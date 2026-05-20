import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// vitest.config.ts is at apps/api root — derive absolute DB path here so
// both globalSetup (main process) and worker forks receive the same path.
const API_DIR = dirname(fileURLToPath(import.meta.url));
const TEST_DB = resolve(API_DIR, 'prisma/test.db');

export default defineConfig({
  test: {
    environment: 'node',
    // forks = separate Node.js process per file; safest for Prisma + ESM
    pool: 'forks',
    // SQLite can't handle parallel writes from concurrent test-file workers.
    // Sequential execution eliminates locking/visibility races entirely.
    fileParallelism: false,
    env: {
      DATABASE_URL: `file:${TEST_DB}`,
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-secret-do-not-use-in-prod',
      DISCORD_TOKEN: 'test-bot-token',
      BOT_INTERNAL_URL: '',
    },
    globalSetup: ['./src/__tests__/globalSetup.ts'],
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 15000,
  },
});
