// config/defaults.js
// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER V2 - DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
// This file contains ALL configurable defaults. Server admins can override these
// per-server, and users can override per-alert.
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULTS = {
  // ─────────────────────────────────────────────────────────────────────────────
  // BRANDING
  // ─────────────────────────────────────────────────────────────────────────────
  brand: {
    name: 'The Crater',
    icon: 'https://i.ibb.co/BVMTHSzM/Y-W-2.png',
    color: 0x1a1a2e,           // Deep midnight blue
    accentColor: 0xff6b35,     // Volcanic orange
    successColor: 0x00d26a,    // Profit green
    dangerColor: 0xff3860,     // Loss red
    warningColor: 0xffdd57,    // Warning yellow
    infoColor: 0x3298dc,       // Info blue
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // API CONFIGURATION
  // ─────────────────────────────────────────────────────────────────────────────
  api: {
    baseUrl: 'https://prices.runescape.wiki/api/v1/osrs',
    userAgent: 'TheCrater-V2-GE-Tracker/2.0 (Discord Bot; Contact: craig@example.com)',
    
    // How often to fetch latest prices (ms)
    pollInterval: 30000,        // 30 seconds
    
    // How often to run alert scans (ms)
    alertScanInterval: 60000,   // 1 minute
    
    // How often to run manipulation scans (ms)
    manipulationScanInterval: 300000,  // 5 minutes
    
    // Price history retention (data points)
    historyLength: 576,         // 24 hours at 5-min intervals (288) x 2
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // ALERT THRESHOLDS (Server defaults - can be overridden)
  // ─────────────────────────────────────────────────────────────────────────────
  alerts: {
    // Price change alerts
    priceChange: {
      crash: {
        moderate: -5,           // % drop for moderate alert
        severe: -10,            // % drop for severe alert
        extreme: -20,           // % drop for extreme alert
      },
      spike: {
        moderate: 5,            // % rise for moderate alert
        severe: 10,             // % rise for severe alert
        extreme: 20,            // % rise for extreme alert
      },
      timeframe: 1,             // Hours to look back for change calculation
    },

    // Volume alerts
    volume: {
      spikeMultiplier: 3,       // Alert when volume is Nx baseline
      baselinePeriod: 24,       // Hours to calculate baseline
      minimumVolume: 100,       // Minimum volume to trigger alert
    },

    // Margin alerts
    margin: {
      minimumPercent: 3,        // Minimum margin % to be "interesting"
      minimumGp: 500,           // Minimum margin gp to alert
      minimumLimit: 50,         // Minimum buy limit for flip alerts
    },

    // Cooldowns (prevent spam)
    cooldowns: {
      priceChange: 3600000,     // 1 hour between same-item price alerts
      volume: 1800000,          // 30 min between same-item volume alerts
      margin: 7200000,          // 2 hours between same-item margin alerts
      manipulation: 3600000,    // 1 hour between same-item manipulation alerts
    },

    // Rate limits
    rateLimits: {
      maxAlertsPerHour: 50,     // Max alerts per channel per hour
      maxAlertsPerItem: 5,      // Max alerts per item per hour
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // MANIPULATION DETECTION THRESHOLDS
  // ─────────────────────────────────────────────────────────────────────────────
  manipulation: {
    // Pump detection
    pump: {
      minPriceIncrease: 8,      // % minimum price increase
      minVolumeSurge: 2,        // Volume multiplier vs baseline
      sustainedPeriods: 3,      // Number of consecutive periods showing increase
      periodLength: 5,          // Minutes per period
    },

    // Dump detection
    dump: {
      minPriceDecrease: -10,    // % minimum price decrease
      rapidTimeframe: 30,       // Minutes for "rapid" dump
      postPumpWindow: 120,      // Minutes after pump to watch for dump
    },

    // Accumulation detection (whales quietly buying)
    accumulation: {
      priceStability: 3,        // Max % price change during accumulation
      volumeIncrease: 1.5,      // Volume multiplier showing increased activity
      periods: 6,               // Consecutive periods to confirm
    },

    // Distribution detection (whales quietly selling)
    distribution: {
      priceStability: 3,        // Max % price change during distribution
      volumeIncrease: 1.5,      // Volume multiplier
      periods: 6,               // Consecutive periods to confirm
    },

    // Wash trading signals (fake volume)
    washTrading: {
      highVolumeThreshold: 5,   // Volume multiplier vs normal
      lowPriceMovement: 1,      // Max % price movement
      spreadCompression: 0.5,   // Spread as % of price (unusually tight)
    },

    // Unusual Activity Score thresholds
    unusualActivityScore: {
      low: 30,                  // Score 30-50 = worth watching
      medium: 50,               // Score 50-70 = suspicious
      high: 70,                 // Score 70-90 = likely manipulation
      extreme: 90,              // Score 90+ = almost certain manipulation
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // TECHNICAL ANALYSIS SETTINGS
  // ─────────────────────────────────────────────────────────────────────────────
  technicalAnalysis: {
    // Moving averages (periods in data points, e.g., 12 = 1 hour at 5min intervals)
    movingAverages: {
      fast: 12,                 // 1 hour MA
      medium: 72,               // 6 hour MA
      slow: 288,                // 24 hour MA
    },

    // RSI (Relative Strength Index)
    rsi: {
      period: 14,               // Standard RSI period
      overbought: 70,           // Above = overbought
      oversold: 30,             // Below = oversold
    },

    // Volatility
    volatility: {
      highThreshold: 15,        // % stddev = high volatility
      lowThreshold: 3,          // % stddev = low volatility
    },

    // Support/Resistance
    supportResistance: {
      touchesRequired: 3,       // Times price must touch level
      tolerance: 2,             // % tolerance for "touch"
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // FLIP FINDER SETTINGS
  // ─────────────────────────────────────────────────────────────────────────────
  flipFinder: {
    // Minimum requirements for a flip to be considered
    minimums: {
      marginPercent: 2,         // Minimum margin %
      marginGp: 200,            // Minimum margin gp
      buyLimit: 50,             // Minimum buy limit
      dailyVolume: 1000,        // Minimum daily volume estimate
    },

    // Scoring weights (for ranking flips)
    weights: {
      marginPercent: 0.3,       // How much margin % affects score
      roiPerHour: 0.25,         // How much ROI/hour affects score
      volumeLiquidity: 0.2,     // How much volume affects score
      stability: 0.15,          // How much price stability affects score
      limit: 0.1,               // How much buy limit affects score
    },

    // Risk assessment
    risk: {
      highVolatilityPenalty: 0.3,   // Reduce score by this for volatile items
      lowVolumePenalty: 0.2,        // Reduce score for illiquid items
      recentCrashPenalty: 0.4,      // Reduce score if item crashed recently
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // ITEM CATEGORIES (for filtered watchlists/scans)
  // ─────────────────────────────────────────────────────────────────────────────
  categories: {
    pvpGear: [
      'Granite maul', 'Dragon claws', 'Armadyl godsword', 'Abyssal whip',
      'Dragon dagger', 'Toxic blowpipe', 'Heavy ballista', 'Elder maul',
      'Volatile nightmare staff', 'Zaryte crossbow', 'Voidwaker',
    ],
    skilling: [
      'Dragon bones', 'Superior dragon bones', 'Black chinchompa', 
      'Red chinchompa', 'Ranarr seed', 'Snapdragon seed', 'Magic logs',
      'Runite ore', 'Amethyst',
    ],
    highValue: [
      'Twisted bow', 'Scythe of vitur', 'Harmonised nightmare staff',
      'Elysian spirit shield', 'Ancestral hat', 'Ancestral robe top',
      'Ancestral robe bottom', 'Torva full helm', 'Torva platebody',
    ],
    consumables: [
      'Super combat potion(4)', 'Saradomin brew(4)', 'Super restore(4)',
      'Anglerfish', 'Manta ray', 'Dark crab', 'Cooked karambwan',
    ],
    runes: [
      'Blood rune', 'Death rune', 'Soul rune', 'Wrath rune', 'Nature rune',
      'Law rune', 'Astral rune',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // DISPLAY SETTINGS
  // ─────────────────────────────────────────────────────────────────────────────
  display: {
    // Number formatting
    compactNumbers: true,       // Use K, M, B suffixes
    
    // Embed limits
    maxItemsPerEmbed: 15,       // Max items in a list embed
    maxFieldsPerEmbed: 25,      // Discord limit
    
    // Sparkline settings
    sparklineWidth: 24,         // Characters wide
    sparklineChars: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
    
    // Severity emojis
    severityEmojis: {
      low: '🟡',
      moderate: '🟠', 
      severe: '🔴',
      extreme: '💀',
    },

    // Trend emojis
    trendEmojis: {
      strongUp: '🚀',
      up: '📈',
      flat: '➡️',
      down: '📉',
      strongDown: '💥',
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// ALERT TYPES ENUM
// ═══════════════════════════════════════════════════════════════════════════════
export const AlertType = {
  PRICE_TARGET: 'PRICE_TARGET',           // Specific price reached
  PRICE_CHANGE: 'PRICE_CHANGE',           // % change threshold
  VOLUME_SPIKE: 'VOLUME_SPIKE',           // Unusual volume
  MARGIN_THRESHOLD: 'MARGIN_THRESHOLD',   // Margin becomes profitable
  PUMP_DETECTED: 'PUMP_DETECTED',         // Manipulation: pump
  DUMP_DETECTED: 'DUMP_DETECTED',         // Manipulation: dump
  ACCUMULATION: 'ACCUMULATION',           // Whale accumulation
  DISTRIBUTION: 'DISTRIBUTION',           // Whale distribution
  WASH_TRADING: 'WASH_TRADING',           // Fake volume
  UNUSUAL_ACTIVITY: 'UNUSUAL_ACTIVITY',   // Composite score alert
  RSI_SIGNAL: 'RSI_SIGNAL',               // Overbought/oversold
  CORRELATION_BREAK: 'CORRELATION_BREAK', // Correlated items diverge
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEVERITY LEVELS
// ═══════════════════════════════════════════════════════════════════════════════
export const Severity = {
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  SEVERE: 'SEVERE',
  EXTREME: 'EXTREME',
};

// ═══════════════════════════════════════════════════════════════════════════════
// DIRECTION ENUM (for price targets)
// ═══════════════════════════════════════════════════════════════════════════════
export const Direction = {
  ABOVE: 'ABOVE',
  BELOW: 'BELOW',
  CROSS: 'CROSS',  // Alert on any cross of the target
};

export default DEFAULTS;
