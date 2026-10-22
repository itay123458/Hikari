import { randomBytes } from 'node:crypto';
import { guildDefaults } from './domain.js';

const newId = () => randomBytes(6).toString('hex');
export function ownerOnly(item, userId, manager) {
  if (!item) throw new Error('This item no longer exists.');
  if (item.ownerId !== userId && !manager) throw new Error('Only the owner or a member with Manage Server can change this.');
}
export function futureTime(value) {
  if (!value || !/(Z|[+-]\d\d:\d\d)$/.test(value)) throw new Error('Use an ISO date with an explicit offset, for example 2026-11-01T20:00:00+02:00.');
  const date = new Date(value);
  if (Number.isNaN(+date) || +date <= Date.now() || +date > Date.now() + 366 * 86400000) throw new Error('Choose a time within the next year.');
  return date.toISOString();
}
export class Community {
  constructor(store) { this.store = store; }
  async guild(guildId) { return { ...guildDefaults(), games: {}, ...await this.store.read('guild', guildId, {}) }; }
  edit(guildId, change) { return this.store.mutate('guild', guildId, p => change({ ...guildDefaults(), games: {}, ...p }), guildDefaults()); }

  async partyCreate(guildId, ownerId, input) {
    const party = { ...input, id: newId(), ownerId, startsAt: futureTime(input.startsAt), version: 1, rsvps: {}, canceled: false };
    await this.edit(guildId, g => { g.parties[party.id] = party; return g; });
    return party;
  }
  async partyEdit(guildId, id, userId, manager, changes) {
    const state = await this.edit(guildId, g => {
      const party = g.parties[id]; ownerOnly(party, userId, manager);
      if (changes.startsAt) party.startsAt = futureTime(changes.startsAt);
      if (changes.canceled !== undefined) party.canceled = Boolean(changes.canceled);
      party.version++; return g;
    });
    return state.parties[id];
  }
  async rsvp(guildId, id, userId, response) {
    if (!['yes', 'maybe', 'no'].includes(response)) throw new Error('Invalid RSVP.');
    const state = await this.edit(guildId, g => {
      const party = g.parties[id];
      if (!party || party.canceled || Date.parse(party.startsAt) <= Date.now()) throw new Error('This party is canceled or has already started.');
      party.rsvps[userId] = response; return g;
    });
    return state.parties[id];
  }
  async pollCreate(guildId, ownerId, question, options, endsAt) {
    if (!question.trim() || question.length > 200 || options.length < 2 || options.length > 10 || options.some(o => !o.trim() || o.length > 80)) throw new Error('Use a question under 200 characters and 2–10 nonempty options under 80 characters.');
    if (!Number.isFinite(endsAt) || endsAt <= Date.now()) throw new Error('Poll closing time must be in the future.');
    const poll = { id: newId(), ownerId, question, options, endsAt, votes: {} };
    await this.edit(guildId, g => { g.polls[poll.id] = poll; return g; }); return poll;
  }
  async pollVote(guildId, id, userId, option) {
    const state = await this.edit(guildId, g => {
      const poll = g.polls[id];
      if (!poll || poll.endsAt <= Date.now()) throw new Error('This poll expired.');
      if (!Number.isInteger(option) || option < 0 || option >= poll.options.length) throw new Error('Invalid poll option.');
      poll.votes[userId] = option; return g;
    }); return state.polls[id];
  }
  async review(guildId, userId, input) {
    if (!Number.isInteger(input.episode) || input.episode < 1) throw new Error('Reviews require an episode context of at least 1.');
    if (!input.text?.trim() || input.text.length > 1800) throw new Error('Reviews must contain 1–1800 characters.');
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 10) throw new Error('Choose a rating from 1 to 10.');
    const review = { ...input, id: newId(), userId, at: new Date().toISOString(), spoiler: input.spoiler !== false };
    await this.edit(guildId, g => { g.reviews = g.reviews.filter(r => r.userId !== userId || r.animeId !== input.animeId); g.reviews.push(review); return g; });
    return review;
  }
  async tournamentCreate(guildId, ownerId, entries) {
    if (![4, 8, 16].includes(entries.length) || new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Provide 4, 8 or 16 distinct character IDs.');
    const bracket = { id: newId(), ownerId, entries, round: 0, match: 0, matches: [], winners: [], votes: {}, winner: null };
    for (let i = 0; i < entries.length; i += 2) bracket.matches.push([entries[i], entries[i + 1]]);
    await this.edit(guildId, g => { g.tournaments[bracket.id] = bracket; return g; }); return bracket;
  }
  async tournamentVote(guildId, id, userId, round, match, choice) {
    const state = await this.edit(guildId, g => {
      const bracket = g.tournaments[id];
      if (!bracket || bracket.winner || round !== bracket.round || match !== bracket.match) throw new Error('This tournament match has ended. Open the current bracket.');
      if (![0, 1].includes(choice)) throw new Error('Invalid candidate.');
      bracket.votes[`${round}:${match}`] ??= {};
      bracket.votes[`${round}:${match}`][userId] = choice; return g;
    }); return state.tournaments[id];
  }
  async tournamentAdvance(guildId, id, userId, manager) {
    const state = await this.edit(guildId, g => {
      const bracket = g.tournaments[id]; ownerOnly(bracket, userId, manager);
      if (bracket.winner) throw new Error('This tournament has ended.');
      const votes = Object.values(bracket.votes[`${bracket.round}:${bracket.match}`] || {});
      const score = [votes.filter(v => v === 0).length, votes.filter(v => v === 1).length];
      bracket.winners.push(bracket.matches[bracket.match][score[1] > score[0] ? 1 : 0]);
      if (++bracket.match === bracket.matches.length) {
        if (bracket.winners.length === 1) bracket.winner = bracket.winners[0];
        else {
          bracket.matches = [];
          for (let i = 0; i < bracket.winners.length; i += 2) bracket.matches.push([bracket.winners[i], bracket.winners[i + 1]]);
          bracket.winners = []; bracket.round++; bracket.match = 0;
        }
      }
      return g;
    }); return state.tournaments[id];
  }
  async gameCreate(guildId, ownerId, anime, mode) {
    if (!['clues', 'silhouette', 'reveal'].includes(mode)) throw new Error('Invalid game mode.');
    const game = { id: newId(), ownerId, mode, animeId: anime.mal_id, answers: [...new Set([anime.title, anime.title_english, ...(anime.titles || []).map(t => t.title)].filter(Boolean))],
      image: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || null,
      clues: [anime.year ? `Premiered in ${anime.year}` : 'Premiere year unknown', `Genres: ${(anime.genres || []).map(g => g.name).join(', ') || 'unknown'}`, `Studios: ${(anime.studios || []).map(g => g.name).join(', ') || 'unknown'}`],
      level: 0, winnerId: null, expiresAt: Date.now() + 15 * 60000, attempts: {} };
    await this.edit(guildId, g => { g.games[game.id] = game; return g; }); return game;
  }
  async reveal(guildId, id, userId, manager) {
    const state = await this.edit(guildId, g => {
      const game = g.games[id]; ownerOnly(game, userId, manager);
      if (game.winnerId || game.endedAt || game.expiresAt <= Date.now()) throw new Error('This game ended.');
      game.level = Math.min(3, game.level + 1); return g;
    }); return state.games[id];
  }
  async answer(guildId, id, userId, answer) {
    let correct = false;
    const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const state = await this.edit(guildId, g => {
      const game = g.games[id];
      if (!game || game.winnerId || game.endedAt || game.expiresAt <= Date.now()) throw new Error('This game ended.');
      if ((game.attempts[userId] || 0) > Date.now() - 3000) throw new Error('Wait three seconds before another guess.');
      game.attempts[userId] = Date.now();
      correct = game.answers.some(a => normalize(a) === normalize(answer));
      if (correct) { game.winnerId = userId; game.endedAt = new Date().toISOString(); } return g;
    }); return { correct, game: state.games[id] };
  }
}
