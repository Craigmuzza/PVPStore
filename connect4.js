// connect4.js
// ─────────────────────────────────────────────────────────────────────────────
// Connect 4 game playable inside Discord using emoji board + button columns.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const P1    = 1;
const P2    = 2;

const CELL = {
  [EMPTY]: '⚫',
  [P1]:    '🔴',
  [P2]:    '🟡',
};

const COL_LABELS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

const GAME_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

// Keyed by the board message ID
const games = new Map();

// Pending challenges: keyed by the challenge message ID
const pendingChallenges = new Map();

/**
 * Create a fresh 6×7 board (all zeros).
 */
function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDERING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Render the board as an emoji string.
 */
function renderBoard(board) {
  let str = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      str += CELL[board[r][c]];
    }
    str += '\n';
  }
  str += COL_LABELS.join('');
  return str;
}

/**
 * Build the game embed.
 */
function buildEmbed(game, statusText) {
  const currentPlayer = game.currentTurn === P1 ? game.player1 : game.player2;
  const turnIcon = game.currentTurn === P1 ? '🔴' : '🟡';

  return new EmbedBuilder()
    .setTitle('Connect 4')
    .setDescription(renderBoard(game.board))
    .setFooter({ text: statusText || `${turnIcon} ${game.currentTurn === P1 ? game.player1Name : game.player2Name}'s turn` })
    .setColor(game.currentTurn === P1 ? 0xDD2E44 : 0xFDCB58);
}

/**
 * Build the column button rows (Discord max 5 buttons per row).
 */
function buildButtons(game, disabled = false) {
  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();

  for (let c = 0; c < COLS; c++) {
    const colFull = game.board[0][c] !== EMPTY;
    const btn = new ButtonBuilder()
      .setCustomId(`c4_drop_${c}`)
      .setLabel(`${c + 1}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || colFull);

    if (c < 4) row1.addComponents(btn);
    else       row2.addComponents(btn);
  }

  return [row1, row2];
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME LOGIC
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Drop a piece into the given column. Returns the row it landed on, or -1 if full.
 */
function dropPiece(board, col, player) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === EMPTY) {
      board[r][col] = player;
      return r;
    }
  }
  return -1; // column full
}

/**
 * Check if the last placed piece at (row, col) resulted in a win.
 */
function checkWin(board, row, col) {
  const player = board[row][col];
  if (player === EMPTY) return false;

  const directions = [
    [0, 1],  // horizontal
    [1, 0],  // vertical
    [1, 1],  // diagonal ↘
    [1, -1], // diagonal ↙
  ];

  for (const [dr, dc] of directions) {
    let count = 1;
    // Check positive direction
    for (let i = 1; i < 4; i++) {
      const nr = row + dr * i;
      const nc = col + dc * i;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
      if (board[nr][nc] !== player) break;
      count++;
    }
    // Check negative direction
    for (let i = 1; i < 4; i++) {
      const nr = row - dr * i;
      const nc = col - dc * i;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
      if (board[nr][nc] !== player) break;
      count++;
    }
    if (count >= 4) return true;
  }
  return false;
}

/**
 * Check if the board is completely full (draw).
 */
function isBoardFull(board) {
  return board[0].every(cell => cell !== EMPTY);
}

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  for (const [msgId, game] of games) {
    if (now - game.lastMove > GAME_TIMEOUT_MS) {
      games.delete(msgId);
      console.log(`[C4] Game ${msgId} expired (timeout).`);
    }
  }
  for (const [msgId, challenge] of pendingChallenges) {
    if (now - challenge.createdAt > GAME_TIMEOUT_MS) {
      pendingChallenges.delete(msgId);
      console.log(`[C4] Challenge ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ═════════════════════════════════════════════════════════════════════════════

const cmdConnect4 = new SlashCommandBuilder()
  .setName('connect4')
  .setDescription('Challenge someone to a game of Connect 4!')
  .addUserOption(opt =>
    opt.setName('opponent')
      .setDescription('The user you want to play against')
      .setRequired(true),
  );

const cmdConnect4Forfeit = new SlashCommandBuilder()
  .setName('connect4forfeit')
  .setDescription('Forfeit your current Connect 4 game.');

export const connect4Commands = [cmdConnect4, cmdConnect4Forfeit];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Handle all Connect 4 related interactions.
 * Returns true if handled, false otherwise.
 */
export async function handleConnect4Interaction(interaction) {
  // ── Slash commands ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'connect4') {
      return await cmdChallenge(interaction);
    }
    if (interaction.commandName === 'connect4forfeit') {
      return await cmdForfeit(interaction);
    }
    return false;
  }

  // ── Button clicks ──────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const id = interaction.customId;

    if (id === 'c4_accept' || id === 'c4_decline') {
      return await handleChallengeResponse(interaction);
    }

    if (id.startsWith('c4_drop_')) {
      return await handleDrop(interaction);
    }

    return false;
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  COMMAND HANDLERS
// ═════════════════════════════════════════════════════════════════════════════

async function cmdChallenge(interaction) {
  const challenger = interaction.user;
  const opponent   = interaction.options.getUser('opponent');

  if (opponent.id === challenger.id) {
    await interaction.reply({ content: "You can't play against yourself.", ephemeral: true });
    return true;
  }

  if (opponent.bot) {
    await interaction.reply({ content: "You can't challenge a bot.", ephemeral: true });
    return true;
  }

  // Check if either player is already in a game
  for (const game of games.values()) {
    if (game.player1 === challenger.id || game.player2 === challenger.id) {
      await interaction.reply({ content: "You're already in a game! Use `/connect4forfeit` to quit it first.", ephemeral: true });
      return true;
    }
    if (game.player1 === opponent.id || game.player2 === opponent.id) {
      await interaction.reply({ content: `${opponent.displayName} is already in a game.`, ephemeral: true });
      return true;
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('c4_accept')
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('c4_decline')
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );

  const msg = await interaction.reply({
    content: `🎮 **Connect 4 Challenge!**\n${challenger} challenges ${opponent} to a game of Connect 4!\n\n${opponent}, do you accept?`,
    components: [row],
    fetchReply: true,
  });

  pendingChallenges.set(msg.id, {
    challengerId:   challenger.id,
    challengerName: challenger.displayName,
    opponentId:     opponent.id,
    opponentName:   opponent.displayName,
    createdAt:      Date.now(),
  });

  console.log(`[C4] ${challenger.tag} challenged ${opponent.tag}`);
  return true;
}

async function cmdForfeit(interaction) {
  const userId = interaction.user.id;

  for (const [msgId, game] of games) {
    if (game.player1 === userId || game.player2 === userId) {
      const winnerId = game.player1 === userId ? game.player2 : game.player1;
      const winnerName = game.player1 === userId ? game.player2Name : game.player1Name;
      const loserName  = game.player1 === userId ? game.player1Name : game.player2Name;

      games.delete(msgId);

      // Try to update the original board message
      try {
        const channel = interaction.channel;
        const boardMsg = await channel.messages.fetch(msgId);
        const embed = buildEmbed(game, `🏳️ ${loserName} forfeited! ${winnerName} wins!`);
        await boardMsg.edit({ embeds: [embed], components: buildButtons(game, true) });
      } catch {
        // message may be gone
      }

      await interaction.reply({ content: `🏳️ **${loserName}** forfeited! **${winnerName}** wins!` });
      console.log(`[C4] ${loserName} forfeited against ${winnerName}`);
      return true;
    }
  }

  await interaction.reply({ content: "You're not in a game.", ephemeral: true });
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUTTON HANDLERS
// ═════════════════════════════════════════════════════════════════════════════

async function handleChallengeResponse(interaction) {
  const msgId = interaction.message.id;
  const challenge = pendingChallenges.get(msgId);

  if (!challenge) {
    await interaction.reply({ content: 'This challenge has expired.', ephemeral: true });
    return true;
  }

  // Only the opponent can accept/decline
  if (interaction.user.id !== challenge.opponentId) {
    await interaction.reply({ content: "This challenge isn't for you!", ephemeral: true });
    return true;
  }

  pendingChallenges.delete(msgId);

  if (interaction.customId === 'c4_decline') {
    await interaction.update({
      content: `❌ **${challenge.opponentName}** declined the challenge.`,
      components: [],
    });
    console.log(`[C4] ${challenge.opponentName} declined ${challenge.challengerName}'s challenge`);
    return true;
  }

  // ── Accept: start the game ──────────────────────────────────────────────
  const board = createBoard();
  const game = {
    board,
    player1:     challenge.challengerId,
    player1Name: challenge.challengerName,
    player2:     challenge.opponentId,
    player2Name: challenge.opponentName,
    currentTurn: P1,
    lastMove:    Date.now(),
  };

  const embed  = buildEmbed(game);
  const buttons = buildButtons(game);

  // Update the challenge message into the game board
  await interaction.update({
    content: `🎮 **Connect 4** — ${challenge.challengerName} 🔴 vs ${challenge.opponentName} 🟡`,
    embeds: [embed],
    components: buttons,
  });

  // Store game keyed by the same message
  games.set(msgId, game);

  console.log(`[C4] Game started: ${challenge.challengerName} vs ${challenge.opponentName}`);
  return true;
}

async function handleDrop(interaction) {
  const msgId = interaction.message.id;
  const game  = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
    return true;
  }

  // Verify it's the correct player's turn
  const expectedPlayer = game.currentTurn === P1 ? game.player1 : game.player2;
  if (interaction.user.id !== expectedPlayer) {
    // Is this even a participant?
    if (interaction.user.id !== game.player1 && interaction.user.id !== game.player2) {
      await interaction.reply({ content: "You're not in this game!", ephemeral: true });
      return true;
    }
    await interaction.reply({ content: "It's not your turn!", ephemeral: true });
    return true;
  }

  const col = parseInt(interaction.customId.replace('c4_drop_', ''), 10);
  const row = dropPiece(game.board, col, game.currentTurn);

  if (row === -1) {
    await interaction.reply({ content: 'That column is full!', ephemeral: true });
    return true;
  }

  game.lastMove = Date.now();

  // ── Check for win ─────────────────────────────────────────────────────
  if (checkWin(game.board, row, col)) {
    const winnerName = game.currentTurn === P1 ? game.player1Name : game.player2Name;
    const winnerIcon = game.currentTurn === P1 ? '🔴' : '🟡';
    const embed = buildEmbed(game, `🏆 ${winnerIcon} ${winnerName} wins!`);

    await interaction.update({
      embeds: [embed],
      components: buildButtons(game, true),
    });

    games.delete(msgId);
    console.log(`[C4] ${winnerName} won!`);
    return true;
  }

  // ── Check for draw ────────────────────────────────────────────────────
  if (isBoardFull(game.board)) {
    const embed = buildEmbed(game, "🤝 It's a draw!");

    await interaction.update({
      embeds: [embed],
      components: buildButtons(game, true),
    });

    games.delete(msgId);
    console.log('[C4] Game ended in a draw.');
    return true;
  }

  // ── Next turn ─────────────────────────────────────────────────────────
  game.currentTurn = game.currentTurn === P1 ? P2 : P1;

  const embed  = buildEmbed(game);
  const buttons = buildButtons(game);

  await interaction.update({
    embeds: [embed],
    components: buttons,
  });

  return true;
}
