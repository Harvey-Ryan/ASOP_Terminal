import { REST, Routes } from 'discord.js';
import { client } from '../client.js';
import { prisma } from '../db.js';
import * as eventCommand from '../commands/event.js';
import * as loginCommand from '../commands/login.js';
import * as lootCommand from '../commands/loot.js';
import * as bidCommand from '../commands/bid.js';
import * as walletCommand from '../commands/wallet.js';
import * as uexCommand from '../commands/uex.js';
import * as whohasCommand from '../commands/whohas.js';
import * as blueprintCommand from '../commands/blueprint.js';
import * as materialCommand from '../commands/material.js';
import * as fleetCommand from '../commands/fleet.js';
import * as helpCommand from '../commands/help.js';
import * as marketplaceCommand from '../commands/marketplace.js';

const body = [eventCommand.data.toJSON(), loginCommand.data.toJSON(), lootCommand.data.toJSON(), bidCommand.data.toJSON(), walletCommand.data.toJSON(), uexCommand.data.toJSON(), whohasCommand.data.toJSON(), blueprintCommand.data.toJSON(), materialCommand.data.toJSON(), fleetCommand.data.toJSON(), helpCommand.data.toJSON(), marketplaceCommand.data.toJSON()];

export async function registerCommands(clientId?: string): Promise<void> {
  const token = process.env['DISCORD_TOKEN'];
  if (!token) return;

  const resolvedClientId = clientId ?? client.user?.id;
  if (!resolvedClientId) {
    console.error('[bot] registerCommands: client not ready, no clientId available');
    return;
  }

  const rest = new REST().setToken(token);

  const guildIds = [...client.guilds.cache.keys()];
  let guildSuccesses = 0;
  for (const guildId of guildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(resolvedClientId, guildId), { body });
      guildSuccesses++;
    } catch (err) {
      console.error(`[bot] Failed to register commands for guild ${guildId}:`, err);
    }
  }
  if (guildSuccesses > 0) {
    console.log(`[bot] Slash commands registered instantly to ${guildSuccesses} guild(s)`);
  }

  const config = await prisma.botConfig.findUnique({ where: { id: 1 } });
  const globalEnabled = config?.globalCommandsEnabled ?? true;

  if (globalEnabled) {
    try {
      await rest.put(Routes.applicationCommands(resolvedClientId), { body });
      console.log(`[bot] Global slash commands registered`);
    } catch (err) {
      console.error('[bot] Failed to register global commands:', err);
    }
  } else {
    try {
      await rest.put(Routes.applicationCommands(resolvedClientId), { body: [] });
      console.log(`[bot] Global slash commands cleared (disabled)`);
    } catch (err) {
      console.error('[bot] Failed to clear global commands:', err);
    }
  }
}
