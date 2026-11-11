import { useState } from 'react';
import {
  HelpCircle, CalendarDays, Coins, Gavel, Gift, Store,
  Ship, Users, Settings, ChevronDown, ChevronRight, Shield, Network, Trophy, BarChart3, Terminal,
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
      <P>Pick a <B>Repeat</B> option in the Create Event form to make an event recurring. The options are worded from the start date you chose, for example <B>Weekly on Tuesday</B>, <B>Monthly on the 14th</B>, <B>Monthly on the 2nd Tuesday</B> or <B>Monthly on the last Friday</B>. The form shows the next three dates so you can check them before saving.</P>
      <P>When an occurrence ends, the bot schedules the next one automatically. Times stay the same in your local time across daylight saving changes. A monthly event on the 29th–31st falls on the last day of shorter months and returns to its usual date afterwards.</P>
      <P>To end a series, click <B>Stop Repeating</B> on the event. If the next occurrence hasn't started yet, it is cancelled too, and its Discord event and thread are taken down. If it's already under way, it finishes as normal. Either way, no more occurrences are scheduled.</P>
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
      <P>If you're in a snake draft's pick order, every unassigned item on the loot page has a <B>+</B> button. Click it to add the item to your queue; the button changes to a check mark, and clicking it again removes the item. When it's your turn, the system picks the first item in your queue that's still available.</P>
      <P>Your <B>Queue</B> panel lists only the items you've queued. Drag the grip handle (⠿) to change their order. Items someone else has already received are struck through and skipped. The panel and the + buttons appear only for members in the draft order. You'll get a Discord DM when it's your turn whether or not you have a queue.</P>
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
      <P>Session controls (creating sessions, adding items, the draft order, assigning and completing) are shown only to members with the <B>Manage Server</B> permission in Discord. Everyone else sees the session read-only, plus their own queue.</P>
      <P>From an event's loot tab or the standalone Loot page, click <B>New Session</B>. Choose a distribution method, optionally set a {dkpLabel} award for attendance, then add items. Sessions can be created before, during, or after an event ends.</P>
      <Divider />
      <H>Adding Items</H>
      <P>Type item names in the input field; suggestions come from the game's own item and commodity list (Commodity Draft sessions suggest commodities only). Hover the <B>i</B> next to an item to see its in-game stats, or average prices for a commodity. For <B>Commodity Draft</B>, set a Quality Level (QL) and Count — the count determines how many members will each receive one unit of that item.</P>
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
      <P>The <B>My Inventory</B> tab is your personal stockpile for this server. Add items or commodities using the search box — pick the item from the game's own item list, set a quantity, optional quality level (QL), and location. Hover any row to edit quantity/location (✏️) or delete it (🗑). Use the <B>Listed (N)</B> toggle to filter down to only your active listings.</P>
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
      <H>Allies</H>
      <P>Orgs on ASOP Terminal can become <B>allies</B>: one org's officers send a request and the other org's officers accept or reject it. Your officers manage this on the <B>Allies</B> page. Only allies can share events with each other.</P>
      <Divider />
      <H>Shared Events on Your Dashboard</H>
      <P>Events an allied org shares with yours appear alongside your own once they're accepted: either by your server managers, or straight away if your officers chose to post that ally's events automatically. Click any event card to open it and RSVP exactly as you would for one of your own events. The event is hosted by the other org, but your RSVP is recorded on your org's roster, and the bot posts the event, thread and roster in your Discord too.</P>
      <Divider />
      <H>Per-Org Role Slots</H>
      <P>Shared events use <B>per-org role slots</B>: the host sets the role structure (e.g. Infantry ×10, Pilot ×4) and each org fills its own slots. Your role choice only affects your org's roster.</P>
      <Divider />
      <H>Org Tags</H>
      <P>Each org can set a short <B>Org Tag</B> (up to 4 characters, e.g. <code className="font-mono text-xs bg-muted px-1 rounded">ASOP</code>). It appears next to member names on shared events, in bot roster posts and snake draft order announcements, so everyone can tell which org a member belongs to.</P>
    </>
  );
}

function allianceAdminContent() {
  return (
    <>
      <H>The Allies Page</H>
      <P>Open <B>Org Settings → Allies</B>. A badge on the menu item counts ally requests waiting for an answer. Server managers can use it, plus any role chosen under <B>Who can manage allies</B> on the same page.</P>
      <Divider />
      <H>Sending a Request</H>
      <P>Under <B>Add an ally</B>, search for an org by name or tag, or paste its <B>ally code</B>, and click <B>Send request</B>. You can add a short message. Only orgs that turned on <B>Listed in the ally directory</B> show up in search; any org can be reached with its code. If the other org had already asked you, sending a request to them makes you allies straight away.</P>
      <P>You can have up to 10 requests waiting at once. Withdraw one with <B>Cancel request</B> under <B>Requests you sent</B>.</P>
      <Divider />
      <H>Answering a Request</H>
      <P>Requests for your org appear at the top of the page. <B>Accept</B> makes you allies. <B>Reject</B> declines; that org can ask again after 7 days. <B>Reject and block</B> stops that org from sending requests until you unblock it under <B>Blocked</B>. The other org isn't told it was blocked.</P>
      <Divider />
      <H>Ally Notices in Discord</H>
      <P>Choose an <B>Ally notices channel</B> under <B>Ally settings</B> and the bot posts each new request there, with the org's name, tag and message, and <B>Accept</B>, <B>Reject</B> and <B>Reject and block</B> buttons. Anyone who can manage allies can use the buttons; others are told privately they can't. Once a request is answered, from Discord or this page, the post updates to show who answered it, and its buttons go away.</P>
      <P>The same channel tells you when another org accepts or declines your request, or ends an alliance with you. Events your allies share with you are posted there too, with <B>Accept</B>, <B>Decline</B> and <B>Open</B> buttons; only server managers can accept or decline them. Pick a channel only officers can see, and make sure the bot can view it, send messages and embed links there. With no channel set, everything still works from the Allies page.</P>
      <Divider />
      <H>Your Listing and Ally Code</H>
      <P>Turn on <B>Listed in the ally directory</B> to let other orgs find you by name or tag. Whether or not you're listed, your <B>ally code</B> lets an org send you a request. Copy it to share with another org's officers; <B>New code</B> replaces it and stops the old one working.</P>
      <Divider />
      <H>Ending an Alliance</H>
      <P>Click <B>Remove</B> next to an ally. It takes effect for both orgs at once, and either org can send a new request later.</P>
      <Divider />
      <H>Sharing Events with Allies</H>
      <P>When creating an event, click <B>Share with allies</B> and tick the allies to share it with (<B>Select all</B> picks every one). To share an event that already exists, open it and use <B>+ Share with an ally</B> under <B>Shared With</B>. Only allies can be picked: add an org on the Allies page first.</P>
      <P>Once a share is accepted, the bot posts the event, a forum thread with the roster and a Discord event in the ally's server, and loot results are announced in every participating thread. Under <B>Shared With</B> you can cancel an invitation that's still waiting, stop sharing with an ally that accepted, or invite one that declined again.</P>
      <P>A repeating event is shared again each time with the allies that accepted the last one, as long as they're still allies.</P>
      <Divider />
      <H>Their Events: Approve Each or Post Automatically</H>
      <P>Next to each ally on the Allies page, <B>Their events</B> sets what happens when that ally shares an event with you. <B>Approve each</B> (the default) puts it under <B>Pending</B> on your Events page, and in your ally notices channel with <B>Accept</B> and <B>Decline</B> buttons, for a server manager to answer. <B>Post automatically</B> posts it in your server straight away. Each org sets this for itself.</P>
      <P>Removing an ally withdraws invitations still waiting between your two orgs, both ways. Events already accepted stay until they end.</P>
      <Divider />
      <H>Org Tag, Notices &amp; Ally Managers</H>
      <P>Set your <B>Org Tag</B> (up to 4 letters or numbers) and <B>Ally notices channel</B> under <B>Ally settings</B> on the Allies page. Server managers can also choose there which Discord roles may manage allies.</P>
    </>
  );
}

function tournamentsContent() {
  return (
    <>
      <H>Viewing Tournaments</H>
      <P>The <B>Tournaments</B> page lists all upcoming, active, and completed tournaments for your server. Tabs divide them by status. Each card shows the format, bracket size, registration deadline, and current participant count.</P>
      <Divider />
      <H>Registering</H>
      <P>While registration is open, click <B>Register</B> on any tournament card. You can also register directly from the bot's Discord announcement using the Register button in the embed — no need to visit the dashboard. Click <B>Leave</B> to withdraw your registration before the tournament starts.</P>
      <Divider />
      <H>Bracket &amp; Matches</H>
      <P>Once a tournament starts, the bracket is posted as an image in the Discord forum thread and visible on the tournament detail page. Match results appear in real time as they're submitted. Click any match card to see scores and progression.</P>
      <Divider />
      <H>ELO Rankings</H>
      <P>The <B>Rankings</B> tab shows player ratings across all tournaments on this server. Your rating updates after every match result. Click your name on the rankings table to see your full match history, per-match ELO changes, and peak rating.</P>
      <Divider />
      <H>Head-to-Head (H2H)</H>
      <P>H2H matches are informal 1v1 results recorded outside of any bracket. Admins submit them from the H2H tab. Results count toward ELO ratings and are announced in the configured H2H channel. Use them to track scrimmages, side bets, or ranked practice matches between events.</P>
    </>
  );
}

function tournamentsAdminContent() {
  return (
    <>
      <H>Creating a Tournament</H>
      <P>Click <B>+ New Tournament</B> and configure: name, format (Single Elimination or Double Elimination), participant mode (Solo or Team), bracket size, seeding mode (Manual, Random, or ELO), and an optional registration deadline. Enable <B>Open Roster</B> to remove the registration cap — the bracket size is derived from registrants when you start.</P>
      <Divider />
      <H>Managing Registration</H>
      <P>Open any tournament card and use the <B>Participants</B> panel. Add members manually by searching the roster, or let members self-register from the Discord embed or dashboard. Drag participant rows to adjust seed order, or click a seed number to set it directly. Remove anyone who can no longer attend before the tournament starts.</P>
      <Divider />
      <H>Starting &amp; Running the Bracket</H>
      <P>Click <B>Start Tournament</B> when registration is closed. The bracket is generated, posted as an image to the configured Discord forum channel, and a thread is created for announcements. Submit match results using the <B>Report Result</B> button on any match card — set scores, declare the winner, or record a forfeit. The bracket image and standings update automatically after each result.</P>
      <Divider />
      <H>Completing a Tournament</H>
      <P>Once all matches in the final round are resolved, click <B>Complete</B> to close the tournament. ELO ratings are updated for every participant and a final results message is posted in the Discord thread.</P>
      <Divider />
      <H>Seasons</H>
      <P>Group tournaments into named <B>Seasons</B> to track standings over time. Create a season from the Seasons tab, then link a tournament to it when creating or editing it. Season standings are available in the Rankings tab and show cumulative wins, losses, and rating movement within that season.</P>
      <Divider />
      <H>H2H Matches</H>
      <P>Submit a head-to-head result from the <B>H2H</B> tab. Enter both players' names (or Discord accounts), pick the winner, and optionally toggle the Discord announcement. The result is recorded, ELO updated, and a summary posted to the H2H announcement channel if configured.</P>
      <Divider />
      <H>Settings</H>
      <P>Configure the module in <B>Module Settings → Tournaments</B>: set the <B>Announcement Channel</B> (forum channel where bracket threads are auto-created), the <B>H2H Channel</B> (text channel for H2H result posts), and the <B>Hide ELO Ratings</B> toggle (hides the Rankings tab and ELO numbers from all members while still calculating ratings internally).</P>
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
      <H>Module Settings &amp; Setting Tooltips</H>
      <P>Each module (Event Bot, DKP, Loot, Marketplace, Fleet, Blueprints, Crafting Calculator, Alliance, Tournaments) has its own settings page under <B>Module Settings</B> in the sidebar. Toggle the enabled switch to show or hide that module's nav link for all members. Disabled modules are completely hidden.</P>
      <P>Every setting input has a <B>?</B> icon next to its label. Hovering it shows a detailed explanation of what that setting controls and how it affects the bot and dashboard.</P>
      <P>The DKP module settings page also lets you set the <B>currency label</B> (e.g. renaming "DKP" to "Credits"), the default auction duration, and the minimum valid bid.</P>
      <Divider />
      <H>Bot Channel Configuration</H>
      <P>In <B>Event Bot</B> module settings, configure the forum channel for event threads, the scheduled events channel, and the voice category for auto-created VCs. In <B>DKP</B> settings, set the announcement channel for standalone auctions. In <B>Loot</B> settings, set the channel for loot result posts. In <B>Tournaments</B> settings, configure the bracket announcement forum channel, the H2H results channel, and the ELO visibility toggle.</P>
      <Divider />
      <H>RSI Org Tag</H>
      <P>Set your org's RSI tag in <B>Org Settings</B> to enable the RSI Roster and bio verification requirement. Once set, all members must verify their RSI handle before accessing the dashboard.</P>
      <Divider />
      <H>Status Channel</H>
      <P>Choose a <B>Status Channel</B> in <B>Org Settings</B> and the bot keeps one live status message there. It shows the ASOP version and when it was deployed, plus the Star Citizen game data build, when the Star Citizen Wiki published it and when ASOP last checked for and installed an update. The message is edited in place, and only when something changes (a new version, a game data update, a failed update or a warning), so it never floods the channel.</P>
      <P>Game data is checked for updates once a day. If an update fails, the previous data stays in use and the status message shows the error until the next successful check. The <B>SC Database</B> page shows the same status.</P>
      <Divider />
      <H>Registering Bot Commands</H>
      <P>The bot registers its slash commands every time it starts, so new commands appear and removed ones disappear after an update with nothing to do on your side. If commands ever stop appearing in Discord, use <B>Re-register Commands</B> in <B>Org Settings</B>. It doesn't affect anything else the bot does.</P>
    </>
  );
}

function activityContent() {
  return (
    <>
      <H>The Leaderboard</H>
      <P>The <B>Activity</B> page ranks members by their activity score, built from messages and time in voice channels. Admins set how much each counts.</P>
      <Divider />
      <H>Inactive Members</H>
      <P>Members who haven't been active for the server's inactivity threshold are marked inactive and <B>hidden from the leaderboard</B> by default. A line under the leaderboard says how many are hidden; click <B>Show inactive</B> to list them, greyed out, and <B>Hide inactive</B> to hide them again. A member who becomes active again is back on the leaderboard straight away.</P>
      <Divider />
      <H>Members Who Left</H>
      <P>Members who have left the Discord server are never listed. Their history is kept rather than deleted, so if they rejoin they reappear with their previous score.</P>
    </>
  );
}

function C({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-xs bg-muted px-1 rounded">{children}</code>;
}

function commandsContent(opts: { dkpLabel: string; eventBotEnabled: boolean; dkpEnabled: boolean; lootEnabled: boolean; exchangeEnabled: boolean; fleetEnabled: boolean }) {
  const { dkpLabel, eventBotEnabled, dkpEnabled, lootEnabled, exchangeEnabled, fleetEnabled } = opts;
  return (
    <>
      <P>Type <C>/</C> in Discord to see the bot's commands. <C>/help</C> lists the ones available to you in that server.</P>
      <Divider />
      <H>Star Citizen Data</H>
      <UL>
        <LI><C>/blueprint &lt;name&gt;</C> — everything about a crafting blueprint in one answer: the materials and craft time, how quality changes the stats, what dismantling returns, and how many missions can reward it. Click <B>Show missions</B> for the list of those missions (only you see it). If you type a name without picking a suggestion, you get the blueprints that match.</LI>
        <LI><C>/material &lt;name&gt;</C> — every blueprint that uses a crafting material. Slots that accept several materials count for each of them.</LI>
        <LI><C>/item &lt;name&gt;</C> — details for an item, or average prices for a commodity.</LI>
      </UL>
      <P>Blueprint and material answers come from the latest game files and update automatically when a new game build is published. The footer of each answer names the build.</P>
      <P>These replace the older <C>/recipe</C>, <C>/blueprint search</C>, <C>/blueprint recipe</C>, <C>/blueprint dismantle</C>, <C>/blueprint contracts</C>, <C>/material usedby</C> and <C>/uex</C> commands.</P>
      {(eventBotEnabled || dkpEnabled || lootEnabled || exchangeEnabled || fleetEnabled) && <Divider />}
      {(eventBotEnabled || dkpEnabled || lootEnabled || exchangeEnabled || fleetEnabled) && <H>Server Features</H>}
      <UL>
        {eventBotEnabled && <LI><C>/event list</C>, <C>/event create</C>, <C>/event end</C> — for event organisers: list upcoming events, open the create form, or end an event.</LI>}
        {dkpEnabled && <LI><C>/wallet</C> — your {dkpLabel} balance and recent transactions; add a member to check theirs. <C>/bid &lt;amount&gt;</C> bids in a live {dkpLabel} auction.</LI>}
        {lootEnabled && <LI><C>/loot status</C> — the current loot session; <C>/loot open</C> links to the loot page.</LI>}
        {exchangeEnabled && <LI><C>/whohas &lt;item&gt;</C> — members of this server who have an item. <C>/marketplace search</C> and <C>/marketplace list</C> — listings across all servers, and your own.</LI>}
        {fleetEnabled && <LI><C>/fleet search &lt;ship&gt;</C> — members who own a ship; <C>/fleet link</C> opens your Fleet Registry.</LI>}
        <LI><C>/login</C> — a link to sign in to this website.</LI>
      </UL>
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
  tournamentsEnabled: boolean;
  activityEnabled: boolean;
}): GuideSection[] {
  const { isManager, dkpLabel, eventBotEnabled, dkpEnabled, lootEnabled, exchangeEnabled, fleetEnabled, rsiOrgRequired, tournamentsEnabled, activityEnabled } = opts;

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
      title: 'Allies & Shared Events',
      subtitle: 'Allied orgs, events shared between orgs, per-org role slots, and org tags.',
      content: allianceContent(),
    },
    tournamentsEnabled && {
      id: 'tournaments',
      icon: <Trophy className="h-4 w-4" />,
      title: 'Tournaments',
      subtitle: 'Register, follow brackets, ELO rankings, and head-to-head results.',
      content: tournamentsContent(),
    },
    activityEnabled && {
      id: 'activity',
      icon: <BarChart3 className="h-4 w-4" />,
      title: 'Activity Leaderboard',
      subtitle: 'How members are ranked, and how inactive and departed members are shown.',
      content: activityContent(),
    },
    {
      id: 'commands',
      icon: <Terminal className="h-4 w-4" />,
      title: 'Discord Commands',
      subtitle: '/blueprint, /material, /item and the rest of the bot\'s slash commands.',
      content: commandsContent({ dkpLabel, eventBotEnabled, dkpEnabled, lootEnabled, exchangeEnabled, fleetEnabled }),
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
      title: 'Allies Administration',
      subtitle: 'Ally requests, sharing events with allies, Discord ally notices, the directory and ally codes, blocking, org tags.',
      adminOnly: true,
      content: allianceAdminContent(),
    },
    tournamentsEnabled && {
      id: 'tournaments-admin',
      icon: <Trophy className="h-4 w-4" />,
      title: 'Tournament Administration',
      subtitle: 'Creating brackets, managing registration, results, seasons, and H2H.',
      adminOnly: true,
      content: tournamentsAdminContent(),
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
      subtitle: 'Module settings, bot channels, the status channel, roles, RSI org tag.',
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
  tournamentsEnabled = false,
  activityEnabled = false,
}: {
  isManager: boolean;
  dkpLabel: string;
  eventBotEnabled?: boolean;
  dkpEnabled?: boolean;
  lootEnabled?: boolean;
  exchangeEnabled?: boolean;
  fleetEnabled?: boolean;
  rsiOrgRequired?: boolean;
  tournamentsEnabled?: boolean;
  activityEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const sections = buildSections({ isManager, dkpLabel, eventBotEnabled, dkpEnabled, lootEnabled, exchangeEnabled, fleetEnabled, rsiOrgRequired, tournamentsEnabled, activityEnabled });
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
