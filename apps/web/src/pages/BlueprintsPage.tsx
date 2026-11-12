// Blueprints (v1.27.0): find an item's blueprint, then every mission that can
// give it, with its real rewards, difficulty, places and the other blueprints
// it can give. Same "fabrication bay" look and blueprint list as the
// Crafting Calculator.
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { craftingSource, getBlueprintByUuid, missionContracts, obtainableBlueprints, type LocalBlueprint } from '@/lib/gameData';
import './crafting/fabrication.css';
import { BlueprintBrowser, fmtSecs, Rivets, typeLabel } from './crafting/browser';
import { MissionCard } from './crafting/missions';

function BlueprintMissions({ bp, onPick, onCalculator, onBack }: {
  bp: LocalBlueprint;
  onPick: (uuid: string) => void;
  onCalculator: (uuid: string) => void;
  onBack: () => void;
}) {
  const contracts = useMemo(
    () => missionContracts().filter((mc) => mc.pools.some((p) => p.blueprints.some((e) => e.blueprintUuid === bp.uuid))),
    [bp.uuid],
  );
  const kind = [typeLabel(bp.type), bp.subtype && !typeLabel(bp.type).toLowerCase().includes(bp.subtype.toLowerCase()) && bp.subtype, bp.grade && `Grade ${bp.grade}`].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={bp.name} className="fab-plate flex flex-col gap-4 px-5 pb-5 pt-6 sm:px-7">
        <Rivets />
        <button type="button" onClick={onBack} className="fab-btn -mt-1 flex h-9 w-fit items-center gap-1 px-2.5 text-xs lg:hidden">
          <ChevronLeft aria-hidden="true" className="h-4 w-4" /> All blueprints
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="fab-label">{kind}</span>
            <h2 className="fab-stencil m-0 text-[26px] leading-tight text-[var(--fab-bright)] sm:text-[30px]">{bp.name.toUpperCase()}</h2>
            <span className="fab-mono text-xs text-[var(--fab-muted)]">
              {contracts.length} mission{contracts.length === 1 ? '' : 's'} can give it · craft time {fmtSecs(bp.craftTimeSecs)}
            </span>
            <span className="text-xs text-[var(--fab-muted)]">{bp.components.map((c) => c.material.name).join(' · ')}</span>
          </div>
          <button type="button" onClick={() => onCalculator(bp.uuid)} className="fab-btn-primary h-11 shrink-0 px-4 text-[15px]">
            Open in calculator →
          </button>
        </div>
      </section>

      {contracts.length === 0 ? (
        <section className="fab-plate px-6 py-8 text-center text-sm text-[var(--fab-muted)]">No mission in the current game data gives this blueprint.</section>
      ) : (
        <div className="flex flex-col gap-3">
          {contracts.map((mc, i) => (
            <MissionCard key={mc.title} contract={mc} defaultOpen={i === 0} currentUuid={bp.uuid} onSelectBlueprint={onPick} onOpenCalculator={onCalculator} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <section className="fab-plate flex min-h-[18rem] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <Rivets />
      <span className="fab-stencil text-xl text-[var(--fab-gold-text)]">SELECT A BLUEPRINT</span>
      <p className="m-0 max-w-sm text-sm text-[var(--fab-muted)]">
        Search for an item or pick a type. You'll see every mission that can give its blueprint: the rewards, how hard it is, where it runs and what else it can give.
      </p>
    </section>
  );
}

export function BlueprintsPage() {
  const { guildId, blueprintUuid } = useParams<{ guildId: string; blueprintUuid?: string }>();
  const navigate = useNavigate();
  const bp = blueprintUuid ? getBlueprintByUuid(blueprintUuid) ?? null : null;
  const base = `/dashboard/servers/${guildId}`;
  const pick = (uuid: string) => navigate(`${base}/blueprints/${uuid}`);
  const back = () => navigate(`${base}/blueprints`);
  const toCalculator = (uuid: string) => navigate(`${base}/crafting-calculator/${uuid}`);
  const src = craftingSource();

  return (
    <div className="fab -m-6 min-h-[calc(100%+3rem)] pb-10 xl:flex xl:h-[calc(100%+3rem)] xl:flex-col xl:overflow-hidden xl:pb-0">
      <div aria-hidden="true" className="fab-hazard h-2 shrink-0 opacity-85" />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b-2 border-[#0d0d0d] px-5 pb-4 pt-5 shadow-[0_1px_0_#2c2c2c] sm:px-8">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="fab-stencil flex h-11 w-11 items-center justify-center border-2 border-[var(--fab-gold)] text-xl text-[var(--fab-gold-text)]">B</span>
          <div className="flex flex-col gap-0.5">
            <span className="fab-label">Mission rewards{src.build ? ` · ${src.build}` : ''}</span>
            <h1 className="fab-stencil m-0 text-[26px] text-[var(--fab-gold-text)] sm:text-[32px]">BLUEPRINTS</h1>
          </div>
        </div>
        <span className="fab-mono border border-[#333] bg-[#121212] px-2.5 py-1.5 text-xs text-[var(--fab-muted)]">
          <span className="font-semibold text-[var(--fab-gold-text)]">{obtainableBlueprints().length}</span> BLUEPRINTS · <span className="font-semibold text-[var(--fab-gold-text)]">{missionContracts().length}</span> MISSIONS
        </span>
      </header>

      <div className="flex flex-wrap items-start gap-5 px-5 pt-6 sm:px-8 xl:min-h-0 xl:flex-1 xl:flex-nowrap xl:items-stretch xl:pb-6">
        <BlueprintBrowser
          selectedUuid={bp?.uuid ?? null}
          onPick={pick}
          className={cn('flex-[1_1_260px] lg:max-w-[360px] xl:min-h-0', bp && 'hidden lg:flex')}
        />
        <div className="fab-scroll min-w-0 flex-[999_1_480px] xl:min-h-0 xl:overflow-y-auto xl:pb-1">
          {bp ? (
            <BlueprintMissions key={bp.uuid} bp={bp} onPick={pick} onCalculator={toCalculator} onBack={back} />
          ) : blueprintUuid ? (
            <section className="fab-plate px-6 py-10 text-center text-sm text-[var(--fab-muted)]">
              That blueprint isn't in the current game data. <button type="button" onClick={back} className="text-[var(--fab-gold-text)] underline">Back to all blueprints</button>
            </section>
          ) : <EmptyState />}
        </div>
      </div>
    </div>
  );
}
