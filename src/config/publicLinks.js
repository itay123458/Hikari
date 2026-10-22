import { PermissionFlagsBits as P } from 'discord.js';

// Application IDs are public. Never put a bot token in a browser asset or URL.
export const PUBLIC_CLIENT_ID = '1562836610800685118';
export const SOURCE_URL = 'https://github.com/itay123458/Hikari';
export const DASHBOARD_URL = 'https://itay123458.github.io/Hikari/';
const installPermissions = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory,
  P.EmbedLinks, P.AttachFiles, P.AddReactions, P.UseExternalEmojis,
  P.CreatePublicThreads, P.SendMessagesInThreads, P.ManageMessages,
  P.ModerateMembers, P.ViewAuditLog, P.KickMembers, P.BanMembers,
  P.ManageChannels, P.ManageRoles, P.Connect, P.Speak];
export const INVITE_PERMISSIONS = installPermissions.reduce((mask, bit) => mask | bit, 0n);
export const INVITE_URL = `https://discord.com/oauth2/authorize?${new URLSearchParams({
  client_id: PUBLIC_CLIENT_ID, scope: 'bot applications.commands',
  integration_type: '0', permissions: INVITE_PERMISSIONS.toString(),
})}`;
