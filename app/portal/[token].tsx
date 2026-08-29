import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

import { Button, Field, formatPLN } from "@/components/report-ui";
import {
  fetchPublicBuild,
  type PublicBuildView,
} from "@/lib/data/public-portal";

/**
 * Portal Klienta — publiczna, NIEAUTORYZOWANA strona podglądu postępu
 * budowy (skan kodu QR / link). Celowo bez importu z contexts/app-data.tsx
 * (tam żyją wewnętrzne query z pełnymi danymi) — cała whitelista pól jest
 * narzucona po stronie bazy przez RPC `get_public_build`
 * (supabase/sql/059_portal_klienta_zdjecia_i_notatki.sql), front tylko
 * renderuje to, co przyjdzie.
 *
 * Paleta i układ celowo NIE dzielone z resztą apki (report-ui.tsx) — to
 * osobna, publiczna wizytówka dla klienta, z własną, ciemną identyfikacją
 * (na wzór dostarczonego mockupu), niezależna od wewnętrznego motywu
 * panelu administratora/brygadzisty.
 */

const PC = {
  bg: "#0C0D0F",
  bg2: "#111316",
  surface: "#16191D",
  surface2: "#1C2026",
  line: "rgba(255,255,255,0.07)",
  lineStrong: "rgba(255,255,255,0.12)",
  txt: "#F4F3F1",
  txt2: "#A7AEB6",
  txt3: "#6E757D",
  accent: "#D08B41",
  accent2: "#F0B571",
  accentSoft: "rgba(208,139,65,0.12)",
  ok: "#3FB27F",
  okSoft: "rgba(63,178,127,0.12)",
  warn: "#E0A45C",
  warnSoft: "rgba(224,164,92,0.12)",
  danger: "#E0574D",
  dangerSoft: "rgba(224,87,77,0.12)",
};

const STATUS_TONE: Record<
  NonNullable<PublicBuildView["statusColor"]>,
  { color: string; bg: string; label: string }
> = {
  green: { color: PC.ok, bg: PC.okSoft, label: "Realizacja na czasie" },
  yellow: { color: PC.warn, bg: PC.warnSoft, label: "Lekkie opóźnienie" },
  red: { color: PC.danger, bg: PC.dangerSoft, label: "Opóźnienie" },
};

const DISPLAY_STATUS_LABEL: Record<PublicBuildView["displayStatus"], string> = {
  nierozpoczeta: "Nierozpoczęta",
  aktywna: "W trakcie",
  zamknieta: "Zakończona",
};

// Ikonki "faktów" w nagłówku — te same kształty (uproszczone do stroke
// path) co w dostarczonym mockupie HTML (ikony inline SVG obok każdego
// "fact"), nie generyczna biblioteka ikon, żeby zachować identyczny rysunek.
function FactIcon({ kind }: { kind: "area" | "calendar" | "clock" | "check" }) {
  const common = { stroke: PC.accent, strokeWidth: 1.6, fill: "none" as const };
  if (kind === "area") {
    return (
      <Svg width={15} height={15} viewBox="0 0 24 24">
        <Path d="M3 3h18v18H3z" {...common} />
        <Path d="M3 9h18M9 3v18" {...common} />
      </Svg>
    );
  }
  if (kind === "calendar") {
    return (
      <Svg width={15} height={15} viewBox="0 0 24 24">
        <Rect x={3} y={5} width={18} height={16} rx={2} {...common} />
        <Path d="M16 3v4M8 3v4M3 11h18" {...common} strokeLinecap="round" />
      </Svg>
    );
  }
  if (kind === "clock") {
    return (
      <Svg width={15} height={15} viewBox="0 0 24 24">
        <Path d="M12 8v4l3 2" {...common} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={12} cy={12} r={9} {...common} />
      </Svg>
    );
  }
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24">
      <Path d="M20 6 9 17l-5-5" {...common} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const formatDatePL = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const formatDateShortPL = (iso: string) => {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
};

// Miniaturka Google Drive z samego driveFileId — folder budowy ma
// "anyone with the link: reader" ustawione przy tworzeniu (patrz
// supabase/functions/drive-photos/index.ts), więc ten link działa bez
// logowania.
const driveThumbUrl = (fileId: string) =>
  `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: PC.surface,
          borderWidth: 1,
          borderColor: PC.line,
          borderRadius: 20,
          marginBottom: 14,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function CardHeader({ title, right }: { title: string; right?: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: PC.line,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: PC.txt3,
          fontWeight: "700",
        }}
      >
        {title}
      </Text>
      {right && (
        <Text
          style={{
            fontSize: 11,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: PC.txt3,
            fontWeight: "700",
          }}
        >
          {right}
        </Text>
      )}
    </View>
  );
}

const GAUGE_SIZE = 216;
const GAUGE_STROKE = 14;
const GAUGE_RADIUS = (GAUGE_SIZE - GAUGE_STROKE) / 2;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

function Gauge({ view }: { view: PublicBuildView }) {
  const tone = view.statusColor ? STATUS_TONE[view.statusColor] : null;
  const percent = Math.max(0, Math.min(100, view.progressPercent));
  const offset = GAUGE_CIRCUMFERENCE * (1 - percent / 100);

  const currentStageIndex = view.stages.findIndex((s) => s.percent < 100);
  const currentStage =
    currentStageIndex >= 0 ? view.stages[currentStageIndex] : view.stages[view.stages.length - 1];

  const subtitle =
    view.displayStatus === "nierozpoczeta"
      ? "Budowa jeszcze się nie rozpoczęła"
      : view.displayStatus === "zamknieta"
        ? "Budowa zakończona"
        : "Postęp budowy";

  return (
    <View style={{ alignItems: "center", paddingVertical: 30, paddingHorizontal: 22 }}>
      {tone && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            backgroundColor: tone.bg,
            borderRadius: 999,
            paddingHorizontal: 13,
            paddingVertical: 6,
            borderWidth: 1,
            borderColor: tone.color,
            marginBottom: 18,
          }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tone.color }} />
          <Text style={{ color: tone.color, fontSize: 12, fontWeight: "700" }}>{tone.label}</Text>
        </View>
      )}

      <View style={{ width: GAUGE_SIZE, height: GAUGE_SIZE }}>
        {/* Poświata za gaugem — radial-gradient blob z mockupu (::before),
            trochę szerszy i wyższy niż sam pierścień. */}
        <Svg
          width={GAUGE_SIZE * 1.6}
          height={GAUGE_SIZE * 1.3}
          style={{
            position: "absolute",
            left: -GAUGE_SIZE * 0.3,
            top: -GAUGE_SIZE * 0.15,
          }}
        >
          <Defs>
            <RadialGradient id="gaugeGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={PC.accent} stopOpacity={0.35} />
              <Stop offset="100%" stopColor={PC.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse
            cx={(GAUGE_SIZE * 1.6) / 2}
            cy={(GAUGE_SIZE * 1.3) / 2}
            rx={GAUGE_SIZE * 0.8}
            ry={GAUGE_SIZE * 0.6}
            fill="url(#gaugeGlow)"
          />
        </Svg>
        <Svg width={GAUGE_SIZE} height={GAUGE_SIZE} style={{ transform: [{ rotate: "-90deg" }] }}>
          <Defs>
            <LinearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={PC.accent2} />
              <Stop offset="100%" stopColor={PC.accent} />
            </LinearGradient>
          </Defs>
          <Circle
            cx={GAUGE_SIZE / 2}
            cy={GAUGE_SIZE / 2}
            r={GAUGE_RADIUS}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={GAUGE_STROKE}
            fill="none"
          />
          <Circle
            cx={GAUGE_SIZE / 2}
            cy={GAUGE_SIZE / 2}
            r={GAUGE_RADIUS}
            stroke="url(#gaugeGradient)"
            strokeWidth={GAUGE_STROKE}
            strokeLinecap="round"
            strokeDasharray={GAUGE_CIRCUMFERENCE}
            strokeDashoffset={offset}
            fill="none"
          />
        </Svg>
        <View
          style={{
            position: "absolute",
            inset: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {view.stages.length > 0 ? (
            <>
              <Text style={{ color: PC.txt, fontSize: 46, fontWeight: "800", letterSpacing: -1 }}>
                {currentStageIndex >= 0 ? currentStageIndex + 1 : view.stages.length}
                <Text style={{ fontSize: 20, color: PC.txt3, fontWeight: "600" }}>
                  /{view.stages.length}
                </Text>
              </Text>
              <Text style={{ color: PC.txt3, fontSize: 11, marginTop: 2, letterSpacing: 1 }}>
                ETAP
              </Text>
              <Text style={{ color: PC.accent2, fontSize: 12, marginTop: 4, fontWeight: "600" }}>
                {Math.round(percent)}% całości zlecenia
              </Text>
            </>
          ) : (
            <>
              <Text style={{ color: PC.txt, fontSize: 46, fontWeight: "800", letterSpacing: -1 }}>
                {Math.round(percent)}%
              </Text>
              <Text style={{ color: PC.txt3, fontSize: 11, marginTop: 2, letterSpacing: 1 }}>
                POSTĘPU
              </Text>
            </>
          )}
        </View>
      </View>

      <View style={{ alignItems: "center", marginTop: 16 }}>
        {currentStage ? (
          <>
            <Text style={{ color: PC.txt3, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" }}>
              Aktualnie trwa
            </Text>
            <Text style={{ color: PC.txt, fontSize: 19, fontWeight: "700", marginTop: 6 }}>
              {currentStage.name}
            </Text>
            <Text style={{ color: PC.accent2, fontSize: 13, marginTop: 4, fontWeight: "600" }}>
              {Math.round(currentStage.percent)}% tego etapu
            </Text>
          </>
        ) : (
          <Text style={{ color: PC.txt, fontSize: 15, fontWeight: "700" }}>{subtitle}</Text>
        )}
      </View>
    </View>
  );
}

function StagesStepper({ stages }: { stages: PublicBuildView["stages"] }) {
  if (!stages.length) return null;
  const currentIndex = stages.findIndex((s) => s.percent < 100);
  return (
    <View style={{ padding: 20 }}>
      {stages.map((s, i) => {
        const done = s.percent >= 100;
        const isCurrent = i === currentIndex;
        const isLast = i === stages.length - 1;
        return (
          <View key={s.name + i} style={{ flexDirection: "row", gap: 14 }}>
            <View style={{ alignItems: "center", width: 26 }}>
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: done ? PC.accent : PC.bg2,
                  borderWidth: done ? 0 : 2,
                  borderColor: isCurrent ? PC.accent : PC.lineStrong,
                }}
              >
                <Text
                  style={{
                    color: done ? "#1A1206" : isCurrent ? PC.accent2 : PC.txt3,
                    fontSize: 11,
                    fontWeight: "800",
                  }}
                >
                  {done ? "✓" : i + 1}
                </Text>
              </View>
              {!isLast && (
                <View
                  style={{
                    width: 2,
                    flex: 1,
                    minHeight: 24,
                    backgroundColor: done ? PC.accent : PC.lineStrong,
                    marginTop: 2,
                  }}
                />
              )}
            </View>
            <View style={{ flex: 1, paddingBottom: isLast ? 0 : 20, minWidth: 0 }}>
              <Text
                style={{
                  fontWeight: "600",
                  fontSize: 15,
                  color: done || isCurrent ? PC.txt : PC.txt3,
                }}
              >
                {s.name}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  marginTop: 3,
                  color: isCurrent ? PC.accent2 : PC.txt3,
                }}
              >
                {done ? "Ukończono" : isCurrent ? `W trakcie · ${Math.round(s.percent)}%` : "Zaplanowane"}
              </Text>
              {isCurrent && (
                <View
                  style={{
                    height: 5,
                    borderRadius: 99,
                    backgroundColor: "rgba(255,255,255,0.07)",
                    marginTop: 9,
                    maxWidth: 220,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      width: `${Math.max(0, Math.min(100, s.percent))}%`,
                      height: "100%",
                      borderRadius: 99,
                      backgroundColor: PC.accent,
                    }}
                  />
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function PhotosCard({ view }: { view: PublicBuildView }) {
  if (view.photos.length === 0) return null;
  const shown = view.photos.slice(0, 6);
  return (
    <Card>
      <CardHeader title="Zdjęcia z budowy" right={`${shown.length} z ${view.photos.length}`} />
      <View style={{ padding: 20 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {shown.map((p) => (
            <View
              key={p.id}
              style={{
                width: "31%",
                aspectRatio: 4 / 3,
                borderRadius: 14,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: PC.line,
                backgroundColor: PC.surface2,
              }}
            >
              <Image
                source={{ uri: driveThumbUrl(p.id) }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
              />
              <Text
                style={{
                  position: "absolute",
                  left: 8,
                  bottom: 7,
                  fontSize: 10,
                  fontWeight: "700",
                  color: "#fff",
                  backgroundColor: "rgba(0,0,0,0.6)",
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 5,
                }}
              >
                {formatDateShortPL(p.createdAt)}
              </Text>
            </View>
          ))}
        </View>
        {view.photosUrl && (
          <Pressable
            onPress={() => Linking.openURL(view.photosUrl!)}
            style={{
              marginTop: 14,
              borderWidth: 1,
              borderColor: PC.line,
              borderRadius: 10,
              paddingVertical: 11,
              alignItems: "center",
            }}
          >
            <Text style={{ color: PC.accent2, fontSize: 13, fontWeight: "600" }}>
              Zobacz wszystkie zdjęcia
            </Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

function NotesCard({ notes }: { notes: PublicBuildView["notes"] }) {
  if (notes.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Ostatnie aktualizacje" />
      <View style={{ paddingHorizontal: 20, paddingVertical: 6 }}>
        {notes.map((n, i) => (
          <View
            key={n.date + i}
            style={{
              flexDirection: "row",
              gap: 12,
              alignItems: "flex-start",
              paddingVertical: 13,
              borderBottomWidth: i === notes.length - 1 ? 0 : 1,
              borderBottomColor: PC.line,
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                marginTop: 6,
                backgroundColor: i === 0 ? PC.accent : PC.lineStrong,
              }}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: PC.txt3, fontSize: 12 }}>{formatDatePL(n.date)}</Text>
              <Text
                style={{
                  color: i === 0 ? PC.txt : PC.txt2,
                  fontSize: 14,
                  marginTop: 3,
                }}
              >
                {n.note}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

function TechCard({ view }: { view: PublicBuildView }) {
  if (!view.technologyName && view.materials.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Zastosowana technologia" />
      <View style={{ padding: 20 }}>
        {view.technologyName && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              padding: 14,
              borderRadius: 14,
              backgroundColor: PC.surface2,
              borderWidth: 1,
              borderColor: PC.line,
              marginBottom: view.materials.length > 0 ? 16 : 0,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 11,
                backgroundColor: PC.accentSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: PC.accent2, fontSize: 18 }}>⬢</Text>
            </View>
            <Text style={{ color: PC.txt, fontWeight: "600", fontSize: 15, flex: 1 }}>
              {view.technologyName}
            </Text>
          </View>
        )}
        {view.materials.length > 0 && (
          <View>
            <Text
              style={{
                color: PC.txt3,
                fontSize: 11,
                letterSpacing: 1,
                textTransform: "uppercase",
                marginBottom: 8,
                fontWeight: "700",
              }}
            >
              Materiały na budowie
            </Text>
            {view.materials.map((name, i) => (
              <Text
                key={name + i}
                style={{ color: PC.txt2, fontSize: 13.5, marginTop: i === 0 ? 0 : 5 }}
              >
                • {name}
              </Text>
            ))}
          </View>
        )}
      </View>
    </Card>
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
      } catch (err) {
        console.error("[portal] get_public_build failed:", err);
        const message = err instanceof Error ? err.message : "Nieznany błąd.";
        setError(`Nie udało się wczytać danych budowy: ${message}`);
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
      <View style={{ flex: 1, backgroundColor: PC.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={PC.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: PC.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: PC.danger, textAlign: "center" }}>{error}</Text>
      </View>
    );
  }

  if (!view) {
    return (
      <View style={{ flex: 1, backgroundColor: PC.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: PC.txt, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
          Strona nie została znaleziona
        </Text>
        <Text style={{ color: PC.txt3, marginTop: 8, textAlign: "center" }}>
          Link może być nieaktualny lub podgląd tej budowy nie jest już udostępniony.
        </Text>
      </View>
    );
  }

  if (view.requiresPin) {
    return (
      <View style={{ flex: 1, backgroundColor: PC.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: PC.txt, fontSize: 20, fontWeight: "800", textAlign: "center", marginBottom: 4 }}>
          {view.name}
        </Text>
        <Text style={{ color: PC.txt3, marginBottom: 20 }}>{view.number}</Text>
        <View style={{ width: "100%", maxWidth: 320 }}>
          <Text style={{ color: PC.txt, marginBottom: 8, textAlign: "center" }}>
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
            <Text style={{ color: PC.danger, fontSize: 12, marginTop: 8, textAlign: "center" }}>{pinError}</Text>
          )}
          <View style={{ marginTop: 14 }}>
            <Button label={pinBusy ? "Sprawdzanie…" : "Zatwierdź"} onPress={submitPin} disabled={pinBusy} fullWidth />
          </View>
        </View>
      </View>
    );
  }

  const plannedEnd = formatDatePL(view.plannedEndDate);
  const startDate = formatDatePL(view.startDate);
  const lastUpdate = formatDatePL(view.lastUpdateDate);
  // Dwukolumnowy układ (gauge/etapy z lewej, zdjęcia/aktualizacje/
  // technologia z prawej) tylko od szerokości, przy której mockup HTML
  // się na to przełącza (.grid, max-width:900px w oryginalnym CSS) —
  // węższe ekrany (telefon) zostają w jednej kolumnie.
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: PC.bg }} contentContainerStyle={{ padding: 18, paddingTop: 40, paddingBottom: 48, alignItems: "center" }}>
      {/* max-width: 1180 wyśrodkowane — ten sam .wrap co w mockupie HTML,
          strona nie ma się rozciągać na całą szerokość ekranu. */}
      <View style={{ width: "100%", maxWidth: 1180 }}>
      {/* Pasek marki — uproszczony (bez position:sticky, niekrytyczne na
          jednorazowym podglądzie z linku/QR). */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 28,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              backgroundColor: PC.accent2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#1A1206", fontSize: 13, fontWeight: "800" }}>F</Text>
          </View>
          <Text style={{ color: PC.txt, fontWeight: "800", fontSize: 13, letterSpacing: 2 }}>
            FLOWTEX
          </Text>
        </View>
        <Text style={{ color: PC.txt3, fontSize: 11 }}>🔒 Podgląd dla zleceniodawcy</Text>
      </View>

      {/* Nagłówek budowy */}
      <Text
        style={{
          color: PC.accent2,
          fontSize: 11,
          letterSpacing: 2,
          textTransform: "uppercase",
          fontWeight: "700",
          marginBottom: 10,
        }}
      >
        — Postęp realizacji
      </Text>
      <Text style={{ color: PC.txt, fontSize: 34, fontWeight: "800", letterSpacing: -0.5 }}>
        {view.name}
      </Text>
      <Text style={{ color: PC.txt3, fontSize: 14, marginTop: 6 }}>
        Zlecenie {view.number}
        {view.address ? `  ·  ${view.address}` : ""}
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
        {view.areaM2 && (
          <View style={styles.pill}>
            <FactIcon kind="area" />
            <Text style={styles.pillText}>
              Powierzchnia <Text style={styles.pillStrong}>{view.areaM2} m²</Text>
            </Text>
          </View>
        )}
        {startDate && (
          <View style={styles.pill}>
            <FactIcon kind="calendar" />
            <Text style={styles.pillText}>
              Start <Text style={styles.pillStrong}>{startDate}</Text>
            </Text>
          </View>
        )}
        {plannedEnd && (
          <View style={styles.pill}>
            <FactIcon kind="clock" />
            <Text style={styles.pillText}>
              Zakończenie <Text style={styles.pillStrong}>{plannedEnd}</Text>
            </Text>
          </View>
        )}
        <View style={styles.pill}>
          <FactIcon kind="check" />
          <Text style={styles.pillText}>
            Status <Text style={styles.pillStrong}>{DISPLAY_STATUS_LABEL[view.displayStatus]}</Text>
          </Text>
        </View>
      </View>

      <View style={{ marginTop: 26, flexDirection: isWide ? "row" : "column", gap: 18 }}>
        <View style={{ flex: isWide ? 1.35 : undefined }}>
          <Card style={{ marginBottom: 0 }}>
            <Gauge view={view} />
            {view.stages.length > 0 && (
              <>
                <View style={{ borderTopWidth: 1, borderTopColor: PC.line }} />
                <StagesStepper stages={view.stages} />
              </>
            )}
          </Card>
        </View>

        <View style={{ flex: isWide ? 1 : undefined }}>
          <PhotosCard view={view} />
          <NotesCard notes={view.notes} />
          <TechCard view={view} />

          {view.contractValue != null && (
            <Card>
              <CardHeader title="Wartość kontraktu" />
              <View style={{ padding: 20 }}>
                <Text style={{ color: PC.txt, fontSize: 20, fontWeight: "800" }}>
                  {formatPLN(Number(view.contractValue))}
                </Text>
              </View>
            </Card>
          )}
        </View>
      </View>

      <View style={{ marginTop: 14 }}>
        <View
          style={{
            marginTop: 4,
            padding: 20,
            borderRadius: 20,
            backgroundColor: PC.accentSoft,
            borderWidth: 1,
            borderColor: "rgba(208,139,65,0.22)",
          }}
        >
          <Text style={{ color: PC.txt, fontWeight: "700", fontSize: 15, marginBottom: 4 }}>
            Masz pytania do realizacji?
          </Text>
          <Text style={{ color: PC.txt2, fontSize: 13.5 }}>
            Skontaktuj się z opiekunem projektu po stronie Flowtex.
          </Text>
        </View>

        <View
          style={{
            marginTop: 22,
            paddingTop: 18,
            borderTopWidth: 1,
            borderTopColor: PC.line,
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <Text style={{ color: PC.txt3, fontSize: 11 }}>
            {lastUpdate ? `Aktualizacja danych: ${lastUpdate}` : "Brak jeszcze raportów z tej budowy."}
          </Text>
          <Text style={{ color: PC.txt3, fontSize: 11 }}>
            Widok generowany automatycznie z systemu ERP Flowtex
          </Text>
        </View>
      </View>
      </View>
    </ScrollView>
  );
}

const styles = {
  pill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    backgroundColor: PC.surface,
    borderWidth: 1,
    borderColor: PC.line,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillText: { color: PC.txt2, fontSize: 12.5 },
  pillStrong: { color: PC.txt, fontWeight: "700" as const },
};
