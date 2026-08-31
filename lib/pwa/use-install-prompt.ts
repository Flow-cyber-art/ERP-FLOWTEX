import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { isStandalone } from "@/lib/notifications/use-register-web-push";

/**
 * Monit "Zainstaluj aplikację" (Chrome/Edge desktop, Android) — łapie
 * zdarzenie `beforeinstallprompt`, które przeglądarka wysyła TYLKO gdy
 * appka spełnia kryteria instalowalności (manifest.json + zarejestrowany
 * service worker, patrz app/+html.tsx i lib/pwa/registerServiceWorker.ts)
 * i jeszcze nie jest zainstalowana. iOS Safari NIGDY nie wysyła tego
 * zdarzenia (Apple go nie wspiera) — tam instalacja to ręczne
 * "Udostępnij → Dodaj do ekranu głównego", opisane osobno w
 * web-push-settings-section.tsx.
 *
 * Domyślna zachowanie przeglądarki (mini-infobar / ikonka w pasku
 * adresu) zostaje ZABLOKOWANE (`preventDefault()`), żeby zamiast tego
 * pokazać własny przycisk w sekcji Powiadomień push — spójne miejsce z
 * resztą instrukcji "jak włączyć powiadomienia", zamiast osobnego,
 * niepowiązanego z niczym monitu przeglądarki.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function useInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    setInstalled(isStandalone());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredEvent(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const promptInstall = async (): Promise<boolean> => {
    if (!deferredEvent) return false;
    await deferredEvent.prompt();
    const { outcome } = await deferredEvent.userChoice;
    setDeferredEvent(null);
    return outcome === "accepted";
  };

  return {
    // Przycisk ma sens pokazać tylko gdy przeglądarka faktycznie
    // wystrzeliła beforeinstallprompt (obsługiwana przeglądarka, appka
    // jeszcze nie zainstalowana) i appka nie działa już jako standalone.
    canInstall: !!deferredEvent && !installed,
    installed,
    promptInstall,
  };
}
