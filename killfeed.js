// killfeed.js
// Kill Feed module for The Crater bot — slash commands, Crater-branded.

import express              from 'express';
import multer               from 'multer';
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { execFile }         from 'child_process';
import fs                   from 'fs';
import path                 from 'path';
import { fileURLToPath }    from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Environment ─────────────────────────────────────────────────────────────
const KILL_CHANNEL  = process.env.KILL_FEED_CHANNEL_ID;
const CLAN_FILTER   = (process.env.CLAN_FILTER ?? 'the crater').toLowerCase();
const MIN_LOOT_GP   = parseInt(process.env.MIN_LOOT_GP ?? '0', 10);
const PORT          = Number(process.env.PORT) || 10000;
const EMBED_ICON    = process.env.EMBED_ICON   ?? 'https://i.ibb.co/8nXbWYmq/The-Craterlogo.webp';

const LIVE_REFRESH_MS = Number(process.env.LIVE_REFRESH_MS) || 5 * 60 * 1000;

const GITHUB_PAT    = process.env.GITHUB_PAT;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH   ?? 'main';
const GIT_NAME      = process.env.GIT_COMMIT_NAME  ?? 'CraterBot';
const GIT_EMAIL     = process.env.GIT_COMMIT_EMAIL ?? 'bot@crater.gg';
const GITHUB_ACTOR  = process.env.GITHUB_ACTOR;

// ─── Paths ───────────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const KF       = s => path.join(DATA_DIR, `killfeed_${s}.json`);

// ─── Constants ───────────────────────────────────────────────────────────────
const DEDUP_MS        = 10_000;
const BACKUP_INTERVAL = 5 * 60 * 1000;

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
// Death RE — update once in-game format is confirmed
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

function utcDay() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

// ─── State ───────────────────────────────────────────────────────────────────
let killLog      = [];
let lootLog      = [];
let deathLog     = [];
let accounts     = {};   // discordId → [rsn, ...]
let rsnMap       = {};   // rsn_lower → discordId
let killStreaks   = {};   // playerKey → { current, best }
let firstBloodDay = '';
let liveBoards   = {};   // type → { channelId, messageId, period }

const seen         = new Map();
const sessionStart = Date.now();
let discordClient  = null;

// ─── RSN ↔ Discord ───────────────────────────────────────────────────────────
function rebuildRsnMap() {
  const overrides = { ...rsnMap };
  rsnMap = overrides;
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
      const m    = await guild.members.fetch(key);
      const rsns = accounts[key] ?? [];
      return rsns.length ? `${m.displayName} (${rsns.join(', ')})` : m.displayName;
    } catch { return `<@${key}>`; }
  }
  return key;
}

// ─── Persistence ─────────────────────────────────────────────────────────────
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadState() {
  ensureDirs();
  try {
    const s   = JSON.parse(fs.readFileSync(KF('state'), 'utf8'));
    killLog       = s.killLog       ?? [];
    lootLog       = s.lootLog       ?? [];
    deathLog      = s.deathLog      ?? [];
    killStreaks    = s.killStreaks   ?? {};
    firstBloodDay = s.firstBloodDay ?? '';
    liveBoards    = s.liveBoards    ?? {};
  } catch {}

  try { accounts = JSON.parse(fs.readFileSync(KF('accounts'), 'utf8')); } catch { accounts = {}; }
  try { rsnMap   = JSON.parse(fs.readFileSync(KF('rsnmap'),   'utf8')); } catch { rsnMap   = {}; }

  rebuildRsnMap();
}

function saveState() {
  ensureDirs();
  fs.writeFileSync(KF('state'),    JSON.stringify({ killLog, lootLog, deathLog, killStreaks, firstBloodDay, liveBoards }, null, 2));
  fs.writeFileSync(KF('accounts'), JSON.stringify(accounts, null, 2));
  fs.writeFileSync(KF('rsnmap'),   JSON.stringify(rsnMap,   null, 2));
  queueGitBackup();
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

// ─── Embed factory ───────────────────────────────────────────────────────────
function mkEmbed(color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTimestamp()
    .setThumbnail(EMBED_ICON)
    .setFooter({ text: 'The Crater' });
}

// ─── Dedup ───────────────────────────────────────────────────────────────────
function isDup(key) {
  const now = Date.now();
  if (seen.has(key) && now - seen.get(key) < DEDUP_MS) return true;
  seen.set(key, now);
  return false;
}
setInterval(() => { const cut = Date.now() - DEDUP_MS * 2; for (const [k, ts] of seen) if (ts < cut) seen.delete(k); }, 60_000);

// ─── Streak helpers ──────────────────────────────────────────────────────────
function addKill(key) {
  if (!killStreaks[key]) killStreaks[key] = { current: 0, best: 0 };
  killStreaks[key].current++;
  if (killStreaks[key].current > killStreaks[key].best) killStreaks[key].best = killStreaks[key].current;
  return killStreaks[key].current;
}
function resetStreak(key) { if (killStreaks[key]) killStreaks[key].current = 0; }

// ─── Send embed ──────────────────────────────────────────────────────────────
async function sendEmbed(channelId, embed) {
  if (!channelId || !discordClient) return;
  try { const ch = await discordClient.channels.fetch(channelId); await ch.send({ embeds: [embed] }); }
  catch (e) { console.error('[KILLFEED] sendEmbed:', e.message); }
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

  const streak = addKill(kKey);
  resetStreak(vKey);

  const now = Date.now();
  killLog.push({ killer: kKey, killerRSN: kci, victim: vKey, victimRSN: vci, gp, timestamp: now });
  lootLog.push({ killer: kKey, killerRSN: kci, victim: vKey, victimRSN: vci, gp, timestamp: now });

  const killerLabel = /^\d{17,19}$/.test(kKey) ? `<@${kKey}>` : killerRSN;
  const victimLabel  = /^\d{17,19}$/.test(vKey) ? `<@${vKey}>` : victimRSN;

  // First Blood of the day
  const today = utcDay();
  if (firstBloodDay !== today) {
    firstBloodDay = today;
    await sendEmbed(KILL_CHANNEL, mkEmbed(0xFF0000)
      .setTitle(`🩸 First Blood — ${killerRSN} draws first blood!`)
      .setDescription(`${killerLabel} opens the day by slaying ${victimLabel}\nLooted **${fmtGP(gp)} GP**`)
    );
  }

  const embed = mkEmbed(gpColor(gp))
    .setTitle(`☠️  ${killerRSN} slayed ${victimRSN}`)
    .setDescription(`${killerLabel} looted **${fmtGP(gp)} GP** from ${victimLabel}\n*(${gp.toLocaleString()} coins)*`);

  if (streak >= 3) embed.addFields({ name: '🔥 Kill Streak', value: `${streak} in a row!`, inline: true });

  await sendEmbed(KILL_CHANNEL, embed);

  if (STREAK_MILESTONES.has(streak)) {
    await sendEmbed(KILL_CHANNEL, mkEmbed(0xFF6600)
      .setTitle(`🔥 ${killerRSN} is on a ${streak}-KILL STREAK!`)
      .setDescription(`${killerLabel} has killed ${streak} players without dying!`)
    );
  }

  const killerTotal = lootLog.filter(e => e.killer === kKey).reduce((s, e) => s + (e.gp ?? 0), 0);
  for (const m of LOOT_MILESTONES) {
    if (killerTotal - gp < m && killerTotal >= m) {
      await sendEmbed(KILL_CHANNEL, mkEmbed(0xFFD700)
        .setTitle(`💰 ${killerRSN} hit ${fmtGP(m)} total loot!`)
        .setDescription(`${killerLabel} has now looted **${fmtGP(killerTotal)} GP** in total!`)
      );
    }
  }

  saveState();
}

// ─── Death processing ─────────────────────────────────────────────────────────
async function processDeath(playerRSN, killedByRSN) {
  const pci = ci(playerRSN);
  const kci = killedByRSN ? ci(killedByRSN) : null;
  if (isDup(`D|${pci}|${kci ?? ''}|${Math.floor(Date.now() / DEDUP_MS)}`)) return;
  if (!KILL_CHANNEL) return;

  resetStreak(playerKey(pci));
  deathLog.push({ player: playerKey(pci), playerRSN: pci, killedBy: kci ? playerKey(kci) : null, killedByRSN: kci, timestamp: Date.now() });

  await sendEmbed(KILL_CHANNEL, mkEmbed(0x880000)
    .setTitle(`💀 ${playerRSN} has died!`)
    .setDescription(kci ? `Killed by **${killedByRSN}**` : 'Died in the wilderness.')
  );
  saveState();
}

// ─── Express + Webhook ───────────────────────────────────────────────────────
const app    = express();
const upload = multer();
app.use(express.json());

app.get('/',               (_req, res) => res.send('OK'));
app.get('/health',         (_req, res) => res.send('OK'));
app.get('/data/download',  (_req, res) => res.download(KF('state')));

app.post('/dink', upload.any(), async (req, res) => {
  try {
    let payload = req.body?.payload_json
      ? (typeof req.body.payload_json === 'string' ? JSON.parse(req.body.payload_json) : req.body.payload_json)
      : req.body;

    const message  = payload?.embeds?.[0]?.description ?? payload?.content ?? payload?.message ?? '';
    const rawClan  = payload?.clanName ?? payload?.clan_name ?? payload?.source ?? payload?.clanTag ?? payload?.clan ?? '';

    if (ci(rawClan) !== CLAN_FILTER) return res.status(200).send('ignored');

    const lootMatch = LOOT_RE.exec(message);
    if (lootMatch) {
      const gp = parseInt(lootMatch[3].replace(/,/g, ''), 10);
      if (!isNaN(gp)) { await processLoot(lootMatch[1].trim(), lootMatch[2].trim(), gp); return res.status(200).send('ok'); }
    }

    const deathMatch = DEATH_RE.exec(message);
    if (deathMatch) { await processDeath(deathMatch[1].trim(), deathMatch[2]?.trim() ?? null); return res.status(200).send('ok'); }

    res.status(200).send('no match');
  } catch (e) { console.error('[KILLFEED] /dink:', e.message); res.status(500).send('error'); }
});

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
  killLog.push({ killer: kKey, killerRSN: ci(killer), victim: playerKey(ci(victim)), victimRSN: ci(victim), gp: 0, timestamp: Date.now() });
  saveState();
  res.status(200).send('ok');
});

app.post('/logDeath', async (req, res) => {
  const { player, killedBy } = req.body ?? {};
  if (!player) return res.status(400).send('bad data');
  await processDeath(player, killedBy ?? null);
  res.status(200).send('ok');
});

// ─── Leaderboard builders ────────────────────────────────────────────────────
function buildKillsMap(period) {
  const map = {};
  for (const e of killLog) { if (!periodFilter(e, period)) continue; map[e.killer] = (map[e.killer] ?? 0) + 1; }
  return map;
}

function buildLootMap(period) {
  const map = {};
  for (const e of lootLog) { if (!periodFilter(e, period)) continue; map[e.killer] = (map[e.killer] ?? 0) + (e.gp ?? 0); }
  return map;
}

function buildDeathMap(period) {
  const map = {};
  for (const e of deathLog) { if (!periodFilter(e, period)) continue; map[e.player] = (map[e.player] ?? 0) + 1; }
  for (const e of killLog) {
    if (!periodFilter(e, period)) continue;
    if (!deathLog.some(d => d.player === e.victim && Math.abs(d.timestamp - e.timestamp) < DEDUP_MS))
      map[e.victim] = (map[e.victim] ?? 0) + 1;
  }
  return map;
}

async function topRows(map, limit, guild) {
  return Promise.all(
    Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit)
      .map(async ([k, v], i) => ({ rank: i + 1, name: await displayName(k, guild), value: v, key: k }))
  );
}

// ─── Live board helpers ───────────────────────────────────────────────────────
async function buildBoardEmbed(type, period, guild) {
  if (type === 'kills') {
    const allKills = buildKillsMap('all');
    const rows = await topRows(buildKillsMap(period), 10, guild);
    const lines = rows.map(r => {
      const rank = getRank(allKills[r.key] ?? 0);
      return `\`${String(r.rank).padStart(2)}.\` **${r.name}** — ${r.value} kills  *${rank}*`;
    });
    return mkEmbed(0x00CC88).setTitle(`☠️ The Crater — Kill Hiscores (${period})`).setDescription(lines.join('\n') || 'No data.');
  }
  if (type === 'loot') {
    const rows = await topRows(buildLootMap(period), 10, guild);
    const lines = rows.map(r => `\`${String(r.rank).padStart(2)}.\` **${r.name}** — ${fmtGP(r.value)} GP`);
    return mkEmbed(0xFFD700).setTitle(`💰 The Crater — Loot Leaderboard (${period})`).setDescription(lines.join('\n') || 'No data.');
  }
  if (type === 'graves') {
    const rows = await topRows(buildDeathMap(period), 10, guild);
    const lines = rows.map(r => `\`${String(r.rank).padStart(2)}.\` **${r.name}** — ${r.value} deaths`);
    return mkEmbed(0x880000).setTitle(`🪦 The Crater — Who Keeps Dying? (${period})`).setDescription(lines.join('\n') || 'No deaths recorded.');
  }
}

async function refreshLiveBoard(type) {
  const board = liveBoards[type];
  if (!board || !discordClient) return;
  try {
    const ch    = await discordClient.channels.fetch(board.channelId);
    const msg   = await ch.messages.fetch(board.messageId);
    const embed = await buildBoardEmbed(type, board.period, ch.guild);
    await msg.edit({ embeds: [embed] });
  } catch (e) {
    console.error(`[KILLFEED] Live board "${type}" refresh failed — removing:`, e.message);
    delete liveBoards[type];
    saveState();
  }
}

// ─── Slash command definitions ───────────────────────────────────────────────
export const killfeedCommands = [

  new SlashCommandBuilder().setName('kfkills').setDescription('Kill leaderboard with Crater rank titles')
    .addStringOption(o => o.setName('period').setDescription('Time period').addChoices(...PERIOD_CHOICES))
    .addStringOption(o => o.setName('player').setDescription('Filter by player name')),

  new SlashCommandBuilder().setName('kfloot').setDescription('GP looted leaderboard')
    .addStringOption(o => o.setName('period').setDescription('Time period').addChoices(...PERIOD_CHOICES))
    .addStringOption(o => o.setName('player').setDescription('Filter by player name')),

  new SlashCommandBuilder().setName('kfgraves').setDescription('Death leaderboard — who keeps feeding?')
    .addStringOption(o => o.setName('period').setDescription('Time period').addChoices(...PERIOD_CHOICES)),

  new SlashCommandBuilder().setName('kfstreaks').setDescription('Kill streaks — active and all-time records'),

  new SlashCommandBuilder().setName('kftotalgp').setDescription('Total GP looted by The Crater'),

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
      .addStringOption(o => o.setName('type').setDescription('Board type').setRequired(true)
        .addChoices({ name: 'Kill Hiscores', value: 'kills' }, { name: 'Loot Board', value: 'loot' }, { name: 'Death Board', value: 'graves' }))
      .addStringOption(o => o.setName('period').setDescription('Time period').addChoices(...PERIOD_CHOICES)))
    .addSubcommand(s => s.setName('clear').setDescription('Remove a live leaderboard')
      .addStringOption(o => o.setName('type').setDescription('Board type').setRequired(true)
        .addChoices({ name: 'Kill Hiscores', value: 'kills' }, { name: 'Loot Board', value: 'loot' }, { name: 'Death Board', value: 'graves' })))
    .addSubcommand(s => s.setName('list').setDescription('Show all active live leaderboards')),

  new SlashCommandBuilder().setName('kfhelp').setDescription('All kill feed commands for The Crater'),

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

];

// ─── Interaction handler ──────────────────────────────────────────────────────
export async function handleKillfeedInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  const cmd = interaction.commandName;
  const kf  = [
    'kfkills','kfloot','kfgraves','kfstreaks','kftotalgp','kfsession','kfrivalry',
    'kfrsn','kflive','kfadmin','kfhelp',
  ];
  if (!kf.includes(cmd)) return false;

  // ── /kfkills ───────────────────────────────────────────────────────
  if (cmd === 'kfkills') {
    await interaction.deferReply();
    const period   = interaction.options.getString('period') ?? 'all';
    const filter   = interaction.options.getString('player')?.toLowerCase();
    const allKills = buildKillsMap('all');
    let rows = await topRows(buildKillsMap(period), 10, interaction.guild);
    if (filter) rows = rows.filter(r => r.name.toLowerCase().includes(filter));
    const lines = rows.map(r => {
      const rank = getRank(allKills[r.key] ?? 0);
      return `\`${String(r.rank).padStart(2)}.\` **${r.name}** — ${r.value} kills  *${rank}*`;
    });
    return interaction.editReply({ embeds: [mkEmbed(0x00CC88).setTitle(`☠️ The Crater — Kill Hiscores (${period})`).setDescription(lines.join('\n') || 'No data.')] });
  }

  // ── /kfloot ────────────────────────────────────────────────────────
  if (cmd === 'kfloot') {
    await interaction.deferReply();
    const period = interaction.options.getString('period') ?? 'all';
    const filter = interaction.options.getString('player')?.toLowerCase();
    let rows = await topRows(buildLootMap(period), 10, interaction.guild);
    if (filter) rows = rows.filter(r => r.name.toLowerCase().includes(filter));
    const lines = rows.map(r => `\`${String(r.rank).padStart(2)}.\` **${r.name}** — ${fmtGP(r.value)} GP`);
    return interaction.editReply({ embeds: [mkEmbed(0xFFD700).setTitle(`💰 The Crater — Loot Leaderboard (${period})`).setDescription(lines.join('\n') || 'No data.')] });
  }

  // ── /kfgraves ──────────────────────────────────────────────────────
  if (cmd === 'kfgraves') {
    await interaction.deferReply();
    const period = interaction.options.getString('period') ?? 'all';
    const rows   = await topRows(buildDeathMap(period), 10, interaction.guild);
    const lines  = rows.map(r => `\`${String(r.rank).padStart(2)}.\` **${r.name}** — ${r.value} deaths`);
    return interaction.editReply({ embeds: [mkEmbed(0x880000).setTitle(`🪦 The Crater — Who Keeps Dying? (${period})`).setDescription(lines.join('\n') || 'No deaths recorded.')] });
  }

  // ── /kfstreaks ─────────────────────────────────────────────────────
  if (cmd === 'kfstreaks') {
    await interaction.deferReply();
    const active  = Object.entries(killStreaks).filter(([, v]) => v.current > 0).sort((a, b) => b[1].current - a[1].current).slice(0, 10);
    const allTime = Object.entries(killStreaks).sort((a, b) => b[1].best - a[1].best).slice(0, 5);
    const al = await Promise.all(active.map(async ([k, v], i) =>  `\`${String(i+1).padStart(2)}.\` **${await displayName(k, interaction.guild)}** — 🔥 ${v.current}`));
    const at = await Promise.all(allTime.map(async ([k, v], i) => `\`${String(i+1).padStart(2)}.\` **${await displayName(k, interaction.guild)}** — ${v.best}`));
    return interaction.editReply({ embeds: [mkEmbed(0xFF6600).setTitle('🔥 Kill Streaks')
      .addFields({ name: 'Currently Active', value: al.join('\n') || 'None', inline: false }, { name: 'All-Time Records', value: at.join('\n') || 'None', inline: false })] });
  }

  // ── /kftotalgp ─────────────────────────────────────────────────────
  if (cmd === 'kftotalgp') {
    const total = lootLog.reduce((s, e) => s + (e.gp ?? 0), 0);
    return interaction.reply({ embeds: [mkEmbed(0xFFD700).setTitle('💰 Total Loot — The Crater').setDescription(`**${fmtGP(total)} GP** looted in total by the clan`)] });
  }

  // ── /kfsession ─────────────────────────────────────────────────────
  if (cmd === 'kfsession') {
    const sk = killLog.filter(e => e.timestamp >= sessionStart);
    const sl = lootLog.filter(e => e.timestamp >= sessionStart);
    const sd = deathLog.filter(e => e.timestamp >= sessionStart);
    const gp = sl.reduce((s, e) => s + (e.gp ?? 0), 0);
    const up = Date.now() - sessionStart;
    return interaction.reply({ embeds: [mkEmbed(0x00AAFF).setTitle('📊 Session Stats')
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
    const p1key = p1mention ? p1mention[1] : playerKey(ci(p1raw));
    const p2key = p2mention ? p2mention[1] : playerKey(ci(p2raw));

    const p1name = await displayName(p1key, interaction.guild);
    const p2name = await displayName(p2key, interaction.guild);

    const p1kills = killLog.filter(e => e.killer === p1key && e.victim === p2key).length;
    const p2kills = killLog.filter(e => e.killer === p2key && e.victim === p1key).length;
    const p1loot  = lootLog.filter(e => e.killer === p1key && e.victim === p2key).reduce((s, e) => s + (e.gp ?? 0), 0);
    const p2loot  = lootLog.filter(e => e.killer === p2key && e.victim === p1key).reduce((s, e) => s + (e.gp ?? 0), 0);

    let winnerLine = '';
    if (p1kills > p2kills)      winnerLine = `\n🏆 **${p1name}** leads the rivalry`;
    else if (p2kills > p1kills) winnerLine = `\n🏆 **${p2name}** leads the rivalry`;
    else if (p1kills > 0)       winnerLine = `\n🤝 Dead even`;

    return interaction.editReply({ embeds: [
      mkEmbed(0xAA00FF)
        .setTitle(`⚔️ Rivalry: ${p1name} vs ${p2name}`)
        .addFields(
          { name: p1name, value: `${p1kills} kills\n${fmtGP(p1loot)} GP looted`, inline: true },
          { name: '⚔️',  value: '\u200b', inline: true },
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
      const rsns   = accounts[target] ?? [];
      return interaction.reply({ content: rsns.length ? `Accounts for <@${target}>: **${rsns.join(', ')}**` : `No accounts linked to <@${target}>.`, ephemeral: true });
    }
    if (sub === 'whohas') {
      const rsn = interaction.options.getString('rsn', true).trim();
      const uid = rsnMap[ci(rsn)];
      return interaction.reply({ content: uid ? `**${rsn}** is linked to <@${uid}>.` : `**${rsn}** is not linked to any Discord account.`, ephemeral: true });
    }
    if (sub === 'link') {
      const rsn  = interaction.options.getString('rsn', true).trim();
      const user = interaction.options.getUser('user', true);
      rsnMap[ci(rsn)] = user.id;
      accounts[user.id] = [...new Set([...(accounts[user.id] ?? []), rsn])];
      saveState();
      return interaction.reply({ content: `✅ Linked **${rsn}** → <@${user.id}>.`, ephemeral: true });
    }
    if (sub === 'unlink') {
      const rsn    = interaction.options.getString('rsn', true).trim();
      const rsnLow = ci(rsn);
      const uid    = rsnMap[rsnLow];
      delete rsnMap[rsnLow];
      if (uid && accounts[uid]) accounts[uid] = accounts[uid].filter(r => ci(r) !== rsnLow);
      saveState();
      return interaction.reply({ content: `✅ Unlinked RSN **${rsn}**.`, ephemeral: true });
    }
    const target = (interaction.options.getUser('user') ?? interaction.user).id;
    const rsns   = interaction.options.getString('rsns', true).split(',').map(s => s.trim()).filter(Boolean);
    if (sub === 'add') {
      accounts[target] = [...new Set([...(accounts[target] ?? []), ...rsns])];
      rebuildRsnMap(); saveState();
      return interaction.reply({ content: `✅ Linked **${rsns.join(', ')}** → <@${target}>.`, ephemeral: true });
    }
    if (sub === 'remove') {
      const lower = rsns.map(r => r.toLowerCase());
      accounts[target] = (accounts[target] ?? []).filter(r => !lower.includes(r.toLowerCase()));
      rebuildRsnMap(); saveState();
      return interaction.reply({ content: `✅ Unlinked **${rsns.join(', ')}** from <@${target}>.`, ephemeral: true });
    }
  }

  // ── /kflive ────────────────────────────────────────────────────────
  if (cmd === 'kflive') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      await interaction.deferReply({ ephemeral: true });
      const type   = interaction.options.getString('type', true);
      const period = interaction.options.getString('period') ?? 'all';
      const embed  = await buildBoardEmbed(type, period, interaction.guild);
      const msg    = await interaction.channel.send({ embeds: [embed] });
      liveBoards[type] = { channelId: interaction.channelId, messageId: msg.id, period };
      saveState();
      return interaction.editReply({ content: `✅ Live **${type}** board posted. Refreshes every ${Math.round(LIVE_REFRESH_MS / 60_000)} minutes.` });
    }

    if (sub === 'clear') {
      const type = interaction.options.getString('type', true);
      if (!liveBoards[type]) return interaction.reply({ content: `No live **${type}** board is active.`, ephemeral: true });
      delete liveBoards[type];
      saveState();
      return interaction.reply({ content: `✅ Live **${type}** board removed.`, ephemeral: true });
    }

    if (sub === 'list') {
      const active = Object.entries(liveBoards);
      if (!active.length) return interaction.reply({ content: 'No live boards active.', ephemeral: true });
      const lines = active.map(([type, b]) => `• **${type}** — <#${b.channelId}> (${b.period})`);
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }
  }

  // ── /kfadmin ───────────────────────────────────────────────────────
  if (cmd === 'kfadmin') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'addgp' || sub === 'removegp') {
      const name = interaction.options.getString('player', true).trim();
      const amt  = parseGP(interaction.options.getString('amount', true)) * (sub === 'removegp' ? -1 : 1);
      const key  = playerKey(ci(name));
      lootLog.push({ killer: key, killerRSN: ci(name), gp: amt, timestamp: Date.now(), manual: true });
      saveState();
      return interaction.reply({ content: `✅ ${sub === 'addgp' ? 'Added' : 'Removed'} **${fmtGP(Math.abs(amt))} GP** ${sub === 'addgp' ? 'to' : 'from'} **${name}**.`, ephemeral: true });
    }

    if (sub === 'reset') {
      const name = interaction.options.getString('player', true).trim();
      const key  = playerKey(ci(name));
      killLog  = killLog.filter(e => e.killer !== key && e.victim !== key);
      lootLog  = lootLog.filter(e => e.killer !== key);
      deathLog = deathLog.filter(e => e.player !== key);
      delete killStreaks[key];
      saveState();
      return interaction.reply({ content: `✅ Reset stats for **${name}**.`, ephemeral: true });
    }

    if (sub === 'resetall') {
      if (interaction.options.getString('confirm', true) !== 'CONFIRM')
        return interaction.reply({ content: '❌ You must type `CONFIRM` exactly to reset all data.', ephemeral: true });
      killLog = []; lootLog = []; deathLog = []; killStreaks = {}; firstBloodDay = '';
      saveState();
      return interaction.reply({ content: '🗑️ All kill feed data has been reset.', ephemeral: true });
    }

    if (sub === 'export') {
      const type   = interaction.options.getString('type', true);
      const period = interaction.options.getString('period') ?? 'all';
      let csv = '';
      if (type === 'hiscores')   csv = 'Player,Kills\n'  + Object.entries(buildKillsMap(period)).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k},${v}`).join('\n');
      if (type === 'lootboard')  csv = 'Player,GP\n'     + Object.entries(buildLootMap(period)).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k},${v}`).join('\n');
      if (type === 'deathboard') csv = 'Player,Deaths\n' + Object.entries(buildDeathMap(period)).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k},${v}`).join('\n');
      ensureDirs();
      const fname = path.join(DATA_DIR, `export_${type}_${period}_${Date.now()}.csv`);
      fs.writeFileSync(fname, csv);
      return interaction.reply({ files: [{ attachment: fname, name: `${type}_${period}.csv` }], ephemeral: true });
    }
  }

  // ── /kfhelp ────────────────────────────────────────────────────────
  if (cmd === 'kfhelp') {
    return interaction.reply({ embeds: [
      mkEmbed(0x00AAFF)
        .setTitle('☠️ The Crater — Kill Feed Commands')
        .addFields(
          { name: '📊 Stats',
            value: [
              '`/kfkills [period] [player]` — Kill leaderboard with rank titles',
              '`/kfloot [period] [player]` — GP looted leaderboard',
              '`/kfgraves [period]` — Death leaderboard',
              '`/kfstreaks` — Active & all-time kill streaks',
              '`/kftotalgp` — Total GP looted by the clan',
              '`/kfsession` — Stats since last bot restart',
              '`/kfrivalry <player1> <player2>` — Head-to-head record',
            ].join('\n'), inline: false },
          { name: '📺 Live Boards',
            value: [
              '`/kflive set <type> [period]` — Post a live board that auto-refreshes',
              '`/kflive clear <type>` — Remove a live board',
              '`/kflive list` — Show all active live boards',
            ].join('\n'), inline: false },
          { name: '🔗 RSN Linking',
            value: [
              '`/kfrsn add <rsns> [user]` — Link RSNs to a Discord account',
              '`/kfrsn remove <rsns> [user]` — Unlink RSNs',
              '`/kfrsn list [user]` — View linked RSNs',
              '`/kfrsn link <rsn> <user>` — Manual RSN override',
              '`/kfrsn unlink <rsn>` — Remove a manual override',
              '`/kfrsn whohas <rsn>` — Find who owns an RSN',
            ].join('\n'), inline: false },
          { name: '🔧 Admin',
            value: [
              '`/kfadmin addgp/removegp <player> <amount>` — Adjust GP manually',
              '`/kfadmin reset <player>` — Reset one player\'s stats',
              '`/kfadmin resetall` — ⚠️ Wipe all kill feed data',
              '`/kfadmin export <type> [period]` — Export data as CSV',
            ].join('\n'), inline: false },
        )
    ], ephemeral: true });
  }

  return false;
}

// ─── Module init ─────────────────────────────────────────────────────────────
export function initKillfeed(client) {
  discordClient = client;
  loadState();
  app.listen(PORT, () => console.log(`[KILLFEED] HTTP server on port ${PORT}`));
  setInterval(saveState, BACKUP_INTERVAL);
  setInterval(async () => { for (const type of Object.keys(liveBoards)) await refreshLiveBoard(type); }, LIVE_REFRESH_MS);
  console.log(`[KILLFEED] Ready. Clan filter: "${CLAN_FILTER}", Min loot: ${MIN_LOOT_GP > 0 ? fmtGP(MIN_LOOT_GP) : 'none'}, Live refresh: ${LIVE_REFRESH_MS / 1000}s`);
}
