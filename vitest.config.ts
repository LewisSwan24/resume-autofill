import { realpathSync } from 'node:fs';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  server: {
    fs: {
      // A git worktree links node_modules to the main checkout, outside this root, and Vite refuses
      // to serve files from there (`?raw` icons, fonts). Allow the folder the link points to.
      allow: [searchForWorkspaceRoot(process.cwd()), realpathSync('node_modules')],
    },
  },
  test: {
    // A busy machine, not a slow test: nothing here waits this long when it works.
    testTimeout: 30_000,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
