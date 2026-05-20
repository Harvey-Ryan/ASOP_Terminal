import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    env: {
      DATABASE_URL: 'postgresql://dem:dem_test_password@localhost:5433/dem_test',
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
