import { logger } from '../../utils/logger.js';

// Discord cannot atomically commit a PostgreSQL receipt. An intent is saved
// before sending. After an ambiguous send, recover from Discord history or hold
// the job for operator reconciliation; do not trade duplicate avoidance for an
// unprovable exactly-once guarantee.
export async function deliverOnce(store, job, channel, body, botId, { admit } = {}) {
  // A completed receipt may be read again, but stale claims must never create an intent.
  const nonce = `hikari-${job.id}`;
  const existing = await store.delivery(job.id);
  if (existing?.state === 'sent') { await store.finish(job); return 'sent'; }
  if (!await store.ownsAttempt(job)) return existing?.state ?? 'stale';
  if (existing) {
    let found;
    try {
      const history = await channel.messages.fetch({ limit: 100 });
      found = [...history.values()].find(msg => String(msg.nonce) === nonce && msg.author?.id === botId);
    } catch { /* no history access: preserve the uncertain intent */ }
    if (found) { await store.receipt(job.id, found.id); await store.finish(job); return 'sent'; }
    if (['blocked', 'failed'].includes(existing.state)) { await store.finish(job, existing.state); return existing.state; }
    await store.receipt(job.id, null, 'uncertain');
    await store.finish(job, 'uncertain');
    logger.warn('Anime delivery held for reconciliation', { event: 'anime.delivery.uncertain', jobId: job.id });
    return 'uncertain';
  }
  if (!(admit ? await admit() : await store.beginDelivery(job, channel.id))) {
    if (!await store.delivery(job.id)) return 'stale';
    return deliverOnce(store, job, channel, body, botId);
  }
  try {
    const sent = await channel.send({ ...body, nonce, enforceNonce: true });
    await store.receipt(job.id, sent.id);
    await store.finish(job);
    return 'sent';
  } catch (error) {
    const definitive = error.code === 50007 ? 'blocked' : [50001, 50013, 10003, 10007, 10013].includes(error.code) ? 'failed' : 'uncertain';
    await store.receipt(job.id, null, definitive);
    await store.finish(job, definitive);
    logger.warn('Anime delivery did not receive a confirmed receipt', { event: `anime.delivery.${definitive}`, jobId: job.id, errorCode: String(error.code || 'TRANSPORT_UNCERTAIN') });
    return definitive;
  }
}
