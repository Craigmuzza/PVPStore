// geDetector.js
// ─────────────────────────────────────────────────────────────────────────────
// GE Dump Detector v2.2 for The Crater
//  - /alerts, /watchlist, /price, /help
//  - Runs a scan loop, posts alerts to configured channels
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

// ─────────────────────────────────────────────────────────────────────────────
// Branding + config
// ─────────────────────────────────────────────────────────────────────────────

const CRATER_ICON  = 'https://i.ibb.co/PZVD0ccr/The-Crater-Logo.gif';
const CRATER_COLOR = 0x1a1a2e;

const CONFIG = {
  // Version identifier - check logs to confirm deployment
  version: '3.1-realistic-bids',

  // Branding
  brand: {
    name: 'The Crater',
    icon: CRATER_ICON,
    color: CRATER_COLOR,
  },

  // OSRS Wiki API
  api: {
    baseUrl: 'https://prices.runescape.wiki/api/v1/osrs',
    userAgent: 'TheCrater-DumpDetector/2.2 (Discord Bot)',
  },

  // Scan loop
  scanInterval: 60000, // 60 seconds - matches Wiki API update frequency

  // Detection thresholds - TIGHTENED for quality
  detection: {
    // Volumes
    volumeSpikeMultiplier: 1.5,  // 5m vs 1h spike threshold (×) - was 1.2
    minVolumeFor5m: 5,           // minimum 5m volume - was 4
    minVolume1h: 25,             // minimum 1h volume - was 20

    // Sell pressure / price drop
    minSellPressure: 0.60,       // ≥ 60% of 5m volume must be sells - was 0.55
    minPriceDrop: 6,             // ≥ 6% below 5m avg high - was 5

    // Tier thresholds (price drop % vs 5m avg)
    tiers: {
      notable: -6,       // was -5
      significant: -10,  // was -8
      major: -15,        // was -12
      extreme: -25,
    },

    // Freshness
    maxDataAge: 900,             // 15 minutes - seconds; ignore stale prices

    // Profit / size filters - TIGHTENED
    minMaxProfit: 200_000,       // minimum max net profit at GE limit - was 150k
    minProfitPerItem: 100,       // minimum profit per item (gp)
    minPrice: 50,                // ignore very low-priced junk
    minTradeValue5m: 750_000,    // minimum 5m trade value - was 500k

    // Minimum ROI (%)
    minRoi: 3,                   // minimum % return on investment - was 2
  },

  // Special handling for 1gp dumps
  dumps: {
    oneGpAlerts: true,
    oneGpMinAvgPrice: 100,       // ignore items that are normally < 100 gp - was 10
    oneGpMaxAge: 300,            // 5 min
  },

  // Cooldowns
  cooldowns: {
    item: 300_000,   // 5 minutes between alerts for the same item
    oneGp: 600_000,  // 10 minutes between 1gp alerts per item
  },

  // Safety limit per scan
  limits: {
    maxAlertsPerScan: 10,  // was 15
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// In-memory state
// ─────────────────────────────────────────────────────────────────────────────

// Item metadata + name lookup
let itemMapping    = new Map(); // id -> { id, name, ... }
let itemNameLookup = new Map(); // lowercased name -> id

// Latest prices
let latestPrices    = new Map(); // id -> { high, highTime, low, lowTime, fetchTime }
let lastLatestFetch = 0;         // when we last refreshed /latest

// Averages (5m, 1h, 24h)
let data5m  = new Map(); // id -> { avgHigh, avgLow, volume, buyVolume, sellVolume, ts }
let data1h  = new Map();
let data24h = new Map();
let last5mTimestamp  = 0;
let last1hTimestamp  = 0;
let last24hTimestamp = 0;
let lastAvgFetch     = 0;

// Config + watchlist
let serverConfigs = {};        // guildId -> { enabled, channelId, overrides? }
let watchlist     = new Set(); // of item IDs (number)

// Cooldowns
const alertCooldowns  = new Map(); // itemId -> lastAlertMs
const oneGpCooldowns  = new Map(); // itemId -> lastOneGpMs

// Flag so we only start one loop and one HTTP server
let alertLoopStarted   = false;
let healthServerStarted = false;

// Scan iteration counter for periodic logging
let scanIteration = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: filesystem
// ─────────────────────────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadServerConfigs() {
  ensureDataDir();
  if (!fs.existsSync(SERVER_CONFIG_FILE)) {
    serverConfigs = {};
    return;
  }
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
  if (!fs.existsSync(WATCHLIST_FILE)) {
    watchlist = new Set();
    return;
  }
  try {
    const arr = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
    if (Array.isArray(arr)) {
      watchlist = new Set(arr.map(x => Number(x)).filter(x => Number.isInteger(x)));
    } else {
      watchlist = new Set();
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: formatting
// ─────────────────────────────────────────────────────────────────────────────

function fmtGp(value) {
  if (value == null) return '—';
  return value.toLocaleString();
}

function fmtPct(value, showPlus = true) {
  if (value == null) return '—';
  const sign = showPlus && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function fmtSpike(value) {
  if (value == null) return '—';
  return `${value.toFixed(1)}×`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: API
// ─────────────────────────────────────────────────────────────────────────────

async function fetchApi(endpoint) {
  const url = `${CONFIG.api.baseUrl}${endpoint}`;
  const startTime = Date.now();
  
  const res = await fetch(url, {
    headers: {
      'User-Agent': CONFIG.api.userAgent,
    },
  });
  
  const elapsed = Date.now() - startTime;
  
  // Check for rate limiting
  if (res.status === 429) {
    console.error(`[GE] RATE LIMITED on ${endpoint}! Status 429. Retry-After: ${res.headers.get('Retry-After')}`);
    throw new Error(`Rate limited on ${endpoint}`);
  }
  
  if (!res.ok) {
    console.error(`[GE] HTTP ${res.status} for ${endpoint} (took ${elapsed}ms)`);
    throw new Error(`HTTP ${res.status} for ${endpoint}`);
  }
  
  // Log slow responses
  if (elapsed > 1000) {
    console.warn(`[GE] Slow response: ${endpoint} took ${elapsed}ms`);
  }
  
  return res.json();
}

async function refreshLatestIfNeeded(force = false) {
  const now      = Date.now();
  const maxAgeMs = 55_000; // 55s cache - just under scan interval

  if (!force && latestPrices.size > 0 && (now - lastLatestFetch) < maxAgeMs) {
    return;
  }

  await fetchPrices();
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

    if (item.name) {
      itemNameLookup.set(item.name.toLowerCase(), item.id);
    }
  }

  console.log(`[GE] Loaded ${itemMapping.size} items.`);
}

// Track previous prices for change detection
let previousPrices = new Map();

async function fetchPrices() {
  console.log('[GE] Fetching latest prices…');
  const data = await fetchApi('/latest');
  const now  = Date.now();

  // Store previous for comparison
  previousPrices = new Map(latestPrices);
  
  let changedCount = 0;
  let newestTradeAge = Infinity;

  latestPrices.clear();
  for (const [idStr, v] of Object.entries(data.data || {})) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;

    const lowTime = v.lowTime ? v.lowTime * 1000 : null;
    const highTime = v.highTime ? v.highTime * 1000 : null;
    
    // Track how fresh the newest trade is
    if (lowTime) {
      const tradeAge = (now - lowTime) / 1000;
      if (tradeAge < newestTradeAge) newestTradeAge = tradeAge;
    }
    
    // Check if price changed from previous fetch
    const prev = previousPrices.get(id);
    if (prev && (prev.low !== v.low || prev.high !== v.high)) {
      changedCount++;
    }

    latestPrices.set(id, {
      high: v.high || null,
      highTime: v.highTime ? v.highTime * 1000 : null,
      low: v.low || null,
      lowTime,
      fetchTime: now,
    });
  }

  lastLatestFetch = now;
  console.log(`[GE] Latest prices loaded for ${latestPrices.size} items. Changed: ${changedCount}, Freshest trade: ${newestTradeAge === Infinity ? 'N/A' : Math.round(newestTradeAge) + 's ago'}`);
}

async function fetchAverages(force = false) {
  const now = Date.now();
  const cacheAge = (now - lastAvgFetch) / 1000;

  // Cache for 55 seconds - just under scan interval
  if (!force && cacheAge < 55 && data5m.size > 0 && data1h.size > 0) {
    return;
  }

  console.log('[GE] Fetching 5m, 1h and 24h averages…');

  const [data5mRaw, data1hRaw, data24hRaw] = await Promise.all([
    fetchApi('/5m'),
    fetchApi('/1h'),
    fetchApi('/24h'),
  ]);

  data5m.clear();
  data1h.clear();
  data24h.clear();

  // 5m
  for (const [idStr, v] of Object.entries(data5mRaw.data || {})) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;

    const ts = data5mRaw.timestamp ? data5mRaw.timestamp * 1000 : now;
    const totalVolume5m = (v.highPriceVolume || 0) + (v.lowPriceVolume || 0);

    data5m.set(id, {
      avgHigh: v.avgHighPrice || null,
      avgLow: v.avgLowPrice || null,
      volume: totalVolume5m,
      buyVolume: v.highPriceVolume || 0,
      sellVolume: v.lowPriceVolume || 0,
      ts,
    });
    last5mTimestamp = ts;
  }

  // 1h
  for (const [idStr, v] of Object.entries(data1hRaw.data || {})) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;

    const ts = data1hRaw.timestamp ? data1hRaw.timestamp * 1000 : now;
    const totalVolume1h = (v.highPriceVolume || 0) + (v.lowPriceVolume || 0);

    data1h.set(id, {
      avgHigh: v.avgHighPrice || null,
      avgLow: v.avgLowPrice || null,
      volume: totalVolume1h,
      buyVolume: v.highPriceVolume || 0,
      sellVolume: v.lowPriceVolume || 0,
      ts,
    });
    last1hTimestamp = ts;
  }

  // 24h
  for (const [idStr, v] of Object.entries(data24hRaw.data || {})) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;

    const ts = data24hRaw.timestamp ? data24hRaw.timestamp * 1000 : now;
    const totalVolume24h = (v.highPriceVolume || 0) + (v.lowPriceVolume || 0);

    data24h.set(id, {
      avgHigh: v.avgHighPrice || null,
      avgLow: v.avgLowPrice || null,
      volume: totalVolume24h,
      buyVolume: v.highPriceVolume || 0,
      sellVolume: v.lowPriceVolume || 0,
      ts,
    });
    last24hTimestamp = ts;
  }

  lastAvgFetch = now;
  console.log('[GE] Averages refreshed.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: name ⇄ id
// ─────────────────────────────────────────────────────────────────────────────

function findItem(query) {
  if (!query) return null;

  const trimmed = query.trim();

  // ID
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    if (itemMapping.has(id)) {
      return { id, item: itemMapping.get(id) };
    }
  }

  const lower = trimmed.toLowerCase();

  // Exact
  if (itemNameLookup.has(lower)) {
    const id = itemNameLookup.get(lower);
    return { id, item: itemMapping.get(id) };
  }

  // Fuzzy (starts with)
  for (const [nameLower, id] of itemNameLookup.entries()) {
    if (nameLower.startsWith(lower)) {
      return { id, item: itemMapping.get(id) };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dump detection
// ─────────────────────────────────────────────────────────────────────────────

function classifyTier(dropPct) {
  // dropPct is negative for price below average
  if (dropPct <= CONFIG.detection.tiers.extreme)     return 'EXTREME';
  if (dropPct <= CONFIG.detection.tiers.major)       return 'MAJOR';
  if (dropPct <= CONFIG.detection.tiers.significant) return 'DUMP';
  if (dropPct <= CONFIG.detection.tiers.notable)     return 'OPPORTUNITY';
  return null;
}

function scoreAlert(alert) {
  // Score combining drop%, spike, sellPressure, maxProfit for sorting
  const dropScore   = Math.abs(alert.dropPct || 0) * 2;
  const spikeScore  = Math.min((alert.volumeSpike || 0) * 3, 30);
  const sellScore   = (alert.sellPressure || 0) * 15;
  const profitScore = Math.min((alert.maxProfit || 0) / 50_000, 20);
  const roiScore    = Math.min((alert.roiPct || 0), 15);

  return dropScore + spikeScore + sellScore + profitScore + roiScore;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embed builders
// ─────────────────────────────────────────────────────────────────────────────

function buildDumpEmbed(alert) {
  const {
    id,
    name,
    tier,
    instaSell,
    instaBuy,
    suggestedBid,
    sellTarget,
    avgHigh5m,
    avgHigh1h,
    avgHigh24h,
    dropPct,
    volume5m,
    volume1h,
    volumeSpike,
    sellPressure,
    geLimit,
    perItemProfit,
    maxProfit,
    roiPct,
    tradeTime,
  } = alert;

  // Tier styling
  let color, emoji;
  if (tier === 'EXTREME') {
    color = 0xff4d4f;
    emoji = '💥';
  } else if (tier === 'MAJOR') {
    color = 0xfa8c16;
    emoji = '🔥';
  } else if (tier === 'DUMP') {
    color = 0xfaad14;
    emoji = '📉';
  } else {
    color = 0x52c41a;
    emoji = '🟢';
  }

  // Item image from official GE API
  const itemImageUrl = `https://secure.runescape.com/m=itemdb_oldschool/obj_big.gif?id=${id}`;
  
  // Wiki links
  const wikiUrl = `https://oldschool.runescape.wiki/w/${encodeURIComponent(name.replace(/ /g, '_'))}`;
  const pricesUrl = `https://prices.runescape.wiki/osrs/item/${id}`;

  // Calculate drops vs each average
  const drop5m  = avgHigh5m && instaSell ? ((instaSell - avgHigh5m) / avgHigh5m * 100) : null;
  const drop1h  = avgHigh1h && instaSell ? ((instaSell - avgHigh1h) / avgHigh1h * 100) : null;
  const drop24h = avgHigh24h && instaSell ? ((instaSell - avgHigh24h) / avgHigh24h * 100) : null;

  // Timestamps - use Discord's live relative format
  const now = Date.now();
  const tradeTimestamp = tradeTime ? Math.floor(tradeTime / 1000) : null;
  const embedTimestamp = Math.floor(now / 1000);

  // Calculate realistic sell price after tax
  const sellAfterTax = sellTarget ? Math.floor(sellTarget * 0.99) : null;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${emoji} ${tier}`, iconURL: CRATER_ICON })
    .setTitle(name)
    .setURL(pricesUrl)
    .setThumbnail(itemImageUrl)
    .setDescription(
      [
        `## Bid: \`${fmtGp(suggestedBid)} gp\``,
        ``,
        `**Your Trade**`,
        `Buy at: \`${fmtGp(suggestedBid)} gp\` (beats current buyers)`,
        `Sell at: \`${fmtGp(sellAfterTax)} gp\` (after 1% tax)`,
        `Profit: \`${fmtGp(Math.round(perItemProfit))} gp\` per item (${fmtPct(roiPct)})`,
        `Max profit: \`${fmtGp(Math.round(maxProfit))} gp\``,
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Market Context',
        value: [
          `Dump price: \`${fmtGp(instaSell)} gp\``,
          `Buyers at: \`${fmtGp(instaBuy)} gp\``,
          `Sell target: \`${fmtGp(sellTarget)} gp\``,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Dump Signal',
        value: [
          `Spike: \`${fmtSpike(volumeSpike)}\``,
          `Sellers: \`${sellPressure != null ? (sellPressure * 100).toFixed(0) + '%' : '—'}\``,
        ].join('\n'),
        inline: true,
      },
    )
    .addFields(
      {
        name: 'Price History',
        value: `5m: \`${fmtGp(avgHigh5m)}\` (${fmtPct(drop5m)}) • 1h: \`${fmtGp(avgHigh1h)}\` (${fmtPct(drop1h)}) • 24h: \`${fmtGp(avgHigh24h)}\` (${fmtPct(drop24h)})`,
        inline: false,
      },
    )
    .addFields(
      {
        name: 'Volume & Limits',
        value: `5m: \`${fmtGp(volume5m)}\` • 1h: \`${fmtGp(volume1h)}\` • GE limit: \`${fmtGp(geLimit)}\``,
        inline: false,
      },
    )
    .addFields(
      {
        name: 'Freshness',
        value: [
          `Last trade: ${tradeTimestamp ? `<t:${tradeTimestamp}:T> (<t:${tradeTimestamp}:R>)` : '—'}`,
          `Alerted: <t:${embedTimestamp}:T>`,
        ].join('\n'),
        inline: false,
      },
    )
    .addFields({
      name: '\u200b',
      value: `[Wiki](${wikiUrl}) • [Live Prices](${pricesUrl})`,
      inline: false,
    })
    .setFooter({ text: 'The Crater', iconURL: CRATER_ICON })
    .setTimestamp();

  return embed;
}

function build1gpEmbed(alert) {
  const {
    id,
    name,
    typicalPrice,
    avgHigh1h,
    avgHigh24h,
    volume5m,
    sellPressure,
    geLimit,
    ts,
  } = alert;

  const itemImageUrl = `https://secure.runescape.com/m=itemdb_oldschool/obj_big.gif?id=${id}`;
  const wikiUrl = `https://oldschool.runescape.wiki/w/${encodeURIComponent(name.replace(/ /g, '_'))}`;
  const pricesUrl = `https://prices.runescape.wiki/osrs/item/${id}`;

  const sellStr = sellPressure != null ? `${(sellPressure * 100).toFixed(0)}%` : '—';
  
  // Timestamps - use Discord's live relative format
  const now = Date.now();
  const tradeTimestamp = ts ? Math.floor(ts / 1000) : null;
  const embedTimestamp = Math.floor(now / 1000);

  // Calculate potential profit
  const potentialProfit = typicalPrice && geLimit ? (typicalPrice - 1) * geLimit : null;

  const embed = new EmbedBuilder()
    .setColor(0x722ed1)
    .setAuthor({ name: '💀 1GP DUMP', iconURL: CRATER_ICON })
    .setTitle(name)
    .setURL(pricesUrl)
    .setThumbnail(itemImageUrl)
    .setDescription(
      [
        `# DUMPED AT 1 GP`,
        ``,
        `**Typical Prices**`,
        `5m avg: \`${fmtGp(typicalPrice)} gp\``,
        `1h avg: \`${fmtGp(avgHigh1h)} gp\``,
        `24h avg: \`${fmtGp(avgHigh24h)} gp\``,
      ].join('\n'),
    )
    .addFields(
      {
        name: 'If You Snipe It',
        value: [
          `Potential: \`${fmtGp(potentialProfit)} gp\``,
          `GE limit: \`${fmtGp(geLimit)}\``,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Activity',
        value: [
          `Volume: \`${fmtGp(volume5m)}\` (5m)`,
          `Sellers: \`${sellStr}\``,
        ].join('\n'),
        inline: true,
      },
    )
    .addFields(
      {
        name: 'Freshness',
        value: [
          `Last trade: ${tradeTimestamp ? `<t:${tradeTimestamp}:T> (<t:${tradeTimestamp}:R>)` : '—'}`,
          `Alerted: <t:${embedTimestamp}:T>`,
        ].join('\n'),
        inline: false,
      },
    )
    .addFields({
      name: '\u200b',
      value: `[Wiki](${wikiUrl}) • [Live Prices](${pricesUrl})`,
      inline: false,
    })
    .setFooter({ text: 'The Crater', iconURL: CRATER_ICON })
    .setTimestamp();

  return embed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan for dumps
// ─────────────────────────────────────────────────────────────────────────────

async function scanForDumps() {
  const scanStart = Date.now();
  
  // Refresh latest spot prices and averages
  const latestStart = Date.now();
  await refreshLatestIfNeeded(false);
  const latestEnd = Date.now();
  
  const avgStart = Date.now();
  await fetchAverages(false);
  const avgEnd = Date.now();

  const now   = Date.now();
  const age5m = (now - last5mTimestamp) / 1000;

  // If 5m data is too old, force a refresh and check again
  if (age5m > 600) {
    console.log('[GE] 5m data stale, forcing refresh…');
    await fetchAverages(true);  // Force refresh
    const newAge5m = (Date.now() - last5mTimestamp) / 1000;
    if (newAge5m > 600) {
      console.log('[GE] 5m data still too old after refresh, skipping scan.');
      return { oneGpAlerts: [], dumpAlerts: [] };
    }
  }

  const idsToScan = watchlist.size > 0
    ? Array.from(watchlist)
    : Array.from(latestPrices.keys());

  const debugCounts = {
    total: idsToScan.length,
    missingPrice: 0,
    ageTooOld: 0,
    vol1hLow: 0,
    vol5mLow: 0,
    spikeLow: 0,
    sellersLow: 0,
    priceTooLow: 0,
    dropTooSmall: 0,
    noOpportunity: 0,  // Buyers already at/above sell target
    roiTooLow: 0,
    profitTooLow: 0,
    tradeTooSmall: 0,
    passed: 0,
  };

  const oneGpAlerts = [];
  const dumpAlerts  = [];

  for (const id of idsToScan) {
    const priceInfo = latestPrices.get(id);
    if (!priceInfo) {
      debugCounts.missingPrice++;
      continue;
    }

    const mapping = itemMapping.get(id);
    const name    = mapping?.name || `Item ${id}`;
    const geLimit = mapping?.limit ?? null;

    const avg5  = data5m.get(id);
    const avg1h = data1h.get(id);
    const avg24 = data24h.get(id);

    const instaSell      = priceInfo.low ?? null;
    const instaSellTime  = priceInfo.lowTime ?? null;
    const instaBuy       = priceInfo.high ?? null;  // Current buyer offers
    const instaBuyTime   = priceInfo.highTime ?? null;

    if (!instaSell || !instaSellTime) {
      debugCounts.missingPrice++;
      continue;
    }

    const priceAgeSec = (now - instaSellTime) / 1000;
    if (priceAgeSec > CONFIG.detection.maxDataAge) {
      debugCounts.ageTooOld++;
      continue;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1GP DUMP DETECTION (always check, separate from normal dumps)
    // ─────────────────────────────────────────────────────────────────────────
    if (CONFIG.dumps.oneGpAlerts && instaSell === 1) {
      const lastOneGp = oneGpCooldowns.get(id) || 0;
      if (now - lastOneGp >= CONFIG.cooldowns.oneGp) {
        let typicalPrice = avg5?.avgHigh
          ?? avg1h?.avgHigh
          ?? priceInfo.high
          ?? null;

        if (typicalPrice && typicalPrice >= CONFIG.dumps.oneGpMinAvgPrice) {
          const vol5m     = avg5?.volume || 0;
          const sellers5m = avg5 ? (avg5.sellVolume || 0) / (avg5.volume || 1) : 0.5;

          oneGpAlerts.push({
            id,
            name,
            typicalPrice,
            avgHigh1h: avg1h?.avgHigh ?? null,
            avgHigh24h: avg24?.avgHigh ?? null,
            volume5m: vol5m,
            sellPressure: sellers5m,
            geLimit,
            ts: instaSellTime,
          });

          oneGpCooldowns.set(id, now);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NORMAL DUMP DETECTION
    // ─────────────────────────────────────────────────────────────────────────
    const vol5m = avg5?.volume || 0;
    const vol1h = avg1h?.volume || 0;

    if (vol1h < CONFIG.detection.minVolume1h) {
      debugCounts.vol1hLow++;
      continue;
    }
    if (vol5m < CONFIG.detection.minVolumeFor5m) {
      debugCounts.vol5mLow++;
      continue;
    }

    const spike = vol1h > 0 ? (vol5m / (vol1h / 12)) : 0;
    if (spike < CONFIG.detection.volumeSpikeMultiplier) {
      debugCounts.spikeLow++;
      continue;
    }

    const sellers5m = avg5 ? (avg5.sellVolume || 0) / (avg5.volume || 1) : 0.5;
    if (sellers5m < CONFIG.detection.minSellPressure) {
      debugCounts.sellersLow++;
      continue;
    }

    const avgHigh5m = avg5?.avgHigh ?? null;
    if (!avgHigh5m || avgHigh5m < CONFIG.detection.minPrice) {
      debugCounts.priceTooLow++;
      continue;
    }

    const dropPct = ((instaSell - avgHigh5m) / avgHigh5m) * 100;
    if (dropPct > -CONFIG.detection.minPriceDrop) {
      debugCounts.dropTooSmall++;
      continue;
    }

    // Multi-timeframe validation: must be down vs 5m AND (1h OR 24h)
    // This filters out false signals where 5m is artificially spiked
    const avgHigh1h = avg1h?.avgHigh ?? null;
    const avgHigh24h = avg24?.avgHigh ?? null;
    
    const drop1h = avgHigh1h && instaSell ? ((instaSell - avgHigh1h) / avgHigh1h) * 100 : null;
    const drop24h = avgHigh24h && instaSell ? ((instaSell - avgHigh24h) / avgHigh24h) * 100 : null;
    
    // Require at least 3% drop vs 1h OR 24h (half the 5m threshold)
    const secondaryDropThreshold = -3;
    const validVs1h = drop1h !== null && drop1h <= secondaryDropThreshold;
    const validVs24h = drop24h !== null && drop24h <= secondaryDropThreshold;
    
    if (!validVs1h && !validVs24h) {
      debugCounts.dropTooSmall++;
      continue;
    }

    // CRITICAL: Check if opportunity still exists
    // If buyers (instaBuy) are already at or above the averages, the dump got absorbed
    // Use the lowest average as our sell target for conservative profit calc
    const sellTarget = Math.min(
      avgHigh5m || Infinity,
      avgHigh1h || Infinity,
      avgHigh24h || Infinity
    );
    
    if (!instaBuy || instaBuy >= sellTarget) {
      // Buyers already at or above where we'd sell - no opportunity
      debugCounts.noOpportunity++;
      continue;
    }

    // Profit calculations based on REALISTIC buy price (instaBuy + 1gp to beat buyers)
    const realisticBuyPrice = instaBuy + 1;
    const sellPrice = sellTarget * 0.99; // 1% GE tax

    const perItemProfit = sellPrice - realisticBuyPrice;
    const roiPct = (perItemProfit / realisticBuyPrice) * 100;

    // Filter out low per-item profit (but don't override the display value)
    if (perItemProfit < CONFIG.detection.minProfitPerItem) {
      debugCounts.profitTooLow++;
      continue;
    }

    if (roiPct < CONFIG.detection.minRoi) {
      debugCounts.roiTooLow++;
      continue;
    }
    const limitForProfit = geLimit || 0;
    const maxProfit = limitForProfit > 0
      ? perItemProfit * limitForProfit
      : 0;

    if (maxProfit < CONFIG.detection.minMaxProfit) {
      debugCounts.profitTooLow++;
      continue;
    }

    const tradeValue5m = realisticBuyPrice * vol5m;
    if (tradeValue5m < CONFIG.detection.minTradeValue5m) {
      debugCounts.tradeTooSmall++;
      continue;
    }

    const tier = classifyTier(dropPct);
    if (!tier) continue;

    // Cooldown check
    const lastAlert = alertCooldowns.get(id) || 0;
    if (now - lastAlert < CONFIG.cooldowns.item) continue;

    const alert = {
      id,
      name,
      tier,
      instaSell,                // The dump price (for reference)
      instaBuy,                 // Current buyer offers
      suggestedBid: realisticBuyPrice,  // What you should bid (instaBuy + 1)
      sellTarget,               // Lowest of 5m/1h/24h averages
      avgHigh5m,
      avgHigh1h,
      avgHigh24h,
      dropPct,
      volume5m: vol5m,
      volume1h: vol1h,
      volumeSpike: spike,
      sellPressure: sellers5m,
      geLimit,
      perItemProfit,
      maxProfit,
      roiPct,
      tradeTime: instaSellTime,
    };

    dumpAlerts.push(alert);
    alertCooldowns.set(id, now);
    debugCounts.passed++;
  }

  const scanEnd = Date.now();

  // Periodic logging with timing
  scanIteration++;
  if (scanIteration % 30 === 0) {
    console.log('[GE] Scan stats:', {
      total: debugCounts.total,
      missingPrice: debugCounts.missingPrice,
      ageTooOld: debugCounts.ageTooOld,
      vol1hLow: debugCounts.vol1hLow,
      vol5mLow: debugCounts.vol5mLow,
      spikeLow: debugCounts.spikeLow,
      sellersLow: debugCounts.sellersLow,
      priceTooLow: debugCounts.priceTooLow,
      dropTooSmall: debugCounts.dropTooSmall,
      noOpportunity: debugCounts.noOpportunity,
      roiTooLow: debugCounts.roiTooLow,
      profitTooLow: debugCounts.profitTooLow,
      tradeTooSmall: debugCounts.tradeTooSmall,
      passed: debugCounts.passed,
      dumpAlerts: dumpAlerts.length,
    });
    console.log('[GE] Timing:', {
      latestFetch: `${latestEnd - latestStart}ms`,
      avgFetch: `${avgEnd - avgStart}ms`,
      scanTotal: `${scanEnd - scanStart}ms`,
    });
  }

  // Log every alert with timing for debugging
  if (dumpAlerts.length > 0) {
    for (const alert of dumpAlerts) {
      const tradeAge = alert.tradeTime ? Math.round((Date.now() - alert.tradeTime) / 1000) : null;
      console.log(`[GE] ALERT: ${alert.name} | Trade age: ${tradeAge}s | Scan took: ${scanEnd - scanStart}ms`);
    }
  }

  return { oneGpAlerts, dumpAlerts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert loop + health server
// ─────────────────────────────────────────────────────────────────────────────

function startHealthServer() {
  if (healthServerStarted) return;
  healthServerStarted = true;

  const port = Number(process.env.PORT) || 10000;
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    console.log(`[GE] Health server listening on port ${port}`);
  });
}

function startAlertLoop(client) {
  if (alertLoopStarted) return;
  alertLoopStarted = true;

  setInterval(async () => {
    try {
      const { oneGpAlerts, dumpAlerts } = await scanForDumps();
      if (!oneGpAlerts.length && !dumpAlerts.length) return;

      const sortedDumps = dumpAlerts
        .sort((a, b) => scoreAlert(b) - scoreAlert(a))
        .slice(0, CONFIG.limits.maxAlertsPerScan);

      const guildIds = Object.keys(serverConfigs);

      for (const guildId of guildIds) {
        const cfg = serverConfigs[guildId];
        if (!cfg || !cfg.enabled || !cfg.channelId) continue;

        const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;

        for (const alert of oneGpAlerts) {
          await channel.send({ embeds: [build1gpEmbed(alert)] });
        }

        for (const alert of sortedDumps) {
          await channel.send({ embeds: [buildDumpEmbed(alert)] });
        }
      }
    } catch (err) {
      console.error('[GE] Error in alert loop:', err);
    }
  }, CONFIG.scanInterval);
}

// ─────────────────────────────────────────────────────────────────────────────
// Slash commands (GE)
// ─────────────────────────────────────────────────────────────────────────────

export const geCommands = [
  new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Configure GE dump alerts.')
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Enable alerts in this channel.'),
    )
    .addSubcommand(sub =>
      sub
        .setName('stop')
        .setDescription('Disable GE dump alerts for this server.'),
    )
    .addSubcommand(sub =>
      sub
        .setName('config')
        .setDescription('Adjust detection thresholds.')
        .addNumberOption(opt =>
          opt
            .setName('volume_spike')
            .setDescription('Minimum 5m vs 1h volume spike (x).'),
        )
        .addNumberOption(opt =>
          opt
            .setName('sell_pressure')
            .setDescription('Minimum 5m seller share (%).'),
        )
        .addNumberOption(opt =>
          opt
            .setName('price_drop')
            .setDescription('Minimum price drop vs 5m avg (%).'),
        )
        .addIntegerOption(opt =>
          opt
            .setName('cooldown')
            .setDescription('Per-item alert cooldown (minutes).'),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show current alert status and thresholds.'),
    ),

  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage the GE watchlist.')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add an item to the watchlist.')
        .addStringOption(opt =>
          opt
            .setName('item')
            .setDescription('Item name or ID.')
            .setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove an item from the watchlist.')
        .addStringOption(opt =>
          opt
            .setName('item')
            .setDescription('Item name or ID.')
            .setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('View the current watchlist.'),
    )
    .addSubcommand(sub =>
      sub
        .setName('clear')
        .setDescription('Clear the watchlist (monitor all items).'),
    ),

  new SlashCommandBuilder()
    .setName('price')
    .setDescription('Inspect GE signal for a specific item.')
    .addStringOption(opt =>
      opt
        .setName('item')
        .setDescription('Item name or ID.')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show GE Dump Detector help.'),
];

// ─────────────────────────────────────────────────────────────────────────────
// Command handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleAlerts(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'setup') {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: 'This command must be used in a guild.',
        flags: 64,
      });
      return true;
    }

    const channelId = interaction.channelId;
    serverConfigs[guildId] = serverConfigs[guildId] || {};
    serverConfigs[guildId].enabled   = true;
    serverConfigs[guildId].channelId = channelId;

    saveServerConfigs();

    const embed = new EmbedBuilder()
      .setTitle('✅ GE Alerts Enabled')
      .setDescription(
        [
          `Alerts will now be posted in <#${channelId}>.`,
          '',
          '**Detection thresholds (v2.2):**',
          `• Volume spike: ≥${CONFIG.detection.volumeSpikeMultiplier}×`,
          `• Sell pressure: ≥${(CONFIG.detection.minSellPressure * 100).toFixed(0)}%`,
          `• Price drop: ≥${CONFIG.detection.minPriceDrop}%`,
          `• Min ROI: ≥${CONFIG.detection.minRoi}%`,
          `• Min max profit: ≥${fmtGp(CONFIG.detection.minMaxProfit)} gp`,
        ].join('\n'),
      )
      .setColor(CRATER_COLOR)
      .setThumbnail(CRATER_ICON);

    await interaction.reply({ embeds: [embed], flags: 64 });
    return true;
  }

  if (sub === 'stop') {
    const guildId = interaction.guildId;
    if (guildId && serverConfigs[guildId]) {
      serverConfigs[guildId].enabled = false;
      saveServerConfigs();
    }

    await interaction.reply({
      content: 'GE dump alerts have been disabled for this server.',
      flags: 64,
    });
    return true;
  }

  if (sub === 'config') {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: 'This command must be used in a guild.',
        flags: 64,
      });
      return true;
    }

    serverConfigs[guildId] = serverConfigs[guildId] || {};

    const volumeSpike  = interaction.options.getNumber('volume_spike');
    const sellPressure = interaction.options.getNumber('sell_pressure');
    const priceDrop    = interaction.options.getNumber('price_drop');
    const cooldown     = interaction.options.getInteger('cooldown');

    if (volumeSpike != null) {
      CONFIG.detection.volumeSpikeMultiplier = volumeSpike;
      serverConfigs[guildId].volumeSpikeMultiplier = volumeSpike;
    }
    if (sellPressure != null) {
      CONFIG.detection.minSellPressure = sellPressure / 100;
      serverConfigs[guildId].minSellPressure = sellPressure / 100;
    }
    if (priceDrop != null) {
      CONFIG.detection.minPriceDrop = priceDrop;
      serverConfigs[guildId].minPriceDrop = priceDrop;
    }
    if (cooldown != null) {
      CONFIG.cooldowns.item = cooldown * 60_000;
      serverConfigs[guildId].cooldownMs = CONFIG.cooldowns.item;
    }

    saveServerConfigs();

    const embed = new EmbedBuilder()
      .setTitle('⚙️ GE Detection Config Updated')
      .setColor(CRATER_COLOR)
      .setThumbnail(CRATER_ICON)
      .addFields(
        {
          name: 'Volume spike',
          value: `${CONFIG.detection.volumeSpikeMultiplier.toFixed(2)}×`,
          inline: true,
        },
        {
          name: 'Sell pressure',
          value: `${(CONFIG.detection.minSellPressure * 100).toFixed(0)}%+`,
          inline: true,
        },
        {
          name: 'Price drop',
          value: `${CONFIG.detection.minPriceDrop.toFixed(1)}%+`,
          inline: true,
        },
        {
          name: 'Per-item cooldown',
          value: `${Math.round(CONFIG.cooldowns.item / 60000)} min`,
          inline: true,
        },
      );

    await interaction.reply({ embeds: [embed], flags: 64 });
    return true;
  }

  if (sub === 'status') {
    const guildId = interaction.guildId;
    const cfg = guildId ? serverConfigs[guildId] : null;

    const enabled   = cfg?.enabled ? '🟢 Active' : '🔴 Inactive';
    const channelId = cfg?.channelId;

    const embed = new EmbedBuilder()
      .setTitle('📡 GE Alerts Status')
      .setColor(CRATER_COLOR)
      .setThumbnail(CRATER_ICON)
      .addFields(
        {
          name: 'Status',
          value: enabled,
          inline: true,
        },
        {
          name: 'Channel',
          value: channelId ? `<#${channelId}>` : 'Not configured',
          inline: true,
        },
        {
          name: 'Watchlist',
          value: watchlist.size > 0
            ? `${watchlist.size} item(s)`
            : 'All items',
          inline: true,
        },
      )
      .addFields({
        name: 'Detection Thresholds',
        value: [
          `• Volume spike: ≥${CONFIG.detection.volumeSpikeMultiplier}×`,
          `• Sell pressure: ≥${(CONFIG.detection.minSellPressure * 100).toFixed(0)}%`,
          `• Price drop: ≥${CONFIG.detection.minPriceDrop}%`,
          `• Min ROI: ≥${CONFIG.detection.minRoi}%`,
          `• Min max profit: ≥${fmtGp(CONFIG.detection.minMaxProfit)} gp`,
          `• Min 5m trade value: ≥${fmtGp(CONFIG.detection.minTradeValue5m)} gp`,
          `• Cooldown: ${Math.round(CONFIG.cooldowns.item / 60000)} min`,
        ].join('\n'),
        inline: false,
      });

    await interaction.reply({ embeds: [embed], flags: 64 });
    return true;
  }

  return false;
}

async function handleWatchlist(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'add' || sub === 'remove') {
    const query    = interaction.options.getString('item', true);
    const resolved = findItem(query);

    if (!resolved) {
      await interaction.reply({
        content: `I couldn't find an item matching \`${query}\`.`,
        flags: 64,
      });
      return true;
    }

    const { id, item } = resolved;

    if (sub === 'add') {
      watchlist.add(id);
      saveWatchlist();
      await interaction.reply({
        content: `Added **${item.name}** (ID: ${id}) to the watchlist.`,
        flags: 64,
      });
      return true;
    }

    if (sub === 'remove') {
      const had = watchlist.delete(id);
      saveWatchlist();
      await interaction.reply({
        content: had
          ? `Removed **${item.name}** (ID: ${id}) from the watchlist.`
          : `**${item.name}** (ID: ${id}) was not on the watchlist.`,
        flags: 64,
      });
      return true;
    }
  }

  if (sub === 'view') {
    if (watchlist.size === 0) {
      await interaction.reply({
        content: 'The watchlist is empty – all items are being monitored.',
        flags: 64,
      });
      return true;
    }

    const names = [];
    for (const id of watchlist) {
      const meta = itemMapping.get(id);
      if (meta?.name) names.push(meta.name);
    }
    names.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

    const embed = new EmbedBuilder()
      .setTitle('👁 Watchlist')
      .setColor(CRATER_COLOR)
      .setThumbnail(CRATER_ICON)
      .setDescription(
        names.length
          ? names.map(n => `• ${n}`).join('\n')
          : 'No resolvable names; custom IDs only.',
      );

    await interaction.reply({ embeds: [embed], flags: 64 });
    return true;
  }

  if (sub === 'clear') {
    watchlist.clear();
    saveWatchlist();
    await interaction.reply({
      content: 'Watchlist cleared. All items will now be monitored.',
      flags: 64,
    });
    return true;
  }

  return false;
}

async function handlePrice(interaction) {
  const query    = interaction.options.getString('item', true);
  const resolved = findItem(query);

  if (!resolved) {
    await interaction.reply({
      content: `I couldn't find an item matching \`${query}\`.`,
      flags: 64,
    });
    return true;
  }

  const { id, item } = resolved;

  // Ensure data is loaded
  if (!latestPrices.size) {
    await fetchPrices();
  }
  await fetchAverages(false);

  const priceInfo = latestPrices.get(id);
  const avg5      = data5m.get(id);
  const avg1h     = data1h.get(id);
  const avg24     = data24h.get(id);

  const now = Date.now();

  const instaSell     = priceInfo?.low ?? null;
  const instaSellTime = priceInfo?.lowTime ?? null;
  const instaBuy      = priceInfo?.high ?? null;

  const ageSec = instaSellTime ? (now - instaSellTime) / 1000 : null;

  const vol5m = avg5?.volume || 0;
  const vol1h = avg1h?.volume || 0;
  const vol24 = avg24?.volume || 0;

  const spike      = vol1h > 0 ? (vol5m / (vol1h / 12)) : null;
  const sellers5m  = avg5 ? (avg5.sellVolume || 0) / (avg5.volume || 1) : null;
  
  const avgHigh5m  = avg5?.avgHigh ?? null;
  const avgHigh1h  = avg1h?.avgHigh ?? null;
  const avgHigh24h = avg24?.avgHigh ?? null;

  const drop5m  = avgHigh5m && instaSell ? ((instaSell - avgHigh5m) / avgHigh5m * 100) : null;
  const drop1h  = avgHigh1h && instaSell ? ((instaSell - avgHigh1h) / avgHigh1h * 100) : null;
  const drop24h = avgHigh24h && instaSell ? ((instaSell - avgHigh24h) / avgHigh24h * 100) : null;

  const geLimit = item?.limit ?? null;

  let perItemProfit = null;
  let roiPct        = null;
  let maxProfit     = null;

  if (instaSell && avgHigh5m) {
    const buyPrice  = instaSell;
    const sellPrice = avgHigh5m * 0.99;

    perItemProfit = sellPrice - buyPrice;
    roiPct        = (perItemProfit / buyPrice) * 100;
    maxProfit     = geLimit ? perItemProfit * geLimit : null;
  }

  const tier = drop5m != null ? classifyTier(drop5m) : null;

  // Item image and links
  const itemImageUrl = `https://secure.runescape.com/m=itemdb_oldschool/obj_big.gif?id=${id}`;
  const wikiUrl = `https://oldschool.runescape.wiki/w/${encodeURIComponent(item.name.replace(/ /g, '_'))}`;
  const pricesUrl = `https://prices.runescape.wiki/osrs/item/${id}`;

  const embed = new EmbedBuilder()
    .setTitle(item.name)
    .setURL(pricesUrl)
    .setColor(CRATER_COLOR)
    .setThumbnail(itemImageUrl)
    .setDescription(
      [
        `# ${fmtGp(instaSell)} gp`,
        ageSec != null ? `*Last trade ${ageSec.toFixed(0)}s ago*` : '',
        '',
        `**Price Comparison**`,
        `\`  5m avg:\` ${fmtGp(avgHigh5m)} gp  (${fmtPct(drop5m)})`,
        `\`  1h avg:\` ${fmtGp(avgHigh1h)} gp  (${fmtPct(drop1h)})`,
        `\` 24h avg:\` ${fmtGp(avgHigh24h)} gp  (${fmtPct(drop24h)})`,
      ].filter(Boolean).join('\n'),
    )
    .addFields(
      {
        name: '📊 Signal Strength',
        value: [
          `Volume spike: **${fmtSpike(spike)}**`,
          `Sell pressure: **${sellers5m != null ? (sellers5m * 100).toFixed(0) + '%' : '—'}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '💰 Profit Potential',
        value: [
          `Max profit: **${fmtGp(maxProfit)} gp**`,
          `Per item: ${fmtGp(perItemProfit)} gp`,
          `ROI: ${fmtPct(roiPct)}`,
        ].join('\n'),
        inline: true,
      },
    )
    .addFields(
      {
        name: '📈 Volume',
        value: `5m: ${fmtGp(vol5m)}  •  1h: ${fmtGp(vol1h)}  •  24h: ${fmtGp(vol24)}  •  GE limit: ${fmtGp(geLimit)}`,
        inline: false,
      },
    )
    .addFields({
      name: tier ? `🎯 Classification: **${tier}**` : '🎯 Classification',
      value: tier
        ? 'This item currently meets dump detection thresholds.'
        : 'Does not currently meet dump thresholds.',
      inline: false,
    })
    .addFields({
      name: '\u200b',
      value: `[📖 Wiki](${wikiUrl})  •  [📊 Live Prices](${pricesUrl})`,
      inline: false,
    })
    .setFooter({
      text: 'The Crater • GE Dump Detector',
      iconURL: CRATER_ICON,
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: 64 });
  return true;
}

async function handleHelp(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('🌋 The Crater – GE Dump Detector v2.2')
    .setColor(CRATER_COLOR)
    .setThumbnail(CRATER_ICON)
    .setDescription(
      [
        'Detects price dumps on the Grand Exchange in real-time using RuneLite trade data from the OSRS Wiki API.',
        '',
        '**How Detection Works**',
        '',
        '1️⃣ **Volume Spike** – 5m trading volume significantly higher than normal (vs 1h average)',
        '',
        '2️⃣ **Sell Pressure** – High percentage of trades are sells (people dumping)',
        '',
        '3️⃣ **Price Drop** – Current price is below recent averages',
        '',
        '4️⃣ **Profit Filter** – Only alerts for opportunities with meaningful profit potential',
        '',
        '**Alert Tiers**',
        '🟢 `OPPORTUNITY` – 6%+ drop',
        '📉 `DUMP` – 10%+ drop',
        '🔥 `MAJOR` – 15%+ drop',
        '💥 `EXTREME` – 25%+ drop',
        '💀 `1GP DUMP` – Item sold at 1gp (always shown)',
      ].join('\n'),
    )
    .addFields(
      {
        name: '📋 Commands',
        value: [
          '`/alerts setup` – Enable alerts in current channel',
          '`/alerts stop` – Disable alerts',
          '`/alerts config` – Adjust thresholds',
          '`/alerts status` – View current settings',
          '`/price <item>` – Check any item\'s signal',
          '`/watchlist` – Manage item watchlist',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({
      text: 'The Crater • Built for OSRS flippers',
      iconURL: CRATER_ICON,
    });

  await interaction.reply({ embeds: [embed], flags: 64 });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API for bot.js
// ─────────────────────────────────────────────────────────────────────────────

export async function initGeDetector(client) {
  console.log(`[GE] Starting GE Detector v${CONFIG.version}`);
  console.log(`[GE] Config: maxDataAge=${CONFIG.detection.maxDataAge}s, minVolume1h=${CONFIG.detection.minVolume1h}, minVolumeFor5m=${CONFIG.detection.minVolumeFor5m}`);

  ensureDataDir();
  loadServerConfigs();
  loadWatchlist();

  try {
    await loadItemMapping();
  } catch (err) {
    console.error('[GE] Failed to load item mapping:', err);
  }

  startHealthServer();
  startAlertLoop(client);
}

export async function handleGeInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  const name = interaction.commandName;

  if (name === 'alerts') {
    await handleAlerts(interaction);
    return true;
  }

  if (name === 'watchlist') {
    await handleWatchlist(interaction);
    return true;
  }

  if (name === 'price') {
    await handlePrice(interaction);
    return true;
  }

  if (name === 'help') {
    await handleHelp(interaction);
    return true;
  }

  return false;
}