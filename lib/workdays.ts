// Dni robocze (bez weekendów i polskich świąt ustawowych) — liczenie
// planowanego zakończenia budowy z daty startu i liczby dni roboczych.

// Daty liczone w UTC (YYYY-MM-DD ↔ Date.UTC) — wcześniej lokalna północ +
// toISOString() w strefie PL cofała wynik o dzień (z testów: start w
// niedzielę 22.11, 3 dni → "23.11").
const parseISODateUTC = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
};
const toISODateUTC = (d: Date) => d.toISOString().slice(0, 10);

// Polskie dni ustawowo wolne (stałe + ruchome od Wielkanocy).
const polishHolidaysCache = new Map<number, Set<string>>();
const polishHolidays = (year: number): Set<string> => {
  const cached = polishHolidaysCache.get(year);
  if (cached) return cached;
  // Wielkanoc — algorytm Meeusa/Jonesa/Butchera (kalendarz gregoriański).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = Date.UTC(year, month - 1, day);
  const plus = (n: number) => toISODateUTC(new Date(easter + n * 86400000));
  const fixed = ["01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-25", "12-26"];
  // Wigilia wolna od 2025 r.
  if (year >= 2025) fixed.push("12-24");
  const set = new Set<string>([
    ...fixed.map((md) => `${year}-${md}`),
    plus(1), // Poniedziałek Wielkanocny
    plus(60), // Boże Ciało
  ]);
  polishHolidaysCache.set(year, set);
  return set;
};

export const isWorkdayUTC = (d: Date) => {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !polishHolidays(d.getUTCFullYear()).has(toISODateUTC(d));
};

// Pierwszy dzień roboczy w dniu startu albo po nim (start w sobotę /
// niedzielę / święto → praca rusza w najbliższy dzień roboczy).
export const firstWorkdayISO = (dateStr: string) => {
  const d = parseISODateUTC(dateStr);
  if (!d) return "";
  while (!isWorkdayUTC(d)) d.setUTCDate(d.getUTCDate() + 1);
  return toISODateUTC(d);
};

// Planowane zakończenie budowy: `days` DNI ROBOCZYCH licząc od pierwszego
// dnia roboczego w dniu startu lub po nim (dzień startu = dzień 1),
// z pominięciem weekendów i świąt.
export const addWorkdaysISO = (dateStr: string, days: number) => {
  if (!Number.isFinite(days)) return "";
  const start = firstWorkdayISO(dateStr);
  if (!start) return "";
  const d = parseISODateUTC(start)!;
  let remaining = Math.max(1, Math.round(days)) - 1;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkdayUTC(d)) remaining -= 1;
  }
  return toISODateUTC(d);
};
