/**
 * Tournament lifecycle smoke test.
 *
 * Walks through a complete tournament end-to-end against a live dev/staging
 * API, pausing 30 seconds between each stage so Discord output can be
 * observed in real time.
 *
 * WHAT TO WATCH FOR IN DISCORD:
 *   Stage 1 — Draft forum thread appears with a "Coming Soon" embed
 *   Stage 2 — Thread renamed; registration embed posted with Join button
 *   Stage 3 — Registration embed updates after each participant is added
 *   Stage 4 — "🔒 Registration closed" message → bracket image → Round 1 match cards
 *   Stage 5+ — Per-match: result card → bracket refresh → next-round match card (if applicable)
 *   Final   — 🏆 Champion announcement
 *
 * HOW TO RUN:
 *   cd apps/api
 *   SCRIPT_API_URL=http://localhost:3001 \
 *   SCRIPT_GUILD_ID=<discord-guild-snowflake> \
 *   SCRIPT_USER_ID=<internal-db-user-id> \
 *   npx tsx scripts/tournament-test.ts
 *
 * REQUIREMENTS:
 *   - API dev server running (NODE_ENV != production so /test/login is available)
 *   - Bot running and connected to Discord
 *   - Guild has a tournament or forum channel configured in GuildSettings
 */

import 'dotenv/config';

// ── Config ────────────────────────────────────────────────────────────────────

const API   = (process.env['SCRIPT_API_URL'] ?? 'http://localhost:3001').replace(/\/$/, '');
const GUILD = process.env['SCRIPT_GUILD_ID'] ?? '';
const USER  = process.env['SCRIPT_USER_ID']  ?? '';
const DELAY = 30_000; // ms between stages

// Four participants → clean 2-round bracket, no BYEs
const PARTICIPANTS = ['Alice', 'Bob', 'Charlie', 'Diana'];

if (!GUILD || !USER) {
  console.error('❌  SCRIPT_GUILD_ID and SCRIPT_USER_ID are required.');
  process.exit(1);
}

// ── HTTP client with cookie jar ───────────────────────────────────────────────

let cookies = '';

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const raw = res.headers.get('set-cookie');
  if (raw) {
    // Collapse multi-value Set-Cookie into a single Cookie header (name=value only)
    cookies = raw.split(/,(?=[^ ].*?=)/)
      .map(c => c.trim().split(';')[0]!)
      .join('; ');
  }

  const data = await res.json().catch(() => null);
  return { status: res.status, data: data as Record<string, unknown> };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

function hr(label: string) {
  const line = '─'.repeat(64);
  console.log(`\n${line}\n  ${label}\n${line}`);
}

function ok(msg: string)   { console.log(`  ✅  ${msg}`); }
function info(msg: string) { console.log(`  ℹ️   ${msg}`); }

async function must<T>(result: Awaited<ReturnType<typeof api>>, label: string): Promise<T> {
  if (result.status < 200 || result.status >= 300) {
    console.error(`  ❌  ${label} → HTTP ${result.status}`, JSON.stringify(result.data, null, 2));
    process.exit(1);
  }
  ok(label);
  return (result.data as { data: T }).data;
}

async function countdown(seconds: number) {
  process.stdout.write(`  ⏳  Next stage in: `);
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(`${i}s… `);
    await sleep(1000);
  }
  process.stdout.write('\n');
}

type Match = {
  id: string;
  round: number;
  position: number;
  status: string;
  participantAId: string | null;
  participantBId: string | null;
};

type TournamentDetail = {
  id: string;
  name: string;
  status: string;
  matches: Match[];
  participants: Array<{ id: string; displayName: string }>;
};

async function fetchDetail(tournamentId: string): Promise<TournamentDetail> {
  return must<TournamentDetail>(
    await api('GET', `/api/guilds/${GUILD}/tournaments/${tournamentId}`),
    'Fetched tournament detail',
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🏆  Tournament Lifecycle Smoke Test');
  console.log(`    API:         ${API}`);
  console.log(`    Guild:       ${GUILD}`);
  console.log(`    User:        ${USER}`);
  console.log(`    Participants: ${PARTICIPANTS.join(', ')}`);
  console.log(`    Delay:       ${DELAY / 1000}s between stages`);

  // ── Login ──────────────────────────────────────────────────────────────────
  hr('Login');
  await must(
    await api('POST', '/test/login', { userId: USER, managedGuildIds: [GUILD] }),
    'Logged in via /test/login',
  );

  // ── Stage 1: Create tournament ─────────────────────────────────────────────
  hr('Stage 1 — Create tournament');
  info('Expected Discord: draft forum thread with "Coming Soon" embed');
  const tournament = await must<{ id: string; name: string }>(
    await api('POST', `/api/guilds/${GUILD}/tournaments`, {
      name: `Smoke Test ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      description: 'Automated smoke test — please ignore.',
      format: 'SINGLE_ELIM',
      size: PARTICIPANTS.length,
      seedingMode: 'RANDOM',
    }),
    'Tournament created',
  );
  info(`ID:   ${tournament.id}`);
  info(`Name: ${tournament.name}`);
  await countdown(DELAY / 1000);

  // ── Stage 2: Open registration ─────────────────────────────────────────────
  hr('Stage 2 — Open registration');
  info('Expected Discord: thread renamed, registration embed with Join button');
  await must(
    await api('POST', `/api/guilds/${GUILD}/tournaments/${tournament.id}/open`),
    'Registration opened',
  );
  await countdown(DELAY / 1000);

  // ── Stage 3: Register participants ─────────────────────────────────────────
  hr(`Stage 3 — Register ${PARTICIPANTS.length} participants`);
  info('Expected Discord: registration embed updates after each addition');
  for (const name of PARTICIPANTS) {
    const res = await api('POST', `/api/guilds/${GUILD}/tournaments/${tournament.id}/register`, {
      displayName: name,
    });
    if (res.status >= 200 && res.status < 300) {
      ok(`Registered: ${name}`);
    } else {
      console.error(`  ❌  Register "${name}" → HTTP ${res.status}`, res.data);
    }
    await sleep(2_500); // avoid Discord rate-limit on embed edits
  }
  await countdown(DELAY / 1000);

  // ── Stage 4: Start tournament ──────────────────────────────────────────────
  hr('Stage 4 — Start tournament (close registration + generate bracket)');
  info('Expected Discord: "🔒 Registration closed!" → bracket image → Round 1 match cards');
  await must(
    await api('POST', `/api/guilds/${GUILD}/tournaments/${tournament.id}/start`),
    'Tournament started',
  );
  await countdown(DELAY / 1000);

  // ── Stages 5+: Submit results round by round ───────────────────────────────
  let detail = await fetchDetail(tournament.id);
  const maxRound = Math.max(...detail.matches.map(m => m.round));

  for (let round = 1; round <= maxRound; round++) {
    // Re-fetch so we get the current participantAId / participantBId for this round
    // (later rounds are only populated after earlier rounds complete)
    detail = await fetchDetail(tournament.id);

    const roundMatches = detail.matches
      .filter(m => m.round === round && m.status !== 'BYE' && m.participantAId && m.participantBId)
      .sort((a, b) => a.position - b.position);

    const isLastRound = round === maxRound;
    hr(`Stage ${4 + round} — Round ${round} results (${roundMatches.length} match${roundMatches.length !== 1 ? 'es' : ''})${isLastRound ? '  →  🏆 champion' : ''}`);

    for (const match of roundMatches) {
      // Always declare participant A the winner for determinism
      const res = await api(
        'POST',
        `/api/guilds/${GUILD}/tournaments/${tournament.id}/matches/${match.id}/result`,
        { winnerId: match.participantAId, scoreA: 2, scoreB: 1 },
      );

      if (res.status >= 200 && res.status < 300) {
        ok(`Round ${round} · match ${match.position + 1}: participant A wins (2–1)`);
      } else {
        console.error(`  ❌  Result → HTTP ${res.status}`, res.data);
      }

      const moreMatchesThisRound = roundMatches.indexOf(match) < roundMatches.length - 1;
      if (moreMatchesThisRound) {
        info('Expected Discord: result card + bracket refresh');
        await countdown(DELAY / 1000);
      }
    }

    if (isLastRound) {
      info('Expected Discord: final result card + 🏆 champion announcement');
    } else {
      info(`Expected Discord: result cards, bracket refreshed, Round ${round + 1} match cards announced`);
    }
    await countdown(DELAY / 1000);
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  hr('✅  Smoke test complete');
  console.log(`\n  Tournament ID: ${tournament.id}`);
  console.log('  Full lifecycle exercised. Check Discord for all expected posts.\n');
}

main().catch(err => {
  console.error('\n❌  Unexpected error:', err);
  process.exit(1);
});
