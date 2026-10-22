import { PermissionFlagsBits } from 'discord.js';
import { animeId } from './domain.js';
import { message, text } from './views.js';
import { resolveMapping } from './providers.js';
import { scheduleCommand } from './discoveryCommands.js';

export async function alertCommand(interaction, ctx, settings, sub, member) {
  if (sub === 'schedule' || sub === 'countdown') return scheduleCommand(interaction, ctx, settings, sub === 'countdown');
  const o = interaction.options, userId = interaction.user.id, guildId = interaction.guildId;
  const server = o.getBoolean('server') || false;
  if (server && !member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error('Manage Server permission is required for server follows.');
  if (sub === 'following') {
    const follows = server ? (await ctx.community.guild(guildId)).follows : (await ctx.tracking.profile(userId)).follows;
    return message(server ? 'Server anime follows' : 'Your private anime follows', Object.values(follows).map(f => `**${text(f.title)}** · MAL ${f.malId} · ${f.type} · ${f.route ? `mapped to ${text(f.route)}` : 'schedule mapping unknown'}`).join('\n') || 'No follows saved.');
  }
  const id = animeId(o.getString('anime'));
  if (sub === 'unfollow') {
    if (server) await ctx.community.edit(guildId, g => { delete g.follows[id]; return g; });
    else await ctx.tracking.edit(userId, p => { delete p.follows[id]; return p; });
    return message('Unfollowed', 'This subscription is removed. Pending release jobs recheck your subscription before sending.');
  }
  const anime = await ctx.jikan.anime(id), role = o.getRole('role');
  if (role && (!server || !settings.approvedRoles.includes(role.id) || role.id === guildId || role.managed)) throw new Error('Select an administrator-approved role for a server follow. Everyone and managed roles are not allowed.');
  if (server && !settings.announcementChannel) throw new Error('Configure an announcement channel with /anime admin channels first.');
  let mapping = null;
  try { mapping = await resolveMapping(ctx.store, ctx.schedule, guildId, id); } catch { /* news follows remain useful without a working schedule provider */ }
  const follow = { malId: id, title: anime.title, route: mapping?.route || null, type: o.getString('type') || 'all', guildId, roleId: role?.id || null, sinceAt: new Date().toISOString() };
  if (server) await ctx.community.edit(guildId, g => { g.follows[id] = follow; return g; });
  else await ctx.tracking.edit(userId, p => { p.follows[id] = follow; return p; });
  return message('Anime follow saved', `${server ? 'Announcements will use the configured server channel.' : 'You opted into private episode announcement DMs.'}\n${mapping ? `Exact schedule mapping: ${text(mapping.route)}.` : 'Episode times remain unavailable until a token and exact mapping are available. News and relation updates for server follows can still work.'}\nRaw, sub and dub times are schedules; none confirm Crunchyroll publication.`);
}
