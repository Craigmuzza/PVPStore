// blackjack.js
// ─────────────────────────────────────────────────────────────────────────────
// Blackjack game vs dealer (bot). Standard 52-card deck, Hit/Stand/Double Down.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { recordWin, recordLoss, recordDraw } from './leaderboard.js';

const GAME_KEY = 'blackjack';

// ═════════════════════════════════════════════════════════════════════════════
//  DECK & CARDS
// ═════════════════════════════════════════════════════════════════════════════

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function formatCard(card) {
  return `${card.rank}${card.suit}`;
}

function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  return parseInt(card.rank, 10);
}

/**
 * Best total for a hand (A = 1 or 11).
 */
function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') aces++;
    else total += cardValue(c);
  }
  total += aces * 11;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

/**
 * Check if hand is blackjack (21 with exactly 2 cards).
 */
function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

/**
 * Check if hand is bust (over 21).
 */
function isBust(hand) {
  return handValue(hand) > 21;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

const GAME_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Keyed by the game message ID
const games = new Map();

// Track active player (one game per player)
const playerActiveGame = new Map();

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  for (const [msgId, game] of games) {
    if (now - game.startedAt > GAME_TIMEOUT_MS) {
      playerActiveGame.delete(game.playerId);
      games.delete(msgId);
      console.log(`[BJ] Game ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  EMBED & BUTTONS
// ═════════════════════════════════════════════════════════════════════════════

function buildEmbed(game) {
  const playerHandStr = game.playerHand.map(formatCard).join(' ');
  const playerTotal = handValue(game.playerHand);

  let dealerHandStr;
  let dealerTotalStr;
  if (game.phase === 'playing') {
    dealerHandStr = formatCard(game.dealerHand[0]) + ' ?';
    dealerTotalStr = cardValue(game.dealerHand[0]).toString();
  } else {
    dealerHandStr = game.dealerHand.map(formatCard).join(' ');
    dealerTotalStr = handValue(game.dealerHand).toString();
  }

  let statusText = game.statusText || '';
  if (!statusText && game.phase === 'playing') {
    statusText = `${game.playerName}'s turn — Hit, Stand, or Double Down?`;
  }

  const embed = new EmbedBuilder()
    .setTitle('🃏 Blackjack')
    .addFields(
      {
        name: `👤 ${game.playerName}`,
        value: `${playerHandStr}\n**Total: ${playerTotal}**`,
        inline: true,
      },
      {
        name: '🤖 Dealer',
        value: `${dealerHandStr}\n**Total: ${dealerTotalStr}**`,
        inline: true,
      },
    )
    .setFooter({ text: statusText })
    .setColor(0x1E88E5);

  return embed;
}

function buildButtons(game) {
  const phase = game.phase;
  const canHit = phase === 'playing' && !isBust(game.playerHand);
  const isFirstMove = phase === 'playing' && game.playerHand.length === 2 && game.dealerHand.length === 2;
  const canDouble = isFirstMove && canHit;

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('bj_hit')
        .setLabel('Hit')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!canHit),
      new ButtonBuilder()
        .setCustomId('bj_stand')
        .setLabel('Stand')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canHit),
      new ButtonBuilder()
        .setCustomId('bj_double')
        .setLabel('Double Down')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canDouble),
    );

  return [row];
}

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const cmdBlackjack = new SlashCommandBuilder()
  .setName('blackjack')
  .setDescription('Play Blackjack against the dealer!');

export const blackjackCommands = [cmdBlackjack];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Handle all Blackjack related interactions.
 * Returns true if handled, false otherwise.
 */
export async function handleBlackjackInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'blackjack') {
      return await cmdBlackjackStart(interaction);
    }
    return false;
  }

  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id === 'bj_hit' || id === 'bj_stand' || id === 'bj_double') {
      return await handleBlackjackButton(interaction);
    }
    return false;
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  COMMAND & GAME HANDLERS
// ═════════════════════════════════════════════════════════════════════════════

async function cmdBlackjackStart(interaction) {
  const user = interaction.user;
  const existingMsgId = playerActiveGame.get(user.id);

  if (existingMsgId && games.has(existingMsgId)) {
    await interaction.reply({ content: "You're already in a Blackjack game! Finish or wait for it to expire.", ephemeral: true });
    return true;
  }

  const deck = shuffle(createDeck());
  const playerHand = [deck.pop(), deck.pop()];
  const dealerHand = [deck.pop(), deck.pop()];

  const game = {
    messageId: null,
    playerId: user.id,
    playerName: user.displayName,
    deck,
    playerHand,
    dealerHand,
    phase: 'playing',
    statusText: null,
    doubled: false,
    startedAt: Date.now(),
  };

  // Check for instant blackjack
  if (isBlackjack(playerHand)) {
    const dealerBJ = isBlackjack(dealerHand);
    if (dealerBJ) {
      game.phase = 'over';
      game.statusText = "Both have Blackjack — it's a draw!";
      recordDraw(user.id, user.displayName, GAME_KEY);
    } else {
      game.phase = 'over';
      game.statusText = '🃏 Blackjack! You win!';
      recordWin(user.id, user.displayName, GAME_KEY);
    }
  } else if (isBlackjack(dealerHand)) {
    game.phase = 'over';
    game.statusText = "Dealer has Blackjack. You lose.";
    recordLoss(user.id, user.displayName, GAME_KEY);
  } else if (isBust(playerHand)) {
    game.phase = 'over';
    game.statusText = 'Bust! You lose.';
    recordLoss(user.id, user.displayName, GAME_KEY);
  }

  const embed = buildEmbed(game);
  const components = game.phase === 'over' ? [] : buildButtons(game);

  const msg = await interaction.reply({
    embeds: [embed],
    components,
    fetchReply: true,
  });

  game.messageId = msg.id;
  games.set(msg.id, game);
  playerActiveGame.set(user.id, msg.id);

  return true;
}

async function handleBlackjackButton(interaction) {
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

  if (game.phase !== 'playing') {
    await interaction.reply({ content: "This game is already over.", ephemeral: true });
    return true;
  }

  const action = interaction.customId;

  if (action === 'bj_hit') {
    game.playerHand.push(game.deck.pop());
    if (isBust(game.playerHand)) {
      endGame(game, 'loss');
    } else {
      game.statusText = null;
    }
  } else if (action === 'bj_stand') {
    dealerPlays(game);
    resolveGame(game);
  } else if (action === 'bj_double') {
    game.doubled = true;
    game.playerHand.push(game.deck.pop());
    if (isBust(game.playerHand)) {
      endGame(game, 'loss');
    } else {
      dealerPlays(game);
      resolveGame(game);
    }
  }

  game.startedAt = Date.now();

  const embed = buildEmbed(game);
  const components = game.phase === 'over' ? [] : buildButtons(game);

  await interaction.update({ embeds: [embed], components });

  if (game.phase === 'over') {
    playerActiveGame.delete(game.playerId);
    games.delete(msgId);
  }

  return true;
}

function dealerPlays(game) {
  game.phase = 'dealer';
  while (handValue(game.dealerHand) < 17) {
    game.dealerHand.push(game.deck.pop());
  }
}

function endGame(game, result) {
  game.phase = 'over';
  // When player busts, dealer doesn't play — just reveal their hand
  if (result !== 'loss') {
    dealerPlays(game);
  }
  if (result === 'loss') {
    game.statusText = 'Bust! You lose.';
    recordLoss(game.playerId, game.playerName, GAME_KEY);
  }
}

function resolveGame(game) {
  game.phase = 'over';

  const playerTotal = handValue(game.playerHand);
  const dealerTotal = handValue(game.dealerHand);

  if (isBust(game.dealerHand)) {
    game.statusText = 'Dealer busts! You win!';
    recordWin(game.playerId, game.playerName, GAME_KEY);
    return;
  }

  if (playerTotal > dealerTotal) {
    game.statusText = `You win! ${playerTotal} vs ${dealerTotal}`;
    recordWin(game.playerId, game.playerName, GAME_KEY);
  } else if (playerTotal < dealerTotal) {
    game.statusText = `You lose. ${playerTotal} vs ${dealerTotal}`;
    recordLoss(game.playerId, game.playerName, GAME_KEY);
  } else {
    game.statusText = `Push (draw). ${playerTotal} vs ${dealerTotal}`;
    recordDraw(game.playerId, game.playerName, GAME_KEY);
  }
}
