import Constants from "expo-constants";
import { useEffect } from "react";
import { Platform } from "react-native";

import { notify } from "@/components/report-ui";
import { registerWebPushSubscription } from "@/lib/data/push-tokens";

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Na iPhonie nie ma jak podejrzeć konsolę Safari bez Maca (Web
// Inspector wymaga kabla + macOS) — dopóki to nie zadziała za pierwszym
// razem, pokazujemy wynik jako zwykły window.alert (notify), widoczny
// gołym okiem na telefonie. Po PIERWSZYM sukcesie przestajemy pokazywać
// cokolwiek (localStorage), żeby nie straszyć alertem przy każdym
// otwarciu appki na stałe.
const SUCCESS_FLAG_KEY = "web-push-registered-ok";

function alreadyConfirmedOk(): boolean {
  try {
    return localStorage.getItem(SUCCESS_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function markConfirmedOk() {
  try {
    localStorage.setItem(SUCCESS_FLAG_KEY, "1");
  } catch {
    // Prywatna karta / zablokowany localStorage — nie krytyczne, po
    // prostu zobaczy alert sukcesu ponownie przy następnym otwarciu.
  }
}

/**
 * Web Push (Safari iOS 16.4+, patrz 068_web_push_ios_safari.sql) dla
 * powiadomień o nowym raporcie — odpowiednik useRegisterPushToken, ale
 * dla web (native ma Expo Push, patrz use-register-push-token.ts).
 *
 * WARUNKI, żeby to w ogóle zadziałało na iPhonie: strona musi być
 * dodana "Do ekranu głównego" (Safari -> Udostępnij) i otwierana z tej
 * ikonki, nie z zakładki przeglądarki — Safari nie daje web push
 * zwykłym kartom, tylko zainstalowanym PWA.
 */
export function useRegisterWebPush(role: "Admin" | "Brygadzista" | "Pracownik") {
  useEffect(() => {
    if (role !== "Admin") return;
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined" || typeof navigator === "undefined") return;

    const alreadyOk = alreadyConfirmedOk();

    const isStandalone =
      // @ts-expect-error -- pole specyficzne dla Safari na iOS, brak w typach DOM
      window.navigator.standalone === true ||
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches);

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      if (!alreadyOk) {
        notify(
          "Powiadomienia: brak wsparcia",
          isStandalone
            ? "Ta przeglądarka/wersja iOS nie obsługuje Web Push (potrzeba iOS 16.4+)."
            : "Otwórz appkę z IKONKI na ekranie głównym (nie z zakładki Safari) — dopiero wtedy da się włączyć powiadomienia.",
        );
      }
      return;
    }
    if (typeof Notification === "undefined") return;

    const vapidPublicKey = Constants.expoConfig?.extra?.vapidPublicKey as string | undefined;
    if (!vapidPublicKey) {
      if (!alreadyOk) {
        notify(
          "Powiadomienia: błąd konfiguracji",
          "Brak klucza VAPID w konfiguracji appki — zgłoś to (brakuje vapidPublicKey w build).",
        );
      }
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        let permission = Notification.permission;
        if (permission === "default") {
          permission = await Notification.requestPermission();
        }
        if (permission !== "granted") {
          if (!alreadyOk) {
            notify(
              "Powiadomienia wyłączone",
              "Nie zgodziłeś się na powiadomienia (albo zostały wcześniej zablokowane) — sprawdź Ustawienia -> Powiadomienia -> [nazwa appki] na iPhonie.",
            );
          }
          return;
        }
        if (cancelled) return;

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
        if (!alreadyOk) {
          markConfirmedOk();
          notify("Powiadomienia włączone", "Subskrypcja push zarejestrowana poprawnie.");
        }
      } catch (err) {
        if (!alreadyOk) {
          const message = err instanceof Error ? err.message : String(err);
          notify("Powiadomienia: błąd rejestracji", message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role]);
}
