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
 * cache statycznych assetów. Używane przez useVersionCheck, gdy wykryje
 * nowszy build na serwerze.
 */
export async function clearServiceWorkerCache() {
  if (Platform.OS !== "web") return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  registration?.active?.postMessage({ type: "CLEAR_CACHE" });
}
