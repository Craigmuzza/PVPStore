// checkers.js
// ─────────────────────────────────────────────────────────────────────────────
// Checkers (English Draughts) — two-step button interaction:
//   Step 1: Click your piece (chip)    →  board highlights it
//   Step 2: Click where it goes        →  move executes
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

const BOARD_SIZE = 8;
const EMPTY   = 0;
const P1      = 1;   // Player 1 regular piece
const P2      = 2;   // Player 2 regular piece
const P1_KING = 3;   // Player 1 king
const P2_KING = 4;   // Player 2 king

const EMOJI = {
  [EMPTY]:   '⬛',   // dark square (playable, empty)
  light:     '⬜',   // light square (non-playable)
  [P1]:      '🔴',   // Player 1 piece
  [P2]:      '🔵',   // Player 2 piece
  [P1_KING]: '🔶',   // Player 1 king
  [P2_KING]: '🟠',   // Player 2 king
  selected:  '🟢',   // selected piece highlight
  target:    '💠',   // valid move destination
};

const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const ROW_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8'];

const EMBED_COLOR     = 0xD97706;   // warm amber
const GAME_TIMEOUT_MS = 10 * 60 * 1000;

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE  (in-memory, keyed by Discord message ID)
// ═════════════════════════════════════════════════════════════════════════════

const games             = new Map();
const pendingChallenges = new Map();

// ═════════════════════════════════════════════════════════════════════════════
//  BOARD SETUP
// ═════════════════════════════════════════════════════════════════════════════

function createBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(EMPTY),
  );
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 === 1) board[r][c] = P1;
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 === 1) board[r][c] = P2;
    }
  }
  return board;
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
  const owner = ownerOf(piece);
  return owner !== EMPTY && owner !== player;
}

function posToLabel(r, c) {
  return `${COL_LABELS[c]}${ROW_LABELS[r]}`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  MOVE GENERATION
// ═════════════════════════════════════════════════════════════════════════════

function getMoveDirs(piece) {
  if (isKing(piece)) return [1, -1];
  return ownerOf(piece) === P1 ? [1] : [-1];
}

function getSimpleMoves(board, r, c) {
  const piece = board[r][c];
  if (piece === EMPTY) return [];
  const dirs  = getMoveDirs(piece);
  const moves = [];
  for (const dr of dirs) {
    for (const dc of [-1, 1]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === EMPTY) {
        moves.push({ toR: nr, toC: nc });
      }
    }
  }
  return moves;
}

function getCaptureMoves(board, r, c) {
  const piece = board[r][c];
  if (piece === EMPTY) return [];
  const player   = ownerOf(piece);
  const dirs     = getMoveDirs(piece);
  const captures = [];
  for (const dr of dirs) {
    for (const dc of [-1, 1]) {
      const midR  = r + dr;
      const midC  = c + dc;
      const landR = r + dr * 2;
      const landC = c + dc * 2;
      if (
        landR >= 0 && landR < BOARD_SIZE &&
        landC >= 0 && landC < BOARD_SIZE &&
        isOpponent(board[midR][midC], player) &&
        board[landR][landC] === EMPTY
      ) {
        captures.push({ toR: landR, toC: landC, capturedR: midR, capturedC: midC });
      }
    }
  }
  return captures;
}

function playerHasCaptures(board, player) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (ownerOf(board[r][c]) === player && getCaptureMoves(board, r, c).length > 0) {
        return true;
      }
    }
  }
  return false;
}

/** Get all movable pieces for `player`. Returns array of { r, c, moves }. */
function getMovablePieces(board, player) {
  const mustCapture = playerHasCaptures(board, player);
  const result = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (ownerOf(board[r][c]) !== player) continue;
      const moves = mustCapture
        ? getCaptureMoves(board, r, c)
        : getSimpleMoves(board, r, c);
      if (moves.length > 0) result.push({ r, c, moves });
    }
  }
  return result;
}

/** Get valid moves for a specific piece (respects mandatory capture). */
function getValidMovesForPiece(board, r, c, player) {
  return playerHasCaptures(board, player)
    ? getCaptureMoves(board, r, c)
    : getSimpleMoves(board, r, c);
}

/** Does the player have ANY valid moves? */
function hasAnyMoves(board, player) {
  return getMovablePieces(board, player).length > 0;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME LOGIC
// ═════════════════════════════════════════════════════════════════════════════

function promoteIfNeeded(board, r, c) {
  if (board[r][c] === P1 && r === BOARD_SIZE - 1) { board[r][c] = P1_KING; return true; }
  if (board[r][c] === P2 && r === 0)              { board[r][c] = P2_KING; return true; }
  return false;
}

function executeMove(board, fromR, fromC, toR, toC) {
  const piece = board[fromR][fromC];
  board[fromR][fromC] = EMPTY;
  board[toR][toC]     = piece;

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
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (ownerOf(board[r][c]) === player) n++;
  return n;
}

function checkGameOver(board, nextPlayer) {
  if (countPieces(board, nextPlayer) === 0) return true;
  if (!hasAnyMoves(board, nextPlayer)) return true;
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDERING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Render the board with optional highlights.
 * @param {number[][]} board
 * @param {number} selR - selected piece row (-1 if none)
 * @param {number} selC - selected piece col (-1 if none)
 * @param {Array<{toR:number,toC:number}>} targets - valid destination squares
 */
function renderBoard(board, selR = -1, selC = -1, targets = []) {
  const targetSet = new Set(targets.map(t => `${t.toR},${t.toC}`));

  // Column header
  let str = '\u2005\u2005\u2005\u2005';
  for (const l of COL_LABELS) str += ` ${l}\u2005`;
  str += '\n';

  for (let r = 0; r < BOARD_SIZE; r++) {
    str += `**${ROW_LABELS[r]}**\u2005`;
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 === 0) {
        // Light square — not playable
        str += EMOJI.light;
      } else if (r === selR && c === selC) {
        // Selected piece
        str += EMOJI.selected;
      } else if (targetSet.has(`${r},${c}`)) {
        // Valid destination
        str += EMOJI.target;
      } else if (board[r][c] === EMPTY) {
        str += EMOJI[EMPTY];
      } else {
        str += EMOJI[board[r][c]];
      }
    }
    str += '\n';
  }
  return str;
}

function buildEmbed(game, statusText) {
  const p1Count = countPieces(game.board, P1);
  const p2Count = countPieces(game.board, P2);

  const turnIcon    = game.currentTurn === P1 ? '🔴' : '🔵';
  const currentName = game.currentTurn === P1 ? game.player1Name : game.player2Name;

  // If a piece is selected, highlight it and its targets
  const selR = game.selectedPiece?.r ?? -1;
  const selC = game.selectedPiece?.c ?? -1;
  const targets = (selR >= 0)
    ? getValidMovesForPiece(game.board, selR, selC, game.currentTurn)
    : [];

  const boardStr = renderBoard(game.board, selR, selC, targets);

  const mustCapture = playerHasCaptures(game.board, game.currentTurn);
  const captureNote = mustCapture ? '\n⚔️ **Capture available! You must jump.**' : '';

  const pieceLine = `🔴 **${game.player1Name}**: ${p1Count} piece${p1Count !== 1 ? 's' : ''}`
    + `  |  🔵 **${game.player2Name}**: ${p2Count} piece${p2Count !== 1 ? 's' : ''}`;

  let stepHint = '';
  if (!statusText && !game.selectedPiece) {
    stepHint = `\n\n👆 **Step 1:** Click one of your pieces below`;
  } else if (!statusText && game.selectedPiece) {
    const selLabel = posToLabel(selR, selC);
    stepHint = `\n\n🟢 **${selLabel} selected** — **Step 2:** Click where to move it`;
  }

  const description = `${pieceLine}\n\n${boardStr}${captureNote}${stepHint}`;

  const footerText = statusText || `${turnIcon} ${currentName}'s turn`;

  return new EmbedBuilder()
    .setTitle('♟️ Checkers')
    .setDescription(description)
    .setFooter({ text: footerText })
    .setColor(EMBED_COLOR);
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUTTONS — Two-step: Piece select → Destination select
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Step 1: Show buttons for each movable piece.
 * Button label: "🔴 C3" or "⚔ 🔴 C3" (if captures)
 * CustomId: chk_p_{r}_{c}
 */
function buildPieceButtons(game) {
  const pieces = game.multiJumpPiece
    ? [{ r: game.multiJumpPiece.r, c: game.multiJumpPiece.c, moves: getCaptureMoves(game.board, game.multiJumpPiece.r, game.multiJumpPiece.c) }]
    : getMovablePieces(game.board, game.currentTurn);

  if (pieces.length === 0) return [];

  const mustCapture = playerHasCaptures(game.board, game.currentTurn);
  const pieceEmoji = game.currentTurn === P1 ? '🔴' : '🔵';

  const buttons = pieces.slice(0, 25).map(p => {
    const label = posToLabel(p.r, p.c);
    const kingTag = isKing(game.board[p.r][p.c]) ? '👑 ' : '';
    const captureTag = mustCapture ? '⚔ ' : '';
    const movesCount = p.moves.length;

    return new ButtonBuilder()
      .setCustomId(`chk_p_${p.r}_${p.c}`)
      .setLabel(`${captureTag}${kingTag}${label}`)
      .setStyle(mustCapture ? ButtonStyle.Danger : ButtonStyle.Primary);
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

/**
 * Step 2: Show buttons for each valid destination of the selected piece.
 * Button label: "→ D4" or "⚔ → E5"
 * CustomId: chk_d_{toR}_{toC}
 * Plus a "↩ Back" button (unless mid multi-jump).
 */
function buildDestButtons(game) {
  const { r, c } = game.selectedPiece;
  const moves = getValidMovesForPiece(game.board, r, c, game.currentTurn);

  if (moves.length === 0) return buildPieceButtons(game);

  const isCapture = moves[0].capturedR !== undefined;

  const buttons = moves.slice(0, 24).map(m => {
    const toLabel = posToLabel(m.toR, m.toC);
    const captureTag = m.capturedR !== undefined ? '⚔ ' : '';

    return new ButtonBuilder()
      .setCustomId(`chk_d_${m.toR}_${m.toC}`)
      .setLabel(`${captureTag}→ ${toLabel}`)
      .setStyle(m.capturedR !== undefined ? ButtonStyle.Danger : ButtonStyle.Success);
  });

  // Add "Back" button unless we're in a multi-jump chain
  if (!game.multiJumpPiece) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('chk_back')
        .setLabel('↩ Back')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

/** Return the correct components for the current game phase. */
function buildComponents(game) {
  if (game.selectedPiece) return buildDestButtons(game);
  return buildPieceButtons(game);
}

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  for (const [msgId, game] of games) {
    if (now - game.lastMove > GAME_TIMEOUT_MS) {
      games.delete(msgId);
      console.log(`[CHK] Game ${msgId} expired (timeout).`);
    }
  }
  for (const [msgId, challenge] of pendingChallenges) {
    if (now - challenge.createdAt > GAME_TIMEOUT_MS) {
      pendingChallenges.delete(msgId);
      console.log(`[CHK] Challenge ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ═════════════════════════════════════════════════════════════════════════════

const cmdCheckers = new SlashCommandBuilder()
  .setName('checkers')
  .setDescription('Challenge someone to a game of Checkers!')
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
    if (id.startsWith('chk_p_'))                      return await handlePieceSelect(interaction);
    if (id.startsWith('chk_d_'))                      return await handleDestSelect(interaction);
    if (id === 'chk_back')                            return await handleBack(interaction);
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

  for (const game of games.values()) {
    if (game.player1 === challenger.id || game.player2 === challenger.id) {
      await interaction.reply({ content: "You're already in a game! Use `/checkersforfeit` to quit it first.", ephemeral: true });
      return true;
    }
    if (game.player1 === opponent.id || game.player2 === opponent.id) {
      await interaction.reply({ content: `${opponent.displayName} is already in a game.`, ephemeral: true });
      return true;
    }
  }

  for (const challenge of pendingChallenges.values()) {
    if (challenge.challengerId === challenger.id || challenge.opponentId === challenger.id) {
      await interaction.reply({ content: 'You already have a pending challenge.', ephemeral: true });
      return true;
    }
    if (challenge.challengerId === opponent.id || challenge.opponentId === opponent.id) {
      await interaction.reply({ content: `${opponent.displayName} has a pending challenge.`, ephemeral: true });
      return true;
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('chk_accept')
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('chk_decline')
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );

  const msg = await interaction.reply({
    content: `♟️ **Checkers Challenge!**\n${challenger} challenges ${opponent} to a game of Checkers!\n\n${opponent}, do you accept?`,
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
        const channel  = interaction.channel;
        const boardMsg = await channel.messages.fetch(msgId);
        game.selectedPiece = null;
        const embed = buildEmbed(game, `🏳️ ${loserName} forfeited! ${winnerName} wins!`);
        await boardMsg.edit({ embeds: [embed], components: [] });
      } catch {
        // message may have been deleted
      }

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
  const msgId     = interaction.message.id;
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

  if (interaction.customId === 'chk_decline') {
    await interaction.update({
      content:    `❌ **${challenge.opponentName}** declined the challenge.`,
      components: [],
    });
    return true;
  }

  // ── Accept: start the game ────────────────────────────────────────────
  const game = {
    board:          createBoard(),
    player1:        challenge.challengerId,
    player1Name:    challenge.challengerName,
    player2:        challenge.opponentId,
    player2Name:    challenge.opponentName,
    currentTurn:    P1,
    selectedPiece:  null,   // { r, c } — when set, show destination buttons
    multiJumpPiece: null,   // { r, c } — during mandatory multi-jump chain
    lastMove:       Date.now(),
  };

  const embed      = buildEmbed(game);
  const components = buildComponents(game);

  await interaction.update({
    content:    null,
    embeds:     [embed],
    components,
  });

  games.set(msgId, game);
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  STEP 1: PIECE SELECT — player clicks on their piece
// ═════════════════════════════════════════════════════════════════════════════

async function handlePieceSelect(interaction) {
  const msgId = interaction.message.id;
  const game  = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
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

  // Parse piece position
  const parts = interaction.customId.split('_'); // chk, p, r, c
  const r = parseInt(parts[2], 10);
  const c = parseInt(parts[3], 10);

  if (ownerOf(game.board[r][c]) !== game.currentTurn) {
    await interaction.reply({ content: "That's not your piece!", ephemeral: true });
    return true;
  }

  // Set selected piece → show destination buttons + highlighted board
  game.selectedPiece = { r, c };

  const embed      = buildEmbed(game);
  const components = buildComponents(game);

  await interaction.update({ embeds: [embed], components });
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  STEP 2: DESTINATION SELECT — player clicks where to move
// ═════════════════════════════════════════════════════════════════════════════

async function handleDestSelect(interaction) {
  const msgId = interaction.message.id;
  const game  = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
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

  if (!game.selectedPiece) {
    await interaction.reply({ content: 'No piece selected. Click a piece first.', ephemeral: true });
    return true;
  }

  // Parse destination
  const parts = interaction.customId.split('_'); // chk, d, toR, toC
  const toR = parseInt(parts[2], 10);
  const toC = parseInt(parts[3], 10);

  const { r: fromR, c: fromC } = game.selectedPiece;

  // Validate the move
  const validMoves = getValidMovesForPiece(game.board, fromR, fromC, game.currentTurn);
  const targetMove = validMoves.find(m => m.toR === toR && m.toC === toC);

  if (!targetMove) {
    await interaction.reply({ content: 'That move is no longer valid.', ephemeral: true });
    return true;
  }

  // ── Execute the move ──────────────────────────────────────────────────
  const { captured, promoted } = executeMove(game.board, fromR, fromC, toR, toC);
  game.lastMove      = Date.now();
  game.selectedPiece = null;

  // ── Multi-jump check ──────────────────────────────────────────────────
  if (captured && !promoted) {
    const furtherCaptures = getCaptureMoves(game.board, toR, toC);
    if (furtherCaptures.length > 0) {
      game.multiJumpPiece = { r: toR, c: toC };
      // Auto-select the jumping piece for step 2
      game.selectedPiece  = { r: toR, c: toC };

      const jumpLabel  = posToLabel(toR, toC);
      const statusText = `⚔️ Multi-jump! Continue jumping with ${jumpLabel}`;
      const embed      = buildEmbed(game, statusText);
      const components = buildComponents(game);

      await interaction.update({ embeds: [embed], components });
      return true;
    }
  }

  game.multiJumpPiece = null;

  // ── Switch turns ──────────────────────────────────────────────────────
  const prevPlayer = game.currentTurn;
  game.currentTurn = game.currentTurn === P1 ? P2 : P1;

  // ── Check for game over ───────────────────────────────────────────────
  if (checkGameOver(game.board, game.currentTurn)) {
    const winnerId   = prevPlayer === P1 ? game.player1 : game.player2;
    const winnerName = prevPlayer === P1 ? game.player1Name : game.player2Name;
    const loserId    = prevPlayer === P1 ? game.player2 : game.player1;
    const loserName  = prevPlayer === P1 ? game.player2Name : game.player1Name;
    const winnerIcon = prevPlayer === P1 ? '🔴' : '🔵';

    recordWin(winnerId, winnerName, GAME_KEY);
    recordLoss(loserId, loserName, GAME_KEY);
    games.delete(msgId);

    const embed = buildEmbed(game, `🏆 ${winnerIcon} ${winnerName} wins!`);
    await interaction.update({ embeds: [embed], components: [] });
    return true;
  }

  // ── Normal next turn ──────────────────────────────────────────────────
  const embed      = buildEmbed(game);
  const components = buildComponents(game);

  await interaction.update({ embeds: [embed], components });
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  BACK BUTTON — deselect piece, go back to step 1
// ═════════════════════════════════════════════════════════════════════════════

async function handleBack(interaction) {
  const msgId = interaction.message.id;
  const game  = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
    return true;
  }

  const expectedId = game.currentTurn === P1 ? game.player1 : game.player2;
  if (interaction.user.id !== expectedId) {
    if (interaction.user.id !== game.player1 && interaction.user.id !== game.player2) {
      await interaction.reply({ content: "You're not in this game!", ephemeral: true });
      return true;
    }
    await interaction.reply({ content: "It's not your turn!", ephemeral: true });
    return true;
  }

  game.selectedPiece = null;

  const embed      = buildEmbed(game);
  const components = buildComponents(game);

  await interaction.update({ embeds: [embed], components });
  return true;
}
