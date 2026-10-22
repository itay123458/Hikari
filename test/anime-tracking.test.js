import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './helpers/database.js';
import { Tracking } from '../src/services/anime/tracking.js';
import { authorize, validateSession } from '../src/services/anime/access.js';

const anime = { mal_id: 1, title: 'Cowboy Bebop', episodes: 26, duration: '24 min per ep', genres: [{ mal_id: 1, name: 'Action' }], score: 8.7 };

test('watchlist actions persist progress, private notes, rating and monthly totals', async t => {
  const tracking = new Tracking(await testStore(t), { anime: async () => anime });
  await tracking.add('u1', 1, 'watching');
  await tracking.progress('u1', 1, 3, new Date('2026-10-22T00:00:00Z'));
  await tracking.note('u1', 1, 2, 'private episode note');
  await tracking.rate('u1', 1, 9);
  const profile = await tracking.profile('u1');
  assert.equal(profile.list[1].progress, 3);
  assert.equal(profile.list[1].rating, 9);
  assert.equal(profile.notes['1:2'], 'private episode note');
  const stats = await tracking.stats('u1', 'Asia/Jerusalem', new Date('2026-10-22T10:00:00Z'));
  assert.equal(stats.estimatedMinutes, 72);
  assert.equal(stats.monthEpisodes, 3);
  assert.equal((await tracking.profile('u2')).notes['1:2'], undefined);
});

test('concurrent increment buttons do not lose episodes', async t => {
  const tracking = new Tracking(await testStore(t), { anime: async () => anime });
  await tracking.add('u1', 1, 'watching');
  await Promise.all([tracking.increment('u1', 1), tracking.increment('u1', 1)]);
  assert.equal((await tracking.profile('u1')).list[1].progress, 2);
});

test('shared suggestions stop working immediately when consent is revoked', async t => {
  const tracking = new Tracking(await testStore(t), { anime: async () => anime });
  await tracking.add('u1', 1, 'planned'); await tracking.add('u2', 1, 'planned');
  await tracking.privacy('u1', 'g', true); await tracking.privacy('u2', 'g', true);
  assert.equal((await tracking.shared('u1', 'u2', 'g')).suggestions[0].malId, 1);
  await tracking.privacy('u2', 'g', false);
  await assert.rejects(tracking.shared('u1', 'u2', 'g'), /consent/i);
});

test('permissions reject disabled modules, maintenance, wrong owners and expired sessions', () => {
  const args = { member: { permissions: { has: () => false } }, settings: { enabled: true, modules: ['tracking'] }, module: 'tracking' };
  assert.equal(authorize(args), true);
  assert.throws(() => authorize({ ...args, admin: true }), /Manage Server/);
  assert.throws(() => authorize({ ...args, module: 'games' }), /disabled/);
  assert.throws(() => authorize({ ...args, maintenance: true }), /maintenance/);
  assert.throws(() => validateSession({ ownerId: 'u1', guildId: 'g', expiresAt: Date.now() + 10000 }, 'u2', 'g'), /belongs/);
  assert.throws(() => validateSession({ ownerId: 'u1', guildId: 'g', expiresAt: 1 }, 'u1', 'g'), /expired/);
  assert.throws(() => validateSession({ ownerId: 'u1', guildId: 'g', expiresAt: Date.now() + 10000 }, 'u1', 'x'), /server/);
});
