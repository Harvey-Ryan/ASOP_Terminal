import React from 'react';
import { X, HelpCircle } from 'lucide-react';
import type { DiscordChannel } from '@/api/settings';
import type { DiscordRoleDto } from '@dem/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// ── SettingTooltip ────────────────────────────────────────────────────────────

export function SettingTooltip({ content }: { content: React.ReactNode }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label="More information"
          className="inline-flex shrink-0 text-muted-foreground/60 hover:text-muted-foreground transition-colors focus:outline-none"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        className="max-w-xs text-xs leading-relaxed px-3 py-2.5 shadow-lg bg-secondary border-border text-foreground"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Channel type icons ────────────────────────────────────────────────────────

const CH_ICON: Record<number, string> = {
  0: '#',    // GUILD_TEXT
  2: '🔊',   // GUILD_VOICE
  4: '📁',   // GUILD_CATEGORY
  5: '📢',   // GUILD_ANNOUNCEMENT
  13: '🎭',  // GUILD_STAGE_VOICE
  15: '📋',  // GUILD_FORUM
  16: '🖼️', // GUILD_MEDIA
};

function channelLabel(ch: DiscordChannel): string {
  return `${CH_ICON[ch.type] ?? '·'}  ${ch.name}`;
}

function roleColorCss(color: number): string {
  return color === 0 ? '#99aab5' : `#${color.toString(16).padStart(6, '0')}`;
}

// ── ChannelSelect ─────────────────────────────────────────────────────────────

export function ChannelSelect({
  id,
  channels,
  value,
  onChange,
  types,
}: {
  id: string;
  channels: DiscordChannel[];
  value: string | null;
  onChange: (val: string | null) => void;
  types?: number[];
}) {
  const visible = types
    ? channels.filter((c) => c.type === 4 || types.includes(c.type))
    : channels;
  const categories    = visible.filter((c) => c.type === 4);
  const uncategorised = visible.filter((c) => c.type !== 4 && !c.parent_id);
  const childrenOf    = (catId: string) => visible.filter((c) => c.parent_id === catId);

  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="">— Not set —</option>
      {uncategorised.map((ch) => (
        <option key={ch.id} value={ch.id}>{channelLabel(ch)}</option>
      ))}
      {categories.map((cat) => {
        const children = childrenOf(cat.id);
        return (
          <optgroup key={cat.id} label={`📁  ${cat.name}`}>
            <option value={cat.id}>{channelLabel(cat)}</option>
            {children.map((ch) => (
              <option key={ch.id} value={ch.id}>{channelLabel(ch)}</option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

// ── ToggleSwitch ──────────────────────────────────────────────────────────────

export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  tooltip,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  tooltip?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium">{label}</p>
          {tooltip && <SettingTooltip content={tooltip} />}
        </div>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
          checked ? 'bg-primary' : 'bg-input'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

// ── RolePicker ────────────────────────────────────────────────────────────────

export function RolePicker({
  roles,
  selected,
  onChange,
}: {
  roles: DiscordRoleDto[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const selectedSet = new Set(selected);
  const unselected  = roles.filter((r) => !selectedSet.has(r.id));

  function add(id: string)    { onChange([...selected, id]); }
  function remove(id: string) { onChange(selected.filter((s) => s !== id)); }

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((id) => {
            const role = roles.find((r) => r.id === id);
            if (!role) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: roleColorCss(role.color) }}
                />
                {role.name}
                <button
                  type="button"
                  onClick={() => remove(id)}
                  className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={`Remove ${role.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {unselected.length > 0 ? (
        <select
          value=""
          onChange={(e) => { if (e.target.value) add(e.target.value); }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Add a role…</option>
          {unselected.map((role) => (
            <option key={role.id} value={role.id}>{role.name}</option>
          ))}
        </select>
      ) : selected.length > 0 ? (
        <p className="text-xs text-muted-foreground italic">All roles have been added.</p>
      ) : null}
    </div>
  );
}
