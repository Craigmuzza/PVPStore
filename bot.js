// bot.js
// ─────────────────────────────────────────────────────────────────────────────
// Main entry for The Crater bot
//  - wires GE Dump Detector (geDetector.js)
//  - wires extras (vouch + vengeance list; extras.js)
// ─────────────────────────────────────────────────────────────────────────────

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
} from 'discord.js';

import dotenv from 'dotenv';
dotenv.config();

import {
  geCommands,
  initGeDetector,
  handleGeInteraction,
} from './geDetector.js';

import {
  extraCommands,
  handleExtraInteraction,
} from './extras.js';

import { handleRoast } from './roasts.js';

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error('DISCORD_TOKEN is not set in environment.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Combine commands from both modules
const allCommands = [...geCommands, ...extraCommands];

// Shared ready handler (works for both v14 "ready" and v15 "clientReady")
async function onClientReady(c) {
  console.log(`Logged in as ${c.user.tag}`);

  // Register global commands
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(c.user.id),
      { body: allCommands.map(cmd => cmd.toJSON()) },
    );
    console.log('[BOT] Slash commands registered.');
  } catch (err) {
    console.error('[BOT] Failed to register slash commands:', err);
  }

  // Start GE detector (health server + alert loop)
  await initGeDetector(c);
}

// v14
client.once('ready', onClientReady);
// v15+
client.once('clientReady', onClientReady);

client.on('interactionCreate', async (interaction) => {
  try {
    console.log(
      '[INT]',
      'id:', interaction.id,
      'type:',
      interaction.isChatInputCommand() ? 'chat-input'
        : interaction.isStringSelectMenu() ? 'string-select'
        : interaction.isButton() ? 'button'
        : interaction.isModalSubmit() ? 'modal-submit'
        : 'other',
      'command:',
      interaction.isChatInputCommand() ? interaction.commandName : 'n/a',
      'customId:',
      'customId' in interaction ? interaction.customId : 'n/a',
    );

    // First let extras handle it (/vouch, /addveng, /removeveng, /listveng)
    if (await handleExtraInteraction(interaction)) return;

    // Then GE-related commands (/alerts, /watchlist, /price, /help)
    if (await handleGeInteraction(interaction)) return;
  } catch (err) {
    console.error('[BOT] Error handling interaction:', err);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({
          content: 'An error occurred while processing this command.',
          ephemeral: true,
        });
      } catch {
        // ignore
      }
    }
  }
});


// ── Random roast listener ──────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  try {
    await handleRoast(message);
  } catch (err) {
    console.error('[BOT] Error in roast handler:', err);
  }
});

client.login(TOKEN);
