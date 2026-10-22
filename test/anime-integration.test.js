import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import loadInteractions from '../src/handlers/loaders/interactions.js';
import { normalizeGuildConfig, validateGuildConfigOrThrow } from '../src/utils/schemas.js';
import { GUILD_CONFIG_DEFAULTS } from '../src/config/guild/guildConfigDefaults.js';
import { redactSecrets } from '../src/utils/redactSecrets.js';

test('Hikari loads anime and essential commands while retiring unrelated legacy commands', async () => {
  const client = { buttons: new Collection(), selectMenus: new Collection(), modals: new Collection() };
  await loadCommands(client); await loadInteractions(client);
  for (const name of ['anime', 'help', 'commands', 'configwizard', 'play', 'music', 'ban', 'unban', 'timeout', 'untimeout', 'cases', 'reactroles', 'greet', 'logging', 'report']) assert.ok(client.commands.has(name), `${name} did not load`);
  for (const name of ['balance', 'gamble', 'slut', 'birthday', 'ticket', 'massban', 'masskick', 'generatepassword', 'leaderboard', 'gcreate']) assert.equal(client.commands.has(name), false, `${name} should be retired`);
  const names = new Set([...client.commands.values()].map(c => c.data.name));
  assert.equal(names.size, 29);
  assert.ok(client.buttons.has('anime_ui')); assert.ok(client.selectMenus.has('anime_public')); assert.ok(client.modals.has('anime_form'));
  for (const command of new Set(client.commands.values())) command.data.toJSON();
});

test('old guild configurations gain validated anime defaults without losing existing settings', () => {
  const config = normalizeGuildConfig({ prefix: '?', economy: { enabled: true }, anime: { language: 'romaji' } }, GUILD_CONFIG_DEFAULTS);
  assert.equal(config.prefix, '?'); assert.equal(config.economy.enabled, true);
  assert.equal(config.anime.timezone, 'Asia/Jerusalem'); assert.equal(config.anime.language, 'romaji');
  assert.throws(() => validateGuildConfigOrThrow({ anime: { timezone: 'Bad/Zone' } }), /Invalid guild/);
});

test('structured logs redact tokens, passwords, credentials in URLs and nested error stacks', () => {
  const input = { token: 'abc', nested: { Authorization: 'Bearer tokenvalue', url: 'postgresql://admin:password@db/test', stack: 'failed Bearer tokenvalue' } };
  const result = redactSecrets(input);
  assert.equal(JSON.stringify(result).includes('password@'), false);
  assert.equal(result.token, '[REDACTED]');
  assert.equal(JSON.stringify(result).includes('tokenvalue'), false);
});
