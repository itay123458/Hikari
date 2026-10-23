import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { guard, validateSession } from './access.js';
import { contextFor, requireStore } from './context.js';
import { animeId, readReview } from './domain.js';
import { message, text, detailView, searchPage, row, uiButton } from './views.js';
import { discoverCommand, personView, schedulePage } from './discoveryCommands.js';
import { trackingCommand, watchlistPage } from './trackingCommands.js';
import { communityCommand, gamesCommand } from './communityCommands.js';
import { alertCommand } from './alertCommands.js';
import { adminCommand } from './adminCommands.js';
import { reviewsView, refreshPublication, eraseUserData, publishChannel } from './communityViews.js';

const moduleFor = { discover: 'discovery', list: 'tracking', alerts: 'announcements', club: 'community', games: 'games', admin: null };
export const HELP = [
  '**Discover:** /anime discover search, detail, character, voice, season, order',
  '**Private tracking:** /anime list add, show, progress, rate, note, notes, preferences, recommend, random, stats, challenge, reminders',
  '**Privacy:** /anime list privacy (per-server sharing consent), shared, compare, export, delete',
  '**Schedules:** /anime alerts follow, unfollow, following, countdown, schedule',
  '**Community:** /anime club review, reviews, favorites, poll, party, parties, cancel, reschedule, discuss, hub, refresh',
  '**Games:** /anime games guess, answer, reveal, tournament, bracket, advance',
  '**Administrators:** /anime admin settings, channels, roles, modules, mapping, chronology, feeds, weekly, preview',
  '\nPersonal responses and notes are private. Shared suggestions and comparisons require both members’ current consent. Reviews are public contributions whose text is revealed privately; ordinary threads cannot enforce per-member spoiler access.',
  '\n[Jikan v4](https://jikan.moe) supplies MAL metadata. [AnimeSchedule.net](https://animeschedule.net) supplies raw/sub/dub schedules and needs an application token. Crunchyroll uses provider-listed links; regions, languages and actual publication remain unknown.',
].join('\n\n');

export async function safely(interaction, task) {
  try { return await task(); }
  catch (error) {
    // Never serialize provider responses, request headers, connection strings,
    // note text or Discord payloads into logs.
    logger.warn('Anime action failed', { event: 'anime.action.failed', errorCode: String(error.code || error.name || 'ANIME_ACTION_FAILED'), guildId: interaction.guildId });
    let description = error.code || error instanceof TypeError ? 'The anime action could not be completed. Please try again; the operator can check the database and permissions.' : error.message;
    if (error.name === 'ZodError') description = error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
    const body = message('Anime action unavailable', text(description, 1800));
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(body);
      else await interaction.reply({ ...body, flags: MessageFlags.Ephemeral });
    } catch { /* expired Discord tokens cannot be repaired by another response */ }
  }
}

export async function promptForm(interaction, ctx, kind) {
  const o = interaction.options;
  const id = animeId(o.getString('anime')), episode = o.getInteger('episode');
  const data = { ownerId: interaction.user.id, guildId: interaction.guildId, kind, animeId: id, episode, module: kind === 'note' ? 'tracking' : 'community' };
  if (kind === 'review') { data.rating = o.getInteger('rating'); data.spoiler = o.getBoolean('spoiler') !== false; }
  const session = await ctx.store.session(data, 10);
  const form = new ModalBuilder().setCustomId(`anime_form:${session}:${kind}`).setTitle(kind === 'note' ? `Private note · Episode ${episode}` : `Publish review · Episode ${episode}`);
  form.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel(kind === 'note' ? 'Private note; leave empty to delete' : 'Public review; private spoiler reveal').setStyle(TextInputStyle.Paragraph).setMaxLength(1800).setRequired(kind === 'review')));
  await interaction.showModal(form);
}

export async function executeAnime(interaction, _guildConfig, client) {
  return safely(interaction, async () => {
    const group = interaction.options.getSubcommandGroup(false), sub = interaction.options.getSubcommand();
    const form = (group === 'list' && sub === 'note') || (group === 'club' && sub === 'review');
    if (!form) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { settings, member } = await guard(interaction, client, moduleFor[group], { admin: group === 'admin', action: [group, sub].filter(Boolean).join(' ') });
    if (!group && sub === 'help') return interaction.editReply(message('Hikari anime help', HELP));
    const ctx = contextFor(client);
    if (group !== 'discover' && !(group === 'alerts' && sub === 'schedule')) requireStore(ctx);
    if (form) { await promptForm(interaction, ctx, sub); return; }
    let body;
    if (group === 'discover') body = await discoverCommand(interaction, ctx, settings, sub);
    else if (group === 'list') body = await trackingCommand(interaction, ctx, settings, sub);
    else if (group === 'alerts') body = await alertCommand(interaction, ctx, settings, sub, member);
    else if (group === 'club') body = await communityCommand(interaction, ctx, settings, sub, member);
    else if (group === 'games') body = await gamesCommand(interaction, ctx, settings, sub, member);
    else if (group === 'admin') body = await adminCommand(interaction, client, ctx, settings, sub);
    else throw new Error('Unknown anime command. Open /anime help.');
    await interaction.editReply(body);
  });
}

export async function autocompleteAnime(interaction, client) {
  const focused = interaction.options.getFocused(true);
  if (!['anime', 'query'].includes(focused.name) || String(focused.value).trim().length < 2) return interaction.respond([]);
  let timeout;
  try {
    const work = (async () => {
      await guard(interaction, client, 'discovery', { action: 'discover search' });
      const sub = interaction.options.getSubcommand(false);
      const kind = focused.name === 'query' && sub === 'character' ? 'characters' : focused.name === 'query' && sub === 'voice' ? 'people' : 'anime';
      const result = await contextFor(client).jikan.search(kind, { q: focused.value });
      return (result.data || []).slice(0, 10).map(a => ({ name: `${a.title || a.name} · ${a.year || '?'} · MAL ${a.mal_id}`.slice(0, 100), value: focused.name === 'anime' ? String(a.mal_id) : (a.title || a.name).slice(0, 100) }));
    })();
    const options = await Promise.race([work, new Promise(resolve => { timeout = setTimeout(() => resolve([]), 1800); })]);
    await interaction.respond(options);
  } catch { await interaction.respond([]).catch(() => {}); }
  finally { clearTimeout(timeout); }
}

async function revealReview(interaction, ctx, session, reviewId, confirmed = false) {
  const review = (await ctx.community.guild(interaction.guildId)).reviews.find(r => r.id === reviewId);
  if (!review) throw new Error('This review was removed or replaced.');
  const profile = await ctx.tracking.profile(interaction.user.id);
  const result = readReview(review, profile, confirmed);
  if (result.warning) {
    const id = await ctx.store.session({ ownerId: interaction.user.id, guildId: interaction.guildId, kind: 'spoiler', module: 'community', reviewId });
    return message('Spoiler warning · private reveal', `This review covers episode **${result.episode}**. Your recorded progress is **${result.progress}**. It may contain spoilers beyond your progress. Reveal only if you want to read it.`, [row(uiButton('Reveal review privately', id, 'reveal', 4))]);
  }
  return message(`Private review reveal · Episode ${review.episode}`, `${text(result.text, 1800)}\n\n${review.rating}/10 · <@${review.userId}> · Recorded progress ${profile.list[review.animeId]?.progress || 0}`);
}

export async function handleAnimeComponent(interaction, client, args) {
  return safely(interaction, async () => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ctx = contextFor(client); requireStore(ctx);
    const [id, action] = args;
    const session = validateSession(await ctx.store.read('session', id), interaction.user.id, interaction.guildId);
    const { settings } = await guard(interaction, client, session.module);
    let body;
    if (session.kind === 'detail') {
      if (action === 'plan' || action === 'increment') {
        await guard(interaction, client, 'tracking', { action: `list ${action === 'plan' ? 'add' : 'progress'}` });
        if (action === 'plan') await ctx.tracking.add(interaction.user.id, session.animeId);
        else await ctx.tracking.increment(interaction.user.id, session.animeId);
        body = message('Watchlist updated', 'Your private watchlist was updated.');
      } else if (action === 'follow') body = await followFromButton(interaction, client, ctx, session.animeId);
      else if (action === 'synopsis') {
        await guard(interaction, client, 'discovery', { action: 'discover detail' });
        const anime = await ctx.jikan.anime(session.animeId);
        body = message('Synopsis · may contain story spoilers', text(anime.synopsis || 'Synopsis unknown.', 3000));
      }
    } else if (session.kind === 'watchlist') {
      await guard(interaction, client, 'tracking', { action: action?.startsWith('inc-') ? 'list progress' : 'list show' });
      if (action?.startsWith('inc-')) {
        const anime = animeId(action.slice(4));
        if (!session.ids.includes(anime)) throw new Error('This anime is not part of this control.');
        await ctx.tracking.increment(interaction.user.id, anime);
        body = await watchlistPage(ctx, interaction.user.id, interaction.guildId, session.status, session.page);
      } else if (['next', 'previous'].includes(action)) body = await watchlistPage(ctx, interaction.user.id, interaction.guildId, session.status, Math.max(0, session.page + (action === 'next' ? 1 : -1)));
    } else if (['anime', 'characters', 'people'].includes(session.kind)) {
      await guard(interaction, client, 'discovery', { action: 'discover search' });
      if (action === 'select') {
        const selected = animeId(interaction.values?.[0]);
        if (!session.ids.includes(selected)) throw new Error('Choose a result belonging to this search.');
        body = session.kind === 'anime' ? await detailView(ctx, selected, interaction.user.id, interaction.guildId, settings) : await personView(ctx, session.kind, selected);
      } else if (['next', 'previous'].includes(action) && !session.results) body = await searchPage(ctx, { ...session, page: Math.max(1, session.page + (action === 'next' ? 1 : -1)) });
    } else if (session.kind === 'schedule' && ['next', 'previous'].includes(action)) {
      await guard(interaction, client, 'announcements', { action: 'alerts schedule' });
      body = await schedulePage(ctx, { ...session, page: Math.max(0, Math.min(Math.ceil(session.entries.length / 10) - 1, session.page + (action === 'next' ? 1 : -1))) });
    } else if (session.kind === 'reviews') {
      await guard(interaction, client, 'community', { action: 'club reviews' });
      if (action?.startsWith('review-') && session.reviewIds.includes(action.slice(7))) body = await revealReview(interaction, ctx, session, action.slice(7));
      else if (['next', 'previous'].includes(action)) body = await reviewsView(ctx, interaction.guildId, interaction.user.id, session.animeId, Math.max(0, session.page + (action === 'next' ? 1 : -1)));
    } else if (session.kind === 'spoiler' && action === 'reveal') {
      await guard(interaction, client, 'community', { action: 'club reviews' });
      body = await revealReview(interaction, ctx, session, session.reviewId, true);
    } else if (session.kind === 'delete' && action === 'confirm') {
      await guard(interaction, client, 'tracking', { action: 'list delete' });
      const unavailable = await eraseUserData(ctx, client, interaction.user.id);
      body = message('Anime data deleted', `Your anime data and subscriptions were removed from the database.${unavailable ? ` ${unavailable} Discord posts could not be refreshed or removed because their server/channel or permissions were unavailable. Ask a server administrator to remove those copies.` : ''} Backup copies expire under the operator’s retention policy.`);
    }
    if (!body) throw new Error('This control is unavailable. Run the command again.');
    await interaction.editReply(body);
  });
}

async function followFromButton(interaction, client, ctx, id) {
  const { settings, member } = await guard(interaction, client, 'announcements', { action: 'alerts follow' });
  const source = interaction.options;
  interaction.options = { getString: name => name === 'anime' ? String(id) : name === 'type' ? 'all' : null, getBoolean: () => false, getRole: () => null };
  try { return await alertCommand(interaction, ctx, settings, 'follow', member); }
  finally { interaction.options = source; }
}

export async function handleAnimeForm(interaction, client, args) {
  return safely(interaction, async () => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ctx = contextFor(client); requireStore(ctx);
    const session = validateSession(await ctx.store.read('session', args[0]), interaction.user.id, interaction.guildId);
    if (!['note', 'review'].includes(session.kind) || session.kind !== args[1]) throw new Error('Invalid anime form.');
    await guard(interaction, client, session.module, { action: session.kind === 'note' ? 'list note' : 'club review' });
    const value = interaction.fields.getTextInputValue('text').trim();
    if (session.kind === 'note') await ctx.tracking.note(interaction.user.id, session.animeId, session.episode, value);
    else {
      await publishChannel(interaction);
      const anime = await ctx.jikan.anime(session.animeId);
      if (anime.episodes && session.episode > anime.episodes) throw new Error('Review episode exceeds the known episode count.');
      await ctx.community.review(interaction.guildId, interaction.user.id, { animeId: session.animeId, title: anime.title, episode: session.episode, rating: session.rating, spoiler: session.spoiler, text: value });
    }
    await ctx.store.remove('session', args[0]);
    await interaction.editReply(message(session.kind === 'note' ? 'Private note saved' : 'Review published', session.kind === 'note' ? (value ? 'Your note is private and stored in PostgreSQL.' : 'This episode note was deleted.') : 'Your rating and episode context are visible in /anime club reviews. Review content is revealed privately with spoiler warnings.'));
  });
}

export async function handleAnimePublic(interaction, client, args) {
  return safely(interaction, async () => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [kind, id, value, match, choice] = args;
    const { settings, member } = await guard(interaction, client, kind === 'game' || kind === 'tournament' ? 'games' : 'community');
    const ctx = contextFor(client); requireStore(ctx);
    const guildId = interaction.guildId, userId = interaction.user.id;
    const state = await ctx.community.guild(guildId);
    const kinds = { party: 'parties', poll: 'polls', tournament: 'tournaments', game: 'games', hub: 'hubs' };
    const collection = kinds[kind];
    const key = kind === 'hub' ? `${interaction.channelId}:${id}` : id;
    const item = state[collection]?.[key];
    if (!item || item.messageId !== interaction.message?.id || item.channelId !== interaction.channelId) throw new Error('This community control has expired or its message was replaced.');
    let body;
    if (kind === 'party') { await guard(interaction, client, 'community', { action: 'club party' }); await ctx.community.rsvp(guildId, id, userId, value); body = message('RSVP saved', value === 'yes' ? 'You are going and opted into this party’s private reminder DMs.' : 'Your RSVP is saved; party reminder DMs are disabled for you.'); }
    else if (kind === 'poll') { await guard(interaction, client, 'community', { action: 'club poll' }); await ctx.community.pollVote(guildId, id, userId, Number(interaction.values?.[0])); body = message('Vote saved', 'Your vote was stored. Choosing again changes your vote.'); }
    else if (kind === 'tournament') { await guard(interaction, client, 'games', { action: 'games tournament' }); await ctx.community.tournamentVote(guildId, id, userId, Number(value), Number(match), Number(choice)); body = message('Vote saved', 'Your vote for the current match was stored.'); }
    else if (kind === 'game') { await guard(interaction, client, 'games', { action: 'games reveal' }); await ctx.community.reveal(guildId, id, userId, member.permissions.has(PermissionFlagsBits.ManageGuild)); body = message('Clue revealed', 'The game message now shows the next reveal stage.'); }
    else if (kind === 'hub') {
      if (value === 'plan') { await guard(interaction, client, 'tracking', { action: 'list add' }); await ctx.tracking.add(userId, animeId(id)); body = message('Added to your watchlist', 'This anime is now privately planned.'); }
      else if (value === 'follow') body = await followFromButton(interaction, client, ctx, animeId(id));
      else if (value === 'reviews') { await guard(interaction, client, 'community', { action: 'club reviews' }); body = await reviewsView(ctx, guildId, userId, animeId(id)); }
      else if (value === 'discussions') body = message('Episode discussion links · spoilers', Object.values(state.discussions).filter(d => d.animeId === Number(id)).map(d => `[Episode ${d.episode}](https://discord.com/channels/${guildId}/${d.threadId})`).join('\n') || 'No threads yet. Create one with /anime club discuss. Ordinary threads do not enforce individual spoiler access.');
    }
    if (!body) throw new Error('Unknown community action.');
    if (kind !== 'hub') {
      try { await refreshPublication(ctx, interaction.guild, collection, key, settings); }
      catch { body.embeds[0].addFields({ name: 'Message refresh unavailable', value: 'Your change is saved. The bot could not edit the public message; an administrator can check channel permissions.' }); }
    }
    await interaction.editReply(body);
  });
}
