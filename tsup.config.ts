import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Bundled into dist, so browser-toolset stays a dev dependency and installing
  // this package pulls in nothing more.
  noExternal: ['@stuntkit/browser-toolset'],
  onSuccess: async () => {
    await copyFile('src/ui.html', 'dist/ui.html');
    await copyFile('src/studio.js', 'dist/studio.js');
  },
});
