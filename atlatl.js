import {
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';

const WIKI_URL = 'https://oldschool.runescape.wiki/w/Eclipse_atlatl';

const PRAYERS = Object.freeze({
  none: { label: 'None', numerator: 1, denominator: 1 },
  sharp_eye: { label: 'Sharp Eye', numerator: 105, denominator: 100, minimumGain: 1 },
  hawk_eye: { label: 'Hawk Eye', numerator: 110, denominator: 100 },
  eagle_eye: { label: 'Eagle Eye', numerator: 115, denominator: 100 },
  deadeye: { label: 'Deadeye', numerator: 118, denominator: 100 },
  rigour: { label: 'Rigour', numerator: 123, denominator: 100 },
});

const STYLES = Object.freeze({
  rapid: { label: 'Rapid', damageLevelBonus: 0 },
  accurate: { label: 'Accurate', damageLevelBonus: 3 },
  longrange: { label: 'Longrange', damageLevelBonus: 0 },
});

const VOID_SETS = Object.freeze({
  none: { label: 'None', numerator: 1, denominator: 1 },
  regular: { label: 'Regular ranged Void', numerator: 11, denominator: 10 },
  elite: { label: 'Elite ranged Void', numerator: 9, denominator: 8 },
});

const TARGET_BONUSES = Object.freeze({
  none: { label: 'None', numerator: 1, denominator: 1 },
  slayer: { label: 'Slayer helm / Black mask on task', numerator: 7, denominator: 6 },
  salve: { label: 'Salve / Salve (i) vs undead', numerator: 7, denominator: 6 },
  salve_e: { label: 'Salve (e) / (ei) vs undead', numerator: 6, denominator: 5 },
});

function boundedInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function configuredValue(config, key, name) {
  const value = config[key];
  if (!value) throw new RangeError(`Unknown ${name}: ${key}`);
  return value;
}

function applyPrayer(visibleStrength, prayer) {
  if (prayer.minimumGain && visibleStrength <= 20) {
    return visibleStrength + prayer.minimumGain;
  }
  return Math.trunc(visibleStrength * prayer.numerator / prayer.denominator);
}

export function calculateAtlatlMaxHit({
  visibleStrength,
  meleeStrengthBonus,
  prayer = 'none',
  style = 'rapid',
  voidSet = 'none',
  targetBonus = 'none',
  burn = 0,
}) {
  const strength = boundedInteger(visibleStrength, 'Visible Strength', 1, 255);
  const equipmentStrength = boundedInteger(meleeStrengthBonus, 'Melee Strength bonus', -64, 500);
  const burnDamage = boundedInteger(burn, 'Burn damage', 0, 50);
  const prayerConfig = configuredValue(PRAYERS, prayer, 'prayer');
  const styleConfig = configuredValue(STYLES, style, 'style');
  const voidConfig = configuredValue(VOID_SETS, voidSet, 'Void set');
  const targetConfig = configuredValue(TARGET_BONUSES, targetBonus, 'target bonus');

  const prayerAdjustedLevel = applyPrayer(strength, prayerConfig);
  const preVoidEffectiveLevel = prayerAdjustedLevel + styleConfig.damageLevelBonus + 8;
  const effectiveLevel = Math.trunc(
    preVoidEffectiveLevel * voidConfig.numerator / voidConfig.denominator,
  );
  const baseMaxHit = Math.trunc(
    (effectiveLevel * (equipmentStrength + 64) + 320) / 640,
  );
  const maxHit = Math.trunc(
    baseMaxHit * targetConfig.numerator / targetConfig.denominator,
  );

  return {
    visibleStrength: strength,
    meleeStrengthBonus: equipmentStrength,
    prayer,
    prayerConfig,
    style,
    styleConfig,
    voidSet,
    voidConfig,
    targetBonus,
    targetConfig,
    burn: burnDamage,
    prayerAdjustedLevel,
    preVoidEffectiveLevel,
    effectiveLevel,
    baseMaxHit,
    maxHit,
    specialMinHit: Math.trunc(burnDamage / 2),
    specialMaxHit: maxHit + burnDamage,
    fullBurnSpecialMinHit: 25,
    fullBurnSpecialMaxHit: maxHit + 50,
  };
}

export function findAtlatlBreakpoints(input) {
  const current = calculateAtlatlMaxHit(input);

  function find(field, maxValue) {
    const startingValue = input[field];
    for (let value = startingValue + 1; value <= maxValue; value += 1) {
      const result = calculateAtlatlMaxHit({ ...input, [field]: value });
      if (result.maxHit > current.maxHit) {
        return {
          delta: value - startingValue,
          value,
          maxHit: result.maxHit,
        };
      }
    }
    return null;
  }

  return {
    meleeStrengthBonus: find('meleeStrengthBonus', 500),
    visibleStrength: find('visibleStrength', 255),
  };
}

function signed(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function factorText(config) {
  if (config.numerator === config.denominator) return '0%';
  const percent = ((config.numerator / config.denominator) - 1) * 100;
  return `${percent.toFixed(Number.isInteger(percent) ? 0 : 2)}%`;
}

function breakpointText(breakpoints) {
  const lines = [];
  const bonus = breakpoints.meleeStrengthBonus;
  const strength = breakpoints.visibleStrength;

  if (bonus) {
    lines.push(
      `Gear: **${signed(bonus.delta)}** melee Strength bonus `
      + `(total ${signed(bonus.value)}) -> **${bonus.maxHit}**`,
    );
  } else {
    lines.push('Gear: no higher breakpoint within the command range');
  }

  if (strength) {
    lines.push(
      `Level: **+${strength.delta}** visible Strength `
      + `(to ${strength.value}) -> **${strength.maxHit}**`,
    );
  } else {
    lines.push('Level: no higher breakpoint within the command range');
  }

  return lines.join('\n');
}

function calculationText(result) {
  const prayerLine = result.prayerConfig.minimumGain && result.visibleStrength <= 20
    ? `${result.visibleStrength} + 1 minimum prayer gain = ${result.prayerAdjustedLevel}`
    : `floor(${result.visibleStrength} x ${result.prayerConfig.numerator}`
      + ` / ${result.prayerConfig.denominator}) = ${result.prayerAdjustedLevel}`;

  const lines = [
    `Prayer level: \`${prayerLine}\``,
    `Style/base: \`${result.prayerAdjustedLevel} + `
      + `${result.styleConfig.damageLevelBonus} + 8 = ${result.preVoidEffectiveLevel}\``,
  ];

  if (result.voidSet !== 'none') {
    lines.push(
      `Void: \`floor(${result.preVoidEffectiveLevel} x ${result.voidConfig.numerator}`
      + ` / ${result.voidConfig.denominator}) = ${result.effectiveLevel}\``,
    );
  }

  lines.push(
    `Base hit: \`floor((${result.effectiveLevel} x `
    + `(${result.meleeStrengthBonus} + 64) + 320) / 640) = ${result.baseMaxHit}\``,
  );

  if (result.targetBonus !== 'none') {
    lines.push(
      `Target: \`floor(${result.baseMaxHit} x ${result.targetConfig.numerator}`
      + ` / ${result.targetConfig.denominator}) = ${result.maxHit}\``,
    );
  }

  return lines.join('\n');
}

function buildResultEmbed(result, breakpoints) {
  const specLabel = result.burn === 0
    ? 'Eclipse spec with no Burn'
    : `Eclipse spec with ${result.burn} Burn`;
  const resultLines = [
    `Normal max hit: **${result.maxHit}**`,
    `${specLabel}: **${result.specialMinHit}-${result.specialMaxHit}**`,
  ];

  if (result.burn !== 50) {
    resultLines.push(
      `Full 50-Burn spec ceiling: **${result.fullBurnSpecialMinHit}`
      + `-${result.fullBurnSpecialMaxHit}**`,
    );
  }

  return new EmbedBuilder()
    .setColor(0xD99A32)
    .setTitle('Eclipse atlatl max-hit calculator')
    .setURL(WIKI_URL)
    .setDescription(resultLines.join('\n'))
    .addFields(
      {
        name: 'Inputs',
        value: [
          `Visible Strength: **${result.visibleStrength}**`,
          `Melee Strength bonus: **${signed(result.meleeStrengthBonus)}** `
            + `(includes the atlatl's +40)`,
          `Ranged prayer: **${result.prayerConfig.label}** `
            + `(${factorText(result.prayerConfig)})`,
          `Style: **${result.styleConfig.label}**`,
          `Ranged Void: **${result.voidConfig.label}**`,
          `Target bonus: **${result.targetConfig.label}**`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Exact calculation',
        value: calculationText(result),
        inline: false,
      },
      {
        name: 'Next normal-hit breakpoints',
        value: breakpointText(breakpoints),
        inline: false,
      },
      {
        name: 'How to hit higher',
        value: [
          'Boost visible Strength, use Rigour, choose Accurate for the raw max hit,',
          'and stack melee Strength bonus. Ranged level and ranged attack bonus only',
          'improve accuracy. Rapid will usually win on DPS because it attacks faster.',
          'The special requires the full Eclipse set and consumes Burn at melee distance.',
        ].join(' '),
        inline: false,
      },
    )
    .setFooter({
      text: 'Slayer and Salve are optional target bonuses. Other encounter modifiers are not included.',
    });
}

export const atlatlCommands = [
  new SlashCommandBuilder()
    .setName('atlatl')
    .setDescription('Calculate an Eclipse atlatl max hit and its next damage breakpoints')
    .addIntegerOption(option => option
      .setName('visible_strength')
      .setDescription('Current visible Strength after boosts or drains')
      .setMinValue(1)
      .setMaxValue(255)
      .setRequired(true))
    .addIntegerOption(option => option
      .setName('melee_strength')
      .setDescription("Total melee Strength bonus, including the atlatl's +40")
      .setMinValue(-64)
      .setMaxValue(500)
      .setRequired(true))
    .addStringOption(option => option
      .setName('prayer')
      .setDescription('Active ranged prayer')
      .addChoices(
        { name: 'None', value: 'none' },
        { name: 'Sharp Eye (5%)', value: 'sharp_eye' },
        { name: 'Hawk Eye (10%)', value: 'hawk_eye' },
        { name: 'Eagle Eye (15%)', value: 'eagle_eye' },
        { name: 'Deadeye (18%)', value: 'deadeye' },
        { name: 'Rigour (23%)', value: 'rigour' },
      ))
    .addStringOption(option => option
      .setName('style')
      .setDescription('Atlatl attack style')
      .addChoices(
        { name: 'Rapid', value: 'rapid' },
        { name: 'Accurate (+3 damage level)', value: 'accurate' },
        { name: 'Longrange', value: 'longrange' },
      ))
    .addStringOption(option => option
      .setName('void')
      .setDescription('Full ranged Void set, including the ranger helm')
      .addChoices(
        { name: 'None', value: 'none' },
        { name: 'Regular ranged Void (10%)', value: 'regular' },
        { name: 'Elite ranged Void (12.5%)', value: 'elite' },
      ))
    .addStringOption(option => option
      .setName('target')
      .setDescription('Optional target-specific melee damage bonus')
      .addChoices(
        { name: 'None', value: 'none' },
        { name: 'Slayer helm / Black mask on task', value: 'slayer' },
        { name: 'Salve / Salve (i) vs undead', value: 'salve' },
        { name: 'Salve (e) / (ei) vs undead', value: 'salve_e' },
      ))
    .addIntegerOption(option => option
      .setName('burn')
      .setDescription('Remaining Burn damage consumed by the full-set special')
      .setMinValue(0)
      .setMaxValue(50)),
];

export async function handleAtlatlInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'atlatl') {
    return false;
  }

  try {
    const input = {
      visibleStrength: interaction.options.getInteger('visible_strength', true),
      meleeStrengthBonus: interaction.options.getInteger('melee_strength', true),
      prayer: interaction.options.getString('prayer') || 'none',
      style: interaction.options.getString('style') || 'rapid',
      voidSet: interaction.options.getString('void') || 'none',
      targetBonus: interaction.options.getString('target') || 'none',
      burn: interaction.options.getInteger('burn') ?? 0,
    };
    const result = calculateAtlatlMaxHit(input);
    const breakpoints = findAtlatlBreakpoints(input);

    await interaction.reply({
      embeds: [buildResultEmbed(result, breakpoints)],
    });
  } catch (error) {
    console.error('[ATLATL] Calculator failed:', error);
    await interaction.reply({
      content: 'I could not calculate that atlatl hit. Check the values and try again.',
      ephemeral: true,
    });
  }

  return true;
}
