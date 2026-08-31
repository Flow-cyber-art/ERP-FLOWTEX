import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";

import { Button, COLORS, notify } from "@/components/report-ui";
import { requestWebPushPermission } from "@/lib/notifications/use-register-web-push";
import { useInstallPrompt } from "@/lib/pwa/use-install-prompt";

// Instrukcja "dodaj do ekranu głównego" ma sens WYŁĄCZNIE na iOS Safari —
// tam PushManager nie istnieje bez trybu standalone (patrz
// use-register-web-push.ts). Na Chrome/Edge desktop czy Androidzie ta
// sama treść jest po prostu nie na temat (myląca — patrz zgłoszenie
// "widzę to mimo że appka już jest dodana do ekranu", bo na Chrome
// dodanie do ekranu nie jest w ogóle wymagane do działania powiadomień).
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

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
  const { canInstall, installed, promptInstall } = useInstallPrompt();
  const [installBusy, setInstallBusy] = useState(false);

  const readPermission = () => {
    if (Platform.OS !== "web" || typeof Notification === "undefined") return;
    setStatus(Notification.permission);
  };

  useEffect(readPermission, []);

  if (Platform.OS !== "web") return null;

  const install = async () => {
    setInstallBusy(true);
    try {
      const accepted = await promptInstall();
      if (accepted) {
        notify(
          "Aplikacja zainstalowana",
          "Otwieraj ją teraz z ikonki na pulpicie/ekranie głównym — powiadomienia będą działać stabilniej.",
        );
      }
    } finally {
      setInstallBusy(false);
    }
  };

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
        {isIOS()
          ? " Na iPhonie musisz najpierw dodać tę stronę \"Do ekranu głównego\" (Safari → " +
            "Udostępnij) i otwierać ją z tej ikonki — z poziomu zwykłej karty przeglądarki to " +
            "nie zadziała."
          : ""}
      </Text>
      {canInstall && !installed && (
        <View
          style={{
            marginTop: 10,
            backgroundColor: COLORS.background,
            borderRadius: 10,
            padding: 12,
          }}
        >
          <Text style={{ color: COLORS.foreground, fontSize: 12, fontWeight: "600" }}>
            Zainstaluj aplikację na pulpicie/ekranie głównym
          </Text>
          <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 4 }}>
            Powiadomienia działają stabilniej z ikonki zainstalowanej appki niż z karty
            przeglądarki.
          </Text>
          <View style={{ marginTop: 8 }}>
            <Button
              label={installBusy ? "Instalowanie…" : "Zainstaluj aplikację"}
              secondary
              disabled={installBusy}
              onPress={install}
            />
          </View>
        </View>
      )}
      <View style={{ marginTop: 10 }}>
        {status === "granted" ? (
          <Text style={{ color: COLORS.success, fontSize: 12, fontWeight: "700" }}>
            ✓ Powiadomienia włączone na tym urządzeniu
          </Text>
        ) : status === "denied" ? (
          <View>
            <Text style={{ color: COLORS.danger, fontSize: 12 }}>
              {isIOS()
                ? "Zablokowane — włącz ręcznie w Ustawieniach systemowych → Powiadomienia dla tej appki."
                : "Zablokowane w przeglądarce dla tej strony. Kliknij ikonkę kłódki/ustawień " +
                  "przy adresie strony → Uprawnienia strony (Site settings) → Powiadomienia → " +
                  "Zezwalaj, potem wróć tutaj i sprawdź ponownie."}
            </Text>
            <View style={{ marginTop: 8 }}>
              <Button label="Sprawdź ponownie" secondary onPress={readPermission} />
            </View>
          </View>
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
