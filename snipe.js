// snipe.js
// Short-lived, admin-only archive for recovering recently deleted messages.

import {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'snipe_messages.json');
const ADMIN_ROLE_ID = process.env.KF_ADMIN_ROLE_ID ?? '1392512695303143435';

function numberSetting(name, fallback, min, max) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const RETENTION_HOURS = numberSetting('SNIPE_RETENTION_HOURS', 24, 1, 168);
const RETENTION_MS = RETENTION_HOURS * 60 * 60 * 1000;
const MAX_TRACKED_MESSAGES = Math.floor(numberSetting('SNIPE_MAX_TRACKED_MESSAGES', 10_000, 100, 50_000));
const MAX_DELETED_PER_CHANNEL = Math.floor(numberSetting('SNIPE_MAX_DELETED_PER_CHANNEL', 25, 1, 25));
const MAX_CONTENT_CHARS = 4_000;
const SAVE_DELAY_MS = 5_000;

const trackedMessages = new Map();
const deletedByChannel = new Map();
let saveTimer = null;
let lastPruneAt = 0;

function channelKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function trimText(value, maxLength) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeAsset(asset) {
  if (!asset?.url) return null;
  return {
    id: String(asset.id ?? ''),
    name: trimText(asset.name || 'attachment', 200),
    url: String(asset.url),
    contentType: asset.contentType ? String(asset.contentType) : null,
    size: Number.isFinite(asset.size) ? asset.size : null,
  };
}

function assetsFrom(collection, fallback = []) {
  if (!collection?.values) return fallback;
  return [...collection.values()].slice(0, 10).map(normalizeAsset).filter(Boolean);
}

function stickersFrom(collection, fallback = []) {
  if (!collection?.values) return fallback;
  return [...collection.values()].slice(0, 10).map(sticker => ({
    id: String(sticker.id ?? ''),
    name: trimText(sticker.name || 'sticker', 200),
    url: sticker.url ? String(sticker.url) : null,
  }));
}

function snapshotMessage(message, previous = null) {
  if (!message?.id || !message.guildId || !message.channelId) return null;
  if (message.author?.bot || previous?.authorBot) return null;

  const authorId = message.author?.id || previous?.authorId;
  if (!authorId) return null;

  const isPartial = message.partial === true;
  const content = typeof message.content === 'string'
    ? trimText(message.content, MAX_CONTENT_CHARS)
    : previous?.content ?? '';

  return {
    id: String(message.id),
    guildId: String(message.guildId),
    channelId: String(message.channelId),
    channelName: message.channel?.name || previous?.channelName || null,
    authorId: String(authorId),
    authorUsername: message.author?.username || previous?.authorUsername || 'unknown',
    authorDisplayName: message.member?.displayName || message.author?.globalName || previous?.authorDisplayName || null,
    authorBot: false,
    content,
    attachments: isPartial
      ? previous?.attachments ?? []
      : assetsFrom(message.attachments, previous?.attachments ?? []),
    stickers: isPartial
      ? previous?.stickers ?? []
      : stickersFrom(message.stickers, previous?.stickers ?? []),
    createdAt: Number(message.createdTimestamp) || previous?.createdAt || Date.now(),
    editedAt: Number(message.editedTimestamp) || previous?.editedAt || null,
  };
}

function normalizeStoredEntry(entry) {
  if (!entry || !entry.id || !entry.guildId || !entry.channelId || !entry.authorId) return null;
  return {
    id: String(entry.id),
    guildId: String(entry.guildId),
    channelId: String(entry.channelId),
    channelName: entry.channelName ? String(entry.channelName) : null,
    authorId: String(entry.authorId),
    authorUsername: trimText(entry.authorUsername || 'unknown', 100),
    authorDisplayName: entry.authorDisplayName ? trimText(entry.authorDisplayName, 100) : null,
    authorBot: false,
    content: trimText(entry.content, MAX_CONTENT_CHARS),
    attachments: Array.isArray(entry.attachments) ? entry.attachments.slice(0, 10).map(normalizeAsset).filter(Boolean) : [],
    stickers: Array.isArray(entry.stickers) ? entry.stickers.slice(0, 10).map(sticker => ({
      id: String(sticker?.id ?? ''),
      name: trimText(sticker?.name || 'sticker', 200),
      url: sticker?.url ? String(sticker.url) : null,
    })) : [],
    createdAt: Number(entry.createdAt) || Date.now(),
    editedAt: Number(entry.editedAt) || null,
    deletedAt: Number(entry.deletedAt) || null,
  };
}

function prune(now = Date.now(), force = false) {
  if (!force && now - lastPruneAt < 60_000) return false;
  lastPruneAt = now;
  const cutoff = now - RETENTION_MS;
  let changed = false;

  for (const [id, entry] of trackedMessages) {
    if ((entry.createdAt || 0) < cutoff) {
      trackedMessages.delete(id);
      changed = true;
    }
  }

  while (trackedMessages.size > MAX_TRACKED_MESSAGES) {
    const oldestId = trackedMessages.keys().next().value;
    trackedMessages.delete(oldestId);
    changed = true;
  }

  for (const [key, entries] of deletedByChannel) {
    const kept = entries
      .filter(entry => (entry.deletedAt || 0) >= cutoff)
      .slice(0, MAX_DELETED_PER_CHANNEL);
    if (kept.length !== entries.length) changed = true;
    if (kept.length) deletedByChannel.set(key, kept);
    else deletedByChannel.delete(key);
  }

  return changed;
}

function loadStore() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[SNIPE] Could not load archive:', error.message);
    return;
  }

  for (const item of Array.isArray(raw?.tracked) ? raw.tracked : []) {
    const entry = normalizeStoredEntry(item);
    if (entry && !entry.deletedAt) trackedMessages.set(entry.id, entry);
  }

  for (const entries of Object.values(raw?.deleted ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const item of entries) {
      const entry = normalizeStoredEntry(item);
      if (!entry?.deletedAt) continue;
      const key = channelKey(entry.guildId, entry.channelId);
      const list = deletedByChannel.get(key) ?? [];
      list.push(entry);
      deletedByChannel.set(key, list);
    }
  }

  for (const [key, entries] of deletedByChannel) {
    deletedByChannel.set(key, entries.sort((a, b) => b.deletedAt - a.deletedAt));
  }
  prune(Date.now(), true);
}

function saveStore() {
  prune(Date.now(), true);
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const deleted = {};
    for (const [key, entries] of deletedByChannel) deleted[key] = entries;
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      tracked: [...trackedMessages.values()],
      deleted,
    }));
  } catch (error) {
    console.error('[SNIPE] Could not save archive:', error.message);
  }
}

function queueSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStore();
  }, SAVE_DELAY_MS);
}

function saveImmediately() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveStore();
}

loadStore();

export function recordSnipeMessage(message) {
  const previous = message?.id ? trackedMessages.get(String(message.id)) : null;
  const entry = snapshotMessage(message, previous);
  if (!entry) return false;

  trackedMessages.delete(entry.id);
  trackedMessages.set(entry.id, entry);
  prune();
  queueSave();
  return true;
}

function archiveDeletedMessage(message, deletedAt = Date.now()) {
  const id = message?.id ? String(message.id) : null;
  if (!id) return false;

  const tracked = trackedMessages.get(id);
  const entry = tracked || snapshotMessage(message);
  trackedMessages.delete(id);
  if (!entry) return false;

  const deletedEntry = { ...entry, deletedAt };
  const key = channelKey(entry.guildId, entry.channelId);
  const withoutDuplicate = (deletedByChannel.get(key) ?? []).filter(item => item.id !== id);
  deletedByChannel.set(key, [deletedEntry, ...withoutDuplicate].slice(0, MAX_DELETED_PER_CHANNEL));
  console.log(`[SNIPE] Captured deleted message ${id} from ${entry.authorUsername} in #${entry.channelName || entry.channelId}`);
  return true;
}

export function recordSnipeDelete(message) {
  const captured = archiveDeletedMessage(message);
  if (captured) saveImmediately();
  return captured;
}

export function recordSnipeBulkDelete(messages) {
  let captured = 0;
  for (const message of messages?.values?.() ?? []) {
    if (archiveDeletedMessage(message)) captured += 1;
  }
  if (captured) saveImmediately();
  return captured;
}

export function flushSnipeStore() {
  saveImmediately();
}

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.member?.roles?.cache?.has(ADMIN_ROLE_ID);
}

function formatBytes(size) {
  if (!Number.isFinite(size)) return '';
  if (size >= 1024 * 1024) return ` (${(size / (1024 * 1024)).toFixed(1)} MB)`;
  if (size >= 1024) return ` (${Math.round(size / 1024)} KB)`;
  return ` (${size} B)`;
}

function escapeLinkLabel(value) {
  return String(value).replace(/[\\\[\]]/g, '\\$&');
}

function assetLines(entry) {
  const lines = [];
  for (const attachment of entry.attachments ?? []) {
    lines.push(`[${escapeLinkLabel(attachment.name)}](${attachment.url})${formatBytes(attachment.size)}`);
  }
  for (const sticker of entry.stickers ?? []) {
    lines.push(sticker.url
      ? `[Sticker: ${escapeLinkLabel(sticker.name)}](${sticker.url})`
      : `Sticker: ${sticker.name}`);
  }
  return trimText(lines.join('\n'), 1_024);
}

function displayName(entry) {
  const primary = entry.authorDisplayName || entry.authorUsername || 'Unknown user';
  const username = entry.authorUsername && entry.authorUsername !== primary
    ? ` (@${entry.authorUsername})`
    : '';
  return trimText(`${primary}${username}`, 256);
}

function buildSnipeEmbed(entry, position, total) {
  const content = entry.content?.trim() ? trimText(entry.content, 3_800) : '*No text content.*';
  const sentAt = Math.floor(entry.createdAt / 1000);
  const deletedAt = Math.floor(entry.deletedAt / 1000);
  const assets = assetLines(entry);
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Deleted message')
    .setAuthor({ name: displayName(entry) })
    .setDescription(content)
    .addFields(
      { name: 'Author', value: `<@${entry.authorId}> (\`${entry.authorId}\`)`, inline: true },
      { name: 'Channel', value: `<#${entry.channelId}>`, inline: true },
      { name: 'Timing', value: `Sent <t:${sentAt}:R>\nDeleted <t:${deletedAt}:R>`, inline: false },
    )
    .setFooter({ text: `Snipe ${position} of ${total} retained deletion${total === 1 ? '' : 's'}` })
    .setTimestamp(entry.deletedAt);

  if (assets) embed.addFields({ name: 'Attachments', value: assets, inline: false });
  const image = entry.attachments?.find(asset => asset.contentType?.startsWith('image/') && asset.url);
  if (image) embed.setImage(image.url);
  return embed;
}

export const snipeCommands = [
  new SlashCommandBuilder()
    .setName('snipe')
    .setDescription('Show a recently deleted message (admins only)')
    .addChannelOption(option => option
      .setName('channel')
      .setDescription('Channel to inspect (defaults to this channel)'))
    .addUserOption(option => option
      .setName('user')
      .setDescription('Only show deletions from this user'))
    .addIntegerOption(option => option
      .setName('number')
      .setDescription('Which deletion to show: 1 is the most recent')
      .setMinValue(1)
      .setMaxValue(MAX_DELETED_PER_CHANNEL))
    .setDMPermission(false),
];

export async function handleSnipeInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'snipe') return false;

  if (!interaction.guildId) {
    await interaction.reply({ content: 'Server only.', ephemeral: true });
    return true;
  }
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: 'Admins only (Manage Server, or the killfeed admin role).',
      ephemeral: true,
    });
    return true;
  }

  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (!channel?.id || channel.guildId !== interaction.guildId || !channel.isTextBased?.()) {
    await interaction.reply({ content: 'Choose a message-based channel in this server.', ephemeral: true });
    return true;
  }

  const canView = channel.permissionsFor?.(interaction.member)?.has(PermissionFlagsBits.ViewChannel);
  if (!canView) {
    await interaction.reply({ content: 'You cannot view that channel.', ephemeral: true });
    return true;
  }

  const selectedUser = interaction.options.getUser('user');
  const position = interaction.options.getInteger('number') ?? 1;
  const key = channelKey(interaction.guildId, channel.id);
  const pruned = prune(Date.now(), true);
  if (pruned) queueSave();

  const entries = (deletedByChannel.get(key) ?? [])
    .filter(entry => !selectedUser || entry.authorId === selectedUser.id);
  const entry = entries[position - 1];
  if (!entry) {
    const userFilter = selectedUser ? ` from <@${selectedUser.id}>` : '';
    await interaction.reply({
      content: `No matching deleted message${userFilter} is stored for <#${channel.id}> within the last ${RETENTION_HOURS} hours.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  await interaction.reply({
    embeds: [buildSnipeEmbed(entry, position, entries.length)],
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
  console.log(`[SNIPE] ${interaction.user.tag} viewed deletion ${entry.id} in #${channel.name || channel.id}`);
  return true;
}
