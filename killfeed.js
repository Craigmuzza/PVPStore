// killfeed.js
// Multi-tenant kill feed: Crater is the default tenant; guest clans can be
// registered via /kfclan and get their own isolated data + embeds + leaderboards.

import express              from 'express';
import multer               from 'multer';
import { EmbedBuilder, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { execFile }         from 'child_process';
import fs                   from 'fs';
import path                 from 'path';
import { fileURLToPath }    from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Environment ─────────────────────────────────────────────────────────────
const KILL_CHANNEL    = process.env.KILL_FEED_CHANNEL_ID;
const CLAN_FILTER     = (process.env.CLAN_FILTER ?? 'the crater').toLowerCase();
const CRATER_GUILD_ID = process.env.CRATER_GUILD_ID ?? null;
const MIN_LOOT_GP     = parseInt(process.env.MIN_LOOT_GP ?? '0', 10);
const PORT            = Number(process.env.PORT) || 10000;
const EMBED_ICON      = process.env.EMBED_ICON ?? 'https://i.ibb.co/8nXbWYmq/The-Craterlogo.webp';
const LIVE_REFRESH_MS = Number(process.env.LIVE_REFRESH_MS) || 5 * 60 * 1000;
const KF_ADMIN_ROLE   = process.env.KF_ADMIN_ROLE_ID ?? '1392512695303143435';
const COMMUNAL_CHANNEL_ENV = process.env.COMMUNAL_CHANNEL_ID ?? null;
const CRATER_INVITE = process.env.CRATER_INVITE_URL ?? 'discord.gg/thecrater';
const CRATER_INVITE_LINK = /^https?:\/\//i.test(CRATER_INVITE) ? CRATER_INVITE : `https://${CRATER_INVITE}`;

const GITHUB_PAT    = process.env.GITHUB_PAT;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH   ?? 'main';
const GIT_NAME      = process.env.GIT_COMMIT_NAME  ?? 'CraterBot';
const GIT_EMAIL     = process.env.GIT_COMMIT_EMAIL ?? 'bot@crater.gg';
const GITHUB_ACTOR  = process.env.GITHUB_ACTOR;

// ─── Paths ───────────────────────────────────────────────────────────────────
const DATA_DIR     = process.env.DATA_DIR || path.join(__dirname, 'data');
const CLANS_DIR    = path.join(DATA_DIR, 'clans');
const CLANS_FILE   = path.join(DATA_DIR, 'clans.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'killfeed_settings.json');
const GLOBAL_ACCOUNTS_FILE = path.join(DATA_DIR, 'global_accounts.json');
const KF           = s => path.join(DATA_DIR, `killfeed_${s}.json`);
const GUEST_FILES = slug => ({
  state:    path.join(CLANS_DIR, slug, 'state.json'),
  accounts: path.join(CLANS_DIR, slug, 'accounts.json'),
  rsnmap:   path.join(CLANS_DIR, slug, 'rsnmap.json'),
});

// ─── Constants ───────────────────────────────────────────────────────────────
const DEDUP_MS        = 10_000;
const BACKUP_INTERVAL = 5 * 60 * 1000;
const EXPIRY_SWEEP_MS = 60 * 60 * 1000;

const COLOR_TINY   = 0x808080;
const COLOR_NORMAL = 0x00CC44;
const COLOR_BIG    = 0xFF4400;
const COLOR_HUGE   = 0xFFD700;
const COLOR_INSANE = 0xAA00FF;

const STREAK_MILESTONES = new Set([3, 5, 10, 25, 50, 100]);
const LOOT_MILESTONES   = [100_000_000, 500_000_000, 1_000_000_000, 5_000_000_000, 10_000_000_000];

const PERIOD_CHOICES = [
  { name: 'All time', value: 'all' },
  { name: 'Daily',    value: 'daily' },
  { name: 'Weekly',   value: 'weekly' },
  { name: 'Monthly',  value: 'monthly' },
];

const BOARD_CHOICES = [
  { name: 'Kills',          value: 'kills'  },
  { name: 'Loot',           value: 'loot'   },
  { name: 'Deaths',         value: 'graves' },
  { name: 'Profit & Loss',  value: 'pnl'    },
];

const RANKS = [
  { min: 100, title: '☠️ Crater Champion' },
  { min:  50, title: '🔥 The Ruthless'    },
  { min:  30, title: '⚔️ Crater Warrior'  },
  { min:  15, title: '💀 Skull Carrier'   },
  { min:   5, title: '🗡️ Raider'          },
  { min:   0, title: '🪦 Initiate'        },
];

function getRank(allTimeKills) {
  for (const r of RANKS) if (allTimeKills >= r.min) return r.title;
  return RANKS[RANKS.length - 1].title;
}

// ─── Regex ───────────────────────────────────────────────────────────────────
// Both patterns stop at the closing paren of the GP amount so OSRS's randomised
// taunt suffix ("Perhaps they should stick to skilling." etc.) doesn't break us.
const LOOT_RE  = /^(.+?)\s+has\s+defeated\s+(.+?)\s+and\s+received\s+\(\s*([\d,]+)\s*coins\s*\)/i;
const DEATH_RE = /^(.+?)\s+has\s+been\s+defeated\s+by\s+(.+?)\s+in\s+The\s+Wilderness\s+and\s+lost\s+\(\s*([\d,]+)\s*(?:coins\s*)?\)/i;
const CLOG_RE  = /^(.+?)\s+received a new collection log item:\s*(.+?)$/i;
const CLOG_COUNT_RE = /\((\d+)\s*\/\s*\d+\)\s*$/;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ci = s => (s ?? '').toLowerCase().trim();

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

function fmtGP(n) {
  if (n >= 1_000_000_000) return `${+(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `${+(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtNet(n) {
  return (n >= 0 ? '+' : '') + fmtGP(n);
}

function parseGP(s) {
  if (!s) return 0;
  const l = String(s).toLowerCase().replace(/,/g, '');
  if (l.endsWith('b')) return Math.round(parseFloat(l) * 1_000_000_000);
  if (l.endsWith('m')) return Math.round(parseFloat(l) * 1_000_000);
  if (l.endsWith('k')) return Math.round(parseFloat(l) * 1_000);
  return parseInt(l, 10) || 0;
}

function gpColor(gp) {
  if (gp >= 100_000_000) return COLOR_INSANE;
  if (gp >= 10_000_000)  return COLOR_HUGE;
  if (gp >= 1_000_000)   return COLOR_BIG;
  if (gp >= 100_000)     return COLOR_NORMAL;
  return COLOR_TINY;
}

function periodFilter(entry, period) {
  if (!period || period === 'all') return true;
  const age = Date.now() - (entry.timestamp ?? 0);
  if (period === 'daily')   return age < 86_400_000;
  if (period === 'weekly')  return age < 7 * 86_400_000;
  if (period === 'monthly') return age < 30 * 86_400_000;
  return true;
}

function utcDay() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function medal(rank) {
  return `\`${String(rank).padStart(2)}.\``;
}

// Joins formatted leaderboard lines into a single field value that fits within
// Discord's 1024-character embed-field-value limit. Drops whole rows from the
// tail rather than truncating mid-line, and adds a "…and N more" footer when
// anything was dropped.
function fitField(lines, fallback = '*No data*', maxLen = 1024) {
  if (!lines || lines.length === 0) return fallback;
  const kept = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const extra = line.length + (kept.length ? 1 : 0); // +1 for joining newline
    // Reserve space for a potential "…and N more" footer
    const remaining = lines.length - kept.length - 1;
    const footer = remaining > 0 ? `\n*…and ${remaining} more*` : '';
    if (used + extra + footer.length > maxLen) break;
    kept.push(line);
    used += extra;
  }
  const dropped = lines.length - kept.length;
  return kept.join('\n') + (dropped > 0 ? `\n*…and ${dropped} more*` : '');
}

// ─── Tenants ─────────────────────────────────────────────────────────────────
// One Tenant object per registered clan. Crater is special-cased: it uses the
// pre-existing killfeed_*.json files and never expires.

function makeTenant({ slug, displayName, clanNameLower, guildId, killChannelId, craterChannelId, iconUrl, expiresAt, addedAt, addedBy, files, isDefault }) {
  return {
    slug,
    displayName,
    clanNameLower,
    guildId: guildId ?? null,
    killChannelId: killChannelId ?? null,
    craterChannelId: craterChannelId ?? null,
    iconUrl: iconUrl ?? null,
    expiresAt: expiresAt ?? null,
    addedAt: addedAt ?? Date.now(),
    addedBy: addedBy ?? null,
    isDefault: !!isDefault,
    files,
    // in-memory state
    killLog: [],
    lootLog: [],
    deathLog: [],
    accounts: {},
    rsnMap: {},
    killStreaks: {},
    firstBloodDay: '',
    liveBoards: {},
    // collection-log tracking (off by default)
    clogEnabled: false,
    clogChannelId: null,        // their server's clog channel
    clogCraterChannelId: null,  // dedicated Crater channel mirror for this clan's clog drops
    collectionLog: [], // [{ player, item, logCount, timestamp }]
    clogComp: null,    // { name, startTime, endTime|null }
  };
}

// slug → Tenant
const tenants = new Map();
// lowercase clan name → slug
const tenantByClan = new Map();
// guildId → slug
const tenantByGuild = new Map();

function rebuildIndexes() {
  tenantByClan.clear();
  tenantByGuild.clear();
  for (const t of tenants.values()) {
    if (t.clanNameLower) tenantByClan.set(t.clanNameLower, t.slug);
    if (t.guildId) tenantByGuild.set(t.guildId, t.slug);
  }
}

function craterTenant() {
  return tenants.get('crater');
}

function isExpired(t) {
  return t.expiresAt != null && Date.now() >= t.expiresAt;
}

function tenantForGuild(guildId) {
  if (guildId && tenantByGuild.has(guildId)) {
    return tenants.get(tenantByGuild.get(guildId));
  }
  if (CRATER_GUILD_ID && guildId && guildId !== CRATER_GUILD_ID) {
    return null;
  }
  return craterTenant();
}

function tenantForClanName(rawClan) {
  const key = ci(rawClan);
  if (!key) return null;
  const slug = tenantByClan.get(key);
  return slug ? tenants.get(slug) : null;
}

// ─── State per tenant ────────────────────────────────────────────────────────
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CLANS_DIR)) fs.mkdirSync(CLANS_DIR, { recursive: true });
}

function ensureTenantDir(t) {
  const dir = path.dirname(t.files.state);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadTenant(t) {
  try {
    const s = JSON.parse(fs.readFileSync(t.files.state, 'utf8'));
    t.killLog       = s.killLog       ?? [];
    t.lootLog       = s.lootLog       ?? [];
    t.deathLog      = s.deathLog      ?? [];
    t.killStreaks   = s.killStreaks   ?? {};
    t.firstBloodDay = s.firstBloodDay ?? '';
    // Collection log persistence — new fields, default off
    t.collectionLog       = s.collectionLog       ?? [];
    t.clogEnabled         = !!s.clogEnabled;
    t.clogChannelId       = s.clogChannelId       ?? null;
    t.clogCraterChannelId = s.clogCraterChannelId ?? null;
    t.clogComp            = s.clogComp            ?? null;

    // Migrate old liveBoards format (keyed by type) to new format (keyed by channelId_type)
    const raw = s.liveBoards ?? {};
    const OLD_TYPES = new Set(['kills','loot','graves','overview','pnl']);
    t.liveBoards = {};
    for (const [k, v] of Object.entries(raw)) {
      if (OLD_TYPES.has(k) && v?.channelId) {
        t.liveBoards[`${v.channelId}_${k}`] = { type: k, ...v };
      } else {
        t.liveBoards[k] = v;
      }
    }
  } catch {}

  try { t.accounts = JSON.parse(fs.readFileSync(t.files.accounts, 'utf8')); } catch { t.accounts = {}; }
  try { t.rsnMap   = JSON.parse(fs.readFileSync(t.files.rsnmap,   'utf8')); } catch { t.rsnMap   = {}; }

  rebuildRsnMap(t);
}

function saveTenant(t) {
  ensureTenantDir(t);
  fs.writeFileSync(t.files.state, JSON.stringify({
    killLog: t.killLog,
    lootLog: t.lootLog,
    deathLog: t.deathLog,
    killStreaks: t.killStreaks,
    firstBloodDay: t.firstBloodDay,
    liveBoards: t.liveBoards,
    collectionLog: t.collectionLog,
    clogEnabled: t.clogEnabled,
    clogChannelId: t.clogChannelId,
    clogCraterChannelId: t.clogCraterChannelId,
    clogComp: t.clogComp,
  }, null, 2));
  fs.writeFileSync(t.files.accounts, JSON.stringify(t.accounts, null, 2));
  fs.writeFileSync(t.files.rsnmap,   JSON.stringify(t.rsnMap,   null, 2));
  if (t.isDefault) queueGitBackup();
}

function saveAllTenants() {
  for (const t of tenants.values()) saveTenant(t);
}

function saveRegistry() {
  ensureDirs();
  const out = {};
  for (const t of tenants.values()) {
    if (t.isDefault) continue;
    out[t.slug] = {
      slug: t.slug,
      displayName: t.displayName,
      clanNameLower: t.clanNameLower,
      guildId: t.guildId,
      killChannelId: t.killChannelId,
      craterChannelId: t.craterChannelId,
      iconUrl: t.iconUrl,
      expiresAt: t.expiresAt,
      addedAt: t.addedAt,
      addedBy: t.addedBy,
    };
  }
  fs.writeFileSync(CLANS_FILE, JSON.stringify(out, null, 2));
}

// ─── Settings (communal channel) ─────────────────────────────────────────────
let settings = { communalChannelId: null };

function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { settings = { communalChannelId: null }; }
}
function saveSettings() {
  ensureDirs();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}
function communalChannelId() {
  return settings.communalChannelId ?? COMMUNAL_CHANNEL_ENV;
}

// ─── Global accounts registry ────────────────────────────────────────────────
// Registering an RSN in ANY tenant server adds it here, so every tenant's
// killfeed/leaderboards can resolve that RSN to the same Discord UID.
// Per-tenant t.rsnMap is still consulted first (preserves any legacy
// per-server overrides), then we fall back to this global map.
let globalAccounts = {};   // { userId: [rsn, ...] }
let globalRsnMap   = {};   // { rsnLower: userId }

function rebuildGlobalRsnMap() {
  globalRsnMap = {};
  for (const [uid, rsns] of Object.entries(globalAccounts))
    for (const r of rsns) {
      globalRsnMap[ci(r)] = uid;
      rememberRSN(r);
    }
}

function loadGlobalAccounts() {
  try { globalAccounts = JSON.parse(fs.readFileSync(GLOBAL_ACCOUNTS_FILE, 'utf8')); } catch { globalAccounts = {}; }
  rebuildGlobalRsnMap();
}

function saveGlobalAccounts() {
  ensureDirs();
  fs.writeFileSync(GLOBAL_ACCOUNTS_FILE, JSON.stringify(globalAccounts, null, 2));
  queueGitBackup();
}

// One-time union of every tenant's existing accounts into the global registry.
// Safe to re-run: Set-dedup means rerunning is a no-op. Per-tenant files are
// left intact as a backup.
function migrateLegacyAccountsToGlobal() {
  let changed = false;
  for (const t of tenants.values()) {
    for (const [uid, rsns] of Object.entries(t.accounts ?? {})) {
      const before = new Set((globalAccounts[uid] ?? []).map(ci));
      const merged = [...(globalAccounts[uid] ?? [])];
      for (const r of rsns) {
        if (!before.has(ci(r))) {
          merged.push(r);
          before.add(ci(r));
          changed = true;
        }
      }
      if (merged.length) globalAccounts[uid] = merged;
    }
  }
  if (changed) {
    rebuildGlobalRsnMap();
    saveGlobalAccounts();
    console.log(`[KILLFEED] Migrated legacy per-tenant accounts into global registry (${Object.keys(globalAccounts).length} users).`);
  }
}

function addGlobalRSNs(userId, rsns) {
  globalAccounts[userId] = [...new Set([...(globalAccounts[userId] ?? []), ...rsns])];
  rebuildGlobalRsnMap();
  saveGlobalAccounts();
  for (const r of rsns) notifyAssociation(userId, r, 'register');
}

function removeGlobalRSNs(userId, rsns) {
  const lower = new Set(rsns.map(ci));
  globalAccounts[userId] = (globalAccounts[userId] ?? []).filter(r => !lower.has(ci(r)));
  if (globalAccounts[userId].length === 0) delete globalAccounts[userId];
  rebuildGlobalRsnMap();
  saveGlobalAccounts();
}

function replaceGlobalRSNs(userId, rsns) {
  globalAccounts[userId] = [...new Set(rsns)];
  if (globalAccounts[userId].length === 0) delete globalAccounts[userId];
  rebuildGlobalRsnMap();
  saveGlobalAccounts();
  for (const r of rsns) notifyAssociation(userId, r, 'register');
}

function linkGlobalRSN(rsn, userId) {
  // Drop the RSN from whoever currently owns it, then attach to the new owner.
  const low = ci(rsn);
  const prevUid = globalRsnMap[low];
  if (prevUid && globalAccounts[prevUid]) {
    globalAccounts[prevUid] = globalAccounts[prevUid].filter(r => ci(r) !== low);
    if (globalAccounts[prevUid].length === 0) delete globalAccounts[prevUid];
  }
  globalAccounts[userId] = [...new Set([...(globalAccounts[userId] ?? []), rsn])];
  rebuildGlobalRsnMap();
  saveGlobalAccounts();
  notifyAssociation(userId, rsn, 'register');
}

function unlinkGlobalRSN(rsn) {
  const low = ci(rsn);
  const uid = globalRsnMap[low];
  if (!uid) return null;
  globalAccounts[uid] = (globalAccounts[uid] ?? []).filter(r => ci(r) !== low);
  if (globalAccounts[uid].length === 0) delete globalAccounts[uid];
  rebuildGlobalRsnMap();
  saveGlobalAccounts();
  return uid;
}

function getGlobalRSNs(userId) {
  return globalAccounts[userId] ?? [];
}

function loadRegistry() {
  ensureDirs();

  // Always create Crater tenant from env
  const crater = makeTenant({
    slug: 'crater',
    displayName: 'The Crater',
    clanNameLower: CLAN_FILTER,
    guildId: CRATER_GUILD_ID,
    killChannelId: KILL_CHANNEL,
    expiresAt: null,
    isDefault: true,
    files: { state: KF('state'), accounts: KF('accounts'), rsnmap: KF('rsnmap') },
  });
  tenants.set(crater.slug, crater);
  loadTenant(crater);

  // Load guest clans
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CLANS_FILE, 'utf8')); } catch { raw = {}; }

  for (const [slug, cfg] of Object.entries(raw)) {
    if (slug === 'crater') continue;
    const t = makeTenant({
      slug,
      displayName: cfg.displayName ?? slug,
      clanNameLower: ci(cfg.clanNameLower ?? cfg.clanName ?? slug),
      guildId: cfg.guildId ?? null,
      killChannelId: cfg.killChannelId ?? null,
      craterChannelId: cfg.craterChannelId ?? null,
      iconUrl: cfg.iconUrl ?? null,
      expiresAt: cfg.expiresAt ?? null,
      addedAt: cfg.addedAt ?? Date.now(),
      addedBy: cfg.addedBy ?? null,
      isDefault: false,
      files: GUEST_FILES(slug),
    });
    tenants.set(slug, t);
    loadTenant(t);
  }

  rebuildIndexes();
}

// ─── Git backup ──────────────────────────────────────────────────────────────
let gitTimer = null;
function queueGitBackup() {
  if (!GITHUB_PAT || !GITHUB_REPO) return;
  clearTimeout(gitTimer);
  gitTimer = setTimeout(async () => {
    try {
      const remote = `https://${GITHUB_ACTOR}:${GITHUB_PAT}@github.com/${GITHUB_REPO}.git`;
      const g = (...a) => new Promise(r => execFile('git', a, { cwd: __dirname }, (_, o) => r(o)));
      await g('config', 'user.name', GIT_NAME);
      await g('config', 'user.email', GIT_EMAIL);
      await g('remote', 'set-url', 'origin', remote);
      await g('add', 'data/');
      await g('commit', '-m', `auto-save ${new Date().toISOString()}`);
      await g('push', 'origin', GITHUB_BRANCH);
    } catch {}
  }, 5 * 60 * 1000);
}

// ─── RSN ↔ Discord (per-tenant) ──────────────────────────────────────────────
function rebuildRsnMap(t) {
  const overrides = { ...t.rsnMap };
  t.rsnMap = overrides;
  for (const [uid, rsns] of Object.entries(t.accounts))
    for (const r of rsns) {
      t.rsnMap[ci(r)] = uid;
      rememberRSN(r); // registered RSNs preserve their original case
    }
}

// Resolve an RSN to a Discord UID:
//   1. Tenant override (legacy / explicit per-tenant link)
//   2. Global registry (registering in ANY tenant server is recognised here)
//   3. Bare RSN
function playerKey(t, rsnLower) {
  return t.rsnMap[rsnLower] ?? globalRsnMap[rsnLower] ?? rsnLower;
}

// Re-resolve a log entry's key against the CURRENT rsnMap, so registrations
// added after the kill/death/loot was logged still aggregate retroactively.
// Falls back to the stored key when the RSN field is missing on legacy entries.
function liveKey(t, rsn, fallback) {
  if (rsn) return playerKey(t, rsn);
  return fallback;
}

// Best-known original case for an RSN (e.g. "S Plit", "GJP"), keyed by ci(rsn).
// Populated from log entries at load and from every new kill/death — so repeat
// PKers keep whatever case Dink first reported. Title-case is used as fallback.
const rsnCase = new Map();

function rememberRSN(rsn) {
  if (!rsn) return;
  const key = ci(rsn);
  if (!key) return;
  // Only overwrite if the stored value looks lowercased/ungroomed
  const existing = rsnCase.get(key);
  if (!existing || existing === existing.toLowerCase()) rsnCase.set(key, rsn);
}

function titleCaseRSN(s) {
  // Split on whitespace runs so multi-word RSNs keep their spacing.
  return s.split(/(\s+)/).map(w => {
    if (!w || /^\s+$/.test(w)) return w;
    return w[0].toUpperCase() + w.slice(1);
  }).join('');
}

async function displayName(key, guild) {
  if (!key) return 'Unknown';
  if (/^\d{17,19}$/.test(key)) {
    try {
      const m = await guild.members.fetch(key);
      return m.displayName;
    } catch { return `<@${key}>`; }
  }
  // Plain RSN key — prefer the originally-observed casing if we have it.
  return rsnCase.get(key) ?? titleCaseRSN(key);
}

// ─── Embed factory ───────────────────────────────────────────────────────────
// Crater uses the Crater logo as thumbnail + plain footer.
// Guest clans get a partnership look: their logo as the thumbnail + author
// line. The author line is hyperlinked to the Crater invite so clicking the
// clan name in the embed jumps anyone curious straight to Crater. Footer
// reads "Powered by The Crater · discord.gg/thecrater" with the Crater logo.
function mkEmbed(t, color) {
  const builder = new EmbedBuilder()
    .setColor(color)
    .setTimestamp();

  if (t.isDefault) {
    builder
      .setThumbnail(EMBED_ICON)
      .setFooter({ text: t.displayName });
  } else {
    const thumb = t.iconUrl ?? EMBED_ICON;
    builder
      .setAuthor({ name: t.displayName, iconURL: thumb, url: CRATER_INVITE_LINK })
      .setThumbnail(thumb)
      .setFooter({ text: `Powered by The Crater  ·  ${CRATER_INVITE}`, iconURL: EMBED_ICON });
  }

  return builder;
}

// ─── Dedup ───────────────────────────────────────────────────────────────────
const seen = new Map();
function isDup(key) {
  const now = Date.now();
  if (seen.has(key) && now - seen.get(key) < DEDUP_MS) return true;
  seen.set(key, now);
  return false;
}
setInterval(() => { const cut = Date.now() - DEDUP_MS * 2; for (const [k, ts] of seen) if (ts < cut) seen.delete(k); }, 60_000);

// ─── Streak helpers (per tenant) ─────────────────────────────────────────────
function addKill(t, key) {
  if (!t.killStreaks[key]) t.killStreaks[key] = { current: 0, best: 0 };
  t.killStreaks[key].current++;
  if (t.killStreaks[key].current > t.killStreaks[key].best) t.killStreaks[key].best = t.killStreaks[key].current;
  return t.killStreaks[key].current;
}
function resetStreak(t, key) { if (t.killStreaks[key]) t.killStreaks[key].current = 0; }

// ─── Send embed ──────────────────────────────────────────────────────────────
let discordClient = null;
async function sendEmbed(channelId, embed) {
  if (!channelId || !discordClient) return;
  try {
    const ch = await discordClient.channels.fetch(channelId);
    await ch.send({ embeds: [embed] });
  } catch (e) {
    console.error(`[KILLFEED] sendEmbed to ${channelId}:`, e.message);
  }
}

// Mirror a guest tenant's embed to its dedicated Crater channel (per-clan) AND
// to the global communal channel if one is set. Crater (default tenant) never mirrors.
async function mirrorToCommunal(t, embed) {
  if (t.isDefault) return;
  const targets = new Set();
  if (t.craterChannelId) targets.add(t.craterChannelId);
  const communal = communalChannelId();
  if (communal) targets.add(communal);
  targets.delete(t.killChannelId); // never double-post to the same channel
  for (const chId of targets) {
    const mirrored = EmbedBuilder.from(embed.data).setFooter({ text: `${t.displayName} · via The Crater` });
    await sendEmbed(chId, mirrored);
  }
}

// ─── Loot processing (per tenant) ────────────────────────────────────────────
async function processLoot(t, killerRSN, victimRSN, gp) {
  if (isDup(`${t.slug}|L|${ci(killerRSN)}|${ci(victimRSN)}|${gp}`)) return;
  if (gp < MIN_LOOT_GP) return;
  if (!t.killChannelId) { console.warn(`[KILLFEED] ${t.slug}: no kill channel set`); return; }

  rememberRSN(killerRSN);
  rememberRSN(victimRSN);

  const kci  = ci(killerRSN);
  const vci  = ci(victimRSN);
  const kKey = playerKey(t, kci);
  const vKey = playerKey(t, vci);

  // Tell /whois we observed these RSNs in action (if they resolve to a UID).
  if (/^\d{17,19}$/.test(kKey)) notifyAssociation(kKey, killerRSN, 'observe');
  if (/^\d{17,19}$/.test(vKey)) notifyAssociation(vKey, victimRSN, 'observe');

  const streak = addKill(t, kKey);
  resetStreak(t, vKey);

  const now = Date.now();
  t.killLog.push({ killer: kKey, killerRSN: kci, victim: vKey, victimRSN: vci, gp, timestamp: now });
  t.lootLog.push({ killer: kKey, killerRSN: kci, victim: vKey, victimRSN: vci, gp, timestamp: now });

  const killerLabel = /^\d{17,19}$/.test(kKey) ? `<@${kKey}>` : killerRSN;
  const victimLabel = /^\d{17,19}$/.test(vKey) ? `<@${vKey}>` : victimRSN;

  // First Blood of the day
  const today = utcDay();
  if (t.firstBloodDay !== today) {
    t.firstBloodDay = today;
    const fb = mkEmbed(t, 0xFF0000)
      .setTitle(`🩸 First Blood — ${killerRSN} draws first blood!`)
      .setDescription(`${killerLabel} opens the day by slaying ${victimLabel}\nLooted **${fmtGP(gp)} GP**`);
    await sendEmbed(t.killChannelId, fb);
    await mirrorToCommunal(t, fb);
  }

  const embed = mkEmbed(t, gpColor(gp))
    .setTitle(`☠️  ${killerRSN} slayed ${victimRSN}`)
    .setDescription(`${killerLabel} looted **${fmtGP(gp)} GP** from ${victimLabel}\n*(${gp.toLocaleString()} coins)*`);

  if (streak >= 3) embed.addFields({ name: '🔥 Kill Streak', value: `${streak} in a row!`, inline: true });

  await sendEmbed(t.killChannelId, embed);
  await mirrorToCommunal(t, embed);

  if (STREAK_MILESTONES.has(streak)) {
    const sembed = mkEmbed(t, 0xFF6600)
      .setTitle(`🔥 ${killerRSN} is on a ${streak}-KILL STREAK!`)
      .setDescription(`${killerLabel} has killed ${streak} players without dying!`);
    await sendEmbed(t.killChannelId, sembed);
    await mirrorToCommunal(t, sembed);
  }

  const killerTotal = t.lootLog.filter(e => e.killer === kKey).reduce((s, e) => s + (e.gp ?? 0), 0);
  for (const m of LOOT_MILESTONES) {
    if (killerTotal - gp < m && killerTotal >= m) {
      const mlEmbed = mkEmbed(t, 0xFFD700)
        .setTitle(`💰 ${killerRSN} hit ${fmtGP(m)} total loot!`)
        .setDescription(`${killerLabel} has now looted **${fmtGP(killerTotal)} GP** in total!`);
      await sendEmbed(t.killChannelId, mlEmbed);
      await mirrorToCommunal(t, mlEmbed);
    }
  }

  saveTenant(t);
}

// ─── Death processing (per tenant) ───────────────────────────────────────────
async function processDeath(t, playerRSN, killedByRSN, gp = 0) {
  const pci = ci(playerRSN);
  const kci = killedByRSN ? ci(killedByRSN) : null;
  if (isDup(`${t.slug}|D|${pci}|${kci ?? ''}|${Math.floor(Date.now() / DEDUP_MS)}`)) return;
  if (!t.killChannelId) return;

  rememberRSN(playerRSN);
  if (killedByRSN) rememberRSN(killedByRSN);

  const pKey = playerKey(t, pci);
  const kKey = kci ? playerKey(t, kci) : null;
  if (/^\d{17,19}$/.test(pKey)) notifyAssociation(pKey, playerRSN, 'observe');
  if (kKey && /^\d{17,19}$/.test(kKey)) notifyAssociation(kKey, killedByRSN, 'observe');

  resetStreak(t, playerKey(t, pci));
  t.deathLog.push({ player: playerKey(t, pci), playerRSN: pci, killedBy: kci ? playerKey(t, kci) : null, killedByRSN: kci, gp, timestamp: Date.now() });

  const desc = kci
    ? `Killed by **${killedByRSN}**${gp > 0 ? ` · Lost **${fmtGP(gp)} GP**` : ''}`
    : `Died in the wilderness.${gp > 0 ? ` Lost **${fmtGP(gp)} GP**` : ''}`;

  const dembed = mkEmbed(t, 0x880000)
    .setTitle(`💀 ${playerRSN} has died!`)
    .setDescription(desc);
  await sendEmbed(t.killChannelId, dembed);
  await mirrorToCommunal(t, dembed);
  saveTenant(t);
}

// ─── Collection log processing (per tenant) ─────────────────────────────────
async function processClog(t, player, item) {
  if (!t.clogEnabled) return;
  if (!player || !item) return;

  // Dedup on tenant+player+item — clan members all broadcasting the same drop
  if (isDup(`${t.slug}|C|${ci(player)}|${ci(item)}`)) return;

  // Capture the "(32/1609)" suffix as the player's running total
  const m = CLOG_COUNT_RE.exec(item);
  const logCount = m ? parseInt(m[1], 10) : null;

  rememberRSN(player);

  // /whois observation: if the clog-dropping RSN resolves to a UID, log it.
  const pKey = playerKey(t, ci(player));
  if (/^\d{17,19}$/.test(pKey)) notifyAssociation(pKey, player, 'observe');

  const entry = { player, item, logCount, timestamp: Date.now() };
  t.collectionLog.push(entry);

  // Build the embed once (partnership branding when guest)
  const embed = mkEmbed(t, 0xFF6B35)
    .setTitle('📜 Collection Log Item')
    .setDescription(`**${player}** received a new collection log item:\n\n**${item}**`);

  // Post to each configured channel exactly once (skip duplicates if the same id is set in both fields)
  const targets = new Set();
  if (t.clogChannelId)        targets.add(t.clogChannelId);
  if (t.clogCraterChannelId)  targets.add(t.clogCraterChannelId);
  for (const chId of targets) await sendEmbed(chId, embed);

  saveTenant(t);
}

// ─── Express + Webhook ───────────────────────────────────────────────────────
const app    = express();
const upload = multer();
app.use(express.json());

app.get('/',               (_req, res) => res.send('OK'));
app.get('/health',         (_req, res) => res.send('OK'));
app.get('/data/download',  (_req, res) => res.download(KF('state')));

app.post('/dink', (req, res, next) => {
  const ct = req.headers['content-type'] ?? '';
  ct.includes('multipart/form-data') ? upload.any()(req, res, next) : next();
}, async (req, res) => {
  try {
    let payload = req.body?.payload_json
      ? (typeof req.body.payload_json === 'string' ? JSON.parse(req.body.payload_json) : req.body.payload_json)
      : req.body;

    const rawMsg  = payload?.embeds?.[0]?.description ?? payload?.content ?? payload?.message ?? '';
    const rawClan = payload?.clanName ?? payload?.clan_name ?? payload?.source ?? payload?.clanTag ?? payload?.clan ?? '';
    console.log('[DINK]', JSON.stringify({ type: payload?.type, clan: rawClan, msg: rawMsg.slice(0, 200) }));

    const tenant = tenantForClanName(rawClan);
    if (!tenant) {
      const known = [...tenantByClan.keys()].join(', ') || '(none registered)';
      console.log(`[KILLFEED] /dink no tenant for clan "${rawClan}" — known: ${known}`);
      return res.status(200).send('ignored');
    }
    if (isExpired(tenant)) {
      console.log(`[KILLFEED] /dink "${tenant.slug}" is expired — dropping`);
      return res.status(200).send('expired');
    }
    console.log(`[KILLFEED] /dink → "${tenant.slug}" (${tenant.displayName}) → channel ${tenant.killChannelId}`);

    // Try raw message first, then extract content from inside a code block (Dink chat notifications
    // wrap the game message in ```...``` — e.g. "PlayerName received a chat message:\n\n```\nX has defeated Y...\n```")
    const codeBlockMatch = /```\s*([\s\S]+?)\s*```/.exec(rawMsg);
    const candidates = codeBlockMatch ? [rawMsg, codeBlockMatch[1]] : [rawMsg];

    for (const message of candidates) {
      const lootMatch = LOOT_RE.exec(message);
      if (lootMatch) {
        const gp = parseInt(lootMatch[3].replace(/,/g, ''), 10);
        if (!isNaN(gp)) { await processLoot(tenant, lootMatch[1].trim(), lootMatch[2].trim(), gp); return res.status(200).send('ok'); }
      }

      const deathMatch = DEATH_RE.exec(message);
      if (deathMatch) {
        const gp = parseInt(deathMatch[3].replace(/,/g, ''), 10) || 0;
        await processDeath(tenant, deathMatch[1].trim(), deathMatch[2].trim(), gp);
        return res.status(200).send('ok');
      }

      // Collection log — only attempted if the tenant has enabled it
      if (tenant.clogEnabled) {
        const clogMatch = CLOG_RE.exec(message);
        if (clogMatch) {
          await processClog(tenant, clogMatch[1].trim(), clogMatch[2].trim());
          return res.status(200).send('ok');
        }
      }
    }

    const inner = codeBlockMatch ? codeBlockMatch[1] : rawMsg;
    console.log(`[KILLFEED] /dink "${tenant.slug}" no regex match — body: ${inner.slice(0, 200)}`);
    res.status(200).send('no match');
  } catch (e) { console.error('[KILLFEED] /dink:', e.message); res.status(500).send('error'); }
});

// Legacy debug endpoints route to Crater only.
app.post('/logLoot', async (req, res) => {
  const { lootMessage } = req.body ?? {};
  if (!lootMessage) return res.status(400).send('bad request');
  const m = LOOT_RE.exec(lootMessage.trim());
  if (!m) return res.status(400).send('bad format');
  await processLoot(craterTenant(), m[1].trim(), m[2].trim(), parseInt(m[3].replace(/,/g, ''), 10));
  res.status(200).send('ok');
});

app.post('/logKill', async (req, res) => {
  const t = craterTenant();
  const { killer, victim } = req.body ?? {};
  if (!killer || !victim) return res.status(400).send('bad data');
  if (isDup(`${t.slug}|K|${ci(killer)}|${ci(victim)}`)) return res.status(200).send('duplicate');
  const kKey = playerKey(t, ci(killer));
  t.killLog.push({ killer: kKey, killerRSN: ci(killer), victim: playerKey(t, ci(victim)), victimRSN: ci(victim), gp: 0, timestamp: Date.now() });
  saveTenant(t);
  res.status(200).send('ok');
});

app.post('/logDeath', async (req, res) => {
  const { player, killedBy, gp } = req.body ?? {};
  if (!player) return res.status(400).send('bad data');
  await processDeath(craterTenant(), player, killedBy ?? null, parseInt(gp ?? '0', 10) || 0);
  res.status(200).send('ok');
});

// ─── Leaderboard builders (per tenant) ───────────────────────────────────────
function buildKillsMap(t, period) {
  const map = {};
  for (const e of t.killLog) {
    if (!periodFilter(e, period)) continue;
    const k = liveKey(t, e.killerRSN, e.killer);
    map[k] = (map[k] ?? 0) + 1;
  }
  return map;
}

function buildLootMap(t, period) {
  const map = {};
  for (const e of t.lootLog) {
    if (!periodFilter(e, period)) continue;
    const k = liveKey(t, e.killerRSN, e.killer);
    map[k] = (map[k] ?? 0) + (e.gp ?? 0);
  }
  return map;
}

function buildDeathMap(t, period) {
  const map = {};
  for (const e of t.deathLog) {
    if (!periodFilter(e, period)) continue;
    const k = liveKey(t, e.playerRSN, e.player);
    map[k] = (map[k] ?? 0) + 1;
  }
  return map;
}

function buildDeathGpMap(t, period) {
  const map = {};
  for (const e of t.deathLog) {
    if (!periodFilter(e, period)) continue;
    const k = liveKey(t, e.playerRSN, e.player);
    map[k] = (map[k] ?? 0) + (e.gp ?? 0);
  }
  return map;
}

function buildPnLMaps(t, period) {
  const earned = {};
  const lost   = {};
  for (const e of t.lootLog) {
    if (!periodFilter(e, period)) continue;
    const k = liveKey(t, e.killerRSN, e.killer);
    if (k) earned[k] = (earned[k] ?? 0) + (e.gp ?? 0);
  }
  for (const e of t.deathLog) {
    if (!periodFilter(e, period)) continue;
    const k = liveKey(t, e.playerRSN, e.player);
    if (k) lost[k] = (lost[k] ?? 0) + (e.gp ?? 0);
  }
  const all = new Set([...Object.keys(earned), ...Object.keys(lost)]);
  const net = {};
  for (const k of all) net[k] = (earned[k] ?? 0) - (lost[k] ?? 0);
  return { earned, lost, net };
}

async function topRows(map, limit, guild) {
  return Promise.all(
    Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit)
      .map(async ([k, v], i) => ({ rank: i + 1, name: await displayName(k, guild), value: v, key: k }))
  );
}

// ─── Graves sort buttons ──────────────────────────────────────────────────────
function gravesSortButtons(sortBy = 'count') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kfsort_count').setLabel('By Deaths').setStyle(sortBy === 'count' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('kfsort_gp').setLabel('By GP Lost').setStyle(sortBy === 'gp'    ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

function boardComponents(type, sortBy = 'count') {
  return type === 'graves' ? [gravesSortButtons(sortBy)] : [];
}

// ─── Board embed builders (per tenant) ───────────────────────────────────────
async function buildBoardEmbed(t, type, guild, opts = {}) {
  const PLABELS = { daily: '📅 Daily', weekly: '📆 Weekly', monthly: '🗓️ Monthly', all: '🏆 All Time' };
  const name = t.displayName;

  if (type === 'kills') {
    const allKills = buildKillsMap(t, 'all');
    const [daily, weekly, monthly, allTime] = await Promise.all([
      topRows(buildKillsMap(t, 'daily'),    5, guild),
      topRows(buildKillsMap(t, 'weekly'),   5, guild),
      topRows(buildKillsMap(t, 'monthly'),  5, guild),
      topRows(buildKillsMap(t, 'all'),     10, guild),
    ]);
    const fmt    = rows => fitField(rows.map(r => `${medal(r.rank)}  **${r.name}** — ${r.value}`), '*No data yet*');
    const fmtAll = rows => fitField(rows.map(r => `${medal(r.rank)}  **${r.name}** — ${r.value}  *· ${getRank(allKills[r.key] ?? 0)}*`), '*No data yet*');
    return mkEmbed(t, 0x00CC88)
      .setTitle(`☠️ ${name} — Kill Hiscores`)
      .setDescription(`Total kills logged: **${t.killLog.length}**`)
      .addFields(
        { name: PLABELS.daily,   value: fmt(daily),       inline: false },
        { name: PLABELS.weekly,  value: fmt(weekly),      inline: false },
        { name: PLABELS.monthly, value: fmt(monthly),     inline: false },
        { name: PLABELS.all,     value: fmtAll(allTime),  inline: false },
      );
  }

  if (type === 'loot') {
    const [daily, weekly, monthly, allTime] = await Promise.all([
      topRows(buildLootMap(t, 'daily'),    5, guild),
      topRows(buildLootMap(t, 'weekly'),   5, guild),
      topRows(buildLootMap(t, 'monthly'),  5, guild),
      topRows(buildLootMap(t, 'all'),     10, guild),
    ]);
    const fmt = rows => fitField(rows.map(r => `${medal(r.rank)}  **${r.name}** — ${fmtGP(r.value)} GP`), '*No data yet*');
    const totalGP = t.lootLog.reduce((s, e) => s + (e.gp ?? 0), 0);
    return mkEmbed(t, 0xFFD700)
      .setTitle(`💰 ${name} — Loot Leaderboard`)
      .setDescription(`Clan total: **${fmtGP(totalGP)} GP**`)
      .addFields(
        { name: PLABELS.daily,   value: fmt(daily),    inline: false },
        { name: PLABELS.weekly,  value: fmt(weekly),   inline: false },
        { name: PLABELS.monthly, value: fmt(monthly),  inline: false },
        { name: PLABELS.all,     value: fmt(allTime),  inline: false },
      );
  }

  if (type === 'graves') {
    const sortBy = opts.sortBy ?? 'count';
    const buildDeathRows = async (period, limit) => {
      const counts  = buildDeathMap(t, period);
      const gps     = buildDeathGpMap(t, period);
      const allKeys = new Set([...Object.keys(counts), ...Object.keys(gps)]);
      const entries = [...allKeys].map(k => ({ key: k, count: counts[k] ?? 0, gp: gps[k] ?? 0 }));
      entries.sort((a, b) => sortBy === 'gp' ? b.gp - a.gp : b.count - a.count);
      return Promise.all(entries.slice(0, limit).map(async (e, i) => ({
        rank: i + 1, name: await displayName(e.key, guild), count: e.count, gp: e.gp,
      })));
    };
    const [daily, weekly, monthly, allTime] = await Promise.all([
      buildDeathRows('daily',    5),
      buildDeathRows('weekly',   5),
      buildDeathRows('monthly',  5),
      buildDeathRows('all',     10),
    ]);
    const fmt = rows => fitField(rows.map(r => `${medal(r.rank)}  **${r.name}** — ${r.count} deaths · ${fmtGP(r.gp)} GP`), '*No data yet*');
    const totalDeaths = t.deathLog.length;
    const totalLost   = t.deathLog.reduce((s, e) => s + (e.gp ?? 0), 0);
    const label = sortBy === 'gp' ? `🪦 ${name} — Who Keeps Dying? *(by GP)*` : `🪦 ${name} — Who Keeps Dying?`;
    return mkEmbed(t, 0x880000)
      .setTitle(label)
      .setDescription(`Total deaths: **${totalDeaths}** · Total GP lost: **${fmtGP(totalLost)} GP**`)
      .addFields(
        { name: PLABELS.daily,   value: fmt(daily),   inline: false },
        { name: PLABELS.weekly,  value: fmt(weekly),  inline: false },
        { name: PLABELS.monthly, value: fmt(monthly), inline: false },
        { name: PLABELS.all,     value: fmt(allTime), inline: false },
      );
  }

  if (type === 'pnl') {
    const fmtRow = (r, showBreakdown) => {
      const sign = r.value >= 0 ? '🟢' : '🔴';
      const base = `${medal(r.rank)}  ${sign} **${r.name}** — **${fmtNet(r.value)} GP**`;
      return showBreakdown
        ? `${base}\n   ↑ ${fmtGP(r.earned)} earned · ↓ ${fmtGP(r.lost)} lost`
        : base;
    };

    const buildPnLRows = async (p, limit, showBreakdown) => {
      const { earned, lost, net } = buildPnLMaps(t, p);
      const totalNet = Object.values(net).reduce((s, v) => s + v, 0);
      const sorted   = Object.entries(net).sort((a, b) => b[1] - a[1]).slice(0, limit);
      const rows     = await Promise.all(sorted.map(async ([k, n], i) => ({
        rank: i + 1, key: k, value: n,
        name: await displayName(k, guild),
        earned: earned[k] ?? 0, lost: lost[k] ?? 0,
      })));
      const lines = fitField(rows.map(r => fmtRow(r, showBreakdown)), '*No data yet*');
      return { lines, totalNet };
    };

    const [daily, weekly, monthly, allTime] = await Promise.all([
      buildPnLRows('daily',   5, false),
      buildPnLRows('weekly',  5, false),
      buildPnLRows('monthly', 5, false),
      buildPnLRows('all',    10, true),
    ]);

    const overallNet = allTime.totalNet;
    return mkEmbed(t, overallNet >= 0 ? 0x00CC44 : 0xFF4400)
      .setTitle(`📊 ${name} — Profit & Loss`)
      .setDescription(`Clan all-time net: **${fmtNet(overallNet)} GP**`)
      .addFields(
        { name: `${PLABELS.daily}  ·  Clan: ${fmtNet(daily.totalNet)} GP`,     value: daily.lines,   inline: false },
        { name: `${PLABELS.weekly}  ·  Clan: ${fmtNet(weekly.totalNet)} GP`,   value: weekly.lines,  inline: false },
        { name: `${PLABELS.monthly}  ·  Clan: ${fmtNet(monthly.totalNet)} GP`, value: monthly.lines, inline: false },
        { name: PLABELS.all,                                                    value: allTime.lines, inline: false },
      );
  }
}

// ─── Live board refresh ───────────────────────────────────────────────────────
async function refreshLiveBoard(t, key) {
  const board = t.liveBoards[key];
  if (!board || !discordClient) return;
  try {
    const ch         = await discordClient.channels.fetch(board.channelId);
    const msg        = await ch.messages.fetch(board.messageId);
    const opts       = { sortBy: board.sortBy ?? 'count' };
    const embed      = await buildBoardEmbed(t, board.type, ch.guild, opts);
    const components = boardComponents(board.type, opts.sortBy);
    await msg.edit({ embeds: [embed], components });
    board._failCount = 0;
  } catch (e) {
    board._failCount = (board._failCount ?? 0) + 1;
    console.error(`[KILLFEED] Live board "${t.slug}:${key}" refresh failed (${board._failCount}/5):`, e.message);
    if (board._failCount >= 5) {
      console.warn(`[KILLFEED] Removing live board "${t.slug}:${key}" after 5 consecutive failures.`);
      delete t.liveBoards[key];
      saveTenant(t);
      stopBoardTimer(t, key);
    }
  }
}

// ─── Profile embed builder (shared by /kfprofile and !p) ────────────────────
async function buildProfileEmbed(t, key, guild) {
  const name = await displayName(key, guild);
  const PERIODS = ['daily', 'weekly', 'monthly', 'all'];
  const PLABELS = { daily: '📅 Daily', weekly: '📆 Weekly', monthly: '🗓️ Monthly', all: '🏆 All Time' };

  const kills   = PERIODS.map(p => (buildKillsMap(t, p)[key] ?? 0));
  const loot    = PERIODS.map(p => (buildLootMap(t, p)[key] ?? 0));
  const deaths  = PERIODS.map(p => (buildDeathMap(t, p)[key] ?? 0));
  const deathGp = PERIODS.map(p => (buildDeathGpMap(t, p)[key] ?? 0));
  const pnl     = PERIODS.map(p => {
    const { earned, lost } = buildPnLMaps(t, p);
    return { earned: earned[key] ?? 0, lost: lost[key] ?? 0, net: (earned[key] ?? 0) - (lost[key] ?? 0) };
  });

  const streak   = t.killStreaks[key];
  const allKills = buildKillsMap(t, 'all')[key] ?? 0;

  const fmtKills  = (v, i) => `${PLABELS[PERIODS[i]]}: **${v}**`;
  const fmtLoot   = (v, i) => `${PLABELS[PERIODS[i]]}: **${fmtGP(v)} GP**`;
  const fmtDeaths = (v, i) => `${PLABELS[PERIODS[i]]}: **${v}** · ${fmtGP(deathGp[i])} GP`;
  const fmtPnl    = (v, i) => `${PLABELS[PERIODS[i]]}: ${v.net >= 0 ? '🟢' : '🔴'} **${fmtNet(v.net)} GP**`;

  return mkEmbed(t, 0x5865F2)
    .setTitle(`📋 ${name}`)
    .setDescription(`${getRank(allKills)}${streak ? `  ·  🔥 Current streak: **${streak.current}**  ·  Best: **${streak.best}**` : ''}`)
    .addFields(
      { name: '☠️ Kills',          value: kills.map(fmtKills).join('\n'),   inline: true },
      { name: '💰 Loot',           value: loot.map(fmtLoot).join('\n'),     inline: true },
      { name: '💀 Deaths',         value: deaths.map(fmtDeaths).join('\n'), inline: false },
      { name: '📊 Profit & Loss',  value: pnl.map(fmtPnl).join('\n'),      inline: false },
    );
}

// Character-specific profile: stats are derived from log entries whose RAW
// RSN field matches `rsn` exactly. Unlike buildProfileEmbed which folds by
// resolved key (UID if linked, else RSN) and so combines every character on
// the same Discord account, this isolates a single character. Useful when
// you're trying to verify whether someone is actually the "Craigmuzza" they
// claim to be vs. another account using the same Discord owner's RSN list.
async function buildRSNProfileEmbed(t, rsn, guild) {
  const rsnLo   = ci(rsn);
  const display = rsnCase.get(rsnLo) ?? titleCaseRSN(rsn);
  const PERIODS = ['daily', 'weekly', 'monthly', 'all'];
  const PLABELS = { daily: '📅 Daily', weekly: '📆 Weekly', monthly: '🗓️ Monthly', all: '🏆 All Time' };

  const countKills  = p => t.killLog.filter(e => periodFilter(e, p) && ci(e.killerRSN ?? '') === rsnLo).length;
  const sumLoot     = p => t.lootLog.filter(e => periodFilter(e, p) && ci(e.killerRSN ?? '') === rsnLo).reduce((s, e) => s + (e.gp ?? 0), 0);
  const countDeaths = p => t.deathLog.filter(e => periodFilter(e, p) && ci(e.playerRSN ?? '') === rsnLo).length;
  const sumDeathGP  = p => t.deathLog.filter(e => periodFilter(e, p) && ci(e.playerRSN ?? '') === rsnLo).reduce((s, e) => s + (e.gp ?? 0), 0);

  const kills   = PERIODS.map(countKills);
  const loot    = PERIODS.map(sumLoot);
  const deaths  = PERIODS.map(countDeaths);
  const deathGp = PERIODS.map(sumDeathGP);
  const pnl     = PERIODS.map((_, i) => ({ earned: loot[i], lost: deathGp[i], net: loot[i] - deathGp[i] }));

  const allKills = kills[3]; // 'all' is last

  const fmtKills  = (v, i) => `${PLABELS[PERIODS[i]]}: **${v}**`;
  const fmtLoot   = (v, i) => `${PLABELS[PERIODS[i]]}: **${fmtGP(v)} GP**`;
  const fmtDeaths = (v, i) => `${PLABELS[PERIODS[i]]}: **${v}** · ${fmtGP(deathGp[i])} GP`;
  const fmtPnl    = (v, i) => `${PLABELS[PERIODS[i]]}: ${v.net >= 0 ? '🟢' : '🔴'} **${fmtNet(v.net)} GP**`;

  const ownerUid  = globalRsnMap[rsnLo];
  const ownerLine = ownerUid
    ? `🔗 RSN linked to <@${ownerUid}>`
    : '🔓 *Not linked to a Discord account*';

  // Last active timestamp for this exact RSN
  const lastEntry = [...t.killLog, ...t.deathLog, ...t.lootLog]
    .filter(e => ci(e.killerRSN ?? e.playerRSN ?? '') === rsnLo)
    .reduce((m, e) => Math.max(m, e.timestamp ?? 0), 0);
  const lastLine  = lastEntry ? `\n**Last active:** <t:${Math.floor(lastEntry / 1000)}:R>` : '';

  return mkEmbed(t, 0x5865F2)
    .setTitle(`📋 ${display} — Character Profile`)
    .setDescription(`${getRank(allKills)}\n${ownerLine}${lastLine}`)
    .addFields(
      { name: '☠️ Kills',          value: kills.map(fmtKills).join('\n'),   inline: true },
      { name: '💰 Loot',           value: loot.map(fmtLoot).join('\n'),     inline: true },
      { name: '💀 Deaths',         value: deaths.map(fmtDeaths).join('\n'), inline: false },
      { name: '📊 Profit & Loss',  value: pnl.map(fmtPnl).join('\n'),      inline: false },
    );
}

// ─── Text shortcut: !p in the designated profile channel ────────────────────
// Hardcoded to the Crater profile channel for now; trivial to extend per-tenant
// later if guest clans want the same shortcut.
const KF_PROFILE_CHANNEL_ID = '1511420852195950602';

export async function handleKfShortcut(message) {
  if (message.author?.bot) return;
  if (message.channelId !== KF_PROFILE_CHANNEL_ID) return;
  const content = (message.content ?? '').trim();
  if (!/^!p\b/i.test(content)) return;

  const t = tenantForGuild(message.guildId) ?? craterTenant();
  if (isExpired(t)) return;

  try {
    const embed = await buildProfileEmbed(t, message.author.id, message.guild);
    await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
  } catch (e) {
    console.error('[KILLFEED] !p shortcut failed:', e.message);
  }
}

// ─── Exported helpers (onboarding compat — now global) ──────────────────────
// These were Crater-only when accounts were per-tenant. Now they write to the
// global registry so an onboarding flow in ANY tenant server registers the RSN
// for every clan to see.
export function registerRSNs(userId, rsns) {
  addGlobalRSNs(userId, rsns);
}

export function getAccountRSNs(userId) {
  return getGlobalRSNs(userId);
}

export function removeRSNs(userId, rsns) {
  removeGlobalRSNs(userId, rsns);
}

export function replaceAllRSNs(userId, rsns) {
  replaceGlobalRSNs(userId, rsns);
}

// ─── Exports for /whois ──────────────────────────────────────────────────────
// Lightweight summary of every tenant (no log data — that's what
// getUserActivity is for).
export function getTenantsSummary() {
  return [...tenants.values()].map(t => ({
    slug: t.slug,
    displayName: t.displayName,
    isDefault: t.isDefault,
    guildId: t.guildId,
  }));
}

// Resolve an RSN to its current global owner UID (or null).
export function getRSNOwner(rsn) {
  return globalRsnMap[ci(rsn)] ?? null;
}

// Aggregate every tenant's kill/loot/death/clog activity for a user.
// `rsns` is the user's globally-linked RSN list — we match against both the
// log's resolved key (UID) AND the raw RSN field, so we catch activity from
// before the RSN was linked.
export function getUserActivity(userId, rsns) {
  const keys = new Set([userId, ...(rsns ?? []).map(ci)]);
  const out  = [];
  for (const t of tenants.values()) {
    const kills  = t.killLog.filter(e => keys.has(e.killer)  || keys.has(e.killerRSN));
    const deaths = t.deathLog.filter(e => keys.has(e.player) || keys.has(e.playerRSN));
    const loot   = t.lootLog.filter(e => keys.has(e.killer)  || keys.has(e.killerRSN));
    const lost   = t.deathLog.filter(e => (keys.has(e.player) || keys.has(e.playerRSN)) && (e.gp ?? 0) > 0);
    const clog   = (t.collectionLog ?? []).filter(e => keys.has(ci(e.player)));
    const lootedGP = loot.reduce((s, e) => s + (e.gp ?? 0), 0);
    const lostGP   = lost.reduce((s, e) => s + (e.gp ?? 0), 0);
    const allTs = [...kills, ...deaths, ...loot, ...clog].map(e => e.timestamp ?? 0).filter(Boolean);
    if (kills.length + deaths.length + loot.length + clog.length === 0) continue;
    out.push({
      slug: t.slug,
      displayName: t.displayName,
      kills:  kills.length,
      deaths: deaths.length,
      looted: lootedGP,
      lost:   lostGP,
      net:    lootedGP - lostGP,
      clog:   clog.length,
      firstSeen: allTs.length ? Math.min(...allTs) : null,
      lastSeen:  allTs.length ? Math.max(...allTs) : null,
    });
  }
  return out;
}

// ─── RSN association hook (whois) ────────────────────────────────────────────
// /whois wants to know every time we see "UID X is using RSN Y" — both at
// registration time and from observed in-game activity. The hook is optional
// (whois may not be loaded) so callers no-op if it isn't set.
let _onRSNAssociation = null;
export function setRSNAssociationHook(fn) { _onRSNAssociation = fn; }
function notifyAssociation(uid, rsn, source) {
  try { _onRSNAssociation?.(uid, rsn, source); }
  catch (e) { console.error('[KILLFEED] whois hook failed:', e.message); }
}

// ─── Slash command definitions ───────────────────────────────────────────────
export const killfeedCommands = [

  new SlashCommandBuilder().setName('kfoverview').setDescription('View a leaderboard — shows daily, weekly, monthly & all-time')
    .addStringOption(o => o.setName('type').setDescription('Board type').setRequired(true).addChoices(...BOARD_CHOICES))
    .addStringOption(o => o.setName('slug').setDescription('Crater admin: view another clan\'s board (autocomplete)').setAutocomplete(true)),

  new SlashCommandBuilder().setName('kfstreaks').setDescription('Kill streaks — active and all-time records'),

  new SlashCommandBuilder().setName('kftotalgp').setDescription('Total GP looted by the clan'),

  new SlashCommandBuilder().setName('kfsession').setDescription('Stats since the bot last restarted'),

  new SlashCommandBuilder().setName('kfrivalry').setDescription('Head-to-head record between two players')
    .addStringOption(o => o.setName('player1').setDescription('First player (RSN or @mention)').setRequired(true))
    .addStringOption(o => o.setName('player2').setDescription('Second player (RSN or @mention)').setRequired(true)),

  new SlashCommandBuilder().setName('kfrsn').setDescription('Link in-game names (RSNs) to Discord accounts')
    .addSubcommand(s => s.setName('add').setDescription('Link RSNs to a Discord user')
      .addStringOption(o => o.setName('rsns').setDescription('Comma-separated RSNs').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Discord user (defaults to you)')))
    .addSubcommand(s => s.setName('remove').setDescription('Unlink RSNs from a Discord user')
      .addStringOption(o => o.setName('rsns').setDescription('Comma-separated RSNs').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Discord user (defaults to you)')))
    .addSubcommand(s => s.setName('list').setDescription('View linked RSNs for a user')
      .addUserOption(o => o.setName('user').setDescription('Discord user (defaults to you)')))
    .addSubcommand(s => s.setName('link').setDescription('Manually override RSN → Discord link')
      .addStringOption(o => o.setName('rsn').setDescription('RSN to link').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true)))
    .addSubcommand(s => s.setName('unlink').setDescription('Remove a manual RSN override')
      .addStringOption(o => o.setName('rsn').setDescription('RSN to unlink').setRequired(true)))
    .addSubcommand(s => s.setName('whohas').setDescription('Check which Discord user owns an RSN')
      .addStringOption(o => o.setName('rsn').setDescription('RSN to look up').setRequired(true)))
    .addSubcommand(s => s.setName('refresh').setDescription('Reload the global registry from disk and re-sync all tenants (admin)')),

  new SlashCommandBuilder().setName('kflive').setDescription('Manage auto-refreshing live leaderboards')
    .addSubcommand(s => s.setName('set').setDescription('Post a live leaderboard that auto-refreshes in this channel')
      .addStringOption(o => o.setName('type').setDescription('Board type').setRequired(true).addChoices(...BOARD_CHOICES))
      .addStringOption(o => o.setName('slug').setDescription('Crater admin: pin another clan\'s board here (autocomplete)').setAutocomplete(true)))
    .addSubcommand(s => s.setName('clear').setDescription('Remove a live leaderboard from this channel')
      .addStringOption(o => o.setName('type').setDescription('Board type').setRequired(true).addChoices(...BOARD_CHOICES))
      .addStringOption(o => o.setName('slug').setDescription('Crater admin: target a specific clan (autocomplete)').setAutocomplete(true)))
    .addSubcommand(s => s.setName('list').setDescription('Show all active live leaderboards')),

  new SlashCommandBuilder().setName('kfprofile').setDescription('View all stats for a specific player')
    .addStringOption(o => o.setName('player').setDescription('RSN (this character only) or @mention (whole Discord account)').setRequired(true)),

  new SlashCommandBuilder().setName('kflistall').setDescription('List every RSN registered in the clan'),

  new SlashCommandBuilder().setName('kfhelp').setDescription('All kill feed commands'),

  new SlashCommandBuilder().setName('kfadmin').setDescription('Kill feed admin commands')
    .addSubcommand(s => s.setName('addgp').setDescription('Manually add GP to a player')
      .addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true))
      .addStringOption(o => o.setName('amount').setDescription('Amount e.g. 5m, 100k').setRequired(true)))
    .addSubcommand(s => s.setName('removegp').setDescription('Manually remove GP from a player')
      .addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true))
      .addStringOption(o => o.setName('amount').setDescription('Amount to remove').setRequired(true)))
    .addSubcommand(s => s.setName('addkill').setDescription('Manually log a kill (with optional loot)')
      .addStringOption(o => o.setName('killer').setDescription('Killer RSN or @mention').setRequired(true))
      .addStringOption(o => o.setName('victim').setDescription('Victim RSN or @mention').setRequired(true))
      .addStringOption(o => o.setName('gp').setDescription('Loot amount e.g. 5m, 100k (optional)')))
    .addSubcommand(s => s.setName('adddeath').setDescription('Manually log a death')
      .addStringOption(o => o.setName('player').setDescription('Player who died (RSN or @mention)').setRequired(true))
      .addStringOption(o => o.setName('killed_by').setDescription('Who killed them (optional)'))
      .addStringOption(o => o.setName('gp').setDescription('GP lost e.g. 1m (optional)')))
    .addSubcommand(s => s.setName('removekill').setDescription('Remove the most recent matching kill entry')
      .addStringOption(o => o.setName('killer').setDescription('Killer RSN or @mention').setRequired(true))
      .addStringOption(o => o.setName('victim').setDescription('Victim RSN or @mention').setRequired(true))
      .addStringOption(o => o.setName('gp').setDescription('Exact GP to match e.g. 1m (optional)')))
    .addSubcommand(s => s.setName('removedeath').setDescription('Remove the most recent matching death entry')
      .addStringOption(o => o.setName('player').setDescription('Player who died (RSN or @mention)').setRequired(true))
      .addStringOption(o => o.setName('killed_by').setDescription('Who killed them (optional)'))
      .addStringOption(o => o.setName('gp').setDescription('Exact GP to match (optional)')))
    .addSubcommand(s => s.setName('reset').setDescription("Reset one player's stats")
      .addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true)))
    .addSubcommand(s => s.setName('resetall').setDescription('⚠️ Reset ALL kill feed data')
      .addStringOption(o => o.setName('confirm').setDescription('Type CONFIRM to proceed').setRequired(true)))
    .addSubcommand(s => s.setName('export').setDescription('Export leaderboard as CSV')
      .addStringOption(o => o.setName('type').setDescription('What to export').setRequired(true)
        .addChoices({ name: 'Kill Hiscores', value: 'hiscores' }, { name: 'Loot Board', value: 'lootboard' }, { name: 'Death Board', value: 'deathboard' }))
      .addStringOption(o => o.setName('period').setDescription('Time period').addChoices(...PERIOD_CHOICES))),

  // Guest clan management (Crater admin only)
  new SlashCommandBuilder().setName('kfclan').setDescription('Manage guest clan killfeeds')
    .addSubcommand(s => s.setName('add').setDescription('Register a guest clan (indefinite if days omitted)')
      .addStringOption(o => o.setName('slug').setDescription('Short identifier e.g. infliction').setRequired(true))
      .addStringOption(o => o.setName('clan_name').setDescription('Clan name exactly as it appears in Dink').setRequired(true))
      .addStringOption(o => o.setName('guild_id').setDescription('Their Discord server ID').setRequired(true))
      .addStringOption(o => o.setName('channel_id').setDescription('Their killfeed channel ID (in their server)').setRequired(true))
      .addStringOption(o => o.setName('crater_channel_id').setDescription('Channel in Crater that mirrors this clan\'s kills (optional)'))
      .addStringOption(o => o.setName('icon_url').setDescription('URL to their clan logo (shown as thumbnail; optional)'))
      .addIntegerOption(o => o.setName('days').setDescription('Trial duration in days (omit for indefinite)'))
      .addStringOption(o => o.setName('display').setDescription('Display name (default: clan_name)')))
    .addSubcommand(s => s.setName('remove').setDescription('Deregister a guest clan and DELETE its data')
      .addStringOption(o => o.setName('slug').setDescription('Clan slug').setRequired(true))
      .addStringOption(o => o.setName('confirm').setDescription('Type CONFIRM to proceed').setRequired(true)))
    .addSubcommand(s => s.setName('extend').setDescription('Extend a guest clan trial')
      .addStringOption(o => o.setName('slug').setDescription('Clan slug').setRequired(true))
      .addIntegerOption(o => o.setName('days').setDescription('Additional days').setRequired(true)))
    .addSubcommand(s => s.setName('makeindefinite').setDescription('Remove the expiry from a guest clan')
      .addStringOption(o => o.setName('slug').setDescription('Clan slug').setRequired(true)))
    .addSubcommand(s => s.setName('rename').setDescription('Change a guest clan\'s display name')
      .addStringOption(o => o.setName('slug').setDescription('Clan slug').setRequired(true))
      .addStringOption(o => o.setName('display').setDescription('New display name e.g. "Obsidians"').setRequired(true)))
    .addSubcommand(s => s.setName('icon').setDescription('Set/clear a guest clan\'s logo URL (shown as thumbnail)')
      .addStringOption(o => o.setName('slug').setDescription('Clan slug').setRequired(true))
      .addStringOption(o => o.setName('url').setDescription('Image URL (omit to clear)')))
    .addSubcommand(s => s.setName('list').setDescription('List all registered guest clans'))
    .addSubcommand(s => s.setName('channel').setDescription('Change the killfeed channel (in their server) for a guest clan')
      .addStringOption(o => o.setName('slug').setDescription('Clan slug').setRequired(true))
      .addStringOption(o => o.setName('channel_id').setDescription('New channel ID').setRequired(true)))
    .addSubcommand(s => s.setName('craterchannel').setDescription('Set/change the Crater channel that mirrors this clan')
      .addStringOption(o => o.setName('slug').setDescription('Clan slug').setRequired(true))
      .addStringOption(o => o.setName('channel_id').setDescription('Crater channel ID (empty to clear)')))
    .addSubcommandGroup(g => g.setName('communal').setDescription('Manage the communal Crater channel (mirror of all guests)')
      .addSubcommand(s => s.setName('set').setDescription('Set the communal Crater channel')
        .addStringOption(o => o.setName('channel_id').setDescription('Channel ID in The Crater').setRequired(true)))
      .addSubcommand(s => s.setName('clear').setDescription('Disable mirroring to the communal channel'))
      .addSubcommand(s => s.setName('show').setDescription('Show the current communal channel'))),

  // Communal cross-clan leaderboards (Crater admin only)
  new SlashCommandBuilder().setName('kfcommunal').setDescription('Aggregated leaderboards across all clans')
    .addSubcommand(s => s.setName('kills').setDescription('Combined kill leaderboard (one-shot, only you see)'))
    .addSubcommand(s => s.setName('loot').setDescription('Combined loot leaderboard (one-shot)'))
    .addSubcommand(s => s.setName('deaths').setDescription('Combined deaths leaderboard (one-shot)'))
    .addSubcommand(s => s.setName('pnl').setDescription('Combined profit & loss (one-shot)'))
    .addSubcommandGroup(g => g.setName('live').setDescription('Pin auto-refreshing communal boards in a channel')
      .addSubcommand(s => s.setName('set').setDescription('Post an auto-refreshing communal board in this channel')
        .addStringOption(o => o.setName('type').setDescription('Board type').setRequired(true)
          .addChoices(
            { name: 'Kills',  value: 'kills'  },
            { name: 'Loot',   value: 'loot'   },
            { name: 'Deaths', value: 'deaths' },
            { name: 'P&L',    value: 'pnl'    },
          )))
      .addSubcommand(s => s.setName('clear').setDescription('Remove a communal live board from this channel')
        .addStringOption(o => o.setName('type').setDescription('Board type').setRequired(true)
          .addChoices(
            { name: 'Kills',  value: 'kills'  },
            { name: 'Loot',   value: 'loot'   },
            { name: 'Deaths', value: 'deaths' },
            { name: 'P&L',    value: 'pnl'    },
          )))
      .addSubcommand(s => s.setName('list').setDescription('Show active communal live boards'))),

  // Collection log tracking per clan
  new SlashCommandBuilder().setName('kfclog').setDescription('Collection log tracking')
    .addSubcommand(s => s.setName('enable').setDescription('Enable collection log tracking for this clan (admin)')
      .addStringOption(o => o.setName('channel_id').setDescription('Their server\'s clog channel (optional if reusing one already set)'))
      .addStringOption(o => o.setName('crater_channel_id').setDescription('Dedicated Crater channel mirror for this clan (optional)'))
      .addStringOption(o => o.setName('slug').setDescription('Crater admin: target another clan').setAutocomplete(true)))
    .addSubcommand(s => s.setName('disable').setDescription('Disable collection log tracking (admin)')
      .addStringOption(o => o.setName('slug').setDescription('Crater admin: target another clan').setAutocomplete(true)))
    .addSubcommand(s => s.setName('channel').setDescription('Set/clear their server\'s clog channel (admin; omit channel_id to clear)')
      .addStringOption(o => o.setName('channel_id').setDescription('Channel ID (omit to clear)'))
      .addStringOption(o => o.setName('slug').setDescription('Crater admin: target another clan').setAutocomplete(true)))
    .addSubcommand(s => s.setName('craterchannel').setDescription('Set/clear the Crater mirror channel for this clan\'s clog drops (admin)')
      .addStringOption(o => o.setName('channel_id').setDescription('Crater channel ID (omit to clear)'))
      .addStringOption(o => o.setName('slug').setDescription('Crater admin: target another clan').setAutocomplete(true)))
    .addSubcommand(s => s.setName('status').setDescription('Show current clog configuration (enabled?, channels)')
      .addStringOption(o => o.setName('slug').setDescription('Crater admin: inspect another clan').setAutocomplete(true)))
    .addSubcommand(s => s.setName('listall').setDescription('Show clog configuration for EVERY tenant (Crater admin)'))
    .addSubcommand(s => s.setName('recent').setDescription('Show recent collection log items')
      .addIntegerOption(o => o.setName('count').setDescription('How many to show (default 10, max 25)')))
    .addSubcommand(s => s.setName('board').setDescription('Collection log leaderboard'))
    .addSubcommandGroup(g => g.setName('comp').setDescription('Collection log competitions')
      .addSubcommand(s => s.setName('start').setDescription('Start a competition (admin)')
        .addStringOption(o => o.setName('name').setDescription('Competition name').setRequired(true))
        .addIntegerOption(o => o.setName('days').setDescription('Duration in days (omit for open-ended)')))
      .addSubcommand(s => s.setName('status').setDescription('Show current standings'))
      .addSubcommand(s => s.setName('end').setDescription('End the active competition (admin)'))),
];

// ─── Interaction handler ──────────────────────────────────────────────────────
export async function handleKillfeedInteraction(interaction) {
  // ── Autocomplete for slug option on /kfoverview, /kflive, /kfclog ───
  if (interaction.isAutocomplete && interaction.isAutocomplete()) {
    if (!['kfoverview', 'kflive', 'kfclog'].includes(interaction.commandName)) return false;
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'slug') return false;
    const term = (focused.value ?? '').toLowerCase();
    const choices = [...tenants.values()]
      .filter(t => !term || t.slug.toLowerCase().includes(term) || t.displayName.toLowerCase().includes(term))
      .slice(0, 25)
      .map(t => ({ name: `${t.displayName} (${t.slug})`, value: t.slug }));
    await interaction.respond(choices);
    return true;
  }

  // ── Deaths sort toggle buttons ──────────────────────────────────────
  if (interaction.isButton() && (interaction.customId === 'kfsort_count' || interaction.customId === 'kfsort_gp')) {
    const t = tenantForGuild(interaction.guildId);
    if (!t) return interaction.reply({ content: 'This server is not registered.', ephemeral: true });
    const key   = `${interaction.channelId}_graves`;
    const board = t.liveBoards[key];
    if (!board) return interaction.reply({ content: 'No deaths board found in this channel.', ephemeral: true });
    board.sortBy = interaction.customId === 'kfsort_count' ? 'count' : 'gp';
    saveTenant(t);
    const embed = await buildBoardEmbed(t, 'graves', interaction.guild, { sortBy: board.sortBy });
    await interaction.update({ embeds: [embed], components: [gravesSortButtons(board.sortBy)] });
    return true;
  }

  if (!interaction.isChatInputCommand()) return false;
  const cmd = interaction.commandName;
  const kf  = [
    'kfoverview','kfprofile','kflistall',
    'kfstreaks','kftotalgp','kfsession','kfrivalry',
    'kfrsn','kflive','kfadmin','kfhelp','kfclan','kfcommunal','kfclog',
  ];
  if (!kf.includes(cmd)) return false;

  // /kfclan and /kfcommunal are Crater-admin only and resolved separately
  if (cmd === 'kfclan')     return handleKfClan(interaction);
  if (cmd === 'kfcommunal') return handleKfCommunal(interaction);
  if (cmd === 'kfclog')     return handleKfClog(interaction);

  const t = tenantForGuild(interaction.guildId);
  if (!t) return interaction.reply({ content: 'This server is not registered with the killfeed.', ephemeral: true });
  if (isExpired(t)) return interaction.reply({ content: `⏰ ${t.displayName}'s killfeed trial has expired.`, ephemeral: true });

  // ── /kfoverview ────────────────────────────────────────────────────
  if (cmd === 'kfoverview') {
    await interaction.deferReply({ ephemeral: true });
    const type   = interaction.options.getString('type', true);
    const slug   = interaction.options.getString('slug');

    // Crater admin can target a specific clan via slug
    let target = t;
    if (slug) {
      const isCraterAdmin =
        (!CRATER_GUILD_ID || interaction.guildId === CRATER_GUILD_ID) &&
        interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE);
      if (!isCraterAdmin) return interaction.editReply({ content: '🔒 Only Crater admins can target another clan.' });
      const tgt = tenants.get(slug);
      if (!tgt) return interaction.editReply({ content: `❌ No such clan slug: \`${slug}\`.` });
      target = tgt;
    }

    const key        = `${interaction.channelId}_${type}`;
    const sortBy     = target.liveBoards[key]?.sortBy ?? 'count';
    const embed      = await buildBoardEmbed(target, type, interaction.guild, { sortBy });
    const components = boardComponents(type, sortBy);
    const msg        = await interaction.channel.send({ embeds: [embed], components });
    target.liveBoards[key] = { type, channelId: interaction.channelId, messageId: msg.id, sortBy };
    saveTenant(target);
    startBoardTimer(target, key);
    return interaction.editReply({ content: `✅ Live **${type}** board for **${target.displayName}** posted. Refreshes every ${Math.round(LIVE_REFRESH_MS / 60_000)} minutes.` });
  }

  // ── /kfprofile ─────────────────────────────────────────────────────
  // @mention → combined stats for that Discord account (across every RSN they own).
  // Bare RSN  → stats for THAT specific character only — no aggregation across
  //              the owner's other linked RSNs.
  if (cmd === 'kfprofile') {
    await interaction.deferReply();
    const input   = interaction.options.getString('player', true).trim();
    const mention = input.match(/^<@!?(\d+)>$/)?.[1];

    if (mention) {
      const embed = await buildProfileEmbed(t, mention, interaction.guild);
      return interaction.editReply({ embeds: [embed] });
    }

    const embed = await buildRSNProfileEmbed(t, input, interaction.guild);
    return interaction.editReply({ embeds: [embed] });
  }

  // ── /kfstreaks ─────────────────────────────────────────────────────
  if (cmd === 'kfstreaks') {
    await interaction.deferReply();
    const active  = Object.entries(t.killStreaks).filter(([, v]) => v.current > 0).sort((a, b) => b[1].current - a[1].current).slice(0, 10);
    const allTime = Object.entries(t.killStreaks).sort((a, b) => b[1].best - a[1].best).slice(0, 5);
    const al = await Promise.all(active.map(async ([k, v], i) =>  `\`${String(i+1).padStart(2)}.\` **${await displayName(k, interaction.guild)}** — 🔥 ${v.current}`));
    const at = await Promise.all(allTime.map(async ([k, v], i) => `\`${String(i+1).padStart(2)}.\` **${await displayName(k, interaction.guild)}** — ${v.best}`));
    return interaction.editReply({ embeds: [mkEmbed(t, 0xFF6600).setTitle('🔥 Kill Streaks')
      .addFields({ name: 'Currently Active', value: al.join('\n') || 'None', inline: false }, { name: 'All-Time Records', value: at.join('\n') || 'None', inline: false })] });
  }

  // ── /kftotalgp ─────────────────────────────────────────────────────
  if (cmd === 'kftotalgp') {
    const total = t.lootLog.reduce((s, e) => s + (e.gp ?? 0), 0);
    return interaction.reply({ embeds: [mkEmbed(t, 0xFFD700).setTitle(`💰 Total Loot — ${t.displayName}`).setDescription(`**${fmtGP(total)} GP** looted in total by the clan`)] });
  }

  // ── /kfsession ─────────────────────────────────────────────────────
  if (cmd === 'kfsession') {
    const sk = t.killLog.filter(e => e.timestamp >= sessionStart);
    const sl = t.lootLog.filter(e => e.timestamp >= sessionStart);
    const sd = t.deathLog.filter(e => e.timestamp >= sessionStart);
    const gp = sl.reduce((s, e) => s + (e.gp ?? 0), 0);
    const up = Date.now() - sessionStart;
    return interaction.reply({ embeds: [mkEmbed(t, 0x00AAFF).setTitle('📊 Session Stats')
      .addFields(
        { name: 'Uptime',         value: `${Math.floor(up / 3_600_000)}h ${Math.floor((up % 3_600_000) / 60_000)}m`, inline: true },
        { name: 'Kills',          value: String(sk.length),  inline: true },
        { name: 'Deaths',         value: String(sd.length),  inline: true },
        { name: 'GP Looted',      value: fmtGP(gp),          inline: true },
        { name: 'Active Killers', value: String(new Set(sk.map(e => e.killer)).size), inline: true },
      )] });
  }

  // ── /kfrivalry ─────────────────────────────────────────────────────
  if (cmd === 'kfrivalry') {
    await interaction.deferReply();
    const p1raw = interaction.options.getString('player1', true).trim();
    const p2raw = interaction.options.getString('player2', true).trim();

    const p1mention = p1raw.match(/^<@!?(\d{17,19})>$/);
    const p2mention = p2raw.match(/^<@!?(\d{17,19})>$/);
    const p1key = p1mention ? p1mention[1] : playerKey(t, ci(p1raw));
    const p2key = p2mention ? p2mention[1] : playerKey(t, ci(p2raw));

    const p1name = await displayName(p1key, interaction.guild);
    const p2name = await displayName(p2key, interaction.guild);

    const ek = (e) => liveKey(t, e.killerRSN, e.killer);
    const ev = (e) => liveKey(t, e.victimRSN, e.victim);
    const p1kills = t.killLog.filter(e => ek(e) === p1key && ev(e) === p2key).length;
    const p2kills = t.killLog.filter(e => ek(e) === p2key && ev(e) === p1key).length;
    const p1loot  = t.lootLog.filter(e => ek(e) === p1key && ev(e) === p2key).reduce((s, e) => s + (e.gp ?? 0), 0);
    const p2loot  = t.lootLog.filter(e => ek(e) === p2key && ev(e) === p1key).reduce((s, e) => s + (e.gp ?? 0), 0);

    let winnerLine = '';
    if (p1kills > p2kills)      winnerLine = `\n🏆 **${p1name}** leads the rivalry`;
    else if (p2kills > p1kills) winnerLine = `\n🏆 **${p2name}** leads the rivalry`;
    else if (p1kills > 0)       winnerLine = `\n🤝 Dead even`;

    return interaction.editReply({ embeds: [
      mkEmbed(t, 0xAA00FF)
        .setTitle(`⚔️ Rivalry: ${p1name} vs ${p2name}`)
        .addFields(
          { name: p1name, value: `${p1kills} kills\n${fmtGP(p1loot)} GP looted`, inline: true },
          { name: '⚔️',  value: '​', inline: true },
          { name: p2name, value: `${p2kills} kills\n${fmtGP(p2loot)} GP looted`, inline: true },
        )
        .setDescription(winnerLine || 'No clashes recorded yet.')
    ] });
  }

  // ── /kfrsn ─────────────────────────────────────────────────────────
  // Registration is global: registering in ANY tenant server is recognised by
  // every tenant's killfeed/leaderboards. Per-tenant t.rsnMap overrides are
  // still honoured first (legacy + manual overrides) before falling back to
  // the global registry.
  if (cmd === 'kfrsn') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'refresh') {
      const isCraterAdmin =
        (!CRATER_GUILD_ID || interaction.guildId === CRATER_GUILD_ID) &&
        interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE);
      if (!isCraterAdmin) return interaction.reply({ content: '🔒 Crater admins only.', ephemeral: true });

      const beforeUsers = Object.keys(globalAccounts).length;
      const beforeRsns  = Object.values(globalAccounts).reduce((s, a) => s + a.length, 0);

      loadGlobalAccounts();          // reload from disk (picks up manual edits)
      migrateLegacyAccountsToGlobal(); // fold any tenant-only accounts into global
      for (const tt of tenants.values()) rebuildRsnMap(tt); // refresh per-tenant overrides

      const users = Object.keys(globalAccounts).length;
      const rsns  = Object.values(globalAccounts).reduce((s, a) => s + a.length, 0);
      const delta = (rsns - beforeRsns) || (users - beforeUsers);
      const deltaLine = delta > 0 ? `\n🆕 Picked up **${delta}** new entr${delta === 1 ? 'y' : 'ies'} since last load.` : '';

      return interaction.reply({ content:
        `✅ Refreshed global registry.\n` +
        `👥 **${users}** Discord users · 🎮 **${rsns}** RSNs\n` +
        `🏷️ **${tenants.size}** tenant${tenants.size === 1 ? '' : 's'} re-synced.` +
        deltaLine, ephemeral: true });
    }

    if (sub === 'list') {
      const target = (interaction.options.getUser('user') ?? interaction.user).id;
      const rsns   = getGlobalRSNs(target);
      return interaction.reply({ content: rsns.length ? `Accounts for <@${target}>: **${rsns.join(', ')}**` : `No accounts linked to <@${target}>.`, ephemeral: true });
    }
    if (sub === 'whohas') {
      const rsn = interaction.options.getString('rsn', true).trim();
      const uid = t.rsnMap[ci(rsn)] ?? globalRsnMap[ci(rsn)];
      return interaction.reply({ content: uid ? `**${rsn}** is linked to <@${uid}>.` : `**${rsn}** is not linked to any Discord account.`, ephemeral: true });
    }
    if (sub === 'link') {
      const rsn  = interaction.options.getString('rsn', true).trim();
      const user = interaction.options.getUser('user', true);
      linkGlobalRSN(rsn, user.id);
      return interaction.reply({ content: `✅ Linked **${rsn}** → <@${user.id}> (global).`, ephemeral: true });
    }
    if (sub === 'unlink') {
      const rsn = interaction.options.getString('rsn', true).trim();
      const uid = unlinkGlobalRSN(rsn);
      return interaction.reply({ content: uid ? `✅ Unlinked **${rsn}** (was <@${uid}>).` : `**${rsn}** wasn't linked.`, ephemeral: true });
    }
    const target = (interaction.options.getUser('user') ?? interaction.user).id;
    const rsns   = interaction.options.getString('rsns', true).split(',').map(s => s.trim()).filter(Boolean);
    if (sub === 'add') {
      addGlobalRSNs(target, rsns);
      return interaction.reply({ content: `✅ Linked **${rsns.join(', ')}** → <@${target}> (global — visible to all clans).`, ephemeral: true });
    }
    if (sub === 'remove') {
      removeGlobalRSNs(target, rsns);
      return interaction.reply({ content: `✅ Unlinked **${rsns.join(', ')}** from <@${target}>.`, ephemeral: true });
    }
  }

  // ── /kflive ────────────────────────────────────────────────────────
  if (cmd === 'kflive') {
    const sub = interaction.options.getSubcommand();

    // Resolve which tenant to operate on (default = current guild's tenant, or
    // any tenant if Crater admin specifies slug)
    function resolveTarget() {
      const slug = interaction.options.getString('slug');
      if (!slug) return { target: t, slugErr: null };
      const isCraterAdmin =
        (!CRATER_GUILD_ID || interaction.guildId === CRATER_GUILD_ID) &&
        interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE);
      if (!isCraterAdmin) return { target: null, slugErr: '🔒 Only Crater admins can target another clan.' };
      const tgt = tenants.get(slug);
      if (!tgt) return { target: null, slugErr: `❌ No such clan slug: \`${slug}\`.` };
      return { target: tgt, slugErr: null };
    }

    if (sub === 'set') {
      await interaction.deferReply({ ephemeral: true });
      const { target, slugErr } = resolveTarget();
      if (slugErr) return interaction.editReply({ content: slugErr });
      const type       = interaction.options.getString('type', true);
      const key        = `${interaction.channelId}_${type}`;
      const sortBy     = target.liveBoards[key]?.sortBy ?? 'count';
      const embed      = await buildBoardEmbed(target, type, interaction.guild, { sortBy });
      const components = boardComponents(type, sortBy);
      const msg        = await interaction.channel.send({ embeds: [embed], components });
      target.liveBoards[key] = { type, channelId: interaction.channelId, messageId: msg.id, sortBy };
      saveTenant(target);
      startBoardTimer(target, key);
      return interaction.editReply({ content: `✅ Live **${type}** board for **${target.displayName}** posted in <#${interaction.channelId}>. Refreshes every ${Math.round(LIVE_REFRESH_MS / 60_000)} minutes.` });
    }

    if (sub === 'clear') {
      const { target, slugErr } = resolveTarget();
      if (slugErr) return interaction.reply({ content: slugErr, ephemeral: true });
      const type = interaction.options.getString('type', true);
      const key  = `${interaction.channelId}_${type}`;
      if (!target.liveBoards[key]) return interaction.reply({ content: `No live **${type}** board for **${target.displayName}** in this channel.`, ephemeral: true });
      delete target.liveBoards[key];
      saveTenant(target);
      stopBoardTimer(target, key);
      return interaction.reply({ content: `✅ Live **${type}** board for **${target.displayName}** removed.`, ephemeral: true });
    }

    if (sub === 'list') {
      // Show live boards across all tenants (rather than just current) when
      // run from Crater by an admin; otherwise just this server's tenant.
      const isCraterAdmin =
        (!CRATER_GUILD_ID || interaction.guildId === CRATER_GUILD_ID) &&
        interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE);
      const scopes = isCraterAdmin ? [...tenants.values()] : [t];
      const lines = [];
      for (const tt of scopes) {
        for (const b of Object.values(tt.liveBoards)) {
          lines.push(`• **${b.type}** \`[${tt.displayName}]\` — <#${b.channelId}>`);
        }
      }
      if (!lines.length) return interaction.reply({ content: 'No live boards active.', ephemeral: true });
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }
  }

  // ── /kfadmin ───────────────────────────────────────────────────────
  if (cmd === 'kfadmin') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'addgp' || sub === 'removegp') {
      const name = interaction.options.getString('player', true).trim();
      const amt  = parseGP(interaction.options.getString('amount', true)) * (sub === 'removegp' ? -1 : 1);
      const key  = playerKey(t, ci(name));
      t.lootLog.push({ killer: key, killerRSN: ci(name), gp: amt, timestamp: Date.now(), manual: true });
      saveTenant(t);
      return interaction.reply({ content: `✅ ${sub === 'addgp' ? 'Added' : 'Removed'} **${fmtGP(Math.abs(amt))} GP** ${sub === 'addgp' ? 'to' : 'from'} **${name}**.`, ephemeral: true });
    }

    if (sub === 'addkill') {
      const killerRaw = interaction.options.getString('killer', true).trim();
      const victimRaw = interaction.options.getString('victim', true).trim();
      const gpStr     = interaction.options.getString('gp');
      const gp        = gpStr ? parseGP(gpStr) : 0;

      const kMention = killerRaw.match(/^<@!?(\d{17,19})>$/)?.[1];
      const vMention = victimRaw.match(/^<@!?(\d{17,19})>$/)?.[1];
      const kKey = kMention ?? playerKey(t, ci(killerRaw));
      const vKey = vMention ?? playerKey(t, ci(victimRaw));
      const kRsn = kMention ? null : ci(killerRaw);
      const vRsn = vMention ? null : ci(victimRaw);

      const now = Date.now();
      t.killLog.push({ killer: kKey, killerRSN: kRsn, victim: vKey, victimRSN: vRsn, gp, timestamp: now, manual: true });
      if (gp > 0) t.lootLog.push({ killer: kKey, killerRSN: kRsn, victim: vKey, victimRSN: vRsn, gp, timestamp: now, manual: true });
      addKill(t, kKey);
      resetStreak(t, vKey);
      saveTenant(t);
      return interaction.reply({
        content: `✅ Logged kill: **${killerRaw}** → **${victimRaw}**${gp > 0 ? ` for **${fmtGP(gp)} GP**` : ''}.`,
        ephemeral: true,
      });
    }

    if (sub === 'adddeath') {
      const playerRaw   = interaction.options.getString('player', true).trim();
      const killedByRaw = interaction.options.getString('killed_by');
      const gpStr       = interaction.options.getString('gp');
      const gp          = gpStr ? parseGP(gpStr) : 0;

      const pMention = playerRaw.match(/^<@!?(\d{17,19})>$/)?.[1];
      const pKey = pMention ?? playerKey(t, ci(playerRaw));
      const pRsn = pMention ? null : ci(playerRaw);

      let kKey = null, kRsn = null;
      if (killedByRaw) {
        const trimmed  = killedByRaw.trim();
        const kMention = trimmed.match(/^<@!?(\d{17,19})>$/)?.[1];
        kKey = kMention ?? playerKey(t, ci(trimmed));
        kRsn = kMention ? null : ci(trimmed);
      }

      t.deathLog.push({ player: pKey, playerRSN: pRsn, killedBy: kKey, killedByRSN: kRsn, gp, timestamp: Date.now(), manual: true });
      resetStreak(t, pKey);
      saveTenant(t);
      return interaction.reply({
        content: `✅ Logged death: **${playerRaw}**${killedByRaw ? ` killed by **${killedByRaw}**` : ''}${gp > 0 ? ` · lost **${fmtGP(gp)} GP**` : ''}.`,
        ephemeral: true,
      });
    }

    if (sub === 'removekill') {
      const killerRaw = interaction.options.getString('killer', true).trim();
      const victimRaw = interaction.options.getString('victim', true).trim();
      const gpStr     = interaction.options.getString('gp');
      const gpFilter  = gpStr ? parseGP(gpStr) : null;

      const kMention = killerRaw.match(/^<@!?(\d{17,19})>$/)?.[1];
      const vMention = victimRaw.match(/^<@!?(\d{17,19})>$/)?.[1];
      const kKey = kMention ?? playerKey(t, ci(killerRaw));
      const vKey = vMention ?? playerKey(t, ci(victimRaw));

      const matches = e => {
        const ek = liveKey(t, e.killerRSN, e.killer);
        const ev = liveKey(t, e.victimRSN, e.victim);
        if (ek !== kKey || ev !== vKey) return false;
        if (gpFilter !== null && e.gp !== gpFilter) return false;
        return true;
      };

      // Find most recent matching kill entry
      let killIdx = -1, killTs = -1;
      for (let i = 0; i < t.killLog.length; i++) {
        const ts = t.killLog[i].timestamp ?? 0;
        if (matches(t.killLog[i]) && ts > killTs) { killIdx = i; killTs = ts; }
      }
      if (killIdx === -1) return interaction.reply({ content: '❌ No matching kill found.', ephemeral: true });
      const removed = t.killLog.splice(killIdx, 1)[0];

      // Also remove the paired loot entry (same timestamp + killer/victim)
      let removedLoot = null;
      const lootIdx = t.lootLog.findIndex(e => e.timestamp === removed.timestamp && matches(e));
      if (lootIdx !== -1) removedLoot = t.lootLog.splice(lootIdx, 1)[0];

      saveTenant(t);
      return interaction.reply({
        content: `🗑️ Removed kill: **${killerRaw}** → **${victimRaw}**${removed.gp > 0 ? ` (${fmtGP(removed.gp)} GP)` : ''}${removedLoot ? ' + matched loot entry' : ''}.`,
        ephemeral: true,
      });
    }

    if (sub === 'removedeath') {
      const playerRaw   = interaction.options.getString('player', true).trim();
      const killedByRaw = interaction.options.getString('killed_by');
      const gpStr       = interaction.options.getString('gp');
      const gpFilter    = gpStr ? parseGP(gpStr) : null;

      const pMention = playerRaw.match(/^<@!?(\d{17,19})>$/)?.[1];
      const pKey = pMention ?? playerKey(t, ci(playerRaw));

      let kKey = null;
      if (killedByRaw) {
        const trimmed  = killedByRaw.trim();
        const kMention = trimmed.match(/^<@!?(\d{17,19})>$/)?.[1];
        kKey = kMention ?? playerKey(t, ci(trimmed));
      }

      const matches = e => {
        const ep = liveKey(t, e.playerRSN, e.player);
        if (ep !== pKey) return false;
        if (kKey !== null) {
          const ek = liveKey(t, e.killedByRSN, e.killedBy);
          if (ek !== kKey) return false;
        }
        if (gpFilter !== null && e.gp !== gpFilter) return false;
        return true;
      };

      let deathIdx = -1, deathTs = -1;
      for (let i = 0; i < t.deathLog.length; i++) {
        const ts = t.deathLog[i].timestamp ?? 0;
        if (matches(t.deathLog[i]) && ts > deathTs) { deathIdx = i; deathTs = ts; }
      }
      if (deathIdx === -1) return interaction.reply({ content: '❌ No matching death found.', ephemeral: true });
      const removed = t.deathLog.splice(deathIdx, 1)[0];

      saveTenant(t);
      return interaction.reply({
        content: `🗑️ Removed death: **${playerRaw}**${killedByRaw ? ` killed by **${killedByRaw}**` : ''}${removed.gp > 0 ? ` (${fmtGP(removed.gp)} GP)` : ''}.`,
        ephemeral: true,
      });
    }

    if (sub === 'reset') {
      const name = interaction.options.getString('player', true).trim();
      const key  = playerKey(t, ci(name));
      t.killLog  = t.killLog.filter(e => e.killer !== key && e.victim !== key);
      t.lootLog  = t.lootLog.filter(e => e.killer !== key);
      t.deathLog = t.deathLog.filter(e => e.player !== key);
      delete t.killStreaks[key];
      saveTenant(t);
      return interaction.reply({ content: `✅ Reset stats for **${name}**.`, ephemeral: true });
    }

    if (sub === 'resetall') {
      if (interaction.options.getString('confirm', true) !== 'CONFIRM')
        return interaction.reply({ content: '❌ You must type `CONFIRM` exactly to reset all data.', ephemeral: true });
      t.killLog = []; t.lootLog = []; t.deathLog = []; t.killStreaks = {}; t.firstBloodDay = '';
      saveTenant(t);
      return interaction.reply({ content: '🗑️ All kill feed data has been reset for this clan.', ephemeral: true });
    }

    if (sub === 'export') {
      const type   = interaction.options.getString('type', true);
      const period = interaction.options.getString('period') ?? 'all';
      let csv = '';
      if (type === 'hiscores')   csv = 'Player,Kills\n'  + Object.entries(buildKillsMap(t, period)).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k},${v}`).join('\n');
      if (type === 'lootboard')  csv = 'Player,GP\n'     + Object.entries(buildLootMap(t, period)).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k},${v}`).join('\n');
      if (type === 'deathboard') csv = 'Player,Deaths\n' + Object.entries(buildDeathMap(t, period)).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k},${v}`).join('\n');
      ensureDirs();
      const fname = path.join(DATA_DIR, `export_${t.slug}_${type}_${period}_${Date.now()}.csv`);
      fs.writeFileSync(fname, csv);
      return interaction.reply({ files: [{ attachment: fname, name: `${type}_${period}.csv` }], ephemeral: true });
    }
  }

  // ── /kflistall ─────────────────────────────────────────────────────
  if (cmd === 'kflistall') {
    const all = Object.values(globalAccounts).flat();
    if (!all.length) return interaction.reply({ content: 'No RSNs registered yet.', ephemeral: true });
    const sorted = [...new Set(all)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const list = sorted.join(', ');
    const header = `**${sorted.length}** RSN${sorted.length === 1 ? '' : 's'} registered (global):\n`;
    if (header.length + list.length + 8 <= 1900) {
      return interaction.reply({ content: `${header}\`\`\`\n${list}\n\`\`\`` });
    }
    ensureDirs();
    const fname = path.join(DATA_DIR, `rsns_global_${Date.now()}.txt`);
    fs.writeFileSync(fname, list);
    return interaction.reply({ content: header + '(list attached — too long for chat)', files: [{ attachment: fname, name: 'rsns.txt' }] });
  }

  // ── /kfhelp ────────────────────────────────────────────────────────
  if (cmd === 'kfhelp') {
    const isCraterAdmin =
      t.isDefault &&
      (!CRATER_GUILD_ID || interaction.guildId === CRATER_GUILD_ID) &&
      interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE);

    const fields = [
      { name: '📊 Stats & Boards',
        value: [
          '`/kfoverview kills` — Kill leaderboard (daily/weekly/monthly/all-time)',
          '`/kfoverview loot` — Loot leaderboard',
          '`/kfoverview deaths` — Death leaderboard',
          '`/kfoverview pnl` — Profit & loss',
          '`/kfprofile @user` — Combined stats for a Discord account (all their RSNs)',
          '`/kfprofile <rsn>` — Stats for just that character (ignores other RSNs on the same account)',
          '`/kfstreaks` — Active & all-time kill streaks',
          '`/kftotalgp` — Total GP looted by the clan',
          '`/kfsession` — Stats since last bot restart',
          '`/kfrivalry <player1> <player2>` — Head-to-head record',
          isCraterAdmin ? '🌐 *Crater admins:* pass `slug:<clan>` on `/kfoverview` to view a guest clan\'s board here.' : null,
        ].filter(Boolean).join('\n'), inline: false },
      { name: '📺 Live Boards',
        value: [
          '`/kflive set <type>` — Post a live board that auto-refreshes',
          '`/kflive clear <type>` — Remove a live board from this channel',
          '`/kflive list` — Show all active live boards',
          '*Types: kills · loot · graves · pnl*',
          isCraterAdmin ? '🌐 *Crater admins:* pass `slug:<clan>` to pin a guest clan\'s board in a Crater channel.' : null,
        ].filter(Boolean).join('\n'), inline: false },
      { name: '🔗 RSN Linking *(global — works across every clan)*',
        value: [
          '`/kfrsn add <rsns> [user]` — Link RSNs to a Discord account',
          '`/kfrsn remove <rsns> [user]` — Unlink RSNs',
          '`/kfrsn list [user]` — View linked RSNs',
          '`/kfrsn link <rsn> <user>` — Force-link an RSN to a user',
          '`/kfrsn unlink <rsn>` — Unlink an RSN',
          '`/kfrsn whohas <rsn>` — Find who owns an RSN',
          '`/kfrsn refresh` — *(admin)* Reload global registry from disk + re-sync tenants',
          '`/kflistall` — List every RSN registered across all clans',
          '*Register once in any server — your profit/kills are tracked under your Discord ID in every clan. Players active in multiple clans show as separate leaderboard rows: `@Craigmuzza (The Crater)` & `@Craigmuzza (Obby Elite)`.*',
        ].join('\n'), inline: false },
      { name: '🔧 Admin',
        value: [
          '`/kfadmin addkill <killer> <victim> [gp]` — Manually log a kill (+ optional loot)',
          '`/kfadmin adddeath <player> [killed_by] [gp]` — Manually log a death',
          '`/kfadmin removekill <killer> <victim> [gp]` — Remove most recent matching kill',
          '`/kfadmin removedeath <player> [killed_by] [gp]` — Remove most recent matching death',
          '`/kfadmin addgp/removegp <player> <amount>` — Adjust GP only (no kill count)',
          '`/kfadmin reset <player>` — Reset one player\'s stats',
          '`/kfadmin resetall CONFIRM` — ⚠️ Wipe all kill feed data',
          '`/kfadmin export <type> [period]` — Export data as CSV',
        ].join('\n'), inline: false },
      { name: '📜 Collection Log',
        value: [
          '`/kfclog enable [channel_id] [crater_channel_id]` — *(admin)* Turn on tracking',
          '`/kfclog disable` — *(admin)* Turn off tracking (keeps channels)',
          '`/kfclog channel [channel_id]` — *(admin)* Set/clear their server\'s channel',
          '`/kfclog craterchannel [channel_id]` — *(admin)* Set/clear the Crater mirror',
          '`/kfclog status` — Show which channels are linked + on/off',
          '`/kfclog listall` — *(admin)* Clog config for every tenant in one view',
          '`/kfclog recent [count]` — Show recent collection log items',
          '`/kfclog board` — Most items + highest collection log count',
          '`/kfclog comp start <name> [days]` — *(admin)* Start a competition',
          '`/kfclog comp status` — Current competition standings',
          '`/kfclog comp end` — *(admin)* End the competition',
        ].join('\n'), inline: false },
    ];

    if (isCraterAdmin) {
      fields.push({
        name: '🌐 Guest Clans *(Crater admin only)*',
        value: [
          '`/kfclan add <slug> <clan_name> <guild_id> <channel_id> [crater_channel_id] [days] [display]`',
          '`/kfclan remove <slug> CONFIRM` — Deregister and **delete** data',
          '`/kfclan extend <slug> <days>` — Extend the trial',
          '`/kfclan makeindefinite <slug>` — Remove the expiry',
          '`/kfclan channel <slug> <channel_id>` — Change their own channel',
          '`/kfclan craterchannel <slug> [channel_id]` — Set/clear their dedicated Crater mirror channel',
          '`/kfclan rename <slug> <display>` — Fix display name (e.g. "obsidians" → "Obsidians")',
          '`/kfclan icon <slug> [url]` — Set/clear the clan logo shown in their embeds',
          '`/kfclan list` — Show all registered guest clans',
          '`/kfclan communal set/clear/show` — Optional global Crater feed for ALL guests',
        ].join('\n'), inline: false });
      fields.push({
        name: '📈 Communal Leaderboards *(Crater admin only)*',
        value: [
          '`/kfcommunal kills/loot/deaths/pnl` — One-shot view (just you)',
          '`/kfcommunal live set <type>` — Pin an auto-refreshing communal board in this channel',
          '`/kfcommunal live clear <type>` — Remove a communal live board',
          '`/kfcommunal live list` — Show active communal live boards',
        ].join('\n'), inline: false });
    }

    return interaction.reply({ embeds: [
      mkEmbed(t, 0x00AAFF)
        .setTitle(`☠️ ${t.displayName} — Kill Feed Commands`)
        .setDescription(t.isDefault
          ? 'Full command list for the kill feed.'
          : `Killfeed for ${t.displayName}. All commands are scoped to your clan's data.`)
        .addFields(...fields)
    ], ephemeral: true });
  }

  return false;
}

// ─── /kfclan handler (Crater admin only) ─────────────────────────────────────
async function handleKfClan(interaction) {
  // Must be in Crater's guild and have the admin role
  const craterGuild = CRATER_GUILD_ID;
  if (craterGuild && interaction.guildId !== craterGuild) {
    return interaction.reply({ content: 'This command can only be run from The Crater server.', ephemeral: true });
  }
  if (!interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE)) {
    return interaction.reply({ content: '🔒 You don\'t have permission to manage guest clans.', ephemeral: true });
  }

  // Subcommand groups are nested: getSubcommandGroup() returns null for top-level subs
  const group = interaction.options.getSubcommandGroup(false);
  const sub   = interaction.options.getSubcommand();

  if (group === 'communal') {
    if (sub === 'set') {
      const chId = interaction.options.getString('channel_id', true);
      settings.communalChannelId = chId;
      saveSettings();
      return interaction.reply({ content: `✅ Communal Crater channel set to <#${chId}>. All guest-clan kills will now mirror here.`, ephemeral: true });
    }
    if (sub === 'clear') {
      settings.communalChannelId = null;
      saveSettings();
      return interaction.reply({ content: '✅ Communal mirroring disabled.', ephemeral: true });
    }
    if (sub === 'show') {
      const id = communalChannelId();
      return interaction.reply({ content: id ? `Communal channel: <#${id}>` : 'No communal channel set.', ephemeral: true });
    }
  }

  if (sub === 'list') {
    const guests = [...tenants.values()].filter(t => !t.isDefault);
    if (!guests.length) return interaction.reply({ content: 'No guest clans registered.', ephemeral: true });
    const lines = guests.map(t => {
      const remainingLabel = t.expiresAt
        ? `${Math.max(0, Math.ceil((t.expiresAt - Date.now()) / 86_400_000))} day(s) left`
        : 'indefinite';
      const exp = isExpired(t) ? ' ⏰ EXPIRED' : '';
      const craterPart = t.craterChannelId ? ` · 🌐 Crater: <#${t.craterChannelId}>` : '';
      return `• **${t.displayName}** (\`${t.slug}\`) — clan "${t.clanNameLower}" → <#${t.killChannelId}>${craterPart} · ${remainingLabel}${exp}`;
    });
    const communalLine = communalChannelId()
      ? `\n\n🌐 Global communal mirror: <#${communalChannelId()}>`
      : '\n\n🌐 Global communal mirror: *disabled*';
    return interaction.reply({ content: lines.join('\n') + communalLine, ephemeral: true });
  }

  if (sub === 'add') {
    const slugRaw          = interaction.options.getString('slug', true);
    const clanName         = interaction.options.getString('clan_name', true);
    const guildId          = interaction.options.getString('guild_id', true);
    const channelId        = interaction.options.getString('channel_id', true);
    const craterChannelId  = interaction.options.getString('crater_channel_id') ?? null;
    const iconUrl          = interaction.options.getString('icon_url') ?? null;
    const days             = interaction.options.getInteger('days'); // optional → null = indefinite
    const explicitDisplay  = interaction.options.getString('display');
    // Default display = title-cased clan_name; respect explicit display verbatim
    const display          = explicitDisplay ?? titleCaseRSN(clanName);

    const slug = slugify(slugRaw);
    if (!slug) return interaction.reply({ content: '❌ Invalid slug.', ephemeral: true });
    if (slug === 'crater') return interaction.reply({ content: '❌ "crater" is reserved.', ephemeral: true });
    if (tenants.has(slug)) return interaction.reply({ content: `❌ Slug "${slug}" already exists.`, ephemeral: true });
    if (tenantByClan.has(ci(clanName))) return interaction.reply({ content: `❌ Clan name "${clanName}" already routes elsewhere.`, ephemeral: true });
    if (tenantByGuild.has(guildId)) return interaction.reply({ content: `❌ Guild ${guildId} already routes elsewhere.`, ephemeral: true });
    if (days !== null && days <= 0) return interaction.reply({ content: '❌ Days must be positive (omit for indefinite).', ephemeral: true });

    const expiresAt = days != null ? Date.now() + days * 86_400_000 : null;

    const t = makeTenant({
      slug,
      displayName: display,
      clanNameLower: ci(clanName),
      guildId,
      killChannelId: channelId,
      craterChannelId,
      iconUrl,
      expiresAt,
      addedAt: Date.now(),
      addedBy: interaction.user.id,
      isDefault: false,
      files: GUEST_FILES(slug),
    });
    tenants.set(slug, t);
    ensureTenantDir(t);
    saveTenant(t);
    rebuildIndexes();
    saveRegistry();

    const expiryLine = expiresAt
      ? `Expires: <t:${Math.floor(expiresAt / 1000)}:R>`
      : 'Expiry: **never** (indefinite)';
    const craterLine = craterChannelId
      ? `Crater mirror: <#${craterChannelId}>`
      : 'Crater mirror: *none (use /kfclan craterchannel to add)*';
    const iconLine = iconUrl
      ? `Clan logo: ${iconUrl}`
      : 'Clan logo: *none — using Crater fallback (use /kfclan icon to set)*';
    return interaction.reply({ content:
      `✅ Registered **${display}** (\`${slug}\`)\n` +
      `Clan name: "${clanName}"\n` +
      `Guild: ${guildId}\n` +
      `Their channel: <#${channelId}>\n` +
      `${craterLine}\n` +
      `${iconLine}\n` +
      expiryLine, ephemeral: true });
  }

  if (sub === 'icon') {
    const slug = interaction.options.getString('slug', true);
    const url  = interaction.options.getString('url') ?? null;
    const t = tenants.get(slug);
    if (!t || t.isDefault) return interaction.reply({ content: '❌ No such guest clan.', ephemeral: true });
    t.iconUrl = url;
    saveRegistry();
    return interaction.reply({
      content: url
        ? `✅ Clan logo for **${t.displayName}** set.\nPreview: ${url}`
        : `✅ Cleared clan logo for **${t.displayName}** (Crater fallback will be used).`,
      ephemeral: true,
    });
  }

  if (sub === 'craterchannel') {
    const slug = interaction.options.getString('slug', true);
    const chId = interaction.options.getString('channel_id') ?? null;
    const t = tenants.get(slug);
    if (!t || t.isDefault) return interaction.reply({ content: '❌ No such guest clan.', ephemeral: true });
    t.craterChannelId = chId;
    saveRegistry();
    return interaction.reply({
      content: chId
        ? `✅ Crater mirror channel for **${t.displayName}** set to <#${chId}>.`
        : `✅ Crater mirror disabled for **${t.displayName}**.`,
      ephemeral: true,
    });
  }

  if (sub === 'rename') {
    const slug    = interaction.options.getString('slug', true);
    const display = interaction.options.getString('display', true).trim();
    const t       = tenants.get(slug);
    if (!t || t.isDefault) return interaction.reply({ content: '❌ No such guest clan.', ephemeral: true });
    if (!display) return interaction.reply({ content: '❌ Display name cannot be empty.', ephemeral: true });
    const old = t.displayName;
    t.displayName = display;
    saveRegistry();
    return interaction.reply({ content: `✅ Renamed **${old}** → **${display}**.`, ephemeral: true });
  }

  if (sub === 'makeindefinite') {
    const slug = interaction.options.getString('slug', true);
    const t = tenants.get(slug);
    if (!t || t.isDefault) return interaction.reply({ content: '❌ No such guest clan.', ephemeral: true });
    t.expiresAt = null;
    delete t._expiredLogged;
    saveRegistry();
    return interaction.reply({ content: `✅ **${t.displayName}** is now indefinite (no expiry).`, ephemeral: true });
  }

  if (sub === 'remove') {
    const slug = interaction.options.getString('slug', true);
    const confirm = interaction.options.getString('confirm', true);
    if (confirm !== 'CONFIRM') return interaction.reply({ content: '❌ You must type `CONFIRM` to remove a clan.', ephemeral: true });
    const t = tenants.get(slug);
    if (!t || t.isDefault) return interaction.reply({ content: '❌ No such guest clan.', ephemeral: true });

    // Delete files + tenant dir
    try { fs.rmSync(path.dirname(t.files.state), { recursive: true, force: true }); } catch {}
    tenants.delete(slug);
    rebuildIndexes();
    saveRegistry();
    return interaction.reply({ content: `🗑️ Removed **${t.displayName}** and deleted its data.`, ephemeral: true });
  }

  if (sub === 'extend') {
    const slug = interaction.options.getString('slug', true);
    const days = interaction.options.getInteger('days', true);
    const t = tenants.get(slug);
    if (!t || t.isDefault) return interaction.reply({ content: '❌ No such guest clan.', ephemeral: true });
    const base = isExpired(t) ? Date.now() : (t.expiresAt ?? Date.now());
    t.expiresAt = base + days * 86_400_000;
    saveRegistry();
    return interaction.reply({ content: `✅ Extended **${t.displayName}** — now expires <t:${Math.floor(t.expiresAt / 1000)}:R>.`, ephemeral: true });
  }

  if (sub === 'channel') {
    const slug = interaction.options.getString('slug', true);
    const channelId = interaction.options.getString('channel_id', true);
    const t = tenants.get(slug);
    if (!t || t.isDefault) return interaction.reply({ content: '❌ No such guest clan.', ephemeral: true });
    t.killChannelId = channelId;
    saveRegistry();
    return interaction.reply({ content: `✅ Killfeed channel for **${t.displayName}** is now <#${channelId}>.`, ephemeral: true });
  }

  return false;
}

// ─── Communal embed builder (shared by /kfcommunal and live refresh) ────────
async function buildCommunalEmbed(type, guild) {
  const PLABELS = { daily: '📅 Daily', weekly: '📆 Weekly', monthly: '🗓️ Monthly', all: '🏆 All Time' };
  const PERIODS = ['daily', 'weekly', 'monthly', 'all'];

  async function aggregate(period, mapFn) {
    const rows = [];
    for (const t of tenants.values()) {
      const m = mapFn(t, period);
      for (const [key, value] of Object.entries(m)) {
        if (!value) continue;
        rows.push({ tenant: t, key, value });
      }
    }
    return rows.sort((a, b) => b.value - a.value);
  }
  async function annotate(rows, limit) {
    return Promise.all(rows.slice(0, limit).map(async (r, i) => {
      const isUid = /^\d{17,19}$/.test(r.key);
      const raw   = await displayName(r.key, guild);
      // Discord-linked players get an @ prefix; RSN-only rows stay bare.
      const name  = isUid ? `@${raw}` : raw;
      return { rank: i + 1, name, tenant: r.tenant, value: r.value };
    }));
  }

  if (type === 'kills') {
    const buckets = {};
    for (const p of PERIODS) buckets[p] = await annotate(await aggregate(p, buildKillsMap), p === 'all' ? 15 : 5);
    const fmt = rows => fitField(rows.map(r => `${medal(r.rank)}  **${r.name}** *(${r.tenant.displayName})* — ${r.value}`));
    const totalKills = [...tenants.values()].reduce((s, t) => s + t.killLog.length, 0);
    return new EmbedBuilder()
      .setColor(0x00CC88)
      .setTitle('🌐 Communal Kill Leaderboard')
      .setDescription(`Combined across **${tenants.size}** clan(s) · ${totalKills} total kills logged`)
      .setTimestamp()
      .addFields(
        { name: PLABELS.daily,   value: fmt(buckets.daily),   inline: false },
        { name: PLABELS.weekly,  value: fmt(buckets.weekly),  inline: false },
        { name: PLABELS.monthly, value: fmt(buckets.monthly), inline: false },
        { name: PLABELS.all,     value: fmt(buckets.all),     inline: false },
      );
  }

  if (type === 'loot') {
    const buckets = {};
    for (const p of PERIODS) buckets[p] = await annotate(await aggregate(p, buildLootMap), p === 'all' ? 15 : 5);
    const fmt = rows => fitField(rows.map(r => `${medal(r.rank)}  **${r.name}** *(${r.tenant.displayName})* — ${fmtGP(r.value)} GP`));
    const totalGP = [...tenants.values()].reduce((s, t) => s + t.lootLog.reduce((x, e) => x + (e.gp ?? 0), 0), 0);
    return new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle('🌐 Communal Loot Leaderboard')
      .setDescription(`Combined total: **${fmtGP(totalGP)} GP**`)
      .setTimestamp()
      .addFields(
        { name: PLABELS.daily,   value: fmt(buckets.daily),   inline: false },
        { name: PLABELS.weekly,  value: fmt(buckets.weekly),  inline: false },
        { name: PLABELS.monthly, value: fmt(buckets.monthly), inline: false },
        { name: PLABELS.all,     value: fmt(buckets.all),     inline: false },
      );
  }

  if (type === 'deaths') {
    const buckets = {};
    for (const p of PERIODS) buckets[p] = await annotate(await aggregate(p, buildDeathMap), p === 'all' ? 15 : 5);
    const fmt = rows => fitField(rows.map(r => `${medal(r.rank)}  **${r.name}** *(${r.tenant.displayName})* — ${r.value}`));
    const totalDeaths = [...tenants.values()].reduce((s, t) => s + t.deathLog.length, 0);
    return new EmbedBuilder()
      .setColor(0x880000)
      .setTitle('🌐 Communal Deaths Leaderboard')
      .setDescription(`Combined total: **${totalDeaths}** deaths`)
      .setTimestamp()
      .addFields(
        { name: PLABELS.daily,   value: fmt(buckets.daily),   inline: false },
        { name: PLABELS.weekly,  value: fmt(buckets.weekly),  inline: false },
        { name: PLABELS.monthly, value: fmt(buckets.monthly), inline: false },
        { name: PLABELS.all,     value: fmt(buckets.all),     inline: false },
      );
  }

  if (type === 'pnl') {
    async function aggregatePnl(period) {
      const rows = [];
      for (const t of tenants.values()) {
        const { earned, lost, net } = buildPnLMaps(t, period);
        for (const [key, value] of Object.entries(net)) {
          rows.push({ tenant: t, key, value, earned: earned[key] ?? 0, lost: lost[key] ?? 0 });
        }
      }
      return rows.sort((a, b) => b.value - a.value);
    }
    const buckets = {};
    for (const p of PERIODS) {
      const rows = await aggregatePnl(p);
      const limit = p === 'all' ? 15 : 5;
      buckets[p] = await Promise.all(rows.slice(0, limit).map(async (r, i) => {
        const isUid = /^\d{17,19}$/.test(r.key);
        const raw   = await displayName(r.key, guild);
        return {
          rank: i + 1,
          name: isUid ? `@${raw}` : raw,
          tenant: r.tenant,
          value: r.value, earned: r.earned, lost: r.lost,
        };
      }));
    }
    const fmt = (rows, showBreakdown) => fitField(rows.map(r => {
      const sign = r.value >= 0 ? '🟢' : '🔴';
      const base = `${medal(r.rank)}  ${sign} **${r.name}** *(${r.tenant.displayName})* — **${fmtNet(r.value)} GP**`;
      return showBreakdown ? `${base}\n   ↑ ${fmtGP(r.earned)} · ↓ ${fmtGP(r.lost)}` : base;
    }));
    return new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🌐 Communal Profit & Loss')
      .setTimestamp()
      .addFields(
        { name: PLABELS.daily,   value: fmt(buckets.daily,   false), inline: false },
        { name: PLABELS.weekly,  value: fmt(buckets.weekly,  false), inline: false },
        { name: PLABELS.monthly, value: fmt(buckets.monthly, false), inline: false },
        { name: PLABELS.all,     value: fmt(buckets.all,     true),  inline: false },
      );
  }

  return null;
}

async function refreshCommunalLiveBoard(key) {
  const board = settings.communalLiveBoards?.[key];
  if (!board || !discordClient) return;
  try {
    const ch    = await discordClient.channels.fetch(board.channelId);
    const msg   = await ch.messages.fetch(board.messageId);
    const embed = await buildCommunalEmbed(board.type, ch.guild);
    await msg.edit({ embeds: [embed] });
    board._failCount = 0;
  } catch (e) {
    board._failCount = (board._failCount ?? 0) + 1;
    console.error(`[KILLFEED] Communal live board "${key}" refresh failed (${board._failCount}/5):`, e.message);
    if (board._failCount >= 5) {
      console.warn(`[KILLFEED] Removing communal live board "${key}" after 5 consecutive failures.`);
      delete settings.communalLiveBoards[key];
      saveSettings();
      stopCommunalTimer(key);
    }
  }
}

// ─── Per-board independent timers ────────────────────────────────────────────
// Each live board gets its own setInterval. Boards never share a tick, so a
// slow Obby-Elite refresh can't delay Crater's, and vice versa.
const boardTimers = new Map(); // timerId → { handle, label }

function timerIdTenant(t, key)  { return `${t.slug}|${key}`; }
function timerIdCommunal(key)   { return `communal|${key}`; }

function startBoardTimer(t, key) {
  const id = timerIdTenant(t, key);
  if (boardTimers.has(id)) clearInterval(boardTimers.get(id).handle);
  const handle = setInterval(() => refreshLiveBoard(t, key), LIVE_REFRESH_MS);
  boardTimers.set(id, { handle, label: `${t.displayName}/${key}` });
  console.log(`[KILLFEED] Started timer for "${t.slug}:${key}" (every ${LIVE_REFRESH_MS / 1000}s)`);
}

function stopBoardTimer(t, key) {
  const id = timerIdTenant(t, key);
  const entry = boardTimers.get(id);
  if (!entry) return;
  clearInterval(entry.handle);
  boardTimers.delete(id);
  console.log(`[KILLFEED] Stopped timer for "${t.slug}:${key}"`);
}

function startCommunalTimer(key) {
  const id = timerIdCommunal(key);
  if (boardTimers.has(id)) clearInterval(boardTimers.get(id).handle);
  const handle = setInterval(() => refreshCommunalLiveBoard(key), LIVE_REFRESH_MS);
  boardTimers.set(id, { handle, label: `communal/${key}` });
  console.log(`[KILLFEED] Started communal timer for "${key}" (every ${LIVE_REFRESH_MS / 1000}s)`);
}

function stopCommunalTimer(key) {
  const id = timerIdCommunal(key);
  const entry = boardTimers.get(id);
  if (!entry) return;
  clearInterval(entry.handle);
  boardTimers.delete(id);
  console.log(`[KILLFEED] Stopped communal timer for "${key}"`);
}

function startAllBoardTimers() {
  for (const t of tenants.values()) {
    for (const key of Object.keys(t.liveBoards)) startBoardTimer(t, key);
  }
  for (const key of Object.keys(settings.communalLiveBoards ?? {})) startCommunalTimer(key);
  console.log(`[KILLFEED] ${boardTimers.size} live-board timer(s) running.`);
}

// ─── /kfcommunal handler (Crater admin only) ────────────────────────────────
async function handleKfCommunal(interaction) {
  if (CRATER_GUILD_ID && interaction.guildId !== CRATER_GUILD_ID) {
    return interaction.reply({ content: 'This command can only be run from The Crater server.', ephemeral: true });
  }
  if (!interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE)) {
    return interaction.reply({ content: '🔒 You don\'t have permission to view communal boards.', ephemeral: true });
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub   = interaction.options.getSubcommand();

  if (group === 'live') {
    if (sub === 'set') {
      await interaction.deferReply({ ephemeral: true });
      const type  = interaction.options.getString('type', true);
      const key   = `${interaction.channelId}_${type}`;
      const embed = await buildCommunalEmbed(type, interaction.guild);
      const msg   = await interaction.channel.send({ embeds: [embed] });
      settings.communalLiveBoards = settings.communalLiveBoards ?? {};
      settings.communalLiveBoards[key] = { type, channelId: interaction.channelId, messageId: msg.id };
      saveSettings();
      startCommunalTimer(key);
      return interaction.editReply({ content: `✅ Communal **${type}** live board posted. Refreshes every ${Math.round(LIVE_REFRESH_MS / 60_000)} min.` });
    }
    if (sub === 'clear') {
      const type = interaction.options.getString('type', true);
      const key  = `${interaction.channelId}_${type}`;
      if (!settings.communalLiveBoards?.[key]) return interaction.reply({ content: `No communal **${type}** live board in this channel.`, ephemeral: true });
      delete settings.communalLiveBoards[key];
      saveSettings();
      stopCommunalTimer(key);
      return interaction.reply({ content: `✅ Communal **${type}** live board removed from this channel.`, ephemeral: true });
    }
    if (sub === 'list') {
      const boards = Object.values(settings.communalLiveBoards ?? {});
      if (!boards.length) return interaction.reply({ content: 'No communal live boards active.', ephemeral: true });
      return interaction.reply({ content: boards.map(b => `• **${b.type}** — <#${b.channelId}>`).join('\n'), ephemeral: true });
    }
  }

  // One-shot ephemeral views
  await interaction.deferReply({ ephemeral: true });
  const embed = await buildCommunalEmbed(sub, interaction.guild);
  if (!embed) return interaction.editReply({ content: '❌ Unknown board type.' });
  return interaction.editReply({ embeds: [embed] });
}

// ─── /kfclog handler ─────────────────────────────────────────────────────────
async function handleKfClog(interaction) {
  // Admin subcommands need the role; if slug is provided, must be in Crater.
  const group = interaction.options.getSubcommandGroup(false);
  const sub   = interaction.options.getSubcommand();
  const adminSubs = new Set(['enable', 'disable', 'channel', 'craterchannel']);
  const adminCompSubs = new Set(['start', 'end']);
  const needsAdmin = (group === 'comp' ? adminCompSubs.has(sub) : adminSubs.has(sub));

  // Resolve which tenant the command targets
  function resolveTarget() {
    const slug = interaction.options.getString('slug');
    if (slug) {
      // Slug only allowed from Crater + admin
      const isCraterAdmin =
        (!CRATER_GUILD_ID || interaction.guildId === CRATER_GUILD_ID) &&
        interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE);
      if (!isCraterAdmin) return { target: null, err: '🔒 Only Crater admins can target another clan.' };
      const tgt = tenants.get(slug);
      if (!tgt) return { target: null, err: `❌ No such clan slug: \`${slug}\`.` };
      return { target: tgt, err: null };
    }
    const t = tenantForGuild(interaction.guildId);
    if (!t) return { target: null, err: 'This server is not registered with the killfeed.' };
    return { target: t, err: null };
  }

  if (needsAdmin) {
    // Require the admin role
    if (!interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE)) {
      return interaction.reply({ content: '🔒 You don\'t have permission for that.', ephemeral: true });
    }
  }

  const { target: t, err } = resolveTarget();
  if (err) return interaction.reply({ content: err, ephemeral: true });
  if (!t.isDefault && isExpired(t)) return interaction.reply({ content: `⏰ ${t.displayName}'s killfeed trial has expired.`, ephemeral: true });

  // ── enable / disable / channel / craterchannel / status ────────────
  if (sub === 'enable') {
    const chId       = interaction.options.getString('channel_id') ?? null;
    const craterChId = interaction.options.getString('crater_channel_id') ?? null;
    if (chId !== null)       t.clogChannelId = chId;
    if (craterChId !== null) t.clogCraterChannelId = craterChId;
    if (!t.clogChannelId && !t.clogCraterChannelId) {
      return interaction.reply({ content: '❌ Provide at least one channel (`channel_id` or `crater_channel_id`) — otherwise drops would go nowhere.', ephemeral: true });
    }
    t.clogEnabled = true;
    saveTenant(t);
    const lines = [
      `✅ Collection log tracking **enabled** for **${t.displayName}**.`,
      t.clogChannelId       ? `Their channel: <#${t.clogChannelId}>`       : null,
      t.clogCraterChannelId ? `Crater mirror: <#${t.clogCraterChannelId}>` : null,
    ].filter(Boolean);
    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }
  if (sub === 'disable') {
    t.clogEnabled = false;
    saveTenant(t);
    return interaction.reply({ content: `✅ Collection log tracking **disabled** for **${t.displayName}**.\n*(channels are kept — re-enable any time.)*`, ephemeral: true });
  }
  if (sub === 'channel') {
    const chId = interaction.options.getString('channel_id') ?? null;
    t.clogChannelId = chId;
    saveTenant(t);
    return interaction.reply({
      content: chId
        ? `✅ Clog channel for **${t.displayName}** set to <#${chId}>.`
        : `✅ Cleared **${t.displayName}**'s own clog channel.${t.clogCraterChannelId ? '' : ' ⚠️ No channels are set now — drops will not post anywhere.'}`,
      ephemeral: true,
    });
  }
  if (sub === 'craterchannel') {
    const chId = interaction.options.getString('channel_id') ?? null;
    t.clogCraterChannelId = chId;
    saveTenant(t);
    return interaction.reply({
      content: chId
        ? `✅ Crater clog mirror for **${t.displayName}** set to <#${chId}>.`
        : `✅ Cleared **${t.displayName}**'s Crater clog mirror.${t.clogChannelId ? '' : ' ⚠️ No channels are set now — drops will not post anywhere.'}`,
      ephemeral: true,
    });
  }
  if (sub === 'status' && !group) {
    const lines = [
      `📜 **${t.displayName}** — clog status:`,
      `• Enabled: ${t.clogEnabled ? '✅ yes' : '❌ no'}`,
      `• Their channel: ${t.clogChannelId ? `<#${t.clogChannelId}>` : '*not set*'}`,
      `• Crater mirror: ${t.clogCraterChannelId ? `<#${t.clogCraterChannelId}>` : '*not set*'}`,
      `• Items logged: **${(t.collectionLog ?? []).length}**`,
      t.clogComp
        ? `• Competition: **${t.clogComp.name}** ${t.clogComp.endTime ? '*(ended)*' : '*(live)*'}`
        : '• Competition: *none active*',
    ];
    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }

  // ── listall ────────────────────────────────────────────────────────
  if (sub === 'listall' && !group) {
    const isCraterAdmin =
      (!CRATER_GUILD_ID || interaction.guildId === CRATER_GUILD_ID) &&
      interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE);
    if (!isCraterAdmin) return interaction.reply({ content: '🔒 Crater admins only.', ephemeral: true });

    const rows = [...tenants.values()]
      .sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : a.displayName.localeCompare(b.displayName)))
      .map(tt => {
        const state  = tt.clogEnabled ? '✅' : '❌';
        const their  = tt.clogChannelId       ? `<#${tt.clogChannelId}>`       : '*—*';
        const crater = tt.clogCraterChannelId ? `<#${tt.clogCraterChannelId}>` : '*—*';
        const items  = (tt.collectionLog ?? []).length;
        const comp   = tt.clogComp ? ` · 🏆 ${tt.clogComp.name}${tt.clogComp.endTime ? ' (ended)' : ''}` : '';
        const warn   = tt.clogEnabled && !tt.clogChannelId && !tt.clogCraterChannelId ? ' ⚠️ *no channels — drops won\'t post*' : '';
        return `${state} **${tt.displayName}** \`(${tt.slug})\`\n   • Their: ${their}\n   • Crater: ${crater}\n   • Items: **${items}**${comp}${warn}`;
      });

    const enabled  = [...tenants.values()].filter(tt => tt.clogEnabled).length;
    const header   = `📜 **Clog configuration — ${enabled}/${tenants.size} tenant${tenants.size === 1 ? '' : 's'} enabled**\n\n`;
    const content  = header + rows.join('\n\n');

    if (content.length <= 1900) {
      return interaction.reply({ content, ephemeral: true });
    }
    // Edge case: too long for chat — paginate as a file.
    ensureDirs();
    const fname = path.join(DATA_DIR, `clog_listall_${Date.now()}.txt`);
    fs.writeFileSync(fname, content.replace(/<#(\d+)>/g, '#$1'));
    return interaction.reply({ content: header + '(full list attached — too long for chat)', files: [{ attachment: fname, name: 'clog_listall.txt' }], ephemeral: true });
  }

  // ── recent ─────────────────────────────────────────────────────────
  if (sub === 'recent' && !group) {
    let count = interaction.options.getInteger('count') ?? 10;
    count = Math.min(25, Math.max(1, count));
    const log = t.collectionLog ?? [];
    const recent = log.slice(-count).reverse();
    const embed = mkEmbed(t, 0xFF6B35)
      .setTitle(`📜 Recent Collection Logs — ${t.displayName}`);
    if (!recent.length) {
      embed.setDescription('No collection log items recorded yet.');
    } else {
      embed.setDescription(recent.map((e, i) => {
        const countSuffix = e.logCount ? `  *(${e.logCount} total)*` : '';
        return `**${i + 1}.** ${e.player} — ${e.item}${countSuffix}`;
      }).join('\n'));
    }
    return interaction.reply({ embeds: [embed] });
  }

  // ── board ──────────────────────────────────────────────────────────
  if (sub === 'board' && !group) {
    const log = t.collectionLog ?? [];
    const stats = {};
    for (const e of log) {
      const key = ci(e.player);
      if (!stats[key]) stats[key] = { name: e.player, totalItems: 0, highestCount: 0 };
      stats[key].totalItems++;
      if (e.logCount && e.logCount > stats[key].highestCount) stats[key].highestCount = e.logCount;
    }
    const byItems = Object.values(stats)
      .sort((a, b) => b.totalItems - a.totalItems || b.highestCount - a.highestCount)
      .slice(0, 10);
    const byHighest = Object.values(stats)
      .filter(p => p.highestCount > 0)
      .sort((a, b) => b.highestCount - a.highestCount || b.totalItems - a.totalItems)
      .slice(0, 10);

    const embed = mkEmbed(t, 0xFF6B35)
      .setTitle(`📜 ${t.displayName} — Collection Log Leaderboard`);

    if (!byItems.length && !byHighest.length) {
      embed.setDescription('No collection log data yet.');
    } else {
      if (byItems.length) {
        embed.addFields({
          name: '🏆 Most New Items Logged',
          value: fitField(byItems.map((p, i) => `**${i + 1}.** ${p.name} — ${p.totalItems} item${p.totalItems === 1 ? '' : 's'}`)),
          inline: false,
        });
      }
      if (byHighest.length) {
        embed.addFields({
          name: '📊 Highest Collection Log Count',
          value: fitField(byHighest.map((p, i) => `**${i + 1}.** ${p.name} — ${p.highestCount} logs`)),
          inline: false,
        });
      }
    }
    return interaction.reply({ embeds: [embed] });
  }

  // ── comp start/status/end ──────────────────────────────────────────
  if (group === 'comp') {
    if (sub === 'start') {
      if (t.clogComp && !t.clogComp.endTime) {
        return interaction.reply({ content: `⚠️ **${t.clogComp.name}** is already active. End it first with \`/kfclog comp end\`.`, ephemeral: true });
      }
      const name = interaction.options.getString('name', true).trim();
      const days = interaction.options.getInteger('days');
      const startTime = Date.now();
      const endTime = days ? startTime + days * 86_400_000 : null;
      t.clogComp = { name, startTime, endTime };
      saveTenant(t);
      const dur = endTime
        ? `Ends <t:${Math.floor(endTime / 1000)}:R>`
        : 'No end time — use `/kfclog comp end` to finish.';
      return interaction.reply({ embeds: [mkEmbed(t, 0xFF6B35)
        .setTitle(`📜 Competition Started — ${t.displayName}`)
        .setDescription(`**${name}** has begun!\n${dur}\nUse \`/kfclog comp status\` to see standings.`)] });
    }
    if (sub === 'status') {
      const comp = t.clogComp;
      if (!comp) return interaction.reply({ content: 'No collection log competition is running.', ephemeral: true });
      const cutoff = comp.endTime ?? Date.now();
      const entries = (t.collectionLog ?? []).filter(e => e.timestamp >= comp.startTime && e.timestamp <= cutoff);
      const tally = {};
      for (const { player } of entries) {
        const k = ci(player);
        if (!tally[k]) tally[k] = { name: player, count: 0 };
        tally[k].count++;
      }
      const board = Object.values(tally).sort((a, b) => b.count - a.count).slice(0, 10);
      const title = comp.endTime ? `${comp.name} — Final Results` : `${comp.name} — Live Standings`;
      const embed = mkEmbed(t, 0xFF6B35).setTitle(`📜 ${title}`);
      if (!board.length) embed.setDescription('No collection log items recorded yet.');
      else embed.setDescription(board.map((p, i) => `**${i + 1}.** ${p.name} — ${p.count} item${p.count === 1 ? '' : 's'}`).join('\n'));
      return interaction.reply({ embeds: [embed] });
    }
    if (sub === 'end') {
      const comp = t.clogComp;
      if (!comp || comp.endTime) return interaction.reply({ content: '⚠️ No active competition.', ephemeral: true });
      comp.endTime = Date.now();
      saveTenant(t);
      const entries = (t.collectionLog ?? []).filter(e => e.timestamp >= comp.startTime && e.timestamp <= comp.endTime);
      const tally = {};
      for (const { player } of entries) {
        const k = ci(player);
        if (!tally[k]) tally[k] = { name: player, count: 0 };
        tally[k].count++;
      }
      const board = Object.values(tally).sort((a, b) => b.count - a.count).slice(0, 10);
      const embed = mkEmbed(t, 0xFFD700).setTitle(`🏆 ${comp.name} — Final Results`);
      if (!board.length) embed.setDescription('No collection log items were recorded.');
      else {
        embed.setDescription(board.map((p, i) => `**${i + 1}.** ${p.name} — ${p.count} item${p.count === 1 ? '' : 's'}`).join('\n'));
        embed.addFields({ name: '🥇 Winner', value: `**${board[0].name}** with **${board[0].count}** items!` });
      }
      return interaction.reply({ embeds: [embed] });
    }
  }

  return false;
}

// ─── Module init ─────────────────────────────────────────────────────────────
const sessionStart = Date.now();

export function initKillfeed(client) {
  discordClient = client;
  loadSettings();
  loadGlobalAccounts();
  loadRegistry();
  // Fold any pre-existing per-tenant accounts into the global registry once.
  // Idempotent — repeat runs are a no-op.
  migrateLegacyAccountsToGlobal();
  app.listen(PORT, () => console.log(`[KILLFEED] HTTP server on port ${PORT}`));
  setInterval(() => saveAllTenants(), BACKUP_INTERVAL);
  // Each live board ticks on its own setInterval so refreshes can't queue up
  // behind one another. New boards get their timer at /kflive set time.
  startAllBoardTimers();
  setInterval(() => {
    // Expiry sweep — just logs; data stays until /kfclan remove
    for (const t of tenants.values()) {
      if (t.isDefault) continue;
      if (isExpired(t) && !t._expiredLogged) {
        console.log(`[KILLFEED] Tenant "${t.slug}" has expired.`);
        t._expiredLogged = true;
      }
    }
  }, EXPIRY_SWEEP_MS);

  const guestCount = [...tenants.values()].filter(t => !t.isDefault).length;
  console.log(`[KILLFEED] Ready. Default: "${CLAN_FILTER}" (${guestCount} guest${guestCount === 1 ? '' : 's'}), Min loot: ${MIN_LOOT_GP > 0 ? fmtGP(MIN_LOOT_GP) : 'none'}, Live refresh: ${LIVE_REFRESH_MS / 1000}s`);
}
