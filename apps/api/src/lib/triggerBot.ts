export function triggerBot(path: string): void {
  const botUrl = process.env['BOT_INTERNAL_URL'];
  if (!botUrl) return;
  const headers: Record<string, string> = {};
  const secret = process.env['BOT_INTERNAL_SECRET'];
  if (secret) headers['Authorization'] = `Bearer ${secret}`;
  fetch(`${botUrl}${path}`, { method: 'POST', headers }).catch(() => null);
}
