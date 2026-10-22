import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './helpers/database.js';
import { AnimeWorker, deliverOnce, episodeKey } from '../src/services/anime/worker.js';
import { Community } from '../src/services/anime/community.js';
import { Tracking } from '../src/services/anime/tracking.js';

function channel(sent, { fail = false } = {}) {
  return { id: 'c', messages: { fetch: async () => new Map(sent.map((m, i) => [String(i), m])) }, send: async body => {
    if (fail) throw new Error('connection lost');
    const result = { id: String(sent.length + 1), nonce: body.nonce, author: { id: 'bot' }, content: body.content };
    sent.push(result); return result;
  } };
}

test('notification receipts and Discord nonces prevent a duplicate after restart', async t => {
  const store = await testStore(t), sent = [], target = channel(sent);
  const job = await store.enqueue('release', 'episode', {}, new Date());
  await deliverOnce(store, job, target, { content: 'episode' }, 'bot');
  await deliverOnce(store, job, target, { content: 'episode' }, 'bot');
  assert.equal(sent.length, 1);
  assert.equal((await store.delivery(job.id)).message_id, '1');
});

test('a crashed send is reconciled from history rather than repeated', async t => {
  const store = await testStore(t), sent = [], target = channel(sent);
  const job = await store.enqueue('release', 'episode', {}, new Date());
  await store.beginDelivery(job.id, 'c');
  sent.push({ id: 'already', nonce: `hikari-${job.id}`, author: { id: 'bot' } });
  await deliverOnce(store, job, target, { content: 'episode' }, 'bot');
  assert.equal(sent.length, 1);
  assert.equal((await store.delivery(job.id)).message_id, 'already');
});

test('ambiguous network sends are held, never blindly retried', async t => {
  const store = await testStore(t), sent = [], target = channel(sent, { fail: true });
  const job = await store.enqueue('release', 'episode', {}, new Date());
  await deliverOnce(store, job, target, { content: 'episode' }, 'bot');
  assert.equal((await store.delivery(job.id)).state, 'uncertain');
  await deliverOnce(store, job, channel(sent), { content: 'episode' }, 'bot');
  assert.equal(sent.length, 0);
});

test('scheduled episode identity ignores changed air dates, but distinguishes seasons and release tracks', () => {
  assert.equal(episodeKey('g', 1, { type: 'sub', episode: 3, at: 'old' }), episodeKey('g', 1, { type: 'sub', episode: 3, at: 'new' }));
  assert.notEqual(episodeKey('g', 1, { type: 'sub', episode: 3 }), episodeKey('g', 2, { type: 'sub', episode: 3 }));
  assert.notEqual(episodeKey('g', 1, { type: 'sub', episode: 3 }), episodeKey('g', 1, { type: 'dub', episode: 3 }));
});

test('a rescheduled episode is deferred and an unfollowed episode is canceled at delivery', async t => {
  const store = await testStore(t), community = new Community(store), tracking = new Tracking(store, {});
  const now = new Date('2026-10-22T12:00:00Z');
  await community.edit('g', g => { g.follows[1] = { malId: 1, route: 'exact', type: 'sub', sinceAt: '2026-10-21T00:00:00Z' }; return g; });
  await store.mutate('mapping', 'g:1', () => ({ route: 'exact' }));
  const worker = new AnimeWorker({ guilds: { cache: new Map() } }, { store, community, tracking, schedule: { timetable: async () => [{ route: 'exact', type: 'sub', episode: 2, at: '2026-10-22T15:00:00Z', title: 'Test' }] } }, { now: () => now });
  const job = await store.enqueue('test', 'episode', { guildId: 'g', malId: 1, type: 'sub', episode: 2 }, now);
  await worker.handleEpisode(job, { notifications: true, modules: ['announcements'] });
  const saved = (await store.pool.query('SELECT state,run_at FROM anime_jobs WHERE id=$1', [job.id])).rows[0];
  assert.equal(saved.state, 'pending');
  assert.equal(new Date(saved.run_at).toISOString(), '2026-10-22T15:00:00.000Z');
  await community.edit('g', g => { delete g.follows[1]; return g; });
  await worker.handleEpisode(job, { notifications: true, modules: ['announcements'] });
  assert.equal((await store.pool.query('SELECT state FROM anime_jobs WHERE id=$1', [job.id])).rows[0].state, 'canceled');
});

test('notification quiet hours defer before attempting delivery', async t => {
  const store = await testStore(t);
  const now = new Date('2026-10-22T21:00:00Z');
  const worker = new AnimeWorker({}, { store }, { now: () => now });
  const job = await store.enqueue('quiet', 'feed', { guildId: 'g' }, now);
  assert.equal(await worker.quiet(job, { timezone: 'Asia/Jerusalem', quietStart: '22:00', quietEnd: '08:00' }), true);
  assert.equal(new Date((await store.pool.query('SELECT run_at FROM anime_jobs WHERE id=$1', [job.id])).rows[0].run_at).toISOString(), '2026-10-23T05:00:00.000Z');
});

test('a slow provider scan does not block due jobs on the next worker tick', async t => {
  const store = await testStore(t);
  let entered, release;
  const started = new Promise(r => { entered = r; });
  const blocked = new Promise(r => { release = r; });
  const worker = new AnimeWorker({ guilds: { cache: new Map() } }, { store });
  worker.planner.reconcile = async () => { entered(); await blocked; };
  const first = worker.tick();
  await started;
  const job = await store.enqueue('during-scan', 'test', { guildId: 'missing' }, new Date());
  try {
    await Promise.race([worker.tick(), new Promise(r => setTimeout(r, 50))]);
    assert.equal((await store.pool.query('SELECT state FROM anime_jobs WHERE id=$1', [job.id])).rows[0].state, 'canceled');
  } finally { release(); await first; await worker.stop(); }
});

test('a provider response arriving after erasure cannot recreate private jobs or snapshots', async t => {
  const store = await testStore(t), community = new Community(store), tracking = new Tracking(store, {});
  const now = new Date('2026-10-22T12:00:00Z');
  const follow = { malId: 1, type: 'sub', guildId: 'g', sinceAt: '2026-10-21T00:00:00Z' };
  await tracking.edit('u', p => { p.follows[1] = follow; return p; });
  let release, entered;
  const started = new Promise(r => { entered = r; });
  const provider = new Promise(r => { release = r; });
  const worker = new AnimeWorker({}, { store, tracking, community, schedule: { resolve: async () => { entered(); return provider; } } }, { now: () => now });
  const planning = worker.planner.follow('g', follow, [{ route: 'exact', type: 'sub', episode: 2, at: '2026-10-22T15:00:00Z' }], 'u');
  await started;
  await store.eraseUser('u');
  release({ route: 'exact' });
  await planning;
  assert.equal(await store.read('schedule-snapshot', 'user-u:1'), null);
  assert.equal((await store.pool.query('SELECT count(*) AS n FROM anime_jobs')).rows[0].n, 0);
});
