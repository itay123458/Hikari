import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let count = 0, failed = false;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      count++;
      if (result.status !== 0) { failed = true; process.stderr.write(result.stderr); }
    }
  }
}
for (const directory of ['src', 'scripts', 'test']) await check(directory);
console.log(`Syntax checked ${count} JavaScript files; ${failed ? 'failed' : 'passed'}.`);
process.exitCode = failed ? 1 : 0;
