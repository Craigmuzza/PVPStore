// src/index.js
// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER V2 - MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════
// The ultimate OSRS GE manipulation detection and flipping bot
// ═══════════════════════════════════════════════════════════════════════════════

import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment
dotenv.config();

// Services
import geApi from './services/GeApi.js';
import analytics from './services/Analytics.js';
import { initAlertEngine, getAlertEngine } from './services/AlertEngine.js';
import { initDataStore, getDataStore } from './services/DataStore.js';

// Commands
import { commands } from './commands/index.js';
import * as handlers from './commands/handlers.js';

// Utils
import * as embeds from './utils/embeds.js';

// Config
import { DEFAULTS } from '../config/defaults.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PATHS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || '/data';
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCORD CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  
  try {
    console.log('🔄 [Commands] Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log(`✅ [Commands] Registered ${commands.length} commands`);
  } catch (error) {
    console.error('❌ [Commands] Registration failed:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALERT SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

async function runAlertScan() {
  try {
    const alertEngine = getAlertEngine();
    const triggered = await alertEngine.scan();
    
    if (triggered.length === 0) return;
    
    console.log(`🔔 [Alerts] ${triggered.length} alerts triggered`);
    
    // Group by channel
    const byChannel = new Map();
    for (const { alert, result } of triggered) {
      const channelId = alert.channelId;
      if (!byChannel.has(channelId)) {
        byChannel.set(channelId, []);
      }
      byChannel.get(channelId).push({ alert, result });
    }
    
    // Send alerts
    for (const [channelId, alerts] of byChannel) {
      const channel = client.channels.cache.get(channelId);
      if (!channel) continue;
      
      for (const { alert, result } of alerts) {
        try {
          const embed = embeds.buildAlertEmbed(result);
          
          // Mention user for personal alerts
          const content = alert.userId ? `<@${alert.userId}>` : undefined;
          
          await channel.send({ content, embeds: [embed] });
        } catch (err) {
          console.error(`❌ [Alerts] Failed to send alert:`, err.message);
        }
      }
    }
  } catch (error) {
    console.error('❌ [Alerts] Scan error:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRICE UPDATE LOOP
// ═══════════════════════════════════════════════════════════════════════════════

async function priceUpdateLoop() {
  try {
    await geApi.fetchLatestPrices();
    console.log(`📡 [Prices] Updated ${geApi.getPricedItemCount()} items`);
  } catch (error) {
    console.error('❌ [Prices] Update error:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

client.once('ready', async () => {
  console.log('\n' + '═'.repeat(60));
  console.log('🌋 THE CRATER V2 - OSRS GE MANIPULATION DETECTION BOT');
  console.log('═'.repeat(60));
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} servers`);
  console.log('═'.repeat(60) + '\n');
  
  // Initialize services
  try {
    // GE API
    await geApi.initialize();
    
    // Alert Engine
    const alertEngine = initAlertEngine(DATA_DIR);
    await alertEngine.initialize();
    
    // Data Store
    initDataStore(DATA_DIR);
    
    // Register commands
    await registerCommands();
    
    // Set activity
    client.user.setActivity('the GE 📈', { type: 3 }); // Watching
    
    // Start loops
    setInterval(priceUpdateLoop, DEFAULTS.api.pollInterval);
    setInterval(runAlertScan, DEFAULTS.api.alertScanInterval);
    
    console.log('\n✅ Bot is fully operational!\n');
    
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Autocomplete
    if (interaction.isAutocomplete()) {
      return handlers.handleAutocomplete(interaction);
    }
    
    // Buttons
    if (interaction.isButton()) {
      return handlers.handleButton(interaction);
    }
    
    // Commands
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName } = interaction;
    
    switch (commandName) {
      // Price commands
      case 'price': return handlers.handlePrice(interaction);
      case 'compare': return handlers.handleCompare(interaction);
      case 'search': return handlers.handleSearch(interaction);
      
      // Flip commands
      case 'flip': return handlers.handleFlip(interaction);
      case 'margin': return handlers.handleMargin(interaction);
      
      // Movers
      case 'gainers': return handlers.handleGainers(interaction);
      case 'crashes': return handlers.handleCrashes(interaction);
      case 'volatile': return handlers.handleVolatile(interaction);
      
      // Scan & Analysis
      case 'scan': return handlers.handleScan(interaction);
      case 'analyse': return handlers.handleAnalyse(interaction);
      
      // Alerts
      case 'alert': return handlers.handleAlert(interaction);
      case 'alerts': return handlers.handleAlerts(interaction);
      
      // Watchlist
      case 'watchlist': return handlers.handleWatchlist(interaction);
      
      // Portfolio
      case 'portfolio': return handlers.handlePortfolio(interaction);
      
      // Veng list
      case 'veng': return handlers.handleVeng(interaction);
      
      // Utility
      case 'alch': return handlers.handleAlch(interaction);
      case 'correlate': return handlers.handleCorrelate(interaction);
      case 'stats': return handlers.handleStats(interaction);
      case 'help': return handlers.handleHelp(interaction);
      
      default:
        console.warn(`Unknown command: ${commandName}`);
    }
    
  } catch (error) {
    console.error('❌ Interaction error:', error);
    
    const errorReply = {
      embeds: [embeds.errorEmbed('An error occurred processing your request.')],
      ephemeral: true,
    };
    
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorReply);
      } else {
        await interaction.reply(errorReply);
      }
    } catch (e) {
      console.error('Failed to send error reply:', e.message);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPRESS HEALTH CHECK SERVER
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.json({
    name: 'The Crater V2',
    status: 'operational',
    bot: client.user?.tag || 'Starting...',
    servers: client.guilds?.cache.size || 0,
    itemsTracked: geApi.getPricedItemCount(),
    uptime: process.uptime(),
    version: '2.0.0',
  });
});

app.get('/health', (req, res) => {
  res.send('OK');
});

app.listen(PORT, () => {
  console.log(`🌐 Health server running on port ${PORT}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// START BOT
// ═══════════════════════════════════════════════════════════════════════════════

client.login(process.env.TOKEN);
