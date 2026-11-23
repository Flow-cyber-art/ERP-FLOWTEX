import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines class names using clsx and tailwind-merge.
 * This ensures Tailwind classes are properly merged without conflicts.
 *
 * Usage:
 * ```tsx
 * cn("px-4 py-2", isActive && "bg-primary", className)
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Data YYYY-MM-DD w STREFIE CZASOWEJ URZĄDZENIA (w Polsce: czas polski).
 * `toISOString().slice(0, 10)` liczy w UTC — raport zapisany między 00:00
 * a 01:00 (latem 02:00) dostawał wczorajszą datę, a data wybrana w
 * kalendarzu o północy przesuwała się o dzień wstecz (F9).
 */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
