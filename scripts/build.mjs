import { build as bundle } from 'esbuild';
import { build as buildUi } from 'vite';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const brandingRoot = 'assets/branding';
const branding = JSON.parse(await readFile(join(brandingRoot, 'manifest.json'), 'utf8'));
for (const file of [branding.files.windowsIcon, branding.files.windowPng]) {
  const destination = join('apps/desktop/dist/branding', file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(brandingRoot, file), destination);
}

await buildUi({ configFile: 'apps/pos-ui/vite.config.ts', root: 'apps/pos-ui' });
const common = { bundle: true, platform: 'node', target: 'node24', sourcemap: true, logLevel: 'info' };
await bundle({ ...common, entryPoints: ['apps/desktop/src/main.ts'], outfile: 'apps/desktop/dist/main.mjs', format: 'esm', external: ['electron'] });
await bundle({ ...common, entryPoints: ['apps/desktop/src/preload.ts'], outfile: 'apps/desktop/dist/preload.cjs', format: 'cjs', external: ['electron'] });
await bundle({ ...common, entryPoints: ['apps/pi-host/src/main.ts'], outfile: 'apps/pi-host/dist/main.mjs', format: 'esm' });
