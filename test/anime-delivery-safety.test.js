import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './helpers/database.js';
import { AnimeStore } from '../src/services/anime/store.js';
import { deliverOnce } from '../src/services/anime/notifications.js';
import { sendableChannel } from '../src/services/anime/access.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { animeTableStatements } from '../src/services/anime/schema.js';

test('late uncertain recovery cannot downgrade a confirmed receipt', async t => {
  const store = await testStore(t);
  const job = await store.enqueue('monotonic-receipt', 'episode', {}, new Date());
  await store.beginDelivery(job, 'channel');
  await store.receipt(job.id, 'confirmed', 'sent');
  await store.receipt(job.id, null, 'uncertain');
  const receipt = await store.delivery(job.id);
  assert.equal(receipt.state, 'sent');
  assert.equal(receipt.message_id, 'confirmed');
});

for (const mutation of ['finish', 'defer', 'retry']) test(`reclaimed attempts reject stale ${mutation}`, async t => {
  const store = await testStore(t), now = new Date();
  await store.enqueue(mutation, 'episode', {}, now);
  const stale = await store.claim(now, 1);
  const current = await store.claim(new Date(+now + 2));
  if (mutation === 'finish') await store.finish(stale, 'canceled');
  if (mutation === 'defer') await store.defer(stale, new Date(+now + 10000));
  if (mutation === 'retry') await store.retry(stale, 'old error');
  const saved = (await store.pool.query('SELECT * FROM anime_jobs WHERE id=$1', [current.id])).rows[0];
  assert.equal(saved.state, 'running');
  assert.equal(saved.attempts, current.attempts);
});

test('stale attempt cannot create an intent or send after reclaim', async t => {
  const store = await testStore(t), now = new Date();
  await store.enqueue('intent', 'episode', {}, now);
  const stale = await store.claim(now, 1);
  await store.claim(new Date(+now + 2));
  let sends = 0;
  const target = { id: 'c', send: async () => { sends++; return { id: 'm' }; } };
  assert.equal(await store.beginDelivery(stale, 'c'), null);
  assert.equal(await deliverOnce(store, stale, target, {}, 'bot'), 'stale');
  assert.equal(sends, 0);
  assert.equal(await store.delivery(stale.id), null);
});

test('recreated store retains uncertain intent and never resends', async t => {
  const store = await testStore(t);
  const job = await store.enqueue('uncertain', 'episode', {}, new Date());
  let sends = 0;
  const target = { id: 'c', messages: { fetch: async () => new Map() }, send: async () => { sends++; throw new Error('lost response'); } };
  await deliverOnce(store, job, target, {}, 'bot');
  const restarted = new AnimeStore(store.pool);
  assert.equal(await deliverOnce(restarted, job, target, {}, 'bot'), 'uncertain');
  assert.equal(sends, 1);
  assert.equal((await restarted.delivery(job.id)).state, 'uncertain');
});

test('channel lookup preserves transient errors before a delivery intent', async () => {
  const network = new Error('network interrupted');
  await assert.rejects(sendableChannel({ channels: { fetch: async () => { throw network; } } }, 'c'), error => error === network);
});

test('uncertain receipts survive database shutdown and reopen and reconcile history', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hikari-delivery-'));
  let db;
  t.after(async () => { if (db) await db.close(); await rm(directory, { recursive: true, force: true }); });
  db = new PGlite(directory);
  for (const statement of animeTableStatements) await db.query(statement);
  let store = new AnimeStore({ query: (sql, args) => db.query(sql, args) });
  const job = await store.enqueue('persisted', 'episode', {}, new Date());
  await store.beginDelivery(job, 'c');
  await store.receipt(job.id, null, 'uncertain');
  await db.close();
  db = new PGlite(directory);
  store = new AnimeStore({ query: (sql, args) => db.query(sql, args) });
  assert.equal((await store.delivery(job.id)).state, 'uncertain');
  let sends = 0;
  const target = { id: 'c', messages: { fetch: async () => new Map([['m', { id: 'm', nonce: `hikari-${job.id}`, author: { id: 'bot' } }]]) }, send: async () => { sends++; } };
  assert.equal(await deliverOnce(store, job, target, {}, 'bot'), 'sent');
  assert.equal(sends, 0);
  assert.equal((await store.delivery(job.id)).message_id, 'm');
});
