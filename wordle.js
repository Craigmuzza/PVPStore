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
import { recordWin, recordLoss } from './leaderboard.js';

const GAME_KEY = 'wordle';
const EXPIRY_MS = 10 * 60 * 1000;

const ANSWERS = [
  'about','above','abuse','actor','adapt','admit','adopt','adult','after','again','agent','agree','ahead','alarm','album','alert','alike','alive','allow','alone','along','alter','among','angel','anger','angle','angry','apart','apple','apply','arena','argue','arise','array','asset','avoid','awake','award','aware','badly','baker','bases','basic','basin','beast','begin','being','below','bench','birth','black','blade','blame','blank','blast','bleed','bless','blind','block','blood','blown','blues','board','boast','bones','booth','bound','brain','brand','brass','brave','bread','break','breed','brick','bride','bring','broad','broke','brown','build','built','bunch','burst','buyer','cabin','cable','calm','camel','cameo','camp','canal','candy','canoe','cargo','carry','carve','catch','cause','chain','chair','champ','charm','chart','chase','cheap','check','cheek','cheer','chest','chief','child','chill','china','chips','choir','chord','civil','claim','clash','class','clean','clear','clerk','click','climb','cling','clock','close','cloth','cloud','clown','coach','coast','cobra','codes','coins','color','comet','comfy','comic','comma','condo','couch','cough','could','count','court','cover','crack','craft','crane','crank','crash','crate','crave','crawl','crazy','cream','creed','creep','crest','crime','cross','crowd','crown','crude','cruel','crumb','crush','crust','curly','curry','curse','curve','cycle','daily','dairy','daisy','dance','dared','dated','dealt','death','debit','debug','debut','decay','decor','decoy','defer','delay','delta','demon','denim','dense','depot','depth','derby','deter','devil','diary','dice','diets','digit','diner','dirty','disco','ditch','diver','dizzy','dodge','dogma','doing','dolls','donor','donut','doors','doubt','dough','douse','dozen','drain','drama','drank','drape','drawl','drawn','dread','dream','dress','dried','drill','drink','drive','drops','drove','drown','drugs','drunk','ducks','ducts','duels','duets','dukes','dumps','dunce','dunes','dunks','dusty','dutch','dwarf','dwell','dying','eager','eagle','early','earns','earth','eased','easel','eases','eaten','eater','eaves','echo','edged','edges','edict','edits','eerie','egged','egger','eggs','eight','eject','elbow','elder','elect','elegy','elite','elope','elude','elves','embed','ember','empty','enable','enact','ended','enemy','energy','enjoy','enrol','ensue','enter','entry','envy','epoch','equal','equip','erase','erect','error','erupt','escape','essay','ester','ether','ethic','ethos','etude','euros','evade','event','evict','evils','evoke','evolve','exact','exalt','exams','excel','exert','exile','exits','exist','expel','extra','exude','exult','eying','fable','faced','faces','facet','faded','fades','fails','faint','fairs','fairy','faith','faked','fakes','falls','false','fancy','fangs','farce','fared','fares','farm','farms','fast','fated','fates','fault','fauna','favor','fears','feast','feats','feeds','feels','feign','feint','felon','fence','fends','feral','ferry','fests','fetid','fetus','feuds','fever','fewer','fiber','field','fiend','fiery','fifth','fifty','fight','filed','files','filet','fills','films','filth','final','finch','finds','fined','finer','fines','fire','fired','fires','firms','first','fish','fishy','fists','fixed','fixer','fixes','fizzy','flack','flags','flail','flair','flame','flank','flaps','flare','flash','flask','flats','flaws','flees','fleet','flesh','flick','flier','flies','flight','fling','flint','flips','flirt','float','flock','flood','floor','flops','flora','floss','flour','flout','flown','flows','fluid','fluke','flume','flung','flunk','flush','flute','flux','flyer','foals','foams','foamy','focal','focus','fodder','foggy','foils','foist','folds','folks','fonts','foods','fools','force','fords','forge','forgo','forks','forms','forte','forth','forts','forum','found','fowls','foxes','foyer','frail','frame','frank','fraud','freak','freed','freer','frees','fresh','frets','friar','fried','frier','fries','frill','frisk','frogs','front','frost','froth','frown','froze','fruit','fudge','fuels','fugue','fumed','fumes','funds','fungi','funky','funny','furor','furry','fused','fuses','fussy','fuzzy',
];

const EXTRA_GUESSES = ['aahed','aalii','abaca','abaci','aback','abaft','abase','abash','abate','abaya','abbas','abbes','abbey','abbot','abear','abele','abets','abhor','abide','abler','ables','ablet','abmho','abohm','aboil','aboma','abord','abore','aborn','abort','abram','abray','abrim','abrin','abris','absit','abuna','abune','abuts','abuzz','abyes','abysm','abyss','acais','acari','accas','accoy','acerb','acers','aceta','ached','aches','achoo','acidy','acing','acini','ackee','acker','acmes','acmic','acned','acnes','acold','acorn','acred','acres','acrid','actin','acton','acyls','adage','adaws','adays','addax','adder','addle','adeem','adhan','adieu','adios','adits','adman','admen','admin','admix','adobe','adobo','adore','adorn','adoze','adsum','aduki','adunc','adust','adyta','adzed','adzes','aecia','aedes','aegis','aeons','aerie','aeros','aesir','affix','afire','afoot','afore','afoul','afrit','afros','agama','agami','agape','agars','agate','agave','agaze','agene','agers','agger','aggie','aggro','aghas','agila','agile','agios','agism','agist','agita','aglee','aglet','agley','agloo','aglow','aglus','agmas','agoge','agone','agons','agony','agora','agria','agrin','agros','agued','agues','aguna','aguti','aheap','ahent','ahigh','ahind','ahing','ahint','ahold','ahull','aidas','aider','aides','aidos','aiery','aight','ailed','aimer','aioli','aired','airer','airns','airth','airts','aitch','aizle','ajuga','ajwan','akees','akela','akene','akita','alaap','alack','alang','alans','alant','alary','alate','alays','albee','albid','alcid','alcos','aldea','alder','aldol','aleck','alecs','alefs','aleft','aleph','alewd','alfas','algas','algid','algin','algor','algum','alibi','alien','alifs','alist','aliya','alkie','alkos','alkyd','alkyl','allay','allee','allel','alley','allis','allod','allot','alloy','allyl','almah','almas','almeh','almes','almud','almug','alods','aloed','aloes','aloft','aloha','aloin','aloof','aloos','aloud','alowe','altar','altho','altos','alula','alums','alure','alvar','amahs','amain','amass','amate','amaut','amber','ambit','amble','ambos','ambry','ameba','ameer','amend','amene','amens','ament','amice','amici','amide','amido','amids','amies','amiga','amigo','amine','amino','amins','amiss','amity','ammon','ammos','amnia','amnio','amoks','amole','amort','amour','amove','ampul','amrit','amuck','amuse','amyls','anata','ancho','ancle','ancon','anear','anele','anent','angas','anglo','angst','anile','anils','anima','anime','animi','anion','anise','ankhs','ankle','ankus','anlas','annas','annat','annex','annie','annoy','annul','annum','anode','anole','anomy','ansae','antae','antal','antas','anted','antes','antic','antis','antra','antre','antsy','anura','anvil','anyon','apace','apage','apaid','apayd','apays','apeak','apers','apert','apery','apgar','apian','aping','apiol','apish','apism','apnea','apods','aport','appal','appel','appro','apres','apses','apsis','apted','apter','aquae','aquas','araba','araks','arame','arbor','arced','archi','arcos','arcus','ardeb','ardor','aread','areae','areal','arear','areca','aredd','arede','arefy','areic','arene','arepa','arere','arete','arets','argal','argil','argol','argon','argot','argus','arhat','arias','ariki','arils','ariot','arish','arked','arled','arles','armer','armet','armil','arnas','arnut','aroha','aroid','aroma','arpas','arpen','arrah','arras','arret','arris','arrow','arroz','arsed','arses','arsey','arsis','arson','artal','artel','artic','artis','artsy','arums','arval','arvee','arvos','aryls','asana','ascot','ascus','ashed','ashen','asker','aspen','asper','aspic','aspie','aspis','aspro','assay','assot','astir','astun','asura','ataps','ataxy','atigi','atilt','atimy','atlas','atman','atocs','atoke','atoll','atoms','atomy','atone','atony','atopy','atria','atrip','attar','attic','audad','auger','aught','augur','aulas','aumil','aunes','aurae','aural','auras','aurei','aures','auric','auris','aurum','auxin','avail','avale','avant','avast','avels','avens','avers','avert','avgas','avian','avine','avion','avise','aviso','avize','avows','avyze','awarn','awash','awave','awdls','awful','awned','awner','awols','axial','axile','axils','axion','axite','axled','axles','axmen','axone','axons','ayahs','ayins','ayont','ayres','azurn','azury','azygy'];
const VALID_GUESSES = new Set([...ANSWERS, ...EXTRA_GUESSES.filter(w => w.length === 5)]);

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

/** @type {Map<string, { state: WordleState; expiry: number }>} */
const gamesByMessage = new Map();
/** @type {Map<string, string>} userId -> messageId */
const gamesByUser = new Map();

/** @param {string} id */
function getGame(messageId) {
  const entry = gamesByMessage.get(messageId);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    gamesByMessage.delete(messageId);
    if (entry.state.userId) gamesByUser.delete(entry.state.userId);
    return null;
  }
  return entry.state;
}

function setGame(messageId, state) {
  const expiry = Date.now() + EXPIRY_MS;
  gamesByMessage.set(messageId, { state, expiry });
  if (state.userId) gamesByUser.set(state.userId, messageId);
}

function deleteGame(messageId) {
  const entry = gamesByMessage.get(messageId);
  if (entry?.state.userId) gamesByUser.delete(entry.state.userId);
  gamesByMessage.delete(messageId);
}

function pickAnswer() {
  return ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
}

function computeFeedback(guess, answer) {
  const g = guess.toLowerCase().split('');
  const a = answer.toLowerCase().split('');
  const result = ['', '', '', '', ''];
  const used = [false, false, false, false, false];

  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      result[i] = 'g';
      used[i] = true;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (result[i]) continue;
    for (let j = 0; j < 5; j++) {
      if (used[j]) continue;
      if (g[i] === a[j]) {
        result[i] = 'y';
        used[j] = true;
        break;
      }
    }
    if (!result[i]) result[i] = 'b';
  }
  return result.join('');
}

function buildLetterStatus(guesses, answer) {
  const status = {};
  for (const c of LETTERS) status[c] = null;
  for (const row of guesses) {
    const { guess, feedback } = row;
    for (let i = 0; i < 5; i++) {
      const ch = guess[i].toLowerCase();
      if (feedback[i] === 'g') status[ch] = 'g';
      else if (feedback[i] === 'y' && status[ch] !== 'g') status[ch] = 'y';
      else if (feedback[i] === 'b' && status[ch] == null) status[ch] = 'b';
    }
  }
  return status;
}

function formatKeyboard(status) {
  const g = (c) => status[c] === 'g' ? '🟩' : status[c] === 'y' ? '🟨' : status[c] === 'b' ? '⬛' : c.toUpperCase();
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  return rows.map(row => row.split('').map(c => g(c)).join(' ')).join('\n');
}

function formatRow(feedback, guess) {
  const map = { g: '🟩', y: '🟨', b: '⬛' };
  const squares = feedback.split('').map(c => map[c]).join('');
  return `${squares} ${guess.toUpperCase()}`;
}

function buildEmbed(state) {
  const { answer, guesses, userId } = state;
  const won = guesses.length > 0 && guesses[guesses.length - 1].feedback === 'ggggg';
  const lost = guesses.length >= 6 && !won;

  const lines = guesses.map(r => formatRow(r.feedback, r.guess));
  if (lines.length === 0) lines.push('_No guesses yet. Click **Guess** to play!_');
  const status = buildLetterStatus(guesses, answer);
  const keyboard = formatKeyboard(status);

  const embed = new EmbedBuilder()
    .setTitle('📝 Wordle')
    .setColor(lost ? 0xed4245 : won ? 0x57f287 : 0x5865f2)
    .setDescription(lines.join('\n'))
    .addFields({ name: '⌨️ Keyboard', value: keyboard, inline: false })
    .setFooter({
      text: lost
        ? `Game Over! The word was: **${answer.toUpperCase()}**`
        : won
          ? `You won in ${guesses.length}/6 guesses!`
          : `${6 - guesses.length} guess(es) left`,
    });

  return embed;
}

const slashCommand = new SlashCommandBuilder()
  .setName('wordle')
  .setDescription('Start a solo Wordle game (5-letter word, 6 guesses)');

export const wordleCommands = [slashCommand];

export async function handleWordleInteraction(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'wordle') {
    const userId = interaction.user.id;
    const existingMsgId = gamesByUser.get(userId);
    if (existingMsgId && getGame(existingMsgId)) {
      await interaction.reply({
        content: 'You already have an active Wordle game. Use that message to play.',
        ephemeral: true,
      });
      return true;
    }
    if (existingMsgId) gamesByUser.delete(userId);

    const answer = pickAnswer();
    const state = { answer, guesses: [], userId };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wdl_guess')
        .setLabel('Guess')
        .setStyle(ButtonStyle.Primary),
    );

    const embed = buildEmbed(state);
    const msg = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    setGame(msg.id, state);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'wdl_guess') {
    const game = getGame(interaction.message.id);
    if (!game) {
      await interaction.reply({ content: 'This game has expired or ended.', ephemeral: true });
      return true;
    }
    if (game.userId !== interaction.user.id) {
      await interaction.reply({ content: "This isn't your game.", ephemeral: true });
      return true;
    }
    const won = game.guesses.length > 0 && game.guesses[game.guesses.length - 1].feedback === 'ggggg';
    const lost = game.guesses.length >= 6;
    if (won || lost) {
      await interaction.reply({ content: 'This game is over.', ephemeral: true });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`wdl_modal_${interaction.message.id}`)
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

  if (interaction.isModalSubmit() && interaction.customId.startsWith('wdl_modal_')) {
    const messageId = interaction.customId.replace('wdl_modal_', '');
    const game = getGame(messageId);
    if (!game) {
      await interaction.reply({ content: 'Game not found or expired.', ephemeral: true });
      return true;
    }
    if (game.userId !== interaction.user.id) {
      await interaction.reply({ content: "This isn't your game.", ephemeral: true });
      return true;
    }

    const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
    if (!message) {
      await interaction.reply({ content: 'Original game message not found.', ephemeral: true });
      return true;
    }

    const raw = (interaction.fields.getTextInputValue('wdl_input') || '').trim();
    const guess = raw.toLowerCase();

    if (guess.length !== 5) {
      await interaction.reply({
        content: 'Your guess must be exactly 5 letters.',
        ephemeral: true,
      });
      return true;
    }
    if (!/^[a-zA-Z]+$/.test(guess)) {
      await interaction.reply({
        content: 'Your guess must contain only letters (A-Z).',
        ephemeral: true,
      });
      return true;
    }
    if (!VALID_GUESSES.has(guess)) {
      await interaction.reply({
        content: `"${guess.toUpperCase()}" is not in the word list.`,
        ephemeral: true,
      });
      return true;
    }

    const feedback = computeFeedback(guess, game.answer);
    game.guesses.push({ guess, feedback });

    const won = feedback === 'ggggg';
    const lost = game.guesses.length >= 6 && !won;

    if (won || lost) {
      deleteGame(messageId);
      try {
        const { id, displayName } = interaction.user;
        if (won) recordWin(id, displayName, GAME_KEY);
        else recordLoss(id, displayName, GAME_KEY);
      } catch (e) {
        console.error('wordle leaderboard error:', e);
      }
    }

    const embed = buildEmbed(game);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wdl_guess')
        .setLabel('Guess')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(won || lost),
    );

    await message.edit({ embeds: [embed], components: [row] });
    await interaction.reply({ content: 'Guess recorded!', ephemeral: true });
    return true;
  }

  return false;
}
