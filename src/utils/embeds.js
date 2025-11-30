// src/utils/embeds.js
// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER V2 - EMBED BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════
// Professional, beautiful Discord embeds with consistent branding
// ═══════════════════════════════════════════════════════════════════════════════

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DEFAULTS, AlertType, Severity } from '../../config/defaults.js';
import * as fmt from './formatters.js';

const { brand } = DEFAULTS;

// ═══════════════════════════════════════════════════════════════════════════════
// BASE EMBED FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a base embed with branding
 */
export function createEmbed(options = {}) {
  const embed = new EmbedBuilder()
    .setColor(options.color || brand.color)
    .setTimestamp();
  
  if (options.title) embed.setTitle(options.title);
  if (options.description) embed.setDescription(options.description);
  if (options.thumbnail !== false) embed.setThumbnail(options.thumbnail || brand.icon);
  if (options.url) embed.setURL(options.url);
  if (options.image) embed.setImage(options.image);
  if (options.author) embed.setAuthor(options.author);
  
  embed.setFooter({ 
    text: options.footerText || brand.name, 
    iconURL: brand.icon 
  });
  
  return embed;
}

/**
 * Error embed
 */
export function errorEmbed(message, title = 'Error') {
  return createEmbed({
    title: `❌ ${title}`,
    description: message,
    color: brand.dangerColor,
  });
}

/**
 * Success embed
 */
export function successEmbed(message, title = 'Success') {
  return createEmbed({
    title: `✅ ${title}`,
    description: message,
    color: brand.successColor,
  });
}

/**
 * Info embed
 */
export function infoEmbed(message, title = 'Info') {
  return createEmbed({
    title: `ℹ️ ${title}`,
    description: message,
    color: brand.infoColor,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM EMBEDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a comprehensive item price embed
 */
export function buildItemEmbed(item, prices, analytics = {}) {
  const embed = createEmbed({
    title: `📊 ${item.name}`,
    url: fmt.getPriceChartUrl(item.id),
    thumbnail: fmt.getItemIconUrl(item.icon),
  });
  
  // Core prices
  embed.addFields(
    { name: '💰 Instant Buy', value: fmt.formatGp(prices.high), inline: true },
    { name: '💰 Instant Sell', value: fmt.formatGp(prices.low), inline: true },
    { name: '📦 Buy Limit', value: item.limit ? `${item.limit.toLocaleString()}/4hr` : 'Unknown', inline: true },
  );
  
  // Margin info
  if (analytics.margin) {
    const m = analytics.margin;
    const profitEmoji = m.margin > 0 ? '🟢' : '🔴';
    embed.addFields(
      { name: `${profitEmoji} Margin`, value: `${fmt.formatGp(m.margin)} (${m.marginPercent.toFixed(1)}%)`, inline: true },
      { name: '💸 Tax', value: fmt.formatGp(m.tax), inline: true },
      { name: '💎 Max Profit', value: m.potentialProfit ? fmt.formatGp(m.potentialProfit) : 'N/A', inline: true },
    );
    
    if (m.roiPerHour) {
      embed.addFields(
        { name: '📈 ROI/Hour', value: `${m.roiPerHour.toFixed(2)}%`, inline: true },
        { name: '💵 Capital', value: fmt.formatGp(m.capitalRequired), inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
      );
    }
  }
  
  // Price changes
  if (analytics.priceChange1h || analytics.priceChange24h) {
    const changes = [];
    if (analytics.priceChange1h) {
      changes.push(`**1h:** ${fmt.formatPercentColored(analytics.priceChange1h.changePercent)}`);
    }
    if (analytics.priceChange24h) {
      changes.push(`**24h:** ${fmt.formatPercentColored(analytics.priceChange24h.changePercent)}`);
    }
    embed.addFields({ name: '📉 Price Changes', value: changes.join(' • '), inline: false });
  }
  
  // Technical indicators
  const techFields = [];
  
  if (analytics.rsi) {
    const rsiEmoji = fmt.getRsiEmoji(analytics.rsi.value);
    techFields.push(`**RSI:** ${rsiEmoji} ${analytics.rsi.value} (${analytics.rsi.signal})`);
  }
  
  if (analytics.trend) {
    const trendEmoji = fmt.getTrendEmoji(analytics.trend.direction);
    techFields.push(`**Trend:** ${trendEmoji} ${analytics.trend.direction.replace('_', ' ')}`);
  }
  
  if (analytics.volatility) {
    const volLevel = analytics.volatility.isHighVolatility ? '⚠️ HIGH' : 
                     analytics.volatility.isLowVolatility ? '✅ LOW' : '➡️ NORMAL';
    techFields.push(`**Volatility:** ${volLevel} (${analytics.volatility.volatilityPercent}%)`);
  }
  
  if (techFields.length) {
    embed.addFields({ name: '📈 Technical Analysis', value: techFields.join('\n'), inline: false });
  }
  
  // Sparkline
  if (analytics.sparkline) {
    embed.addFields({ name: '📊 24h Chart', value: `\`${analytics.sparkline}\``, inline: false });
  }
  
  // Footer with item details
  const footerParts = [`ID: ${item.id}`];
  if (item.members !== undefined) footerParts.push(item.members ? 'Members' : 'F2P');
  if (item.highalch) footerParts.push(`Alch: ${fmt.formatGp(item.highalch)}`);
  
  embed.setFooter({ text: footerParts.join(' • '), iconURL: brand.icon });
  
  return embed;
}

/**
 * Create item action buttons
 */
export function buildItemButtons(item) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`watchlist_add_${item.id}`)
      .setLabel('Watch')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('👁️'),
    new ButtonBuilder()
      .setCustomId(`alert_price_${item.id}`)
      .setLabel('Price Alert')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔔'),
    new ButtonBuilder()
      .setLabel('Wiki')
      .setStyle(ButtonStyle.Link)
      .setURL(fmt.getWikiUrl(item.name)),
    new ButtonBuilder()
      .setLabel('Chart')
      .setStyle(ButtonStyle.Link)
      .setURL(fmt.getPriceChartUrl(item.id)),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLIP EMBEDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build flip opportunities embed
 */
export function buildFlipEmbed(flips, title = 'Best Flipping Opportunities') {
  const embed = createEmbed({
    title: `💹 ${title}`,
    color: brand.successColor,
  });
  
  if (!flips || flips.length === 0) {
    embed.setDescription('No flipping opportunities found with those criteria.\n\nTry lowering the minimum margin or buy limit.');
    return embed;
  }
  
  embed.setDescription('Ranked by margin, ROI, and risk factors:');
  
  const medals = ['🥇', '🥈', '🥉'];
  
  for (let i = 0; i < Math.min(flips.length, 10); i++) {
    const flip = flips[i];
    const medal = medals[i] || `${i + 1}.`;
    
    const lines = [
      `**Buy:** ${fmt.formatGp(flip.low)} → **Sell:** ${fmt.formatGp(flip.high)}`,
      `**Margin:** ${fmt.formatGp(flip.margin)} (${flip.marginPercent.toFixed(1)}%)`,
      `**Limit:** ${flip.buyLimit || '?'} • **4h Profit:** ${fmt.formatGp(flip.potentialProfit)}`,
      `**ROI:** ${flip.roiPerHour.toFixed(2)}%/hr • **Capital:** ${fmt.formatGp(flip.capitalRequired)}`,
    ];
    
    // Add indicators
    const indicators = [];
    if (flip.rsi) {
      const rsiEmoji = fmt.getRsiEmoji(flip.rsi);
      indicators.push(`RSI: ${rsiEmoji}${flip.rsi}`);
    }
    if (flip.trend) {
      const trendEmoji = fmt.getTrendEmoji(flip.trend);
      indicators.push(`${trendEmoji}`);
    }
    if (flip.volatility && flip.volatility > 10) {
      indicators.push('⚠️ Volatile');
    }
    
    if (indicators.length) {
      lines.push(indicators.join(' • '));
    }
    
    embed.addFields({
      name: `${medal} ${flip.item.name}`,
      value: lines.join('\n'),
      inline: false,
    });
  }
  
  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOVERS EMBEDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build gainers/losers embed
 */
export function buildMoversEmbed(movers, type = 'gainers', timeframe = '1h') {
  const isGainers = type === 'gainers';
  const data = isGainers ? movers.gainers : movers.losers;
  
  const embed = createEmbed({
    title: `${isGainers ? '🚀 Top Gainers' : '💥 Biggest Crashes'} (${timeframe})`,
    color: isGainers ? brand.successColor : brand.dangerColor,
  });
  
  if (!data || data.length === 0) {
    embed.setDescription('No significant movers found.\n\nThe bot needs time to collect price data. Check back later.');
    return embed;
  }
  
  const lines = data.slice(0, 15).map((m, i) => {
    const emoji = isGainers ? '📈' : '📉';
    return `**${i + 1}.** ${m.item.name}\n` +
           `　　${emoji} **${fmt.formatPercent(m.changePercent)}** • ` +
           `${fmt.formatGp(m.pastPrice)} → ${fmt.formatGp(m.currentPrice)}`;
  });
  
  embed.setDescription(lines.join('\n\n'));
  
  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALERT EMBEDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build alert notification embed
 */
export function buildAlertEmbed(alertResult) {
  const { type, item } = alertResult;
  const typeEmoji = fmt.getAlertTypeEmoji(type);
  
  let color = brand.warningColor;
  let title = 'Alert';
  
  switch (type) {
    case AlertType.PRICE_TARGET:
      title = `${typeEmoji} Price Target Hit: ${item.name}`;
      color = brand.successColor;
      break;
      
    case AlertType.PRICE_CHANGE:
      const isCrash = alertResult.direction === 'crash';
      title = `${isCrash ? '💥' : '🚀'} ${isCrash ? 'CRASH' : 'SPIKE'}: ${item.name}`;
      color = isCrash ? brand.dangerColor : brand.successColor;
      break;
      
    case AlertType.PUMP_DETECTED:
      title = `${typeEmoji} PUMP DETECTED: ${item.name}`;
      color = brand.warningColor;
      break;
      
    case AlertType.DUMP_DETECTED:
      title = `${typeEmoji} DUMP DETECTED: ${item.name}`;
      color = brand.dangerColor;
      break;
      
    case AlertType.UNUSUAL_ACTIVITY:
      title = `${typeEmoji} Unusual Activity: ${item.name}`;
      color = brand.warningColor;
      break;
      
    case AlertType.MARGIN_THRESHOLD:
      title = `${typeEmoji} Margin Alert: ${item.name}`;
      color = brand.successColor;
      break;
      
    default:
      title = `${typeEmoji} Alert: ${item?.name || 'Unknown'}`;
  }
  
  const embed = createEmbed({
    title,
    color,
    thumbnail: fmt.getItemIconUrl(item?.icon),
    url: item ? fmt.getPriceChartUrl(item.id) : undefined,
  });
  
  // Build description based on alert type
  const descLines = [];
  
  if (alertResult.severity) {
    const severityEmoji = fmt.getSeverityEmoji(alertResult.severity);
    descLines.push(`**Severity:** ${severityEmoji} ${alertResult.severity}`);
  }
  
  if (alertResult.priceChange) {
    const pc = alertResult.priceChange;
    descLines.push(`**Change:** ${fmt.formatPercentColored(pc.changePercent)}`);
    descLines.push(`**Movement:** ${fmt.formatGp(pc.pastPrice)} → ${fmt.formatGp(pc.currentPrice)}`);
  }
  
  if (alertResult.targetPrice !== undefined) {
    descLines.push(`**Target:** ${fmt.formatGp(alertResult.targetPrice)} (${alertResult.direction})`);
    descLines.push(`**Current:** ${fmt.formatGp(alertResult.currentPrice)}`);
  }
  
  if (alertResult.margin) {
    const m = alertResult.margin;
    descLines.push(`**Margin:** ${fmt.formatGp(m.margin)} (${m.marginPercent.toFixed(1)}%)`);
    descLines.push(`**Potential Profit:** ${fmt.formatGp(m.potentialProfit)}`);
  }
  
  if (alertResult.confidence) {
    descLines.push(`**Confidence:** ${alertResult.confidence}%`);
  }
  
  if (alertResult.reasons && alertResult.reasons.length) {
    descLines.push('');
    descLines.push('**Signals:**');
    alertResult.reasons.forEach(r => descLines.push(`• ${r}`));
  }
  
  if (alertResult.score !== undefined) {
    descLines.push('');
    descLines.push(`**Activity Score:** ${fmt.scoreBar(alertResult.score)}`);
  }
  
  embed.setDescription(descLines.join('\n'));
  
  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MANIPULATION SCAN EMBEDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build manipulation scan results embed
 */
export function buildManipulationEmbed(signals, title = 'Manipulation Scan') {
  const embed = createEmbed({
    title: `🔍 ${title}`,
    color: brand.warningColor,
  });
  
  if (!signals || signals.length === 0) {
    embed.setDescription('No manipulation signals detected.\n\n*This is good - the market appears healthy.*');
    return embed;
  }
  
  embed.setDescription('Items showing unusual activity patterns:');
  
  for (let i = 0; i < Math.min(signals.length, 10); i++) {
    const sig = signals[i];
    const severityEmoji = fmt.getSeverityEmoji(sig.severity);
    
    const lines = [
      `${severityEmoji} **Score:** ${sig.score}/100`,
      sig.reasons.slice(0, 3).map(r => `• ${r}`).join('\n'),
    ];
    
    embed.addFields({
      name: `${i + 1}. ${sig.item.name}`,
      value: lines.join('\n'),
      inline: true,
    });
  }
  
  embed.addFields({
    name: '⚠️ Disclaimer',
    value: '*This is algorithmic analysis only. Not financial advice. Always do your own research.*',
    inline: false,
  });
  
  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WATCHLIST EMBEDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build watchlist embed
 */
export function buildWatchlistEmbed(watchlistItems, title = 'Watchlist') {
  const embed = createEmbed({
    title: `👁️ ${title}`,
  });
  
  if (!watchlistItems || watchlistItems.length === 0) {
    embed.setDescription('Your watchlist is empty.\n\nUse `/watchlist add <item>` to add items.');
    return embed;
  }
  
  const fields = watchlistItems.slice(0, 25).map(({ item, prices, change }) => {
    const changeText = change 
      ? `${fmt.formatPercentColored(change.changePercent)}` 
      : '';
    
    return {
      name: item.name,
      value: `💰 ${fmt.formatGp(prices?.high)} / ${fmt.formatGp(prices?.low)}${changeText ? `\n${changeText}` : ''}`,
      inline: true,
    };
  });
  
  embed.addFields(fields);
  
  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO EMBEDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build portfolio summary embed
 */
export function buildPortfolioEmbed(summary, getItem) {
  const embed = createEmbed({
    title: '📊 Portfolio Summary',
    color: summary.totalPnl >= 0 ? brand.successColor : brand.dangerColor,
  });
  
  const pnlEmoji = summary.totalPnl >= 0 ? '🟢' : '🔴';
  
  embed.addFields(
    { name: '💰 Realised P&L', value: `${pnlEmoji} ${fmt.formatGp(Math.round(summary.realised))}`, inline: true },
    { name: '📦 Invested', value: fmt.formatGp(Math.round(summary.invested)), inline: true },
    { name: '📈 Current Value', value: fmt.formatGp(Math.round(summary.currentValue)), inline: true },
    { name: '📉 Unrealised P&L', value: `${summary.unrealised >= 0 ? '🟢' : '🔴'} ${fmt.formatGp(Math.round(summary.unrealised))}`, inline: true },
    { name: '🏦 Total P&L', value: `${pnlEmoji} ${fmt.formatGp(Math.round(summary.totalPnl))}`, inline: true },
    { name: '📝 Trades', value: `${summary.tradeCount}`, inline: true },
  );
  
  // Holdings
  const holdingLines = [];
  for (const [itemId, h] of summary.holdings) {
    if (h.qty <= 0) continue;
    const item = getItem(itemId);
    const name = item ? item.name : `Item ${itemId}`;
    holdingLines.push(`• **${name}** — ${h.qty}× @ ${fmt.formatGp(Math.round(h.costBasis))}`);
  }
  
  if (holdingLines.length) {
    embed.addFields({
      name: '📦 Current Holdings',
      value: holdingLines.slice(0, 10).join('\n'),
      inline: false,
    });
  }
  
  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VENG LIST EMBEDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build veng list embed
 */
export function buildVengListEmbed(vengList) {
  const embed = createEmbed({
    title: '⚔️ Vengeance List',
    color: brand.dangerColor,
  });
  
  if (!vengList || vengList.length === 0) {
    embed.setDescription('*The vengeance list is empty.*\n\nUse `/addveng <RSN>` to add someone.');
    return embed;
  }
  
  // Quick copy list
  const rsnList = vengList.map(v => v.rsn).join(', ');
  embed.setDescription(`**Quick Copy:**\n\`\`\`${rsnList}\`\`\``);
  
  // Detailed list
  const detailedList = vengList.slice(0, 15).map((v, i) => {
    const addedDate = new Date(v.addedAt);
    const timestamp = Math.floor(addedDate.getTime() / 1000);
    return `**${i + 1}.** \`${v.rsn}\`\n　📝 ${v.reason}\n　➕ ${v.addedBy} • <t:${timestamp}:R>`;
  }).join('\n\n');
  
  embed.addFields({
    name: `📋 Full List (${vengList.length})`,
    value: detailedList.slice(0, 1024),
    inline: false,
  });
  
  embed.setFooter({ text: `${brand.name} • Kill on sight`, iconURL: brand.icon });
  
  return embed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG EMBEDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build server config embed
 */
export function buildConfigEmbed(config, guildName) {
  const embed = createEmbed({
    title: `⚙️ Alert Configuration`,
    description: `Settings for **${guildName}**`,
  });
  
  const statusEmoji = config.enabled ? '🟢' : '🔴';
  
  embed.addFields(
    { name: 'Status', value: `${statusEmoji} ${config.enabled ? 'Enabled' : 'Disabled'}`, inline: true },
    { name: 'Alert Channel', value: config.alertChannelId ? `<#${config.alertChannelId}>` : 'Not set', inline: true },
    { name: '\u200B', value: '\u200B', inline: true },
  );
  
  // Price change thresholds
  const pc = config.priceChange;
  embed.addFields({
    name: '📊 Price Change Thresholds',
    value: [
      `**Crashes:** ${pc.crash.moderate}% / ${pc.crash.severe}% / ${pc.crash.extreme}%`,
      `**Spikes:** +${pc.spike.moderate}% / +${pc.spike.severe}% / +${pc.spike.extreme}%`,
      `**Timeframe:** ${pc.timeframe}h`,
    ].join('\n'),
    inline: false,
  });
  
  // Feature toggles
  const features = [
    config.enablePumpAlerts ? '✅ Pump Detection' : '❌ Pump Detection',
    config.enableDumpAlerts ? '✅ Dump Detection' : '❌ Dump Detection',
    config.enableManipulationAlerts ? '✅ Manipulation Alerts' : '❌ Manipulation Alerts',
    config.enableVolumeAlerts ? '✅ Volume Alerts' : '❌ Volume Alerts',
  ];
  
  embed.addFields({
    name: '🔔 Features',
    value: features.join('\n'),
    inline: true,
  });
  
  // Cooldowns
  embed.addFields({
    name: '⏱️ Cooldowns',
    value: [
      `Price: ${fmt.formatDuration(config.cooldowns.priceChange)}`,
      `Volume: ${fmt.formatDuration(config.cooldowns.volume)}`,
      `Manipulation: ${fmt.formatDuration(config.cooldowns.manipulation)}`,
    ].join('\n'),
    inline: true,
  });
  
  return embed;
}

export default {
  createEmbed,
  errorEmbed,
  successEmbed,
  infoEmbed,
  buildItemEmbed,
  buildItemButtons,
  buildFlipEmbed,
  buildMoversEmbed,
  buildAlertEmbed,
  buildManipulationEmbed,
  buildWatchlistEmbed,
  buildPortfolioEmbed,
  buildVengListEmbed,
  buildConfigEmbed,
};
