import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './helpers/database.js';
import { AnimePlanner } from '../src/services/anime/planner.js';
import { AnimeWorker } from '../src/services/anime/worker.js';
import { Community } from '../src/services/anime/community.js';
import { validateSettings } from '../src/services/anime/domain.js';
import animeCommand from '../src/commands/Anime/anime.js';

test('conversation prompts default off and expose admin channel/cadence controls', () => {
  assert.equal(validateSettings({}).conversationDays, 0);
  assert.equal(validateSettings({ conversationDays: 2, conversationChannel: 'chat' }).conversationDays, 2);
  assert.throws(() => validateSettings({ conversationDays: -1 }));
  const admin = animeCommand.data.toJSON().options.find(option => option.name === 'admin');
  assert(admin.options.find(option => option.name === 'channels').options.some(option => option.name === 'conversation'));
  assert(admin.options.find(option => option.name === 'feeds').options.some(option => option.name === 'prompt-days'));
});

test('concurrent scans reserve one prompt, wait two local calendar days, and survive Israel DST', async t => {
  const store = await testStore(t), community = new Community(store);
  let now = new Date('2026-10-24T16:00:00Z'); // Saturday 19:00, before Israel DST ends.
  const config = { anime: { conversationChannel: 'chat', conversationDays: 2, timezone: 'Asia/Jerusalem', modules: ['community'] } };
  const client = { db: { get: async () => config }, guilds: { cache: new Map([['g', { id: 'g' }]]) } };
  const ctx = { store, community, tracking: {}, schedule: { timetable: async () => [] } };
  const planner = new AnimePlanner(client, ctx, () => now);
  await Promise.all([planner.reconcile(), planner.reconcile()]);
  let rows = (await store.pool.query("SELECT payload FROM anime_jobs WHERE kind='conversation'")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.channelId, 'chat');
  now = new Date('2026-10-25T17:00:00Z'); // Sunday 19:00, after the clocks change.
  await new AnimePlanner(client, ctx, () => now).reconcile();
  assert.equal((await store.pool.query("SELECT count(*) AS n FROM anime_jobs WHERE kind='conversation'")).rows[0].n, 1);
  now = new Date('2026-10-26T17:00:00Z');
  await planner.reconcile();
  rows = (await store.pool.query("SELECT payload FROM anime_jobs WHERE kind='conversation' ORDER BY id")).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].payload.sequence, rows[0].payload.sequence + 1);
  config.anime.conversationDays = 0;
  now = new Date('2026-10-28T17:00:00Z');
  await planner.reconcile();
  assert.equal((await store.pool.query("SELECT count(*) AS n FROM anime_jobs WHERE kind='conversation'")).rows[0].n, 2);
});

test('prompt delivery uses the configured channel without pings, deduplicates, and rejects revoked or stale jobs', async t => {
  const store = await testStore(t), sent = [];
  const now = new Date('2026-10-22T16:00:00Z');
  const config = { anime: { conversationChannel: 'chat', conversationDays: 2, timezone: 'Asia/Jerusalem', modules: ['community'] } };
  const target = { id: 'chat', isTextBased: () => true, isDMBased: () => false, permissionsFor: () => ({ has: () => true }), messages: { fetch: async () => new Map(sent.map((m, i) => [i, m])) }, send: async body => { const result = { id: String(sent.length + 1), nonce: body.nonce, author: { id: 'bot' }, body }; sent.push(result); return result; } };
  const guild = { id: 'g', members: { fetchMe: async () => ({ id: 'bot' }) }, channels: { fetch: async id => { assert.equal(id, 'chat'); return target; } } };
  const client = { user: { id: 'bot' }, db: { get: async () => config }, guilds: { cache: new Map([['g', guild]]) } };
  const worker = new AnimeWorker(client, { store }, { now: () => now });
  const payload = { guildId: 'g', channelId: 'chat', days: 2, date: '2026-10-22', sequence: 0 };
  const job = await store.enqueue('prompt-one', 'conversation', payload, now);
  await worker.handle(job); await worker.handle(job);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.allowedMentions, { parse: [] });
  assert(sent[0].body.embeds[0].toJSON().description.length > 30);
  const stale = await store.enqueue('old', 'conversation', { ...payload, date: '2026-10-20' }, now);
  await worker.handle(stale);
  config.anime.conversationDays = 0;
  const disabled = await store.enqueue('disabled', 'conversation', payload, now); await worker.handle(disabled);
  config.anime.conversationDays = 2; config.anime.conversationChannel = 'different';
  const moved = await store.enqueue('moved', 'conversation', payload, now); await worker.handle(moved);
  config.anime.conversationChannel = 'chat'; config.anime.conversationDays = 3;
  const cadence = await store.enqueue('cadence', 'conversation', payload, now); await worker.handle(cadence);
  config.anime.conversationDays = 2; config.anime.notifications = false;
  const muted = await store.enqueue('muted', 'conversation', payload, now); await worker.handle(muted);
  config.anime.notifications = true; config.anime.modules = [];
  const moduleOff = await store.enqueue('module-off', 'conversation', payload, now); await worker.handle(moduleOff);
  assert.equal(sent.length, 1);
  for (const canceled of [stale, disabled, moved, cadence, muted, moduleOff]) assert.equal((await store.pool.query('SELECT state FROM anime_jobs WHERE id=$1', [canceled.id])).rows[0].state, 'canceled');
});

test('prompts wait for the evening window without sending overnight', async t => {
  const store = await testStore(t), now = new Date('2026-10-22T08:00:00Z');
  const worker = new AnimeWorker({}, { store }, { now: () => now });
  const job = await store.enqueue('early', 'conversation', { date: '2026-10-22', channelId: 'chat', days: 2, sequence: 0 }, now);
  await worker.handleConversation(job, validateSettings({ conversationChannel: 'chat', conversationDays: 2 }));
  const saved = (await store.pool.query('SELECT state,run_at FROM anime_jobs WHERE id=$1', [job.id])).rows[0];
  assert.equal(saved.state, 'pending');
  assert.equal(new Date(saved.run_at).toISOString(), '2026-10-22T15:30:00.000Z');
});
