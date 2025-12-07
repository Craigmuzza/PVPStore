// geDetector.js
// ─────────────────────────────────────────────────────────────────────────────
// GE Dump Detector v3.0 for The Crater
//  - Tiered alerts: 💎 DEAL, 👀 OPPORTUNITY, 💀 PANIC DUMP
//  - Smart sell targets, realistic profit estimates, spread analysis
//  - Freshness weighting, dump vs correction detection
//  - REST API for RuneLite plugin integration
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js';

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// Paths / data directory
// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATA_DIR           = process.env.DATA_DIR || path.join(__dirname, 'data');
const SERVER_CONFIG_FILE = path.join(DATA_DIR, 'server_config.json');
const WATCHLIST_FILE     = path.join(DATA_DIR, 'watchlist.json');
const HISTORY_FILE       = path.join(DATA_DIR, 'price_history.json');

// ─────────────────────────────────────────────────────────────────────────────
// Branding + config
// ─────────────────────────────────────────────────────────────────────────────

const CRATER_ICON  = 'https://i.ibb.co/PZVD0ccr/The-Crater-Logo.gif';
const CRATER_COLOR = 0x1a1a2e;

const CONFIG = {
  version: '3.0-smart-targets',

  brand: { name: 'The Crater', icon: CRATER_ICON, color: CRATER_COLOR },

  api: {
    baseUrl: 'https://prices.runescape.wiki/api/v1/osrs',
    userAgent: 'TheCrater-DumpDetector/3.0 (Discord Bot)',
  },

  scanInterval: 15_000,

  // Shared detection thresholds
  detection: {
    volumeSpikeMultiplier: 1.5,
    minVolumeFor5m: 5,
    minVolume1h: 20,
    minSellPressure: 0.55,
    minPriceDrop: 5,
    tiers: { notable: -5, significant: -10, major: -15, extreme: -25 },
    maxDataAge: 900,
    minPrice: 50,
    tightSpreadPct: 2,
    wideSpreadPct: 10,
  },

  // 💎 DEAL tier
  dealTier: {
    minMaxProfit: 150_000,
    minRealisticProfit: 50_000,
    minProfitPerItem: 75,
    minRoi: 5,
    minTradeValue5m: 500_000,
    requireBuyersBelowTarget: true,
    minVolume1h: 40,
    minLiquidityRatio: 0.4,
    highValueBypass: 200_000,
    maxSpreadForConfidence: 3,
  },

  // 👀 OPPORTUNITY tier
  opportunityTier: {
    minMaxProfit: 25_000,
    minRealisticProfit: 10_000,
    minProfitPerItem: 20,
    minRoi: 3,
    minTradeValue5m: 100_000,
    requireBuyersBelowTarget: false,
    maxBuyerOvershoot: 0.02,
    minVolume1h: 25,
    minLiquidityRatio: 0.25,
    highValueBypass: 100_000,
  },

  // 💀 PANIC DUMP
  panicDumps: {
    enabled: true,
    panicThresholds: [
      { maxValue: 5_000, ratio: 0.15 },
      { maxValue: 25_000, ratio: 0.25 },
      { maxValue: Infinity, ratio: 0.33 },
    ],
    minTypicalPrice: 2_000,
    minMaxProfit: 75_000,
    minRealisticProfit: 25_000,
    minVolume1h: 5,
    maxAge: 600,
  },

  // Cooldowns
  cooldowns: {
    deal: 300_000,
    opportunity: 600_000,
    panicDump: 900_000,
    pruneInterval: 300_000,
    maxCooldownAge: 3600_000,
  },

  // Smart pricing
  pricing: {
    sellTargetSafetyMargin: 0.95,
    realisticVolumeCapture: 0.3,
    correctionThreshold: 0.10,
  },

  // Freshness
  freshness: {
    hotThreshold: 30,
    warmThreshold: 120,
  },

  // Limits
  limits: {
    maxDealsPerScan: 5,
    maxOpportunitiesPerScan: 10,
    maxPanicDumpsPerScan: 3,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// In-memory state
// ─────────────────────────────────────────────────────────────────────────────

let itemMapping    = new Map();
let itemNameLookup = new Map();

let latestPrices    = new Map();
let previousPrices  = new Map();
let lastLatestFetch = 0;

let data5m  = new Map();
let data1h  = new Map();
let data24h = new Map();
let last5mTimestamp  = 0;
let last1hTimestamp  = 0;
let last24hTimestamp = 0;
let lastAvgFetch     = 0;

let priceHistory = new Map();
const HISTORY_RETENTION_HOURS = 48;

let serverConfigs = {};
let watchlist     = new Set();

const dealCooldowns        = new Map();
const opportunityCooldowns = new Map();
const panicCooldowns       = new Map();

let alertLoopStarted    = false;
let healthServerStarted = false;
let scanInProgress      = false;
let scanIteration       = 0;
let lastCooldownPrune   = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Filesystem helpers
// ─────────────────────────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadServerConfigs() {
  ensureDataDir();
  if (!fs.existsSync(SERVER_CONFIG_FILE)) { serverConfigs = {}; return; }
  try {
    serverConfigs = JSON.parse(fs.readFileSync(SERVER_CONFIG_FILE, 'utf8'));
  } catch (err) {
    console.error('[GE] Failed to load server_config.json:', err);
    serverConfigs = {};
  }
}

function saveServerConfigs() {
  ensureDataDir();
  try {
    fs.writeFileSync(SERVER_CONFIG_FILE, JSON.stringify(serverConfigs, null, 2), 'utf8');
  } catch (err) {
    console.error('[GE] Failed to save server_config.json:', err);
  }
}

function loadWatchlist() {
  ensureDataDir();
  if (!fs.existsSync(WATCHLIST_FILE)) { watchlist = new Set(); return; }
  try {
    const arr = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
    watchlist = Array.isArray(arr) 
      ? new Set(arr.map(x => Number(x)).filter(x => Number.isInteger(x)))
      : new Set();
  } catch (err) {
    console.error('[GE] Failed to load watchlist.json:', err);
    watchlist = new Set();
  }
}

function saveWatchlist() {
  ensureDataDir();
  try {
    fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(Array.from(watchlist), null, 2), 'utf8');
  } catch (err) {
    console.error('[GE] Failed to save watchlist.json:', err);
  }
}

function loadPriceHistory() {
  ensureDataDir();
  if (!fs.existsSync(HISTORY_FILE)) { priceHistory = new Map(); return; }
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    priceHistory = new Map(Object.entries(data).map(([k, v]) => [Number(k), v]));
    console.log(`[GE] Loaded price history for ${priceHistory.size} items`);
  } catch (err) {
    console.error('[GE] Failed to load price_history.json:', err);
    priceHistory = new Map();
  }
}

function savePriceHistory() {
  ensureDataDir();
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(Object.fromEntries(priceHistory)), 'utf8');
  } catch (err) {
    console.error('[GE] Failed to save price_history.json:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cooldown management
// ─────────────────────────────────────────────────────────────────────────────

function pruneCooldowns() {
  const now = Date.now();
  const maxAge = CONFIG.cooldowns.maxCooldownAge;
  let pruned = 0;
  for (const map of [dealCooldowns, opportunityCooldowns, panicCooldowns]) {
    for (const [id, ts] of map) {
      if (now - ts > maxAge) { map.delete(id); pruned++; }
    }
  }
  if (pruned > 0) console.log(`[GE] Pruned ${pruned} stale cooldowns`);
}

function maybePruneCooldowns() {
  const now = Date.now();
  if (now - lastCooldownPrune >= CONFIG.cooldowns.pruneInterval) {
    pruneCooldowns();
    lastCooldownPrune = now;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtGp(v) { return v == null ? '—' : Math.round(v).toLocaleString(); }
function fmtPct(v, showPlus = true) {
  if (v == null) return '—';
  return `${showPlus && v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}
function fmtSpike(v) { return v == null ? '—' : `${v.toFixed(1)}×`; }
function fmtDuration(s) {
  if (s == null) return '—';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchApi(endpoint) {
  const url = `${CONFIG.api.baseUrl}${endpoint}`;
  const start = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': CONFIG.api.userAgent } });
  const elapsed = Date.now() - start;

  if (res.status === 429) {
    console.error(`[GE] RATE LIMITED on ${endpoint}!`);
    throw new Error(`Rate limited on ${endpoint}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${endpoint}`);
  if (elapsed > 1000) console.warn(`[GE] Slow: ${endpoint} took ${elapsed}ms`);

  return res.json();
}

async function loadItemMapping() {
  if (itemMapping.size > 0) return;
  console.log('[GE] Loading item mapping…');
  const data = await fetchApi('/mapping');
  itemMapping.clear();
  itemNameLookup.clear();
  for (const item of data) {
    if (!item || typeof item.id !== 'number') continue;
    itemMapping.set(item.id, item);
    if (item.name) itemNameLookup.set(item.name.toLowerCase(), item.id);
  }
  console.log(`[GE] Loaded ${itemMapping.size} items.`);
}

async function fetchPrices() {
  console.log('[GE] Fetching latest prices…');
  const data = await fetchApi('/latest');
  const now = Date.now();
  previousPrices = new Map(latestPrices);
  let changed = 0, freshest = Infinity;
  latestPrices.clear();

  for (const [idStr, v] of Object.entries(data.data || {})) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;
    const lowTime = v.lowTime ? v.lowTime * 1000 : null;
    if (lowTime) {
      const age = (now - lowTime) / 1000;
      if (age < freshest) freshest = age;
    }
    const prev = previousPrices.get(id);
    if (prev && (prev.low !== v.low || prev.high !== v.high)) changed++;
    latestPrices.set(id, {
      high: v.high || null,
      highTime: v.highTime ? v.highTime * 1000 : null,
      low: v.low || null,
      lowTime,
      fetchTime: now,
    });
  }
  lastLatestFetch = now;
  console.log(`[GE] Latest: ${latestPrices.size} items, ${changed} changed, freshest: ${freshest === Infinity ? 'N/A' : Math.round(freshest) + 's'}`);
}

async function refreshLatestIfNeeded(force = false) {
  const now = Date.now();
  if (!force && latestPrices.size > 0 && (now - lastLatestFetch) < 55_000) return;
  await fetchPrices();
}

async function fetchAverages(force = false) {
  const now = Date.now();
  if (!force && (now - lastAvgFetch) / 1000 < 55 && data5m.size > 0) return;

  console.log('[GE] Fetching averages…');
  const [d5m, d1h, d24h] = await Promise.all([
    fetchApi('/5m'), fetchApi('/1h'), fetchApi('/24h'),
  ]);

  data5m.clear(); data1h.clear(); data24h.clear();

  for (const [idStr, v] of Object.entries(d5m.data || {})) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;
    const ts = d5m.timestamp ? d5m.timestamp * 1000 : now;
    data5m.set(id, {
      avgHigh: v.avgHighPrice || null,
      avgLow: v.avgLowPrice || null,
      volume: (v.highPriceVolume || 0) + (v.lowPriceVolume || 0),
      buyVolume: v.highPriceVolume || 0,
      sellVolume: v.lowPriceVolume || 0,
      ts,
    });
    last5mTimestamp = ts;
  }

  for (const [idStr, v] of Object.entries(d1h.data || {})) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;
    const ts = d1h.timestamp ? d1h.timestamp * 1000 : now;
    data1h.set(id, {
      avgHigh: v.avgHighPrice || null,
      avgLow: v.avgLowPrice || null,
      volume: (v.highPriceVolume || 0) + (v.lowPriceVolume || 0),
      buyVolume: v.highPriceVolume || 0,
      sellVolume: v.lowPriceVolume || 0,
      ts,
    });
    last1hTimestamp = ts;
  }

  for (const [idStr, v] of Object.entries(d24h.data || {})) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;
    const ts = d24h.timestamp ? d24h.timestamp * 1000 : now;
    const avgHigh = v.avgHighPrice || null;
    data24h.set(id, {
      avgHigh,
      avgLow: v.avgLowPrice || null,
      volume: (v.highPriceVolume || 0) + (v.lowPriceVolume || 0),
      buyVolume: v.highPriceVolume || 0,
      sellVolume: v.lowPriceVolume || 0,
      ts,
    });
    last24hTimestamp = ts;
    if (avgHigh && avgHigh > 0) updatePriceHistory(id, ts, avgHigh);
  }

  lastAvgFetch = now;
  console.log('[GE] Averages refreshed.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Price history (correction detection)
// ─────────────────────────────────────────────────────────────────────────────

function updatePriceHistory(id, timestamp, avgHigh24h) {
  let h = priceHistory.get(id);
  if (!h) { h = { timestamps: [], prices: [] }; priceHistory.set(id, h); }
  const last = h.timestamps[h.timestamps.length - 1] || 0;
  if (timestamp - last < 3600_000) return;
  h.timestamps.push(timestamp);
  h.prices.push(avgHigh24h);
  const cutoff = Date.now() - HISTORY_RETENTION_HOURS * 3600_000;
  while (h.timestamps.length > 0 && h.timestamps[0] < cutoff) {
    h.timestamps.shift(); h.prices.shift();
  }
}

function getPreviousDayAvg(id) {
  const h = priceHistory.get(id);
  if (!h || h.prices.length < 2) return null;
  const target = Date.now() - 24 * 3600_000;
  for (let i = h.timestamps.length - 1; i >= 0; i--) {
    if (h.timestamps[i] <= target) return h.prices[i];
  }
  return h.prices[0];
}

let lastHistorySave = 0;
function maybeSavePriceHistory() {
  if (Date.now() - lastHistorySave >= 300_000) {
    savePriceHistory();
    lastHistorySave = Date.now();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Item lookup
// ─────────────────────────────────────────────────────────────────────────────

function findItem(query) {
  if (!query) return null;
  const t = query.trim();
  if (/^\d+$/.test(t)) {
    const id = Number(t);
    if (itemMapping.has(id)) return { id, item: itemMapping.get(id) };
  }
  const lower = t.toLowerCase();
  if (itemNameLookup.has(lower)) {
    const id = itemNameLookup.get(lower);
    return { id, item: itemMapping.get(id) };
  }
  for (const [name, id] of itemNameLookup.entries()) {
    if (name.startsWith(lower)) return { id, item: itemMapping.get(id) };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Calculations
// ─────────────────────────────────────────────────────────────────────────────

function calculateTax(price) {
  if (!price || price < 50) return 0;
  return Math.min(Math.floor(price * 0.02), 5_000_000);
}

function calculateSmartSellTarget(avg5m, avg1h, avg24h) {
  const candidates = [];
  if (avg5m && avg5m > 0) candidates.push(avg5m);
  if (avg1h && avg1h > 0) candidates.push(avg1h * CONFIG.pricing.sellTargetSafetyMargin);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function calculateRealisticProfit(perItem, vol5m, geLimit) {
  const qty = Math.min(geLimit || Infinity, Math.floor(vol5m * CONFIG.pricing.realisticVolumeCapture));
  return perItem > 0 ? perItem * qty : 0;
}

function analyseSpread(instaBuy, instaSell) {
  if (!instaBuy || !instaSell || instaSell <= 0) return { spreadPct: null, spreadType: 'unknown' };
  const pct = ((instaBuy - instaSell) / instaSell) * 100;
  let type = 'normal';
  if (pct < CONFIG.detection.tightSpreadPct) type = 'tight';
  else if (pct > CONFIG.detection.wideSpreadPct) type = 'wide';
  return { spreadPct: pct, spreadType: type };
}

function assessFreshness(tradeTimeMs) {
  if (!tradeTimeMs) return { freshnessLabel: 'UNKNOWN', freshnessScore: 0 };
  const age = (Date.now() - tradeTimeMs) / 1000;
  if (age < CONFIG.freshness.hotThreshold) return { freshnessLabel: 'HOT', freshnessScore: 1.0, ageSec: age };
  if (age < CONFIG.freshness.warmThreshold) return { freshnessLabel: 'WARM', freshnessScore: 0.6, ageSec: age };
  return { freshnessLabel: 'STALE', freshnessScore: 0.3, ageSec: age };
}

function detectCorrection(id, avgHigh24h) {
  const prev = getPreviousDayAvg(id);
  if (!prev || !avgHigh24h) return { isCorrection: false, correctionPct: null };
  const pct = ((avgHigh24h - prev) / prev) * 100;
  return { isCorrection: pct <= -(CONFIG.pricing.correctionThreshold * 100), correctionPct: pct };
}

function classifyDropSeverity(dropPct) {
  if (dropPct <= CONFIG.detection.tiers.extreme) return 'EXTREME';
  if (dropPct <= CONFIG.detection.tiers.major) return 'MAJOR';
  if (dropPct <= CONFIG.detection.tiers.significant) return 'SIGNIFICANT';
  if (dropPct <= CONFIG.detection.tiers.notable) return 'NOTABLE';
  return null;
}

function scoreAlert(a) {
  const drop = Math.abs(a.dropPct || 0) * 2;
  const spike = Math.min((a.volumeSpike || 0) * 3, 30);
  const sell = (a.sellPressure || 0) * 15;
  const profit = Math.min((a.realisticProfit || 0) / 30_000, 25);
  const roi = Math.min((a.roiPct || 0), 15);
  const fresh = (a.freshnessScore || 0) * 10;
  const corrPenalty = a.isCorrection ? 15 : 0;
  const spreadPenalty = a.spreadType === 'tight' ? 10 : 0;
  return drop + spike + sell + profit + roi + fresh - corrPenalty - spreadPenalty;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embed builders
// ─────────────────────────────────────────────────────────────────────────────

function buildDumpEmbed(a) {
  let color, tierEmoji, tierLabel;
  if (a.alertTier === 'DEAL') { color = 0xffd700; tierEmoji = '💎'; tierLabel = 'DEAL'; }
  else { color = 0x3498db; tierEmoji = '👀'; tierLabel = 'OPPORTUNITY'; }

  const sevEmoji = { EXTREME: '💥', MAJOR: '🔥', SIGNIFICANT: '📉', NOTABLE: '📊' };
  const freshEmoji = { HOT: '🟢', WARM: '🟡', STALE: '🔴', UNKNOWN: '⚪' };
  const spreadEmoji = { tight: '⚠️', normal: '✅', wide: '🐌', unknown: '❓' };

  const imgUrl = `https://secure.runescape.com/m=itemdb_oldschool/obj_big.gif?id=${a.id}`;
  const wikiUrl = `https://oldschool.runescape.wiki/w/${encodeURIComponent(a.name.replace(/ /g, '_'))}`;
  const pricesUrl = `https://prices.runescape.wiki/osrs/item/${a.id}`;

  const drop5m = a.avgHigh5m && a.instaSell ? ((a.instaSell - a.avgHigh5m) / a.avgHigh5m * 100) : null;
  const drop1h = a.avgHigh1h && a.instaSell ? ((a.instaSell - a.avgHigh1h) / a.avgHigh1h * 100) : null;
  const drop24h = a.avgHigh24h && a.instaSell ? ((a.instaSell - a.avgHigh24h) / a.avgHigh24h * 100) : null;

  const tradeTs = a.tradeTime ? Math.floor(a.tradeTime / 1000) : null;
  const nowTs = Math.floor(Date.now() / 1000);
  const taxOnSell = calculateTax(a.sellTarget);
  const sellAfterTax = a.sellTarget ? a.sellTarget - taxOnSell : null;

  const corrWarn = a.isCorrection ? `\n⚠️ **Possible correction** (24h avg down ${fmtPct(a.correctionPct)})` : '';

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${tierEmoji} ${tierLabel} ${sevEmoji[a.dropSeverity] || '📊'} ${a.dropSeverity}`, iconURL: CRATER_ICON })
    .setTitle(a.name)
    .setURL(pricesUrl)
    .setThumbnail(imgUrl)
    .setDescription([
      `## Bid: \`${fmtGp(a.suggestedBid)} gp\``,
      ``,
      `**Your Trade**`,
      `Buy: \`${fmtGp(a.suggestedBid)} gp\` → Sell: \`${fmtGp(sellAfterTax)} gp\` (after tax)`,
      ``,
      `**Profit**`,
      `Per item: \`${fmtGp(Math.round(a.perItemProfit))} gp\` (${fmtPct(a.roiPct)})`,
      `Realistic: \`${fmtGp(Math.round(a.realisticProfit))} gp\``,
      `Maximum: \`${fmtGp(Math.round(a.maxProfit))} gp\``,
      corrWarn,
    ].join('\n'))
    .addFields(
      { name: 'Market', value: `Dump: \`${fmtGp(a.instaSell)}\` • Buyers: \`${fmtGp(a.instaBuy)}\` • Target: \`${fmtGp(a.sellTarget)}\``, inline: false },
      { name: 'Signal', value: `Spike: \`${fmtSpike(a.volumeSpike)}\` • Sellers: \`${a.sellPressure != null ? (a.sellPressure * 100).toFixed(0) + '%' : '—'}\``, inline: true },
      { name: 'Availability', value: `${freshEmoji[a.freshnessLabel] || '⚪'} ${a.freshnessLabel} (${fmtDuration(a.ageSec)}) • ${spreadEmoji[a.spreadType] || '❓'} ${a.spreadType}`, inline: true },
    )
    .addFields(
      { name: 'History', value: `5m: \`${fmtGp(a.avgHigh5m)}\` (${fmtPct(drop5m)}) • 1h: \`${fmtGp(a.avgHigh1h)}\` (${fmtPct(drop1h)}) • 24h: \`${fmtGp(a.avgHigh24h)}\` (${fmtPct(drop24h)})`, inline: false },
      { name: 'Volume', value: `5m: \`${fmtGp(a.volume5m)}\` • 1h: \`${fmtGp(a.volume1h)}\` • Limit: \`${fmtGp(a.geLimit)}\``, inline: false },
    )
    .addFields({ name: '\u200b', value: `[Wiki](${wikiUrl}) • [Prices](${pricesUrl}) • Trade: ${tradeTs ? `<t:${tradeTs}:R>` : '—'}`, inline: false })
    .setFooter({ text: 'The Crater', iconURL: CRATER_ICON })
    .setTimestamp();
}

function buildPanicEmbed(a) {
  const imgUrl = `https://secure.runescape.com/m=itemdb_oldschool/obj_big.gif?id=${a.id}`;
  const wikiUrl = `https://oldschool.runescape.wiki/w/${encodeURIComponent(a.name.replace(/ /g, '_'))}`;
  const pricesUrl = `https://prices.runescape.wiki/osrs/item/${a.id}`;

  const buyAt = a.dumpPrice + 1;
  const tax = calculateTax(a.typicalPrice);
  const sellAfter = a.typicalPrice - tax;
  const dumpPct = a.typicalPrice ? ((a.dumpPrice / a.typicalPrice) * 100).toFixed(1) : '?';
  const header = a.dumpPrice <= 10 ? `DUMPED AT ${a.dumpPrice} GP` : `PANIC DUMP (${dumpPct}% of value)`;

  const freshEmoji = { HOT: '🟢', WARM: '🟡', STALE: '🔴', UNKNOWN: '⚪' };
  const tradeTs = a.ts ? Math.floor(a.ts / 1000) : null;

  return new EmbedBuilder()
    .setColor(0x722ed1)
    .setAuthor({ name: '💀 PANIC DUMP', iconURL: CRATER_ICON })
    .setTitle(a.name)
    .setURL(pricesUrl)
    .setThumbnail(imgUrl)
    .setDescription([
      `# ${header}`,
      ``,
      `**Prices:** Dump: \`${fmtGp(a.dumpPrice)}\` • 5m: \`${fmtGp(a.avgHigh5m)}\` • 1h: \`${fmtGp(a.avgHigh1h)}\` • 24h: \`${fmtGp(a.avgHigh24h)}\``,
    ].join('\n'))
    .addFields(
      { name: 'Snipe It', value: `Buy: \`${fmtGp(buyAt)}\` → Sell: \`${fmtGp(sellAfter)}\` (after tax)\nPer item: \`${fmtGp(a.profitPerItem)}\` • Realistic: \`${fmtGp(Math.round(a.realisticProfit))}\` • Max: \`${fmtGp(Math.round(a.maxProfit))}\`\nLimit: \`${fmtGp(a.geLimit)}\``, inline: false },
      { name: 'Activity', value: `Vol 5m: \`${fmtGp(a.volume5m)}\` • 1h: \`${fmtGp(a.volume1h)}\` • Sellers: \`${a.sellPressure != null ? (a.sellPressure * 100).toFixed(0) + '%' : '—'}\``, inline: true },
      { name: 'Fresh', value: `${freshEmoji[a.freshnessLabel] || '⚪'} ${a.freshnessLabel} (${fmtDuration(a.ageSec)})`, inline: true },
    )
    .addFields({ name: '\u200b', value: `[Wiki](${wikiUrl}) • [Prices](${pricesUrl}) • Trade: ${tradeTs ? `<t:${tradeTs}:R>` : '—'}`, inline: false })
    .setFooter({ text: 'The Crater', iconURL: CRATER_ICON })
    .setTimestamp();
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan
// ─────────────────────────────────────────────────────────────────────────────

async function scanForDumps() {
  maybePruneCooldowns();
  await refreshLatestIfNeeded(false);
  await fetchAverages(false);
  maybeSavePriceHistory();

  const now = Date.now();
  const age5m = (now - last5mTimestamp) / 1000;
  if (age5m > 600) {
    await fetchAverages(true);
    if ((Date.now() - last5mTimestamp) / 1000 > 600) return { panicAlerts: [], dumpAlerts: [] };
  }

  const ids = watchlist.size > 0 ? Array.from(watchlist) : Array.from(latestPrices.keys());
  const panicAlerts = [];
  const dumpAlerts = [];

  for (const id of ids) {
    const price = latestPrices.get(id);
    if (!price) continue;

    const map = itemMapping.get(id);
    const name = map?.name || `Item ${id}`;
    const geLimit = map?.limit ?? null;

    const avg5 = data5m.get(id);
    const avg1h_ = data1h.get(id);
    const avg24 = data24h.get(id);

    const instaSell = price.low;
    const instaSellTime = price.lowTime;
    const instaBuy = price.high;

    if (!instaSell || !instaSellTime) continue;
    const ageSec = (now - instaSellTime) / 1000;
    if (ageSec > CONFIG.detection.maxDataAge) continue;

    const avgHigh5m = avg5?.avgHigh ?? null;
    const avgHigh1h = avg1h_?.avgHigh ?? null;
    const avgHigh24h = avg24?.avgHigh ?? null;
    const vol5m = avg5?.volume || 0;
    const vol1h = avg1h_?.volume || 0;

    const { freshnessLabel, freshnessScore, ageSec: freshAge } = assessFreshness(instaSellTime);
    const { spreadPct, spreadType } = analyseSpread(instaBuy, instaSell);
    const { isCorrection, correctionPct } = detectCorrection(id, avgHigh24h);

    // ─── PANIC DUMP ───
    if (CONFIG.panicDumps.enabled) {
      const avgs = [avgHigh5m, avgHigh1h, avgHigh24h].filter(p => p != null && p > 0);
      const typical = avgs.length > 0 ? Math.min(...avgs) : null;

      if (typical && typical >= CONFIG.panicDumps.minTypicalPrice) {
        let thresh = 0.33;
        for (const t of CONFIG.panicDumps.panicThresholds) {
          if (typical <= t.maxValue) { thresh = t.ratio; break; }
        }
        const ratio = instaSell / typical;
        if (instaSell <= 10 || ratio < thresh) {
          const buyAt = instaSell + 1;
          const tax = calculateTax(typical);
          const profit = typical - tax - buyAt;
          const max = profit > 0 && geLimit ? profit * geLimit : 0;
          const realistic = calculateRealisticProfit(profit, vol5m, geLimit || 0);

          if (max >= CONFIG.panicDumps.minMaxProfit && realistic >= CONFIG.panicDumps.minRealisticProfit && vol1h >= CONFIG.panicDumps.minVolume1h && ageSec <= CONFIG.panicDumps.maxAge) {
            const lastP = panicCooldowns.get(id) || 0;
            if (now - lastP >= CONFIG.cooldowns.panicDump) {
              const sellers = avg5 ? (avg5.sellVolume || 0) / (avg5.volume || 1) : 0.5;
              panicAlerts.push({ id, name, typicalPrice: typical, dumpPrice: instaSell, avgHigh5m, avgHigh1h, avgHigh24h, volume5m: vol5m, volume1h: vol1h, sellPressure: sellers, geLimit, maxProfit: max, realisticProfit: realistic, profitPerItem: profit, freshnessLabel, freshnessScore, ageSec: freshAge, ts: instaSellTime });
              panicCooldowns.set(id, now);
            }
          }
        }
      }
    }

    // ─── NORMAL DUMP ───
    if (vol1h < CONFIG.detection.minVolume1h) continue;
    if (vol5m < CONFIG.detection.minVolumeFor5m) continue;

    const spike = vol1h > 0 ? vol5m / (vol1h / 12) : 0;
    if (spike < CONFIG.detection.volumeSpikeMultiplier) continue;

    const sellers = avg5 ? (avg5.sellVolume || 0) / (avg5.volume || 1) : 0.5;
    if (sellers < CONFIG.detection.minSellPressure) continue;

    if (!avgHigh5m || avgHigh5m < CONFIG.detection.minPrice) continue;

    const sellTarget = calculateSmartSellTarget(avgHigh5m, avgHigh1h, avgHigh24h);
    if (!sellTarget) continue;

    const dropPct = ((instaSell - sellTarget) / sellTarget) * 100;
    if (dropPct > -CONFIG.detection.minPriceDrop) continue;

    const buyPrice = (instaBuy || 0) + 1;
    const tax = calculateTax(sellTarget);
    const sellAfter = sellTarget - tax;
    const perItem = sellAfter - buyPrice;
    const roi = buyPrice > 0 ? (perItem / buyPrice) * 100 : 0;
    const max = geLimit ? perItem * geLimit : 0;
    const realistic = calculateRealisticProfit(perItem, vol5m, geLimit || 0);
    const tradeVal = buyPrice * vol5m;
    const buyerGap = instaBuy && sellTarget ? ((instaBuy - sellTarget) / sellTarget) * 100 : null;
    const liqRatio = geLimit ? vol1h / geLimit : 0;

    if (perItem <= 0) continue;

    const dealLiqOk = buyPrice >= CONFIG.dealTier.highValueBypass || (vol1h >= CONFIG.dealTier.minVolume1h && liqRatio >= CONFIG.dealTier.minLiquidityRatio);
    const oppLiqOk = buyPrice >= CONFIG.opportunityTier.highValueBypass || (vol1h >= CONFIG.opportunityTier.minVolume1h && liqRatio >= CONFIG.opportunityTier.minLiquidityRatio);

    let isDeal = max >= CONFIG.dealTier.minMaxProfit && realistic >= CONFIG.dealTier.minRealisticProfit && perItem >= CONFIG.dealTier.minProfitPerItem && roi >= CONFIG.dealTier.minRoi && tradeVal >= CONFIG.dealTier.minTradeValue5m && (!CONFIG.dealTier.requireBuyersBelowTarget || (instaBuy && instaBuy < sellTarget)) && dealLiqOk;
    if (isDeal && spreadPct !== null && spreadPct < CONFIG.dealTier.maxSpreadForConfidence) isDeal = false;

    const isOpp = max >= CONFIG.opportunityTier.minMaxProfit && realistic >= CONFIG.opportunityTier.minRealisticProfit && perItem >= CONFIG.opportunityTier.minProfitPerItem && roi >= CONFIG.opportunityTier.minRoi && tradeVal >= CONFIG.opportunityTier.minTradeValue5m && (!CONFIG.opportunityTier.requireBuyersBelowTarget || !instaBuy || instaBuy < sellTarget || (buyerGap !== null && buyerGap <= CONFIG.opportunityTier.maxBuyerOvershoot * 100)) && oppLiqOk;

    if (!isDeal && !isOpp) continue;

    const tier = isDeal ? 'DEAL' : 'OPPORTUNITY';
    const cdMap = isDeal ? dealCooldowns : opportunityCooldowns;
    const cdTime = isDeal ? CONFIG.cooldowns.deal : CONFIG.cooldowns.opportunity;
    const last = cdMap.get(id) || 0;
    if (now - last < cdTime) continue;

    const sev = classifyDropSeverity(dropPct);
    if (!sev) continue;

    dumpAlerts.push({ id, name, alertTier: tier, dropSeverity: sev, instaSell, instaBuy, suggestedBid: buyPrice, sellTarget, avgHigh5m, avgHigh1h, avgHigh24h, dropPct, volume5m: vol5m, volume1h: vol1h, volumeSpike: spike, sellPressure: sellers, geLimit, perItemProfit: perItem, maxProfit: max, realisticProfit: realistic, roiPct: roi, spreadPct, spreadType, freshnessLabel, freshnessScore, ageSec: freshAge, isCorrection, correctionPct, tradeTime: instaSellTime });
    cdMap.set(id, now);
  }

  scanIteration++;
  return { panicAlerts, dumpAlerts };
}

// ─────────────────────────────────────────────────────────────────────────────
// API Server
// ─────────────────────────────────────────────────────────────────────────────

let recentAlerts = { deals: [], opportunities: [], panicDumps: [], lastUpdate: null };

function updateRecentAlerts(d, o, p) {
  recentAlerts = { deals: d.slice(0, 10), opportunities: o.slice(0, 15), panicDumps: p.slice(0, 5), lastUpdate: Date.now() };
}

function startApiServer() {
  if (healthServerStarted) return;
  healthServerStarted = true;
  const port = Number(process.env.PORT) || 10000;

  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://localhost:${port}`);
    const p = url.pathname;

    if (p === '/' || p === '/health') { res.writeHead(200); res.end('OK'); return; }
    if (p === '/api/alerts') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data: recentAlerts, config: { version: CONFIG.version } })); return; }
    if (p === '/api/deals') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data: recentAlerts.deals })); return; }
    if (p === '/api/opportunities') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data: recentAlerts.opportunities })); return; }
    if (p === '/api/panic') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data: recentAlerts.panicDumps })); return; }
    if (p === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data: { version: CONFIG.version, items: itemMapping.size, uptime: process.uptime(), cooldowns: dealCooldowns.size + opportunityCooldowns.size + panicCooldowns.size } })); return; }

    if (p === '/api/price') {
      const qid = url.searchParams.get('id');
      const qname = url.searchParams.get('name');
      let id = qid ? Number(qid) : qname ? itemNameLookup.get(qname.toLowerCase()) : null;
      if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: 'Not found' })); return; }
      const pr = latestPrices.get(id), a5 = data5m.get(id), a1 = data1h.get(id), a24 = data24h.get(id), m = itemMapping.get(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { id, name: m?.name, limit: m?.limit, high: pr?.high, low: pr?.low, avg5m: a5?.avgHigh, avg1h: a1?.avgHigh, avg24h: a24?.avgHigh, vol5m: a5?.volume, vol1h: a1?.volume } }));
      return;
    }

    res.writeHead(404); res.end('Not found');
  }).listen(port, () => console.log(`[GE] API on port ${port}`));
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert loop
// ─────────────────────────────────────────────────────────────────────────────

function startAlertLoop(client) {
  if (alertLoopStarted) return;
  alertLoopStarted = true;

  setInterval(async () => {
    if (scanInProgress) return;
    scanInProgress = true;

    try {
      const { panicAlerts, dumpAlerts } = await scanForDumps();
      const deals = dumpAlerts.filter(a => a.alertTier === 'DEAL').sort((a, b) => scoreAlert(b) - scoreAlert(a)).slice(0, CONFIG.limits.maxDealsPerScan);
      const opps = dumpAlerts.filter(a => a.alertTier === 'OPPORTUNITY').sort((a, b) => scoreAlert(b) - scoreAlert(a)).slice(0, CONFIG.limits.maxOpportunitiesPerScan);
      const panics = panicAlerts.sort((a, b) => (b.realisticProfit || 0) - (a.realisticProfit || 0)).slice(0, CONFIG.limits.maxPanicDumpsPerScan);

      updateRecentAlerts(deals, opps, panics);
      if (!panicAlerts.length && !dumpAlerts.length) return;

      for (const gid of Object.keys(serverConfigs)) {
        const cfg = serverConfigs[gid];
        if (!cfg?.enabled || !cfg?.channelId) continue;
        const ch = await client.channels.fetch(cfg.channelId).catch(() => null);
        if (!ch?.isTextBased()) continue;

        for (const a of panics) { try { await ch.send({ embeds: [buildPanicEmbed(a)] }); } catch (e) { console.error(`[GE] Send fail: ${a.name}`, e.message); } }
        for (const a of [...deals, ...opps]) { try { await ch.send({ embeds: [buildDumpEmbed(a)] }); } catch (e) { console.error(`[GE] Send fail: ${a.name}`, e.message); } }
      }
    } catch (e) { console.error('[GE] Loop error:', e); }
    finally { scanInProgress = false; }
  }, CONFIG.scanInterval);
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

export const geCommands = [
  new SlashCommandBuilder().setName('alerts').setDescription('Configure GE alerts.')
    .addSubcommand(s => s.setName('setup').setDescription('Enable alerts here.'))
    .addSubcommand(s => s.setName('stop').setDescription('Disable alerts.'))
    .addSubcommand(s => s.setName('status').setDescription('Show status.'))
    .addSubcommand(s => s.setName('config').setDescription('Adjust thresholds.')
      .addNumberOption(o => o.setName('volume_spike').setDescription('Min spike multiplier'))
      .addNumberOption(o => o.setName('sell_pressure').setDescription('Min sell % (0-100)'))
      .addNumberOption(o => o.setName('price_drop').setDescription('Min drop %'))
      .addIntegerOption(o => o.setName('deal_cooldown').setDescription('DEAL cooldown (min)'))
      .addIntegerOption(o => o.setName('opportunity_cooldown').setDescription('OPP cooldown (min)'))),
  new SlashCommandBuilder().setName('watchlist').setDescription('Manage watchlist.')
    .addSubcommand(s => s.setName('add').setDescription('Add item.').addStringOption(o => o.setName('item').setDescription('Name/ID').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove item.').addStringOption(o => o.setName('item').setDescription('Name/ID').setRequired(true)))
    .addSubcommand(s => s.setName('view').setDescription('View list.'))
    .addSubcommand(s => s.setName('clear').setDescription('Clear list.')),
  new SlashCommandBuilder().setName('price').setDescription('Check item signal.').addStringOption(o => o.setName('item').setDescription('Name/ID').setRequired(true)),
  new SlashCommandBuilder().setName('help').setDescription('Show help.'),
];

async function handleAlerts(int) {
  const sub = int.options.getSubcommand();
  if (sub === 'setup') {
    if (!int.guildId) { await int.reply({ content: 'Use in server.', flags: 64 }); return true; }
    serverConfigs[int.guildId] = { enabled: true, channelId: int.channelId };
    saveServerConfigs();
    await int.reply({ content: `✅ Alerts enabled in <#${int.channelId}>`, flags: 64 });
    return true;
  }
  if (sub === 'stop') {
    if (int.guildId && serverConfigs[int.guildId]) serverConfigs[int.guildId].enabled = false;
    saveServerConfigs();
    await int.reply({ content: 'Alerts disabled.', flags: 64 });
    return true;
  }
  if (sub === 'status') {
    const cfg = int.guildId ? serverConfigs[int.guildId] : null;
    const embed = new EmbedBuilder().setTitle('📡 Status').setColor(CRATER_COLOR)
      .addFields(
        { name: 'Active', value: cfg?.enabled ? '🟢 Yes' : '🔴 No', inline: true },
        { name: 'Channel', value: cfg?.channelId ? `<#${cfg.channelId}>` : '—', inline: true },
        { name: 'Watchlist', value: watchlist.size > 0 ? `${watchlist.size}` : 'All', inline: true },
      )
      .addFields(
        { name: '💎 DEAL', value: `Profit: ≥${fmtGp(CONFIG.dealTier.minMaxProfit)}\nRealistic: ≥${fmtGp(CONFIG.dealTier.minRealisticProfit)}\nROI: ≥${CONFIG.dealTier.minRoi}%\nCD: ${CONFIG.cooldowns.deal / 60000}m`, inline: true },
        { name: '👀 OPP', value: `Profit: ≥${fmtGp(CONFIG.opportunityTier.minMaxProfit)}\nRealistic: ≥${fmtGp(CONFIG.opportunityTier.minRealisticProfit)}\nROI: ≥${CONFIG.opportunityTier.minRoi}%\nCD: ${CONFIG.cooldowns.opportunity / 60000}m`, inline: true },
      );
    await int.reply({ embeds: [embed], flags: 64 });
    return true;
  }
  if (sub === 'config') {
    const vs = int.options.getNumber('volume_spike');
    const sp = int.options.getNumber('sell_pressure');
    const pd = int.options.getNumber('price_drop');
    const dc = int.options.getInteger('deal_cooldown');
    const oc = int.options.getInteger('opportunity_cooldown');
    const changes = [];
    if (vs != null) { CONFIG.detection.volumeSpikeMultiplier = vs; changes.push(`Spike: ${vs}×`); }
    if (sp != null) { CONFIG.detection.minSellPressure = sp / 100; changes.push(`Sellers: ${sp}%`); }
    if (pd != null) { CONFIG.detection.minPriceDrop = pd; changes.push(`Drop: ${pd}%`); }
    if (dc != null) { CONFIG.cooldowns.deal = dc * 60_000; changes.push(`DEAL CD: ${dc}m`); }
    if (oc != null) { CONFIG.cooldowns.opportunity = oc * 60_000; changes.push(`OPP CD: ${oc}m`); }
    saveServerConfigs();
    await int.reply({ content: changes.length ? `Updated:\n${changes.join('\n')}` : 'No changes.', flags: 64 });
    return true;
  }
  return false;
}

async function handleWatchlist(int) {
  const sub = int.options.getSubcommand();
  if (sub === 'add' || sub === 'remove') {
    const q = int.options.getString('item', true);
    const r = findItem(q);
    if (!r) { await int.reply({ content: `Not found: ${q}`, flags: 64 }); return true; }
    if (sub === 'add') { watchlist.add(r.id); saveWatchlist(); await int.reply({ content: `Added ${r.item.name}`, flags: 64 }); }
    else { watchlist.delete(r.id); saveWatchlist(); await int.reply({ content: `Removed ${r.item.name}`, flags: 64 }); }
    return true;
  }
  if (sub === 'view') {
    if (!watchlist.size) { await int.reply({ content: 'Empty (all items monitored)', flags: 64 }); return true; }
    const names = [...watchlist].map(id => itemMapping.get(id)?.name).filter(Boolean).sort();
    await int.reply({ content: `**Watchlist (${names.length})**\n${names.join(', ')}`, flags: 64 });
    return true;
  }
  if (sub === 'clear') { watchlist.clear(); saveWatchlist(); await int.reply({ content: 'Cleared.', flags: 64 }); return true; }
  return false;
}

async function handlePrice(int) {
  const q = int.options.getString('item', true);
  const r = findItem(q);
  if (!r) { await int.reply({ content: `Not found: ${q}`, flags: 64 }); return true; }
  if (!latestPrices.size) await fetchPrices();
  await fetchAverages(false);

  const { id, item } = r;
  const pr = latestPrices.get(id);
  const a5 = data5m.get(id), a1h = data1h.get(id), a24 = data24h.get(id);

  const sell = pr?.low, sellTime = pr?.lowTime, buy = pr?.high;
  const avg5 = a5?.avgHigh, avg1 = a1h?.avgHigh, avg24 = a24?.avgHigh;
  const v5 = a5?.volume || 0, v1 = a1h?.volume || 0;

  const target = calculateSmartSellTarget(avg5, avg1, avg24);
  const { spreadPct, spreadType } = analyseSpread(buy, sell);
  const { freshnessLabel } = assessFreshness(sellTime);
  const { isCorrection, correctionPct } = detectCorrection(id, avg24);

  let perItem = null, roi = null, max = null, realistic = null;
  if (sell && target) {
    const tax = calculateTax(target);
    perItem = target - tax - sell;
    roi = (perItem / sell) * 100;
    max = item.limit ? perItem * item.limit : null;
    realistic = calculateRealisticProfit(perItem, v5, item.limit || 0);
  }

  const drop = target && sell ? ((sell - target) / target) * 100 : null;
  const sev = drop != null ? classifyDropSeverity(drop) : null;

  const embed = new EmbedBuilder()
    .setTitle(item.name)
    .setURL(`https://prices.runescape.wiki/osrs/item/${id}`)
    .setColor(CRATER_COLOR)
    .setThumbnail(`https://secure.runescape.com/m=itemdb_oldschool/obj_big.gif?id=${id}`)
    .setDescription([
      `# ${fmtGp(sell)} gp`,
      ``,
      `**Averages:** 5m: ${fmtGp(avg5)} • 1h: ${fmtGp(avg1)} • 24h: ${fmtGp(avg24)}`,
      `**Smart target:** ${fmtGp(target)}`,
      `**Profit:** ${fmtGp(perItem)}/item (${fmtPct(roi)}) • Realistic: ${fmtGp(realistic)} • Max: ${fmtGp(max)}`,
      `**Volume:** 5m: ${fmtGp(v5)} • 1h: ${fmtGp(v1)} • Limit: ${fmtGp(item.limit)}`,
      ``,
      `Fresh: **${freshnessLabel}** • Spread: ${fmtPct(spreadPct, false)} (${spreadType})`,
      isCorrection ? `⚠️ Possible correction (${fmtPct(correctionPct)})` : '',
      sev ? `🎯 **${sev}**` : 'Not currently a dump',
    ].filter(Boolean).join('\n'))
    .setFooter({ text: 'The Crater', iconURL: CRATER_ICON });

  await int.reply({ embeds: [embed], flags: 64 });
  return true;
}

async function handleHelp(int) {
  const embed = new EmbedBuilder()
    .setTitle('🌋 The Crater v3.0')
    .setColor(CRATER_COLOR)
    .setDescription([
      '**Tiers:** 💎 DEAL (strict) • 👀 OPPORTUNITY (looser) • 💀 PANIC',
      '**Severity:** 📊 Notable (5%) • 📉 Significant (10%) • 🔥 Major (15%) • 💥 Extreme (25%)',
      '',
      '**v3.0 Features:**',
      '• Smart sell targets (MAX of 5m, 1h×95%)',
      '• Realistic profit (30% of dump volume)',
      '• Spread analysis (tight/normal/wide)',
      '• Freshness (HOT/WARM/STALE)',
      '• Correction detection',
      '',
      '**Commands:**',
      '`/alerts setup|stop|status|config`',
      '`/watchlist add|remove|view|clear`',
      '`/price <item>` • `/help`',
    ].join('\n'))
    .setFooter({ text: 'Built for OSRS flippers', iconURL: CRATER_ICON });
  await int.reply({ embeds: [embed], flags: 64 });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export async function initGeDetector(client) {
  console.log(`[GE] v${CONFIG.version} | Scan: ${CONFIG.scanInterval / 1000}s`);
  ensureDataDir();
  loadServerConfigs();
  loadWatchlist();
  loadPriceHistory();
  try { await loadItemMapping(); } catch (e) { console.error('[GE] Item mapping failed:', e); }
  startApiServer();
  startAlertLoop(client);
}

export async function handleGeInteraction(int) {
  if (!int.isChatInputCommand()) return false;
  const n = int.commandName;
  if (n === 'alerts') return handleAlerts(int);
  if (n === 'watchlist') return handleWatchlist(int);
  if (n === 'price') return handlePrice(int);
  if (n === 'help') return handleHelp(int);
  return false;
}