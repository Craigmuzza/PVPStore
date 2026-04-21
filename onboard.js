// onboard.js
// Ticket-based RSN onboarding for The Crater

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';

import { registerRSNs } from './killfeed.js';

const CATEGORY_ID      = process.env.TICKET_CATEGORY_ID;
const ADMIN_ROLE_ID    = process.env.TICKET_ADMIN_ROLE_ID;
const EMBED_ICON       = process.env.EMBED_ICON ?? 'https://i.ibb.co/8nXbWYmq/The-Craterlogo.webp';

const BUTTON_OPEN  = 'onboard_open';
const BUTTON_RSN   = 'onboard_addrsn';
const BUTTON_CLOSE = 'onboard_close';
const MODAL_RSN    = 'onboard_rsn_modal';
const INPUT_RSN    = 'onboard_rsn_input';

// ─── Slash commands ───────────────────────────────────────────────────────────
export const onboardCommands = [
  new SlashCommandBuilder()
    .setName('kfonboard')
    .setDescription('Onboarding ticket system')
    .addSubcommand(s => s.setName('setup').setDescription('Post the registration embed in this channel')),
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function registerEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⚔️ Welcome to The Crater')
    .setThumbnail(EMBED_ICON)
    .setDescription(
      'To be fully registered in the clan, click the button below to open a private ticket.\n\n' +
      'You\'ll be able to link all of your in-game names so your kills, loot and deaths are tracked correctly.'
    )
    .setFooter({ text: 'The Crater' })
    .setTimestamp();
}

function openButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_OPEN).setLabel('📋 Register my RSNs').setStyle(ButtonStyle.Primary)
  );
}

function ticketEmbed(user) {
  return new EmbedBuilder()
    .setColor(0x00CC88)
    .setTitle(`📋 RSN Registration — ${user.username}`)
    .setThumbnail(EMBED_ICON)
    .setDescription(
      `Hey <@${user.id}>! Use the button below to link your in-game name(s).\n\n` +
      'You can enter multiple RSNs at once, separated by commas.\n' +
      'Run it again at any time to add more names.'
    )
    .setFooter({ text: 'The Crater' })
    .setTimestamp();
}

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_RSN).setLabel('⚔️ Add my RSN(s)').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(BUTTON_CLOSE).setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger),
  );
}

// ─── Interaction handler ──────────────────────────────────────────────────────
export async function handleOnboardInteraction(interaction) {
  // Slash command
  if (interaction.isChatInputCommand() && interaction.commandName === 'kfonboard') {
    if (interaction.options.getSubcommand() === 'setup') {
      await interaction.channel.send({ embeds: [registerEmbed()], components: [openButton()] });
      return interaction.reply({ content: '✅ Onboarding embed posted.', ephemeral: true });
    }
    return false;
  }

  // Open ticket button
  if (interaction.isButton() && interaction.customId === BUTTON_OPEN) {
    const guild   = interaction.guild;
    const user    = interaction.user;
    const safeName = user.username.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || user.id;
    const chanName = `ticket-${safeName}`;

    // Check if they already have a ticket open
    const existing = guild.channels.cache.find(c => c.name === chanName);
    if (existing) {
      return interaction.reply({ content: `You already have a ticket open: <#${existing.id}>`, ephemeral: true });
    }

    // Permission overwrites
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: user.id,                 allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ];
    if (ADMIN_ROLE_ID) overwrites.push({ id: ADMIN_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

    const channel = await guild.channels.create({
      name: chanName,
      type: ChannelType.GuildText,
      parent: CATEGORY_ID ?? null,
      permissionOverwrites: overwrites,
      reason: `RSN onboarding ticket for ${user.tag}`,
    });

    await channel.send({ embeds: [ticketEmbed(user)], components: [ticketButtons()] });
    return interaction.reply({ content: `✅ Your ticket is ready: <#${channel.id}>`, ephemeral: true });
  }

  // Add RSN button → open modal
  if (interaction.isButton() && interaction.customId === BUTTON_RSN) {
    const modal = new ModalBuilder().setCustomId(MODAL_RSN).setTitle('Link your RSN(s)');
    const input = new TextInputBuilder()
      .setCustomId(INPUT_RSN)
      .setLabel('Enter your RSN(s), comma-separated')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. Zezima, My Alt, PureAcc')
      .setRequired(true)
      .setMaxLength(200);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Modal submit — register RSNs
  if (interaction.isModalSubmit() && interaction.customId === MODAL_RSN) {
    const raw  = interaction.fields.getTextInputValue(INPUT_RSN);
    const rsns = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (!rsns.length) return interaction.reply({ content: 'No RSNs provided.', ephemeral: true });

    registerRSNs(interaction.user.id, rsns);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00CC88)
          .setTitle('✅ RSNs Registered!')
          .setDescription(`Linked **${rsns.join(', ')}** to <@${interaction.user.id}>.\n\nYour kills, loot and deaths will now be tracked. Run again to add more names.`)
          .setFooter({ text: 'The Crater' })
          .setTimestamp(),
      ],
    });
    return true;
  }

  // Close ticket button
  if (interaction.isButton() && interaction.customId === BUTTON_CLOSE) {
    await interaction.reply({ content: '🔒 Closing ticket...' });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
    return true;
  }

  return false;
}
