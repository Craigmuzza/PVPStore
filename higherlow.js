// higherlow.js
// ─────────────────────────────────────────────────────────────────────────────
// Higher or Lower — multiplayer card guessing game. Two players alternate
// turns guessing if the next card from a shared deck is higher or lower.
// Wrong guess = you lose. Survive the longest to win!
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { recordWin, recordLoss, recordDraw } from './leaderboard.js';

const GAME_KEY = 'higherlow';

// ═════════════════════════════════════════════════════════════════════════════
//  DECK & CARDS
// ═════════════════════════════════════════════════════════════════════════════

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const EMERALD = 0x059669;

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

/**
 * Numeric value for comparison. 2=2 ... 10=10, J=11, Q=12, K=13, A=14.
 */
function cardValue(card) {
  const idx = RANKS.indexOf(card.rank);
  return idx + 2;
}

/**
 * Display format: "A♠" (plain) or "**A♠**" (bold).
 */
function formatCard(card, bold = false) {
  const str = `${card.rank}${card.suit}`;
  return bold ? `**${str}**` : str;
}

/**
 * Suit-colored display — red suits get red, black stay default.
 */
function suitColor(card) {
  return (card.suit === '♥' || card.suit === '♦') ? '🔴' : '⚫';
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

const GAME_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Active games — keyed by message ID */
const games = new Map();

/** Pending challenges — keyed by challenge message ID */
const pendingChallenges = new Map();

/** One active game per player — userId → messageId */
const playerActiveGame = new Map();

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();

  // Clean up expired challenges
  for (const [msgId, challenge] of pendingChallenges) {
    if (now - challenge.createdAt > GAME_TIMEOUT_MS) {
      pendingChallenges.delete(msgId);
      console.log(`[HL] Challenge ${msgId} expired (timeout).`);
    }
  }

  // Clean up expired games
  for (const [msgId, game] of games) {
    if (now - game.lastActivity > GAME_TIMEOUT_MS) {
      playerActiveGame.delete(game.player1.id);
      playerActiveGame.delete(game.player2.id);
      games.delete(msgId);
      console.log(`[HL] Game ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  CARD HISTORY TRAIL
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build the card trail string: "2♥ → 7♦ → K♠ → ?"
 * Shows the last few cards plus the current one, ending with "→ ?"
 */
function buildCardTrail(game, maxShow = 8) {
  const history = game.cardHistory;
  const cards = history.length > maxShow
    ? history.slice(history.length - maxShow)
    : [...history];

  const trail = cards.map(c => formatCard(c)).join(' → ');
  const prefix = history.length > maxShow ? '… → ' : '';
  return `${prefix}${trail} → **?**`;
}

/**
 * Build the card trail after a reveal: "2♥ → 7♦ → K♠ → **A♣**"
 */
function buildCardTrailRevealed(game, revealedCard, maxShow = 8) {
  const history = game.cardHistory;
  const cards = history.length > maxShow
    ? history.slice(history.length - maxShow)
    : [...history];

  const trail = cards.map(c => formatCard(c)).join(' → ');
  const prefix = history.length > maxShow ? '… → ' : '';
  return `${prefix}${trail} → ${formatCard(revealedCard, true)}`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  EMBEDS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build the challenge embed shown when a player issues /higherlow @opponent.
 */
function buildChallengeEmbed(challenger, opponent) {
  return new EmbedBuilder()
    .setTitle('🃏 Higher or Lower — Challenge!')
    .setDescription(
      `**${challenger.displayName}** has challenged **${opponent.displayName}** to a game of Higher or Lower!\n\n` +
      `Players alternate turns guessing if the next card from a shared deck is **Higher** or **Lower**.\n` +
      `Wrong guess = **you lose!** Ties (same value) count as correct.\n\n` +
      `${opponent}, do you accept?`
    )
    .setColor(EMERALD)
    .setFooter({ text: 'Challenge expires in 5 minutes' });
}

/**
 * Build the main game embed during play.
 */
function buildGameEmbed(game, statusLines = []) {
  const currentCard = formatCard(game.currentCard, true);
  const currentPlayer = game.currentTurn === 1 ? game.player1 : game.player2;
  const turnIcon = game.currentTurn === 1 ? '🔵' : '🔴';
  const trail = buildCardTrail(game);

  const p1Score = `🔵 ${game.player1.name}: **${game.player1.correct}** correct`;
  const p2Score = `🔴 ${game.player2.name}: **${game.player2.correct}** correct`;

  const cardsLeft = game.deck.length;

  let description = '';
  description += `### Current Card: ${currentCard}\n\n`;
  description += `${trail}\n\n`;
  description += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  description += `${p1Score}\n`;
  description += `${p2Score}\n`;
  description += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (statusLines.length > 0) {
    description += statusLines.join('\n') + '\n\n';
  }

  description += `${turnIcon} **${currentPlayer.name}**'s turn — Higher or Lower?`;

  return new EmbedBuilder()
    .setTitle('🃏 Higher or Lower')
    .setDescription(description)
    .setColor(EMERALD)
    .setFooter({ text: `Cards remaining: ${cardsLeft} | 5 min timeout` });
}

/**
 * Build the reveal embed (shown briefly when a guess is made).
 */
function buildRevealEmbed(game, revealedCard, guesser, guessedHigher, correct) {
  const revealStr = formatCard(revealedCard, true);
  const prevCard = formatCard(game.previousCard, true);
  const trail = buildCardTrailRevealed(game, revealedCard);
  const icon = correct ? '✅' : '❌';
  const guessDir = guessedHigher ? 'Higher' : 'Lower';
  const turnIcon = game.currentTurn === 1 ? '🔵' : '🔴';

  const p1Score = `🔵 ${game.player1.name}: **${game.player1.correct}** correct`;
  const p2Score = `🔴 ${game.player2.name}: **${game.player2.correct}** correct`;

  let description = '';
  description += `### ${prevCard} → ${revealStr}  ${icon}\n\n`;
  description += `${trail}\n\n`;
  description += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  description += `${p1Score}\n`;
  description += `${p2Score}\n`;
  description += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (correct) {
    description += `${icon} **${guesser.name}** guessed **${guessDir}** — Correct! Survived!\n\n`;
    const nextPlayer = game.currentTurn === 1 ? game.player1 : game.player2;
    const nextIcon = game.currentTurn === 1 ? '🔵' : '🔴';
    description += `${nextIcon} **${nextPlayer.name}**'s turn — Higher or Lower?`;
  } else {
    description += `${icon} **${guesser.name}** guessed **${guessDir}** — **WRONG!**\n`;
    description += `The card was ${revealStr}!`;
  }

  return new EmbedBuilder()
    .setTitle('🃏 Higher or Lower')
    .setDescription(description)
    .setColor(EMERALD)
    .setFooter({ text: `Cards remaining: ${game.deck.length} | 5 min timeout` });
}

/**
 * Build the game-over embed.
 */
function buildGameOverEmbed(game, winner, loser, reason) {
  const trail = game.cardHistory.map(c => formatCard(c)).join(' → ');
  const displayTrail = trail.length > 900 ? '… ' + game.cardHistory.slice(-10).map(c => formatCard(c)).join(' → ') : trail;

  const p1Score = `🔵 ${game.player1.name}: **${game.player1.correct}** correct`;
  const p2Score = `🔴 ${game.player2.name}: **${game.player2.correct}** correct`;

  let description = '';
  description += `### Game Over!\n\n`;
  description += `${displayTrail}\n\n`;
  description += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  description += `${p1Score}\n`;
  description += `${p2Score}\n`;
  description += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (winner && loser) {
    description += `🏆 **${winner.name}** wins! ${reason}\n`;
    description += `💀 **${loser.name}** has been defeated.`;
  } else {
    // Draw (deck exhausted with equal scores)
    description += `🤝 **It's a draw!** ${reason}`;
  }

  return new EmbedBuilder()
    .setTitle('🃏 Higher or Lower')
    .setDescription(description)
    .setColor(EMERALD)
    .setFooter({ text: 'Game complete — start a new one with /higherlow' });
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUTTONS
// ═════════════════════════════════════════════════════════════════════════════

function buildChallengeButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('hl_accept')
        .setLabel('Accept')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('hl_decline')
        .setLabel('Decline')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildGameButtons(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('hl_higher')
        .setLabel('Higher')
        .setEmoji('⬆️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('hl_lower')
        .setLabel('Lower')
        .setEmoji('⬇️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
    ),
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const slashCommand = new SlashCommandBuilder()
  .setName('higherlow')
  .setDescription('Challenge someone to a game of Higher or Lower!')
  .addUserOption(option =>
    option
      .setName('opponent')
      .setDescription('The player to challenge')
      .setRequired(true)
  );

export const higherlowCommands = [slashCommand];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Handle all Higher or Lower interactions.
 * Returns true if handled, false otherwise.
 */
export async function handleHigherlowInteraction(interaction) {
  // ── Slash command ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'higherlow') {
      return await startChallenge(interaction);
    }
    return false;
  }

  // ── Button presses ────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id === 'hl_accept' || id === 'hl_decline') {
      return await handleChallengeResponse(interaction);
    }
    if (id === 'hl_higher' || id === 'hl_lower') {
      return await handleGuess(interaction);
    }
    return false;
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHALLENGE FLOW
// ═════════════════════════════════════════════════════════════════════════════

async function startChallenge(interaction) {
  const challenger = interaction.user;
  const opponent = interaction.options.getUser('opponent');

  // ── Validation ─────────────────────────────────────────────────────────
  if (!opponent) {
    await interaction.reply({ content: 'You must mention an opponent!', ephemeral: true });
    return true;
  }

  if (opponent.id === challenger.id) {
    await interaction.reply({ content: "You can't challenge yourself!", ephemeral: true });
    return true;
  }

  if (opponent.bot) {
    await interaction.reply({ content: "You can't challenge a bot!", ephemeral: true });
    return true;
  }

  // Check if either player is already in a game
  const challMsgId = playerActiveGame.get(challenger.id);
  if (challMsgId && games.has(challMsgId)) {
    await interaction.reply({
      content: "You're already in a Higher or Lower game! Finish it first.",
      ephemeral: true,
    });
    return true;
  }

  const oppMsgId = playerActiveGame.get(opponent.id);
  if (oppMsgId && games.has(oppMsgId)) {
    await interaction.reply({
      content: `**${opponent.displayName}** is already in a game! Wait for them to finish.`,
      ephemeral: true,
    });
    return true;
  }

  // ── Send challenge ────────────────────────────────────────────────────
  const embed = buildChallengeEmbed(challenger, opponent);
  const components = buildChallengeButtons();

  const msg = await interaction.reply({
    content: `${opponent}`,
    embeds: [embed],
    components,
    fetchReply: true,
  });

  pendingChallenges.set(msg.id, {
    challengerId: challenger.id,
    challengerName: challenger.displayName,
    opponentId: opponent.id,
    opponentName: opponent.displayName,
    createdAt: Date.now(),
  });

  return true;
}

async function handleChallengeResponse(interaction) {
  const msgId = interaction.message.id;
  const challenge = pendingChallenges.get(msgId);

  if (!challenge) {
    await interaction.reply({ content: 'This challenge has expired or already been answered.', ephemeral: true });
    return true;
  }

  // Only the challenged opponent can accept/decline
  if (interaction.user.id !== challenge.opponentId) {
    await interaction.reply({ content: "This challenge isn't for you!", ephemeral: true });
    return true;
  }

  pendingChallenges.delete(msgId);

  // ── Declined ──────────────────────────────────────────────────────────
  if (interaction.customId === 'hl_decline') {
    const embed = new EmbedBuilder()
      .setTitle('🃏 Higher or Lower — Declined')
      .setDescription(`**${challenge.opponentName}** declined the challenge.`)
      .setColor(0x6B7280);

    await interaction.update({ embeds: [embed], components: [] });
    return true;
  }

  // ── Accepted — start game ─────────────────────────────────────────────
  // Double-check neither player started another game in the meantime
  const challBusy = playerActiveGame.get(challenge.challengerId);
  const oppBusy = playerActiveGame.get(challenge.opponentId);
  if ((challBusy && games.has(challBusy)) || (oppBusy && games.has(oppBusy))) {
    const embed = new EmbedBuilder()
      .setTitle('🃏 Higher or Lower — Cancelled')
      .setDescription('One of the players is already in another game.')
      .setColor(0x6B7280);
    await interaction.update({ embeds: [embed], components: [] });
    return true;
  }

  // Build deck and draw first card
  const deck = shuffle(createDeck());
  const firstCard = deck.pop();

  const game = {
    messageId: msgId,
    player1: {
      id: challenge.challengerId,
      name: challenge.challengerName,
      correct: 0,
    },
    player2: {
      id: challenge.opponentId,
      name: challenge.opponentName,
      correct: 0,
    },
    deck,
    currentCard: firstCard,
    previousCard: null,
    cardHistory: [firstCard],
    currentTurn: 1, // 1 = player1, 2 = player2
    phase: 'playing',
    lastActivity: Date.now(),
  };

  games.set(msgId, game);
  playerActiveGame.set(game.player1.id, msgId);
  playerActiveGame.set(game.player2.id, msgId);

  const embed = buildGameEmbed(game);
  const components = buildGameButtons();

  await interaction.update({ embeds: [embed], components });
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GUESS LOGIC
// ═════════════════════════════════════════════════════════════════════════════

async function handleGuess(interaction) {
  const msgId = interaction.message.id;
  const game = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
    return true;
  }

  if (game.phase !== 'playing') {
    await interaction.reply({ content: 'This game is already over.', ephemeral: true });
    return true;
  }

  // Verify it's the correct player's turn
  const currentPlayer = game.currentTurn === 1 ? game.player1 : game.player2;
  if (interaction.user.id !== currentPlayer.id) {
    const otherPlayer = game.currentTurn === 1 ? game.player1 : game.player2;
    await interaction.reply({
      content: `It's **${currentPlayer.name}**'s turn, not yours!`,
      ephemeral: true,
    });
    return true;
  }

  // ── Draw the next card ────────────────────────────────────────────────
  const guessedHigher = interaction.customId === 'hl_higher';
  const nextCard = game.deck.pop();

  const currentVal = cardValue(game.currentCard);
  const nextVal = cardValue(nextCard);

  // Tie (same value) counts as correct — you survive
  const correct = nextVal === currentVal
    ? true
    : guessedHigher
      ? nextVal > currentVal
      : nextVal < currentVal;

  // Save previous card for reveal display
  game.previousCard = game.currentCard;

  const guesser = currentPlayer;

  if (correct) {
    // ── Correct guess — survive ───────────────────────────────────────
    guesser.correct++;
    game.currentCard = nextCard;
    game.cardHistory.push(nextCard);
    game.lastActivity = Date.now();

    // Switch turns: 1 → 2, 2 → 1
    game.currentTurn = game.currentTurn === 1 ? 2 : 1;

    // Check if deck is exhausted
    if (game.deck.length === 0) {
      return await handleDeckExhausted(interaction, game, msgId);
    }

    // Continue playing
    const embed = buildRevealEmbed(game, nextCard, guesser, guessedHigher, true);
    const components = buildGameButtons();
    await interaction.update({ embeds: [embed], components });
  } else {
    // ── Wrong guess — guesser loses ─────────────────────────────────
    game.cardHistory.push(nextCard);
    game.phase = 'over';

    const winner = game.currentTurn === 1 ? game.player2 : game.player1;
    const loser = guesser;

    // Record leaderboard
    recordWin(winner.id, winner.name, GAME_KEY);
    recordLoss(loser.id, loser.name, GAME_KEY);

    const guessDir = guessedHigher ? 'Higher' : 'Lower';
    const reason = `**${loser.name}** guessed **${guessDir}** but the card was ${formatCard(nextCard, true)}!`;

    const embed = buildGameOverEmbed(game, winner, loser, reason);
    await interaction.update({ embeds: [embed], components: [] });

    // Cleanup
    playerActiveGame.delete(game.player1.id);
    playerActiveGame.delete(game.player2.id);
    games.delete(msgId);
  }

  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  DECK EXHAUSTED
// ═════════════════════════════════════════════════════════════════════════════

async function handleDeckExhausted(interaction, game, msgId) {
  game.phase = 'over';

  const p1 = game.player1;
  const p2 = game.player2;

  let winner = null;
  let loser = null;
  let reason = '';

  if (p1.correct > p2.correct) {
    winner = p1;
    loser = p2;
    reason = `Deck exhausted! **${p1.name}** had more correct guesses (${p1.correct} vs ${p2.correct}).`;
    recordWin(winner.id, winner.name, GAME_KEY);
    recordLoss(loser.id, loser.name, GAME_KEY);
  } else if (p2.correct > p1.correct) {
    winner = p2;
    loser = p1;
    reason = `Deck exhausted! **${p2.name}** had more correct guesses (${p2.correct} vs ${p1.correct}).`;
    recordWin(winner.id, winner.name, GAME_KEY);
    recordLoss(loser.id, loser.name, GAME_KEY);
  } else {
    // True draw
    reason = `Deck exhausted! Both players had **${p1.correct}** correct guesses. It's a tie!`;
    recordDraw(p1.id, p1.name, GAME_KEY);
    recordDraw(p2.id, p2.name, GAME_KEY);
  }

  const embed = buildGameOverEmbed(game, winner, loser, reason);
  await interaction.update({ embeds: [embed], components: [] });

  // Cleanup
  playerActiveGame.delete(game.player1.id);
  playerActiveGame.delete(game.player2.id);
  games.delete(msgId);

  return true;
}
