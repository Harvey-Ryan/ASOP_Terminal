// Server AI keys at rest (v1.56.0). AES-256-GCM with a secret that lives only
// in the environment (AI_KEY_SECRET), never in the database, so a database
// copy or backup alone reveals no key. Each key is bound to its Discord server
// (the server id is the authenticated data), so a value copied onto another
// server's row won't decrypt. The bot has the same decrypt
// (apps/bot/src/utils/aiKeys.ts): keep the two in step.
//
// Keys never go back to the browser, into logs, error reports, the admin panel
// or data exports: only "key ending 4f2a" (AiAssistant.keyLast4).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const FORMAT = 'v1';

/** The 32-byte key from AI_KEY_SECRET, or null when it isn't set (keys can't be saved). */
function secretKey(): Buffer | null {
  const secret = process.env['AI_KEY_SECRET'];
  if (!secret || secret.length < 32) return null;
  return createHash('sha256').update(secret, 'utf8').digest();
}

export const aiKeysConfigured = (): boolean => secretKey() !== null;

const aad = (guildId: string) => Buffer.from(`asop-ai-key:${guildId}`, 'utf8');

export function encryptAiKey(plain: string, guildId: string): string {
  const key = secretKey();
  if (!key) throw new Error('AI_KEY_SECRET is not set (32+ characters), so AI keys cannot be stored.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(guildId));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${FORMAT}:${iv.toString('base64')}:${body.toString('base64')}`;
}

/** The key, or null when it can't be read (wrong secret, other server, damaged). */
export function decryptAiKey(stored: string, guildId: string): string | null {
  const key = secretKey();
  const [format, ivB64, bodyB64] = stored.split(':');
  if (!key || format !== FORMAT || !ivB64 || !bodyB64) return null;
  try {
    const body = Buffer.from(bodyB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAAD(aad(guildId));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
