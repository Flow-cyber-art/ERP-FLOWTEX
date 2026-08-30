/**
 * Rejestracja service workera PWA (public/sw.js).
 *
 * DLACZEGO OSOBNY MODUŁ: `navigator.serviceWorker.ready` NIE rejestruje
 * niczego — czeka tylko na SW, który już jest aktywny i kontroluje tę
 * stronę. Jeśli rejestracja nigdy nie nastąpiła (albo SW ma za wąski
 * scope), `ready` wisi w NIESKOŃCZONOŚĆ i nie rzuca błędem. To najczęstsza
 * przyczyna "push nie działa i nic się nie dzieje" na iOS.
 */

const SW_URL = "/sw.js";
const SW_SCOPE = "/";
const READY_TIMEOUT_MS = 10_000;

export function isServiceWorkerSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator
  );
}

/**
 * Rejestruje /sw.js (jeśli trzeba) i czeka na aktywny rejestr — z twardym
 * timeoutem, żeby zamiast wiecznego zawieszenia dostać czytelny błąd.
 */
export async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!isServiceWorkerSupported()) {
    throw new Error("Ta przeglądarka nie obsługuje Service Workerów.");
  }

  const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (!existing) {
    // sw.js MUSI leżeć w root'cie domeny — SW z podkatalogu nie obejmie
    // scope "/" i push dla całej appki nie zadziała.
    await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  }

  const ready = navigator.serviceWorker.ready;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            "Service Worker nie aktywował się w 10 s. Sprawdź, czy /sw.js jest serwowany " +
              "z roota domeny i czy strona działa po HTTPS.",
          ),
        ),
      READY_TIMEOUT_MS,
    );
  });

  return Promise.race([ready, timeout]);
}

/**
 * Wołane raz przy starcie appki webowej (patrz app/_layout.tsx).
 * Fire-and-forget: brak SW nie może zablokować renderu appki.
 */
export function registerServiceWorker(): void {
  if (!isServiceWorkerSupported()) return;

  ensureServiceWorkerRegistration().catch((err) => {
    console.warn("[pwa] rejestracja service workera nie powiodła się:", err);
  });
}

/** Wymuszenie aktywacji nowego SW (patrz useVersionCheck.ts). */
export async function skipWaiting(): Promise<void> {
  if (!isServiceWorkerSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
}

/** Czyści cache statyczny i czeka na potwierdzenie z SW (patrz sw.js). */
export async function clearServiceWorkerCache(): Promise<void> {
  if (!isServiceWorkerSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  const target = registration?.active;
  if (!target) return;

  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(resolve, 3_000);
    channel.port1.onmessage = (event) => {
      if (event.data?.type === "CACHE_CLEARED") {
        clearTimeout(timer);
        resolve();
      }
    };
    target.postMessage({ type: "CLEAR_CACHE" }, [channel.port2]);
  });
}
