// leaderboard.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared leaderboard system — tracks wins/losses/draws per user per game.
// Persisted to data/leaderboard.json.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, 'data');
const LB_FILE   = path.join(DATA_DIR, 'leaderboard.json');

// ═════════════════════════════════════════════════════════════════════════════
//  DATA STRUCTURE
//  {
//    "userId": {
//      "name": "DisplayName",
//      "games": {
//        "connect4": { "wins": 0, "losses": 0, "draws": 0 },
//        ...
//      }
//    }
//  }
// ═════════════════════════════════════════════════════════════════════════════

let data = {};

function load() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(LB_FILE)) {
      data = JSON.parse(fs.readFileSync(LB_FILE, 'utf8'));
      console.log(`[LB] Loaded leaderboard (${Object.keys(data).length} users).`);
    }
  } catch (err) {
    console.error('[LB] Failed to load leaderboard:', err);
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[LB] Failed to save leaderboard:', err);
  }
}

load();

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC API — used by each game module
// ═════════════════════════════════════════════════════════════════════════════

function ensureUser(userId, displayName) {
  if (!data[userId]) {
    data[userId] = { name: displayName, games: {} };
  } else {
    data[userId].name = displayName; // keep name up to date
  }
}

function ensureGame(userId, gameName) {
  if (!data[userId].games[gameName]) {
    data[userId].games[gameName] = { wins: 0, losses: 0, draws: 0 };
  }
}

/**
 * Record a win for the given user in the given game.
 */
export function recordWin(userId, displayName, gameName) {
  ensureUser(userId, displayName);
  ensureGame(userId, gameName);
  data[userId].games[gameName].wins++;
  save();
}

/**
 * Record a loss for the given user in the given game.
 */
export function recordLoss(userId, displayName, gameName) {
  ensureUser(userId, displayName);
  ensureGame(userId, gameName);
  data[userId].games[gameName].losses++;
  save();
}

/**
 * Record a draw for the given user in the given game.
 */
export function recordDraw(userId, displayName, gameName) {
  ensureUser(userId, displayName);
  ensureGame(userId, gameName);
  data[userId].games[gameName].draws++;
  save();
}

/**
 * Get a user's stats for a specific game (or null).
 */
export function getStats(userId, gameName) {
  return data[userId]?.games?.[gameName] || null;
}

/**
 * Get sorted leaderboard for a game.
 * Returns array of { userId, name, wins, losses, draws, points }.
 * Points: win=3, draw=1, loss=0.
 */
export function getLeaderboard(gameName) {
  const entries = [];
  for (const [userId, userData] of Object.entries(data)) {
    const g = userData.games?.[gameName];
    if (!g) continue;
    const total = g.wins + g.losses + g.draws;
    if (total === 0) continue;
    entries.push({
      userId,
      name: userData.name,
      wins: g.wins,
      losses: g.losses,
      draws: g.draws,
      points: g.wins * 3 + g.draws,
    });
  }
  entries.sort((a, b) => b.points - a.points || b.wins - a.wins);
  return entries;
}

/**
 * Get overall leaderboard across ALL games.
 */
export function getOverallLeaderboard() {
  const totals = {};
  for (const [userId, userData] of Object.entries(data)) {
    let w = 0, l = 0, d = 0;
    for (const g of Object.values(userData.games || {})) {
      w += g.wins; l += g.losses; d += g.draws;
    }
    if (w + l + d === 0) continue;
    totals[userId] = {
      name: userData.name,
      wins: w, losses: l, draws: d,
      points: w * 3 + d,
    };
  }
  return Object.entries(totals)
    .map(([userId, t]) => ({ userId, ...t }))
    .sort((a, b) => b.points - a.points || b.wins - a.wins);
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME REGISTRY — each game registers itself here for the /leaderboard menu
// ═════════════════════════════════════════════════════════════════════════════

const GAME_NAMES = {
  connect4:   'Connect 4',
  tictactoe:  'Tic Tac Toe',
  rps:        'Rock Paper Scissors',
  blackjack:  'Blackjack',
  hangman:    'Hangman',
  trivia:     'Trivia',
  higherlow:  'Higher or Lower',
  roulette:   'Russian Roulette',
  minesweeper:'Minesweeper',
  wordle:     'Wordle',
  poker:      'Poker',
  checkers:   'Checkers',
};

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const cmdLeaderboard = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View the game leaderboard')
  .addStringOption(opt =>
    opt.setName('game')
      .setDescription('Which game? Leave empty for overall.')
      .setRequired(false)
      .addChoices(
        { name: 'Overall', value: 'overall' },
        ...Object.entries(GAME_NAMES).map(([k, v]) => ({ name: v, value: k })),
      ),
  );

export const leaderboardCommands = [cmdLeaderboard];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

export async function handleLeaderboardInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== 'leaderboard') return false;

  const game = interaction.options.getString('game') || 'overall';

  if (game === 'overall') {
    const lb = getOverallLeaderboard();
    if (lb.length === 0) {
      await interaction.reply({ content: 'No games have been played yet!', ephemeral: true });
      return true;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = lb.slice(0, 15).map((e, i) => {
      const medal = medals[i] || `**${i + 1}.**`;
      return `${medal} **${e.name}** — ${e.points} pts (${e.wins}W ${e.losses}L ${e.draws}D)`;
    });

    const embed = new EmbedBuilder()
      .setTitle('🏆 Overall Leaderboard')
      .setDescription(lines.join('\n'))
      .setColor(0xFFD700)
      .setFooter({ text: 'Points: Win = 3, Draw = 1' });

    await interaction.reply({ embeds: [embed] });
    return true;
  }

  // Specific game
  const lb = getLeaderboard(game);
  const gamePretty = GAME_NAMES[game] || game;

  if (lb.length === 0) {
    await interaction.reply({ content: `No ${gamePretty} games have been played yet!`, ephemeral: true });
    return true;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = lb.slice(0, 15).map((e, i) => {
    const medal = medals[i] || `**${i + 1}.**`;
    return `${medal} **${e.name}** — ${e.points} pts (${e.wins}W ${e.losses}L ${e.draws}D)`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${gamePretty} Leaderboard`)
    .setDescription(lines.join('\n'))
    .setColor(0xFFD700)
    .setFooter({ text: 'Points: Win = 3, Draw = 1' });

  await interaction.reply({ embeds: [embed] });
  return true;
}
