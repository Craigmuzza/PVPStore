// src/services/GeApi.js
// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER V2 - GE API SERVICE
// ═══════════════════════════════════════════════════════════════════════════════
// Handles all communication with the OSRS Wiki Prices API
// ═══════════════════════════════════════════════════════════════════════════════

import { DEFAULTS } from '../../config/defaults.js';

class GeApiService {
  constructor() {
    this.baseUrl = DEFAULTS.api.baseUrl;
    this.userAgent = DEFAULTS.api.userAgent;
    
    // Item data
    this.itemMapping = new Map();      // id -> item data
    this.itemNameLookup = new Map();   // lowercase name -> id
    
    // Price data
    this.latestPrices = new Map();     // id -> { high, low, highTime, lowTime }
    this.previousPrices = new Map();   // id -> previous price snapshot
    this.priceHistory = new Map();     // id -> [{ high, low, timestamp }, ...]
    
    // Volume data
    this.volumeHistory = new Map();    // id -> [{ volume, timestamp }, ...]
    this.volumeBaselines = new Map();  // id -> { mean, stdDev }
    
    // Metadata
    this.lastUpdate = null;
    this.isInitialized = false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────────────────────────
  async initialize() {
    console.log('📡 [GeApi] Initializing...');
    
    const mappingLoaded = await this.fetchMapping();
    if (!mappingLoaded) {
      throw new Error('Failed to load item mapping');
    }
    
    const pricesLoaded = await this.fetchLatestPrices();
    if (!pricesLoaded) {
      throw new Error('Failed to load initial prices');
    }
    
    this.isInitialized = true;
    console.log(`✅ [GeApi] Initialized with ${this.itemMapping.size} items`);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // API FETCHING
  // ─────────────────────────────────────────────────────────────────────────────
  async fetch(endpoint) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: { 'User-Agent': this.userAgent }
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`❌ [GeApi] Fetch error for ${endpoint}:`, error.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ITEM MAPPING
  // ─────────────────────────────────────────────────────────────────────────────
  async fetchMapping() {
    const data = await this.fetch('/mapping');
    if (!data) return false;
    
    this.itemMapping.clear();
    this.itemNameLookup.clear();
    
    for (const item of data) {
      this.itemMapping.set(item.id, {
        id: item.id,
        name: item.name,
        examine: item.examine,
        icon: item.icon,
        members: item.members,
        limit: item.limit,
        value: item.value,
        highalch: item.highalch,
        lowalch: item.lowalch,
      });
      this.itemNameLookup.set(item.name.toLowerCase(), item.id);
    }
    
    console.log(`📦 [GeApi] Loaded ${this.itemMapping.size} items`);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRICE FETCHING
  // ─────────────────────────────────────────────────────────────────────────────
  async fetchLatestPrices() {
    const data = await this.fetch('/latest');
    if (!data?.data) return false;
    
    const timestamp = Date.now();
    
    for (const [itemId, priceData] of Object.entries(data.data)) {
      const id = parseInt(itemId);
      
      // Store previous price before updating
      const existing = this.latestPrices.get(id);
      if (existing) {
        this.previousPrices.set(id, { ...existing });
      }
      
      // Update latest
      this.latestPrices.set(id, {
        high: priceData.high,
        low: priceData.low,
        highTime: priceData.highTime,
        lowTime: priceData.lowTime,
        fetchTime: timestamp,
      });
      
      // Add to history
      this.addToHistory(id, priceData, timestamp);
    }
    
    this.lastUpdate = timestamp;
    return true;
  }

  addToHistory(itemId, priceData, timestamp) {
    if (!this.priceHistory.has(itemId)) {
      this.priceHistory.set(itemId, []);
    }
    
    const history = this.priceHistory.get(itemId);
    history.push({
      high: priceData.high,
      low: priceData.low,
      timestamp,
    });
    
    // Trim to max length
    while (history.length > DEFAULTS.api.historyLength) {
      history.shift();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TIMESERIES DATA
  // ─────────────────────────────────────────────────────────────────────────────
  async fetchTimeseries(itemId, timestep = '5m') {
    const data = await this.fetch(`/timeseries?timestep=${timestep}&id=${itemId}`);
    return data?.data || null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ITEM LOOKUP
  // ─────────────────────────────────────────────────────────────────────────────
  getItem(itemId) {
    return this.itemMapping.get(itemId) || null;
  }

  findItem(query) {
    const lowerQuery = query.toLowerCase().trim();
    
    // Exact match first
    if (this.itemNameLookup.has(lowerQuery)) {
      return this.itemMapping.get(this.itemNameLookup.get(lowerQuery));
    }
    
    // Partial match - prefer shorter names (more likely to be exact)
    const matches = [];
    for (const [name, id] of this.itemNameLookup) {
      if (name.includes(lowerQuery)) {
        matches.push(this.itemMapping.get(id));
      }
    }
    
    matches.sort((a, b) => a.name.length - b.name.length);
    return matches[0] || null;
  }

  searchItems(query, limit = 25) {
    const lowerQuery = query.toLowerCase().trim();
    const matches = [];
    
    for (const [name, id] of this.itemNameLookup) {
      if (name.includes(lowerQuery)) {
        matches.push(this.itemMapping.get(id));
      }
    }
    
    // Sort: starts-with first, then by name length
    matches.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(lowerQuery);
      const bStarts = b.name.toLowerCase().startsWith(lowerQuery);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.name.length - b.name.length;
    });
    
    return matches.slice(0, limit);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRICE DATA ACCESSORS
  // ─────────────────────────────────────────────────────────────────────────────
  getPrice(itemId) {
    return this.latestPrices.get(itemId) || null;
  }

  getPreviousPrice(itemId) {
    return this.previousPrices.get(itemId) || null;
  }

  getHistory(itemId) {
    return this.priceHistory.get(itemId) || [];
  }

  // Get prices at specific time offset (hours back)
  getPriceAtOffset(itemId, hoursBack) {
    const history = this.priceHistory.get(itemId);
    if (!history || history.length < 2) return null;
    
    const targetTime = Date.now() - (hoursBack * 60 * 60 * 1000);
    
    // Find closest data point to target time
    let closest = history[0];
    let closestDiff = Math.abs(history[0].timestamp - targetTime);
    
    for (const point of history) {
      const diff = Math.abs(point.timestamp - targetTime);
      if (diff < closestDiff) {
        closest = point;
        closestDiff = diff;
      }
    }
    
    return closest;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BULK DATA
  // ─────────────────────────────────────────────────────────────────────────────
  getAllItemIds() {
    return Array.from(this.itemMapping.keys());
  }

  getAllPricedItemIds() {
    return Array.from(this.latestPrices.keys());
  }

  getItemCount() {
    return this.itemMapping.size;
  }

  getPricedItemCount() {
    return this.latestPrices.size;
  }
}

// Singleton instance
const geApi = new GeApiService();
export default geApi;
