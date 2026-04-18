// killfeed.js
// Kill Feed module for The Crater bot
// Runs the webhook server (Express) and handles all ! kill feed commands.
// Integrated into bot.js — shares the existing Discord client.

import express       from 'express';
import multer        from 'multer';
import { Collection, EmbedBuilder } from 'discord.js';
import { execFile }  from 'child_process';
import fs            from 'fs';
import path          from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Environment ─────────────────────────────────────────────────────────────
const KILL_CHANNEL  = process.env.KILL_FEED_CHANNEL_ID;
const CLOG_CHANNEL  = process.env.CLOG_CHANNEL_ID ?? KILL_CHANNEL;
const CLAN_FILTER   = (process.env.CLAN_FILTER     ?? 'the crater').toLowerCase();
const MIN_LOOT_GP   = parseInt(process.env.MIN_LOOT_GP ?? '0', 10);
const PORT          = Number(process.env.PORT) || 10000;

// Reuse the same Crater icon used across the bot
const EMBED_ICON = process.env.EMBED_ICON ?? 'https://i.ibb.co/8nXbWYmq/The-Craterlogo.webp';

// GitHub backup (optional)
const GITHUB_PAT    = process.env.GITHUB_PAT;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH  ?? 'main';
const GIT_NAME      = process.env.GIT_COMMIT_NAME ?? 'CraterBot';
const GIT_EMAIL     = process.env.GIT_COMMIT_EMAIL ?? 'bot@crater.gg';
const GITHUB_ACTOR  = process.env.GITHUB_ACTOR;

// ─── Paths ───────────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const KF       = s => path.join(DATA_DIR, `killfeed_${s}.json`);

// ─── Timing ──────────────────────────────────────────────────────────────────
const DEDUP_MS         = 10_000;
const COMMAND_COOLDOWN = 3_000;
const BACKUP_INTERVAL  = 5 * 60 * 1000;

// ─── GP colour tiers ─────────────────────────────────────────────────────────
const COLOR_TINY   = 0x808080;
const COLOR_NORMAL = 0x00CC44;
const COLOR_BIG    = 0xFF4400;
const COLOR_HUGE   = 0xFFD700;
const COLOR_INSANE = 0xAA00FF;

// ─── Milestone thresholds ────────────────────────────────────────────────────
const STREAK_MILESTONES = new Set([3, 5, 10, 25, 50, 100]);
const LOOT_MILESTONES   = [100_000_000, 500_000_000, 1_000_000_000, 5_000_000_000, 10_000_000_000];

// ─── Regex ───────────────────────────────────────────────────────────────────
// Loot:   "KillerName has defeated VictimName and received (1,234,567 coins)"
const LOOT_RE  = /^(.+?)\s+has\s+defeated\s+(.+?)\s+and\s+received\s+\(\s*([\d,]+)\s*coins\).*$/i;
// Clog:   "PlayerName received a new collection log item: Item Name (12/1609)"
const CLOG_RE  = /^(.+?)\s+received a new collection log item:\s*(.+)$/i;
// Death:  update this once the in-game death message format is confirmed
const DEATH_RE = /^(.+?)\s+has\s+been\s+defeated\s+by\s+(.+?)(?:\.|$)/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ci = s => (s ?? '').toLowerCase().trim();

function fmtGP(n) {
  if (n >= 1_000_000_000) return `${+(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `${+(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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

// ─── Runtime state ───────────────────────────────────────────────────────────
let currentEvent = 'default';
let clanOnlyMode = false;
let clogEnabled  = true;
let events       = { default: { deathCounts: {}, lootTotals: {}, gpTotal: {}, kills: {} } };
let killLog            = [];
let lootLog            = [];
let deathLog           = [];
let collectionLogItems = [];
let clogComp           = null;
let registered   = new Set();
let raglist      = new Set();
let bounties     = {};
let accounts     = {};   // discordId → [rsn, ...]
let rsnMap       = {};   // rsn_lower → discordId
let killStreaks   = {};   // playerKey → { current, best }

const seen             = new Map();
const commandCooldowns = new Collection();
const sessionStart     = Date.now();

let discordClient = null;

// ─── RSN ↔ Discord ──────────────────────────────────────────────────────────
function rebuildRsnMap() {
  const existing = { ...rsnMap }; // preserve manual overrides
  rsnMap = existing;
  for (const [uid, rsns] of Object.entries(accounts))
    for (const r of rsns) rsnMap[ci(r)] = uid;
}

function playerKey(rsnLower) {
  return rsnMap[rsnLower] ?? rsnLower;
}

async function displayName(key, guild) {
  if (!key) return 'Unknown';
  if (/^\d{17,19}$/.test(key)) {
    try {
      const m = await guild.members.fetch(key);
      const rsns = accounts[key] ?? [];
      return rsns.length ? `${m.displayName} (${rsns.join(', ')})` : m.displayName;
    } catch { return `<@${key}>`; }
  }
  return key;
}

// ─── Persistence ─────────────────────────────────────────────────────────────
function ensureDirs() {
  [DATA_DIR, path.join(DATA_DIR, 'events')].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function loadState() {
  ensureDirs();
  try {
    const s = JSON.parse(fs.readFileSync(KF('state'), 'utf8'));
    currentEvent       = s.currentEvent       ?? 'default';
    clanOnlyMode       = s.clanOnlyMode       ?? false;
    events             = s.events             ?? { default: { deathCounts: {}, lootTotals: {}, gpTotal: {}, kills: {} } };
    killLog            = s.killLog            ?? [];
    lootLog            = s.lootLog            ?? [];
    deathLog           = s.deathLog           ?? [];
    collectionLogItems = s.collectionLogItems ?? [];
    clogComp           = s.clogComp           ?? null;
    killStreaks         = s.killStreaks        ?? {};
    clogEnabled        = s.clogEnabled        ?? true;
  } catch {}

  try { registered = new Set(JSON.parse(fs.readFileSync(KF('registered'), 'utf8')).map(ci)); } catch { registered = new Set(); }
  try { raglist    = new Set(JSON.parse(fs.readFileSync(KF('raglist'),    'utf8')).map(ci)); } catch { raglist    = new Set(); }

  try {
    bounties = JSON.parse(fs.readFileSync(KF('bounties'), 'utf8'));
    for (const [k, v] of Object.entries(bounties)) {
      if (typeof v === 'number') {
        bounties[k] = { once: { total: v, posters: {} }, persistent: { total: 0, posters: {} } };
      } else {
        bounties[k] = {
          once:       { total: v.once?.total        ?? 0, posters: v.once?.posters        ?? {} },
          persistent: { total: v.persistent?.total  ?? 0, posters: v.persistent?.posters  ?? {} },
        };
      }
    }
  } catch { bounties = {}; }

  try { accounts = JSON.parse(fs.readFileSync(KF('accounts'), 'utf8')); } catch { accounts = {}; }
  try { rsnMap   = JSON.parse(fs.readFileSync(KF('rsnmap'),   'utf8')); } catch { rsnMap   = {}; }

  rebuildRsnMap();
}

function saveState() {
  ensureDirs();
  fs.writeFileSync(KF('state'), JSON.stringify({
    currentEvent, clanOnlyMode, clogEnabled, events,
    killLog, lootLog, deathLog,
    collectionLogItems, clogComp, killStreaks,
  }, null, 2));
  fs.writeFileSync(KF('registered'), JSON.stringify([...registered]));
  fs.writeFileSync(KF('raglist'),    JSON.stringify([...raglist]));
  fs.writeFileSync(KF('bounties'),   JSON.stringify(bounties,  null, 2));
  fs.writeFileSync(KF('accounts'),   JSON.stringify(accounts,  null, 2));
  fs.writeFileSync(KF('rsnmap'),     JSON.stringify(rsnMap,    null, 2));
  queueGitBackup();
}

// ─── Git backup (optional) ──────────────────────────────────────────────────
let gitTimer = null;
function queueGitBackup() {
  if (!GITHUB_PAT || !GITHUB_REPO) return;
  clearTimeout(gitTimer);
  gitTimer = setTimeout(pushGit, 5 * 60 * 1000);
}

function git(...args) {
  return new Promise(res => execFile('git', args, { cwd: __dirname }, (_e, out) => res(out)));
}

async function pushGit() {
  try {
    const remote = `https://${GITHUB_ACTOR}:${GITHUB_PAT}@github.com/${GITHUB_REPO}.git`;
    await git('config', 'user.name',  GIT_NAME);
    await git('config', 'user.email', GIT_EMAIL);
    await git('remote', 'set-url', 'origin', remote);
    await git('add', 'data/');
    await git('commit', '-m', `auto-save ${new Date().toISOString()}`);
    await git('push', 'origin', GITHUB_BRANCH);
  } catch {}
}

// ─── Embed factory ──────────────────────────────────────────────────────────
function mkEmbed(color) {
  return new EmbedBuilder().setColor(color).setTimestamp().setThumbnail(EMBED_ICON);
}

// ─── Dedup ───────────────────────────────────────────────────────────────────
function isDup(key) {
  const now = Date.now();
  if (seen.has(key) && now - seen.get(key) < DEDUP_MS) return true;
  seen.set(key, now);
  return false;
}

setInterval(() => {
  const cut = Date.now() - DEDUP_MS * 2;
  for (const [k, ts] of seen) if (ts < cut) seen.delete(k);
}, 60_000);

// ─── Streak helpers ──────────────────────────────────────────────────────────
function addKill(key) {
  if (!killStreaks[key]) killStreaks[key] = { current: 0, best: 0 };
  killStreaks[key].current++;
  if (killStreaks[key].current > killStreaks[key].best) killStreaks[key].best = killStreaks[key].current;
  return killStreaks[key].current;
}

function resetStreak(key) {
  if (killStreaks[key]) killStreaks[key].current = 0;
}

// ─── Event bucket ────────────────────────────────────────────────────────────
function getEvent(name) {
  if (!events[name]) events[name] = { deathCounts: {}, lootTotals: {}, gpTotal: {}, kills: {} };
  return events[name];
}

// ─── Send embed helper ───────────────────────────────────────────────────────
async function sendEmbed(channelId, embed) {
  if (!channelId || !discordClient) return;
  try {
    const ch = await discordClient.channels.fetch(channelId);
    await ch.send({ embeds: [embed] });
  } catch (e) { console.error('[KILLFEED] sendEmbed:', e.message); }
}

// ─── Loot processing ─────────────────────────────────────────────────────────
async function processLoot(killerRSN, victimRSN, gp) {
  if (isDup(`L|${ci(killerRSN)}|${ci(victimRSN)}|${gp}`)) return;
  if (gp < MIN_LOOT_GP) return;
  if (!KILL_CHANNEL) { console.warn('[KILLFEED] KILL_FEED_CHANNEL_ID not set'); return; }

  const kci  = ci(killerRSN);
  const vci  = ci(victimRSN);
  const kKey = playerKey(kci);
  const vKey = playerKey(vci);
  const isClan = registered.size === 0 || registered.has(kci) || registered.has(vci);
  if (clanOnlyMode && !isClan) return;

  const ev = getEvent(currentEvent);
  ev.gpTotal[kKey]     = (ev.gpTotal[kKey]     ?? 0) + gp;
  ev.lootTotals[kKey]  = (ev.lootTotals[kKey]  ?? 0) + gp;
  ev.kills[kKey]       = (ev.kills[kKey]        ?? 0) + 1;
  ev.deathCounts[vKey] = (ev.deathCounts[vKey]  ?? 0) + 1;

  const streak = addKill(kKey);
  resetStreak(vKey);

  const now = Date.now();
  killLog.push({ killer: kKey, killerRSN: kci, victim: vKey, victimRSN: vci, gp, timestamp: now, event: currentEvent, isClan });
  lootLog.push({ killer: kKey, killerRSN: kci, victim: vKey, victimRSN: vci, gp, timestamp: now, event: currentEvent, isClan, manual: false });

  // Kill feed embed
  const killerLabel = /^\d{17,19}$/.test(kKey) ? `<@${kKey}>` : killerRSN;
  const victimLabel  = /^\d{17,19}$/.test(vKey) ? `<@${vKey}>` : victimRSN;

  const embed = mkEmbed(gpColor(gp))
    .setTitle(`☠️  ${killerRSN} slayed ${victimRSN}`)
    .setDescription(
      `${killerLabel} looted **${fmtGP(gp)} GP** from ${victimLabel}\n*(${gp.toLocaleString()} coins)*`
    );

  if (streak >= 3)      embed.addFields({ name: '🔥 Kill Streak', value: `${streak} in a row!`, inline: true });
  if (raglist.has(vci)) embed.addFields({ name: '🎯 Raglist',    value: `${victimRSN} is wanted!`, inline: true });

  await sendEmbed(KILL_CHANNEL, embed);

  // Streak milestone
  if (STREAK_MILESTONES.has(streak)) {
    await sendEmbed(KILL_CHANNEL, mkEmbed(0xFF6600)
      .setTitle(`🔥 ${killerRSN} is on a ${streak}-KILL STREAK!`)
      .setDescription(`${killerLabel} has killed ${streak} players without dying!`)
    );
  }

  // Loot milestone
  const newTotal = ev.gpTotal[kKey];
  for (const m of LOOT_MILESTONES) {
    if (newTotal - gp < m && newTotal >= m) {
      await sendEmbed(KILL_CHANNEL, mkEmbed(0xFFD700)
        .setTitle(`💰 ${killerRSN} hit ${fmtGP(m)} total loot!`)
        .setDescription(`${killerLabel} has now looted **${fmtGP(newTotal)} GP** this season!`)
      );
    }
  }

  // Bounty check
  if (bounties[vci]) {
    const b    = bounties[vci];
    const msgs = [];
    if (b.once.total > 0) {
      msgs.push(`💸 One-shot bounty claimed: **${fmtGP(b.once.total)} GP**`);
      const ps = Object.keys(b.once.posters);
      if (ps.length) msgs.push(`Posted by: ${ps.join(', ')}`);
      b.once = { total: 0, posters: {} };
    }
    if (b.persistent.total > 0)
      msgs.push(`🔁 Persistent bounty triggered: **${fmtGP(b.persistent.total)} GP/kill**`);
    if (msgs.length) {
      await sendEmbed(KILL_CHANNEL, mkEmbed(0xFFAA00)
        .setTitle(`🏆 Bounty Claimed on ${victimRSN}!`)
        .setDescription(msgs.join('\n'))
      );
    }
    if (b.once.total === 0 && b.persistent.total === 0) delete bounties[vci];
  }

  saveState();
}

// ─── Death processing ─────────────────────────────────────────────────────────
async function processDeath(playerRSN, killedByRSN) {
  const pci = ci(playerRSN);
  const kci = killedByRSN ? ci(killedByRSN) : null;
  if (isDup(`D|${pci}|${kci ?? ''}|${Math.floor(Date.now() / DEDUP_MS)}`)) return;
  if (!KILL_CHANNEL) return;

  const pKey = playerKey(pci);
  resetStreak(pKey);
  getEvent(currentEvent).deathCounts[pKey] = (getEvent(currentEvent).deathCounts[pKey] ?? 0) + 1;

  deathLog.push({
    player: pKey, playerRSN: pci,
    killedBy: kci ? playerKey(kci) : null, killedByRSN: kci,
    timestamp: Date.now(), event: currentEvent,
  });

  await sendEmbed(KILL_CHANNEL, mkEmbed(0x880000)
    .setTitle(`💀 ${playerRSN} has died!`)
    .setDescription(kci ? `Killed by **${killedByRSN}**` : 'Died in the wilderness.')
  );
  saveState();
}

// ─── Collection log processing ────────────────────────────────────────────────
async function processClog(playerRSN, item) {
  if (!clogEnabled) return;
  if (isDup(`C|${ci(playerRSN)}|${ci(item)}`)) return;
  if (!CLOG_CHANNEL) return;

  const logCountMatch = /\((\d+)\/\d+\)/.exec(item);
  const logCount = logCountMatch ? parseInt(logCountMatch[1], 10) : null;

  collectionLogItems.push({ player: ci(playerRSN), item, logCount, timestamp: Date.now() });

  await sendEmbed(CLOG_CHANNEL, mkEmbed(0x7289DA)
    .setTitle(`📖 Collection Log — ${playerRSN}`)
    .setDescription(`Received **${item}**${logCount !== null ? `\nLog count: **${logCount}**` : ''}`)
  );

  if (clogComp && (!clogComp.endTime || Date.now() <= clogComp.endTime)) {
    const count = collectionLogItems.filter(
      e => e.player === ci(playerRSN) && e.timestamp >= clogComp.startTime
    ).length;
    if ([1, 5, 10, 25, 50].includes(count)) {
      await sendEmbed(CLOG_CHANNEL, mkEmbed(0xFFD700)
        .setTitle(`🏆 ${playerRSN} has ${count} drops in the competition!`)
        .setDescription(`Competition: **${clogComp.name}**`)
      );
    }
  }

  saveState();
}

// ─── Webhook & HTTP server ───────────────────────────────────────────────────
const app    = express();
const upload = multer();
app.use(express.json());

// Health check — keeps Render happy
app.get('/',       (_req, res) => res.send('OK'));
app.get('/health', (_req, res) => res.send('OK'));

// Download state
app.get('/data/download', (_req, res) => res.download(KF('state')));

// Main RuneLite DinkAPI webhook
app.post('/dink', upload.any(), async (req, res) => {
  try {
    let payload;
    if (req.body?.payload_json) {
      payload = typeof req.body.payload_json === 'string'
        ? JSON.parse(req.body.payload_json)
        : req.body.payload_json;
    } else {
      payload = req.body;
    }

    const playerName = payload?.playerName ?? payload?.player_name ?? payload?.username ?? '';
    const message    = payload?.embeds?.[0]?.description ?? payload?.content ?? payload?.message ?? '';
    const rawClan    = payload?.clanName ?? payload?.clan_name ?? payload?.source ?? payload?.clanTag ?? payload?.clan ?? '';

    if (ci(rawClan) !== CLAN_FILTER) return res.status(200).send('ignored');

    if (playerName) registered.add(ci(playerName));

    const clogMatch  = CLOG_RE.exec(message);
    if (clogMatch) {
      await processClog(clogMatch[1].trim(), clogMatch[2].trim());
      return res.status(200).send('ok');
    }

    const lootMatch  = LOOT_RE.exec(message);
    if (lootMatch) {
      const gp = parseInt(lootMatch[3].replace(/,/g, ''), 10);
      if (!isNaN(gp)) {
        await processLoot(lootMatch[1].trim(), lootMatch[2].trim(), gp);
        return res.status(200).send('ok');
      }
    }

    // Death — update DEATH_RE above once in-game format is confirmed
    const deathMatch = DEATH_RE.exec(message);
    if (deathMatch) {
      await processDeath(deathMatch[1].trim(), deathMatch[2]?.trim() ?? null);
      return res.status(200).send('ok');
    }

    res.status(200).send('no match');
  } catch (e) {
    console.error('[KILLFEED] /dink:', e.message);
    res.status(500).send('error');
  }
});

// Legacy Rat Pact plugin endpoints
app.post('/logLoot', async (req, res) => {
  const { lootMessage } = req.body ?? {};
  if (!lootMessage) return res.status(400).send('bad request');
  const m = LOOT_RE.exec(lootMessage.trim());
  if (!m) return res.status(400).send('bad format');
  await processLoot(m[1].trim(), m[2].trim(), parseInt(m[3].replace(/,/g, ''), 10));
  res.status(200).send('ok');
});

app.post('/logKill', async (req, res) => {
  const { killer, victim } = req.body ?? {};
  if (!killer || !victim) return res.status(400).send('bad data');
  if (isDup(`K|${ci(killer)}|${ci(victim)}`)) return res.status(200).send('duplicate');
  const kKey = playerKey(ci(killer));
  getEvent(currentEvent).kills[kKey] = (getEvent(currentEvent).kills[kKey] ?? 0) + 1;
  killLog.push({ killer: kKey, killerRSN: ci(killer), victim: playerKey(ci(victim)), victimRSN: ci(victim), gp: 0, timestamp: Date.now(), event: currentEvent, isClan: true });
  saveState();
  res.status(200).send('ok');
});

// Wire up once you know the death message format from in-game
app.post('/logDeath', async (req, res) => {
  const { player, killedBy } = req.body ?? {};
  if (!player) return res.status(400).send('bad data');
  await processDeath(player, killedBy ?? null);
  res.status(200).send('ok');
});

// ─── Leaderboard builders ─────────────────────────────────────────────────────
function buildKillsMap(period) {
  const map = {};
  for (const e of killLog) {
    if (!periodFilter(e, period) || e.event !== currentEvent) continue;
    map[e.killer] = (map[e.killer] ?? 0) + 1;
  }
  return map;
}

function buildLootMap(period) {
  const map = {};
  for (const e of lootLog) {
    if (!periodFilter(e, period) || e.event !== currentEvent) continue;
    map[e.killer] = (map[e.killer] ?? 0) + (e.gp ?? 0);
  }
  return map;
}

function buildDeathMap(period) {
  const map = {};
  for (const e of deathLog) {
    if (!periodFilter(e, period) || e.event !== currentEvent) continue;
    map[e.player] = (map[e.player] ?? 0) + 1;
  }
  // Fill gaps from killLog victims where no deathLog entry exists
  for (const e of killLog) {
    if (!periodFilter(e, period) || e.event !== currentEvent) continue;
    if (!deathLog.some(d => d.player === e.victim && Math.abs(d.timestamp - e.timestamp) < DEDUP_MS))
      map[e.victim] = (map[e.victim] ?? 0) + 1;
  }
  return map;
}

async function topRows(map, limit, guild) {
  return Promise.all(
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(async ([k, v], i) => ({ rank: i + 1, name: await displayName(k, guild), value: v }))
  );
}

// ─── Command handler (exported to bot.js) ────────────────────────────────────
export async function handleKillfeedMessage(msg) {
  if (msg.author.bot || !msg.content.startsWith('!')) return;

  const uid = msg.author.id;
  const now = Date.now();
  if (commandCooldowns.has(uid) && now - commandCooldowns.get(uid) < COMMAND_COOLDOWN) return;
  commandCooldowns.set(uid, now);

  const parts  = msg.content.slice(1).trim().split(/\s+/);
  const cmd    = parts[0].toLowerCase();
  const args   = parts.slice(1);
  const PERIOD = ['daily', 'weekly', 'monthly', 'all'];

  // ── !hiscores ──────────────────────────────────────────────────────
  if (cmd === 'hiscores') {
    const period = PERIOD.includes(args[0]) ? args[0] : 'all';
    const filter = args.find(a => !PERIOD.includes(a))?.toLowerCase();
    const map    = buildKillsMap(period);
    let rows     = await topRows(map, 10, msg.guild);
    if (filter) rows = rows.filter(r => r.name.toLowerCase().includes(filter));
    const lines  = rows.map(r => `\`${String(r.rank).padStart(2)}.\` **${r.name}** — ${r.value} kills`);
    return msg.channel.send({ embeds: [mkEmbed(0x00CC88)
      .setTitle(`🏆 Kill Hiscores (${period})`).setDescription(lines.join('\n') || 'No data.')
    ]});
  }

  // ── !lootboard ─────────────────────────────────────────────────────
  if (cmd === 'lootboard') {
    const period = PERIOD.includes(args[0]) ? args[0] : 'all';
    const filter = args.find(a => !PERIOD.includes(a))?.toLowerCase();
    const map    = buildLootMap(period);
    let rows     = await topRows(map, 10, msg.guild);
    if (filter) rows = rows.filter(r => r.name.toLowerCase().includes(filter));
    const lines  = rows.map(r => `\`${String(r.rank).padStart(2)}.\` **${r.name}** — ${fmtGP(r.value)} GP`);
    return msg.channel.send({ embeds: [mkEmbed(0xFFD700)
      .setTitle(`💰 Loot Leaderboard (${period})`).setDescription(lines.join('\n') || 'No data.')
    ]});
  }

  // ── !deathboard ────────────────────────────────────────────────────
  if (cmd === 'deathboard') {
    const period = PERIOD.includes(args[0]) ? args[0] : 'all';
    const rows   = await topRows(buildDeathMap(period), 10, msg.guild);
    const lines  = rows.map(r => `\`${String(r.rank).padStart(2)}.\` **${r.name}** — ${r.value} deaths`);
    return msg.channel.send({ embeds: [mkEmbed(0x880000)
      .setTitle(`💀 Death Board (${period}) — Hall of Shame`).setDescription(lines.join('\n') || 'No deaths recorded.')
    ]});
  }

  // ── !streaks ───────────────────────────────────────────────────────
  if (cmd === 'streaks') {
    const active  = Object.entries(killStreaks).filter(([, v]) => v.current > 0).sort((a, b) => b[1].current - a[1].current).slice(0, 10);
    const allTime = Object.entries(killStreaks).sort((a, b) => b[1].best - a[1].best).slice(0, 5);
    const al = await Promise.all(active.map(async ([k, v], i) => `\`${String(i+1).padStart(2)}.\` **${await displayName(k, msg.guild)}** — 🔥 ${v.current} active`));
    const at = await Promise.all(allTime.map(async ([k, v], i) => `\`${String(i+1).padStart(2)}.\` **${await displayName(k, msg.guild)}** — ${v.best}`));
    return msg.channel.send({ embeds: [mkEmbed(0xFF6600)
      .setTitle('🔥 Kill Streaks')
      .addFields(
        { name: 'Active',    value: al.join('\n') || 'None', inline: false },
        { name: 'All-Time',  value: at.join('\n') || 'None', inline: false },
      )
    ]});
  }

  // ── !session ───────────────────────────────────────────────────────
  if (cmd === 'session') {
    const sk = killLog.filter(e => e.timestamp >= sessionStart && e.event === currentEvent);
    const sl = lootLog.filter(e => e.timestamp >= sessionStart && e.event === currentEvent);
    const sd = deathLog.filter(e => e.timestamp >= sessionStart && e.event === currentEvent);
    const gp = sl.reduce((s, e) => s + (e.gp ?? 0), 0);
    const up = Date.now() - sessionStart;
    return msg.channel.send({ embeds: [mkEmbed(0x00AAFF)
      .setTitle('📊 Session Stats')
      .addFields(
        { name: 'Uptime',         value: `${Math.floor(up / 3_600_000)}h ${Math.floor((up % 3_600_000) / 60_000)}m`, inline: true },
        { name: 'Kills',          value: String(sk.length),  inline: true },
        { name: 'Deaths',         value: String(sd.length),  inline: true },
        { name: 'GP Looted',      value: fmtGP(gp),          inline: true },
        { name: 'Active Killers', value: String(new Set(sk.map(e => e.killer)).size), inline: true },
      )
    ]});
  }

  // ── !totalgp ───────────────────────────────────────────────────────
  if (cmd === 'totalgp' || cmd === 'totalloot') {
    const total = Object.values(getEvent(currentEvent).gpTotal).reduce((s, v) => s + v, 0);
    return msg.channel.send({ embeds: [mkEmbed(0xFFD700)
      .setTitle('💰 Total Loot')
      .setDescription(`**${fmtGP(total)} GP** looted in event \`${currentEvent}\``)
    ]});
  }

  // ── !addgp / !removegp ─────────────────────────────────────────────
  if (cmd === 'addgp' || cmd === 'removegp') {
    const [name, amtStr] = args;
    if (!name || !amtStr) return msg.channel.send('Usage: `!addgp <player> <amount>`');
    const amt = parseGP(amtStr) * (cmd === 'removegp' ? -1 : 1);
    const key = playerKey(ci(name));
    const ev  = getEvent(currentEvent);
    ev.gpTotal[key]    = (ev.gpTotal[key]    ?? 0) + amt;
    ev.lootTotals[key] = (ev.lootTotals[key] ?? 0) + amt;
    lootLog.push({ killer: key, killerRSN: ci(name), gp: amt, timestamp: Date.now(), event: currentEvent, isClan: true, manual: true });
    saveState();
    return msg.channel.send(`✅ ${cmd === 'addgp' ? 'Added' : 'Removed'} **${fmtGP(Math.abs(amt))} GP** ${cmd === 'addgp' ? 'to' : 'from'} **${name}**.`);
  }

  // ── !reset ─────────────────────────────────────────────────────────
  if (cmd === 'reset' && args[0]) {
    const key = playerKey(ci(args[0]));
    const ev  = getEvent(currentEvent);
    delete ev.deathCounts[key]; delete ev.lootTotals[key];
    delete ev.gpTotal[key];     delete ev.kills[key];
    killLog  = killLog.filter(e => e.killer !== key && e.victim !== key);
    lootLog  = lootLog.filter(e => e.killer !== key);
    deathLog = deathLog.filter(e => e.player !== key);
    delete killStreaks[key];
    saveState();
    return msg.channel.send(`✅ Reset stats for **${args[0]}**.`);
  }

  if (cmd === 'resetall') {
    events = { default: { deathCounts: {}, lootTotals: {}, gpTotal: {}, kills: {} } };
    killLog = []; lootLog = []; deathLog = [];
    killStreaks = {}; currentEvent = 'default';
    saveState();
    return msg.channel.send('🗑️ All kill feed data has been reset.');
  }

  // ── Clan management ────────────────────────────────────────────────
  if (cmd === 'register') {
    const names = args.join(' ').split(',').map(s => s.trim()).filter(Boolean);
    names.forEach(n => registered.add(ci(n)));
    saveState();
    return msg.channel.send(`✅ Registered: **${names.join(', ')}**`);
  }

  if (cmd === 'unregister') {
    const names = args.join(' ').split(',').map(s => s.trim()).filter(Boolean);
    names.forEach(n => registered.delete(ci(n)));
    saveState();
    return msg.channel.send(`✅ Unregistered: **${names.join(', ')}**`);
  }

  if (cmd === 'listclan') {
    const list = [...registered].sort();
    return msg.channel.send({ embeds: [mkEmbed(0x00CC88)
      .setTitle(`👥 Clan Members (${list.length})`)
      .setDescription(list.join(', ') || 'No members registered.')
    ]});
  }

  if (cmd === 'clanonly') {
    clanOnlyMode = args[0]?.toLowerCase() !== 'off';
    saveState();
    return msg.channel.send(`✅ Clan-only mode: **${clanOnlyMode ? 'ON' : 'OFF'}**`);
  }

  if (cmd === 'clogs') {
    if (args[0]?.toLowerCase() === 'on' || args[0]?.toLowerCase() === 'off') {
      clogEnabled = args[0].toLowerCase() !== 'off';
      saveState();
      return msg.channel.send(`✅ Collection log posts: **${clogEnabled ? 'ON' : 'OFF'}**`);
    }
    return msg.channel.send(`Collection log posts are currently **${clogEnabled ? 'ON' : 'OFF'}**. Use \`!clogs on\` or \`!clogs off\`.`);
  }

  // ── Account linking ────────────────────────────────────────────────
  if (cmd === 'addacc') {
    const mention = msg.mentions.users.first();
    const target  = mention?.id ?? msg.author.id;
    const nameStr = args.filter(a => !a.startsWith('<@')).join(' ');
    const names   = nameStr.split(',').map(s => s.trim()).filter(Boolean);
    accounts[target] = [...new Set([...(accounts[target] ?? []), ...names])];
    rebuildRsnMap();
    saveState();
    return msg.channel.send(`✅ Linked **${names.join(', ')}** → <@${target}>.`);
  }

  if (cmd === 'removeacc') {
    const mention = msg.mentions.users.first();
    const target  = mention?.id ?? msg.author.id;
    const nameStr = args.filter(a => !a.startsWith('<@')).join(' ');
    const names   = nameStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    accounts[target] = (accounts[target] ?? []).filter(r => !names.includes(r.toLowerCase()));
    rebuildRsnMap();
    saveState();
    return msg.channel.send(`✅ Unlinked **${names.join(', ')}** from <@${target}>.`);
  }

  if (cmd === 'listacc') {
    const mention = msg.mentions.users.first();
    const target  = mention?.id ?? msg.author.id;
    const rsns    = accounts[target] ?? [];
    return msg.channel.send(rsns.length ? `Accounts for <@${target}>: **${rsns.join(', ')}**` : `No accounts linked to <@${target}>.`);
  }

  // Manual RSN override — bypasses accounts map
  if (cmd === 'linkrsn') {
    const mention = msg.mentions.users.first();
    const rsn     = args.filter(a => !a.startsWith('<@')).join(' ').trim();
    if (!rsn || !mention) return msg.channel.send('Usage: `!linkrsn <rsn> @user`');
    rsnMap[ci(rsn)] = mention.id;
    accounts[mention.id] = [...new Set([...(accounts[mention.id] ?? []), rsn])];
    saveState();
    return msg.channel.send(`✅ Linked **${rsn}** → <@${mention.id}>.`);
  }

  if (cmd === 'unlinkrsn') {
    const rsn = args.join(' ').trim();
    if (!rsn) return msg.channel.send('Usage: `!unlinkrsn <rsn>`');
    const rsnLower = ci(rsn);
    const uid = rsnMap[rsnLower];
    delete rsnMap[rsnLower];
    if (uid && accounts[uid]) accounts[uid] = accounts[uid].filter(r => ci(r) !== rsnLower);
    saveState();
    return msg.channel.send(`✅ Unlinked RSN **${rsn}**.`);
  }

  if (cmd === 'whohas') {
    const rsn = args.join(' ').trim();
    if (!rsn) return msg.channel.send('Usage: `!whohas <rsn>`');
    const uid = rsnMap[ci(rsn)];
    return msg.channel.send(uid ? `**${rsn}** is linked to <@${uid}>.` : `**${rsn}** is not linked to any Discord account.`);
  }

  // ── Raglist ────────────────────────────────────────────────────────
  if (cmd === 'raglist') {
    const sub = args[0]?.toLowerCase();
    if (sub === 'add') {
      const name = args.slice(1).join(' ').trim();
      raglist.add(ci(name));
      saveState();
      return msg.channel.send(`🎯 Added **${name}** to the raglist.`);
    }
    if (sub === 'remove') {
      const name = args.slice(1).join(' ').trim();
      raglist.delete(ci(name));
      saveState();
      return msg.channel.send(`✅ Removed **${name}** from the raglist.`);
    }
    const list = [...raglist].sort();
    return msg.channel.send({ embeds: [mkEmbed(0xFF0000)
      .setTitle('🎯 Raglist — Wanted Players')
      .setDescription(list.join('\n') || 'No players on the raglist.')
    ]});
  }

  // ── Bounty system ──────────────────────────────────────────────────
  if (cmd === 'bounty') {
    const sub     = args[0]?.toLowerCase();
    const target  = args[1];
    const amtStr  = args[2];
    const mention = msg.mentions.users.first();
    const poster  = mention ? `<@${mention.id}>` : msg.author.username;
    const bKey    = ci(target ?? '');
    const amt     = parseGP(amtStr ?? '');

    if (sub === 'list') {
      const active = Object.entries(bounties).filter(([, b]) => b.once.total > 0 || b.persistent.total > 0);
      if (!active.length) return msg.channel.send('No active bounties.');
      const lines = active.map(([n, b]) => {
        const parts = [];
        if (b.once.total > 0)       parts.push(`One-shot: **${fmtGP(b.once.total)} GP**`);
        if (b.persistent.total > 0) parts.push(`Persistent: **${fmtGP(b.persistent.total)} GP/kill**`);
        return `• **${n}** — ${parts.join(' | ')}`;
      });
      return msg.channel.send({ embeds: [mkEmbed(0xFFAA00)
        .setTitle('💰 Active Bounties').setDescription(lines.join('\n'))
      ]});
    }

    if (!bounties[bKey]) bounties[bKey] = { once: { total: 0, posters: {} }, persistent: { total: 0, posters: {} } };

    if (sub === 'add')     { bounties[bKey].once.total += amt; bounties[bKey].once.posters[poster] = (bounties[bKey].once.posters[poster] ?? 0) + amt; saveState(); return msg.channel.send(`✅ One-shot bounty of **${fmtGP(amt)} GP** placed on **${target}** by ${poster}.`); }
    if (sub === 'addp')    { bounties[bKey].persistent.total += amt; bounties[bKey].persistent.posters[poster] = (bounties[bKey].persistent.posters[poster] ?? 0) + amt; saveState(); return msg.channel.send(`✅ Persistent bounty of **${fmtGP(amt)} GP/kill** placed on **${target}** by ${poster}.`); }
    if (sub === 'remove')  { bounties[bKey].once.total = Math.max(0, bounties[bKey].once.total - amt); saveState(); return msg.channel.send(`✅ Removed **${fmtGP(amt)} GP** from one-shot bounty on **${target}**.`); }
    if (sub === 'removep') { bounties[bKey].persistent.total = Math.max(0, bounties[bKey].persistent.total - amt); saveState(); return msg.channel.send(`✅ Removed **${fmtGP(amt)} GP/kill** from persistent bounty on **${target}**.`); }
    return msg.channel.send('Usage: `!bounty list|add|addp|remove|removep <name> <amount>`');
  }

  // ── Events ─────────────────────────────────────────────────────────
  if (cmd === 'createevent') {
    const name = args.join(' ').trim();
    if (!name) return msg.channel.send('Usage: `!createevent <name>`');
    events[name] = { deathCounts: {}, lootTotals: {}, gpTotal: {}, kills: {} };
    currentEvent = name;
    saveState();
    return msg.channel.send(`✅ Created event **${name}** and set as current.`);
  }

  if (cmd === 'listevents') {
    return msg.channel.send(Object.keys(events).map(n => `${n === currentEvent ? '→ ' : '  '}**${n}**`).join('\n') || 'No events.');
  }

  if (cmd === 'finishevent') {
    if (currentEvent === 'default') return msg.channel.send('Cannot finish the default event.');
    const stamp = new Date().toISOString().replace(/:/g, '_');
    const fpath = path.join(DATA_DIR, 'events', `event_${currentEvent}_${stamp}.json`);
    fs.writeFileSync(fpath, JSON.stringify({ event: currentEvent, data: events[currentEvent] }, null, 2));
    delete events[currentEvent];
    currentEvent = 'default';
    saveState();
    return msg.channel.send('✅ Event archived. Switched back to `default`.');
  }

  // ── Collection log ─────────────────────────────────────────────────
  if (cmd === 'collectionlog' || cmd === 'clog' || cmd === 'clogs') {
    const n    = parseInt(args[0], 10) || 10;
    const last = collectionLogItems.slice(-n).reverse();
    if (!last.length) return msg.channel.send('No collection log items recorded.');
    return msg.channel.send({ embeds: [mkEmbed(0x7289DA)
      .setTitle(`📖 Collection Log (last ${last.length})`)
      .setDescription(last.map(e => `• **${e.player}** — ${e.item}`).join('\n'))
    ]});
  }

  if (cmd === 'clboard' || cmd === 'collectionboard') {
    const counts  = {};
    for (const e of collectionLogItems) counts[e.player] = (counts[e.player] ?? 0) + 1;
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return msg.channel.send({ embeds: [mkEmbed(0x7289DA)
      .setTitle('📊 Collection Log Leaderboard')
      .setDescription(entries.map(([k, v], i) => `\`${String(i+1).padStart(2)}.\` **${k}** — ${v} items`).join('\n') || 'No data.')
    ]});
  }

  if (cmd === 'startclogcomp') {
    const name   = args[0];
    const durStr = args[1];
    if (!name) return msg.channel.send('Usage: `!startclogcomp <name> [7d|2w|24h]`');
    let endTime = null;
    if (durStr) {
      const m = /^(\d+)([dwh])$/i.exec(durStr);
      if (m) {
        const mult = { h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2].toLowerCase()];
        endTime = Date.now() + parseInt(m[1], 10) * mult;
      }
    }
    clogComp = { name, startTime: Date.now(), endTime };
    saveState();
    return msg.channel.send(`✅ Collection log competition **${name}** started!${endTime ? ` Ends <t:${Math.floor(endTime/1000)}:R>.` : ''}`);
  }

  if (cmd === 'clogcomp') {
    if (!clogComp) return msg.channel.send('No active collection log competition.');
    const items   = collectionLogItems.filter(e => e.timestamp >= clogComp.startTime && (!clogComp.endTime || e.timestamp <= clogComp.endTime));
    const counts  = {};
    for (const e of items) counts[e.player] = (counts[e.player] ?? 0) + 1;
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return msg.channel.send({ embeds: [mkEmbed(0x7289DA)
      .setTitle(`🏆 ${clogComp.name} — Live Standings`)
      .setDescription(entries.map(([k, v], i) => `\`${String(i+1).padStart(2)}.\` **${k}** — ${v} items`).join('\n') || 'No drops yet.')
    ]});
  }

  if (cmd === 'endclogcomp') {
    if (!clogComp) return msg.channel.send('No active competition.');
    const name = clogComp.name;
    clogComp = null;
    saveState();
    return msg.channel.send(`✅ Competition **${name}** ended.`);
  }

  // ── Export ─────────────────────────────────────────────────────────
  if (cmd === 'export') {
    const type   = args[0]?.toLowerCase() ?? 'hiscores';
    const period = args[1] ?? 'all';
    let csv = '';
    if (type === 'hiscores')   csv = 'Player,Kills\n'  + Object.entries(buildKillsMap(period)).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k},${v}`).join('\n');
    else if (type === 'lootboard') csv = 'Player,GP\n' + Object.entries(buildLootMap(period)).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k},${v}`).join('\n');
    else if (type === 'deathboard') csv = 'Player,Deaths\n' + Object.entries(buildDeathMap(period)).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k},${v}`).join('\n');
    else return msg.channel.send('Usage: `!export hiscores|lootboard|deathboard [daily|weekly|monthly|all]`');
    ensureDirs();
    const fname = path.join(DATA_DIR, `export_${type}_${period}_${Date.now()}.csv`);
    fs.writeFileSync(fname, csv);
    return msg.channel.send({ files: [{ attachment: fname, name: `${type}_${period}.csv` }] });
  }

  // ── !kfhelp ────────────────────────────────────────────────────────
  if (cmd === 'kfhelp') {
    return msg.channel.send({ embeds: [mkEmbed(0x00CC88)
      .setTitle('📋 Kill Feed — Commands')
      .addFields(
        { name: '📊 Stats', value: '`!hiscores [daily|weekly|monthly|all] [name]`\n`!lootboard [period] [name]`\n`!deathboard [period]`\n`!streaks`\n`!totalgp`\n`!session`' },
        { name: '🎯 Bounty & Raglist', value: '`!raglist` / `!raglist add|remove <name>`\n`!bounty list|add|addp|remove|removep <name> <amount>`' },
        { name: '📖 Collection Log', value: '`!clogs on|off` — toggle clog posts\n`!clog [n]` / `!clboard`\n`!startclogcomp <name> [7d|2w|24h]`\n`!clogcomp` / `!endclogcomp`' },
        { name: '👥 Clan & Identity', value: '`!register <name,name>` / `!unregister` / `!listclan`\n`!clanonly on|off`\n`!addacc [@user] <rsn,rsn>` / `!removeacc` / `!listacc`\n`!linkrsn <rsn> @user` / `!unlinkrsn <rsn>` / `!whohas <rsn>`' },
        { name: '⚙️ Admin', value: '`!createevent <name>` / `!listevents` / `!finishevent`\n`!addgp <player> <amount>` / `!removegp`\n`!reset <player>` / `!resetall`\n`!export hiscores|lootboard|deathboard [period]`' },
      )
    ]});
  }
}

// ─── Module init (called from bot.js) ────────────────────────────────────────
export function initKillfeed(client) {
  discordClient = client;
  loadState();
  app.listen(PORT, () => console.log(`[KILLFEED] HTTP server on port ${PORT}`));
  setInterval(saveState, BACKUP_INTERVAL);
  console.log(`[KILLFEED] Ready. Clan filter: "${CLAN_FILTER}", Min loot: ${MIN_LOOT_GP > 0 ? fmtGP(MIN_LOOT_GP) : 'none'}`);
}
