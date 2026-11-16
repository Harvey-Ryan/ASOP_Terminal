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
import {
  uexBestRoutes, uexBestRuns, uexMoney, uexRoutePlace, uexRouteUrl, uexSearch, uexShort, uexStockWord, uexTerminalPlace,
  type UexRoute, type UexRun, type UexRunLimit, type UexTerminal,
} from '@dem/shared';
import {
  UexUnavailable, peekCommodities, peekStarSystems, peekTerminals, uexCommodities, uexPricesAll, uexRoutes, uexTerminals, warmUexLists,
} from '../services/uexService.js';
import { UEX_FOOTER, findCommodity } from './price.js';

// /route (v1.42.0): UEX Corp's best trade routes for a commodity and/or from
// a terminal, from player-reported prices.

// v1.43.0: two subcommands: `find` (UEX's routes for a commodity / from a
// terminal) and `best` (the most profitable runs right now, worked out here
// from every price at every terminal).
export const data = new SlashCommandBuilder()
  .setName('route')
  .setDescription('Trade routes from player-reported prices (UEX)')
  .addSubcommand((sub) => sub
    .setName('best')
    .setDescription('The most profitable trade runs right now, across every commodity')
    .addIntegerOption((opt) =>
      opt.setName('scu').setDescription('Your cargo space in SCU (ranks by profit for a full load)').setRequired(false).setMinValue(1).setMaxValue(100_000))
    .addIntegerOption((opt) =>
      opt.setName('budget').setDescription('aUEC you can spend on cargo').setRequired(false).setMinValue(1_000).setMaxValue(1_000_000_000))
    .addStringOption((opt) =>
      opt.setName('system').setDescription('Only runs inside this star system').setRequired(false).setAutocomplete(true))
    .addBooleanOption((opt) =>
      opt.setName('cross_system').setDescription('Include runs that jump between systems (off by default)').setRequired(false)))
  .addSubcommand((sub) => sub
    .setName('find')
    .setDescription('Best routes for a commodity or from a terminal')
    .addStringOption((opt) =>
      opt.setName('commodity').setDescription('What to haul (start typing for suggestions)').setRequired(false).setAutocomplete(true))
    .addStringOption((opt) =>
      opt.setName('from').setDescription('Where you buy: a trade terminal (start typing)').setRequired(false).setAutocomplete(true))
    .addIntegerOption((opt) =>
      opt.setName('budget').setDescription('aUEC you can spend on cargo').setRequired(false).setMinValue(1_000).setMaxValue(1_000_000_000)));

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const terminalLabel = (t: UexTerminal) => {
  const where = t.moon_name ?? t.planet_name ?? t.space_station_name ?? t.city_name;
  return clip(`${t.name}${where && !t.name.includes(where) ? ` · ${where}` : ''}${t.star_system_name ? `, ${t.star_system_name}` : ''}`, 100);
};

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'system') {
    const systems = peekStarSystems();
    if (!systems) { warmUexLists(); await interaction.respond([]); return; }
    await interaction.respond(uexSearch(systems, focused.value).slice(0, 25).map((x) => ({ name: x.name, value: x.name })));
    return;
  }
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

const LIMIT_WORDS: Record<UexRunLimit, string> = {
  hold: 'your hold',
  stock: 'the stock for sale',
  demand: 'what the buyer takes',
  budget: 'your budget',
};

export function buildBestEmbed(runs: UexRun[], o: { scu: number | null; budget: number | null; system: string | null; crossSystem: boolean }): EmbedBuilder {
  const sized = !!(o.scu || o.budget);
  const embed = new EmbedBuilder().setTitle('🏆 Best trade runs right now').setColor(0xb98a13).setFooter({ text: UEX_FOOTER });
  const setup = [
    o.scu ? `**${o.scu.toLocaleString('en-US')} SCU** hold` : null,
    o.budget ? `**${uexShort(o.budget)}** aUEC budget` : null,
    o.system ? `in **${o.system}**` : null,
    o.crossSystem ? 'jumps between systems allowed' : 'same system only',
  ].filter(Boolean).join(' · ');
  const ranked = sized ? 'Ranked by profit for your load.' : 'Ranked by profit per SCU. Add `scu:` (your cargo space) to rank by profit for a full load.';
  embed.setDescription(`${setup}\n${ranked}`);
  if (!runs.length) {
    embed.setDescription(`${setup}\n\nNo profitable runs reported${o.system ? ` in ${o.system}` : ''} right now.`);
    return embed;
  }
  runs.forEach((r, i) => {
    const flags = [r.crossSystem ? '⚠️ Jump between systems' : null, r.illegal ? '⚠️ Illegal in some jurisdictions' : null].filter(Boolean).join(' · ');
    embed.addFields({
      name: clip(`${i + 1}. ${r.commodityName}: ${r.buy.terminal_name} → ${r.sell.terminal_name}`, 256),
      value: clip([
        `Buy **${uexMoney(r.buy.price_buy)}** → sell **${uexMoney(r.sell.price_sell)}** /SCU · **+${uexMoney(r.margin)}**/SCU`,
        `${uexTerminalPlace(r.buyTerminal, r.buy.terminal_name)} → ${uexTerminalPlace(r.sellTerminal, r.sell.terminal_name)}`,
        r.units !== null
          ? `Fill **${r.units.toLocaleString('en-US')} SCU** (limited by ${LIMIT_WORDS[r.limitedBy!]}) → **${uexShort(r.profit!)}** profit on **${uexShort(r.investment!)}**`
          : null,
        `${flags ? `${flags} · ` : ''}Reported <t:${r.reportedAt}:R>`,
      ].filter(Boolean).join('\n'), 1024),
    });
  });
  return embed;
}

async function executeBest(interaction: ChatInputCommandInteraction): Promise<void> {
  const scu = interaction.options.getInteger('scu');
  const budget = interaction.options.getInteger('budget');
  const system = interaction.options.getString('system')?.trim() || null;
  const crossSystem = interaction.options.getBoolean('cross_system') ?? false;
  await interaction.deferReply();
  try {
    const [rows, terminals, commodities] = await Promise.all([uexPricesAll(), uexTerminals(), uexCommodities()]);
    const runs = uexBestRuns(rows, terminals, commodities, { scu, budget, system, crossSystem });
    await interaction.editReply({ embeds: [buildBestEmbed(runs, { scu, budget, system, crossSystem })] });
  } catch (err) {
    if (err instanceof UexUnavailable) {
      await interaction.editReply('UEX isn\'t answering right now. Try again in a minute.');
      return;
    }
    throw err;
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.options.getSubcommand() === 'best') return executeBest(interaction);
  const rawCommodity = interaction.options.getString('commodity')?.trim() || null;
  const rawFrom = interaction.options.getString('from')?.trim() || null;
  const budget = interaction.options.getInteger('budget');
  if (!rawCommodity && !rawFrom) {
    await interaction.reply({ content: 'Pick a **commodity**, a **from** terminal, or both. Or use `/route best` for the most profitable runs right now.', flags: MessageFlags.Ephemeral });
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
