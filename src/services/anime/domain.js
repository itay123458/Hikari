import { z } from 'zod';

export const STATUSES = ['watching', 'planned', 'completed', 'paused', 'dropped'];
export const MODULES = ['discovery', 'tracking', 'announcements', 'community', 'games'];
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid quiet hour (HH:mm).');
export const AnimeSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  modules: z.array(z.enum(MODULES)).default(MODULES),
  announcementChannel: z.string().nullable().default(null),
  newsChannel: z.string().nullable().default(null),
  scheduleChannel: z.string().nullable().default(null),
  conversationChannel: z.string().nullable().default(null),
  conversationDays: z.number().int().min(0).max(7).default(0),
  approvedRoles: z.array(z.string()).default([]),
  timezone: z.string().refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Invalid time zone.').default('Asia/Jerusalem'),
  language: z.enum(['english', 'romaji', 'japanese']).default('english'),
  hideSpoilers: z.boolean().default(true),
  quietStart: clock.nullable().default(null),
  quietEnd: clock.nullable().default(null),
  notifications: z.boolean().default(true),
  weekly: z.boolean().default(false),
  news: z.boolean().default(false),
  trailers: z.boolean().default(false),
});
export const validateSettings = input => AnimeSettingsSchema.parse(input ?? {});
export const profileDefaults = () => ({ list: {}, history: [], notes: {}, consent: {}, preferences: [], follows: {}, challenges: {}, reminderDays: 0 });
export const guildDefaults = () => ({ follows: {}, parties: {}, polls: {}, tournaments: {}, reviews: [], hubs: {}, discussions: {}, snapshots: {} });

export function animeId(value) {
  if (!/^\d{1,8}$/.test(String(value)) || Number(value) <= 0) throw new Error('Choose an anime from autocomplete or provide a positive MAL ID.');
  return Number(value);
}
export function titleOf(anime, language = 'english') {
  return (language === 'japanese' ? anime.title_japanese : language === 'english' ? anime.title_english : null) || anime.title || 'Unknown title';
}
export function episodeMinutes(duration) {
  if (!duration || /unknown/i.test(duration)) return null;
  const hours = Number(duration.match(/(\d+)\s*hr/)?.[1] ?? 0);
  const minutes = Number(duration.match(/(\d+)\s*min/)?.[1] ?? 0);
  return hours * 60 + minutes || null;
}
export function updateProgress(profile, id, progress, now = new Date()) {
  const item = profile.list?.[id];
  if (!item) throw new Error('Add this anime to your watchlist first.');
  if (!Number.isInteger(progress) || progress < 0 || (item.episodes && progress > item.episodes)) throw new Error('Episode progress is outside the known episode count.');
  const delta = progress - (item.progress || 0);
  item.progress = progress;
  item.updatedAt = now.toISOString();
  profile.history ??= [];
  if (delta > 0) profile.history.push({ animeId: Number(id), delta, minutes: item.minutes ? delta * item.minutes : null, at: now.toISOString() });
  return profile;
}
export function compareProfiles(a, b, guildId) {
  if (!a?.consent?.[guildId] || !b?.consent?.[guildId]) throw new Error('Both members must opt in with /anime list privacy in this server. Consent is required.');
  const left = Object.keys(a.list || {}), right = Object.keys(b.list || {});
  const sharedIds = left.filter(id => right.includes(id));
  const rated = sharedIds.filter(id => a.list[id].rating && b.list[id].rating);
  return {
    sharedIds,
    overlap: Math.round(100 * sharedIds.length / (new Set([...left, ...right]).size || 1)),
    ratingAgreement: rated.length ? Math.round(100 * (1 - rated.reduce((sum, id) => sum + Math.abs(a.list[id].rating - b.list[id].rating) / 9, 0) / rated.length)) : null,
  };
}
export function readReview(review, profile, confirmed) {
  const progress = profile?.list?.[review.animeId]?.progress || 0;
  if ((review.spoiler || review.episode > progress) && !confirmed) return { warning: true, episode: review.episode, progress };
  return { text: review.text, episode: review.episode, warning: false };
}
export function localDate(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function localTime(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}
export function quietUntil(settings, date = new Date()) {
  const { quietStart: start, quietEnd: end, timezone = 'Asia/Jerusalem' } = settings;
  if (!start || !end || start === end) return date;
  const inside = value => start < end ? value >= start && value < end : value >= start || value < end;
  if (!inside(localTime(date, timezone))) return date;
  // Minute iteration uses absolute time, so DST gaps and repeated hours behave
  // correctly without constructing ambiguous wall-clock dates.
  let next = Math.floor(+date / 60000) * 60000 + 60000;
  for (let i = 0; i < 26 * 60; i++, next += 60000) {
    if (!inside(localTime(new Date(next), timezone))) return new Date(next);
  }
  return new Date(+date + 86400000);
}
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return { year: d.getUTCFullYear(), week: Math.ceil((((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400000) + 1) / 7) };
}
