import { STATUSES, profileDefaults, animeId, titleOf, episodeMinutes, updateProgress, compareProfiles, localDate } from './domain.js';

export class Tracking {
  constructor(store, jikan) { this.store = store; this.jikan = jikan; }
  async profile(userId) { return { ...profileDefaults(), ...await this.store.read('profile', userId, {}) }; }
  edit(userId, change) {
    return this.store.mutate('profile', userId, p => change({ ...profileDefaults(), ...p }), profileDefaults());
  }
  async add(userId, id, status = 'planned') {
    id = animeId(id);
    if (!STATUSES.includes(status)) throw new Error('Unknown watchlist status.');
    const anime = await this.jikan.anime(id);
    if (!anime?.mal_id) throw new Error('Anime not found.');
    return this.edit(userId, profile => {
      if (!profile.list[id] && Object.keys(profile.list).length >= 500) throw new Error('Your watchlist is full (500 anime). Export or remove an entry first.');
      profile.list[id] = {
        ...profile.list[id], malId: id, title: titleOf(anime), episodes: anime.episodes || null,
        minutes: episodeMinutes(anime.duration), genres: (anime.genres || []).map(g => g.mal_id),
        score: anime.score || null, progress: profile.list[id]?.progress || 0,
        status, updatedAt: new Date().toISOString(),
      };
      return profile;
    });
  }
  remove(userId, id) {
    return this.edit(userId, p => { delete p.list[animeId(id)]; return p; });
  }
  progress(userId, id, count, now) { return this.edit(userId, p => updateProgress(p, animeId(id), count, now)); }
  increment(userId, id) { return this.edit(userId, p => updateProgress(p, animeId(id), (p.list[id]?.progress || 0) + 1)); }
  rate(userId, id, rating) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) throw new Error('Rating must be an integer from 1 to 10.');
    return this.edit(userId, p => {
      if (!p.list[animeId(id)]) throw new Error('Add this anime to your watchlist first.');
      p.list[id].rating = rating; return p;
    });
  }
  note(userId, id, episode, text) {
    if (!Number.isInteger(episode) || episode < 1 || episode > 100000) throw new Error('Invalid episode context.');
    if (text.length > 1800) throw new Error('Notes are limited to 1800 characters.');
    return this.edit(userId, p => {
      if (!p.list[animeId(id)]) throw new Error('Add this anime to your watchlist first.');
      const key = `${id}:${episode}`;
      if (text) p.notes[key] = text; else delete p.notes[key];
      return p;
    });
  }
  privacy(userId, guildId, enabled) { return this.edit(userId, p => { p.consent[guildId] = Boolean(enabled); return p; }); }
  async shared(left, right, guildId) {
    const [a, b] = await Promise.all([this.profile(left), this.profile(right)]);
    const comparison = compareProfiles(a, b, guildId);
    return { ...comparison, suggestions: comparison.sharedIds.filter(id => !['completed', 'dropped'].includes(a.list[id].status) && !['completed', 'dropped'].includes(b.list[id].status)).map(id => ({ malId: Number(id), title: a.list[id].title })) };
  }
  async random(userId, { status, genre, minimum } = {}) {
    const p = await this.profile(userId);
    const entries = Object.values(p.list).filter(a => (!status || a.status === status) && (!genre || a.genres?.includes(Number(genre))) && (!minimum || (a.score && a.score >= minimum)));
    if (!entries.length) throw new Error('No watchlist entries match these filters.');
    return entries[Math.floor(Math.random() * entries.length)];
  }
  async stats(userId, timezone, now = new Date()) {
    const p = await this.profile(userId);
    const month = localDate(now, timezone).slice(0, 7);
    const history = p.history.filter(h => localDate(new Date(h.at), timezone).startsWith(month));
    return {
      anime: Object.keys(p.list).length,
      episodes: Object.values(p.list).reduce((n, a) => n + a.progress, 0),
      estimatedMinutes: Object.values(p.list).reduce((n, a) => n + (a.minutes || 0) * a.progress, 0),
      unknownDuration: Object.values(p.list).filter(a => a.progress && !a.minutes).length,
      monthEpisodes: history.reduce((n, h) => n + h.delta, 0),
      monthMinutes: history.reduce((n, h) => n + (h.minutes || 0), 0), month,
    };
  }
  async recommendations(userId) {
    const p = await this.profile(userId);
    const seeds = Object.values(p.list).filter(a => a.status === 'completed' || a.rating >= 7).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 2);
    const ranked = new Map();
    for (const seed of seeds) {
      const entries = await this.jikan.resource(seed.malId, 'recommendations');
      for (const row of entries || []) {
        if (!row.entry?.mal_id || p.list[row.entry.mal_id]) continue;
        const old = ranked.get(row.entry.mal_id);
        ranked.set(row.entry.mal_id, { ...row.entry, weight: (old?.weight || 0) + (row.votes || 0) * (seed.rating || 7), reason: `Recommended by MAL users for ${seed.title}` });
      }
    }
    if (p.preferences.length || !ranked.size) {
      const result = await this.jikan.search('anime', { genres: p.preferences.join(','), order_by: 'score', sort: 'desc', min_score: 6 });
      for (const a of result.data || []) if (!p.list[a.mal_id]) ranked.set(a.mal_id, { ...a, weight: (ranked.get(a.mal_id)?.weight || 0) + 100, reason: p.preferences.length ? 'Matches your preferred genres' : 'Highly rated on MAL; add ratings to personalize' });
    }
    return [...ranked.values()].sort((a, b) => b.weight - a.weight).slice(0, 10);
  }
}
