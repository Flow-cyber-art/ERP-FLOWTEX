import { useEffect } from "react";
import { Platform } from "react-native";

import { registerPushToken } from "@/lib/data/push-tokens";

/**
 * Rejestruje token Expo Push dla Admina, żeby dostawał powiadomienia o
 * nowym raporcie dziennym (patrz supabase/functions/send-report-
 * notification, wołane z lib/offline-outbox.ts po każdym udanym
 * submitDailyReport). Tylko Admin — Brygadzista/Pracownik nie mają czego
 * dostawać (to oni wysyłają raporty, nie sprawdzają je).
 *
 * WYMAGA konfiguracji EAS (projekt Expo z `projectId`) do wydania
 * prawdziwego tokenu na urządzeniu natywnym — bez tego (np. lokalny
 * build bez `eas init`) rejestracja po cichu się nie uda i hook nic nie
 * robi (catch niżej). Na webie Expo Notifications nie wspiera push (poza
 * eksperymentalnym service-workerowym web push), więc tam też cicho
 * pomijamy — pokrywa to najważniejszy przypadek: Admin z aplikacją
 * zainstalowaną na telefonie (Android/iOS).
 */
export function useRegisterPushToken(role: "Admin" | "Brygadzista" | "Pracownik") {
  useEffect(() => {
    if (role !== "Admin") return;
    if (Platform.OS === "web") return;

    let cancelled = false;

    (async () => {
      try {
        const Notifications = await import("expo-notifications");
        const Device = await import("expo-device");

        if (!Device.isDevice) return; // symulator/emulator nie ma push

        const existing = await Notifications.getPermissionsAsync();
        let status = existing.status;
        if (status !== "granted") {
          const requested = await Notifications.requestPermissionsAsync();
          status = requested.status;
        }
        if (status !== "granted" || cancelled) return;

        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }

        const projectId = (await import("expo-constants")).default?.expoConfig?.extra?.eas
          ?.projectId;
        const tokenResponse = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        if (cancelled) return;

        await registerPushToken(tokenResponse.data, Platform.OS);
      } catch {
        // Brak konfiguracji EAS, brak uprawnień, urządzenie bez Google
        // Play Services itd. — powiadomienia są usprawnieniem, nigdy nie
        // mogą wywrócić reszty apki.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role]);
}
