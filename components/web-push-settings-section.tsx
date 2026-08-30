import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";

import { Button, COLORS, notify } from "@/components/report-ui";
import { requestWebPushPermission } from "@/lib/notifications/use-register-web-push";

// Przycisk "Włącz powiadomienia" (Web Push, Safari na iPhonie) — MUSI
// być osobnym przyciskiem klikanym ręcznie, nie automatyczną prośbą przy
// starcie appki. Powód: `Notification.requestPermission()` wywołane bez
// bezpośredniego gestu użytkownika na iOS Safari potrafi pokazać
// systemowe okienko, ale jego Promise nigdy się nie rozstrzyga po
// wybraniu "Zezwól" — patrz komentarz w
// lib/notifications/use-register-web-push.ts. Widoczne tylko na webie
// (natywny build ma Expo Push, rejestrowane automatycznie).
export function WebPushSettingsSection() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"unknown" | "granted" | "default" | "denied">("unknown");

  useEffect(() => {
    if (Platform.OS !== "web" || typeof Notification === "undefined") return;
    setStatus(Notification.permission);
  }, []);

  if (Platform.OS !== "web") return null;

  const enable = async () => {
    setBusy(true);
    try {
      const result = await requestWebPushPermission();
      if (result.ok) {
        setStatus("granted");
        notify("Powiadomienia włączone", "Będziesz dostawać powiadomienia o nowych raportach.");
      } else {
        notify("Nie udało się włączyć powiadomień", result.reason);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mt-4">
      <Text style={{ color: COLORS.muted, fontSize: 13, marginBottom: 4 }}>
        Powiadomienia push
      </Text>
      <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>
        Dostaniesz powiadomienie na tym urządzeniu, gdy brygadzista wyśle nowy raport dzienny.
        Na iPhonie musisz najpierw dodać tę stronę &quot;Do ekranu głównego&quot; (Safari →
        Udostępnij) i otwierać ją z tej ikonki — z poziomu zwykłej karty przeglądarki to nie
        zadziała.
      </Text>
      <View style={{ marginTop: 10 }}>
        {status === "granted" ? (
          <Text style={{ color: COLORS.success, fontSize: 12, fontWeight: "700" }}>
            ✓ Powiadomienia włączone na tym urządzeniu
          </Text>
        ) : status === "denied" ? (
          <Text style={{ color: COLORS.danger, fontSize: 12 }}>
            Zablokowane — włącz ręcznie w Ustawieniach systemowych → Powiadomienia dla tej appki.
          </Text>
        ) : (
          <Button
            label={busy ? "Włączanie…" : "Włącz powiadomienia"}
            secondary
            disabled={busy}
            onPress={enable}
          />
        )}
      </View>
    </View>
  );
}
