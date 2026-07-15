// bot.js
// ─────────────────────────────────────────────────────────────────────────────
// Main entry for The Crater bot
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';

import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
} from 'discord.js';

import {
  extraCommands,
  handleExtraInteraction,
} from './extras.js';

import { handleRoast, initRoastDriveBy, roastCommands, handleRoastInteraction } from './roasts.js';

import { initKillfeed, killfeedCommands, handleKillfeedInteraction, handleKfShortcut, setRSNAssociationHook } from './killfeed.js';
import { onboardCommands, handleOnboardInteraction } from './onboard.js';
import { prankCommands, handlePrankInteraction, handlePrankMessage } from './prank.js';
import {
  snipeCommands,
  handleSnipeInteraction,
  recordSnipeMessage,
  recordSnipeDelete,
  recordSnipeBulkDelete,
} from './snipe.js';
import { whoisCommands, handleWhoisInteraction, recordSighting, recordRSNAssociation } from './whois.js';

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error('TOKEN is not set in environment.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const allCommands = [
  ...extraCommands,
  ...killfeedCommands,
  ...onboardCommands,
  ...prankCommands,
  ...roastCommands,
  ...snipeCommands,
  ...whoisCommands,
];

async function onClientReady(c) {
  console.log(`Logged in as ${c.user.tag}`);

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

  initKillfeed(c);
  initRoastDriveBy(c);
  // /whois listens for every RSN ↔ UID association observed by killfeed
  // (both /kfrsn registrations and in-game PvP/clog sightings).
  setRSNAssociationHook(recordRSNAssociation);
}

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

    if (await handleExtraInteraction(interaction)) return;
    if (await handleKillfeedInteraction(interaction)) return;
    if (await handleOnboardInteraction(interaction)) return;
    if (await handlePrankInteraction(interaction)) return;
    if (await handleRoastInteraction(interaction)) return;
    if (await handleSnipeInteraction(interaction)) return;
    if (await handleWhoisInteraction(interaction)) return;
  } catch (err) {
    console.error('[BOT] Error handling interaction:', err);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: 'An error occurred.', ephemeral: true });
      } catch {}
    }
  }
});

client.on('messageCreate', async (message) => {
  try {
    // Archive before prank handling so bot-triggered deletions can be sniped.
    recordSnipeMessage(message);
    // Record sighting BEFORE any delete — we want identity data even when
    // the message gets nuked by a prank mode.
    recordSighting(message);
    // Prank delete runs first — if the message gets nuked, downstream handlers skip.
    if (await handlePrankMessage(message)) return;
    await handleKfShortcut(message);
    await handleRoast(message);
  } catch (err) {
    console.error('[BOT] messageCreate error:', err);
  }
});

client.on('messageUpdate', (_oldMessage, newMessage) => {
  try {
    recordSnipeMessage(newMessage);
  } catch (err) {
    console.error('[BOT] messageUpdate archive error:', err);
  }
});

client.on('messageDelete', (message) => {
  try {
    recordSnipeDelete(message);
  } catch (err) {
    console.error('[BOT] messageDelete archive error:', err);
  }
});

client.on('messageDeleteBulk', (messages) => {
  try {
    recordSnipeBulkDelete(messages);
  } catch (err) {
    console.error('[BOT] messageDeleteBulk archive error:', err);
  }
});

client.login(TOKEN);
