// battleships.js
// ─────────────────────────────────────────────────────────────────────────────
// Battleships — 5×5 grid, 3 ships each, two-player turn-based.
// The 5×5 grid maps perfectly to Discord's 25-button limit.
// Ships are randomly placed. Players fire by clicking grid buttons.
// "View Fleet" button shows your ships privately (ephemeral).
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { recordWin, recordLoss } from './leaderboard.js';

const GAME_KEY = 'battleships';

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const GRID = 5;

const SHIP_DEFS = [
  { name: 'Destroyer',   size: 3, emoji: '🚢' },
  { name: 'Submarine',   size: 2, emoji: '🤿' },
  { name: 'Patrol Boat', size: 2, emoji: '🛥️' },
];

const COL_LABELS = ['A', 'B', 'C', 'D', 'E'];
const ROW_LABELS = ['1', '2', '3', '4', '5'];

const GAME_TIMEOUT_MS = 10 * 60 * 1000;

// Cell states
const WATER = 0;
const SHIP  = 1;

// Shot results
const NOT_FIRED = 0;
const HIT       = 1;
const MISS      = 2;

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

const games             = new Map();
const pendingChallenges = new Map();

// ═════════════════════════════════════════════════════════════════════════════
//  SHIP PLACEMENT (random)
// ═════════════════════════════════════════════════════════════════════════════

function placeShips() {
  const board = Array.from({ length: GRID }, () => Array(GRID).fill(WATER));
  const ships = [];

  for (const def of SHIP_DEFS) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 200) {
      attempts++;
      const horizontal = Math.random() < 0.5;
      const r = Math.floor(Math.random() * GRID);
      const c = Math.floor(Math.random() * GRID);

      const cells = [];
      let fits = true;
      for (let i = 0; i < def.size; i++) {
        const nr = horizontal ? r : r + i;
        const nc = horizontal ? c + i : c;
        if (nr >= GRID || nc >= GRID || board[nr][nc] !== WATER) {
          fits = false;
          break;
        }
        cells.push([nr, nc]);
      }

      if (fits) {
        for (const [nr, nc] of cells) board[nr][nc] = SHIP;
        ships.push({ name: def.name, size: def.size, emoji: def.emoji, cells, hits: 0 });
        placed = true;
      }
    }
  }

  return { board, ships };
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function coordLabel(r, c) {
  return `${COL_LABELS[c]}${ROW_LABELS[r]}`;
}

/** Check if all ships of a player are sunk. */
function allShipsSunk(ships) {
  return ships.every(s => s.hits >= s.size);
}

/** Check if a specific ship is sunk. */
function isShipSunk(ship) {
  return ship.hits >= ship.size;
}

/** Find which ship occupies cell (r, c). */
function findShipAt(ships, r, c) {
  return ships.find(s => s.cells.some(([sr, sc]) => sr === r && sc === c));
}

/** Count total ship cells for a player. */
function totalShipCells(ships) {
  return ships.reduce((sum, s) => sum + s.size, 0);
}

/** Count total hits on a player's ships. */
function totalHits(shots) {
  let count = 0;
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      if (shots[r][c] === HIT) count++;
  return count;
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDERING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Render a radar view (what a player has fired at the opponent).
 * Shows: ⬛ = unknown, 🌊 = miss, 💥 = hit
 */
function renderRadar(shots) {
  let str = '`ㅤ A  B  C  D  E`\n';
  for (let r = 0; r < GRID; r++) {
    str += `\`${ROW_LABELS[r]}\` `;
    for (let c = 0; c < GRID; c++) {
      if (shots[r][c] === HIT)       str += '💥';
      else if (shots[r][c] === MISS) str += '🌊';
      else                           str += '⬛';
    }
    str += '\n';
  }
  return str;
}

/**
 * Render a fleet view (your own board with ships visible).
 * Shows: 🌊 = water, 🟩 = ship (intact), 💥 = ship (hit), ⬜ = miss received
 */
function renderFleet(board, receivedShots) {
  let str = '`ㅤ A  B  C  D  E`\n';
  for (let r = 0; r < GRID; r++) {
    str += `\`${ROW_LABELS[r]}\` `;
    for (let c = 0; c < GRID; c++) {
      const isShip = board[r][c] === SHIP;
      const shot   = receivedShots[r][c];

      if (isShip && shot === HIT) str += '💥';
      else if (isShip)            str += '🟩';
      else if (shot === MISS)     str += '⬜';
      else                        str += '🌊';
    }
    str += '\n';
  }
  return str;
}

/**
 * Build ship status line for a player's fleet.
 * Shows each ship with ✅ (alive) or 💀 (sunk).
 */
function renderShipStatus(ships) {
  return ships.map(s => {
    const sunk = isShipSunk(s);
    const bar  = Array(s.size).fill(null).map((_, i) => i < s.hits ? '💥' : '🟩').join('');
    return `${s.emoji} ${s.name} ${bar} ${sunk ? '💀' : ''}`;
  }).join('\n');
}

function buildEmbed(game, statusText) {
  const turnIcon    = game.currentTurn === 1 ? '🔵' : '🔴';
  const currentName = game.currentTurn === 1 ? game.player1Name : game.player2Name;

  const p1Radar = renderRadar(game.p1Shots);
  const p2Radar = renderRadar(game.p2Shots);

  const p1ShipStatus = renderShipStatus(game.p1Ships);
  const p2ShipStatus = renderShipStatus(game.p2Ships);

  const p1Hits = totalHits(game.p1Shots);
  const p2Hits = totalHits(game.p2Shots);
  const shipCells = totalShipCells(game.p1Ships); // same for both

  const embed = new EmbedBuilder()
    .setTitle('🚢 Battleships')
    .setColor(0x1E3A5F)
    .addFields(
      {
        name: `🔵 ${game.player1Name}'s Radar (${p1Hits}/${shipCells})`,
        value: p1Radar,
        inline: true,
      },
      {
        name: `🔴 ${game.player2Name}'s Radar (${p2Hits}/${shipCells})`,
        value: p2Radar,
        inline: true,
      },
    )
    .addFields(
      {
        name: `🔵 ${game.player1Name}'s Fleet`,
        value: p1ShipStatus,
        inline: true,
      },
      {
        name: `🔴 ${game.player2Name}'s Fleet`,
        value: p2ShipStatus,
        inline: true,
      },
    );

  if (statusText) {
    embed.setFooter({ text: statusText });
  } else {
    embed.setFooter({ text: `${turnIcon} ${currentName}'s turn — fire at the grid!` });
  }

  return embed;
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUTTONS — 5×5 firing grid + View Fleet
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build the 5×5 button grid representing the OPPONENT's board from the
 * current player's perspective. Already-fired cells are disabled.
 */
function buildGrid(game, disabled = false) {
  // Determine which shots array to use (current player's shots at opponent)
  const shots = game.currentTurn === 1 ? game.p1Shots : game.p2Shots;

  const rows = [];
  for (let r = 0; r < GRID; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < GRID; c++) {
      const shot = shots[r][c];
      const label = coordLabel(r, c);
      let btn;

      if (shot === HIT) {
        btn = new ButtonBuilder()
          .setCustomId(`bs_${r}_${c}`)
          .setLabel('💥')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true);
      } else if (shot === MISS) {
        btn = new ButtonBuilder()
          .setCustomId(`bs_${r}_${c}`)
          .setLabel('🌊')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true);
      } else {
        btn = new ButtonBuilder()
          .setCustomId(`bs_${r}_${c}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled);
      }

      row.addComponents(btn);
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Build all components: the 5×5 grid is exactly 5 rows.
 * We can't add a 6th row for "View Fleet", so we'll handle it
 * by making View Fleet an ephemeral slash subcommand or by
 * replacing the grid temporarily. Instead, let's put View Fleet
 * as the label on a disabled info button... No, better approach:
 *
 * We use the embed description to tell players to use the buttons.
 * For "View Fleet", we'll accept that clicking any disabled cell or
 * adding it as a separate interaction isn't ideal.
 *
 * SOLUTION: We put the View Fleet button in the LAST row alongside
 * the last grid row. Last grid row has 5 cells (E1-E5) so we can't.
 *
 * ALTERNATIVE: Make the grid 5×4 (20 buttons, 4 rows) and use the
 * 5th row for View Fleet. But then we lose a row of gameplay.
 *
 * BEST SOLUTION: Use /battleshipsfleet as a separate command.
 * OR: We only need 5 rows for the grid. Discord actually allows
 * 5 action rows. So we use all 5 for the grid. View Fleet will
 * be via a separate slash command.
 *
 * Actually — we CAN'T have View Fleet as a button since we're using
 * all 5 rows. Let's add a /battleshipsfleet command instead.
 */
function buildComponents(game, disabled = false) {
  return buildGrid(game, disabled);
}

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  for (const [msgId, game] of games) {
    if (now - game.lastMove > GAME_TIMEOUT_MS) {
      games.delete(msgId);
      console.log(`[BS] Game ${msgId} expired (timeout).`);
    }
  }
  for (const [msgId, challenge] of pendingChallenges) {
    if (now - challenge.createdAt > GAME_TIMEOUT_MS) {
      pendingChallenges.delete(msgId);
      console.log(`[BS] Challenge ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ═════════════════════════════════════════════════════════════════════════════

const cmdBattleships = new SlashCommandBuilder()
  .setName('battleships')
  .setDescription('Challenge someone to Battleships!')
  .addUserOption(opt =>
    opt.setName('opponent')
      .setDescription('The user you want to play against')
      .setRequired(true),
  );

const cmdFleet = new SlashCommandBuilder()
  .setName('fleet')
  .setDescription('View your fleet privately during a Battleships game.');

export const battleshipsCommands = [cmdBattleships, cmdFleet];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

export async function handleBattleshipsInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'battleships') return await cmdChallenge(interaction);
    if (interaction.commandName === 'fleet')       return await cmdViewFleet(interaction);
    return false;
  }

  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id === 'bs_accept' || id === 'bs_decline') return await handleChallengeResponse(interaction);
    if (id.startsWith('bs_'))                      return await handleFire(interaction);
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
      await interaction.reply({ content: "You're already in a Battleships game!", ephemeral: true });
      return true;
    }
    if (game.player1 === opponent.id || game.player2 === opponent.id) {
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
    new ButtonBuilder()
      .setCustomId('bs_accept')
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('bs_decline')
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );

  const embed = new EmbedBuilder()
    .setTitle('🚢 Battleships Challenge!')
    .setDescription(
      `${challenger} challenges ${opponent} to a game of Battleships!\n\n` +
      `**5×5 grid** • **3 ships each** (Destroyer, Submarine, Patrol Boat)\n` +
      `Ships are placed randomly. Take turns firing at the grid to sink the enemy fleet!\n\n` +
      `Use \`/fleet\` during the game to view your ships privately.\n\n` +
      `${opponent}, do you accept?`,
    )
    .setColor(0x1E3A5F);

  const msg = await interaction.reply({
    embeds: [embed],
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

/** /fleet — view your fleet privately. */
async function cmdViewFleet(interaction) {
  const userId = interaction.user.id;

  for (const game of games.values()) {
    if (game.player1 === userId || game.player2 === userId) {
      const isP1    = game.player1 === userId;
      const board   = isP1 ? game.p1Board : game.p2Board;
      const ships   = isP1 ? game.p1Ships : game.p2Ships;
      const received = isP1 ? game.p2Shots : game.p1Shots;
      // ^ shots the OPPONENT fired at you

      const fleetGrid   = renderFleet(board, received);
      const shipStatus  = renderShipStatus(ships);

      const embed = new EmbedBuilder()
        .setTitle('🚢 Your Fleet')
        .setDescription(
          `${fleetGrid}\n` +
          `🟩 = Ship  |  💥 = Hit  |  ⬜ = Miss  |  🌊 = Water\n\n` +
          `**Ships:**\n${shipStatus}`,
        )
        .setColor(0x1E3A5F)
        .setFooter({ text: 'Only you can see this.' });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return true;
    }
  }

  await interaction.reply({ content: "You're not in a Battleships game.", ephemeral: true });
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

  if (interaction.customId === 'bs_decline') {
    await interaction.update({
      content: `❌ **${challenge.opponentName}** declined the Battleships challenge.`,
      embeds: [],
      components: [],
    });
    return true;
  }

  // ── Accept: generate boards and start ────────────────────────────────
  const p1Setup = placeShips();
  const p2Setup = placeShips();

  const game = {
    player1:     challenge.challengerId,
    player1Name: challenge.challengerName,
    player2:     challenge.opponentId,
    player2Name: challenge.opponentName,

    p1Board: p1Setup.board,
    p1Ships: p1Setup.ships,
    p2Board: p2Setup.board,
    p2Ships: p2Setup.ships,

    // Each player's shots at the OTHER player's board
    p1Shots: Array.from({ length: GRID }, () => Array(GRID).fill(NOT_FIRED)),
    p2Shots: Array.from({ length: GRID }, () => Array(GRID).fill(NOT_FIRED)),

    currentTurn: 1, // 1 = player1, 2 = player2
    lastMove:    Date.now(),
    lastAction:  null, // text describing last shot result
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
//  FIRE HANDLER — player clicks a grid cell
// ═════════════════════════════════════════════════════════════════════════════

async function handleFire(interaction) {
  const msgId = interaction.message.id;
  const game  = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
    return true;
  }

  // Turn enforcement
  const expectedId = game.currentTurn === 1 ? game.player1 : game.player2;
  if (interaction.user.id !== expectedId) {
    if (interaction.user.id !== game.player1 && interaction.user.id !== game.player2) {
      await interaction.reply({ content: "You're not in this game!", ephemeral: true });
      return true;
    }
    await interaction.reply({ content: "It's not your turn!", ephemeral: true });
    return true;
  }

  // Parse target cell
  const match = interaction.customId.match(/^bs_(\d)_(\d)$/);
  if (!match) return false;

  const r = parseInt(match[1], 10);
  const c = parseInt(match[2], 10);

  // Get the current player's shots and opponent's board
  const shots    = game.currentTurn === 1 ? game.p1Shots : game.p2Shots;
  const oppBoard = game.currentTurn === 1 ? game.p2Board : game.p1Board;
  const oppShips = game.currentTurn === 1 ? game.p2Ships : game.p1Ships;

  const shooterName = game.currentTurn === 1 ? game.player1Name : game.player2Name;
  const shooterIcon = game.currentTurn === 1 ? '🔵' : '🔴';

  // Already fired here?
  if (shots[r][c] !== NOT_FIRED) {
    await interaction.reply({ content: "You already fired there!", ephemeral: true });
    return true;
  }

  // ── Fire! ──────────────────────────────────────────────────────────────
  game.lastMove = Date.now();
  const coord = coordLabel(r, c);

  if (oppBoard[r][c] === SHIP) {
    // HIT!
    shots[r][c] = HIT;

    // Find which ship was hit and increment its hit count
    const hitShip = findShipAt(oppShips, r, c);
    if (hitShip) hitShip.hits++;

    const sunk = hitShip && isShipSunk(hitShip);

    if (sunk) {
      game.lastAction = `${shooterIcon} **${shooterName}** fired at **${coord}** — 💥 **HIT!** ${hitShip.emoji} **${hitShip.name} SUNK!**`;
    } else {
      game.lastAction = `${shooterIcon} **${shooterName}** fired at **${coord}** — 💥 **HIT!**`;
    }

    // Check win condition
    if (allShipsSunk(oppShips)) {
      const winnerId   = game.currentTurn === 1 ? game.player1 : game.player2;
      const winnerName = shooterName;
      const loserId    = game.currentTurn === 1 ? game.player2 : game.player1;
      const loserName  = game.currentTurn === 1 ? game.player2Name : game.player1Name;

      recordWin(winnerId, winnerName, GAME_KEY);
      recordLoss(loserId, loserName, GAME_KEY);

      const embed = buildEmbed(game, `🏆 ${shooterIcon} ${winnerName} sinks the entire fleet and wins!`);
      await interaction.update({ embeds: [embed], components: buildComponents(game, true) });
      games.delete(msgId);
      return true;
    }
  } else {
    // MISS
    shots[r][c] = MISS;
    game.lastAction = `${shooterIcon} **${shooterName}** fired at **${coord}** — 🌊 **Miss!**`;
  }

  // ── Switch turns ──────────────────────────────────────────────────────
  game.currentTurn = game.currentTurn === 1 ? 2 : 1;

  const embed      = buildEmbed(game);
  const components = buildComponents(game);

  // Add last action as content above the embed
  await interaction.update({
    content:    game.lastAction,
    embeds:     [embed],
    components,
  });

  return true;
}
