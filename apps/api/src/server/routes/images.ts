import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import type { ApiResponse, ServerImageDto, ImageUsageDto } from '@dem/shared';
import {
  guildUploadDir, guildUsage, optimiseUpload, serverCapBytes, forgetStorageReport, ImageRejected, UPLOAD_MAX_INPUT_BYTES,
} from '../../lib/uploads.js';

export const imagesRouter = Router();

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;

function toDto(img: { id: string; guildId: string; filename: string; url: string; sortOrder: number; createdAt: Date }): ServerImageDto {
  return { id: img.id, guildId: img.guildId, filename: img.filename, url: img.url, sortOrder: img.sortOrder, createdAt: img.createdAt.toISOString() };
}

function uploadsFor(guildId: string) {
  const dir = guildUploadDir(guildId);
  fs.mkdirSync(dir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: UPLOAD_MAX_INPUT_BYTES },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Only image files are allowed'));
    },
  });
}

// ── GET /api/guilds/:guildId/images ───────────────────────────────────────────

imagesRouter.get('/:guildId/images', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  if (!(await assertEventCreator(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const images = await prisma.serverImage.findMany({
    where: { guildId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  });

  res.json({ success: true, data: images.map(toDto) } satisfies ApiResponse<ServerImageDto[]>);
});

// ── GET /api/guilds/:guildId/images/usage ─────────────────────────────────────
// How much of the server's image space is used (v1.40.0).

imagesRouter.get('/:guildId/images/usage', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertEventCreator(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }
  const used = await guildUsage(guildId);
  res.json({ success: true, data: { bytes: used.bytes, files: used.files, capBytes: serverCapBytes() } } satisfies ApiResponse<ImageUsageDto>);
});

// ── POST /api/guilds/:guildId/images ──────────────────────────────────────────

imagesRouter.post('/:guildId/images', requireAuth, (req, res, next) => {
  const { guildId } = req.params as { guildId: string };

  assertEventCreator(req, guildId).then((ok) => {
    if (!ok) {
      res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
      return;
    }

    const upload = uploadsFor(guildId);
    upload.single('image')(req, res, async (err) => {
      if (err) {
        const message = err instanceof multer.MulterError
          ? (err.code === 'LIMIT_FILE_SIZE' ? `That file is too big (the most is ${mb(UPLOAD_MAX_INPUT_BYTES)}).` : err.message)
          : err instanceof Error && err.message === 'Only image files are allowed' ? err.message : 'Upload failed';
        res.status(400).json({ success: false, error: message } satisfies ApiResponse);
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ success: false, error: 'No file uploaded' } satisfies ApiResponse);
        return;
      }

      // Shrink and re-encode it, then check the server's cap (v1.40.0).
      let saved: Awaited<ReturnType<typeof optimiseUpload>>;
      try {
        saved = await optimiseUpload(file.path);
      } catch (e) {
        if (e instanceof ImageRejected) { res.status(400).json({ success: false, error: e.message } satisfies ApiResponse); return; }
        console.error('[images] upload:', e);
        res.status(500).json({ success: false, error: 'Upload failed' } satisfies ApiResponse);
        return;
      }
      forgetStorageReport();
      const cap = serverCapBytes();
      const used = await guildUsage(guildId);
      if (used.bytes > cap) {
        fs.unlink(path.join(guildUploadDir(guildId), saved.filename), () => {});
        res.status(413).json({
          success: false,
          error: `This server's image library is full (${mb(used.bytes - saved.bytes)} of ${mb(cap)} used). Delete some images to make room.`,
        } satisfies ApiResponse);
        return;
      }

      // Place new image at the end of the current sort order
      const maxRow = await prisma.serverImage.findFirst({
        where: { guildId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const sortOrder = (maxRow?.sortOrder ?? -1) + 1;

      const url = `/uploads/${guildId}/${saved.filename}`;
      const image = await prisma.serverImage.create({
        data: { guildId, filename: saved.filename, url, sortOrder },
      });

      res.status(201).json({ success: true, data: toDto(image) } satisfies ApiResponse<ServerImageDto>);
    });
  }).catch(next);
});

// ── DELETE /api/guilds/:guildId/images/:imageId ───────────────────────────────

imagesRouter.delete('/:guildId/images/:imageId', requireAuth, async (req, res) => {
  const { guildId, imageId } = req.params as { guildId: string; imageId: string };

  if (!(await assertEventCreator(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const image = await prisma.serverImage.findUnique({ where: { id: imageId } });
  if (!image || image.guildId !== guildId) {
    res.status(404).json({ success: false, error: 'Image not found' } satisfies ApiResponse);
    return;
  }

  await prisma.serverImage.delete({ where: { id: imageId } });

  const filePath = path.join(guildUploadDir(guildId), image.filename);
  fs.unlink(filePath, () => { /* ignore if already gone */ });
  forgetStorageReport();

  res.json({ success: true } satisfies ApiResponse);
});

// ── PUT /api/guilds/:guildId/images/reorder ───────────────────────────────────
// Body: { ids: string[] } — full ordered list of image IDs for this guild

imagesRouter.put('/:guildId/images/reorder', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  if (!(await assertEventCreator(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length === 0) {
    res.status(400).json({ success: false, error: 'ids array required' } satisfies ApiResponse);
    return;
  }

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.serverImage.updateMany({ where: { id, guildId }, data: { sortOrder: index } }),
    ),
  );

  res.json({ success: true } satisfies ApiResponse);
});
