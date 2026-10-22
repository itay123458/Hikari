import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { animeTableStatements } from '../src/services/anime/schema.js';
import { AnimeStore } from '../src/services/anime/store.js';
import { updateProgress, compareProfiles, readReview, validateSettings, quietUntil } from '../src/services/anime/domain.js';

async function database(t) {
  const db = new PGlite();
  t.after(() => db.close());
  for (const sql of animeTableStatements) await db.query(sql);
  let tail = Promise.resolve();
  const pool = {
    query: (sql, args) => db.query(sql, args),
    connect: async () => {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      return { query: (sql, args) => db.query(sql, args), release };
    },
  };
  return new AnimeStore(pool);
}

test('transactional edits persist and serialize simultaneous progress updates', async t => {
  const store = await database(t);
  await Promise.all(Array.from({ length: 12 }, () => store.mutate('profile', 'u1', p => {
    p.count = (p.count || 0) + 1;
    return p;
  })));
  assert.equal((await store.read('profile', 'u1')).count, 12);
  await assert.rejects(store.mutate('profile', 'u1', () => { throw new Error('abort'); }), /abort/);
  assert.equal((await store.read('profile', 'u1')).count, 12);
});

test('jobs deduplicate keys, recover expired claims, and do not reclaim completed jobs', async t => {
  const store = await database(t);
  const at = new Date('2026-10-22T10:00:00Z');
  await store.enqueue('episode:1', 'episode', { userId: 'u1' }, at);
  await store.enqueue('episode:1', 'episode', { userId: 'u1' }, at);
  const first = await store.claim(at, 1000);
  assert.equal(first.kind, 'episode');
  assert.equal(await store.claim(at, 1000), null);
  const recovered = await store.claim(new Date(+at + 1001), 1000);
  assert.equal(recovered.id, first.id);
  await store.finish(first.id);
  assert.equal(await store.claim(new Date(+at + 3000)), null);
});

test('data erasure removes private documents, author content and personal jobs', async t => {
  const store = await database(t);
  await store.mutate('profile', 'u1', () => ({ notes: ['secret'] }));
  await store.mutate('session', 's1', () => ({ ownerId: 'u1' }));
  await store.mutate('guild', 'g1', () => ({ reviews: [{ userId: 'u1', text: 'x' }, { userId: 'u2', text: 'y' }], polls: { p: { votes: { u1: 1, u2: 0 } } }, games: { game: { ownerId: 'u2', winnerId: 'u1', expiresAt: Date.now() + 60000 } } }));
  await store.mutate('schedule-snapshot', 'user-u1:21', () => ({ 'sub:1': { at: 'private follow' } }));
  await store.enqueue('personal', 'reminder', { userId: 'u1' }, new Date());
  await store.eraseUser('u1');
  assert.equal(await store.read('profile', 'u1'), null);
  assert.equal(await store.read('session', 's1'), null);
  const guild = await store.read('guild', 'g1');
  assert.equal(guild.reviews.length, 1);
  assert.deepEqual(guild.polls.p.votes, { u2: 0 });
  assert.equal(guild.games.game.winnerId, null);
  assert.ok(guild.games.game.endedAt);
  assert.equal(await store.read('schedule-snapshot', 'user-u1:21'), null);
  assert.equal(await store.claim(new Date(Date.now() + 1000)), null);
});

test('progress rejects invalid counts and records only increases in history', () => {
  const p = { list: { 1: { episodes: 12, progress: 2 } } };
  assert.throws(() => updateProgress(p, 1, 13), /episode/i);
  assert.throws(() => updateProgress(p, 1, -1), /episode/i);
  updateProgress(p, 1, 5, new Date('2026-10-22T00:00:00Z'));
  updateProgress(p, 1, 4);
  assert.equal(p.history[0].delta, 3);
  assert.equal(p.history.length, 1);
});

test('sharing needs both current guild consents and never discloses private notes', () => {
  const a = { consent: { g: true }, list: { 1: { rating: 8 } }, notes: ['secret'] };
  const b = { consent: {}, list: { 1: { rating: 9 } } };
  assert.throws(() => compareProfiles(a, b, 'g'), /consent/i);
  b.consent.g = true;
  assert.deepEqual(compareProfiles(a, b, 'g').sharedIds, ['1']);
  assert.equal(JSON.stringify(compareProfiles(a, b, 'g')).includes('secret'), false);
  b.consent.g = false;
  assert.throws(() => compareProfiles(a, b, 'g'), /consent/i);
});

test('spoiler reviews require explicit private confirmation past recorded progress', () => {
  const review = { animeId: 1, episode: 8, spoiler: true, text: 'secret' };
  assert.equal(readReview(review, { list: { 1: { progress: 2 } } }, false).text, undefined);
  assert.equal(readReview(review, { list: { 1: { progress: 2 } } }, true).text, 'secret');
  assert.equal(readReview(review, {}, false).warning, true);
});

test('settings validate time zones and overnight quiet hours across Israel DST', () => {
  assert.throws(() => validateSettings({ timezone: 'Invalid/Zone' }), /time zone/i);
  assert.throws(() => validateSettings({ quietStart: '25:00' }), /quiet/i);
  const settings = validateSettings({ timezone: 'Asia/Jerusalem', quietStart: '22:00', quietEnd: '08:00' });
  assert.equal(quietUntil(settings, new Date('2026-10-22T21:00:00Z')).toISOString(), '2026-10-23T05:00:00.000Z');
  assert.equal(quietUntil(settings, new Date('2026-10-25T21:00:00Z')).toISOString(), '2026-10-26T06:00:00.000Z');
});
