import { Platform } from "react-native";

/**
 * Rejestruje service workera (public/sw.js → serwowany pod /sw.js) na
 * platformie web. Na natywnym iOS/Androidzie nie ma service workerów,
 * więc funkcja jest tam no-opem — bezpiecznie wołać ją zawsze, bez
 * osobnego sprawdzania platformy w miejscu wywołania.
 */
export function registerServiceWorker() {
  if (Platform.OS !== "web") return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("[sw] rejestracja nie powiodła się:", err));
  });
}

/**
 * Wysyła do aktywnego service workera komunikat każący mu wyczyścić
 * cache statycznych assetów i CZEKA na potwierdzenie, że cache faktycznie
 * został wyczyszczony (przez MessageChannel, patrz public/sw.js), zanim
 * wywołujący zrobi window.location.reload().
 *
 * Wcześniej funkcja tylko wysyłała komunikat i wracała natychmiast, a
 * czyszczenie cache'a w SW działo się asynchronicznie w tle (wewnątrz
 * event.waitUntil) — reload wygrywał ten wyścig i strona ładowała się
 * z mieszanki starych (jeszcze niewyczyszczonych) i nowych assetów, co
 * potrafiło zgubić część skompilowanych klas Tailwind (np. ograniczenie
 * szerokości layoutu na desktopie). Timeout 2s to zabezpieczenie na
 * wypadek, gdyby SW nie odpowiedział (np. brak aktywnego workera).
 */
export async function clearServiceWorkerCache() {
  if (Platform.OS !== "web") return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const active = registration?.active;
  if (!active) return;

  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(resolve, 2000);
    channel.port1.onmessage = () => {
      clearTimeout(timeout);
      resolve();
    };
    active.postMessage({ type: "CLEAR_CACHE" }, [channel.port2]);
  });
}
