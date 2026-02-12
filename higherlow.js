// higherlow.js
// ─────────────────────────────────────────────────────────────────────────────
// Higher or Lower — solo streak-based card game. Guess if next card is higher
// or lower. Cash out to lock in your streak.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { recordWin, recordLoss } from './leaderboard.js';

const GAME_KEY = 'higherlow';

// ═════════════════════════════════════════════════════════════════════════════
//  DECK & CARDS
// ═════════════════════════════════════════════════════════════════════════════

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

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
  return idx + 2; // 2->2, A->14
}

/**
 * Display format: "**A♠**" — bold with suit.
 */
function formatCardDisplay(card) {
  return `**${card.rank}${card.suit}**`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

const GAME_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Keyed by message ID */
const games = new Map();

/** One game per player: userId -> messageId */
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
      console.log(`[HL] Game ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  EMBED & BUTTONS
// ═════════════════════════════════════════════════════════════════════════════

function buildEmbed(game, statusText = null) {
  const cardDisplay = formatCardDisplay(game.currentCard);
  const footer = `🔥 Streak: ${game.streak}`;

  const embed = new EmbedBuilder()
    .setTitle('🃏 Higher or Lower')
    .setDescription(`${cardDisplay}\n\n${statusText || 'Higher or Lower?'}`)
    .setFooter({ text: footer })
    .setColor(0x2E7D32);

  return embed;
}

function buildButtons(game) {
  const canCashOut = game.streak >= 1 && game.phase === 'playing';

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('hl_higher')
        .setLabel('Higher')
        .setEmoji('⬆️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(game.phase !== 'playing'),
      new ButtonBuilder()
        .setCustomId('hl_lower')
        .setLabel('Lower')
        .setEmoji('⬇️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(game.phase !== 'playing'),
      new ButtonBuilder()
        .setCustomId('hl_cashout')
        .setLabel('Cash Out')
        .setEmoji('🏃')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canCashOut),
    );

  return [row];
}

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const slashCommand = new SlashCommandBuilder()
  .setName('higherlow')
  .setDescription('Play Higher or Lower — guess if the next card is higher or lower!');

export const higherlowCommands = [slashCommand];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Handle all Higher or Lower interactions.
 * Returns true if handled, false otherwise.
 */
export async function handleHigherlowInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'higherlow') {
      return await startGame(interaction);
    }
    return false;
  }

  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id === 'hl_higher' || id === 'hl_lower' || id === 'hl_cashout') {
      return await handleButton(interaction);
    }
    return false;
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME LOGIC
// ═════════════════════════════════════════════════════════════════════════════

async function startGame(interaction) {
  const user = interaction.user;
  const existingMsgId = playerActiveGame.get(user.id);

  if (existingMsgId && games.has(existingMsgId)) {
    await interaction.reply({
      content: "You're already in a Higher or Lower game! Finish or wait for it to expire.",
      ephemeral: true,
    });
    return true;
  }

  const deck = shuffle(createDeck());
  const currentCard = deck.pop();

  const game = {
    messageId: null,
    playerId: user.id,
    playerName: user.displayName,
    deck,
    currentCard,
    streak: 0,
    phase: 'playing',
    startedAt: Date.now(),
  };

  const embed = buildEmbed(game);
  const components = buildButtons(game);

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

async function handleButton(interaction) {
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

  if (interaction.customId === 'hl_cashout') {
    return await handleCashOut(interaction, game, msgId);
  }

  if (game.phase !== 'playing') {
    await interaction.reply({ content: "This game is already over.", ephemeral: true });
    return true;
  }

  // Higher or Lower guess
  const guessedHigher = interaction.customId === 'hl_higher';
  const nextCard = game.deck.pop();

  const currentVal = cardValue(game.currentCard);
  const nextVal = cardValue(nextCard);

  // Tie goes to player
  const correct = nextVal > currentVal ? guessedHigher : nextVal < currentVal ? !guessedHigher : true;

  if (correct) {
    game.streak++;
    game.currentCard = nextCard;
    game.startedAt = Date.now();

    // Check if deck is empty — player wins by default
    if (game.deck.length === 0) {
      game.phase = 'over';
      recordWin(game.playerId, game.playerName, GAME_KEY);
      const embed = buildEmbed(
        game,
        `Deck exhausted! You made it through! 🎉\nFinal streak: **${game.streak}**`
      );
      await interaction.update({ embeds: [embed], components: [] });
      playerActiveGame.delete(game.playerId);
      games.delete(msgId);
    } else {
      const embed = buildEmbed(game, `Correct! Next card: Higher or Lower?`);
      const components = buildButtons(game);
      await interaction.update({ embeds: [embed], components });
    }
  } else {
    // Wrong guess — game over
    game.phase = 'over';
    recordLoss(game.playerId, game.playerName, GAME_KEY);
    const embed = buildEmbed(
      game,
      `Wrong! Next card was ${formatCardDisplay(nextCard)}\n\nGame Over. Final streak: **${game.streak}**`
    );
    await interaction.update({ embeds: [embed], components: [] });
    playerActiveGame.delete(game.playerId);
    games.delete(msgId);
  }

  return true;
}

async function handleCashOut(interaction, game, msgId) {
  if (game.phase !== 'playing' || game.streak < 1) {
    await interaction.reply({ content: "You need at least streak 1 to cash out.", ephemeral: true });
    return true;
  }

  game.phase = 'over';
  recordWin(game.playerId, game.playerName, GAME_KEY);

  const embed = buildEmbed(game, `🏃 Cashed out! Final streak: **${game.streak}**`);
  await interaction.update({ embeds: [embed], components: [] });

  playerActiveGame.delete(game.playerId);
  games.delete(msgId);
  return true;
}
