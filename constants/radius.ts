/**
 * Skala zaokrągleń interfejsu — trzy wartości zamiast kilkunastu.
 * Zmiana tu zmienia wygląd całej aplikacji (style `borderRadius: RADIUS.*`).
 * Odpowiednik dla klas Tailwind: `rounded-card` / `rounded-control` /
 * `rounded-chip` (tailwind.config.js, theme.extend.borderRadius) — te trzy
 * wartości muszą być tam takie same.
 *
 *  card    — karty, panele, okna dialogowe, wiersze list
 *  control — pola formularzy, przyciski, przełączniki
 *  chip    — znaczniki, małe etykiety, checkboxy
 *
 * Pełne koła (awatary, kropki statusu, przyciski +/−) zostają okrągłe
 * (borderRadius = połowa rozmiaru) i nie należą do skali.
 */
export const RADIUS = {
  card: 4,
  control: 3,
  chip: 2,
} as const;
