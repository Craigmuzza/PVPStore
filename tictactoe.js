// tictactoe.js
// ─────────────────────────────────────────────────────────────────────────────
// Tic-Tac-Toe game playable inside Discord with 3x3 button grid.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { recordWin, recordLoss, recordDraw } from './leaderboard.js';

const GAME_KEY = 'tictactoe';

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const EMPTY = 0;
const P1 = 1;  // Challenger — ❌
const P2 = 2;  // Opponent  — ⭕

const GAME_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

// Keyed by the board message ID
const games = new Map();

// Pending challenges: keyed by the challenge message ID
const pendingChallenges = new Map();

/**
 * Create a fresh 3×3 board (all zeros). Positions 0-8 left-to-right, top-to-bottom.
 */
function createBoard() {
  return Array(9).fill(EMPTY);
}

// ═════════════════════════════════════════════════════════════════════════════
//  WIN DETECTION
// ═════════════════════════════════════════════════════════════════════════════

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

function checkWin(board, player) {
  return WIN_LINES.some(line =>
    line.every(idx => board[idx] === player),
  );
}

function checkDraw(board) {
  return board.every(cell => cell !== EMPTY);
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDERING
// ═════════════════════════════════════════════════════════════════════════════

function buildGrid(game, disabled = false) {
  const rows = [new ActionRowBuilder(), new ActionRowBuilder(), new ActionRowBuilder()];

  for (let i = 0; i < 9; i++) {
    const cell = game.board[i];
    let style = ButtonStyle.Secondary;
    let label = 'ㅤ';

    if (cell === P1) {
      style = ButtonStyle.Danger;
      label = '❌';
    } else if (cell === P2) {
      style = ButtonStyle.Success;
      label = '⭕';
    }

    const btn = new ButtonBuilder()
      .setCustomId(`ttt_move_${i}`)
      .setLabel(label)
      .setStyle(style)
      .setDisabled(disabled || cell !== EMPTY);

    rows[Math.floor(i / 3)].addComponents(btn);
  }

  return rows;
}

function buildEmbed(game, statusText, { win = false } = {}) {
  const currentPlayer = game.currentTurn === P1 ? game.player1Name : game.player2Name;
  const turnIcon = game.currentTurn === P1 ? '❌' : '⭕';
  const defaultFooter = statusText || `${turnIcon} ${currentPlayer}'s turn`;

  let color;
  if (win) color = 0xFFD700;
  else color = game.currentTurn === P1 ? 0xE74C3C : 0x2ECC71;

  return new EmbedBuilder()
    .setTitle('❌⭕ Tic Tac Toe')
    .setDescription(`**${game.player1Name}** ❌ vs **${game.player2Name}** ⭕\n━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    .setFooter({ text: defaultFooter })
    .setColor(color);
}

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  for (const [msgId, game] of games) {
    if (now - game.lastMove > GAME_TIMEOUT_MS) {
      games.delete(msgId);
      console.log(`[TTT] Game ${msgId} expired (timeout).`);
    }
  }
  for (const [msgId, challenge] of pendingChallenges) {
    if (now - challenge.createdAt > GAME_TIMEOUT_MS) {
      pendingChallenges.delete(msgId);
      console.log(`[TTT] Challenge ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const slashCommand = new SlashCommandBuilder()
  .setName('tictactoe')
  .setDescription('Challenge someone to Tic-Tac-Toe!')
  .addUserOption(opt =>
    opt.setName('opponent')
      .setDescription('The user you want to play against')
      .setRequired(true),
  );

export const tictactoeCommands = [slashCommand];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Handle all Tic-Tac-Toe related interactions.
 * Returns true if handled, false otherwise.
 */
export async function handleTicTacToeInteraction(interaction) {
  // ── Slash commands ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'tictactoe') {
      return await cmdChallenge(interaction);
    }
    return false;
  }

  // ── Button clicks ──────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const id = interaction.customId;

    if (id === 'ttt_accept' || id === 'ttt_decline') {
      return await handleChallengeResponse(interaction);
    }

    if (id.startsWith('ttt_move_')) {
      return await handleMove(interaction);
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
  const opponent = interaction.options.getUser('opponent');

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
      await interaction.reply({ content: "You're already in a game! Finish it or wait for it to expire.", ephemeral: true });
      return true;
    }
    if (game.player1 === opponent.id || game.player2 === opponent.id) {
      await interaction.reply({ content: `${opponent.displayName} is already in a game.`, ephemeral: true });
      return true;
    }
  }

  // Check pending challenges
  for (const challenge of pendingChallenges.values()) {
    if (challenge.challengerId === challenger.id || challenge.opponentId === challenger.id) {
      await interaction.reply({ content: "You already have a pending challenge.", ephemeral: true });
      return true;
    }
    if (challenge.challengerId === opponent.id || challenge.opponentId === opponent.id) {
      await interaction.reply({ content: `${opponent.displayName} has a pending challenge.`, ephemeral: true });
      return true;
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ttt_accept')
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ttt_decline')
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );

  const challengeEmbed = new EmbedBuilder()
    .setTitle('🎮 Tic Tac Toe Challenge!')
    .setDescription(`${challenger} challenges ${opponent} to a game!\n\n${opponent}, do you accept?`)
    .setColor(0x3498DB);

  const msg = await interaction.reply({
    embeds: [challengeEmbed],
    components: [row],
    fetchReply: true,
  });

  pendingChallenges.set(msg.id, {
    challengerId: challenger.id,
    challengerName: challenger.displayName,
    opponentId: opponent.id,
    opponentName: opponent.displayName,
    createdAt: Date.now(),
  });

  console.log(`[TTT] ${challenger.tag} challenged ${opponent.tag}`);
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

  if (interaction.user.id !== challenge.opponentId) {
    await interaction.reply({ content: "This challenge isn't for you!", ephemeral: true });
    return true;
  }

  pendingChallenges.delete(msgId);

  if (interaction.customId === 'ttt_decline') {
    await interaction.update({
      content: `❌ **${challenge.opponentName}** declined the challenge.`,
      embeds: [],
      components: [],
    });
    console.log(`[TTT] ${challenge.opponentName} declined ${challenge.challengerName}'s challenge`);
    return true;
  }

  // ── Accept: start the game ──────────────────────────────────────────────
  const game = {
    board: createBoard(),
    player1: challenge.challengerId,
    player1Name: challenge.challengerName,
    player2: challenge.opponentId,
    player2Name: challenge.opponentName,
    currentTurn: P1,
    lastMove: Date.now(),
  };

  const embed = buildEmbed(game);
  const grid = buildGrid(game);

  await interaction.update({
    content: null,
    embeds: [embed],
    components: grid,
  });

  games.set(msgId, game);

  console.log(`[TTT] Game started: ${challenge.challengerName} vs ${challenge.opponentName}`);
  return true;
}

async function handleMove(interaction) {
  const msgId = interaction.message.id;
  const game = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
    return true;
  }

  const expectedPlayer = game.currentTurn === P1 ? game.player1 : game.player2;
  if (interaction.user.id !== expectedPlayer) {
    if (interaction.user.id !== game.player1 && interaction.user.id !== game.player2) {
      await interaction.reply({ content: "You're not in this game!", ephemeral: true });
      return true;
    }
    await interaction.reply({ content: "It's not your turn!", ephemeral: true });
    return true;
  }

  const pos = parseInt(interaction.customId.replace('ttt_move_', ''), 10);
  if (game.board[pos] !== EMPTY) {
    await interaction.reply({ content: 'That spot is already taken!', ephemeral: true });
    return true;
  }

  game.board[pos] = game.currentTurn;
  game.lastMove = Date.now();

  const player = game.currentTurn;

  // ── Check for win ─────────────────────────────────────────────────────
  if (checkWin(game.board, player)) {
    const winnerName = player === P1 ? game.player1Name : game.player2Name;
    const embed = buildEmbed(game, `🏆 ${player === P1 ? '❌' : '⭕'} ${winnerName} wins!`, { win: true });

    await interaction.update({
      embeds: [embed],
      components: buildGrid(game, true),
    });

    const loserId = player === P1 ? game.player2 : game.player1;
    const loserName = player === P1 ? game.player2Name : game.player1Name;
    recordWin(expectedPlayer, winnerName, GAME_KEY);
    recordLoss(loserId, loserName, GAME_KEY);
    games.delete(msgId);
    console.log(`[TTT] ${winnerName} won!`);
    return true;
  }

  // ── Check for draw ────────────────────────────────────────────────────
  if (checkDraw(game.board)) {
    const embed = buildEmbed(game, "🤝 It's a draw!");

    await interaction.update({
      embeds: [embed],
      components: buildGrid(game, true),
    });

    recordDraw(game.player1, game.player1Name, GAME_KEY);
    recordDraw(game.player2, game.player2Name, GAME_KEY);
    games.delete(msgId);
    console.log('[TTT] Game ended in a draw.');
    return true;
  }

  // ── Next turn ─────────────────────────────────────────────────────────
  game.currentTurn = game.currentTurn === P1 ? P2 : P1;

  const embed = buildEmbed(game);
  const grid = buildGrid(game);

  await interaction.update({
    embeds: [embed],
    components: grid,
  });

  return true;
}
