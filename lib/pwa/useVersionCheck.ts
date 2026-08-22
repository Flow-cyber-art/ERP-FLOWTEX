import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { BUILD_VERSION } from "@/constants/build-version";
import { clearServiceWorkerCache } from "@/lib/pwa/registerServiceWorker";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // co 5 minut

/**
 * Wykrywanie nowej wersji appki wdrożonej na serwerze.
 *
 * Mechanizm:
 * - `constants/build-version.ts` zawiera BUILD_VERSION "wypieczoną" w
 *   JS-ie bieżącego builda (patrz scripts/generate-build-version.mjs).
 * - `/version.json` to statyczny plik z tą samą wartością, ale
 *   odpytywany na żywo z serwera (zawsze `cache: "no-store"`, nigdy nie
 *   trafia do cache'a service workera — patrz public/sw.js).
 * - Jeśli różnią się → na serwerze jest nowszy build niż ten, który ma
 *   klient w pamięci. Czyścimy cache statycznych assetów service workera
 *   i przeładowujemy stronę, żeby ściągnąć nową wersję.
 *
 * Sprawdzane: co CHECK_INTERVAL_MS oraz przy każdym powrocie apki na
 * pierwszy plan (np. przełączenie karty/aplikacji z powrotem).
 *
 * Web-only — na natywnym iOS/Android aktualizacje idą przez App/Play
 * Store, więc hook jest tam no-opem.
 */
export function useVersionCheck() {
  const checkingRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const checkVersion = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data: { version?: string } = await response.json();
        if (data.version && data.version !== BUILD_VERSION) {
          console.info(
            `[version-check] nowy build na serwerze (${data.version} ≠ ${BUILD_VERSION}) — aktualizuję…`,
          );
          await clearServiceWorkerCache();
          window.location.reload();
        }
      } catch {
        // Brak sieci / błąd fetcha — po prostu spróbujemy przy
        // następnym sprawdzeniu, nie przerywamy pracy offline.
      } finally {
        checkingRef.current = false;
      }
    };

    checkVersion();
    const intervalId = setInterval(checkVersion, CHECK_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") checkVersion();
    });

    return () => {
      clearInterval(intervalId);
      subscription.remove();
    };
  }, []);
}
