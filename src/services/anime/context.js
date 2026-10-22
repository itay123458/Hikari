import { AnimeStore } from './store.js';
import { Tracking } from './tracking.js';
import { Community } from './community.js';
import { providers } from './providers.js';

export function contextFor(client) {
  if (client.animeServices) return client.animeServices;
  const pool = client.db?.isAvailable?.() ? client.db.db?.pool : null;
  const store = pool ? new AnimeStore(pool) : null;
  const services = { ...providers, store, tracking: store ? new Tracking(store, providers.jikan) : null, community: store ? new Community(store) : null };
  if (store) client.animeServices = services;
  return services;
}
export function requireStore(ctx) {
  if (!ctx.store) throw new Error('Persistent PostgreSQL is required for this action. The bot operator must restore the database; no personal data was saved.');
}
