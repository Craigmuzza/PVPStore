// checkers.js
// ─────────────────────────────────────────────────────────────────────────────
// Checkers — 5×5 board where the grid IS the buttons (like Battleships/TTT).
// Click your piece on the board → it highlights green + shows destinations →
// click where to move it. All interaction happens ON the board.
// 5×5 = 25 buttons = exactly Discord's limit.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { recordWin, recordLoss } from './leaderboard.js';

const GAME_KEY = 'checkers';

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const GRID = 5;

const EMPTY   = 0;
const P1      = 1;   // 🔴
const P2      = 2;   // 🔵
const P1_KING = 3;   // 👑🔴
const P2_KING = 4;   // 👑🔵

const GAME_TIMEOUT_MS = 10 * 60 * 1000;

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

const games             = new Map();
const pendingChallenges = new Map();

// ═════════════════════════════════════════════════════════════════════════════
//  BOARD SETUP — 5×5 mini checkers
//  Dark squares = (r + c) is odd.
//  P1 on rows 0-1, P2 on rows 3-4, row 2 empty.
//  5 pieces each at start.
// ═════════════════════════════════════════════════════════════════════════════

function createBoard() {
  const board = Array.from({ length: GRID }, () => Array(GRID).fill(EMPTY));
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < GRID; c++)
      if ((r + c) % 2 === 1) board[r][c] = P1;
  for (let r = 3; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      if ((r + c) % 2 === 1) board[r][c] = P2;
  return board;
}

function isDark(r, c) {
  return (r + c) % 2 === 1;
}

// ═════════════════════════════════════════════════════════════════════════════
//  PIECE HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function ownerOf(piece) {
  if (piece === P1 || piece === P1_KING) return P1;
  if (piece === P2 || piece === P2_KING) return P2;
  return EMPTY;
}

function isKing(piece) {
  return piece === P1_KING || piece === P2_KING;
}

function isOpponent(piece, player) {
  const o = ownerOf(piece);
  return o !== EMPTY && o !== player;
}

// ═════════════════════════════════════════════════════════════════════════════
//  MOVE GENERATION
// ═════════════════════════════════════════════════════════════════════════════

function getMoveDirs(piece) {
  if (isKing(piece)) return [1, -1];
  return ownerOf(piece) === P1 ? [1] : [-1]; // P1 moves down, P2 moves up
}

function getSimpleMoves(board, r, c) {
  const piece = board[r][c];
  if (piece === EMPTY) return [];
  const moves = [];
  for (const dr of getMoveDirs(piece)) {
    for (const dc of [-1, 1]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID && board[nr][nc] === EMPTY) {
        moves.push({ toR: nr, toC: nc });
      }
    }
  }
  return moves;
}

function getCaptureMoves(board, r, c) {
  const piece = board[r][c];
  if (piece === EMPTY) return [];
  const player = ownerOf(piece);
  const caps = [];
  for (const dr of getMoveDirs(piece)) {
    for (const dc of [-1, 1]) {
      const midR = r + dr, midC = c + dc;
      const landR = r + dr * 2, landC = c + dc * 2;
      if (
        landR >= 0 && landR < GRID && landC >= 0 && landC < GRID &&
        isOpponent(board[midR][midC], player) &&
        board[landR][landC] === EMPTY
      ) {
        caps.push({ toR: landR, toC: landC, midR, midC });
      }
    }
  }
  return caps;
}

function playerHasCaptures(board, player) {
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      if (ownerOf(board[r][c]) === player && getCaptureMoves(board, r, c).length > 0)
        return true;
  return false;
}

function getValidMoves(board, r, c, player) {
  return playerHasCaptures(board, player)
    ? getCaptureMoves(board, r, c)
    : getSimpleMoves(board, r, c);
}

/** Get all pieces that can move for the current player. */
function getMovablePieces(board, player) {
  const mustCapture = playerHasCaptures(board, player);
  const result = [];
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++) {
      if (ownerOf(board[r][c]) !== player) continue;
      const moves = mustCapture ? getCaptureMoves(board, r, c) : getSimpleMoves(board, r, c);
      if (moves.length > 0) result.push({ r, c });
    }
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME LOGIC
// ═════════════════════════════════════════════════════════════════════════════

function promoteIfNeeded(board, r, c) {
  if (board[r][c] === P1 && r === GRID - 1) { board[r][c] = P1_KING; return true; }
  if (board[r][c] === P2 && r === 0)         { board[r][c] = P2_KING; return true; }
  return false;
}

function executeMove(board, fromR, fromC, toR, toC) {
  const piece = board[fromR][fromC];
  board[fromR][fromC] = EMPTY;
  board[toR][toC] = piece;
  let captured = false;
  if (Math.abs(toR - fromR) === 2) {
    board[(fromR + toR) / 2][(fromC + toC) / 2] = EMPTY;
    captured = true;
  }
  const promoted = promoteIfNeeded(board, toR, toC);
  return { captured, promoted };
}

function countPieces(board, player) {
  let n = 0;
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      if (ownerOf(board[r][c]) === player) n++;
  return n;
}

function checkGameOver(board, nextPlayer) {
  if (countPieces(board, nextPlayer) === 0) return true;
  if (getMovablePieces(board, nextPlayer).length === 0) return true;
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  EMBED — compact info bar above the button grid
// ═════════════════════════════════════════════════════════════════════════════

function buildEmbed(game, statusText) {
  const p1Count = countPieces(game.board, P1);
  const p2Count = countPieces(game.board, P2);

  const turnIcon    = game.currentTurn === P1 ? '🔴' : '🔵';
  const currentName = game.currentTurn === P1 ? game.player1Name : game.player2Name;

  const mustCapture = playerHasCaptures(game.board, game.currentTurn);

  let desc = `🔴 **${game.player1Name}**: ${p1Count}  vs  🔵 **${game.player2Name}**: ${p2Count}`;

  if (!statusText) {
    if (game.selectedPiece) {
      desc += `\n\n🟢 Piece selected — **click where to move it**`;
    } else {
      desc += `\n\n${turnIcon} **${currentName}'s turn** — click one of your pieces`;
    }
    if (mustCapture) desc += '\n⚔️ **Jump available — you must capture!**';
  }

  return new EmbedBuilder()
    .setTitle('♟️ Checkers')
    .setDescription(desc)
    .setFooter({ text: statusText || `Pieces move diagonally. Kings (👑) move all directions.` })
    .setColor(0xD97706);
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUTTON GRID — the board IS the buttons (5 rows × 5 cols = 25)
// ═════════════════════════════════════════════════════════════════════════════

function cellEmoji(piece) {
  switch (piece) {
    case P1:      return '🔴';
    case P2:      return '🔵';
    case P1_KING: return '♛';
    case P2_KING: return '♚';
    default:      return '⬛';
  }
}

function cellEmojiKing(piece) {
  if (piece === P1_KING) return '👑';
  if (piece === P2_KING) return '👑';
  return null;
}

/**
 * Build the 5×5 button grid.
 *
 * Phase logic:
 * - No piece selected (step 1): movable pieces are enabled + Primary, rest disabled
 * - Piece selected (step 2): selected = enabled green, destinations = enabled green, rest disabled
 * - Game over: all disabled
 */
function buildGrid(game, disabled = false) {
  const board = game.board;
  const sel = game.selectedPiece; // { r, c } or null
  const turn = game.currentTurn;

  // Pre-compute movable pieces and valid destinations
  let movableSet = new Set();
  let destSet = new Set();
  let validMoves = [];

  if (!disabled && !sel) {
    // Step 1: highlight movable pieces
    const movable = game.multiJumpPiece
      ? [game.multiJumpPiece]
      : getMovablePieces(board, turn);
    for (const p of movable) movableSet.add(`${p.r},${p.c}`);
  }

  if (!disabled && sel) {
    // Step 2: highlight valid destinations for selected piece
    validMoves = getValidMoves(board, sel.r, sel.c, turn);
    for (const m of validMoves) destSet.add(`${m.toR},${m.toC}`);
  }

  const rows = [];
  for (let r = 0; r < GRID; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < GRID; c++) {
      const customId = `chk_${r}_${c}`;
      const piece = board[r][c];

      // Light square — always disabled decoration
      if (!isDark(r, c)) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(customId)
            .setLabel('ㅤ')  // invisible character
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        );
        continue;
      }

      const key = `${r},${c}`;

      // Selected piece (step 2) — green, clickable to deselect
      if (sel && sel.r === r && sel.c === c) {
        const btn = new ButtonBuilder()
          .setCustomId(customId)
          .setLabel('🟢')
          .setStyle(ButtonStyle.Success)
          .setDisabled(disabled);
        row.addComponents(btn);
        continue;
      }

      // Valid destination (step 2) — green, clickable to move there
      if (destSet.has(key)) {
        const isCapture = validMoves.some(m => m.toR === r && m.toC === c && m.midR !== undefined);
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(isCapture ? '⚔️' : '💠')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
        );
        continue;
      }

      // Movable piece (step 1) — blue, clickable to select
      if (movableSet.has(key)) {
        const emoji = cellEmoji(piece);
        const btn = new ButtonBuilder()
          .setCustomId(customId)
          .setLabel(isKing(piece) ? '👑' : emoji)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled);
        row.addComponents(btn);
        continue;
      }

      // Everything else — disabled, show piece or empty
      if (piece !== EMPTY) {
        const emoji = cellEmoji(piece);
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(isKing(piece) ? '👑' : emoji)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        );
      } else {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(customId)
            .setLabel('ㅤ')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        );
      }
    }
    rows.push(row);
  }
  return rows;
}

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  for (const [msgId, game] of games) {
    if (now - game.lastMove > GAME_TIMEOUT_MS) {
      games.delete(msgId);
    }
  }
  for (const [msgId, ch] of pendingChallenges) {
    if (now - ch.createdAt > GAME_TIMEOUT_MS) {
      pendingChallenges.delete(msgId);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ═════════════════════════════════════════════════════════════════════════════

const cmdCheckers = new SlashCommandBuilder()
  .setName('checkers')
  .setDescription('Challenge someone to Checkers! (5×5 board)')
  .addUserOption(opt =>
    opt.setName('opponent')
      .setDescription('The user you want to play against')
      .setRequired(true),
  );

const cmdCheckersForfeit = new SlashCommandBuilder()
  .setName('checkersforfeit')
  .setDescription('Forfeit your current Checkers game.');

export const checkersCommands = [cmdCheckers, cmdCheckersForfeit];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

export async function handleCheckersInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'checkers')        return await cmdChallenge(interaction);
    if (interaction.commandName === 'checkersforfeit') return await cmdForfeit(interaction);
    return false;
  }

  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id === 'chk_accept' || id === 'chk_decline') return await handleChallengeResponse(interaction);
    if (id.startsWith('chk_'))                        return await handleGridClick(interaction);
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

  for (const g of games.values()) {
    if (g.player1 === challenger.id || g.player2 === challenger.id) {
      await interaction.reply({ content: "You're already in a game! Use `/checkersforfeit` first.", ephemeral: true });
      return true;
    }
    if (g.player1 === opponent.id || g.player2 === opponent.id) {
      await interaction.reply({ content: `${opponent.displayName} is already in a game.`, ephemeral: true });
      return true;
    }
  }

  for (const ch of pendingChallenges.values()) {
    if (ch.challengerId === challenger.id || ch.opponentId === challenger.id) {
      await interaction.reply({ content: 'You already have a pending challenge.', ephemeral: true });
      return true;
    }
    if (ch.challengerId === opponent.id || ch.opponentId === opponent.id) {
      await interaction.reply({ content: `${opponent.displayName} has a pending challenge.`, ephemeral: true });
      return true;
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('chk_accept').setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('chk_decline').setLabel('Decline').setStyle(ButtonStyle.Danger),
  );

  const msg = await interaction.reply({
    content: `♟️ **Checkers Challenge!**\n${challenger} challenges ${opponent} to a game of Checkers!\n\n${opponent}, do you accept?`,
    components: [row],
    fetchReply: true,
  });

  pendingChallenges.set(msg.id, {
    challengerId: challenger.id, challengerName: challenger.displayName,
    opponentId: opponent.id, opponentName: opponent.displayName,
    createdAt: Date.now(),
  });
  return true;
}

async function cmdForfeit(interaction) {
  const userId = interaction.user.id;
  for (const [msgId, game] of games) {
    if (game.player1 === userId || game.player2 === userId) {
      const winnerId   = game.player1 === userId ? game.player2 : game.player1;
      const winnerName = game.player1 === userId ? game.player2Name : game.player1Name;
      const loserName  = game.player1 === userId ? game.player1Name : game.player2Name;

      recordWin(winnerId, winnerName, GAME_KEY);
      recordLoss(userId, loserName, GAME_KEY);
      games.delete(msgId);

      try {
        const boardMsg = await interaction.channel.messages.fetch(msgId);
        game.selectedPiece = null;
        await boardMsg.edit({ embeds: [buildEmbed(game, `🏳️ ${loserName} forfeited! ${winnerName} wins!`)], components: buildGrid(game, true) });
      } catch { /* message gone */ }

      await interaction.reply({ content: `🏳️ **${loserName}** forfeited! **${winnerName}** wins!` });
      return true;
    }
  }
  await interaction.reply({ content: "You're not in a game.", ephemeral: true });
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHALLENGE RESPONSE
// ═════════════════════════════════════════════════════════════════════════════

async function handleChallengeResponse(interaction) {
  const msgId = interaction.message.id;
  const ch    = pendingChallenges.get(msgId);

  if (!ch) { await interaction.reply({ content: 'Challenge expired.', ephemeral: true }); return true; }
  if (interaction.user.id !== ch.opponentId) { await interaction.reply({ content: "Not your challenge!", ephemeral: true }); return true; }

  pendingChallenges.delete(msgId);

  if (interaction.customId === 'chk_decline') {
    await interaction.update({ content: `❌ **${ch.opponentName}** declined.`, components: [] });
    return true;
  }

  const game = {
    board:          createBoard(),
    player1:        ch.challengerId,
    player1Name:    ch.challengerName,
    player2:        ch.opponentId,
    player2Name:    ch.opponentName,
    currentTurn:    P1,
    selectedPiece:  null,
    multiJumpPiece: null,
    lastMove:       Date.now(),
  };

  await interaction.update({
    content:    null,
    embeds:     [buildEmbed(game)],
    components: buildGrid(game),
  });

  games.set(msgId, game);
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GRID CLICK HANDLER — the core interaction
//  Determines context from game state: piece select, deselect, or move.
// ═════════════════════════════════════════════════════════════════════════════

async function handleGridClick(interaction) {
  const msgId = interaction.message.id;
  const game  = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'Game ended or expired.', ephemeral: true });
    return true;
  }

  // Turn enforcement
  const expectedId = game.currentTurn === P1 ? game.player1 : game.player2;
  if (interaction.user.id !== expectedId) {
    if (interaction.user.id !== game.player1 && interaction.user.id !== game.player2) {
      await interaction.reply({ content: "You're not in this game!", ephemeral: true });
      return true;
    }
    await interaction.reply({ content: "It's not your turn!", ephemeral: true });
    return true;
  }

  // Parse cell
  const match = interaction.customId.match(/^chk_(\d)_(\d)$/);
  if (!match) return false;
  const r = parseInt(match[1], 10);
  const c = parseInt(match[2], 10);

  // ── No piece selected → SELECTING a piece ────────────────────────────
  if (!game.selectedPiece) {
    if (ownerOf(game.board[r][c]) !== game.currentTurn) {
      await interaction.deferUpdate();
      return true;
    }
    const moves = getValidMoves(game.board, r, c, game.currentTurn);
    if (moves.length === 0) {
      await interaction.deferUpdate();
      return true;
    }
    game.selectedPiece = { r, c };
    await interaction.update({ embeds: [buildEmbed(game)], components: buildGrid(game) });
    return true;
  }

  // ── Piece is selected ────────────────────────────────────────────────

  const sel = game.selectedPiece;

  // Clicked the SAME piece → deselect (go back)
  if (r === sel.r && c === sel.c) {
    // Don't allow deselect during multi-jump
    if (game.multiJumpPiece) {
      await interaction.deferUpdate();
      return true;
    }
    game.selectedPiece = null;
    await interaction.update({ embeds: [buildEmbed(game)], components: buildGrid(game) });
    return true;
  }

  // Clicked a valid destination → MOVE
  const validMoves = getValidMoves(game.board, sel.r, sel.c, game.currentTurn);
  const target = validMoves.find(m => m.toR === r && m.toC === c);

  if (!target) {
    // Clicked something else — maybe a different piece?
    if (ownerOf(game.board[r][c]) === game.currentTurn && !game.multiJumpPiece) {
      const altMoves = getValidMoves(game.board, r, c, game.currentTurn);
      if (altMoves.length > 0) {
        game.selectedPiece = { r, c };
        await interaction.update({ embeds: [buildEmbed(game)], components: buildGrid(game) });
        return true;
      }
    }
    await interaction.deferUpdate();
    return true;
  }

  // ── Execute the move ──────────────────────────────────────────────────
  const { captured, promoted } = executeMove(game.board, sel.r, sel.c, r, c);
  game.selectedPiece = null;
  game.lastMove      = Date.now();

  // Multi-jump check
  if (captured && !promoted) {
    const further = getCaptureMoves(game.board, r, c);
    if (further.length > 0) {
      game.multiJumpPiece = { r, c };
      game.selectedPiece  = { r, c }; // auto-select for next jump
      await interaction.update({
        embeds:     [buildEmbed(game, `⚔️ Multi-jump! Keep jumping!`)],
        components: buildGrid(game),
      });
      return true;
    }
  }

  game.multiJumpPiece = null;

  // Switch turns
  const prevPlayer = game.currentTurn;
  game.currentTurn = game.currentTurn === P1 ? P2 : P1;

  // Check game over
  if (checkGameOver(game.board, game.currentTurn)) {
    const winnerId   = prevPlayer === P1 ? game.player1 : game.player2;
    const winnerName = prevPlayer === P1 ? game.player1Name : game.player2Name;
    const loserId    = prevPlayer === P1 ? game.player2 : game.player1;
    const loserName  = prevPlayer === P1 ? game.player2Name : game.player1Name;
    const icon       = prevPlayer === P1 ? '🔴' : '🔵';

    recordWin(winnerId, winnerName, GAME_KEY);
    recordLoss(loserId, loserName, GAME_KEY);
    games.delete(msgId);

    await interaction.update({
      embeds:     [buildEmbed(game, `🏆 ${icon} ${winnerName} wins!`)],
      components: buildGrid(game, true),
    });
    return true;
  }

  // Normal next turn
  await interaction.update({
    embeds:     [buildEmbed(game)],
    components: buildGrid(game),
  });
  return true;
}
