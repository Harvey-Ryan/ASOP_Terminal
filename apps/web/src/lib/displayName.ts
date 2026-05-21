export function loadDisplayName(userId: string): string {
  try { return localStorage.getItem(`displayName:${userId}`) ?? ''; } catch { return ''; }
}

/** Returns the display name override for `userId` if they are the current user, otherwise `username`. */
export function resolveUsername(
  userId: string,
  username: string,
  currentUserId: string | null | undefined,
): string {
  if (!currentUserId || userId !== currentUserId) return username;
  return loadDisplayName(currentUserId) || username;
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
