import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import * as eventCommand from './commands/event.js';

const token = process.env['DISCORD_TOKEN'];
const clientId = process.env['DISCORD_CLIENT_ID'];
const guildId = process.env['GUILD_ID'];

if (!token || !clientId) {
  console.error('[deploy] DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in .env');
  process.exit(1);
}

const body = [eventCommand.data.toJSON()];
const rest = new REST().setToken(token);

try {
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.log(`[deploy] Registered ${body.length} command(s) to guild ${guildId} (instant).`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log(`[deploy] Registered ${body.length} global command(s) (takes ~1 hour to propagate).`);
  }
} catch (err) {
  console.error('[deploy] Failed:', err);
  process.exit(1);
}
