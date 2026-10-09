import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = fileURLToPath(new URL('../artifacts/source.zip', import.meta.url));
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/').replace(/\/$/, '')}`, 'archive', '--format=zip', `--output=${target}`, 'HEAD'], { cwd: root });
console.log('Clean source ZIP created: artifacts/source.zip');
