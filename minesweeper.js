// minesweeper.js
// ─────────────────────────────────────────────────────────────────────────────
// Multiplayer Minesweeper Battle — 5×5 grid, 5 mines, alternating turns.
// Hit a mine = you lose. Reveal all safe cells = most reveals wins.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { recordWin, recordLoss, recordDraw } from './leaderboard.js';

const GAME_KEY = 'minesweeper';

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const SIZE = 5;
const MINE_COUNT = 5;
const TOTAL_SAFE = SIZE * SIZE - MINE_COUNT; // 20
const GAME_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const NUM_EMOJIS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
const MINE_EMOJI = '💣';
const HIDDEN_EMOJI = '⬜';

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],          [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1],
];

const THEME_COLOR = 0x334155; // slate/dark

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

// Active games keyed by message ID
const games = new Map();

// Pending challenges keyed by challenge message ID
const pendingChallenges = new Map();

// ═════════════════════════════════════════════════════════════════════════════
//  BOARD GENERATION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Generate a 5×5 grid. grid[r][c] = -1 for mine, 0-8 for adjacent mine count.
 * @param {[number, number] | null} exclude — cell to exclude from mine placement (first-click safety)
 */
function generateBoard(exclude = null) {
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (exclude && r === exclude[0] && c === exclude[1]) continue;
      cells.push([r, c]);
    }
  }

  // Fisher-Yates shuffle, pick first MINE_COUNT
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
 * Build the 5×5 button grid for Discord.
 * @param {object} game — active game state
 * @param {boolean} disabled — disable all buttons (game over)
 * @param {boolean} revealMines — show all mines (game over: someone hit one)
 */
function buildButtonGrid(game, disabled = false, revealMines = false) {
  const rows = [];
  for (let r = 0; r < SIZE; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < SIZE; c++) {
      const isRevealed = game.revealed[r][c];
      const val = game.grid[r][c];
      let label = HIDDEN_EMOJI;
      let style = ButtonStyle.Secondary; // gray for unrevealed
      let btnDisabled = disabled;

      if (isRevealed) {
        // This cell was clicked during play
        if (val === -1) {
          // The cell that was hit (the losing click)
          label = '💥';
          style = ButtonStyle.Danger;
        } else {
          label = NUM_EMOJIS[val];
          style = ButtonStyle.Primary;
        }
        btnDisabled = true; // already revealed cells are always disabled
      } else if (revealMines && val === -1) {
        // Game over — reveal remaining mines
        label = MINE_EMOJI;
        style = ButtonStyle.Danger;
        btnDisabled = true;
      }

      const btn = new ButtonBuilder()
        .setCustomId(`ms_${r}_${c}`)
        .setLabel(label)
        .setStyle(style)
        .setDisabled(btnDisabled);

      row.addComponents(btn);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Build the game embed.
 */
function buildGameEmbed(game, statusOverride = null) {
  const p1Icon = '🔵';
  const p2Icon = '🔴';

  const scoreLine = `${p1Icon} **${game.player1Name}**: ${game.player1Score} cells  |  ${p2Icon} **${game.player2Name}**: ${game.player2Score} cells`;

  let turnLine;
  if (statusOverride) {
    turnLine = statusOverride;
  } else {
    const currentIcon = game.currentTurn === 1 ? p1Icon : p2Icon;
    const currentName = game.currentTurn === 1 ? game.player1Name : game.player2Name;
    turnLine = `${currentIcon} **${currentName}**'s turn — pick a cell!`;
  }

  return new EmbedBuilder()
    .setTitle('💣 Minesweeper Battle')
    .setDescription(`${scoreLine}\n\n${turnLine}`)
    .setColor(THEME_COLOR);
}

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  for (const [msgId, game] of games) {
    if (now - game.lastMove > GAME_TIMEOUT_MS) {
      games.delete(msgId);
      console.log(`[MS] Game ${msgId} expired (timeout).`);
    }
  }
  for (const [msgId, challenge] of pendingChallenges) {
    if (now - challenge.createdAt > GAME_TIMEOUT_MS) {
      pendingChallenges.delete(msgId);
      console.log(`[MS] Challenge ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const cmdMinesweeper = new SlashCommandBuilder()
  .setName('minesweeper')
  .setDescription('Challenge someone to a Minesweeper Battle! 💣')
  .addUserOption(opt =>
    opt.setName('opponent')
      .setDescription('The user you want to play against')
      .setRequired(true),
  );

export const minesweeperCommands = [cmdMinesweeper];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Handle all Minesweeper related interactions.
 * Returns true if handled, false otherwise.
 */
export async function handleMinesweeperInteraction(interaction) {
  // ── Slash commands ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'minesweeper') {
      return await cmdChallenge(interaction);
    }
    return false;
  }

  // ── Button clicks ──────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const id = interaction.customId;

    if (id === 'ms_accept' || id === 'ms_decline') {
      return await handleChallengeResponse(interaction);
    }

    if (id.startsWith('ms_') && /^ms_\d_\d$/.test(id)) {
      return await handleCellClick(interaction);
    }

    return false;
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  COMMAND HANDLER — /minesweeper @opponent
// ═════════════════════════════════════════════════════════════════════════════

async function cmdChallenge(interaction) {
  const challenger = interaction.user;
  const opponent = interaction.options.getUser('opponent');

  if (opponent.id === challenger.id) {
    await interaction.reply({ content: "You can't challenge yourself!", ephemeral: true });
    return true;
  }

  if (opponent.bot) {
    await interaction.reply({ content: "You can't challenge a bot.", ephemeral: true });
    return true;
  }

  // Check if either player is already in a game
  for (const game of games.values()) {
    if (game.player1 === challenger.id || game.player2 === challenger.id) {
      await interaction.reply({ content: "You're already in a Minesweeper game! Finish it first.", ephemeral: true });
      return true;
    }
    if (game.player1 === opponent.id || game.player2 === opponent.id) {
      await interaction.reply({ content: `**${opponent.displayName}** is already in a Minesweeper game.`, ephemeral: true });
      return true;
    }
  }

  // Build challenge message with Accept / Decline buttons
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ms_accept')
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ms_decline')
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );

  const challengeEmbed = new EmbedBuilder()
    .setTitle('💣 Minesweeper Battle')
    .setDescription(
      `${challenger} challenges ${opponent} to a Minesweeper Battle!\n\n` +
      `**Rules:**\n` +
      `• 5×5 grid with 5 hidden mines\n` +
      `• Players alternate turns clicking cells\n` +
      `• Hit a mine = 💥 you lose!\n` +
      `• Reveal all safe cells = most reveals wins\n\n` +
      `${opponent}, do you accept?`
    )
    .setColor(THEME_COLOR);

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

  console.log(`[MS] ${challenger.tag} challenged ${opponent.tag}`);
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHALLENGE RESPONSE — Accept / Decline
// ═════════════════════════════════════════════════════════════════════════════

async function handleChallengeResponse(interaction) {
  const msgId = interaction.message.id;
  const challenge = pendingChallenges.get(msgId);

  if (!challenge) {
    await interaction.reply({ content: 'This challenge has expired.', ephemeral: true });
    return true;
  }

  // Only the challenged opponent can accept/decline
  if (interaction.user.id !== challenge.opponentId) {
    await interaction.reply({ content: "This challenge isn't for you!", ephemeral: true });
    return true;
  }

  pendingChallenges.delete(msgId);

  // ── Decline ────────────────────────────────────────────────────────────
  if (interaction.customId === 'ms_decline') {
    const declineEmbed = new EmbedBuilder()
      .setTitle('💣 Minesweeper Battle')
      .setDescription(`❌ **${challenge.opponentName}** declined the challenge.`)
      .setColor(THEME_COLOR);

    await interaction.update({
      embeds: [declineEmbed],
      components: [],
    });

    console.log(`[MS] ${challenge.opponentName} declined ${challenge.challengerName}'s challenge`);
    return true;
  }

  // ── Accept: start the game ─────────────────────────────────────────────
  const grid = generateBoard(); // initial board; may regenerate on first click
  const revealed = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  // revealedBy[r][c] = 1 or 2 indicating which player revealed it
  const revealedBy = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

  const game = {
    grid,
    revealed,
    revealedBy,
    player1: challenge.challengerId,
    player1Name: challenge.challengerName,
    player2: challenge.opponentId,
    player2Name: challenge.opponentName,
    currentTurn: 1, // 1 = player1, 2 = player2
    player1Score: 0,
    player2Score: 0,
    firstClick: true,
    over: false,
    lastMove: Date.now(),
  };

  const embed = buildGameEmbed(game);
  const buttons = buildButtonGrid(game);

  await interaction.update({
    embeds: [embed],
    components: buttons,
  });

  games.set(msgId, game);

  console.log(`[MS] Game started: ${challenge.challengerName} vs ${challenge.opponentName}`);
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CELL CLICK HANDLER
// ═════════════════════════════════════════════════════════════════════════════

async function handleCellClick(interaction) {
  const msgId = interaction.message.id;
  const game = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
    return true;
  }

  if (game.over) {
    await interaction.reply({ content: 'This game is already over.', ephemeral: true });
    return true;
  }

  // Verify correct player's turn
  const expectedPlayerId = game.currentTurn === 1 ? game.player1 : game.player2;
  if (interaction.user.id !== expectedPlayerId) {
    // Check if they're even a participant
    if (interaction.user.id !== game.player1 && interaction.user.id !== game.player2) {
      await interaction.reply({ content: "You're not in this game!", ephemeral: true });
      return true;
    }
    await interaction.reply({ content: "It's not your turn!", ephemeral: true });
    return true;
  }

  // Parse row and column from customId: ms_r_c
  const match = interaction.customId.match(/^ms_(\d)_(\d)$/);
  if (!match) return false;

  const r = parseInt(match[1], 10);
  const c = parseInt(match[2], 10);

  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false;

  if (game.revealed[r][c]) {
    await interaction.reply({ content: 'That cell is already revealed!', ephemeral: true });
    return true;
  }

  game.lastMove = Date.now();

  // ── First click safety: never a mine ───────────────────────────────────
  if (game.firstClick) {
    game.firstClick = false;
    if (game.grid[r][c] === -1) {
      game.grid = generateBoard([r, c]);
    }
  }

  // ── Clicked a mine: current player LOSES ───────────────────────────────
  if (game.grid[r][c] === -1) {
    game.over = true;
    game.revealed[r][c] = true; // mark the hit cell as revealed

    const loserTurn = game.currentTurn;
    const loserId = loserTurn === 1 ? game.player1 : game.player2;
    const loserName = loserTurn === 1 ? game.player1Name : game.player2Name;
    const winnerId = loserTurn === 1 ? game.player2 : game.player1;
    const winnerName = loserTurn === 1 ? game.player2Name : game.player1Name;
    const loserIcon = loserTurn === 1 ? '🔵' : '🔴';
    const winnerIcon = loserTurn === 1 ? '🔴' : '🔵';

    recordWin(winnerId, winnerName, GAME_KEY);
    recordLoss(loserId, loserName, GAME_KEY);
    games.delete(msgId);

    const statusText =
      `💥 **BOOM!** ${loserIcon} **${loserName}** hit a mine!\n\n` +
      `🏆 ${winnerIcon} **${winnerName}** wins!`;

    const embed = buildGameEmbed(game, statusText);
    const buttons = buildButtonGrid(game, true, true); // disabled + reveal all mines

    await interaction.update({
      embeds: [embed],
      components: buttons,
    });

    console.log(`[MS] ${loserName} hit a mine! ${winnerName} wins.`);
    return true;
  }

  // ── Safe cell: reveal it and award point ───────────────────────────────
  game.revealed[r][c] = true;
  game.revealedBy[r][c] = game.currentTurn;

  if (game.currentTurn === 1) {
    game.player1Score++;
  } else {
    game.player2Score++;
  }

  const totalRevealed = game.player1Score + game.player2Score;

  // ── All safe cells revealed: determine winner by score ─────────────────
  if (totalRevealed >= TOTAL_SAFE) {
    game.over = true;
    games.delete(msgId);

    let statusText;

    if (game.player1Score > game.player2Score) {
      // Player 1 wins
      recordWin(game.player1, game.player1Name, GAME_KEY);
      recordLoss(game.player2, game.player2Name, GAME_KEY);
      statusText =
        `🎉 All safe cells revealed!\n\n` +
        `🏆 🔵 **${game.player1Name}** wins with **${game.player1Score}** cells vs **${game.player2Score}**!`;
    } else if (game.player2Score > game.player1Score) {
      // Player 2 wins
      recordWin(game.player2, game.player2Name, GAME_KEY);
      recordLoss(game.player1, game.player1Name, GAME_KEY);
      statusText =
        `🎉 All safe cells revealed!\n\n` +
        `🏆 🔴 **${game.player2Name}** wins with **${game.player2Score}** cells vs **${game.player1Score}**!`;
    } else {
      // Draw
      recordDraw(game.player1, game.player1Name, GAME_KEY);
      recordDraw(game.player2, game.player2Name, GAME_KEY);
      statusText =
        `🎉 All safe cells revealed!\n\n` +
        `🤝 It's a **draw**! Both players revealed **${game.player1Score}** cells!`;
    }

    const embed = buildGameEmbed(game, statusText);
    const buttons = buildButtonGrid(game, true, true); // disabled + reveal mines

    await interaction.update({
      embeds: [embed],
      components: buttons,
    });

    console.log(`[MS] All safe cells revealed. P1: ${game.player1Score}, P2: ${game.player2Score}`);
    return true;
  }

  // ── Game continues: switch turns ───────────────────────────────────────
  game.currentTurn = game.currentTurn === 1 ? 2 : 1;

  const embed = buildGameEmbed(game);
  const buttons = buildButtonGrid(game);

  await interaction.update({
    embeds: [embed],
    components: buttons,
  });

  return true;
}
