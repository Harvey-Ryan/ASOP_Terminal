import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { uexBestRoutes, uexMoney, uexRoutePlace, uexRouteUrl, uexSearch, uexShort, uexStockWord, type UexRoute, type UexTerminal } from '@dem/shared';
import { UexUnavailable, peekCommodities, peekTerminals, uexTerminals, uexRoutes, warmUexLists } from '../services/uexService.js';
import { UEX_FOOTER, findCommodity } from './price.js';

// /route (v1.42.0): UEX Corp's best trade routes for a commodity and/or from
// a terminal, from player-reported prices.

export const data = new SlashCommandBuilder()
  .setName('route')
  .setDescription('Best trade routes for a commodity or from a terminal (player-reported prices from UEX)')
  .addStringOption((opt) =>
    opt.setName('commodity').setDescription('What to haul (start typing for suggestions)').setRequired(false).setAutocomplete(true))
  .addStringOption((opt) =>
    opt.setName('from').setDescription('Where you buy: a trade terminal (start typing)').setRequired(false).setAutocomplete(true))
  .addIntegerOption((opt) =>
    opt.setName('budget').setDescription('aUEC you can spend on cargo').setRequired(false).setMinValue(1_000).setMaxValue(1_000_000_000));

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const terminalLabel = (t: UexTerminal) => {
  const where = t.moon_name ?? t.planet_name ?? t.space_station_name ?? t.city_name;
  return clip(`${t.name}${where && !t.name.includes(where) ? ` · ${where}` : ''}${t.star_system_name ? `, ${t.star_system_name}` : ''}`, 100);
};

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'from') {
    const terminals = peekTerminals();
    if (!terminals) { warmUexLists(); await interaction.respond([]); return; }
    const hits = uexSearch(terminals.map((t) => ({ ...t, code: `${t.nickname ?? ''} ${t.moon_name ?? t.planet_name ?? ''} ${t.star_system_name ?? ''}` })), focused.value);
    await interaction.respond(hits.slice(0, 25).map((t) => ({ name: terminalLabel(t), value: String(t.id) })));
    return;
  }
  const list = peekCommodities();
  if (!list) { warmUexLists(); await interaction.respond([]); return; }
  await interaction.respond(uexSearch(list, focused.value).slice(0, 25).map((c) => ({ name: clip(`${c.name} (${c.code})`, 100), value: String(c.id) })));
}

async function findTerminal(raw: string): Promise<{ found: UexTerminal | null; matches: UexTerminal[] }> {
  const list = await uexTerminals();
  const byId = /^\d+$/.test(raw) ? list.find((t) => t.id === Number(raw)) : undefined;
  if (byId) return { found: byId, matches: [byId] };
  const matches = uexSearch(list, raw, 10);
  return { found: matches.find((t) => t.name.toLowerCase() === raw.toLowerCase()) ?? (matches.length === 1 ? matches[0]! : null), matches };
}

export function buildRouteEmbed(title: string, routes: UexRoute[], budget: number | null): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(clip(`🚚 ${title}`, 256)).setColor(0xb98a13).setFooter({ text: UEX_FOOTER });
  if (!routes.length) {
    embed.setDescription('No profitable routes reported right now.');
    return embed;
  }
  const newest = Math.max(...routes.map((r) => r.date_added));
  embed.setDescription([budget ? `Budget: **${uexShort(budget)}** aUEC` : null, `Updated <t:${newest}:R>`].filter(Boolean).join(' · '));
  routes.forEach((r, i) => {
    const stock = uexStockWord(r.status_origin);
    embed.addFields({
      name: clip(`${i + 1}. ${r.commodity_name}: ${r.origin_terminal_name ?? '?'} → ${r.destination_terminal_name ?? '?'}`, 256),
      value: clip([
        `Buy **${uexMoney(r.price_origin)}** → sell **${uexMoney(r.price_destination)}** /SCU · **+${uexMoney(r.price_margin)}**/SCU (${Math.round(r.price_roi)}%)`,
        `${uexRoutePlace(r, 'origin', false)} → ${uexRoutePlace(r, 'destination', false)}${r.distance ? ` · ${Math.round(r.distance)} Gm` : ''}`,
        `Up to **${uexShort(r.profit)}** profit on **${uexShort(r.investment)}** of cargo${stock ? ` · ${stock} at the start` : ''} · [On UEX](${uexRouteUrl(r.code)})`,
      ].join('\n'), 1024),
    });
  });
  return embed;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const rawCommodity = interaction.options.getString('commodity')?.trim() || null;
  const rawFrom = interaction.options.getString('from')?.trim() || null;
  const budget = interaction.options.getInteger('budget');
  if (!rawCommodity && !rawFrom) {
    await interaction.reply({ content: 'Pick a **commodity**, a **from** terminal, or both.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply();
  try {
    let commodityId: number | undefined;
    let commodityName: string | null = null;
    if (rawCommodity) {
      const { found, matches } = await findCommodity(rawCommodity);
      if (!found) {
        await interaction.editReply(matches.length ? `Which commodity? ${matches.map((c) => `**${c.name}**`).join(', ')}` : `No commodity matches **${clip(rawCommodity, 80)}**.`);
        return;
      }
      commodityId = found.id;
      commodityName = found.name;
    }
    let from: UexTerminal | null = null;
    if (rawFrom) {
      const { found, matches } = await findTerminal(rawFrom);
      if (!found) {
        await interaction.editReply(matches.length ? `Which terminal? ${matches.map((t) => `**${t.name}**`).join(', ')}` : `No trade terminal matches **${clip(rawFrom, 80)}**.`);
        return;
      }
      from = found;
    }
    const routes = uexBestRoutes(await uexRoutes({ commodityId, originTerminalId: from?.id, investment: budget ?? undefined }));
    const title = [commodityName ? `${commodityName} routes` : 'Trade routes', from ? `from ${from.name}` : null].filter(Boolean).join(' ');
    const best = routes[0];
    const components = best
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Best route on UEX').setURL(uexRouteUrl(best.code)))]
      : [];
    await interaction.editReply({ embeds: [buildRouteEmbed(title, routes, budget)], components });
  } catch (err) {
    if (err instanceof UexUnavailable) {
      await interaction.editReply('UEX isn\'t answering right now. Try again in a minute.');
      return;
    }
    throw err;
  }
}
