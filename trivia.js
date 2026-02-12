// trivia.js
// ─────────────────────────────────────────────────────────────────────────────
// Multiplayer Discord Trivia Battle — Best of 5, two-player, leaderboard.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { recordWin, recordLoss, recordDraw } from './leaderboard.js';

const GAME_KEY = 'trivia';

// ─────────────────────────────────────────────────────────────────────────────
//  QUESTION BANK
// ─────────────────────────────────────────────────────────────────────────────

const QUESTIONS = [
  { question: 'In what year was the first NES released in North America?', answers: ['1983','1985','1987','1990'], correctIndex: 1 },
  { question: 'What is the name of the protagonist in The Legend of Zelda?', answers: ['Zelda','Link','Ganon','Tingle'], correctIndex: 1 },
  { question: 'Which game introduced Battle Royale to mainstream?', answers: ['Fortnite','PUBG','H1Z1','Minecraft Hunger Games'], correctIndex: 1 },
  { question: 'In Minecraft, what material do you need to mine diamonds?', answers: ['Stone Pickaxe','Iron Pickaxe','Gold Pickaxe','Wood Pickaxe'], correctIndex: 1 },
  { question: 'What is the highest level cap in Classic OSRS?', answers: ['99','120','138','200'], correctIndex: 0 },
  { question: 'Which OSRS boss drops the Twisted Bow?', answers: ['Corp Beast','Chambers of Xeric','Theatre of Blood','GWD'], correctIndex: 1 },
  { question: 'What is the max hitpoints level in OSRS?', answers: ['90','99','120','150'], correctIndex: 1 },
  { question: 'In OSRS, which skill allows you to craft runes?', answers: ['Magic','Runecraft','Crafting','Enchanting'], correctIndex: 1 },
  { question: 'Which game features a plumber named Mario?', answers: ['Donkey Kong','Super Mario Bros','Both','Neither'], correctIndex: 2 },
  { question: 'What does NPC stand for in gaming?', answers: ['Non-Player Character','Neutral Play Controller','New Player Command','Network Protocol Code'], correctIndex: 0 },
  { question: 'What is the capital of Australia?', answers: ['Sydney','Melbourne','Canberra','Brisbane'], correctIndex: 2 },
  { question: 'Which is the largest ocean on Earth?', answers: ['Atlantic','Indian','Arctic','Pacific'], correctIndex: 3 },
  { question: 'What is the longest river in the world?', answers: ['Amazon','Nile','Mississippi','Yangtze'], correctIndex: 1 },
  { question: 'What is the smallest country by area?', answers: ['Monaco','San Marino','Vatican City','Liechtenstein'], correctIndex: 2 },
  { question: 'What is the chemical symbol for gold?', answers: ['Go','Gd','Au','Ag'], correctIndex: 2 },
  { question: 'What planet is known as the Red Planet?', answers: ['Venus','Jupiter','Mars','Saturn'], correctIndex: 2 },
  { question: 'What is the atomic number of carbon?', answers: ['4','6','8','12'], correctIndex: 1 },
  { question: 'What is the hardest natural substance?', answers: ['Platinum','Titanium','Diamond','Graphite'], correctIndex: 2 },
  { question: 'In what year did WWII end?', answers: ['1943','1944','1945','1946'], correctIndex: 2 },
  { question: 'Who was the first emperor of Rome?', answers: ['Julius Caesar','Augustus','Nero','Caligula'], correctIndex: 1 },
  { question: 'In which year did the Titanic sink?', answers: ['1910','1911','1912','1913'], correctIndex: 2 },
  { question: 'Which ancient wonder still stands today?', answers: ['Colossus of Rhodes','Great Pyramid of Giza','Lighthouse of Alexandria','Hanging Gardens'], correctIndex: 1 },
  { question: 'When did the Berlin Wall fall?', answers: ['1987','1988','1989','1990'], correctIndex: 2 },
  { question: 'How many strings does a standard guitar have?', answers: ['4','5','6','7'], correctIndex: 2 },
  { question: 'Which band sang Bohemian Rhapsody?', answers: ['The Beatles','Queen','Led Zeppelin','Pink Floyd'], correctIndex: 1 },
  { question: 'Who is known as the King of Pop?', answers: ['Prince','Michael Jackson','Elvis Presley','Whitney Houston'], correctIndex: 1 },
  { question: 'What year was Jurassic Park released?', answers: ['1991','1992','1993','1994'], correctIndex: 2 },
  { question: 'Who directed Inception?', answers: ['Spielberg','Nolan','Cameron','Tarantino'], correctIndex: 1 },
  { question: 'In The Matrix, what color pill does Neo take?', answers: ['Blue','Red','Green','Both'], correctIndex: 1 },
  { question: 'How many players on a soccer team on field?', answers: ['9','10','11','12'], correctIndex: 2 },
  { question: 'Who has the most Olympic gold medals?', answers: ['Usain Bolt','Michael Phelps','Carl Lewis','Simone Biles'], correctIndex: 1 },
  { question: 'Which country has won the most FIFA World Cups?', answers: ['Germany','Italy','Argentina','Brazil'], correctIndex: 3 },
  { question: 'What is the most spoken language by native speakers?', answers: ['English','Spanish','Mandarin Chinese','Hindi'], correctIndex: 2 },
  { question: 'How many days in a leap year?', answers: ['364','365','366','367'], correctIndex: 2 },
  { question: 'What is the largest mammal on Earth?', answers: ['Elephant','Blue Whale','Giraffe','Polar Bear'], correctIndex: 1 },
  { question: 'What year did the first iPhone release?', answers: ['2005','2006','2007','2008'], correctIndex: 2 },
  { question: 'What is the fear of spiders called?', answers: ['Ophidiophobia','Arachnophobia','Acrophobia','Claustrophobia'], correctIndex: 1 },
  { question: 'What is the starting city in OSRS?', answers: ['Varrock','Lumbridge','Falador','Draynor'], correctIndex: 1 },
  { question: 'Which OSRS NPC offers Dragon Slayer?', answers: ['Oziach','Guildmaster','Gertrude','Wise Old Man'], correctIndex: 0 },
  { question: 'Which skill in OSRS uses runes?', answers: ['Runecraft','Magic','Prayer','Crafting'], correctIndex: 1 },
];

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const TOTAL_ROUNDS   = 5;
const ROUND_TIMEOUT  = 15_000;       // 15 seconds per question
const GAME_TIMEOUT   = 10 * 60_000;  // 10 minute overall game timeout
const THEME_COLOR    = 0x4F46E5;     // indigo
const CORRECT_COLOR  = 0x22C55E;     // green
const WRONG_COLOR    = 0xEF4444;     // red
const GOLD_COLOR     = 0xFFD700;     // trophy gold
const BUTTON_LABELS  = ['A', 'B', 'C', 'D'];

// ─────────────────────────────────────────────────────────────────────────────
//  GAME STATE STORAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TriviaGame
 * @property {'pending'|'playing'|'revealed'|'finished'} phase
 * @property {string} challengerId
 * @property {string} challengerName
 * @property {string} opponentId
 * @property {string} opponentName
 * @property {number} challengerScore
 * @property {number} opponentScore
 * @property {number} currentRound          — 0-indexed
 * @property {Object[]} questions           — 5 pre-selected questions (shuffled order)
 * @property {string[]} shuffledAnswers     — current round's shuffled answer strings
 * @property {number} correctShuffledIndex  — correct index in shuffled order
 * @property {number|null} challengerAnswer — index chosen (or null)
 * @property {number|null} opponentAnswer   — index chosen (or null)
 * @property {string} channelId
 * @property {string} messageId
 * @property {number} createdAt
 * @property {number} roundStartedAt
 * @property {NodeJS.Timeout|null} roundTimer
 */

/** @type {Map<string, TriviaGame>} messageId → game */
const games = new Map();

/** @type {Map<string, string>} userId → messageId (one active game per player) */
const playerLock = new Map();

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function shuffleArray(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickQuestions(count) {
  const pool = shuffleArray(QUESTIONS);
  return pool.slice(0, count);
}

function displayName(interaction) {
  return interaction.member?.displayName ?? interaction.user.displayName ?? interaction.user.username;
}

function isExpired(game) {
  return Date.now() - game.createdAt > GAME_TIMEOUT;
}

function cleanupGame(messageId) {
  const game = games.get(messageId);
  if (!game) return;
  if (game.roundTimer) clearTimeout(game.roundTimer);
  if (playerLock.get(game.challengerId) === messageId) playerLock.delete(game.challengerId);
  if (playerLock.get(game.opponentId) === messageId) playerLock.delete(game.opponentId);
  games.delete(messageId);
}

function prepareRound(game) {
  const q = game.questions[game.currentRound];
  const shuffled = shuffleArray(q.answers);
  const correctAnswer = q.answers[q.correctIndex];
  game.shuffledAnswers = shuffled;
  game.correctShuffledIndex = shuffled.indexOf(correctAnswer);
  game.challengerAnswer = null;
  game.opponentAnswer = null;
  game.roundStartedAt = Date.now();
  game.phase = 'playing';
}

// ─────────────────────────────────────────────────────────────────────────────
//  EMBED BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildChallengeEmbed(challengerName, opponentName) {
  return new EmbedBuilder()
    .setTitle('🧠 Trivia Battle — Challenge!')
    .setDescription(
      `**${challengerName}** has challenged **${opponentName}** to a Best of ${TOTAL_ROUNDS} Trivia Battle!\n\n` +
      `${opponentName}, do you accept?`
    )
    .setColor(THEME_COLOR)
    .setFooter({ text: 'Challenge expires in 60 seconds' });
}

function buildChallengeButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('triv_accept')
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('triv_decline')
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );
}

function buildQuestionEmbed(game) {
  const q = game.questions[game.currentRound];
  const round = game.currentRound + 1;

  const scoreLine = `🔵 ${game.challengerName}: **${game.challengerScore}** | 🔴 ${game.opponentName}: **${game.opponentScore}**`;

  const answerLines = game.shuffledAnswers.map((a, i) =>
    `> **${BUTTON_LABELS[i]}.** ${a}`
  ).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🧠 Trivia Battle — Round ${round}/${TOTAL_ROUNDS}`)
    .setDescription(`${scoreLine}\n\n**${q.question}**\n\n${answerLines}`)
    .setColor(THEME_COLOR)
    .setFooter({ text: `Both players have 15 seconds to answer` });

  const row = new ActionRowBuilder();
  for (let i = 0; i < 4; i++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`triv_${i}`)
        .setLabel(`${BUTTON_LABELS[i]}`)
        .setStyle(ButtonStyle.Primary),
    );
  }

  return { embeds: [embed], components: [row] };
}

function buildRevealEmbed(game) {
  const q = game.questions[game.currentRound];
  const round = game.currentRound + 1;
  const correctIdx = game.correctShuffledIndex;
  const correctText = game.shuffledAnswers[correctIdx];

  const challengerCorrect = game.challengerAnswer === correctIdx;
  const opponentCorrect = game.opponentAnswer === correctIdx;

  const challengerText = game.challengerAnswer !== null
    ? `${BUTTON_LABELS[game.challengerAnswer]}. ${game.shuffledAnswers[game.challengerAnswer]}`
    : '*(no answer — timed out)*';
  const opponentText = game.opponentAnswer !== null
    ? `${BUTTON_LABELS[game.opponentAnswer]}. ${game.shuffledAnswers[game.opponentAnswer]}`
    : '*(no answer — timed out)*';

  const challengerIcon = challengerCorrect ? '✅' : '❌';
  const opponentIcon = opponentCorrect ? '✅' : '❌';

  const scoreLine = `🔵 ${game.challengerName}: **${game.challengerScore}** | 🔴 ${game.opponentName}: **${game.opponentScore}**`;

  const answerLines = game.shuffledAnswers.map((a, i) => {
    if (i === correctIdx) return `> ✅ **${BUTTON_LABELS[i]}.** ${a}`;
    // Mark wrong if either player picked it
    const wasPicked = game.challengerAnswer === i || game.opponentAnswer === i;
    if (wasPicked) return `> ❌ ~~${BUTTON_LABELS[i]}. ${a}~~`;
    return `> ${BUTTON_LABELS[i]}. ${a}`;
  }).join('\n');

  const resultsSection = [
    `\n${challengerIcon} **${game.challengerName}** answered: ${challengerText}`,
    `${opponentIcon} **${game.opponentName}** answered: ${opponentText}`,
    `\n✅ Correct answer: **${BUTTON_LABELS[correctIdx]}. ${correctText}**`,
  ].join('\n');

  const isLastRound = round >= TOTAL_ROUNDS;

  const embed = new EmbedBuilder()
    .setTitle(`🧠 Trivia Battle — Round ${round}/${TOTAL_ROUNDS} — Results`)
    .setDescription(`${scoreLine}\n\n**${q.question}**\n\n${answerLines}\n${resultsSection}`)
    .setColor(challengerCorrect || opponentCorrect ? CORRECT_COLOR : WRONG_COLOR)
    .setFooter({ text: isLastRound ? 'Final round complete!' : `Click "Next Question" to continue` });

  const components = [];
  if (!isLastRound) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('triv_next')
          .setLabel('Next Question ➡️')
          .setStyle(ButtonStyle.Primary),
      )
    );
  }

  return { embeds: [embed], components };
}

function buildFinalEmbed(game) {
  const cScore = game.challengerScore;
  const oScore = game.opponentScore;

  let resultTitle, resultDesc, color;

  if (cScore > oScore) {
    resultTitle = `🏆 ${game.challengerName} Wins!`;
    resultDesc = `**${game.challengerName}** defeated **${game.opponentName}** in Trivia Battle!`;
    color = GOLD_COLOR;
  } else if (oScore > cScore) {
    resultTitle = `🏆 ${game.opponentName} Wins!`;
    resultDesc = `**${game.opponentName}** defeated **${game.challengerName}** in Trivia Battle!`;
    color = GOLD_COLOR;
  } else {
    resultTitle = `🤝 It's a Draw!`;
    resultDesc = `**${game.challengerName}** and **${game.opponentName}** are tied!`;
    color = THEME_COLOR;
  }

  const scoreLine = `\n🔵 ${game.challengerName}: **${cScore}** | 🔴 ${game.opponentName}: **${oScore}**`;

  const embed = new EmbedBuilder()
    .setTitle(`🧠 Trivia Battle — Final Results`)
    .setDescription(`${resultTitle}\n\n${resultDesc}\n${scoreLine}`)
    .setColor(color)
    .setFooter({ text: `Best of ${TOTAL_ROUNDS} • Final score: ${cScore} – ${oScore}` });

  return { embeds: [embed], components: [] };
}

function buildDeclinedEmbed(challengerName, opponentName) {
  return new EmbedBuilder()
    .setTitle('🧠 Trivia Battle — Declined')
    .setDescription(`**${opponentName}** declined the trivia challenge from **${challengerName}**.`)
    .setColor(WRONG_COLOR);
}

function buildExpiredEmbed(reason) {
  return new EmbedBuilder()
    .setTitle('🧠 Trivia Battle — Expired')
    .setDescription(reason)
    .setColor(0x6B7280);
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROUND RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

async function resolveRound(game, channel) {
  if (game.phase !== 'playing') return;
  game.phase = 'revealed';

  if (game.roundTimer) {
    clearTimeout(game.roundTimer);
    game.roundTimer = null;
  }

  // Score the round
  const correctIdx = game.correctShuffledIndex;
  if (game.challengerAnswer === correctIdx) game.challengerScore++;
  if (game.opponentAnswer === correctIdx) game.opponentScore++;

  const isLastRound = game.currentRound + 1 >= TOTAL_ROUNDS;

  if (isLastRound) {
    // Show reveal briefly then show final
    const reveal = buildRevealEmbed(game);
    try {
      const msg = await channel.messages.fetch(game.messageId);
      await msg.edit(reveal);
    } catch { /* message may be gone */ }

    // Slight delay to let players see the last answer, then show final results
    setTimeout(async () => {
      await finishGame(game, channel);
    }, 3000);
  } else {
    // Show reveal with "Next Question" button
    const reveal = buildRevealEmbed(game);
    try {
      const msg = await channel.messages.fetch(game.messageId);
      await msg.edit(reveal);
    } catch { /* message may be gone */ }
  }
}

async function finishGame(game, channel) {
  game.phase = 'finished';

  const cScore = game.challengerScore;
  const oScore = game.opponentScore;

  // Record leaderboard
  if (cScore > oScore) {
    recordWin(game.challengerId, game.challengerName, GAME_KEY);
    recordLoss(game.opponentId, game.opponentName, GAME_KEY);
  } else if (oScore > cScore) {
    recordWin(game.opponentId, game.opponentName, GAME_KEY);
    recordLoss(game.challengerId, game.challengerName, GAME_KEY);
  } else {
    recordDraw(game.challengerId, game.challengerName, GAME_KEY);
    recordDraw(game.opponentId, game.opponentName, GAME_KEY);
  }

  const final = buildFinalEmbed(game);
  try {
    const msg = await channel.messages.fetch(game.messageId);
    await msg.edit(final);
  } catch { /* message may be gone */ }

  cleanupGame(game.messageId);
}

function startRoundTimer(game, channel) {
  game.roundTimer = setTimeout(async () => {
    if (game.phase !== 'playing') return;
    await resolveRound(game, channel);
  }, ROUND_TIMEOUT);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SLASH COMMAND
// ─────────────────────────────────────────────────────────────────────────────

const triviaCommand = new SlashCommandBuilder()
  .setName('trivia')
  .setDescription('Challenge someone to a Best of 5 Trivia Battle!')
  .addUserOption(opt =>
    opt.setName('opponent')
      .setDescription('The user you want to challenge')
      .setRequired(true),
  );

export const triviaCommands = [triviaCommand];

// ─────────────────────────────────────────────────────────────────────────────
//  INTERACTION HANDLER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
export async function handleTriviaInteraction(interaction) {

  // ── SLASH COMMAND: /trivia @opponent ──────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'trivia') {
    const challenger = interaction.user;
    const opponent = interaction.options.getUser('opponent');

    if (!opponent) {
      await interaction.reply({ content: 'You must mention an opponent!', ephemeral: true });
      return true;
    }
    if (opponent.id === challenger.id) {
      await interaction.reply({ content: 'You cannot challenge yourself!', ephemeral: true });
      return true;
    }
    if (opponent.bot) {
      await interaction.reply({ content: 'You cannot challenge a bot!', ephemeral: true });
      return true;
    }

    // Check if either player already has an active game
    const cLock = playerLock.get(challenger.id);
    if (cLock && games.has(cLock) && !isExpired(games.get(cLock))) {
      await interaction.reply({ content: 'You already have an active trivia game!', ephemeral: true });
      return true;
    }
    const oLock = playerLock.get(opponent.id);
    if (oLock && games.has(oLock) && !isExpired(games.get(oLock))) {
      await interaction.reply({ content: `**${opponent.displayName ?? opponent.username}** already has an active trivia game!`, ephemeral: true });
      return true;
    }

    const challengerN = displayName(interaction);
    const opponentN = opponent.displayName ?? opponent.username;

    const embed = buildChallengeEmbed(challengerN, opponentN);
    const row = buildChallengeButtons();

    const msg = await interaction.reply({
      content: `<@${opponent.id}>`,
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    /** @type {TriviaGame} */
    const game = {
      phase: 'pending',
      challengerId: challenger.id,
      challengerName: challengerN,
      opponentId: opponent.id,
      opponentName: opponentN,
      challengerScore: 0,
      opponentScore: 0,
      currentRound: 0,
      questions: pickQuestions(TOTAL_ROUNDS),
      shuffledAnswers: [],
      correctShuffledIndex: -1,
      challengerAnswer: null,
      opponentAnswer: null,
      channelId: interaction.channelId,
      messageId: msg.id,
      createdAt: Date.now(),
      roundStartedAt: 0,
      roundTimer: null,
    };

    games.set(msg.id, game);
    playerLock.set(challenger.id, msg.id);
    playerLock.set(opponent.id, msg.id);

    // Auto-expire challenge after 60s
    setTimeout(() => {
      const g = games.get(msg.id);
      if (g && g.phase === 'pending') {
        cleanupGame(msg.id);
        const expEmbed = buildExpiredEmbed('The trivia challenge was not accepted in time.');
        msg.edit({ content: '', embeds: [expEmbed], components: [] }).catch(() => {});
      }
    }, 60_000);

    return true;
  }

  // ── BUTTON INTERACTIONS ──────────────────────────────────────────────────
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith('triv_')) return false;

  const messageId = interaction.message.id;
  const game = games.get(messageId);

  if (!game) {
    await interaction.reply({ content: 'This trivia game has expired or ended.', ephemeral: true });
    return true;
  }

  // Check overall game timeout
  if (isExpired(game)) {
    cleanupGame(messageId);
    const expEmbed = buildExpiredEmbed('This trivia game has timed out (10 min limit).');
    await interaction.update({ content: '', embeds: [expEmbed], components: [] });
    return true;
  }

  const userId = interaction.user.id;
  const isChallenger = userId === game.challengerId;
  const isOpponent = userId === game.opponentId;

  // ── ACCEPT / DECLINE ─────────────────────────────────────────────────────
  if (interaction.customId === 'triv_accept') {
    if (!isOpponent) {
      await interaction.reply({ content: 'Only the challenged player can accept!', ephemeral: true });
      return true;
    }
    if (game.phase !== 'pending') {
      await interaction.reply({ content: 'This challenge has already been responded to.', ephemeral: true });
      return true;
    }

    // Start the game — prepare round 1
    prepareRound(game);
    const questionMsg = buildQuestionEmbed(game);
    await interaction.update({ content: '', ...questionMsg });

    // Start round timer
    const channel = interaction.channel;
    startRoundTimer(game, channel);

    return true;
  }

  if (interaction.customId === 'triv_decline') {
    if (!isOpponent) {
      await interaction.reply({ content: 'Only the challenged player can decline!', ephemeral: true });
      return true;
    }
    if (game.phase !== 'pending') {
      await interaction.reply({ content: 'This challenge has already been responded to.', ephemeral: true });
      return true;
    }

    const embed = buildDeclinedEmbed(game.challengerName, game.opponentName);
    cleanupGame(messageId);
    await interaction.update({ content: '', embeds: [embed], components: [] });
    return true;
  }

  // ── NEXT QUESTION ─────────────────────────────────────────────────────────
  if (interaction.customId === 'triv_next') {
    if (!isChallenger && !isOpponent) {
      await interaction.reply({ content: 'You are not a player in this game!', ephemeral: true });
      return true;
    }
    if (game.phase !== 'revealed') {
      await interaction.reply({ content: 'Cannot advance right now.', ephemeral: true });
      return true;
    }

    // Advance to next round
    game.currentRound++;
    if (game.currentRound >= TOTAL_ROUNDS) {
      // Shouldn't happen since last round auto-finishes, but safety net
      await finishGame(game, interaction.channel);
      await interaction.deferUpdate();
      return true;
    }

    prepareRound(game);
    const questionMsg = buildQuestionEmbed(game);
    await interaction.update({ content: '', ...questionMsg });

    startRoundTimer(game, interaction.channel);
    return true;
  }

  // ── ANSWER BUTTONS (triv_0 through triv_3) ───────────────────────────────
  if (/^triv_[0-3]$/.test(interaction.customId)) {
    if (!isChallenger && !isOpponent) {
      await interaction.reply({ content: 'You are not a player in this game!', ephemeral: true });
      return true;
    }
    if (game.phase !== 'playing') {
      await interaction.reply({ content: 'This question is no longer active.', ephemeral: true });
      return true;
    }

    const chosenIndex = parseInt(interaction.customId.charAt(5), 10);
    const chosenLabel = `${BUTTON_LABELS[chosenIndex]}. ${game.shuffledAnswers[chosenIndex]}`;

    if (isChallenger) {
      if (game.challengerAnswer !== null) {
        await interaction.reply({ content: `You already answered: **${BUTTON_LABELS[game.challengerAnswer]}. ${game.shuffledAnswers[game.challengerAnswer]}**`, ephemeral: true });
        return true;
      }
      game.challengerAnswer = chosenIndex;
      await interaction.reply({ content: `You picked **${chosenLabel}**!`, ephemeral: true });
    } else {
      if (game.opponentAnswer !== null) {
        await interaction.reply({ content: `You already answered: **${BUTTON_LABELS[game.opponentAnswer]}. ${game.shuffledAnswers[game.opponentAnswer]}**`, ephemeral: true });
        return true;
      }
      game.opponentAnswer = chosenIndex;
      await interaction.reply({ content: `You picked **${chosenLabel}**!`, ephemeral: true });
    }

    // Check if both players have answered
    if (game.challengerAnswer !== null && game.opponentAnswer !== null) {
      await resolveRound(game, interaction.channel);
    }

    return true;
  }

  return false;
}
