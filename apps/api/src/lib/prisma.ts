import { PrismaClient } from '@prisma/client';
import { installLiveUpdates } from '@dem/shared';

// Reuse the same client instance across hot-reloads in development.
// In production there is only one instance anyway.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function makeClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
  // Watched writes tell open pages what changed (v1.30.0, lib/live.ts).
  installLiveUpdates(client);
  return client;
}

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
