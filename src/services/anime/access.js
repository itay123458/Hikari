import { PermissionFlagsBits } from 'discord.js';
import { isMaintenanceMode, isBotOwner, isCommandCategoryEnabled } from '../../config/bot.js';
import { getGuildConfig } from '../config/guildConfig.js';
import { isCommandEnabledInConfig } from '../commandAccessService.js';
import { validateSettings } from './domain.js';

export function authorize({ member, settings, module, admin = false, maintenance = false }) {
  if (!member) throw new Error('You must be a current member of this server.');
  if (maintenance) throw new Error('The bot is in maintenance mode.');
  if (admin && !member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error('Manage Server permission is required.');
  if (!admin && (!settings.enabled || (module && !settings.modules.includes(module)))) throw new Error('This anime module is disabled in this server.');
  return true;
}
export function validateSession(session, userId, guildId, now = Date.now()) {
  if (!session || session.expiresAt <= now) throw new Error('This control expired. Run the command again.');
  if (session.guildId !== guildId) throw new Error('This control belongs to another server.');
  if (session.ownerId && session.ownerId !== userId) throw new Error('This private control belongs to another member.');
  return session;
}
export async function guard(interaction, client, module, { admin = false, action = '' } = {}) {
  if (!interaction.guildId || !interaction.guild) throw new Error('Use anime commands in a server. Personal responses stay private.');
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  const config = await getGuildConfig(client, interaction.guildId, { failClosed: true });
  const settings = validateSettings(config.anime);
  authorize({ member, settings, module, admin, maintenance: isMaintenanceMode() && !isBotOwner(interaction.user.id) });
  if (!isCommandCategoryEnabled('Anime') || !isCommandEnabledInConfig(config, `anime${action ? ` ${action}` : ''}`, 'Anime')) throw new Error('This anime command is disabled in this server.');
  return { member, config, settings };
}
export async function sendableChannel(guild, channelId, permissions = []) {
  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !channel.send) throw Object.assign(new Error('Choose an existing server text channel.'), { code: 'ANIME_CHANNEL_INVALID' });
  const me = await guild.members.fetchMe();
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, ...permissions])) throw Object.assign(new Error('The bot needs View Channel, Send Messages, Embed Links and any requested thread permissions in that channel.'), { code: 'ANIME_CHANNEL_PERMISSIONS' });
  return channel;
}
