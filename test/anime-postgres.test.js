import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { AnimeStore } from '../src/services/anime/store.js';
import { animeTableStatements } from '../src/services/anime/schema.js';

test('real PostgreSQL: concurrent connections lock records and claim each job once', { skip: !process.env.TEST_POSTGRES_URL }, async () => {
  const schema = `hikari_test_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_POSTGRES_URL });
  const pool = new pg.Pool({ connectionString: process.env.TEST_POSTGRES_URL, options: `-c search_path=${schema}`, max: 12 });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const sql of animeTableStatements) await pool.query(sql);
    const store = new AnimeStore(pool);
    await Promise.all(Array.from({ length: 20 }, () => store.mutate('profile', 'u', p => ({ value: (p.value || 0) + 1 }))));
    assert.equal((await store.read('profile', 'u')).value, 20);
    for (let i = 0; i < 8; i++) await store.enqueue(`job-${i}`, 'test', {}, new Date());
    const claimed = await Promise.all(Array.from({ length: 12 }, () => store.claim()));
    assert.equal(claimed.filter(Boolean).length, 8);
    assert.equal(new Set(claimed.filter(Boolean).map(j => j.id)).size, 8);
    const leases = await Promise.all(Array.from({ length: 10 }, () => store.acquireLease('scan', new Date(), 60000)));
    assert.equal(leases.filter(Boolean).length, 1);
    const now = new Date();
    const pending = await store.enqueue('fenced', 'episode', {}, now);
    const first = await store.claim(now, 1);
    const second = await store.claim(new Date(+now + 2));
    assert.equal(first.id, pending.id);
    assert.equal(second.id, pending.id);
    await store.finish(first, 'canceled');
    await store.defer(first, now);
    await store.retry(first, 'stale', now);
    assert.equal((await pool.query('SELECT state FROM anime_jobs WHERE id=$1', [pending.id])).rows[0].state, 'running');
    assert.equal(await store.beginDelivery(first, 'channel'), null);
    await store.transaction(async tx => {
      await tx.beginDelivery(second, 'channel');
      // An independent connection must not see an uncommitted intent.
      assert.equal((await pool.query('SELECT * FROM anime_deliveries WHERE job_id=$1', [pending.id])).rows.length, 0);
    });
    assert.equal((await pool.query('SELECT * FROM anime_deliveries WHERE job_id=$1', [pending.id])).rows.length, 1);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
