export function loadDisplayName(userId: string): string {
  try { return localStorage.getItem(`displayName:${userId}`) ?? ''; } catch { return ''; }
}

export function saveDisplayName(userId: string, name: string) {
  try {
    if (name) {
      localStorage.setItem(`displayName:${userId}`, name);
    } else {
      localStorage.removeItem(`displayName:${userId}`);
    }
  } catch {}
}
