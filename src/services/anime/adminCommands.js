import { PermissionFlagsBits } from 'discord.js';
import { patchGuildConfig } from '../config/guildConfig.js';
import { validateSettings, animeId } from './domain.js';
import { sendableChannel } from './access.js';
import { message, text } from './views.js';
import { safeUrl, exactMalId } from './providers.js';

export async function adminCommand(interaction, client, ctx, settings, sub) {
  const o = interaction.options, guildId = interaction.guildId;
  let patch = {};
  if (sub === 'settings') {
    for (const [option, key, kind] of [['enabled', 'enabled', 'Boolean'], ['timezone', 'timezone', 'String'], ['language', 'language', 'String'], ['spoilers', 'hideSpoilers', 'Boolean'], ['notifications', 'notifications', 'Boolean'], ['quiet-start', 'quietStart', 'String'], ['quiet-end', 'quietEnd', 'String']]) {
      const value = o[`get${kind}`](option);
      if (value !== null) patch[key] = value === 'off' ? null : value;
    }
  } else if (sub === 'channels') {
    for (const [option, key] of [['announcements', 'announcementChannel'], ['news', 'newsChannel'], ['schedule', 'scheduleChannel']]) {
      const channel = o.getChannel(option);
      if (channel) { await sendableChannel(interaction.guild, channel.id); patch[key] = channel.id; }
    }
  } else if (sub === 'roles') {
    const role = o.getRole('role');
    if (role.id === guildId || role.managed) throw new Error('Everyone and managed roles cannot be approved.');
    patch.approvedRoles = settings.approvedRoles.filter(id => id !== role.id);
    if (o.getBoolean('approved')) patch.approvedRoles.push(role.id);
  } else if (sub === 'modules') {
    const module = o.getString('module');
    patch.modules = settings.modules.filter(m => m !== module);
    if (o.getBoolean('enabled')) patch.modules.push(module);
  } else if (sub === 'feeds') {
    for (const key of ['weekly', 'news', 'trailers']) {
      const value = o.getBoolean(key); if (value !== null) patch[key] = value;
    }
    if (patch.weekly && !settings.scheduleChannel) throw new Error('Configure a schedule channel first.');
    if ((patch.news || patch.trailers) && !settings.newsChannel) throw new Error('Configure a news channel first.');
  } else if (sub === 'mapping') {
    const id = animeId(o.getString('anime')), slug = o.getString('slug');
    const [mal, scheduled] = await Promise.all([ctx.jikan.anime(id), ctx.schedule.anime(slug)]);
    const actual = exactMalId(scheduled.websites?.mal);
    if (actual && actual !== id) throw new Error(`The provider links this slug to MAL ${actual}, a different anime. Mapping rejected.`);
    if (scheduled.route !== slug) throw new Error('The provider did not return the requested exact slug.');
    await ctx.store.mutate('mapping', `${guildId}:${id}`, () => ({ malId: id, route: slug, method: 'administrator-confirmed', confirmedAt: new Date().toISOString(), confirmedBy: interaction.user.id }));
    return message('Provider mapping confirmed', `${text(mal.title)} → ${text(scheduled.title)} (${text(slug)}). This mapping applies only in this server. It does not map any other season.`);
  } else if (sub === 'chronology') {
    const root = animeId(o.getString('anime'));
    const source = safeUrl(o.getString('source'));
    if (!source) throw new Error('Provide a valid HTTPS verification source.');
    const ids = o.getString('entries').split(',').map(s => animeId(s.trim()));
    if (ids.length > 20 || new Set(ids).size !== ids.length || !ids.includes(root)) throw new Error('Provide up to 20 distinct anime IDs including the root anime.');
    const entries = [];
    for (const id of ids) { const anime = await ctx.jikan.anime(id); entries.push({ malId: id, title: anime.title }); }
    await ctx.store.mutate('chronology', `${guildId}:${root}`, () => ({ entries, source, verifiedBy: interaction.user.id, verifiedAt: new Date().toISOString() }));
    return message('Verified chronological guide saved', 'The supplied order and source are now available to this server. Entries are not labeled optional or filler.');
  }
  const next = validateSettings({ ...settings, ...patch });
  if (Boolean(next.quietStart) !== Boolean(next.quietEnd)) throw new Error('Set both quiet-start and quiet-end, or set both to off.');
  await patchGuildConfig(client, guildId, { anime: next });
  return message('Anime server settings', `Enabled: **${next.enabled}**\nModules: ${next.modules.join(', ') || 'None'}\nTime zone: **${next.timezone}** · Title language: ${next.language}\nSpoilers hidden: ${next.hideSpoilers}\nQuiet hours: ${next.quietStart || 'Off'}${next.quietEnd ? `–${next.quietEnd}` : ''}\nNotifications: ${next.notifications} · Weekly: ${next.weekly} · News: ${next.news} · Trailers: ${next.trailers}\nChannels: announcements ${next.announcementChannel ? `<#${next.announcementChannel}>` : 'unset'} · news ${next.newsChannel ? `<#${next.newsChannel}>` : 'unset'} · schedule ${next.scheduleChannel ? `<#${next.scheduleChannel}>` : 'unset'}\nApproved mention roles: ${next.approvedRoles.length}`);
}
