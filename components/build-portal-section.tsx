import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Image, Linking, Modal, Platform, Pressable, Text, View } from "react-native";

import { Button, COLORS, Field, confirmAction, notify } from "@/components/report-ui";
import {
  getPublicPortalSettings,
  regeneratePublicToken,
  setAllowClientAiSummary,
  setPublicAccessEnabled,
  setPublicPortalPin,
  setShowContractValueToClient,
  setShowNotesToClient,
  setShowPhotosToClient,
  type PublicPortalSettings,
} from "@/lib/data/public-portal";

// Domyślnie strona portalu jest serwowana z tego samego originu co apka
// (patrz vercel.json + app/portal/[token].tsx) — brak osobnej domeny do
// skonfigurowania na start.
function portalOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return "https://flowtex.app"; // placeholder poza webem (podgląd/QR i tak generowany na webie)
}

export function BuildPortalSection({ buildId }: { buildId: number }) {
  const [settings, setSettings] = useState<PublicPortalSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pinEditing, setPinEditing] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [qrFullscreen, setQrFullscreen] = useState(false);
  const [savingAllowAiSummary, setSavingAllowAiSummary] = useState(false);

  const refresh = () => {
    getPublicPortalSettings(buildId)
      .then(setSettings)
      .catch(() => notify("Błąd", "Nie udało się wczytać ustawień portalu klienta."));
  };

  useEffect(refresh, [buildId]);

  useEffect(() => {
    if (!settings?.publicAccessEnabled) {
      setQrDataUrl(null);
      return;
    }
    const url = `${portalOrigin()}/portal/${settings.publicToken}`;
    QRCode.toDataURL(url, { width: 220, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [settings?.publicAccessEnabled, settings?.publicToken]);

  // Tylko pierwsze ładowanie zwraca ten wąski placeholder zamiast całej
  // sekcji — `refresh()` po każdym przełączniku (dostęp/PIN/zdjęcia/
  // notatki/kontrakt) też ustawia `loading`, ale wtedy `settings` już
  // istnieje z poprzedniego wczytania, więc karta zostaje na miejscu
  // zamiast znikać i wracać (co przesuwało scroll całej strony na górę).
  if (!settings) {
    return <Text style={{ color: COLORS.muted, fontSize: 12 }}>Wczytywanie…</Text>;
  }

  const portalUrl = `${portalOrigin()}/portal/${settings.publicToken}`;

  const toggleAccess = async () => {
    setBusy(true);
    try {
      await setPublicAccessEnabled(buildId, !settings.publicAccessEnabled);
      refresh();
    } catch {
      notify("Błąd", "Nie udało się zmienić udostępniania.");
    } finally {
      setBusy(false);
    }
  };

  const toggleContractValue = async () => {
    setBusy(true);
    try {
      await setShowContractValueToClient(buildId, !settings.showContractValueToClient);
      refresh();
    } catch {
      notify("Błąd", "Nie udało się zmienić widoczności wartości kontraktu.");
    } finally {
      setBusy(false);
    }
  };

  const togglePhotos = async () => {
    setBusy(true);
    try {
      await setShowPhotosToClient(buildId, !settings.showPhotosToClient);
      refresh();
    } catch {
      notify("Błąd", "Nie udało się zmienić udostępniania zdjęć.");
    } finally {
      setBusy(false);
    }
  };

  const toggleNotes = async () => {
    setBusy(true);
    try {
      await setShowNotesToClient(buildId, !settings.showNotesToClient);
      refresh();
    } catch {
      notify("Błąd", "Nie udało się zmienić udostępniania notatek.");
    } finally {
      setBusy(false);
    }
  };

  const savePin = async () => {
    setBusy(true);
    try {
      await setPublicPortalPin(buildId, pinInput.trim() || null);
      setPinEditing(false);
      setPinInput("");
      refresh();
      notify("Zapisano", pinInput.trim() ? "PIN portalu ustawiony." : "PIN portalu usunięty.");
    } catch {
      notify("Błąd", "Nie udało się zapisać PIN-u.");
    } finally {
      setBusy(false);
    }
  };

  const toggleAllowClientAiSummary = async () => {
    setSavingAllowAiSummary(true);
    try {
      await setAllowClientAiSummary(buildId, !settings.allowClientAiSummary);
      refresh();
    } catch {
      notify("Błąd", "Nie udało się zmienić ustawienia raportu AI.");
    } finally {
      setSavingAllowAiSummary(false);
    }
  };

  const regenerate = () => {
    confirmAction(
      "Unieważnić dotychczasowy link?",
      "Stary link/kod QR przestanie działać. Trzeba będzie wygenerować i przekazać klientowi nowy.",
      "Unieważnij i wygeneruj nowy",
      async () => {
        setBusy(true);
        try {
          await regeneratePublicToken(buildId);
          refresh();
          notify("Gotowe", "Wygenerowano nowy link portalu.");
        } catch {
          notify("Błąd", "Nie udało się wygenerować nowego linku.");
        } finally {
          setBusy(false);
        }
      },
    );
  };

  const openLink = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(portalUrl, "_blank", "noopener,noreferrer");
    } else {
      Linking.openURL(portalUrl);
    }
  };

  const copyLink = async () => {
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(portalUrl);
        notify("Skopiowano", "Link do portalu klienta w schowku.");
      } else {
        notify("Link do portalu", portalUrl);
      }
    } catch {
      notify("Link do portalu", portalUrl);
    }
  };

  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>Udostępnij postęp klientowi</Text>
        <Button
          label={settings.publicAccessEnabled ? "Włączony" : "Wyłączony"}
          secondary={!settings.publicAccessEnabled}
          disabled={busy}
          onPress={toggleAccess}
        />
      </View>

      {settings.publicAccessEnabled && (
        <View style={{ marginTop: 14 }}>
          {qrDataUrl && (
            <Pressable
              onPress={() => setQrFullscreen(true)}
              style={{ alignItems: "center", marginBottom: 12 }}
            >
              <Image source={{ uri: qrDataUrl }} style={{ width: 180, height: 180, borderRadius: 8 }} />
              <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 6 }}>
                Dotknij, żeby powiększyć
              </Text>
            </Pressable>
          )}

          <Modal
            visible={qrFullscreen}
            transparent
            animationType="fade"
            onRequestClose={() => setQrFullscreen(false)}
          >
            <Pressable
              onPress={() => setQrFullscreen(false)}
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.9)",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
              }}
            >
              <Pressable
                onPress={() => setQrFullscreen(false)}
                hitSlop={16}
                style={{
                  position: "absolute",
                  top: 48,
                  right: 24,
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: "rgba(255,255,255,0.15)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>✕</Text>
              </Pressable>
              {qrDataUrl && (
                <Image
                  source={{ uri: qrDataUrl }}
                  style={{ width: 280, height: 280, borderRadius: 12 }}
                />
              )}
              <Text
                selectable
                style={{ color: "#fff", fontSize: 13, textAlign: "center", marginTop: 20 }}
              >
                {portalUrl}
              </Text>
            </Pressable>
          </Modal>
          <Pressable onPress={openLink}>
            <Text
              selectable
              style={{
                color: COLORS.primary ?? "#3B82F6",
                fontSize: 12,
                textAlign: "center",
                textDecorationLine: "underline",
              }}
            >
              {portalUrl}
            </Text>
          </Pressable>
          <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button label="Otwórz portal" onPress={openLink} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Kopiuj link" secondary onPress={copyLink} />
            </View>
          </View>

          <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: COLORS.foreground, fontWeight: "600" }}>
                Zabezpiecz PIN-em {settings.hasPin ? "(ustawiony)" : "(brak)"}
              </Text>
              <Button
                label={pinEditing ? "Anuluj" : settings.hasPin ? "Zmień" : "Ustaw"}
                secondary
                onPress={() => {
                  setPinInput("");
                  setPinEditing((v) => !v);
                }}
              />
            </View>
            {pinEditing && (
              <View style={{ marginTop: 10 }}>
                <Field
                  placeholder="4-6 cyfr (puste = wyłącz PIN)"
                  value={pinInput}
                  onChangeText={setPinInput}
                  keyboardType="number-pad"
                />
                <View style={{ marginTop: 8 }}>
                  <Button label={busy ? "Zapisywanie…" : "Zapisz"} disabled={busy} onPress={savePin} />
                </View>
              </View>
            )}
          </View>

          <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: COLORS.foreground, fontWeight: "600", flex: 1, marginRight: 8 }}>
                Pokaż wartość kontraktu klientowi
              </Text>
              <Button
                label={settings.showContractValueToClient ? "Tak" : "Nie"}
                secondary={!settings.showContractValueToClient}
                disabled={busy}
                onPress={toggleContractValue}
              />
            </View>
          </View>

          <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: COLORS.foreground, fontWeight: "600", flex: 1, marginRight: 8 }}>
                Udostępnij zdjęcia klientowi
              </Text>
              <Button
                label={settings.showPhotosToClient ? "Tak" : "Nie"}
                secondary={!settings.showPhotosToClient}
                disabled={busy}
                onPress={togglePhotos}
              />
            </View>
          </View>

          <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: COLORS.foreground, fontWeight: "600", flex: 1, marginRight: 8 }}>
                Udostępnij notatki klientowi
              </Text>
              <Button
                label={settings.showNotesToClient ? "Tak" : "Nie"}
                secondary={!settings.showNotesToClient}
                disabled={busy}
                onPress={toggleNotes}
              />
            </View>
            <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 6 }}>
              Włączone: przy każdym zatwierdzeniu raportu AI automatycznie generuje neutralną
              notatkę dla klienta (bez kwot i danych pracowników) z notatki brygadzisty — klient
              widzi tylko notatkę z ostatniego dnia. Wyłączone: AI nic nie generuje, klient nie
              widzi żadnych notatek dziennych.
            </Text>
          </View>

          <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: COLORS.foreground, fontWeight: "600", flex: 1, marginRight: 8 }}>
                Klient może wygenerować raport AI
              </Text>
              <Button
                label={settings.allowClientAiSummary ? "Tak" : "Nie"}
                secondary={!settings.allowClientAiSummary}
                disabled={savingAllowAiSummary}
                onPress={toggleAllowClientAiSummary}
              />
            </View>
            <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 6 }}>
              Włączone: w portalu klienta, pod „Ostatnimi aktualizacjami”, pojawia się przycisk
              „Wygeneruj raport z budowy AI” — klient sam, na życzenie, generuje skonsolidowane,
              neutralne podsumowanie postępu całej budowy (bez kwot i danych pracowników) z
              wszystkich zatwierdzonych raportów. Wyłączone: przycisk nie jest widoczny.
            </Text>
            {settings.aiClientSummary && (
              <View
                style={{
                  marginTop: 10,
                  backgroundColor: COLORS.background,
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <Text style={{ color: COLORS.muted, fontSize: 11, fontWeight: "800" }} className="uppercase">
                  Ostatnio wygenerowany raport (podgląd)
                </Text>
                <Text style={{ color: COLORS.foreground, fontSize: 13, marginTop: 6 }}>
                  {settings.aiClientSummary}
                </Text>
                {settings.aiClientSummaryGeneratedAt && (
                  <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 8 }}>
                    Wygenerowano: {new Date(settings.aiClientSummaryGeneratedAt).toLocaleString("pl-PL")}
                  </Text>
                )}
              </View>
            )}
          </View>

          <View style={{ marginTop: 16 }}>
            <Button label="Unieważnij link i wygeneruj nowy" secondary disabled={busy} onPress={regenerate} />
          </View>
        </View>
      )}
    </View>
  );
}
