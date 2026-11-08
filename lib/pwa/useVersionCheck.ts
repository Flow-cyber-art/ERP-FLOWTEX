import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { BUILD_VERSION } from "@/constants/build-version";
import { clearServiceWorkerCache } from "@/lib/pwa/registerServiceWorker";

// Co ile dodatkowo sprawdzać wersję, gdy appka stoi otwarta bez przełączania.
const VERSION_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
 *   klient w pamięci.
 *
 * Sprawdzane: od razu przy montowaniu i za każdym razem, gdy apka wraca
 * na pierwszy plan (np. przełączenie karty/aplikacji z powrotem —
 * `AppState` → `"active"`). Dodatkowo co VERSION_CHECK_INTERVAL_MS (4 h),
 * tylko gdy karta jest widoczna — dla apki otwartej cały dzień bez
 * przełączania. Częściej nie ma sensu: wdrożenia są rzadkie.
 *
 * W ODRÓŻNIENIU OD POPRZEDNIEJ WERSJI: nie czyści cache'a i nie
 * przeładowuje strony automatycznie — tylko zgłasza, że jest nowa wersja
 * (`updateAvailable`), żeby UI mogło pokazać baner i zostawić decyzję
 * "kiedy" użytkownikowi (`applyUpdate`). Bezwarunkowy auto-reload w
 * trakcie wypełniania np. raportu dziennego (dane trzymane lokalnie,
 * jeszcze niewysłane) mógłby po cichu skasować niezapisaną pracę.
 *
 * Web-only — na natywnym iOS/Android aktualizacje idą przez App/Play
 * Store, więc hook jest tam no-opem.
 */
export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
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
          setUpdateAvailable(true);
        }
      } catch {
        // Brak sieci / błąd fetcha — po prostu spróbujemy przy
        // następnym sprawdzeniu, nie przerywamy pracy offline.
      } finally {
        checkingRef.current = false;
      }
    };

    checkVersion();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") checkVersion();
    });
    // Zapas dla karty/PWA otwartej cały dzień bez przełączania się (typowo
    // desktop): wdrożenia są rzadkie, więc wystarczy sprawdzenie co kilka
    // godzin, tylko gdy karta jest widoczna.
    const interval = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        checkVersion();
      }
    }, VERSION_CHECK_INTERVAL_MS);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    if (Platform.OS !== "web") return;
    await clearServiceWorkerCache();
    window.location.reload();
  }, []);

  return { updateAvailable, applyUpdate };
}
