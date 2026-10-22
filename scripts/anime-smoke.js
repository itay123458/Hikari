import 'dotenv/config';
import { providers } from '../src/services/anime/providers.js';
const { jikan, schedule } = providers;
try {
  const anime = await jikan.anime(1);
  if (anime?.mal_id !== 1) throw new Error('Unexpected canonical ID');
  console.log(`Jikan detail: MAL ${anime.mal_id}; title received; relations ${anime.relations?.length || 0}; streaming links ${anime.streaming?.length || 0}.`);
  const found = await jikan.search('anime', { q: 'Cowboy Bebop' });
  console.log(`Jikan search: ${found.data?.length || 0} actual provider results.`);
  const characters = await jikan.resource(1, 'characters');
  console.log(`Jikan anime characters: ${characters?.length || 0} actual credits.`);
  if (!schedule.token) console.log('AnimeSchedule authenticated checks NOT RUN: ANIMESCHEDULE_TOKEN is absent.');
  else {
    const rows = await schedule.timetable('all');
    console.log(`AnimeSchedule: ${rows.length} actual timetable entries; ${new Set(rows.map(r => r.type)).size} release tracks.`);
    const mapping = await schedule.resolve(21);
    console.log(`AnimeSchedule exact mapping check: ${mapping?.route || 'unknown'}.`);
  }
  console.log('Crunchyroll direct access NOT USED: provider links only; publication, languages and regions unknown.');
} catch (error) {
  console.error(`Provider smoke check failed: ${error.name || 'Error'} (${error.status || 'network/schema'}). No credentials logged.`);
  process.exitCode = 1;
}
