// StarStrings (v1.35.0): MrKraken's community string replacements for Star
// Citizen (github.com/MrKraken/StarStrings). The project republishes its
// rolling `latest` release (the LIVE build) on every patch; the bot watches it
// and announces new builds, and /starstrings links the current one. We only
// ever link to their GitHub; the files are never copied.

export const STARSTRINGS_REPO = 'MrKraken/StarStrings';
export const STARSTRINGS_PAGE = `https://github.com/${STARSTRINGS_REPO}`;
/** The LIVE build's release, read through GitHub's public API. */
export const STARSTRINGS_LIVE_API = `https://api.github.com/repos/${STARSTRINGS_REPO}/releases/tags/latest`;
export const STARSTRINGS_LIVE_PAGE = `${STARSTRINGS_PAGE}/releases/tag/latest`;
/** How often the bot asks GitHub (each ask is one request; 304s are free). */
export const STARSTRINGS_CHECK_MS = 30 * 60_000;

export interface StarStringsRelease {
  /** "SC LIVE Build (release-2026-10-09-292e6be)" */
  name: string;
  /** "release-2026-10-09-292e6be", or null if the name doesn't carry one */
  build: string | null;
  /** ISO time GitHub published it */
  publishedAt: string;
  pageUrl: string;
  /** The zip to download (StarStrings-LIVE.zip), or the release page if it has none */
  downloadUrl: string;
  /** The zip's file name and size, when there is one */
  fileName: string | null;
  sizeBytes: number | null;
}

interface GithubRelease {
  name?: unknown;
  tag_name?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  draft?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown; size?: unknown }[] | unknown;
}

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** GitHub's release JSON → what we show, or null if it isn't a usable release. */
export function parseStarStringsRelease(json: unknown): StarStringsRelease | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as GithubRelease;
  if (r.draft === true) return null;
  const publishedAt = s(r.published_at);
  const name = s(r.name) ?? s(r.tag_name);
  if (!publishedAt || !name || Number.isNaN(Date.parse(publishedAt))) return null;
  const pageUrl = s(r.html_url)?.startsWith('https://github.com/') ? s(r.html_url)! : STARSTRINGS_LIVE_PAGE;

  const assets = (Array.isArray(r.assets) ? r.assets : [])
    .map((a: { name?: unknown; browser_download_url?: unknown; size?: unknown }) => ({ name: s(a.name), url: s(a.browser_download_url), size: typeof a.size === 'number' ? a.size : null }))
    .filter((a): a is { name: string; url: string; size: number | null } => !!a.name && !!a.url && a.url.startsWith('https://github.com/'));
  const zip = assets.find((a) => /live.*\.zip$/i.test(a.name)) ?? assets.find((a) => /\.zip$/i.test(a.name));

  return {
    name,
    build: /\b(release-[\w-]+)/i.exec(name)?.[1] ?? null,
    publishedAt: new Date(publishedAt).toISOString(),
    pageUrl,
    downloadUrl: zip?.url ?? pageUrl,
    fileName: zip?.name ?? null,
    sizeBytes: zip?.size ?? null,
  };
}

/** What makes a build new: its build id (or name) and when it was published. */
export const starStringsKey = (r: Pick<StarStringsRelease, 'build' | 'name' | 'publishedAt'>) => `${r.build ?? r.name}@${r.publishedAt}`;

/**
 * GuildSettings.starStringsPosted is "<channel id>|<key>": a server is due a
 * post when its channel has no post of this build yet (a new channel gets the
 * current build).
 */
export const starStringsPostedValue = (channelId: string, key: string) => `${channelId}|${key}`;

/** "2.3 MB" */
export function fileSize(bytes: number | null): string | null {
  if (bytes === null || bytes < 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** How to install, from the project's README, in our words. */
export const STARSTRINGS_INSTALL = [
  'Unzip it, then copy the `data` folder and `user.cfg` into your `StarCitizen/LIVE` folder.',
  'Already have a `user.cfg`? Don\'t replace it: add `g_language = english` to the end of yours.',
  'Get the new build after every patch; an old one can leave text missing or blank in game.',
];
