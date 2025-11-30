// src/services/AlertEngine.js
// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER V2 - ALERT ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
// Manages all alerts: creation, storage, evaluation, and triggering
// ═══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { DEFAULTS, AlertType, Severity, Direction } from '../../config/defaults.js';
import geApi from './GeApi.js';
import analytics from './Analytics.js';

class AlertEngine {
  constructor(dataDir) {
    this.dataDir = dataDir;
    
    // Alert storage
    this.userAlerts = new Map();      // odlIndexerId -> [alerts]
    this.serverConfigs = new Map();    // guildId -> config
    this.serverWatchlists = new Map(); // guildId -> Set<itemId>
    
    // Cooldown tracking
    this.alertCooldowns = new Map();   // `${itemId}-${alertType}` -> lastTriggered
    this.channelRateLimits = new Map(); // channelId -> { count, resetTime }
    
    // Triggered alerts queue (for batch sending)
    this.triggeredAlerts = [];
    
    // File paths
    this.files = {
      userAlerts: path.join(dataDir, 'user_alerts.json'),
      serverConfigs: path.join(dataDir, 'server_configs.json'),
      watchlists: path.join(dataDir, 'watchlists.json'),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION & PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════════

  async initialize() {
    console.log('🔔 [AlertEngine] Initializing...');
    this.loadData();
    console.log(`✅ [AlertEngine] Loaded ${this.getTotalAlertCount()} alerts`);
  }

  loadData() {
    // Load user alerts
    try {
      if (fs.existsSync(this.files.userAlerts)) {
        const data = JSON.parse(fs.readFileSync(this.files.userAlerts, 'utf8'));
        for (const [odlIndexerId, alerts] of Object.entries(data)) {
          this.userAlerts.set(odlIndexerId, alerts);
        }
      }
    } catch (e) { console.error('Error loading user alerts:', e.message); }

    // Load server configs
    try {
      if (fs.existsSync(this.files.serverConfigs)) {
        const data = JSON.parse(fs.readFileSync(this.files.serverConfigs, 'utf8'));
        for (const [guildId, config] of Object.entries(data)) {
          this.serverConfigs.set(guildId, config);
        }
      }
    } catch (e) { console.error('Error loading server configs:', e.message); }

    // Load watchlists
    try {
      if (fs.existsSync(this.files.watchlists)) {
        const data = JSON.parse(fs.readFileSync(this.files.watchlists, 'utf8'));
        for (const [guildId, itemIds] of Object.entries(data)) {
          this.serverWatchlists.set(guildId, new Set(itemIds));
        }
      }
    } catch (e) { console.error('Error loading watchlists:', e.message); }
  }

  saveUserAlerts() {
    const data = Object.fromEntries(this.userAlerts);
    fs.writeFileSync(this.files.userAlerts, JSON.stringify(data, null, 2));
  }

  saveServerConfigs() {
    const data = Object.fromEntries(this.serverConfigs);
    fs.writeFileSync(this.files.serverConfigs, JSON.stringify(data, null, 2));
  }

  saveWatchlists() {
    const data = {};
    for (const [guildId, itemSet] of this.serverWatchlists) {
      data[guildId] = Array.from(itemSet);
    }
    fs.writeFileSync(this.files.watchlists, JSON.stringify(data, null, 2));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ALERT CREATION
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Create a user alert ID (combines odlIndexer and guild for uniqueness)
   */
  makeAlertKey(odlIndexerId, guildId) {
    return `${guildId}-${odlIndexerId}`;
  }

  /**
   * Add a price target alert
   */
  addPriceTargetAlert(odlIndexerId, guildId, channelId, itemId, targetPrice, direction) {
    const key = this.makeAlertKey(odlIndexerId, guildId);
    
    if (!this.userAlerts.has(key)) {
      this.userAlerts.set(key, []);
    }
    
    const alert = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: AlertType.PRICE_TARGET,
      odlIndexerId,
      guildId,
      channelId,
      itemId,
      targetPrice,
      direction,
      createdAt: new Date().toISOString(),
      triggered: false,
    };
    
    this.userAlerts.get(key).push(alert);
    this.saveUserAlerts();
    
    return alert;
  }

  /**
   * Add a price change alert (% change threshold)
   */
  addPriceChangeAlert(odlIndexerId, guildId, channelId, itemId, threshold, timeframeHours = 1) {
    const key = this.makeAlertKey(odlIndexerId, guildId);
    
    if (!this.userAlerts.has(key)) {
      this.userAlerts.set(key, []);
    }
    
    const alert = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: AlertType.PRICE_CHANGE,
      odlIndexerId,
      guildId,
      channelId,
      itemId,
      threshold, // Can be positive or negative
      timeframeHours,
      createdAt: new Date().toISOString(),
      triggered: false,
    };
    
    this.userAlerts.get(key).push(alert);
    this.saveUserAlerts();
    
    return alert;
  }

  /**
   * Add a margin threshold alert
   */
  addMarginAlert(odlIndexerId, guildId, channelId, itemId, minMarginPercent, minMarginGp = 0) {
    const key = this.makeAlertKey(odlIndexerId, guildId);
    
    if (!this.userAlerts.has(key)) {
      this.userAlerts.set(key, []);
    }
    
    const alert = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: AlertType.MARGIN_THRESHOLD,
      odlIndexerId,
      guildId,
      channelId,
      itemId,
      minMarginPercent,
      minMarginGp,
      createdAt: new Date().toISOString(),
      triggered: false,
    };
    
    this.userAlerts.get(key).push(alert);
    this.saveUserAlerts();
    
    return alert;
  }

  /**
   * Remove a specific alert by ID
   */
  removeAlert(odlIndexerId, guildId, alertId) {
    const key = this.makeAlertKey(odlIndexerId, guildId);
    const alerts = this.userAlerts.get(key);
    
    if (!alerts) return false;
    
    const index = alerts.findIndex(a => a.id === alertId);
    if (index === -1) return false;
    
    alerts.splice(index, 1);
    this.saveUserAlerts();
    return true;
  }

  /**
   * Remove all alerts for a user in a guild
   */
  clearUserAlerts(odlIndexerId, guildId) {
    const key = this.makeAlertKey(odlIndexerId, guildId);
    const count = this.userAlerts.get(key)?.length || 0;
    this.userAlerts.delete(key);
    this.saveUserAlerts();
    return count;
  }

  /**
   * Get all alerts for a user
   */
  getUserAlerts(odlIndexerId, guildId) {
    const key = this.makeAlertKey(odlIndexerId, guildId);
    return this.userAlerts.get(key) || [];
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SERVER CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Get or create server config
   */
  getServerConfig(guildId) {
    if (!this.serverConfigs.has(guildId)) {
      this.serverConfigs.set(guildId, {
        enabled: false,
        alertChannelId: null,
        
        // Thresholds (override defaults)
        priceChange: { ...DEFAULTS.alerts.priceChange },
        volume: { ...DEFAULTS.alerts.volume },
        margin: { ...DEFAULTS.alerts.margin },
        cooldowns: { ...DEFAULTS.alerts.cooldowns },
        
        // Feature flags
        enablePumpAlerts: true,
        enableDumpAlerts: true,
        enableManipulationAlerts: true,
        enableVolumeAlerts: true,
        
        // Rate limits
        maxAlertsPerHour: DEFAULTS.alerts.rateLimits.maxAlertsPerHour,
      });
    }
    return this.serverConfigs.get(guildId);
  }

  /**
   * Update server config
   */
  updateServerConfig(guildId, updates) {
    const config = this.getServerConfig(guildId);
    Object.assign(config, updates);
    this.saveServerConfigs();
    return config;
  }

  /**
   * Enable alerts for a server
   */
  enableAlerts(guildId, channelId) {
    const config = this.getServerConfig(guildId);
    config.enabled = true;
    config.alertChannelId = channelId;
    this.saveServerConfigs();
    return config;
  }

  /**
   * Disable alerts for a server
   */
  disableAlerts(guildId) {
    const config = this.getServerConfig(guildId);
    config.enabled = false;
    this.saveServerConfigs();
    return config;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // WATCHLISTS
  // ═══════════════════════════════════════════════════════════════════════════════

  getWatchlist(guildId) {
    if (!this.serverWatchlists.has(guildId)) {
      this.serverWatchlists.set(guildId, new Set());
    }
    return this.serverWatchlists.get(guildId);
  }

  addToWatchlist(guildId, itemId) {
    const watchlist = this.getWatchlist(guildId);
    watchlist.add(itemId);
    this.saveWatchlists();
    return true;
  }

  removeFromWatchlist(guildId, itemId) {
    const watchlist = this.getWatchlist(guildId);
    const removed = watchlist.delete(itemId);
    this.saveWatchlists();
    return removed;
  }

  clearWatchlist(guildId) {
    const watchlist = this.getWatchlist(guildId);
    const count = watchlist.size;
    watchlist.clear();
    this.saveWatchlists();
    return count;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // COOLDOWN & RATE LIMITING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Check if an alert is on cooldown
   */
  isOnCooldown(itemId, alertType, cooldownMs) {
    const key = `${itemId}-${alertType}`;
    const lastTriggered = this.alertCooldowns.get(key);
    
    if (!lastTriggered) return false;
    
    return (Date.now() - lastTriggered) < cooldownMs;
  }

  /**
   * Set cooldown for an alert
   */
  setCooldown(itemId, alertType) {
    const key = `${itemId}-${alertType}`;
    this.alertCooldowns.set(key, Date.now());
  }

  /**
   * Check channel rate limit
   */
  checkChannelRateLimit(channelId, maxPerHour) {
    const now = Date.now();
    const hourAgo = now - 3600000;
    
    let limit = this.channelRateLimits.get(channelId);
    
    if (!limit || limit.resetTime < now) {
      limit = { count: 0, resetTime: now + 3600000 };
      this.channelRateLimits.set(channelId, limit);
    }
    
    if (limit.count >= maxPerHour) {
      return false;
    }
    
    limit.count++;
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ALERT EVALUATION
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Main scan function - evaluates all alerts
   */
  async scan() {
    const triggered = [];
    
    // Scan user alerts
    for (const [key, alerts] of this.userAlerts) {
      for (const alert of alerts) {
        if (alert.triggered) continue;
        
        const result = this.evaluateAlert(alert);
        if (result) {
          triggered.push({ alert, result });
          alert.triggered = true;
        }
      }
    }
    
    // Scan server-wide alerts (manipulation detection)
    for (const [guildId, config] of this.serverConfigs) {
      if (!config.enabled || !config.alertChannelId) continue;
      
      const serverAlerts = await this.evaluateServerAlerts(guildId, config);
      triggered.push(...serverAlerts);
    }
    
    // Save triggered state
    if (triggered.length > 0) {
      this.saveUserAlerts();
    }
    
    return triggered;
  }

  /**
   * Evaluate a single user alert
   */
  evaluateAlert(alert) {
    const prices = geApi.getPrice(alert.itemId);
    if (!prices) return null;
    
    switch (alert.type) {
      case AlertType.PRICE_TARGET:
        return this.evaluatePriceTarget(alert, prices);
      
      case AlertType.PRICE_CHANGE:
        return this.evaluatePriceChange(alert);
      
      case AlertType.MARGIN_THRESHOLD:
        return this.evaluateMarginThreshold(alert);
      
      default:
        return null;
    }
  }

  evaluatePriceTarget(alert, prices) {
    const currentPrice = prices.high;
    
    if (alert.direction === Direction.ABOVE && currentPrice >= alert.targetPrice) {
      return {
        type: AlertType.PRICE_TARGET,
        direction: 'above',
        targetPrice: alert.targetPrice,
        currentPrice,
        item: geApi.getItem(alert.itemId),
      };
    }
    
    if (alert.direction === Direction.BELOW && currentPrice <= alert.targetPrice) {
      return {
        type: AlertType.PRICE_TARGET,
        direction: 'below',
        targetPrice: alert.targetPrice,
        currentPrice,
        item: geApi.getItem(alert.itemId),
      };
    }
    
    return null;
  }

  evaluatePriceChange(alert) {
    const change = analytics.calculatePriceChange(alert.itemId, alert.timeframeHours);
    if (!change) return null;
    
    const thresholdMet = alert.threshold > 0
      ? change.changePercent >= alert.threshold
      : change.changePercent <= alert.threshold;
    
    if (!thresholdMet) return null;
    
    // Check cooldown
    if (this.isOnCooldown(alert.itemId, AlertType.PRICE_CHANGE, DEFAULTS.alerts.cooldowns.priceChange)) {
      return null;
    }
    
    this.setCooldown(alert.itemId, AlertType.PRICE_CHANGE);
    
    return {
      type: AlertType.PRICE_CHANGE,
      threshold: alert.threshold,
      actualChange: change.changePercent,
      priceChange: change,
      item: geApi.getItem(alert.itemId),
    };
  }

  evaluateMarginThreshold(alert) {
    const margin = analytics.calculateMargin(alert.itemId);
    if (!margin) return null;
    
    if (margin.marginPercent < alert.minMarginPercent) return null;
    if (margin.margin < alert.minMarginGp) return null;
    
    // Check cooldown
    if (this.isOnCooldown(alert.itemId, AlertType.MARGIN_THRESHOLD, DEFAULTS.alerts.cooldowns.margin)) {
      return null;
    }
    
    this.setCooldown(alert.itemId, AlertType.MARGIN_THRESHOLD);
    
    return {
      type: AlertType.MARGIN_THRESHOLD,
      margin,
      item: geApi.getItem(alert.itemId),
    };
  }

  /**
   * Evaluate server-wide alerts (manipulation detection, etc.)
   */
  async evaluateServerAlerts(guildId, config) {
    const triggered = [];
    const watchlist = this.getWatchlist(guildId);
    
    // Determine which items to scan
    const itemsToScan = watchlist.size > 0
      ? Array.from(watchlist)
      : geApi.getAllPricedItemIds().filter(id => {
          const item = geApi.getItem(id);
          return item?.limit && item.limit >= 50; // Only scan tradeable items
        });
    
    for (const itemId of itemsToScan) {
      const item = geApi.getItem(itemId);
      if (!item) continue;
      
      // Pump detection
      if (config.enablePumpAlerts) {
        const pump = await analytics.detectPump(itemId);
        if (pump?.detected && !this.isOnCooldown(itemId, AlertType.PUMP_DETECTED, config.cooldowns.manipulation || DEFAULTS.alerts.cooldowns.manipulation)) {
          this.setCooldown(itemId, AlertType.PUMP_DETECTED);
          triggered.push({
            alert: { guildId, channelId: config.alertChannelId, itemId },
            result: { type: AlertType.PUMP_DETECTED, ...pump, item },
          });
        }
      }
      
      // Dump detection
      if (config.enableDumpAlerts) {
        const dump = analytics.detectDump(itemId);
        if (dump?.detected && !this.isOnCooldown(itemId, AlertType.DUMP_DETECTED, config.cooldowns.manipulation || DEFAULTS.alerts.cooldowns.manipulation)) {
          this.setCooldown(itemId, AlertType.DUMP_DETECTED);
          triggered.push({
            alert: { guildId, channelId: config.alertChannelId, itemId },
            result: { type: AlertType.DUMP_DETECTED, ...dump, item },
          });
        }
      }
      
      // Unusual activity detection
      if (config.enableManipulationAlerts) {
        const activity = analytics.calculateUnusualActivityScore(itemId);
        if (activity.severity && activity.severity !== Severity.LOW) {
          if (!this.isOnCooldown(itemId, AlertType.UNUSUAL_ACTIVITY, config.cooldowns.manipulation || DEFAULTS.alerts.cooldowns.manipulation)) {
            this.setCooldown(itemId, AlertType.UNUSUAL_ACTIVITY);
            triggered.push({
              alert: { guildId, channelId: config.alertChannelId, itemId },
              result: { type: AlertType.UNUSUAL_ACTIVITY, ...activity, item },
            });
          }
        }
      }
      
      // Price change alerts (server-wide thresholds)
      const change = analytics.calculatePriceChange(itemId, config.priceChange?.timeframe || 1);
      if (change) {
        const { crash, spike } = config.priceChange || DEFAULTS.alerts.priceChange;
        
        // Crash alert
        if (change.changePercent <= crash.moderate) {
          let severity = Severity.MODERATE;
          if (change.changePercent <= crash.extreme) severity = Severity.EXTREME;
          else if (change.changePercent <= crash.severe) severity = Severity.SEVERE;
          
          if (!this.isOnCooldown(itemId, AlertType.PRICE_CHANGE, config.cooldowns.priceChange || DEFAULTS.alerts.cooldowns.priceChange)) {
            this.setCooldown(itemId, AlertType.PRICE_CHANGE);
            triggered.push({
              alert: { guildId, channelId: config.alertChannelId, itemId },
              result: { type: AlertType.PRICE_CHANGE, direction: 'crash', severity, priceChange: change, item },
            });
          }
        }
        
        // Spike alert
        if (change.changePercent >= spike.moderate) {
          let severity = Severity.MODERATE;
          if (change.changePercent >= spike.extreme) severity = Severity.EXTREME;
          else if (change.changePercent >= spike.severe) severity = Severity.SEVERE;
          
          if (!this.isOnCooldown(itemId, `${AlertType.PRICE_CHANGE}_spike`, config.cooldowns.priceChange || DEFAULTS.alerts.cooldowns.priceChange)) {
            this.setCooldown(itemId, `${AlertType.PRICE_CHANGE}_spike`);
            triggered.push({
              alert: { guildId, channelId: config.alertChannelId, itemId },
              result: { type: AlertType.PRICE_CHANGE, direction: 'spike', severity, priceChange: change, item },
            });
          }
        }
      }
    }
    
    return triggered;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════════════════

  getTotalAlertCount() {
    let count = 0;
    for (const alerts of this.userAlerts.values()) {
      count += alerts.length;
    }
    return count;
  }
}

// Factory function (needs dataDir)
let alertEngine = null;

export function initAlertEngine(dataDir) {
  alertEngine = new AlertEngine(dataDir);
  return alertEngine;
}

export function getAlertEngine() {
  if (!alertEngine) {
    throw new Error('AlertEngine not initialized. Call initAlertEngine(dataDir) first.');
  }
  return alertEngine;
}

export default { initAlertEngine, getAlertEngine };
