<<<<<<< HEAD
# 🌋 The Crater - GE Dump Detector

Simple, focused Discord bot that detects items being dumped into the Grand Exchange.

## What It Does

- **Detects price dumps** - Alerts when items drop vs their 5-minute average
- **1gp dump alerts** - Flags items being sold at 1gp
- **Configurable thresholds** - Set your own sensitivity levels
- **Optional watchlist** - Only monitor specific items

## Example Alerts

```
🟠 DUMP DETECTED: Rune full helm
SIGNIFICANT price drop detected

💰 Buy Price: 19,554 gp
📊 5m Average: 20,499 gp  
📉 Drop: -4.6%
📦 Volume (5m): 411
📈 Vol vs Expected: 1.4x
```

```
💀 1GP ITEM ALERT: Dust battlestaff
Item sold at 1gp - potential dump or manipulation

📊 Average Price Today: 12,095 gp
📋 GE Limit: 8
```

## Commands

| Command | Description |
|---------|-------------|
| `/alerts setup` | Enable alerts in this channel |
| `/alerts config` | Set custom thresholds |
| `/alerts status` | Show current config |
| `/alerts stop` | Disable alerts |
| `/watchlist add/remove` | Only alert for specific items |
| `/watchlist view` | See current watchlist |
| `/watchlist clear` | Monitor all items |
| `/price <item>` | Check current price |
| `/help` | Show help |

## Configuration

Edit the `CONFIG` object at the top of `bot.js`:

```javascript
detection: {
  priceDrop: {
    moderate: -4,      // Yellow alert
    significant: -8,   // Orange alert  
    severe: -15,       // Red alert
  },
  volumeSpike: 1.3,    // Alert when volume is 1.3x expected
  minVolume: 50,       // Ignore low-volume items
  oneGpAlert: true,    // Enable 1gp alerts
  cooldown: 300000,    // 5 min cooldown per item
},
```

Or use `/alerts config` to change per-server:
```
/alerts config moderate:-3 significant:-6 severe:-12 cooldown:10
```

## Setup

1. Clone/download
2. `npm install`
3. Copy `.env.example` to `.env` and add your bot token
4. `npm start`

## Deploy on Render

1. Push to GitHub
2. Create new Web Service on Render
3. Set environment variable `TOKEN`
4. Deploy!
=======
# PVP-Store Loot Tracker Bot

Discord bot + Express endpoint that logs PK kills and “Loot Chest” payouts.

## Local dev

```bash
npm install
cp .env.example .env   # fill in Discord TOKEN etc.
node bot.js
>>>>>>> 38022bb7f8b0870e58673ec43e907145bbdbdc64
