// src/services/DataStore.js
// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER V2 - DATA STORE SERVICE
// ═══════════════════════════════════════════════════════════════════════════════
// Manages persistence for portfolios, veng list, and other user data
// ═══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

class DataStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    
    // In-memory stores
    this.portfolios = new Map();   // `${guildId}-${userId}` -> { trades: [] }
    this.vengList = [];             // [{ rsn, reason, addedBy, addedAt }]
    this.loot = [];                 // Loot records
    
    // File paths
    this.files = {
      portfolios: path.join(dataDir, 'portfolios.json'),
      vengList: path.join(dataDir, 'venglist.json'),
      loot: path.join(dataDir, 'loot.json'),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════════

  initialize() {
    console.log('💾 [DataStore] Initializing...');
    this.loadAll();
    console.log(`✅ [DataStore] Loaded ${this.portfolios.size} portfolios, ${this.vengList.length} veng entries`);
  }

  loadAll() {
    // Portfolios
    try {
      if (fs.existsSync(this.files.portfolios)) {
        const data = JSON.parse(fs.readFileSync(this.files.portfolios, 'utf8'));
        for (const [key, portfolio] of Object.entries(data)) {
          this.portfolios.set(key, portfolio);
        }
      }
    } catch (e) { console.error('Error loading portfolios:', e.message); }

    // Veng list
    try {
      if (fs.existsSync(this.files.vengList)) {
        this.vengList = JSON.parse(fs.readFileSync(this.files.vengList, 'utf8'));
      }
    } catch (e) { console.error('Error loading veng list:', e.message); }

    // Loot
    try {
      if (fs.existsSync(this.files.loot)) {
        this.loot = JSON.parse(fs.readFileSync(this.files.loot, 'utf8'));
      }
    } catch (e) { console.error('Error loading loot:', e.message); }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PORTFOLIO MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  makePortfolioKey(guildId, userId) {
    return `${guildId}-${userId}`;
  }

  getPortfolio(guildId, userId) {
    const key = this.makePortfolioKey(guildId, userId);
    if (!this.portfolios.has(key)) {
      this.portfolios.set(key, { trades: [] });
    }
    return this.portfolios.get(key);
  }

  addTrade(guildId, userId, trade) {
    const portfolio = this.getPortfolio(guildId, userId);
    portfolio.trades.push({
      ...trade,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    });
    this.savePortfolios();
    return portfolio;
  }

  getPortfolioSummary(guildId, userId, latestPrices) {
    const portfolio = this.getPortfolio(guildId, userId);
    if (!portfolio.trades.length) return null;

    // Calculate holdings using FIFO
    const holdings = new Map(); // itemId -> { qty, costBasis }
    let realised = 0;

    const sortedTrades = [...portfolio.trades].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );

    for (const trade of sortedTrades) {
      const entry = holdings.get(trade.itemId) || { qty: 0, costBasis: 0 };

      if (trade.type === 'BUY') {
        const totalCost = entry.costBasis * entry.qty + trade.price * trade.qty;
        const newQty = entry.qty + trade.qty;
        entry.qty = newQty;
        entry.costBasis = newQty > 0 ? totalCost / newQty : 0;
      } else if (trade.type === 'SELL') {
        const sellQty = Math.min(entry.qty, trade.qty);
        if (sellQty > 0) {
          const cost = entry.costBasis * sellQty;
          const revenue = trade.price * sellQty;
          realised += revenue - cost;
          entry.qty -= sellQty;
        }
      }

      holdings.set(trade.itemId, entry);
    }

    // Calculate current value
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
    const totalPnl = realised + unrealised;

    return {
      holdings,
      realised,
      invested,
      currentValue,
      unrealised,
      totalPnl,
      tradeCount: portfolio.trades.length,
    };
  }

  clearPortfolio(guildId, userId) {
    const key = this.makePortfolioKey(guildId, userId);
    const portfolio = this.portfolios.get(key);
    const count = portfolio?.trades?.length || 0;
    this.portfolios.set(key, { trades: [] });
    this.savePortfolios();
    return count;
  }

  savePortfolios() {
    const data = Object.fromEntries(this.portfolios);
    fs.writeFileSync(this.files.portfolios, JSON.stringify(data, null, 2));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // VENGEANCE LIST
  // ═══════════════════════════════════════════════════════════════════════════════

  addToVengList(rsns, reason, addedBy) {
    const names = Array.isArray(rsns) ? rsns : [rsns];
    let added = 0;
    let already = 0;

    for (const rsn of names) {
      const trimmed = rsn.trim();
      if (!trimmed) continue;

      const exists = this.vengList.find(
        v => v.rsn.toLowerCase() === trimmed.toLowerCase()
      );

      if (exists) {
        already++;
        continue;
      }

      this.vengList.push({
        rsn: trimmed,
        reason: reason || 'No reason provided',
        addedBy,
        addedAt: new Date().toISOString(),
      });
      added++;
    }

    this.saveVengList();
    return { added, already };
  }

  removeFromVengList(rsn) {
    const index = this.vengList.findIndex(
      v => v.rsn.toLowerCase() === rsn.toLowerCase()
    );

    if (index === -1) return null;

    const removed = this.vengList.splice(index, 1)[0];
    this.saveVengList();
    return removed;
  }

  getVengList() {
    return [...this.vengList];
  }

  clearVengList() {
    const count = this.vengList.length;
    this.vengList = [];
    this.saveVengList();
    return count;
  }

  saveVengList() {
    fs.writeFileSync(this.files.vengList, JSON.stringify(this.vengList, null, 2));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // LOOT TRACKING
  // ═══════════════════════════════════════════════════════════════════════════════

  addLoot(lootRecord) {
    this.loot.push({
      ...lootRecord,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    });
    this.saveLoot();
    return this.loot[this.loot.length - 1];
  }

  getLoot(limit = 100) {
    return this.loot.slice(-limit);
  }

  getLootStats() {
    if (!this.loot.length) return null;

    const totalValue = this.loot.reduce((sum, l) => sum + (l.totalValue || 0), 0);
    const killCount = this.loot.length;

    return {
      totalValue,
      killCount,
      averageValue: Math.round(totalValue / killCount),
    };
  }

  saveLoot() {
    fs.writeFileSync(this.files.loot, JSON.stringify(this.loot, null, 2));
  }
}

// Singleton
let dataStore = null;

export function initDataStore(dataDir) {
  dataStore = new DataStore(dataDir);
  dataStore.initialize();
  return dataStore;
}

export function getDataStore() {
  if (!dataStore) {
    throw new Error('DataStore not initialized. Call initDataStore(dataDir) first.');
  }
  return dataStore;
}

export default { initDataStore, getDataStore };
