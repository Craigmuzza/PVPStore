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

const GITHUB_PAT    = process.env.GITHUB_PAT;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH   ?? 'main';
const GIT_NAME      = process.env.GIT_COMMIT_NAME  ?? 'CraterBot';
const GIT_EMAIL     = process.env.GIT_COMMIT_EMAIL ?? 'bot@crater.gg';
const GITHUB_ACTOR  = process.env.GITHUB_ACTOR;

// ─── Paths ───────────────────────────────────────────────────────────────────
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const CLANS_DIR   = path.join(DATA_DIR, 'clans');
const CLANS_FILE  = path.join(DATA_DIR, 'clans.json');
const KF          = s => path.join(DATA_DIR, `killfeed_${s}.json`);
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
const LOOT_RE  = /^(.+?)\s+has\s+defeated\s+(.+?)\s+and\s+received\s+\(\s*([\d,]+)\s*coins\).*$/i;
const DEATH_RE = /^(.+?)\s+has\s+been\s+defeated\s+by\s+(.+?)\s+in\s+The\s+Wilderness\s+and\s+lost\s+\(\s*([\d,]+)\s*(?:coins\s*)?\)\s+worth\s+of\s+loot\.?$/i;

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

// ─── Tenants ─────────────────────────────────────────────────────────────────
// One Tenant object per registered clan. Crater is special-cased: it uses the
// pre-existing killfeed_*.json files and never expires.

function makeTenant({ slug, displayName, clanNameLower, guildId, killChannelId, expiresAt, addedAt, addedBy, files, isDefault }) {
  return {
    slug,
    displayName,
    clanNameLower,
    guildId: guildId ?? null,
    killChannelId: killChannelId ?? null,
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
      expiresAt: t.expiresAt,
      addedAt: t.addedAt,
      addedBy: t.addedBy,
    };
  }
  fs.writeFileSync(CLANS_FILE, JSON.stringify(out, null, 2));
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
    for (const r of rsns) t.rsnMap[ci(r)] = uid;
}

function playerKey(t, rsnLower) {
  return t.rsnMap[rsnLower] ?? rsnLower;
}

// Re-resolve a log entry's key against the CURRENT rsnMap, so registrations
// added after the kill/death/loot was logged still aggregate retroactively.
// Falls back to the stored key when the RSN field is missing on legacy entries.
function liveKey(t, rsn, fallback) {
  if (rsn) return playerKey(t, rsn);
  return fallback;
}

async function displayName(key, guild) {
  if (!key) return 'Unknown';
  if (/^\d{17,19}$/.test(key)) {
    try {
      const m = await guild.members.fetch(key);
      return m.displayName;
    } catch { return `<@${key}>`; }
  }
  return key;
}

// ─── Embed factory ───────────────────────────────────────────────────────────
function mkEmbed(t, color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTimestamp()
    .setThumbnail(EMBED_ICON)
    .setFooter({ text: t.displayName });
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

// ─── Loot processing (per tenant) ────────────────────────────────────────────
async function processLoot(t, killerRSN, victimRSN, gp) {
  if (isDup(`${t.slug}|L|${ci(killerRSN)}|${ci(victimRSN)}|${gp}`)) return;
  if (gp < MIN_LOOT_GP) return;
  if (!t.killChannelId) { console.warn(`[KILLFEED] ${t.slug}: no kill channel set`); return; }

  const kci  = ci(killerRSN);
  const vci  = ci(victimRSN);
  const kKey = playerKey(t, kci);
  const vKey = playerKey(t, vci);

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
    await sendEmbed(t.killChannelId, mkEmbed(t, 0xFF0000)
      .setTitle(`🩸 First Blood — ${killerRSN} draws first blood!`)
      .setDescription(`${killerLabel} opens the day by slaying ${victimLabel}\nLooted **${fmtGP(gp)} GP**`)
    );
  }

  const embed = mkEmbed(t, gpColor(gp))
    .setTitle(`☠️  ${killerRSN} slayed ${victimRSN}`)
    .setDescription(`${killerLabel} looted **${fmtGP(gp)} GP** from ${victimLabel}\n*(${gp.toLocaleString()} coins)*`);

  if (streak >= 3) embed.addFields({ name: '🔥 Kill Streak', value: `${streak} in a row!`, inline: true });

  await sendEmbed(t.killChannelId, embed);

  if (STREAK_MILESTONES.has(streak)) {
    await sendEmbed(t.killChannelId, mkEmbed(t, 0xFF6600)
      .setTitle(`🔥 ${killerRSN} is on a ${streak}-KILL STREAK!`)
      .setDescription(`${killerLabel} has killed ${streak} players without dying!`)
    );
  }

  const killerTotal = t.lootLog.filter(e => e.killer === kKey).reduce((s, e) => s + (e.gp ?? 0), 0);
  for (const m of LOOT_MILESTONES) {
    if (killerTotal - gp < m && killerTotal >= m) {
      await sendEmbed(t.killChannelId, mkEmbed(t, 0xFFD700)
        .setTitle(`💰 ${killerRSN} hit ${fmtGP(m)} total loot!`)
        .setDescription(`${killerLabel} has now looted **${fmtGP(killerTotal)} GP** in total!`)
      );
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

  resetStreak(t, playerKey(t, pci));
  t.deathLog.push({ player: playerKey(t, pci), playerRSN: pci, killedBy: kci ? playerKey(t, kci) : null, killedByRSN: kci, gp, timestamp: Date.now() });

  const desc = kci
    ? `Killed by **${killedByRSN}**${gp > 0 ? ` · Lost **${fmtGP(gp)} GP**` : ''}`
    : `Died in the wilderness.${gp > 0 ? ` Lost **${fmtGP(gp)} GP**` : ''}`;

  await sendEmbed(t.killChannelId, mkEmbed(t, 0x880000)
    .setTitle(`💀 ${playerRSN} has died!`)
    .setDescription(desc)
  );
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
    }

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
    const fmt    = rows => rows.map(r => `${medal(r.rank)}  **${r.name}** — ${r.value}`).join('\n') || '*No data yet*';
    const fmtAll = rows => rows.map(r => `${medal(r.rank)}  **${r.name}** — ${r.value}  *· ${getRank(allKills[r.key] ?? 0)}*`).join('\n') || '*No data yet*';
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
    const fmt = rows => rows.map(r => `${medal(r.rank)}  **${r.name}** — ${fmtGP(r.value)} GP`).join('\n') || '*No data yet*';
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
    const fmt = rows => rows.map(r => `${medal(r.rank)}  **${r.name}** — ${r.count} deaths · ${fmtGP(r.gp)} GP`).join('\n') || '*No data yet*';
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
      const lines = rows.map(r => fmtRow(r, showBreakdown)).join('\n');
      return { lines: lines || '*No data yet*', totalNet };
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
  } catch (e) {
    console.error(`[KILLFEED] Live board "${t.slug}:${key}" refresh failed — removing:`, e.message);
    delete t.liveBoards[key];
    saveTenant(t);
  }
}

// ─── Exported helpers (Crater-targeted for onboarding compat) ────────────────
export function registerRSNs(userId, rsns) {
  const t = craterTenant();
  t.accounts[userId] = [...new Set([...(t.accounts[userId] ?? []), ...rsns])];
  rebuildRsnMap(t);
  saveTenant(t);
}

export function getAccountRSNs(userId) {
  const t = craterTenant();
  return t.accounts[userId] ?? [];
}

export function removeRSNs(userId, rsns) {
  const t = craterTenant();
  const lower = rsns.map(r => r.toLowerCase());
  t.accounts[userId] = (t.accounts[userId] ?? []).filter(r => !lower.includes(r.toLowerCase()));
  rebuildRsnMap(t);
  saveTenant(t);
}

export function replaceAllRSNs(userId, rsns) {
  const t = craterTenant();
  t.accounts[userId] = [...new Set(rsns)];
  rebuildRsnMap(t);
  saveTenant(t);
}

// ─── Slash command definitions ───────────────────────────────────────────────
export const killfeedCommands = [

  new SlashCommandBuilder().setName('kfoverview').setDescription('View a leaderboard — shows daily, weekly, monthly & all-time')
    .addStringOption(o => o.setName('type').setDescription('Board type').setRequired(true).addChoices(...BOARD_CHOICES)),

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
      .addStringOption(o => o.setName('rsn').setDescription('RSN to look up').setRequired(true))),

  new SlashCommandBuilder().setName('kflive').setDescription('Manage auto-refreshing live leaderboards')
    .addSubcommand(s => s.setName('set').setDescription('Post a live leaderboard that auto-refreshes in this channel')
      .addStringOption(o => o.setName('type').setDescription('Board type').setRequired(true).addChoices(...BOARD_CHOICES)))
    .addSubcommand(s => s.setName('clear').setDescription('Remove a live leaderboard from this channel')
      .addStringOption(o => o.setName('type').setDescription('Board type').setRequired(true).addChoices(...BOARD_CHOICES)))
    .addSubcommand(s => s.setName('list').setDescription('Show all active live leaderboards')),

  new SlashCommandBuilder().setName('kfprofile').setDescription('View all stats for a specific player')
    .addStringOption(o => o.setName('player').setDescription('RSN or @mention').setRequired(true)),

  new SlashCommandBuilder().setName('kflistall').setDescription('List every RSN registered in the clan'),

  new SlashCommandBuilder().setName('kfhelp').setDescription('All kill feed commands'),

  new SlashCommandBuilder().setName('kfadmin').setDescription('Kill feed admin commands')
    .addSubcommand(s => s.setName('addgp').setDescription('Manually add GP to a player')
      .addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true))
      .addStringOption(o => o.setName('amount').setDescription('Amount e.g. 5m, 100k').setRequired(true)))
    .addSubcommand(s => s.setName('removegp').setDescription('Manually remove GP from a player')
      .addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true))
      .addStringOption(o => o.setName('amount').setDescription('Amount to remove').setRequired(true)))
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
    .addSubcommand(s => s.setName('add').setDescription('Register a guest clan')
      .addStringOption(o => o.setName('slug').setDescription('Short identifier e.g. infliction').setRequired(true))
      .addStringOption(o => o.setName('clan_name').setDescription('Clan name exactly as it appears in Dink').setRequired(true))
      .addStringOption(o => o.setName('guild_id').setDescription('Their Discord server ID').setRequired(true))
      .addStringOption(o => o.setName('channel_id').setDescription('Their killfeed channel ID').setRequired(true))
      .addIntegerOption(o => o.setName('days').setDescription('Trial duration in days').setRequired(true))
      .addStringOption(o => o.setName('display').setDescription('Display name (default: clan_name)')))
    .addSubcommand(s => s.setName('remove').setDescription('Deregister a guest clan and DELETE its data')
      .addStringOption(o => o.setName('slug').setDescription('Clan slug').setRequired(true))
      .addStringOption(o => o.setName('confirm').setDescription('Type CONFIRM to proceed').setRequired(true)))
    .addSubcommand(s => s.setName('extend').setDescription('Extend a guest clan trial')
      .addStringOption(o => o.setName('slug').setDescription('Clan slug').setRequired(true))
      .addIntegerOption(o => o.setName('days').setDescription('Additional days').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List all registered guest clans'))
    .addSubcommand(s => s.setName('channel').setDescription('Change the killfeed channel for a guest clan')
      .addStringOption(o => o.setName('slug').setDescription('Clan slug').setRequired(true))
      .addStringOption(o => o.setName('channel_id').setDescription('New channel ID').setRequired(true))),
];

// ─── Interaction handler ──────────────────────────────────────────────────────
export async function handleKillfeedInteraction(interaction) {
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
    'kfrsn','kflive','kfadmin','kfhelp','kfclan',
  ];
  if (!kf.includes(cmd)) return false;

  // /kfclan is Crater-admin only and resolved separately
  if (cmd === 'kfclan') return handleKfClan(interaction);

  const t = tenantForGuild(interaction.guildId);
  if (!t) return interaction.reply({ content: 'This server is not registered with the killfeed.', ephemeral: true });
  if (isExpired(t)) return interaction.reply({ content: `⏰ ${t.displayName}'s killfeed trial has expired.`, ephemeral: true });

  // ── /kfoverview ────────────────────────────────────────────────────
  if (cmd === 'kfoverview') {
    await interaction.deferReply({ ephemeral: true });
    const type       = interaction.options.getString('type', true);
    const key        = `${interaction.channelId}_${type}`;
    const sortBy     = t.liveBoards[key]?.sortBy ?? 'count';
    const embed      = await buildBoardEmbed(t, type, interaction.guild, { sortBy });
    const components = boardComponents(type, sortBy);
    const msg        = await interaction.channel.send({ embeds: [embed], components });
    t.liveBoards[key] = { type, channelId: interaction.channelId, messageId: msg.id, sortBy };
    saveTenant(t);
    return interaction.editReply({ content: `✅ Live **${type}** board posted. Refreshes every ${Math.round(LIVE_REFRESH_MS / 60_000)} minutes.` });
  }

  // ── /kfprofile ─────────────────────────────────────────────────────
  if (cmd === 'kfprofile') {
    await interaction.deferReply();
    const input  = interaction.options.getString('player', true).trim();
    const mentionId = input.match(/^<@!?(\d+)>$/)?.[1];
    const key    = mentionId ?? playerKey(t, ci(input));
    const name   = await displayName(key, interaction.guild);

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

    return interaction.editReply({ embeds: [
      mkEmbed(t, 0x5865F2)
        .setTitle(`📋 ${name}`)
        .setDescription(`${getRank(allKills)}${streak ? `  ·  🔥 Current streak: **${streak.current}**  ·  Best: **${streak.best}**` : ''}`)
        .addFields(
          { name: '☠️ Kills',          value: kills.map(fmtKills).join('\n'),   inline: true },
          { name: '💰 Loot',           value: loot.map(fmtLoot).join('\n'),     inline: true },
          { name: '💀 Deaths',         value: deaths.map(fmtDeaths).join('\n'), inline: false },
          { name: '📊 Profit & Loss',  value: pnl.map(fmtPnl).join('\n'),      inline: false },
        ),
    ]});
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
  if (cmd === 'kfrsn') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const target = (interaction.options.getUser('user') ?? interaction.user).id;
      const rsns   = t.accounts[target] ?? [];
      return interaction.reply({ content: rsns.length ? `Accounts for <@${target}>: **${rsns.join(', ')}**` : `No accounts linked to <@${target}>.`, ephemeral: true });
    }
    if (sub === 'whohas') {
      const rsn = interaction.options.getString('rsn', true).trim();
      const uid = t.rsnMap[ci(rsn)];
      return interaction.reply({ content: uid ? `**${rsn}** is linked to <@${uid}>.` : `**${rsn}** is not linked to any Discord account.`, ephemeral: true });
    }
    if (sub === 'link') {
      const rsn  = interaction.options.getString('rsn', true).trim();
      const user = interaction.options.getUser('user', true);
      t.rsnMap[ci(rsn)] = user.id;
      t.accounts[user.id] = [...new Set([...(t.accounts[user.id] ?? []), rsn])];
      saveTenant(t);
      return interaction.reply({ content: `✅ Linked **${rsn}** → <@${user.id}>.`, ephemeral: true });
    }
    if (sub === 'unlink') {
      const rsn    = interaction.options.getString('rsn', true).trim();
      const rsnLow = ci(rsn);
      const uid    = t.rsnMap[rsnLow];
      delete t.rsnMap[rsnLow];
      if (uid && t.accounts[uid]) t.accounts[uid] = t.accounts[uid].filter(r => ci(r) !== rsnLow);
      saveTenant(t);
      return interaction.reply({ content: `✅ Unlinked RSN **${rsn}**.`, ephemeral: true });
    }
    const target = (interaction.options.getUser('user') ?? interaction.user).id;
    const rsns   = interaction.options.getString('rsns', true).split(',').map(s => s.trim()).filter(Boolean);
    if (sub === 'add') {
      t.accounts[target] = [...new Set([...(t.accounts[target] ?? []), ...rsns])];
      rebuildRsnMap(t); saveTenant(t);
      return interaction.reply({ content: `✅ Linked **${rsns.join(', ')}** → <@${target}>.`, ephemeral: true });
    }
    if (sub === 'remove') {
      const lower = rsns.map(r => r.toLowerCase());
      t.accounts[target] = (t.accounts[target] ?? []).filter(r => !lower.includes(r.toLowerCase()));
      rebuildRsnMap(t); saveTenant(t);
      return interaction.reply({ content: `✅ Unlinked **${rsns.join(', ')}** from <@${target}>.`, ephemeral: true });
    }
  }

  // ── /kflive ────────────────────────────────────────────────────────
  if (cmd === 'kflive') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      await interaction.deferReply({ ephemeral: true });
      const type       = interaction.options.getString('type', true);
      const key        = `${interaction.channelId}_${type}`;
      const sortBy     = t.liveBoards[key]?.sortBy ?? 'count';
      const embed      = await buildBoardEmbed(t, type, interaction.guild, { sortBy });
      const components = boardComponents(type, sortBy);
      const msg        = await interaction.channel.send({ embeds: [embed], components });
      t.liveBoards[key] = { type, channelId: interaction.channelId, messageId: msg.id, sortBy };
      saveTenant(t);
      return interaction.editReply({ content: `✅ Live **${type}** board posted in <#${interaction.channelId}>. Refreshes every ${Math.round(LIVE_REFRESH_MS / 60_000)} minutes.` });
    }

    if (sub === 'clear') {
      const type = interaction.options.getString('type', true);
      const key  = `${interaction.channelId}_${type}`;
      if (!t.liveBoards[key]) return interaction.reply({ content: `No live **${type}** board in this channel.`, ephemeral: true });
      delete t.liveBoards[key];
      saveTenant(t);
      return interaction.reply({ content: `✅ Live **${type}** board removed.`, ephemeral: true });
    }

    if (sub === 'list') {
      const active = Object.values(t.liveBoards);
      if (!active.length) return interaction.reply({ content: 'No live boards active.', ephemeral: true });
      const lines = active.map(b => `• **${b.type}** — <#${b.channelId}>`);
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
    const all = Object.values(t.accounts).flat();
    if (!all.length) return interaction.reply({ content: 'No RSNs registered yet.', ephemeral: true });
    const sorted = [...new Set(all)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const list = sorted.join(', ');
    const header = `**${sorted.length}** RSN${sorted.length === 1 ? '' : 's'} registered:\n`;
    if (header.length + list.length + 8 <= 1900) {
      return interaction.reply({ content: `${header}\`\`\`\n${list}\n\`\`\`` });
    }
    ensureDirs();
    const fname = path.join(DATA_DIR, `rsns_${t.slug}_${Date.now()}.txt`);
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
          '`/kfprofile <player>` — Full stat sheet for one player',
          '`/kfstreaks` — Active & all-time kill streaks',
          '`/kftotalgp` — Total GP looted by the clan',
          '`/kfsession` — Stats since last bot restart',
          '`/kfrivalry <player1> <player2>` — Head-to-head record',
        ].join('\n'), inline: false },
      { name: '📺 Live Boards',
        value: [
          '`/kflive set <type>` — Post a live board that auto-refreshes',
          '`/kflive clear <type>` — Remove a live board from this channel',
          '`/kflive list` — Show all active live boards',
          '*Types: kills · loot · graves · pnl*',
        ].join('\n'), inline: false },
      { name: '🔗 RSN Linking',
        value: [
          '`/kfrsn add <rsns> [user]` — Link RSNs to a Discord account',
          '`/kfrsn remove <rsns> [user]` — Unlink RSNs',
          '`/kfrsn list [user]` — View linked RSNs',
          '`/kfrsn link <rsn> <user>` — Manual RSN override',
          '`/kfrsn unlink <rsn>` — Remove a manual override',
          '`/kfrsn whohas <rsn>` — Find who owns an RSN',
          '`/kflistall` — List every RSN registered in the clan',
        ].join('\n'), inline: false },
      { name: '🔧 Admin',
        value: [
          '`/kfadmin addgp/removegp <player> <amount>` — Adjust GP manually',
          '`/kfadmin reset <player>` — Reset one player\'s stats',
          '`/kfadmin resetall CONFIRM` — ⚠️ Wipe all kill feed data',
          '`/kfadmin export <type> [period]` — Export data as CSV',
        ].join('\n'), inline: false },
    ];

    if (isCraterAdmin) {
      fields.push({
        name: '🌐 Guest Clans *(Crater admin only)*',
        value: [
          '`/kfclan add <slug> <clan_name> <guild_id> <channel_id> <days> [display]` — Register a guest clan',
          '`/kfclan remove <slug> CONFIRM` — Deregister and **delete** the clan\'s data',
          '`/kfclan extend <slug> <days>` — Extend the trial',
          '`/kfclan channel <slug> <channel_id>` — Change the killfeed channel',
          '`/kfclan list` — Show all registered guest clans + remaining days',
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

  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const guests = [...tenants.values()].filter(t => !t.isDefault);
    if (!guests.length) return interaction.reply({ content: 'No guest clans registered.', ephemeral: true });
    const lines = guests.map(t => {
      const remaining = t.expiresAt ? Math.max(0, Math.ceil((t.expiresAt - Date.now()) / 86_400_000)) : '∞';
      const exp = isExpired(t) ? ' ⏰ EXPIRED' : '';
      return `• **${t.displayName}** (\`${t.slug}\`) — clan "${t.clanNameLower}" → <#${t.killChannelId}> · ${remaining} day${remaining === 1 ? '' : 's'} left${exp}`;
    });
    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }

  if (sub === 'add') {
    const slugRaw    = interaction.options.getString('slug', true);
    const clanName   = interaction.options.getString('clan_name', true);
    const guildId    = interaction.options.getString('guild_id', true);
    const channelId  = interaction.options.getString('channel_id', true);
    const days       = interaction.options.getInteger('days', true);
    const display    = interaction.options.getString('display') ?? clanName;

    const slug = slugify(slugRaw);
    if (!slug) return interaction.reply({ content: '❌ Invalid slug.', ephemeral: true });
    if (slug === 'crater') return interaction.reply({ content: '❌ "crater" is reserved.', ephemeral: true });
    if (tenants.has(slug)) return interaction.reply({ content: `❌ Slug "${slug}" already exists.`, ephemeral: true });
    if (tenantByClan.has(ci(clanName))) return interaction.reply({ content: `❌ Clan name "${clanName}" already routes elsewhere.`, ephemeral: true });
    if (tenantByGuild.has(guildId)) return interaction.reply({ content: `❌ Guild ${guildId} already routes elsewhere.`, ephemeral: true });
    if (days <= 0) return interaction.reply({ content: '❌ Days must be positive.', ephemeral: true });

    const t = makeTenant({
      slug,
      displayName: display,
      clanNameLower: ci(clanName),
      guildId,
      killChannelId: channelId,
      expiresAt: Date.now() + days * 86_400_000,
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

    return interaction.reply({ content:
      `✅ Registered **${display}** (\`${slug}\`)\n` +
      `Clan name: "${clanName}"\n` +
      `Guild: ${guildId}\n` +
      `Channel: <#${channelId}>\n` +
      `Expires: <t:${Math.floor(t.expiresAt / 1000)}:R>`, ephemeral: true });
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

// ─── Module init ─────────────────────────────────────────────────────────────
const sessionStart = Date.now();

export function initKillfeed(client) {
  discordClient = client;
  loadRegistry();
  app.listen(PORT, () => console.log(`[KILLFEED] HTTP server on port ${PORT}`));
  setInterval(() => saveAllTenants(), BACKUP_INTERVAL);
  setInterval(async () => {
    for (const t of tenants.values()) {
      if (isExpired(t)) continue;
      for (const key of Object.keys(t.liveBoards)) await refreshLiveBoard(t, key);
    }
  }, LIVE_REFRESH_MS);
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
