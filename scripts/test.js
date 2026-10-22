import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
// These inert values satisfy import-time configuration validation. Tests never
// log in to Discord and use a separate database fixture.
const env = { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'error', DISCORD_TOKEN: 'test-token-no-login', CLIENT_ID: '100000000000000001' };
const files = readdirSync('test').filter(name => name.endsWith('.test.js')).map(name => `test/${name}`);
const result = spawnSync(process.execPath, ['--test', ...files], { env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
