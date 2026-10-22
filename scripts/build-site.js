import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Catalogue generation never logs in. Do not read a local .env for a public build.
process.env.DISCORD_TOKEN = 'public-catalogue-no-login';
process.env.CLIENT_ID = '1562836610800685118';
process.env.LOG_LEVEL = 'error';
process.env.NODE_ENV = 'test';
const { loadCommands } = await import('../src/handlers/loaders/commandLoader.js');
const { INVITE_URL, SOURCE_URL, DASHBOARD_URL } = await import('../src/config/publicLinks.js');
const client = {};
await loadCommands(client);
if (client.commands.size !== 29) throw new Error('Unexpected active command count; review the public catalogue.');
const commands = [];
for (const command of client.commands.values()) {
  const data = command.data.toJSON();
  const add = (name, description) => commands.push({ name: '/' + name, description, category: command.category });
  const walk = (options, prefix) => {
    for (const option of options || []) {
      if (option.type === 1) add(`${prefix} ${option.name}`, option.description);
      if (option.type === 2) walk(option.options, `${prefix} ${option.name}`);
    }
  };
  add(data.name, data.description);
  walk(data.options, data.name);
}
commands.sort((a,b) => a.name.localeCompare(b.name));
await mkdir('site/data', { recursive: true });
await writeFile('site/data/catalogue.json', JSON.stringify({
  links: { invite: INVITE_URL, source: SOURCE_URL, dashboard: DASHBOARD_URL },
  topLevelCount: client.commands.size, commands,
}, null, 2) + '\n');
console.log(`Built public catalogue: ${client.commands.size} commands, ${commands.length} searchable entries.`);
// Keep primary actions usable even if JavaScript or the catalogue request fails.
const links = { invite: INVITE_URL, source: SOURCE_URL, dashboard: DASHBOARD_URL };
const html = await readFile('site/index.html', 'utf8');
await writeFile('site/index.html', html.replace(/<a\b[^>]*\bdata-link="(invite|source|dashboard)"[^>]*>/g, (tag, key) => {
  const clean = tag.replace(/\s(?:href|target|rel)="[^"]*"/g, '');
  return clean.slice(0,-1) + ` href="${links[key].replaceAll('&','&amp;')}" target="_blank" rel="noopener noreferrer">`;
}));
