// hangman.js
// ─────────────────────────────────────────────────────────────────────────────
// Multiplayer Hangman game playable inside Discord with letter buttons.
// Two players take turns guessing letters. Correct guesses earn points and
// grant another turn; wrong guesses advance the gallows and swap turns.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { recordWin, recordLoss, recordDraw } from './leaderboard.js';

const GAME_KEY = 'hangman';

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const WORDS = [
  'apple', 'banana', 'cherry', 'orange', 'grape', 'melon', 'lemon', 'peach',
  'bread', 'water', 'coffee', 'cream', 'sugar', 'honey', 'salad', 'pizza',
  'tiger', 'eagle', 'horse', 'camel', 'mouse', 'zebra', 'snake', 'otter',
  'river', 'ocean', 'cloud', 'storm', 'light', 'earth', 'stone', 'forest',
  'music', 'dance', 'piano', 'violin', 'guitar', 'drums', 'trumpet', 'flute',
  'beach', 'house', 'garden', 'castle', 'tower', 'bridge', 'tunnel', 'valley',
  'brave', 'happy', 'clean', 'quick', 'smart', 'lucky', 'funny', 'bright',
  'robot', 'magic', 'crown', 'sword', 'shield', 'arrow', 'potion', 'scroll',
  'queen', 'knight', 'dragon', 'wizard', 'prince', 'pirate', 'ninja', 'ghost',
  'planet', 'comet', 'galaxy', 'chocolate', 'sandwich', 'elephant', 'butterfly',
  'mountain', 'adventure', 'treasure', 'journey', 'mystery', 'rainbow',
  'thunder', 'crystal', 'diamond',
];

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

const THEME_COLOR = 0x7C3AED; // purple
const WIN_COLOR   = 0x57F287; // green
const LOSE_COLOR  = 0xED4245; // red
const DRAW_COLOR  = 0xFEE75C; // yellow

const MAX_WRONG = 6;

// ═════════════════════════════════════════════════════════════════════════════
//  ASCII HANGMAN ART
// ═════════════════════════════════════════════════════════════════════════════

const ASCII_HANGMAN = [
  // 0 wrong
  '```\n' +
  '  ┌───┐\n' +
  '  │   │\n' +
  '      │\n' +
  '      │\n' +
  '      │\n' +
  '      │\n' +
  '══════╧══\n' +
  '```',
  // 1 wrong — head
  '```\n' +
  '  ┌───┐\n' +
  '  │   │\n' +
  '  O   │\n' +
  '      │\n' +
  '      │\n' +
  '      │\n' +
  '══════╧══\n' +
  '```',
  // 2 wrong — body
  '```\n' +
  '  ┌───┐\n' +
  '  │   │\n' +
  '  O   │\n' +
  '  │   │\n' +
  '      │\n' +
  '      │\n' +
  '══════╧══\n' +
  '```',
  // 3 wrong — left arm
  '```\n' +
  '  ┌───┐\n' +
  '  │   │\n' +
  '  O   │\n' +
  ' /│   │\n' +
  '      │\n' +
  '      │\n' +
  '══════╧══\n' +
  '```',
  // 4 wrong — both arms
  '```\n' +
  '  ┌───┐\n' +
  '  │   │\n' +
  '  O   │\n' +
  ' /│\\  │\n' +
  '      │\n' +
  '      │\n' +
  '══════╧══\n' +
  '```',
  // 5 wrong — left leg
  '```\n' +
  '  ┌───┐\n' +
  '  │   │\n' +
  '  O   │\n' +
  ' /│\\  │\n' +
  ' /    │\n' +
  '      │\n' +
  '══════╧══\n' +
  '```',
  // 6 wrong — full body (dead)
  '```\n' +
  '  ┌───┐\n' +
  '  │   │\n' +
  '  O   │\n' +
  ' /│\\  │\n' +
  ' / \\  │\n' +
  '      │\n' +
  '══════╧══\n' +
  '```',
];

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} HangmanState
 * @property {string}      word
 * @property {Set<string>} guessed
 * @property {number}      wrongCount
 * @property {string}      player1Id
 * @property {string}      player1Name
 * @property {string}      player2Id
 * @property {string}      player2Name
 * @property {1|2}         currentTurn
 * @property {number}      player1Score
 * @property {number}      player2Score
 */

/** Active games keyed by the board message ID */
const games = new Map();

/** Pending challenges keyed by the challenge message ID */
const pendingChallenges = new Map();

// ── helpers ──────────────────────────────────────────────────────────────────

function getGame(messageId) {
  const entry = games.get(messageId);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    games.delete(messageId);
    return null;
  }
  return entry.state;
}

function setGame(messageId, state) {
  games.set(messageId, { state, expiry: Date.now() + EXPIRY_MS });
}

function deleteGame(messageId) {
  games.delete(messageId);
}

function getChallenge(messageId) {
  const entry = pendingChallenges.get(messageId);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    pendingChallenges.delete(messageId);
    return null;
  }
  return entry;
}

function pickWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDERING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build the word display: `_ _ a _ _ e`
 */
function buildDisplayWord(word, guessed) {
  return word
    .split('')
    .map((c) => (guessed.has(c) ? c.toUpperCase() : '\\_'))
    .join('  ');
}

/**
 * Build 5 rows of letter buttons (A-Z = 26 buttons).
 * Correct = green, wrong = red, unguessed = gray.
 * Disabled when already guessed OR when the game is over.
 */
function buildLetterRows(word, guessed, gameOver) {
  const rows = [];
  const rowSizes = [5, 5, 5, 5, 6]; // 5+5+5+5+6 = 26
  let idx = 0;

  for (const size of rowSizes) {
    const row = new ActionRowBuilder();
    for (let i = 0; i < size && idx < LETTERS.length; i++, idx++) {
      const letter = LETTERS[idx];
      const wasGuessed = guessed.has(letter);

      let style = ButtonStyle.Secondary; // gray (unguessed)
      if (wasGuessed) {
        style = word.includes(letter) ? ButtonStyle.Success : ButtonStyle.Danger;
      }

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`hm_${letter}`)
          .setLabel(letter.toUpperCase())
          .setStyle(style)
          .setDisabled(wasGuessed || gameOver),
      );
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Build the full game embed and button components.
 */
function buildGameMessage(state) {
  const {
    word, guessed, wrongCount,
    player1Id, player1Name, player2Id, player2Name,
    currentTurn, player1Score, player2Score,
  } = state;

  const wrongLetters = [...guessed].filter((l) => !word.includes(l));
  const correctLetters = [...guessed].filter((l) => word.includes(l));
  const displayWord = buildDisplayWord(word, guessed);
  const wordComplete = [...word].every((c) => guessed.has(c));
  const hanged = wrongCount >= MAX_WRONG;
  const gameOver = wordComplete || hanged;

  // ── determine winner ────────────────────────────────────────────────────
  let resultText = '';
  let embedColor = THEME_COLOR;

  if (gameOver) {
    if (player1Score > player2Score) {
      resultText = `🏆 **${player1Name}** wins with **${player1Score}** points!`;
      embedColor = WIN_COLOR;
    } else if (player2Score > player1Score) {
      resultText = `🏆 **${player2Name}** wins with **${player2Score}** points!`;
      embedColor = WIN_COLOR;
    } else {
      resultText = `🤝 It's a **draw**! Both players scored **${player1Score}** points.`;
      embedColor = DRAW_COLOR;
    }
    if (hanged && !wordComplete) {
      resultText = `☠️ The hangman is complete!\n${resultText}`;
    }
  }

  // ── build embed ─────────────────────────────────────────────────────────
  const hangmanArt = ASCII_HANGMAN[Math.min(wrongCount, MAX_WRONG)];

  const description = gameOver
    ? `${hangmanArt}\n\n**The word was:** \`${word.toUpperCase()}\`\n\n${resultText}`
    : `${hangmanArt}\n\n> ${displayWord}`;

  const embed = new EmbedBuilder()
    .setTitle('📝 Hangman')
    .setColor(embedColor)
    .setDescription(description);

  // Fields
  embed.addFields(
    {
      name: 'Correct Guesses',
      value: correctLetters.length
        ? correctLetters.map((l) => l.toUpperCase()).join(', ')
        : '*None yet*',
      inline: true,
    },
    {
      name: 'Wrong Guesses',
      value: wrongLetters.length
        ? wrongLetters.map((l) => l.toUpperCase()).join(', ')
        : '*None yet*',
      inline: true,
    },
    {
      name: '\u200b', // spacer
      value: '\u200b',
      inline: true,
    },
    {
      name: 'Scoreboard',
      value: `🔵 **${player1Name}:** ${player1Score} pts  |  🔴 **${player2Name}:** ${player2Score} pts`,
      inline: false,
    },
  );

  // Footer — turn indicator or game over
  if (gameOver) {
    embed.setFooter({ text: `Game over • Word: ${word.toUpperCase()}` });
  } else {
    const turnIcon = currentTurn === 1 ? '🔵' : '🔴';
    const turnName = currentTurn === 1 ? player1Name : player2Name;
    embed.setFooter({ text: `${turnIcon} ${turnName}'s turn — pick a letter!` });
  }

  // Components — letter buttons (empty if game over)
  const components = buildLetterRows(word, guessed, gameOver);

  return { embed, components };
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHALLENGE EMBED
// ═════════════════════════════════════════════════════════════════════════════

function buildChallengeEmbed(challengerName, opponentName) {
  const embed = new EmbedBuilder()
    .setTitle('📝 Hangman — Challenge!')
    .setColor(THEME_COLOR)
    .setDescription(
      `**${challengerName}** has challenged **${opponentName}** to a game of Hangman!\n\n` +
      `${opponentName}, do you accept?`,
    )
    .setFooter({ text: 'Challenge expires in 5 minutes.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('hm_accept')
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('hm_decline')
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );

  return { embed, row };
}

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const hangmanCommand = new SlashCommandBuilder()
  .setName('hangman')
  .setDescription('Challenge someone to a game of multiplayer Hangman!')
  .addUserOption((opt) =>
    opt
      .setName('opponent')
      .setDescription('The player you want to challenge')
      .setRequired(true),
  );

export const hangmanCommands = [hangmanCommand];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
export async function handleHangmanInteraction(interaction) {
  // ── /hangman @opponent ──────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'hangman') {
    const opponent = interaction.options.getUser('opponent');

    if (!opponent) {
      await interaction.reply({ content: 'Please mention an opponent.', ephemeral: true });
      return true;
    }

    if (opponent.id === interaction.user.id) {
      await interaction.reply({ content: 'You can\'t challenge yourself!', ephemeral: true });
      return true;
    }

    if (opponent.bot) {
      await interaction.reply({ content: 'You can\'t challenge a bot!', ephemeral: true });
      return true;
    }

    const { embed, row } = buildChallengeEmbed(
      interaction.user.displayName,
      opponent.displayName,
    );

    const msg = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    pendingChallenges.set(msg.id, {
      challengerId: interaction.user.id,
      challengerName: interaction.user.displayName,
      opponentId: opponent.id,
      opponentName: opponent.displayName,
      expiry: Date.now() + EXPIRY_MS,
    });

    return true;
  }

  // ── Button interactions ─────────────────────────────────────────────────
  if (!interaction.isButton() || !interaction.customId.startsWith('hm_')) {
    return false;
  }

  const customId = interaction.customId;

  // ── Accept / Decline challenge ──────────────────────────────────────────
  if (customId === 'hm_accept' || customId === 'hm_decline') {
    const challenge = getChallenge(interaction.message.id);

    if (!challenge) {
      await interaction.reply({
        content: 'This challenge has expired.',
        ephemeral: true,
      });
      return true;
    }

    // Only the challenged player may respond
    if (interaction.user.id !== challenge.opponentId) {
      await interaction.reply({
        content: 'This challenge isn\'t for you!',
        ephemeral: true,
      });
      return true;
    }

    pendingChallenges.delete(interaction.message.id);

    // ── Decline ───────────────────────────────────────────────────────────
    if (customId === 'hm_decline') {
      const declineEmbed = new EmbedBuilder()
        .setTitle('📝 Hangman — Challenge Declined')
        .setColor(LOSE_COLOR)
        .setDescription(`**${challenge.opponentName}** declined the challenge.`);

      await interaction.update({ embeds: [declineEmbed], components: [] });
      return true;
    }

    // ── Accept → start game ───────────────────────────────────────────────
    const word = pickWord();
    const state = {
      word,
      guessed: new Set(),
      wrongCount: 0,
      player1Id: challenge.challengerId,
      player1Name: challenge.challengerName,
      player2Id: challenge.opponentId,
      player2Name: challenge.opponentName,
      currentTurn: 1, // challenger goes first
      player1Score: 0,
      player2Score: 0,
    };

    const { embed, components } = buildGameMessage(state);

    await interaction.update({ embeds: [embed], components });

    setGame(interaction.message.id, state);
    return true;
  }

  // ── Letter guess (hm_a through hm_z) ───────────────────────────────────
  const letter = customId.slice(3); // e.g. "hm_a" → "a"
  if (letter.length !== 1 || !LETTERS.includes(letter)) {
    return false;
  }

  const game = getGame(interaction.message.id);
  if (!game) {
    await interaction.reply({
      content: 'This game has expired or already ended.',
      ephemeral: true,
    });
    return true;
  }

  // Validate it's the current player's turn
  const currentPlayerId = game.currentTurn === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== currentPlayerId) {
    const whoseTurn = game.currentTurn === 1 ? game.player1Name : game.player2Name;
    await interaction.reply({
      content: `It's **${whoseTurn}**'s turn right now!`,
      ephemeral: true,
    });
    return true;
  }

  // Already guessed (safety check)
  if (game.guessed.has(letter)) {
    await interaction.deferUpdate();
    return true;
  }

  // ── Process the guess ─────────────────────────────────────────────────
  game.guessed.add(letter);

  if (game.word.includes(letter)) {
    // Correct guess — count how many times this letter appears in the word
    const letterCount = game.word.split('').filter((c) => c === letter).length;

    if (game.currentTurn === 1) {
      game.player1Score += letterCount;
    } else {
      game.player2Score += letterCount;
    }
    // Correct guess: player keeps their turn (no switch)
  } else {
    // Wrong guess — advance gallows and switch turns
    game.wrongCount++;
    game.currentTurn = game.currentTurn === 1 ? 2 : 1;
  }

  // ── Check for game over ───────────────────────────────────────────────
  const wordComplete = [...game.word].every((c) => game.guessed.has(c));
  const hanged = game.wrongCount >= MAX_WRONG;
  const gameOver = wordComplete || hanged;

  if (gameOver) {
    deleteGame(interaction.message.id);

    // Record leaderboard
    try {
      if (game.player1Score > game.player2Score) {
        recordWin(game.player1Id, game.player1Name, GAME_KEY);
        recordLoss(game.player2Id, game.player2Name, GAME_KEY);
      } else if (game.player2Score > game.player1Score) {
        recordWin(game.player2Id, game.player2Name, GAME_KEY);
        recordLoss(game.player1Id, game.player1Name, GAME_KEY);
      } else {
        recordDraw(game.player1Id, game.player1Name, GAME_KEY);
        recordDraw(game.player2Id, game.player2Name, GAME_KEY);
      }
    } catch (e) {
      console.error('hangman leaderboard error:', e);
    }
  }

  // ── Update the message ────────────────────────────────────────────────
  const { embed, components } = buildGameMessage(game);
  await interaction.update({ embeds: [embed], components });
  return true;
}
