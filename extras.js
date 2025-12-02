// extras.js
// ─────────────────────────────────────────────────────────────────────────────
// Extra commands for The Crater bot:
// - /vouch      : in-Discord vouch flow (dropdowns + modal + rich embed)
// - /addveng    : add RSNs to vengeance list, optional user assignment
// - /removeveng : remove RSNs from vengeance list
// - /listveng   : show vengeance list + raw copy-paste RSN list
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// Paths / storage
// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, 'data');
const VENG_FILE = path.join(DATA_DIR, 'veng_list.json');

// Branding
const CRATER_ICON  = 'https://i.ibb.co/PZVD0ccr/The-Crater-Logo.gif';
const CRATER_COLOR = 0x1a1a2e;

// Vouch log channel (set this in .env / Render)
const VOUCH_CHANNEL_ID = process.env.VOUCH_CHANNEL_ID || null;

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vengeance list data model
// ─────────────────────────────────────────────────────────────────────────────

let vengData = { rsns: {} };
let vengSet  = new Set(); // lower-cased RSNs

function loadVengData() {
  ensureDataDir();

  if (!fs.existsSync(VENG_FILE)) {
    vengData = { rsns: {} };
    vengSet  = new Set();
    return;
  }

  try {
    const raw  = fs.readFileSync(VENG_FILE, 'utf8');
    const json = JSON.parse(raw);

    if (Array.isArray(json)) {
      // Legacy plain list
      const rsnsObj = {};
      for (const name of json) {
        if (typeof name !== 'string') continue;
        const trimmed = name.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        rsnsObj[key] = { name: trimmed, assignedTo: null };
      }
      vengData = { rsns: rsnsObj };
    } else if (json && typeof json === 'object' && json.rsns && typeof json.rsns === 'object') {
      // New format
      vengData = { rsns: {} };
      for (const [key, value] of Object.entries(json.rsns)) {
        if (!value || typeof value !== 'object') continue;
        if (typeof value.name !== 'string') continue;
        const k = key.toLowerCase();
        vengData.rsns[k] = {
          name: value.name.trim(),
          assignedTo: value.assignedTo || null,
        };
      }
    } else {
      vengData = { rsns: {} };
    }
  } catch (err) {
    console.error('[VENG] Failed to load veng_list.json:', err);
    vengData = { rsns: {} };
  }

  vengSet = new Set(Object.keys(vengData.rsns));
}

function saveVengData() {
  ensureDataDir();
  try {
    fs.writeFileSync(
      VENG_FILE,
      JSON.stringify({ rsns: vengData.rsns }, null, 2),
      'utf8',
    );
  } catch (err) {
    console.error('[VENG] Failed to save veng_list.json:', err);
  }
}

// Load at startup
loadVengData();

// ─────────────────────────────────────────────────────────────────────────────
// Vouch system configuration
// ─────────────────────────────────────────────────────────────────────────────

const VOUCH_TYPES = {
  giveaway: { label: 'Giveaway', emoji: '🎁' },
  purchase: { label: 'Purchase', emoji: '🛒' },
  service:  { label: 'Service',  emoji: '🛠️' },
};

const RATING_LABELS = {
  1: 'Very bad',
  2: 'Bad',
  3: 'OK',
  4: 'Good',
  5: 'Excellent',
};

const RATING_STARS = {
  1: '⭐',
  2: '⭐⭐',
  3: '⭐⭐⭐',
  4: '⭐⭐⭐⭐',
  5: '⭐⭐⭐⭐⭐',
};

function ratingToColor(rating) {
  switch (rating) {
    case 1: return 0xff4d4f;
    case 2: return 0xffa940;
    case 3: return 0xffec3d;
    case 4: return 0x40a9ff;
    case 5: return 0x52c41a;
    default: return CRATER_COLOR;
  }
}

// Per-user temporary vouch state
const vouchState = new Map(); // userId -> { type, rating }

// ─────────────────────────────────────────────────────────────────────────────
// Slash commands exported to bot.js
// ─────────────────────────────────────────────────────────────────────────────

export const extraCommands = [
  new SlashCommandBuilder()
    .setName('vouch')
    .setDescription('Leave a vouch for a trade, service or giveaway.'),

  new SlashCommandBuilder()
    .setName('addveng')
    .setDescription('Add RSNs to the vengeance list.')
    .addStringOption(opt =>
      opt.setName('rsns')
        .setDescription('Comma-separated RSNs to add.')
        .setRequired(true),
    )
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Assign these RSNs to a Discord user.')
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName('removeveng')
    .setDescription('Remove RSNs from the vengeance list.')
    .addStringOption(opt =>
      opt.setName('rsns')
        .setDescription('Comma-separated RSNs to remove.')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('listveng')
    .setDescription('Show vengeance list and a raw copy-paste RSN list.'),
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseRsns(input) {
  if (!input || typeof input !== 'string') return [];
  return input
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function buildVouchComponents() {
  const typeSelect = new StringSelectMenuBuilder()
    .setCustomId('vouch_select_type')
    .setPlaceholder('Select vouch type')
    .addOptions(
      {
        label: 'Giveaway',
        value: 'giveaway',
        emoji: VOUCH_TYPES.giveaway.emoji,
        description: 'Vouch for a giveaway / raffle.',
      },
      {
        label: 'Purchase',
        value: 'purchase',
        emoji: VOUCH_TYPES.purchase.emoji,
        description: 'Vouch for buying/selling items or accounts.',
      },
      {
        label: 'Service',
        value: 'service',
        emoji: VOUCH_TYPES.service.emoji,
        description: 'Vouch for services, boosts, or other help.',
      },
    );

  const ratingSelect = new StringSelectMenuBuilder()
    .setCustomId('vouch_select_rating')
    .setPlaceholder('Select rating (1–5)')
    .addOptions(
      { label: '1 – Very bad', value: '1' },
      { label: '2 – Bad',       value: '2' },
      { label: '3 – OK',        value: '3' },
      { label: '4 – Good',      value: '4' },
      { label: '5 – Excellent', value: '5' },
    );

  const openModalButton = new ButtonBuilder()
    .setCustomId('vouch_open_modal')
    .setLabel('Write vouch…')
    .setStyle(1); // Primary

  const row1 = new ActionRowBuilder().addComponents(typeSelect);
  const row2 = new ActionRowBuilder().addComponents(ratingSelect);
  const row3 = new ActionRowBuilder().addComponents(openModalButton);

  return [row1, row2, row3];
}

function buildVouchModal() {
  const modal = new ModalBuilder()
    .setCustomId('vouch_modal')
    .setTitle('Submit your vouch');

  const detailsInput = new TextInputBuilder()
    .setCustomId('vouch_details')
    .setLabel('What happened?')
    .setPlaceholder('Describe the trade, service or giveaway.')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const anonInput = new TextInputBuilder()
    .setCustomId('vouch_anonymous')
    .setLabel('Anonymous? (yes/no)')
    .setPlaceholder('Type "yes" to hide your name, or "no".')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const row1 = new ActionRowBuilder().addComponents(detailsInput);
  const row2 = new ActionRowBuilder().addComponents(anonInput);

  modal.addComponents(row1, row2);
  return modal;
}

function buildVouchEmbed({ interaction, typeKey, rating, details, isAnon }) {
  const typeConfig = VOUCH_TYPES[typeKey] || VOUCH_TYPES.service;
  const ratingInt  = Math.min(5, Math.max(1, rating || 5));
  const stars      = RATING_STARS[ratingInt];
  const ratingText = RATING_LABELS[ratingInt];

  const createdTs = Math.floor(Date.now() / 1000);

  const authorName = isAnon
    ? 'Anonymous vouch'
    : `Vouch from ${interaction.user.tag}`;

  const authorIcon = isAnon
    ? CRATER_ICON
    : interaction.user.displayAvatarURL({ dynamic: true });

  const forText = isAnon ? 'Anonymous' : interaction.user.tag;

  const embed = new EmbedBuilder()
    .setAuthor({ name: authorName, iconURL: authorIcon })
    .setTitle(`${typeConfig.emoji} ${typeConfig.label.toUpperCase()} VOUCH`)
    .setThumbnail(CRATER_ICON)
    .setColor(ratingToColor(ratingInt))
    .setDescription(
      [
        '┈┈┈┈┈┈┈┈┈┈',
        `**For:** ${forText}`,
        `**Rating:** ${stars} (${ratingInt}/5 – ${ratingText})`,
        `**Type:** ${typeConfig.label}`,
        '┈┈┈┈┈┈┈┈┈┈',
      ].join('\n'),
    )
    .addFields(
      {
        name: '📝 Full feedback',
        value: details && details.trim().length > 0
          ? details.trim()
          : '_No additional details provided._',
      },
      {
        name: '⏱️ Time',
        value: `<t:${createdTs}:f>`,
        inline: true,
      },
    )
    .setFooter({
      text: 'The Crater • Vouch System',
      iconURL: CRATER_ICON,
    });

  return embed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main interaction handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleExtraInteraction(interaction) {
  // Slash commands
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    // /vouch
    if (commandName === 'vouch') {
      const components = buildVouchComponents();
      await interaction.reply({
        content:
          'Select the vouch type and rating below, then click **Write vouch…** to submit your feedback.',
        components,
        ephemeral: false,
      });
      return true;
    }

    // /addveng
    if (commandName === 'addveng') {
      const rsnInput   = interaction.options.getString('rsns', true);
      const assignUser = interaction.options.getUser('user');

      const names = parseRsns(rsnInput);
      if (names.length === 0) {
        await interaction.reply({
          content: 'No valid RSNs found. Please provide a comma-separated list.',
          ephemeral: true,
        });
        return true;
      }

      let addedNew     = 0;
      let updatedCount = 0;

      for (const name of names) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();

        if (!vengSet.has(key)) {
          vengSet.add(key);
          vengData.rsns[key] = {
            name: trimmed,
            assignedTo: assignUser ? assignUser.id : null,
          };
          addedNew += 1;
        } else if (assignUser) {
          vengData.rsns[key].assignedTo = assignUser.id;
          updatedCount += 1;
        }
      }

      saveVengData();

      const assignedText = assignUser
        ? `Assigned to ${assignUser.toString()}.`
        : 'No user assignment set.';

      await interaction.reply({
        content: [
          `Added **${addedNew}** new RSNs to the vengeance list.`,
          updatedCount > 0
            ? `Updated assignment for **${updatedCount}** existing RSNs.`
            : null,
          assignedText,
        ].filter(Boolean).join('\n'),
        ephemeral: true,
      });

      return true;
    }

    // /removeveng
    if (commandName === 'removeveng') {
      const rsnInput = interaction.options.getString('rsns', true);
      const names    = parseRsns(rsnInput);

      if (names.length === 0) {
        await interaction.reply({
          content: 'No valid RSNs found. Please provide a comma-separated list.',
          ephemeral: true,
        });
        return true;
      }

      let removed  = 0;
      let notFound = 0;

      for (const name of names) {
        const key = name.trim().toLowerCase();
        if (!key) continue;
        if (vengSet.has(key)) {
          vengSet.delete(key);
          delete vengData.rsns[key];
          removed += 1;
        } else {
          notFound += 1;
        }
      }

      saveVengData();

      await interaction.reply({
        content: [
          `Removed **${removed}** RSNs from the vengeance list.`,
          notFound > 0
            ? `**${notFound}** RSNs were not found in the list.`
            : null,
        ].filter(Boolean).join('\n'),
        ephemeral: true,
      });

      return true;
    }

    // /listveng
    if (commandName === 'listveng') {
      if (vengSet.size === 0) {
        await interaction.reply({
          content: '```Veng list is currently empty.```',
          ephemeral: false,
        });
        return true;
      }

      const entries = Object.entries(vengData.rsns).sort(([, a], [, b]) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
      );

      const lines = entries.map(([, data]) => {
        const target = data.assignedTo ? `<@${data.assignedTo}>` : 'Unassigned';
        return `• ${data.name} — ${target}`;
      });

      const rawList = entries.map(([, data]) => data.name).join(',');

      const embed = new EmbedBuilder()
        .setTitle(`Vengeance List (${entries.length})`)
        .setDescription(lines.join('\n') || 'No entries.')
        .setColor(CRATER_COLOR)
        .setThumbnail(CRATER_ICON)
        .setFooter({
          text: 'The Crater • Vengeance List',
          iconURL: CRATER_ICON,
        });

      await interaction.reply({
        content: '```' + rawList + '```',
        embeds: [embed],
        ephemeral: false,
      });

      return true;
    }

    return false;
  }

  // String select menus (vouch type / rating)
  if (interaction.isStringSelectMenu()) {
    const { customId, user, values } = interaction;

    if (customId === 'vouch_select_type') {
      const selectedType = values[0];
      if (VOUCH_TYPES[selectedType]) {
        const state = vouchState.get(user.id) || {};
        state.type  = selectedType;
        vouchState.set(user.id, state);
      }
      await interaction.deferUpdate().catch(() => {});
      return true;
    }

    if (customId === 'vouch_select_rating') {
      const rating = parseInt(values[0], 10);
      if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
        const state  = vouchState.get(user.id) || {};
        state.rating = rating;
        vouchState.set(user.id, state);
      }
      await interaction.deferUpdate().catch(() => {});
      return true;
    }

    // Any other vouch-related select – just ack to avoid "interaction failed"
    if (customId.startsWith('vouch_')) {
      await interaction.deferUpdate().catch(() => {});
      return true;
    }

    return false;
  }

  // Button: open vouch modal
  if (interaction.isButton()) {
    if (interaction.customId === 'vouch_open_modal') {
      const modal = buildVouchModal();
      await interaction.showModal(modal).catch(err =>
        console.error('[VOUCH] Failed to show modal:', err),
      );
      return true;
    }

    if (interaction.customId.startsWith('vouch_')) {
      await interaction.deferUpdate().catch(() => {});
      return true;
    }

    return false;
  }

  // Modal submit: vouch form
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'vouch_modal') {
      const details = interaction.fields.getTextInputValue('vouch_details');
      const anonRaw = interaction.fields.getTextInputValue('vouch_anonymous');

      const isAnon = typeof anonRaw === 'string'
        ? anonRaw.trim().toLowerCase().startsWith('y')
        : false;

      const state   = vouchState.get(interaction.user.id) || {};
      const typeKey = state.type || 'service';
      const rating  = state.rating || 5;

      vouchState.delete(interaction.user.id);

      const embed = buildVouchEmbed({
        interaction,
        typeKey,
        rating,
        details,
        isAnon,
      });

      // Resolve target channel: env var if valid, else current channel
      try {
        let targetChannel = null;

        if (VOUCH_CHANNEL_ID) {
          const ch = await interaction.client.channels
            .fetch(VOUCH_CHANNEL_ID)
            .catch(() => null);
          if (ch && ch.isTextBased && ch.isTextBased()) {
            targetChannel = ch;
          }
        }

        if (!targetChannel && interaction.channel && interaction.channel.isTextBased && interaction.channel.isTextBased()) {
          targetChannel = interaction.channel;
        }

        if (targetChannel && typeof targetChannel.send === 'function') {
          await targetChannel.send({ embeds: [embed] });
        } else {
          console.warn('[VOUCH] No valid text channel found to send vouch.');
        }
      } catch (err) {
        console.error('[VOUCH] Failed to send vouch to channel:', err);
      }

      await interaction.reply({
        content:
          `Thank you, your vouch has been recorded.${isAnon ? ' (It has been logged anonymously.)' : ''}`,
        ephemeral: true,
      });

      return true;
    }

    return false;
  }

  return false;
}
