// roulette.js
// ─────────────────────────────────────────────────────────────────────────────
// Russian Roulette Discord game — multiplayer, 6-chamber revolver, turn-based.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { recordWin, recordLoss } from './leaderboard.js';

const GAME_KEY = 'roulette';

const CHAMBERS = 6;
const GAME_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

// Keyed by message ID
const games = new Map();

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  for (const [msgId, game] of games) {
    if (now - game.startedAt > GAME_TIMEOUT_MS) {
      games.delete(msgId);
      console.log(`[RR] Game ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  GAME HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function getRemainingChambers(game) {
  return game.remainingChambers ?? CHAMBERS;
}

function isShot(game) {
  const remaining = getRemainingChambers(game);
  return Math.random() < 1 / remaining;
}

function onSurvived(game) {
  game.remainingChambers = (game.remainingChambers ?? CHAMBERS) - 1;
  if (game.remainingChambers <= 0) {
    game.remainingChambers = CHAMBERS;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  EMBED & BUTTONS
// ═════════════════════════════════════════════════════════════════════════════

function buildEmbed(game) {
  const embed = new EmbedBuilder()
    .setTitle('🔫 Russian Roulette')
    .setColor(0x8B0000);

  if (game.phase === 'lobby') {
    const playerList = game.players.length
      ? game.players.map((p, i) => `${i + 1}. **${p.displayName}**`).join('\n')
      : '_No players yet_';
    embed
      .setDescription(`**Host:** ${game.hostName}\n\n**Players (${game.players.length}/${MAX_PLAYERS}):**\n${playerList}`)
      .setFooter({ text: `Minimum ${MIN_PLAYERS} players needed to start. Host clicks Start when ready.` });
    return embed;
  }

  if (game.phase === 'over') {
    const winner = game.players[0];
    embed
      .setDescription(`🏆 **${winner?.displayName ?? 'Unknown'}** is the last one standing!\n\n*All others have fallen.*`)
      .setFooter({ text: 'Game Over' });
    return embed;
  }

  // phase === 'playing'
  const aliveList = game.players.map((p, i) => {
    const marker = i === game.currentTurnIndex ? '👉 ' : '';
    return `${marker}**${p.displayName}**`;
  }).join('\n');
  const deadList = game.eliminated.length
    ? game.eliminated.map(p => `💀 ${p.displayName}`).join('\n')
    : '_None yet_';

  const remaining = getRemainingChambers(game);
  const chancePercent = remaining > 0 ? ((1 / remaining) * 100).toFixed(1) : 'N/A';

  embed
    .addFields(
      { name: '🔫 Alive', value: aliveList || '_None_', inline: true },
      { name: '💀 Eliminated', value: deadList, inline: true },
      { name: '🎲 Chamber', value: `${remaining}/${CHAMBERS} chambers left\n*~${chancePercent}% chance on next pull*`, inline: true },
    )
    .setFooter({ text: `${game.players[game.currentTurnIndex]?.displayName ?? '?'}'s turn — Pull the trigger!` });

  return embed;
}

function buildLobbyButtons(game) {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('rr_join')
      .setLabel('Join')
      .setEmoji('🔫')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(game.players.length >= MAX_PLAYERS),
    new ButtonBuilder()
      .setCustomId('rr_start')
      .setLabel('Start')
      .setEmoji('🎲')
      .setStyle(ButtonStyle.Success)
      .setDisabled(game.players.length < MIN_PLAYERS),
  );
  return [row];
}

function buildPlayingButtons(game) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('rr_pull')
        .setLabel('Pull Trigger')
        .setEmoji('🔫')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const cmdRoulette = new SlashCommandBuilder()
  .setName('roulette')
  .setDescription('Start a Russian Roulette lobby — players join, host starts when ready!');

export const rouletteCommands = [cmdRoulette];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

export async function handleRouletteInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'roulette') {
      return await cmdRouletteStart(interaction);
    }
    return false;
  }

  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id === 'rr_join' || id === 'rr_start' || id === 'rr_pull') {
      return await handleRouletteButton(interaction);
    }
    return false;
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  COMMAND & BUTTON HANDLERS
// ═════════════════════════════════════════════════════════════════════════════

async function cmdRouletteStart(interaction) {
  const user = interaction.user;

  const game = {
    messageId: null,
    hostId: user.id,
    hostName: user.displayName,
    phase: 'lobby',
    players: [{ id: user.id, displayName: user.displayName }],
    eliminated: [],
    currentTurnIndex: 0,
    remainingChambers: CHAMBERS,
    startedAt: Date.now(),
  };

  const msg = await interaction.reply({
    embeds: [buildEmbed(game)],
    components: buildLobbyButtons(game),
    fetchReply: true,
  });

  game.messageId = msg.id;
  games.set(msg.id, game);

  return true;
}

async function handleRouletteButton(interaction) {
  const msgId = interaction.message.id;
  const game = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
    return true;
  }

  game.startedAt = Date.now();

  if (interaction.customId === 'rr_join') {
    return await handleJoin(interaction, game);
  }
  if (interaction.customId === 'rr_start') {
    return await handleStart(interaction, game);
  }
  if (interaction.customId === 'rr_pull') {
    return await handlePull(interaction, game);
  }

  return false;
}

async function handleJoin(interaction, game) {
  if (game.phase !== 'lobby') {
    await interaction.reply({ content: 'This game has already started!', ephemeral: true });
    return true;
  }

  const user = interaction.user;
  if (game.players.some(p => p.id === user.id)) {
    await interaction.reply({ content: "You're already in the game!", ephemeral: true });
    return true;
  }
  if (game.players.length >= MAX_PLAYERS) {
    await interaction.reply({ content: 'This game is full!', ephemeral: true });
    return true;
  }

  game.players.push({ id: user.id, displayName: user.displayName });

  await interaction.update({
    embeds: [buildEmbed(game)],
    components: buildLobbyButtons(game),
  });
  return true;
}

async function handleStart(interaction, game) {
  if (game.phase !== 'lobby') {
    await interaction.reply({ content: 'This game has already started!', ephemeral: true });
    return true;
  }
  if (interaction.user.id !== game.hostId) {
    await interaction.reply({ content: 'Only the host can start the game!', ephemeral: true });
    return true;
  }
  if (game.players.length < MIN_PLAYERS) {
    await interaction.reply({ content: `Need at least ${MIN_PLAYERS} players to start!`, ephemeral: true });
    return true;
  }

  game.phase = 'playing';
  game.currentTurnIndex = 0;
  game.remainingChambers = CHAMBERS;

  await interaction.update({
    embeds: [buildEmbed(game)],
    components: buildPlayingButtons(game),
  });
  return true;
}

async function handlePull(interaction, game) {
  if (game.phase !== 'playing') {
    await interaction.reply({ content: "This game isn't in progress.", ephemeral: true });
    return true;
  }

  const currentPlayer = game.players[game.currentTurnIndex];
  if (!currentPlayer) {
    await interaction.reply({ content: 'Invalid game state.', ephemeral: true });
    return true;
  }
  if (interaction.user.id !== currentPlayer.id) {
    await interaction.reply({ content: "It's not your turn!", ephemeral: true });
    return true;
  }

  const shot = isShot(game);

  if (shot) {
    // BANG! - player is eliminated
    const eliminated = game.players.splice(game.currentTurnIndex, 1)[0];
    game.eliminated.push(eliminated);
    recordLoss(eliminated.id, eliminated.displayName, GAME_KEY);

    if (game.players.length === 1) {
      // Last player standing wins
      const winner = game.players[0];
      recordWin(winner.id, winner.displayName, GAME_KEY);
      game.phase = 'over';

      await interaction.update({
        content: `💀 **BANG!** ${eliminated.displayName} is dead!\n\n🏆 **${winner.displayName}** is the last one standing — they win!`,
        embeds: [buildEmbed(game)],
        components: [],
      });
      games.delete(game.messageId);
      return true;
    }

    // Normalize turn index after removal
    if (game.currentTurnIndex >= game.players.length) {
      game.currentTurnIndex = 0;
    }
    // Reload revolver after a hit
    game.remainingChambers = CHAMBERS;

    await interaction.update({
      content: `💀 **BANG!** ${eliminated.displayName} is dead!`,
      embeds: [buildEmbed(game)],
      components: buildPlayingButtons(game),
    });
  } else {
    // Click... survived!
    onSurvived(game);

    // Next player's turn
    game.currentTurnIndex = (game.currentTurnIndex + 1) % game.players.length;

    await interaction.update({
      content: `*Click...* **${currentPlayer.displayName}** survived!`,
      embeds: [buildEmbed(game)],
      components: buildPlayingButtons(game),
    });
  }

  return true;
}
