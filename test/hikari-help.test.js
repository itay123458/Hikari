import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { loadCommands, registerCommands } from '../src/handlers/loaders/commandLoader.js';
import { createInitialHelpMenu } from '../src/commands/Core/help.js';
import { createAllCommandsMenu, helpCategorySelectMenu } from '../src/handlers/help/helpSelectMenus.js';
import { helpBugReportButton } from '../src/handlers/help/helpButtons.js';

async function fixture() {
  const client = { user: { username: 'Hikari', displayAvatarURL: () => undefined } };
  await loadCommands(client);
  client.application = { commands: { fetch: async () => new Collection([...client.commands.keys()].map((name, index) => [name, { name, id: String(100000000000000001n + BigInt(index)) }])) } };
  return client;
}
function rendered(menu) { return JSON.stringify(menu.embeds.map(embed => embed.toJSON())); }

test('registration replaces the old catalogue with only the loaded anime essentials', async () => {
  const client = await fixture();
  const calls = [];
  client.rest = { put: async (route, { body }) => { calls.push({ route, body }); } };
  await registerCommands(client, { clientId: '100000000000000001' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.length, 29);
  assert(calls[0].body.some(command => command.name === 'anime'));
  assert(!calls[0].body.some(command => ['ticket', 'balance', 'massban'].includes(command.name)));
});

test('help navigation and every page describe the active commands rather than archived files', async () => {
  const client = await fixture();
  const initial = await createInitialHelpMenu(client);
  const rows = initial.components.map(row => row.toJSON());
  const options = rows.flatMap(row => row.components).find(component => component.type === 3).options;
  assert(options.some(option => option.value === 'Anime'));
  for (const category of ['Economy', 'Ticket', 'Tools', 'Fun', 'Leveling', 'Giveaway', 'Community', 'Birthday']) assert(!options.some(option => option.value === category), `${category} must not appear`);
  const initialText = JSON.stringify({ rows, embeds: initial.embeds.map(embed => embed.toJSON()) });
  assert(!/youtu\.be|discord\.gg|github\.com|codebymitch|TitanBot/.test(initialText));
  let report;
  await helpBugReportButton.execute({ reply: async body => { report = body; } }, client);
  assert.deepEqual(report.components, []);
  assert(JSON.stringify(report.embeds.map(embed => embed.toJSON())).includes('server owner or staff'));
  assert(!JSON.stringify(report).includes('github.com'));
  let content = '';
  const first = await createAllCommandsMenu(1, client);
  for (let page = 1; page <= first.totalPages; page++) {
    const body = await createAllCommandsMenu(page, client);
    content += rendered(body);
    for (const embed of body.embeds) {
      const json = embed.toJSON();
      assert(embed.length <= 6000);
      for (const field of json.fields || []) assert(field.value.length <= 1024);
    }
  }
  assert(content.includes('/anime discover search'));
  assert(content.includes('/music pause'));
  for (const retired of ['/balance', '/ticket', '/massban', '/generatepassword']) assert(!content.includes(retired));
  // Old help messages can still send a retired category: never re-import it.
  const oldSelection = { deferred: true, values: ['Economy'], editReply: async body => { assert(!rendered(body).includes('/balance')); } };
  await helpCategorySelectMenu.execute(oldSelection, client);
  // Anime's many nested commands must also fit Discord's embed limits.
  const animeSelection = { deferred: true, values: ['Anime'], editReply: async body => { for (const embed of body.embeds) { embed.toJSON(); assert(embed.length <= 6000); } } };
  await helpCategorySelectMenu.execute(animeSelection, client);
});
