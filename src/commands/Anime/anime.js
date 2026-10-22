import { SlashCommandBuilder } from 'discord.js';
import { executeAnime, autocompleteAnime } from '../../services/anime/controller.js';

// A small declarative option table keeps every option discoverable in Discord.
// [name, type, description, required, choices/min/max]
const anime = ['anime', 'anime', 'Choose an anime or enter its MAL ID', true];
const id = ['id', 'string', 'Party, poll, game or tournament ID', true];
const episode = ['episode', 'integer', 'Episode context', true, [1, 100000]];
const status = ['status', 'string', 'Watchlist status', false, ['watching', 'planned', 'completed', 'paused', 'dropped']];
const member = ['member', 'user', 'Consenting server member', true];
const type = ['type', 'string', 'Release track (not a publication guarantee)', false, ['all', 'raw', 'sub', 'dub']];
const definitions = {
  discover: [
    ['search', 'Search anime with filters and result selection', [['query', 'string', 'Anime title', true], ['genre', 'string', 'Comma-separated MAL genre IDs'], ['status', 'string', 'Airing status', false, ['airing', 'complete', 'upcoming']], ['minimum', 'number', 'Minimum MAL score', false, [0, 10]], ['format', 'string', 'Anime format', false, ['tv', 'movie', 'ova', 'special', 'ona', 'music']], ['stream', 'string', 'Filter provider-listed streaming links', false, ['crunchyroll']]]],
    ['detail', 'Show anime metadata and official streaming links', [anime]],
    ['character', 'Search characters and their voice actors', [['query', 'string', 'Character name', true]]],
    ['voice', 'Search people and voice acting credits', [['query', 'string', 'Voice actor name', true]]],
    ['season', 'Browse current, previous or upcoming seasons', [['period', 'string', 'Season to browse', true, ['current', 'previous', 'upcoming']]]],
    ['order', 'Sourced release order or verified chronological guide', [anime, ['order', 'string', 'Guide type', false, ['release', 'chronological']]]],
  ],
  list: [
    ['add', 'Add or change an anime in your private watchlist', [anime, status]],
    ['show', 'Your private watchlist with progress controls', [status]],
    ['remove', 'Remove an entry from your watchlist', [anime]],
    ['progress', 'Set your recorded episode progress', [anime, ['episodes', 'integer', 'Episodes watched', true, [0, 100000]]]],
    ['rate', 'Save a private 1–10 rating', [anime, ['rating', 'integer', 'Your rating', true, [1, 10]]]],
    ['note', 'Write a private episode note in a form', [anime, episode]],
    ['notes', 'Read your private episode note', [anime, episode]],
    ['preferences', 'Set preferred genres for recommendations', [['genres', 'string', 'Comma-separated MAL genre IDs; use clear to reset', true]]],
    ['recommend', 'Recommendations from API results, ratings and history', []],
    ['random', 'Pick from your watchlist with filters', [status, ['genre', 'integer', 'MAL genre ID', false, [1, 1000]], ['minimum', 'number', 'Minimum MAL score', false, [0, 10]]]],
    ['privacy', 'Opt in or revoke sharing and comparisons in this server', [['consent', 'boolean', 'Allow comparison of titles and ratings with consenting members', true]]],
    ['shared', 'Anime you and a consenting member can watch together', [member]],
    ['compare', 'Private compatibility comparison with a consenting member', [member]],
    ['stats', 'Estimated watch time and monthly episode progress', []],
    ['challenge', 'Set a private monthly episode challenge', [['episodes', 'integer', 'Episode target this month', true, [1, 10000]]]],
    ['reminders', 'Opt into or disable private inactivity reminders', [['days', 'integer', 'Inactive days before a DM; 0 disables', true, [0, 90]]]],
    ['export', 'Export your anime data privately as JSON', []],
    ['delete', 'Confirm deletion of your anime data across servers', []],
  ],
  alerts: [
    ['follow', 'Follow release tracks privately or for this server', [anime, type, ['server', 'boolean', 'Post to configured server channel (Manage Server)'], ['role', 'role', 'Approved announcement role (server follows only)']]],
    ['unfollow', 'Stop following an anime', [anime, ['server', 'boolean', 'Remove server follow (Manage Server)']]],
    ['following', 'View your private or server follows', [['server', 'boolean', 'View server follows']]],
    ['countdown', 'Next mapped episode time, preserving release type', [anime, type]],
    ['schedule', 'Today or weekly AnimeSchedule timetable', [['period', 'string', 'Schedule period', false, ['today', 'week']], type, ['stream', 'string', 'Provider-listed streaming filter', false, ['crunchyroll']]]],
  ],
  club: [
    ['review', 'Explicitly publish an episode-context review', [anime, episode, ['rating', 'integer', 'Public review rating', true, [1, 10]], ['spoiler', 'boolean', 'Hide review behind a private warning (default true)']]],
    ['reviews', 'Browse review metadata; reveal text privately', [anime]],
    ['favorites', 'Server favorites from explicitly public reviews', []],
    ['poll', 'Post a persistent voting poll', [['question', 'string', 'Poll question', true], ['options', 'string', '2–10 options separated by |', true], ['hours', 'integer', 'Hours until voting closes', false, [1, 168]]]],
    ['party', 'Post a watch party with RSVP and private reminders', [anime, ['starts', 'string', 'ISO time including offset (e.g. 2026-11-01T20:00:00+02:00)', true]]],
    ['reschedule', 'Reschedule a party you own (or Manage Server)', [id, ['starts', 'string', 'New ISO time including offset', true]]],
    ['cancel', 'Cancel your party (or Manage Server)', [id]],
    ['parties', 'Browse upcoming watch parties', []],
    ['discuss', 'Create a spoiler-labeled episode discussion thread', [anime, episode]],
    ['hub', 'Post a refreshable anime hub (Manage Server)', [anime]],
    ['refresh', 'Refresh this channel’s hub for an anime (Manage Server)', [anime]],
  ],
  games: [
    ['guess', 'Start a clue, silhouette or image reveal guessing game', [['mode', 'string', 'Guessing mode', true, ['clues', 'silhouette', 'reveal']]]],
    ['answer', 'Submit a private guess', [id, ['guess', 'string', 'Anime title', true]]],
    ['reveal', 'Reveal the next clue/image stage in your game', [id]],
    ['tournament', 'Start a persistent character voting bracket', [['characters', 'string', '4, 8 or 16 distinct MAL character IDs, comma-separated', true]]],
    ['bracket', 'Show a character tournament', [id]],
    ['advance', 'Close current match and advance your tournament', [id]],
  ],
  admin: [
    ['settings', 'Show or update anime preferences (Manage Server)', [['enabled', 'boolean', 'Enable anime modules'], ['timezone', 'string', 'IANA time zone; default Asia/Jerusalem'], ['language', 'string', 'Title language', false, ['english', 'romaji', 'japanese']], ['spoilers', 'boolean', 'Hide synopsis by default'], ['quiet-start', 'string', 'Quiet hours start HH:mm, or off'], ['quiet-end', 'string', 'Quiet hours end HH:mm, or off'], ['notifications', 'boolean', 'Enable scheduled notifications']]],
    ['channels', 'Set announcement, news and schedule channels', [['announcements', 'channel', 'Episode and update channel'], ['news', 'channel', 'News/trailer channel'], ['schedule', 'channel', 'Weekly schedule channel']]],
    ['roles', 'Allow or remove a mention role for server follows', [['role', 'role', 'Role that may be mentioned', true], ['approved', 'boolean', 'Whether the role is approved', true]]],
    ['modules', 'Enable/disable a module', [['module', 'string', 'Module', true, ['discovery', 'tracking', 'announcements', 'community', 'games']], ['enabled', 'boolean', 'Enabled', true]]],
    ['mapping', 'Confirm exact MAL-to-AnimeSchedule mapping', [anime, ['slug', 'string', 'Verified AnimeSchedule anime URL slug', true]]],
    ['chronology', 'Save a sourced, verified chronological order', [anime, ['entries', 'string', 'MAL IDs in verified chronological order, comma-separated', true], ['source', 'string', 'Source URL verifying this order', true]]],
    ['feeds', 'Toggle scheduled weekly posts, followed-anime news and trailers', [['weekly', 'boolean', 'Automatic weekly timetable'], ['news', 'boolean', 'News for server follows'], ['trailers', 'boolean', 'Trailers for server follows']]],
  ],
};

function addOption(builder, [name, type, description, required = false, constraint]) {
  const methods = { anime: 'addStringOption', string: 'addStringOption', integer: 'addIntegerOption', number: 'addNumberOption', boolean: 'addBooleanOption', user: 'addUserOption', role: 'addRoleOption', channel: 'addChannelOption' };
  builder[methods[type]](o => {
    o.setName(name).setDescription(description).setRequired(required);
    if (type === 'anime') o.setAutocomplete(true).setMaxLength(100);
    else if (type === 'string') {
      o.setMaxLength(name === 'query' ? 100 : 1800);
      if (name === 'query') o.setAutocomplete(true);
      if (constraint) o.addChoices(...constraint.map(value => ({ name: value, value })));
    } else if (constraint) o.setMinValue(constraint[0]).setMaxValue(constraint[1]);
    return o;
  });
}
const data = new SlashCommandBuilder().setName('anime').setDescription('Hikari anime discovery, private tracking and community').setDMPermission(false);
data.addSubcommand(s => s.setName('help').setDescription('Anime commands, privacy and provider information'));
for (const [name, commands] of Object.entries(definitions)) data.addSubcommandGroup(group => {
  group.setName(name).setDescription(`Anime ${name}`);
  for (const [command, description, options] of commands) group.addSubcommand(sub => {
    sub.setName(command).setDescription(description);
    for (const option of [...options].sort((a, b) => Number(Boolean(b[3])) - Number(Boolean(a[3])))) addOption(sub, option);
    return sub;
  });
  return group;
});

export default { data, slashOnly: true, execute: executeAnime, autocomplete: autocompleteAnime };
