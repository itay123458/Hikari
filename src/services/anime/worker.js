import { PermissionFlagsBits } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { AnimePlanner } from './planner.js';
import { deliverOnce } from './notifications.js';
import { quietUntil, validateSettings, isoWeek } from './domain.js';
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
    if (+at > +this.now()) { await this.ctx.store.defer(job.id, at); return true; }
    return false;
  }
  async handle(job) {
    const guild = this.client.guilds.cache.get(job.payload.guildId);
    if (!guild) return this.ctx.store.finish(job.id, 'canceled');
    const config = await getGuildConfig(this.client, guild.id, { failClosed: true }), settings = validateSettings(config.anime);
    const module = ['party', 'party-change', 'hub'].includes(job.kind) ? 'community' : job.kind === 'inactivity' ? 'tracking' : 'announcements';
    if (!settings.enabled || !settings.modules.includes(module) || !isCommandEnabledInConfig(config, 'anime', 'Anime') || (job.kind !== 'hub' && !settings.notifications)) return this.ctx.store.finish(job.id, 'canceled');
    if (job.kind !== 'hub' && await this.quiet(job, settings)) return;
    if (job.kind === 'episode') return this.handleEpisode(job, settings);
    if (job.kind === 'update') return this.handleUpdate(job, settings);
    if (job.kind === 'feed') return this.handleFeed(job, settings);
    if (job.kind === 'weekly') return this.handleWeekly(job, settings);
    if (job.kind === 'party' || job.kind === 'party-change') return this.handleParty(job, settings);
    if (job.kind === 'inactivity') return this.handleInactivity(job, settings);
    if (job.kind === 'hub') { await refreshPublication(this.ctx, guild, 'hubs', job.payload.key, settings); return this.ctx.store.finish(job.id); }
    return this.ctx.store.finish(job.id, 'failed');
  }
  async follow(job) {
    const p = job.payload;
    return p.userId ? (await this.ctx.tracking.profile(p.userId)).follows[p.malId] : (await this.ctx.community.guild(p.guildId)).follows[p.malId];
  }
  async currentEvent(job) {
    const mapping = await resolveMapping(this.ctx.store, this.ctx.schedule, job.payload.guildId, job.payload.malId);
    if (!mapping) return null;
    const rows = await this.planner.timetables();
    return rows.find(e => e.route === mapping.route && e.type === job.payload.type && e.episode === job.payload.episode) || null;
  }
  async handleEpisode(job, settings) {
    const follow = await this.follow(job), p = job.payload;
    if (!follow || (follow.type !== 'all' && follow.type !== p.type)) return this.ctx.store.finish(job.id, 'canceled');
    const event = await this.currentEvent(job);
    if (!event?.at || event.delay) return this.ctx.store.finish(job.id, 'canceled');
    if (Date.parse(event.at) > +this.now()) return this.ctx.store.defer(job.id, new Date(event.at));
    if (Date.parse(event.at) < +this.now() - 86400000 || (follow.sinceAt && Date.parse(event.at) < Date.parse(follow.sinceAt))) return this.ctx.store.finish(job.id, 'canceled');
    const label = { raw: 'Japanese broadcast', sub: 'Subtitle schedule', dub: 'Dub schedule' }[event.type] || 'Schedule';
    const body = message(`${event.title} · Episode ${event.episode}`, `**${label}: scheduled time reached**\n${timestamp(event.at)}\n[AnimeSchedule source](${event.source})\nThis schedule does not confirm an episode was published on Crunchyroll. Regional availability and languages remain unknown.`);
    return this.send(job, settings, body, follow.roleId);
  }
  async handleUpdate(job, settings) {
    const follow = await this.follow(job);
    if (!follow) return this.ctx.store.finish(job.id, 'canceled');
    const event = await this.currentEvent(job);
    if (!event || event.at !== job.payload.at || event.delay !== job.payload.delay) return this.ctx.store.finish(job.id, 'canceled');
    return this.send(job, settings, message(`${event.title} · Schedule changed`, `${event.type} · Episode ${event.episode || '?'}\n${event.delay ? `Delay: ${text(event.delay)}` : 'Provider schedule updated.'}\nCurrent reported time: ${timestamp(event.at)}\n[AnimeSchedule source](${event.source})\nActual streaming publication and regional availability remain unknown.`), follow.roleId);
  }
  async handleFeed(job, settings) {
    const follow = await this.follow(job), p = job.payload;
    if (!follow || (p.feedType === 'news' && !settings.news) || (p.feedType === 'trailers' && !settings.trailers)) return this.ctx.store.finish(job.id, 'canceled');
    return this.send(job, settings, message(p.title, `${text(p.description, 1200)}\n[Source](${p.source})`));
  }
  async handleWeekly(job, settings) {
    const week = isoWeek(this.now());
    if (!settings.weekly || week.year !== job.payload.year || week.week !== job.payload.week) return this.ctx.store.finish(job.id, 'canceled');
    const entries = await this.ctx.schedule.timetable('all', this.now());
    entries.sort((a, b) => (a.at || '9999').localeCompare(b.at || '9999'));
    const body = scheduleView(entries, 0, 'This week’s anime schedule');
    body.embeds[0].addFields({ name: 'Full timetable', value: `Showing the first ${Math.min(10, entries.length)} of ${entries.length} entries. Use /anime alerts schedule to browse every page, or [open AnimeSchedule](https://animeschedule.net).` });
    return this.send(job, settings, body);
  }
  async handleParty(job, settings) {
    const p = job.payload, party = (await this.ctx.community.guild(p.guildId)).parties[p.partyId];
    if (!party || party.version !== p.version || party.rsvps[p.userId] !== 'yes') return this.ctx.store.finish(job.id, 'canceled');
    if (job.kind === 'party' && (party.canceled || Date.parse(party.startsAt) < +this.now() - 15 * 60000)) return this.ctx.store.finish(job.id, 'canceled');
    const title = job.kind === 'party-change' ? (party.canceled ? 'Watch party canceled' : 'Watch party rescheduled') : p.minutes ? 'Watch party starts soon' : 'Watch party start time';
    return this.send(job, settings, message(title, `**${text(party.title)}** · ID ${party.id}\n${timestamp(party.startsAt)}${party.messageId ? `\n[Party details](https://discord.com/channels/${p.guildId}/${party.channelId}/${party.messageId})` : ''}\nYou received this private DM because you RSVP’d Going. Select No on the party to stop reminders.`));
  }
  async handleInactivity(job, settings) {
    const p = job.payload, profile = await this.ctx.tracking.profile(p.userId);
    const latest = [profile.reminderSetAt, ...Object.values(profile.list).map(a => a.updatedAt), ...profile.history.map(h => h.at)].filter(Boolean).sort().at(-1);
    if (!profile.reminderDays || profile.reminderDays !== p.days || profile.reminderGuild !== p.guildId || latest !== p.activity) return this.ctx.store.finish(job.id, 'canceled');
    return this.send(job, settings, message('Your optional anime watch reminder', `You haven’t recorded viewing activity for at least ${p.days} days. Open /anime list show to continue your private watchlist. Disable these DMs with /anime list reminders days:0.`));
  }
  async send(job, settings, body, roleId = null) {
    const p = job.payload, guild = this.client.guilds.cache.get(p.guildId);
    let channel;
    if (p.userId) {
      const member = await guild.members.fetch({ user: p.userId, force: true }).catch(() => null);
      if (!member || member.user.bot) return this.ctx.store.finish(job.id, 'canceled');
      try { channel = await member.user.createDM(); }
      catch { return this.ctx.store.finish(job.id, 'blocked'); }
    } else {
      const channelId = job.kind === 'weekly' ? settings.scheduleChannel : job.kind === 'feed' && ['news', 'trailers'].includes(p.feedType) ? settings.newsChannel : settings.announcementChannel;
      if (!channelId) return this.ctx.store.finish(job.id, 'canceled');
      try { channel = await sendableChannel(guild, channelId, [PermissionFlagsBits.ReadMessageHistory]); }
      catch { return this.ctx.store.finish(job.id, 'failed'); }
      if (roleId && settings.approvedRoles.includes(roleId) && roleId !== guild.id) {
        const role = await guild.roles.fetch(roleId).catch(() => null), me = await guild.members.fetchMe();
        if (role && !role.managed && (role.mentionable || channel.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone))) {
          body.content = `<@&${role.id}>`; body.allowedMentions = { parse: [], roles: [role.id] };
        }
      }
    }
    return deliverOnce(this.ctx.store, job, channel, body, this.client.user.id);
  }
}
