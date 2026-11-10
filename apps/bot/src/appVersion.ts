import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// The ASOP version lives in the monorepo root package.json (see CLAUDE.md,
// "Versioning"). src/ and dist/ are both three levels below the root.
function readVersion(): string {
  try {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../../package.json');
    return (JSON.parse(readFileSync(path, 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const APP_VERSION = readVersion();
/** Railway sets this on every deploy; empty when running locally. */
export const APP_COMMIT = (process.env['RAILWAY_GIT_COMMIT_SHA'] ?? '').slice(0, 7);
