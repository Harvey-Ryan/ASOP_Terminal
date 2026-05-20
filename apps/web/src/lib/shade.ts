// primary: hsl 43 81% 40% (#b98a13), accent: hsl 43 81% 33% (hover), ring mirrors primary
// slider 0 = full bright, 100 = darkest (-25 lightness points)
export function applyShade(val: number) {
  const primaryL = 40 - (val / 100) * 25;
  const accentL  = 33 - (val / 100) * 20;
  document.documentElement.style.setProperty('--primary', `43 81% ${primaryL}%`);
  document.documentElement.style.setProperty('--accent',  `43 81% ${accentL}%`);
  document.documentElement.style.setProperty('--ring',    `43 81% ${primaryL}%`);
}

export function loadShade(userId: string): number {
  try { return Number(localStorage.getItem(`shade:${userId}`) ?? '0'); } catch { return 0; }
}

export function saveShade(userId: string, val: number) {
  try { localStorage.setItem(`shade:${userId}`, String(val)); } catch {}
}
