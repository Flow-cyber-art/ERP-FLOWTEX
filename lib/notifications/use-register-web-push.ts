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

function isWebPushSupported(): boolean {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

function sameApplicationServerKey(
  subscription: PushSubscription,
  expectedRaw: Uint8Array,
): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const currentBytes = new Uint8Array(current);
  if (currentBytes.length !== expectedRaw.length) return false;
  return currentBytes.every((byte, i) => byte === expectedRaw[i]);
}

async function subscribeAndRegister(): Promise<void> {
  const vapidPublicKey = Constants.expoConfig?.extra?.vapidPublicKey as string | undefined;
  if (!vapidPublicKey) {
    throw new Error("Brak klucza VAPID w konfiguracji appki (extra.vapidPublicKey).");
  }
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // Subskrypcja z POPRZEDNIEJ pary kluczy VAPID (np. po regeneracji
  // klucza) jest martwa dla nowego klucza prywatnego po stronie serwera
  // — bez tego sprawdzenia appka uznałaby "mam subskrypcję" i nigdy nie
  // spróbowałaby utworzyć nowej, mimo że serwer i tak odrzuci wysyłkę.
  if (subscription && !sameApplicationServerKey(subscription, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as BufferSource,
    });
  }
  await registerWebPushSubscription(subscription.toJSON() as {
    endpoint: string;
    keys?: { p256dh?: string; auth?: string };
  });
}

/**
 * Wywoływane WYŁĄCZNIE z bezpośredniej reakcji na kliknięcie/tap
 * (przycisk "Włącz powiadomienia" w Ustawieniach, patrz
 * web-push-settings-section.tsx) — Safari na iOS ma udokumentowany
 * problem: `Notification.requestPermission()` wywołane automatycznie
 * (np. w useEffect przy starcie appki, bez bezpośredniego gestu
 * użytkownika) potrafi pokazać systemowe okienko zgody, ale Promise NIGDY
 * się nie rozstrzyga po wybraniu "Zezwól" — kod wisi w nieskończoność
 * bez żadnego błędu ani efektu. Stąd cała inicjatywa musi wychodzić z
 * onPress, nie z automatycznego hooka.
 */
export async function requestWebPushPermission(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  if (!isWebPushSupported()) {
    return {
      ok: false,
      reason:
        "Ta przeglądarka nie obsługuje powiadomień push, albo appka jest otwarta w zwykłej karcie Safari zamiast z ikonki dodanej do ekranu głównego (iOS wymaga iOS 16.4+ i uruchomienia z ekranu głównego).",
    };
  }
  try {
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") {
      return {
        ok: false,
        reason:
          "Nie zgodziłeś się na powiadomienia (albo są zablokowane) — sprawdź Ustawienia -> Powiadomienia na iPhonie dla tej appki.",
      };
    }
    await subscribeAndRegister();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Odświeża subskrypcję W TLE, ale WYŁĄCZNIE gdy zgoda na powiadomienia
 * jest już (`granted`) — bez wołania `requestPermission()`, więc nie ma
 * ryzyka zawieszonej obietnicy z powodu braku gestu użytkownika. Pokrywa
 * przypadek "zgoda była dawana wcześniej, ale subskrypcja wygasła/
 * zniknęła" (np. po odinstalowaniu i ponownym dodaniu PWA do ekranu
 * głównego) bez konieczności ponownego klikania przycisku.
 */
export function useRegisterWebPush(role: "Admin" | "Brygadzista" | "Pracownik") {
  useEffect(() => {
    if (role !== "Admin") return;
    if (!isWebPushSupported()) return;
    if (Notification.permission !== "granted") return;

    let cancelled = false;
    subscribeAndRegister().catch(() => {
      if (cancelled) return;
      // Cichy błąd w tle — użytkownik już raz przeszedł przez przycisk
      // "Włącz powiadomienia" i dostał tam ewentualny komunikat; nie
      // zasypujemy go alertem przy każdym otwarciu appki.
    });
    return () => {
      cancelled = true;
    };
  }, [role]);
}
