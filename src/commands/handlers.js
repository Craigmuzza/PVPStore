// src/commands/handlers.js
// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER V2 - COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

import geApi from '../services/GeApi.js';
import analytics from '../services/Analytics.js';
import { getAlertEngine } from '../services/AlertEngine.js';
import { getDataStore } from '../services/DataStore.js';
import * as embeds from '../utils/embeds.js';
import * as fmt from '../utils/formatters.js';
import { Direction, AlertType } from '../../config/defaults.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PRICE COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handlePrice(interaction) {
  const query = interaction.options.getString('item');
  const item = geApi.findItem(query);
  
  if (!item) {
    return interaction.reply({ embeds: [embeds.errorEmbed(`Item "${query}" not found.`)], ephemeral: true });
  }
  
  const prices = geApi.getPrice(item.id);
  if (!prices) {
    return interaction.reply({ embeds: [embeds.errorEmbed(`No price data for ${item.name}.`)], ephemeral: true });
  }
  
  // Gather analytics
  const analyticsData = {
    margin: analytics.calculateMargin(item.id),
    priceChange1h: analytics.calculatePriceChange(item.id, 1),
    priceChange24h: analytics.calculatePriceChange(item.id, 24),
    rsi: analytics.calculateRSI(item.id),
    trend: analytics.analyzeTrend(item.id),
    volatility: analytics.calculateVolatility(item.id),
  };
  
  // Generate sparkline
  const history = geApi.getHistory(item.id);
  if (history.length > 0) {
    analyticsData.sparkline = fmt.generateSparkline(history.map(h => h.high));
  }
  
  const embed = embeds.buildItemEmbed(item, prices, analyticsData);
  const buttons = embeds.buildItemButtons(item);
  
  return interaction.reply({ embeds: [embed], components: [buttons] });
}

export async function handleCompare(interaction) {
  const itemsStr = interaction.options.getString('items');
  const queries = itemsStr.split(',').map(s => s.trim()).filter(Boolean);
  
  if (queries.length < 2) {
    return interaction.reply({ embeds: [embeds.errorEmbed('Provide at least 2 items, separated by commas.')], ephemeral: true });
  }
  
  await interaction.deferReply();
  
  const items = queries.map(q => geApi.findItem(q)).filter(Boolean);
  
  if (items.length < 2) {
    return interaction.editReply({ embeds: [embeds.errorEmbed('Could not find enough valid items to compare.')] });
  }
  
  const embed = embeds.createEmbed({ title: '⚖️ Item Comparison' });
  
  for (const item of items.slice(0, 6)) {
    const prices = geApi.getPrice(item.id);
    const margin = analytics.calculateMargin(item.id);
    const change = analytics.calculatePriceChange(item.id, 1);
    
    embed.addFields({
      name: item.name,
      value: [
        `**Buy:** ${fmt.formatGp(prices?.high)} • **Sell:** ${fmt.formatGp(prices?.low)}`,
        `**Margin:** ${margin ? `${fmt.formatGp(margin.margin)} (${margin.marginPercent.toFixed(1)}%)` : 'N/A'}`,
        `**1h:** ${change ? fmt.formatPercent(change.changePercent) : 'N/A'} • **Limit:** ${item.limit || '?'}`,
      ].join('\n'),
      inline: true,
    });
  }
  
  return interaction.editReply({ embeds: [embed] });
}

export async function handleSearch(interaction) {
  const query = interaction.options.getString('query');
  const results = geApi.searchItems(query, 20);
  
  if (results.length === 0) {
    return interaction.reply({ embeds: [embeds.errorEmbed(`No items matching "${query}".`)], ephemeral: true });
  }
  
  const embed = embeds.createEmbed({ title: `🔍 Search: "${query}"` });
  
  const list = results.map((item, i) => {
    const prices = geApi.getPrice(item.id);
    return `**${i + 1}.** ${item.name} — ${prices?.high ? fmt.formatGp(prices.high) : 'No data'}`;
  }).join('\n');
  
  embed.setDescription(list);
  embed.setFooter({ text: `${results.length} results` });
  
  return interaction.reply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLIP COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleFlip(interaction) {
  const minMargin = interaction.options.getNumber('min_margin') || 2;
  const minGp = interaction.options.getNumber('min_gp') || 200;
  const minLimit = interaction.options.getNumber('min_limit') || 50;
  const limit = interaction.options.getInteger('limit') || 10;
  
  await interaction.deferReply();
  
  const flips = analytics.findBestFlips({
    marginPercent: minMargin,
    marginGp: minGp,
    buyLimit: minLimit,
    limit,
  });
  
  const embed = embeds.buildFlipEmbed(flips);
  return interaction.editReply({ embeds: [embed] });
}

export async function handleMargin(interaction) {
  const query = interaction.options.getString('item');
  const customBuy = interaction.options.getNumber('buy_price');
  const customSell = interaction.options.getNumber('sell_price');
  
  const item = geApi.findItem(query);
  if (!item) {
    return interaction.reply({ embeds: [embeds.errorEmbed(`Item "${query}" not found.`)], ephemeral: true });
  }
  
  const prices = geApi.getPrice(item.id);
  if (!prices) {
    return interaction.reply({ embeds: [embeds.errorEmbed(`No price data for ${item.name}.`)], ephemeral: true });
  }
  
  const buyPrice = customBuy || prices.low;
  const sellPrice = customSell || prices.high;
  const taxRate = sellPrice >= 100 ? 0.01 : 0;
  const tax = Math.min(Math.floor(sellPrice * taxRate), 5000000);
  const margin = sellPrice - buyPrice - tax;
  const marginPercent = (margin / buyPrice) * 100;
  const limit = item.limit || 1;
  const maxProfit = margin * limit;
  
  const embed = embeds.createEmbed({
    title: `💹 Margin Calculator: ${item.name}`,
    thumbnail: fmt.getItemIconUrl(item.icon),
  });
  
  embed.addFields(
    { name: '🛒 Buy Price', value: fmt.formatGp(buyPrice), inline: true },
    { name: '💰 Sell Price', value: fmt.formatGp(sellPrice), inline: true },
    { name: '💸 GE Tax', value: fmt.formatGp(tax), inline: true },
    { name: `${margin > 0 ? '✅' : '❌'} Margin`, value: `${fmt.formatGp(margin)} (${marginPercent.toFixed(2)}%)`, inline: true },
    { name: '📦 Buy Limit', value: `${limit.toLocaleString()}/4hr`, inline: true },
    { name: '💎 Max Profit', value: fmt.formatGp(maxProfit), inline: true },
  );
  
  embed.setFooter({ text: customBuy || customSell ? 'Using custom prices' : 'Using market prices' });
  
  return interaction.reply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKET MOVERS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleGainers(interaction) {
  const hours = parseInt(interaction.options.getString('timeframe') || '1');
  await interaction.deferReply();
  const movers = analytics.findBiggestMovers(hours);
  return interaction.editReply({ embeds: [embeds.buildMoversEmbed(movers, 'gainers', `${hours}h`)] });
}

export async function handleCrashes(interaction) {
  const hours = parseInt(interaction.options.getString('timeframe') || '1');
  await interaction.deferReply();
  const movers = analytics.findBiggestMovers(hours);
  return interaction.editReply({ embeds: [embeds.buildMoversEmbed(movers, 'losers', `${hours}h`)] });
}

export async function handleVolatile(interaction) {
  await interaction.deferReply();
  const volatile = analytics.findMostVolatile(20);
  
  const embed = embeds.createEmbed({ title: '🎢 Most Volatile Items (24h)' });
  
  if (!volatile.length) {
    embed.setDescription('No volatility data available yet. Let the bot collect data for a while.');
    return interaction.editReply({ embeds: [embed] });
  }
  
  const list = volatile.slice(0, 15).map((v, i) => 
    `**${i + 1}.** ${v.item.name}\n` +
    `　　📊 **${v.volatilityPercent}%** volatility • ${fmt.formatGp(v.min)} - ${fmt.formatGp(v.max)}`
  ).join('\n\n');
  
  embed.setDescription('High price swings - risky but potentially profitable:\n\n' + list);
  
  return interaction.editReply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCAN COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleScan(interaction) {
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply();
  
  switch (subcommand) {
    case 'pump': {
      const signals = [];
      for (const itemId of geApi.getAllPricedItemIds().slice(0, 500)) {
        const pump = await analytics.detectPump(itemId);
        if (pump?.detected) {
          signals.push({ ...pump, item: geApi.getItem(itemId) });
        }
      }
      signals.sort((a, b) => b.confidence - a.confidence);
      
      const embed = embeds.createEmbed({ title: '🚀 Pump Detection Scan' });
      
      if (!signals.length) {
        embed.setDescription('No pump patterns detected.\n\n*The market appears normal.*');
      } else {
        const list = signals.slice(0, 10).map((s, i) => 
          `**${i + 1}.** ${s.item.name}\n` +
          `　　📈 +${s.priceChange.toFixed(1)}% • Confidence: ${s.confidence}%`
        ).join('\n\n');
        embed.setDescription(list);
      }
      
      return interaction.editReply({ embeds: [embed] });
    }
    
    case 'dump': {
      const signals = [];
      for (const itemId of geApi.getAllPricedItemIds().slice(0, 500)) {
        const dump = analytics.detectDump(itemId);
        if (dump?.detected) {
          signals.push({ ...dump, item: geApi.getItem(itemId) });
        }
      }
      signals.sort((a, b) => a.priceChange - b.priceChange);
      
      const embed = embeds.createEmbed({ title: '💥 Dump Detection Scan' });
      
      if (!signals.length) {
        embed.setDescription('No dump patterns detected.\n\n*No major crashes happening.*');
      } else {
        const list = signals.slice(0, 10).map((s, i) => 
          `**${i + 1}.** ${s.item.name}\n` +
          `　　📉 ${s.priceChange.toFixed(1)}% • Confidence: ${s.confidence}%`
        ).join('\n\n');
        embed.setDescription(list);
      }
      
      return interaction.editReply({ embeds: [embed] });
    }
    
    case 'unusual': {
      const signals = await analytics.scanForManipulation(15);
      const embed = embeds.buildManipulationEmbed(signals, 'Unusual Activity Scan');
      return interaction.editReply({ embeds: [embed] });
    }
    
    case 'opportunity': {
      const flips = analytics.findBestFlips({ limit: 10 });
      const embed = embeds.buildFlipEmbed(flips, 'Best Opportunities Right Now');
      return interaction.editReply({ embeds: [embed] });
    }
  }
}

export async function handleAnalyse(interaction) {
  const query = interaction.options.getString('item');
  const item = geApi.findItem(query);
  
  if (!item) {
    return interaction.reply({ embeds: [embeds.errorEmbed(`Item "${query}" not found.`)], ephemeral: true });
  }
  
  await interaction.deferReply();
  
  const prices = geApi.getPrice(item.id);
  const margin = analytics.calculateMargin(item.id);
  const change1h = analytics.calculatePriceChange(item.id, 1);
  const change24h = analytics.calculatePriceChange(item.id, 24);
  const volatility = analytics.calculateVolatility(item.id);
  const rsi = analytics.calculateRSI(item.id);
  const trend = analytics.analyzeTrend(item.id);
  const activity = analytics.calculateUnusualActivityScore(item.id);
  const pump = await analytics.detectPump(item.id);
  const dump = analytics.detectDump(item.id);
  
  const embed = embeds.createEmbed({
    title: `🔬 Deep Analysis: ${item.name}`,
    url: fmt.getPriceChartUrl(item.id),
    thumbnail: fmt.getItemIconUrl(item.icon),
  });
  
  // Prices
  embed.addFields(
    { name: '💰 Current Prices', value: `Buy: ${fmt.formatGp(prices?.high)}\nSell: ${fmt.formatGp(prices?.low)}\nLimit: ${item.limit || '?'}`, inline: true },
    { name: '📊 Margin', value: margin ? `${fmt.formatGp(margin.margin)} (${margin.marginPercent.toFixed(1)}%)\nROI: ${margin.roiPerHour.toFixed(2)}%/hr` : 'N/A', inline: true },
    { name: '📈 Changes', value: `1h: ${change1h ? fmt.formatPercent(change1h.changePercent) : 'N/A'}\n24h: ${change24h ? fmt.formatPercent(change24h.changePercent) : 'N/A'}`, inline: true },
  );
  
  // Technical
  embed.addFields(
    { name: '📉 RSI', value: rsi ? `${fmt.getRsiEmoji(rsi.value)} ${rsi.value} (${rsi.signal})` : 'N/A', inline: true },
    { name: '📊 Trend', value: trend ? `${fmt.getTrendEmoji(trend.direction)} ${trend.direction.replace('_', ' ')}` : 'N/A', inline: true },
    { name: '🎢 Volatility', value: volatility ? `${volatility.volatilityPercent}% (${volatility.isHighVolatility ? 'HIGH' : volatility.isLowVolatility ? 'LOW' : 'Normal'})` : 'N/A', inline: true },
  );
  
  // Activity score
  if (activity.score > 0) {
    embed.addFields({
      name: '⚠️ Unusual Activity Score',
      value: fmt.scoreBar(activity.score) + (activity.reasons.length ? '\n' + activity.reasons.slice(0, 3).map(r => `• ${r}`).join('\n') : ''),
      inline: false,
    });
  }
  
  // Signals
  const signals = [];
  if (pump?.detected) signals.push(`🚀 **PUMP SIGNAL** (${pump.confidence}% confidence)`);
  if (dump?.detected) signals.push(`💥 **DUMP SIGNAL** (${dump.confidence}% confidence)`);
  if (rsi?.isOverbought) signals.push('🔥 RSI indicates OVERBOUGHT');
  if (rsi?.isOversold) signals.push('❄️ RSI indicates OVERSOLD');
  
  if (signals.length) {
    embed.addFields({ name: '🚨 Active Signals', value: signals.join('\n'), inline: false });
  }
  
  // Sparkline
  const history = geApi.getHistory(item.id);
  if (history.length > 0) {
    embed.addFields({ name: '📊 Price History', value: `\`${fmt.generateSparkline(history.map(h => h.high))}\``, inline: false });
  }
  
  return interaction.editReply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALERT COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleAlert(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const alertEngine = getAlertEngine();
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  
  switch (subcommand) {
    case 'price': {
      const query = interaction.options.getString('item');
      const item = geApi.findItem(query);
      if (!item) {
        return interaction.reply({ embeds: [embeds.errorEmbed(`Item "${query}" not found.`)], ephemeral: true });
      }
      
      const target = interaction.options.getNumber('target');
      const direction = interaction.options.getString('direction');
      
      const alert = alertEngine.addPriceTargetAlert(
        userId, guildId, interaction.channelId,
        item.id, target, direction
      );
      
      return interaction.reply({
        embeds: [embeds.successEmbed(
          `Price target set for **${item.name}**\n` +
          `Alert when price goes **${direction.toLowerCase()}** ${fmt.formatGp(target)}`
        )],
        ephemeral: true,
      });
    }
    
    case 'change': {
      const query = interaction.options.getString('item');
      const item = geApi.findItem(query);
      if (!item) {
        return interaction.reply({ embeds: [embeds.errorEmbed(`Item "${query}" not found.`)], ephemeral: true });
      }
      
      const percent = interaction.options.getNumber('percent');
      const hours = interaction.options.getInteger('hours') || 1;
      
      const alert = alertEngine.addPriceChangeAlert(
        userId, guildId, interaction.channelId,
        item.id, percent, hours
      );
      
      return interaction.reply({
        embeds: [embeds.successEmbed(
          `Price change alert set for **${item.name}**\n` +
          `Alert when price changes by **${fmt.formatPercent(percent)}** over **${hours}h**`
        )],
        ephemeral: true,
      });
    }
    
    case 'margin': {
      const query = interaction.options.getString('item');
      const item = geApi.findItem(query);
      if (!item) {
        return interaction.reply({ embeds: [embeds.errorEmbed(`Item "${query}" not found.`)], ephemeral: true });
      }
      
      const minPercent = interaction.options.getNumber('min_percent');
      const minGp = interaction.options.getNumber('min_gp') || 0;
      
      const alert = alertEngine.addMarginAlert(
        userId, guildId, interaction.channelId,
        item.id, minPercent, minGp
      );
      
      return interaction.reply({
        embeds: [embeds.successEmbed(
          `Margin alert set for **${item.name}**\n` +
          `Alert when margin exceeds **${minPercent}%**${minGp ? ` and **${fmt.formatGp(minGp)}**` : ''}`
        )],
        ephemeral: true,
      });
    }
    
    case 'list': {
      const alerts = alertEngine.getUserAlerts(userId, guildId);
      
      if (!alerts.length) {
        return interaction.reply({ embeds: [embeds.infoEmbed('You have no active alerts.')], ephemeral: true });
      }
      
      const embed = embeds.createEmbed({ title: '🔔 Your Alerts' });
      
      const lines = alerts.map(a => {
        const item = geApi.getItem(a.itemId);
        const itemName = item?.name || `Item ${a.itemId}`;
        
        let desc = `**${itemName}**\n`;
        
        switch (a.type) {
          case AlertType.PRICE_TARGET:
            desc += `Target: ${a.direction} ${fmt.formatGp(a.targetPrice)}`;
            break;
          case AlertType.PRICE_CHANGE:
            desc += `Change: ${fmt.formatPercent(a.threshold)} over ${a.timeframeHours}h`;
            break;
          case AlertType.MARGIN_THRESHOLD:
            desc += `Margin: >${a.minMarginPercent}%`;
            break;
        }
        
        desc += `\nID: \`${a.id}\``;
        return desc;
      });
      
      embed.setDescription(lines.join('\n\n'));
      
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    case 'remove': {
      const alertId = interaction.options.getString('alert_id');
      const removed = alertEngine.removeAlert(userId, guildId, alertId);
      
      if (!removed) {
        return interaction.reply({ embeds: [embeds.errorEmbed('Alert not found.')], ephemeral: true });
      }
      
      return interaction.reply({ embeds: [embeds.successEmbed('Alert removed.')], ephemeral: true });
    }
    
    case 'clear': {
      const count = alertEngine.clearUserAlerts(userId, guildId);
      return interaction.reply({ embeds: [embeds.successEmbed(`Cleared **${count}** alerts.`)], ephemeral: true });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER ALERTS CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleAlerts(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const alertEngine = getAlertEngine();
  const guildId = interaction.guildId;
  
  switch (subcommand) {
    case 'setup': {
      alertEngine.enableAlerts(guildId, interaction.channelId);
      return interaction.reply({
        embeds: [embeds.successEmbed(`Server alerts enabled in this channel!\n\nUse \`/alerts config\` to customize thresholds.`)],
      });
    }
    
    case 'config': {
      const config = alertEngine.getServerConfig(guildId);
      
      const crashMod = interaction.options.getNumber('crash_moderate');
      const crashSev = interaction.options.getNumber('crash_severe');
      const spikeMod = interaction.options.getNumber('spike_moderate');
      const spikeSev = interaction.options.getNumber('spike_severe');
      const timeframe = interaction.options.getInteger('timeframe');
      
      if (crashMod !== null) config.priceChange.crash.moderate = crashMod;
      if (crashSev !== null) config.priceChange.crash.severe = crashSev;
      if (spikeMod !== null) config.priceChange.spike.moderate = spikeMod;
      if (spikeSev !== null) config.priceChange.spike.severe = spikeSev;
      if (timeframe !== null) config.priceChange.timeframe = timeframe;
      
      alertEngine.updateServerConfig(guildId, config);
      
      return interaction.reply({
        embeds: [embeds.successEmbed(
          `Configuration updated!\n\n` +
          `**Crash thresholds:** ${config.priceChange.crash.moderate}% / ${config.priceChange.crash.severe}%\n` +
          `**Spike thresholds:** +${config.priceChange.spike.moderate}% / +${config.priceChange.spike.severe}%\n` +
          `**Timeframe:** ${config.priceChange.timeframe}h`
        )],
        ephemeral: true,
      });
    }
    
    case 'features': {
      const config = alertEngine.getServerConfig(guildId);
      
      const pump = interaction.options.getBoolean('pump_alerts');
      const dump = interaction.options.getBoolean('dump_alerts');
      const manip = interaction.options.getBoolean('manipulation_alerts');
      const volume = interaction.options.getBoolean('volume_alerts');
      
      if (pump !== null) config.enablePumpAlerts = pump;
      if (dump !== null) config.enableDumpAlerts = dump;
      if (manip !== null) config.enableManipulationAlerts = manip;
      if (volume !== null) config.enableVolumeAlerts = volume;
      
      alertEngine.updateServerConfig(guildId, config);
      
      return interaction.reply({
        embeds: [embeds.successEmbed(
          `Features updated!\n\n` +
          `${config.enablePumpAlerts ? '✅' : '❌'} Pump alerts\n` +
          `${config.enableDumpAlerts ? '✅' : '❌'} Dump alerts\n` +
          `${config.enableManipulationAlerts ? '✅' : '❌'} Manipulation alerts\n` +
          `${config.enableVolumeAlerts ? '✅' : '❌'} Volume alerts`
        )],
        ephemeral: true,
      });
    }
    
    case 'cooldowns': {
      const config = alertEngine.getServerConfig(guildId);
      
      const priceMin = interaction.options.getInteger('price_minutes');
      const manipMin = interaction.options.getInteger('manipulation_minutes');
      
      if (priceMin !== null) config.cooldowns.priceChange = priceMin * 60 * 1000;
      if (manipMin !== null) config.cooldowns.manipulation = manipMin * 60 * 1000;
      
      alertEngine.updateServerConfig(guildId, config);
      
      return interaction.reply({
        embeds: [embeds.successEmbed(
          `Cooldowns updated!\n\n` +
          `Price alerts: ${fmt.formatDuration(config.cooldowns.priceChange)}\n` +
          `Manipulation alerts: ${fmt.formatDuration(config.cooldowns.manipulation)}`
        )],
        ephemeral: true,
      });
    }
    
    case 'view': {
      const config = alertEngine.getServerConfig(guildId);
      const embed = embeds.buildConfigEmbed(config, interaction.guild.name);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    case 'stop': {
      alertEngine.disableAlerts(guildId);
      return interaction.reply({ embeds: [embeds.successEmbed('Server alerts disabled.')], ephemeral: true });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WATCHLIST COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleWatchlist(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const alertEngine = getAlertEngine();
  const guildId = interaction.guildId;
  
  switch (subcommand) {
    case 'add': {
      const query = interaction.options.getString('item');
      const item = geApi.findItem(query);
      if (!item) {
        return interaction.reply({ embeds: [embeds.errorEmbed(`Item "${query}" not found.`)], ephemeral: true });
      }
      
      alertEngine.addToWatchlist(guildId, item.id);
      return interaction.reply({ embeds: [embeds.successEmbed(`Added **${item.name}** to watchlist.`)], ephemeral: true });
    }
    
    case 'remove': {
      const query = interaction.options.getString('item');
      const item = geApi.findItem(query);
      if (!item) {
        return interaction.reply({ embeds: [embeds.errorEmbed(`Item "${query}" not found.`)], ephemeral: true });
      }
      
      alertEngine.removeFromWatchlist(guildId, item.id);
      return interaction.reply({ embeds: [embeds.successEmbed(`Removed **${item.name}** from watchlist.`)], ephemeral: true });
    }
    
    case 'view': {
      const watchlist = alertEngine.getWatchlist(guildId);
      
      if (!watchlist.size) {
        return interaction.reply({ embeds: [embeds.infoEmbed('Watchlist is empty.\n\nUse `/watchlist add <item>` to add items.')], ephemeral: true });
      }
      
      const items = [];
      for (const itemId of watchlist) {
        const item = geApi.getItem(itemId);
        const prices = geApi.getPrice(itemId);
        const change = analytics.calculatePriceChange(itemId, 1);
        if (item) items.push({ item, prices, change });
      }
      
      const embed = embeds.buildWatchlistEmbed(items);
      return interaction.reply({ embeds: [embed] });
    }
    
    case 'clear': {
      const count = alertEngine.clearWatchlist(guildId);
      return interaction.reply({ embeds: [embeds.successEmbed(`Cleared **${count}** items from watchlist.`)], ephemeral: true });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handlePortfolio(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const dataStore = getDataStore();
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  
  switch (subcommand) {
    case 'buy':
    case 'sell': {
      const query = interaction.options.getString('item');
      const item = geApi.findItem(query);
      if (!item) {
        return interaction.reply({ embeds: [embeds.errorEmbed(`Item "${query}" not found.`)], ephemeral: true });
      }
      
      const qty = interaction.options.getInteger('quantity');
      const price = interaction.options.getInteger('price');
      
      if (qty <= 0 || price <= 0) {
        return interaction.reply({ embeds: [embeds.errorEmbed('Quantity and price must be positive.')], ephemeral: true });
      }
      
      dataStore.addTrade(guildId, userId, {
        type: subcommand.toUpperCase(),
        itemId: item.id,
        qty,
        price,
      });
      
      return interaction.reply({
        embeds: [embeds.successEmbed(
          `Logged **${subcommand.toUpperCase()}** of **${qty}× ${item.name}** at **${fmt.formatGp(price)}** each.`
        )],
        ephemeral: true,
      });
    }
    
    case 'summary': {
      const summary = dataStore.getPortfolioSummary(guildId, userId, geApi.latestPrices);
      
      if (!summary) {
        return interaction.reply({ embeds: [embeds.infoEmbed('No trades logged yet.')], ephemeral: true });
      }
      
      const embed = embeds.buildPortfolioEmbed(summary, id => geApi.getItem(id));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    case 'history': {
      const limit = interaction.options.getInteger('limit') || 10;
      const portfolio = dataStore.getPortfolio(guildId, userId);
      
      if (!portfolio.trades.length) {
        return interaction.reply({ embeds: [embeds.infoEmbed('No trades logged yet.')], ephemeral: true });
      }
      
      const recent = [...portfolio.trades].slice(-limit).reverse();
      
      const lines = recent.map(t => {
        const item = geApi.getItem(t.itemId);
        const name = item?.name || `Item ${t.itemId}`;
        return `• **${t.type}** ${t.qty}× **${name}** @ ${fmt.formatGp(t.price)} (${fmt.formatRelativeTime(new Date(t.timestamp).getTime())})`;
      });
      
      const embed = embeds.createEmbed({ title: '📜 Trade History' });
      embed.setDescription(lines.join('\n'));
      
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    case 'clear': {
      const count = dataStore.clearPortfolio(guildId, userId);
      return interaction.reply({ embeds: [embeds.successEmbed(`Cleared **${count}** trades.`)], ephemeral: true });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VENG LIST COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleVeng(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const dataStore = getDataStore();
  
  switch (subcommand) {
    case 'add': {
      const rsnInput = interaction.options.getString('rsn');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const rsns = rsnInput.split(',').map(s => s.trim()).filter(Boolean);
      
      const result = dataStore.addToVengList(rsns, reason, interaction.user.tag);
      
      const embed = embeds.successEmbed(
        `Added **${result.added}** RSN(s) to the list.` +
        (result.already ? `\n**${result.already}** were already on the list.` : '') +
        `\n\nReason: ${reason}`
      );
      embed.setTitle('⚔️ Vengeance List Updated');
      
      return interaction.reply({ embeds: [embed] });
    }
    
    case 'remove': {
      const rsn = interaction.options.getString('rsn');
      const removed = dataStore.removeFromVengList(rsn);
      
      if (!removed) {
        return interaction.reply({ embeds: [embeds.errorEmbed(`**${rsn}** is not on the list.`)], ephemeral: true });
      }
      
      return interaction.reply({ embeds: [embeds.successEmbed(`Removed **${removed.rsn}** from the list.`)] });
    }
    
    case 'list': {
      const list = dataStore.getVengList();
      const embed = embeds.buildVengListEmbed(list);
      return interaction.reply({ embeds: [embed] });
    }
    
    case 'clear': {
      const count = dataStore.clearVengList();
      return interaction.reply({ embeds: [embeds.successEmbed(`Cleared **${count}** entries from the vengeance list.`)] });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleAlch(interaction) {
  const minProfit = interaction.options.getInteger('min_profit') || 100;
  const natureRunePrice = geApi.getPrice(561)?.high || 150;
  
  await interaction.deferReply();
  
  const profitable = [];
  
  for (const [itemId, item] of geApi.itemMapping) {
    if (!item.highalch) continue;
    const prices = geApi.getPrice(itemId);
    if (!prices?.high) continue;
    
    const profit = item.highalch - prices.high - natureRunePrice;
    if (profit >= minProfit) {
      profitable.push({ item, buyPrice: prices.high, alchValue: item.highalch, profit });
    }
  }
  
  profitable.sort((a, b) => b.profit - a.profit);
  
  const embed = embeds.createEmbed({ title: '🔮 Profitable High Alch Items' });
  
  if (!profitable.length) {
    embed.setDescription(`No items with ${fmt.formatGp(minProfit)}+ profit per alch.`);
    return interaction.editReply({ embeds: [embed] });
  }
  
  embed.setDescription(`**${fmt.formatGp(minProfit)}+** gp profit (Nature: ${fmt.formatGp(natureRunePrice)} gp)\n\n` +
    profitable.slice(0, 15).map((p, i) =>
      `**${i + 1}.** ${p.item.name}\n　　Buy: ${fmt.formatGp(p.buyPrice)} • Alch: ${fmt.formatGp(p.alchValue)} • **+${fmt.formatGp(p.profit)}**`
    ).join('\n\n')
  );
  
  return interaction.editReply({ embeds: [embed] });
}

export async function handleCorrelate(interaction) {
  const query = interaction.options.getString('item');
  const item = geApi.findItem(query);
  
  if (!item) {
    return interaction.reply({ embeds: [embeds.errorEmbed(`Item "${query}" not found.`)], ephemeral: true });
  }
  
  await interaction.deferReply();
  
  const correlations = analytics.findCorrelatedItems(item.id, 10);
  
  const embed = embeds.createEmbed({ title: `🔗 Price Correlations: ${item.name}` });
  
  if (!correlations.length) {
    embed.setDescription('Not enough data to compute correlations.\n\nLet the bot collect price history.');
    return interaction.editReply({ embeds: [embed] });
  }
  
  const lines = correlations.map((c, i) => 
    `**${i + 1}.** ${c.item.name} — r = **${c.correlation.toFixed(3)}**`
  );
  
  embed.setDescription(lines.join('\n'));
  embed.addFields({
    name: 'ℹ️ Interpretation',
    value: 'r close to 1 = moves together\nr close to -1 = moves opposite\nr close to 0 = no relationship',
  });
  
  return interaction.editReply({ embeds: [embed] });
}

export async function handleStats(interaction) {
  const alertEngine = getAlertEngine();
  
  const embed = embeds.createEmbed({ title: '📊 The Crater Stats' });
  
  embed.addFields(
    { name: '📈 Items Tracked', value: geApi.getPricedItemCount().toLocaleString(), inline: true },
    { name: '🏠 Servers', value: interaction.client.guilds.cache.size.toString(), inline: true },
    { name: '🔔 Active Alerts', value: alertEngine.getTotalAlertCount().toString(), inline: true },
  );
  
  const movers = analytics.findBiggestMovers(1);
  if (movers.gainers[0]) {
    embed.addFields({ name: '🚀 Top Gainer (1h)', value: `${movers.gainers[0].item.name}: ${fmt.formatPercent(movers.gainers[0].changePercent)}`, inline: true });
  }
  if (movers.losers[0]) {
    embed.addFields({ name: '💥 Top Crash (1h)', value: `${movers.losers[0].item.name}: ${fmt.formatPercent(movers.losers[0].changePercent)}`, inline: true });
  }
  
  embed.addFields({ name: '⏱️ Uptime', value: fmt.formatDuration(process.uptime() * 1000), inline: true });
  
  return interaction.reply({ embeds: [embed] });
}

export async function handleHelp(interaction) {
  const embed = embeds.createEmbed({ title: '📖 The Crater - Command Guide' });
  
  embed.setDescription(
    '**The Crater** is an advanced OSRS GE manipulation detection and flipping bot.\n\n' +
    '**Key Features:**\n' +
    '• Real-time price tracking & analysis\n' +
    '• Pump/dump manipulation detection\n' +
    '• Smart flip finding with risk scoring\n' +
    '• Customisable alerts & watchlists\n' +
    '• Portfolio tracking with P&L'
  );
  
  embed.addFields(
    { name: '📊 Price Commands', value: '`/price` `/compare` `/search` `/margin`', inline: true },
    { name: '💹 Flip Commands', value: '`/flip` `/gainers` `/crashes` `/volatile`', inline: true },
    { name: '🔍 Scan Commands', value: '`/scan pump` `/scan dump` `/scan unusual` `/analyse`', inline: true },
    { name: '🔔 Alert Commands', value: '`/alert price` `/alert change` `/alert margin` `/alert list`', inline: true },
    { name: '⚙️ Server Config', value: '`/alerts setup` `/alerts config` `/alerts features`', inline: true },
    { name: '👁️ Watchlist', value: '`/watchlist add` `/watchlist view`', inline: true },
    { name: '📈 Portfolio', value: '`/portfolio buy` `/portfolio sell` `/portfolio summary`', inline: true },
    { name: '⚔️ Veng List', value: '`/veng add` `/veng list`', inline: true },
    { name: '🔧 Utility', value: '`/alch` `/correlate` `/stats`', inline: true },
  );
  
  return interaction.reply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOCOMPLETE HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleAutocomplete(interaction) {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  
  if (focusedValue.length < 2) {
    return interaction.respond([]);
  }
  
  const matches = geApi.searchItems(focusedValue, 25);
  
  const choices = matches.map(item => {
    const prices = geApi.getPrice(item.id);
    const priceStr = prices?.high ? ` (${fmt.formatGp(prices.high)})` : '';
    return {
      name: `${item.name}${priceStr}`.slice(0, 100),
      value: item.name,
    };
  });
  
  return interaction.respond(choices);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUTTON HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleButton(interaction) {
  const [action, type, ...args] = interaction.customId.split('_');
  
  if (action === 'watchlist' && type === 'add') {
    const itemId = parseInt(args[0]);
    const alertEngine = getAlertEngine();
    const guildId = interaction.guildId;
    
    alertEngine.addToWatchlist(guildId, itemId);
    const item = geApi.getItem(itemId);
    
    return interaction.reply({
      embeds: [embeds.successEmbed(`Added **${item?.name || 'item'}** to watchlist.`)],
      ephemeral: true,
    });
  }
  
  if (action === 'alert' && type === 'price') {
    // Would open a modal for price alert setup
    return interaction.reply({
      embeds: [embeds.infoEmbed('Use `/alert price <item> <target> <direction>` to set a price alert.')],
      ephemeral: true,
    });
  }
}

export default {
  handlePrice,
  handleCompare,
  handleSearch,
  handleFlip,
  handleMargin,
  handleGainers,
  handleCrashes,
  handleVolatile,
  handleScan,
  handleAnalyse,
  handleAlert,
  handleAlerts,
  handleWatchlist,
  handlePortfolio,
  handleVeng,
  handleAlch,
  handleCorrelate,
  handleStats,
  handleHelp,
  handleAutocomplete,
  handleButton,
};
