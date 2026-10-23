import { createHash } from 'node:crypto';
import { localDate, localTime, isoWeek, validateSettings } from './domain.js';
import { resolveMapping } from './providers.js';
import { reconcileFeeds } from './feeds.js';
import { weeklyOccurrence } from './schedules.js';
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
    const lookback = new Date(+now - 86400000);
    const previous = JSON.stringify(isoWeek(lookback)) !== JSON.stringify(isoWeek(now)) ? await this.ctx.schedule.timetable('all', lookback) : [];
    const unique = new Map([...previous, ...current, ...next].map(e => [`${e.route}:${e.type}:${e.episode}`, e]));
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
          if (settings.weekly && settings.scheduleChannel) {
            const occurrence = weeklyOccurrence(now, settings);
            if (+now - Date.parse(occurrence.at) < 86400000) await store.enqueue(`weekly:${guild.id}:${occurrence.at}`, 'weekly', { guildId: guild.id, ...occurrence, weeklyDay: settings.weeklyDay, weeklyTime: settings.weeklyTime, timezone: settings.timezone, createdAt: occurrence.at }, new Date(occurrence.at));
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
    const old = await store.read('schedule-snapshot', snapshotId, {});
    // Preserve delayed/unknown entries that disappear from the provider horizon,
    // while bounding historical snapshot growth separately from delivery keys.
    const next = Object.fromEntries(Object.entries(old).filter(([, value]) => !value.seenAt || Date.parse(value.seenAt) >= +this.now() - 90 * 86400000).slice(-500));
    for (const event of events) {
      if (!event.episode || event.type === 'unknown') continue;
      const key = `${event.type}:${event.episode}`;
      const state = { at: event.at, delay: event.delay ?? null, delayedUntil: event.delayedUntil ?? null, status: event.status ?? null, episodeStart: event.episodeStart ?? event.episode };
      const before = old[key];
      const changed = before && Object.keys(state).some(field => (before[field] ?? null) !== (state[field] ?? null));
      const revision = (before?.revision || 0) + (changed ? 1 : 0);
      next[key] = { ...state, revision, seenAt: this.now().toISOString() };
      if (changed && follow.changes !== false) {
        const payload = { guildId, userId, malId: follow.malId, sinceAt: follow.sinceAt, title: event.title, type: event.type, episode: event.episode, ...state, source: event.source, roleId: follow.roleId, update: true, createdAt: this.now().toISOString() };
        await store.enqueue(`schedule-change:${snapshotId}:${key}:${revision}`, 'update', payload, this.now());
      }
      if (follow.episodes !== false && event.at && !event.delay && Date.parse(event.at) >= Date.parse(follow.sinceAt || this.now().toISOString()) && Date.parse(event.at) >= +this.now() - 86400000) {
        await store.schedule(episodeKey(target, follow.malId, event), 'episode', { guildId, userId, malId: follow.malId, sinceAt: follow.sinceAt, type: event.type, episode: event.episode }, new Date(event.at));
      }
    }
    await store.mutate('schedule-snapshot', snapshotId, () => next);
  }
  async feeds(guildId, follow, settings) {
    return reconcileFeeds(this.ctx, guildId, follow, settings, this.now());
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
