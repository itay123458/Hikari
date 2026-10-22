import { handleAnimeComponent, handleAnimePublic } from '../../../services/anime/controller.js';
export default [
  { name: 'anime_ui', execute: handleAnimeComponent },
  { name: 'anime_public', execute: handleAnimePublic },
];
