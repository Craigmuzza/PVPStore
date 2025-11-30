// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER - GE DUMP DETECTOR
// ═══════════════════════════════════════════════════════════════════════════════
// Detects items being dumped into the GE and 1gp sales
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
// CONFIGURATION - EDIT THESE TO YOUR LIKING
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Branding
  brand: {
    name: 'The Crater',
    icon: 'https://i.ibb.co/BVMTHSzM/Y-W-2.png',
    color: 0x1a1a2e,
  },

  // API Settings
  api: {
    baseUrl: 'https://prices.runescape.wiki/api/v1/osrs',
    userAgent: 'TheCrater-DumpDetector/1.0 (Discord Bot)',
    scanInterval: 30000,  // How often to check for dumps (30 seconds)
  },

  // Dump Detection Thresholds - CONFIGURE THESE
  detection: {
    // Price drop thresholds (negative percentages vs 5m average)
    priceDrop: {
      moderate: -6,      // ⚠️ Yellow - notable dip
      significant: -12,  // 🟠 Orange - real dump
      severe: -25,       // 🔴 Red - major dump
      extreme: -40,      // 💀 Purple - catastrophic dump
    },
    
    // SPAM FILTERS
    minPrice: 500,         // Ignore items worth less than 500gp (filters junk)
    minAvgFor1gp: 1000,    // Only alert 1gp dumps if avg price is >1000gp (filters naturally cheap items)
    
    // Volume spike (multiplier vs expected)
    volumeSpike: 1.5,    // Alert when volume is 1.5x expected
    
    // Minimum volume to care about (filters out low-liquidity items)
    minVolume: 50,
    
    // 1gp dump detection - ALWAYS alerts regardless of other thresholds
    oneGpAlert: true,    // Enable 1gp alerts
    oneGpCooldown: 600000, // 10 min cooldown for 1gp alerts (separate from price alerts)
    
    // Cooldown between alerts for same item (ms)
    cooldown: 300000,    // 5 minutes
  },

  // Data persistence
  dataDir: process.env.DATA_DIR || './data',
};

/*
 * Modifications for The Crater – GE Dump Detector
 *
 * These changes implement dynamic price thresholds based on an item's GE
 * buy-limit and incorporate profit and volume considerations into the dump
 * detection logic. Low-limit items (those with buy limits under 250) now
 * require higher minimum values to trigger alerts, reflecting the fact
 * that rare items can have wild price swings but low trading volume. The
 * detection logic also checks potential profit to ensure alerts are only
 * raised when there is meaningful upside, as requested. These thresholds are
 * configurable via the `CONFIG.detection` object.
 *
 * Background: Low volume items are extremely volatile, so to reduce
 * noise we require higher minimum prices and profit levels before alerting.
 *
 * 1. Dynamic minimum price thresholds:
 *    - Items with GE buy limit >= 250: min price = 25 000 gp (default)
 *    - Items with buy limit <= 50: min price = 75 000 gp
 *    - Items with buy limit between 50 and 250: min price increases linearly
 *      from 25 000 gp at limit 250 down to 75 000 gp at limit 50.  For example,
 *      an item with a buy limit of 150 would have a min price of 50 000 gp.
 *    The formula used is:
 *      minPrice = 25_000 + (250 - limit) * (75_000 - 25_000) / (250 - 50)
 *
 * 2. Profit threshold:
 *    For low-limit items, the potential profit must exceed
 *    CONFIG.detection.minProfitForLowLimit (default 50 000 gp).  Potential
 *    profit is estimated as (5-minute average high price – current low price)
 *    multiplied by the item's buy limit.  This helps focus on trades with
 *    meaningful upside rather than tiny arbitrage opportunities.
 *
 * 3. Separate thresholds for 1 gp dump alerts:
 *    Low-limit items require the 5-minute average price to exceed
 *    CONFIG.detection.minAvgForLowLimit1gp (default 10 000 gp) before a 1 gp
 *    alert is raised.  This reduces spam from items whose normal value is
 *    around 1 gp.
 *
 * 4. Configuration additions:
 *    Add the following keys to CONFIG.detection:
 *      lowLimitThreshold
 *      minProfitForLowLimit
 *      minAvgForLowLimit1gp
 *    These values can be customised via the `/alerts config` command if
 *    required.
 */

// Insert into CONFIG.detection (replace or merge with existing config):
const updatedDetection = {
  ...CONFIG.detection,
  // Low-limit threshold: items with buy limits below this value are treated
  // differently.  Defaults to 250, as specified by the user.
  lowLimitThreshold: 250,
  // Minimum expected profit (in gp) required for low-limit items to trigger
  // a dump alert.  This value can be tuned via `/alerts config` if you
  // desire larger or smaller minimum profits.
  minProfitForLowLimit: 50000,
  // Minimum average price (gp) for 1 gp dumps of low-limit items.  If the
  // 5-minute average price is below this threshold, 1 gp alerts will be
  // suppressed to avoid spam on junk items.
  minAvgForLowLimit1gp: 10000,
};

// Merge the updated detection settings back into the CONFIG object
CONFIG.detection = updatedDetection;

/*
 * Dynamic minimum price calculation based on GE buy limit.
 *
 * For items with buy limits below `lowLimitThreshold`, compute a minimum price
 * that scales linearly from 25 000 gp at a limit of 250 down to 75 000 gp at
 * a limit of 50.  For limits above 250, the minimum is 25 000 gp.  For
 * limits below 50, the minimum is 75 000 gp.  This function returns the
 * appropriate threshold for a given item.
 */
function getDynamicMinPrice(item) {
  const limit = item?.limit ?? Infinity;
  // If the limit is not defined, return the base minPrice
  if (limit === Infinity) return CONFIG.detection.minPrice;
  // Limits above the threshold use the base minPrice
  if (limit >= CONFIG.detection.lowLimitThreshold) return 25000;
  // Limits below or equal to 50 use the maximum threshold
  if (limit <= 50) return 75000;
  // Otherwise interpolate between 25 000 and 75 000
  const maxLimit = CONFIG.detection.lowLimitThreshold; // 250
  const minLimit = 50;
  const maxPrice = 25000;
  const minPrice = 75000;
  // Linear interpolation: value decreases as limit increases
  const slope = (minPrice - maxPrice) / (minLimit - maxLimit);
  // At limit = maxLimit (250), price = 25 000; at limit = minLimit (50), price = 75 000
  const dynamicPrice = maxPrice + slope * (limit - maxLimit);
  return Math.round(dynamicPrice);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA STORAGE
// ═══════════════════════════════════════════════════════════════════════════════

const DATA_DIR = CONFIG.dataDir;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_FILE = path.join(DATA_DIR, 'server_config.json');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');

// Server configurations (which channel to post alerts)
let serverConfigs = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    serverConfigs = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
} catch (e) { console.error('Error loading config:', e.message); }

// Optional watchlist (if empty, scans all items)
let watchlist = new Set();
try {
  if (fs.existsSync(WATCHLIST_FILE)) {
    watchlist = new Set(JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8')));
  }
} catch (e) { console.error('Error loading watchlist:', e.message); }

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(serverConfigs, null, 2));
}

function saveWatchlist() {
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify([...watchlist], null, 2));
}

// Cooldown tracking
const alertCooldowns = new Map(); // itemId -> lastAlertTime
const oneGpCooldowns = new Map(); // itemId -> lastAlertTime (separate for 1gp)

// ═══════════════════════════════════════════════════════════════════════════════
// GE API
// ═══════════════════════════════════════════════════════════════════════════════

let itemMapping = new Map();   // id -> item data
let itemNameLookup = new Map(); // lowercase name -> id
let latestPrices = new Map();  // id -> price data
let priceHistory = new Map();  // id -> [{high, low, timestamp}, ...]

async function fetchApi(endpoint) {
  try {
    const response = await fetch(`${CONFIG.api.baseUrl}${endpoint}`, {
      headers: { 'User-Agent': CONFIG.api.userAgent }
    });
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
    const id = parseInt(itemId);
    latestPrices.set(id, { ...priceData, fetchTime: timestamp });
    
    // Store history for avg calculations
    if (!priceHistory.has(id)) priceHistory.set(id, []);
    const history = priceHistory.get(id);
    history.push({ high: priceData.high, low: priceData.low, timestamp });
    
    // Keep last 30 minutes of data (60 entries at 30s intervals)
    while (history.length > 60) history.shift();
  }
  
  return true;
}

async function fetch5mAverage(itemId) {
  // Get average from our stored history (last ~5 mins = 10 data points)
  const history = priceHistory.get(itemId);
  if (!history || history.length < 2) return null;
  
  const recent = history.slice(-10);
  const avgHigh = recent.reduce((sum, h) => sum + (h.high || 0), 0) / recent.length;
  const avgLow = recent.reduce((sum, h) => sum + (h.low || 0), 0) / recent.length;
  
  return { avgHigh, avgLow };
}

function findItem(query) {
  const lower = query.toLowerCase().trim();
  if (itemNameLookup.has(lower)) {
    return itemMapping.get(itemNameLookup.get(lower));
  }
  for (const [name, id] of itemNameLookup) {
    if (name.includes(lower)) return itemMapping.get(id);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMATTING
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

// ═══════════════════════════════════════════════════════════════════════════════
# EMBED BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════

function buildDumpEmbed(item, prices, avg5m, dropPercent, volume, volumeMultiplier) {
  // Determine severity
  let severity = 'MODERATE';
  let color = 0xffdd57; // Yellow
  let emoji = '⚠️';
  
  if (dropPercent <= CONFIG.detection.priceDrop.extreme) {
    severity = 'EXTREME';
    color = 0x9b59b6; // Purple
    emoji = '💀';
  } else if (dropPercent <= CONFIG.detection.priceDrop.severe) {
    severity = 'SEVERE';
    color = 0xff3860; // Red
    emoji = '🔴';
  } else if (dropPercent <= CONFIG.detection.priceDrop.significant) {
    severity = 'SIGNIFICANT';
    color = 0xff6b35; // Orange
    emoji = '🟠';
  }
  
  // Calculate additional averages from history
  const history = priceHistory.get(item.id) || [];
  
  // 1h average (last 120 data points at 30s intervals)
  const hourHistory = history.slice(-120);
  const avg1h = hourHistory.length > 0 
    ? hourHistory.reduce((sum, h) => sum + (h.high || 0), 0) / hourHistory.length 
    : null;
  
  // 24h average (use all history we have)
  const avg24h = history.length > 0
    ? history.reduce((sum, h) => sum + (h.high || 0), 0) / history.length
    : null;
  
  // Calculate diffs
  const diffVs1h = avg1h ? ((prices.high - avg1h) / avg1h) * 100 : null;
  const diffVs24h = avg24h ? ((prices.high - avg24h) / avg24h) * 100 : null;
  
  const embed = new EmbedBuilder()
    .setTitle(`${emoji} DUMP DETECTED: ${item.name}`)
    .setColor(color)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
    .setDescription(`**${severity}** price drop detected`)
    .addFields(
      { name: '💰 Buy Price', value: formatGp(prices.high), inline: true },
      { name: '📋 GE Limit', value: item.limit ? item.limit.toLocaleString() : 'Unknown', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
    );
  
  // Average Prices section
  embed.addFields({
    name: '📊 Average Prices',
    value: [
      `5 minutes: ${formatGp(Math.round(avg5m?.avgHigh || 0))}`,
      `1 hour: ${avg1h ? formatGp(Math.round(avg1h)) : 'N/A'}`,
      `Today: ${avg24h ? formatGp(Math.round(avg24h)) : 'N/A'}`,
    ].join('\n'),
    inline: true,
  });
  
  // Price Changes section
  embed.addFields({
    name: '📉 Price Changes',
    value: [
      `Diff vs 5m: **${formatPercent(dropPercent)}**`,
      `Diff vs 1h: ${diffVs1h !== null ? formatPercent(diffVs1h) : 'N/A'}`,
      `Diff vs 24h: ${diffVs24h !== null ? formatPercent(diffVs24h) : 'N/A'}`,
    ].join('\n'),
    inline: true,
  });
  
  // Volume section
  embed.addFields({
    name: '📦 Volume',
    value: [
      `5 min: ${volume ? formatVolume(volume) : 'N/A'}`,
      `Vol vs expected: ${volumeMultiplier ? `${volumeMultiplier.toFixed(1)}x` : 'N/A'}`,
    ].join('\n'),
    inline: true,
  });
  
  // Timestamp and links
  embed.addFields(
    { name: '⏰ Traded at', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
    { name: '🔗 Links', value: `[Wiki](https://oldschool.runescape.wiki/w/${encodeURIComponent(item.name)}) | [Graph](https://prices.runescape.wiki/osrs/item/${item.id})`, inline: false }
  );
  
  embed.setFooter({ text: CONFIG.brand.name, iconURL: CONFIG.brand.icon });
  
  return embed;
}

function build1gpEmbed(item, avgPrice, volume) {
  // Calculate additional averages from history
  const history = priceHistory.get(item.id) || [];
  
  // 1h average
  const hourHistory = history.slice(-120);
  const avg1h = hourHistory.length > 0 
    ? hourHistory.reduce((sum, h) => sum + (h.high || 0), 0) / hourHistory.length 
    : null;
  
  // 24h average
  const avg24h = history.length > 0
    ? history.reduce((sum, h) => sum + (h.high || 0), 0) / history.length
    : null;
  
  const embed = new EmbedBuilder()
    .setTitle(`💀 1GP DUMP: ${item.name}`)
    .setColor(0x9b59b6) // Purple
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
    .setDescription('**Someone just dumped this item at 1gp!**')
    .addFields(
      { name: '💰 Buy Price', value: '1 gp', inline: true },
      { name: '📋 GE Limit', value: item.limit ? item.limit.toLocaleString() : 'Unknown', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
    );
  
  // Average Prices section
  embed.addFields({
    name: '📊 Average Prices',
    value: [
      `5 minutes: ${formatGp(Math.round(avgPrice || 0))}`,
      `1 hour: ${avg1h ? formatGp(Math.round(avg1h)) : 'N/A'}`,
      `Today: ${avg24h ? formatGp(Math.round(avg24h)) : 'N/A'}`,
    ].join('\n'),
    inline: true,
  });
  
  // Price Changes section - all will be ~-100%
  const diffVs5m = avgPrice > 1 ? ((1 - avgPrice) / avgPrice) * 100 : 0;
  const diffVs1h = avg1h && avg1h > 1 ? ((1 - avg1h) / avg1h) * 100 : null;
  const diffVs24h = avg24h && avg24h > 1 ? ((1 - avg24h) / avg24h) * 100 : null;
  
  embed.addFields({
    name: '📉 Price Changes',
    value: [
      `Diff vs 5m: **${formatPercent(diffVs5m)}**`,
      `Diff vs 1h: ${diffVs1h !== null ? formatPercent(diffVs1h) : 'N/A'}`,
      `Diff vs 24h: ${diffVs24h !== null ? formatPercent(diffVs24h) : 'N/A'}`,
    ].join('\n'),
    inline: true,
  });
  
  // Timestamp and links
  embed.addFields(
    { name: '⏰ Traded at', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
    { name: '🔗 Links', value: `[Wiki](https://oldschool.runescape.wiki/w/${encodeURIComponent(item.name)}) | [Graph](https://prices.runescape.wiki/osrs/item/${item.id})`, inline: false }
  );
  
  embed.setFooter({ text: CONFIG.brand.name, iconURL: CONFIG.brand.icon });
  
  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DUMP DETECTION LOGIC (MODIFIED)
// ═══════════════════════════════════════════════════════════════════════════════

async function scanForDumps() {
  const alerts = [];
  const now = Date.now();
  const itemsToScan = watchlist.size > 0 ? [...watchlist] : [...latestPrices.keys()];

  for (const itemId of itemsToScan) {
    const item = itemMapping.get(itemId);
    const prices = latestPrices.get(itemId);
    if (!item || !prices) continue;

    // Compute 5-minute average
    const avg5m = await fetch5mAverage(itemId);
    const avgPrice = avg5m?.avgHigh || prices.high || 0;

    // Determine dynamic minimum price for the item
    const dynamicMinPrice = getDynamicMinPrice(item);

    // Apply dynamic minimum price threshold only if the limit is below the
    // configured lowLimitThreshold.  Otherwise, use CONFIG.detection.minPrice.
    const minPriceThreshold =
      item.limit < CONFIG.detection.lowLimitThreshold
        ? dynamicMinPrice
        : CONFIG.detection.minPrice;

    // Skip items below the computed minimum price
    if (avgPrice < minPriceThreshold) {
      continue;
    }

    // 1 gp alert handling: check if high or low price is 1 and above the
    // average price threshold
    if (CONFIG.detection.oneGpAlert && (prices.low === 1 || prices.high === 1)) {
      // Determine threshold for 1 gp alerts based on limit
      const avgThreshold =
        item.limit < CONFIG.detection.lowLimitThreshold
          ? CONFIG.detection.minAvgForLowLimit1gp
          : CONFIG.detection.minAvgFor1gp;

      if (avgPrice >= avgThreshold) {
        const last1gp = oneGpCooldowns.get(itemId);
        const cooldown = CONFIG.detection.oneGpCooldown;
        if (!last1gp || now - last1gp >= cooldown) {
          alerts.push({ type: '1GP', item, prices, avgPrice });
          oneGpCooldowns.set(itemId, now);
        }
      }
      continue; // Skip regular price checks if 1 gp condition is met
    }

    // Skip items with current price below the (static) minPrice threshold.  This
    // further filters out very cheap items, including high-limit items.
    if (prices.high < CONFIG.detection.minPrice) {
      continue;
    }

    // Cooldown check for normal alerts
    const lastAlert = alertCooldowns.get(itemId);
    if (lastAlert && now - lastAlert < CONFIG.detection.cooldown) {
      continue;
    }

    // Require a valid average to compute drop percentage
    if (!avg5m || !avg5m.avgHigh) continue;

    const dropPercent = ((prices.high - avg5m.avgHigh) / avg5m.avgHigh) * 100;

    // Determine if the price drop meets the moderate threshold
    if (dropPercent <= CONFIG.detection.priceDrop.moderate) {
      // Profit calculation: potential profit = (avg5m.avgHigh – prices.low) * limit
      const potentialProfit = (avg5m.avgHigh - prices.low) * (item.limit || 0);

      // Only alert if the potential profit meets the minimum for low-limit items
      if (item.limit && potentialProfit >= CONFIG.detection.minProfitForLowLimit) {
        alerts.push({
          type: 'DUMP',
          item,
          prices,
          avg5m,
          dropPercent,
          volume: null,
          volumeMultiplier: 1.0, // Placeholder for future volume logic
        });
        alertCooldowns.set(itemId, now);
      }
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

// Commands
const commands = [
  new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Configure dump alerts')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Enable dump alerts in this channel'))
    .addSubcommand(sub => sub
      .setName('stop')
      .setDescription('Disable dump alerts for this server'))
    .addSubcommand(sub => sub
      .setName('config')
      .setDescription('Configure alert thresholds')
      .addNumberOption(opt => opt
        .setName('moderate')
        .setDescription('Moderate drop threshold % (e.g., -4)'))
      .addNumberOption(opt => opt
        .setName('significant')
        .setDescription('Significant drop threshold % (e.g., -8)'))
      .addNumberOption(opt => opt
        .setName('severe')
        .setDescription('Severe drop threshold % (e.g., -15)'))
      .addNumberOption(opt => opt
        .setName('extreme')
        .setDescription('Extreme drop threshold % (e.g., -25)'))
      .addIntegerOption(opt => opt
        .setName('cooldown')
        .setDescription('Minutes between alerts for same item')))
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Show current configuration')),

  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage watchlist (only alert for these items)')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add item to watchlist')
      .addStringOption(opt => opt
        .setName('item')
        .setDescription('Item name')
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove item from watchlist')
      .addStringOption(opt => opt
        .setName('item')
        .setDescription('Item name')
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('View current watchlist'))
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear watchlist (alert for all items)')),

  new SlashCommandBuilder()
    .setName('price')
    .setDescription('Check current price of an item')
    .addStringOption(opt => opt
      .setName('item')
      .setDescription('Item name')
      .setRequired(true)
      .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help'),
];

// Register commands
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
    // Fetch latest prices
    await fetchPrices();
    
    // Scan for dumps
    const alerts = await scanForDumps();
    
    if (alerts.length === 0) return;
    
    console.log(`🔔 ${alerts.length} dump alerts triggered`);
    
    // Send to all configured channels
    for (const [guildId, config] of Object.entries(serverConfigs)) {
      if (!config.enabled || !config.channelId) continue;
      
      const channel = client.channels.cache.get(config.channelId);
      if (!channel) continue;
      
      for (const alert of alerts) {
        try {
          let embed;
          if (alert.type === '1GP') {
            embed = build1gpEmbed(alert.item, alert.avgPrice, null);
          } else {
            embed = buildDumpEmbed(
              alert.item, alert.prices, alert.avg5m, 
              alert.dropPercent, alert.volume, alert.volumeMultiplier
            );
          }
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

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

client.once('ready', async () => {
  console.log('\n═══════════════════════════════════════════════');
  console.log('🌋 THE CRATER - GE DUMP DETECTOR');
  console.log('═══════════════════════════════════════════════');
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} servers`);
  console.log('═══════════════════════════════════════════════\n');
  
  // Load item mapping
  await loadItemMapping();
  
  // Initial price fetch
  await fetchPrices();
  
  // Register commands
  await registerCommands();
  
  // Set activity
  client.user.setActivity('for dumps 📉', { type: 3 });
  
  // Start alert loop
  setInterval(runAlertLoop, CONFIG.api.scanInterval);
  
  console.log('\n✅ Bot is operational!\n');
  console.log(`⚙️ Thresholds: Moderate ${CONFIG.detection.priceDrop.moderate}% | Significant ${CONFIG.detection.priceDrop.significant}% | Severe ${CONFIG.detection.priceDrop.severe}%`);
  console.log(`⏱️ Scan interval: ${CONFIG.api.scanInterval / 1000}s | Cooldown: ${CONFIG.detection.cooldown / 1000}s\n`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Autocomplete
    if (interaction.isAutocomplete()) {
      const query = interaction.options.getFocused().toLowerCase();
      if (query.length < 2) return interaction.respond([]);
      
      const matches = [];
      for (const [name, id] of itemNameLookup) {
        if (name.includes(query)) {
          const item = itemMapping.get(id);
          matches.push({ name: item.name, value: item.name });
          if (matches.length >= 25) break;
        }
      }
      return interaction.respond(matches);
    }
    
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName } = interaction;
    const guildId = interaction.guildId;
    
    // /alerts
    if (commandName === 'alerts') {
      const sub = interaction.options.getSubcommand();
      
      if (sub === 'setup') {
        serverConfigs[guildId] = {
          enabled: true,
          channelId: interaction.channelId,
          ...CONFIG.detection,
        };
        saveConfig();
        
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setTitle('✅ Dump Alerts Enabled')
            .setColor(0x00d26a)
            .setDescription(`Alerts will be posted in this channel.\n\n**Price Drop Thresholds:**\n⚠️ Moderate: ${CONFIG.detection.priceDrop.moderate}%\n🟠 Significant: ${CONFIG.detection.priceDrop.significant}%\n🔴 Severe: ${CONFIG.detection.priceDrop.severe}%\n💀 Extreme: ${CONFIG.detection.priceDrop.extreme}%\n\n**1GP Dumps:** Always alerted 💀\n\nUse \`/alerts config\` to customise.`)
            .setFooter({ text: CONFIG.brand.name, iconURL: CONFIG.brand.icon })]
        });
      }
      
      if (sub === 'stop') {
        if (serverConfigs[guildId]) {
          serverConfigs[guildId].enabled = false;
          saveConfig();
        }
        return interaction.reply({ content: '✅ Dump alerts disabled.', ephemeral: true });
      }
      
      if (sub === 'config') {
        const config = serverConfigs[guildId] || { ...CONFIG.detection };
        
        const moderate = interaction.options.getNumber('moderate');
        const significant = interaction.options.getNumber('significant');
        const severe = interaction.options.getNumber('severe');
        const extreme = interaction.options.getNumber('extreme');
        const cooldown = interaction.options.getInteger('cooldown');
        
        if (moderate !== null) config.priceDrop = { ...config.priceDrop, moderate };
        if (significant !== null) config.priceDrop = { ...config.priceDrop, significant };
        if (severe !== null) config.priceDrop = { ...config.priceDrop, severe };
        if (extreme !== null) config.priceDrop = { ...config.priceDrop, extreme };
        if (cooldown !== null) config.cooldown = cooldown * 60 * 1000;
        
        serverConfigs[guildId] = { ...serverConfigs[guildId], ...config };
        saveConfig();
        
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setTitle('⚙️ Configuration Updated')
            .setColor(0x3298dc)
            .addFields(
              { name: '⚠️ Moderate', value: `${config.priceDrop?.moderate || CONFIG.detection.priceDrop.moderate}%`, inline: true },
              { name: '🟠 Significant', value: `${config.priceDrop?.significant || CONFIG.detection.priceDrop.significant}%`, inline: true },
              { name: '🔴 Severe', value: `${config.priceDrop?.severe || CONFIG.detection.priceDrop.severe}%`, inline: true },
              { name: '💀 Extreme', value: `${config.priceDrop?.extreme || CONFIG.detection.priceDrop.extreme}%`, inline: true },
              { name: '⏱️ Cooldown', value: `${(config.cooldown || CONFIG.detection.cooldown) / 60000} mins`, inline: true },
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
              { name: 'Status', value: config.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
              { name: 'Channel', value: `<#${config.channelId}>`, inline: true },
              { name: 'Watchlist', value: watchlist.size > 0 ? `${watchlist.size} items` : 'All items', inline: true },
              { name: 'Thresholds', value: `Mod: ${config.priceDrop?.moderate || CONFIG.detection.priceDrop.moderate}%\nSig: ${config.priceDrop?.significant || CONFIG.detection.priceDrop.significant}%\nSev: ${config.priceDrop?.severe || CONFIG.detection.priceDrop.severe}%`, inline: true },
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
      const avg5m = await fetch5mAverage(item.id);
      
      if (!prices) {
        return interaction.reply({ content: `❌ No price data for ${item.name}.`, ephemeral: true });
      }
      
      const dropVs5m = avg5m?.avgHigh 
        ? ((prices.high - avg5m.avgHigh) / avg5m.avgHigh) * 100 
        : null;
      
      const embed = new EmbedBuilder()
        .setTitle(`📊 ${item.name}`)
        .setColor(CONFIG.brand.color)
        .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
        .addFields(
          { name: '💰 Buy Price', value: formatGp(prices.high), inline: true },
          { name: '💰 Sell Price', value: formatGp(prices.low), inline: true },
          { name: '📋 GE Limit', value: item.limit ? item.limit.toLocaleString() : 'Unknown', inline: true },
        );
      
      if (avg5m?.avgHigh) {
        embed.addFields(
          { name: '📊 5m Average', value: formatGp(Math.round(avg5m.avgHigh)), inline: true },
          { name: '📉 Diff vs 5m', value: formatPercent(dropVs5m), inline: true },
        );
      }
      
      embed.addFields(
        { name: '🔗 Links', value: `[Wiki](https://oldschool.runescape.wiki/w/${encodeURIComponent(item.name)}) | [Graph](https://prices.runescape.wiki/osrs/item/${item.id})`, inline: false }
      );
      
      embed.setFooter({ text: CONFIG.brand.name, iconURL: CONFIG.brand.icon })
        .setTimestamp();
      
      return interaction.reply({ embeds: [embed] });
    }
    
    // /help
    if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('🌋 The Crater - Dump Detector')
        .setColor(CONFIG.brand.color)
        .setDescription('Detects items being dumped into the GE and alerts you in real-time.')
        .addFields(
          { name: '📢 `/alerts setup`', value: 'Enable dump alerts in this channel', inline: false },
          { name: '⚙️ `/alerts config`', value: 'Set custom thresholds (e.g., `-4`, `-8`, `-15`)', inline: false },
          { name: '👁️ `/watchlist add/remove/view`', value: 'Only alert for specific items', inline: false },
          { name: '📊 `/price <item>`', value: 'Check current price of an item', inline: false },
        )
        .addFields({
          name: '⚡ What it detects',
          value: '• **Price dumps** - Items crashing vs 5-min average\n• **1gp dumps** - Items sold at 1gp\n• **Volume spikes** - Unusual trading activity',
          inline: false,
        })
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
    name: 'The Crater - Dump Detector',
    status: 'operational',
    servers: client.guilds?.cache.size || 0,
    itemsTracked: latestPrices.size,
    watchlistSize: watchlist.size,
  });
});

app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => console.log(`🌐 Health server on port ${PORT}`));

// ═══════════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════════

client.login(process.env.TOKEN);
