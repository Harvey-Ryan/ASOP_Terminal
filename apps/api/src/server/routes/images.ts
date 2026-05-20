import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import type { ApiResponse, ServerImageDto } from '@dem/shared';

export const imagesRouter = Router();

const UPLOADS_BASE = path.resolve('uploads');

function guildUploadDir(guildId: string): string {
  return path.join(UPLOADS_BASE, guildId);
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
    limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Only image files are allowed'));
    },
  });
}


// ── GET /api/guilds/:guildId/images ───────────────────────────────────────────

imagesRouter.get('/:guildId/images', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const images = await prisma.serverImage.findMany({
    where: { guildId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json({
    success: true,
    data: images.map(
      (img): ServerImageDto => ({
        id: img.id,
        guildId: img.guildId,
        filename: img.filename,
        url: img.url,
        createdAt: img.createdAt.toISOString(),
      }),
    ),
  } satisfies ApiResponse<ServerImageDto[]>);
});

// ── POST /api/guilds/:guildId/images ──────────────────────────────────────────

imagesRouter.post('/:guildId/images', requireAuth, (req, res, next) => {
  const { guildId } = req.params as { guildId: string };

  assertGuildManager(req, guildId).then((ok) => {
    if (!ok) {
      res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
      return;
    }

    const upload = uploadsFor(guildId);
    upload.single('image')(req, res, async (err) => {
      if (err) {
        // Only expose multer's own error messages; suppress OS/filesystem details
        const message = err instanceof multer.MulterError ? err.message : 'Upload failed';
        res.status(400).json({ success: false, error: message } satisfies ApiResponse);
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ success: false, error: 'No file uploaded' } satisfies ApiResponse);
        return;
      }

      const url = `/uploads/${guildId}/${file.filename}`;
      const image = await prisma.serverImage.create({
        data: { guildId, filename: file.filename, url },
      });

      res.status(201).json({
        success: true,
        data: {
          id: image.id,
          guildId: image.guildId,
          filename: image.filename,
          url: image.url,
          createdAt: image.createdAt.toISOString(),
        } satisfies ServerImageDto,
      } satisfies ApiResponse<ServerImageDto>);
    });
  }).catch(next);
});
