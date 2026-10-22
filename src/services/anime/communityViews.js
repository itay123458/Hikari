import { PermissionFlagsBits } from 'discord.js';
import { sendableChannel } from './access.js';
import { animeCard, button, row, text, message, timestamp, uiButton, partyView, pollView, tournamentView, gameView } from './views.js';
import { resolveMapping } from './providers.js';

export async function publishChannel(interaction) {
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
  const channel = await sendableChannel(interaction.guild, interaction.channelId);
  if (!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) throw new Error('You need View Channel and Send Messages to publish here.');
  return channel;
}
export async function hubView(ctx, guildId, channelId, id, settings) {
  const anime = await ctx.jikan.anime(id);
  const state = await ctx.community.guild(guildId);
  const body = animeCard(anime, { ...settings, hideSpoilers: true }, anime.streaming || []);
  const reviews = state.reviews.filter(r => r.animeId === Number(id));
  body.embeds[0].addFields({ name: 'Server rating', value: reviews.length ? `${(reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)}/10 · ${reviews.length} public reviews` : 'No public ratings yet.' });
  let timing = 'Unknown. No verified schedule currently available.';
  try {
    const mapping = await resolveMapping(ctx.store, ctx.schedule, guildId, id);
    if (mapping) {
      const entries = (await ctx.schedule.timetable()).filter(e => e.route === mapping.route && (!e.at || Date.parse(e.at) >= Date.now())).slice(0, 3);
      if (entries.length) timing = entries.map(e => `${e.type} · Ep ${e.episode || '?'} · ${timestamp(e.at)}${e.delay ? ` · ${text(e.delay, 120)}` : ''}`).join('\n');
    }
  } catch { /* show unknown instead of a guessed schedule */ }
  body.embeds[0].addFields({ name: 'Schedule · not streaming publication', value: timing.slice(0, 1000) });
  const discussions = Object.values(state.discussions).filter(d => d.animeId === Number(id)).slice(-5);
  if (discussions.length) body.embeds[0].addFields({ name: 'Spoiler-labeled public discussions', value: discussions.map(d => `[Episode ${d.episode}](https://discord.com/channels/${guildId}/${d.threadId})`).join('\n') });
  body.components.push(row(button('Plan to watch', `anime_public:hub:${id}:plan`, 1), button('Follow releases', `anime_public:hub:${id}:follow`), button('Read reviews', `anime_public:hub:${id}:reviews`), button('Discussion links', `anime_public:hub:${id}:discussions`)));
  return body;
}
export async function reviewsView(ctx, guildId, userId, id, page = 0) {
  const state = await ctx.community.guild(guildId);
  const reviews = state.reviews.filter(r => r.animeId === Number(id));
  const visible = reviews.slice(page * 5, page * 5 + 5);
  const body = message(`Public review metadata · Page ${page + 1}`, visible.map((r, i) => `${i + 1}. **${r.rating}/10** · Through episode **${r.episode}** · <@${r.userId}>\n${r.spoiler ? 'Spoiler review; content hidden.' : 'Content is revealed privately after checking episode context.'}`).join('\n\n') || 'No public reviews yet. Use /anime club review to explicitly publish one.');
  const session = await ctx.store.session({ ownerId: userId, guildId, kind: 'reviews', module: 'community', animeId: Number(id), reviewIds: visible.map(r => r.id), page });
  if (visible.length) body.components.push(row(visible.map((r, i) => uiButton(`Read review ${i + 1}`, session, `review-${r.id}`))));
  const nav = [];
  if (page > 0) nav.push(uiButton('Previous page', session, 'previous'));
  if ((page + 1) * 5 < reviews.length) nav.push(uiButton('Next page', session, 'next'));
  if (nav.length) body.components.push(row(nav));
  return body;
}
const publicationQueues = new Map();
export async function refreshPublication(ctx, guild, kind, id, settings) {
  const key = `${guild.id}:${kind}:${id}`;
  const task = (publicationQueues.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const state = await ctx.community.guild(guild.id);
    const item = state[kind]?.[id];
    if (!item?.messageId || !item.channelId) return;
    const channel = await sendableChannel(guild, item.channelId);
    const msg = await channel.messages.fetch(item.messageId).catch(() => null);
    if (!msg) return;
    const views = { parties: partyView, polls: pollView, tournaments: tournamentView, games: gameView };
    const body = kind === 'hubs' ? await hubView(ctx, guild.id, item.channelId, item.animeId, settings) : await views[kind](item);
    await msg.edit({ ...body, attachments: [] });
  });
  publicationQueues.set(key, task);
  try { await task; } finally { if (publicationQueues.get(key) === task) publicationQueues.delete(key); }
}

export async function eraseUserData(ctx, client, userId) {
  const affected = await ctx.store.eraseUser(userId);
  let unavailable = 0;
  for (const item of affected) {
    try {
      const guild = client.guilds.cache.get(item.guildId);
      if (!guild) { unavailable++; continue; }
      if (item.remove) {
        const channel = await sendableChannel(guild, item.channelId);
        const msg = await channel.messages.fetch(item.messageId).catch(() => null);
        if (msg) await msg.delete();
      } else await refreshPublication(ctx, guild, item.kind, item.id, {});
    } catch { unavailable++; }
  }
  return unavailable;
}
