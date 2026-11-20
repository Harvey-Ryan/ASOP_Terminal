# Uploaded images (v1.40.0)

- One folder per server under `UPLOADS_DIR` (`ServerImage` rows), served
  publicly at `/uploads/<guild>/<file>`. Everything about them is in
  `apps/api/src/lib/uploads.ts`:
  - `optimiseUpload` re-encodes every upload with sharp: turned upright, fit
    inside 2560 px, WebP (animations kept), metadata dropped. SVGs are turned
    into pictures, so nothing we serve can run script. Unreadable files are
    refused and nothing is kept.
  - Each server's cap is `UPLOADS_SERVER_CAP_MB` (default 200), measured from
    the files on disk (`guildUsage`); `GET /:guildId/images/usage` feeds the
    "X of Y used" bar (`components/ImageUsage.tsx`).
  - `storageReport()` (1-minute cache, cleared by uploads and deletes) is
    Admin → Overview → Image storage (`GET /api/admin/storage`).
- Images uploaded before v1.40.0 were stored as sent and aren't converted.
