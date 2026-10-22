// Hikari's active catalogue. Archived command modules remain in source so their
// stored data is preserved, but they are not registered or available by prefix.
export const HIKARI_COMMAND_NAMES = Object.freeze([
  'anime',
  'help', 'commands', 'configwizard', 'ping', 'stats',
  'play', 'queue', 'nowplaying', 'music',
  'ban', 'unban', 'kick', 'timeout', 'untimeout', 'purge',
  'warn', 'warnings', 'cases', 'lock', 'unlock',
  'reactroles', 'logging', 'welcome', 'greet',
  'avatar', 'userinfo', 'serverinfo', 'report',
]);

const activeCommands = new Set(HIKARI_COMMAND_NAMES);
export function isHikariCommand(name) {
  return activeCommands.has(name);
}
