import { EmbedBuilder } from 'discord.js';
import type { LocalBlueprint } from '../gamedata.js';

export type { LocalBlueprint };

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Formats craft/dismantle seconds into "2m 30s" or "1h 10m". */
export function formatSeconds(secs: number): string {
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Estimates the aUEC reward range for a blueprint mission using the
 * community-benchmarked formula: time × 2500 × 1.5^(riskScore-3) ±20%.
 */
export function estimateAuec(
  timeMin: number | null,
  riskScore: number | null,
): { low: number; high: number } | null {
  if (!timeMin || !riskScore) return null;
  const mid = timeMin * 2500 * Math.pow(1.5, riskScore - 3);
  return { low: Math.round(mid * 0.8), high: Math.round(mid * 1.2) };
}

/** Formats a raw aUEC number as "45k", "1.2M", etc. */
export function fmtAuec(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// ── Shared embed builder ──────────────────────────────────────────────────────

/**
 * Builds the standard crafting-recipe embed used by both /recipe and
 * /blueprint recipe.  Returns an EmbedBuilder ready for editReply.
 */
export function buildRecipeEmbed(bp: LocalBlueprint): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📋 ${bp.outputName}`)
    .setColor(0x00b0f4)
    .setFooter({ text: 'Star Citizen Blueprint Database' });

  // Header fields: Type / Subtype / Grade
  const headerFields: { name: string; value: string; inline: boolean }[] = [
    { name: 'Type', value: bp.outputType, inline: true },
  ];
  if (bp.outputSubtype) headerFields.push({ name: 'Subtype', value: bp.outputSubtype, inline: true });
  if (bp.outputGrade)   headerFields.push({ name: 'Grade',   value: bp.outputGrade,   inline: true });
  embed.addFields(headerFields);

  // Materials field
  const time = formatSeconds(bp.craftTimeSecs);
  if (bp.materials.length === 0) {
    embed.addFields({ name: `Materials · ⏱ ${time}`, value: '_No materials listed_', inline: false });
  } else {
    const matLines = bp.materials.map((m) => {
      const qty  = m.quantityScu != null ? `${m.quantityScu} SCU` : m.quantity != null ? `×${m.quantity}` : '';
      const qual = m.minQuality ? ` _(min q${m.minQuality})_` : '';
      return `• **${m.name}** ${qty}${qual}`.trimEnd();
    });
    embed.addFields({
      name:  `Materials · ⏱ ${time}`,
      value: matLines.slice(0, 20).join('\n') +
        (matLines.length > 20 ? `\n_…and ${matLines.length - 20} more_` : ''),
      inline: false,
    });
  }

  // Quality-scaling modifiers (deduplicated by key, capped at 10)
  if (bp.modifiers.length > 0) {
    const seen  = new Set<string>();
    const dedup = bp.modifiers.filter((mod) => {
      if (seen.has(mod.key)) return false;
      seen.add(mod.key);
      return true;
    });

    const first  = dedup[0]!;
    const modLines = dedup.map((mod) => {
      const lo   = (mod.modifierAtMin * 100).toFixed(0);
      const hi   = (mod.modifierAtMax * 100).toFixed(0);
      const unit = mod.unitFormat ?? '%';
      return `• **${mod.name}**: ${lo}${unit} → ${hi}${unit}`;
    });

    embed.addFields({
      name:   `Quality Range (q${first.qualityMin}–${first.qualityMax})`,
      value:  modLines.slice(0, 10).join('\n'),
      inline: false,
    });
  }

  return embed;
}
