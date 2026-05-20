import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEST_DB_URL = 'postgresql://dem:dem_test_password@localhost:5433/dem_test';

export async function setup() {
  console.log('[test] Applying migrations to test database...');
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'inherit',
    cwd: API_DIR,
  });
  console.log('[test] Test database ready');
}

export async function teardown() {
  // Postgres test DB is persistent; nothing to clean up between runs
}
