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
    scanInterval: 30000,  // 30 seconds between scans
  },

  detection: {
    // ═══════════════════════════════════════════════════════════════
    // VOLUME SPIKE - Primary trigger
    // ═══════════════════════════════════════════════════════════════
    // Expected 5m volume = 1h volume ÷ 12
    // Spike = actual 5m volume significantly exceeds expected
    volumeSpikeMultiplier: 2.0,     // 2x expected volume = something's happening
    minVolumeFor5m: 5,              // Need at least 5 trades in 5m to register
    
    // ═══════════════════════════════════════════════════════════════
    // SELL PRESSURE - Confirms it's a dump, not a pump
    // ═══════════════════════════════════════════════════════════════
    // sellPressure = lowPriceVolume / totalVolume (insta-sells vs total)
    // High sell pressure = people dumping
    minSellPressure: 0.55,          // >55% of trades are sells = dump signal
    
    // ═══════════════════════════════════════════════════════════════
    // PRICE DROP - The opportunity
    // ═══════════════════════════════════════════════════════════════
    // How much below average is the current buy-in price?
    minPriceDrop: -3,               // At least 3% below 5m average to be interesting
    
    // Severity tiers (for embed coloring, not filtering)
    priceDrop: {
      notable: -3,      // ⚠️ Yellow - worth looking at
      significant: -6,  // 🟠 Orange - real opportunity  
      major: -12,       // 🔴 Red - big dump
      extreme: -25,     // 💀 Purple - massive dump
    },

    // ═══════════════════════════════════════════════════════════════
    // DATA FRESHNESS - Don't act on stale data
    // ═══════════════════════════════════════════════════════════════
    maxDataAge: 300,                // Price data must be <5 mins old (seconds)
    
    // ═══════════════════════════════════════════════════════════════
    // PROFIT THRESHOLDS - Must meet at least ONE to alert
    // ═══════════════════════════════════════════════════════════════
    // Option 1: High max profit (catches high-volume items)
    minMaxProfit: 325000,           // 325K max profit at GE limit
    // Option 2: High margin AND decent max (catches expensive items with small limits)
    minProfitPerItem: 2500,         // 2.5K gp per item, AND...
    minMaxProfitForMargin: 200000,  // ...at least 200K max profit
    
    // ═══════════════════════════════════════════════════════════════
    // SPAM FILTERS - Basic sanity checks
    // ═══════════════════════════════════════════════════════════════
    minPrice: 100,                  // Ignore items worth less than 100gp
    minGELimit: 1,                  // Must have a known GE limit
    
    // ═══════════════════════════════════════════════════════════════
    // 1GP DUMPS - Always show, no exceptions
    // ═══════════════════════════════════════════════════════════════
    oneGpAlerts: true,              // Master switch for 1gp alerts
    oneGpMinAvgPrice: 500,          // Only alert if avg price is >500gp (filters true junk)
    oneGpCooldown: 600000,          // 10 min cooldown per item
    
    // ═══════════════════════════════════════════════════════════════
    // GENERAL COOLDOWN
    // ═══════════════════════════════════════════════════════════════
    cooldown: 300000,               // 5 minutes between alerts for same item
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
  if (num === null || num === undefined) return 'N/A';
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B gp`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M gp`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K gp`;
  return `${num.toLocaleString()} gp`;
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
  
  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${tier}: ${item.name}`)
    .setColor(color)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon || item.name.replace(/ /g, '_') + '.png')}`)
    .setDescription(`**${formatPercent(dropPercent)}** below average • ${spikeEmoji} **${volumeSpike.toFixed(1)}x** volume spike`);
  
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
      `Data: ${formatAge(priceAge)}`,
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
  } = alert;
  
  // 1gp dumps are always purple/skull - they're the holy grail
  let emoji = '💀';
  let color = 0x9b59b6;
  
  if (maxProfit >= 1000000) {
    emoji = '💎💀';
  } else if (maxProfit >= 500000) {
    emoji = '🔥💀';
  }
  
  const embed = new EmbedBuilder()
    .setTitle(`${emoji} 1GP DUMP: ${item.name}`)
    .setColor(color)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon || item.name.replace(/ /g, '_') + '.png')}`)
    .setDescription(`Someone just sold for **1 GP** • Normal price: **${formatGp(avgPrice)}**`);
  
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
      `Data age: ${formatAge(priceAge)}`,
    ].join('\n'),
    inline: true,
  });
  
  // Warning
  embed.addFields({
    name: '⚡ ACT FAST',
    value: '1GP offers get snapped up instantly. This is showing you what JUST happened - the window may already be closed.',
    inline: false,
  });
  
  // Links
  embed.addFields({
    name: '🔗 Links',
    value: `[Wiki](https://oldschool.runescape.wiki/w/${encodeURIComponent(item.name)}) | [Prices](https://prices.runescape.wiki/osrs/item/${item.id})`,
    inline: false,
  });
  
  embed.setFooter({ text: `${CONFIG.brand.name} • ALL 1GP dumps shown`, iconURL: CONFIG.brand.icon })
    .setTimestamp();
  
  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DUMP DETECTION LOGIC v2.0
// ═══════════════════════════════════════════════════════════════════════════════
// 
// WHAT WE KNOW (from API):
// - Latest prices: high (insta-buy), low (insta-sell), and their timestamps
// - 5m averages: avgHighPrice, avgLowPrice, highPriceVolume, lowPriceVolume
// - 1h averages: same metrics over longer period
// - Item data: GE limit, high alch value, members status
//
// WHAT INDICATES A DUMP:
// 1. Volume spike: 5m volume >> expected (1h ÷ 12)
// 2. Sell pressure: lowPriceVolume > highPriceVolume (more people selling than buying)
// 3. Price suppression: current low < avgLowPrice (prices being pushed down)
// 4. Fresh data: timestamps are recent (opportunity still exists)
//
// WHAT WE DON'T PRETEND TO KNOW:
// - How many items are available to buy (we can't see order book)
// - Whether you'll actually get any (competition is invisible)
// - Future price movement (we're not predicting, just detecting)
//
// ═══════════════════════════════════════════════════════════════════════════════

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
    
    // ═══════════════════════════════════════════════════════════════
    // 1GP DUMP DETECTION - ALWAYS CHECK FIRST
    // ═══════════════════════════════════════════════════════════════
    
    if (CONFIG.detection.oneGpAlerts && buyPrice === 1) {
      // Someone sold at 1gp - this is always interesting if the item has real value
      const avgPrice = avg5mHigh || avg1hHigh || instaBuyPrice;
      
      if (avgPrice && avgPrice >= CONFIG.detection.oneGpMinAvgPrice) {
        // Check cooldown
        const last1gp = oneGpCooldowns.get(itemId);
        if (!last1gp || now - last1gp >= CONFIG.detection.oneGpCooldown) {
          const profitPerItem = avgPrice - 1;
          const maxProfit = profitPerItem * (geLimit || 1);
          
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
            alchProfit: highAlch - 1 - 135,
          });
          
          oneGpCooldowns.set(itemId, now);
          console.log(`💀 1GP dump: ${item.name} (avg: ${formatGp(avgPrice)})`);
        }
      }
      continue;  // Don't also trigger as a regular dump
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
      
      // ═══════════════════════════════════════════════════════════════
      // PROFIT FILTER - Must meet at least ONE threshold
      // ═══════════════════════════════════════════════════════════════
      // Option 1: Max profit alone is high enough (high-volume items)
      const meetsMaxProfit = maxProfit >= CONFIG.detection.minMaxProfit;
      // Option 2: High margin AND decent max profit (expensive low-limit items)
      const meetsMarginCombo = profitPerItem >= CONFIG.detection.minProfitPerItem 
                            && maxProfit >= CONFIG.detection.minMaxProfitForMargin;
      
      if (!meetsMaxProfit && !meetsMarginCombo) {
        // Not worth alerting - too small
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
      });
      
      alertCooldowns.set(itemId, now);
      console.log(`📉 Dump detected: ${item.name} (${formatPercent(dropPercent)}, ${volumeSpike.toFixed(1)}x vol, ${formatGp(maxProfit)} max)`);
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
        .setDescription('Min price drop % (default: -3)'))
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
    const alerts = await scanForDumps();
    
    if (alerts.length === 0) return;
    
    console.log(`🔔 ${alerts.length} alerts triggered`);
    
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
        
        if (volumeSpike !== null) config.volumeSpikeMultiplier = volumeSpike;
        if (sellPressure !== null) config.minSellPressure = sellPressure / 100;
        if (priceDrop !== null) config.minPriceDrop = priceDrop;
        if (cooldown !== null) config.cooldown = cooldown * 60 * 1000;
        
        serverConfigs[guildId] = { ...serverConfigs[guildId], ...config };
        saveConfig();
        
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
