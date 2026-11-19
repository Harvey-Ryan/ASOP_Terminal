// Reading a server's AI key (v1.56.0): the decrypt half of the API's
// apps/api/src/lib/aiKeys.ts (AES-256-GCM with AI_KEY_SECRET, bound to the
// server id). Keep the two in step. The key is used for one request and never
// logged; error messages from callModel already mask it.

import { createDecipheriv, createHash } from 'node:crypto';

export function decryptAiKey(stored: string, guildId: string): string | null {
  const secret = process.env['AI_KEY_SECRET'];
  const [format, ivB64, bodyB64] = stored.split(':');
  if (!secret || secret.length < 32 || format !== 'v1' || !ivB64 || !bodyB64) return null;
  try {
    const key = createHash('sha256').update(secret, 'utf8').digest();
    const body = Buffer.from(bodyB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAAD(Buffer.from(`asop-ai-key:${guildId}`, 'utf8'));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
