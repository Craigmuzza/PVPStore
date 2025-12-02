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

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error('DISCORD_TOKEN is not set in environment.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
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
  // Only handle slash commands here
  if (!interaction.isChatInputCommand()) return;

  try {
    // First let extras handle it (/vouch, /addveng, /removeveng, /listveng)
    if (await handleExtraInteraction(interaction)) return;

    // Then GE-related commands (/alerts, /watchlist, /price, /help)
    if (await handleGeInteraction(interaction)) return;

  } catch (err) {
    console.error('[BOT] Error handling interaction:', err);

    // Avoid double replies: only reply if not already replied/deferred
    if (!interaction.replied && !interaction.deferred && interaction.isRepliable()) {
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

client.login(TOKEN);
