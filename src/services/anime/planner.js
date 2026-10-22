import { createHash } from 'node:crypto';
import { localDate, localTime, isoWeek, validateSettings } from './domain.js';
import { resolveMapping, safeUrl } from './providers.js';
import { logger } from '../../utils/logger.js';
import { calendarDay } from './conversation.js';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
export const episodeKey = (target, id, event) => `episode:${target}:${id}:${event.type}:${event.episode}`;

export class AnimePlanner {
  constructor(client, ctx, now = () => new Date()) { Object.assign(this, { client, ctx, now }); }
  async timetables() {
    const now = this.now();
    const current = await this.ctx.schedule.timetable('all', now);
    const next = await this.ctx.schedule.timetable('all', new Date(+now + 7 * 86400000));
    const unique = new Map([...current, ...next].map(e => [`${e.route}:${e.type}:${e.episode}:${e.at}`, e]));
    return [...unique.values()];
  }
  async reconcile() {
    const { store, community, tracking } = this.ctx, now = this.now();
    const profiles = await store.list('profile');
    let timetable;
    try { timetable = await this.timetables(); }
    catch { timetable = null; logger.warn('AnimeSchedule scan unavailable; existing notifications will recheck before delivery', { event: 'anime.schedule.unavailable' }); }
    for (const guild of this.client.guilds.cache.values()) {
      if (this.stopped?.()) return;
      try {
        const settings = await this.settings(guild.id);
        if (!settings.enabled) continue;
        const state = await community.guild(guild.id);
        if (settings.modules.includes('announcements') && settings.notifications) {
          for (const follow of Object.values(state.follows)) {
            if (this.stopped?.()) return;
            try {
              if (timetable) await this.follow(guild.id, follow, timetable);
              await this.feeds(guild.id, follow, settings);
            } catch { logger.warn('Anime follow scan deferred', { event: 'anime.follow.scan_failed', guildId: guild.id, malId: follow.malId }); }
          }
          if (settings.weekly && settings.scheduleChannel && localTime(now, settings.timezone) >= '09:00') {
            const week = isoWeek(now);
            await store.enqueue(`weekly:${guild.id}:${week.year}:${week.week}`, 'weekly', { guildId: guild.id, ...week }, now);
          }
        }
        if (settings.modules.includes('community') && settings.notifications) {
          await this.parties(guild.id, state);
          await this.conversations(guild.id, settings, now);
        }
        if (settings.modules.includes('community') && await store.acquireLease(`hubs:${guild.id}`, now, 900000)) {
          for (const key of Object.keys(state.hubs)) await store.enqueue(`hub:${guild.id}:${key}:${Math.floor(+now / 900000)}`, 'hub', { guildId: guild.id, key }, now);
        }
      } catch { logger.warn('Anime server scan deferred', { event: 'anime.guild.scan_failed', guildId: guild.id }); }
    }
    for (const { id: userId, data } of profiles) {
      if (this.stopped?.()) return;
      for (const follow of Object.values(data.follows || {})) {
        if (!this.client.guilds.cache.has(follow.guildId)) continue;
        try {
          const settings = await this.settings(follow.guildId);
          if (timetable && settings.enabled && settings.notifications && settings.modules.includes('announcements')) await this.follow(follow.guildId, follow, timetable, userId);
        } catch { logger.warn('Private anime follow scan deferred', { event: 'anime.follow.private_scan_failed' }); }
      }
      if (data.reminderDays && data.reminderGuild && this.client.guilds.cache.has(data.reminderGuild)) {
        await store.withDocument('profile', userId, async (tx, current) => {
          if (!current.reminderDays || current.reminderGuild !== data.reminderGuild) return;
          const activity = [current.reminderSetAt, ...Object.values(current.list || {}).map(a => a.updatedAt), ...(current.history || []).map(h => h.at)].filter(Boolean).sort().at(-1);
          if (activity && Date.parse(activity) + current.reminderDays * 86400000 <= +now) await tx.enqueue(`inactivity:${userId}:${activity}:${current.reminderDays}`, 'inactivity', { userId, guildId: current.reminderGuild, activity, days: current.reminderDays }, now);
        });
      }
    }
    await store.cleanup();
  }
  async settings(guildId) {
    const { getGuildConfig } = await import('../config/guildConfig.js');
    return validateSettings((await getGuildConfig(this.client, guildId, { failClosed: true })).anime);
  }
  async conversations(guildId, settings, now = this.now()) {
    const time = localTime(now, settings.timezone);
    if (!settings.conversationDays || !settings.conversationChannel || time < '18:30' || time >= '21:30') return;
    const date = localDate(now, settings.timezone);
    // Reserve the date and enqueue in one transaction. A crash or two scanners
    // cannot create adjacent-day posts or duplicate a reserved conversation.
    await this.ctx.store.transaction(tx => tx.mutate('conversation-state', guildId, async current => {
      if (current.lastDate && calendarDay(date) - calendarDay(current.lastDate) < settings.conversationDays) return current;
      const sequence = current.sequence || 0;
      await tx.enqueue(`conversation:${guildId}:${date}`, 'conversation', { guildId, date, sequence, channelId: settings.conversationChannel, days: settings.conversationDays }, now);
      return { lastDate: date, sequence: sequence + 1 };
    }));
  }
  async follow(guildId, follow, timetable, userId = null) {
    const { store } = this.ctx;
    const mapping = await resolveMapping(store, this.ctx.schedule, guildId, follow.malId);
    if (!mapping) return;
    const events = timetable.filter(e => e.route === mapping.route);
    // Provider calls happen outside the lock. Recheck the current subscription
    // and commit snapshots/jobs under the same profile/guild lock as erasure.
    return store.withDocument(userId ? 'profile' : 'guild', userId || guildId, async (tx, current) => {
      const fresh = current.follows?.[follow.malId];
      if (!fresh || fresh.sinceAt !== follow.sinceAt || (userId && fresh.guildId !== guildId)) return;
      await this.commitFollow(tx, guildId, fresh, events, userId);
    });
  }
  async commitFollow(store, guildId, follow, timetable, userId) {
    const target = userId ? `user-${userId}` : `guild-${guildId}`;
    const events = timetable.filter(e => follow.type === 'all' || follow.type === e.type);
    const snapshotId = `${target}:${follow.malId}`;
    const old = await store.read('schedule-snapshot', snapshotId, {}), next = {};
    for (const event of events) {
      if (!event.episode || event.type === 'unknown') continue;
      const key = `${event.type}:${event.episode}`;
      next[key] = { at: event.at, delay: event.delay };
      if (old[key] && (old[key].at !== event.at || old[key].delay !== event.delay)) {
        const payload = { guildId, userId, malId: follow.malId, title: event.title, type: event.type, episode: event.episode, at: event.at, delay: event.delay, source: event.source, roleId: follow.roleId, update: true };
        await store.enqueue(`schedule-change:${snapshotId}:${key}:${digest(next[key])}`, 'update', payload, this.now());
      }
      if (event.at && !event.delay && Date.parse(event.at) >= Date.parse(follow.sinceAt || this.now().toISOString()) && Date.parse(event.at) >= +this.now() - 86400000) {
        await store.schedule(episodeKey(target, follow.malId, event), 'episode', { guildId, userId, malId: follow.malId, type: event.type, episode: event.episode }, new Date(event.at));
      }
    }
    await store.mutate('schedule-snapshot', snapshotId, () => next);
  }
  async feeds(guildId, follow, settings) {
    const { jikan, store } = this.ctx;
    const key = `${guildId}:${follow.malId}`, old = await store.read('feed-snapshot', key);
    const anime = await jikan.anime(follow.malId);
    const relations = (anime.relations || []).flatMap(r => (r.entry || []).filter(e => e.type === 'anime').map(e => ({ ...e, relation: r.relation })));
    const news = settings.news ? await jikan.resource(follow.malId, 'news') : [];
    const videos = settings.trailers ? await jikan.resource(follow.malId, 'videos') : null;
    const trailers = videos?.promo || [];
    const snapshot = { relations: relations.map(r => r.mal_id), status: anime.status, news: settings.news ? (news || []).map(n => n.mal_id) : null, trailers: settings.trailers ? trailers.map(p => p.trailer?.youtube_id || p.trailer?.url).filter(Boolean) : null };
    if (old) {
      for (const relation of relations.filter(r => !old.relations.includes(r.mal_id))) {
        const related = await jikan.anime(relation.mal_id);
        await this.feed(guildId, follow, `relation:${relation.mal_id}`, `Related ${related.type || 'anime'} listed: ${related.title}`, `MAL now lists this as ${relation.relation}. Release date and chronology remain as reported by the source.`, `https://myanimelist.net/anime/${relation.mal_id}`, 'relation');
      }
      if (old.status && old.status !== anime.status) await this.feed(guildId, follow, `status:${anime.status}`, `${anime.title} · status update`, `Provider status changed from ${old.status} to ${anime.status || 'unknown'}.`, `https://myanimelist.net/anime/${follow.malId}`, 'relation');
      if (old.news) for (const item of (news || []).filter(n => !old.news.includes(n.mal_id))) {
        if (item.date && Date.parse(item.date) < Date.parse(follow.sinceAt)) continue;
        await this.feed(guildId, follow, `news:${item.mal_id}`, item.title, 'New source article for a followed anime. The linked article may contain spoilers.', safeUrl(item.url), 'news');
      }
      if (old.trailers) for (const trailer of trailers.filter(p => !old.trailers.includes(p.trailer?.youtube_id || p.trailer?.url))) await this.feed(guildId, follow, `trailer:${trailer.trailer?.youtube_id || digest(trailer)}`, `${anime.title} · ${trailer.title || 'Trailer'}`, 'New promotional video listed by MAL. Trailers may contain spoilers.', safeUrl(trailer.trailer?.url, ['youtube.com', 'youtu.be']), 'trailers');
    }
    await store.mutate('feed-snapshot', key, () => snapshot);
  }
  async feed(guildId, follow, key, title, description, source, feedType) {
    if (!source) return;
    await this.ctx.store.enqueue(`feed:${guildId}:${follow.malId}:${key}`, 'feed', { guildId, malId: follow.malId, title, description, source, feedType }, this.now());
  }
  async parties(guildId) {
    const now = this.now();
    return this.ctx.store.withDocument('guild', guildId, async (store, state) => {
      for (const party of Object.values(state.parties || {})) {
        if (Date.parse(party.startsAt) < +now - 3600000) continue;
        for (const [userId, rsvp] of Object.entries(party.rsvps)) {
          if (rsvp !== 'yes') continue;
          if (party.version > 1) await store.enqueue(`party-change:${guildId}:${party.id}:${party.version}:${userId}`, 'party-change', { guildId, userId, partyId: party.id, version: party.version }, now);
          if (party.canceled) continue;
          for (const minutes of [15, 0]) await store.enqueue(`party:${guildId}:${party.id}:${party.version}:${userId}:${minutes}`, 'party', { guildId, userId, partyId: party.id, version: party.version, minutes }, new Date(Date.parse(party.startsAt) - minutes * 60000));
        }
      }
    });
  }
}
