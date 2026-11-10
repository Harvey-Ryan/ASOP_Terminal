/** Tells the bot something happened (fire and forget). `body` is sent as JSON when given. */
export function triggerBot(path: string, body?: unknown): void {
  const botUrl = process.env['BOT_INTERNAL_URL'];
  if (!botUrl) return;
  const headers: Record<string, string> = {};
  const secret = process.env['BOT_INTERNAL_SECRET'];
  if (secret) headers['Authorization'] = `Bearer ${secret}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  fetch(`${botUrl}${path}`, { method: 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }).catch((err) => {
    console.warn(`[triggerBot] Failed to notify bot at ${path}:`, err);
  });
}
