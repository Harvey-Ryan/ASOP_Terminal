import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEST_DB_URL = 'postgresql://dem:dem_test_password@localhost:5433/dem_test';

// The test database gets its tables from schema.prisma, the way production does
// (the Dockerfile runs `prisma db push` on start). The migrations folder stopped
// being kept up to date at v1.21.0, so `migrate deploy` would test an old schema.
export async function setup() {
  console.log('[test] Bringing the test database in line with schema.prisma...');
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'inherit',
    cwd: API_DIR,
  });
  console.log('[test] Test database ready');
}

export async function teardown() {
  // Postgres test DB is persistent; nothing to clean up between runs
}
