import { useState } from 'react';
import {
  HelpCircle, CalendarDays, Coins, Gavel, Gift, Store,
  Ship, Users, Settings, ChevronDown, ChevronRight, Shield, Network,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GuideSection {
  id: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  adminOnly?: boolean;
  content: React.ReactNode;
}

// ── Collapsible section card ──────────────────────────────────────────────────

function SectionCard({ section }: { section: GuideSection }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors"
      >
        <span className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          section.adminOnly ? 'bg-amber-500/15 text-amber-500' : 'bg-primary/10 text-primary',
        )}>
          {section.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{section.title}</span>
            {section.adminOnly && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                <Shield className="h-2.5 w-2.5" />
                Admin
              </span>
            )}
          </div>
          {!open && <p className="text-xs text-muted-foreground truncate mt-0.5">{section.subtitle}</p>}
        </div>
        {open
          ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border bg-muted/20 px-4 py-4 text-sm text-muted-foreground leading-relaxed space-y-3">
          {section.content}
        </div>
      )}
    </div>
  );
}

// ── Prose helpers ─────────────────────────────────────────────────────────────

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function H({ children }: { children: React.ReactNode }) {
  return <p className="font-semibold text-foreground">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-1 list-none pl-0">{children}</ul>;
}

function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
      <span>{children}</span>
    </li>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

function Divider() {
  return <div className="border-t border-border/60" />;
}

// ── Section content definitions ───────────────────────────────────────────────

function eventsContent() {
  return (
    <>
      <H>Viewing &amp; RSVPing</H>
      <P>The server <B>Dashboard</B> lists all upcoming and recently completed events. Each card shows the start time, muster point, assigned role slots, and current RSVP count. Completed events are available on the Completed tab.</P>
      <P>To RSVP, click any event card to open its detail view. If the event uses role slots (e.g. Infantry, Pilot, Medic), select the role you intend to fill and confirm. Your slot is reserved immediately.</P>
      <Divider />
      <H>Loot Results</H>
      <P>Once loot has been run for an event, a <B>Loot</B> button appears on the event card. Clicking it shows all item assignments from that session — who received what, and by which method (roll, draft pick, DKP bid).</P>
      <Divider />
      <H>Snake Draft Notifications</H>
      <P>If you're in an active snake draft, a <B>My Picks</B> prompt appears on the Dashboard when it's your turn. You'll also receive a Discord DM from the bot with a direct link to the loot page.</P>
    </>
  );
}

function eventsAdminContent() {
  return (
    <>
      <H>Creating Events</H>
      <P>Click <B>+ New Event</B> on the dashboard. Set the name, start time, optional end time, muster point, and cover image. Add <B>Role Slots</B> (name + capacity) for structured RSVPs, and <B>Voice Channel</B> names to auto-create VCs 30 minutes before the event starts.</P>
      <P>Events are posted to the configured Discord forum channel and scheduled event channel automatically. A thread is created in the forum post for announcements and loot results.</P>
      <Divider />
      <H>Event Templates &amp; Recurring Events</H>
      <P>Every time you click <B>Repeat</B> on a completed event, a template is saved or updated with that event's configuration. Templates appear in the Create Event form so you can pre-fill all fields instantly.</P>
      <P>Set a <B>Recurrence</B> type (Daily, Weekly, Biweekly, Monthly) to mark an event as repeating. Use Repeat to schedule the next occurrence on any cadence you choose.</P>
      <Divider />
      <H>Attendance Audit</H>
      <P>After an event ends, open the <B>Audit</B> page to confirm attendance. Members who were active in event VCs are pre-marked as present. Manually confirm or remove attendees — only confirmed attendees receive DKP awards and qualify for loot rolls.</P>
      <Divider />
      <H>Ending Events</H>
      <P>Use the <B>End Event</B> button on the event card to close the event, archive voice channels, and lock RSVPs. The bot cleans up VCs and archives the forum thread automatically. You can still run a loot session after an event is ended.</P>
    </>
  );
}

function dkpContent(dkpLabel: string) {
  return (
    <>
      <H>Your Balance &amp; Rank</H>
      <P>The <B>{dkpLabel}</B> page shows your current balance, your rank among all guild members, and a full transaction history on your account — every award, spend, and manual adjustment with timestamps and reasons.</P>
      <Divider />
      <H>Earning {dkpLabel}</H>
      <UL>
        <LI><B>Event Attendance Awards</B> — admins can set a point award on any loot session. When the session is completed, the configured amount is distributed automatically to all confirmed attendees.</LI>
        <LI><B>Manual Adjustments</B> — admins can award or deduct points at any time with a required reason that is logged permanently.</LI>
      </UL>
      <Divider />
      <H>Spending {dkpLabel}</H>
      <P>Your balance is spent in <B>{dkpLabel} Bid</B> loot sessions and standalone <B>Auctions</B>. Only the final winning bid is deducted — losing bids are never charged. If you win a loot session item, the cost is deducted when the session completes.</P>
    </>
  );
}

function dkpAdminContent(dkpLabel: string) {
  return (
    <>
      <H>Adjusting Balances</H>
      <P>From the <B>{dkpLabel}</B> page, use the Adjust button on any member row to award or deduct points. A reason is required and is saved to the permanent transaction log visible to all admins.</P>
      <Divider />
      <H>Session Awards</H>
      <P>Set a <B>{dkpLabel} Award</B> amount when creating or managing a loot session. The amount is automatically distributed to every confirmed attendee when the session is marked complete — no manual award needed.</P>
      <Divider />
      <H>Currency Label</H>
      <P>Rename the {dkpLabel} currency in <B>Module Settings → DKP</B>. The custom label appears throughout the dashboard, bot messages, and DM notifications.</P>
    </>
  );
}

function auctionsContent(dkpLabel: string) {
  return (
    <>
      <H>Browsing Auctions</H>
      <P>The <B>Auctions</B> page lists all active and recently closed auctions for your server. Each entry shows the item name, current high bid, time remaining, and the full bidder list ranked by current bid.</P>
      <Divider />
      <H>Proxy Bidding</H>
      <P>Enter your <B>maximum willing bid</B> — the system bids only what's necessary to stay ahead of the competition, incrementing by 1 each time someone outbids you. You'll win at the lowest amount that beats the runner-up, not necessarily your stated maximum.</P>
      <P>You can raise your max bid at any time, but bids can never be lowered or withdrawn once placed.</P>
      <Divider />
      <H>Loot Auctions</H>
      <P>Loot sessions using the <B>{dkpLabel} Bid</B> method run one auction per item inline on the loot page. These auctions also appear on the Auctions page and follow the same proxy bidding rules. The winning bid is deducted from the winner's {dkpLabel} balance when the session completes.</P>
      <Divider />
      <H>Standalone Auctions</H>
      <P>Admins can create auctions outside of any event from the Auctions page. These are useful for one-off items or organization fundraisers and are announced in the configured Discord channel.</P>
    </>
  );
}

function lootContent(dkpLabel: string) {
  return (
    <>
      <H>Distribution Methods</H>
      <P>Each loot session uses one of four methods, chosen when the session is created:</P>
      <UL>
        <LI><B>Random Roll</B> — all eligible members roll a d1000. Highest roll wins. Ties auto-reroll. The "Exclude previous winners" option prevents repeat wins within the session.</LI>
        <LI><B>Snake Draft</B> — members take turns in a snake order (1-2-3-3-2-1…). Each member gets a fair turn. You can set a pick queue in advance and the system auto-picks for you when it's your turn.</LI>
        <LI><B>Commodity Draft</B> — designed for bulk materials. Items are grouped by name and quality, then distributed automatically to a set number of members per item using a snake order. Each recipient gets one unit.</LI>
        <LI><B>{dkpLabel} Bid</B> — a timed proxy auction per item. Winner pays the runner-up's bid + 1, deducted from their {dkpLabel} balance.</LI>
      </UL>
      <Divider />
      <H>Snake Draft — Pick Queue</H>
      <P>When you're in an active snake draft, open the loot page and find the <B>Queue</B> panel. Add items in the order you'd prefer to receive them. When it's your turn, the system checks your queue and picks the first still-available item automatically.</P>
      <P>Drag the grip handle (⠿) to reorder your queue. Items already assigned to someone else are struck through and skipped. You'll receive a Discord DM when it's your turn regardless of whether you have a queue set.</P>
      <Divider />
      <H>Loot History</H>
      <P>The <B>Loot History</B> tab on the Loot module page shows all past sessions. Expand any session row to see the full item list. For commodity sessions, all distribution assignments are shown grouped by recipient. Admins and session owners can mark individual items as <B>Delivered</B>.</P>
    </>
  );
}

function lootAdminContent(dkpLabel: string) {
  return (
    <>
      <H>Creating a Session</H>
      <P>From an event's loot tab or the standalone Loot page, click <B>New Session</B>. Choose a distribution method, optionally set a {dkpLabel} award for attendance, then add items. Sessions can be created before, during, or after an event ends.</P>
      <Divider />
      <H>Adding Items</H>
      <P>Type item names in the input field. For <B>Snake Draft</B> sessions the autocomplete searches your Exchange commodity list. For <B>Commodity Draft</B>, set a Quality Level (QL) and Count — the count determines how many members will each receive one unit of that item.</P>
      <P>Items can be renamed or removed at any point before the session is marked complete.</P>
      <Divider />
      <H>Snake Draft — Admin Controls</H>
      <P>Build the draft order in the <B>Draft Order</B> card. Add confirmed attendees with one click, or search the full member list to include others. Drag to reorder, or use Shuffle for a randomized order. Once you click <B>Start Draft</B> and confirm, the order is locked and the first picker receives a Discord DM.</P>
      <P>Use <B>Skip Turn</B> if the current player is absent — the skip is logged and the draft advances. Auto-pick cascades through consecutive players who have items queued, pausing when the chain breaks.</P>
      <Divider />
      <H>Standalone Sessions</H>
      <P>The <B>Loot</B> module page lets you create sessions not tied to any event. Add participants manually by searching the member list. Standalone sessions support all four distribution methods and send the same Discord DM notifications as event sessions.</P>
      <Divider />
      <H>Completing &amp; Delivering</H>
      <P>Click <B>Complete Session</B> once all items are assigned. {dkpLabel} attendance awards (if set) are distributed automatically. The session is locked as read-only. In the Loot History view, expand any session to mark individual items as delivered using the toggle on each assignment row.</P>
    </>
  );
}

function marketplaceContent() {
  return (
    <>
      <H>Cross-Guild Browse</H>
      <P>The <B>Marketplace</B> lets you browse listings from every guild on the platform, not just your own server. Use the <B>Browse</B> tab to search by item name, filter by type (Item / Commodity), this guild only, fixed price only, and sort by newest or price low to high. Results are paginated — click <B>Load more</B> for additional listings.</P>
      <Divider />
      <H>My Inventory</H>
      <P>The <B>My Inventory</B> tab is your personal stockpile for this server. Add items or commodities using the search box — select a UEX item or commodity, set a quantity, optional quality level (QL), and location. Hover any row to edit quantity/location (✏️) or delete it (🗑). Use the <B>Listed (N)</B> toggle to filter down to only your active listings.</P>
      <Divider />
      <H>Listing Items for Sale</H>
      <P>Hover any inventory row and click the tag icon to open the listing editor. Set a quantity to list (blank = all of your stock), an asking price in aUEC, or a free-text price note (e.g. "Negotiable", "Trade for Agricium"). Click <B>Publish Listing</B> to make it visible to all guilds on the platform.</P>
      <P>Listings expire after <B>14 days</B>. To renew, open the listing editor and change your asking price or price note — the timer only resets when the price actually changes. Expired listings show an amber <B>Expired</B> badge and are hidden from Browse until renewed. An <B>Expires in Xd</B> warning appears when fewer than 3 days remain.</P>
      <Divider />
      <H>Trade Requests</H>
      <P>Found something you want? Click <B>Request</B> on a Browse listing, enter the quantity, and add an optional message to the seller. The seller receives a Discord DM from the bot and sees the request in the <B>Trades</B> tab under Incoming Requests.</P>
      <P>Sellers can <B>Accept</B>, <B>Decline</B>, or <B>Cancel</B> any pending request. Buyers can cancel their own request at any time. Accepting a trade automatically adjusts the seller's listed quantity and declines any other pending requests that can no longer be fulfilled. All status changes send a bot DM to the other party.</P>
      <P>The <B>Trades</B> tab label shows a live badge counting pending incoming requests. Resolved trades older than 30 days are hidden by default — click <B>Show older trades</B> at the bottom to reveal history. If a seller leaves the guild while your request is pending, a <B>Seller left this guild</B> warning appears so you know to cancel.</P>
      <Divider />
      <H>Bot Commands</H>
      <P><code className="font-mono text-xs bg-muted px-1 rounded">/marketplace search</code> searches active listings for an exact item or commodity across all guilds directly from Discord. <code className="font-mono text-xs bg-muted px-1 rounded">/marketplace list</code> shows your own active listings for the current server (visible only to you).</P>
    </>
  );
}

function fleetContent() {
  return (
    <>
      <H>Fleet Registry</H>
      <P>The <B>Fleet</B> page is a registry of every ship owned by guild members. Search by ship name or manufacturer to see who in the org flies a particular hull, how many they own, and any notes they've added.</P>
      <Divider />
      <H>Adding Your Ships</H>
      <P>Use the ship search box on the Fleet page to find your vessel by name or manufacturer. Select it from the dropdown, set the quantity, and optionally add notes (loadout, current status, etc.). Repeat for each ship you own.</P>
      <Divider />
      <H>RSI Handle</H>
      <P>Set your <B>RSI citizen handle</B> in the Fleet page settings panel. This links your Discord account to your RSI profile and is used by the RSI Roster to confirm org membership.</P>
    </>
  );
}

function rsiContent() {
  return (
    <>
      <H>Why Verification Is Required</H>
      <P>This server requires you to verify ownership of your RSI citizen account before accessing the dashboard. This prevents members from claiming a handle they don't own and ensures the org roster accurately reflects who is who.</P>
      <Divider />
      <H>Completing Verification</H>
      <P>When you first open the dashboard, a three-step verification prompt appears:</P>
      <UL>
        <LI><B>Step 1</B> — Enter your RSI citizen handle and click Get Token.</LI>
        <LI><B>Step 2</B> — Copy the generated token (format: <code className="font-mono text-xs bg-muted px-1 rounded">DEM-XXXXXX</code>) and paste it anywhere in your RSI bio at robertsspaceindustries.com → Account → Profile. Save the page.</LI>
        <LI><B>Step 3</B> — Click Verify. The system fetches your public citizen profile, finds the token, and unlocks the dashboard.</LI>
      </UL>
      <P>You can remove the token from your bio immediately after verification completes — it is one-time use only.</P>
      <Divider />
      <H>RSI Roster (Admins)</H>
      <P>The <B>RSI Roster</B> page (visible to admins) fetches the live org member list from Roberts Space Industries and cross-references it against app members' verified handles. You can see at a glance who is confirmed in the org, who is linked but not in the org, and which org members haven't linked their app account yet.</P>
    </>
  );
}

function allianceContent() {
  return (
    <>
      <H>What Is an Alliance?</H>
      <P>An alliance is a named group of servers that have agreed to coordinate together. Once your guild joins an alliance, events shared by any member guild appear on your dashboard automatically — no separate login or server required.</P>
      <Divider />
      <H>Alliance Events on Your Dashboard</H>
      <P>Shared events show alongside your own guild's events with a small alliance indicator. Click them to open the event detail and RSVP exactly as you would for a local event. The event is hosted by another guild but your RSVP is recorded under your guild's roster.</P>
      <Divider />
      <H>Per-Guild Role Slots</H>
      <P>Alliance events use <B>per-guild role slots</B> — each member guild has its own set of role assignments. This lets the host org define a role structure (e.g. Infantry ×10, Pilot ×4) and each guild fills its own complement independently. Your role choice only affects your guild's roster, not other guilds'.</P>
      <Divider />
      <H>Org Tags</H>
      <P>Each guild can set a short <B>Org Tag</B> (up to 4 characters, e.g. <code className="font-mono text-xs bg-muted px-1 rounded">ASOP</code>) in Alliance settings. This tag appears next to member names in event lists, bot roster embeds, and snake draft order announcements so participants can identify which org each member belongs to.</P>
    </>
  );
}

function allianceAdminContent() {
  return (
    <>
      <H>Creating an Alliance</H>
      <P>Go to <B>Module Settings → Alliance</B> and click <B>New Alliance</B>. Give it a name (e.g. "Northern Coalition") and confirm. Your server is added as the first accepted member automatically.</P>
      <Divider />
      <H>Inviting Other Servers</H>
      <P>Open an alliance card and click <B>Invite Server</B>. Search the list of bot-installed guilds and select one to send an invitation. The invited server sees a <B>Pending Alliance Invitations</B> banner on their Alliance settings page and can accept or reject. Pending invitations are shown with an "Awaiting" badge on your card until resolved.</P>
      <P>To cancel a pending invitation before it is accepted, hover the awaiting server row and click the remove button.</P>
      <Divider />
      <H>Accepting Invitations</H>
      <P>When another guild invites yours, a highlighted <B>Pending Alliance Invitations</B> card appears at the top of your Alliance settings page. Click <B>Accept</B> to join the alliance, or <B>Reject</B> to decline. Accepted guilds immediately appear as members on all alliance cards across every member server.</P>
      <Divider />
      <H>Sharing Events</H>
      <P>When creating or editing an event, use the <B>Alliance</B> selector in the event form to choose which alliance to share it with. The event is then visible on every member guild's dashboard. The bot automatically creates a forum thread and Discord scheduled event in each member guild, and loot result announcements are broadcast to all alliance threads when a session completes.</P>
      <P>Only guilds the host server is an accepted member of appear in the alliance dropdown. Removing the alliance share from an event un-broadcasts it.</P>
      <Divider />
      <H>Org Tag &amp; Manager Roles</H>
      <P>Set your guild's <B>Org Tag</B> (up to 4 alphanumeric characters) in Alliance settings. It appears in event lists and bot embeds to identify your guild within the alliance. Use <B>Alliance Manager Roles</B> to grant non-admin Discord roles the ability to create, invite, and manage alliances — server admins always have this permission regardless of the role setting.</P>
      <Divider />
      <H>Removing Members &amp; Deleting Alliances</H>
      <P>Hover any accepted member row in an alliance card and click the remove button to remove that server from the alliance. To delete an alliance entirely, use the trash icon on the alliance card header. Both actions take effect immediately across all member servers.</P>
    </>
  );
}

function marketplaceAdminContent() {
  return (
    <>
      <H>Module Toggle</H>
      <P>Toggle the <B>Marketplace enabled</B> switch in <B>Module Settings → Marketplace</B> to show or hide the Marketplace nav link and all associated features for every member in this server.</P>
      <Divider />
      <H>Wipe All Inventories</H>
      <P>The <B>Danger Zone</B> section contains a <B>Wipe Inventories</B> action that permanently deletes every member's inventory entries for this server. It cannot be undone. You must type a confirmation phrase and confirm a second time before the wipe executes. Pending trade requests and trade history are preserved separately and are not affected.</P>
    </>
  );
}

function settingsContent(dkpLabel: string) {
  return (
    <>
      <H>Permissions</H>
      <P>The <B>Org Settings</B> panel controls who can edit module settings. Assign Discord roles to <B>Module Settings Editors</B> to allow non-admin members to configure channels and module options. <B>Viewer Roles</B> grant members access to view events and loot without being a server admin.</P>
      <Divider />
      <H>Module Settings</H>
      <P>Each module (Event Bot, DKP, Loot, Marketplace, Fleet) has its own settings page under <B>Module Settings</B> in the sidebar. Toggle the enabled switch to show or hide that module's nav link and features for all members. Disabled modules are completely hidden.</P>
      <P>The DKP module settings page also lets you set the <B>currency label</B> (e.g. renaming "DKP" to "Credits"), the default auction duration, and the minimum valid bid.</P>
      <Divider />
      <H>Bot Configuration</H>
      <P>In the <B>Event Bot</B> module settings, configure which Discord channels receive event announcements and voice category for auto-created VCs. In <B>DKP</B> module settings, set the announcement channel for standalone auctions. In <B>Loot</B> settings, set the channel for loot result posts.</P>
      <Divider />
      <H>RSI Org Tag</H>
      <P>Set your org's RSI tag in <B>Org Settings</B> to enable the RSI Roster and bio verification requirement. Once set, all members must verify their RSI handle before accessing the dashboard.</P>
      <Divider />
      <H>Registering Bot Commands</H>
      <P>Use the <B>Register Commands</B> button in the Org Settings panel if slash commands stop appearing in Discord. This re-registers all guild-specific commands without affecting the bot's other functions.</P>
    </>
  );
}

// ── Section builder ───────────────────────────────────────────────────────────

function buildSections(opts: {
  isManager: boolean;
  dkpLabel: string;
  eventBotEnabled: boolean;
  dkpEnabled: boolean;
  lootEnabled: boolean;
  exchangeEnabled: boolean;
  fleetEnabled: boolean;
  rsiOrgRequired: boolean;
}): GuideSection[] {
  const { isManager, dkpLabel, eventBotEnabled, dkpEnabled, lootEnabled, exchangeEnabled, fleetEnabled, rsiOrgRequired } = opts;

  const member: GuideSection[] = [
    eventBotEnabled && {
      id: 'events',
      icon: <CalendarDays className="h-4 w-4" />,
      title: 'Events',
      subtitle: 'RSVPing, viewing event details, and loot results.',
      content: eventsContent(),
    },
    dkpEnabled && {
      id: 'dkp',
      icon: <Coins className="h-4 w-4" />,
      title: `${dkpLabel} — Points & Balance`,
      subtitle: `How ${dkpLabel} is earned, spent, and tracked.`,
      content: dkpContent(dkpLabel),
    },
    dkpEnabled && {
      id: 'auctions',
      icon: <Gavel className="h-4 w-4" />,
      title: 'Auctions',
      subtitle: 'Proxy bidding, live auctions, and loot bid sessions.',
      content: auctionsContent(dkpLabel),
    },
    lootEnabled && {
      id: 'loot',
      icon: <Gift className="h-4 w-4" />,
      title: 'Loot & Distribution',
      subtitle: 'All four distribution methods, pick queues, and loot history.',
      content: lootContent(dkpLabel),
    },
    exchangeEnabled && {
      id: 'marketplace',
      icon: <Store className="h-4 w-4" />,
      title: 'Marketplace',
      subtitle: 'Browse cross-guild listings, manage inventory, and trade with other members.',
      content: marketplaceContent(),
    },
    fleetEnabled && {
      id: 'fleet',
      icon: <Ship className="h-4 w-4" />,
      title: 'Fleet Registry',
      subtitle: 'Register your ships and set your RSI citizen handle.',
      content: fleetContent(),
    },
    (fleetEnabled && rsiOrgRequired) && {
      id: 'rsi',
      icon: <Users className="h-4 w-4" />,
      title: 'RSI Verification & Roster',
      subtitle: 'Bio token verification and org membership cross-reference.',
      content: rsiContent(),
    },
    {
      id: 'alliance',
      icon: <Network className="h-4 w-4" />,
      title: 'Alliance & Cross-Server Events',
      subtitle: 'Cross-guild events, per-guild role slots, and org tags.',
      content: allianceContent(),
    },
  ].filter(Boolean) as GuideSection[];

  if (!isManager) return member;

  const admin: GuideSection[] = [
    eventBotEnabled && {
      id: 'events-admin',
      icon: <CalendarDays className="h-4 w-4" />,
      title: 'Event Administration',
      subtitle: 'Creating events, templates, recurring schedules, attendance audit.',
      adminOnly: true,
      content: eventsAdminContent(),
    },
    lootEnabled && {
      id: 'loot-admin',
      icon: <Gift className="h-4 w-4" />,
      title: 'Loot Administration',
      subtitle: 'Running sessions, managing the snake draft, completing and delivering.',
      adminOnly: true,
      content: lootAdminContent(dkpLabel),
    },
    dkpEnabled && {
      id: 'dkp-admin',
      icon: <Coins className="h-4 w-4" />,
      title: `${dkpLabel} Administration`,
      subtitle: 'Adjusting balances, session awards, and currency configuration.',
      adminOnly: true,
      content: dkpAdminContent(dkpLabel),
    },
    {
      id: 'alliance-admin',
      icon: <Network className="h-4 w-4" />,
      title: 'Alliance Administration',
      subtitle: 'Creating alliances, inviting servers, sharing events, org tags.',
      adminOnly: true,
      content: allianceAdminContent(),
    },
    exchangeEnabled && {
      id: 'marketplace-admin',
      icon: <Store className="h-4 w-4" />,
      title: 'Marketplace Administration',
      subtitle: 'Module toggle and inventory wipe danger zone.',
      adminOnly: true,
      content: marketplaceAdminContent(),
    },
    {
      id: 'settings-admin',
      icon: <Settings className="h-4 w-4" />,
      title: 'Permissions & Settings',
      subtitle: 'Module settings, bot channels, roles, RSI org tag.',
      adminOnly: true,
      content: settingsContent(dkpLabel),
    },
  ].filter(Boolean) as GuideSection[];

  return [...member, ...admin];
}

// ── HelpPanel ─────────────────────────────────────────────────────────────────

export function HelpPanel({
  isManager,
  dkpLabel,
  eventBotEnabled = true,
  dkpEnabled = true,
  lootEnabled = true,
  exchangeEnabled = true,
  fleetEnabled = true,
  rsiOrgRequired = false,
}: {
  isManager: boolean;
  dkpLabel: string;
  eventBotEnabled?: boolean;
  dkpEnabled?: boolean;
  lootEnabled?: boolean;
  exchangeEnabled?: boolean;
  fleetEnabled?: boolean;
  rsiOrgRequired?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const sections = buildSections({ isManager, dkpLabel, eventBotEnabled, dkpEnabled, lootEnabled, exchangeEnabled, fleetEnabled, rsiOrgRequired });
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
                ? 'Click any section to expand. Disabled modules are hidden.'
                : 'Guides for the features available to you.'}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto px-6 py-5 space-y-6">
            {memberSections.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-0.5">Member Guides</p>
                {memberSections.map((s) => <SectionCard key={s.id} section={s} />)}
              </div>
            )}

            {adminSections.length > 0 && (
              <>
                <div className="border-t border-border" />
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-500 px-0.5">Admin Guides</p>
                  {adminSections.map((s) => <SectionCard key={s.id} section={s} />)}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
