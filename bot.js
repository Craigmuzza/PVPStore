/*────────────────────────  Imports  ────────────────────────────*/
import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import express from 'express';
import fs, { existsSync, mkdirSync } from 'fs';
import path     from 'path';
import { fileURLToPath } from 'url';
import dotenv   from 'dotenv';
dotenv.config();

/*────────────────────  Paths & constants  ──────────────────────*/
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || '/data';
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const ICON_URL      = 'https://cdn.mos.cms.futurecdn.net/Lb544mmJnN9mq8VJSJ7yHV.jpg; // Placeholder - update later
const EMBED_COLOR   = 0x000000;
const BRAND_NAME    = 'The Crater';

const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const VENG_FILE     = path.join(DATA_DIR, 'venglist.json');

/* ── Discord-user ↔ RuneScape-account links ───────────────── */
const accounts = {};
try {
  Object.assign(accounts, JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8')));
  console.log(`[init] loaded RSN links for ${Object.keys(accounts).length} users`);
} catch {/* file may not exist yet */}

/* ── Vengeance list ───────────────────────────────────────── */
let vengList = [];
try {
  vengList = JSON.parse(fs.readFileSync(VENG_FILE, 'utf-8'));
  console.log(`[init] loaded ${vengList.length} RSNs on veng list`);
} catch {/* file may not exist yet */}

/*────────────────────  GE Tracker Config  ──────────────────────*/
const GE_CONFIG = {
  API_BASE: 'https://prices.runescape.wiki/api/v1/osrs',
  USER_AGENT: 'TheCrater-GE-Tracker - Discord Bot',
  DEFAULT_CRASH_THRESHOLD: -10,
  DEFAULT_SPIKE_THRESHOLD: 15,
  SCAN_INTERVAL: 60000,
  PRICE_HISTORY_LENGTH: 288,
};

/* ── GE Data Storage ──────────────────────────────────────── */
let itemMapping = new Map();
let itemNameLookup = new Map();
let latestPrices = new Map();
let priceHistory = new Map();
let serverWatchlists = new Map();
let serverAlertConfigs = new Map();
let previousPrices = new Map();

const WATCHLIST_FILE = path.join(DATA_DIR, 'ge_watchlists.json');
const ALERTS_FILE = path.join(DATA_DIR, 'ge_alerts.json');

/*────────────────────  Discord client  ─────────────────────────*/
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/*────────────────────  Helper functions  ───────────────────────*/
const errorEmbed = txt => new EmbedBuilder()
  .setTitle('⚠️ Error').setDescription(txt).setColor(EMBED_COLOR)
  .setThumbnail(ICON_URL).setFooter({ iconURL: ICON_URL, text: BRAND_NAME });

const formatAbbr = v => v>=1e9?`${(v/1e9).toFixed(1)}B`:v>=1e6?`${(v/1e6).toFixed(1)}M`:v>=1e3?`${(v/1e3).toFixed(1)}K`:`${v}`;

function saveData() {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

function saveVengList() {
  fs.writeFileSync(VENG_FILE, JSON.stringify(vengList, null, 2));
}

/*────────────────────  GE API Functions  ───────────────────────*/
async function fetchWithUA(url) {
  const response = await fetch(`${GE_CONFIG.API_BASE}${url}`, {
    headers: { 'User-Agent': GE_CONFIG.USER_AGENT }
  });
  return response.json();
}

async function fetchMapping() {
  try {
    const response = await fetchWithUA('/mapping');
    response.forEach(item => {
      itemMapping.set(item.id, item);
      itemNameLookup.set(item.name.toLowerCase(), item.id);
    });
    console.log(`✅ Loaded ${itemMapping.size} items from GE mapping`);
    return true;
  } catch (error) {
    console.error('❌ Failed to fetch item mapping:', error.message);
    return false;
  }
}

async function fetchLatestPrices() {
  try {
    const response = await fetchWithUA('/latest');
    const timestamp = Date.now();
    
    for (const [itemId, priceData] of Object.entries(response.data)) {
      const id = parseInt(itemId);
      const existing = latestPrices.get(id);
      
      if (existing) {
        previousPrices.set(id, existing);
      }
      
      latestPrices.set(id, { ...priceData, fetchTime: timestamp });
      
      if (!priceHistory.has(id)) {
        priceHistory.set(id, []);
      }
      const history = priceHistory.get(id);
      history.push({ high: priceData.high, low: priceData.low, timestamp });
      if (history.length > GE_CONFIG.PRICE_HISTORY_LENGTH) {
        history.shift();
      }
    }
    return true;
  } catch (error) {
    console.error('❌ Failed to fetch latest prices:', error.message);
    return false;
  }
}

async function fetchTimeseries(itemId, timestep = '5m') {
  try {
    const response = await fetchWithUA(`/timeseries?timestep=${timestep}&id=${itemId}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to fetch timeseries for ${itemId}:`, error.message);
    return null;
  }
}

/*────────────────────  GE Analysis Functions  ──────────────────*/
function findItem(query) {
  const lowerQuery = query.toLowerCase().trim();
  
  if (itemNameLookup.has(lowerQuery)) {
    const id = itemNameLookup.get(lowerQuery);
    return itemMapping.get(id);
  }
  
  const matches = [];
  for (const [name, id] of itemNameLookup) {
    if (name.includes(lowerQuery)) {
      matches.push(itemMapping.get(id));
    }
  }
  
  matches.sort((a, b) => a.name.length - b.name.length);
  return matches.length > 0 ? matches[0] : null;
}

function searchItems(query, limit = 25) {
  const lowerQuery = query.toLowerCase().trim();
  const matches = [];
  
  for (const [name, id] of itemNameLookup) {
    if (name.includes(lowerQuery)) {
      matches.push(itemMapping.get(id));
    }
  }
  
  matches.sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(lowerQuery);
    const bStarts = b.name.toLowerCase().startsWith(lowerQuery);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return a.name.length - b.name.length;
  });
  
  return matches.slice(0, limit);
}

function formatNumber(num) {
  if (!num) return 'N/A';
  if (num >= 1000000000) return (num / 1000000000).toFixed(2) + 'B';
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function formatTime(timestamp) {
  if (!timestamp) return 'N/A';
  return `<t:${Math.floor(timestamp)}:R>`;
}

function calculatePriceChange(itemId, hoursBack = 1) {
  const history = priceHistory.get(itemId);
  if (!history || history.length < 2) return null;
  
  const pointsBack = Math.min(hoursBack * 12, history.length - 1);
  const current = history[history.length - 1];
  const past = history[history.length - 1 - pointsBack];
  
  if (!current.high || !past.high) return null;
  
  const change = ((current.high - past.high) / past.high) * 100;
  return {
    currentPrice: current.high,
    pastPrice: past.high,
    changePercent: change,
    changeAmount: current.high - past.high
  };
}

function calculateMargin(itemId) {
  const prices = latestPrices.get(itemId);
  if (!prices || !prices.high || !prices.low) return null;
  
  const item = itemMapping.get(itemId);
  const taxRate = prices.high >= 100 ? 0.01 : 0;
  const tax = Math.floor(prices.high * taxRate);
  
  const margin = prices.high - prices.low - tax;
  const marginPercent = (margin / prices.low) * 100;
  
  return {
    high: prices.high,
    low: prices.low,
    margin,
    marginPercent,
    tax,
    buyLimit: item?.limit || 'Unknown',
    potentialProfit: item?.limit ? margin * item.limit : null
  };
}

function analyzeVolatility(itemId) {
  const history = priceHistory.get(itemId);
  if (!history || history.length < 12) return null;
  
  const prices = history.map(h => h.high).filter(p => p);
  if (prices.length < 12) return null;
  
  const mean = prices.reduce((a, b) => a + b) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  const volatility = (stdDev / mean) * 100;
  
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = ((max - min) / mean) * 100;
  
  return { mean: Math.round(mean), stdDev: Math.round(stdDev), volatility: volatility.toFixed(2), min, max, range: range.toFixed(2) };
}

function findBestFlips(minMarginPercent = 3, minBuyLimit = 100) {
  const flips = [];
  
  for (const [itemId, prices] of latestPrices) {
    const item = itemMapping.get(itemId);
    if (!item || !prices.high || !prices.low) continue;
    if (item.limit && item.limit < minBuyLimit) continue;
    
    const margin = calculateMargin(itemId);
    if (!margin || margin.marginPercent < minMarginPercent) continue;
    if (margin.margin < 100) continue;
    
    flips.push({
      item,
      ...margin,
      score: margin.marginPercent * Math.log10(margin.potentialProfit || margin.margin)
    });
  }
  
  flips.sort((a, b) => b.score - a.score);
  return flips.slice(0, 20);
}

function findMostVolatile(limit = 20) {
  const volatile = [];
  
  for (const [itemId] of latestPrices) {
    const item = itemMapping.get(itemId);
    if (!item) continue;
    
    const vol = analyzeVolatility(itemId);
    if (!vol) continue;
    
    volatile.push({ item, ...vol });
  }
  
  volatile.sort((a, b) => parseFloat(b.volatility) - parseFloat(a.volatility));
  return volatile.slice(0, limit);
}

function findBiggestMovers(hoursBack = 1, limit = 20) {
  const movers = { gainers: [], losers: [] };
  
  for (const [itemId] of latestPrices) {
    const item = itemMapping.get(itemId);
    if (!item) continue;
    
    const change = calculatePriceChange(itemId, hoursBack);
    if (!change || Math.abs(change.changePercent) < 1) continue;
    
    const entry = { item, ...change };
    
    if (change.changePercent > 0) {
      movers.gainers.push(entry);
    } else {
      movers.losers.push(entry);
    }
  }
  
  movers.gainers.sort((a, b) => b.changePercent - a.changePercent);
  movers.losers.sort((a, b) => a.changePercent - b.changePercent);
  
  return { gainers: movers.gainers.slice(0, limit), losers: movers.losers.slice(0, limit) };
}

function detectCrashOrSpike(itemId, thresholds) {
  const change = calculatePriceChange(itemId, 1);
  if (!change) return null;
  
  const alerts = [];
  
  if (change.changePercent <= thresholds.crash) {
    alerts.push({
      type: 'CRASH',
      item: itemMapping.get(itemId),
      change: change,
      severity: change.changePercent <= thresholds.crash * 2 ? 'SEVERE' : 'MODERATE'
    });
  }
  
  if (change.changePercent >= thresholds.spike) {
    alerts.push({
      type: 'SPIKE',
      item: itemMapping.get(itemId),
      change: change,
      severity: change.changePercent >= thresholds.spike * 2 ? 'SEVERE' : 'MODERATE'
    });
  }
  
  return alerts.length > 0 ? alerts : null;
}

/*────────────────────  GE Embed Builders  ──────────────────────*/
function buildItemEmbed(item, prices, includeAnalysis = true) {
  const embed = new EmbedBuilder()
    .setTitle(`📊 ${item.name}`)
    .setColor(EMBED_COLOR)
    .setURL(`https://prices.runescape.wiki/osrs/item/${item.id}`)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
    .addFields(
      { name: '💰 Instant Buy', value: `**${formatNumber(prices.high)}** gp`, inline: true },
      { name: '💰 Instant Sell', value: `**${formatNumber(prices.low)}** gp`, inline: true },
      { name: '📈 Spread', value: prices.high && prices.low ? `${formatNumber(prices.high - prices.low)} gp` : 'N/A', inline: true }
    );
  
  if (prices.highTime) {
    embed.addFields(
      { name: '⏰ High Time', value: formatTime(prices.highTime), inline: true },
      { name: '⏰ Low Time', value: formatTime(prices.lowTime), inline: true },
      { name: '📦 Buy Limit', value: item.limit ? `${item.limit.toLocaleString()}/4hr` : 'Unknown', inline: true }
    );
  }
  
  if (includeAnalysis) {
    const margin = calculateMargin(item.id);
    if (margin) {
      const profitColor = margin.margin > 0 ? '🟢' : '🔴';
      embed.addFields(
        { name: `${profitColor} Margin`, value: `${formatNumber(margin.margin)} gp (${margin.marginPercent.toFixed(1)}%)`, inline: true },
        { name: '💸 Tax', value: `${formatNumber(margin.tax)} gp`, inline: true },
        { name: '💎 Max Profit', value: margin.potentialProfit ? formatNumber(margin.potentialProfit) + ' gp' : 'Unknown', inline: true }
      );
    }
    
    const change1h = calculatePriceChange(item.id, 1);
    const change24h = calculatePriceChange(item.id, 24);
    if (change1h || change24h) {
      embed.addFields({
        name: '📉 Price Changes',
        value: [
          change1h ? `**1h:** ${change1h.changePercent >= 0 ? '📈' : '📉'} ${change1h.changePercent.toFixed(2)}%` : '',
          change24h ? `**24h:** ${change24h.changePercent >= 0 ? '📈' : '📉'} ${change24h.changePercent.toFixed(2)}%` : ''
        ].filter(Boolean).join('\n') || 'Not enough data',
        inline: false
      });
    }
  }
  
  embed.addFields({ name: '📝 Examine', value: item.examine || 'No examine text', inline: false });
  embed.setFooter({ iconURL: ICON_URL, text: `Item ID: ${item.id} | ${item.members ? 'Members' : 'F2P'} | High Alch: ${formatNumber(item.highalch)} gp` })
    .setTimestamp();
  
  return embed;
}

function buildFlipEmbed(flips) {
  const embed = new EmbedBuilder()
    .setTitle('💹 Best Flipping Opportunities')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setTimestamp()
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • GE Tracker` });
  
  if (!flips || flips.length === 0) {
    embed.setDescription('*No flipping opportunities found with those criteria.*\n\nTry lowering the minimum margin or buy limit.');
    return embed;
  }
  
  embed.setDescription('Items with the best margin-to-effort ratio:');
  
  const fields = flips.slice(0, 10).map((flip, i) => ({
    name: `${['🥇','🥈','🥉'][i] || `${i+1}.`} ${flip.item.name}`,
    value: [
      `**Buy:** ${formatNumber(flip.low)} → **Sell:** ${formatNumber(flip.high)}`,
      `**Margin:** ${formatNumber(flip.margin)} (${flip.marginPercent.toFixed(1)}%)`,
      `**Limit:** ${flip.buyLimit || '?'} • **Max:** ${formatNumber(flip.potentialProfit)}`
    ].join('\n'),
    inline: false
  }));
  
  embed.addFields(fields);
  return embed;
}

function buildMoversEmbed(movers, type = 'gainers', timeframe = '1h') {
  const isGainers = type === 'gainers';
  const data = isGainers ? movers.gainers : movers.losers;
  
  const embed = new EmbedBuilder()
    .setTitle(`${isGainers ? '🚀 Top Gainers' : '💥 Biggest Crashes'} (${timeframe})`)
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setTimestamp()
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • GE Tracker` });
  
  if (!data || data.length === 0) {
    embed.setDescription('*No significant movers found.*\n\nThe bot needs to collect price data over time. Check back in an hour or so.');
    return embed;
  }
  
  const list = data.slice(0, 15).map((m, i) => 
    `**${i + 1}.** ${m.item.name}\n` +
    `　　${isGainers ? '📈' : '📉'} **${m.changePercent.toFixed(2)}%** • ` +
    `${formatNumber(m.pastPrice)} → ${formatNumber(m.currentPrice)}`
  ).join('\n\n');
  
  embed.setDescription(list);
  return embed;
}

function buildAlertEmbed(alert) {
  const isCrash = alert.type === 'CRASH';
  const emoji = isCrash ? '🔻' : '🔺';
  const severityEmoji = alert.severity === 'SEVERE' ? '🚨' : '⚠️';
  
  return new EmbedBuilder()
    .setTitle(`${severityEmoji} ${emoji} ${alert.type} ALERT: ${alert.item.name}`)
    .setColor(EMBED_COLOR)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(alert.item.icon)}`)
    .addFields(
      { name: 'Price Change', value: `**${alert.change.changePercent.toFixed(2)}%**`, inline: true },
      { name: 'Movement', value: `${formatNumber(alert.change.pastPrice)} → ${formatNumber(alert.change.currentPrice)}`, inline: true },
      { name: 'GP Change', value: `${formatNumber(alert.change.changeAmount)} gp`, inline: true }
    )
    .setFooter({ iconURL: ICON_URL, text: `Severity: ${alert.severity} • ${BRAND_NAME}` })
    .setTimestamp();
}

function buildVolatilityEmbed(volatile) {
  const embed = new EmbedBuilder()
    .setTitle('🎢 Most Volatile Items (24h)')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setTimestamp()
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • GE Tracker` });
  
  if (!volatile || volatile.length === 0) {
    embed.setDescription('*No volatility data available yet.*\n\nThe bot needs to collect price data over time. Check back in an hour or so.');
    return embed;
  }
  
  const list = volatile.slice(0, 15).map((v, i) => 
    `**${i + 1}.** ${v.item.name}\n` +
    `　　📊 **${v.volatility}%** volatility • ${formatNumber(v.min)} - ${formatNumber(v.max)}`
  ).join('\n\n');
  
  embed.setDescription('High price swings - risky but potentially profitable:\n\n' + list);
  return embed;
}

/*────────────────────  GE Data Persistence  ────────────────────*/
function saveWatchlists() {
  const data = {};
  for (const [guildId, watchlist] of serverWatchlists) {
    data[guildId] = { channelId: watchlist.channelId, items: Array.from(watchlist.items) };
  }
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(data, null, 2));
}

function loadWatchlists() {
  try {
    if (fs.existsSync(WATCHLIST_FILE)) {
      const data = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
      for (const [guildId, watchlist] of Object.entries(data)) {
        serverWatchlists.set(guildId, { channelId: watchlist.channelId, items: new Set(watchlist.items) });
      }
      console.log(`✅ Loaded ${serverWatchlists.size} server watchlists`);
    }
  } catch (error) {
    console.error('❌ Failed to load watchlists:', error.message);
  }
}

function saveAlertConfigs() {
  const data = Object.fromEntries(serverAlertConfigs);
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(data, null, 2));
}

function loadAlertConfigs() {
  try {
    if (fs.existsSync(ALERTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
      for (const [guildId, config] of Object.entries(data)) {
        serverAlertConfigs.set(guildId, config);
      }
      console.log(`✅ Loaded ${serverAlertConfigs.size} alert configurations`);
    }
  } catch (error) {
    console.error('❌ Failed to load alert configs:', error.message);
  }
}

/*────────────────────  Alert Scanner  ──────────────────────────*/
async function scanForAlerts() {
  for (const [guildId, config] of serverAlertConfigs) {
    if (!config.enabled || !config.channelId) continue;
    
    const channel = client.channels.cache.get(config.channelId);
    if (!channel) continue;
    
    const watchlist = serverWatchlists.get(guildId);
    const itemsToCheck = watchlist?.items || new Set();
    
    if (itemsToCheck.size === 0) {
      for (const [itemId] of latestPrices) {
        const alerts = detectCrashOrSpike(itemId, { crash: config.crash, spike: config.spike });
        if (alerts && alerts[0].severity === 'SEVERE') {
          const item = itemMapping.get(itemId);
          if (item && item.limit && item.limit >= 100) {
            for (const alert of alerts) {
              const embed = buildAlertEmbed(alert);
              await channel.send({ embeds: [embed] }).catch(console.error);
            }
          }
        }
      }
    } else {
      for (const itemId of itemsToCheck) {
        const alerts = detectCrashOrSpike(itemId, { crash: config.crash, spike: config.spike });
        if (alerts) {
          for (const alert of alerts) {
            const embed = buildAlertEmbed(alert);
            await channel.send({ embeds: [embed] }).catch(console.error);
          }
        }
      }
    }
  }
}

/*────────────────────  Slash Commands  ─────────────────────────*/
const commands = [
  new SlashCommandBuilder()
    .setName('price')
    .setDescription('Get current GE price and analysis for an item')
    .addStringOption(opt => opt.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true)),
  
  new SlashCommandBuilder()
    .setName('flip')
    .setDescription('Find the best flipping opportunities')
    .addNumberOption(opt => opt.setName('min_margin').setDescription('Minimum margin % (default: 3)'))
    .addNumberOption(opt => opt.setName('min_limit').setDescription('Minimum buy limit (default: 100)')),
  
  new SlashCommandBuilder()
    .setName('gainers')
    .setDescription('Show items with biggest price increases')
    .addStringOption(opt => opt.setName('timeframe').setDescription('Time period')
      .addChoices({ name: '1 Hour', value: '1' }, { name: '6 Hours', value: '6' }, { name: '24 Hours', value: '24' })),
  
  new SlashCommandBuilder()
    .setName('crashes')
    .setDescription('Show items with biggest price drops')
    .addStringOption(opt => opt.setName('timeframe').setDescription('Time period')
      .addChoices({ name: '1 Hour', value: '1' }, { name: '6 Hours', value: '6' }, { name: '24 Hours', value: '24' })),
  
  new SlashCommandBuilder()
    .setName('volatile')
    .setDescription('Show the most volatile items'),
  
  new SlashCommandBuilder()
    .setName('compare')
    .setDescription('Compare prices of multiple items')
    .addStringOption(opt => opt.setName('items').setDescription('Comma-separated item names').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage your item watchlist')
    .addSubcommand(sub => sub.setName('add').setDescription('Add item').addStringOption(opt => opt.setName('item').setDescription('Item').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove item').addStringOption(opt => opt.setName('item').setDescription('Item').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName('view').setDescription('View watchlist'))
    .addSubcommand(sub => sub.setName('clear').setDescription('Clear watchlist')),
  
  new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Configure price alerts')
    .addSubcommand(sub => sub.setName('setup').setDescription('Enable alerts in this channel'))
    .addSubcommand(sub => sub.setName('config').setDescription('Configure thresholds')
      .addNumberOption(opt => opt.setName('crash').setDescription('Crash threshold %'))
      .addNumberOption(opt => opt.setName('spike').setDescription('Spike threshold %')))
    .addSubcommand(sub => sub.setName('stop').setDescription('Disable alerts')),
  
  new SlashCommandBuilder()
    .setName('margin')
    .setDescription('Calculate flip margin for an item')
    .addStringOption(opt => opt.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true))
    .addNumberOption(opt => opt.setName('buy_price').setDescription('Your buy price'))
    .addNumberOption(opt => opt.setName('sell_price').setDescription('Your sell price')),
  
  new SlashCommandBuilder()
    .setName('history')
    .setDescription('Get price history for an item')
    .addStringOption(opt => opt.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true))
    .addStringOption(opt => opt.setName('timeframe').setDescription('History timeframe')
      .addChoices({ name: '6 Hours', value: '5m' }, { name: '1 Week', value: '1h' }, { name: '2 Months', value: '6h' }, { name: '1 Year', value: '24h' })),
  
  new SlashCommandBuilder()
    .setName('alch')
    .setDescription('Find profitable high alch items')
    .addNumberOption(opt => opt.setName('min_profit').setDescription('Minimum profit per alch (default: 100)')),
  
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for items by name')
    .addStringOption(opt => opt.setName('query').setDescription('Search query').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('gestats')
    .setDescription('Show GE tracker statistics'),
  
  // Vengeance List Commands
  new SlashCommandBuilder()
    .setName('addveng')
    .setDescription('Add an RSN to the vengeance list')
    .addStringOption(opt => opt.setName('rsn').setDescription('RuneScape name to add').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for adding (optional)')),
  
  new SlashCommandBuilder()
    .setName('removeveng')
    .setDescription('Remove an RSN from the vengeance list')
    .addStringOption(opt => opt.setName('rsn').setDescription('RuneScape name to remove').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('venglist')
    .setDescription('Display the vengeance list'),
  
  new SlashCommandBuilder()
    .setName('clearveng')
    .setDescription('Clear the entire vengeance list'),
];

/*────────────────────  Command Handlers  ───────────────────────*/
async function handlePrice(interaction) {
  const query = interaction.options.getString('item');
  const item = findItem(query);
  
  if (!item) {
    return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });
  }
  
  const prices = latestPrices.get(item.id);
  if (!prices) {
    return interaction.reply({ content: `❌ No price data for ${item.name}.`, ephemeral: true });
  }
  
  const embed = buildItemEmbed(item, prices);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`watchlist_add_${item.id}`).setLabel('Add to Watchlist').setStyle(ButtonStyle.Primary).setEmoji('👁️'),
    new ButtonBuilder().setLabel('Wiki Page').setStyle(ButtonStyle.Link).setURL(`https://oldschool.runescape.wiki/w/${encodeURIComponent(item.name)}`),
    new ButtonBuilder().setLabel('Price Chart').setStyle(ButtonStyle.Link).setURL(`https://prices.runescape.wiki/osrs/item/${item.id}`)
  );
  
  return interaction.reply({ embeds: [embed], components: [row] });
}

async function handleFlip(interaction) {
  const minMargin = interaction.options.getNumber('min_margin') || 3;
  const minLimit = interaction.options.getNumber('min_limit') || 100;
  
  await interaction.deferReply();
  const flips = findBestFlips(minMargin, minLimit);
  
  if (flips.length === 0) {
    return interaction.editReply('❌ No flipping opportunities found with those criteria.');
  }
  
  return interaction.editReply({ embeds: [buildFlipEmbed(flips)] });
}

async function handleGainers(interaction) {
  const hours = parseInt(interaction.options.getString('timeframe') || '1');
  await interaction.deferReply();
  const movers = findBiggestMovers(hours);
  return interaction.editReply({ embeds: [buildMoversEmbed(movers, 'gainers', `${hours}h`)] });
}

async function handleCrashes(interaction) {
  const hours = parseInt(interaction.options.getString('timeframe') || '1');
  await interaction.deferReply();
  const movers = findBiggestMovers(hours);
  return interaction.editReply({ embeds: [buildMoversEmbed(movers, 'losers', `${hours}h`)] });
}

async function handleVolatile(interaction) {
  await interaction.deferReply();
  const volatile = findMostVolatile(20);
  return interaction.editReply({ embeds: [buildVolatilityEmbed(volatile)] });
}

async function handleCompare(interaction) {
  const itemsStr = interaction.options.getString('items');
  const queries = itemsStr.split(',').map(s => s.trim()).filter(Boolean);
  
  if (queries.length < 2) {
    return interaction.reply({ content: '❌ Provide at least 2 items, separated by commas.', ephemeral: true });
  }
  
  await interaction.deferReply();
  const items = queries.map(q => findItem(q)).filter(Boolean);
  
  if (items.length < 2) {
    return interaction.editReply('❌ Could not find enough valid items to compare.');
  }
  
  const embed = new EmbedBuilder()
    .setTitle('⚖️ Item Comparison')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setTimestamp()
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • GE Tracker` });
  
  items.forEach(item => {
    const prices = latestPrices.get(item.id);
    const margin = calculateMargin(item.id);
    const change = calculatePriceChange(item.id, 1);
    
    embed.addFields({
      name: item.name,
      value: [
        `**Buy:** ${formatNumber(prices?.high)} • **Sell:** ${formatNumber(prices?.low)}`,
        `**Margin:** ${margin ? `${formatNumber(margin.margin)} (${margin.marginPercent.toFixed(1)}%)` : 'N/A'}`,
        `**1h:** ${change ? `${change.changePercent.toFixed(2)}%` : 'N/A'} • **Limit:** ${item.limit || '?'}`
      ].join('\n'),
      inline: true
    });
  });
  
  return interaction.editReply({ embeds: [embed] });
}

async function handleWatchlist(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  
  if (!serverWatchlists.has(guildId)) {
    serverWatchlists.set(guildId, { channelId: null, items: new Set() });
  }
  
  const watchlist = serverWatchlists.get(guildId);
  
  switch (subcommand) {
    case 'add': {
      const query = interaction.options.getString('item');
      const item = findItem(query);
      if (!item) return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });
      watchlist.items.add(item.id);
      saveWatchlists();
      return interaction.reply({ content: `✅ Added **${item.name}** to watchlist!`, ephemeral: true });
    }
    case 'remove': {
      const query = interaction.options.getString('item');
      const item = findItem(query);
      if (!item || !watchlist.items.has(item.id)) return interaction.reply({ content: `❌ Item not in watchlist.`, ephemeral: true });
      watchlist.items.delete(item.id);
      saveWatchlists();
      return interaction.reply({ content: `✅ Removed **${item.name}** from watchlist.`, ephemeral: true });
    }
    case 'view': {
      if (watchlist.items.size === 0) return interaction.reply({ content: '📋 Watchlist is empty.', ephemeral: true });
      await interaction.deferReply();
      const embed = new EmbedBuilder().setTitle('👁️ Watchlist').setColor(EMBED_COLOR).setThumbnail(ICON_URL).setTimestamp().setFooter({ iconURL: ICON_URL, text: BRAND_NAME });
      const fields = [];
      for (const itemId of watchlist.items) {
        const item = itemMapping.get(itemId);
        const prices = latestPrices.get(itemId);
        const change = calculatePriceChange(itemId, 1);
        if (item && prices) {
          fields.push({
            name: item.name,
            value: `💰 ${formatNumber(prices.high)} / ${formatNumber(prices.low)}${change ? ` • ${change.changePercent >= 0 ? '📈' : '📉'} ${change.changePercent.toFixed(2)}%` : ''}`,
            inline: true
          });
        }
      }
      embed.addFields(fields);
      return interaction.editReply({ embeds: [embed] });
    }
    case 'clear': {
      watchlist.items.clear();
      saveWatchlists();
      return interaction.reply({ content: '✅ Watchlist cleared!', ephemeral: true });
    }
  }
}

async function handleAlerts(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  
  switch (subcommand) {
    case 'setup': {
      if (!serverAlertConfigs.has(guildId)) {
        serverAlertConfigs.set(guildId, { channelId: interaction.channelId, crash: GE_CONFIG.DEFAULT_CRASH_THRESHOLD, spike: GE_CONFIG.DEFAULT_SPIKE_THRESHOLD, enabled: true });
      } else {
        serverAlertConfigs.get(guildId).channelId = interaction.channelId;
        serverAlertConfigs.get(guildId).enabled = true;
      }
      saveAlertConfigs();
      const config = serverAlertConfigs.get(guildId);
      return interaction.reply({ content: `✅ Alerts enabled!\n📉 Crash: ${config.crash}%\n📈 Spike: +${config.spike}%`, ephemeral: true });
    }
    case 'config': {
      const crash = interaction.options.getNumber('crash');
      const spike = interaction.options.getNumber('spike');
      if (!serverAlertConfigs.has(guildId)) return interaction.reply({ content: '❌ Run `/alerts setup` first!', ephemeral: true });
      const config = serverAlertConfigs.get(guildId);
      if (crash !== null) config.crash = crash;
      if (spike !== null) config.spike = spike;
      saveAlertConfigs();
      return interaction.reply({ content: `✅ Updated!\n📉 Crash: ${config.crash}%\n📈 Spike: +${config.spike}%`, ephemeral: true });
    }
    case 'stop': {
      if (serverAlertConfigs.has(guildId)) {
        serverAlertConfigs.get(guildId).enabled = false;
        saveAlertConfigs();
      }
      return interaction.reply({ content: '✅ Alerts disabled.', ephemeral: true });
    }
  }
}

async function handleMargin(interaction) {
  const query = interaction.options.getString('item');
  const customBuy = interaction.options.getNumber('buy_price');
  const customSell = interaction.options.getNumber('sell_price');
  
  const item = findItem(query);
  if (!item) return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });
  
  const prices = latestPrices.get(item.id);
  if (!prices) return interaction.reply({ content: `❌ No price data for ${item.name}.`, ephemeral: true });
  
  const buyPrice = customBuy || prices.low;
  const sellPrice = customSell || prices.high;
  const taxRate = sellPrice >= 100 ? 0.01 : 0;
  const tax = Math.floor(sellPrice * taxRate);
  const margin = sellPrice - buyPrice - tax;
  const marginPercent = (margin / buyPrice) * 100;
  const limit = item.limit || 1;
  const maxProfit = margin * limit;
  
  const embed = new EmbedBuilder()
    .setTitle(`💹 Margin Calculator: ${item.name}`)
    .setColor(EMBED_COLOR)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
    .addFields(
      { name: '🛒 Buy Price', value: `${formatNumber(buyPrice)} gp`, inline: true },
      { name: '💰 Sell Price', value: `${formatNumber(sellPrice)} gp`, inline: true },
      { name: '💸 GE Tax', value: `${formatNumber(tax)} gp`, inline: true },
      { name: `${margin > 0 ? '✅' : '❌'} Margin`, value: `${formatNumber(margin)} gp (${marginPercent.toFixed(2)}%)`, inline: true },
      { name: '📦 Buy Limit', value: `${limit.toLocaleString()}/4hr`, inline: true },
      { name: '💎 Max Profit', value: `${formatNumber(maxProfit)} gp`, inline: true }
    )
    .setFooter({ iconURL: ICON_URL, text: customBuy || customSell ? 'Using custom prices' : 'Using market prices' })
    .setTimestamp();
  
  return interaction.reply({ embeds: [embed] });
}

async function handleHistory(interaction) {
  const query = interaction.options.getString('item');
  const timestep = interaction.options.getString('timeframe') || '5m';
  
  const item = findItem(query);
  if (!item) return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });
  
  await interaction.deferReply();
  const history = await fetchTimeseries(item.id, timestep);
  if (!history || history.length === 0) return interaction.editReply(`❌ No historical data for ${item.name}.`);
  
  const highs = history.map(h => h.avgHighPrice).filter(Boolean);
  const lows = history.map(h => h.avgLowPrice).filter(Boolean);
  const avgHigh = highs.length ? Math.round(highs.reduce((a, b) => a + b) / highs.length) : null;
  const avgLow = lows.length ? Math.round(lows.reduce((a, b) => a + b) / lows.length) : null;
  const maxHigh = highs.length ? Math.max(...highs) : null;
  const minLow = lows.length ? Math.min(...lows) : null;
  
  const current = history[history.length - 1];
  const oldest = history[0];
  const priceChange = current.avgHighPrice && oldest.avgHighPrice ? ((current.avgHighPrice - oldest.avgHighPrice) / oldest.avgHighPrice * 100).toFixed(2) : null;
  
  const timeframeNames = { '5m': '6 Hours', '1h': '1 Week', '6h': '2 Months', '24h': '1 Year' };
  
  const embed = new EmbedBuilder()
    .setTitle(`📈 Price History: ${item.name}`)
    .setColor(EMBED_COLOR)
    .setDescription(`**${timeframeNames[timestep]}** of data`)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
    .addFields(
      { name: '📊 Avg High', value: formatNumber(avgHigh), inline: true },
      { name: '📊 Avg Low', value: formatNumber(avgLow), inline: true },
      { name: '📈 Change', value: priceChange ? `${priceChange}%` : 'N/A', inline: true },
      { name: '⬆️ Highest', value: formatNumber(maxHigh), inline: true },
      { name: '⬇️ Lowest', value: formatNumber(minLow), inline: true },
      { name: '📉 Range', value: maxHigh && minLow ? formatNumber(maxHigh - minLow) : 'N/A', inline: true }
    )
    .setFooter({ iconURL: ICON_URL, text: `${history.length} data points` })
    .setTimestamp();
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('View Chart').setStyle(ButtonStyle.Link).setURL(`https://prices.runescape.wiki/osrs/item/${item.id}`)
  );
  
  return interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleAlch(interaction) {
  const minProfit = interaction.options.getNumber('min_profit') || 100;
  const natureRunePrice = latestPrices.get(561)?.high || 150;
  
  await interaction.deferReply();
  const profitable = [];
  
  for (const [itemId, item] of itemMapping) {
    if (!item.highalch) continue;
    const prices = latestPrices.get(itemId);
    if (!prices?.high) continue;
    const profit = item.highalch - prices.high - natureRunePrice;
    if (profit >= minProfit) {
      profitable.push({ item, buyPrice: prices.high, alchValue: item.highalch, profit, limit: item.limit || 'Unknown' });
    }
  }
  
  profitable.sort((a, b) => b.profit - a.profit);
  
  if (profitable.length === 0) return interaction.editReply(`❌ No items with ${formatNumber(minProfit)}+ gp profit per alch.`);
  
  const embed = new EmbedBuilder()
    .setTitle('🔮 Profitable High Alch Items')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setDescription(`**${formatNumber(minProfit)}+** gp profit (Nature: ${formatNumber(natureRunePrice)} gp)`)
    .setTimestamp()
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • GE Tracker` });
  
  const list = profitable.slice(0, 15).map((p, i) =>
    `**${i + 1}.** ${p.item.name}\n　　Buy: ${formatNumber(p.buyPrice)} • Alch: ${formatNumber(p.alchValue)} • **+${formatNumber(p.profit)}**`
  ).join('\n\n');
  
  embed.setDescription(embed.data.description + '\n\n' + list);
  return interaction.editReply({ embeds: [embed] });
}

async function handleSearch(interaction) {
  const query = interaction.options.getString('query');
  const results = searchItems(query, 20);
  
  if (results.length === 0) return interaction.reply({ content: `❌ No items matching "${query}".`, ephemeral: true });
  
  const embed = new EmbedBuilder()
    .setTitle(`🔍 Search: "${query}"`)
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setDescription(results.map((item, i) => {
      const prices = latestPrices.get(item.id);
      return `**${i + 1}.** ${item.name} — ${prices?.high ? formatNumber(prices.high) : 'No data'} gp`;
    }).join('\n'))
    .setFooter({ iconURL: ICON_URL, text: `${results.length} results` })
    .setTimestamp();
  
  return interaction.reply({ embeds: [embed] });
}

async function handleGEStats(interaction) {
  await interaction.deferReply();
  
  const trackedItems = latestPrices.size;
  const watchlistCount = Array.from(serverWatchlists.values()).reduce((sum, w) => sum + w.items.size, 0);
  const alertServers = Array.from(serverAlertConfigs.values()).filter(c => c.enabled).length;
  
  const movers1h = findBiggestMovers(1);
  const topGainer = movers1h.gainers[0];
  const topLoser = movers1h.losers[0];
  
  const embed = new EmbedBuilder()
    .setTitle('📊 GE Tracker Stats')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .addFields(
      { name: '📈 Items Tracked', value: trackedItems.toLocaleString(), inline: true },
      { name: '🏠 Servers', value: client.guilds.cache.size.toString(), inline: true },
      { name: '👁️ Watchlist Items', value: watchlistCount.toString(), inline: true },
      { name: '🔔 Alert Channels', value: alertServers.toString(), inline: true }
    );
  
  if (topGainer) embed.addFields({ name: '🚀 Top Gainer (1h)', value: `${topGainer.item.name}: +${topGainer.changePercent.toFixed(2)}%`, inline: true });
  if (topLoser) embed.addFields({ name: '💥 Top Crash (1h)', value: `${topLoser.item.name}: ${topLoser.changePercent.toFixed(2)}%`, inline: true });
  
  embed.setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • OSRS Wiki API` }).setTimestamp();
  
  return interaction.editReply({ embeds: [embed] });
}

/*────────────────────  Vengeance List Handlers  ────────────────*/
async function handleAddVeng(interaction) {
  const rsn = interaction.options.getString('rsn').trim();
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const addedBy = interaction.user.tag;
  
  const existing = vengList.find(v => v.rsn.toLowerCase() === rsn.toLowerCase());
  if (existing) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('⚠️ Already Listed')
        .setDescription(`**${rsn}** is already on the vengeance list.`)
        .setColor(EMBED_COLOR)
        .setThumbnail(ICON_URL)
        .setFooter({ iconURL: ICON_URL, text: BRAND_NAME })
      ],
      ephemeral: true
    });
  }
  
  vengList.push({
    rsn,
    reason,
    addedBy,
    addedAt: new Date().toISOString()
  });
  saveVengList();
  
  const embed = new EmbedBuilder()
    .setTitle('⚔️ Added to Vengeance List')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .addFields(
      { name: '👤 RSN', value: `\`${rsn}\``, inline: true },
      { name: '📝 Reason', value: reason, inline: true },
      { name: '➕ Added By', value: addedBy, inline: true }
    )
    .setFooter({ iconURL: ICON_URL, text: `Total on list: ${vengList.length}` })
    .setTimestamp();
  
  return interaction.reply({ embeds: [embed] });
}

async function handleRemoveVeng(interaction) {
  const rsn = interaction.options.getString('rsn').trim();
  const index = vengList.findIndex(v => v.rsn.toLowerCase() === rsn.toLowerCase());
  
  if (index === -1) {
    return interaction.reply({
      embeds: [errorEmbed(`**${rsn}** is not on the vengeance list.`)],
      ephemeral: true
    });
  }
  
  const removed = vengList.splice(index, 1)[0];
  saveVengList();
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Removed from Vengeance List')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .addFields(
      { name: '👤 RSN', value: `\`${removed.rsn}\``, inline: true },
      { name: '📝 Was Listed For', value: removed.reason, inline: true }
    )
    .setFooter({ iconURL: ICON_URL, text: `Remaining on list: ${vengList.length}` })
    .setTimestamp();
  
  return interaction.reply({ embeds: [embed] });
}

async function handleVengList(interaction) {
  if (vengList.length === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('⚔️ Vengeance List')
        .setDescription('*The vengeance list is empty.*\n\nUse `/addveng <RSN>` to add someone.')
        .setColor(EMBED_COLOR)
        .setThumbnail(ICON_URL)
        .setFooter({ iconURL: ICON_URL, text: BRAND_NAME })
      ]
    });
  }
  
  // Create the RSN list string
  const rsnList = vengList.map(v => v.rsn).join(', ');
  
  // Build detailed list
  const detailedList = vengList.map((v, i) => {
    const addedDate = new Date(v.addedAt);
    return `**${i + 1}.** \`${v.rsn}\`\n　　📝 ${v.reason}\n　　➕ ${v.addedBy} • <t:${Math.floor(addedDate.getTime() / 1000)}:R>`;
  }).join('\n\n');
  
  const embed = new EmbedBuilder()
    .setTitle('⚔️ Vengeance List')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setDescription(`**Quick Copy:**\n\`\`\`${rsnList}\`\`\``)
    .addFields({ name: `📋 Full List (${vengList.length})`, value: detailedList.slice(0, 1024) })
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • Kill on sight` })
    .setTimestamp();
  
  // If list is too long, add continuation
  if (detailedList.length > 1024) {
    embed.addFields({ name: '\u200B', value: detailedList.slice(1024, 2048) });
  }
  
  return interaction.reply({ embeds: [embed] });
}

async function handleClearVeng(interaction) {
  const count = vengList.length;
  vengList = [];
  saveVengList();
  
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Vengeance List Cleared')
    .setDescription(`Removed **${count}** entries from the list.`)
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setFooter({ iconURL: ICON_URL, text: BRAND_NAME })
    .setTimestamp();
  
  return interaction.reply({ embeds: [embed] });
}

/*────────────────────  Autocomplete Handler  ───────────────────*/
async function handleAutocomplete(interaction) {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  if (focusedValue.length < 2) return interaction.respond([]);
  
  const matches = searchItems(focusedValue, 25);
  const choices = matches.map(item => ({
    name: `${item.name} (${formatNumber(latestPrices.get(item.id)?.high || 0)} gp)`,
    value: item.name
  }));
  
  return interaction.respond(choices);
}

/*────────────────────  Button Handler  ─────────────────────────*/
async function handleButton(interaction) {
  const [action, type, itemId] = interaction.customId.split('_');
  
  if (action === 'watchlist' && type === 'add') {
    const guildId = interaction.guildId;
    if (!serverWatchlists.has(guildId)) {
      serverWatchlists.set(guildId, { channelId: null, items: new Set() });
    }
    const watchlist = serverWatchlists.get(guildId);
    const id = parseInt(itemId);
    const item = itemMapping.get(id);
    
    if (watchlist.items.has(id)) {
      return interaction.reply({ content: `ℹ️ **${item?.name}** already in watchlist.`, ephemeral: true });
    }
    
    watchlist.items.add(id);
    saveWatchlists();
    return interaction.reply({ content: `✅ Added **${item?.name}** to watchlist!`, ephemeral: true });
  }
}

/*────────────────────  Command Registration  ───────────────────*/
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  
  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.toJSON()) });
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
}

/*────────────────────  Event Handlers  ─────────────────────────*/
client.once('ready', async () => {
  console.log(`\n🤖 Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} servers`);
  
  // Load data
  loadWatchlists();
  loadAlertConfigs();
  
  // Fetch GE data
  console.log('\n📡 Fetching GE market data...');
  await fetchMapping();
  await fetchLatestPrices();
  
  // Register commands
  await registerCommands();
  
  // Set activity
  client.user.setActivity('the GE 📈', { type: 3 }); // Watching
  
  // Start price update loop
  setInterval(async () => {
    await fetchLatestPrices();
    await scanForAlerts();
  }, GE_CONFIG.SCAN_INTERVAL);
  
  console.log('\n✅ Bot is ready!\n');
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      return handleAutocomplete(interaction);
    }
    
    if (interaction.isButton()) {
      return handleButton(interaction);
    }
    
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName } = interaction;
    
    switch (commandName) {
      case 'price': return handlePrice(interaction);
      case 'flip': return handleFlip(interaction);
      case 'gainers': return handleGainers(interaction);
      case 'crashes': return handleCrashes(interaction);
      case 'volatile': return handleVolatile(interaction);
      case 'compare': return handleCompare(interaction);
      case 'watchlist': return handleWatchlist(interaction);
      case 'alerts': return handleAlerts(interaction);
      case 'margin': return handleMargin(interaction);
      case 'history': return handleHistory(interaction);
      case 'alch': return handleAlch(interaction);
      case 'search': return handleSearch(interaction);
      case 'gestats': return handleGEStats(interaction);
      case 'addveng': return handleAddVeng(interaction);
      case 'removeveng': return handleRemoveVeng(interaction);
      case 'venglist': return handleVengList(interaction);
      case 'clearveng': return handleClearVeng(interaction);
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    const reply = { content: '❌ An error occurred.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(console.error);
    } else {
      await interaction.reply(reply).catch(console.error);
    }
  }
});

client.login(process.env.TOKEN);

/*────────────────────  Health Check Server  ────────────────────*/
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    bot: client.user?.tag || 'Starting...',
    servers: client.guilds?.cache.size || 0,
    itemsTracked: latestPrices.size,
    uptime: process.uptime()
  });
});

app.get('/health', (req, res) => {
  res.send('OK');
});

app.listen(PORT, () => {
  console.log(`🌐 Health check server running on port ${PORT}`);
});
