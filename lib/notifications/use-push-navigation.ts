import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

/**
 * Przejście do raportu po KLIKNIĘCIU w powiadomienie push.
 *
 * Dlaczego to nie dzieje się samo: na iOS są dwa scenariusze.
 *
 *  A) Appka była ZAMKNIĘTA — service worker robi clients.openWindow(url),
 *     PWA startuje pod właściwym adresem i expo-router sam wchodzi na
 *     trasę. Tu nic nie trzeba robić.
 *
 *  B) Appka była W TLE — clients.focus() NIE zmienia adresu, appka wraca
 *     tam, gdzie była. Nawigację musi wykonać JS w środku, po wiadomości
 *     NAVIGATE_TO z service workera (patrz public/sw.js).
 *
 * Wpiąć RAZ, wysoko w drzewie — w app/_layout.tsx.
 */
export function usePushNavigation() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "NAVIGATE_TO") return;

      const url = event.data.url;
      // Tylko ścieżki względne — obrona przed nawigacją poza appkę,
      // gdyby payload przyszedł zniekształcony.
      if (typeof url !== "string" || !url.startsWith("/")) return;

      router.push(url as never);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [router]);
}
