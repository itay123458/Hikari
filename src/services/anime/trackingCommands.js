import { AttachmentBuilder } from 'discord.js';
import { animeId, localDate } from './domain.js';
import { detailView, searchPage, message, text, row, uiButton } from './views.js';
import { validateGenres } from './discoveryCommands.js';

export async function watchlistPage(ctx, userId, guildId, status, page = 0) {
  const profile = await ctx.tracking.profile(userId);
  const entries = Object.values(profile.list).filter(a => !status || a.status === status).sort((a, b) => a.title.localeCompare(b.title));
  const visible = entries.slice(page * 8, page * 8 + 8);
  const body = message(`Your private watchlist · Page ${page + 1}`, visible.map(a => `**${text(a.title, 140)}** · ID ${a.malId}\n${a.status} · ${a.progress}/${a.episodes || '?'} episodes${a.rating ? ` · Your rating ${a.rating}/10` : ''}`).join('\n\n') || 'No entries yet. Use /anime list add.');
  const session = await ctx.store.session({ ownerId: userId, guildId, kind: 'watchlist', module: 'tracking', status, page, ids: visible.map(a => a.malId) });
  for (let i = 0; i < Math.min(visible.length, 8); i += 4) body.components.push(row(visible.slice(i, i + 4).map(a => uiButton(`+1 · ${a.title.slice(0, 40)}`, session, `inc-${a.malId}`))));
  const nav = [];
  if (page > 0) nav.push(uiButton('Previous page', session, 'previous'));
  if ((page + 1) * 8 < entries.length) nav.push(uiButton('Next page', session, 'next'));
  if (nav.length) body.components.push(row(nav));
  return body;
}

export async function trackingCommand(interaction, ctx, settings, sub) {
  const userId = interaction.user.id, guildId = interaction.guildId, o = interaction.options;
  const id = () => animeId(o.getString('anime'));
  if (sub === 'show') return watchlistPage(ctx, userId, guildId, o.getString('status'));
  if (sub === 'add') { await ctx.tracking.add(userId, id(), o.getString('status') || 'planned'); return message('Watchlist saved', 'Your private watchlist has been updated. Use /anime list show to record episodes.'); }
  if (sub === 'remove') { await ctx.tracking.remove(userId, id()); return message('Entry removed', 'Removed from your private watchlist. Your notes and viewing history are retained until you delete them.'); }
  if (sub === 'progress') { await ctx.tracking.progress(userId, id(), o.getInteger('episodes')); return message('Progress saved', 'Your episode progress is stored privately.'); }
  if (sub === 'rate') { await ctx.tracking.rate(userId, id(), o.getInteger('rating')); return message('Rating saved', 'Your private rating now contributes to recommendations. Public ratings use /anime club review.'); }
  if (sub === 'notes') {
    const profile = await ctx.tracking.profile(userId);
    return message('Private episode note', text(profile.notes[`${id()}:${o.getInteger('episode')}`] || 'No note saved for this episode.', 1800));
  }
  if (sub === 'preferences') {
    const genres = validateGenres(o.getString('genres'));
    const known = genres ? await ctx.jikan.get('genres/anime') : null;
    if (genres && genres.split(',').some(g => !known.data.some(k => k.mal_id === Number(g)))) throw new Error('One of these MAL genre IDs is unknown.');
    await ctx.tracking.edit(userId, p => { p.preferences = genres ? genres.split(',').map(Number) : []; return p; });
    return message('Preferences saved', 'Genre preferences will be used alongside your ratings and viewing history.');
  }
  if (sub === 'recommend') return searchPage(ctx, { ownerId: userId, guildId, kind: 'anime', page: 1, results: await ctx.tracking.recommendations(userId) });
  if (sub === 'random') {
    const anime = await ctx.tracking.random(userId, { status: o.getString('status'), genre: o.getInteger('genre'), minimum: o.getNumber('minimum') });
    return detailView(ctx, anime.malId, userId, guildId, settings);
  }
  if (sub === 'privacy') {
    await ctx.tracking.privacy(userId, guildId, o.getBoolean('consent'));
    return message('Privacy preference saved', o.getBoolean('consent') ? 'You opted into title/rating comparisons with other consenting members in this server. Notes and progress remain private. You can revoke at any time.' : 'Your sharing consent is revoked in this server. Comparisons and shared suggestions now refuse access.');
  }
  if (sub === 'compare' || sub === 'shared') {
    const other = o.getUser('member');
    if (!await interaction.guild.members.fetch({ user: other.id, force: true }).catch(() => null)) throw new Error('The other person must still be a member of this server.');
    const result = await ctx.tracking.shared(userId, other.id, guildId);
    return message(sub === 'shared' ? 'Shared anime suggestions' : 'Private compatibility', sub === 'shared' ? result.suggestions.slice(0, 20).map(a => `[${text(a.title)}](https://myanimelist.net/anime/${a.malId})`).join('\n') || 'No shared unfinished anime found.' : `Watchlist title overlap: **${result.overlap}%**\nRating agreement: **${result.ratingAgreement ?? 'Unknown'}${result.ratingAgreement === null ? '' : '%'}**\nShared titles: **${result.sharedIds.length}**\nThese are simple overlap measures based on explicitly shared titles and ratings.`);
  }
  if (sub === 'stats' || sub === 'challenge') {
    const stats = await ctx.tracking.stats(userId, settings.timezone);
    if (sub === 'challenge') await ctx.tracking.edit(userId, p => { p.challenges[stats.month] = o.getInteger('episodes'); return p; });
    const p = await ctx.tracking.profile(userId);
    return message('Your private viewing statistics', `Watchlist: **${stats.anime} anime · ${stats.episodes} episodes**\nEstimated watched: **${stats.estimatedMinutes} minutes**\n${stats.month}: **${stats.monthEpisodes} episodes · ${stats.monthMinutes} estimated minutes**\nMonthly challenge: **${p.challenges[stats.month] ? `${stats.monthEpisodes}/${p.challenges[stats.month]} episodes` : 'Not set'}**\nDurations are provider estimates. ${stats.unknownDuration} watched entries have unknown duration. Monthly history counts recorded increases, including rewatch increments; corrections do not erase history.`);
  }
  if (sub === 'reminders') {
    const days = o.getInteger('days');
    if (days > 0 && days < 2) throw new Error('Choose at least 2 days, or 0 to disable reminders.');
    await ctx.tracking.edit(userId, p => { p.reminderDays = days; p.reminderGuild = guildId; p.reminderSetAt = new Date().toISOString(); return p; });
    return message('Reminder preference saved', days ? `You opted into a private DM after ${days} inactive days. Blocked DMs are handled without posting personal information in the server.` : 'Private inactivity reminders disabled.');
  }
  if (sub === 'export') {
    const profile = await ctx.tracking.profile(userId);
    const contributions = [];
    for (const g of await ctx.store.list('guild')) contributions.push({ guildId: g.id,
      reviews: (g.data.reviews || []).filter(r => r.userId === userId),
      parties: Object.values(g.data.parties || {}).filter(p => p.ownerId === userId).map(({ rsvps, ...party }) => ({ ...party, rsvpCounts: Object.values(rsvps).reduce((out, value) => ({ ...out, [value]: (out[value] || 0) + 1 }), {}) })),
      votes: Object.values(g.data.polls || {}).filter(p => Object.hasOwn(p.votes, userId)).map(p => ({ pollId: p.id, choice: p.votes[userId] })),
      rsvps: Object.values(g.data.parties || {}).filter(p => p.rsvps[userId]).map(p => ({ partyId: p.id, response: p.rsvps[userId] })),
      polls: Object.values(g.data.polls || {}).filter(p => p.ownerId === userId).map(({ votes, ...poll }) => ({ ...poll, results: poll.options.map((_, index) => Object.values(votes).filter(v => v === index).length) })),
      games: Object.values(g.data.games || {}).filter(game => game.ownerId === userId).map(({ attempts, winnerId, ...game }) => ({ ...game, wonByYou: winnerId === userId, attemptedGuesses: Object.keys(attempts || {}).length })),
      wins: Object.values(g.data.games || {}).filter(game => game.winnerId === userId).map(game => ({ gameId: game.id, animeId: game.animeId })),
      tournaments: Object.values(g.data.tournaments || {}).filter(bracket => bracket.ownerId === userId).map(({ votes, ...bracket }) => ({ ...bracket, results: Object.fromEntries(Object.entries(votes).map(([match, ballot]) => [match, [0, 1].map(choice => Object.values(ballot).filter(v => v === choice).length)])) })),
      tournamentVotes: Object.values(g.data.tournaments || {}).flatMap(bracket => Object.entries(bracket.votes || {}).filter(([, ballot]) => Object.hasOwn(ballot, userId)).map(([match, ballot]) => ({ tournamentId: bracket.id, match, choice: ballot[userId] }))),
      discussions: Object.values(g.data.discussions || {}).filter(d => d.ownerId === userId),
    });
    return { ...message('Your anime data export', 'Contains your global private profile and your public contributions. Store this file privately.'), files: [new AttachmentBuilder(Buffer.from(JSON.stringify({ userId, exportedAt: new Date().toISOString(), profile, contributions }, null, 2)), { name: 'hikari-anime-data.json' })] };
  }
  if (sub === 'delete') {
    const session = await ctx.store.session({ ownerId: userId, guildId, kind: 'delete', module: 'tracking' }, 5);
    return message('Delete all your anime data?', 'This removes your global watchlist, notes, history, preferences, consent, subscriptions, contributions and stored votes across servers. Backups expire under the operator’s retention policy. Bot messages will be refreshed or removed where permissions allow. This cannot be undone.', [row(uiButton('Delete my anime data', session, 'confirm', 4))]);
  }
  throw new Error('Unknown watchlist action.');
}
