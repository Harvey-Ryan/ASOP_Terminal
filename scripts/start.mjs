// Starts ASOP in its container (the main Dockerfile's CMD), v1.59.1.
//
// 1. Refuses to start without the app's own secrets: a Railway service pointed
//    at this Dockerfile by mistake has none, and `prisma db push
//    --accept-data-loss` must never run from it.
// 2. Brings the database schema up to date, before any app code runs (the bot
//    used to start alongside it, on the old schema).
// 3. Runs the bot and the API side by side. If either one stops, the other is
//    stopped too and the container exits with an error, so Railway restarts
//    the whole thing. (Before, a crashed bot stayed down while the website
//    kept running.)
//
// Plain Node, no dependencies: it runs from /app with the built apps.

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps/api');
const log = (msg) => console.log(`[startup] ${msg}`);

if (!process.env.DISCORD_TOKEN || !process.env.SESSION_SECRET) {
  console.error(
    '[startup] DISCORD_TOKEN or SESSION_SECRET is not set: refusing to start and leaving the database untouched. Is this service using the wrong Dockerfile?',
  );
  process.exit(1);
}

log('Updating the database schema (prisma db push)…');
const push = spawnSync('npx', ['prisma', 'db', 'push', '--accept-data-loss'], { cwd: apiDir, stdio: 'inherit' });
if (push.status !== 0) {
  console.error(`[startup] prisma db push failed (exit ${push.status ?? push.signal}); not starting.`);
  process.exit(1);
}

let stopping = false;
const children = new Map();

function start(name, args, cwd, stopSignal) {
  const child = spawn('node', args, { cwd, stdio: 'inherit' });
  children.set(name, { child, stopSignal });
  child.on('exit', (code, signal) => {
    children.delete(name);
    if (stopping) {
      if (children.size === 0) process.exit(process.exitCode ?? 0);
      return;
    }
    console.error(
      `[startup] ${name} stopped (${signal ?? `exit ${code}`}); stopping the container so Railway restarts it.`,
    );
    stopAll(1);
  });
  return child;
}

function stopAll(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  if (children.size === 0) process.exit(exitCode);
  for (const { child, stopSignal } of children.values()) child.kill(stopSignal);
  // Don't hang if something ignores the signal.
  setTimeout(() => process.exit(exitCode), 10_000).unref();
}

// The bot saves its pending error records on SIGINT; the API on SIGTERM.
start('bot', [path.join(root, 'apps/bot/dist/index.js')], root, 'SIGINT');
start('API', ['dist/index.js'], apiDir, 'SIGTERM');

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log(`${signal} received, stopping the bot and the API…`);
    stopAll(0);
  });
}
