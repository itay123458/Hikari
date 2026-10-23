import { PermissionFlagsBits } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { AnimePlanner } from './planner.js';
import { deliverOnce } from './notifications.js';
import { quietUntil, validateSettings, localDate } from './domain.js';
import { followedSchedule, weeklyOccurrence } from './schedules.js';
import { CONVERSATION_PROMPTS } from './conversation.js';
import { getGuildConfig } from '../config/guildConfig.js';
import { isCommandEnabledInConfig } from '../commandAccessService.js';
import { isMaintenanceMode, isCommandCategoryEnabled } from '../../config/bot.js';
import { sendableChannel } from './access.js';
import { resolveMapping } from './providers.js';
import { message, text, timestamp, scheduleView } from './views.js';
import { refreshPublication } from './communityViews.js';
import { logger } from '../../utils/logger.js';
export { deliverOnce } from './notifications.js';
export { episodeKey } from './planner.js';

export class AnimeWorker {
  constructor(client, ctx, { now = () => new Date() } = {}) {
    Object.assign(this, { client, ctx, now });
    this.planner = new AnimePlanner(client, ctx, now);
    this.planner.stopped = () => this.stopped;
    this.scanOwner = randomUUID();
    this.active = null; this.stopped = false;
  }
  start() {
    this.timer = setInterval(() => this.tick(), 30000);
    this.timer.unref();
    this.tick();
  }
  async stop() { this.stopped = true; clearInterval(this.timer); await this.active; await this.scanning; }
  tick() {
    if (this.active || this.stopped) return this.active;
    this.active = this.run().catch(error => logger.warn('Anime worker cycle failed', { event: 'anime.worker.failed', errorCode: String(error.code || error.name) })).finally(() => { this.active = null; });
    return this.active;
  }
  async run() {
    if (isMaintenanceMode() || !isCommandCategoryEnabled('Anime')) return;
    if (!this.scanning && await this.ctx.store.acquireLease('anime-scan', this.now(), 300000, this.scanOwner)) {
      const heartbeat = setInterval(() => {
        this.ctx.store.pool.query('UPDATE anime_locks SET until_at=$3 WHERE name=$1 AND owner=$2', ['anime-scan', this.scanOwner, new Date(+this.now() + 300000)]).catch(() => {});
      }, 30000);
      heartbeat.unref();
      this.scanning = this.planner.reconcile().catch(error => logger.warn('Anime scan deferred', { event: 'anime.scan.failed', errorCode: String(error.code || error.name) })).finally(() => { clearInterval(heartbeat); this.scanning = null; });
    }
    for (let i = 0; i < 50 && !this.stopped; i++) {
      const job = await this.ctx.store.claim(this.now());
      if (!job) break;
      const heartbeat = setInterval(() => {
        this.ctx.store.pool.query("UPDATE anime_jobs SET lease_until=$3 WHERE id=$1 AND state='running' AND attempts=$2", [job.id, job.attempts, new Date(+this.now() + 120000)]).catch(() => {});
      }, 30000);
      heartbeat.unref();
      try { await this.handle(job); }
      catch (error) {
        await this.ctx.store.retry(job, error.code || error.name || 'PROVIDER_UNAVAILABLE');
        logger.warn('Anime job deferred', { event: 'anime.job.deferred', jobId: job.id, errorCode: String(error.code || error.name) });
      } finally { clearInterval(heartbeat); }
    }
  }
  async quiet(job, settings) {
    const at = quietUntil(settings, this.now());
    if (+at > +this.now()) { await this.ctx.store.defer(job, at); return true; }
    return false;
  }
  async handle(job) {
    const guild = this.client.guilds.cache.get(job.payload.guildId);
    if (!guild) return this.ctx.store.finish(job, 'canceled');
    const config = await getGuildConfig(this.client, guild.id, { failClosed: true }), settings = validateSettings(config.anime);
    const module = ['party', 'party-change', 'hub', 'conversation'].includes(job.kind) ? 'community' : job.kind === 'inactivity' ? 'tracking' : 'announcements';
    if (!settings.enabled || !settings.modules.includes(module) || !isCommandEnabledInConfig(config, 'anime', 'Anime') || (job.kind !== 'hub' && !settings.notifications)) return this.ctx.store.finish(job, 'canceled');
    if (['update', 'feed', 'weekly'].includes(job.kind) && Date.parse(job.payload.createdAt || job.created_at || job.run_at) < +this.now() - 86400000) return this.ctx.store.finish(job, 'canceled');
    if (job.kind !== 'hub' && await this.quiet(job, settings)) return;
    if (job.kind === 'episode') return this.handleEpisode(job, settings);
    if (job.kind === 'update') return this.handleUpdate(job, settings);
    if (job.kind === 'feed') return this.handleFeed(job, settings);
    if (job.kind === 'weekly') return this.handleWeekly(job, settings);
    if (job.kind === 'conversation') return this.handleConversation(job, settings);
    if (job.kind === 'party' || job.kind === 'party-change') return this.handleParty(job, settings);
    if (job.kind === 'inactivity') return this.handleInactivity(job, settings);
    if (job.kind === 'hub') { await refreshPublication(this.ctx, guild, 'hubs', job.payload.key, settings); return this.ctx.store.finish(job); }
    return this.ctx.store.finish(job, 'failed');
  }
  async follow(job) {
    const p = job.payload;
    const follow = p.userId ? (await this.ctx.tracking.profile(p.userId)).follows[p.malId] : (await this.ctx.community.guild(p.guildId)).follows[p.malId];
    if (!follow || (p.userId && follow.guildId !== p.guildId) || (p.sinceAt && follow.sinceAt !== p.sinceAt)) return null;
    return follow;
  }
  async currentEvent(job) {
    const mapping = await resolveMapping(this.ctx.store, this.ctx.schedule, job.payload.guildId, job.payload.malId);
    if (!mapping) return null;
    const rows = await this.planner.timetables();
    return rows.find(e => e.route === mapping.route && e.type === job.payload.type && e.episode === job.payload.episode) || null;
  }
  async handleEpisode(job, settings) {
    const follow = await this.follow(job), p = job.payload;
    if (!follow || follow.episodes === false || (follow.type !== 'all' && follow.type !== p.type)) return this.ctx.store.finish(job, 'canceled');
    const event = await this.currentEvent(job);
    if (!event?.at || event.delay) return this.ctx.store.finish(job, 'canceled');
    if (Date.parse(event.at) > +this.now()) return this.ctx.store.defer(job, new Date(event.at));
    if (Date.parse(event.at) < +this.now() - 86400000 || (follow.sinceAt && Date.parse(event.at) < Date.parse(follow.sinceAt))) return this.ctx.store.finish(job, 'canceled');
    const label = { raw: 'Japanese broadcast', sub: 'Subtitle schedule', dub: 'Dub schedule' }[event.type] || 'Schedule';
    const episode = event.episodeStart && event.episodeStart !== event.episode ? `${event.episodeStart}–${event.episode}` : event.episode;
    const body = message(`${event.title} · Episode ${episode}`, `**${label}: scheduled time reached**\n${timestamp(event.at)}\n[AnimeSchedule source](${event.source})\nThis schedule does not confirm an episode was published on Crunchyroll. Regional availability and languages remain unknown.`);
    return this.send(job, settings, body, follow.roleId, event.at);
  }
  async handleUpdate(job, settings) {
    const follow = await this.follow(job);
    if (!follow || follow.changes === false || (follow.type !== 'all' && follow.type !== job.payload.type)) return this.ctx.store.finish(job, 'canceled');
    const event = await this.currentEvent(job);
    if (!event || event.at !== job.payload.at || (event.delay ?? null) !== (job.payload.delay ?? null) || (event.delayedUntil ?? null) !== (job.payload.delayedUntil ?? null)) return this.ctx.store.finish(job, 'canceled');
    return this.send(job, settings, message(`${event.title} · Schedule changed`, `${event.type} · Episode ${event.episode || '?'}\n${event.delay ? `Delay: ${text(event.delay)}` : 'Provider schedule updated.'}\nCurrent reported time: ${timestamp(event.at)}\n[AnimeSchedule source](${event.source})\nActual streaming publication and regional availability remain unknown.`), follow.roleId);
  }
  async handleFeed(job, settings) {
    const p = job.payload;
    let follow = await this.follow(job);
    if (p.sourceKey) {
      const source = await this.ctx.store.read('feed-source', p.sourceKey, {});
      const state = await this.ctx.community.guild(p.guildId);
      follow = Object.entries(source.subscriptions || {}).map(([id, since]) => state.follows[id]?.sinceAt === since ? state.follows[id] : null).find(f => f && f.changes !== false);
    }
    if (!follow || follow.changes === false || (settings.feedCategories && !settings.feedCategories.includes(p.feedType)) || (p.feedType === 'news' && !settings.news) || (p.feedType === 'trailers' && !settings.trailers)) return this.ctx.store.finish(job, 'canceled');
    return this.send(job, settings, message(p.title, `${text(p.description, 1200)}\n[Source](${p.source})`));
  }
  async handleWeekly(job, settings) {
    const occurrence = weeklyOccurrence(this.now(), settings), p = job.payload;
    if (!settings.weekly || occurrence.date !== p.date || occurrence.at !== p.at || +this.now() - Date.parse(p.at) >= 86400000) return this.ctx.store.finish(job, 'canceled');
    const follows = (await this.ctx.community.guild(p.guildId)).follows;
    const entries = await followedSchedule(this.ctx, p.guildId, follows, settings, { now: this.now(), type: settings.weeklyType });
    const body = scheduleView(entries, 0, 'This week’s followed anime');
    body.embeds[0].addFields({ name: 'Followed timetable', value: `Showing the first ${Math.min(10, entries.length)} of ${entries.length} entries. Use /anime alerts schedule to browse every page, or [open AnimeSchedule](https://animeschedule.net).` });
    return this.send(job, settings, body);
  }
  async handleParty(job, settings) {
    const p = job.payload, party = (await this.ctx.community.guild(p.guildId)).parties[p.partyId];
    if (!party || party.version !== p.version || party.rsvps[p.userId] !== 'yes') return this.ctx.store.finish(job, 'canceled');
    if (job.kind === 'party-change' && Date.parse(party.startsAt) < +this.now() - 3600000) return this.ctx.store.finish(job, 'canceled');
    if (job.kind === 'party' && (party.canceled || Date.parse(party.startsAt) < +this.now() - 15 * 60000)) return this.ctx.store.finish(job, 'canceled');
    const title = job.kind === 'party-change' ? (party.canceled ? 'Watch party canceled' : 'Watch party rescheduled') : p.minutes ? 'Watch party starts soon' : 'Watch party start time';
    return this.send(job, settings, message(title, `**${text(party.title)}** · ID ${party.id}\n${timestamp(party.startsAt)}${party.messageId ? `\n[Party details](https://discord.com/channels/${p.guildId}/${party.channelId}/${party.messageId})` : ''}\nYou received this private DM because you RSVP’d Going. Select No on the party to stop reminders.`));
  }
  async handleConversation(job, settings) {
    const p = job.payload;
    if (!settings.conversationDays || settings.conversationDays !== p.days || settings.conversationChannel !== p.channelId || p.date !== localDate(this.now(), settings.timezone)) return this.ctx.store.finish(job, 'canceled');
    if (await this.quiet(job, { ...settings, quietStart: '21:30', quietEnd: '18:30' })) return;
    const prompt = CONVERSATION_PROMPTS[(p.sequence || 0) % CONVERSATION_PROMPTS.length];
    return this.send(job, settings, message('Palace conversation starter', `${prompt}\n\nReply here or start a thread. Keep plot details behind spoiler tags and let everyone enjoy their first watch.`));
  }
  async handleInactivity(job, settings) {
    const p = job.payload, profile = await this.ctx.tracking.profile(p.userId);
    const latest = [profile.reminderSetAt, ...Object.values(profile.list).map(a => a.updatedAt), ...profile.history.map(h => h.at)].filter(Boolean).sort().at(-1);
    if (!profile.reminderDays || profile.reminderDays !== p.days || profile.reminderGuild !== p.guildId || latest !== p.activity) return this.ctx.store.finish(job, 'canceled');
    return this.send(job, settings, message('Your optional anime watch reminder', `You haven’t recorded viewing activity for at least ${p.days} days. Open /anime list show to continue your private watchlist. Disable these DMs with /anime list reminders days:0.`));
  }
  async send(job, settings, body, roleId = null, eventAt = null) {
    const p = job.payload, guild = this.client.guilds.cache.get(p.guildId);
    let channel;
    if (p.userId) {
      let member;
      try { member = await guild.members.fetch({ user: p.userId, force: true }); }
      catch (error) { if (![10007, 10013, 50001, 50013].includes(Number(error.code))) throw error; return this.ctx.store.finish(job, 'canceled'); }
      if (!member || member.user.bot) return this.ctx.store.finish(job, 'canceled');
      try { channel = await member.user.createDM(); }
      catch (error) { if (![50007, 50001, 50013, 10013].includes(Number(error.code))) throw error; return this.ctx.store.finish(job, 'blocked'); }
    } else {
      const channelId = job.kind === 'conversation' ? settings.conversationChannel : job.kind === 'weekly' ? settings.scheduleChannel : job.kind === 'feed' && ['news', 'trailers'].includes(p.feedType) ? settings.newsChannel : settings.announcementChannel;
      if (!channelId) return this.ctx.store.finish(job, 'canceled');
      try { channel = await sendableChannel(guild, channelId, [PermissionFlagsBits.ReadMessageHistory]); }
      catch (error) { if (!['ANIME_CHANNEL_INVALID', 'ANIME_CHANNEL_PERMISSIONS'].includes(error.code) && ![10003, 50001, 50013].includes(Number(error.code))) throw error; return this.ctx.store.finish(job, 'failed'); }
      if (roleId && settings.approvedRoles.includes(roleId) && roleId !== guild.id) {
        const role = await guild.roles.fetch(roleId).catch(() => null), me = await guild.members.fetchMe();
        if (role && !role.managed && (role.mentionable || channel.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone))) {
          body.content = `<@&${role.id}>`; body.allowedMentions = { parse: [], roles: [role.id] };
        }
      }
    }
    if (!['episode', 'update', 'feed'].includes(job.kind)) return deliverOnce(this.ctx.store, job, channel, body, this.client.user.id);
    // Admission and its intent commit under the subscription lock. Discord
    // sends only after commit; cancellation after admission cannot recall it.
    return deliverOnce(this.ctx.store, job, channel, body, this.client.user.id, { admit: async () => {
      let intent = null;
      await this.ctx.store.withDocument(p.userId ? 'profile' : 'guild', p.userId || p.guildId, async (tx, current) => {
        let follow = current.follows?.[p.malId];
        if (job.kind === 'feed' && p.sourceKey) {
          const source = await tx.read('feed-source', p.sourceKey, {});
          follow = Object.entries(source.subscriptions || {}).map(([id, since]) => current.follows?.[id]?.sinceAt === since ? current.follows[id] : null).find(f => f && f.changes !== false);
        } else if (follow && ((p.sinceAt && follow.sinceAt !== p.sinceAt) || (p.userId && follow.guildId !== p.guildId))) follow = null;
        const eligible = follow && (job.kind === 'feed' || follow.type === 'all' || follow.type === p.type)
          && (job.kind === 'episode' ? follow.episodes !== false && (!follow.sinceAt || Date.parse(eventAt || p.at) >= Date.parse(follow.sinceAt)) : follow.changes !== false);
        if (!eligible) return tx.finish(job, 'canceled');
        if (roleId && follow.roleId !== roleId) { delete body.content; body.allowedMentions = { parse: [] }; }
        intent = await tx.beginDelivery(job, channel.id);
      });
      if (!intent && !await this.ctx.store.delivery(job.id)) await this.ctx.store.finish(job, 'canceled');
      return intent;
    } });
  }
}
