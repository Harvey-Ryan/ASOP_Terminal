// Uploaded images (v1.40.0): one folder per Discord server under UPLOADS_DIR.
//
// - Every upload is re-encoded on the way in: turned the right way up, shrunk
//   to fit 2560 px, saved as WebP (animations kept), camera data (GPS etc.)
//   dropped. SVGs become pictures too, so nothing we serve can run script.
// - Each server has a cap (UPLOADS_SERVER_CAP_MB, default 200 MB), measured
//   from the files on disk.
// - The admin panel's storage report reads the same folders.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { prisma } from './prisma.js';

export const UPLOADS_BASE = process.env['UPLOADS_DIR'] ?? path.resolve('uploads');
export const IMAGE_MAX_SIDE = 2560;
/** What the browser may send; the stored file is usually far smaller. */
export const UPLOAD_MAX_INPUT_BYTES = 20 * 1024 * 1024;

export function serverCapBytes(): number {
  const mb = Number(process.env['UPLOADS_SERVER_CAP_MB']);
  return (Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024;
}

export const guildUploadDir = (guildId: string) => path.join(UPLOADS_BASE, guildId);

/** Bytes and file count of the files directly in a folder (0 if it doesn't exist). */
export async function dirUsage(dir: string): Promise<{ bytes: number; files: number }> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: 0, files: 0 };
    throw err;
  }
  let bytes = 0;
  let files = 0;
  for (const e of entries) {
    if (!e.isFile()) continue;
    try {
      bytes += (await fs.stat(path.join(dir, e.name))).size;
      files++;
    } catch { /* removed meanwhile */ }
  }
  return { bytes, files };
}

export const guildUsage = (guildId: string) => dirUsage(guildUploadDir(guildId));

export class ImageRejected extends Error {}

/**
 * Re-encodes an uploaded file as WebP next to it and removes the original.
 * Returns the new file's name and size. Throws ImageRejected for files that
 * aren't readable images.
 */
export async function optimiseUpload(filePath: string): Promise<{ filename: string; bytes: number; before: number }> {
  const before = (await fs.stat(filePath)).size;
  const dir = path.dirname(filePath);
  const filename = `${path.basename(filePath, path.extname(filePath))}.webp`;
  const out = path.join(dir, filename === path.basename(filePath) ? `${Date.now()}-o.webp` : filename);
  try {
    const info = await sharp(filePath, { animated: true, limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toFile(out);
    if (out !== filePath) await fs.unlink(filePath).catch(() => {});
    return { filename: path.basename(out), bytes: info.size, before };
  } catch (err) {
    await fs.unlink(out).catch(() => {});
    await fs.unlink(filePath).catch(() => {});
    console.warn('[uploads] Could not read an uploaded image:', (err as Error).message);
    throw new ImageRejected('Could not read that image. Try a PNG, JPEG, WebP or GIF.');
  }
}

export interface StorageReport {
  totalBytes: number;
  files: number;
  capBytes: number;
  /** The disk (or Railway volume) holding the uploads; null if it can't be read. */
  disk: { sizeBytes: number; freeBytes: number } | null;
  servers: { guildId: string; name: string | null; bytes: number; files: number }[];
}

let cached: { at: number; report: StorageReport } | null = null;
export const forgetStorageReport = () => { cached = null; };

/** Every server's folder, biggest first. Cached for a minute (cleared by uploads and deletes). */
export async function storageReport(): Promise<StorageReport> {
  if (cached && Date.now() - cached.at < 60_000) return cached.report;
  let dirs: string[] = [];
  try {
    dirs = (await fs.readdir(UPLOADS_BASE, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const usage = await Promise.all(dirs.map(async (d) => ({ guildId: d, ...(await dirUsage(path.join(UPLOADS_BASE, d))) })));
  const names = new Map((await prisma.guild.findMany({ where: { guildId: { in: dirs } }, select: { guildId: true, name: true } })).map((g) => [g.guildId, g.name]));
  let disk: StorageReport['disk'] = null;
  try {
    const s = await fs.statfs(UPLOADS_BASE);
    disk = { sizeBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch { /* no folder yet */ }
  const servers = usage.filter((u) => u.files > 0).map((u) => ({ ...u, name: names.get(u.guildId) ?? null })).sort((a, b) => b.bytes - a.bytes);
  const report: StorageReport = {
    totalBytes: servers.reduce((n, s) => n + s.bytes, 0),
    files: servers.reduce((n, s) => n + s.files, 0),
    capBytes: serverCapBytes(),
    disk,
    servers,
  };
  cached = { at: Date.now(), report };
  return report;
}
