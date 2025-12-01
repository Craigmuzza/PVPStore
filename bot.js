// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER - GE DUMP DETECTOR v2.0
// ═══════════════════════════════════════════════════════════════════════════════
// Reworked detection logic:
// - Volume spike as PRIMARY trigger (something unusual is happening)
// - Sell pressure confirmation (more sellers than buyers = dump)
// - Price suppression (current price below averages)
// - Fresh data requirement (stale data = stale opportunity)
// - ALL 1gp dumps shown regardless of other factors
// ═══════════════════════════════════════════════════════════════════════════════

import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } from 'discord.js';
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
    scanInterval: 2000,  // 2 seconds between scans
  },

  detection: {
    // ────────────────────────────────────────────────────────────
    // VOLUME SPIKE - Primary trigger
    // ────────────────────────────────────────────────────────────
    volumeSpikeMultiplier: 1.7,    // was 2.0
    minVolumeFor5m: 8,            // was 5

    // NEW: require decent 1h volume so weird tiny trades don't spam
    minVolume1h: 350,              // ignore items with <500 trades in last hour

    // ────────────────────────────────────────────────────────────
    // SELL PRESSURE
    // ────────────────────────────────────────────────────────────
    minSellPressure: 0.52,         // was 0.55

    // ────────────────────────────────────────────────────────────
    // PRICE DROP
    // ────────────────────────────────────────────────────────────
    minPriceDrop: -3,              // was -3

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
    minMaxProfit: 300000,          // was 325k – now skewed to more meaningful flips
    minProfitPerItem: 3000,        // was 2.5k
    minMaxProfitForMargin: 225000, // was 200k
    minPrice: 100,
    minProfitPerItemFloor: 100,    // was 50

    // ────────────────────────────────────────────────────────────
    // 1GP DUMPS
    // ────────────────────────────────────────────────────────────
    oneGpAlerts: true,
    oneGpMinAvgPrice: 10,        // was 500 – 1gp on real items only
    oneGpMaxAge: 60,
    oneGpCooldown: 600000,

    // ────────────────────────────────────────────────────────────
    // GENERAL COOLDOWN
    // ────────────────────────────────────────────────────────────
    cooldown: 300000,

    // NEW: limit alerts per scan
    maxAlertsPerScan: 15,          // keep the best 15 per 5s scan
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// DATA STORAGE
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

async function fetchAverages() {
  // Fetch both 5m and 1h data, but don't spam the API
  if (Date.now() - lastAvgFetch < 30000 && cached5mData && cached1hData) {
    return { data5m: cached5mData, data1h: cached1hData };
  }

  const [resp5m, resp1h] = await Promise.all([
    fetchApi('/5m'),
    fetchApi('/1h'),
  ]);

  if (resp5m?.data) cached5mData = resp5m.data;
  if (resp1h?.data) cached1hData = resp1h.data;
  lastAvgFetch = Date.now();

  return { data5m: cached5mData, data1h: cached1hData };
}

function findItem(query) {
  const lower = query.toLowerCase().trim();

  // Exact match first
  if (itemNameLookup.has(lower)) {
    return itemMapping.get(itemNameLookup.get(lower));
  }

  // Partial match
  for (const [name, id] of itemNameLookup) {
    if (name.includes(lower)) return itemMapping.get(id);
  }

  // Try item ID
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

  // Prices and profits from the API can be floats (averages),
  // but in-game they are integers, so we round to the nearest gp.
  const value = Math.round(num);
  return `${value.toLocaleString()} gp`;
}

function formatPercent(num) {
  if (num === null || num === undefined) return 'N/A';
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
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

// NEW: format Unix seconds into Discord timestamp (HH:MM:SS in user’s local time)
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
    buyPrice,           // What you can buy at (current low)
    sellTarget,         // What you can sell at (5m avg high)
    profitPerItem,
    maxProfit,          // Theoretical max at GE limit
    dropPercent,
    volumeSpike,
    sellPressure,
    totalVolume5m,
    totalVolume1h,
    priceAge,
    highAlch,
    alchProfit,
    tradeTime,
    alertTime,
  } = alert;

  // Determine severity based on price drop
  let color, emoji, tier;
  const drop = Math.abs(dropPercent);

  if (drop >= 25) {
    color = 0x9b59b6; emoji = '💀'; tier = 'EXTREME DUMP';
  } else if (drop >= 12) {
    color = 0xff3860; emoji = '🔴'; tier = 'MAJOR DUMP';
  } else if (drop >= 6) {
    color = 0xff6b35; emoji = '🟠'; tier = 'DUMP DETECTED';
  } else {
    color = 0xffdd57; emoji = '⚠️'; tier = 'OPPORTUNITY';
  }

  // Volume spike indicator
  const spikeEmoji = volumeSpike >= 5 ? '🚨' : volumeSpike >= 3 ? '📊' : '📈';

  // Sell pressure indicator
  const pressureEmoji = sellPressure >= 0.7 ? '🔻' : sellPressure >= 0.6 ? '↘️' : '➡️';

  const tradeTimeStr = formatTime(tradeTime);
  const alertTimeStr = formatTime(alertTime);

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${tier}: ${item.name}`)
    .setColor(color)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon || item.name.replace(/ /g, '_') + '.png')}`)
    .setDescription(
      `**${formatPercent(dropPercent)}** below average • ${spikeEmoji} **${volumeSpike.toFixed(1)}x** volume spike\n` +
      `🕒 Trade: ${tradeTimeStr} • Alert: ${alertTimeStr}`
    );

  // Prices
  embed.addFields(
    { name: '🛒 BUY NOW', value: `**${formatGp(buyPrice)}**`, inline: true },
    { name: '💰 SELL TARGET', value: formatGp(sellTarget), inline: true },
    { name: '📋 GE Limit', value: `${item.limit?.toLocaleString() || '?'}`, inline: true },
  );

  // Profit potential (informational, not predictive)
  embed.addFields({
    name: '💎 POTENTIAL',
    value: [
      `Per item: **${formatGp(profitPerItem)}**`,
      `ROI: **${((profitPerItem / buyPrice) * 100).toFixed(1)}%**`,
      `Max @ limit: ${formatGp(maxProfit)}`,
      alchProfit > 0 ? `⚗️ Alch profit: ${formatGp(alchProfit)}` : null,
    ].filter(Boolean).join('\n'),
    inline: true,
  });

  // Market activity (what we actually know)
  embed.addFields({
    name: `${pressureEmoji} ACTIVITY`,
    value: [
      `Dumped 5m: **${formatVolume(totalVolume5m)}**`,
      `Dumped 1h: ${formatVolume(totalVolume1h)}`,
      `Sellers: **${(sellPressure * 100).toFixed(0)}%**`,
      // Age kept internal for logic; no longer shown as "34s ago"
    ].join('\n'),
    inline: true,
  });

  // What triggered this alert
  embed.addFields({
    name: '🎯 TRIGGER',
    value: [
      `Volume: ${volumeSpike.toFixed(1)}x expected`,
      `Drop: ${formatPercent(dropPercent)}`,
      `Sellers: ${(sellPressure * 100).toFixed(0)}%`,
    ].join('\n'),
    inline: true,
  });

  // Links
  embed.addFields({
    name: '🔗 Links',
    value: `[Wiki](https://oldschool.runescape.wiki/w/${encodeURIComponent(item.name)}) | [Prices](https://prices.runescape.wiki/osrs/item/${item.id})`,
    inline: false,
  });

  embed.setFooter({ text: `${CONFIG.brand.name} • Real data only`, iconURL: CONFIG.brand.icon })
    .setTimestamp();

  return embed;
}

function build1gpEmbed(alert) {
  const {
    item,
    avgPrice,           // What it normally trades for
    profitPerItem,      // avgPrice - 1
    maxProfit,          // profitPerItem × GE limit
    totalVolume5m,
    sellPressure,
    priceAge,
    highAlch,
    alchProfit,
    tradeTime,
    alertTime,
  } = alert;

  // 1gp dumps are always purple/skull - they're the holy grail
  let emoji = '💀';
  let color = 0x9b59b6;

  if (maxProfit >= 1000000) {
    emoji = '💎💀';
  } else if (maxProfit >= 500000) {
    emoji = '🔥💀';
  }

  const tradeTimeStr = formatTime(tradeTime);
  const alertTimeStr = formatTime(alertTime);

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} 1GP DUMP: ${item.name}`)
    .setColor(color)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon || item.name.replace(/ /g, '_') + '.png')}`)
	.setDescription(
	  avgPrice
		? `Someone just sold for **1 GP** • Normal price: **${formatGp(avgPrice)}**`
		: `Someone just sold for **1 GP**`
	);


  // The opportunity
  embed.addFields(
    { name: '🛒 BUY NOW', value: '**1 GP**', inline: true },
    { name: '💰 SELL FOR', value: `**${formatGp(avgPrice)}**`, inline: true },
    { name: '📋 GE Limit', value: `${item.limit?.toLocaleString() || '?'}`, inline: true },
  );

  // Profit
  embed.addFields({
    name: '💎 POTENTIAL',
    value: [
      `Per item: **${formatGp(profitPerItem)}**`,
      `ROI: **${((profitPerItem) * 100).toFixed(0)}%** (yes, really)`,
      `Max @ limit: **${formatGp(maxProfit)}**`,
      alchProfit > 0 ? `⚗️ Alch profit: ${formatGp(alchProfit)}` : null,
    ].filter(Boolean).join('\n'),
    inline: true,
  });

  // Market context
  embed.addFields({
    name: '📊 MARKET',
    value: [
      `Vol 5m: ${formatVolume(totalVolume5m)}`,
      `Sell pressure: ${(sellPressure * 100).toFixed(0)}%`,
      // Previously: Data age: 34s ago – now replaced by explicit times above
    ].join('\n'),
    inline: true,
  });

  // Freshness line now references exact times rather than "34s ago"
  embed.addFields({
    name: '⚡ FRESH',
    value: `Detected at ${alertTimeStr} (trade at ${tradeTimeStr}).`,
    inline: false,
  });

  // Links
  embed.addFields({
    name: '🔗 Links',
    value: `[Wiki](https://oldschool.runescape.wiki/w/${encodeURIComponent(item.name)}) | [Prices](https://prices.runescape.wiki/osrs/item/${item.id})`,
    inline: false,
  });

  embed.setFooter({ text: `${CONFIG.brand.name} • Fresh 1GP dumps only`, iconURL: CONFIG.brand.icon })
    .setTimestamp();

  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DUMP DETECTION LOGIC v2.0
// ═══════════════════════════════════════════════════════════════════════════════

function scoreAlert(alert) {
  if (alert.type === '1GP') {
    // Always top priority – we still also enforce a cooldown
    return 1e9;
  }

  const drop = Math.abs(alert.dropPercent || 0);         // % below avg
  const vol  = Math.min(alert.volumeSpike || 0, 10);     // cap to avoid silly scores
  const pressure = (alert.sellPressure || 0.5) - 0.55;   // 0 at ~threshold
  const maxProfit = alert.maxProfit || 0;

  const profitScore  = maxProfit > 0 ? Math.log10(maxProfit) * 4 : 0;
  const dropScore    = drop * 1.5;
  const volumeScore  = vol * 2;
  const pressureScore = Math.max(pressure, 0) * 20;

  return dropScore + volumeScore + pressureScore + profitScore;
}

async function scanForDumps() {
  const alerts = [];
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);

  // Fetch current averages
  const { data5m, data1h } = await fetchAverages();
  if (!data5m || !data1h) {
    console.warn('⚠️ Could not fetch average data');
    return alerts;
  }

  const itemsToScan = watchlist.size > 0 ? [...watchlist] : [...latestPrices.keys()];

  for (const itemId of itemsToScan) {
    const item = itemMapping.get(itemId);
    const prices = latestPrices.get(itemId);
    if (!item || !prices) continue;

    // ═══════════════════════════════════════════════════════════════
    // EXTRACT RAW DATA
    // ═══════════════════════════════════════════════════════════════

    // Static item data
    const geLimit = item.limit || 0;
    const highAlch = item.highalch || 0;

    // Latest prices (real-time)
    const instaBuyPrice = prices.high;      // Last insta-buy price
    const instaSellPrice = prices.low;      // Last insta-sell price (our buy-in)
    const instaBuyTime = prices.highTime;   // When
    const instaSellTime = prices.lowTime;   // When

    // 5-minute averages
    const api5m = data5m[itemId];
    const avg5mHigh = api5m?.avgHighPrice || null;    // Avg insta-buy (our sell target)
    const avg5mLow = api5m?.avgLowPrice || null;      // Avg insta-sell
    const buyVolume5m = api5m?.highPriceVolume || 0;  // Insta-buys in 5m
    const sellVolume5m = api5m?.lowPriceVolume || 0;  // Insta-sells in 5m
    const totalVolume5m = buyVolume5m + sellVolume5m;

    // 1-hour averages
    const api1h = data1h[itemId];
    const avg1hHigh = api1h?.avgHighPrice || null;
    const avg1hLow = api1h?.avgLowPrice || null;
    const buyVolume1h = api1h?.highPriceVolume || 0;
    const sellVolume1h = api1h?.lowPriceVolume || 0;
    const totalVolume1h = buyVolume1h + sellVolume1h;

    // Ignore thinly traded items – 1 weird trade should not be an "opportunity"
    if (totalVolume1h < CONFIG.detection.minVolume1h) {
      continue;
    }

    // ═══════════════════════════════════════════════════════════════
    // CALCULATE METRICS
    // ═══════════════════════════════════════════════════════════════

    // Data freshness
    const priceAge = instaSellTime ? (nowSeconds - instaSellTime) : Infinity;
    const isFresh = priceAge < CONFIG.detection.maxDataAge;

    // Volume spike: is 5m volume higher than expected?
    // Expected = 1h volume ÷ 12 (since 5m is 1/12th of an hour)
    const expected5mVolume = totalVolume1h / 12;
    const volumeSpike = expected5mVolume > 0 ? totalVolume5m / expected5mVolume : 0;

    // Sell pressure: what % of trades are sells?
    const sellPressure = totalVolume5m > 0 ? sellVolume5m / totalVolume5m : 0.5;

    // The key prices for profit calculation
    const buyPrice = instaSellPrice;        // What we can buy at NOW
    const sellTarget = avg5mHigh;           // What we can likely sell for

    // Alch calculation
    const alchProfit = highAlch - buyPrice - 135;  // 135 ≈ nature rune

    // For timing – prefer the sell timestamp for buy-in, fall back to buyTime/now
    const tradeTime = instaSellTime || instaBuyTime || nowSeconds;
    const alertTime = nowSeconds;

	// ═══════════════════════════════════════════════════════════════
	// 1GP DUMP DETECTION - ALL 1GP SALES, PRICE-AGNOSTIC
	// ═══════════════════════════════════════════════════════════════

	if (CONFIG.detection.oneGpAlerts && buyPrice === 1) {
	  // Normal price if we can find one; may be null on weird items
	  const avgPrice = avg5mHigh ?? avg1hHigh ?? instaBuyPrice ?? null;

	  // Still require freshness so we don't alert on ancient 1gp trades
	  const is1gpFresh = priceAge < CONFIG.detection.oneGpMaxAge;

	  if (is1gpFresh) {
		// Per-item profit only if we know a normal price
		const profitPerItem = avgPrice ? (avgPrice - 1) : 0;
		const maxProfit = profitPerItem * (geLimit || 1);

		// Cooldown per item so the same thing doesn't spam every tick
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
			alchProfit: highAlch ? (highAlch - 1 - 135) : 0,
		  });

		  oneGpCooldowns.set(itemId, now);
		  console.log(
			`💀 1GP dump: ${item.name} (${avgPrice ? 'avg ' + formatGp(avgPrice) : 'no avg'}, ${Math.floor(priceAge)}s ago)`
		  );
		}
	  }

	  // Never also treat a 1gp sale as a regular dump
	  continue;
	}


    // ═══════════════════════════════════════════════════════════════
    // REGULAR DUMP DETECTION
    // ═══════════════════════════════════════════════════════════════

    // Skip if we don't have the data we need
    if (!buyPrice || !sellTarget || !geLimit) continue;

    // Skip junk items
    if (buyPrice < CONFIG.detection.minPrice && sellTarget < CONFIG.detection.minPrice) continue;

    // Skip stale data
    if (!isFresh) continue;

    // Skip if no meaningful volume
    if (totalVolume5m < CONFIG.detection.minVolumeFor5m) continue;

    // Calculate price drop (negative = below average = opportunity)
    const dropPercent = ((buyPrice - sellTarget) / sellTarget) * 100;

    // ═══════════════════════════════════════════════════════════════
    // THE THREE TRIGGERS (all must be met)
    // ═══════════════════════════════════════════════════════════════

    const hasVolumeSpike = volumeSpike >= CONFIG.detection.volumeSpikeMultiplier;
    const hasSellPressure = sellPressure >= CONFIG.detection.minSellPressure;
    const hasPriceDrop = dropPercent <= CONFIG.detection.minPriceDrop;

    if (hasVolumeSpike && hasSellPressure && hasPriceDrop) {
      // Check cooldown
      const lastAlert = alertCooldowns.get(itemId);
      if (lastAlert && now - lastAlert < CONFIG.detection.cooldown) continue;

      const profitPerItem = sellTarget - buyPrice;
      const maxProfit = profitPerItem * geLimit;

      // PROFIT FILTER
      if (profitPerItem < CONFIG.detection.minProfitPerItemFloor) {
        continue;
      }

      const meetsMaxProfit = maxProfit >= CONFIG.detection.minMaxProfit;
      const meetsMarginCombo = profitPerItem >= CONFIG.detection.minProfitPerItem
        && maxProfit >= CONFIG.detection.minMaxProfitForMargin;

      if (!meetsMaxProfit && !meetsMarginCombo) {
        continue;
      }

      alerts.push({
        type: 'DUMP',
        item,
        buyPrice,
        sellTarget,
        profitPerItem,
        maxProfit,
        dropPercent,
        volumeSpike,
        sellPressure,
        totalVolume5m,
        totalVolume1h,
        priceAge,
        highAlch,
        alchProfit,
        tradeTime,
        alertTime,
      });

      alertCooldowns.set(itemId, now);
      console.log(`📉 Dump detected: ${item.name} (${formatPercent(dropPercent)}, ${volumeSpike.toFixed(1)}x vol, ${formatGp(maxProfit)} max, tradeTime: ${tradeTime}, alertTime: ${alertTime})`);
    }
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
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Enable dump alerts in this channel'))
    .addSubcommand(sub => sub
      .setName('stop')
      .setDescription('Disable dump alerts'))
    .addSubcommand(sub => sub
      .setName('config')
      .setDescription('Configure detection thresholds')
      .addNumberOption(opt => opt
        .setName('volume_spike')
        .setDescription('Volume spike multiplier (default: 2.0)'))
      .addNumberOption(opt => opt
        .setName('sell_pressure')
        .setDescription('Min sell pressure % (default: 55)'))
      .addNumberOption(opt => opt
        .setName('price_drop')
        .setDescription('Min price drop % (default: -4)'))
      .addIntegerOption(opt => opt
        .setName('cooldown')
        .setDescription('Minutes between alerts for same item (default: 5)')))
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Show current configuration')),

  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage item watchlist')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add item to watchlist')
      .addStringOption(opt => opt
        .setName('item')
        .setDescription('Item name or ID')
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove item from watchlist')
      .addStringOption(opt => opt
        .setName('item')
        .setDescription('Item name or ID')
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('View current watchlist'))
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear watchlist (monitor all items)')),

  new SlashCommandBuilder()
    .setName('price')
    .setDescription('Check current price and market data')
    .addStringOption(opt => opt
      .setName('item')
      .setDescription('Item name or ID')
      .setRequired(true)
      .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help and detection logic'),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    console.log('🔄 Registering commands...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.toJSON()) });
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

    // Always keep all 1gp alerts (already cooldown-limited)
    const oneGpAlerts = alerts.filter(a => a.type === '1GP');
    const dumpAlerts  = alerts.filter(a => a.type === 'DUMP');

    // Score and keep only the best DUMP alerts for this scan
    dumpAlerts.sort((a, b) => scoreAlert(b) - scoreAlert(a));
    const topDumps = dumpAlerts.slice(0, CONFIG.detection.maxAlertsPerScan);

    alerts = [...oneGpAlerts, ...topDumps];

    console.log(`🔔 ${alerts.length} alerts selected from ${oneGpAlerts.length + dumpAlerts.length} candidates`);

    for (const [guildId, config] of Object.entries(serverConfigs)) {
      if (!config.enabled || !config.channelId) continue;

      const channel = client.channels.cache.get(config.channelId);
      if (!channel) continue;

      for (const alert of alerts) {
        try {
          const embed = alert.type === '1GP'
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

  // Start scanning
  setInterval(runAlertLoop, CONFIG.api.scanInterval);
  console.log(`🔍 Scanning every ${CONFIG.api.scanInterval / 1000}s`);
  console.log(`📊 Detection: ${CONFIG.detection.volumeSpikeMultiplier}x volume, ${CONFIG.detection.minSellPressure * 100}% sell pressure, ${CONFIG.detection.minPriceDrop}% drop`);
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
          embeds: [new EmbedBuilder()
            .setTitle('🌋 The Crater Activated')
            .setColor(CONFIG.brand.color)
            .setDescription(`Dump alerts will be posted to <#${interaction.channelId}>`)
            .addFields(
              { name: '🎯 Detection Logic', value:
                `• Volume spike: **${CONFIG.detection.volumeSpikeMultiplier}x** expected\n` +
                `• Sell pressure: **>${CONFIG.detection.minSellPressure * 100}%**\n` +
                `• Price drop: **${CONFIG.detection.minPriceDrop}%** below avg\n` +
                `• All 1GP dumps: **Always shown**`,
                inline: false },
              { name: '💰 Profit Filter', value:
                `Must meet ONE of:\n` +
                `• Max profit ≥ **${formatGp(CONFIG.detection.minMaxProfit)}**, OR\n` +
                `• Profit/item ≥ **${formatGp(CONFIG.detection.minProfitPerItem)}** + max ≥ **${formatGp(CONFIG.detection.minMaxProfitForMargin)}**`,
                inline: false },
            )
            .setFooter({ text: CONFIG.brand.name, iconURL: CONFIG.brand.icon })]
        });
      }

      if (sub === 'stop') {
        if (serverConfigs[guildId]) {
          serverConfigs[guildId].enabled = false;
          saveConfig();
        }
        return interaction.reply({ content: '✅ Alerts disabled.', ephemeral: true });
      }

      if (sub === 'config') {
        const config = serverConfigs[guildId] || {};

        const volumeSpike = interaction.options.getNumber('volume_spike');
        const sellPressure = interaction.options.getNumber('sell_pressure');
        const priceDrop = interaction.options.getNumber('price_drop');
        const cooldown = interaction.options.getInteger('cooldown');

        // Update per-guild stored config
        if (volumeSpike !== null) config.volumeSpikeMultiplier = volumeSpike;
        if (sellPressure !== null) config.minSellPressure = sellPressure / 100;
        if (priceDrop !== null) config.minPriceDrop = priceDrop;
        if (cooldown !== null) config.cooldown = cooldown * 60 * 1000;

        serverConfigs[guildId] = { ...serverConfigs[guildId], ...config };
        saveConfig();

        // ALSO update the global detection config actually used by scanForDumps
        if (volumeSpike !== null) CONFIG.detection.volumeSpikeMultiplier = volumeSpike;
        if (sellPressure !== null) CONFIG.detection.minSellPressure = sellPressure / 100;
        if (priceDrop !== null) CONFIG.detection.minPriceDrop = priceDrop;
        if (cooldown !== null) CONFIG.detection.cooldown = cooldown * 60 * 1000;

        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setTitle('⚙️ Configuration Updated')
            .setColor(0x3298dc)
            .addFields(
              { name: '📊 Volume Spike', value: `${config.volumeSpikeMultiplier ?? CONFIG.detection.volumeSpikeMultiplier}x`, inline: true },
              { name: '🔻 Sell Pressure', value: `${((config.minSellPressure ?? CONFIG.detection.minSellPressure) * 100).toFixed(0)}%`, inline: true },
              { name: '📉 Price Drop', value: `${config.minPriceDrop ?? CONFIG.detection.minPriceDrop}%`, inline: true },
              { name: '⏱️ Cooldown', value: `${(config.cooldown ?? CONFIG.detection.cooldown) / 60000} mins`, inline: true },
            )
            .setFooter({ text: CONFIG.brand.name, iconURL: CONFIG.brand.icon })]
        });
      }

      if (sub === 'status') {
        const config = serverConfigs[guildId];

        if (!config || !config.enabled) {
          return interaction.reply({ content: '❌ Alerts not configured. Use `/alerts setup` first.', ephemeral: true });
        }

        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setTitle('📊 Alert Status')
            .setColor(CONFIG.brand.color)
            .addFields(
              { name: 'Status', value: '🟢 Active', inline: true },
              { name: 'Channel', value: `<#${config.channelId}>`, inline: true },
              { name: 'Watchlist', value: watchlist.size > 0 ? `${watchlist.size} items` : 'All items', inline: true },
              { name: 'Detection', value:
                `Vol: ${config.volumeSpikeMultiplier ?? CONFIG.detection.volumeSpikeMultiplier}x\n` +
                `Sell: ${((config.minSellPressure ?? CONFIG.detection.minSellPressure) * 100).toFixed(0)}%\n` +
                `Drop: ${config.minPriceDrop ?? CONFIG.detection.minPriceDrop}%`,
                inline: true },
            )
            .setFooter({ text: CONFIG.brand.name, iconURL: CONFIG.brand.icon })]
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
          return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });
        }
        watchlist.add(item.id);
        saveWatchlist();
        return interaction.reply({ content: `✅ Added **${item.name}** to watchlist.`, ephemeral: true });
      }

      if (sub === 'remove') {
        const query = interaction.options.getString('item');
        const item = findItem(query);
        if (!item) {
          return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });
        }
        watchlist.delete(item.id);
        saveWatchlist();
        return interaction.reply({ content: `✅ Removed **${item.name}** from watchlist.`, ephemeral: true });
      }

      if (sub === 'view') {
        if (watchlist.size === 0) {
          return interaction.reply({ content: '📋 Watchlist is empty. Monitoring **all items**.', ephemeral: true });
        }

        const names = [...watchlist].map(id => itemMapping.get(id)?.name || `ID:${id}`);
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setTitle('👁️ Watchlist')
            .setColor(CONFIG.brand.color)
            .setDescription(names.join(', '))
            .setFooter({ text: `${watchlist.size} items | ${CONFIG.brand.name}`, iconURL: CONFIG.brand.icon })]
        });
      }

      if (sub === 'clear') {
        const count = watchlist.size;
        watchlist.clear();
        saveWatchlist();
        return interaction.reply({ content: `✅ Cleared ${count} items. Now monitoring **all items**.`, ephemeral: true });
      }
    }

    // /price
    if (commandName === 'price') {
      const query = interaction.options.getString('item');
      const item = findItem(query);

      if (!item) {
        return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });
      }

      const prices = latestPrices.get(item.id);
      const { data5m, data1h } = await fetchAverages();
      const api5m = data5m?.[item.id];
      const api1h = data1h?.[item.id];

      if (!prices) {
        return interaction.reply({ content: `❌ No price data for ${item.name}.`, ephemeral: true });
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const priceAge = prices.lowTime ? (nowSeconds - prices.lowTime) : null;

      // Calculate volume spike
      const totalVolume5m = (api5m?.highPriceVolume || 0) + (api5m?.lowPriceVolume || 0);
      const totalVolume1h = (api1h?.highPriceVolume || 0) + (api1h?.lowPriceVolume || 0);
      const expected5m = totalVolume1h / 12;
      const volumeSpike = expected5m > 0 ? totalVolume5m / expected5m : 0;

      // Calculate sell pressure
      const sellPressure = totalVolume5m > 0
        ? (api5m?.lowPriceVolume || 0) / totalVolume5m
        : 0.5;

      // Price vs average
      const dropVs5m = api5m?.avgHighPrice
        ? ((prices.low - api5m.avgHighPrice) / api5m.avgHighPrice) * 100
        : null;

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${item.name}`)
        .setColor(CONFIG.brand.color)
        .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon || item.name.replace(/ /g, '_') + '.png')}`)
        .addFields(
          { name: '💰 Insta-Buy', value: formatGp(prices.high), inline: true },
          { name: '💰 Insta-Sell', value: formatGp(prices.low), inline: true },
          { name: '📋 GE Limit', value: item.limit ? item.limit.toLocaleString() : 'Unknown', inline: true },
        );

      if (api5m?.avgHighPrice) {
        embed.addFields(
          { name: '📊 5m Avg Buy', value: formatGp(Math.round(api5m.avgHighPrice)), inline: true },
          { name: '📉 Diff vs Avg', value: formatPercent(dropVs5m), inline: true },
          { name: '⏱️ Data Age', value: priceAge ? formatAge(priceAge) : 'Unknown', inline: true },
        );
      }

      embed.addFields(
        { name: '📈 Volume 5m', value: formatVolume(totalVolume5m), inline: true },
        { name: '🔄 Vol Spike', value: `${volumeSpike.toFixed(1)}x`, inline: true },
        { name: '🔻 Sell Pressure', value: `${(sellPressure * 100).toFixed(0)}%`, inline: true },
      );

      // Would this trigger an alert?
      const wouldTrigger =
        volumeSpike >= CONFIG.detection.volumeSpikeMultiplier &&
        sellPressure >= CONFIG.detection.minSellPressure &&
        (dropVs5m !== null && dropVs5m <= CONFIG.detection.minPriceDrop);

      embed.addFields({
        name: '🎯 Alert Status',
        value: wouldTrigger
          ? '✅ **Would trigger alert** (all conditions met)'
          : [
              volumeSpike < CONFIG.detection.volumeSpikeMultiplier ? `❌ Volume spike too low (${volumeSpike.toFixed(1)}x < ${CONFIG.detection.volumeSpikeMultiplier}x)` : `✅ Volume spike OK`,
              sellPressure < CONFIG.detection.minSellPressure ? `❌ Sell pressure too low (${(sellPressure*100).toFixed(0)}% < ${CONFIG.detection.minSellPressure*100}%)` : `✅ Sell pressure OK`,
              dropVs5m === null ? '❓ No avg data' : (dropVs5m > CONFIG.detection.minPriceDrop ? `❌ Not enough drop (${formatPercent(dropVs5m)} > ${CONFIG.detection.minPriceDrop}%)` : `✅ Price drop OK`),
            ].join('\n'),
        inline: false,
      });

      embed.addFields(
        { name: '🔗 Links', value: `[Wiki](https://oldschool.runescape.wiki/w/${encodeURIComponent(item.name)}) | [Prices](https://prices.runescape.wiki/osrs/item/${item.id})`, inline: false }
      );

      embed.setFooter({ text: CONFIG.brand.name, iconURL: CONFIG.brand.icon })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // /help
    if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('🌋 The Crater v2.0 - Dump Detector')
        .setColor(CONFIG.brand.color)
        .setDescription('Detects active dumps in the GE using volume spikes and sell pressure.')
        .addFields(
          { name: '🎯 How It Works', value:
            'The bot triggers when ALL THREE conditions are met:\n' +
            `• **Volume spike**: 5m trading volume is **${CONFIG.detection.volumeSpikeMultiplier}x** higher than expected (based on 1h average)\n` +
            `• **Sell pressure**: More than **${CONFIG.detection.minSellPressure * 100}%** of trades are sells\n` +
            `• **Price drop**: Current buy-in is **${CONFIG.detection.minPriceDrop}%** below 5m average`,
            inline: false },
          { name: '💰 Profit Filter', value:
            'Plus, must meet at least ONE of:\n' +
            `• **Max profit** ≥ ${formatGp(CONFIG.detection.minMaxProfit)} (at GE limit)\n` +
            `• **Profit/item** ≥ ${formatGp(CONFIG.detection.minProfitPerItem)} AND max ≥ ${formatGp(CONFIG.detection.minMaxProfitForMargin)}\n\n` +
            'This filters noise while catching both high-volume and high-value opportunities.',
            inline: false },
          { name: '💀 1GP Dumps', value:
            'ALL 1GP dumps are shown regardless of profit thresholds.\n' +
            'These mean someone just sold items at 1gp - often by accident or manipulation.',
            inline: false },
          { name: '📊 What We Show', value:
            '• **Real data only**: Prices, volumes, timestamps from the API\n' +
            '• **No guesswork**: We don\'t pretend to know how many items you\'ll get\n' +
            '• **Max profit**: Theoretical maximum at GE limit (not a promise)',
            inline: false },
          { name: '⚡ Commands', value:
            '`/alerts setup` - Enable alerts in this channel\n' +
            '`/alerts config` - Adjust detection thresholds\n' +
            '`/watchlist add/remove/view` - Monitor specific items only\n' +
            '`/price <item>` - Check item with full market data',
            inline: false },
        )
        .setFooter({ text: CONFIG.brand.name, iconURL: CONFIG.brand.icon });

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

app.listen(PORT, () => console.log(`🌐 Health server on port ${PORT}`));

// ═══════════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════════

client.login(process.env.TOKEN);