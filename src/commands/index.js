// src/commands/index.js
// ═══════════════════════════════════════════════════════════════════════════════
// THE CRATER V2 - COMMAND DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

import { SlashCommandBuilder } from 'discord.js';

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const commands = [
  // ─────────────────────────────────────────────────────────────────────────────
  // PRICE COMMANDS
  // ─────────────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('price')
    .setDescription('Get detailed price and analysis for an item')
    .addStringOption(opt => opt
      .setName('item')
      .setDescription('Item name')
      .setRequired(true)
      .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('compare')
    .setDescription('Compare multiple items side by side')
    .addStringOption(opt => opt
      .setName('items')
      .setDescription('Comma-separated item names')
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for items by name')
    .addStringOption(opt => opt
      .setName('query')
      .setDescription('Search query')
      .setRequired(true)),

  // ─────────────────────────────────────────────────────────────────────────────
  // FLIP COMMANDS
  // ─────────────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('flip')
    .setDescription('Find the best flipping opportunities')
    .addNumberOption(opt => opt
      .setName('min_margin')
      .setDescription('Minimum margin % (default: 2)'))
    .addNumberOption(opt => opt
      .setName('min_gp')
      .setDescription('Minimum margin in gp (default: 200)'))
    .addNumberOption(opt => opt
      .setName('min_limit')
      .setDescription('Minimum buy limit (default: 50)'))
    .addIntegerOption(opt => opt
      .setName('limit')
      .setDescription('Number of results (default: 10)')),

  new SlashCommandBuilder()
    .setName('margin')
    .setDescription('Calculate margin for an item')
    .addStringOption(opt => opt
      .setName('item')
      .setDescription('Item name')
      .setRequired(true)
      .setAutocomplete(true))
    .addNumberOption(opt => opt
      .setName('buy_price')
      .setDescription('Custom buy price'))
    .addNumberOption(opt => opt
      .setName('sell_price')
      .setDescription('Custom sell price')),

  // ─────────────────────────────────────────────────────────────────────────────
  // MARKET MOVERS
  // ─────────────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('gainers')
    .setDescription('Show items with biggest price increases')
    .addStringOption(opt => opt
      .setName('timeframe')
      .setDescription('Time period')
      .addChoices(
        { name: '1 Hour', value: '1' },
        { name: '6 Hours', value: '6' },
        { name: '24 Hours', value: '24' }
      )),

  new SlashCommandBuilder()
    .setName('crashes')
    .setDescription('Show items with biggest price drops')
    .addStringOption(opt => opt
      .setName('timeframe')
      .setDescription('Time period')
      .addChoices(
        { name: '1 Hour', value: '1' },
        { name: '6 Hours', value: '6' },
        { name: '24 Hours', value: '24' }
      )),

  new SlashCommandBuilder()
    .setName('volatile')
    .setDescription('Show the most volatile items'),

  // ─────────────────────────────────────────────────────────────────────────────
  // MANIPULATION DETECTION
  // ─────────────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Scan for market signals')
    .addSubcommand(sub => sub
      .setName('pump')
      .setDescription('Find items showing pump patterns'))
    .addSubcommand(sub => sub
      .setName('dump')
      .setDescription('Find items currently crashing'))
    .addSubcommand(sub => sub
      .setName('unusual')
      .setDescription('Find items with unusual activity'))
    .addSubcommand(sub => sub
      .setName('opportunity')
      .setDescription('AI-ranked best opportunities right now')),

  new SlashCommandBuilder()
    .setName('analyse')
    .setDescription('Deep dive analysis on a single item')
    .addStringOption(opt => opt
      .setName('item')
      .setDescription('Item to analyse')
      .setRequired(true)
      .setAutocomplete(true)),

  // ─────────────────────────────────────────────────────────────────────────────
  // ALERTS
  // ─────────────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('alert')
    .setDescription('Manage your price alerts')
    .addSubcommand(sub => sub
      .setName('price')
      .setDescription('Alert when price reaches a target')
      .addStringOption(opt => opt
        .setName('item')
        .setDescription('Item name')
        .setRequired(true)
        .setAutocomplete(true))
      .addNumberOption(opt => opt
        .setName('target')
        .setDescription('Target price in gp')
        .setRequired(true))
      .addStringOption(opt => opt
        .setName('direction')
        .setDescription('Alert when price goes above or below')
        .setRequired(true)
        .addChoices(
          { name: 'Above or equal', value: 'ABOVE' },
          { name: 'Below or equal', value: 'BELOW' }
        )))
    .addSubcommand(sub => sub
      .setName('change')
      .setDescription('Alert when price changes by a percentage')
      .addStringOption(opt => opt
        .setName('item')
        .setDescription('Item name')
        .setRequired(true)
        .setAutocomplete(true))
      .addNumberOption(opt => opt
        .setName('percent')
        .setDescription('Change threshold (e.g., 5 for +5%, -5 for -5%)')
        .setRequired(true))
      .addIntegerOption(opt => opt
        .setName('hours')
        .setDescription('Timeframe in hours (default: 1)')))
    .addSubcommand(sub => sub
      .setName('margin')
      .setDescription('Alert when margin exceeds threshold')
      .addStringOption(opt => opt
        .setName('item')
        .setDescription('Item name')
        .setRequired(true)
        .setAutocomplete(true))
      .addNumberOption(opt => opt
        .setName('min_percent')
        .setDescription('Minimum margin %')
        .setRequired(true))
      .addNumberOption(opt => opt
        .setName('min_gp')
        .setDescription('Minimum margin gp (optional)')))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('View your active alerts'))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove an alert')
      .addStringOption(opt => opt
        .setName('alert_id')
        .setDescription('Alert ID to remove')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear all your alerts')),

  // ─────────────────────────────────────────────────────────────────────────────
  // SERVER ALERTS CONFIG
  // ─────────────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Configure server-wide alerts')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Enable alerts in this channel'))
    .addSubcommand(sub => sub
      .setName('config')
      .setDescription('Configure alert thresholds')
      .addNumberOption(opt => opt
        .setName('crash_moderate')
        .setDescription('Moderate crash threshold % (e.g., -5)'))
      .addNumberOption(opt => opt
        .setName('crash_severe')
        .setDescription('Severe crash threshold % (e.g., -10)'))
      .addNumberOption(opt => opt
        .setName('spike_moderate')
        .setDescription('Moderate spike threshold % (e.g., 5)'))
      .addNumberOption(opt => opt
        .setName('spike_severe')
        .setDescription('Severe spike threshold % (e.g., 10)'))
      .addIntegerOption(opt => opt
        .setName('timeframe')
        .setDescription('Timeframe in hours (default: 1)')))
    .addSubcommand(sub => sub
      .setName('features')
      .setDescription('Toggle alert features')
      .addBooleanOption(opt => opt
        .setName('pump_alerts')
        .setDescription('Enable pump detection alerts'))
      .addBooleanOption(opt => opt
        .setName('dump_alerts')
        .setDescription('Enable dump detection alerts'))
      .addBooleanOption(opt => opt
        .setName('manipulation_alerts')
        .setDescription('Enable unusual activity alerts'))
      .addBooleanOption(opt => opt
        .setName('volume_alerts')
        .setDescription('Enable volume spike alerts')))
    .addSubcommand(sub => sub
      .setName('cooldowns')
      .setDescription('Set alert cooldowns')
      .addIntegerOption(opt => opt
        .setName('price_minutes')
        .setDescription('Minutes between price alerts for same item'))
      .addIntegerOption(opt => opt
        .setName('manipulation_minutes')
        .setDescription('Minutes between manipulation alerts for same item')))
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('View current configuration'))
    .addSubcommand(sub => sub
      .setName('stop')
      .setDescription('Disable all server alerts')),

  // ─────────────────────────────────────────────────────────────────────────────
  // WATCHLIST
  // ─────────────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage server watchlist')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add item to watchlist')
      .addStringOption(opt => opt
        .setName('item')
        .setDescription('Item name')
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove item from watchlist')
      .addStringOption(opt => opt
        .setName('item')
        .setDescription('Item name')
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('View current watchlist'))
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear entire watchlist')),

  // ─────────────────────────────────────────────────────────────────────────────
  // PORTFOLIO
  // ─────────────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('portfolio')
    .setDescription('Track your flips and P&L')
    .addSubcommand(sub => sub
      .setName('buy')
      .setDescription('Log a buy')
      .addStringOption(opt => opt
        .setName('item')
        .setDescription('Item name')
        .setRequired(true)
        .setAutocomplete(true))
      .addIntegerOption(opt => opt
        .setName('quantity')
        .setDescription('Quantity')
        .setRequired(true))
      .addIntegerOption(opt => opt
        .setName('price')
        .setDescription('Price per item')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('sell')
      .setDescription('Log a sell')
      .addStringOption(opt => opt
        .setName('item')
        .setDescription('Item name')
        .setRequired(true)
        .setAutocomplete(true))
      .addIntegerOption(opt => opt
        .setName('quantity')
        .setDescription('Quantity')
        .setRequired(true))
      .addIntegerOption(opt => opt
        .setName('price')
        .setDescription('Price per item')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('summary')
      .setDescription('View your portfolio summary'))
    .addSubcommand(sub => sub
      .setName('history')
      .setDescription('View your recent trades')
      .addIntegerOption(opt => opt
        .setName('limit')
        .setDescription('Number of trades to show')))
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear all your trade history')),

  // ─────────────────────────────────────────────────────────────────────────────
  // VENGEANCE LIST
  // ─────────────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('veng')
    .setDescription('Manage the vengeance list')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add RSN(s) to the list')
      .addStringOption(opt => opt
        .setName('rsn')
        .setDescription('RSN(s) - comma separated for multiple')
        .setRequired(true))
      .addStringOption(opt => opt
        .setName('reason')
        .setDescription('Reason for adding')))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove RSN from the list')
      .addStringOption(opt => opt
        .setName('rsn')
        .setDescription('RSN to remove')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('View the vengeance list'))
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear the entire list')),

  // ─────────────────────────────────────────────────────────────────────────────
  // UTILITY
  // ─────────────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('alch')
    .setDescription('Find profitable high alch items')
    .addIntegerOption(opt => opt
      .setName('min_profit')
      .setDescription('Minimum profit per alch (default: 100)')),

  new SlashCommandBuilder()
    .setName('correlate')
    .setDescription('Find items that move with a given item')
    .addStringOption(opt => opt
      .setName('item')
      .setDescription('Base item')
      .setRequired(true)
      .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show bot statistics'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help and command list'),
];

export default commands;
