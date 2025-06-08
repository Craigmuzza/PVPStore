/*────────────────────────  Imports  ────────────────────────────*/
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import express  from 'express';
import multer   from 'multer';
import fs, { existsSync, mkdirSync } from 'fs';         // ⬅ add existsSync / mkdirSync
import path     from 'path';
import { fileURLToPath } from 'url';
import dotenv   from 'dotenv';
dotenv.config();

/*────────────────────  Paths & constants  ──────────────────────*/
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* Mount point on Render is /data – override locally with DATA_DIR=./data */
const DATA_DIR = process.env.DATA_DIR || '/data';
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const ICON_URL      = 'https://i.imgur.com/EaFpTY2.gif';
const GOLD          = 0xF1C40F;
const CHANNEL_ID    = process.env.CHANNEL_ID;

/* everything important now lives on the persistent disk */
const PRIZES_FILE   = path.join(DATA_DIR, 'prizes.json');
const LOOT_LOG_FILE = path.join(DATA_DIR, 'loot.json');

/*────────────────────  Discord client  ─────────────────────────*/
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
client.once('ready', () => {                                   // <- second
  console.log('🟡 Bot is online');
  for (const key of Object.keys(winnerTasks)) {
    startWinnerLoop(winnerTasks[key]);
  }
});


/*────────────────────  Helper functions  ───────────────────────*/
const errorEmbed = txt => new EmbedBuilder()
  .setTitle('⚠️ Error').setDescription(txt).setColor(GOLD)
  .setThumbnail(ICON_URL).setFooter({ iconURL: ICON_URL, text:'PVP Store' });

const formatAbbr = v => v>=1e9?`${v/1e9}B`:v>=1e6?`${v/1e6}M`:v>=1e3?`${v/1e3}K`:`${v}`;
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
/** delete the user’s command if we’re allowed to */
const nuke = async m => {
  if (m.deletable) {
    try { await m.delete(); } catch { /* no-op – perms or already gone */ }
  }
};

/******************************************************************
 *  Winner auto-refresh tasks
 ******************************************************************/
const TASK_FILE   = path.join(DATA_DIR, 'winner_tasks.json');
const REFRESH_MS  = +process.env.WINNER_REFRESH_MS || 5 * 60_000; // 5 min default
/** { [key:`channelId|month`]: { channelId, messageId, month } } */
let winnerTasks = {};
try { winnerTasks = JSON.parse(fs.readFileSync(TASK_FILE, 'utf-8')); } catch {}

/** start a repeating updater for a task object */
const startWinnerLoop = task => {
  const key = `${task.channelId}|${task.month}`;
  if (winnerTasks[key]?.interval) return;   // already running

  const tick = async () => {
    try {
      const chan  = await client.channels.fetch(task.channelId);
      const msg   = await chan.messages.fetch(task.messageId);
      const embed = await buildWinnerEmbed(task.month);
      await msg.edit({ embeds: [embed] });
      console.log(`↻ updated !winner for ${task.month}`);
    } catch (e) {
      // 10008 = Unknown Message   •   10003 = Unknown Channel
      if (e.code === 10008 || e.code === 10003) {
        clearInterval(winnerTasks[key].interval);
        delete winnerTasks[key];

        // rewrite winner_tasks.json without the dead loop
        fs.writeFileSync(
          TASK_FILE,
          JSON.stringify(
            Object.fromEntries(
              Object.entries(winnerTasks).map(
                ([k,v]) => [k, { channelId:v.channelId, messageId:v.messageId, month:v.month }]
              )
            ),
            null, 2
          )
        );
        console.log(`✂️ winner loop for ${key} stopped (message/channel gone)`);
      } else {
        console.error('winner-loop error:', e.message);
      }
    }
  };

  winnerTasks[key].interval = setInterval(tick, REFRESH_MS);
  tick();            // run immediately once
};


/** e.g. 30 Jun 2025 */
const fmtDate = d =>
  d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });

async function buildWinnerEmbed(monthArg) {
  const monthIdx = new Date(`${cap(monthArg)} 1, ${new Date().getFullYear()}`).getMonth();
  let log=[]; try { log = JSON.parse(fs.readFileSync(LOOT_LOG_FILE,'utf-8')); } catch {}

  const monthLoot = log.filter(e => new Date(e.timestamp).getMonth() === monthIdx);
  if (!monthLoot.length) {
    return errorEmbed(`No data found for **${cap(monthArg)}**`);
  }

	// ── helper: split an array of lines into 1024-char chunks for Discord fields
	const chunkLines = (arr, max = 1024) => {
	  const out = [], buf = [];
	  let len = 0;
	  for (const line of arr) {
		if (len + line.length + 1 > max) {
		  out.push(buf.join('\n')); buf.length = 0; len = 0;
		}
		buf.push(line); len += line.length + 1;
	  }
	  if (buf.length) out.push(buf.join('\n'));
	  return out;
	};

	  const totals={};
	  monthLoot.forEach(e => totals[e.playerName]=(totals[e.playerName]??0)+e.totalValue);

	  // grab current prize table (optional)
	  let prizeTable={}, setBy;
	  try {
		const all=JSON.parse(fs.readFileSync(PRIZES_FILE));
		if (all[monthArg]) { prizeTable=all[monthArg].prizes; setBy=all[monthArg].setBy; }
	  } catch {}

	/* ── build a row for every player, not just top-5 ────────────── */
	const everyone = Object.entries(totals)
	  .sort((a, b) => b[1] - a[1]);              // highest GP first

	const ordinal = n => {
	  const suf = ['th','st','nd','rd'];
	  const v = n % 100;
	  return n + (suf[(v-20)%10] || suf[v] || suf[0]);
	};

	const allLines = everyone.map(([name, gp], idx) => {
	  const placeStr  = ordinal(idx + 1);                // 1st, 2nd, …
	  const prizeStr  = prizeTable[placeStr]
			? ` — 🏆 ${prizeTable[placeStr].toLocaleString()} GP`
			: '';
	  return `**${placeStr}**  **${name}**  —  ${gp.toLocaleString()} GP${prizeStr}`;
	});

	/* ── Discord field = 1024 chars max, split if needed ─────────── */
	const chunks = chunkLines(allLines);

	/* ── assemble embed ──────────────────────────────────────────── */
	const eb = new EmbedBuilder()
	  .setTitle(`🏆 Winners – ${cap(monthArg)}`)
	  .setColor(GOLD)
	  .setThumbnail(ICON_URL)
	  .setFooter({ iconURL: ICON_URL, text:'PVP Store' });

	chunks.forEach((txt, i) => eb.addFields({
	  name  : i === 0 ? 'Placings' : '\u200B',
	  value : txt
	}));

	if (setBy) {
	  eb.addFields({
		name  : '\u200B',
		value : `_Prizes set by <@${setBy.id}> (${setBy.display})_`
	  });
	}

	return eb;
	}

/*────────────────────  Command handler  ────────────────────────*/
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const args = message.content.trim().split(/ +/);
  const cmd  = args.shift().toLowerCase();

  /* ---------- !setprize ---------- */
  if (cmd === '!setprize') {
	  await nuke(message);                 // ← NEW
    if (args.length < 2) return message.channel.send({ embeds:[ errorEmbed('Usage: `!setprize <Month> 1m,2m,...`') ]});

    const month = args[0].toLowerCase();
    const toGp = v => {
      const n=parseFloat(v); if(v.endsWith('b'))return n*1e9;
      if(v.endsWith('m'))return n*1e6; if(v.endsWith('k'))return n*1e3; return NaN;
    };
    const bad = args.slice(1).find(v=>!/^\d+(\.\d+)?[kmb]$/i.test(v.replace(',','')));
    if(bad) return message.channel.send({ embeds:[ errorEmbed(`Invalid format: "${bad}"`) ]});

    const suffix = i => ['1st','2nd','3rd'][i] || `${i+1}th`;
    let prizes={}; try{prizes=JSON.parse(fs.readFileSync(PRIZES_FILE));}catch{}
    const monthPrizes={}; args.slice(1).join(' ').split(',').forEach((raw,i)=> monthPrizes[suffix(i)]=toGp(raw.trim()));
    const member=await message.guild.members.fetch(message.author.id);
    prizes[month]={ prizes:monthPrizes, setBy:{ id:member.id, display:member.displayName }};
    fs.writeFileSync(PRIZES_FILE, JSON.stringify(prizes,null,2));

    const breakdown=Object.entries(monthPrizes).map(([p,g])=>`${p}: ${g.toLocaleString()} GP (${formatAbbr(g)})`).join('\n');
    return message.channel.send({ embeds:[ new EmbedBuilder()
      .setTitle(`✅ Prizes Set for ${cap(month)}`)
      .setDescription(`**Breakdown:**\n${breakdown}\n\n_Last set by <@${member.id}> (${member.displayName})_`)
      .setColor(GOLD).setThumbnail(ICON_URL)
      .setFooter({ iconURL: ICON_URL, text:'PVP Store' })]});
  }

  /* ---------- !totalprize ---------- */
  if (cmd === '!totalprize') {
	  await nuke(message);                 // ← NEW
    if(!args[0]) return message.channel.send({ embeds:[ errorEmbed('Usage: `!totalprize <Month>`') ]});
    const month=args[0].toLowerCase();
    let prizes={}; try{prizes=JSON.parse(fs.readFileSync(PRIZES_FILE));}catch{}
    const entry=prizes[month];
    if(!entry) return message.channel.send({ embeds:[ errorEmbed(`No prizes set for **${args[0]}**`) ]});

    const total=Object.values(entry.prizes).reduce((s,v)=>s+v,0);
        const breakdown = Object.entries(entry.prizes)
      .map(([p,g])=>`${p}: ${g.toLocaleString()} GP (${formatAbbr(g)})`).join('\n');

    // ⏰ last calendar day of the requested month, this year
    const nowYear     = new Date().getFullYear();
    const monthIdx    = new Date(`${cap(month)} 1, ${nowYear}`).getMonth(); // 0-based
    const expiry      = new Date(nowYear, monthIdx + 1, 0);                 // day=0 ⇒ last

    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`🧮 Total Prize Pool – ${cap(month)}`)
          .setDescription(
            `Total: **${total.toLocaleString()} GP**\n` +
            `**Expires:** ${fmtDate(expiry)}\n\n` +
            `${breakdown}\n\n` +
            `_Last set by <@${entry.setBy.id}> (${entry.setBy.display})_`
          )
          .setColor(GOLD)
          .setThumbnail(ICON_URL)
          .setFooter({ iconURL: ICON_URL, text: 'PVP Store' })
      ]
    });
 }
	/* ---------- !winner ---------- */
	if (cmd === '!winner') {
	  await nuke(message);

	  if (!args[0]) {
		return message.channel.send({ embeds:[ errorEmbed('Usage: `!winner <Month>`') ]});
	  }
	  const monthArg = args[0].toLowerCase();

	  // build embed & send (or edit if already tracking)
	  const embed = await buildWinnerEmbed(monthArg);
	  const sent  = await message.channel.send({ embeds:[embed] });

	  // record / persist task
	  const key = `${message.channel.id}|${monthArg}`;
	  winnerTasks[key] = {
		channelId : message.channel.id,
		messageId : sent.id,
		month     : monthArg
	  };
	  // write a copy that strips the runtime-only `interval`
	const plain = {};
	for (const [k,v] of Object.entries(winnerTasks)) {
		plain[k] = { channelId: v.channelId, messageId: v.messageId, month: v.month };
	}
	fs.writeFileSync(TASK_FILE, JSON.stringify(plain, null, 2));

	  startWinnerLoop(winnerTasks[key]);
	}


/* ---------- !clearprize ---------- */
if (cmd === '!clearprize') {
	await nuke(message);                 // ← NEW
  if (!args[0]) return;

  const month = args[0].toLowerCase();

  let prizes = {};
  try { prizes = JSON.parse(fs.readFileSync(PRIZES_FILE)); } catch {}

  if (prizes[month]) {
    delete prizes[month];
    fs.writeFileSync(PRIZES_FILE, JSON.stringify(prizes, null, 2));

    // 💬  embed instead of plain text
    const embed = new EmbedBuilder()
      .setTitle(`🗑️ Prizes Cleared`)
      .setDescription(`All prize data for **${cap(month)}** has been removed.`)
      .setColor(GOLD)
      .setThumbnail(ICON_URL)
      .setFooter({ iconURL: ICON_URL, text: 'PVP Store' });

    return message.channel.send({ embeds: [embed] });
  }

  // month not found -– keep existing error style
  return message.channel.send({ embeds: [errorEmbed(`No prizes set for **${args[0]}**`)] });
}

/* ---------- !resetloot ---------- */
if (cmd === '!resetloot') {
  await nuke(message);                                   // tidy chat

  if (!args[0]) {
    return message.channel.send({
      embeds: [errorEmbed('Usage: `!resetloot <Month>`')]
    });
  }

  const monthArg = args[0].toLowerCase();
  const targetIdx = new Date(`${cap(monthArg)} 1, ${new Date().getFullYear()}`).getMonth();

  // load existing log (empty array if file missing / corrupt)
  let log = [];
  try { log = JSON.parse(fs.readFileSync(LOOT_LOG_FILE, 'utf-8')); } catch {}

  const before = log.length;
  log = log.filter(e => new Date(e.timestamp).getMonth() !== targetIdx);

  if (before === log.length) {                           // nothing removed
    return message.channel.send({
      embeds: [errorEmbed(`No loot entries found for **${cap(monthArg)}**`)]
    });
  }

  fs.writeFileSync(LOOT_LOG_FILE, JSON.stringify(log, null, 2));

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Loot Log Cleared')
    .setDescription(`Removed **${before - log.length}** entries for **${cap(monthArg)}**.`)
    .setColor(GOLD)
    .setThumbnail(ICON_URL)
    .setFooter({ iconURL: ICON_URL, text: 'PVP Store' });

  return message.channel.send({ embeds: [embed] });
}


  /* ---------- !help ---------- */
  if (cmd === '!help') {
	  await nuke(message);                 // ← NEW
    return message.channel.send({ embeds:[ new EmbedBuilder()
      .setTitle('📖 PVP Store Bot Commands').setColor(GOLD).setThumbnail(ICON_URL)
      .setFooter({ iconURL: ICON_URL, text:'PVP Store' })
      .setDescription(
        '**!setprize &lt;Month&gt; 1m,2m,...** – set prize values\n' +
        '**!totalprize &lt;Month&gt;** – total & breakdown\n' +
        '**!winner &lt;Month&gt;** – top-5 earners & prizes\n' +
        '**!clearprize <Month>** – delete that month’s prize table\n' +
		'**!resetloot  <Month>** – erase that month’s loot log\n' +
        '❓ **!help** – show this help'
      )]});
  }
});

/*────────────────────  Loot logging server  ────────────────────*/
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended:true }));
const upload=multer();                                // multipart memory

/*────────────────── /logLoot  –  PK-only handler ───────────────*/
app.post('/logLoot', upload.any(), async (req, res) => {
  try {
    /* 1️⃣  Pull the JSON out of multipart / form / raw */
    let payload;

    // ── multipart
    if (req.files?.length) {
      const part = req.files.find(f =>
        ['payload_json', 'json'].includes(f.fieldname));
      if (part) payload = JSON.parse(part.buffer.toString());
    }
    // ── url-encoded
    if (!payload && typeof req.body.payload_json === 'string')
      payload = JSON.parse(req.body.payload_json);
    if (!payload && typeof req.body.json === 'string')
      payload = JSON.parse(req.body.json);
    // ── raw JSON
    if (!payload) payload = req.body;

    /* ─── 💬 DEBUG  — peek at every payload that arrives ───────── */
    console.log('↪ incoming payload →', {
      type         : payload.type,
      hasExtra     : !!payload.extra,
      victimEquip  : !!payload.extra?.victimEquipment || !!payload.victimEquipment,
      embeds       : Array.isArray(payload.embeds) ? payload.embeds.length : 0,
      fileParts    : req.files?.length ?? 0,
      topKeys      : Object.keys(payload)
    });
    /* ──────────────────────────────────────────────────────────── */

	/* ─── EARLY-EXIT / ROUTING  ──────────────────────────────────── */

	/**
	 *  Helper flags
	 *  ----------------------------------------------------------------
	 *  PLAYER_KILL : payload.type === 'PLAYER_KILL'
	 *  PK_CHEST    : payload.type === 'LOOT'
	 *                AND extra.source contains “Loot Chest”
	 */
	const type        = (payload.type ?? '').toUpperCase();
	const victimEquip = payload.extra?.victimEquipment || payload.victimEquipment;
	const isPK = (payload.type ?? '').toUpperCase() === 'PLAYER_KILL';
	
	/* ➕ add this */
	const isPkChest =
		type === 'LOOT' &&
		payload.extra?.source?.toUpperCase().includes('LOOT CHEST');

	if (isPK && Array.isArray(payload.embeds) && payload.embeds.length) {
	const files = (req.files ?? [])
		.filter(f => !['payload_json','json'].includes(f.fieldname))
		.map(f => ({ attachment: f.buffer, name: f.originalname }));

  await client.channels.fetch(CHANNEL_ID)
       .then(ch => ch.send({ embeds: payload.embeds, files }));
  console.log('✓ Forwarded PK embed w/ image');
}


	/* 💬 leave this while testing – comment it out later */
	console.log(`↪ payload type ${type}   PK=${isPK}   PK-CHEST=${isPkChest}`);

	/*  Only continue for PK notifications or their Loot-Chest payouts  */
	// ✅ We will push to loot.json **only** when it is a PK-Chest
	// (but we can still forward the PK embed for the discord channel)
	if (!isPkChest) {
	  return res.status(204).end();   // silently ignore everything else
	}

	/* 4️⃣  Build a normalised items[] array

		  PLAYER_KILL ……  victimEquipment  ➜  items[]
		  LOOT-CHEST  ……  extra.items      ➜  items[]
	*/
	let items = [];

	if (victimEquip) {                           // PLAYER_KILL
	  items = Object.values(victimEquip).map(it => ({
		name      : it.name,
		quantity  : 1,
		priceEach : it.priceEach ?? 0
	  }));
	}
	else if (isPkChest && Array.isArray(payload.extra?.items)) {   // Loot Chest
	  items = payload.extra.items.map(it => ({
		name      : it.name,
		quantity  : it.quantity  ?? 1,
		priceEach : it.priceEach ?? 0
	  }));
	}
	else {
	  throw new Error('No loot items found');    // safety net
	}

    /* 5️⃣  Compute total value for stats / !winner */
     const totalValue = items.reduce(
		(sum, it) => sum + (it.priceEach ?? 0) * (it.quantity ?? 1),
		0
	   );

  /* 5b️⃣  If this was a PK-Chest loot, send our own gold embed */
  if (isPkChest) {

    const embed = new EmbedBuilder()
      .setTitle(`💰 Loot Chest – ${payload.playerName}`)
      .setColor(GOLD)
      .setThumbnail(ICON_URL)
      .addFields(
        { name: '📦 Total Loot', value: `${totalValue.toLocaleString()} GP`, inline: true },
        { name: '🌍 World',      value: `${payload.world}`,                inline: true },
      )
      .setFooter({ iconURL: ICON_URL, text: 'PVP Store' });

    await client.channels
      .fetch(CHANNEL_ID)
      .then(ch => ch.send({ embeds: [embed] }));

    console.log(`✓ Loot embedded – ${totalValue.toLocaleString()} GP`);
  }

    /* 6️⃣  Append to loot.json for monthly leader-board */
    let log=[]; try{ log = JSON.parse(fs.readFileSync(LOOT_LOG_FILE,'utf-8')); }catch{}
    log.push({
      timestamp : new Date().toISOString(),
      playerName: payload.playerName,
      world     : payload.world,
      totalValue,
      items
    });
    fs.writeFileSync(LOOT_LOG_FILE, JSON.stringify(log, null, 2));

    console.log(`✓ Logged PK loot – ${totalValue.toLocaleString()} GP`);
    return res.status(200).end();
  } catch (err) {
    console.error('✗ Loot error:', err);
    return res.status(400).send('Invalid loot data');
  }
});

 const PORT = process.env.PORT || 3001;          // 3001 for local dev
 app.listen(PORT, () => console.log(`🟡 /logLoot server listening on ${PORT}`));

client.login(process.env.TOKEN);
