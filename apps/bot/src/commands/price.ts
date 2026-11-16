import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { uexBestPrices, uexMoney, uexPlace, uexSearch, uexStockWord, UEX_MAX_AGE_DAYS, type UexCommodity, type UexPriceRow } from '@dem/shared';
import {
  UexUnavailable, peekCommodities, peekStarSystems, uexCommodities, uexCommodityPrices, warmUexLists,
} from '../services/uexService.js';

// /price (v1.42.0): where to sell and buy a commodity right now, from prices
// players report to UEX Corp (uexcorp.space). Raw ores use UEX's raw prices.

export const data = new SlashCommandBuilder()
  .setName('price')
  .setDescription('Best places to sell and buy a commodity (live player-reported prices from UEX)')
  .addStringOption((opt) =>
    opt.setName('commodity').setDescription('Commodity or ore (start typing for suggestions)').setRequired(true).setAutocomplete(true))
  .addStringOption((opt) =>
    opt.setName('system').setDescription('Only this star system').setRequired(false).setAutocomplete(true));

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const UEX_FOOTER = 'Prices reported by players to UEX Corp (uexcorp.space) · may differ in game';

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'system') {
    const systems = peekStarSystems();
    if (!systems) { warmUexLists(); await interaction.respond([]); return; }
    await interaction.respond(uexSearch(systems, focused.value).slice(0, 25).map((s) => ({ name: s.name, value: s.name })));
    return;
  }
  const list = peekCommodities();
  if (!list) { warmUexLists(); await interaction.respond([]); return; }
  await interaction.respond(uexSearch(list, focused.value).slice(0, 25).map((c) => ({ name: clip(`${c.name} (${c.code})`, 100), value: String(c.id) })));
}

/** The commodity someone picked (an id from autocomplete) or typed. */
export async function findCommodity(raw: string): Promise<{ found: UexCommodity | null; matches: UexCommodity[] }> {
  const list = await uexCommodities();
  const byId = /^\d+$/.test(raw) ? list.find((c) => c.id === Number(raw)) : undefined;
  if (byId) return { found: byId, matches: [byId] };
  const matches = uexSearch(list, raw, 10);
  const exact = matches.find((c) => c.name.toLowerCase() === raw.toLowerCase() || c.code.toLowerCase() === raw.toLowerCase());
  return { found: exact ?? (matches.length === 1 ? matches[0]! : null), matches };
}

const line = (r: UexPriceRow, side: 'sell' | 'buy') => {
  const price = side === 'sell' ? r.price_sell : r.price_buy;
  const stock = side === 'buy' ? uexStockWord(r.status_buy) : null;
  return `**${uexMoney(price)}** /SCU · ${clip(uexPlace(r), 70)}${stock ? ` · ${stock}` : ''} · <t:${r.date_modified}:R>`;
};

export function buildPriceEmbed(c: UexCommodity, rows: UexPriceRow[], system: string | null): EmbedBuilder {
  const { sell, buy, newest } = uexBestPrices(rows, { system });
  const where = system ? ` in ${system}` : '';
  const notes = [
    c.is_raw === 1 ? 'Raw ore: prices for selling it unrefined' : null,
    c.is_illegal === 1 ? '⚠️ Illegal in some jurisdictions' : null,
    newest ? `Latest report <t:${newest}:R>` : null,
  ].filter(Boolean);
  const embed = new EmbedBuilder()
    .setTitle(clip(`💰 ${c.name}${where}`, 256))
    .setColor(0xb98a13)
    .setFooter({ text: UEX_FOOTER });
  if (notes.length) embed.setDescription(notes.join('\n'));
  if (!sell.length && !buy.length) {
    embed.setDescription(`${notes.length ? `${notes.join('\n')}\n\n` : ''}No prices reported${where} in the last ${UEX_MAX_AGE_DAYS} days.`);
    return embed;
  }
  embed.addFields(
    { name: '📈 Best places to sell', value: clip(sell.map((r) => line(r, 'sell')).join('\n') || `Nowhere reported${where}.`, 1024) },
    { name: '📉 Cheapest places to buy', value: clip(buy.map((r) => line(r, 'buy')).join('\n') || `Nowhere reported${where}.`, 1024) },
  );
  return embed;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const raw = interaction.options.getString('commodity', true).trim();
  const system = interaction.options.getString('system')?.trim() || null;
  await interaction.deferReply();
  try {
    const { found, matches } = await findCommodity(raw);
    if (!found) {
      await interaction.editReply(matches.length
        ? `Which one? ${matches.slice(0, 10).map((c) => `**${c.name}**`).join(', ')}`
        : `No commodity matches **${clip(raw, 80)}**.`);
      return;
    }
    const rows = await uexCommodityPrices(found);
    await interaction.editReply({ embeds: [buildPriceEmbed(found, rows, system)] });
  } catch (err) {
    if (err instanceof UexUnavailable) {
      await interaction.editReply('UEX isn\'t answering right now. Try again in a minute.');
      return;
    }
    throw err;
  }
}

