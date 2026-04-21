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

import { registerRSNs, getAccountRSNs, removeRSNs, replaceAllRSNs } from './killfeed.js';

const CATEGORY_ID   = process.env.TICKET_CATEGORY_ID;
const ADMIN_ROLE_ID = process.env.TICKET_ADMIN_ROLE_ID;
const EMBED_ICON    = process.env.EMBED_ICON ?? 'https://i.ibb.co/8nXbWYmq/The-Craterlogo.webp';

const BUTTON_OPEN    = 'onboard_open';
const BUTTON_ADD     = 'onboard_addrsn';
const BUTTON_VIEW    = 'onboard_viewrsn';
const BUTTON_REMOVE  = 'onboard_removersn';
const BUTTON_REPLACE = 'onboard_replacersn';
const BUTTON_CLOSE   = 'onboard_close';

const MODAL_ADD     = 'onboard_modal_add';
const MODAL_REMOVE  = 'onboard_modal_remove';
const MODAL_REPLACE = 'onboard_modal_replace';

// ─── Slash commands ───────────────────────────────────────────────────────────
export const onboardCommands = [
  new SlashCommandBuilder()
    .setName('kfonboard')
    .setDescription('Onboarding ticket system')
    .addSubcommand(s => s.setName('setup').setDescription('Post the registration embed in this channel')),
];

// ─── Embeds ───────────────────────────────────────────────────────────────────
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

function ticketEmbed(user) {
  return new EmbedBuilder()
    .setColor(0x00CC88)
    .setTitle(`📋 RSN Registration — ${user.username}`)
    .setThumbnail(EMBED_ICON)
    .setDescription(
      `Hey <@${user.id}>! Use the buttons below to manage your in-game name(s).\n\n` +
      '**Add RSNs** — link new names to your account\n' +
      '**View RSNs** — see your currently linked names\n' +
      '**Remove RSN** — unlink a specific name\n' +
      '**Replace All** — clear everything and start fresh'
    )
    .setFooter({ text: 'The Crater' })
    .setTimestamp();
}

// ─── Button rows ──────────────────────────────────────────────────────────────
function openButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_OPEN).setLabel('📋 Register my RSNs').setStyle(ButtonStyle.Primary)
  );
}

function ticketButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BUTTON_ADD).setLabel('➕ Add RSNs').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(BUTTON_VIEW).setLabel('👁️ View RSNs').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(BUTTON_REMOVE).setLabel('➖ Remove RSN').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(BUTTON_REPLACE).setLabel('🔄 Replace All').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(BUTTON_CLOSE).setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ─── Interaction handler ──────────────────────────────────────────────────────
export async function handleOnboardInteraction(interaction) {

  // ── /kfonboard setup ──────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'kfonboard') {
    if (interaction.options.getSubcommand() === 'setup') {
      await interaction.channel.send({ embeds: [registerEmbed()], components: [openButton()] });
      return interaction.reply({ content: '✅ Onboarding embed posted.', ephemeral: true });
    }
    return false;
  }

  // ── Open ticket ───────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === BUTTON_OPEN) {
    const guild    = interaction.guild;
    const user     = interaction.user;
    const safeName = user.username.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || user.id;
    const chanName = `ticket-${safeName}`;

    const existing = guild.channels.cache.find(c => c.name === chanName);
    if (existing) {
      return interaction.reply({ content: `You already have a ticket open: <#${existing.id}>`, ephemeral: true });
    }

    const overwrites = [
      { id: guild.roles.everyone.id, deny:  [PermissionFlagsBits.ViewChannel] },
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

    await channel.send({ embeds: [ticketEmbed(user)], components: ticketButtons() });
    return interaction.reply({ content: `✅ Your ticket is ready: <#${channel.id}>`, ephemeral: true });
  }

  // ── Add RSNs → modal ──────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === BUTTON_ADD) {
    const modal = new ModalBuilder().setCustomId(MODAL_ADD).setTitle('Add RSN(s)');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('rsn_input')
        .setLabel('RSN(s) to add, comma-separated')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Zezima, My Alt, PureAcc')
        .setRequired(true)
        .setMaxLength(200)
    ));
    return interaction.showModal(modal);
  }

  // ── View RSNs ─────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === BUTTON_VIEW) {
    const rsns = getAccountRSNs(interaction.user.id);
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('👁️ Your Linked RSNs')
          .setDescription(rsns.length ? rsns.map((r, i) => `**${i + 1}.** ${r}`).join('\n') : 'No RSNs linked yet.')
          .setFooter({ text: 'The Crater' })
          .setTimestamp(),
      ],
      ephemeral: true,
    });
  }

  // ── Remove RSN → modal ────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === BUTTON_REMOVE) {
    const current = getAccountRSNs(interaction.user.id);
    const modal = new ModalBuilder().setCustomId(MODAL_REMOVE).setTitle('Remove RSN(s)');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('rsn_input')
        .setLabel('RSN(s) to remove, comma-separated')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(current.length ? current.join(', ') : 'No RSNs linked yet')
        .setRequired(true)
        .setMaxLength(200)
    ));
    return interaction.showModal(modal);
  }

  // ── Replace all → modal ───────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === BUTTON_REPLACE) {
    const modal = new ModalBuilder().setCustomId(MODAL_REPLACE).setTitle('Replace All RSNs');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('rsn_input')
        .setLabel('Your new RSN(s), comma-separated')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('This will remove all existing names first')
        .setRequired(true)
        .setMaxLength(200)
    ));
    return interaction.showModal(modal);
  }

  // ── Modal: Add ────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === MODAL_ADD) {
    const rsns = interaction.fields.getTextInputValue('rsn_input').split(',').map(s => s.trim()).filter(Boolean);
    if (!rsns.length) return interaction.reply({ content: 'No RSNs provided.', ephemeral: true });
    registerRSNs(interaction.user.id, rsns);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x00CC88).setTitle('✅ RSNs Added!')
        .setDescription(`Linked **${rsns.join(', ')}** to your account.\n\nCurrent names: **${getAccountRSNs(interaction.user.id).join(', ')}**`)
        .setFooter({ text: 'The Crater' }).setTimestamp()],
    });
  }

  // ── Modal: Remove ─────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === MODAL_REMOVE) {
    const rsns = interaction.fields.getTextInputValue('rsn_input').split(',').map(s => s.trim()).filter(Boolean);
    if (!rsns.length) return interaction.reply({ content: 'No RSNs provided.', ephemeral: true });
    removeRSNs(interaction.user.id, rsns);
    const remaining = getAccountRSNs(interaction.user.id);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xFF4400).setTitle('➖ RSNs Removed')
        .setDescription(`Unlinked **${rsns.join(', ')}**.\n\n${remaining.length ? `Remaining names: **${remaining.join(', ')}**` : 'No names remaining.'}`)
        .setFooter({ text: 'The Crater' }).setTimestamp()],
    });
  }

  // ── Modal: Replace all ────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === MODAL_REPLACE) {
    const rsns = interaction.fields.getTextInputValue('rsn_input').split(',').map(s => s.trim()).filter(Boolean);
    if (!rsns.length) return interaction.reply({ content: 'No RSNs provided.', ephemeral: true });
    replaceAllRSNs(interaction.user.id, rsns);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xFFD700).setTitle('🔄 RSNs Replaced')
        .setDescription(`All previous names cleared. Now linked: **${rsns.join(', ')}**`)
        .setFooter({ text: 'The Crater' }).setTimestamp()],
    });
  }

  // ── Close ticket ──────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === BUTTON_CLOSE) {
    await interaction.reply({ content: '🔒 Closing ticket...' });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
    return true;
  }

  return false;
}
