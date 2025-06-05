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
client.once('ready', () => console.log('🟡 Bot is online'));


/*────────────────────  Helper functions  ───────────────────────*/
const errorEmbed = txt => new EmbedBuilder()
  .setTitle('⚠️ Error').setDescription(txt).setColor(GOLD)
  .setThumbnail(ICON_URL).setFooter({ iconURL: ICON_URL, text:'PVP Store' });

const formatAbbr = v => v>=1e9?`${v/1e9}B`:v>=1e6?`${v/1e6}M`:v>=1e3?`${v/1e3}K`:`${v}`;
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);

/*────────────────────  Command handler  ────────────────────────*/
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const args = message.content.trim().split(/ +/);
  const cmd  = args.shift().toLowerCase();

  /* ---------- !setprize ---------- */
  if (cmd === '!setprize') {
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
    fs.writeFileSync(PRIZES_FILE, JSON.stringify(prizes,null,2)); await message.delete();

    const breakdown=Object.entries(monthPrizes).map(([p,g])=>`${p}: ${g.toLocaleString()} GP (${formatAbbr(g)})`).join('\n');
    return message.channel.send({ embeds:[ new EmbedBuilder()
      .setTitle(`✅ Prizes Set for ${cap(month)}`)
      .setDescription(`**Breakdown:**\n${breakdown}\n\n_Last set by <@${member.id}> (${member.displayName})_`)
      .setColor(GOLD).setThumbnail(ICON_URL)
      .setFooter({ iconURL: ICON_URL, text:'PVP Store' })]});
  }

  /* ---------- !totalprize ---------- */
  if (cmd === '!totalprize') {
    if(!args[0]) return message.channel.send({ embeds:[ errorEmbed('Usage: `!totalprize <Month>`') ]});
    const month=args[0].toLowerCase();
    let prizes={}; try{prizes=JSON.parse(fs.readFileSync(PRIZES_FILE));}catch{}
    const entry=prizes[month];
    if(!entry) return message.channel.send({ embeds:[ errorEmbed(`No prizes set for **${args[0]}**`) ]});

    const total=Object.values(entry.prizes).reduce((s,v)=>s+v,0);
    const breakdown=Object.entries(entry.prizes).map(([p,g])=>`${p}: ${g.toLocaleString()} GP (${formatAbbr(g)})`).join('\n');
    await message.delete();
    return message.channel.send({ embeds:[ new EmbedBuilder()
      .setTitle(`🧮 Total Prize Pool – ${cap(month)}`)
      .setDescription(`Total: **${total.toLocaleString()} GP**\n\n${breakdown}\n\n_Last set by <@${entry.setBy.id}> (${entry.setBy.display})_`)
      .setColor(GOLD).setThumbnail(ICON_URL)
      .setFooter({ iconURL: ICON_URL, text:'PVP Store' })]});
  }

  /* ---------- !winner ---------- */
  if (cmd === '!winner') {
    if(!args[0]) return message.channel.send({ embeds:[ errorEmbed('Usage: `!winner <Month>`') ]});
    const monthArg=args[0].toLowerCase(); const monthIdx=new Date(`${cap(monthArg)} 1, ${new Date().getFullYear()}`).getMonth();
    let log=[]; try{log=JSON.parse(fs.readFileSync(LOOT_LOG_FILE,'utf-8'));}catch{}
    const monthLoot=log.filter(e=>new Date(e.timestamp).getMonth()===monthIdx);
    if(!monthLoot.length) return message.channel.send({ embeds:[ errorEmbed(`No data found for **${cap(monthArg)}**`) ]});

    const totals={}; monthLoot.forEach(e=> totals[e.playerName]=(totals[e.playerName]??0)+e.totalValue);
    const top=Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,5);
    let prizeTable={},setBy; try{
      const all=JSON.parse(fs.readFileSync(PRIZES_FILE)); if(all[monthArg]){prizeTable=all[monthArg].prizes; setBy=all[monthArg].setBy;}
    }catch{}

    const places=['1st','2nd','3rd','4th','5th'];
    const lines=top.map(([name,gp],i)=>{
      const prize=prizeTable[places[i]]?` — 🏆 ${prizeTable[places[i]].toLocaleString()} GP`:''; return `**${places[i]}**  **${name}**  —  ${gp.toLocaleString()} GP${prize}`;
    }).join('\n');

    return message.channel.send({ embeds:[ new EmbedBuilder()
      .setTitle(`🏆 Winners – ${cap(monthArg)}`)
      .setDescription(lines + (setBy?`\n\n_Prizes set by <@${setBy.id}> (${setBy.display})_`:''))
      .setColor(GOLD).setThumbnail(ICON_URL)
      .setFooter({ iconURL: ICON_URL, text:'PVP Store' })]});
  }

/* ---------- !clearprize ---------- */
if (cmd === '!clearprize') {
  if (!args[0]) return;

  const month = args[0].toLowerCase();

  let prizes = {};
  try { prizes = JSON.parse(fs.readFileSync(PRIZES_FILE)); } catch {}

  if (prizes[month]) {
    delete prizes[month];
    fs.writeFileSync(PRIZES_FILE, JSON.stringify(prizes, null, 2));

    await message.delete();                       // tidy chat

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

  /* ---------- !help ---------- */
  if (cmd === '!help') {
    return message.channel.send({ embeds:[ new EmbedBuilder()
      .setTitle('📖 PVP Store Bot Commands').setColor(GOLD).setThumbnail(ICON_URL)
      .setFooter({ iconURL: ICON_URL, text:'PVP Store' })
      .setDescription(
        '💰 **!setprize &lt;Month&gt; 1m,2m,...** – set prize values\n' +
        '🧮 **!totalprize &lt;Month&gt;** – total & breakdown\n' +
        '🏆 **!winner &lt;Month&gt;** – top-5 earners & prizes\n' +
        '🗑️ **!clearprize &lt;Month&gt;** – delete that month\n' +
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
	if (!isPK && !isPkChest) {
	  return res.status(204).end();      // silently discard everything else
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
