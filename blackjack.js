// blackjack.js
// ─────────────────────────────────────────────────────────────────────────────
// Multiplayer Blackjack — two players compete head-to-head against a dealer.
// Each player's hand is scored vs the dealer; best overall result wins.
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

const SUIT_COLORS = { '♠': 'black', '♥': 'red', '♦': 'red', '♣': 'black' };

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
  return `**${card.rank}${card.suit}**`;
}

function formatHand(hand) {
  return hand.map(formatCard).join('  ');
}

function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  return parseInt(card.rank, 10);
}

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

function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

function isBust(hand) {
  return handValue(hand) > 21;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

const GAME_TIMEOUT_MS = 5 * 60 * 1000;

const games = new Map();
const pendingChallenges = new Map();

// ═════════════════════════════════════════════════════════════════════════════
//  TIMEOUT CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  for (const [msgId, challenge] of pendingChallenges) {
    if (now - challenge.createdAt > GAME_TIMEOUT_MS) {
      pendingChallenges.delete(msgId);
      console.log(`[BJ] Challenge ${msgId} expired (timeout).`);
    }
  }
  for (const [msgId, game] of games) {
    if (now - game.lastActivity > GAME_TIMEOUT_MS) {
      games.delete(msgId);
      console.log(`[BJ] Game ${msgId} expired (timeout).`);
    }
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  RESULT HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function scoreVsDealer(playerHand, dealerHand) {
  const pVal = handValue(playerHand);
  const dVal = handValue(dealerHand);
  const pBust = isBust(playerHand);
  const dBust = isBust(dealerHand);
  const pBJ = isBlackjack(playerHand);
  const dBJ = isBlackjack(dealerHand);

  if (pBust) return -1;
  if (pBJ && dBJ) return 0;
  if (pBJ) return 1;
  if (dBJ) return -1;
  if (dBust) return 1;
  if (pVal > dVal) return 1;
  if (pVal < dVal) return -1;
  return 0;
}

function playerResultLabel(score) {
  if (score === 1) return '🟢 WIN';
  if (score === -1) return '🔴 LOSS';
  return '🟡 PUSH';
}

function handStatusLabel(hand) {
  if (isBlackjack(hand)) return '✨ BLACKJACK!';
  if (isBust(hand)) return '💥 BUST';
  return `Total: ${handValue(hand)}`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  EMBED BUILDERS
// ═════════════════════════════════════════════════════════════════════════════

function buildChallengeEmbed(challengerName, opponentName) {
  return new EmbedBuilder()
    .setTitle('🃏 Blackjack Table')
    .setDescription(
      `🎰 **${challengerName}** has challenged **${opponentName}** to a game of Blackjack!\n\n` +
      `Both players will be dealt cards and play against the dealer.\n` +
      `Beat the dealer to earn points — the player with the better result wins!\n\n` +
      `🎰 *Waiting for ${opponentName} to respond...*`
    )
    .setColor(0x1B5E20)
    .setFooter({ text: '♠ ♥ ♦ ♣  |  Challenge expires in 5 minutes' });
}

function buildChallengeButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('bj_accept')
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId('bj_decline')
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌'),
    ),
  ];
}

function buildGameEmbed(game) {
  const embed = new EmbedBuilder()
    .setTitle('🃏 Blackjack Table')
    .setColor(0x1B5E20);

  const p1Active = game.phase === 'p1_turn';
  const p2Active = game.phase === 'p2_turn';
  const isOver = game.phase === 'over';
  const showDealer = isOver;

  // ── Player 1 field ──
  const p1Indicator = p1Active ? '👉 ' : '';
  const p1Cards = formatHand(game.player1Hand);
  const p1Status = handStatusLabel(game.player1Hand);
  let p1Value = `${p1Cards}\n${p1Status}`;
  if (isOver) {
    const s1 = scoreVsDealer(game.player1Hand, game.dealerHand);
    p1Value += `\n${playerResultLabel(s1)}`;
  }
  if (game.player1Doubled) p1Value += '\n*(Doubled Down)*';

  embed.addFields({
    name: `${p1Indicator}♠ ${game.player1Name}`,
    value: p1Value,
    inline: true,
  });

  // ── Player 2 field ──
  const p2Indicator = p2Active ? '👉 ' : '';
  const p2Cards = formatHand(game.player2Hand);
  const p2Status = handStatusLabel(game.player2Hand);
  let p2Value = `${p2Cards}\n${p2Status}`;
  if (isOver) {
    const s2 = scoreVsDealer(game.player2Hand, game.dealerHand);
    p2Value += `\n${playerResultLabel(s2)}`;
  }
  if (game.player2Doubled) p2Value += '\n*(Doubled Down)*';

  embed.addFields({
    name: `${p2Indicator}♥ ${game.player2Name}`,
    value: p2Value,
    inline: true,
  });

  // ── Dealer field ──
  let dealerCards;
  let dealerStatus;
  if (showDealer) {
    dealerCards = formatHand(game.dealerHand);
    dealerStatus = handStatusLabel(game.dealerHand);
  } else {
    dealerCards = `${formatCard(game.dealerHand[0])}  🂠`;
    dealerStatus = `Showing: ${cardValue(game.dealerHand[0])}`;
  }

  embed.addFields({
    name: '🎩 Dealer',
    value: `${dealerCards}\n${dealerStatus}`,
    inline: false,
  });

  // ── Footer / status ──
  if (isOver) {
    embed.addFields({ name: '\u200b', value: `\n${game.resultText}`, inline: false });
    embed.setFooter({ text: '♠ ♥ ♦ ♣  |  Game Over' });
  } else if (p1Active) {
    embed.setFooter({ text: `♠ ♥ ♦ ♣  |  ${game.player1Name}'s turn` });
  } else if (p2Active) {
    embed.setFooter({ text: `♠ ♥ ♦ ♣  |  ${game.player2Name}'s turn` });
  }

  return embed;
}

function buildGameButtons(game) {
  const isPlaying = game.phase === 'p1_turn' || game.phase === 'p2_turn';
  if (!isPlaying) return [];

  const currentHand = game.phase === 'p1_turn' ? game.player1Hand : game.player2Hand;
  const canAct = !isBust(currentHand) && handValue(currentHand) < 21;
  const canDouble = canAct && currentHand.length === 2;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('bj_hit')
        .setLabel('Hit')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🃏')
        .setDisabled(!canAct),
      new ButtonBuilder()
        .setCustomId('bj_stand')
        .setLabel('Stand')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🛑')
        .setDisabled(!canAct),
      new ButtonBuilder()
        .setCustomId('bj_double')
        .setLabel('Double Down')
        .setStyle(ButtonStyle.Success)
        .setEmoji('💰')
        .setDisabled(!canDouble),
    ),
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME LOGIC
// ═════════════════════════════════════════════════════════════════════════════

function advanceFromP1(game) {
  game.phase = 'p2_turn';
  if (isBlackjack(game.player2Hand)) {
    advanceFromP2(game);
  }
}

function advanceFromP2(game) {
  game.phase = 'dealer';
  dealerPlays(game);
  resolveGame(game);
}

function dealerPlays(game) {
  while (handValue(game.dealerHand) < 17) {
    game.dealerHand.push(game.deck.pop());
  }
}

function resolveGame(game) {
  game.phase = 'over';

  const s1 = scoreVsDealer(game.player1Hand, game.dealerHand);
  const s2 = scoreVsDealer(game.player2Hand, game.dealerHand);

  const p1Total = handValue(game.player1Hand);
  const p2Total = handValue(game.player2Hand);
  const dealerTotal = handValue(game.dealerHand);

  const p1Label = `**${game.player1Name}**: ${playerResultLabel(s1)} (${isBust(game.player1Hand) ? 'Bust' : p1Total} vs Dealer ${isBust(game.dealerHand) ? 'Bust' : dealerTotal})`;
  const p2Label = `**${game.player2Name}**: ${playerResultLabel(s2)} (${isBust(game.player2Hand) ? 'Bust' : p2Total} vs Dealer ${isBust(game.dealerHand) ? 'Bust' : dealerTotal})`;

  let winner = null;
  let loser = null;
  let draw = false;
  let headlineEmoji = '';
  let headlineText = '';

  if (s1 > s2) {
    winner = { id: game.player1Id, name: game.player1Name };
    loser = { id: game.player2Id, name: game.player2Name };
    headlineEmoji = '🏆';
    headlineText = `${game.player1Name} wins the table!`;
  } else if (s2 > s1) {
    winner = { id: game.player2Id, name: game.player2Name };
    loser = { id: game.player1Id, name: game.player1Name };
    headlineEmoji = '🏆';
    headlineText = `${game.player2Name} wins the table!`;
  } else {
    if (isBust(game.player1Hand) && isBust(game.player2Hand)) {
      draw = true;
      headlineEmoji = '🤝';
      headlineText = 'Both players busted — it\'s a draw!';
    } else if (p1Total > p2Total) {
      winner = { id: game.player1Id, name: game.player1Name };
      loser = { id: game.player2Id, name: game.player2Name };
      headlineEmoji = '🏆';
      headlineText = `${game.player1Name} wins on hand total! (${p1Total} vs ${p2Total})`;
    } else if (p2Total > p1Total) {
      winner = { id: game.player2Id, name: game.player2Name };
      loser = { id: game.player1Id, name: game.player1Name };
      headlineEmoji = '🏆';
      headlineText = `${game.player2Name} wins on hand total! (${p2Total} vs ${p1Total})`;
    } else {
      draw = true;
      headlineEmoji = '🤝';
      headlineText = `Perfect tie! Both players scored ${p1Total}.`;
    }
  }

  game.resultText = `${p1Label}\n${p2Label}\n\n${headlineEmoji} **${headlineText}**`;

  if (draw) {
    recordDraw(game.player1Id, game.player1Name, GAME_KEY);
    recordDraw(game.player2Id, game.player2Name, GAME_KEY);
  } else {
    recordWin(winner.id, winner.name, GAME_KEY);
    recordLoss(loser.id, loser.name, GAME_KEY);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const cmdBlackjack = new SlashCommandBuilder()
  .setName('blackjack')
  .setDescription('Challenge someone to multiplayer Blackjack!')
  .addUserOption(opt =>
    opt.setName('opponent')
      .setDescription('The player you want to challenge')
      .setRequired(true),
  );

export const blackjackCommands = [cmdBlackjack];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

export async function handleBlackjackInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'blackjack') {
      return await cmdBlackjackChallenge(interaction);
    }
    return false;
  }

  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id === 'bj_accept' || id === 'bj_decline') {
      return await handleChallengeResponse(interaction);
    }
    if (id === 'bj_hit' || id === 'bj_stand' || id === 'bj_double') {
      return await handleGameButton(interaction);
    }
    return false;
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHALLENGE FLOW
// ═════════════════════════════════════════════════════════════════════════════

async function cmdBlackjackChallenge(interaction) {
  const challenger = interaction.user;
  const opponent = interaction.options.getUser('opponent');

  if (!opponent) {
    await interaction.reply({ content: 'You must specify an opponent!', ephemeral: true });
    return true;
  }

  if (opponent.id === challenger.id) {
    await interaction.reply({ content: 'You can\'t challenge yourself!', ephemeral: true });
    return true;
  }

  if (opponent.bot) {
    await interaction.reply({ content: 'You can\'t challenge a bot!', ephemeral: true });
    return true;
  }

  const embed = buildChallengeEmbed(challenger.displayName, opponent.displayName);
  const components = buildChallengeButtons();

  const msg = await interaction.reply({
    content: `<@${opponent.id}>, you've been challenged!`,
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
    await interaction.reply({ content: 'This challenge has expired or no longer exists.', ephemeral: true });
    return true;
  }

  if (interaction.user.id !== challenge.opponentId) {
    await interaction.reply({ content: 'This challenge isn\'t for you!', ephemeral: true });
    return true;
  }

  const action = interaction.customId;

  if (action === 'bj_decline') {
    pendingChallenges.delete(msgId);

    const declinedEmbed = new EmbedBuilder()
      .setTitle('🃏 Blackjack Table')
      .setDescription(`❌ **${challenge.opponentName}** declined the challenge.`)
      .setColor(0x8B0000)
      .setFooter({ text: '♠ ♥ ♦ ♣  |  Challenge declined' });

    await interaction.update({ content: '', embeds: [declinedEmbed], components: [] });
    return true;
  }

  if (action === 'bj_accept') {
    pendingChallenges.delete(msgId);

    const deck = shuffle(createDeck());
    const player1Hand = [deck.pop(), deck.pop()];
    const player2Hand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];

    const game = {
      player1Id: challenge.challengerId,
      player1Name: challenge.challengerName,
      player2Id: challenge.opponentId,
      player2Name: challenge.opponentName,
      deck,
      player1Hand,
      player2Hand,
      dealerHand,
      currentPlayer: 1,
      phase: 'p1_turn',
      player1Doubled: false,
      player2Doubled: false,
      resultText: '',
      lastActivity: Date.now(),
    };

    if (isBlackjack(player1Hand)) {
      advanceFromP1(game);
    }

    if (game.phase === 'p2_turn' && isBlackjack(player2Hand)) {
      advanceFromP2(game);
    }

    games.set(msgId, game);

    const embed = buildGameEmbed(game);
    const components = buildGameButtons(game);

    await interaction.update({ content: '', embeds: [embed], components });
    return true;
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  IN-GAME BUTTON HANDLER
// ═════════════════════════════════════════════════════════════════════════════

async function handleGameButton(interaction) {
  const msgId = interaction.message.id;
  const game = games.get(msgId);

  if (!game) {
    await interaction.reply({ content: 'This game has ended or expired.', ephemeral: true });
    return true;
  }

  if (game.phase === 'over') {
    await interaction.reply({ content: 'This game is already over.', ephemeral: true });
    return true;
  }

  const userId = interaction.user.id;
  const isP1Turn = game.phase === 'p1_turn';
  const isP2Turn = game.phase === 'p2_turn';

  if (isP1Turn && userId !== game.player1Id) {
    if (userId === game.player2Id) {
      await interaction.reply({ content: `It's **${game.player1Name}**'s turn right now. Please wait!`, ephemeral: true });
    } else {
      await interaction.reply({ content: 'You\'re not in this game!', ephemeral: true });
    }
    return true;
  }

  if (isP2Turn && userId !== game.player2Id) {
    if (userId === game.player1Id) {
      await interaction.reply({ content: `It's **${game.player2Name}**'s turn right now. Please wait!`, ephemeral: true });
    } else {
      await interaction.reply({ content: 'You\'re not in this game!', ephemeral: true });
    }
    return true;
  }

  const action = interaction.customId;
  const hand = isP1Turn ? game.player1Hand : game.player2Hand;

  if (action === 'bj_hit') {
    hand.push(game.deck.pop());
    if (isBust(hand) || handValue(hand) === 21) {
      if (isP1Turn) {
        advanceFromP1(game);
      } else {
        advanceFromP2(game);
      }
    }
  } else if (action === 'bj_stand') {
    if (isP1Turn) {
      advanceFromP1(game);
    } else {
      advanceFromP2(game);
    }
  } else if (action === 'bj_double') {
    if (isP1Turn) game.player1Doubled = true;
    else game.player2Doubled = true;

    hand.push(game.deck.pop());

    if (isP1Turn) {
      advanceFromP1(game);
    } else {
      advanceFromP2(game);
    }
  }

  game.lastActivity = Date.now();

  const embed = buildGameEmbed(game);
  const components = buildGameButtons(game);

  await interaction.update({ embeds: [embed], components });

  if (game.phase === 'over') {
    games.delete(msgId);
  }

  return true;
}
