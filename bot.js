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
/* CONFIGURATION */
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
    
    // Volume spike (multiplier vs expected) – reserved for future use
    volumeSpike: 1.5,      // Alert when volume is 1.5x expected
    
    // Minimum volume to care about (filters out low-liquidity items) – reserved
    minVolume: 50,
    
    // 1gp dump detection - ALWAYS alerts regardless of other thresholds
    oneGpAlert: true,      // Enable 1gp alerts
    oneGpCooldown: 600000, // 10 min cooldown for 1gp alerts (separate from price alerts)
    
    // Cooldown between alerts for same item (ms)
    cooldown: 300000,      // 5 minutes
  },

  // Data persistence
  dataDir: process.env.DATA_DIR || './data',
};

/*
 * Modifications for The Crater – GE Dump Detector
 *
 * Dynamic thresholds by GE limit + profit requirement + 1gp filtering for low-limit
 * items.
 */

// Extend CONFIG.detection with limit-based settings
const updatedDetection = {
  ...CONFIG.detection,
  // Items with buy limits below this are treated as “low-limit”
  lowLimitThreshold: 250,

  // Minimum expected profit (gp) required for low-limit items to trigger a dump
  // alert: (avg5m high – current low) * buy limit
  minProfitForLowLimit: 50000,

  // Minimum 5-min average price (gp) for 1gp alerts on low-limit items
  minAvgForLowLimit1gp: 10000,
};

CONFIG.detection = updatedDetection;

/*
 * Dynamic minimum price calculation based on GE buy limit.
 *
 * For limits:
 *  - >= 250 → 25k gp
 *  - <= 50  → 75k gp
 *  - between 50 and 250 → linear from 75k (50) to 25k (250)
 */
function getDynamicMinPrice(item) {
  const limit = item?.limit ?? Infinity;
  if (limit === Infinity) return CONFIG.detection.minPrice;
  if (limit >= CONFIG.detection.lowLimitThreshold) return 25000;
  if (limit <= 50) return 75000;

  const maxLimit = CONFIG.detection.lowLimitThreshold; // 250
  const minLimit = 50;
  const maxPrice = 25000;
  const minPrice = 75000;

  const slope = (minPrice - maxPrice) / (minLimit - maxLimit);
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
} catch (e) {
  console.error('Error loading config:', e.message);
}

// Optional watchlist (if empty, scans all items)
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
const alertCooldowns = new Map();  // itemId -> lastAlertTime
const oneGpCooldowns = new Map();  // itemId -> lastAlertTime (separate for 1gp)

// ═══════════════════════════════════════════════════════════════════════════════
// GE API
// ═══════════════════════════════════════════════════════════════════════════════

let itemMapping = new Map();    // id -> item data
let itemNameLookup = new Map(); // lowercase name -> id
let latestPrices = new Map();   // id -> price data
let priceHistory = new Map();   // id -> [{high, low, timestamp}, ...]

async function fetchApi(endpoint) {
  try {
    const response = await fetch(`${CONFIG.api.baseUrl}${endpoint}`, {
      headers: { 'User-Agent': CONFIG.api.userAgent },
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
    const id = parseInt(itemId, 10);
    latestPrices.set(id, { ...priceData, fetchTime: timestamp });
    
    // Store history for avg calculations
    if (!priceHistory.has(id)) priceHistory.set(id, []);
    const history = priceHistory.get(id);
    history.push({ high: priceData.high, low: priceData.low, timestamp });
    
    // Keep last 2 hours of data (240 entries at 30s intervals)
    while (history.length > 240) history.shift();
  }
  
  return true;
}

// Cache for API averages (don't fetch every scan)
let cached5mData = null;
let cached1hData = null;
let lastAvgFetch = 0;

async function fetchRealAverages() {
  // Only fetch every 60 seconds to avoid hammering API
  if (Date.now() - lastAvgFetch < 60000 && cached5mData && cached1hData) {
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
// EMBED BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════

function buildDumpEmbed(item, prices, avg5m, dropPercent, profitPerItem, profitMargin, totalProfit, volume5m) {
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
  
  const embed = new EmbedBuilder()
    .setTitle(`${emoji} DUMP DETECTED: ${item.name}`)
    .setColor(color)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
    .setDescription(`**${severity}** price drop detected`);
  
  // Price info - show BUY and SELL prices clearly
  embed.addFields(
    { name: '🛒 Buy Now (Low)', value: formatGp(prices.low), inline: true },
    { name: '💰 Sell Target (Avg)', value: formatGp(avg5m?.avgHighPrice), inline: true },
    { name: '📋 GE Limit', value: item.limit ? item.limit.toLocaleString() : 'Unknown', inline: true },
  );
  
  // PROFIT SECTION - the important bit!
  embed.addFields({
    name: '💎 Profit Opportunity',
    value: [
      `Per item: **${formatGp(profitPerItem)}**`,
      `Margin: **${profitMargin ? profitMargin.toFixed(1) : '?'}%**`,
      `Max profit: **${formatGp(totalProfit)}**`,
    ].join('\n'),
    inline: true,
  });
  
  // Price Changes section
  embed.addFields({
    name: '📉 Price vs Average',
    value: [
      `Diff vs 5m: **${formatPercent(dropPercent)}**`,
    ].join('\n'),
    inline: true,
  });
  
  // Volume section
  embed.addFields({
    name: '📦 Volume (5m)',
    value: volume5m ? formatVolume(volume5m) : 'N/A',
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

function build1gpEmbed(item, avgPrice, profitPerItem, totalProfit, volume5m) {
  const embed = new EmbedBuilder()
    .setTitle(`💀 1GP DUMP: ${item.name}`)
    .setColor(0x9b59b6) // Purple
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
    .setDescription('**Someone just dumped this item at 1gp!**');
  
  // Price info
  embed.addFields(
    { name: '🛒 Buy Now', value: '**1 gp**', inline: true },
    { name: '💰 Sell Target', value: formatGp(avgPrice), inline: true },
    { name: '📋 GE Limit', value: item.limit ? item.limit.toLocaleString() : 'Unknown', inline: true },
  );
  
  // PROFIT SECTION - this is the jackpot!
  embed.addFields({
    name: '💎 Profit Opportunity',
    value: [
      `Per item: **${formatGp(profitPerItem)}**`,
      `Max profit: **${formatGp(totalProfit)}** 🚀`,
    ].join('\n'),
    inline: true,
  });
  
  // Volume
  embed.addFields({
    name: '📦 Volume (5m)',
    value: volume5m ? formatVolume(volume5m) : 'N/A',
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
// DUMP DETECTION LOGIC (WITH LIMIT/PROFIT LOGIC)
// ═══════════════════════════════════════════════════════════════════════════════

async function scanForDumps() {
  const alerts = [];
  const now = Date.now();

  // Fetch real averages from API
  const { data5m, data1h } = await fetchRealAverages();

  const itemsToScan = watchlist.size > 0 ? [...watchlist] : [...latestPrices.keys()];

  for (const itemId of itemsToScan) {
    const item = itemMapping.get(itemId);
    const prices = latestPrices.get(itemId);
    if (!item || !prices) continue;

    // Get REAL averages from API
    const apiAvg5m = data5m?.[itemId];
    const apiAvg1h = data1h?.[itemId];
    
    // Use API averages - these are the TRUE market prices
    const avg5mHigh = apiAvg5m?.avgHighPrice || null;  // What buyers pay (insta-buy)
    const avg5mLow = apiAvg5m?.avgLowPrice || null;    // What sellers get (insta-sell)
    const avg1hHigh = apiAvg1h?.avgHighPrice || null;
    const avg1hLow = apiAvg1h?.avgLowPrice || null;
    const volume5m = (apiAvg5m?.highPriceVolume || 0) + (apiAvg5m?.lowPriceVolume || 0);

    // THE KEY FOR PROFIT:
    // prices.low = someone is SELLING at this price (your BUY opportunity)
    // avg5mHigh = what people normally INSTA-BUY at (your SELL target)
    const buyPrice = prices.low;      // What you can buy it for RIGHT NOW
    const sellTarget = avg5mHigh;     // What you can likely sell it for
    
    if (!buyPrice || !sellTarget) continue;

    // Dynamic min price by limit
    const dynamicMinPrice = getDynamicMinPrice(item);
    const minPriceThreshold =
      item.limit < CONFIG.detection.lowLimitThreshold
        ? dynamicMinPrice
        : CONFIG.detection.minPrice;

    // Skip items whose avg is below threshold
    if (sellTarget < minPriceThreshold) continue;

    // Calculate the REAL profit opportunity
    const profitPerItem = sellTarget - buyPrice;
    const profitMargin = (profitPerItem / buyPrice) * 100;  // ROI %
    const totalProfit = profitPerItem * (item.limit || 1);
    
    // 1gp alerts - someone selling at 1gp when item is worth way more
    if (CONFIG.detection.oneGpAlert && prices.low === 1 && sellTarget > 1) {
      const avgThreshold =
        item.limit < CONFIG.detection.lowLimitThreshold
          ? CONFIG.detection.minAvgForLowLimit1gp
          : CONFIG.detection.minAvgFor1gp;

      if (sellTarget >= avgThreshold) {
        const last1gp = oneGpCooldowns.get(itemId);
        const cooldown = CONFIG.detection.oneGpCooldown;
        if (!last1gp || now - last1gp >= cooldown) {
          alerts.push({ 
            type: '1GP', 
            item, 
            prices, 
            avgPrice: sellTarget,
            avg5m: apiAvg5m,
            avg1h: apiAvg1h,
            profitPerItem: sellTarget - 1,
            totalProfit: (sellTarget - 1) * (item.limit || 1),
            volume5m,
          });
          oneGpCooldowns.set(itemId, now);
        }
      }
      continue;
    }

    // Hard floor for super-cheap junk
    if (buyPrice < CONFIG.detection.minPrice && sellTarget < CONFIG.detection.minPrice) continue;

    // Cooldown for normal alerts
    const lastAlert = alertCooldowns.get(itemId);
    if (lastAlert && now - lastAlert < CONFIG.detection.cooldown) continue;

    // Calculate drop: how much below average is the current SELL price (low)?
    // Negative = item is being sold BELOW average = BUY opportunity
    const dropPercent = ((buyPrice - sellTarget) / sellTarget) * 100;

    if (dropPercent <= CONFIG.detection.priceDrop.moderate) {
      const limit = item.limit || 0;

      // Only fire if there is real profit opportunity
      if (limit && totalProfit >= CONFIG.detection.minProfitForLowLimit) {
        alerts.push({
          type: 'DUMP',
          item,
          prices,
          avg5m: apiAvg5m,
          avg1h: apiAvg1h,
          dropPercent,
          profitPerItem,
          profitMargin,
          totalProfit,
          volume5m,
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
    await fetchPrices();
    const alerts = await scanForDumps();
    if (alerts.length === 0) return;
    
    console.log(`🔔 ${alerts.length} dump alerts triggered`);
    
    for (const [guildId, config] of Object.entries(serverConfigs)) {
      if (!config.enabled || !config.channelId) continue;
      const channel = client.channels.cache.get(config.channelId);
      if (!channel) continue;
      
      for (const alert of alerts) {
        try {
          let embed;
          if (alert.type === '1GP') {
            embed = build1gpEmbed(
              alert.item, 
              alert.avgPrice, 
              alert.profitPerItem,
              alert.totalProfit,
              alert.volume5m
            );
          } else {
            embed = buildDumpEmbed(
              alert.item, 
              alert.prices, 
              alert.avg5m, 
              alert.dropPercent, 
              alert.profitPerItem,
              alert.profitMargin,
              alert.totalProfit,
              alert.volume5m
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
  
  await loadItemMapping();
  await fetchPrices();
  await registerCommands();
  
  client.user.setActivity('for dumps 📉', { type: 3 });
  
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
            .setDescription(
              `Alerts will be posted in this channel.\n\n` +
              `**Price Drop Thresholds:**\n` +
              `⚠️ Moderate: ${CONFIG.detection.priceDrop.moderate}%\n` +
              `🟠 Significant: ${CONFIG.detection.priceDrop.significant}%\n` +
              `🔴 Severe: ${CONFIG.detection.priceDrop.severe}%\n` +
              `💀 Extreme: ${CONFIG.detection.priceDrop.extreme}%\n\n` +
              `**1GP Dumps:** Always alerted 💀\n\nUse \`/alerts config\` to customise.`
            )
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
              { name: '⚠️ Moderate', value: `${config.priceDrop?.moderate ?? CONFIG.detection.priceDrop.moderate}%`, inline: true },
              { name: '🟠 Significant', value: `${config.priceDrop?.significant ?? CONFIG.detection.priceDrop.significant}%`, inline: true },
              { name: '🔴 Severe', value: `${config.priceDrop?.severe ?? CONFIG.detection.priceDrop.severe}%`, inline: true },
              { name: '💀 Extreme', value: `${config.priceDrop?.extreme ?? CONFIG.detection.priceDrop.extreme}%`, inline: true },
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
              { name: 'Status', value: config.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
              { name: 'Channel', value: `<#${config.channelId}>`, inline: true },
              { name: 'Watchlist', value: watchlist.size > 0 ? `${watchlist.size} items` : 'All items', inline: true },
              { name: 'Thresholds', value: 
                `Mod: ${config.priceDrop?.moderate ?? CONFIG.detection.priceDrop.moderate}%\n` +
                `Sig: ${config.priceDrop?.significant ?? CONFIG.detection.priceDrop.significant}%\n` +
                `Sev: ${config.priceDrop?.severe ?? CONFIG.detection.priceDrop.severe}%`,
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
