import { PermissionFlagsBits } from 'discord.js';
import { animeId } from './domain.js';
import { message, text, timestamp, partyView, pollView, tournamentView, gameView } from './views.js';
import { publishChannel, hubView, reviewsView, refreshPublication } from './communityViews.js';
import { sendableChannel } from './access.js';

async function savePublication(ctx, guildId, kind, item, channel, body) {
  const posted = await channel.send(body);
  try {
    await ctx.community.edit(guildId, g => { g[kind][item.id] = { ...g[kind][item.id], channelId: channel.id, messageId: posted.id }; return g; });
  } catch (error) { await posted.delete().catch(() => {}); throw error; }
  return posted;
}
export async function communityCommand(interaction, ctx, settings, sub, member) {
  const guildId = interaction.guildId, userId = interaction.user.id, o = interaction.options;
  const manager = member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (sub === 'reviews') return reviewsView(ctx, guildId, userId, animeId(o.getString('anime')));
  if (sub === 'favorites') {
    const state = await ctx.community.guild(guildId), totals = new Map();
    for (const review of state.reviews) {
      const item = totals.get(review.animeId) || { count: 0, total: 0, title: review.title || `MAL ${review.animeId}` };
      item.count++; item.total += review.rating; totals.set(review.animeId, item);
    }
    return message('Server favorites', [...totals].sort((a, b) => b[1].total / b[1].count - a[1].total / a[1].count || b[1].count - a[1].count).slice(0, 15).map(([id, v]) => `[${text(v.title)}](https://myanimelist.net/anime/${id}) · ${(v.total / v.count).toFixed(1)}/10 · ${v.count} public reviews`).join('\n') || 'No public ratings yet. Private watchlist ratings are never counted here.');
  }
  if (sub === 'parties') {
    const state = await ctx.community.guild(guildId);
    return message('Upcoming watch parties', Object.values(state.parties).filter(p => !p.canceled && Date.parse(p.startsAt) > Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 15).map(p => `**${text(p.title)}** · ID ${p.id}\n${timestamp(p.startsAt)}${p.messageId ? ` · [RSVP](https://discord.com/channels/${guildId}/${p.channelId}/${p.messageId})` : ''}`).join('\n\n') || 'No upcoming parties.');
  }
  if (sub === 'cancel' || sub === 'reschedule') {
    const party = await ctx.community.partyEdit(guildId, o.getString('id'), userId, manager, sub === 'cancel' ? { canceled: true } : { startsAt: o.getString('starts') });
    await refreshPublication(ctx, interaction.guild, 'parties', party.id, settings);
    const snapshot = partyView(party);
    snapshot.components = [];
    if (party.messageId) snapshot.embeds[0].addFields({ name: 'RSVP controls', value: `[Open the party post](https://discord.com/channels/${guildId}/${party.channelId}/${party.messageId})` });
    return snapshot;
  }
  const channel = await publishChannel(interaction);
  if (sub === 'poll') {
    const poll = await ctx.community.pollCreate(guildId, userId, o.getString('question'), o.getString('options').split('|').map(s => s.trim()), Date.now() + (o.getInteger('hours') || 24) * 3600000);
    const posted = await savePublication(ctx, guildId, 'polls', poll, channel, pollView(poll));
    return message('Poll posted', `[Open poll](${posted.url}) · ID ${poll.id}`);
  }
  const id = animeId(o.getString('anime'));
  const anime = await ctx.jikan.anime(id);
  if (sub === 'party') {
    const party = await ctx.community.partyCreate(guildId, userId, { animeId: id, title: anime.title, channelId: channel.id, startsAt: o.getString('starts') });
    const posted = await savePublication(ctx, guildId, 'parties', party, channel, partyView(party));
    return message('Watch party posted', `[Open party and RSVP](${posted.url}) · ID ${party.id}`);
  }
  if (sub === 'discuss') {
    const episode = o.getInteger('episode');
    if (anime.episodes && episode > anime.episodes) throw new Error('Episode exceeds the known episode count.');
    if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.CreatePublicThreads)) throw new Error('You need Create Public Threads permission.');
    await sendableChannel(interaction.guild, channel.id, [PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.SendMessagesInThreads]);
    const key = `${id}:${episode}:${channel.id}`;
    const state = await ctx.community.guild(guildId);
    if (state.discussions[key]) return message('Episode discussion', `[Open spoiler-labeled thread](https://discord.com/channels/${guildId}/${state.discussions[key].threadId}). Ordinary Discord threads do not enforce individual spoiler access.`);
    const thread = await channel.threads.create({ name: `SPOILERS · ${anime.title.slice(0, 65)} · Ep ${episode}`, autoArchiveDuration: 1440, reason: 'Anime episode discussion requested' });
    await thread.send({ content: `**Spoilers through episode ${episode}.** Use Discord spoiler formatting for story content (two vertical bars on each side). Do not post later-episode spoilers. This ordinary thread cannot restrict access based on individual progress.`, allowedMentions: { parse: [] } });
    await ctx.community.edit(guildId, g => { g.discussions[key] = { animeId: id, episode, threadId: thread.id, channelId: channel.id, ownerId: userId }; return g; });
    return message('Episode discussion created', `[Open thread](https://discord.com/channels/${guildId}/${thread.id}) · spoilers through episode ${episode}.`);
  }
  if (sub === 'hub' || sub === 'refresh') {
    if (!manager) throw new Error('Manage Server permission is required for anime hubs.');
    const key = `${channel.id}:${id}`;
    const current = (await ctx.community.guild(guildId)).hubs[key];
    if (current) {
      await refreshPublication(ctx, interaction.guild, 'hubs', key, settings);
      return message('Anime hub refreshed', `[Open hub](https://discord.com/channels/${guildId}/${channel.id}/${current.messageId})`);
    }
    if (sub === 'refresh') throw new Error('No hub exists for this anime in this channel. Use /anime club hub first.');
    const posted = await channel.send(await hubView(ctx, guildId, channel.id, id, settings));
    try { await ctx.community.edit(guildId, g => { g.hubs[key] = { animeId: id, channelId: channel.id, messageId: posted.id }; return g; }); }
    catch (error) { await posted.delete().catch(() => {}); throw error; }
    return message('Anime hub posted', `[Open hub](${posted.url}). It can be refreshed with /anime club refresh and updates periodically while enabled.`);
  }
  throw new Error('Unknown community action.');
}

export async function gamesCommand(interaction, ctx, settings, sub, member) {
  const guildId = interaction.guildId, userId = interaction.user.id, o = interaction.options;
  const manager = member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (sub === 'guess') {
    const channel = await publishChannel(interaction);
    const result = await ctx.jikan.search('anime', { order_by: 'popularity', sort: 'asc', page: Math.floor(Math.random() * 5) + 1, type: 'tv' });
    const options = (result.data || []).filter(a => a.rating !== 'Rx - Hentai' && a.title);
    if (!options.length) throw new Error('The provider returned no suitable anime for this game.');
    const anime = options[Math.floor(Math.random() * options.length)];
    const game = await ctx.community.gameCreate(guildId, userId, anime, o.getString('mode'));
    const posted = await savePublication(ctx, guildId, 'games', game, channel, await gameView(game));
    return message('Guessing game started', `[Open game](${posted.url}) · ID ${game.id}`);
  }
  if (sub === 'answer') {
    const result = await ctx.community.answer(guildId, o.getString('id'), userId, o.getString('guess'));
    if (result.correct) await refreshPublication(ctx, interaction.guild, 'games', result.game.id, settings);
    return message('Your guess', result.correct ? 'Correct! The game has ended and your win is saved.' : 'That is not a matching title. Try another guess after three seconds.');
  }
  if (sub === 'reveal') {
    const game = await ctx.community.reveal(guildId, o.getString('id'), userId, manager);
    await refreshPublication(ctx, interaction.guild, 'games', game.id, settings);
    return message('Next clue revealed', `Game ${game.id} is now at reveal stage ${game.level + 1}.`);
  }
  if (sub === 'tournament') {
    const channel = await publishChannel(interaction);
    const ids = o.getString('characters').split(',').map(s => animeId(s.trim()));
    if (![4, 8, 16].includes(ids.length) || new Set(ids).size !== ids.length) throw new Error('Provide 4, 8 or 16 distinct MAL character IDs.');
    const entries = [];
    for (const id of ids) { const character = await ctx.jikan.person('characters', id); entries.push({ id, name: character.name }); }
    const bracket = await ctx.community.tournamentCreate(guildId, userId, entries);
    const posted = await savePublication(ctx, guildId, 'tournaments', bracket, channel, tournamentView(bracket));
    return message('Character tournament started', `[Open bracket](${posted.url}) · ID ${bracket.id}`);
  }
  let bracket;
  if (sub === 'advance') { bracket = await ctx.community.tournamentAdvance(guildId, o.getString('id'), userId, manager); await refreshPublication(ctx, interaction.guild, 'tournaments', bracket.id, settings); }
  else bracket = (await ctx.community.guild(guildId)).tournaments[o.getString('id')];
  if (!bracket) throw new Error('Tournament not found.');
  const snapshot = tournamentView(bracket);
  snapshot.components = [];
  if (bracket.messageId) snapshot.embeds[0].addFields({ name: 'Vote on the public post', value: `[Open the tournament](https://discord.com/channels/${guildId}/${bracket.channelId}/${bracket.messageId})` });
  return snapshot;
}
