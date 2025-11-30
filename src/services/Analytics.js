// src/services/Analytics.js
// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER V2 - ANALYTICS SERVICE
// ═══════════════════════════════════════════════════════════════════════════════
// Technical analysis, manipulation detection, and market intelligence
// ═══════════════════════════════════════════════════════════════════════════════

import { DEFAULTS, Severity } from '../../config/defaults.js';
import geApi from './GeApi.js';

class AnalyticsService {
  constructor() {
    // Cache for computed analytics
    this.cache = new Map();
    this.cacheExpiry = 60000; // 1 minute cache
    
    // Manipulation tracking
    this.pumpHistory = new Map();     // itemId -> [{ timestamp, priceChange, volumeChange }]
    this.unusualActivity = new Map(); // itemId -> { score, reasons[], lastUpdated }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRICE ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Calculate price change over a time period
   */
  calculatePriceChange(itemId, hoursBack = 1) {
    const current = geApi.getPrice(itemId);
    const past = geApi.getPriceAtOffset(itemId, hoursBack);
    
    if (!current?.high || !past?.high) return null;
    
    const changeAmount = current.high - past.high;
    const changePercent = (changeAmount / past.high) * 100;
    
    return {
      currentPrice: current.high,
      pastPrice: past.high,
      changeAmount,
      changePercent,
      timeframe: hoursBack,
    };
  }

  /**
   * Calculate margin and flip potential
   */
  calculateMargin(itemId) {
    const prices = geApi.getPrice(itemId);
    const item = geApi.getItem(itemId);
    
    if (!prices?.high || !prices?.low || !item) return null;
    
    // GE tax: 1% on items >= 100gp, capped at 5M
    const taxRate = prices.high >= 100 ? 0.01 : 0;
    const tax = Math.min(Math.floor(prices.high * taxRate), 5000000);
    
    const margin = prices.high - prices.low - tax;
    const marginPercent = (margin / prices.low) * 100;
    const buyLimit = item.limit || 0;
    const potentialProfit = buyLimit ? margin * buyLimit : margin;
    const capitalRequired = prices.low * (buyLimit || 1);
    const roiPer4h = capitalRequired > 0 ? (potentialProfit / capitalRequired) * 100 : 0;
    const roiPerHour = roiPer4h / 4;
    
    return {
      high: prices.high,
      low: prices.low,
      margin,
      marginPercent,
      tax,
      buyLimit,
      potentialProfit,
      capitalRequired,
      roiPer4h,
      roiPerHour,
    };
  }

  /**
   * Calculate volatility metrics
   */
  calculateVolatility(itemId) {
    const history = geApi.getHistory(itemId);
    if (!history || history.length < 12) return null;
    
    const prices = history.map(h => h.high).filter(p => p != null);
    if (prices.length < 12) return null;
    
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    const volatilityPercent = (stdDev / mean) * 100;
    
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min;
    const rangePercent = (range / mean) * 100;
    
    return {
      mean: Math.round(mean),
      stdDev: Math.round(stdDev),
      volatilityPercent: parseFloat(volatilityPercent.toFixed(2)),
      min,
      max,
      range,
      rangePercent: parseFloat(rangePercent.toFixed(2)),
      isHighVolatility: volatilityPercent >= DEFAULTS.technicalAnalysis.volatility.highThreshold,
      isLowVolatility: volatilityPercent <= DEFAULTS.technicalAnalysis.volatility.lowThreshold,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TECHNICAL INDICATORS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Simple Moving Average
   */
  calculateSMA(itemId, periods) {
    const history = geApi.getHistory(itemId);
    if (!history || history.length < periods) return null;
    
    const prices = history.slice(-periods).map(h => h.high).filter(p => p != null);
    if (prices.length < periods) return null;
    
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  /**
   * Exponential Moving Average
   */
  calculateEMA(itemId, periods) {
    const history = geApi.getHistory(itemId);
    if (!history || history.length < periods) return null;
    
    const prices = history.map(h => h.high).filter(p => p != null);
    if (prices.length < periods) return null;
    
    const multiplier = 2 / (periods + 1);
    let ema = prices.slice(0, periods).reduce((a, b) => a + b, 0) / periods;
    
    for (let i = periods; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }

  /**
   * Relative Strength Index (RSI)
   */
  calculateRSI(itemId, periods = 14) {
    const history = geApi.getHistory(itemId);
    if (!history || history.length < periods + 1) return null;
    
    const prices = history.map(h => h.high).filter(p => p != null);
    if (prices.length < periods + 1) return null;
    
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }
    
    const recentChanges = changes.slice(-periods);
    
    let avgGain = 0;
    let avgLoss = 0;
    
    for (const change of recentChanges) {
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }
    
    avgGain /= periods;
    avgLoss /= periods;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    const { overbought, oversold } = DEFAULTS.technicalAnalysis.rsi;
    
    return {
      value: parseFloat(rsi.toFixed(2)),
      isOverbought: rsi >= overbought,
      isOversold: rsi <= oversold,
      signal: rsi >= overbought ? 'OVERBOUGHT' : rsi <= oversold ? 'OVERSOLD' : 'NEUTRAL',
    };
  }

  /**
   * Moving Average Convergence/Divergence (MACD)
   */
  calculateMACD(itemId) {
    const ema12 = this.calculateEMA(itemId, 12);
    const ema26 = this.calculateEMA(itemId, 26);
    
    if (ema12 === null || ema26 === null) return null;
    
    const macd = ema12 - ema26;
    // Signal line would need EMA of MACD, simplified here
    
    return {
      macd,
      signal: macd > 0 ? 'BULLISH' : 'BEARISH',
    };
  }

  /**
   * Get trend direction and strength
   */
  analyzeTrend(itemId) {
    const smaFast = this.calculateSMA(itemId, DEFAULTS.technicalAnalysis.movingAverages.fast);
    const smaMedium = this.calculateSMA(itemId, DEFAULTS.technicalAnalysis.movingAverages.medium);
    const smaSlow = this.calculateSMA(itemId, DEFAULTS.technicalAnalysis.movingAverages.slow);
    const current = geApi.getPrice(itemId)?.high;
    
    if (!smaFast || !current) return null;
    
    let direction = 'NEUTRAL';
    let strength = 0;
    
    // Price above all MAs = strong uptrend
    if (smaSlow && smaMedium) {
      if (current > smaFast && smaFast > smaMedium && smaMedium > smaSlow) {
        direction = 'STRONG_UP';
        strength = 3;
      } else if (current < smaFast && smaFast < smaMedium && smaMedium < smaSlow) {
        direction = 'STRONG_DOWN';
        strength = -3;
      } else if (current > smaFast && current > smaMedium) {
        direction = 'UP';
        strength = 2;
      } else if (current < smaFast && current < smaMedium) {
        direction = 'DOWN';
        strength = -2;
      } else if (current > smaFast) {
        direction = 'WEAK_UP';
        strength = 1;
      } else if (current < smaFast) {
        direction = 'WEAK_DOWN';
        strength = -1;
      }
    }
    
    return {
      direction,
      strength,
      smaFast,
      smaMedium,
      smaSlow,
      priceVsFast: current && smaFast ? ((current - smaFast) / smaFast) * 100 : null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MANIPULATION DETECTION
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Detect pump patterns
   */
  async detectPump(itemId) {
    const config = DEFAULTS.manipulation.pump;
    const change = this.calculatePriceChange(itemId, 1);
    
    if (!change) return null;
    
    // Check if price increase meets threshold
    if (change.changePercent < config.minPriceIncrease) return null;
    
    // Check for sustained increase
    const history = geApi.getHistory(itemId);
    if (!history || history.length < config.sustainedPeriods * 2) return null;
    
    // Get recent periods
    const periodsToCheck = Math.min(config.sustainedPeriods, Math.floor(history.length / 2));
    let consecutiveIncreases = 0;
    
    for (let i = history.length - 1; i > history.length - 1 - periodsToCheck && i > 0; i--) {
      if (history[i].high > history[i - 1].high) {
        consecutiveIncreases++;
      }
    }
    
    if (consecutiveIncreases < config.sustainedPeriods - 1) return null;
    
    // Calculate severity
    let severity = Severity.LOW;
    if (change.changePercent >= config.minPriceIncrease * 2) severity = Severity.MODERATE;
    if (change.changePercent >= config.minPriceIncrease * 3) severity = Severity.SEVERE;
    if (change.changePercent >= config.minPriceIncrease * 4) severity = Severity.EXTREME;
    
    return {
      detected: true,
      type: 'PUMP',
      itemId,
      priceChange: change.changePercent,
      consecutiveIncreases,
      severity,
      confidence: Math.min(95, 50 + (consecutiveIncreases * 10) + (change.changePercent * 2)),
    };
  }

  /**
   * Detect dump patterns
   */
  detectDump(itemId) {
    const config = DEFAULTS.manipulation.dump;
    const change = this.calculatePriceChange(itemId, 0.5); // 30 min
    
    if (!change) return null;
    
    if (change.changePercent > config.minPriceDecrease) return null;
    
    let severity = Severity.LOW;
    if (change.changePercent <= config.minPriceDecrease * 1.5) severity = Severity.MODERATE;
    if (change.changePercent <= config.minPriceDecrease * 2) severity = Severity.SEVERE;
    if (change.changePercent <= config.minPriceDecrease * 3) severity = Severity.EXTREME;
    
    return {
      detected: true,
      type: 'DUMP',
      itemId,
      priceChange: change.changePercent,
      severity,
      confidence: Math.min(95, 50 + Math.abs(change.changePercent) * 3),
    };
  }

  /**
   * Detect accumulation (whale buying quietly)
   */
  detectAccumulation(itemId) {
    const config = DEFAULTS.manipulation.accumulation;
    const volatility = this.calculateVolatility(itemId);
    
    if (!volatility) return null;
    
    // Low volatility with steady price = potential accumulation
    if (volatility.volatilityPercent > config.priceStability) return null;
    
    // Would need volume data to confirm - simplified check
    const trend = this.analyzeTrend(itemId);
    if (!trend || trend.strength < 1) return null;
    
    return {
      detected: true,
      type: 'ACCUMULATION',
      itemId,
      volatility: volatility.volatilityPercent,
      trend: trend.direction,
      confidence: 60,
    };
  }

  /**
   * Calculate Unusual Activity Score (0-100)
   */
  calculateUnusualActivityScore(itemId) {
    let score = 0;
    const reasons = [];
    
    // Price change component (0-30 points)
    const change1h = this.calculatePriceChange(itemId, 1);
    const change6h = this.calculatePriceChange(itemId, 6);
    
    if (change1h) {
      const absChange = Math.abs(change1h.changePercent);
      if (absChange >= 20) { score += 30; reasons.push(`Extreme 1h change: ${change1h.changePercent.toFixed(1)}%`); }
      else if (absChange >= 10) { score += 20; reasons.push(`High 1h change: ${change1h.changePercent.toFixed(1)}%`); }
      else if (absChange >= 5) { score += 10; reasons.push(`Notable 1h change: ${change1h.changePercent.toFixed(1)}%`); }
    }
    
    // Volatility component (0-20 points)
    const volatility = this.calculateVolatility(itemId);
    if (volatility) {
      if (volatility.volatilityPercent >= 20) { score += 20; reasons.push(`Extreme volatility: ${volatility.volatilityPercent}%`); }
      else if (volatility.volatilityPercent >= 15) { score += 15; reasons.push(`High volatility: ${volatility.volatilityPercent}%`); }
      else if (volatility.volatilityPercent >= 10) { score += 10; reasons.push(`Elevated volatility: ${volatility.volatilityPercent}%`); }
    }
    
    // RSI component (0-20 points)
    const rsi = this.calculateRSI(itemId);
    if (rsi) {
      if (rsi.value >= 85 || rsi.value <= 15) { score += 20; reasons.push(`Extreme RSI: ${rsi.value}`); }
      else if (rsi.isOverbought || rsi.isOversold) { score += 10; reasons.push(`RSI signal: ${rsi.signal}`); }
    }
    
    // Trend strength component (0-15 points)
    const trend = this.analyzeTrend(itemId);
    if (trend && Math.abs(trend.strength) >= 3) {
      score += 15;
      reasons.push(`Strong trend: ${trend.direction}`);
    }
    
    // Price vs moving averages (0-15 points)
    if (trend?.priceVsFast) {
      const deviation = Math.abs(trend.priceVsFast);
      if (deviation >= 10) { score += 15; reasons.push(`Price far from MA: ${deviation.toFixed(1)}%`); }
      else if (deviation >= 5) { score += 8; reasons.push(`Price deviating from MA: ${deviation.toFixed(1)}%`); }
    }
    
    // Determine severity
    const thresholds = DEFAULTS.manipulation.unusualActivityScore;
    let severity = null;
    if (score >= thresholds.extreme) severity = Severity.EXTREME;
    else if (score >= thresholds.high) severity = Severity.SEVERE;
    else if (score >= thresholds.medium) severity = Severity.MODERATE;
    else if (score >= thresholds.low) severity = Severity.LOW;
    
    return {
      score: Math.min(100, score),
      severity,
      reasons,
      timestamp: Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FLIP FINDING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Find best flipping opportunities with smart scoring
   */
  findBestFlips(options = {}) {
    const config = { ...DEFAULTS.flipFinder.minimums, ...options };
    const weights = DEFAULTS.flipFinder.weights;
    const flips = [];
    
    for (const itemId of geApi.getAllPricedItemIds()) {
      const margin = this.calculateMargin(itemId);
      const item = geApi.getItem(itemId);
      
      if (!margin || !item) continue;
      
      // Apply minimum filters
      if (margin.marginPercent < config.marginPercent) continue;
      if (margin.margin < config.marginGp) continue;
      if (margin.buyLimit < config.buyLimit) continue;
      
      // Calculate base score
      let score = 0;
      score += margin.marginPercent * weights.marginPercent * 10;
      score += margin.roiPerHour * weights.roiPerHour * 5;
      score += Math.min(margin.buyLimit / 1000, 10) * weights.limit;
      
      // Volatility penalty
      const volatility = this.calculateVolatility(itemId);
      if (volatility?.isHighVolatility) {
        score *= (1 - DEFAULTS.flipFinder.risk.highVolatilityPenalty);
      }
      
      // Recent crash penalty
      const change24h = this.calculatePriceChange(itemId, 24);
      if (change24h && change24h.changePercent < -15) {
        score *= (1 - DEFAULTS.flipFinder.risk.recentCrashPenalty);
      }
      
      flips.push({
        item,
        ...margin,
        score,
        volatility: volatility?.volatilityPercent || null,
        rsi: this.calculateRSI(itemId)?.value || null,
        trend: this.analyzeTrend(itemId)?.direction || null,
      });
    }
    
    // Sort by score descending
    flips.sort((a, b) => b.score - a.score);
    
    return flips.slice(0, options.limit || 20);
  }

  /**
   * Find biggest movers
   */
  findBiggestMovers(hoursBack = 1, limit = 20) {
    const movers = { gainers: [], losers: [] };
    
    for (const itemId of geApi.getAllPricedItemIds()) {
      const item = geApi.getItem(itemId);
      const change = this.calculatePriceChange(itemId, hoursBack);
      
      if (!item || !change || Math.abs(change.changePercent) < 1) continue;
      
      const entry = { item, ...change };
      
      if (change.changePercent > 0) {
        movers.gainers.push(entry);
      } else {
        movers.losers.push(entry);
      }
    }
    
    movers.gainers.sort((a, b) => b.changePercent - a.changePercent);
    movers.losers.sort((a, b) => a.changePercent - b.changePercent);
    
    return {
      gainers: movers.gainers.slice(0, limit),
      losers: movers.losers.slice(0, limit),
    };
  }

  /**
   * Find most volatile items
   */
  findMostVolatile(limit = 20) {
    const volatile = [];
    
    for (const itemId of geApi.getAllPricedItemIds()) {
      const item = geApi.getItem(itemId);
      const vol = this.calculateVolatility(itemId);
      
      if (!item || !vol) continue;
      
      volatile.push({ item, ...vol });
    }
    
    volatile.sort((a, b) => b.volatilityPercent - a.volatilityPercent);
    return volatile.slice(0, limit);
  }

  /**
   * Scan for manipulation signals
   */
  async scanForManipulation(limit = 20) {
    const signals = [];
    
    for (const itemId of geApi.getAllPricedItemIds()) {
      const item = geApi.getItem(itemId);
      if (!item) continue;
      
      const activity = this.calculateUnusualActivityScore(itemId);
      
      if (activity.severity) {
        signals.push({
          item,
          ...activity,
        });
      }
    }
    
    signals.sort((a, b) => b.score - a.score);
    return signals.slice(0, limit);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CORRELATION ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Calculate Pearson correlation between two items
   */
  calculateCorrelation(itemId1, itemId2) {
    const history1 = geApi.getHistory(itemId1);
    const history2 = geApi.getHistory(itemId2);
    
    if (!history1 || !history2) return null;
    
    const len = Math.min(history1.length, history2.length);
    if (len < 10) return null;
    
    const prices1 = history1.slice(-len).map(h => h.high).filter(p => p != null);
    const prices2 = history2.slice(-len).map(h => h.high).filter(p => p != null);
    
    if (prices1.length < 10 || prices2.length < 10) return null;
    
    const n = Math.min(prices1.length, prices2.length);
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += prices1[i];
      sumY += prices2[i];
      sumXY += prices1[i] * prices2[i];
      sumX2 += prices1[i] * prices1[i];
      sumY2 += prices2[i] * prices2[i];
    }
    
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    if (!den) return null;
    
    return num / den;
  }

  /**
   * Find items most correlated to a given item
   */
  findCorrelatedItems(baseItemId, limit = 10) {
    const results = [];
    
    for (const itemId of geApi.getAllPricedItemIds()) {
      if (itemId === baseItemId) continue;
      
      const r = this.calculateCorrelation(baseItemId, itemId);
      if (r === null || isNaN(r)) continue;
      
      results.push({
        itemId,
        item: geApi.getItem(itemId),
        correlation: r,
      });
    }
    
    results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
    return results.slice(0, limit);
  }
}

// Singleton
const analytics = new AnalyticsService();
export default analytics;
