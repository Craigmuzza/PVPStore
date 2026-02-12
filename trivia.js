// trivia.js
// ─────────────────────────────────────────────────────────────────────────────
// Discord bot trivia game module — 50+ questions, 4 multiple-choice, leaderboard.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { recordWin, recordLoss } from './leaderboard.js';

const GAME_KEY = 'trivia';

// ─────────────────────────────────────────────────────────────────────────────
//  TRIVIA QUESTIONS: { question, answers: [4 strings], correctIndex: 0–3 }
// ─────────────────────────────────────────────────────────────────────────────

const QUESTIONS = [
  // Gaming
  { question: 'In what year was the first Nintendo Entertainment System released in North America?', answers: ['1983', '1985', '1987', '1990'], correctIndex: 1 },
  { question: 'What is the name of the protagonist in The Legend of Zelda series?', answers: ['Zelda', 'Link', 'Ganon', 'Tingle'], correctIndex: 1 },
  { question: 'Which game introduced the "Battle Royale" genre to mainstream audiences?', answers: ['Fortnite', 'PlayerUnknown\'s Battlegrounds', 'H1Z1', 'Minecraft Hunger Games'], correctIndex: 1 },
  { question: 'In Minecraft, what material do you need to mine diamonds?', answers: ['Stone Pickaxe', 'Iron Pickaxe', 'Gold Pickaxe', 'Wood Pickaxe'], correctIndex: 1 },
  { question: 'What is the highest level cap in Classic Old School RuneScape?', answers: ['99', '120', '138', '200'], correctIndex: 0 },
  { question: 'Which OSRS boss drops the Twisted Bow?', answers: ['Corporeal Beast', 'Chambers of Xeric', 'Theatre of Blood', 'God Wars Dungeon'], correctIndex: 1 },
  { question: 'What is the max hitpoints level in OSRS?', answers: ['90', '99', '120', '150'], correctIndex: 1 },
  { question: 'In OSRS, which skill allows you to craft runes?', answers: ['Magic', 'Runecraft', 'Crafting', 'Enchanting'], correctIndex: 1 },
  { question: 'Which game features a plumber named Mario?', answers: ['Donkey Kong', 'Super Mario Bros', 'Both', 'Neither'], correctIndex: 2 },
  { question: 'What does "NPC" stand for in gaming?', answers: ['Non-Player Character', 'Neutral Play Controller', 'New Player Command', 'Network Protocol Code'], correctIndex: 0 },

  // Geography
  { question: 'What is the capital of Australia?', answers: ['Sydney', 'Melbourne', 'Canberra', 'Brisbane'], correctIndex: 2 },
  { question: 'Which is the largest ocean on Earth?', answers: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correctIndex: 3 },
  { question: 'In which country would you find the city of Timbuktu?', answers: ['Nigeria', 'Mali', 'Niger', 'Chad'], correctIndex: 1 },
  { question: 'What is the longest river in the world?', answers: ['Amazon', 'Nile', 'Mississippi', 'Yangtze'], correctIndex: 1 },
  { question: 'Which European country has the most borders with other countries?', answers: ['Germany', 'France', 'Russia', 'Austria'], correctIndex: 2 },
  { question: 'What is the smallest country in the world by area?', answers: ['Monaco', 'San Marino', 'Vatican City', 'Liechtenstein'], correctIndex: 2 },
  { question: 'Which mountain range separates Europe from Asia?', answers: ['Alps', 'Urals', 'Caucasus', 'Himalayas'], correctIndex: 1 },
  { question: 'What is the capital of Japan?', answers: ['Osaka', 'Kyoto', 'Tokyo', 'Yokohama'], correctIndex: 2 },

  // Science
  { question: 'What is the chemical symbol for gold?', answers: ['Go', 'Gd', 'Au', 'Ag'], correctIndex: 2 },
  { question: 'What planet is known as the Red Planet?', answers: ['Venus', 'Jupiter', 'Mars', 'Saturn'], correctIndex: 2 },
  { question: 'What is the speed of light in vacuum (approximately)?', answers: ['300,000 km/s', '150,000 km/s', '500,000 km/s', '1,000,000 km/s'], correctIndex: 0 },
  { question: 'What is the atomic number of carbon?', answers: ['4', '6', '8', '12'], correctIndex: 1 },
  { question: 'Which gas do plants absorb from the air for photosynthesis?', answers: ['Nitrogen', 'Oxygen', 'Carbon dioxide', 'Hydrogen'], correctIndex: 2 },
  { question: 'What is the hardest natural substance on Earth?', answers: ['Platinum', 'Titanium', 'Diamond', 'Graphite'], correctIndex: 2 },
  { question: 'Which scientist developed the theory of general relativity?', answers: ['Newton', 'Einstein', 'Hawking', 'Bohr'], correctIndex: 1 },
  { question: 'What is H2O commonly known as?', answers: ['Salt', 'Water', 'Hydrogen peroxide', 'Acid'], correctIndex: 1 },

  // History
  { question: 'In what year did World War II end?', answers: ['1943', '1944', '1945', '1946'], correctIndex: 2 },
  { question: 'Who was the first emperor of Rome?', answers: ['Julius Caesar', 'Augustus', 'Nero', 'Caligula'], correctIndex: 1 },
  { question: 'In which year did the Titanic sink?', answers: ['1910', '1911', '1912', '1913'], correctIndex: 2 },
  { question: 'Who wrote the Declaration of Independence?', answers: ['George Washington', 'Benjamin Franklin', 'Thomas Jefferson', 'John Adams'], correctIndex: 2 },
  { question: 'Which ancient wonder is still standing today?', answers: ['Colossus of Rhodes', 'Great Pyramid of Giza', 'Lighthouse of Alexandria', 'Hanging Gardens'], correctIndex: 1 },
  { question: 'When did the Berlin Wall fall?', answers: ['1987', '1988', '1989', '1990'], correctIndex: 2 },
  { question: 'Who was the first person to walk on the Moon?', answers: ['Buzz Aldrin', 'Neil Armstrong', 'John Glenn', 'Yuri Gagarin'], correctIndex: 1 },

  // Music
  { question: 'How many strings does a standard guitar have?', answers: ['4', '5', '6', '7'], correctIndex: 2 },
  { question: 'Which band sang "Bohemian Rhapsody"?', answers: ['The Beatles', 'Queen', 'Led Zeppelin', 'Pink Floyd'], correctIndex: 1 },
  { question: 'What instrument did Jimi Hendrix famously play?', answers: ['Piano', 'Drums', 'Electric guitar', 'Bass'], correctIndex: 2 },
  { question: 'Which key has no sharps or flats?', answers: ['G major', 'C major', 'F major', 'D major'], correctIndex: 1 },
  { question: 'Who is known as the "King of Pop"?', answers: ['Prince', 'Michael Jackson', 'Elvis Presley', 'Whitney Houston'], correctIndex: 1 },
  { question: 'In which decade did hip-hop emerge as a genre?', answers: ['1960s', '1970s', '1980s', '1990s'], correctIndex: 1 },

  // Movies
  { question: 'What year was the first Jurassic Park film released?', answers: ['1991', '1992', '1993', '1994'], correctIndex: 2 },
  { question: 'Who directed "Inception"?', answers: ['Steven Spielberg', 'Christopher Nolan', 'James Cameron', 'Quentin Tarantino'], correctIndex: 1 },
  { question: 'What is the highest-grossing film of all time (unadjusted)?', answers: ['Titanic', 'Avatar', 'Avengers: Endgame', 'Star Wars: The Force Awakens'], correctIndex: 2 },
  { question: 'Which actor played Jack Dawson in Titanic?', answers: ['Brad Pitt', 'Leonardo DiCaprio', 'Matt Damon', 'Tom Cruise'], correctIndex: 1 },
  { question: 'In The Matrix, what color pill does Neo take?', answers: ['Blue', 'Red', 'Green', 'Both'], correctIndex: 1 },
  { question: 'What animated film features a lion named Simba?', answers: ['Jungle Book', 'Tarzan', 'The Lion King', 'Madagascar'], correctIndex: 2 },

  // Sports
  { question: 'How many players are on a soccer team on the field?', answers: ['9', '10', '11', '12'], correctIndex: 2 },
  { question: 'In which sport do you score a "touchdown"?', answers: ['Soccer', 'Rugby', 'American Football', 'Hockey'], correctIndex: 2 },
  { question: 'Who has won the most Olympic gold medals?', answers: ['Usain Bolt', 'Michael Phelps', 'Carl Lewis', 'Simone Biles'], correctIndex: 1 },
  { question: 'What is the diameter of a basketball hoop in inches?', answers: ['16', '18', '20', '24'], correctIndex: 1 },
  { question: 'Which country has won the most FIFA World Cups?', answers: ['Germany', 'Italy', 'Argentina', 'Brazil'], correctIndex: 3 },
  { question: 'How many Grand Slam tennis tournaments are there per year?', answers: ['2', '3', '4', '5'], correctIndex: 2 },

  // General Knowledge
  { question: 'What is the most spoken language in the world by native speakers?', answers: ['English', 'Spanish', 'Mandarin Chinese', 'Hindi'], correctIndex: 2 },
  { question: 'How many days are in a leap year?', answers: ['364', '365', '366', '367'], correctIndex: 2 },
  { question: 'What is the largest mammal on Earth?', answers: ['Elephant', 'Blue Whale', 'Giraffe', 'Polar Bear'], correctIndex: 1 },
  { question: 'In what year did the first iPhone release?', answers: ['2005', '2006', '2007', '2008'], correctIndex: 2 },
  { question: 'What is the capital of Canada?', answers: ['Toronto', 'Vancouver', 'Ottawa', 'Montreal'], correctIndex: 2 },
  { question: 'Which planet has the most moons?', answers: ['Jupiter', 'Saturn', 'Uranus', 'Neptune'], correctIndex: 1 },
  { question: 'What is the fear of spiders called?', answers: ['Ophidiophobia', 'Arachnophobia', 'Acrophobia', 'Claustrophobia'], correctIndex: 1 },
  { question: 'How many continents are there?', answers: ['5', '6', '7', '8'], correctIndex: 2 },

  // More OSRS
  { question: 'What is the name of the starting city in OSRS?', answers: ['Varrock', 'Lumbridge', 'Falador', 'Draynor'], correctIndex: 1 },
  { question: 'Which OSRS NPC offers the Dragon Slayer quest?', answers: ['Oziach', 'Guildmaster', 'Gertrude', 'Wise Old Man'], correctIndex: 0 },
  { question: 'What combat style is weak against Slash in OSRS?', answers: ['Stab', 'Crush', 'Ranged', 'Magic'], correctIndex: 0 },
  { question: 'How much does a Bond cost in OSRS (in coins)?', answers: ['~5M', '~7M', '~10M', '~15M'], correctIndex: 1 },
  { question: 'Which skill in OSRS uses runes?', answers: ['Runecraft', 'Magic', 'Prayer', 'Crafting'], correctIndex: 1 },
];

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const EXPIRY_MS = 30 * 1000;
const TIMER_SECONDS = 15;
const BUTTON_LABELS = ['A', 'B', 'C', 'D'];

/** @type {Map<string, { state: TriviaState; expiry: number }>} */
const games = new Map();

/** @type {Map<string, number>} — userId -> messageId, for "one active trivia per player" */
const playerToMessageId = new Map();

/**
 * @typedef {Object} TriviaState
 * @property {Object} question — { question, answers, correctIndex }
 * @property {string[]} shuffledAnswers — answers in display order
 * @property {number} correctShuffledIndex — index of correct answer in shuffled order
 * @property {string} userId
 * @property {number} startedAt
 */

function shuffleArray(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickQuestion() {
  return QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
}

function buildTriviaState(userId) {
  const q = pickQuestion();
  const shuffledAnswers = shuffleArray(q.answers);
  const correctAnswer = q.answers[q.correctIndex];
  const correctShuffledIndex = shuffledAnswers.indexOf(correctAnswer);
  return {
    question: q,
    shuffledAnswers,
    correctShuffledIndex,
    userId,
    startedAt: Date.now(),
  };
}

/** @param {string} id */
function getGame(id) {
  const entry = games.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    games.delete(id);
    const p = playerToMessageId.get(entry.state.userId);
    if (p === id) playerToMessageId.delete(entry.state.userId);
    return null;
  }
  return entry.state;
}

/** @param {string} id @param {TriviaState} state */
function setGame(id, state) {
  games.set(id, { state, expiry: Date.now() + EXPIRY_MS });
  playerToMessageId.set(state.userId, id);
}

/** @param {string} id @param {string} userId */
function deleteGame(id, userId) {
  games.delete(id);
  if (userId) playerToMessageId.delete(userId);
}

function buildQuestionEmbed(state, result = null) {
  const { question, shuffledAnswers, correctShuffledIndex, startedAt } = state;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const expired = elapsed >= TIMER_SECONDS;
  const isAnswered = result !== null;

  let color = 0x5865f2;
  let title = '❓ Trivia';
  let description = question.question;

  if (isAnswered || expired) {
    const correctText = shuffledAnswers[correctShuffledIndex];
    if (result === true) {
      color = 0x57f287;
      title = '✅ Correct!';
      description += `\n\n**Your answer was correct!** The answer was: **${correctText}**`;
    } else {
      color = 0xed4245;
      title = result === 'expired' || expired ? '⏰ Time\'s Up!' : '❌ Wrong!';
      description += `\n\nThe correct answer was: **${correctText}**`;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setFooter({
      text: isAnswered || expired
        ? 'Game Over'
        : `You have ${TIMER_SECONDS - elapsed} seconds to answer`,
    });

  const row = new ActionRowBuilder();
  for (let i = 0; i < 4; i++) {
    const btn = new ButtonBuilder()
      .setCustomId(`triv_${i}`)
      .setLabel(`${BUTTON_LABELS[i]}. ${shuffledAnswers[i]}`)
      .setStyle(ButtonStyle.Secondary);
    if (isAnswered || expired) {
      if (i === correctShuffledIndex) btn.setStyle(ButtonStyle.Success);
      else btn.setStyle(ButtonStyle.Secondary).setDisabled(true);
    }
    row.addComponents(btn);
  }

  return { embed, components: isAnswered || expired ? [] : [row] };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SLASH COMMAND & HANDLER
// ─────────────────────────────────────────────────────────────────────────────

const triviaCommand = new SlashCommandBuilder()
  .setName('trivia')
  .setDescription('Start a solo trivia round');

export const triviaCommands = [triviaCommand];

/**
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
export async function handleTriviaInteraction(interaction) {
  // Slash command: start trivia
  if (interaction.isChatInputCommand() && interaction.commandName === 'trivia') {
    const userId = interaction.user.id;
    const existingMsgId = playerToMessageId.get(userId);
    if (existingMsgId) {
      const existing = games.get(existingMsgId);
      if (existing && Date.now() <= existing.expiry) {
        await interaction.reply({
          content: 'You already have an active trivia game. Use that message to answer.',
          ephemeral: true,
        });
        return true;
      }
      playerToMessageId.delete(userId);
    }

    const state = buildTriviaState(userId);
    const { embed, components } = buildQuestionEmbed(state);
    const msg = await interaction.reply({
      embeds: [embed],
      components,
      fetchReply: true,
    });

    setGame(msg.id, state);
    return true;
  }

  // Button: answer
  if (interaction.isButton() && interaction.customId.startsWith('triv_')) {
    const game = getGame(interaction.message.id);
    if (!game) {
      await interaction.reply({
        content: 'This trivia has expired or ended.',
        ephemeral: true,
      });
      return true;
    }
    if (game.userId !== interaction.user.id) {
      await interaction.reply({
        content: 'This is not your trivia game.',
        ephemeral: true,
      });
      return true;
    }

    const chosenIndex = parseInt(interaction.customId.slice(5), 10);
    const correct = chosenIndex === game.correctShuffledIndex;
    const expired = Math.floor((Date.now() - game.startedAt) / 1000) >= TIMER_SECONDS;

    let result;
    if (expired) {
      deleteGame(interaction.message.id, game.userId);
      recordLoss(interaction.user.id, interaction.user.displayName ?? interaction.user.username, GAME_KEY);
      result = 'expired';
    } else {
      deleteGame(interaction.message.id, game.userId);
      if (correct) {
        recordWin(interaction.user.id, interaction.user.displayName ?? interaction.user.username, GAME_KEY);
        result = true;
      } else {
        recordLoss(interaction.user.id, interaction.user.displayName ?? interaction.user.username, GAME_KEY);
        result = false;
      }
    }

    const { embed, components } = buildQuestionEmbed(game, result);
    await interaction.update({ embeds: [embed], components });
    return true;
  }

  return false;
}
