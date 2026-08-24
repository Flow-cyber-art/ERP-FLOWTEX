import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { BUILD_VERSION } from "@/constants/build-version";
import { clearServiceWorkerCache } from "@/lib/pwa/registerServiceWorker";

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
 * `AppState` → `"active"`). Bez osobnego interwału cyklicznego: apkę
 * odłożoną w tło (nie zamkniętą) sprawdzamy dokładnie w momencie, kiedy
 * ktoś do niej wraca, więc dobijanie co kilka minut w tle i tak nie
 * wykryje nic wcześniej niż to zdarzenie — tylko zużywa baterię/dane.
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

    return () => {
      subscription.remove();
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    if (Platform.OS !== "web") return;
    await clearServiceWorkerCache();
    window.location.reload();
  }, []);

  return { updateAvailable, applyUpdate };
}
