// src/utils/formatters.js
// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER V2 - FORMATTING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

import { DEFAULTS, Severity, AlertType } from '../../config/defaults.js';

// ═══════════════════════════════════════════════════════════════════════════════
// NUMBER FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format a number with K/M/B suffixes
 */
export function formatNumber(num) {
  if (num === null || num === undefined) return 'N/A';
  if (typeof num !== 'number' || isNaN(num)) return 'N/A';
  
  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  
  if (absNum >= 1e9) return `${sign}${(absNum / 1e9).toFixed(2)}B`;
  if (absNum >= 1e6) return `${sign}${(absNum / 1e6).toFixed(2)}M`;
  if (absNum >= 1e3) return `${sign}${(absNum / 1e3).toFixed(1)}K`;
  
  return `${sign}${absNum.toLocaleString()}`;
}

/**
 * Format a number as GP
 */
export function formatGp(num) {
  const formatted = formatNumber(num);
  return formatted === 'N/A' ? formatted : `${formatted} gp`;
}

/**
 * Format a percentage
 */
export function formatPercent(num, decimals = 2) {
  if (num === null || num === undefined) return 'N/A';
  if (typeof num !== 'number' || isNaN(num)) return 'N/A';
  
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(decimals)}%`;
}

/**
 * Format a percentage with color indicator
 */
export function formatPercentColored(num, decimals = 2) {
  if (num === null || num === undefined) return 'N/A';
  
  const emoji = num >= 0 ? '🟢' : '🔴';
  return `${emoji} ${formatPercent(num, decimals)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIME FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format a Unix timestamp as Discord relative time
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return 'N/A';
  const seconds = typeof timestamp === 'number' && timestamp > 1e12 
    ? Math.floor(timestamp / 1000) 
    : timestamp;
  return `<t:${seconds}:R>`;
}

/**
 * Format a Unix timestamp as Discord full datetime
 */
export function formatDateTime(timestamp) {
  if (!timestamp) return 'N/A';
  const seconds = typeof timestamp === 'number' && timestamp > 1e12 
    ? Math.floor(timestamp / 1000) 
    : timestamp;
  return `<t:${seconds}:f>`;
}

/**
 * Format duration in ms to human readable
 */
export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPARKLINES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate an ASCII sparkline from values
 */
export function generateSparkline(values, width = DEFAULTS.display.sparklineWidth) {
  if (!values || !values.length) return 'N/A';
  
  const chars = DEFAULTS.display.sparklineChars;
  const filtered = values.filter(v => typeof v === 'number' && !isNaN(v));
  
  if (!filtered.length) return 'N/A';
  
  // Sample down to width
  const step = Math.max(1, Math.floor(filtered.length / width));
  const samples = [];
  for (let i = 0; i < filtered.length; i += step) {
    samples.push(filtered[i]);
  }
  
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  
  if (max === min) return chars[0].repeat(samples.length);
  
  return samples.map(v => {
    const norm = (v - min) / (max - min);
    const idx = Math.min(chars.length - 1, Math.floor(norm * chars.length));
    return chars[idx];
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMOJI & INDICATORS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get severity emoji
 */
export function getSeverityEmoji(severity) {
  const emojis = DEFAULTS.display.severityEmojis;
  switch (severity) {
    case Severity.LOW: return emojis.low;
    case Severity.MODERATE: return emojis.moderate;
    case Severity.SEVERE: return emojis.severe;
    case Severity.EXTREME: return emojis.extreme;
    default: return '⚪';
  }
}

/**
 * Get trend emoji
 */
export function getTrendEmoji(direction) {
  const emojis = DEFAULTS.display.trendEmojis;
  switch (direction) {
    case 'STRONG_UP': return emojis.strongUp;
    case 'UP':
    case 'WEAK_UP': return emojis.up;
    case 'NEUTRAL': return emojis.flat;
    case 'DOWN':
    case 'WEAK_DOWN': return emojis.down;
    case 'STRONG_DOWN': return emojis.strongDown;
    default: return emojis.flat;
  }
}

/**
 * Get RSI signal emoji
 */
export function getRsiEmoji(rsiValue) {
  if (rsiValue >= 80) return '🔥'; // Extremely overbought
  if (rsiValue >= 70) return '🟠'; // Overbought
  if (rsiValue <= 20) return '❄️'; // Extremely oversold
  if (rsiValue <= 30) return '🔵'; // Oversold
  return '⚪'; // Neutral
}

/**
 * Get alert type emoji
 */
export function getAlertTypeEmoji(alertType) {
  switch (alertType) {
    case AlertType.PRICE_TARGET: return '🎯';
    case AlertType.PRICE_CHANGE: return '📊';
    case AlertType.VOLUME_SPIKE: return '📈';
    case AlertType.MARGIN_THRESHOLD: return '💹';
    case AlertType.PUMP_DETECTED: return '🚀';
    case AlertType.DUMP_DETECTED: return '💥';
    case AlertType.ACCUMULATION: return '🐋';
    case AlertType.DISTRIBUTION: return '📤';
    case AlertType.WASH_TRADING: return '🔄';
    case AlertType.UNUSUAL_ACTIVITY: return '⚠️';
    case AlertType.RSI_SIGNAL: return '📉';
    case AlertType.CORRELATION_BREAK: return '🔗';
    default: return '🔔';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRESS BARS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a progress bar
 */
export function progressBar(value, max, width = 10, filled = '█', empty = '░') {
  const percent = Math.min(1, Math.max(0, value / max));
  const filledCount = Math.round(percent * width);
  return filled.repeat(filledCount) + empty.repeat(width - filledCount);
}

/**
 * Generate a score bar (0-100)
 */
export function scoreBar(score, width = 10) {
  let color = '🟢';
  if (score >= 70) color = '🔴';
  else if (score >= 50) color = '🟠';
  else if (score >= 30) color = '🟡';
  
  return `${color} ${progressBar(score, 100, width)} ${score}/100`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get item wiki URL
 */
export function getWikiUrl(itemName) {
  return `https://oldschool.runescape.wiki/w/${encodeURIComponent(itemName)}`;
}

/**
 * Get item price chart URL
 */
export function getPriceChartUrl(itemId) {
  return `https://prices.runescape.wiki/osrs/item/${itemId}`;
}

/**
 * Get item icon URL
 */
export function getItemIconUrl(iconName) {
  if (!iconName) return null;
  return `https://oldschool.runescape.wiki/images/${encodeURIComponent(iconName)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Truncate text with ellipsis
 */
export function truncate(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Create a code block
 */
export function codeBlock(text, language = '') {
  return `\`\`\`${language}\n${text}\n\`\`\``;
}

/**
 * Create inline code
 */
export function inlineCode(text) {
  return `\`${text}\``;
}

/**
 * Bold text
 */
export function bold(text) {
  return `**${text}**`;
}

/**
 * Italic text
 */
export function italic(text) {
  return `*${text}*`;
}

export default {
  formatNumber,
  formatGp,
  formatPercent,
  formatPercentColored,
  formatRelativeTime,
  formatDateTime,
  formatDuration,
  generateSparkline,
  getSeverityEmoji,
  getTrendEmoji,
  getRsiEmoji,
  getAlertTypeEmoji,
  progressBar,
  scoreBar,
  getWikiUrl,
  getPriceChartUrl,
  getItemIconUrl,
  truncate,
  codeBlock,
  inlineCode,
  bold,
};
