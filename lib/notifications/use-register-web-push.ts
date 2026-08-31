import Constants from "expo-constants";
import { useEffect } from "react";
import { Platform } from "react-native";

import { registerWebPushSubscription } from "@/lib/data/push-tokens";
import { ensureServiceWorkerRegistration } from "@/lib/pwa/registerServiceWorker";

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function getVapidPublicKey(): string | undefined {
  // process.env.EXPO_PUBLIC_* jest inlineowane przez Metro w buildzie
  // webowym i bywa pewniejsze niż Constants.expoConfig (który na webie
  // potrafi zgubić `extra`, gdy app.config.ts liczy je dynamicznie).
  const fromEnv = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
  const fromExtra = Constants.expoConfig?.extra?.vapidPublicKey as string | undefined;
  return fromEnv || fromExtra;
}

/**
 * iOS: `PushManager` istnieje TYLKO gdy appka jest uruchomiona z ikonki
 * dodanej do ekranu głównego (standalone). W zwykłej karcie Safari tego
 * API po prostu nie ma — stąd osobna diagnoza dla użytkownika.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  const displayMode =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  return iosStandalone || displayMode;
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

/**
 * Czy istniejąca subskrypcja została wydana pod TEN klucz VAPID.
 * Gdy klucz się rozjedzie (np. wygenerowano nową parę), stara
 * subskrypcja nadal "istnieje", ale serwer dostaje 403 przy wysyłce —
 * a `getSubscription()` nigdy nie zwróci null, więc bez tej kontroli
 * nowa subskrypcja nie powstałaby nigdy.
 */
function matchesVapidKey(subscription: PushSubscription, vapidPublicKey: string): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current as ArrayBuffer);
  const b = urlBase64ToUint8Array(vapidPublicKey);
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

async function subscribeAndRegister(): Promise<void> {
  const vapidPublicKey = getVapidPublicKey();
  if (!vapidPublicKey) {
    throw new Error("Brak klucza VAPID w konfiguracji appki (extra.vapidPublicKey).");
  }

  // ensureServiceWorkerRegistration() sam rejestruje /sw.js i pilnuje
  // timeoutu — `navigator.serviceWorker.ready` samo z siebie NIC nie
  // rejestruje i potrafi wisieć w nieskończoność bez błędu.
  const registration = await ensureServiceWorkerRegistration();

  if (!registration.pushManager) {
    throw new Error(
      "Ta instalacja PWA nie ma PushManagera (znany błąd iOS). Usuń ikonę z ekranu " +
        "głównego, w Ustawieniach → Safari wyczyść dane tej strony i dodaj appkę ponownie.",
    );
  }

  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !matchesVapidKey(subscription, vapidPublicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });
  }

  await registerWebPushSubscription(
    subscription.toJSON() as {
      endpoint: string;
      keys?: { p256dh?: string; auth?: string };
    },
  );
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
 *
 * WAŻNE: przed requestPermission() nie może być ŻADNEGO `await`
 * (fetch, sprawdzenie sesji Supabase itp.) — każdy await gubi "user
 * gesture" i iOS odrzuci prośbę o zgodę.
 */
export async function requestWebPushPermission(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  if (Platform.OS === "web" && !isStandalone()) {
    return {
      ok: false,
      reason:
        "Na iPhonie powiadomienia działają dopiero, gdy appka jest dodana do ekranu " +
        "głównego: Udostępnij → Dodaj do ekranu głównego, a potem otwórz ją z tej ikonki " +
        "(nie z karty Safari).",
    };
  }

  if (!isWebPushSupported()) {
    return {
      ok: false,
      reason:
        "Ta przeglądarka nie obsługuje powiadomień push (na iPhonie wymagany jest iOS 16.4 " +
        "lub nowszy oraz uruchomienie appki z ikonki na ekranie głównym).",
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
          "Nie zgodziłeś się na powiadomienia (albo są zablokowane) — sprawdź Ustawienia → Powiadomienia na iPhonie dla tej appki.",
      };
    }
    await subscribeAndRegister();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[web-push] requestWebPushPermission failed:", err);
    return { ok: false, reason: message };
  }
}

/**
 * Odświeża subskrypcję W TLE, ale WYŁĄCZNIE gdy zgoda na powiadomienia
 * jest już `granted` — bez wołania `requestPermission()`, więc nie ma
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

    subscribeAndRegister().catch((err) => {
      if (cancelled) return;
      // Nie alertujemy użytkownika (przeszedł już przez przycisk
      // "Włącz powiadomienia"), ale MUSI to być widoczne w konsoli —
      // ciche `catch {}` sprawiało, że diagnoza była niemożliwa.
      console.warn("[web-push] odświeżenie subskrypcji w tle nie powiodło się:", err);
    });

    // Subskrypcja odnowiona przez samo iOS (pushsubscriptionchange w
    // sw.js) — dosyłamy nowy endpoint do Supabase.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "PUSH_SUBSCRIPTION_CHANGED") return;
      registerWebPushSubscription(event.data.subscription).catch((err) => {
        console.warn("[web-push] zapis odnowionej subskrypcji nie powiódł się:", err);
      });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [role]);
}

/**
 * Diagnostyka do wywołania z konsoli Safari (Mac → Rozwój → iPhone) albo
 * z ukrytego przycisku w Ustawieniach. Zwraca komplet informacji o tym,
 * na którym ogniwie łańcucha push się wykłada.
 */
export async function debugWebPush(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {
    platform: Platform.OS,
    standalone: isStandalone(),
    hasServiceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    hasPushManager: typeof window !== "undefined" && "PushManager" in window,
    permission: typeof Notification !== "undefined" ? Notification.permission : "brak API",
    vapidKeyLength: getVapidPublicKey()?.length ?? 0,
  };

  try {
    const registration = await ensureServiceWorkerRegistration();
    result.swScope = registration.scope;
    result.swHasPushManager = !!registration.pushManager;
    const subscription = await registration.pushManager?.getSubscription();
    result.endpoint = subscription?.endpoint ?? null;
    result.isAppleEndpoint = subscription?.endpoint?.includes("web.push.apple.com") ?? false;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}
