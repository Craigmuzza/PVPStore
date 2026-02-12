// poker.js
// ─────────────────────────────────────────────────────────────────────────────
// Texas Hold'em Poker table for 2–6 players.
// Lobby → deal → Pre-flop → Flop → Turn → River → Showdown → repeat.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';

import { recordWin, recordLoss } from './leaderboard.js';

const GAME_KEY = 'poker';

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const SMALL_BLIND    = 10;
const BIG_BLIND      = 20;
const RAISE_AMOUNT   = 50;
const STARTING_CHIPS = 1000;
const MIN_PLAYERS    = 2;
const MAX_PLAYERS    = 6;
const INACTIVITY_MS  = 10 * 60 * 1000; // 10 minutes

const SUITS  = ['♠', '♥', '♦', '♣'];
const RANKS  = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

// Phases
const PHASE_LOBBY    = 'lobby';
const PHASE_PREFLOP  = 'preflop';
const PHASE_FLOP     = 'flop';
const PHASE_TURN     = 'turn';
const PHASE_RIVER    = 'river';
const PHASE_SHOWDOWN = 'showdown';
const PHASE_GAMEOVER = 'gameover';

// Hand ranks (higher = better)
const HAND_HIGH_CARD       = 1;
const HAND_ONE_PAIR        = 2;
const HAND_TWO_PAIR        = 3;
const HAND_THREE_OF_A_KIND = 4;
const HAND_STRAIGHT        = 5;
const HAND_FLUSH           = 6;
const HAND_FULL_HOUSE      = 7;
const HAND_FOUR_OF_A_KIND  = 8;
const HAND_STRAIGHT_FLUSH  = 9;
const HAND_ROYAL_FLUSH     = 10;

const HAND_NAMES = {
  [HAND_HIGH_CARD]:       'High Card',
  [HAND_ONE_PAIR]:        'One Pair',
  [HAND_TWO_PAIR]:        'Two Pair',
  [HAND_THREE_OF_A_KIND]: 'Three of a Kind',
  [HAND_STRAIGHT]:        'Straight',
  [HAND_FLUSH]:           'Flush',
  [HAND_FULL_HOUSE]:      'Full House',
  [HAND_FOUR_OF_A_KIND]:  'Four of a Kind',
  [HAND_STRAIGHT_FLUSH]:  'Straight Flush',
  [HAND_ROYAL_FLUSH]:     'Royal Flush',
};

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

/** @type {Map<string, object>} keyed by message ID */
const games = new Map();

function touchGame(state) {
  state.lastActivity = Date.now();
}

function cleanExpired() {
  const now = Date.now();
  for (const [id, state] of games) {
    if (now - state.lastActivity > INACTIVITY_MS) {
      games.delete(id);
    }
  }
}

// Run cleanup every 60 seconds
setInterval(cleanExpired, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
//  DECK & CARD HELPERS
// ═════════════════════════════════════════════════════════════════════════════

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

function formatCards(cards) {
  return cards.map(formatCard).join(' ');
}

// ═════════════════════════════════════════════════════════════════════════════
//  HAND EVALUATION — best 5 of 7
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Generate all C(n,5) combinations from an array.
 */
function combinations(arr, k) {
  const result = [];
  function bt(start, combo) {
    if (combo.length === k) { result.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      bt(i + 1, combo);
      combo.pop();
    }
  }
  bt(0, []);
  return result;
}

/**
 * Evaluate exactly 5 cards → { rank, values }
 * values is an array used for tie-breaking (descending importance).
 */
function evaluate5(cards) {
  const vals = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  // Check straight (including A-low: A 2 3 4 5)
  let isStraight = false;
  let straightHigh = 0;
  const unique = [...new Set(vals)].sort((a, b) => b - a);

  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) {
      isStraight = true;
      straightHigh = unique[0];
    }
    // Ace-low straight: A 5 4 3 2
    if (!isStraight && unique[0] === 14 && unique[1] === 5 && unique[2] === 4 && unique[3] === 3 && unique[4] === 2) {
      isStraight = true;
      straightHigh = 5; // 5-high straight
    }
  }

  // Count ranks
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;

  const groups = Object.entries(counts)
    .map(([v, c]) => ({ val: parseInt(v), count: c }))
    .sort((a, b) => b.count - a.count || b.val - a.val);

  const pattern = groups.map(g => g.count).join('');

  // Royal flush
  if (isFlush && isStraight && straightHigh === 14) {
    return { rank: HAND_ROYAL_FLUSH, values: [14] };
  }
  // Straight flush
  if (isFlush && isStraight) {
    return { rank: HAND_STRAIGHT_FLUSH, values: [straightHigh] };
  }
  // Four of a kind
  if (pattern === '41') {
    return { rank: HAND_FOUR_OF_A_KIND, values: [groups[0].val, groups[1].val] };
  }
  // Full house
  if (pattern === '32') {
    return { rank: HAND_FULL_HOUSE, values: [groups[0].val, groups[1].val] };
  }
  // Flush
  if (isFlush) {
    return { rank: HAND_FLUSH, values: vals };
  }
  // Straight
  if (isStraight) {
    return { rank: HAND_STRAIGHT, values: [straightHigh] };
  }
  // Three of a kind
  if (pattern === '311') {
    return { rank: HAND_THREE_OF_A_KIND, values: [groups[0].val, groups[1].val, groups[2].val] };
  }
  // Two pair
  if (pattern === '221') {
    return { rank: HAND_TWO_PAIR, values: [groups[0].val, groups[1].val, groups[2].val] };
  }
  // One pair
  if (pattern === '2111') {
    return { rank: HAND_ONE_PAIR, values: [groups[0].val, groups[1].val, groups[2].val, groups[3].val] };
  }
  // High card
  return { rank: HAND_HIGH_CARD, values: vals };
}

/**
 * Find the best 5-card hand from 7 (or fewer) cards.
 */
function bestHand(cards) {
  if (cards.length <= 5) return evaluate5(cards);

  const combos = combinations(cards, 5);
  let best = null;
  for (const combo of combos) {
    const result = evaluate5(combo);
    if (!best || compareHands(result, best) > 0) {
      best = result;
    }
  }
  return best;
}

/**
 * Compare two evaluated hands. Returns >0 if a wins, <0 if b wins, 0 if tie.
 */
function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) {
    const av = a.values[i] ?? 0;
    const bv = b.values[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME LOGIC HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function createPlayer(id, name) {
  return {
    id,
    name,
    chips: STARTING_CHIPS,
    hand: [],
    folded: false,
    currentBet: 0,
    allIn: false,
    eliminated: false,
  };
}

function activePlayers(state) {
  return state.players.filter(p => !p.folded && !p.eliminated);
}

function playersInHand(state) {
  return state.players.filter(p => !p.eliminated);
}

function playersStillBetting(state) {
  return state.players.filter(p => !p.folded && !p.eliminated && !p.allIn);
}

/**
 * Advance currentPlayerIndex to the next player who can act.
 * Returns false if no one can act (round over).
 */
function advancePlayer(state) {
  const total = state.players.length;
  for (let i = 1; i <= total; i++) {
    const idx = (state.currentPlayerIndex + i) % total;
    const p = state.players[idx];
    if (!p.folded && !p.eliminated && !p.allIn) {
      state.currentPlayerIndex = idx;
      return true;
    }
  }
  return false;
}

/**
 * Check if the current betting round is complete.
 * A round is complete when all non-folded, non-all-in players have matched
 * the current bet AND have had a chance to act.
 */
function isBettingRoundComplete(state) {
  const bettors = playersStillBetting(state);
  if (bettors.length === 0) return true;
  if (bettors.length === 1 && activePlayers(state).length === 1) return true;

  // Everyone who can act has matched the bet and has acted
  return bettors.every(p => p.currentBet === state.currentBet && p.hasActed);
}

/**
 * Reset per-round betting state for a new betting round.
 */
function resetBettingRound(state) {
  for (const p of state.players) {
    p.currentBet = 0;
    p.hasActed = false;
  }
  state.currentBet = 0;
}

/**
 * Post blinds and set up for pre-flop.
 */
function postBlinds(state) {
  const total = state.players.length;
  const inHand = playersInHand(state);

  // Small blind
  const sbIdx = (state.dealerIndex + (inHand.length === 2 ? 0 : 1)) % total;
  let sbPlayer = state.players[sbIdx];
  // Skip eliminated players for blind posting
  let sbSearch = sbIdx;
  for (let i = 0; i < total; i++) {
    sbSearch = (sbIdx + i) % total;
    if (!state.players[sbSearch].eliminated) { sbPlayer = state.players[sbSearch]; break; }
  }
  const sbAmount = Math.min(SMALL_BLIND, sbPlayer.chips);
  sbPlayer.chips -= sbAmount;
  sbPlayer.currentBet = sbAmount;
  state.pot += sbAmount;
  if (sbPlayer.chips === 0) sbPlayer.allIn = true;

  // Big blind
  let bbSearch = (sbSearch + 1) % total;
  let bbPlayer = state.players[bbSearch];
  for (let i = 0; i < total; i++) {
    const idx = (bbSearch + i) % total;
    if (!state.players[idx].eliminated) { bbPlayer = state.players[idx]; bbSearch = idx; break; }
  }
  const bbAmount = Math.min(BIG_BLIND, bbPlayer.chips);
  bbPlayer.chips -= bbAmount;
  bbPlayer.currentBet = bbAmount;
  state.pot += bbAmount;
  if (bbPlayer.chips === 0) bbPlayer.allIn = true;

  state.currentBet = BIG_BLIND;
  state.smallBlindIndex = sbSearch;
  state.bigBlindIndex = bbSearch;

  // First to act is player after big blind
  let firstAct = (bbSearch + 1) % total;
  for (let i = 0; i < total; i++) {
    const idx = (firstAct + i) % total;
    if (!state.players[idx].eliminated && !state.players[idx].allIn) {
      state.currentPlayerIndex = idx;
      return;
    }
  }
  // Everyone is all in from blinds
  state.currentPlayerIndex = -1;
}

/**
 * Deal a new hand — shuffle deck, deal 2 cards each, post blinds.
 */
function dealNewHand(state) {
  state.deck = shuffle(createDeck());
  state.communityCards = [];
  state.pot = 0;
  state.currentBet = 0;
  state.phase = PHASE_PREFLOP;
  state.handNumber = (state.handNumber || 0) + 1;

  // Reset player hand state
  for (const p of state.players) {
    p.hand = [];
    p.folded = false;
    p.currentBet = 0;
    p.allIn = false;
    p.hasActed = false;
    if (p.eliminated) continue;
  }

  // Deal 2 hole cards to each non-eliminated player
  for (const p of state.players) {
    if (p.eliminated) continue;
    p.hand.push(state.deck.pop(), state.deck.pop());
  }

  postBlinds(state);
  touchGame(state);
}

/**
 * Advance the dealer position (skip eliminated players).
 */
function advanceDealer(state) {
  const total = state.players.length;
  for (let i = 1; i <= total; i++) {
    const idx = (state.dealerIndex + i) % total;
    if (!state.players[idx].eliminated) {
      state.dealerIndex = idx;
      return;
    }
  }
}

/**
 * Deal community cards based on the new phase.
 */
function dealCommunity(state) {
  state.deck.pop(); // burn card
  if (state.phase === PHASE_FLOP) {
    state.communityCards.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
  } else if (state.phase === PHASE_TURN || state.phase === PHASE_RIVER) {
    state.communityCards.push(state.deck.pop());
  }
}

/**
 * Move to the next phase of the hand, or go to showdown.
 */
function advancePhase(state) {
  const active = activePlayers(state);

  // Only one player left — they win
  if (active.length === 1) {
    resolveWinner(state);
    return;
  }

  const nextPhase = {
    [PHASE_PREFLOP]: PHASE_FLOP,
    [PHASE_FLOP]:    PHASE_TURN,
    [PHASE_TURN]:    PHASE_RIVER,
    [PHASE_RIVER]:   PHASE_SHOWDOWN,
  };

  const next = nextPhase[state.phase];
  if (!next || next === PHASE_SHOWDOWN) {
    // Showdown
    resolveShowdown(state);
    return;
  }

  state.phase = next;
  dealCommunity(state);
  resetBettingRound(state);

  // First to act post-flop: first active player after dealer
  const total = state.players.length;
  for (let i = 1; i <= total; i++) {
    const idx = (state.dealerIndex + i) % total;
    const p = state.players[idx];
    if (!p.folded && !p.eliminated && !p.allIn) {
      state.currentPlayerIndex = idx;
      break;
    }
  }

  // If everyone remaining is all-in, fast-forward through remaining community cards
  if (playersStillBetting(state).length === 0) {
    advancePhase(state);
  }
}

/**
 * Resolve when all but one player has folded.
 */
function resolveWinner(state) {
  const winner = activePlayers(state)[0];
  winner.chips += state.pot;
  state.lastResult = `**${winner.name}** wins **${state.pot}** chips! Everyone else folded.`;
  state.pot = 0;
  state.phase = PHASE_SHOWDOWN;
  finishHand(state);
}

/**
 * Resolve showdown — compare hands, award pot.
 */
function resolveShowdown(state) {
  const active = activePlayers(state);

  // Evaluate each player's best hand
  const evaluated = active.map(p => {
    const allCards = [...p.hand, ...state.communityCards];
    const best = bestHand(allCards);
    return { player: p, hand: best };
  });

  // Sort by hand strength descending
  evaluated.sort((a, b) => compareHands(b.hand, a.hand));

  // Check for ties at the top
  const winners = [evaluated[0]];
  for (let i = 1; i < evaluated.length; i++) {
    if (compareHands(evaluated[i].hand, evaluated[0].hand) === 0) {
      winners.push(evaluated[i]);
    } else {
      break;
    }
  }

  // Split pot among winners
  const share = Math.floor(state.pot / winners.length);
  const remainder = state.pot - share * winners.length;

  const winnerNames = [];
  for (let i = 0; i < winners.length; i++) {
    const wp = winners[i].player;
    wp.chips += share + (i === 0 ? remainder : 0);
    winnerNames.push(wp.name);
  }

  const bestHandName = HAND_NAMES[winners[0].hand.rank];
  const handCards = active.map(p =>
    `${p.name}: ${formatCards(p.hand)}`
  ).join('\n');

  if (winners.length === 1) {
    state.lastResult = `**${winnerNames[0]}** wins **${state.pot}** chips with **${bestHandName}**!\n\n${handCards}`;
  } else {
    state.lastResult = `**Split pot!** ${winnerNames.join(' & ')} tie with **${bestHandName}** — **${share}** chips each.\n\n${handCards}`;
  }

  state.pot = 0;
  state.phase = PHASE_SHOWDOWN;
  finishHand(state);
}

/**
 * After a hand resolves: eliminate broke players, check if game is over,
 * or set up for next hand.
 */
function finishHand(state) {
  // Eliminate players with 0 chips
  for (const p of state.players) {
    if (!p.eliminated && p.chips <= 0) {
      p.eliminated = true;
      p.chips = 0;
    }
  }

  const remaining = state.players.filter(p => !p.eliminated);
  if (remaining.length <= 1) {
    state.phase = PHASE_GAMEOVER;
    if (remaining.length === 1) {
      state.overallWinner = remaining[0];
      state.lastResult += `\n\n🏆 **${remaining[0].name}** wins the poker game!`;
    }
  } else {
    state.readyForNextHand = true;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  EMBED & BUTTON BUILDERS
// ═════════════════════════════════════════════════════════════════════════════

function buildLobbyEmbed(state) {
  const playerList = state.players.map((p, i) =>
    `${i + 1}. **${p.name}** ${p.id === state.hostId ? '(Host)' : ''}`
  ).join('\n') || '_No players yet_';

  return new EmbedBuilder()
    .setTitle('🃏 Texas Hold\'em Poker')
    .setDescription(
      `**Host:** <@${state.hostId}>\n` +
      `**Players (${state.players.length}/${MAX_PLAYERS}):**\n${playerList}\n\n` +
      `Need at least **${MIN_PLAYERS}** players to start.\n` +
      `Everyone starts with **${STARTING_CHIPS}** chips.`
    )
    .setColor(0x2ECC71)
    .setFooter({ text: 'Click Join to enter, Host clicks Start to begin.' });
}

function buildLobbyButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pkr_join').setLabel('Join').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('pkr_start').setLabel('Start Game').setStyle(ButtonStyle.Primary),
  );
}

function buildGameEmbed(state) {
  const communityStr = buildCommunityDisplay(state);
  const phaseLabel = {
    [PHASE_PREFLOP]: 'Pre-Flop',
    [PHASE_FLOP]:    'Flop',
    [PHASE_TURN]:    'Turn',
    [PHASE_RIVER]:   'River',
    [PHASE_SHOWDOWN]:'Showdown',
    [PHASE_GAMEOVER]:'Game Over',
  }[state.phase] || state.phase;

  const dealerPlayer = state.players[state.dealerIndex];
  const currentPlayer = state.currentPlayerIndex >= 0 ? state.players[state.currentPlayerIndex] : null;

  const playerLines = state.players.map((p, i) => {
    if (p.eliminated) return `~~${p.name}~~ — Eliminated`;
    const markers = [];
    if (i === state.dealerIndex) markers.push('🔘 Dealer');
    if (i === state.smallBlindIndex) markers.push('SB');
    if (i === state.bigBlindIndex) markers.push('BB');
    const markStr = markers.length ? ` (${markers.join(', ')})` : '';

    let status = '';
    if (p.folded) status = ' — *Folded*';
    else if (p.allIn) status = ' — **ALL IN**';
    else if (state.currentPlayerIndex === i && state.phase !== PHASE_SHOWDOWN && state.phase !== PHASE_GAMEOVER) status = ' 👈';

    return `**${p.name}**${markStr}: ${p.chips} chips${status}`;
  }).join('\n');

  let description =
    `**Phase:** ${phaseLabel} | **Hand #${state.handNumber || 1}**\n` +
    `**Community:** ${communityStr}\n` +
    `**Pot:** ${state.pot} chips` +
    (state.currentBet > 0 ? ` | **Current Bet:** ${state.currentBet}` : '') +
    `\n\n**Players:**\n${playerLines}`;

  if (currentPlayer && state.phase !== PHASE_SHOWDOWN && state.phase !== PHASE_GAMEOVER) {
    description += `\n\n⏳ Waiting for **${currentPlayer.name}** to act...`;
  }

  if (state.lastResult) {
    description += `\n\n━━━━━━━━━━━━━━━━━━━━\n${state.lastResult}`;
  }

  const embed = new EmbedBuilder()
    .setTitle('🃏 Texas Hold\'em Poker')
    .setDescription(description)
    .setColor(state.phase === PHASE_GAMEOVER ? 0xFFD700 : 0x2ECC71)
    .setFooter({ text: 'Use "View Cards" to see your hole cards.' });

  return embed;
}

function buildCommunityDisplay(state) {
  const total = 5;
  const revealed = state.communityCards.length;
  const cards = state.communityCards.map(formatCard);
  while (cards.length < total) cards.push('??');
  return cards.join('  ');
}

function buildBettingButtons(state) {
  const player = state.players[state.currentPlayerIndex];
  if (!player) return [];

  const canCheck = player.currentBet >= state.currentBet;
  const callAmount = state.currentBet - player.currentBet;
  const canCall = callAmount > 0 && callAmount < player.chips;
  const canRaise = player.chips > callAmount + RAISE_AMOUNT;

  const row1 = new ActionRowBuilder();

  if (canCheck) {
    row1.addComponents(
      new ButtonBuilder().setCustomId('pkr_check').setLabel('Check').setStyle(ButtonStyle.Secondary),
    );
  }

  if (canCall) {
    row1.addComponents(
      new ButtonBuilder().setCustomId('pkr_call').setLabel(`Call (${callAmount})`).setStyle(ButtonStyle.Primary),
    );
  }

  if (canRaise) {
    row1.addComponents(
      new ButtonBuilder().setCustomId('pkr_raise').setLabel(`Raise (+${RAISE_AMOUNT})`).setStyle(ButtonStyle.Primary),
    );
  }

  row1.addComponents(
    new ButtonBuilder().setCustomId('pkr_allin').setLabel('All In').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('pkr_fold').setLabel('Fold').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pkr_viewcards').setLabel('View Cards').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2];
}

function buildShowdownButtons(state) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pkr_viewcards').setLabel('View Cards').setStyle(ButtonStyle.Secondary),
    ),
  ];

  if (state.readyForNextHand) {
    rows[0].addComponents(
      new ButtonBuilder().setCustomId('pkr_nexthand').setLabel('Next Hand').setStyle(ButtonStyle.Success),
    );
  }

  return rows;
}

function buildGameOverButtons() {
  return []; // No buttons at game over
}

function getComponents(state) {
  if (state.phase === PHASE_LOBBY) return [buildLobbyButtons()];
  if (state.phase === PHASE_GAMEOVER) return buildGameOverButtons();
  if (state.phase === PHASE_SHOWDOWN) return buildShowdownButtons(state);
  return buildBettingButtons(state);
}

function getEmbed(state) {
  if (state.phase === PHASE_LOBBY) return buildLobbyEmbed(state);
  return buildGameEmbed(state);
}

// ═════════════════════════════════════════════════════════════════════════════
//  UPDATE MESSAGE HELPER
// ═════════════════════════════════════════════════════════════════════════════

async function updateMessage(interaction, state) {
  const embed = getEmbed(state);
  const components = getComponents(state);

  try {
    await interaction.message.edit({ embeds: [embed], components });
  } catch {
    // Message may have been deleted
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  BETTING ACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

function processBet(state, action) {
  const player = state.players[state.currentPlayerIndex];
  if (!player) return;

  switch (action) {
    case 'check': {
      player.hasActed = true;
      break;
    }

    case 'call': {
      const callAmount = Math.min(state.currentBet - player.currentBet, player.chips);
      player.chips -= callAmount;
      player.currentBet += callAmount;
      state.pot += callAmount;
      player.hasActed = true;
      if (player.chips === 0) player.allIn = true;
      break;
    }

    case 'raise': {
      const callFirst = state.currentBet - player.currentBet;
      const totalCost = callFirst + RAISE_AMOUNT;
      const actual = Math.min(totalCost, player.chips);
      player.chips -= actual;
      player.currentBet += actual;
      state.pot += actual;
      state.currentBet = player.currentBet;
      player.hasActed = true;
      if (player.chips === 0) player.allIn = true;

      // Reset hasActed for others since there's a new bet to match
      for (const p of state.players) {
        if (p !== player && !p.folded && !p.eliminated && !p.allIn) {
          p.hasActed = false;
        }
      }
      break;
    }

    case 'fold': {
      player.folded = true;
      player.hasActed = true;
      break;
    }

    case 'allin': {
      const amount = player.chips;
      player.currentBet += amount;
      state.pot += amount;
      player.chips = 0;
      player.allIn = true;
      player.hasActed = true;
      if (player.currentBet > state.currentBet) {
        state.currentBet = player.currentBet;
        // Reset hasActed for others
        for (const p of state.players) {
          if (p !== player && !p.folded && !p.eliminated && !p.allIn) {
            p.hasActed = false;
          }
        }
      }
      break;
    }
  }

  // Check if only one active player remains
  const active = activePlayers(state);
  if (active.length === 1) {
    resolveWinner(state);
    return;
  }

  // Check if betting round is complete
  if (isBettingRoundComplete(state)) {
    advancePhase(state);
  } else {
    advancePlayer(state);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const cmdPoker = new SlashCommandBuilder()
  .setName('poker')
  .setDescription('Start a Texas Hold\'em Poker table (2–6 players)');

export const pokerCommands = [cmdPoker];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

export async function handlePokerInteraction(interaction) {
  // ── Slash command: create lobby ──────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'poker') {
    const hostId = interaction.user.id;
    const hostName = interaction.user.displayName || interaction.user.username;

    const state = {
      hostId,
      phase: PHASE_LOBBY,
      players: [createPlayer(hostId, hostName)],
      deck: [],
      communityCards: [],
      pot: 0,
      currentBet: 0,
      dealerIndex: 0,
      currentPlayerIndex: -1,
      smallBlindIndex: -1,
      bigBlindIndex: -1,
      handNumber: 0,
      lastResult: null,
      readyForNextHand: false,
      lastActivity: Date.now(),
      messageId: null,
    };

    const embed = buildLobbyEmbed(state);
    const components = [buildLobbyButtons()];

    const reply = await interaction.reply({ embeds: [embed], components, fetchReply: true });
    state.messageId = reply.id;
    games.set(reply.id, state);
    return true;
  }

  // ── Button interactions ──────────────────────────────────────────────────
  if (!interaction.isButton()) return false;

  const customId = interaction.customId;
  if (!customId.startsWith('pkr_')) return false;

  const messageId = interaction.message.id;
  const state = games.get(messageId);

  if (!state) {
    await interaction.reply({ content: 'This poker game has expired.', ephemeral: true });
    return true;
  }

  touchGame(state);

  const userId = interaction.user.id;
  const userName = interaction.user.displayName || interaction.user.username;

  // ── LOBBY: Join ─────────────────────────────────────────────────────────
  if (customId === 'pkr_join') {
    if (state.phase !== PHASE_LOBBY) {
      await interaction.reply({ content: 'The game has already started.', ephemeral: true });
      return true;
    }
    if (state.players.some(p => p.id === userId)) {
      await interaction.reply({ content: 'You\'re already in the game!', ephemeral: true });
      return true;
    }
    if (state.players.length >= MAX_PLAYERS) {
      await interaction.reply({ content: `The table is full (${MAX_PLAYERS} players max).`, ephemeral: true });
      return true;
    }

    state.players.push(createPlayer(userId, userName));

    await interaction.update({
      embeds: [buildLobbyEmbed(state)],
      components: [buildLobbyButtons()],
    });
    return true;
  }

  // ── LOBBY: Start ────────────────────────────────────────────────────────
  if (customId === 'pkr_start') {
    if (state.phase !== PHASE_LOBBY) {
      await interaction.reply({ content: 'The game has already started.', ephemeral: true });
      return true;
    }
    if (userId !== state.hostId) {
      await interaction.reply({ content: 'Only the host can start the game.', ephemeral: true });
      return true;
    }
    if (state.players.length < MIN_PLAYERS) {
      await interaction.reply({ content: `Need at least **${MIN_PLAYERS}** players to start.`, ephemeral: true });
      return true;
    }

    // Start the game — deal first hand
    dealNewHand(state);
    state.lastResult = null;

    await interaction.update({
      embeds: [getEmbed(state)],
      components: getComponents(state),
    });
    return true;
  }

  // ── View Cards ──────────────────────────────────────────────────────────
  if (customId === 'pkr_viewcards') {
    const player = state.players.find(p => p.id === userId);
    if (!player) {
      await interaction.reply({ content: 'You\'re not in this game.', ephemeral: true });
      return true;
    }
    if (player.eliminated) {
      await interaction.reply({ content: 'You\'ve been eliminated.', ephemeral: true });
      return true;
    }
    if (player.hand.length === 0) {
      await interaction.reply({ content: 'Cards haven\'t been dealt yet.', ephemeral: true });
      return true;
    }

    const handStr = formatCards(player.hand);
    const handEval = bestHand([...player.hand, ...state.communityCards]);
    const evalStr = state.communityCards.length > 0
      ? `\nBest hand: **${HAND_NAMES[handEval.rank]}**`
      : '';

    await interaction.reply({
      content: `🂠 Your hole cards: **${handStr}**${evalStr}`,
      ephemeral: true,
    });
    return true;
  }

  // ── Next Hand ───────────────────────────────────────────────────────────
  if (customId === 'pkr_nexthand') {
    if (!state.readyForNextHand) {
      await interaction.reply({ content: 'Not ready for the next hand.', ephemeral: true });
      return true;
    }
    if (!state.players.some(p => p.id === userId && !p.eliminated)) {
      await interaction.reply({ content: 'You\'re not an active player.', ephemeral: true });
      return true;
    }

    state.readyForNextHand = false;
    state.lastResult = null;
    advanceDealer(state);
    dealNewHand(state);

    await interaction.update({
      embeds: [getEmbed(state)],
      components: getComponents(state),
    });
    return true;
  }

  // ── Betting actions ─────────────────────────────────────────────────────
  const bettingActions = {
    'pkr_check': 'check',
    'pkr_call':  'call',
    'pkr_raise': 'raise',
    'pkr_fold':  'fold',
    'pkr_allin': 'allin',
  };

  const action = bettingActions[customId];
  if (!action) return false;

  // Verify it's a valid game phase
  if (![PHASE_PREFLOP, PHASE_FLOP, PHASE_TURN, PHASE_RIVER].includes(state.phase)) {
    await interaction.reply({ content: 'No betting happening right now.', ephemeral: true });
    return true;
  }

  // Verify it's this player's turn
  if (state.currentPlayerIndex < 0 || state.players[state.currentPlayerIndex].id !== userId) {
    await interaction.reply({ content: 'It\'s not your turn.', ephemeral: true });
    return true;
  }

  const player = state.players[state.currentPlayerIndex];

  // Validate specific actions
  if (action === 'check' && player.currentBet < state.currentBet) {
    await interaction.reply({ content: `You can't check — there's a bet of **${state.currentBet}** to match.`, ephemeral: true });
    return true;
  }

  if (action === 'call') {
    const callAmount = state.currentBet - player.currentBet;
    if (callAmount <= 0) {
      await interaction.reply({ content: 'Nothing to call — try checking instead.', ephemeral: true });
      return true;
    }
  }

  // Process the action
  processBet(state, action);

  // Record leaderboard entries at game over
  if (state.phase === PHASE_GAMEOVER) {
    for (const p of state.players) {
      if (state.overallWinner && p.id === state.overallWinner.id) {
        recordWin(p.id, p.name, GAME_KEY);
      } else {
        recordLoss(p.id, p.name, GAME_KEY);
      }
    }
  }

  await interaction.update({
    embeds: [getEmbed(state)],
    components: getComponents(state),
  });
  return true;
}
