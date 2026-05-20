import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// __dirname = apps/api/src/__tests__  →  ../../  =  apps/api
const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TEST_DB = resolve(API_DIR, 'prisma/test.db');
export const TEST_DB_URL = `file:${TEST_DB}`;

export async function setup() {
  // Always start from a clean slate
  for (const f of [TEST_DB, `${TEST_DB}-journal`, `${TEST_DB}-shm`, `${TEST_DB}-wal`]) {
    if (existsSync(f)) rmSync(f);
  }

  console.log('[test] Creating test database at', TEST_DB);
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'inherit',
    cwd: API_DIR,
  });
  console.log('[test] Test database ready');
}

export async function teardown() {
  for (const f of [TEST_DB, `${TEST_DB}-journal`, `${TEST_DB}-shm`, `${TEST_DB}-wal`]) {
    if (existsSync(f)) rmSync(f);
  }
}
