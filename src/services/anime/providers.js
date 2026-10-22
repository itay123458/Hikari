import { CachedHttp, ProviderError } from './http.js';
import { animeId, isoWeek } from './domain.js';

function queryUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  return url.href;
}

export class Jikan {
  constructor(http = new CachedHttp({ provider: 'Jikan', interval: 1100 })) { this.http = http; }
  get(path, params = {}, ttl = 3600000) { return this.http.get(queryUrl(`https://api.jikan.moe/v4/${path}`, params), { ttl }); }
  search(kind, params) {
    if (!['anime', 'characters', 'people'].includes(kind)) throw new Error('Invalid search type.');
    return this.get(kind, { ...params, limit: 10, ...(kind === 'anime' ? { sfw: true } : {}) }, 300000);
  }
  anime(id) { return this.get(`anime/${animeId(id)}/full`).then(r => r.data); }
  resource(id, part) {
    if (!['characters', 'recommendations', 'relations', 'streaming', 'news', 'videos'].includes(part)) throw new Error('Unknown anime resource.');
    return this.get(`anime/${animeId(id)}/${part}`).then(r => r.data);
  }
  person(kind, id) {
    if (!['characters', 'people'].includes(kind)) throw new Error('Invalid person type.');
    return this.get(`${kind}/${animeId(id)}/full`).then(r => r.data);
  }
  season(which, date = new Date(), page = 1) {
    const seasons = ['winter', 'spring', 'summer', 'fall'];
    const month = date.getUTCMonth();
    let year = date.getUTCFullYear(), index = Math.floor(month / 3);
    if (which === 'previous') { if (--index < 0) { index = 3; year--; } }
    if (which === 'upcoming') return this.get('seasons/upcoming', { page, limit: 10, sfw: true }, 900000);
    return this.get(`seasons/${year}/${seasons[index]}`, { page, limit: 10, sfw: true }, 900000);
  }
}

export function exactMalId(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    return ['myanimelist.net', 'www.myanimelist.net'].includes(url.hostname) ? Number(url.pathname.match(/^\/anime\/(\d+)(?:\/|$)/)?.[1]) || null : null;
  } catch { return null; }
}

export function safeUrl(value, domains) {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (domains && !domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
    return url.href;
  } catch { return null; }
}

const STREAM_DOMAINS = ['crunchyroll.com', 'netflix.com', 'hidive.com', 'hulu.com', 'amazon.com', 'primevideo.com', 'disneyplus.com', 'bilibili.com', 'bilibili.tv', 'youtube.com', 'youtu.be', 'tubitv.com', 'iq.com', 'abema.tv', 'aniplus-asia.com', 'animationdigitalnetwork.fr'];
export function streamingLinks(entries = []) {
  return entries.flatMap(entry => {
    const url = safeUrl(entry.url, STREAM_DOMAINS);
    return url ? [{ name: entry.name || entry.platform || 'Stream', url, region: null, languages: null, source: 'Provider listing' }] : [];
  }).filter((entry, i, all) => all.findIndex(other => other.url === entry.url) === i);
}

export function knownDate(value) {
  if (!value || String(value).startsWith('0001-')) return null;
  const date = new Date(value);
  return Number.isNaN(+date) ? null : date.toISOString();
}
export function normalizeTimetable(rows) {
  if (!Array.isArray(rows)) throw new ProviderError('AnimeSchedule');
  return rows.map(row => ({
    route: row.route, title: row.title || row.english || row.romaji || 'Unknown title',
    type: ['raw', 'sub', 'dub'].includes(row.airType) ? row.airType : 'unknown',
    episode: row.episodeNumber || null, at: knownDate(row.episodeDate),
    delay: row.delayedText || (row.airingStatus === 'delayed-air' ? 'Delayed; new time unknown' : null),
    delayedUntil: knownDate(row.delayedUntil), status: row.airingStatus || null,
    streams: streamingLinks(Array.isArray(row.streams) ? row.streams : []),
    publishedOnCrunchyroll: null, region: null,
    source: `https://animeschedule.net/anime/${encodeURIComponent(row.route)}`,
  }));
}

export class AnimeSchedule {
  constructor({ token = process.env.ANIMESCHEDULE_TOKEN || '', http = new CachedHttp({ provider: 'AnimeSchedule', interval: 600 }) } = {}) {
    this.token = token; this.http = http;
  }
  async get(path, params = {}, ttl = 300000) {
    if (!this.token) throw new Error('Schedules require ANIMESCHEDULE_TOKEN. Ask the bot operator to configure an application token.');
    return this.http.get(queryUrl(`https://animeschedule.net/api/v3/${path}`, params), { ttl, headers: { Authorization: `Bearer ${this.token}` } });
  }
  async timetable(type = 'all', date = new Date()) {
    if (!['all', 'raw', 'sub', 'dub'].includes(type)) throw new Error('Invalid release type.');
    // Request UTC and localize in Discord. Preserve actual returned airType:
    // AnimeSchedule can fall back from a sub request to raw.
    return normalizeTimetable(await this.get(`timetables/${type}`, { ...isoWeek(date), tz: 'UTC' }));
  }
  async resolve(id) {
    const result = await this.get('anime', { 'mal-ids': animeId(id) }, 86400000);
    const rows = Array.isArray(result) ? result : result.anime;
    if (!Array.isArray(rows)) throw new ProviderError('AnimeSchedule');
    const exact = rows.filter(row => exactMalId(row.websites?.mal) === Number(id));
    return exact.length === 1 ? exact[0] : null;
  }
  async anime(route) {
    if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(route)) throw new Error('Invalid AnimeSchedule slug.');
    return this.get(`anime/${route}`, {}, 300000);
  }
}

export async function resolveMapping(store, schedule, guildId, id) {
  const confirmed = await store.read('mapping', `${guildId}:${id}`);
  if (confirmed?.route) return confirmed;
  const exact = await schedule.resolve(id);
  return exact ? { route: exact.route, method: 'exact-mal-link', malId: Number(id) } : null;
}

export async function releaseGuide(jikan, id) {
  const queue = [Number(id)], seen = new Set(), titles = [];
  while (queue.length && titles.length < 12) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    const anime = await jikan.anime(next);
    titles.push(anime);
    for (const relation of anime.relations || []) {
      if (['Prequel', 'Sequel', 'Parent story', 'Side story', 'Full story'].includes(relation.relation)) {
        for (const entry of relation.entry || []) if (entry.type === 'anime' && !seen.has(entry.mal_id)) queue.push(entry.mal_id);
      }
    }
  }
  return { entries: titles.sort((a, b) => (knownDate(a.aired?.from) || '9999').localeCompare(knownDate(b.aired?.from) || '9999')), truncated: queue.length > 0 };
}

export const providers = { jikan: new Jikan(), schedule: new AnimeSchedule() };
