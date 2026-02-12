// rps.js
// ─────────────────────────────────────────────────────────────────────────────
// Rock Paper Scissors game — challenge someone, pick secretly, reveal result.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { recordWin, recordLoss, recordDraw } from './leaderboard.js';

const GAME_KEY = 'rps';

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const PICKS = {
  rock:     { emoji: '🪨', label: 'Rock' },
  paper:    { emoji: '📄', label: 'Paper' },
  scissors: { emoji: '✂️', label: 'Scissors' },
};

const GAME_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

// Pending challenges: keyed by challenge message ID
const pendingChallenges = new Map();

// Active games (after accept): keyed by game message ID
const games = new Map();

// ═════════════════════════════════════════════════════════════════════════════
//  GAME LOGIC
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Determine winner: 1 = challenger wins, 2 = opponent wins, 0 = draw
 */
function resolveRound(p1Pick, p2Pick) {
  if (p1Pick === p2Pick) return 0;
  if (
    (p1Pick === 'rock' && p2Pick === 'scissors') ||
    (p1Pick === 'paper' && p2Pick === 'rock') ||
    (p1Pick === 'scissors' && p2Pick === 'paper')
  ) {
    return 1;
  }
  return 2;
}

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  for (const [msgId, game] of games) {
    if (now - game.createdAt > GAME_TIMEOUT_MS) {
      games.delete(msgId);
      console.log(`[RPS] Game ${msgId} expired (timeout).`);
    }
  }
  for (const [msgId, challenge] of pendingChallenges) {
    if (now - challenge.createdAt > GAME_TIMEOUT_MS) {
      pendingChallenges.delete(msgId);
      console.log(`[RPS] Challenge ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ═════════════════════════════════════════════════════════════════════════════

const cmdRps = new SlashCommandBuilder()
  .setName('rps')
  .setDescription('Challenge someone to Rock Paper Scissors')
  .addUserOption(opt =>
    opt.setName('opponent')
      .setDescription('The user you want to play against')
      .setRequired(true),
  );

export const rpsCommands = [cmdRps];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Handle all RPS related interactions.
 * Returns true if handled, false otherwise.
 */
export async function handleRpsInteraction(interaction) {
  // ── Slash commands ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'rps') {
      return await cmdChallenge(interaction);
    }
    return false;
  }

  // ── Button clicks ──────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const id = interaction.customId;

    if (id === 'rps_accept' || id === 'rps_decline') {
      return await handleChallengeResponse(interaction);
    }

    if (id === 'rps_rock' || id === 'rps_paper' || id === 'rps_scissors') {
      return await handlePick(interaction);
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

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('rps_accept')
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('rps_decline')
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );

  const challengeEmbed = new EmbedBuilder()
    .setTitle('🎯 Rock Paper Scissors Challenge!')
    .setDescription(`${challenger} challenges ${opponent} to a game!\n\n${opponent}, do you accept?`)
    .setColor(0xE67E22);

  const msg = await interaction.reply({
    embeds: [challengeEmbed],
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

  console.log(`[RPS] ${challenger.tag} challenged ${opponent.tag}`);
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

  if (interaction.customId === 'rps_decline') {
    await interaction.update({
      content: `❌ **${challenge.opponentName}** declined the challenge.`,
      embeds: [],
      components: [],
    });
    console.log(`[RPS] ${challenge.opponentName} declined ${challenge.challengerName}'s challenge`);
    return true;
  }

  // ── Accept: show pick buttons ───────────────────────────────────────────
  const pickRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('rps_rock')
      .setLabel('Rock')
      .setEmoji('🪨')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('rps_paper')
      .setLabel('Paper')
      .setEmoji('📄')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('rps_scissors')
      .setLabel('Scissors')
      .setEmoji('✂️')
      .setStyle(ButtonStyle.Primary),
  );

  const game = {
    challengerId:   challenge.challengerId,
    challengerName: challenge.challengerName,
    opponentId:     challenge.opponentId,
    opponentName:   challenge.opponentName,
    player1Pick:    null,
    player2Pick:    null,
    createdAt:      Date.now(),
  };

  const gameEmbed = new EmbedBuilder()
    .setTitle('🪨📄✂️ Rock Paper Scissors')
    .setDescription(`🔵 **${challenge.challengerName}:** ⏳ Waiting...\n🔴 **${challenge.opponentName}:** ⏳ Waiting...\n\n*Both players, choose your move!*`)
    .setColor(0x3498DB);

  await interaction.update({
    content: null,
    embeds: [gameEmbed],
    components: [pickRow],
  });

  games.set(msgId, game);

  console.log(`[RPS] Game started: ${challenge.challengerName} vs ${challenge.opponentName}`);
  return true;
}

async function handlePick(interaction) {
  const msgId = interaction.message.id;
  const game  = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
    return true;
  }

  const pickMap = {
    rps_rock:     'rock',
    rps_paper:    'paper',
    rps_scissors: 'scissors',
  };
  const pick = pickMap[interaction.customId];
  const { emoji, label } = PICKS[pick];

  const isChallenger = interaction.user.id === game.challengerId;
  const isOpponent   = interaction.user.id === game.opponentId;

  if (!isChallenger && !isOpponent) {
    await interaction.reply({ content: "You're not in this game!", ephemeral: true });
    return true;
  }

  if (isChallenger) {
    if (game.player1Pick !== null) {
      await interaction.reply({ content: "You already picked!", ephemeral: true });
      return true;
    }
    game.player1Pick = pick;
  } else {
    if (game.player2Pick !== null) {
      await interaction.reply({ content: "You already picked!", ephemeral: true });
      return true;
    }
    game.player2Pick = pick;
  }

  // Ephemeral confirmation
  await interaction.reply({ content: `You chose ${emoji} **${label}**!`, ephemeral: true });

  // Check if both have picked — if not, update the status embed
  if (game.player1Pick === null || game.player2Pick === null) {
    const p1Status = game.player1Pick !== null ? '✅ Picked!' : '⏳ Waiting...';
    const p2Status = game.player2Pick !== null ? '✅ Picked!' : '⏳ Waiting...';

    const statusEmbed = new EmbedBuilder()
      .setTitle('🪨📄✂️ Rock Paper Scissors')
      .setDescription(`🔵 **${game.challengerName}:** ${p1Status}\n🔴 **${game.opponentName}:** ${p2Status}\n\n*Both players, choose your move!*`)
      .setColor(0x3498DB);

    await interaction.message.edit({
      embeds: [statusEmbed],
    });

    return true;
  }

  // Both picked — resolve and update original message
  const winner = resolveRound(game.player1Pick, game.player2Pick);
  const p1Emoji = PICKS[game.player1Pick].emoji;
  const p2Emoji = PICKS[game.player2Pick].emoji;

  const pickLine = `${p1Emoji}  **${game.challengerName}**\n⚔️ vs\n${p2Emoji}  **${game.opponentName}**`;

  let resultHeader;
  let resultColor;
  if (winner === 0) {
    resultHeader = '🤝 **Draw!**';
    resultColor = 0x95A5A6;
    recordDraw(game.challengerId, game.challengerName, GAME_KEY);
    recordDraw(game.opponentId, game.opponentName, GAME_KEY);
  } else if (winner === 1) {
    resultHeader = `🏆 **${game.challengerName} wins!**`;
    resultColor = 0xFFD700;
    recordWin(game.challengerId, game.challengerName, GAME_KEY);
    recordLoss(game.opponentId, game.opponentName, GAME_KEY);
  } else {
    resultHeader = `🏆 **${game.opponentName} wins!**`;
    resultColor = 0xFFD700;
    recordWin(game.opponentId, game.opponentName, GAME_KEY);
    recordLoss(game.challengerId, game.challengerName, GAME_KEY);
  }

  const embed = new EmbedBuilder()
    .setTitle('🪨📄✂️ Rock Paper Scissors')
    .setDescription(`${resultHeader}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${pickLine}`)
    .setColor(resultColor)
    .setFooter({ text: 'Game over' });

  await interaction.message.edit({
    content: null,
    embeds: [embed],
    components: [],
  });

  games.delete(msgId);
  console.log(`[RPS] Game ended: ${resultText.split('\n')[0]}`);
  return true;
}
