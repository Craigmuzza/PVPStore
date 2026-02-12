import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { recordWin, recordLoss } from './leaderboard.js';

const GAME_KEY = 'hangman';

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
  'planet', 'comet', 'galaxy', 'spaceship', 'astronaut', 'telescope',
  'chocolate', 'sandwich', 'elephant', 'butterfly', 'mountain', 'adventure',
  'treasure', 'journey', 'mystery', 'rainbow', 'thunder', 'crystal', 'diamond',
];

const ASCII_HANGMAN = [
  `\`\`\`
  +---+
  |   |
      |
      |
      |
      |
=========
\`\`\``,
  `\`\`\`
  +---+
  |   |
  O   |
      |
      |
      |
=========
\`\`\``,
  `\`\`\`
  +---+
  |   |
  O   |
  |   |
      |
      |
=========
\`\`\``,
  `\`\`\`
  +---+
  |   |
  O   |
 /|   |
      |
      |
=========
\`\`\``,
  `\`\`\`
  +---+
  |   |
  O   |
 /|\\  |
      |
      |
=========
\`\`\``,
  `\`\`\`
  +---+
  |   |
  O   |
 /|\\  |
 /    |
      |
=========
\`\`\``,
  `\`\`\`
  +---+
  |   |
  O   |
 /|\\  |
 / \\  |
      |
=========
\`\`\``,
];

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const EXPIRY_MS = 5 * 60 * 1000;

/** @type {Map<string, { state: HangmanState; expiry: number }>} */
const games = new Map();

/** @param {string} id */
function getGame(id) {
  const entry = games.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    games.delete(id);
    return null;
  }
  return entry.state;
}

/** @param {string} id @param {HangmanState} state */
function setGame(id, state) {
  games.set(id, { state, expiry: Date.now() + EXPIRY_MS });
}

/** @param {string} id */
function deleteGame(id) {
  games.delete(id);
}

/**
 * @typedef {Object} HangmanState
 * @property {string} word
 * @property {Set<string>} guessed
 * @property {number} wrongCount
 * @property {string} userId
 */

function pickWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

function buildDisplayWord(word, guessed) {
  return word
    .split('')
    .map((c) => (guessed.has(c) ? c : '_'))
    .join(' ');
}

function buildLetterRows(guessed, wrongLetters) {
  const rows = [];
  const rowSizes = [5, 5, 5, 5, 6];
  let idx = 0;
  for (const size of rowSizes) {
    const row = new ActionRowBuilder();
    for (let i = 0; i < size && idx < LETTERS.length; i++, idx++) {
      const letter = LETTERS[idx];
      const isGuessed = guessed.has(letter);
      const style = !isGuessed
        ? ButtonStyle.Secondary
        : wrongLetters.includes(letter)
          ? ButtonStyle.Danger
          : ButtonStyle.Success;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`hm_${letter}`)
          .setLabel(letter.toUpperCase())
          .setStyle(style)
          .setDisabled(isGuessed),
      );
    }
    rows.push(row);
  }
  return rows;
}

/**
 * @param {HangmanState} state
 * @returns {{ embed: EmbedBuilder; components: ActionRowBuilder[] }}
 */
function buildGameMessage(state) {
  const { word, guessed, wrongCount } = state;
  const wrongLetters = [...guessed].filter((l) => !word.includes(l));
  const displayWord = buildDisplayWord(word, guessed);
  const won = [...word].every((c) => guessed.has(c));
  const lost = wrongCount >= 6;

  const embed = new EmbedBuilder()
    .setTitle('Hangman')
    .setColor(lost ? 0xed4245 : won ? 0x57f287 : 0x5865f2)
    .setDescription(ASCII_HANGMAN[Math.min(wrongCount, 6)] + `\n\n**${displayWord}**`)
    .addFields({
      name: 'Guessed',
      value: wrongLetters.length
        ? wrongLetters.join(', ').toUpperCase()
        : '(none)',
      inline: false,
    })
    .setFooter({
      text: lost
        ? `Game Over! The word was: ${word}`
        : won
          ? 'You won!'
          : `${6 - wrongCount} wrong guess(es) left`,
    });

  const components =
    won || lost
      ? []
      : buildLetterRows(guessed, wrongLetters);

  return { embed, components };
}

const hangmanCommand = new SlashCommandBuilder()
  .setName('hangman')
  .setDescription('Start a solo hangman game');

const hangmanCommands = [hangmanCommand];

/**
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
export async function handleHangmanInteraction(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'hangman') {
    const userId = interaction.user.id;
    const existing = Array.from(games.entries()).find(
      ([_, e]) => e.state.userId === userId && Date.now() <= e.expiry,
    );
    if (existing) {
      await interaction.reply({
        content: 'You already have an active hangman game. Use that message to play.',
        ephemeral: true,
      });
      return true;
    }

    const word = pickWord();
    const state = {
      word,
      guessed: new Set(),
      wrongCount: 0,
      userId,
    };

    const { embed, components } = buildGameMessage(state);
    const msg = await interaction.reply({
      embeds: [embed],
      components,
      fetchReply: true,
    });

    setGame(msg.id, state);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith('hm_')) {
    const letter = interaction.customId.slice(3);
    const game = getGame(interaction.message.id);
    if (!game) {
      await interaction.reply({
        content: 'This game has expired or ended.',
        ephemeral: true,
      });
      return true;
    }
    if (game.userId !== interaction.user.id) {
      await interaction.reply({
        content: 'This is not your game.',
        ephemeral: true,
      });
      return true;
    }
    if (game.guessed.has(letter)) {
      await interaction.deferUpdate();
      return true;
    }

    game.guessed.add(letter);
    if (!game.word.includes(letter)) {
      game.wrongCount++;
    }

    const won = [...game.word].every((c) => game.guessed.has(c));
    const lost = game.wrongCount >= 6;

    if (won || lost) {
      deleteGame(interaction.message.id);
      try {
        const { id, displayName } = interaction.user;
        if (won) await recordWin(id, displayName, GAME_KEY);
        else await recordLoss(id, displayName, GAME_KEY);
      } catch (e) {
        console.error('hangman leaderboard error:', e);
      }
    }

    const { embed, components } = buildGameMessage(game);
    await interaction.update({ embeds: [embed], components });
    return true;
  }

  return false;
}
