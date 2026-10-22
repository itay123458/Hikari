import { randomUUID } from 'node:crypto';

export class AnimeStore {
  constructor(pool, connection = null) { this.pool = pool; this.connection = connection; }

  async transaction(work) {
    if (this.connection) return work(this);
    const conn = await this.pool.connect();
    try {
      await conn.query('BEGIN');
      const result = await work(new AnimeStore({ query: (sql, args) => conn.query(sql, args) }, conn));
      await conn.query('COMMIT');
      return result;
    } catch (error) { await conn.query('ROLLBACK'); throw error; }
    finally { conn.release(); }
  }

  async withDocument(scope, id, work) {
    return this.transaction(async tx => {
      const { rows } = await tx.pool.query('SELECT data FROM anime_documents WHERE scope=$1 AND id=$2 FOR UPDATE', [scope, String(id)]);
      if (!rows.length) return false;
      await work(tx, rows[0].data);
      return true;
    });
  }

  async read(scope, id, fallback = null) {
    const { rows } = await this.pool.query('SELECT data FROM anime_documents WHERE scope=$1 AND id=$2', [scope, String(id)]);
    return rows[0]?.data ?? structuredClone(fallback);
  }

  async list(scope) {
    const { rows } = await this.pool.query('SELECT id,data FROM anime_documents WHERE scope=$1 ORDER BY id', [scope]);
    return rows;
  }

  async mutate(scope, id, change, initial = {}) {
    const conn = this.connection || await this.pool.connect();
    try {
      if (!this.connection) await conn.query('BEGIN');
      await conn.query('INSERT INTO anime_documents(scope,id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [scope, String(id), JSON.stringify(initial)]);
      const { rows } = await conn.query('SELECT data FROM anime_documents WHERE scope=$1 AND id=$2 FOR UPDATE', [scope, String(id)]);
      const next = await change(rows[0].data);
      if (next === undefined) throw new Error('An anime update must return its saved state.');
      await conn.query('UPDATE anime_documents SET data=$3,updated_at=now() WHERE scope=$1 AND id=$2', [scope, String(id), JSON.stringify(next)]);
      if (!this.connection) await conn.query('COMMIT');
      return next;
    } catch (error) {
      if (!this.connection) await conn.query('ROLLBACK');
      throw error;
    } finally { if (!this.connection) conn.release(); }
  }

  async remove(scope, id) { await this.pool.query('DELETE FROM anime_documents WHERE scope=$1 AND id=$2', [scope, String(id)]); }

  async session(data, minutes = 15) {
    const id = randomUUID().replaceAll('-', '');
    await this.mutate('session', id, () => ({ ...data, expiresAt: Date.now() + minutes * 60000 }));
    return id;
  }

  async enqueue(key, kind, payload, at) {
    const { rows } = await this.pool.query(`INSERT INTO anime_jobs(unique_key,kind,payload,run_at)
      VALUES($1,$2,$3,$4) ON CONFLICT(unique_key) DO NOTHING RETURNING *`, [key, kind, JSON.stringify(payload), at]);
    return rows[0] ?? null;
  }

  async claim(now = new Date(), leaseMs = 120000) {
    const { rows } = await this.pool.query(`UPDATE anime_jobs SET state='running',lease_until=$2,attempts=attempts+1
      WHERE id=(SELECT id FROM anime_jobs WHERE (state='pending' AND run_at<=$1)
        OR (state='running' AND lease_until<$1) ORDER BY run_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`, [now, new Date(+now + leaseMs)]);
    return rows[0] ?? null;
  }

  async finish(id, state = 'done') {
    await this.pool.query('UPDATE anime_jobs SET state=$2,lease_until=NULL WHERE id=$1', [id, state]);
  }

  async defer(id, at) {
    await this.pool.query("UPDATE anime_jobs SET state='pending',run_at=$2,lease_until=NULL WHERE id=$1", [id, at]);
  }

  async schedule(key, kind, payload, at) {
    await this.pool.query(`INSERT INTO anime_jobs(unique_key,kind,payload,run_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(unique_key) DO UPDATE SET payload=EXCLUDED.payload,run_at=EXCLUDED.run_at,state='pending'
      WHERE anime_jobs.state IN ('pending','canceled') AND NOT EXISTS
        (SELECT 1 FROM anime_deliveries WHERE job_id=anime_jobs.id)`, [key, kind, JSON.stringify(payload), at]);
  }

  async acquireLease(name, now, duration = 300000, owner = null) {
    const { rows } = await this.pool.query(`INSERT INTO anime_locks(name,until_at,owner) VALUES($1,$3,$4)
      ON CONFLICT(name) DO UPDATE SET until_at=EXCLUDED.until_at,owner=EXCLUDED.owner WHERE anime_locks.until_at<=$2 RETURNING name`, [name, now, new Date(+now + duration), owner]);
    return rows.length > 0;
  }

  async retry(job, message, at = new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7)))) {
    await this.pool.query(`UPDATE anime_jobs SET state=$2,run_at=$3,lease_until=NULL,last_error=$4 WHERE id=$1`,
      [job.id, job.attempts >= 8 ? 'failed' : 'pending', at, String(message).slice(0, 200)]);
  }

  async delivery(id) {
    return (await this.pool.query('SELECT * FROM anime_deliveries WHERE job_id=$1', [id])).rows[0] ?? null;
  }

  async beginDelivery(id, channelId) {
    return (await this.pool.query(`INSERT INTO anime_deliveries(job_id,channel_id,state) VALUES($1,$2,'sending')
      ON CONFLICT DO NOTHING RETURNING *`, [id, channelId])).rows[0] ?? null;
  }

  async receipt(id, messageId, state = 'sent') {
    await this.pool.query('UPDATE anime_deliveries SET state=$3,message_id=$2 WHERE job_id=$1', [id, messageId, state]);
  }

  async eraseUser(userId) {
    // Erasure also removes explicit public contributions and votes. Discord posts
    // are separately reconciled by the service; database backups follow retention.
    const conn = await this.pool.connect();
    const affected = [];
    try {
      await conn.query('BEGIN');
      await conn.query("DELETE FROM anime_documents WHERE (scope='profile' AND id=$1) OR (scope='session' AND data->>'ownerId'=$1)", [userId]);
      await conn.query("DELETE FROM anime_documents WHERE scope='schedule-snapshot' AND id LIKE $1", [`user-${userId}:%`]);
      await conn.query("UPDATE anime_documents SET data=data-'confirmedBy'-'verifiedBy' WHERE (scope='mapping' AND data->>'confirmedBy'=$1) OR (scope='chronology' AND data->>'verifiedBy'=$1)", [userId]);
      const { rows } = await conn.query("SELECT id,data FROM anime_documents WHERE scope='guild' FOR UPDATE");
      for (const row of rows) {
        for (const kind of ['parties', 'polls', 'tournaments', 'games']) {
          for (const item of Object.values(row.data[kind] || {})) {
            if (!item.messageId) continue;
            if (item.ownerId === userId) affected.push({ guildId: row.id, kind, id: item.id, channelId: item.channelId, messageId: item.messageId, remove: true });
            else if (item.rsvps?.[userId] || item.winnerId === userId || Object.hasOwn(item.votes || {}, userId) || (kind === 'tournaments' && Object.values(item.votes || {}).some(ballot => Object.hasOwn(ballot, userId)))) affected.push({ guildId: row.id, kind, id: item.id });
          }
        }
        const clean = value => {
          if (Array.isArray(value)) return value.filter(v => v?.userId !== userId && v?.ownerId !== userId).map(clean);
          if (!value || typeof value !== 'object') return value;
          if (value.winnerId === userId) value = { ...value, winnerId: null, endedAt: value.endedAt || new Date().toISOString() };
          return Object.fromEntries(Object.entries(value)
            .filter(([key, v]) => key !== userId && v?.ownerId !== userId && v?.userId !== userId)
            .map(([key, v]) => [key, clean(v)]));
        };
        await conn.query("UPDATE anime_documents SET data=$2,updated_at=now() WHERE scope='guild' AND id=$1", [row.id, JSON.stringify(clean(row.data))]);
      }
      await conn.query("DELETE FROM anime_jobs WHERE payload->>'userId'=$1", [userId]);
      await conn.query('COMMIT');
      return affected;
    } catch (error) { await conn.query('ROLLBACK'); throw error; }
    finally { conn.release(); }
  }

  async cleanup() {
    await this.pool.query("DELETE FROM anime_documents WHERE scope='session' AND (data->>'expiresAt')::bigint < $1", [Date.now()]);
    // Delivery keys remain retained; removing them would replay historical alerts.
  }
}
