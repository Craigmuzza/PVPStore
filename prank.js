// prank.js
// Auto-delete a target user's messages the moment they're sent.
// Per-guild scoped, admin-gated, persisted to disk.

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'prank_victims.json');
const KF_ADMIN_ROLE = process.env.KF_ADMIN_ROLE_ID ?? '1392512695303143435';

// { guildId: { userId: { addedAt, addedBy } } }
let state = {};

function load() {
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { state = {}; }
}
function save() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
load();

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
         interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE);
}

export const prankCommands = [
  new SlashCommandBuilder().setName('prank').setDescription('Auto-delete a user\'s messages (joke)')
    .addSubcommand(s => s.setName('add').setDescription('Start auto-deleting this user\'s messages in this server')
      .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Stop auto-deleting this user\'s messages')
      .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('Show all active prank targets in this server'))
    .addSubcommand(s => s.setName('clear').setDescription('Clear ALL prank targets in this server')),
];

export async function handlePrankInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'prank') return false;
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Server only.', ephemeral: true });
    return true;
  }
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '🔒 Admins only (Manage Server, or Crater killfeed admin role).', ephemeral: true });
    return true;
  }

  const g = interaction.guildId;
  state[g] = state[g] ?? {};
  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    const u = interaction.options.getUser('user', true);
    state[g][u.id] = { addedAt: Date.now(), addedBy: interaction.user.id };
    save();
    await interaction.reply({
      content: `😈 Auto-deleting messages from <@${u.id}> in this server.\n` +
               `*(Requires me to have **Manage Messages** in each channel. Use \`/prank remove user:@them\` to stop.)*`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (sub === 'remove') {
    const u = interaction.options.getUser('user', true);
    const had = !!state[g][u.id];
    delete state[g][u.id];
    save();
    await interaction.reply({
      content: had ? `✅ Stopped auto-deleting <@${u.id}>.` : `<@${u.id}> wasn't being targeted.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (sub === 'list') {
    const ids = Object.keys(state[g] ?? {});
    await interaction.reply({
      content: ids.length
        ? `😈 Active targets in this server: ${ids.map(id => `<@${id}>`).join(', ')}`
        : 'No active prank targets in this server.',
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (sub === 'clear') {
    const n = Object.keys(state[g] ?? {}).length;
    state[g] = {};
    save();
    await interaction.reply({ content: `✅ Cleared **${n}** prank target${n === 1 ? '' : 's'} in this server.`, ephemeral: true });
    return true;
  }

  return false;
}

// Called from bot.js messageCreate — keep this first so deleted prank messages
// don't also trigger /kfprofile or roasts.
export async function handlePrankMessage(message) {
  if (!message.guildId) return false;
  if (message.author?.bot) return false;
  const victims = state[message.guildId];
  if (!victims || !victims[message.author.id]) return false;
  try {
    await message.delete();
    return true;
  } catch (e) {
    console.error('[PRANK] delete failed:', e.message);
    return false;
  }
}
