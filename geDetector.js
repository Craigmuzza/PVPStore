// geDetector.js
// ─────────────────────────────────────────────────────────────────────────────
// GE Dump Detector v2.0 for The Crater
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
  version: '2.1-debug',
  // Branding
  brand: {
    name: 'The Crater',
    icon: CRATER_ICON,
    color: CRATER_COLOR,
  },

  // OSRS Wiki API
  api: {
    baseUrl: 'https://prices.runescape.wiki/api/v1/osrs',
    userAgent: 'TheCrater-DumpDetector/2.0 (Discord Bot)',
  },

  // Scan loop
  scanInterval: 5000, // 5 seconds – calmer than 2s, still very fast

  // Detection thresholds
  detection: {
    // Volumes
    volumeSpikeMultiplier: 1.2,  // 5m vs 1h spike threshold (×)
    minVolumeFor5m: 4,           // minimum 5m volume
    minVolume1h: 20,             // minimum 1h volume

    // Sell pressure / price drop
    minSellPressure: 0.55,       // ≥ 55% of 5m volume must be sells
    minPriceDrop: 5,             // ≥ 5% below 5m avg high

    // Tier thresholds (price drop % vs 5m avg)
    tiers: {
      notable: -5,
      significant: -8,
      major: -12,
      extreme: -25,
    },

    // Freshness
    maxDataAge: 900,  // ✅ 15 minutes - catches more opportunities

    // Profit / size filters
    minMaxProfit: 150_000,       // minimum max net profit at GE limit
    minProfitPerItem: 1_500,     // soft per-item profit threshold (currently not used directly)
    minMaxProfitForMargin: 150_000, // reserved for future use
    minPrice: 50,                // ignore very low-priced junk
    minProfitPerItemFloor: 100,  // never show profit < 100 gp, even if math says so
    minTradeValue5m: 500_000,    // minimum 5m trade value (price * 5m volume)

    // Minimum ROI (%)
    minRoi: 2,                   // minimum % return on investment
  },

  // Special handling for 1gp dumps
  dumps: {
    oneGpAlerts: true,
    oneGpMinAvgPrice: 10,  // ignore items that are normally < 10 gp
    oneGpMaxAge: 300,      // 5 min
  },

  // Cooldowns
  cooldowns: {
    item: 300_000,   // 5 minutes between alerts for the same item
    oneGp: 600_000,  // 10 minutes between 1gp alerts per item
  },

  // Safety limit per scan
  limits: {
    maxAlertsPerScan: 15,
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

// Averages (5m, 1h)
let data5m = new Map(); // id -> { avgHigh, avgLow, volume, buyVolume, sellVolume, ts }
let data1h = new Map();
let last5mTimestamp = 0;
let last1hTimestamp = 0;
let lastAvgFetch    = 0;


// Config + watchlist
let serverConfigs = {};        // guildId -> { enabled, channelId, overrides? }
let watchlist     = new Set(); // of item IDs (number)

// Cooldowns
const alertCooldowns  = new Map(); // itemId -> lastAlertMs
const oneGpCooldowns  = new Map(); // itemId -> lastOneGpMs

// Flag so we only start one loop and one HTTP server
let alertLoopStarted   = false;
let healthServerStarted = false;

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
// Helpers: API
// ─────────────────────────────────────────────────────────────────────────────

async function fetchApi(endpoint) {
  const url = `${CONFIG.api.baseUrl}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': CONFIG.api.userAgent,
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${endpoint}`);
  }
  return res.json();
}

async function refreshLatestIfNeeded(force = false) {
  const now      = Date.now();
  const maxAgeMs = 15_000; // 15s cache window for /latest

  // If we already have fresh data and we're not forcing, do nothing
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

async function fetchPrices() {
  console.log('[GE] Fetching latest prices…');
  const data = await fetchApi('/latest');
  const now  = Date.now();

  latestPrices.clear();
  for (const [idStr, v] of Object.entries(data.data || {})) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;

    latestPrices.set(id, {
      high: v.high || null,
      highTime: v.highTime ? v.highTime * 1000 : null,
      low: v.low || null,
      lowTime: v.lowTime ? v.lowTime * 1000 : null,
      fetchTime: now,
    });
  }

  lastLatestFetch = now;
  console.log(`[GE] Latest prices loaded for ${latestPrices.size} items.`);
}

async function fetchAverages(force = false) {
  const now = Date.now();
  const cacheAge = (now - lastAvgFetch) / 1000;

  if (!force && cacheAge < 15 && data5m.size > 0 && data1h.size > 0) {
    return;
  }

  console.log('[GE] Fetching 5m and 1h averages…');

  const [data5mRaw, data1hRaw] = await Promise.all([
    fetchApi('/5m'),
    fetchApi('/1h'),
  ]);

  data5m.clear();
  data1h.clear();

  // 5m
  for (const [idStr, v] of Object.entries(data5mRaw.data || {})) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;

    const ts = data5mRaw.timestamp ? data5mRaw.timestamp * 1000 : now;

    data5m.set(id, {
      avgHigh: v.avgHigh || null,
      avgLow: v.avgLow || null,
      volume: v.volume || 0,
      buyVolume: v.buyVolume || 0,
      sellVolume: v.sellVolume || 0,
      ts,
    });
    last5mTimestamp = ts;
  }

  // 1h
  for (const [idStr, v] of Object.entries(data1hRaw.data || {})) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;

    const ts = data1hRaw.timestamp ? data1hRaw.timestamp * 1000 : now;

    data1h.set(id, {
      avgHigh: v.avgHigh || null,
      avgLow: v.avgLow || null,
      volume: v.volume || 0,
      buyVolume: v.buyVolume || 0,
      sellVolume: v.sellVolume || 0,
      ts,
    });
    last1hTimestamp = ts;
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
  if (dropPct <= CONFIG.detection.tiers.extreme)     return 'EXTREME DUMP';
  if (dropPct <= CONFIG.detection.tiers.major)       return 'MAJOR DUMP';
  if (dropPct <= CONFIG.detection.tiers.significant) return 'DUMP DETECTED';
  if (dropPct <= CONFIG.detection.tiers.notable)     return 'OPPORTUNITY';
  return null;
}

function scoreAlert(alert) {
  // Simple score combining drop%, spike, sellPressure, maxProfit
  const dropScore   = Math.abs(alert.dropPct || 0);
  const spikeScore  = (alert.volumeSpike || 0) * 5;
  const sellScore   = (alert.sellPressure || 0) * 10;
  const profitScore = (alert.maxProfit || 0) / 100_000;

  return dropScore + spikeScore + sellScore + profitScore;
}

function buildDumpEmbed(alert) {
  const {
    name,
    tier,
    instaSell,
    avgHigh,
    dropPct,
    volume5m,
    volume1h,
    volumeSpike,
    sellPressure,
    geLimit,
    perItemProfit,
    maxProfit,
    roiPct,
    wikiUrl,
    geUrl,
  } = alert;

  let color = CONFIG.brand.color;
  let emoji = '📉';

  if (tier === 'EXTREME DUMP') {
    color = 0xff4d4f;
    emoji = '💥';
  } else if (tier === 'MAJOR DUMP') {
    color = 0xfa8c16;
    emoji = '🔥';
  } else if (tier === 'DUMP DETECTED') {
    color = 0xfaad14;
    emoji = '📉';
  } else if (tier === 'OPPORTUNITY') {
    color = 0x52c41a;
    emoji = '🟢';
  }

  const dropStr  = dropPct != null ? `${dropPct.toFixed(1)}%` : 'n/a';
  const sellStr  = sellPressure != null ? `${(sellPressure * 100).toFixed(1)}%` : 'n/a';
  const spikeStr = volumeSpike != null ? `${volumeSpike.toFixed(2)}×` : 'n/a';

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${tier}`)
    .setDescription(
      [
        `**Item:** ${name}`,
        `**Current price:** ${instaSell?.toLocaleString() ?? 'n/a'} gp`,
        `**Vs 5m avg:** ${dropStr}`,
        `**Volume spike (5m vs 1h):** ${spikeStr}`,
        `**Sellers in 5m:** ${sellStr}`,
      ].join('\n'),
    )
    .setColor(color)
    .setThumbnail(CRATER_ICON)
    .addFields(
      {
        name: '💰 Profit / Size',
        value: [
          `• GE limit: ${geLimit?.toLocaleString?.() ?? 'n/a'}`,
          `• Profit / item: ${perItemProfit?.toLocaleString?.() ?? 'n/a'} gp`,
          `• Max net profit: ${maxProfit?.toLocaleString?.() ?? 'n/a'} gp`,
          `• ROI: ${roiPct != null ? roiPct.toFixed(2) + '%' : 'n/a'}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '📊 Activity',
        value: [
          `• 5m volume: ${volume5m?.toLocaleString?.() ?? 'n/a'}`,
          `• 1h volume: ${volume1h?.toLocaleString?.() ?? 'n/a'}`,
          `• Spike: ${spikeStr}`,
          `• Sellers: ${sellStr}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🔗 Links',
        value: [
          wikiUrl ? `[Wiki page](${wikiUrl})` : 'Wiki page unavailable',
          geUrl ? `[Price page](${geUrl})` : 'Price page unavailable',
        ].join('\n'),
      },
    )
    .setFooter({
      text: 'The Crater • GE Dump Detector',
      iconURL: CRATER_ICON,
    });

  return embed;
}

function build1gpEmbed(alert) {
  const {
    name,
    typicalPrice,
    volume5m,
    sellPressure,
    ts,
    wikiUrl,
    geUrl,
  } = alert;

  const sellStr = sellPressure != null ? `${(sellPressure * 100).toFixed(1)}%` : 'n/a';
  const tsInt   = Math.floor(ts / 1000);

  const embed = new EmbedBuilder()
    .setTitle('💀 1GP DUMP DETECTED')
    .setDescription(
      [
        `**Item:** ${name}`,
        `**Dumped at:** **1 gp**`,
        `**Typical price:** ${typicalPrice?.toLocaleString?.() ?? 'n/a'} gp`,
      ].join('\n'),
    )
    .setColor(0x722ed1)
    .setThumbnail(CRATER_ICON)
    .addFields(
      {
        name: '📊 Activity',
        value: [
          `• 5m volume: ${volume5m?.toLocaleString?.() ?? 'n/a'}`,
          `• Sellers: ${sellStr}`,
          `• Time: <t:${tsInt}:f>`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🔗 Links',
        value: [
          wikiUrl ? `[Wiki page](${wikiUrl})` : 'Wiki page unavailable',
          geUrl ? `[Price page](${geUrl})` : 'Price page unavailable',
        ].join('\n'),
      },
    )
    .setFooter({
      text: 'The Crater • GE Dump Detector • 1gp alerts will be cooled down automatically',
      iconURL: CRATER_ICON,
    });

  return embed;
}

let scanIteration = 0; // put this at file-scope if you prefer, before scanForDumps

async function scanForDumps() {
  // Refresh latest spot prices and 5m/1h averages
  await refreshLatestIfNeeded(false);
  await fetchAverages(false);

  const now   = Date.now();
  const age5m = (now - last5mTimestamp) / 1000;

  if (age5m > 600) {
    console.log('[GE] 5m data too old, skipping scan.');
    return { oneGpAlerts: [], dumpAlerts: [] };
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

    const avg5   = data5m.get(id);
    const avg1h  = data1h.get(id);

    const instaSell      = priceInfo.low ?? null;
    const instaSellTime  = priceInfo.lowTime ?? null;

    if (!instaSell || !instaSellTime) {
      debugCounts.missingPrice++;
      continue;
    }

    const priceAgeSec = (now - instaSellTime) / 1000;
    if (priceAgeSec > CONFIG.detection.maxDataAge) {
      debugCounts.ageTooOld++;
      continue;
    }

    // 1gp dumps (unchanged logic)
    if (CONFIG.dumps.oneGpAlerts && instaSell === 1) {
      const lastOneGp = oneGpCooldowns.get(id) || 0;
      if (now - lastOneGp >= CONFIG.cooldowns.oneGp) {
        let typicalPrice = avg5?.avgHigh
          ?? avg1h?.avgHigh
          ?? priceInfo.high
          ?? null;

        if (typicalPrice && typicalPrice >= CONFIG.dumps.oneGpMinAvgPrice) {
          const vol5m       = avg5?.volume || 0;
          const sellers5m   = avg5 ? (avg5.sellVolume || 0) / (avg5.volume || 1) : 0.5;

          const wikiUrl = mapping?.wiki_url || null;
          const geUrl   = mapping?.wiki_exchange || null;

          oneGpAlerts.push({
            id,
            name,
            typicalPrice,
            volume5m: vol5m,
            sellPressure: sellers5m,
            ts: instaSellTime,
            wikiUrl,
            geUrl,
          });

          oneGpCooldowns.set(id, now);
        }
      }
    }

    // Normal dump detection
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

    const avgHigh = avg5?.avgHigh ?? null;
    if (!avgHigh || avgHigh < CONFIG.detection.minPrice) {
      debugCounts.priceTooLow++;
      continue;
    }

    const dropPct = ((instaSell - avgHigh) / avgHigh) * 100;
    if (dropPct > -CONFIG.detection.minPriceDrop) {
      debugCounts.dropTooSmall++;
      continue;
    }

    // Profit calcs
    const buyPrice  = instaSell;
    const sellPrice = avgHigh * 0.99; // 1% GE tax

    const perItemProfitRaw = sellPrice - buyPrice;
    const perItemProfit    = Math.max(perItemProfitRaw, CONFIG.detection.minProfitPerItemFloor);

    const roiPct = (perItemProfit / buyPrice) * 100;
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

    const tradeValue5m = buyPrice * vol5m;
    if (tradeValue5m < CONFIG.detection.minTradeValue5m) {
      debugCounts.tradeTooSmall++;
      continue;
    }

    const tier = classifyTier(dropPct);
    if (!tier) continue;

    // cooldown
    const lastAlert = alertCooldowns.get(id) || 0;
    if (now - lastAlert < CONFIG.cooldowns.item) continue;

    const wikiUrl = mapping?.wiki_url || null;
    const geUrl   = mapping?.wiki_exchange || null;

    const alert = {
      id,
      name,
      tier,
      instaSell: buyPrice,
      avgHigh,
      dropPct,
      volume5m: vol5m,
      volume1h: vol1h,
      volumeSpike: spike,
      sellPressure: sellers5m,
      geLimit,
      perItemProfit,
      maxProfit,
      roiPct,
      wikiUrl,
      geUrl,
    };

    dumpAlerts.push(alert);
    alertCooldowns.set(id, now);
    debugCounts.passed++;
  }
  
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
      roiTooLow: debugCounts.roiTooLow,
      profitTooLow: debugCounts.profitTooLow,
      tradeTooSmall: debugCounts.tradeTooSmall,
      passed: debugCounts.passed,
      dumpAlerts: dumpAlerts.length,
    });
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
        ephemeral: true,
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
          '**Detection overview:**',
          '• Checks 1h volume and data freshness first.',
          '• Looks for 5m volume spikes, high seller share, and discounts vs 5m average.',
          '• Filters on ROI, max profit at GE limit, GE limit, and trade size.',
          '• Also surfaces 1gp dumps with their own cooldown.',
        ].join('\n'),
      )
      .setColor(CRATER_COLOR)
      .setThumbnail(CRATER_ICON);

    await interaction.reply({ embeds: [embed], ephemeral: true });
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
      ephemeral: true,
    });
    return true;
  }

  if (sub === 'config') {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: 'This command must be used in a guild.',
        ephemeral: true,
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
          value: `${CONFIG.detection.volumeSpikeMultiplier.toFixed(2)}× (5m vs 1h)`,
          inline: true,
        },
        {
          name: 'Sell pressure',
          value: `${(CONFIG.detection.minSellPressure * 100).toFixed(1)}%+ sellers`,
          inline: true,
        },
        {
          name: 'Price drop',
          value: `${CONFIG.detection.minPriceDrop.toFixed(1)}%+ below 5m average`,
          inline: true,
        },
        {
          name: 'Per-item cooldown',
          value: `${Math.round(CONFIG.cooldowns.item / 60000)} min`,
          inline: true,
        },
        {
          name: 'Profit / size filters',
          value: [
            `• Min ROI: ${CONFIG.detection.minRoi.toFixed(1)}%`,
            `• Min 5m trade: ${CONFIG.detection.minTradeValue5m.toLocaleString()} gp`,
            `• Min max profit: ${CONFIG.detection.minMaxProfit.toLocaleString()} gp`,
          ].join('\n'),
          inline: false,
        },
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return true;
  }

  if (sub === 'status') {
    const guildId = interaction.guildId;
    const cfg = guildId ? serverConfigs[guildId] : null;

    const enabled   = cfg?.enabled ? 'Active' : 'Inactive';
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
            : 'Monitoring all items',
          inline: true,
        },
        {
          name: 'Detection thresholds',
          value: [
            `• Volume spike: ${CONFIG.detection.volumeSpikeMultiplier.toFixed(2)}×`,
            `• Sellers: ${(CONFIG.detection.minSellPressure * 100).toFixed(1)}%+`,
            `• Price drop: ${CONFIG.detection.minPriceDrop.toFixed(1)}%+ below 5m avg`,
            `• ROI: ${CONFIG.detection.minRoi.toFixed(1)}%+`,
            `• 5m trade value: ${CONFIG.detection.minTradeValue5m.toLocaleString()}+ gp`,
            `• Cooldown: ${Math.round(CONFIG.cooldowns.item / 60000)} min`,
          ].join('\n'),
        },
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
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
        ephemeral: true,
      });
      return true;
    }

    const { id, item } = resolved;

    if (sub === 'add') {
      watchlist.add(id);
      saveWatchlist();
      await interaction.reply({
        content: `Added **${item.name}** (ID: ${id}) to the watchlist.`,
        ephemeral: true,
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
        ephemeral: true,
      });
      return true;
    }
  }

  if (sub === 'view') {
    if (watchlist.size === 0) {
      await interaction.reply({
        content: 'The watchlist is empty – all items are being monitored.',
        ephemeral: true,
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
      .setTitle('👁‍🗨 Watchlist')
      .setColor(CRATER_COLOR)
      .setThumbnail(CRATER_ICON)
      .setDescription(
        names.length
          ? names.map(n => `• ${n}`).join('\n')
          : 'No resolvable names; custom IDs only.',
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return true;
  }

  if (sub === 'clear') {
    watchlist.clear();
    saveWatchlist();
    await interaction.reply({
      content: 'Watchlist cleared. All items will now be monitored.',
      ephemeral: true,
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
      ephemeral: true,
    });
    return true;
  }

  const { id, item } = resolved;

  if (!latestPrices.size) {
    await fetchPrices();
  }
  await fetchAverages(false);

  const priceInfo = latestPrices.get(id);
  const avg5      = data5m.get(id);
  const avg1h     = data1h.get(id);

  const now = Date.now();

  const instaSell     = priceInfo?.low ?? null;
  const instaSellTime = priceInfo?.lowTime ?? null;
  const instaBuy      = priceInfo?.high ?? null;

  const ageSec = instaSellTime ? (now - instaSellTime) / 1000 : null;

  const vol5m = avg5?.volume || 0;
  const vol1h = avg1h?.volume || 0;

  const spike      = vol1h > 0 ? (vol5m / (vol1h / 12)) : null;
  const sellers5m  = avg5 ? (avg5.sellVolume || 0) / (avg5.volume || 1) : null;
  const avgHigh    = avg5?.avgHigh ?? null;
  const dropPct    = avgHigh && instaSell
    ? ((instaSell - avgHigh) / avgHigh) * 100
    : null;
  const geLimit    = item?.limit ?? null;

  let perItemProfit = null;
  let roiPct        = null;
  let maxProfit     = null;

  if (instaSell && avgHigh) {
    const buyPrice  = instaSell;
    const sellPrice = avgHigh * 0.99;

    perItemProfit = sellPrice - buyPrice;
    roiPct        = (perItemProfit / buyPrice) * 100;
    maxProfit     = geLimit ? perItemProfit * geLimit : null;
  }

  const tier   = dropPct != null ? classifyTier(dropPct) : null;
  const wikiUrl = item?.wiki_url || null;
  const geUrl   = item?.wiki_exchange || null;

  const embed = new EmbedBuilder()
    .setTitle(`📈 ${item.name} – GE Signal`)
    .setColor(CRATER_COLOR)
    .setThumbnail(CRATER_ICON)
    .addFields(
      {
        name: 'Price',
        value: [
          `• Insta-buy (high): ${instaBuy?.toLocaleString?.() ?? 'n/a'} gp`,
          `• Insta-sell (low): ${instaSell?.toLocaleString?.() ?? 'n/a'} gp`,
          ageSec != null ? `• Last trade: ${ageSec.toFixed(1)}s ago` : '',
        ].filter(Boolean).join('\n'),
        inline: true,
      },
      {
        name: 'Averages & volumes',
        value: [
          `• 5m avg high: ${avgHigh?.toLocaleString?.() ?? 'n/a'} gp`,
          `• 5m volume: ${vol5m.toLocaleString()}`,
          `• 1h volume: ${vol1h.toLocaleString()}`,
          `• Spike (5m vs 1h): ${spike != null ? spike.toFixed(2) + '×' : 'n/a'}`,
          `• Sellers (5m): ${sellers5m != null ? (sellers5m * 100).toFixed(1) + '%' : 'n/a'}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Profit / signal',
        value: [
          `• Drop vs 5m avg: ${dropPct != null ? dropPct.toFixed(2) + '%' : 'n/a'}`,
          `• Profit / item: ${perItemProfit != null ? perItemProfit.toLocaleString() + ' gp' : 'n/a'}`,
          `• Max profit @ limit: ${maxProfit != null ? maxProfit.toLocaleString() + ' gp' : 'n/a'}`,
          `• ROI: ${roiPct != null ? roiPct.toFixed(2) + '%' : 'n/a'}`,
          '',
          tier
            ? `This would currently be classified as **${tier}** under your settings.`
            : 'This does not currently meet dump thresholds.',
        ].join('\n'),
      },
      {
        name: 'Links',
        value: [
          wikiUrl ? `[Wiki page](${wikiUrl})` : 'Wiki page unavailable',
          geUrl ? `[Price page](${geUrl})` : 'Price page unavailable',
        ].join('\n'),
      },
    )
    .setFooter({
      text: 'The Crater • GE Dump Detector',
      iconURL: CRATER_ICON,
    });

  await interaction.reply({ embeds: [embed], ephemeral: true });
  return true;
}

async function handleHelp(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('📘 GE Dump Detector – How it works')
    .setColor(CRATER_COLOR)
    .setThumbnail(CRATER_ICON)
    .setDescription(
      [
        '**Step 1 – Base checks**',
        '• 1h volume must be above a minimum.',
        '• Latest price must be fresh (seconds to minutes old).',
        '',
        '**Step 2 – Dump signature**',
        '• 5m volume spikes vs 1h (x times higher).',
        '• High share of sells in the last 5m.',
        '• Price is discounted vs 5m average.',
        '',
        '**Step 3 – Profit / size filters**',
        '• ROI after tax and slippage.',
        '• Max profit at GE limit.',
        '• GE limit sanity and 5m trade value.',
        '',
        '**Step 4 – Tiers**',
        '• OPPORTUNITY, DUMP DETECTED, MAJOR DUMP, EXTREME DUMP based on discount.',
        '',
        '**1gp dumps**',
        '• 1gp sales from items with a normal price are always surfaced,',
        '  with their own cooldown, even if they don’t match normal thresholds.',
        '',
        '**Commands**',
        '• `/alerts setup|stop|config|status` – control alert behaviour.',
        '• `/watchlist add|remove|view|clear` – control which items are scanned.',
        '• `/price` – inspect one item’s signal.',
      ].join('\n'),
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
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
