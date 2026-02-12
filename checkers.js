// checkers.js
// ─────────────────────────────────────────────────────────────────────────────
// Checkers (English Draughts) game playable inside Discord using an emoji
// board rendered in an embed + StringSelectMenus for piece / move selection.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';

import { recordWin, recordLoss } from './leaderboard.js';

const GAME_KEY = 'checkers';

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const BOARD_SIZE = 8;
const EMPTY   = 0;
const P1      = 1;  // Player 1 regular piece
const P2      = 2;  // Player 2 regular piece
const P1_KING = 3;  // Player 1 king
const P2_KING = 4;  // Player 2 king

const EMOJI = {
  [EMPTY]:   '⬛',  // dark square (empty)
  light:     '⬜',  // light square (unused — checkers only on dark)
  [P1]:      '🔴',  // Player 1 piece
  [P2]:      '🟡',  // Player 2 piece
  [P1_KING]: '🔶',  // Player 1 king
  [P2_KING]: '🟠',  // Player 2 king
  selected:  '🟢',  // highlighted / selected square
  target:    '🔵',  // valid move target
};

const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const ROW_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8'];

const GAME_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE  (in-memory, keyed by Discord message ID)
// ═════════════════════════════════════════════════════════════════════════════

const games            = new Map();
const pendingChallenges = new Map();

/**
 * Create the starting 8×8 board.
 * Dark squares are where (row + col) is odd.
 * P1 pieces on rows 0–2, P2 pieces on rows 5–7.
 */
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

/** Row‑directions a piece is allowed to move in. */
function getMoveDirs(piece) {
  if (isKing(piece)) return [1, -1];
  // P1 starts at top (rows 0-2) → moves DOWN;  P2 starts at bottom → moves UP
  return ownerOf(piece) === P1 ? [1] : [-1];
}

/** Simple (non-capturing) moves for the piece at (r, c). */
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

/** Capture (jump) moves for the piece at (r, c). */
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

/** Does any piece belonging to `player` have a capture available? */
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

/**
 * All movable pieces for `player`.
 * If any capture exists the list is restricted to captures only (mandatory).
 */
function getAllValidMoves(board, player) {
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

/** Valid moves for a specific piece (respects mandatory capture). */
function getValidMovesForPiece(board, r, c, player) {
  return playerHasCaptures(board, player)
    ? getCaptureMoves(board, r, c)
    : getSimpleMoves(board, r, c);
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME LOGIC
// ═════════════════════════════════════════════════════════════════════════════

/** Promote a piece if it has reached the far end. Returns true if promoted. */
function promoteIfNeeded(board, r, c) {
  if (board[r][c] === P1 && r === BOARD_SIZE - 1) { board[r][c] = P1_KING; return true; }
  if (board[r][c] === P2 && r === 0)              { board[r][c] = P2_KING; return true; }
  return false;
}

/** Execute a move and return { captured, promoted }. */
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

/** True when `nextPlayer` has lost (no pieces or no valid moves). */
function checkGameOver(board, nextPlayer) {
  if (countPieces(board, nextPlayer) === 0) return true;
  if (getAllValidMoves(board, nextPlayer).length === 0) return true;
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDERING
// ═════════════════════════════════════════════════════════════════════════════

function renderBoard(board, selectedR = -1, selectedC = -1, validTargets = []) {
  const targetSet = new Set(validTargets.map(m => `${m.toR},${m.toC}`));

  // Column header
  let str = '\u2005\u2005\u2005\u2005';
  for (const l of COL_LABELS) str += ` ${l}\u2005`;
  str += '\n';

  for (let r = 0; r < BOARD_SIZE; r++) {
    str += `**${ROW_LABELS[r]}**\u2005`;
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 === 0) {
        str += EMOJI.light;
      } else if (r === selectedR && c === selectedC) {
        str += EMOJI.selected;
      } else if (targetSet.has(`${r},${c}`)) {
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
  const turnIcon    = game.currentTurn === P1 ? '🔴' : '🟡';
  const currentName = game.currentTurn === P1 ? game.player1Name : game.player2Name;

  const validMoves = game.selectedPiece
    ? getValidMovesForPiece(game.board, game.selectedPiece.r, game.selectedPiece.c, game.currentTurn)
    : [];

  const boardStr = renderBoard(
    game.board,
    game.selectedPiece?.r ?? -1,
    game.selectedPiece?.c ?? -1,
    validMoves,
  );

  const p1Count = countPieces(game.board, P1);
  const p2Count = countPieces(game.board, P2);

  return new EmbedBuilder()
    .setTitle('♟️ Checkers')
    .setDescription(
      `**${game.player1Name}** 🔴 (${p1Count}) vs **${game.player2Name}** 🟡 (${p2Count})\n\n${boardStr}`,
    )
    .setFooter({ text: statusText || `${turnIcon} ${currentName}'s turn` })
    .setColor(game.currentTurn === P1 ? 0xDD2E44 : 0xFDCB58);
}

// ═════════════════════════════════════════════════════════════════════════════
//  SELECT MENUS
// ═════════════════════════════════════════════════════════════════════════════

/** Build the "Select piece" menu (step 1). */
function buildPieceSelectMenu(game) {
  const allMoves = game.multiJumpPiece
    ? [{
        r: game.multiJumpPiece.r,
        c: game.multiJumpPiece.c,
        moves: getCaptureMoves(game.board, game.multiJumpPiece.r, game.multiJumpPiece.c),
      }]
    : getAllValidMoves(game.board, game.currentTurn);

  if (allMoves.length === 0) return [];

  const mustCapture = playerHasCaptures(game.board, game.currentTurn);

  const options = allMoves.slice(0, 25).map(pm => {
    const label     = posToLabel(pm.r, pm.c);
    const pieceTag  = isKing(game.board[pm.r][pm.c]) ? ' (King)' : '';
    const captureTag = mustCapture ? '⚔️ ' : '';
    return {
      label:       `${captureTag}${label}${pieceTag}`,
      description: `${pm.moves.length} move${pm.moves.length !== 1 ? 's' : ''} available`,
      value:       `${pm.r}_${pm.c}`,
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('chk_select')
    .setPlaceholder(mustCapture ? '⚔️ Select a piece (capture required!)' : 'Select a piece to move')
    .addOptions(options);

  return [new ActionRowBuilder().addComponents(menu)];
}

/** Build the "Select move" menu (step 2 — after a piece is selected). */
function buildMoveSelectMenu(game) {
  if (!game.selectedPiece) return buildPieceSelectMenu(game);

  const { r, c } = game.selectedPiece;
  const moves = getValidMovesForPiece(game.board, r, c, game.currentTurn);
  if (moves.length === 0) return buildPieceSelectMenu(game);

  const fromLabel = posToLabel(r, c);

  const options = moves.map(m => {
    const toLabel   = posToLabel(m.toR, m.toC);
    const isCapture = m.capturedR !== undefined;
    return {
      label:       isCapture ? `Jump to ${toLabel}` : `Move to ${toLabel}`,
      description: isCapture
        ? `Captures piece at ${posToLabel(m.capturedR, m.capturedC)}`
        : 'Diagonal move',
      value: `${m.toR}_${m.toC}`,
    };
  });

  // Allow deselecting (go back) — but NOT during a mandatory multi-jump
  if (!game.multiJumpPiece) {
    options.push({
      label:       '↩️ Back — choose a different piece',
      description: `Deselect ${fromLabel}`,
      value:       'back',
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId('chk_move')
    .setPlaceholder(`Moving ${fromLabel} — select destination`)
    .addOptions(options);

  return [new ActionRowBuilder().addComponents(menu)];
}

/** Return the correct component rows for the current game state. */
function buildComponents(game, disabled = false) {
  if (disabled) return [];
  if (game.selectedPiece) return buildMoveSelectMenu(game);
  return buildPieceSelectMenu(game);
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

/**
 * Handle all Checkers-related interactions.
 * Returns true if handled, false otherwise.
 */
export async function handleCheckersInteraction(interaction) {
  // ── Slash commands ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'checkers')        return await cmdChallenge(interaction);
    if (interaction.commandName === 'checkersforfeit') return await cmdForfeit(interaction);
    return false;
  }

  // ── Button clicks (accept / decline) ──────────────────────────────────
  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id === 'chk_accept' || id === 'chk_decline') return await handleChallengeResponse(interaction);
    return false;
  }

  // ── Select menu interactions ──────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    const id = interaction.customId;
    if (id === 'chk_select') return await handlePieceSelect(interaction);
    if (id === 'chk_move')   return await handleMoveSelect(interaction);
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
      await interaction.reply({ content: "You're already in a game! Use `/checkersforfeit` to quit it first.", ephemeral: true });
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

  console.log(`[CHK] ${challenger.tag} challenged ${opponent.tag}`);
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

      // Try to update the original board message
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
      console.log(`[CHK] ${loserName} forfeited against ${winnerName}`);
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
    console.log(`[CHK] ${challenge.opponentName} declined ${challenge.challengerName}'s challenge`);
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
    selectedPiece:  null,   // { r, c } when a piece is selected (step 2)
    multiJumpPiece: null,   // { r, c } during a mandatory multi-jump chain
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
  console.log(`[CHK] Game started: ${challenge.challengerName} vs ${challenge.opponentName}`);
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  SELECT MENU HANDLERS
// ═════════════════════════════════════════════════════════════════════════════

/** Step 1 — player picks which piece to move. */
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

  const [r, c] = interaction.values[0].split('_').map(Number);

  if (ownerOf(game.board[r][c]) !== game.currentTurn) {
    await interaction.reply({ content: "That's not your piece!", ephemeral: true });
    return true;
  }

  game.selectedPiece = { r, c };

  const embed      = buildEmbed(game);
  const components = buildComponents(game);

  await interaction.update({ embeds: [embed], components });
  return true;
}

/** Step 2 — player picks where to move the selected piece. */
async function handleMoveSelect(interaction) {
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

  const value = interaction.values[0];

  // ── "Back" — deselect piece ─────────────────────────────────────────
  if (value === 'back') {
    game.selectedPiece = null;
    const embed      = buildEmbed(game);
    const components = buildComponents(game);
    await interaction.update({ embeds: [embed], components });
    return true;
  }

  const [toR, toC]           = value.split('_').map(Number);
  const { r: fromR, c: fromC } = game.selectedPiece;

  // ── Execute the move ────────────────────────────────────────────────
  const { captured, promoted } = executeMove(game.board, fromR, fromC, toR, toC);
  game.lastMove      = Date.now();
  game.selectedPiece = null;

  // ── Multi-jump check ────────────────────────────────────────────────
  // In English draughts a newly-crowned king does NOT continue jumping.
  if (captured && !promoted) {
    const furtherCaptures = getCaptureMoves(game.board, toR, toC);
    if (furtherCaptures.length > 0) {
      game.multiJumpPiece = { r: toR, c: toC };
      game.selectedPiece  = { r: toR, c: toC }; // auto-select for convenience

      const embed      = buildEmbed(game, `⚔️ Multi-jump! Continue jumping with ${posToLabel(toR, toC)}`);
      const components = buildMoveSelectMenu(game);
      await interaction.update({ embeds: [embed], components });
      return true;
    }
  }

  game.multiJumpPiece = null;

  // ── Switch turns ────────────────────────────────────────────────────
  const prevPlayer = game.currentTurn;
  game.currentTurn = game.currentTurn === P1 ? P2 : P1;

  // ── Check for game over ─────────────────────────────────────────────
  if (checkGameOver(game.board, game.currentTurn)) {
    const winnerId   = prevPlayer === P1 ? game.player1 : game.player2;
    const winnerName = prevPlayer === P1 ? game.player1Name : game.player2Name;
    const loserId    = prevPlayer === P1 ? game.player2 : game.player1;
    const loserName  = prevPlayer === P1 ? game.player2Name : game.player1Name;
    const winnerIcon = prevPlayer === P1 ? '🔴' : '🟡';

    recordWin(winnerId, winnerName, GAME_KEY);
    recordLoss(loserId, loserName, GAME_KEY);
    games.delete(msgId);

    const embed = buildEmbed(game, `🏆 ${winnerIcon} ${winnerName} wins!`);
    await interaction.update({ embeds: [embed], components: [] });
    console.log(`[CHK] ${winnerName} won!`);
    return true;
  }

  // ── Normal next turn ────────────────────────────────────────────────
  const embed      = buildEmbed(game);
  const components = buildComponents(game);
  await interaction.update({ embeds: [embed], components });
  return true;
}
