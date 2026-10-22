import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder, escapeMarkdown } from 'discord.js';
import sharp from 'sharp';
import { createEmbed } from '../../utils/embeds.js';
import { titleOf } from './domain.js';
import { safeUrl, streamingLinks } from './providers.js';

export const text = (value, max = 1000) => escapeMarkdown(String(value ?? 'Unknown')).slice(0, max);
export const timestamp = value => value && !Number.isNaN(Date.parse(value)) ? `<t:${Math.floor(Date.parse(value) / 1000)}:F> (<t:${Math.floor(Date.parse(value) / 1000)}:R>)` : 'Unknown';
export const row = (...items) => new ActionRowBuilder().addComponents(items.flat());
export const button = (label, id, style = ButtonStyle.Secondary) => new ButtonBuilder().setLabel(label.slice(0, 80)).setCustomId(id).setStyle(style);
export const message = (title, description, components = []) => ({ embeds: [createEmbed({ title, description: String(description).slice(0, 4000), color: 'primary' })], components, allowedMentions: { parse: [] } });
export const uiButton = (label, session, action, style) => button(label, `anime_ui:${session}:${action}`, style);

export function animeCard(anime, settings = {}, streams = []) {
  const links = streamingLinks(streams).slice(0, 5);
  const body = message(titleOf(anime, settings.language), `MAL ID: **${anime.mal_id}**\n${settings.hideSpoilers === false && anime.synopsis ? text(anime.synopsis, 1500) + '\n\n' : ''}Regional availability, available languages and Crunchyroll publication: **unknown**. Links are provider listings.\n[Source: MyAnimeList via Jikan](https://myanimelist.net/anime/${anime.mal_id})`);
  body.embeds[0].addFields(
    { name: 'Score · Episodes', value: `${anime.score || 'Unknown'} · ${anime.episodes || 'Unknown'}`, inline: true },
    { name: 'Status · Format', value: `${text(anime.status)} · ${text(anime.type)}`, inline: true },
    { name: 'Genres', value: text((anime.genres || []).map(g => g.name).join(', ') || 'Unknown') },
    { name: 'Studios', value: text((anime.studios || []).map(g => g.name).join(', ') || 'Unknown') },
  );
  const image = safeUrl(anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url, ['myanimelist.net']);
  if (image) body.embeds[0].setThumbnail(image);
  if (links.length) body.components.push(row(links.map(link => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(link.name.slice(0, 80)).setURL(link.url))));
  return body;
}

export async function detailView(ctx, id, userId, guildId, settings) {
  const anime = await ctx.jikan.anime(id);
  let streams = anime.streaming || [];
  if (!streams.length) { try { streams = await ctx.jikan.resource(id, 'streaming'); } catch { /* metadata remains usable during a partial provider outage */ } }
  const body = animeCard(anime, settings, streams);
  if (ctx.store) {
    const session = await ctx.store.session({ ownerId: userId, guildId, kind: 'detail', animeId: Number(id), module: 'discovery' });
    body.components.push(row(uiButton('Plan to watch', session, 'plan', ButtonStyle.Primary), uiButton('Episode +1', session, 'increment'), uiButton('Follow releases', session, 'follow'), uiButton('Reveal synopsis', session, 'synopsis')));
  }
  return body;
}

export async function searchPage(ctx, search) {
  let result;
  const kind = search.kind || 'anime';
  if (search.results) result = { data: search.results, pagination: {} };
  else if (search.season) result = await ctx.jikan.season(search.season, new Date(), search.page);
  else result = await ctx.jikan.search(kind, { ...search.params, page: search.page });
  let entries = result.data || [];
  if (search.stream) {
    const checked = [];
    for (const anime of entries) {
      const streams = streamingLinks(await ctx.jikan.resource(anime.mal_id, 'streaming'));
      if (streams.some(s => new URL(s.url).hostname === 'crunchyroll.com' || new URL(s.url).hostname.endsWith('.crunchyroll.com'))) checked.push(anime);
    }
    entries = checked;
  }
  const description = entries.map((entry, i) => `${i + 1}. **${text(entry.title || entry.name, 180)}** · ID ${entry.mal_id}${entry.score ? ` · ${entry.score}/10` : ''}${entry.reason ? `\n${text(entry.reason, 150)}` : ''}`).join('\n') || 'No matching results on this page.';
  const body = message(`Anime ${kind === 'anime' ? 'discovery' : kind === 'people' ? 'voice actors' : 'characters'} · Page ${search.page || 1}`, `${description}${search.stream ? '\n\nStreaming filter applies to this page’s provider links. Region remains unknown.' : ''}\n\nSource: [Jikan / MyAnimeList](https://jikan.moe)`);
  if (!ctx.store) return body;
  const session = await ctx.store.session({ ...search, kind, module: 'discovery', ids: entries.map(e => e.mal_id), expiresAt: undefined });
  if (entries.length) body.components.push(row(new StringSelectMenuBuilder().setCustomId(`anime_ui:${session}:select`).setPlaceholder('Choose a result').addOptions(entries.slice(0, 25).map(e => ({ label: (e.title || e.name).slice(0, 100), value: String(e.mal_id) })))));
  const navigation = [];
  if (search.page > 1 && !search.results) navigation.push(uiButton('Previous page', session, 'previous'));
  if (result.pagination?.has_next_page && !search.results) navigation.push(uiButton('Next page', session, 'next'));
  if (navigation.length) body.components.push(row(navigation));
  return body;
}

export function partyView(party) {
  const counts = response => Object.values(party.rsvps).filter(r => r === response).length;
  return message(`${party.canceled ? 'Canceled · ' : ''}Watch party · ${party.title}`, `Party ID: **${party.id}**\n${timestamp(party.startsAt)}\nGoing ${counts('yes')} · Maybe ${counts('maybe')} · Declined ${counts('no')}\nRSVP Going opts into private reminder DMs for this party. Change to No to revoke.`, party.canceled ? [] : [row(button('Going', `anime_public:party:${party.id}:yes`, ButtonStyle.Primary), button('Maybe', `anime_public:party:${party.id}:maybe`), button('No / stop reminders', `anime_public:party:${party.id}:no`))]);
}
export function pollView(poll) {
  const counts = poll.options.map((_, i) => Object.values(poll.votes).filter(v => v === i).length);
  const closed = poll.endsAt <= Date.now();
  const body = message(poll.question, `Poll ID: **${poll.id}** · ${closed ? 'Closed' : 'Closes'} ${timestamp(new Date(poll.endsAt).toISOString())}\n${poll.options.map((option, i) => `${i + 1}. ${text(option)} — **${counts[i]}**`).join('\n')}\nOne vote per member; selecting again changes your vote. Votes are stored until data deletion.`);
  if (!closed) body.components.push(row(new StringSelectMenuBuilder().setCustomId(`anime_public:poll:${poll.id}`).setPlaceholder('Cast or change your vote').addOptions(poll.options.map((option, i) => ({ label: option, value: String(i) })))));
  return body;
}
export function tournamentView(bracket) {
  if (bracket.winner) return message('Character tournament winner', `**${text(bracket.winner.name)}**\nTournament ID: ${bracket.id}`);
  const pair = bracket.matches[bracket.match];
  const votes = Object.values(bracket.votes[`${bracket.round}:${bracket.match}`] || {});
  return message('Character tournament', `ID: **${bracket.id}** · Round ${bracket.round + 1} · Match ${bracket.match + 1}/${bracket.matches.length}\n**${text(pair[0].name)}** (${votes.filter(v => v === 0).length}) vs **${text(pair[1].name)}** (${votes.filter(v => v === 1).length})\nOwner closes each match with /anime games advance. Ties advance the earlier seed.`, [row(pair.map((entry, i) => button(entry.name, `anime_public:tournament:${bracket.id}:${bracket.round}:${bracket.match}:${i}`, ButtonStyle.Primary)))]);
}
export async function gameImage(game, fetcher = fetch) {
  const url = safeUrl(game.image, ['cdn.myanimelist.net']);
  if (!url) return null;
  const response = await fetcher(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error('The cover image is unavailable. Use the game’s text clues.');
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > 5000000) throw new Error('The cover image exceeds the image size limit.');
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 5000000) { await reader.cancel(); throw new Error('The cover image exceeds the image size limit.'); }
    chunks.push(value);
  }
  let pipeline = sharp(Buffer.concat(chunks), { limitInputPixels: 20000000 }).resize(300, 420, { fit: 'cover' }).toColourspace('srgb').removeAlpha();
  if (game.mode === 'silhouette' && game.level === 0) {
    // Estimate the dominant border color, flood only its connected background,
    // then fill the remaining foreground. Unlike blacking out a cover, this
    // preserves a real shape. Textured covers can produce abstract masks.
    const { data, info } = await pipeline.clone().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info, size = width * height, colors = new Map();
    const border = [];
    for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
    for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1);
    for (const p of border) {
      const key = ((data[p * 3] >> 5) << 6) | ((data[p * 3 + 1] >> 5) << 3) | (data[p * 3 + 2] >> 5);
      colors.set(key, (colors.get(key) || 0) + 1);
    }
    const key = [...colors].sort((a, b) => b[1] - a[1])[0][0];
    const bg = [(key >> 6) * 32 + 16, ((key >> 3) & 7) * 32 + 16, (key & 7) * 32 + 16];
    const mask = new Uint8Array(size), queue = new Int32Array(size);
    let head = 0, tail = 0;
    const visit = p => {
      if (p < 0 || p >= size || mask[p]) return;
      if ((data[p * 3] - bg[0]) ** 2 + (data[p * 3 + 1] - bg[1]) ** 2 + (data[p * 3 + 2] - bg[2]) ** 2 > 10000) return;
      mask[p] = 1; queue[tail++] = p;
    };
    for (const p of border) visit(p);
    while (head < tail) { const p = queue[head++]; if (p % width) visit(p - 1); if (p % width < width - 1) visit(p + 1); visit(p - width); visit(p + width); }
    const output = Buffer.alloc(size * 3);
    for (let p = 0; p < size; p++) if (mask[p]) output.fill(255, p * 3, p * 3 + 3);
    return sharp(output, { raw: { width, height, channels: 3 } }).png().toBuffer();
  }
  else if (game.level < 3) pipeline = pipeline.blur(game.level === 0 ? 30 : game.level === 1 ? 15 : 5);
  return pipeline.png().toBuffer();
}
export async function gameView(game) {
  const ended = game.winnerId || game.endedAt || game.expiresAt <= Date.now();
  const body = message('Guess the anime', `Game ID: **${game.id}** · ${game.mode}\n${ended ? `Ended. Answer: **${text(game.answers[0])}**${game.winnerId ? ` · Winner <@${game.winnerId}>` : ''}` : `${game.clues.slice(0, game.level + 1).map(c => text(c)).join('\n')}\nSubmit with /anime games answer. Expires ${timestamp(new Date(game.expiresAt).toISOString())}`}`);
  if (game.mode !== 'clues') {
    try {
      const buffer = await gameImage(game);
      if (buffer) { body.files = [new AttachmentBuilder(buffer, { name: 'guess.png', description: 'An obscured anime cover; text clues are included in the message.' })]; body.embeds[0].setImage('attachment://guess.png'); }
    } catch { body.embeds[0].addFields({ name: 'Cover unavailable', value: 'Use the text clues above.' }); }
  }
  if (!ended) body.components.push(row(button('Reveal next clue (host)', `anime_public:game:${game.id}`)));
  return body;
}
export function scheduleView(entries, page = 0, title = 'AnimeSchedule timetable') {
  const labels = { raw: 'Japanese broadcast', sub: 'Subtitle schedule', dub: 'Dub schedule', unknown: 'Unknown release type' };
  return message(`${title} · Page ${page + 1}`, entries.slice(page * 10, page * 10 + 10).map(e => `**${text(e.title, 180)}** · Ep ${e.episode || '?'} · ${labels[e.type]}\n${timestamp(e.at)}${e.delay ? `\nDelay: ${text(e.delay, 160)}` : ''}\n[Source](${e.source})`).join('\n\n') + '\n\n[AnimeSchedule.net](https://animeschedule.net) · Scheduled times do not confirm Crunchyroll publication or regional availability.');
}
