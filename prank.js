// prank.js
// Per-user, per-guild prank modes. Stackable — one victim can have multiple
// modes active at once. Persisted to disk so they survive restarts.
//
// Modes:
//   delete       — nuke their messages the instant they're sent
//   clown        — auto-react 🤡 then spell out C L O W N
//   uwu          — delete + repost their message uwu-fied
//   pirate       — delete + repost their message as pirate-speak
//   spongebob    — delete + repost as sPoNgEbOb cAsE
//   autocorrect  — bot replies with `*<wrong word>` mimicking phone autocorrect
//
// Mutation modes (uwu / pirate / spongebob) stack — if multiple are on, they
// compose in that order. Setting `delete` alongside a mutation = delete wins
// (just nukes, no repost). `clown` and `autocorrect` are non-destructive and
// always run regardless.

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'prank_victims.json');
const KF_ADMIN_ROLE = process.env.KF_ADMIN_ROLE_ID ?? '1392512695303143435';

// Regional indicator letters as separate reactions display as individual
// letters — they only merge into a flag when adjacent in plain text.
const CLOWN_REACTIONS = ['🤡', '🇨', '🇱', '🇴', '🇼', '🇳'];

const MODE_CHOICES = [
  { name: '🗑️ Delete messages',       value: 'delete' },
  { name: '🤡 Clown react (C L O W N)', value: 'clown' },
  { name: '🥚 UwU-fy',                value: 'uwu' },
  { name: '🏴‍☠️ Pirate-speak',         value: 'pirate' },
  { name: '🧽 SpongeBob case',         value: 'spongebob' },
  { name: '📱 Fake autocorrect reply', value: 'autocorrect' },
];
const VALID_MODES = new Set(MODE_CHOICES.map(c => c.value));

// State shape:
//   { [guildId]: { [userId]: { modes: { delete?, clown?, ... },
//                              addedAt, addedBy } } }
let state = {};

function load() {
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { state = {}; }
  // Backward-compat: old shape was { addedAt, addedBy } with no `modes` field,
  // and presence implied delete-mode. Migrate in place.
  for (const g of Object.keys(state)) {
    for (const u of Object.keys(state[g])) {
      const e = state[g][u];
      if (e && !e.modes) {
        state[g][u] = { modes: { delete: true }, addedAt: e.addedAt, addedBy: e.addedBy };
      }
    }
  }
}
function save() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
load();

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
         interaction.member?.roles?.cache?.has(KF_ADMIN_ROLE);
}

function modesOf(g, u) {
  return state[g]?.[u]?.modes ?? {};
}

// ─── Text mutators ──────────────────────────────────────────────────────────
function toSpongebob(s) {
  let out = '', upper = false;
  for (const c of s) {
    if (/[a-z]/i.test(c)) {
      out += upper ? c.toUpperCase() : c.toLowerCase();
      upper = !upper;
    } else out += c;
  }
  return out;
}

const UWU_SUFFIXES = [' uwu', ' OwO', ' >w<', ' :3', ' rawr~', ' nya~', ' (｡♥‿♥｡)'];
function toUwu(s) {
  const r = (Math.random() * UWU_SUFFIXES.length) | 0;
  return s
    .replace(/[rl]/g, 'w')
    .replace(/[RL]/g, 'W')
    .replace(/n([aeiou])/g, 'ny$1')
    .replace(/N([aeiou])/g, 'Ny$1')
    .replace(/ove/g, 'uv')
    + UWU_SUFFIXES[r];
}

const PIRATE_DICT = {
  hello: 'ahoy', hi: 'ahoy', hey: 'ahoy', heya: 'ahoy',
  you: 'ye', your: 'yer', "you're": 'ye be', yours: 'yers',
  yes: 'aye', yeah: 'aye', no: 'nay',
  is: 'be', are: 'be', am: 'be', was: 'were',
  my: 'me',
  friend: 'matey', friends: 'mateys', mate: 'matey', mates: 'mateys',
  the: "th'", before: 'afore', with: "wit'",
  treasure: 'booty', money: 'doubloons', gp: 'doubloons',
  fight: 'fray', kill: 'slay', killed: 'slain',
  ship: 'vessel', boat: 'vessel',
  guys: 'lads', guy: 'lad',
};
const PIRATE_PREFIXES = ['Arrr! ', 'Yarr! ', 'Ahoy! ', 'Avast! ', 'Shiver me timbers, '];
const PIRATE_SUFFIXES = [', matey!', ', ye scallywag!', ', arrr!', ', ye landlubber!', ', yarr!'];
function toPirate(s) {
  const pre = PIRATE_PREFIXES[(Math.random() * PIRATE_PREFIXES.length) | 0];
  const suf = PIRATE_SUFFIXES[(Math.random() * PIRATE_SUFFIXES.length) | 0];
  const swapped = s.replace(/[a-z']+/gi, w => {
    const low = w.toLowerCase();
    const hit = PIRATE_DICT[low];
    if (!hit) return w;
    // Preserve capitalisation of the original word's first letter
    return w[0] === w[0].toUpperCase() ? hit[0].toUpperCase() + hit.slice(1) : hit;
  });
  return pre + swapped + suf;
}

// Pick a random word from the message and mangle it into a plausible-looking
// autocorrect "fix". Mimics how phones spit out *typo a beat after you send.
const AUTOCORRECT_TRANSFORMS = [
  (w) => w.slice(0, -1) + 'k',                                     // last letter → k
  (w) => w.slice(0, -1) + 'j',                                     // last letter → j
  (w) => 'p' + w.slice(1),                                         // first letter → p
  (w) => 'd' + w.slice(1),                                         // first letter → d
  (w) => w.replace(/[aeiou]/i, 'u'),                               // first vowel → u
  (w) => w.replace(/[aeiou]/i, 'i'),                               // first vowel → i
  (w) => w.length > 3 ? w.slice(0, 2) + w[3] + w[2] + w.slice(4) : w, // swap two middle letters
  (w) => w + 'ing',                                                // add ing
  (w) => w[0] + w.slice(1).replace(/./, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()),
];
function pickAutocorrect(content) {
  const words = (content ?? '').split(/\s+/).filter(w => w.length >= 3 && /^[a-z]+$/i.test(w));
  if (!words.length) return null;
  // Bias toward longer words — they look funnier when butchered
  words.sort((a, b) => b.length - a.length);
  const w = words[(Math.random() * Math.min(3, words.length)) | 0];
  const t = AUTOCORRECT_TRANSFORMS[(Math.random() * AUTOCORRECT_TRANSFORMS.length) | 0];
  const fake = t(w);
  if (!fake || fake.toLowerCase() === w.toLowerCase()) return null;
  return fake;
}

// ─── Slash commands ─────────────────────────────────────────────────────────
export const prankCommands = [
  new SlashCommandBuilder().setName('prank').setDescription('Auto-react / mutate / delete a user\'s messages (joke)')
    .addSubcommand(s => s.setName('on').setDescription('Enable a prank mode on a user')
      .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
      .addStringOption(o => o.setName('mode').setDescription('Which prank').setRequired(true).addChoices(...MODE_CHOICES)))
    .addSubcommand(s => s.setName('off').setDescription('Disable a prank mode')
      .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
      .addStringOption(o => o.setName('mode').setDescription('Which prank').setRequired(true).addChoices(...MODE_CHOICES)))
    .addSubcommand(s => s.setName('list').setDescription('Show all active prank targets in this server'))
    .addSubcommand(s => s.setName('clear').setDescription('Clear ALL prank state for one user (or everyone in this server)')
      .addUserOption(o => o.setName('user').setDescription('Clear only this user (omit to clear the whole server)'))),
];

const MODE_LABELS = Object.fromEntries(MODE_CHOICES.map(c => [c.value, c.name]));
const MODE_NOTES = {
  delete:      '*(Needs **Manage Messages** in each channel.)*',
  clown:       '*(Needs **Add Reactions**. Reactions land in order: 🤡 🇨 🇱 🇴 🇼 🇳)*',
  uwu:         '*(Needs **Manage Messages** + **Send Messages**. Original is nuked, repost is uwu-fied.)*',
  pirate:      '*(Needs **Manage Messages** + **Send Messages**. Arrrr, matey!)*',
  spongebob:   '*(Needs **Manage Messages** + **Send Messages**.)*',
  autocorrect: '*(Bot replies with `*<typo>` like a phone autocorrect — doesn\'t delete the original.)*',
};

// ─── Interaction handler ────────────────────────────────────────────────────
export async function handlePrankInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'prank') return false;
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Server only.', ephemeral: true });
    return true;
  }
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '🔒 Admins only (Manage Server, or Crater killfeed admin role).', ephemeral: true });
    return true;
  }

  const g   = interaction.guildId;
  const sub = interaction.options.getSubcommand();
  state[g]  = state[g] ?? {};

  if (sub === 'on') {
    const u    = interaction.options.getUser('user', true);
    const mode = interaction.options.getString('mode', true);
    if (!VALID_MODES.has(mode)) return interaction.reply({ content: `Unknown mode: \`${mode}\``, ephemeral: true });
    state[g][u.id] = state[g][u.id] ?? { modes: {}, addedAt: Date.now(), addedBy: interaction.user.id };
    state[g][u.id].modes[mode] = true;
    save();
    return interaction.reply({
      content: `😈 Enabled **${MODE_LABELS[mode]}** on <@${u.id}>.\n${MODE_NOTES[mode]}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  if (sub === 'off') {
    const u    = interaction.options.getUser('user', true);
    const mode = interaction.options.getString('mode', true);
    const entry = state[g][u.id];
    const had   = !!entry?.modes?.[mode];
    if (entry) {
      delete entry.modes[mode];
      if (Object.keys(entry.modes).length === 0) delete state[g][u.id];
    }
    save();
    return interaction.reply({
      content: had ? `✅ Disabled **${MODE_LABELS[mode]}** on <@${u.id}>.` : `<@${u.id}> didn't have **${MODE_LABELS[mode]}** active.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  if (sub === 'list') {
    const users = state[g];
    const ids   = Object.keys(users ?? {});
    if (!ids.length) return interaction.reply({ content: 'No active prank targets in this server.', ephemeral: true });
    const lines = ids.map(id => {
      const active = Object.keys(users[id].modes ?? {}).filter(k => users[id].modes[k]);
      return `• <@${id}> — ${active.length ? active.map(x => `\`${x}\``).join(', ') : '*(no modes)*'}`;
    });
    return interaction.reply({
      content: `😈 **Active prank targets in this server:**\n${lines.join('\n')}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  if (sub === 'clear') {
    const u = interaction.options.getUser('user');
    if (u) {
      const had = !!state[g][u.id];
      delete state[g][u.id];
      save();
      return interaction.reply({
        content: had ? `✅ Cleared all pranks on <@${u.id}>.` : `<@${u.id}> had no active pranks.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }
    const n = Object.keys(state[g] ?? {}).length;
    state[g] = {};
    save();
    return interaction.reply({ content: `✅ Cleared **${n}** prank target${n === 1 ? '' : 's'} in this server.`, ephemeral: true });
  }

  return false;
}

// ─── Message handler — called from bot.js messageCreate ─────────────────────
// Returns true if the original message was deleted (so downstream handlers
// can skip safely).
export async function handlePrankMessage(message) {
  if (!message.guildId) return false;
  if (message.author?.bot) return false;
  const modes = modesOf(message.guildId, message.author.id);
  if (!modes || Object.keys(modes).length === 0) return false;

  // 1. Clown reactions — fire-and-forget, must START before any delete so
  //    they at least queue up against the message id.
  if (modes.clown) {
    (async () => {
      for (const e of CLOWN_REACTIONS) {
        try { await message.react(e); }
        catch (err) { console.error('[PRANK] clown react failed:', err.message); return; }
      }
    })();
  }

  // 2. Fake autocorrect — independent reply, doesn't touch the original.
  if (modes.autocorrect) {
    const fake = pickAutocorrect(message.content);
    if (fake) {
      message.reply({ content: `*${fake}`, allowedMentions: { repliedUser: false } })
        .catch(e => console.error('[PRANK] autocorrect failed:', e.message));
    }
  }

  // 3. Mutations (uwu / pirate / spongebob) — compose in fixed order so the
  //    result is deterministic when multiple are stacked.
  const mutators = [];
  if (modes.uwu)       mutators.push(toUwu);
  if (modes.pirate)    mutators.push(toPirate);
  if (modes.spongebob) mutators.push(toSpongebob);

  // If `delete` is also set, it wins — no repost, just nuke.
  if (mutators.length > 0 && !modes.delete && (message.content ?? '').length > 0) {
    let text = message.content;
    for (const m of mutators) text = m(text);
    try {
      await message.delete();
      await message.channel.send({
        content: `**${message.member?.displayName ?? message.author.username}:** ${text}`,
        allowedMentions: { parse: [] },
      });
      return true;
    } catch (e) {
      console.error('[PRANK] mutate failed:', e.message);
    }
  } else if (modes.delete) {
    try {
      await message.delete();
      return true;
    } catch (e) {
      console.error('[PRANK] delete failed:', e.message);
    }
  }
  return false;
}
