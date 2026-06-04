// whois.js
// Cross-tenant identity dossier for Discord users.
//
// Builds up an identity log over time so impersonators can be caught:
//   - Every Discord username and per-guild nickname we observe is timestamped.
//   - Every RSN we associate with a UID (via /kfrsn or via observed PvP/clog
//     activity in any tenant) is stamped with first/last-seen + source.
//   - At query time, /whois aggregates that log together with per-tenant kill/
//     loot/death/clog activity to produce a single concrete picture.
//
// The log is global (one file, all guilds). /whois works in any server with
// the bot; the data shown is the same regardless of where you ask.

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getTenantsSummary, getUserActivity, getRSNOwner, getAccountRSNs } from './killfeed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATA_DIR     = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE   = path.join(DATA_DIR, 'identity_log.json');
const KF_ADMIN_ROLE = process.env.KF_ADMIN_ROLE_ID ?? '1392512695303143435';
const CRATER_GUILD_ID = process.env.CRATER_GUILD_ID ?? null;

const ci = s => (s ?? '').toLowerCase().trim();

// State shape:
//   { [uid]: { uid, firstSeen, lastSeen,
//              usernames: { [lower]: { value, firstSeen, lastSeen, count } },
//              globalNames: { [lower]: { value, firstSeen, lastSeen, count } },
//              guildNicknames: { [key]: { guildId, nickname, firstSeen, lastSeen, count } },
//              rsns: { [lower]: { rsn, firstSeen, lastSeen, count, sources: [] } },
//              guildsSeen: { [guildId]: { firstSeen, lastSeen } } } }
let log = {};

function load() {
  try { log = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { log = {}; }
}
function save() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(log, null, 2));
}
load();

// Debounce disk writes — sightings come in heavy bursts during chat.
let saveTimer = null;
function queueSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 5_000);
}

function ensureEntry(uid) {
  if (!log[uid]) {
    log[uid] = {
      uid,
      firstSeen: Date.now(),
      lastSeen:  Date.now(),
      usernames: {},
      globalNames: {},
      guildNicknames: {},
      rsns: {},
      guildsSeen: {},
    };
  }
  return log[uid];
}

function bumpKey(map, key, value, extra = {}) {
  const now = Date.now();
  if (!map[key]) {
    map[key] = { value, firstSeen: now, lastSeen: now, count: 1, ...extra };
  } else {
    map[key].lastSeen = now;
    map[key].count = (map[key].count ?? 0) + 1;
    if (value && map[key].value !== value) map[key].value = value; // refresh case
  }
}

// ─── Public: called from bot.js messageCreate ───────────────────────────────
export function recordSighting(message) {
  if (!message?.author || message.author.bot) return;
  const uid = message.author.id;
  const entry = ensureEntry(uid);
  entry.lastSeen = Date.now();

  // Discord username (immutable-ish handle, e.g. "craigmuzza")
  if (message.author.username) {
    bumpKey(entry.usernames, ci(message.author.username), message.author.username);
  }
  // Discord global display name (e.g. "Craig Murray")
  if (message.author.globalName) {
    bumpKey(entry.globalNames, ci(message.author.globalName), message.author.globalName);
  }
  // Per-guild nickname
  if (message.guildId && message.member?.nickname) {
    const key = `${message.guildId}|${ci(message.member.nickname)}`;
    bumpKey(entry.guildNicknames, key, message.member.nickname, {
      guildId: message.guildId, nickname: message.member.nickname,
    });
  }
  // Guild presence
  if (message.guildId) {
    const g = entry.guildsSeen[message.guildId] ?? { firstSeen: Date.now(), lastSeen: 0 };
    g.lastSeen = Date.now();
    entry.guildsSeen[message.guildId] = g;
  }
  queueSave();
}

// ─── Public: called from killfeed when an RSN is associated with a UID ──────
// Sources: 'register' (explicit /kfrsn) | 'observe' (seen doing PvP/clog)
export function recordRSNAssociation(userId, rsn, source = 'observe') {
  if (!userId || !rsn) return;
  if (!/^\d{17,19}$/.test(userId)) return; // only track real UIDs, not bare RSN keys
  const entry = ensureEntry(userId);
  const key   = ci(rsn);
  const now   = Date.now();
  entry.lastSeen = now;
  if (!entry.rsns[key]) {
    entry.rsns[key] = { rsn, firstSeen: now, lastSeen: now, count: 1, sources: [source] };
  } else {
    entry.rsns[key].lastSeen = now;
    entry.rsns[key].count = (entry.rsns[key].count ?? 0) + 1;
    if (rsn && entry.rsns[key].rsn !== rsn) entry.rsns[key].rsn = rsn; // refresh case
    if (!entry.rsns[key].sources?.includes(source)) {
      entry.rsns[key].sources = [...(entry.rsns[key].sources ?? []), source];
    }
  }
  queueSave();
}

// ─── Slash command ──────────────────────────────────────────────────────────
export const whoisCommands = [
  new SlashCommandBuilder().setName('whois').setDescription('Identity dossier for a Discord user (cross-server)')
    .addUserOption(o => o.setName('user').setDescription('Discord user'))
    .addStringOption(o => o.setName('rsn').setDescription('Or look up by RSN'))
    .addStringOption(o => o.setName('id').setDescription('Or look up by Discord ID'))
    .setDMPermission(false),
];

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
         interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE);
}

function fmtTime(ts) {
  if (!ts) return '*never*';
  return `<t:${Math.floor(ts / 1000)}:R>`;
}
function fmtDate(ts) {
  if (!ts) return '*unknown*';
  return `<t:${Math.floor(ts / 1000)}:D>`;
}
function fmtGP(n) {
  if (!Number.isFinite(n) || n === 0) return '0';
  if (Math.abs(n) >= 1_000_000_000) return `${+(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000)     return `${+(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)         return `${+(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
function fitField(lines, fallback = '*none*', maxLen = 1024) {
  if (!lines?.length) return fallback;
  const kept = [];
  let used = 0;
  for (const line of lines) {
    const extra = line.length + (kept.length ? 1 : 0);
    if (used + extra > maxLen - 20) break;
    kept.push(line); used += extra;
  }
  const dropped = lines.length - kept.length;
  return kept.join('\n') + (dropped > 0 ? `\n*…and ${dropped} more*` : '');
}

// Account age helper — Discord snowflake → ms since 2015-01-01 epoch
function accountCreated(uid) {
  const DISCORD_EPOCH = 1420070400000n;
  try {
    const ts = (BigInt(uid) >> 22n) + DISCORD_EPOCH;
    return Number(ts);
  } catch { return null; }
}

// ─── Interaction handler ────────────────────────────────────────────────────
export async function handleWhoisInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'whois') return false;
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '🔒 Admins only.', ephemeral: true });
    return true;
  }

  const user    = interaction.options.getUser('user');
  const rsnOpt  = interaction.options.getString('rsn');
  const idOpt   = interaction.options.getString('id');

  // Resolve to a Discord UID (best effort)
  let uid = user?.id ?? null;
  if (!uid && idOpt && /^\d{17,19}$/.test(idOpt.trim())) uid = idOpt.trim();
  if (!uid && rsnOpt)  uid = getRSNOwner(rsnOpt);

  if (!uid) {
    return interaction.reply({
      content: rsnOpt
        ? `❌ RSN \`${rsnOpt}\` isn't linked to any Discord account. Provide \`user\` or \`id\` instead, or use \`/kfrsn link\` first.`
        : '❌ Provide a `user`, `rsn`, or `id`.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // Try to fetch the live Discord profile
  let fetchedUser = user;
  if (!fetchedUser) {
    try { fetchedUser = await interaction.client.users.fetch(uid); } catch { fetchedUser = null; }
  }
  let member = null;
  if (interaction.guild) {
    try { member = await interaction.guild.members.fetch(uid); } catch { member = null; }
  }

  const entry  = log[uid] ?? null;
  const rsns   = getAccountRSNs(uid);
  const activity = getUserActivity(uid, rsns);

  // ── Discord identity field ─────────────────────────────────────────────
  const created   = accountCreated(uid);
  const ageMs     = created ? Date.now() - created : null;
  const ageDays   = ageMs ? Math.floor(ageMs / 86_400_000) : null;
  const ageStr    = ageDays != null
    ? (ageDays >= 365 ? `${(ageDays / 365).toFixed(1)} years` : `${ageDays} days`)
    : 'unknown';
  const handle    = fetchedUser ? `\`${fetchedUser.username}\`` : '*unknown handle*';
  const globalNm  = fetchedUser?.globalName ? `**${fetchedUser.globalName}**` : '';
  const idLine    = `**ID:** \`${uid}\``;
  const createdLn = created ? `**Created:** ${fmtDate(created)} (${ageStr} old)` : '';

  const identityField = [globalNm, handle, idLine, createdLn].filter(Boolean).join(' · ');

  // ── In this server (if applicable) ─────────────────────────────────────
  const serverField = member
    ? [
        `**Nickname:** ${member.nickname ?? '*(none)*'}`,
        `**Joined:** ${member.joinedTimestamp ? fmtDate(member.joinedTimestamp) : '*unknown*'}`,
        `**Roles:** ${member.roles.cache.size - 1}`,
      ].join(' · ')
    : '*Not a member of this server.*';

  // ── Linked RSNs (global registry, with first-linked from our log) ──────
  const rsnLines = rsns.map(r => {
    const meta = entry?.rsns?.[ci(r)];
    const first = meta?.firstSeen ? ` · linked ${fmtTime(meta.firstSeen)}` : '';
    const sources = meta?.sources?.length ? ` · *${meta.sources.join(', ')}*` : '';
    return `• **${r}**${first}${sources}`;
  });

  // ── Aliases / nicknames ────────────────────────────────────────────────
  const usernameLines = Object.values(entry?.usernames ?? {})
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map(u => `• \`${u.value}\` — last seen ${fmtTime(u.lastSeen)} (${u.count}×)`);
  const globalNameLines = Object.values(entry?.globalNames ?? {})
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map(u => `• **${u.value}** — last seen ${fmtTime(u.lastSeen)} (${u.count}×)`);
  const nickLines = Object.values(entry?.guildNicknames ?? {})
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map(n => `• **${n.nickname}** in \`${n.guildId}\` — last seen ${fmtTime(n.lastSeen)}`);

  // ── Per-tenant activity ────────────────────────────────────────────────
  const actLines = activity
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
    .map(a => {
      const bits = [];
      if (a.kills)  bits.push(`⚔️ ${a.kills} kills`);
      if (a.deaths) bits.push(`💀 ${a.deaths} deaths`);
      if (a.looted) bits.push(`💰 ${fmtGP(a.looted)} looted`);
      if (a.lost)   bits.push(`💸 ${fmtGP(a.lost)} lost`);
      if (a.clog)   bits.push(`📜 ${a.clog} clog`);
      const lastTxt = a.lastSeen ? ` · last ${fmtTime(a.lastSeen)}` : '';
      return `• **${a.displayName}** — ${bits.join(' · ') || '*no logged activity*'}${lastTxt}`;
    });

  // ── Guilds we've seen them in (from our message sightings) ─────────────
  const guildLines = Object.entries(entry?.guildsSeen ?? {})
    .sort(([, a], [, b]) => b.lastSeen - a.lastSeen)
    .map(([gid, g]) => `• \`${gid}\` — first ${fmtTime(g.firstSeen)} · last ${fmtTime(g.lastSeen)}`);

  // ── Assemble embed ─────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🔎 whois — ${fetchedUser?.globalName ?? fetchedUser?.username ?? `Unknown (${uid})`}`)
    .setThumbnail(fetchedUser?.displayAvatarURL?.({ size: 256 }) ?? null)
    .setDescription(`*Identity dossier compiled across **${getTenantsSummary().length}** clan${getTenantsSummary().length === 1 ? '' : 's'} the bot serves.*`)
    .setTimestamp()
    .addFields(
      { name: '🪪 Discord Account', value: identityField || '*unknown*', inline: false },
      { name: '🏰 In This Server',  value: serverField, inline: false },
      { name: `🔗 Linked RSNs (${rsns.length})`,
        value: fitField(rsnLines, '*No RSNs linked.*'), inline: false },
      { name: '🎮 In-Game Activity',
        value: fitField(actLines, '*No tracked activity in any clan.*'), inline: false },
      { name: `👤 Known Discord Handles (${usernameLines.length})`,
        value: fitField(usernameLines, '*No handles observed yet.*'), inline: false },
      { name: `🌐 Known Display Names (${globalNameLines.length})`,
        value: fitField(globalNameLines, '*No display names observed yet.*'), inline: false },
      { name: `🏷️ Server Nicknames Observed (${nickLines.length})`,
        value: fitField(nickLines, '*None observed.*'), inline: false },
      { name: `🏠 Servers Observed In (${guildLines.length})`,
        value: fitField(guildLines, '*Not seen speaking in any tracked server.*'), inline: false },
    )
    .setFooter({ text: entry
      ? `First observed: ${new Date(entry.firstSeen).toISOString().slice(0, 10)} · Last seen: ${new Date(entry.lastSeen).toISOString().slice(0, 10)}`
      : 'No prior observations — start chatting to build a history.' });

  return interaction.editReply({ embeds: [embed] });
}
