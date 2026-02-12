// wordle.js
// ─────────────────────────────────────────────────────────────────────────────
// Multiplayer Wordle Duel — two players alternate guesses on the same secret
// word. First to solve wins; both fail = draw.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { recordWin, recordLoss, recordDraw } from './leaderboard.js';

const GAME_KEY = 'wordle';
const EXPIRY_MS = 10 * 60 * 1000;
const MAX_GUESSES = 6;
const WORDLE_GREEN = 0x538D4E;

// ═════════════════════════════════════════════════════════════════════════════
//  WORD LISTS
// ═════════════════════════════════════════════════════════════════════════════

const ANSWERS = [
  'about','above','abuse','actor','adapt','admit','adopt','adult','after','again',
  'agent','agree','ahead','alarm','album','alert','alike','alive','allow','alone',
  'along','alter','among','angel','anger','angle','angry','apart','apple','apply',
  'arena','argue','arise','array','asset','avoid','awake','award','aware','badly',
  'baker','bases','basic','beast','begin','being','below','bench','birth','black',
  'blade','blame','blank','blast','bleed','blind','block','blood','blown','blues',
  'board','bones','bound','brain','brand','brave','bread','break','breed','brick',
  'bring','broad','brown','build','bunch','burst','buyer','cabin','chain','chair',
  'charm','chase','cheap','check','chief','child','china','claim','class','clean',
  'clear','climb','clock','close','cloud','coach','coast','color','could','count',
  'court','cover','crack','craft','crash','crazy','cream','crime','cross','crowd',
  'crown','cruel','crush','curve','cycle','daily','dance','death','delay','depth',
  'dirty','doubt','dough','dozen','draft','drain','drama','drawn','dream','dress',
  'drink','drive','drops','drove','dying','eager','eagle','early','earth','eight',
  'elect','elite','empty','enemy','enjoy','enter','equal','error','event','every',
  'exact','exist','extra','faith','false','fault','fever','field','fifth','fifty',
  'fight','final','flame','flash','fleet','flesh','float','flood','floor','focus',
  'force','forth','found','frame','frank','fresh','front','fruit','fully','funny',
  'giant','given','glass','globe','going','grace','grade','grain','grand','grant',
  'grass','grave','great','green','gross','group','grown','guard','guess','guide',
  'happy','heart','heavy','hello','horse','hotel','house','human','ideal','image',
  'index','inner','input','issue','juice','knife','known','label','large','laser',
  'later','laugh','layer','learn','legal','level','light','limit','links','lives',
  'local','loose','lover','lower','lucky','lunch','magic','major','maker','march',
  'match','mayor','media','mercy','metal','might','minor','minus','model','money',
  'month','moral','motor','mount','mouse','mouth','moved','movie','music','noble',
  'noise','north','noted','novel','nurse','occur','ocean','offer','often','order',
  'other','outer','ought','paint','panel','paper','party','patch','peace','penny',
  'phase','phone','photo','piano','piece','pilot','pitch','place','plain','plane',
  'plant','plate','plaza','point','pound','power','press','price','pride','prime',
  'print','prior','prize','proof','proud','prove','queen','quick','quiet','quite',
  'quote','radio','raise','range','rapid','ratio','reach','ready','realm','reign',
  'relax','reply','right','river','robin','rough','round','route','royal','rural',
  'sadly','saint','salad','scale','scene','scope','score','sense','serve','seven',
  'shake','shall','shape','share','sharp','sheet','shelf','shell','shift','shine',
  'shirt','shock','shoot','shore','short','shout','sight','since','sixth','sixty',
  'skill','sleep','slide','small','smart','smile','smoke','solid','solve','sorry',
  'south','space','spare','speak','speed','spend','split','sport','spray','squad',
  'stack','staff','stage','stair','stake','stand','stark','start','state','steam',
  'steel','steep','stick','still','stock','stone','stood','store','storm','story',
  'strip','stuck','study','stuff','style','sugar','suite','super','sweet','swing',
  'table','taste','teach','thank','theme','thick','thing','think','third','those',
  'three','throw','tight','tired','title','today','topic','total','touch','tough',
  'tower','track','trade','trail','train','trait','trend','trial','tribe','trick',
  'truck','truly','trust','truth','twice','twist','ultra','uncle','under','union',
  'unite','unity','until','upper','upset','urban','usage','usual','valid','value',
  'video','virus','visit','vital','voice','waste','watch','water','weigh','wheel',
  'where','which','while','white','whole','whose','wider','woman','world','worry',
  'worse','worst','worth','would','wound','write','wrong','wrote','yield','young',
  'youth',
];

const EXTRA_GUESSES = [
  'aahed','aalii','abaci','aback','abaft','abase','abash','abate','abaya','abbey',
  'abbot','abhor','abide','abler','abmho','abode','abort','aboil','abord','abore',
  'abram','abray','abrim','abrin','absit','abuna','abune','abuts','abuzz','abyes',
  'abysm','abyss','acerb','aceta','ached','aches','achoo','acids','acing','acini',
  'ackee','acmes','acned','acnes','acold','acorn','acred','acres','acrid','actin',
  'acton','acute','adage','added','adder','addle','adeem','adept','adhan','adieu',
  'adios','admin','admix','adobe','adopt','adore','adorn','adoze','aduki','adunc',
  'adust','adyta','adzed','adzes','aegis','aeons','aerie','afoot','afore','afoul',
  'afrit','agama','agami','agape','agars','agate','agave','agaze','agene','agers',
  'aggie','aggro','aghas','agile','aging','agios','agism','agist','agita','aglee',
  'aglet','agley','aglow','agmas','agoge','agone','agons','agony','agora','agria',
  'agrin','agros','agued','agues','aguna','aguti','aided','aider','aides','aimed',
  'aimer','aioli','aired','aisle','aitch','ajuga','akees','akela','akene','akita',
  'alack','alamo','alang','alans','alant','alarm','album','alder','aldol','aleck',
  'aleph','algae','algid','algin','algum','alias','alibi','alien','align','aline',
  'allay','allee','allel','alley','allot','alloy','allyl','almah','almas','almeh',
  'almud','alods','aloed','aloes','aloft','aloha','aloin','aloof','aloud','alpha',
  'altar','alter','altho','altos','alula','alums','amass','amaze','amber','ambit',
  'amble','ambos','ambry','ameba','amend','amens','ament','amice','amide','amido',
  'amids','amies','amiga','amigo','amine','amino','amiss','amity','ammos','amnio',
  'amoks','amole','amort','amour','ample','amply','ampul','amrit','amuck','amuse',
  'ancho','angel','anger','angle','angry','angst','anile','anils','anima','anime',
  'anion','anise','ankle','ankus','annas','annex','annoy','annul','anode','anole',
  'antic','antis','antsy','anvil','aorta','apace','apart','aphid','aping','apnea',
  'apple','apply','apron','apter','arbor','arced','ardor','areae','areal','areas',
  'arena','argue','arise','armed','armor','aroma','arose','array','arrow','arses',
  'arson','ashen','ashes','aside','asked','asker','aspen','aspic','assay','aster',
  'astir','atlas','atoll','atoms','atone','attic','audio','audit','auger','augur',
  'aural','avail','avant','avast','avian','avoid','await','awake','award','aware',
  'awful','awing','awned','axial','axils','axion','axled','axles','axone','axons',
  'azote','azure','babel','backs','bacon','badge','badly','bagel','baggy','bails',
  'baker','balls','bands','banjo','banks','baron','bases','basic','basin','basis',
  'batch','bathe','baton','beach','beads','beams','beans','beard','bears','beast',
  'beats','beech','beefs','beers','began','begin','begun','being','below','belts',
  'bench','berry','bible','bikes','bills','binds','bingo','biome','birds','birth',
  'bites','black','blade','blame','bland','blank','blare','blast','blaze','bleak',
  'bleat','bleed','blend','bless','blimp','blind','blink','bliss','blitz','bloat',
  'block','bloke','blond','blood','bloom','blown','blues','bluff','blunt','blurb',
  'blurt','blush','board','boats','bogus','boils','bolts','bombs','bonds','bones',
  'bonus','books','boost','booth','boots','borax','bored','borne','bosom','bossy',
  'botch','bound','bowed','bowel','boxer','boxes','brace','braid','brain','brake',
  'brand','brass','brave','brawn','bread','break','brews','brick','bride','brief',
  'brine','bring','brink','brisk','broad','broil','broke','brood','brook','broom',
  'broth','brown','brush','brute','buddy','budge','buggy','bugle','build','built',
  'bulge','bulky','bulls','bully','bumps','bumpy','bunch','bunks','bunny','burst',
  'buses','bushy','buyer','bytes','cabal','cabin','cable','cadet','camel','cameo',
  'camps','candy','canoe','caper','cards','cargo','carol','carry','carve','catch',
  'cater','cause','cease','cedar','chain','chair','chalk','champ','chant','chaos',
  'charm','chart','chase','cheap','cheat','check','cheek','cheer','chess','chest',
  'chick','chief','child','chill','china','chips','choir','chord','chore','chose',
  'chunk','churn','cider','cigar','cinch','circa','civic','civil','claim','clamp',
  'clang','clank','clash','clasp','class','claws','clean','clear','clerk','click',
  'cliff','climb','cling','clink','cloak','clock','clone','close','cloth','cloud',
  'clown','clubs','cluck','clued','clues','clung','clunk','coach','coast','cobra',
  'cocoa','coils','coins','colon','color','comet','comic','comma','condo','coral',
  'cords','cores','corps','couch','cough','could','count','coupe','court','cover',
  'crack','craft','cramp','crane','crank','crash','crate','crave','crawl','crazy',
  'creak','cream','creed','creep','crest','crews','crime','crisp','crook','crops',
  'cross','crowd','crown','crude','cruel','crush','crust','curly','curry','curse',
  'curve','cycle','cynic','decal','decay','decor','decoy','decry','defer','deity',
  'delay','delta','delve','demon','denim','dense','depot','depth','derby','deter',
  'detox','deuce','devil','diary','diner','dirty','disco','ditch','diver','dizzy',
  'dodge','dogma','doing','dolls','donor','donut','doubt','dough','douse','dowdy',
  'downs','dozen','draft','drain','drake','drama','drank','drape','drawl','drawn',
  'dread','dream','dress','dried','drift','drill','drink','drive','droit','drone',
  'drool','droop','drops','dross','drove','drown','drums','drunk','dryer','dryly',
  'ducks','duels','duets','dulls','dummy','dumps','dunce','dunes','dunks','dusty',
  'dwarf','dwell','dying','eager','eagle','early','earns','earth','eased','easel',
  'eater','eaves','ebbed','ebony','edged','edges','edict','eight','eject','elbow',
  'elder','elect','elite','elope','elude','elves','ember','emcee','emery','empty',
  'enact','ended','enemy','enjoy','ennui','ensue','enter','entry','envoy','epoch',
  'equal','equip','erase','erect','erode','error','erupt','essay','ether','ethic',
  'ethos','evade','event','every','evict','evils','evoke','exact','exalt','exams',
  'excel','exert','exile','exist','expat','expel','extra','exude','exult','fable',
  'facet','faded','fails','faint','fairy','faith','faked','falls','fancy','fangs',
  'farce','fatal','fatty','fault','fauna','feast','feats','fecal','feeds','feign',
  'feint','felon','fence','feral','ferry','fetal','fetch','fetid','fetus','fever',
  'fewer','fiber','fibre','field','fiend','fiery','fifty','fight','filch','filed',
  'filet','filly','films','filmy','filth','final','finch','finds','fined','finer',
  'fines','fired','firms','first','fishy','fixed','fixer','fizzy','fjord','flack',
  'flags','flair','flake','flaky','flame','flank','flaps','flare','flash','flask',
  'flats','flaws','fleas','fleck','fleet','flesh','flick','flier','flies','fling',
  'flint','flips','flirt','float','flock','flood','floor','flops','flora','floss',
  'flour','flout','flown','flows','fluid','fluke','flung','flunk','flush','flute',
  'foamy','focal','focus','foggy','foils','folds','folks','foray','force','forge',
  'forgo','forks','forms','forte','forth','forum','fossil','found','foyer','frail',
  'frame','frank','fraud','freak','freed','fresh','friar','fried','fries','frill',
  'frisk','front','frost','froth','frown','froze','fruit','fryer','fudge','fuels',
  'fugue','fully','fumed','fumes','funds','fungi','funky','funny','furry','fused',
  'fuses','fussy','fuzzy','gaily','gains','gaits','gamer','games','gamma','gangs',
  'gapes','garbs','gates','gauge','gaunt','gauze','gauzy','gavel','gazer','gears',
  'geese','genes','genre','genus','germs','ghost','giant','giddy','given','gives',
  'gizmo','gland','glare','glass','glaze','gleam','glean','glide','glint','gloat',
  'globe','gloom','glory','gloss','glove','glows','glued','glues','glyph','gnash',
  'gnome','goats','godly','going','golfs','goner','goose','gorge','gotta','gouge',
  'gourd','grace','grade','graft','grain','grand','grant','grape','graph','grasp',
  'grass','grate','grave','gravy','graze','great','greed','greek','green','greet',
  'grief','grill','grime','grimy','grind','gripe','grips','grist','groan','groin',
  'groom','grope','gross','group','grout','grove','growl','grown','grows','gruel',
  'gruff','grunt','guard','guava','guess','guest','guide','guild','guilt','guise',
  'gulch','gulls','gulps','gummy','gusto','gusts','gusty','gypsy','habit','haiku',
  'halls','halve','hands','handy','hangs','happy','hardy','harem','haste','hasty',
  'hatch','haunt','haven','havoc','heads','heady','heard','heart','heath','heave',
  'heavy','hedge','heeds','hefty','heirs','heist','hello','hence','herbs','herds',
  'highs','hiker','hikes','hills','hilly','hinge','hints','hippo','hired','hitch',
  'hoist','holds','holes','holly','homer','homes','honey','honor','hooks','hoped',
  'hopes','horns','horse','hotel','hound','hours','house','hover','howls','human',
  'humid','humor','humps','humus','hunks','hunts','hurry','hymns','icily','icing',
  'ideal','idiom','idiot','idled','idler','igloo','image','imbue','imply','inane',
  'incur','index','inept','inert','infer','ingot','inner','input','inter','intro',
  'ionic','irate','irony','ivory','jabot','jacks','jaded','jails','japan','jaunt',
  'jelly','jewel','jiffy','jimmy','joins','joker','jokes','jolly','joust','judge',
  'juice','juicy','jumbo','jumps','jumpy','junco','juror','squid','stabs','stack',
  'staff','stage','staid','stain','stair','stake','stale','stalk','stall','stamp',
  'stand','stank','stare','stark','stars','start','stash','state','stays','steak',
  'steal','steam','steel','steep','steer','stems','steps','stern','stews','stick',
  'stiff','still','stilt','sting','stink','stint','stirs','stock','stoic','stoke',
  'stole','stomp','stone','stood','stool','stoop','store','stork','storm','story',
  'stout','stove','straw','stray','strip','strut','stuck','studs','study','stuff',
  'stump','stung','stunk','stunt','style','suave','suede','sugar','suite','sulky',
  'super','surge','surly','sushi','swamp','swans','swarm','swear','sweat','sweep',
  'sweet','swell','swept','swift','swill','swine','swing','swipe','swirl','swoon',
  'swoop','sword','swore','sworn','swung','syrup','tabby','table','tacit','taffy',
  'taint','taken','tales','talks','tally','talon','tamed','tangy','tango','tanks',
  'tapes','tardy','tasks','taste','tasty','taunt','taxes','teach','teams','tears',
  'teens','teeth','tempo','temps','tense','tenth','terms','tests','thank','theft',
  'theme','thick','thief','thigh','thing','think','third','thorn','those','three',
  'threw','throw','thrum','thumb','thump','tidal','tiers','tiger','tight','tiles',
  'tilts','timer','times','timid','tipsy','tired','titan','title','toast','today',
  'token','tolls','tombs','tonal','toned','tones','tongs','tools','tooth','topic',
  'torch','total','totem','touch','tough','towel','tower','towns','toxic','trace',
  'track','tract','trade','trail','train','trait','tramp','trans','traps','trash',
  'trawl','treat','trees','trend','triad','trial','tribe','trick','tried','trims',
  'trips','trite','troll','troop','trots','trout','truce','truck','truly','trump',
  'trunk','truss','trust','truth','tulip','tumor','tuned','tuner','tunes','tunny',
  'turbo','turns','tutor','twang','tweak','tweed','twice','twigs','twine','twins',
  'twirl','twist','tying','udder','ulcer','ultra','umbra','uncle','uncut','under',
  'undue','unfit','unify','union','unite','units','unity','unlit','until','unwed',
  'upper','upset','urban','usher','usual','utter','udder','valid','valor','value',
  'valve','vapid','vault','venom','venue','verge','verse','vigor','vinyl','viola',
  'viper','viral','virus','visor','visit','vista','vital','vivid','vocal','vodka',
  'vogue','voice','voter','vouch','vowel','wacky','waded','wager','wages','wagon',
  'waist','walls','waltz','wands','wards','waste','watch','water','waved','waver',
  'waves','wears','weary','weave','wedge','weeds','weeks','weigh','weird','wells',
  'whale','wheat','wheel','where','which','while','whine','whirl','whisk','white',
  'whole','whose','wicks','wider','widow','width','wield','wilds','wimpy','windy',
  'wines','wings','wiped','wiper','wires','witch','woman','women','woods','woody',
  'words','wordy','works','world','worms','worry','worse','worst','worth','would',
  'wound','wraps','wrath','wreck','wring','wrist','write','wrong','wrote','yacht',
  'yearn','years','yeast','yield','young','youth','zebra','zones',
];

const VALID_GUESSES = new Set([
  ...ANSWERS,
  ...EXTRA_GUESSES.filter(w => w.length === 5),
]);

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

// ═════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} PlayerBoard
 * @property {string} id
 * @property {string} name
 * @property {{guess:string, feedback:string}[]} guesses
 * @property {boolean} solved
 * @property {boolean} exhausted
 */

/**
 * @typedef {Object} WordleState
 * @property {'pending'|'active'|'done'} phase
 * @property {string} answer
 * @property {PlayerBoard} p1
 * @property {PlayerBoard} p2
 * @property {1|2} turn - whose turn (1 or 2)
 * @property {string|null} winnerId
 * @property {boolean} isDraw
 */

/** @type {Map<string, { state: WordleState; expiry: number }>} */
const gamesByMessage = new Map();

/** @type {Map<string, string>} pendingChallengeMessageId -> state */
const pendingChallenges = new Map();

function getGame(messageId) {
  const entry = gamesByMessage.get(messageId);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cleanup(messageId);
    return null;
  }
  return entry.state;
}

function setGame(messageId, state) {
  gamesByMessage.set(messageId, { state, expiry: Date.now() + EXPIRY_MS });
}

function refreshExpiry(messageId) {
  const entry = gamesByMessage.get(messageId);
  if (entry) entry.expiry = Date.now() + EXPIRY_MS;
}

function cleanup(messageId) {
  gamesByMessage.delete(messageId);
  pendingChallenges.delete(messageId);
}

function pickAnswer() {
  return ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
}

// ═════════════════════════════════════════════════════════════════════════════
//  FEEDBACK LOGIC
// ═════════════════════════════════════════════════════════════════════════════

function computeFeedback(guess, answer) {
  const g = guess.toLowerCase().split('');
  const a = answer.toLowerCase().split('');
  const result = ['', '', '', '', ''];
  const used = [false, false, false, false, false];

  // First pass: exact matches (green)
  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      result[i] = 'g';
      used[i] = true;
    }
  }
  // Second pass: wrong-position matches (yellow) and misses (black)
  for (let i = 0; i < 5; i++) {
    if (result[i]) continue;
    let found = false;
    for (let j = 0; j < 5; j++) {
      if (used[j]) continue;
      if (g[i] === a[j]) {
        result[i] = 'y';
        used[j] = true;
        found = true;
        break;
      }
    }
    if (!found) result[i] = 'b';
  }
  return result.join('');
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDERING
// ═════════════════════════════════════════════════════════════════════════════

function formatRow(feedback, guess) {
  const map = { g: '🟩', y: '🟨', b: '⬛' };
  const squares = feedback.split('').map(c => map[c]).join('');
  return `${squares} \`${guess.toUpperCase()}\``;
}

function buildPlayerBoard(player) {
  const lines = player.guesses.map(r => formatRow(r.feedback, r.guess));
  // Fill remaining rows with empty placeholders
  const remaining = MAX_GUESSES - player.guesses.length;
  for (let i = 0; i < remaining; i++) {
    lines.push('⬜⬜⬜⬜⬜');
  }
  return lines.join('\n');
}

function buildLetterStatus(p1, p2) {
  const status = {};
  for (const c of LETTERS) status[c] = null;

  const allGuesses = [...p1.guesses, ...p2.guesses];
  for (const row of allGuesses) {
    const { guess, feedback } = row;
    for (let i = 0; i < 5; i++) {
      const ch = guess[i].toLowerCase();
      const fb = feedback[i];
      if (fb === 'g') {
        status[ch] = 'g';
      } else if (fb === 'y' && status[ch] !== 'g') {
        status[ch] = 'y';
      } else if (fb === 'b' && status[ch] == null) {
        status[ch] = 'b';
      }
    }
  }
  return status;
}

function formatKeyboard(status) {
  const fmt = (c) => {
    if (status[c] === 'g') return '🟩';
    if (status[c] === 'y') return '🟨';
    if (status[c] === 'b') return '⬛';
    return c.toUpperCase();
  };
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  return rows.map(row => row.split('').map(fmt).join(' ')).join('\n');
}

function buildGameEmbed(state) {
  const { phase, answer, p1, p2, turn, winnerId, isDraw } = state;
  const gameOver = phase === 'done';

  // Determine status line
  let statusText;
  let embedColor = WORDLE_GREEN;

  if (gameOver) {
    if (isDraw) {
      statusText = `🤝 It's a draw! The word was **${answer.toUpperCase()}**.`;
      embedColor = 0xFEE75C;
    } else {
      const winner = winnerId === p1.id ? p1 : p2;
      const winnerGuesses = winner.guesses.length;
      statusText = `🏆 **${winner.name}** solved it in **${winnerGuesses}** guess${winnerGuesses === 1 ? '' : 'es'}!`;
      embedColor = 0x57F287;
    }
  } else {
    const currentPlayer = turn === 1 ? p1 : p2;
    const icon = turn === 1 ? '🔵' : '🔴';
    statusText = `${icon} **${currentPlayer.name}**'s turn — click **Guess**!`;
  }

  const p1Label = `🔵 ${p1.name} (${p1.guesses.length}/${MAX_GUESSES})${p1.solved ? ' ✅' : p1.exhausted ? ' ❌' : ''}`;
  const p2Label = `🔴 ${p2.name} (${p2.guesses.length}/${MAX_GUESSES})${p2.solved ? ' ✅' : p2.exhausted ? ' ❌' : ''}`;

  const letterStatus = buildLetterStatus(p1, p2);
  const keyboard = formatKeyboard(letterStatus);

  const embed = new EmbedBuilder()
    .setTitle('📝 Wordle Duel')
    .setColor(embedColor)
    .setDescription(statusText)
    .addFields(
      { name: p1Label, value: buildPlayerBoard(p1), inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: p2Label, value: buildPlayerBoard(p2), inline: true },
    )
    .addFields({ name: '⌨️ Keyboard', value: keyboard, inline: false });

  if (gameOver && !isDraw && !winnerId) {
    embed.setFooter({ text: `The word was: ${answer.toUpperCase()}` });
  } else if (gameOver && isDraw) {
    embed.setFooter({ text: 'Both players ran out of guesses.' });
  } else {
    const p1Left = MAX_GUESSES - p1.guesses.length;
    const p2Left = MAX_GUESSES - p2.guesses.length;
    embed.setFooter({ text: `Guesses left — 🔵 ${p1.name}: ${p1Left} | 🔴 ${p2.name}: ${p2Left}` });
  }

  return embed;
}

function buildChallengeEmbed(challengerName, opponentName) {
  return new EmbedBuilder()
    .setTitle('📝 Wordle Duel — Challenge!')
    .setColor(WORDLE_GREEN)
    .setDescription(
      `**${challengerName}** has challenged **${opponentName}** to a Wordle Duel!\n\n` +
      `Both players will guess the same secret 5-letter word, alternating turns.\n` +
      `First to solve it wins!\n\n` +
      `**${opponentName}**, do you accept?`
    );
}

function buildGameButtons(state) {
  const gameOver = state.phase === 'done';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('wdl_guess')
      .setLabel('Guess')
      .setStyle(ButtonStyle.Success)
      .setDisabled(gameOver),
  );
  return [row];
}

function buildChallengeButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wdl_accept')
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('wdl_decline')
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
//  GAME LOGIC
// ═════════════════════════════════════════════════════════════════════════════

function advanceTurn(state) {
  // If game is done, do nothing
  if (state.phase === 'done') return;

  const current = state.turn === 1 ? state.p1 : state.p2;
  const other = state.turn === 1 ? state.p2 : state.p1;

  // Check if current player just solved it
  if (current.solved) {
    state.phase = 'done';
    state.winnerId = current.id;
    return;
  }

  // Mark current player as exhausted if they've used all guesses
  if (current.guesses.length >= MAX_GUESSES && !current.solved) {
    current.exhausted = true;
  }

  // If both exhausted → draw
  if (current.exhausted && other.exhausted) {
    state.phase = 'done';
    state.isDraw = true;
    return;
  }

  // If other player is already exhausted and current just exhausted → other can't go
  // Actually, if other is exhausted, we already checked both above
  // If current exhausted but other still has guesses, switch to other
  if (current.exhausted && !other.exhausted && !other.solved) {
    state.turn = state.turn === 1 ? 2 : 1;
    return;
  }

  // If other is exhausted but current still has guesses, stay on current
  if (other.exhausted && !current.exhausted) {
    // stay on current turn
    return;
  }

  // Normal alternation: switch to the other player
  state.turn = state.turn === 1 ? 2 : 1;
}

function recordOutcome(state, interaction) {
  try {
    if (state.isDraw) {
      recordDraw(state.p1.id, state.p1.name, GAME_KEY);
      recordDraw(state.p2.id, state.p2.name, GAME_KEY);
    } else if (state.winnerId) {
      const winner = state.winnerId === state.p1.id ? state.p1 : state.p2;
      const loser = state.winnerId === state.p1.id ? state.p2 : state.p1;
      recordWin(winner.id, winner.name, GAME_KEY);
      recordLoss(loser.id, loser.name, GAME_KEY);
    }
  } catch (e) {
    console.error('[Wordle] Leaderboard error:', e);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  SLASH COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const slashCommand = new SlashCommandBuilder()
  .setName('wordle')
  .setDescription('Challenge someone to a Wordle Duel!')
  .addUserOption(opt =>
    opt.setName('opponent')
      .setDescription('The user to challenge')
      .setRequired(true),
  );

export const wordleCommands = [slashCommand];

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ═════════════════════════════════════════════════════════════════════════════

export async function handleWordleInteraction(interaction) {
  // ── Slash command: /wordle @opponent ──
  if (interaction.isChatInputCommand() && interaction.commandName === 'wordle') {
    const challenger = interaction.user;
    const opponent = interaction.options.getUser('opponent');

    if (!opponent) {
      await interaction.reply({ content: 'Please mention an opponent.', ephemeral: true });
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

    const embed = buildChallengeEmbed(challenger.displayName, opponent.displayName);
    const msg = await interaction.reply({
      content: `<@${opponent.id}>`,
      embeds: [embed],
      components: buildChallengeButtons(),
      fetchReply: true,
    });

    pendingChallenges.set(msg.id, {
      challengerId: challenger.id,
      challengerName: challenger.displayName,
      opponentId: opponent.id,
      opponentName: opponent.displayName,
    });

    // Auto-expire the challenge
    setTimeout(() => {
      const pending = pendingChallenges.get(msg.id);
      if (pending) {
        pendingChallenges.delete(msg.id);
        const expiredEmbed = new EmbedBuilder()
          .setTitle('📝 Wordle Duel — Challenge Expired')
          .setColor(0x95A5A6)
          .setDescription('The challenge was not accepted in time.');
        msg.edit({ embeds: [expiredEmbed], components: [] }).catch(() => {});
      }
    }, EXPIRY_MS);

    return true;
  }

  // ── Accept button ──
  if (interaction.isButton() && interaction.customId === 'wdl_accept') {
    const messageId = interaction.message.id;
    const pending = pendingChallenges.get(messageId);

    if (!pending) {
      await interaction.reply({ content: 'This challenge has expired.', ephemeral: true });
      return true;
    }
    if (interaction.user.id !== pending.opponentId) {
      await interaction.reply({ content: 'Only the challenged player can accept.', ephemeral: true });
      return true;
    }

    pendingChallenges.delete(messageId);

    const answer = pickAnswer();
    const state = {
      phase: 'active',
      answer,
      p1: {
        id: pending.challengerId,
        name: pending.challengerName,
        guesses: [],
        solved: false,
        exhausted: false,
      },
      p2: {
        id: pending.opponentId,
        name: pending.opponentName,
        guesses: [],
        solved: false,
        exhausted: false,
      },
      turn: 1,
      winnerId: null,
      isDraw: false,
    };

    setGame(messageId, state);

    const embed = buildGameEmbed(state);
    await interaction.update({
      content: null,
      embeds: [embed],
      components: buildGameButtons(state),
    });
    return true;
  }

  // ── Decline button ──
  if (interaction.isButton() && interaction.customId === 'wdl_decline') {
    const messageId = interaction.message.id;
    const pending = pendingChallenges.get(messageId);

    if (!pending) {
      await interaction.reply({ content: 'This challenge has expired.', ephemeral: true });
      return true;
    }
    if (interaction.user.id !== pending.opponentId) {
      await interaction.reply({ content: 'Only the challenged player can decline.', ephemeral: true });
      return true;
    }

    pendingChallenges.delete(messageId);

    const embed = new EmbedBuilder()
      .setTitle('📝 Wordle Duel — Declined')
      .setColor(0xED4245)
      .setDescription(`**${pending.opponentName}** declined the challenge.`);

    await interaction.update({ content: null, embeds: [embed], components: [] });
    return true;
  }

  // ── Guess button → show modal ──
  if (interaction.isButton() && interaction.customId === 'wdl_guess') {
    const messageId = interaction.message.id;
    const state = getGame(messageId);

    if (!state) {
      await interaction.reply({ content: 'This game has expired or ended.', ephemeral: true });
      return true;
    }
    if (state.phase !== 'active') {
      await interaction.reply({ content: 'This game is over.', ephemeral: true });
      return true;
    }

    const currentPlayer = state.turn === 1 ? state.p1 : state.p2;
    if (interaction.user.id !== currentPlayer.id) {
      const otherPlayer = state.turn === 1 ? state.p1 : state.p2;
      await interaction.reply({
        content: `It's **${currentPlayer.name}**'s turn right now. Please wait!`,
        ephemeral: true,
      });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`wdl_modal_${messageId}`)
      .setTitle('Enter your 5-letter guess');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('wdl_input')
          .setLabel('Word')
          .setPlaceholder('CRANE')
          .setStyle(TextInputStyle.Short)
          .setMinLength(5)
          .setMaxLength(5)
          .setRequired(true),
      ),
    );

    await interaction.showModal(modal);
    return true;
  }

  // ── Modal submit → process guess ──
  if (interaction.isModalSubmit() && interaction.customId.startsWith('wdl_modal_')) {
    const messageId = interaction.customId.replace('wdl_modal_', '');
    const state = getGame(messageId);

    if (!state) {
      await interaction.reply({ content: 'Game not found or expired.', ephemeral: true });
      return true;
    }
    if (state.phase !== 'active') {
      await interaction.reply({ content: 'This game is already over.', ephemeral: true });
      return true;
    }

    const currentPlayer = state.turn === 1 ? state.p1 : state.p2;
    if (interaction.user.id !== currentPlayer.id) {
      await interaction.reply({ content: "It's not your turn!", ephemeral: true });
      return true;
    }

    const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
    if (!message) {
      await interaction.reply({ content: 'Original game message not found.', ephemeral: true });
      return true;
    }

    // Validate input
    const raw = (interaction.fields.getTextInputValue('wdl_input') || '').trim();
    const guess = raw.toLowerCase();

    if (guess.length !== 5) {
      await interaction.reply({ content: 'Your guess must be exactly 5 letters.', ephemeral: true });
      return true;
    }
    if (!/^[a-z]+$/.test(guess)) {
      await interaction.reply({ content: 'Your guess must contain only letters (A-Z).', ephemeral: true });
      return true;
    }
    if (!VALID_GUESSES.has(guess)) {
      await interaction.reply({
        content: `**${guess.toUpperCase()}** is not in the word list. Try another word!`,
        ephemeral: true,
      });
      return true;
    }

    // Compute feedback and record guess
    const feedback = computeFeedback(guess, state.answer);
    currentPlayer.guesses.push({ guess, feedback });

    if (feedback === 'ggggg') {
      currentPlayer.solved = true;
    }

    // Advance turn / check game-over conditions
    advanceTurn(state);
    refreshExpiry(messageId);

    // If game ended, record leaderboard + clean up
    if (state.phase === 'done') {
      recordOutcome(state, interaction);
      // Clean up after a short delay so the final embed renders
      setTimeout(() => cleanup(messageId), 30_000);
    }

    const embed = buildGameEmbed(state);
    await message.edit({ embeds: [embed], components: buildGameButtons(state) });

    // Ack the modal
    if (state.phase === 'done') {
      if (state.isDraw) {
        await interaction.reply({ content: `Game over — it's a draw! The word was **${state.answer.toUpperCase()}**.`, ephemeral: true });
      } else if (currentPlayer.solved) {
        await interaction.reply({ content: `🎉 Correct! You solved it in **${currentPlayer.guesses.length}** guess${currentPlayer.guesses.length === 1 ? '' : 'es'}!`, ephemeral: true });
      } else {
        await interaction.reply({ content: 'Guess recorded!', ephemeral: true });
      }
    } else {
      const fb = feedback.split('').map(c => c === 'g' ? '🟩' : c === 'y' ? '🟨' : '⬛').join('');
      await interaction.reply({ content: `${fb} \`${guess.toUpperCase()}\` — Guess recorded!`, ephemeral: true });
    }

    return true;
  }

  return false;
}
