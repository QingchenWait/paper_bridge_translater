import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(path);
    else if (/\.m?js$/.test(path)) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0) {
        console.error(result.error || result.stderr);
        process.exitCode = 1;
      }
    }
  }
}
await walk('src/js');
await walk('tools');
if (!process.exitCode) console.log('All JavaScript syntax checks passed.');
