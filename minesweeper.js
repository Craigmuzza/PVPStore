// minesweeper.js
// ─────────────────────────────────────────────────────────────────────────────
// Minesweeper game — 5x5 grid, 5 mines, Discord spoiler + button play.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { recordWin, recordLoss } from './leaderboard.js';

const GAME_KEY = 'minesweeper';

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const SIZE = 5;
const MINE_COUNT = 5;
const GAME_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const NUM_EMOJIS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
const MINE_EMOJI = '💣';
const HIT_EMOJI = '💥';
const HIDDEN_EMOJI = '⬜';

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],          [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1],
];

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

// Keyed by message ID. Each game: { playerId, playerName, grid, revealed, firstClick, hitCell, lastMove }
const games = new Map();

// One game per player — playerId -> messageId (for active game lookup)
const playerToMessage = new Map();

// ═════════════════════════════════════════════════════════════════════════════
//  BOARD GENERATION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Generate a 5x5 grid. grid[r][c] = -1 for mine, 0-8 for adjacent count.
 * @param {[number, number] | null} exclude - [r, c] to exclude from mine placement (first click safety)
 */
function generateBoard(exclude = null) {
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (exclude && r === exclude[0] && c === exclude[1]) continue;
      cells.push([r, c]);
    }
  }

  // Shuffle and pick first 5 for mines
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const minePositions = cells.slice(0, MINE_COUNT);
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

  for (const [r, c] of minePositions) {
    grid[r][c] = -1;
  }

  // Count adjacent mines for non-mine cells
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === -1) continue;
      let count = 0;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && grid[nr][nc] === -1) {
          count++;
        }
      }
      grid[r][c] = count;
    }
  }

  return grid;
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDERING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build spoiler text board for Discord (tap to reveal).
 */
function buildSpoilerBoard(grid) {
  const rows = [];
  for (let r = 0; r < SIZE; r++) {
    const cells = [];
    for (let c = 0; c < SIZE; c++) {
      const val = grid[r][c];
      const emoji = val === -1 ? MINE_EMOJI : NUM_EMOJIS[val];
      cells.push(`||${emoji}||`);
    }
    rows.push(cells.join(' '));
  }
  return rows.join('\n');
}

/**
 * Build 5x5 button grid.
 * @param {object} game - { grid, revealed, hitCell, over }
 */
function buildButtonGrid(game, disabled = false) {
  const rows = [];
  for (let r = 0; r < SIZE; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < SIZE; c++) {
      const isRevealed = game.revealed[r][c];
      const val = game.grid[r][c];
      let label = HIDDEN_EMOJI;
      let style = ButtonStyle.Secondary;

      if (isRevealed) {
        if (val === -1) {
          label = game.hitCell && game.hitCell[0] === r && game.hitCell[1] === c ? HIT_EMOJI : MINE_EMOJI;
          style = game.hitCell && game.hitCell[0] === r && game.hitCell[1] === c ? ButtonStyle.Danger : ButtonStyle.Secondary;
        } else {
          label = NUM_EMOJIS[val];
          style = ButtonStyle.Primary;
        }
      }

      const btn = new ButtonBuilder()
        .setCustomId(`ms_${r}_${c}`)
        .setLabel(label)
        .setStyle(style)
        .setDisabled(disabled || isRevealed);

      row.addComponents(btn);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Count revealed safe cells.
 */
function countRevealedSafe(game) {
  let count = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (game.revealed[r][c] && game.grid[r][c] !== -1) count++;
    }
  }
  return count;
}

const TOTAL_SAFE = SIZE * SIZE - MINE_COUNT; // 20

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  for (const [msgId, game] of games) {
    if (now - game.lastMove > GAME_TIMEOUT_MS) {
      playerToMessage.delete(game.playerId);
      games.delete(msgId);
      console.log(`[MS] Game ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const slashCommand = new SlashCommandBuilder()
  .setName('minesweeper')
  .setDescription('Play Minesweeper — 5x5 grid, 5 mines. Tap spoilers or use buttons!');

export const minesweeperCommands = [slashCommand];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Handle all Minesweeper related interactions.
 * Returns true if handled, false otherwise.
 */
export async function handleMinesweeperInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'minesweeper') {
      return await cmdMinesweeper(interaction);
    }
    return false;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('ms_')) {
      return await handleButtonClick(interaction);
    }
    return false;
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  COMMAND HANDLER
// ═════════════════════════════════════════════════════════════════════════════

async function cmdMinesweeper(interaction) {
  const user = interaction.user;

  // One game per player
  const existingMsgId = playerToMessage.get(user.id);
  if (existingMsgId) {
    const existing = games.get(existingMsgId);
    if (existing) {
      await interaction.reply({
        content: "You already have an active Minesweeper game! Finish it or wait for it to expire.",
        ephemeral: true,
      });
      return true;
    }
    playerToMessage.delete(user.id);
  }

  // Generate initial board (mines placed randomly; first click may trigger regenerate)
  const grid = generateBoard();
  const revealed = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));

  const game = {
    playerId: user.id,
    playerName: user.displayName,
    grid,
    revealed,
    firstClick: true,
    hitCell: null,
    over: false,
    lastMove: Date.now(),
  };

  const spoilerText = buildSpoilerBoard(grid);
  const content = `**Minesweeper** — 5×5 grid, 5 mines\n\nTap the spoilers below to reveal, or use the buttons!\n\n${spoilerText}`;
  const components = buildButtonGrid(game);

  const msg = await interaction.reply({
    content,
    components,
    fetchReply: true,
  });

  games.set(msg.id, game);
  playerToMessage.set(user.id, msg.id);

  console.log(`[MS] ${user.tag} started a game`);
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUTTON HANDLER
// ═════════════════════════════════════════════════════════════════════════════

async function handleButtonClick(interaction) {
  const msgId = interaction.message.id;
  const game = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
    return true;
  }

  if (interaction.user.id !== game.playerId) {
    await interaction.reply({ content: "This isn't your game!", ephemeral: true });
    return true;
  }

  if (game.over) {
    await interaction.reply({ content: 'This game is over.', ephemeral: true });
    return true;
  }

  const match = interaction.customId.match(/^ms_(\d)_(\d)$/);
  if (!match) return false;

  const r = parseInt(match[1], 10);
  const c = parseInt(match[2], 10);

  if (game.revealed[r][c]) {
    await interaction.reply({ content: 'Already revealed!', ephemeral: true });
    return true;
  }

  game.lastMove = Date.now();

  // First click: never a mine — regenerate if needed
  if (game.firstClick) {
    game.firstClick = false;
    if (game.grid[r][c] === -1) {
      game.grid = generateBoard([r, c]);
    }
  }

  // Clicked a mine
  if (game.grid[r][c] === -1) {
    game.over = true;
    game.hitCell = [r, c];

    // Reveal all cells
    for (let i = 0; i < SIZE; i++) {
      for (let j = 0; j < SIZE; j++) {
        game.revealed[i][j] = true;
      }
    }

    recordLoss(game.playerId, game.playerName, GAME_KEY);
    playerToMessage.delete(game.playerId);
    games.delete(msgId);

    await interaction.update({
      content: `**Minesweeper** — 💥 Boom! You hit a mine!\n\n${buildSpoilerBoard(game.grid)}`,
      components: buildButtonGrid(game, true),
    });

    console.log(`[MS] ${game.playerName} hit a mine`);
    return true;
  }

  // Safe cell
  game.revealed[r][c] = true;

  const safeCount = countRevealedSafe(game);

  if (safeCount >= TOTAL_SAFE) {
    // Win
    game.over = true;
    recordWin(game.playerId, game.playerName, GAME_KEY);
    playerToMessage.delete(game.playerId);
    games.delete(msgId);

    await interaction.update({
      content: `**Minesweeper** — 🎉 You win! All safe cells revealed!\n\n${buildSpoilerBoard(game.grid)}`,
      components: buildButtonGrid(game, true),
    });

    console.log(`[MS] ${game.playerName} won!`);
    return true;
  }

  // Game continues — keep spoiler board in sync (important if board was regenerated on first click)
  const spoilerText = buildSpoilerBoard(game.grid);
  const continueContent = `**Minesweeper** — 5×5 grid, 5 mines\n\nTap the spoilers below to reveal, or use the buttons!\n\n${spoilerText}`;
  await interaction.update({
    content: continueContent,
    components: buildButtonGrid(game),
  });

  return true;
}
