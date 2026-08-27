import 'dotenv/config';
import { COMMANDS } from './commands.js';

const { DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN, DISCORD_REGISTER_GUILD_ID } = process.env;
if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN) throw new Error('DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required');
const endpoint = DISCORD_REGISTER_GUILD_ID
  ? `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_REGISTER_GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`;
const response = await fetch(endpoint, { method: 'PUT', headers: { authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(COMMANDS) });
if (!response.ok) throw new Error(`Discord command registration failed: ${response.status} ${await response.text()}`);
console.log(`Registered ${COMMANDS.length} commands.`);
