import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { prisma } from '../db.js';
import { respondWithCatalog, resolveCatalogOption, inventoryOf } from '../catalog.js';

const LISTING_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName('marketplace')
  .setDescription('Browse or manage marketplace listings')
  .addSubcommand((sub) =>
    sub
      .setName('search')
      .setDescription('Search active listings for an item or commodity across all guilds')
      .addStringOption((opt) =>
        opt
          .setName('item')
          .setDescription('Item or commodity name')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('Show your active marketplace listings in this server'),
  );

// ── Autocomplete ──────────────────────────────────────────────────────────────
// Values are game catalog refs ("ITEM:<uuid>" / "COMMODITY:<uuid>") — same as /whohas.

export async function autocomplete(interaction: AutocompleteInteraction) {
  const sub = interaction.options.getSubcommand(false);
  if (sub !== 'search') { await interaction.respond([]); return; }
  await respondWithCatalog(interaction);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtQty(qty: number, itemType: string): string {
  if (itemType === 'COMMODITY') {
    return `${qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(3)} cSCU`;
  }
  return `×${qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2)}`;
}

function fmtPrice(askingPrice: number | null, priceNote: string | null): string {
  if (askingPrice != null) return `💰 ${askingPrice.toLocaleString()} aUEC`;
  if (priceNote)           return `💬 ${priceNote}`;
  return '💬 Price not set';
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();

  // ── /marketplace search ──────────────────────────────────────────────────────

  if (sub === 'search') {
    await interaction.deferReply();

    const raw = interaction.options.getString('item', true);
    const item = await resolveCatalogOption(raw);
    if (!item) {
      await interaction.editReply({ content: 'Please select an item from the suggestions.' });
      return;
    }
    const itemType = item.kind;

    const expiryCutoff = new Date(Date.now() - LISTING_TTL_MS);

    const listings = await prisma.inventoryEntry.findMany({
      where: {
        forSale: true,
        memberActive: true,
        listedAt: { gte: expiryCutoff },
        ...inventoryOf(item),
      },
      orderBy: [{ askingPrice: { sort: 'asc', nulls: 'last' } }, { listedAt: 'desc' }],
      take: 10,
    });

    // Batch-load guild names only for returned rows
    const guildIds = [...new Set(listings.map((l) => l.guildId))];
    const guilds = guildIds.length > 0
      ? await prisma.guild.findMany({ where: { guildId: { in: guildIds } }, select: { guildId: true, name: true } })
      : [];
    const guildNameMap = new Map(guilds.map((g) => [g.guildId, g.name]));

    const itemName = item.name;

    if (listings.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🛒 ${itemName}`)
            .setDescription('No active listings found for this item.')
            .setColor(0x747f8d),
        ],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🛒 ${itemName} — Marketplace`)
      .setColor(itemType === 'COMMODITY' ? 0xf59e0b : 0x5865f2)
      .setFooter({ text: `${listings.length} listing${listings.length !== 1 ? 's' : ''} · up to 10 shown · price low → high` });

    for (const l of listings) {
      const available = l.quantityListed ?? l.quantity;
      const guildName = guildNameMap.get(l.guildId) ?? 'Unknown Guild';
      const ql  = l.qualityLevel !== null ? ` · QL ${l.qualityLevel}` : '';
      const loc = l.location ? ` · 📍 ${l.location}` : '';
      embed.addFields({
        name:   `${l.username} · ${guildName}`,
        value:  `${fmtQty(available, itemType)}${ql}${loc}\n${fmtPrice(l.askingPrice, l.priceNote)}`,
        inline: true,
      });
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /marketplace list ────────────────────────────────────────────────────────

  if (sub === 'list') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const expiryCutoff = new Date(Date.now() - LISTING_TTL_MS);

    const FIELD_LIMIT = 25;
    const listings = await prisma.inventoryEntry.findMany({
      where: { guildId: interaction.guildId, userId: interaction.user.id, forSale: true },
      orderBy: [{ itemName: 'asc' }],
      take: FIELD_LIMIT + 1,
    });

    if (listings.length === 0) {
      await interaction.editReply({ content: 'You have no listings in this server. Use the web dashboard to add items and mark them for sale.' });
      return;
    }

    const truncated = listings.length > FIELD_LIMIT;
    const visible = listings.slice(0, FIELD_LIMIT);
    const footerParts = [
      `${listings.length > FIELD_LIMIT ? `${FIELD_LIMIT}+ ` : listings.length} listing${listings.length !== 1 ? 's' : ''}`,
      interaction.guild?.name ?? 'This server',
      ...(truncated ? ['showing first 25 — see dashboard for all'] : []),
    ];

    const embed = new EmbedBuilder()
      .setTitle('📦 My Listings')
      .setColor(0x5865f2)
      .setFooter({ text: footerParts.join(' · ') });

    for (const l of visible) {
      const available  = l.quantityListed ?? l.quantity;
      const isExpired  = l.listedAt !== null && l.listedAt < expiryCutoff;
      const ql          = l.qualityLevel !== null ? ` · QL ${l.qualityLevel}` : '';
      const loc         = l.location ? ` · 📍 ${l.location}` : '';
      const expiryNote  = isExpired ? '\n⚠️ Expired — update price to renew' : '';
      embed.addFields({
        name:   l.itemName,
        value:  `${fmtQty(available, l.itemType)}${ql}${loc}\n${fmtPrice(l.askingPrice, l.priceNote)}${expiryNote}`,
        inline: true,
      });
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }
}
