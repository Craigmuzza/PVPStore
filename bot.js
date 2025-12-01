// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER - GE DUMP DETECTOR v2.0
// ═══════════════════════════════════════════════════════════════════════════════
// Reworked detection logic:
// - Volume spike as PRIMARY trigger (something unusual is happening)
// - Sell pressure confirmation (more sellers than buyers = dump)
// - Price suppression (current price below averages)
// - Fresh data requirement (stale data = stale opportunity)
// - ALL 1gp dumps shown regardless of other factors (with filters for junk items)
// ═══════════════════════════════════════════════════════════════════════════════

import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
} from 'discord.js';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  brand: {
    name: 'The Crater',
    icon: 'https://i.ibb.co/BVMTHSzM/Y-W-2.png',
    color: 0x1a1a2e,
  },

  api: {
    baseUrl: 'https://prices.runescape.wiki/api/v1/osrs',
    userAgent: 'TheCrater-DumpDetector/2.0 (Discord Bot)',
    scanInterval: 2000, // 2 seconds between scans
  },

  detection: {
    // ────────────────────────────────────────────────────────────
    // VOLUME SPIKE - Primary trigger
    // ────────────────────────────────────────────────────────────
    volumeSpikeMultiplier: 1.5,
    minVolumeFor5m: 5, // loosened from 8

    // NEW: require decent 1h volume so weird tiny trades don't spam
    minVolume1h: 150, // loosened from 350

    // ────────────────────────────────────────────────────────────
    // SELL PRESSURE
    // ────────────────────────────────────────────────────────────
    minSellPressure: 0.6,

    // ────────────────────────────────────────────────────────────
    // PRICE DROP
    // ────────────────────────────────────────────────────────────
    minPriceDrop: 4,

    priceDrop: {
      notable: -5,
      significant: -8,
      major: -12,
      extreme: -25,
    },

    // ────────────────────────────────────────────────────────────
    // DATA FRESHNESS
    // ────────────────────────────────────────────────────────────
    maxDataAge: 60,

    // ────────────────────────────────────────────────────────────
    // PROFIT THRESHOLDS
    // ────────────────────────────────────────────────────────────
    minMaxProfit: 300000,
    minProfitPerItem: 3000,
    minMaxProfitForMargin: 225000,
    minPrice: 100,
    minProfitPerItemFloor: 100,

    // ────────────────────────────────────────────────────────────
    // 1GP DUMPS
    // ────────────────────────────────────────────────────────────
    oneGpAlerts: true,
    oneGpMinAvgPrice: 10, // 1gp alerts only if typical price ≥ this
    oneGpMaxAge: 60,
    oneGpCooldown: 600000,

    // ────────────────────────────────────────────────────────────
    // GENERAL COOLDOWN
    // ────────────────────────────────────────────────────────────
    cooldown: 300000,

    // NEW: limit alerts per scan
    maxAlertsPerScan: 15,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
— DATA STORAGE
// ═══════════════════════════════════════════════════════════════════════════════

const DATA_DIR = process.env.DATA_DIR || './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_FILE = path.join(DATA_DIR, 'server_config.json');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');

let serverConfigs = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    serverConfigs = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
} catch (e) {
  console.error('Error loading config:', e.message);
}

let watchlist = new Set();
try {
  if (fs.existsSync(WATCHLIST_FILE)) {
    watchlist = new Set(JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8')));
  }
} catch (e) {
  console.error('Error loading watchlist:', e.message);
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(serverConfigs, null, 2));
}

function saveWatchlist() {
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify([...watchlist], null, 2));
}

// Cooldown tracking
const alertCooldowns = new Map();
const oneGpCooldowns = new Map();

// ═══════════════════════════════════════════════════════════════════════════════
// GE API
// ═══════════════════════════════════════════════════════════════════════════════

let itemMapping = new Map();
let itemNameLookup = new Map();
let latestPrices = new Map();

// Cache for API data
let cached5mData = null;
let cached1hData = null;
let lastAvgFetch = 0;

// Track timestamps for /5m and /1h snapshots
let last5mTimestamp = null;
let last1hTimestamp = null;

async function fetchApi(endpoint) {
  try {
    const response = await fetch(`${CONFIG.api.baseUrl}${endpoint}`, {
      headers: { 'User-Agent': CONFIG.api.userAgent },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`API error for ${endpoint}:`, error.message);
    return null;
  }
}

async function loadItemMapping() {
  const data = await fetchApi('/mapping');
  if (!data) return false;

  itemMapping.clear();
  itemNameLookup.clear();

  for (const item of data) {
    itemMapping.set(item.id, item);
    itemNameLookup.set(item.name.toLowerCase(), item.id);
  }

  console.log(`✅ Loaded ${itemMapping.size} items`);
  return true;
}

async function fetchPrices() {
  const data = await fetchApi('/latest');
  if (!data?.data) return false;

  const timestamp = Date.now();
  for (const [itemId, priceData] of Object.entries(data.data)) {
    const id = parseInt(itemId, 10);
    latestPrices.set(id, { ...priceData, fetchTime: timestamp });
  }

  return true;
}

async function fetchAverages(force = false) {
  const nowMs = Date.now();

  // Simple cache to avoid hammering the wiki
  if (!force && nowMs - lastAvgFetch < 15000 && cached5mData && cached1hData) {
    return { data5m: cached5mData, data1h: cached1hData };
  }

  const now = Math.floor(nowMs / 1000);

  // Align our requested buckets
  const bucket5m = now - (now % 300); // 300s = 5 minutes
  const bucket1h = now - (now % 3600); // 3600s = 1 hour

  const [resp5m, resp1h] = await Promise.all([
    fetchApi(`/5m?timestamp=${bucket5m}`),
    fetchApi(`/1h?timestamp=${bucket1h}`),
  ]);

  if (!resp5m?.data || !resp1h?.data) {
    console.warn('⚠️ Failed to fetch averages with timestamp alignment', {
      have5m: !!resp5m,
      have1h: !!resp1h,
    });
    return { data5m: cached5mData, data1h: cached1hData };
  }

  cached5mData = resp5m.data;
  cached1hData = resp1h.data;
  last5mTimestamp = resp5m.timestamp;
  last1hTimestamp = resp1h.timestamp;
  lastAvgFetch = nowMs;

  return { data5m: cached5mData, data1h: cached1hData };
}

function findItem(query) {
  const lower = query.toLowerCase().trim();

  // Exact match
  if (itemNameLookup.has(lower)) {
    return itemMapping.get(itemNameLookup.get(lower));
  }

  // Partial match
  for (const [name, id] of itemNameLookup) {
    if (name.includes(lower)) return itemMapping.get(id);
  }

  // Numeric ID
  const numQuery = parseInt(lower, 10);
  if (!isNaN(numQuery) && itemMapping.has(numQuery)) {
    return itemMapping.get(numQuery);
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMATTING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function formatGp(num) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  const value = Math.round(num);
  return `${value.toLocaleString()} gp`;
}

function formatVolume(num) {
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatAge(seconds) {
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

// Format Unix seconds into Discord timestamp
function formatTime(unixSeconds) {
  if (!unixSeconds || Number.isNaN(unixSeconds)) return 'Unknown';
  return `<t:${unixSeconds}:T>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMBED BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════

function buildDumpEmbed(alert) {
  const {
    item,
    buyPrice,
    sellTarget,
    profitPerItem,
    maxProfit,
    priceDropPct,
    volumeSpike,
    sellPressure,
    netRoiPct,
    totalVolume5m,
    totalVolume1h,
    highAlch,
    alchProfit,
    tradeTime,
    alertTime,
    tier,
  } = alert;

  let color;
  let emoji;
  switch (tier) {
    case 'EXTREME DUMP':
      color = 0x9b59b6;
      emoji = '💀';
      break;
    case 'MAJOR DUMP':
      color = 0xff3860;
      emoji = '🔴';
      break;
    case 'DUMP DETECTED':
      color = 0xff6b35;
      emoji = '🟠';
      break;
    default:
      color = 0xffdd57;
      emoji = '⚠️';
      break;
  }

  const spikeEmoji = volumeSpike >= 5 ? '🚨' : volumeSpike >= 3 ? '📊' : '📈';

  const pressureEmoji =
    sellPressure >= 0.9
      ? '💣'
      : sellPressure >= 0.7
      ? '🔻'
      : sellPressure >= 0.6
      ? '↘️'
      : '➡️';

  const tradeTimeStr = formatTime(tradeTime);
  const alertTimeStr = formatTime(alertTime);

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${tier}: ${item.name}`)
    .setColor(color)
    .setThumbnail(
      `https://oldschool.runescape.wiki/images/${encodeURIComponent(
        item.icon || item.name.replace(/ /g, '_') + '.png',
      )}`,
    )
    .setDescription(
      `**${priceDropPct.toFixed(1)}%** below 5m avg • ${spikeEmoji} **${volumeSpike.toFixed(
        1,
      )}x** volume spike\n` +
        `Net ROI: **${netRoiPct.toFixed(1)}%** • 🕒 Trade: ${tradeTimeStr} • Alert: ${alertTimeStr}`,
    );

  embed.addFields(
    {
      name: '🛒 BUY NOW',
      value: `**${formatGp(buyPrice)}**`,
      inline: true,
    },
    {
      name: '💰 SELL TARGET',
      value: formatGp(sellTarget),
      inline: true,
    },
    {
      name: '📋 GE Limit',
      value: `${item.limit?.toLocaleString() || '?'}`,
      inline: true,
    },
  );

  embed.addFields({
    name: '💎 POTENTIAL (net)',
    value: [
      `Per item: **${formatGp(profitPerItem)}**`,
      `Net ROI: **${netRoiPct.toFixed(1)}%**`,
      `Max @ limit: ${formatGp(maxProfit)}`,
      alchProfit > 0 ? `⚗️ Alch profit: ${formatGp(alchProfit)}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    inline: true,
  });

  embed.addFields({
    name: `${pressureEmoji} ACTIVITY`,
    value: [
      `5m volume: **${formatVolume(totalVolume5m)}**`,
      `1h volume: ${formatVolume(totalVolume1h)}`,
      `Sellers: **${(sellPressure * 100).toFixed(0)}%**`,
    ].join('\n'),
    inline: true,
  });

  embed.addFields({
    name: '🎯 TRIGGER METRICS',
    value: [
      `Drop: **${priceDropPct.toFixed(1)}%** below avg`,
      `Volume spike: **${volumeSpike.toFixed(1)}x**`,
      `Sellers: **${(sellPressure * 100).toFixed(0)}%**`,
      `Net ROI: **${netRoiPct.toFixed(1)}%**`,
    ].join('\n'),
    inline: true,
  });

  embed.addFields({
    name: '🔗 Links',
    value: `[Wiki](https://oldschool.runescape.wiki/w/${encodeURIComponent(
      item.name,
    )}) | [Prices](https://prices.runescape.wiki/osrs/item/${item.id})`,
    inline: false,
  });

  embed
    .setFooter({
      text: `${CONFIG.brand.name} • Real net margins only`,
      iconURL: CONFIG.brand.icon,
    })
    .setTimestamp();

  return embed;
}

function build1gpEmbed(alert) {
  const {
    item,
    avgPrice,
    profitPerItem,
    maxProfit,
    totalVolume5m,
    sellPressure,
    priceAge,
    highAlch,
    alchProfit,
    tradeTime,
    alertTime,
  } = alert;

  const tradeTimeStr = formatTime(tradeTime);
  const alertTimeStr = formatTime(alertTime);

  const embed = new EmbedBuilder()
    .setTitle(`💀 1GP DUMP: ${item.name}`)
    .setColor(0x9b59b6)
    .setThumbnail(
      `https://oldschool.runescape.wiki/images/${encodeURIComponent(
        item.icon || item.name.replace(/ /g, '_') + '.png',
      )}`,
    )
    .setDescription(
      [
        `Someone just insta-sold **${item.name}** for **1 gp**.`,
        avgPrice
          ? `Typical price: **${formatGp(avgPrice)}**`
          : 'Typical price: **unknown (no recent average)**',
        '',
        `🕒 Trade: ${tradeTimeStr} • Alert: ${alertTimeStr}`,
      ].join('\n'),
    );

  embed.addFields(
    { name: '🔥 Dump Price', value: '**1 gp**', inline: true },
    { name: '📈 Typical Price', value: avgPrice ? formatGp(avgPrice) : 'N/A', inline: true },
    {
      name: '📋 GE Limit',
      value: item.limit ? item.limit.toLocaleString() : '?',
      inline: true,
    },
  );

  embed.addFields({
    name: '💎 Potential (theoretical)',
    value: [
      `Per item: **${formatGp(profitPerItem)}**`,
      `Max @ limit: ${formatGp(maxProfit)}`,
      highAlch ? `⚗️ Alch profit vs 1gp: ${formatGp(alchProfit)}`
               : null,
    ]
      .filter(Boolean)
      .join('\n'),
    inline: true,
  });

  embed.addFields({
    name: '📊 Market Context (5m)',
    value: [
      `Volume (5m): **${formatVolume(totalVolume5m)}**`,
      `Sellers share: **${(sellPressure * 100).toFixed(0)}%**`,
      `Last trade age: ${priceAge ? formatAge(priceAge) : 'Unknown'}`,
    ].join('\n'),
    inline: true,
  });

  embed.addFields({
    name: '⚠️ Why this matters',
    value: [
      '• Someone may have panic-dumped or mispriced a large stack',
      '• Could be manipulation or a genuine mistake',
      '• Treat this as **signal**, not guaranteed free money',
    ].join('\n'),
    inline: false,
  });

  embed
    .setFooter({
      text: `${CONFIG.brand.name} • All 1gp dumps are surfaced with cooldown`,
      iconURL: CONFIG.brand.icon,
    })
    .setTimestamp();

  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DUMP DETECTION LOGIC v2.0
// ═══════════════════════════════════════════════════════════════════════════════

function scoreAlert(alert) {
  if (alert.type === '1GP') {
    return 1e9;
  }

  const drop = Math.abs(alert.dropPercent || 0);
  const vol = Math.min(alert.volumeSpike || 0, 10);
  const pressure = (alert.sellPressure || 0.5) - 0.55;
  const maxProfit = alert.maxProfit || 0;

  const profitScore = maxProfit > 0 ? Math.log10(maxProfit) * 4 : 0;
  const dropScore = drop * 1.5;
  const volumeScore = vol * 2;
  const pressureScore = Math.max(pressure, 0) * 20;

  return dropScore + volumeScore + pressureScore + profitScore;
}

async function scanForDumps() {
  const alerts = [];
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);

  const { data5m, data1h } = await fetchAverages();
  if (!data5m || !data1h) {
    console.warn('⚠️ Could not fetch average data');
    return alerts;
  }

  if (last5mTimestamp) {
    const aggAge = nowSeconds - last5mTimestamp;
    if (aggAge > 600) {
      console.warn(`⚠️ Aggregate 5m data is stale (${aggAge}s old) – skipping scan`);
      return alerts;
    }
  }

  const itemsToScan = watchlist.size > 0 ? [...watchlist] : [...latestPrices.keys()];

  for (const itemId of itemsToScan) {
    const item = itemMapping.get(itemId);
    const prices = latestPrices.get(itemId);
    if (!item || !prices) continue;

    const geLimit = item.limit || 0;
    const highAlch = item.highalch || 0;

    const instaBuyPrice = prices.high;
    const instaSellPrice = prices.low;
    const instaBuyTime = prices.highTime;
    const instaSellTime = prices.lowTime;

    const api5m = data5m[itemId];
    const avg5mHigh = api5m?.avgHighPrice || null;
    const buyVolume5m = api5m?.highPriceVolume || 0;
    const sellVolume5m = api5m?.lowPriceVolume || 0;
    let totalVolume5m = buyVolume5m + sellVolume5m;

    const api1h = data1h[itemId];
    const avg1hHigh = api1h?.avgHighPrice || null;
    const buyVolume1h = api1h?.highPriceVolume || 0;
    const sellVolume1h = api1h?.lowPriceVolume || 0;
    let totalVolume1h = buyVolume1h + sellVolume1h;

    if (totalVolume1h > 0 && totalVolume5m > totalVolume1h) {
      totalVolume5m = totalVolume1h;
    }

    const priceAge = instaSellTime ? nowSeconds - instaSellTime : Infinity;
    const isFresh = priceAge < CONFIG.detection.maxDataAge;

    const expected5mVolume = totalVolume1h / 12;
    const volumeSpike = expected5mVolume > 0 ? totalVolume5m / expected5mVolume : 0;

    const sellPressure =
      totalVolume5m > 0 ? sellVolume5m / totalVolume5m : 0.5;

    const buyPrice = instaSellPrice;
    const sellTarget = avg5mHigh;

    const alchProfit =
      highAlch && buyPrice ? highAlch - buyPrice - 135 : 0;

    const tradeTime = instaSellTime || instaBuyTime || nowSeconds;
    const alertTime = nowSeconds;

    // 1GP DUMPS
    if (CONFIG.detection.oneGpAlerts && buyPrice === 1) {
      const avgPrice = avg5mHigh ?? avg1hHigh ?? instaBuyPrice ?? null;
      const is1gpFresh = priceAge < CONFIG.detection.oneGpMaxAge;

      if (is1gpFresh) {
        // Filter out junk 1gp items where the typical price is tiny
        if (!avgPrice || avgPrice < CONFIG.detection.oneGpMinAvgPrice) {
          continue;
        }

        const profitPerItem = avgPrice ? avgPrice - 1 : 0;
        const maxProfit = profitPerItem * (geLimit || 1);

        const last1gp = oneGpCooldowns.get(itemId);
        if (!last1gp || now - last1gp >= CONFIG.detection.oneGpCooldown) {
          alerts.push({
            type: '1GP',
            item,
            avgPrice,
            profitPerItem,
            maxProfit,
            totalVolume5m,
            sellPressure,
            priceAge,
            highAlch,
            alchProfit: highAlch ? highAlch - 1 - 135 : 0,
            tradeTime,
            alertTime,
          });

          oneGpCooldowns.set(itemId, now);
          console.log(
            `💀 1GP dump: ${item.name} (${
              avgPrice ? 'avg ' + formatGp(avgPrice) : 'no avg'
            }, ${Math.floor(priceAge)}s ago)`,
          );
        }
      }

      continue;
    }

    // REGULAR DUMP DETECTION

    if (!buyPrice || !sellTarget || !geLimit) continue;

    if (
      buyPrice < CONFIG.detection.minPrice &&
      sellTarget < CONFIG.detection.minPrice
    )
      continue;

    if (!isFresh) continue;

    if (totalVolume5m < CONFIG.detection.minVolumeFor5m) continue;

    if (volumeSpike < CONFIG.detection.volumeSpikeMultiplier) continue;
    if (sellPressure < CONFIG.detection.minSellPressure) continue;

    const priceDropPct =
      sellTarget > 0 ? ((sellTarget - buyPrice) / sellTarget) * 100 : 0;

    if (priceDropPct < CONFIG.detection.minPriceDrop) continue;

    const effectiveBuy = buyPrice * 1.01;
    const effectiveSell = sellTarget * 0.99;
    const netProfitPerItem = effectiveSell - effectiveBuy;
    const netRoiPct =
      effectiveBuy > 0 ? (netProfitPerItem / effectiveBuy) * 100 : 0;

    const maxNetProfit = netProfitPerItem * geLimit;
    const tradeValue5m = buyPrice * totalVolume5m;
    const sellersPct = sellPressure * 100;

    // Softened hard filters
    if (netRoiPct < 3.0) continue;
    if (maxNetProfit < 500000) continue;
    if (tradeValue5m < 1500000) continue;

    let tier = null;

    if (
      priceDropPct >= 22 &&
      volumeSpike >= 3.0 &&
      sellersPct >= 90 &&
      netRoiPct >= 10
    ) {
      tier = 'EXTREME DUMP';
    } else if (
      priceDropPct >= 12 &&
      volumeSpike >= 2.0 &&
      sellersPct >= 80 &&
      netRoiPct >= 7
    ) {
      tier = 'MAJOR DUMP';
    } else if (
      priceDropPct >= 7 &&
      volumeSpike >= 1.8 &&
      sellersPct >= 70 &&
      netRoiPct >= 5
    ) {
      tier = 'DUMP DETECTED';
    } else if (
      priceDropPct >= 4 &&
      volumeSpike >= 1.5 &&
      sellersPct >= 60 &&
      netRoiPct >= 4
    ) {
      tier = 'OPPORTUNITY';
    }

    if (!tier) continue;

    const lastAlert = alertCooldowns.get(itemId);
    if (lastAlert && now - lastAlert < CONFIG.detection.cooldown) continue;

    const alert = {
      type: 'DUMP',
      tier,
      item,
      buyPrice,
      sellTarget,
      profitPerItem: netProfitPerItem,
      maxProfit: maxNetProfit,
      priceDropPct,
      dropPercent: -priceDropPct,
      volumeSpike,
      sellPressure,
      netRoiPct,
      totalVolume5m,
      totalVolume1h,
      priceAge,
      highAlch,
      alchProfit,
      tradeTime,
      alertTime,
    };

    alerts.push(alert);
    alertCooldowns.set(itemId, now);

    console.log(
      `📉 ${tier}: ${item.name} (drop=${priceDropPct.toFixed(
        1,
      )}%, vol=${volumeSpike.toFixed(1)}x, roi=${netRoiPct.toFixed(
        1,
      )}%, max=${formatGp(maxNetProfit)}, tradeTime=${tradeTime}, alertTime=${alertTime})`,
    );
  }

  return alerts;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCORD CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const commands = [
  new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Configure dump alerts')
    .addSubcommand((sub) =>
      sub.setName('setup').setDescription('Enable dump alerts in this channel'),
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Disable dump alerts'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('config')
        .setDescription('Configure detection thresholds')
        .addNumberOption((opt) =>
          opt
            .setName('volume_spike')
            .setDescription('Volume spike multiplier (default: 1.5)'),
        )
        .addNumberOption((opt) =>
          opt
            .setName('sell_pressure')
            .setDescription('Min sell pressure % (default: 60)'),
        )
        .addNumberOption((opt) =>
          opt
            .setName('price_drop')
            .setDescription('Min price drop % (default: 4)'),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('cooldown')
            .setDescription(
              'Minutes between alerts for same item (default: 5)',
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Show current configuration'),
    ),

  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage item watchlist')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add item to watchlist')
        .addStringOption((opt) =>
          opt
            .setName('item')
            .setDescription('Item name or ID')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove item from watchlist')
        .addStringOption((opt) =>
          opt
            .setName('item')
            .setDescription('Item name or ID')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('view').setDescription('View current watchlist'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Clear watchlist (monitor all items)'),
    ),

  new SlashCommandBuilder()
    .setName('price')
    .setDescription('Check current price and market data')
    .addStringOption((opt) =>
      opt
        .setName('item')
        .setDescription('Item name or ID')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help and detection logic'),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    console.log('🔄 Registering commands...');
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log('✅ Commands registered');
  } catch (error) {
    console.error('❌ Command registration failed:', error);
  }
}

// Alert loop
async function runAlertLoop() {
  try {
    await fetchPrices();
    let alerts = await scanForDumps();

    if (alerts.length === 0) return;

    const oneGpAlerts = alerts.filter((a) => a.type === '1GP');
    const dumpAlerts = alerts.filter((a) => a.type === 'DUMP');

    dumpAlerts.sort((a, b) => scoreAlert(b) - scoreAlert(a));
    const topDumps = dumpAlerts.slice(0, CONFIG.detection.maxAlertsPerScan);

    alerts = [...oneGpAlerts, ...topDumps];

    console.log(
      `🔔 ${alerts.length} alerts selected from ${
        oneGpAlerts.length + dumpAlerts.length
      } candidates`,
    );

    for (const [guildId, config] of Object.entries(serverConfigs)) {
      if (!config.enabled || !config.channelId) continue;

      const channel = client.channels.cache.get(config.channelId);
      if (!channel) continue;

      for (const alert of alerts) {
        try {
          const embed =
            alert.type === '1GP'
              ? build1gpEmbed(alert)
              : buildDumpEmbed(alert);
          await channel.send({ embeds: [embed] });
        } catch (err) {
          console.error('Failed to send alert:', err.message);
        }
      }
    }
  } catch (error) {
    console.error('Alert loop error:', error);
  }
}

// Bot ready
client.once('ready', async () => {
  console.log(`🌋 The Crater v2.0 online as ${client.user.tag}`);

  await registerCommands();
  await loadItemMapping();
  await fetchPrices();
  await fetchAverages();

  setInterval(runAlertLoop, CONFIG.api.scanInterval);
  console.log(`🔍 Scanning every ${CONFIG.api.scanInterval / 1000}s`);
  console.log(
    `📊 Detection: ${CONFIG.detection.volumeSpikeMultiplier}x volume, ${
      CONFIG.detection.minSellPressure * 100
    }% sell pressure, ${CONFIG.detection.minPriceDrop}% drop`,
  );
});

// Autocomplete handler
client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    const query = interaction.options.getFocused().toLowerCase();
    const matches = [];

    for (const [name, id] of itemNameLookup) {
      if (name.includes(query)) {
        const item = itemMapping.get(id);
        matches.push({ name: item.name, value: item.name });
        if (matches.length >= 25) break;
      }
    }

    await interaction.respond(matches);
    return;
  }
});

// Command handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const guildId = interaction.guildId;

  try {
    // /alerts
    if (commandName === 'alerts') {
      const sub = interaction.options.getSubcommand();

      if (sub === 'setup') {
        serverConfigs[guildId] = {
          enabled: true,
          channelId: interaction.channelId,
        };
        saveConfig();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('🌋 The Crater Activated')
              .setColor(CONFIG.brand.color)
              .setDescription(
                `Dump alerts will be posted to <#${interaction.channelId}>`,
              )
              .addFields({
                name: '🎯 Detection Logic',
                value: [
                  `1️⃣ **Base filters**`,
                  `• 1h volume ≥ **${CONFIG.detection.minVolume1h.toLocaleString()}** trades`,
                  `• Fresh data: last trade < **${CONFIG.detection.maxDataAge}s** ago`,
                  '',
                  `2️⃣ **Dump signature**`,
                  `• 5m volume spike ≥ **${CONFIG.detection.volumeSpikeMultiplier}x** expected`,
                  `• Sell pressure ≥ **${(
                    CONFIG.detection.minSellPressure * 100
                  ).toFixed(0)}%** of trades`,
                  `• Price is ≥ **${CONFIG.detection.minPriceDrop}%** below 5m average`,
                  '',
                  `3️⃣ **Profit / size filter (net)**`,
                  `• Net ROI ≥ **3%** after 1% spread + 1% tax`,
                  `• Max net profit at GE limit ≥ **500k gp**`,
                  `• At least **1.5m gp** traded in the last 5 minutes`,
                  '',
                  `💀 All **1GP dumps** (with typical price ≥ ${CONFIG.detection.oneGpMinAvgPrice} gp) are always shown (with their own cooldown).`,
                ].join('\n'),
                inline: false,
              })
              .setFooter({
                text: CONFIG.brand.name,
                iconURL: CONFIG.brand.icon,
              }),
          ],
        });
      }

      if (sub === 'stop') {
        if (serverConfigs[guildId]) {
          serverConfigs[guildId].enabled = false;
          saveConfig();
        }
        return interaction.reply({
          content: '✅ Alerts disabled.',
          ephemeral: true,
        });
      }

      if (sub === 'config') {
        const config = serverConfigs[guildId] || {};

        const volumeSpike = interaction.options.getNumber('volume_spike');
        const sellPressure = interaction.options.getNumber('sell_pressure');
        const priceDrop = interaction.options.getNumber('price_drop');
        const cooldown = interaction.options.getInteger('cooldown');

        if (volumeSpike !== null) config.volumeSpikeMultiplier = volumeSpike;
        if (sellPressure !== null)
          config.minSellPressure = sellPressure / 100;
        if (priceDrop !== null) config.minPriceDrop = priceDrop;
        if (cooldown !== null) config.cooldown = cooldown * 60 * 1000;

        serverConfigs[guildId] = { ...serverConfigs[guildId], ...config };
        saveConfig();

        if (volumeSpike !== null)
          CONFIG.detection.volumeSpikeMultiplier = volumeSpike;
        if (sellPressure !== null)
          CONFIG.detection.minSellPressure = sellPressure / 100;
        if (priceDrop !== null) CONFIG.detection.minPriceDrop = priceDrop;
        if (cooldown !== null)
          CONFIG.detection.cooldown = cooldown * 60 * 1000;

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('⚙️ Configuration Updated')
              .setColor(0x3298dc)
              .addFields(
                {
                  name: '📊 Volume Spike',
                  value: `${
                    config.volumeSpikeMultiplier ??
                    CONFIG.detection.volumeSpikeMultiplier
                  }x`,
                  inline: true,
                },
                {
                  name: '🔻 Sell Pressure',
                  value: `${(
                    (config.minSellPressure ??
                      CONFIG.detection.minSellPressure) * 100
                  ).toFixed(0)}%`,
                  inline: true,
                },
                {
                  name: '📉 Price Drop',
                  value: `${
                    config.minPriceDrop ?? CONFIG.detection.minPriceDrop
                  }%`,
                  inline: true,
                },
                {
                  name: '⏱️ Cooldown',
                  value: `${
                    (config.cooldown ?? CONFIG.detection.cooldown) / 60000
                  } mins`,
                  inline: true,
                },
              )
              .setFooter({
                text: CONFIG.brand.name,
                iconURL: CONFIG.brand.icon,
              }),
          ],
        });
      }

      if (sub === 'status') {
        const config = serverConfigs[guildId];

        if (!config || !config.enabled) {
          return interaction.reply({
            content: '❌ Alerts not configured. Use `/alerts setup` first.',
            ephemeral: true,
          });
        }

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('📊 Alert Status')
              .setColor(CONFIG.brand.color)
              .addFields(
                { name: 'Status', value: '🟢 Active', inline: true },
                {
                  name: 'Channel',
                  value: `<#${config.channelId}>`,
                  inline: true,
                },
                {
                  name: 'Watchlist',
                  value:
                    watchlist.size > 0
                      ? `${watchlist.size} items`
                      : 'All items',
                  inline: true,
                },
                {
                  name: 'Detection',
                  value:
                    `Vol: ${
                      config.volumeSpikeMultiplier ??
                      CONFIG.detection.volumeSpikeMultiplier
                    }x\n` +
                    `Sell: ${(
                      (config.minSellPressure ??
                        CONFIG.detection.minSellPressure) * 100
                    ).toFixed(0)}%\n` +
                    `Drop: ${
                      config.minPriceDrop ?? CONFIG.detection.minPriceDrop
                    }%`,
                  inline: true,
                },
              )
              .setFooter({
                text: CONFIG.brand.name,
                iconURL: CONFIG.brand.icon,
              }),
          ],
        });
      }
    }

    // /watchlist
    if (commandName === 'watchlist') {
      const sub = interaction.options.getSubcommand();

      if (sub === 'add') {
        const query = interaction.options.getString('item');
        const item = findItem(query);
        if (!item) {
          return interaction.reply({
            content: `❌ Item "${query}" not found.`,
            ephemeral: true,
          });
        }
        watchlist.add(item.id);
        saveWatchlist();
        return interaction.reply({
          content: `✅ Added **${item.name}** to watchlist.`,
          ephemeral: true,
        });
      }

      if (sub === 'remove') {
        const query = interaction.options.getString('item');
        const item = findItem(query);
        if (!item) {
          return interaction.reply({
            content: `❌ Item "${query}" not found.`,
            ephemeral: true,
          });
        }
        watchlist.delete(item.id);
        saveWatchlist();
        return interaction.reply({
          content: `✅ Removed **${item.name}** from watchlist.`,
          ephemeral: true,
        });
      }

      if (sub === 'view') {
        if (watchlist.size === 0) {
          return interaction.reply({
            content: '📋 Watchlist is empty. Monitoring **all items**.',
            ephemeral: true,
          });
        }

        const names = [...watchlist].map(
          (id) => itemMapping.get(id)?.name || `ID:${id}`,
        );
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('👁️ Watchlist')
              .setColor(CONFIG.brand.color)
              .setDescription(names.join(', '))
              .setFooter({
                text: `${watchlist.size} items | ${CONFIG.brand.name}`,
                iconURL: CONFIG.brand.icon,
              }),
          ],
        });
      }

      if (sub === 'clear') {
        const count = watchlist.size;
        watchlist.clear();
        saveWatchlist();
        return interaction.reply({
          content: `✅ Cleared ${count} items. Now monitoring **all items**.`,
          ephemeral: true,
        });
      }
    }

    // /price
    if (commandName === 'price') {
      const query = interaction.options.getString('item');
      const item = findItem(query);

      if (!item) {
        return interaction.reply({
          content: `❌ Item "${query}" not found.`,
          ephemeral: true,
        });
      }

      const prices = latestPrices.get(item.id);
      const { data5m, data1h } = await fetchAverages();
      const api5m = data5m?.[item.id];
      const api1h = data1h?.[item.id];

      if (!prices) {
        return interaction.reply({
          content: `❌ No price data for ${item.name}.`,
          ephemeral: true,
        });
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const priceAge = prices.lowTime ? nowSeconds - prices.lowTime : null;

      const totalVolume5m =
        (api5m?.highPriceVolume || 0) + (api5m?.lowPriceVolume || 0);
      const totalVolume1h =
        (api1h?.highPriceVolume || 0) + (api1h?.lowPriceVolume || 0);
      const expected5m = totalVolume1h / 12;
      const volumeSpike = expected5m > 0 ? totalVolume5m / expected5m : 0;

      const sellPressure =
        totalVolume5m > 0
          ? (api5m?.lowPriceVolume || 0) / totalVolume5m
          : 0.5;

      const priceDropPct = api5m?.avgHighPrice
        ? ((api5m.avgHighPrice - prices.low) / api5m.avgHighPrice) * 100
        : null;

      let netRoiPct = null;
      if (api5m?.avgHighPrice && prices.low) {
        const effectiveBuy = prices.low * 1.01;
        const effectiveSell = api5m.avgHighPrice * 0.99;
        const netProfit = effectiveSell - effectiveBuy;
        netRoiPct =
          effectiveBuy > 0 ? (netProfit / effectiveBuy) * 100 : null;
      }

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${item.name}`)
        .setColor(CONFIG.brand.color)
        .setThumbnail(
          `https://oldschool.runescape.wiki/images/${encodeURIComponent(
            item.icon || item.name.replace(/ /g, '_') + '.png',
          )}`,
        )
        .addFields(
          {
            name: '💰 Insta-Buy',
            value: formatGp(prices.high),
            inline: true,
          },
          {
            name: '💰 Insta-Sell',
            value: formatGp(prices.low),
            inline: true,
          },
          {
            name: '📋 GE Limit',
            value: item.limit ? item.limit.toLocaleString() : 'Unknown',
            inline: true,
          },
          {
            name: '🕒 5m bucket time',
            value: last5mTimestamp ? `<t:${last5mTimestamp}:T>` : 'Unknown',
            inline: true,
          },
          {
            name: '🕒 1h bucket time',
            value: last1hTimestamp ? `<t:${last1hTimestamp}:T>` : 'Unknown',
            inline: true,
          },
        );

      if (api5m?.avgHighPrice) {
        embed.addFields(
          {
            name: '📊 5m Avg Buy',
            value: formatGp(Math.round(api5m.avgHighPrice)),
            inline: true,
          },
          {
            name: '📉 Diff vs Avg',
            value:
              priceDropPct !== null
                ? `${priceDropPct.toFixed(1)}% below`
                : 'N/A',
            inline: true,
          },
          {
            name: '⏱️ Data Age',
            value: priceAge ? formatAge(priceAge) : 'Unknown',
            inline: true,
          },
        );
      }

      embed.addFields(
        {
          name: '📈 Volume 5m',
          value: formatVolume(totalVolume5m),
          inline: true,
        },
        {
          name: '🔄 Vol Spike',
          value: `${volumeSpike.toFixed(1)}x`,
          inline: true,
        },
        {
          name: '🔻 Sell Pressure',
          value: `${(sellPressure * 100).toFixed(0)}%`,
          inline: true,
        },
      );

      // Would this trigger under current rules?
      let wouldTrigger = false;
      let tierPreview = 'None';

      if (api5m?.avgHighPrice && priceDropPct !== null && netRoiPct !== null) {
        const sellersPct = sellPressure * 100;
        const geLimit = item.limit || 0;
        const tradeValue5m = prices.low * totalVolume5m;

        const effectiveBuy = prices.low * 1.01;
        const effectiveSell = api5m.avgHighPrice * 0.99;
        const netProfitPerItem = effectiveSell - effectiveBuy;
        const maxNetProfit = geLimit > 0 ? netProfitPerItem * geLimit : 0;

        const passesBase =
          totalVolume1h >= CONFIG.detection.minVolume1h &&
          priceAge < CONFIG.detection.maxDataAge &&
          totalVolume5m >= CONFIG.detection.minVolumeFor5m &&
          volumeSpike >= CONFIG.detection.volumeSpikeMultiplier &&
          sellPressure >= CONFIG.detection.minSellPressure &&
          priceDropPct >= CONFIG.detection.minPriceDrop &&
          netRoiPct >= 3.0 &&
          maxNetProfit >= 500000 &&
          tradeValue5m >= 1500000;

        if (passesBase) {
          if (
            priceDropPct >= 22 &&
            volumeSpike >= 3.0 &&
            sellersPct >= 90 &&
            netRoiPct >= 10
          ) {
            tierPreview = 'EXTREME DUMP';
          } else if (
            priceDropPct >= 12 &&
            volumeSpike >= 2.0 &&
            sellersPct >= 80 &&
            netRoiPct >= 7
          ) {
            tierPreview = 'MAJOR DUMP';
          } else if (
            priceDropPct >= 7 &&
            volumeSpike >= 1.8 &&
            sellersPct >= 70 &&
            netRoiPct >= 5
          ) {
            tierPreview = 'DUMP DETECTED';
          } else if (
            priceDropPct >= 4 &&
            volumeSpike >= 1.5 &&
            sellersPct >= 60 &&
            netRoiPct >= 4
          ) {
            tierPreview = 'OPPORTUNITY';
          }

          if (tierPreview !== 'None') {
            wouldTrigger = true;
          }
        }
      }

      embed.addFields({
        name: '🎯 Alert Status',
        value: wouldTrigger
          ? `✅ **Would trigger alert**\nTier: **${tierPreview}**`
          : [
              `❌ Would **not** trigger with current thresholds`,
              '',
              `• Drop vs avg: ${
                priceDropPct !== null
                  ? priceDropPct.toFixed(1) + '%'
                  : 'N/A'
              } (min ${CONFIG.detection.minPriceDrop}%)`,
              `• Vol spike: ${volumeSpike.toFixed(
                1,
              )}x (min ${CONFIG.detection.volumeSpikeMultiplier}x)`,
              `• Sellers: ${(sellPressure * 100).toFixed(0)}% (min ${(
                CONFIG.detection.minSellPressure * 100
              ).toFixed(0)}%)`,
              `• Net ROI: ${
                netRoiPct !== null ? netRoiPct.toFixed(1) + '%' : 'N/A'
              } (min 3%)`,
            ].join('\n'),
        inline: false,
      });

      embed.addFields({
        name: '🔗 Links',
        value: `[Wiki](https://oldschool.runescape.wiki/w/${encodeURIComponent(
          item.name,
        )}) | [Prices](https://prices.runescape.wiki/osrs/item/${item.id})`,
        inline: false,
      });

      embed
        .setFooter({
          text: CONFIG.brand.name,
          iconURL: CONFIG.brand.icon,
        })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // /help
    if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('🌋 The Crater v2.0 - Dump Detector')
        .setColor(CONFIG.brand.color)
        .setDescription(
          'Detects active dumps in the GE using volume spikes and sell pressure.',
        )
        .addFields(
          {
            name: '🎯 How It Works',
            value: [
              '**Step 1 – Base sanity checks**',
              `• 1h volume ≥ **${CONFIG.detection.minVolume1h.toLocaleString()}** trades`,
              `• Last trade < **${CONFIG.detection.maxDataAge}s** ago`,
              '',
              '**Step 2 – Dump signature**',
              `• 5m volume spike ≥ **${CONFIG.detection.volumeSpikeMultiplier}x** expected (vs 1h)`,
              `• Sell pressure ≥ **${(
                CONFIG.detection.minSellPressure * 100
              ).toFixed(0)}%** of trades`,
              `• Buy-in price at least **${CONFIG.detection.minPriceDrop}%** below 5m average`,
              '',
              '**Step 3 – Net profit + size filter**',
              '• Net ROI ≥ **3%** after 1% slippage and 1% GE tax',
              '• Max net profit at GE limit ≥ **500k gp**',
              '• At least **1.5m gp** transacted in last 5 minutes',
              '',
              '**Step 4 – Tiered alert**',
              'Depending on drop %, volume spike, sell pressure and net ROI, alerts are tagged as:',
              '• 💀 EXTREME DUMP',
              '• 🔴 MAJOR DUMP',
              '• 🟠 DUMP DETECTED',
              '• ⚠️ OPPORTUNITY',
            ].join('\n'),
            inline: false,
          },
          {
            name: '💀 1GP Dumps',
            value:
              `ALL 1GP dumps with typical price ≥ **${CONFIG.detection.oneGpMinAvgPrice} gp** are shown regardless of profit thresholds.\n` +
              'These mean someone just sold items at 1gp - often by accident or manipulation.',
            inline: false,
          },
          {
            name: '📊 What We Show',
            value:
              '• **Real data only**: Prices, volumes, timestamps from the API\n' +
              "• **No guesswork**: We don't pretend to know how many items you&apos;ll get\n" +
              '• **Max profit**: Theoretical maximum at GE limit (not a promise)',
            inline: false,
          },
          {
            name: '⚡ Commands',
            value:
              '`/alerts setup` - Enable alerts in this channel\n' +
              '`/alerts config` - Adjust detection thresholds\n' +
              '`/watchlist add/remove/view` - Monitor specific items only\n' +
              '`/price <item>` - Check item with full market data',
            inline: false,
          },
        )
        .setFooter({
          text: CONFIG.brand.name,
          iconURL: CONFIG.brand.icon,
        });

      return interaction.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const reply = { content: '❌ An error occurred.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK SERVER
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.json({
    name: 'The Crater v2.0',
    status: 'operational',
    servers: client.guilds?.cache.size || 0,
    itemsTracked: latestPrices.size,
    watchlistSize: watchlist.size,
    detection: {
      volumeSpike: CONFIG.detection.volumeSpikeMultiplier,
      sellPressure: CONFIG.detection.minSellPressure,
      priceDrop: CONFIG.detection.minPriceDrop,
    },
  });
});

app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () =>
  console.log(`🌐 Health server on port ${PORT}`),
);

// ═══════════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════════

client.login(process.env.TOKEN);
