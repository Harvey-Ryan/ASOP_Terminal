import { PrismaClient } from '@prisma/client';
import { installLiveUpdates } from '@dem/shared';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

// Writes the bot makes (bids, picks, trade replies from Discord) reach open
// pages on the website the same way the API's do (v1.30.0).
installLiveUpdates(prisma);
