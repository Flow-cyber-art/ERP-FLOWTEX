import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  Text,
  View,
} from "react-native";

import { Button, COLORS, Field, formatPLN } from "@/components/report-ui";
import {
  fetchPublicBuild,
  type PublicBuildView,
} from "@/lib/data/public-portal";

/**
 * Portal Klienta — publiczna, NIEAUTORYZOWANA strona podglądu postępu
 * budowy (skan kodu QR / link). Celowo bez importu z contexts/app-data.tsx
 * (tam żyją wewnętrzne query z pełnymi danymi) — cała whitelista pól jest
 * narzucona po stronie bazy przez RPC `get_public_build`
 * (supabase/sql/052_portal_klienta.sql), front tylko renderuje to, co
 * przyjdzie.
 */

const STATUS_COLOR: Record<NonNullable<PublicBuildView["statusColor"]>, string> = {
  green: COLORS.success,
  yellow: COLORS.warning,
  red: COLORS.danger,
};

const DISPLAY_STATUS_LABEL: Record<PublicBuildView["displayStatus"], string> = {
  nierozpoczeta: "Nierozpoczęta",
  aktywna: "W trakcie",
  zamknieta: "Zakończona",
};

const formatDatePL = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
};

function HeroGauge({ view }: { view: PublicBuildView }) {
  const color = view.statusColor ? STATUS_COLOR[view.statusColor] : COLORS.border;
  const subtitle =
    view.displayStatus === "nierozpoczeta"
      ? "Budowa jeszcze się nie rozpoczęła"
      : view.displayStatus === "zamknieta"
        ? "Budowa zakończona"
        : view.currentStageName
          ? `Trwa: ${view.currentStageName}`
          : "Postęp budowy";
  return (
    <View style={{ alignItems: "center", marginTop: 12, marginBottom: 8 }}>
      <View
        style={{
          alignSelf: "center",
          backgroundColor: COLORS.background,
          borderWidth: 1,
          borderColor: color,
          borderRadius: 999,
          paddingHorizontal: 12,
          paddingVertical: 4,
          marginBottom: 12,
        }}
      >
        <Text style={{ color, fontSize: 12, fontWeight: "700" }}>
          {DISPLAY_STATUS_LABEL[view.displayStatus]}
        </Text>
      </View>
      <View
        style={{
          width: 176,
          height: 176,
          borderRadius: 88,
          borderWidth: 10,
          borderColor: color,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: COLORS.surface,
        }}
      >
        <Text style={{ color: COLORS.foreground, fontSize: 40, fontWeight: "800" }}>
          {Math.round(view.progressPercent)}%
        </Text>
        <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>postępu</Text>
      </View>
      <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 16, marginTop: 14 }}>
        {subtitle}
      </Text>
    </View>
  );
}

function StagesTimeline({ stages }: { stages: PublicBuildView["stages"] }) {
  if (!stages.length) return null;
  return (
    <View style={{ marginTop: 8 }}>
      {stages.map((s, i) => (
        <View key={s.name + i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: s.completed ? COLORS.success : "transparent",
              borderWidth: s.completed ? 0 : 2,
              borderColor: COLORS.border,
              marginRight: 12,
            }}
          >
            {s.completed && <Text style={{ color: COLORS.background, fontSize: 12, fontWeight: "800" }}>✓</Text>}
          </View>
          <Text
            style={{
              color: s.completed ? COLORS.foreground : COLORS.muted,
              fontWeight: s.completed ? "700" : "500",
              flex: 1,
            }}
          >
            {s.name}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: COLORS.surface,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 16,
        padding: 16,
        marginBottom: 14,
      }}
    >
      {children}
    </View>
  );
}

export default function PublicBuildPortal() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<PublicBuildView | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const load = useCallback(
    async (pin?: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchPublicBuild(token, pin);
        setView(result);
      } catch {
        setError("Nie udało się wczytać danych budowy. Spróbuj ponownie później.");
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    load();
  }, [load]);

  const submitPin = async () => {
    if (!pinInput.trim()) return;
    setPinBusy(true);
    setPinError(null);
    try {
      const result = await fetchPublicBuild(token, pinInput.trim());
      if (result?.requiresPin) {
        setPinError("Nieprawidłowy PIN.");
      } else {
        setView(result);
      }
    } catch {
      setPinError("Nie udało się zweryfikować PIN-u.");
    } finally {
      setPinBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: COLORS.danger, textAlign: "center" }}>{error}</Text>
      </View>
    );
  }

  if (!view) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: COLORS.foreground, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
          Strona nie została znaleziona
        </Text>
        <Text style={{ color: COLORS.muted, marginTop: 8, textAlign: "center" }}>
          Link może być nieaktualny lub podgląd tej budowy nie jest już udostępniony.
        </Text>
      </View>
    );
  }

  if (view.requiresPin) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: COLORS.foreground, fontSize: 20, fontWeight: "800", textAlign: "center", marginBottom: 4 }}>
          {view.name}
        </Text>
        <Text style={{ color: COLORS.muted, marginBottom: 20 }}>{view.number}</Text>
        <View style={{ width: "100%", maxWidth: 320 }}>
          <Text style={{ color: COLORS.foreground, marginBottom: 8, textAlign: "center" }}>
            Wprowadź kod PIN, żeby zobaczyć postęp budowy
          </Text>
          <Field
            placeholder="PIN"
            value={pinInput}
            onChangeText={setPinInput}
            keyboardType="number-pad"
            secureTextEntry
          />
          {pinError && (
            <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 8, textAlign: "center" }}>{pinError}</Text>
          )}
          <View style={{ marginTop: 14 }}>
            <Button label={pinBusy ? "Sprawdzanie…" : "Zatwierdź"} onPress={submitPin} disabled={pinBusy} fullWidth />
          </View>
        </View>
      </View>
    );
  }

  const plannedEnd = formatDatePL(view.plannedEndDate);
  const lastUpdate = formatDatePL(view.lastUpdateDate);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: 18, paddingTop: 40 }}>
      <Text style={{ color: COLORS.foreground, fontSize: 22, fontWeight: "800" }}>{view.name}</Text>
      <Text style={{ color: COLORS.muted, marginTop: 2 }}>{view.number}</Text>
      {view.address && <Text style={{ color: COLORS.muted, marginTop: 6 }}>{view.address}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 10 }}>
        {view.areaM2 && (
          <Text style={{ color: COLORS.muted, fontSize: 13 }}>Metraż: {view.areaM2} m²</Text>
        )}
        {plannedEnd && (
          <Text style={{ color: COLORS.muted, fontSize: 13 }}>Planowane zakończenie: {plannedEnd}</Text>
        )}
      </View>

      <Card>
        <HeroGauge view={view} />
        <StagesTimeline stages={view.stages} />
      </Card>

      <Card>
        <Text style={{ color: COLORS.foreground, fontWeight: "700", marginBottom: 4 }}>Ostatnia aktualizacja</Text>
        <Text style={{ color: COLORS.muted }}>{lastUpdate ?? "Brak jeszcze raportów z tej budowy."}</Text>
      </Card>

      {view.photosUrl && (
        <Card>
          <Text style={{ color: COLORS.foreground, fontWeight: "700", marginBottom: 10 }}>Zdjęcia z postępu</Text>
          <Button label="Zobacz zdjęcia" onPress={() => Linking.openURL(view.photosUrl!)} fullWidth />
        </Card>
      )}

      {view.contractValue != null && (
        <Card>
          <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>Wartość kontraktu</Text>
          <Text style={{ color: COLORS.muted, marginTop: 4 }}>{formatPLN(Number(view.contractValue))}</Text>
        </Card>
      )}

      <Text style={{ color: COLORS.muted, fontSize: 11, textAlign: "center", marginTop: 8, marginBottom: 24 }}>
        Flowtex — podgląd postępu budowy
      </Text>
    </ScrollView>
  );
}
