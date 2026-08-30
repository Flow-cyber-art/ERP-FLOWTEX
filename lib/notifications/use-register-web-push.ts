import Constants from "expo-constants";
import { useEffect } from "react";
import { Platform } from "react-native";

import { registerWebPushSubscription } from "@/lib/data/push-tokens";

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Web Push (Safari iOS 16.4+, patrz 068_web_push_ios_safari.sql) dla
 * powiadomień o nowym raporcie — odpowiednik useRegisterPushToken, ale
 * dla web (native ma Expo Push, patrz use-register-push-token.ts).
 *
 * WARUNKI, żeby to w ogóle zadziałało na iPhonie: strona musi być
 * dodana "Do ekranu głównego" (Safari -> Udostępnij) i otwierana z tej
 * ikonki, nie z zakładki przeglądarki — Safari nie daje web push
 * zwykłym kartom, tylko zainstalowanym PWA. Bez tego
 * `Notification.requestPermission()` może się nawet udać, ale
 * subskrypcja i tak nie przyjdzie/nie zadziała.
 */
export function useRegisterWebPush(role: "Admin" | "Brygadzista" | "Pracownik") {
  useEffect(() => {
    if (role !== "Admin") return;
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // eslint-disable-next-line no-console
      console.warn("[web-push] przeglądarka nie wspiera Push API (albo to zwykła karta Safari, nie PWA dodane do ekranu głównego).");
      return;
    }
    if (typeof Notification === "undefined") return;

    const vapidPublicKey = Constants.expoConfig?.extra?.vapidPublicKey as string | undefined;
    if (!vapidPublicKey) {
      // eslint-disable-next-line no-console
      console.warn("[web-push] brak vapidPublicKey w Constants.expoConfig.extra — build appki nie ma najnowszej konfiguracji.");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        let permission = Notification.permission;
        if (permission === "default") {
          permission = await Notification.requestPermission();
        }
        if (permission !== "granted" || cancelled) return;

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
          });
        }
        if (cancelled) return;

        await registerWebPushSubscription(subscription.toJSON() as {
          endpoint: string;
          keys?: { p256dh?: string; auth?: string };
        });
        // eslint-disable-next-line no-console
        console.info("[web-push] subskrypcja zarejestrowana.");
      } catch (err) {
        // Brak uprawnień, przeglądarka niewspierana, strona nie jest
        // zainstalowana jako PWA na iOS itd. — powiadomienia są
        // usprawnieniem, nigdy nie mogą wywrócić reszty apki. Logujemy
        // do konsoli (nie do UI), żeby dało się to zdiagnozować zdalnie
        // (Safari -> Ustawienia -> Zaawansowane -> Web Inspector, albo
        // podłączenie do Maca) bez przebudowywania appki za każdym razem.
        // eslint-disable-next-line no-console
        console.warn("[web-push] rejestracja nie powiodła się:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role]);
}
