import { followedSchedule } from './schedules.js';
import { animeId, localDate } from './domain.js';
import { detailView, searchPage, message, text, timestamp, scheduleView, row, uiButton } from './views.js';
import { releaseGuide, releaseDate, resolveMapping, safeUrl } from './providers.js';

export async function personView(ctx, kind, id) {
  const person = await ctx.jikan.person(kind, id);
  const lines = kind === 'characters' ? (person.voices || []).slice(0, 10).map(v => `${text(v.person?.name)} · ${text(v.language)}`) : (person.voices || []).slice(0, 10).map(v => `${text(v.character?.name)} · ${text(v.anime?.title)} · ${text(v.role)}`);
  const body = message(person.name || 'Person', `${lines.join('\n') || 'Voice credits unavailable.'}\n\n[Source: MyAnimeList](${safeUrl(person.url, ['myanimelist.net']) || 'https://myanimelist.net'})\nBiographical and story details are omitted to avoid spoilers.`);
  const image = safeUrl(person.images?.jpg?.image_url, ['myanimelist.net']);
  if (image) body.embeds[0].setThumbnail(image);
  return body;
}

export async function discoverCommand(interaction, ctx, settings, sub) {
  const o = interaction.options, ownerId = interaction.user.id, guildId = interaction.guildId;
  if (sub === 'search') return searchPage(ctx, { ownerId, guildId, kind: 'anime', page: 1, stream: o.getString('stream'), params: { q: o.getString('query'), genres: validateGenres(o.getString('genre')), status: o.getString('status'), min_score: o.getNumber('minimum'), type: o.getString('format') } });
  if (sub === 'character' || sub === 'voice') return searchPage(ctx, { ownerId, guildId, kind: sub === 'voice' ? 'people' : 'characters', page: 1, params: { q: o.getString('query') } });
  if (sub === 'detail') return detailView(ctx, animeId(o.getString('anime')), ownerId, guildId, settings);
  if (sub === 'season') return searchPage(ctx, { ownerId, guildId, kind: 'anime', page: 1, season: o.getString('period') });
  if (sub === 'order') {
    const id = animeId(o.getString('anime'));
    if (o.getString('order') === 'chronological') {
      const guide = ctx.store && await ctx.store.read('chronology', `${guildId}:${id}`);
      if (!guide) return message('Chronological order unknown', 'No sourced chronological guide has been verified by this server’s administrators. Release order and prequel/sequel relationships do not prove chronology.');
      return message('Administrator-verified chronological guide', `${guide.entries.map((entry, i) => `${i + 1}. [${text(entry.title)}](https://myanimelist.net/anime/${entry.malId})`).join('\n')}\n\n[Verification source](${guide.source})\nCurated by this server; report inaccuracies to its administrators.`);
    }
    const guide = await releaseGuide(ctx.jikan, id);
    return message('Release order · related entries', `${guide.entries.map((a, i) => `${i + 1}. [${text(a.title)}](https://myanimelist.net/anime/${a.mal_id}) · ${releaseDate(a.aired).value || 'date unknown'}`).join('\n')}\n\nSource: MAL relationships/premiere dates via Jikan. This is release order; optionality and chronology are unverified.${guide.truncated ? ' Limited to 12 related entries.' : ''}`);
  }
  throw new Error('Unknown discovery action.');
}

export function validateGenres(input) {
  if (!input || input === 'clear') return '';
  if (!/^\d{1,4}(,\s*\d{1,4}){0,9}$/.test(input)) throw new Error('Use up to 10 comma-separated MAL genre IDs.');
  return input.replaceAll(' ', '');
}

export async function scheduleCommand(interaction, ctx, settings, countdown = false) {
  const type = interaction.options.getString('type') || 'all';
  const scope = countdown ? 'all' : interaction.options.getString('scope') || 'server';
  let entries;
  if (scope === 'all') entries = await ctx.schedule.timetable(type);
  else {
    if (!ctx.store) throw new Error('Followed schedules require the persistent database; scope all shows the general timetable.');
    const follows = scope === 'personal' ? (await ctx.tracking.profile(interaction.user.id)).follows : (await ctx.community.guild(interaction.guildId)).follows;
    entries = await followedSchedule(ctx, interaction.guildId, follows, settings, { period: interaction.options.getString('period') || 'week', type });
  }
  if (countdown) {
    const id = animeId(interaction.options.getString('anime'));
    if (!ctx.store) throw new Error('Countdown identity mapping needs the persistent database.');
    const mapping = await resolveMapping(ctx.store, ctx.schedule, interaction.guildId, id);
    if (!mapping) return message('Schedule mapping unknown', 'No exact cross-provider mapping was found. An administrator can verify it with /anime admin mapping.');
    const next = await ctx.schedule.timetable(type, new Date(Date.now() + 7 * 86400000));
    entries = [...new Map([...entries, ...next].filter(e => e.route === mapping.route && (!e.at || Date.parse(e.at) >= Date.now())).map(e => [`${e.route}:${e.type}:${e.episode}`, e])).values()];
    entries.sort((a, b) => (a.at || '9999').localeCompare(b.at || '9999'));
    return entries.length ? scheduleView(entries.slice(0, 10).map(e => ({ ...e, requestedType: type })), 0, 'Next mapped schedule') : message('Next episode unknown', 'The provider has no upcoming mapped episode in the current or next week. No date is assumed.');
  }
  if (interaction.options.getString('period') === 'today') entries = entries.filter(e => e.at && localDate(new Date(e.at), settings.timezone) === localDate(new Date(), settings.timezone));
  if (interaction.options.getString('stream')) entries = entries.filter(e => e.streams.some(s => new URL(s.url).hostname === 'crunchyroll.com' || new URL(s.url).hostname.endsWith('.crunchyroll.com')));
  entries.sort((a, b) => (a.at || '9999').localeCompare(b.at || '9999'));
  if (!entries.length) return message(scope === 'all' ? 'AnimeSchedule timetable' : 'Followed anime schedule', 'No known entries match these filters. Unknown release times are not shown in today’s filter.');
  return schedulePage(ctx, { ownerId: interaction.user.id, guildId: interaction.guildId, entries, page: 0 });
}
export async function schedulePage(ctx, data) {
  const body = scheduleView(data.entries, data.page);
  if (ctx.store && data.entries.length > 10) {
    const id = await ctx.store.session({ ...data, kind: 'schedule', module: 'announcements' });
    const buttons = [];
    if (data.page > 0) buttons.push(uiButton('Previous page', id, 'previous'));
    if ((data.page + 1) * 10 < data.entries.length) buttons.push(uiButton('Next page', id, 'next'));
    if (buttons.length) body.components.push(row(buttons));
  }
  return body;
}
