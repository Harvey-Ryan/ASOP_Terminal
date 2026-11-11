import { createHash } from 'node:crypto';
import { REST, Routes } from 'discord.js';
import { client } from '../client.js';
import { prisma } from '../db.js';
import * as eventCommand from '../commands/event.js';
import * as loginCommand from '../commands/login.js';
import * as lootCommand from '../commands/loot.js';
import * as bidCommand from '../commands/bid.js';
import * as walletCommand from '../commands/wallet.js';
import * as itemCommand from '../commands/item.js';
import * as whohasCommand from '../commands/whohas.js';
import * as blueprintCommand from '../commands/blueprint.js';
import * as materialCommand from '../commands/material.js';
import * as fleetCommand from '../commands/fleet.js';
import * as helpCommand from '../commands/help.js';
import * as marketplaceCommand from '../commands/marketplace.js';

const body = [eventCommand.data.toJSON(), loginCommand.data.toJSON(), lootCommand.data.toJSON(), bidCommand.data.toJSON(), walletCommand.data.toJSON(), itemCommand.data.toJSON(), whohasCommand.data.toJSON(), blueprintCommand.data.toJSON(), materialCommand.data.toJSON(), fleetCommand.data.toJSON(), helpCommand.data.toJSON(), marketplaceCommand.data.toJSON()];

/** What was last registered, saved in BotConfig.commandRegistration. */
interface Registration { hash: string; guilds: string[]; global: boolean }

export const commandsHash = (): string => createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);

/** Which registrations a run needs: changed commands or `force` → everything; otherwise only servers not yet registered. */
export function registrationPlan(prev: Registration | null, hash: string, guildIds: readonly string[], globalEnabled: boolean, force: boolean) {
  const fresh = force || !prev || prev.hash !== hash;
  const known = new Set(fresh ? [] : prev!.guilds);
  return {
    guilds: guildIds.filter((g) => !known.has(g)),
    global: fresh || prev!.global !== globalEnabled,
  };
}

/**
 * Registers the slash commands per server (instant) and globally. v1.11.1:
 * a restart only sends what changed — new commands, a server not registered
 * yet, or the global setting flipped. `force` (the settings page's button or
 * the global toggle) re-sends everything.
 */
export async function registerCommands(clientId?: string, opts: { force?: boolean } = {}): Promise<void> {
  const token = process.env['DISCORD_TOKEN'];
  if (!token) return;

  const resolvedClientId = clientId ?? client.user?.id;
  if (!resolvedClientId) {
    console.error('[bot] registerCommands: client not ready, no clientId available');
    return;
  }

  const rest = new REST().setToken(token);
  const config = await prisma.botConfig.findUnique({ where: { id: 1 } });
  const globalEnabled = config?.globalCommandsEnabled ?? true;
  let prev: Registration | null = null;
  try { prev = config?.commandRegistration ? JSON.parse(config.commandRegistration) as Registration : null; } catch { prev = null; }

  const hash = commandsHash();
  const guildIds = [...client.guilds.cache.keys()];
  const plan = registrationPlan(prev, hash, guildIds, globalEnabled, !!opts.force);
  const keep = prev && prev.hash === hash && !opts.force ? prev.guilds.filter((g) => guildIds.includes(g)) : [];
  const registered = new Set(keep);

  let guildSuccesses = 0;
  for (const guildId of plan.guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(resolvedClientId, guildId), { body });
      registered.add(guildId);
      guildSuccesses++;
    } catch (err) {
      console.error(`[bot] Failed to register commands for guild ${guildId}:`, err);
    }
  }
  if (guildSuccesses > 0) console.log(`[bot] Slash commands registered instantly to ${guildSuccesses} guild(s)`);

  let globalDone = prev?.global ?? globalEnabled;
  if (plan.global) {
    try {
      await rest.put(Routes.applicationCommands(resolvedClientId), { body: globalEnabled ? body : [] });
      globalDone = globalEnabled;
      console.log(globalEnabled ? '[bot] Global slash commands registered' : '[bot] Global slash commands cleared (disabled)');
    } catch (err) {
      console.error(`[bot] Failed to ${globalEnabled ? 'register' : 'clear'} global commands:`, err);
    }
  }
  if (plan.guilds.length === 0 && !plan.global) {
    console.log(`[bot] Slash commands unchanged (${hash}); nothing sent to Discord`);
    return;
  }

  const next: Registration = { hash, guilds: [...registered], global: globalDone };
  // A failed global call leaves the old global state, so the next run tries again.
  if (plan.global && globalDone !== globalEnabled) next.hash = prev?.hash ?? '';
  await prisma.botConfig.upsert({
    where: { id: 1 },
    create: { id: 1, commandRegistration: JSON.stringify(next) },
    update: { commandRegistration: JSON.stringify(next) },
  });
}
