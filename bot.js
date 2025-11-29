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

const ICON_URL      = 'https://i.ibb.co/BVMTHSzM/Y-W-2.png'; // Placeholder - update later
const EMBED_COLOR   = 0x000000;
const BRAND_NAME    = 'The Crater';

const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const VENG_FILE     = path.join(DATA_DIR, 'venglist.json');
const WATCHLIST_FILE = path.join(DATA_DIR, 'ge_watchlists.json');
const ALERTS_FILE    = path.join(DATA_DIR, 'ge_alerts.json');

// ── Extra persistence files ───────────────────────────────────
const PRICE_TARGETS_FILE = path.join(DATA_DIR, 'ge_price_targets.json');
const MARGIN_ALERTS_FILE = path.join(DATA_DIR, 'ge_margin_alerts.json');
const PORTFOLIOS_FILE    = path.join(DATA_DIR, 'ge_portfolios.json');
const REPORTS_FILE       = path.join(DATA_DIR, 'ge_reports.json');

// ── Extra in-memory stores ────────────────────────────────────
let priceTargets   = new Map();   // guildId -> [{ userId,itemId,target,direction,channelId,createdAt }]
let marginAlerts   = new Map();   // guildId -> [{ userId,itemId,threshold,channelId,createdAt }]
let portfolios     = new Map();   // guildId -> Map<userId,{ trades: [...] }>
let reportConfigs  = new Map();   // guildId -> { channelId,hour,minute,enabled,lastSentDate }
let crashStats     = new Map();   // itemId -> { crashes,lastChangePercent }
let volumeCache    = new Map();   // itemId -> { lastFetched, mean, latest }


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

    const buyLimit = typeof margin.buyLimit === 'number' ? margin.buyLimit : (item.limit || 0);
    const capital  = prices.low * (buyLimit || 1);
    const profitPer4h = buyLimit ? margin.margin * buyLimit : margin.margin;
    const roi4hPct = capital > 0 ? (profitPer4h / capital) * 100 : 0;
    const roiPerHour = roi4hPct / 4;

    flips.push({
      item,
      ...margin,
      capital,
      profitPer4h,
      roiPerHour,
      score: (margin.marginPercent * Math.log10((margin.potentialProfit || margin.margin) + 10)) + (roiPerHour * 0.6)
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

/*────────────────────  Extra Analytics Helpers  ─────────────────*/

// ASCII sparkline for history
const SPARK_CHARS = ['▁','▂','▃','▄','▅','▆','▇','█'];
function generateSparkline(values, width = 24) {
  if (!values || values.length === 0) return 'N/A';
  const arr = values.filter(v => typeof v === 'number' && !isNaN(v));
  if (!arr.length) return 'N/A';
  const step = Math.max(1, Math.floor(arr.length / width));
  const samples = [];
  for (let i = 0; i < arr.length; i += step) {
    samples.push(arr[i]);
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  if (max === min) return '▁'.repeat(samples.length);
  return samples.map(v => {
    const norm = (v - min) / (max - min);
    const idx = Math.min(SPARK_CHARS.length - 1, Math.floor(norm * SPARK_CHARS.length));
    return SPARK_CHARS[idx];
  }).join('');
}

// Pearson correlation between two arrays
function pearsonCorrelation(a, b) {
  const len = Math.min(a.length, b.length);
  if (len < 5) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0, n = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x == null || y == null || isNaN(x) || isNaN(y)) continue;
    n++;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }
  if (n < 5) return null;
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (!den) return null;
  return num / den;
}

// Find top correlations for one item
function findTopCorrelations(baseItemId, limit = 10) {
  const baseHistory = priceHistory.get(baseItemId);
  if (!baseHistory || baseHistory.length < 10) return [];
  const baseSeries = baseHistory.map(h => h.high).filter(Boolean);
  const results = [];

  for (const [itemId, hist] of priceHistory) {
    if (itemId === baseItemId) continue;
    if (!hist || hist.length < 10) continue;
    const series = hist.map(h => h.high).filter(Boolean);
    const r = pearsonCorrelation(baseSeries, series);
    if (r === null || isNaN(r)) continue;
    results.push({ itemId, r });
  }

  results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return results.slice(0, limit);
}

// Portfolio maths
function ensurePortfolio(guildId, userId) {
  if (!portfolios.has(guildId)) portfolios.set(guildId, new Map());
  const guildMap = portfolios.get(guildId);
  if (!guildMap.has(userId)) guildMap.set(userId, { trades: [] });
  return guildMap.get(userId);
}

function computePortfolioSummary(trades) {
  // trades: [{ type: 'BUY'|'SELL', itemId, qty, price, timestamp }]
  const holdings = new Map(); // itemId -> { qty, costBasis }
  let realised = 0;

  const sorted = [...trades].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  for (const t of sorted) {
    const entry = holdings.get(t.itemId) || { qty: 0, costBasis: 0 };
    if (t.type === 'BUY') {
      const totalCost = entry.costBasis * entry.qty + t.price * t.qty;
      const newQty    = entry.qty + t.qty;
      entry.qty       = newQty;
      entry.costBasis = newQty > 0 ? totalCost / newQty : 0;
    } else if (t.type === 'SELL') {
      const sellQty = Math.min(entry.qty, t.qty);
      if (sellQty > 0) {
        const cost = entry.costBasis * sellQty;
        const rev  = t.price * sellQty;
        realised  += (rev - cost);
        entry.qty -= sellQty;
      }
    }
    holdings.set(t.itemId, entry);
  }

  let invested = 0;
  let currentValue = 0;

  for (const [itemId, h] of holdings) {
    if (h.qty <= 0) continue;
    invested += h.costBasis * h.qty;
    const prices = latestPrices.get(itemId);
    if (prices?.high) {
      currentValue += prices.high * h.qty;
    }
  }

  const unrealised = currentValue - invested;
  const totalPnl   = realised + unrealised;

  return { holdings, realised, invested, currentValue, unrealised, totalPnl };
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
    const stat = crashStats.get(itemId) || { crashes: 0, lastChangePercent: 0 };
    stat.crashes += 1;
    stat.lastChangePercent = change.changePercent;
    crashStats.set(itemId, stat);
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

async function detectVolumeSpike(itemId, multiplier = 3) {
  const now = Date.now();
  const cached = volumeCache.get(itemId);
  if (cached && now - cached.lastFetched < 10 * 60 * 1000) {
    // only check every 10 minutes per item
    return null;
  }

  const data = await fetchTimeseries(itemId, '1h');
  if (!data || data.length < 5) return null;

  const volumes = data.map(h => {
    const hi = h.avgHighPriceVolume || 0;
    const lo = h.avgLowPriceVolume || 0;
    return hi + lo;
  }).filter(v => v > 0);

  if (volumes.length < 5) return null;

  const latest = volumes[volumes.length - 1];
  const base   = volumes.slice(0, -1);
  const mean   = base.reduce((a, b) => a + b, 0) / base.length;

  volumeCache.set(itemId, { lastFetched: now, mean, latest });

  if (latest >= mean * multiplier && latest >= 100) {
    return { latest, mean, factor: latest / mean };
  }
  return null;
}

function buildVolumeSpikeEmbed(item, volInfo) {
  return new EmbedBuilder()
    .setTitle(`📊 Volume Spike: ${item.name}`)
    .setColor(EMBED_COLOR)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
    .setDescription(
      `Unusual trading activity detected.\n\n` +
      `Latest volume: **${formatNumber(volInfo.latest)}**\n` +
      `Baseline: **${formatNumber(Math.round(volInfo.mean))}**\n` +
      `Spike factor: **${volInfo.factor.toFixed(2)}×**`
    )
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • Volume Spike Alert` })
    .setTimestamp();
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
    .setTitle('💹 Best Flipping Opportunities (Pro)')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setTimestamp()
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • GE Tracker` });

  if (!flips || flips.length === 0) {
    embed.setDescription('*No flipping opportunities found with those criteria.*\n\nTry lowering the minimum margin or buy limit.');
    return embed;
  }

  embed.setDescription('Ranked by tax-adjusted margin and estimated ROI/hour:');

  const fields = flips.slice(0, 10).map((flip, i) => ({
    name: `${['🥇','🥈','🥉'][i] || `${i + 1}.`} ${flip.item.name}`,
    value: [
      `**Buy:** ${formatNumber(flip.low)} → **Sell:** ${formatNumber(flip.high)}`,
      `**Margin:** ${formatNumber(flip.margin)} (${flip.marginPercent.toFixed(1)}%)`,
      `**Limit:** ${flip.buyLimit || '?'} • **Max 4h Profit:** ${formatNumber(flip.profitPer4h)} gp`,
      `**Capital Needed:** ${formatNumber(flip.capital)} gp`,
      `**Est. ROI:** ${flip.roiPerHour.toFixed(2)}% / hour`
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
  // Crash/spike alerts
  for (const [guildId, config] of serverAlertConfigs) {
    if (!config.enabled || !config.channelId) continue;

    const channel = client.channels.cache.get(config.channelId);
    if (!channel) continue;

    const watchlist = serverWatchlists.get(guildId);
    const itemsToCheck = watchlist?.items || new Set();

    if (itemsToCheck.size === 0) {
      // Severe, global, high-limit items
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

  // Smart alerts
  await scanPriceTargets();
  await scanMarginAlerts();
  await scanVolumeSpikes();
}


async function scanPriceTargets() {
  for (const [guildId, targets] of priceTargets) {
    if (!targets || !targets.length) continue;

    const remaining = [];
    for (const t of targets) {
      const prices = latestPrices.get(t.itemId);
      const item   = itemMapping.get(t.itemId);
      if (!item || !prices?.high) {
        remaining.push(t);
        continue;
      }

      const hit = t.direction === 'above'
        ? prices.high >= t.target
        : prices.high <= t.target;

      if (!hit) {
        remaining.push(t);
        continue;
      }

      const channel = client.channels.cache.get(t.channelId);
      if (!channel) continue;

      await channel.send({
        content: `<@${t.userId}>`,
        embeds: [
          new EmbedBuilder()
            .setTitle('🎯 Price Target Hit')
            .setColor(EMBED_COLOR)
            .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
            .setDescription(
              `**${item.name}** has hit your target.\n` +
              `Direction: **${t.direction.toUpperCase()}**\n` +
              `Target: **${formatNumber(t.target)} gp**\n` +
              `Current: **${formatNumber(prices.high)} gp (instant buy)**`
            )
            .setFooter({ iconURL: ICON_URL, text: BRAND_NAME })
            .setTimestamp()
        ]
      }).catch(console.error);
    }
    priceTargets.set(guildId, remaining);
  }
  savePriceTargets();
}

async function scanMarginAlerts() {
  for (const [guildId, alerts] of marginAlerts) {
    if (!alerts || !alerts.length) continue;

    const keep = [];
    for (const a of alerts) {
      const margin = calculateMargin(a.itemId);
      const item   = itemMapping.get(a.itemId);
      if (!item || !margin) {
        keep.push(a);
        continue;
      }

      if (margin.marginPercent < a.threshold) {
        keep.push(a);
        continue;
      }

      const channel = client.channels.cache.get(a.channelId);
      if (!channel) continue;

      await channel.send({
        content: `<@${a.userId}>`,
        embeds: [
          new EmbedBuilder()
            .setTitle('📈 Margin Alert')
            .setColor(EMBED_COLOR)
            .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
            .setDescription(
              `**${item.name}** margin is now above **${a.threshold}%**.\n` +
              `Current: **${margin.marginPercent.toFixed(2)}%**\n` +
              `Raw margin: **${formatNumber(margin.margin)} gp**`
            )
            .setFooter({ iconURL: ICON_URL, text: BRAND_NAME })
            .setTimestamp()
        ]
      }).catch(console.error);
    }
    marginAlerts.set(guildId, keep);
  }
  saveMarginAlerts();
}

async function scanVolumeSpikes() {
  for (const [guildId, config] of serverAlertConfigs) {
    if (!config.enabled || !config.channelId || !config.volumeMultiplier) continue;
    const watchlist = serverWatchlists.get(guildId);
    if (!watchlist || !watchlist.items || watchlist.items.size === 0) continue;

    const channel = client.channels.cache.get(config.channelId);
    if (!channel) continue;

    for (const itemId of watchlist.items) {
      const item = itemMapping.get(itemId);
      if (!item) continue;

      try {
        const info = await detectVolumeSpike(itemId, config.volumeMultiplier);
        if (!info) continue;
        const embed = buildVolumeSpikeEmbed(item, info);
        await channel.send({ embeds: [embed] }).catch(console.error);
      } catch (err) {
        console.error('volume spike error:', err.message);
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
      .addNumberOption(opt => opt.setName('spike').setDescription('Spike threshold %'))
      .addNumberOption(opt => opt.setName('volume_multiplier').setDescription('Volume spike multiplier (e.g. 3 = 3×)')))
    .addSubcommand(sub => sub.setName('stop').setDescription('Disable alerts')),

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
	
	  new SlashCommandBuilder()
    .setName('pricetarget')
    .setDescription('Manage custom price target alerts')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a price target for an item')
      .addStringOption(opt => opt.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true))
      .addNumberOption(opt => opt.setName('price').setDescription('Target price in gp').setRequired(true))
      .addStringOption(opt => opt.setName('direction').setDescription('Alert when price goes above or below')
        .addChoices(
          { name: 'Above or equal', value: 'above' },
          { name: 'Below or equal', value: 'below' }
        )
        .setRequired(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a price target for an item')
      .addStringOption(opt => opt.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List your price targets')
    )
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear all your price targets')
    ),

  new SlashCommandBuilder()
    .setName('marginalert')
    .setDescription('Alert when an item margin exceeds a threshold')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a margin alert')
      .addStringOption(opt => opt.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true))
      .addNumberOption(opt => opt.setName('margin').setDescription('Margin % threshold').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a margin alert for an item')
      .addStringOption(opt => opt.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List your margin alerts')
    )
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear all your margin alerts')
    ),

  new SlashCommandBuilder()
    .setName('portfolio')
    .setDescription('Track your flips and performance')
    .addSubcommand(sub => sub
      .setName('buy')
      .setDescription('Log a buy')
      .addStringOption(opt => opt.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true))
      .addNumberOption(opt => opt.setName('quantity').setDescription('Quantity').setRequired(true))
      .addNumberOption(opt => opt.setName('price').setDescription('Price per item (gp)').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('sell')
      .setDescription('Log a sell')
      .addStringOption(opt => opt.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true))
      .addNumberOption(opt => opt.setName('quantity').setDescription('Quantity').setRequired(true))
      .addNumberOption(opt => opt.setName('price').setDescription('Price per item (gp)').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('summary')
      .setDescription('View your portfolio summary')
    )
    .addSubcommand(sub => sub
      .setName('history')
      .setDescription('View your recent flip history')
      .addNumberOption(opt => opt.setName('limit').setDescription('Number of entries (default 10)'))
    )
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear all your logged flips')
    ),

  new SlashCommandBuilder()
    .setName('flipleaderboard')
    .setDescription('Show top flippers in this server'),

  new SlashCommandBuilder()
    .setName('reports')
    .setDescription('Configure daily GE market summary reports')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Enable a daily report in this channel (UTC)')
      .addIntegerOption(opt => opt.setName('hour').setDescription('Hour (0-23, UTC)').setRequired(true))
      .addIntegerOption(opt => opt.setName('minute').setDescription('Minute (0-59)').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('stop')
      .setDescription('Disable daily reports for this server')
    )
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Show current report configuration')
    )
    .addSubcommand(sub => sub
      .setName('runnow')
      .setDescription('Send a market summary now in this channel')
    ),

  new SlashCommandBuilder()
    .setName('crashpredictor')
    .setDescription('Show items with frequent recent crashes'),

  new SlashCommandBuilder()
    .setName('manipulation')
    .setDescription('Scan for unusual price activity (pump & dump style)'),  

  new SlashCommandBuilder()
    .setName('correlate')
    .setDescription('Find items that move with a given item')
    .addStringOption(opt => opt.setName('item').setDescription('Base item').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('seasonality')
    .setDescription('Check simple day-of-week seasonality for an item')
    .addStringOption(opt => opt.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true)),

  
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
        serverAlertConfigs.set(guildId, {
          channelId: interaction.channelId,
          crash: GE_CONFIG.DEFAULT_CRASH_THRESHOLD,
          spike: GE_CONFIG.DEFAULT_SPIKE_THRESHOLD,
          volumeMultiplier: 3,
          enabled: true
        });
      } else {
        const cfg = serverAlertConfigs.get(guildId);
        cfg.channelId = interaction.channelId;
        cfg.enabled   = true;
        if (cfg.volumeMultiplier == null) cfg.volumeMultiplier = 3;
      }
      saveAlertConfigs();
      const config = serverAlertConfigs.get(guildId);
      return interaction.reply({
        content: `✅ Alerts enabled!\n📉 Crash: ${config.crash}%\n📈 Spike: +${config.spike}%\n📊 Volume spike: ${config.volumeMultiplier}× baseline`,
        ephemeral: true
      });
    }
    case 'config': {
      const crash = interaction.options.getNumber('crash');
      const spike = interaction.options.getNumber('spike');
      const volumeMultiplier = interaction.options.getNumber('volume_multiplier');

      if (!serverAlertConfigs.has(guildId)) {
        return interaction.reply({
          content: '❌ Run `/alerts setup` first!',
          ephemeral: true
        });
      }

      const config = serverAlertConfigs.get(guildId);
      if (crash !== null) config.crash = crash;
      if (spike !== null) config.spike = spike;
      if (volumeMultiplier !== null) config.volumeMultiplier = volumeMultiplier;
      saveAlertConfigs();

      return interaction.reply({
        content:
          `✅ Updated!\n` +
          `📉 Crash: ${config.crash}%\n` +
          `📈 Spike: +${config.spike}%\n` +
          (config.volumeMultiplier ? `📊 Volume spike: ${config.volumeMultiplier}× baseline` : ''),
        ephemeral: true
      });
    }

    case 'stop': {
      if (!serverAlertConfigs.has(guildId)) {
        return interaction.reply({
          content: 'ℹ️ Alerts are not configured for this server.',
          ephemeral: true
        });
      }

      const config = serverAlertConfigs.get(guildId);
      config.enabled = false;
      saveAlertConfigs();

      return interaction.reply({
        content: '✅ Alerts disabled for this server.',
        ephemeral: true
      });
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
  const lows  = history.map(h => h.avgLowPrice).filter(Boolean);
  const avgHigh = highs.length ? Math.round(highs.reduce((a, b) => a + b) / highs.length) : null;
  const avgLow  = lows.length ? Math.round(lows.reduce((a, b) => a + b) / lows.length) : null;
  const maxHigh = highs.length ? Math.max(...highs) : null;
  const minLow  = lows.length ? Math.min(...lows) : null;

  const current = history[history.length - 1];
  const oldest  = history[0];
  const priceChange = current.avgHighPrice && oldest.avgHighPrice
    ? ((current.avgHighPrice - oldest.avgHighPrice) / oldest.avgHighPrice * 100).toFixed(2)
    : null;

  const timeframeNames = { '5m': '6 Hours', '1h': '1 Week', '6h': '2 Months', '24h': '1 Year' };

  const sparkline = generateSparkline(highs.length ? highs : lows);

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
      { name: '📉 Range', value: maxHigh && minLow ? formatNumber(maxHigh - minLow) : 'N/A', inline: true },
      { name: '📊 Sparkline', value: `\`\`${sparkline}\`\``, inline: false }
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
  const raw = interaction.options.getString('rsn').trim();
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const addedBy = interaction.user.tag;

  const names = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) {
    return interaction.reply({
      embeds: [errorEmbed('Please provide at least one RSN.')],
      ephemeral: true
    });
  }

  let added = 0;
  let already = 0;

  for (const rsn of names) {
    const existing = vengList.find(v => v.rsn.toLowerCase() === rsn.toLowerCase());
    if (existing) {
      already++;
      continue;
    }
    vengList.push({
      rsn,
      reason,
      addedBy,
      addedAt: new Date().toISOString()
    });
    added++;
  }

  saveVengList();

  const embed = new EmbedBuilder()
    .setTitle('⚔️ Vengeance List Updated')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setFooter({ iconURL: ICON_URL, text: `Total on list: ${vengList.length}` })
    .setTimestamp();

  const lines = [];
  if (added)   lines.push(`✅ Added **${added}** RSN(s) to the list.`);
  if (already) lines.push(`ℹ️ **${already}** RSN(s) were already on the list.`);
  lines.push(`Reason: ${reason}`);
  lines.push(`Added by: ${addedBy}`);

  embed.setDescription(lines.join('\n'));
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

/*────────────────────  Smart Alert Handlers  ───────────────────*/

async function handlePriceTarget(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;

  if (!priceTargets.has(guildId)) priceTargets.set(guildId, []);
  const list = priceTargets.get(guildId);

  if (sub === 'add') {
    const query = interaction.options.getString('item');
    const item  = findItem(query);
    if (!item) return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });

    const price = interaction.options.getNumber('price');
    const direction = interaction.options.getString('direction');

    list.push({
      userId,
      itemId: item.id,
      target: price,
      direction,
      channelId: interaction.channelId,
      createdAt: new Date().toISOString()
    });
    savePriceTargets();

    return interaction.reply({
      content: `✅ Price target set for **${item.name}** at **${formatNumber(price)} gp (${direction})**.`,
      ephemeral: true
    });
  }

  if (sub === 'remove') {
    const query = interaction.options.getString('item');
    const item  = findItem(query);
    if (!item) return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });

    const before = list.length;
    const after  = list.filter(t => !(t.userId === userId && t.itemId === item.id));
    priceTargets.set(guildId, after);
    savePriceTargets();

    const removed = before - after.length;
    return interaction.reply({
      content: removed ? `✅ Removed **${removed}** price target(s) for **${item.name}**.` : `ℹ️ You had no price targets for **${item.name}**.`,
      ephemeral: true
    });
  }

  if (sub === 'list') {
    const userTargets = list.filter(t => t.userId === userId);
    if (!userTargets.length) return interaction.reply({ content: 'ℹ️ You have no price targets set.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle('🎯 Your Price Targets')
      .setColor(EMBED_COLOR)
      .setThumbnail(ICON_URL)
      .setFooter({ iconURL: ICON_URL, text: BRAND_NAME })
      .setTimestamp();

    const lines = userTargets.map(t => {
      const item = itemMapping.get(t.itemId);
      const name = item ? item.name : `Item ${t.itemId}`;
      return `• **${name}** — ${t.direction} **${formatNumber(t.target)} gp**`;
    });

    embed.setDescription(lines.join('\n'));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'clear') {
    const before = list.length;
    const after  = list.filter(t => t.userId !== userId);
    priceTargets.set(guildId, after);
    savePriceTargets();
    const removed = before - after.length;
    return interaction.reply({
      content: removed ? `✅ Cleared **${removed}** of your price targets.` : 'ℹ️ You had no price targets set.',
      ephemeral: true
    });
  }
}

async function handleMarginAlertCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;

  if (!marginAlerts.has(guildId)) marginAlerts.set(guildId, []);
  const list = marginAlerts.get(guildId);

  if (sub === 'add') {
    const query = interaction.options.getString('item');
    const item  = findItem(query);
    if (!item) return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });

    const threshold = interaction.options.getNumber('margin');
    list.push({
      userId,
      itemId: item.id,
      threshold,
      channelId: interaction.channelId,
      createdAt: new Date().toISOString()
    });
    saveMarginAlerts();

    return interaction.reply({
      content: `✅ Margin alert set for **${item.name}** at **${threshold}%+**.`,
      ephemeral: true
    });
  }

  if (sub === 'remove') {
    const query = interaction.options.getString('item');
    const item  = findItem(query);
    if (!item) return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });

    const before = list.length;
    const after  = list.filter(a => !(a.userId === userId && a.itemId === item.id));
    marginAlerts.set(guildId, after);
    saveMarginAlerts();

    const removed = before - after.length;
    return interaction.reply({
      content: removed ? `✅ Removed margin alert(s) for **${item.name}**.` : `ℹ️ You had no margin alerts for **${item.name}**.`,
      ephemeral: true
    });
  }

  if (sub === 'list') {
    const userAlerts = list.filter(a => a.userId === userId);
    if (!userAlerts.length) return interaction.reply({ content: 'ℹ️ You have no margin alerts set.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle('📈 Your Margin Alerts')
      .setColor(EMBED_COLOR)
      .setThumbnail(ICON_URL)
      .setFooter({ iconURL: ICON_URL, text: BRAND_NAME })
      .setTimestamp();

    const lines = userAlerts.map(a => {
      const item = itemMapping.get(a.itemId);
      const name = item ? item.name : `Item ${a.itemId}`;
      return `• **${name}** — **${a.threshold}%+**`;
    });

    embed.setDescription(lines.join('\n'));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'clear') {
    const before = list.length;
    const after  = list.filter(a => a.userId !== userId);
    marginAlerts.set(guildId, after);
    saveMarginAlerts();
    const removed = before - after.length;
    return interaction.reply({
      content: removed ? `✅ Cleared **${removed}** of your margin alerts.` : 'ℹ️ You had no margin alerts set.',
      ephemeral: true
    });
  }
}

/*────────────────────  Portfolio / Journal  ────────────────────*/

async function handlePortfolio(interaction) {
  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;
  const portfolio = ensurePortfolio(guildId, userId);

  if (sub === 'buy' || sub === 'sell') {
    const query = interaction.options.getString('item');
    const item  = findItem(query);
    if (!item) return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });

    const qty   = interaction.options.getNumber('quantity');
    const price = interaction.options.getNumber('price');
    if (qty <= 0 || price <= 0) {
      return interaction.reply({ content: '❌ Quantity and price must be positive.', ephemeral: true });
    }

    portfolio.trades.push({
      type: sub.toUpperCase(),
      itemId: item.id,
      qty,
      price,
      timestamp: new Date().toISOString()
    });
    savePortfolios();

    return interaction.reply({
      content: `✅ Logged **${sub === 'buy' ? 'BUY' : 'SELL'}** of **${qty} × ${item.name}** at **${formatNumber(price)} gp**.`,
      ephemeral: true
    });
  }

  if (sub === 'summary') {
    if (!portfolio.trades.length) {
      return interaction.reply({ content: 'ℹ️ You have no logged flips yet.', ephemeral: true });
    }

    const { holdings, realised, invested, currentValue, unrealised, totalPnl } = computePortfolioSummary(portfolio.trades);

    const embed = new EmbedBuilder()
      .setTitle('📊 Portfolio Summary')
      .setColor(EMBED_COLOR)
      .setThumbnail(ICON_URL)
      .setFooter({ iconURL: ICON_URL, text: BRAND_NAME })
      .setTimestamp();

    embed.addFields(
      { name: '💰 Realised P&L', value: `${totalPnl >= 0 ? '🟢' : '🔴'} ${formatNumber(Math.round(realised))} gp`, inline: true },
      { name: '📦 Invested (Cost Basis)', value: formatNumber(Math.round(invested)) + ' gp', inline: true },
      { name: '📈 Current Value', value: formatNumber(Math.round(currentValue)) + ' gp', inline: true },
      { name: '📉 Unrealised P&L', value: `${unrealised >= 0 ? '🟢' : '🔴'} ${formatNumber(Math.round(unrealised))} gp`, inline: true },
      { name: '🏦 Total P&L', value: `${totalPnl >= 0 ? '🟢' : '🔴'} ${formatNumber(Math.round(totalPnl))} gp`, inline: true }
    );

    const lines = [];
    for (const [itemId, h] of holdings) {
      if (h.qty <= 0) continue;
      const item   = itemMapping.get(itemId);
      const prices = latestPrices.get(itemId);
      const name   = item ? item.name : `Item ${itemId}`;
      const current = prices?.high || h.costBasis;
      const linePnl = (current - h.costBasis) * h.qty;
      lines.push(
        `• **${name}** — ${h.qty}× @ ${formatNumber(Math.round(h.costBasis))} → ${formatNumber(current)} ` +
        `(**${linePnl >= 0 ? '+' : ''}${formatNumber(Math.round(linePnl))}**)`
      );
    }

    if (lines.length) {
      embed.addFields({ name: '📦 Holdings', value: lines.slice(0, 10).join('\n') });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'history') {
    const limit = interaction.options.getNumber('limit') || 10;
    if (!portfolio.trades.length) {
      return interaction.reply({ content: 'ℹ️ You have no logged flips yet.', ephemeral: true });
    }
    const recent = [...portfolio.trades].slice(-limit).reverse();

    const lines = recent.map(t => {
      const item = itemMapping.get(t.itemId);
      const name = item ? item.name : `Item ${t.itemId}`;
      const time = `<t:${Math.floor(new Date(t.timestamp).getTime() / 1000)}:R>`;
      return `• **${t.type}** ${t.qty}× **${name}** @ **${formatNumber(t.price)} gp** (${time})`;
    });

    const embed = new EmbedBuilder()
      .setTitle('📜 Flip History')
      .setColor(EMBED_COLOR)
      .setThumbnail(ICON_URL)
      .setDescription(lines.join('\n'))
      .setFooter({ iconURL: ICON_URL, text: BRAND_NAME })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'clear') {
    const count = portfolio.trades.length;
    portfolio.trades = [];
    savePortfolios();
    return interaction.reply({
      content: `🗑️ Cleared **${count}** logged flips from your journal.`,
      ephemeral: true
    });
  }
}

async function handleFlipLeaderboard(interaction) {
  const guildId = interaction.guildId;
  const guildMap = portfolios.get(guildId);
  if (!guildMap || !guildMap.size) {
    return interaction.reply({ content: 'ℹ️ No flip data recorded for this server yet.', ephemeral: true });
  }

  const rows = [];
  for (const [userId, p] of guildMap) {
    if (!p.trades || !p.trades.length) continue;
    const { realised } = computePortfolioSummary(p.trades);
    rows.push({ userId, realised });
  }

  if (!rows.length) {
    return interaction.reply({ content: 'ℹ️ No completed flips yet.', ephemeral: true });
  }

  rows.sort((a, b) => b.realised - a.realised);

  const lines = rows.slice(0, 10).map((r, i) =>
    `${['🥇','🥈','🥉'][i] || `${i + 1}.`} <@${r.userId}> — ${r.realised >= 0 ? '🟢' : '🔴'} ${formatNumber(Math.round(r.realised))} gp`
  );

  const embed = new EmbedBuilder()
    .setTitle('🏆 Flip Leaderboard (Realised P&L)')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setDescription(lines.join('\n'))
    .setFooter({ iconURL: ICON_URL, text: BRAND_NAME })
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

/*────────────────────  Daily Market Reports  ───────────────────*/

function buildDailySummaryEmbed() {
  const trackedItems = latestPrices.size;
  const watchlistCount = Array.from(serverWatchlists.values()).reduce((sum, w) => sum + w.items.size, 0);
  const alertServers = Array.from(serverAlertConfigs.values()).filter(c => c.enabled).length;

  const movers1h = findBiggestMovers(1);
  const topGainer = movers1h.gainers[0];
  const topLoser  = movers1h.losers[0];

  const flips = findBestFlips(5, 100);
  const topFlip = flips[0];

  const embed = new EmbedBuilder()
    .setTitle('📊 Daily GE Market Summary')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .addFields(
      { name: '📈 Items Tracked', value: trackedItems.toLocaleString(), inline: true },
      { name: '👁️ Watchlist Items', value: watchlistCount.toString(), inline: true },
      { name: '🔔 Alert Channels', value: alertServers.toString(), inline: true },
    );

  if (topGainer) {
    embed.addFields({
      name: '🚀 Top Gainer (1h)',
      value: `${topGainer.item.name}: +${topGainer.changePercent.toFixed(2)}%`,
      inline: false
    });
  }
  if (topLoser) {
    embed.addFields({
      name: '💥 Top Crash (1h)',
      value: `${topLoser.item.name}: ${topLoser.changePercent.toFixed(2)}%`,
      inline: false
    });
  }
  if (topFlip) {
    embed.addFields({
      name: '💹 Highlight Flip',
      value: `${topFlip.item.name}\n` +
             `Margin: ${formatNumber(topFlip.margin)} (${topFlip.marginPercent.toFixed(1)}%)\n` +
             `ROI: ${topFlip.roiPerHour.toFixed(2)}% / hour`,
      inline: false
    });
  }

  embed.setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • GE Tracker` }).setTimestamp();
  return embed;
}

async function runScheduledReports() {
  const now = new Date();
  const hour = now.getUTCHours();
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes(); // we use (h,m) but this is fine

  const todayStr = now.toISOString().slice(0, 10);

  for (const [guildId, cfg] of reportConfigs) {
    if (!cfg.enabled || !cfg.channelId) continue;
    const minuteNow = now.getUTCMinutes();
    const targetMin = cfg.minute ?? 0;
    if (cfg.hour === hour && targetMin === minuteNow) {
      if (cfg.lastSentDate === todayStr) continue;
      const channel = client.channels.cache.get(cfg.channelId);
      if (!channel) continue;
      const embed = buildDailySummaryEmbed();
      await channel.send({ embeds: [embed] }).catch(console.error);
      cfg.lastSentDate = todayStr;
    }
  }
  saveReportConfigs();
}

async function handleReports(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (!reportConfigs.has(guildId)) {
    reportConfigs.set(guildId, {
      channelId: null,
      hour: 9,
      minute: 0,
      enabled: false,
      lastSentDate: null
    });
  }

  const cfg = reportConfigs.get(guildId);

  if (sub === 'setup') {
    const hour = interaction.options.getInteger('hour');
    const minute = interaction.options.getInteger('minute') ?? 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return interaction.reply({ content: '❌ Hour must be 0–23, minute 0–59 (UTC).', ephemeral: true });
    }
    cfg.channelId = interaction.channelId;
    cfg.hour      = hour;
    cfg.minute    = minute;
    cfg.enabled   = true;
    saveReportConfigs();

    return interaction.reply({
      content: `✅ Daily report enabled in this channel at **${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} UTC**.`,
      ephemeral: true
    });
  }

  if (sub === 'stop') {
    cfg.enabled = false;
    saveReportConfigs();
    return interaction.reply({ content: '✅ Daily reports disabled for this server.', ephemeral: true });
  }

  if (sub === 'status') {
    if (!cfg.enabled || !cfg.channelId) {
      return interaction.reply({ content: 'ℹ️ No daily report configured for this server.', ephemeral: true });
    }
    return interaction.reply({
      content: `📊 Daily report enabled in <#${cfg.channelId}> at **${cfg.hour.toString().padStart(2, '0')}:${(cfg.minute ?? 0).toString().padStart(2, '0')} UTC**.`,
      ephemeral: true
    });
  }

  if (sub === 'runnow') {
    const embed = buildDailySummaryEmbed();
    await interaction.reply({ embeds: [embed] });
  }
}

/*────────────────────  Market Intelligence Commands  ───────────*/

async function handleCrashPredictor(interaction) {
  const entries = [];
  for (const [itemId, stat] of crashStats) {
    const item = itemMapping.get(itemId);
    if (!item) continue;
    entries.push({ item, crashes: stat.crashes, lastChangePercent: stat.lastChangePercent });
  }
  if (!entries.length) {
    return interaction.reply({ content: 'ℹ️ No crash history recorded yet. Let the bot run for a while.', ephemeral: true });
  }
  entries.sort((a, b) => b.crashes - a.crashes);

  const embed = new EmbedBuilder()
    .setTitle('📉 Frequent Crashers (recent 1h checks)')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • Crash Predictor` })
    .setTimestamp();

  const lines = entries.slice(0, 15).map((e, i) =>
    `${i + 1}. **${e.item.name}** — crashes: **${e.crashes}** (last: ${e.lastChangePercent.toFixed(2)}%)`
  );

  embed.setDescription(lines.join('\n'));
  return interaction.reply({ embeds: [embed] });
}

async function handleManipulation(interaction) {
  await interaction.deferReply();

  const suspects = [];

  for (const [itemId] of latestPrices) {
    const item = itemMapping.get(itemId);
    if (!item) continue;
    const vol = analyzeVolatility(itemId);
    const change = calculatePriceChange(itemId, 1);
    if (!vol || !change) continue;

    const absChange = Math.abs(change.changePercent);
    const volPct = parseFloat(vol.volatility);
    if (absChange > 5 && absChange > volPct * 0.7) {
      suspects.push({ item, absChange, volPct, change });
    }
  }

  suspects.sort((a, b) => b.absChange - a.absChange);

  const embed = new EmbedBuilder()
    .setTitle('🚨 Possible Manipulation / Pump & Dump Candidates')
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • Experimental` })
    .setTimestamp();

  if (!suspects.length) {
    embed.setDescription('No strong manipulation signals detected right now.\n\nThis is an experimental heuristic only.');
    return interaction.editReply({ embeds: [embed] });
  }

  const list = suspects.slice(0, 15).map((s, i) =>
    `${i + 1}. **${s.item.name}**\n` +
    `　　Change (1h): **${s.change.changePercent.toFixed(2)}%**\n` +
    `　　Volatility: **${s.volPct.toFixed(2)}%**`
  ).join('\n\n');

  embed.setDescription(list + '\n\n*Heuristic only. Not financial advice.*');
  return interaction.editReply({ embeds: [embed] });
}

async function handleCorrelate(interaction) {
  const query = interaction.options.getString('item');
  const item  = findItem(query);
  if (!item) return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });

  await interaction.deferReply();
  const top = findTopCorrelations(item.id, 10);

  const embed = new EmbedBuilder()
    .setTitle(`🔗 Price Correlations for ${item.name}`)
    .setColor(EMBED_COLOR)
    .setThumbnail(ICON_URL)
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • Experimental` })
    .setTimestamp();

  if (!top.length) {
    embed.setDescription('Not enough price history yet to compute correlations.\n\nLet the bot run for a while.');
    return interaction.editReply({ embeds: [embed] });
  }

  const lines = top.map((c, i) => {
    const other = itemMapping.get(c.itemId);
    const name  = other ? other.name : `Item ${c.itemId}`;
    return `${i + 1}. **${name}** — r = **${c.r.toFixed(3)}**`;
  });

  embed.setDescription(lines.join('\n'));
  return interaction.editReply({ embeds: [embed] });
}

async function handleSeasonality(interaction) {
  const query = interaction.options.getString('item');
  const item  = findItem(query);
  if (!item) return interaction.reply({ content: `❌ Item "${query}" not found.`, ephemeral: true });

  await interaction.deferReply();
  const data = await fetchTimeseries(item.id, '24h');
  if (!data || data.length < 7) {
    return interaction.editReply(`❌ Not enough long-term data for ${item.name}.`);
  }

  const buckets = Array.from({ length: 7 }, () => []);
  for (const point of data) {
    if (!point.avgHighPrice) continue;
    const date = new Date(point.timestamp * 1000);
    const dow  = date.getUTCDay(); // 0 = Sunday
    buckets[dow].push(point.avgHighPrice);
  }

  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const stats = buckets.map((arr, i) => {
    if (!arr.length) return { dow: i, avg: null };
    const avg = arr.reduce((a, b) => a + b) / arr.length;
    return { dow: i, avg };
  }).filter(s => s.avg !== null);

  stats.sort((a, b) => b.avg - a.avg);

  const weekend = stats.filter(s => s.dow === 0 || s.dow === 6);
  const weekday = stats.filter(s => s.dow >= 1 && s.dow <= 5);

  const weekendAvg = weekend.length ? weekend.reduce((a, b) => a + b.avg, 0) / weekend.length : null;
  const weekdayAvg = weekday.length ? weekday.reduce((a, b) => a + b.avg, 0) / weekday.length : null;

  const embed = new EmbedBuilder()
    .setTitle(`📆 Seasonality: ${item.name}`)
    .setColor(EMBED_COLOR)
    .setThumbnail(`https://oldschool.runescape.wiki/images/${encodeURIComponent(item.icon)}`)
    .setFooter({ iconURL: ICON_URL, text: `${BRAND_NAME} • Simple day-of-week check` })
    .setTimestamp();

  const lines = stats.map(s =>
    `• **${dowNames[s.dow]}** — avg high: ${formatNumber(Math.round(s.avg))} gp`
  );

  embed.setDescription(lines.join('\n'));

  if (weekendAvg && weekdayAvg) {
    const diffPct = ((weekendAvg - weekdayAvg) / weekdayAvg) * 100;
    embed.addFields({
      name: 'Weekend vs Weekday',
      value: `Weekend avg: **${formatNumber(Math.round(weekendAvg))}**\n` +
             `Weekday avg: **${formatNumber(Math.round(weekdayAvg))}**\n` +
             `Δ: **${diffPct.toFixed(2)}%** (weekend vs weekday)`
    });
  }

  return interaction.editReply({ embeds: [embed] });
}


/*────────────────────  Event Handlers  ─────────────────────────*/
client.once('ready', async () => {
  console.log(`\n🤖 Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} servers`);
  
  // Load data
  loadWatchlists();
  loadAlertConfigs();
  loadPriceTargets();
  loadMarginAlerts();
  loadPortfolios();
  loadReportConfigs();


/*────────────────────  Extra Data Persistence  ─────────────────*/

// Price targets
function savePriceTargets() {
  const data = {};
  for (const [guildId, targets] of priceTargets) {
    data[guildId] = targets;
  }
  fs.writeFileSync(PRICE_TARGETS_FILE, JSON.stringify(data, null, 2));
}

function loadPriceTargets() {
  try {
    if (fs.existsSync(PRICE_TARGETS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PRICE_TARGETS_FILE, 'utf8'));
      for (const [guildId, targets] of Object.entries(raw)) {
        priceTargets.set(guildId, targets);
      }
      console.log(`✅ Loaded price targets for ${priceTargets.size} servers`);
    }
  } catch (err) {
    console.error('❌ Failed to load price targets:', err.message);
  }
}

// Margin alerts
function saveMarginAlerts() {
  const data = {};
  for (const [guildId, alerts] of marginAlerts) {
    data[guildId] = alerts;
  }
  fs.writeFileSync(MARGIN_ALERTS_FILE, JSON.stringify(data, null, 2));
}

function loadMarginAlerts() {
  try {
    if (fs.existsSync(MARGIN_ALERTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MARGIN_ALERTS_FILE, 'utf8'));
      for (const [guildId, alerts] of Object.entries(raw)) {
        marginAlerts.set(guildId, alerts);
      }
      console.log(`✅ Loaded margin alerts for ${marginAlerts.size} servers`);
    }
  } catch (err) {
    console.error('❌ Failed to load margin alerts:', err.message);
  }
}

// Portfolios
function savePortfolios() {
  const data = {};
  for (const [guildId, users] of portfolios) {
    data[guildId] = {};
    for (const [userId, p] of users) {
      data[guildId][userId] = p;
    }
  }
  fs.writeFileSync(PORTFOLIOS_FILE, JSON.stringify(data, null, 2));
}

function loadPortfolios() {
  try {
    if (fs.existsSync(PORTFOLIOS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PORTFOLIOS_FILE, 'utf8'));
      for (const [guildId, users] of Object.entries(raw)) {
        const userMap = new Map();
        for (const [userId, p] of Object.entries(users)) {
          userMap.set(userId, p);
        }
        portfolios.set(guildId, userMap);
      }
      console.log(`✅ Loaded portfolios for ${portfolios.size} servers`);
    }
  } catch (err) {
    console.error('❌ Failed to load portfolios:', err.message);
  }
}

// Daily report configs
function saveReportConfigs() {
  const data = {};
  for (const [guildId, cfg] of reportConfigs) {
    data[guildId] = cfg;
  }
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(data, null, 2));
}

function loadReportConfigs() {
  try {
    if (fs.existsSync(REPORTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
      for (const [guildId, cfg] of Object.entries(raw)) {
        reportConfigs.set(guildId, cfg);
      }
      console.log(`✅ Loaded report configs for ${reportConfigs.size} servers`);
    }
  } catch (err) {
    console.error('❌ Failed to load report configs:', err.message);
  }
}

  
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
  
    // Daily report scheduler (check once a minute)
  setInterval(async () => {
    await runScheduledReports();
  }, 60 * 1000);
  
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
      case 'history': return handleHistory(interaction);
      case 'alch': return handleAlch(interaction);
      case 'search': return handleSearch(interaction);
      case 'gestats': return handleGEStats(interaction);
      case 'addveng': return handleAddVeng(interaction);
      case 'removeveng': return handleRemoveVeng(interaction);
      case 'venglist': return handleVengList(interaction);
      case 'clearveng': return handleClearVeng(interaction);
	  case 'pricetarget':      return handlePriceTarget(interaction);
      case 'marginalert':      return handleMarginAlertCommand(interaction);
      case 'portfolio':        return handlePortfolio(interaction);
      case 'flipleaderboard':  return handleFlipLeaderboard(interaction);
      case 'reports':          return handleReports(interaction);
      case 'crashpredictor':   return handleCrashPredictor(interaction);
      case 'manipulation':     return handleManipulation(interaction);
      case 'correlate':        return handleCorrelate(interaction);
      case 'seasonality':      return handleSeasonality(interaction);
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
