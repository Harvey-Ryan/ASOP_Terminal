import { useState } from 'react';
import { HelpCircle, CalendarDays, Coins, Gavel, Shuffle, Gift, Settings, ChevronDown, ChevronRight, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GuideItem {
  title: string;
  body: string;
}

interface GuideSection {
  id: string;
  icon: React.ReactNode;
  title: string;
  adminOnly?: boolean;
  items: GuideItem[];
}

// ── Guide item (expandable) ───────────────────────────────────────────────────

function GuideEntry({ title, body }: GuideItem) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium hover:bg-accent/50 transition-colors"
      >
        <span>{title}</span>
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground leading-relaxed">
          {body}
        </div>
      )}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({ section }: { section: GuideSection }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${section.adminOnly ? 'bg-amber-500/15 text-amber-500' : 'bg-primary/10 text-primary'}`}>
          {section.icon}
        </span>
        <h3 className="text-sm font-semibold">{section.title}</h3>
        {section.adminOnly && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500">
            <Shield className="h-3 w-3" />
            Admin
          </span>
        )}
      </div>
      <div className="space-y-1.5 pl-0.5">
        {section.items.map((item) => (
          <GuideEntry key={item.title} {...item} />
        ))}
      </div>
    </div>
  );
}

// ── Content definition ────────────────────────────────────────────────────────

function buildSections(isManager: boolean, dkpLabel: string): GuideSection[] {
  const all: GuideSection[] = [
    {
      id: 'events-member',
      icon: <CalendarDays className="h-4 w-4" />,
      title: 'Events',
      items: [
        {
          title: 'Viewing Events',
          body: 'Browse upcoming events on the server Dashboard. Each card shows the start time, muster point, role slots, and RSVP count. Completed events are available under the Completed tab.',
        },
        {
          title: 'RSVPing to an Event',
          body: "Click an event card to open its details. If the event has role slots (e.g. Infantry, Pilot), select the role you'll fill, then confirm your RSVP. Your slot is reserved immediately and the organizer is notified.",
        },
        {
          title: 'My Picks Notification',
          body: "If you're included in an active snake draft loot session, a notification will appear on the Dashboard when it's your turn to pick an item.",
        },
        {
          title: 'Loot Results',
          body: 'After an event ends, a Loot button appears on the event card if a loot session was run. Click it to see what items were assigned and to whom.',
        },
      ],
    },
    {
      id: 'dkp-member',
      icon: <Coins className="h-4 w-4" />,
      title: `${dkpLabel} (Points)`,
      items: [
        {
          title: 'Your Balance',
          body: `The ${dkpLabel} page shows your current balance, your rank among all guild members, and a full log of every transaction on your account.`,
        },
        {
          title: `Earning ${dkpLabel}`,
          body: `Admins award ${dkpLabel} for event attendance and other contributions. Points are distributed automatically when a loot session completes if an award amount was set.`,
        },
        {
          title: `Spending ${dkpLabel}`,
          body: `Your balance is spent in ${dkpLabel}-bid loot sessions and standalone auctions. Bids that don't win are not deducted — only the final winning amount is charged.`,
        },
      ],
    },
    {
      id: 'auctions-member',
      icon: <Gavel className="h-4 w-4" />,
      title: 'Auctions',
      items: [
        {
          title: 'Browsing Auctions',
          body: 'Open the Auctions page to see all active and recently closed auctions for your server. Each entry shows the item, current bid, time remaining, and bidder list.',
        },
        {
          title: 'Proxy Bidding',
          body: "Enter your maximum willing bid. The system bids only what's needed to stay ahead of the competition — incrementing by 1 each time someone outbids you up to your max. You'll win at the lowest price that beats the runner-up.",
        },
        {
          title: 'Loot Auctions',
          body: 'Loot sessions using the DKP Bid method run one auction per item. These appear inline on the loot page and also reflect on the Auctions page.',
        },
      ],
    },
    {
      id: 'draft-member',
      icon: <Shuffle className="h-4 w-4" />,
      title: 'Snake Draft — Pick Queue',
      items: [
        {
          title: 'What Is a Snake Draft?',
          body: "A snake draft is a loot distribution method where members take turns picking items in a snake order: 1-2-3-3-2-1-1-2-3… Each member gets a fair turn regardless of position.",
        },
        {
          title: 'Setting Up Your Queue',
          body: "In any active snake draft you're part of, open the loot page and find the Queue panel on the right side. Click items to add them to your priority list in the order you'd prefer to receive them.",
        },
        {
          title: 'Auto-Pick',
          body: "When it's your turn and your top-queued item is still available, the system picks it automatically without you needing to be present. The draft cascades through consecutive auto-picks.",
        },
        {
          title: 'Drag to Reorder',
          body: 'Grab the grip handle (⠿) next to any queued item and drag it up or down to change its priority. Changes are saved automatically.',
        },
        {
          title: 'Removing from Queue',
          body: "Click the × beside any item in your queue to remove it. Items that have already been assigned to someone are automatically struck through and can't be picked.",
        },
      ],
    },
  ];

  if (!isManager) return all;

  const adminSections: GuideSection[] = [
    {
      id: 'events-admin',
      icon: <CalendarDays className="h-4 w-4" />,
      title: 'Event Management',
      adminOnly: true,
      items: [
        {
          title: 'Creating an Event',
          body: 'Click + New Event on the server dashboard. Fill in the name, start time, optional end time, muster point, role slots, and voice channel names. Events are posted to the configured Discord announcement channel automatically.',
        },
        {
          title: 'Recurring Events',
          body: 'Set a recurrence type (Daily, Weekly, Biweekly, Monthly) to save the event as a reusable template. Use the Repeat button on any past event to schedule the next occurrence.',
        },
        {
          title: 'Attendance Audit',
          body: "After an event ends, use the Audit page to confirm which members actually attended. Mark members as confirmed or absent. Confirmed attendance is required before awarding DKP or starting a loot session.",
        },
        {
          title: 'Event Templates',
          body: 'Frequently-used event structures are saved as templates when you repeat an event. Access templates from the Create Event form to pre-fill all fields.',
        },
      ],
    },
    {
      id: 'loot-admin',
      icon: <Gift className="h-4 w-4" />,
      title: 'Loot Management',
      adminOnly: true,
      items: [
        {
          title: 'Starting a Loot Session',
          body: 'Open an event (it can be active or ended) and click Manage Loot. Choose a distribution method — Random Roll, DKP Bid, or Snake Draft — then start adding items.',
        },
        {
          title: 'Adding Items',
          body: 'Type item names in the input field and press Enter. Items can be renamed or deleted at any point before the session is marked complete. You can also set per-item quantity.',
        },
        {
          title: 'Random Roll',
          body: 'Click Roll on any item to have all eligible members roll a d1000. The highest roll wins. Tied rolls are automatically re-rolled. Enable "Exclude previous winners" to prevent repeat wins.',
        },
        {
          title: `${dkpLabel} Bid`,
          body: `Start a timed auction per item. Proxy bidding automatically increments bids — the winner pays the runner-up's bid plus 1. The winning ${dkpLabel} amount is deducted from the winner's balance.`,
        },
        {
          title: 'Completing a Session',
          body: `Click Complete Session once all items are assigned. ${dkpLabel} attendance awards (if set) are distributed automatically to all confirmed attendees. The session is then locked as read-only.`,
        },
        {
          title: 'Resuming After Event Ends',
          body: 'Loot sessions can be continued even after an event is marked as ended. Use the Resume Loot button on the event card on the server dashboard.',
        },
      ],
    },
    {
      id: 'snake-admin',
      icon: <Shuffle className="h-4 w-4" />,
      title: 'Snake Draft — Admin Controls',
      adminOnly: true,
      items: [
        {
          title: 'Setting the Draft Order',
          body: 'Use the Draft Order card to build the pick list. All confirmed attendees can be added, and you can also add any guild member by searching the full member list. Drag to reorder, or use Shuffle for a random order.',
        },
        {
          title: 'Adding & Removing Members',
          body: 'Click a member pill in the "Add members" section to add them to the draft. Click × on an existing chip to remove them. Changes are only allowed before the draft is started.',
        },
        {
          title: 'Starting the Draft',
          body: "Click Start Draft, then confirm in the inline prompt. The pick order is permanently locked once started — members receive a DM notification that it's their turn.",
        },
        {
          title: 'Skipping a Turn',
          body: "Use Skip Turn if the current player is absent or unresponsive. Their position is skipped and the draft advances. The skipped player forfeits that pick slot.",
        },
        {
          title: 'Auto-Pick Cascade',
          body: "If the next player in line has a queue set, their turn resolves automatically. The cascade continues through consecutive players with queues, pausing only when a player has no queued items available.",
        },
      ],
    },
    {
      id: 'dkp-admin',
      icon: <Coins className="h-4 w-4" />,
      title: `${dkpLabel} Administration`,
      adminOnly: true,
      items: [
        {
          title: 'Adjusting Balances',
          body: `From the ${dkpLabel} page, use the Adjust button to award or deduct points from any member. A reason is required for every adjustment and is saved to the transaction log.`,
        },
        {
          title: 'Transaction Log',
          body: 'Every balance change — manual adjustments, session awards, and auction spends — is logged with the date, amount, and reason. The full log is visible on the DKP page.',
        },
        {
          title: 'Session Awards',
          body: `Set a ${dkpLabel} Award amount on a loot session before completing it. The amount is distributed to every confirmed attendee automatically when the session is marked complete.`,
        },
      ],
    },
    {
      id: 'settings-admin',
      icon: <Settings className="h-4 w-4" />,
      title: 'Settings',
      adminOnly: true,
      items: [
        {
          title: 'Bot Settings',
          body: 'Configure which Discord channels receive event announcements, loot results, and DKP notifications. Also set the custom DKP label and other server-wide bot options.',
        },
        {
          title: 'Module Settings — Event Bot',
          body: 'Enable or disable the Event Bot module. When disabled, event creation and RSVP features are hidden from members.',
        },
        {
          title: 'Module Settings — DKP',
          body: `Enable or disable the ${dkpLabel} module. Disabling it hides balances and the transaction log from all members.`,
        },
        {
          title: 'Permissions',
          body: 'Grant Organizer or Admin access to specific Discord roles. Organizers can create and manage events; Admins have full access including DKP adjustments and settings.',
        },
      ],
    },
  ];

  return [...all, ...adminSections];
}

// ── HelpPanel ─────────────────────────────────────────────────────────────────

export function HelpPanel({ isManager, dkpLabel }: { isManager: boolean; dkpLabel: string }) {
  const [open, setOpen] = useState(false);
  const sections = buildSections(isManager, dkpLabel);

  const memberSections = sections.filter((s) => !s.adminOnly);
  const adminSections = sections.filter((s) => s.adminOnly);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <HelpCircle className="h-4 w-4 shrink-0" />
        Help &amp; Guides
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-primary" />
              Help &amp; Guides
            </DialogTitle>
            <DialogDescription>
              {isManager
                ? 'Guides for all features — member and admin sections below.'
                : 'Guides for the features available to you.'}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto px-6 py-5 space-y-6">
            {/* Member guides */}
            <div className="space-y-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Member Guides</p>
              {memberSections.map((section) => (
                <Section key={section.id} section={section} />
              ))}
            </div>

            {/* Admin guides */}
            {adminSections.length > 0 && (
              <>
                <div className="border-t border-border" />
                <div className="space-y-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-500">Admin Guides</p>
                  {adminSections.map((section) => (
                    <Section key={section.id} section={section} />
                  ))}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
