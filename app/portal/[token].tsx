import { useLocalSearchParams } from "expo-router";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
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
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Button, Field, formatPLN } from "@/components/report-ui";
import {
  fetchPublicBuild,
  type PublicBuildView,
} from "@/lib/data/public-portal";
import { generateClientSummaryPublic } from "@/lib/data/ai-summary";

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

// Pełny rozmiar do przeglądarki na cały ekran — ten sam publiczny link
// Drive, tylko większy wariant (w1600), zamiast pobierać oryginał (może
// ważyć kilkanaście MB na zdjęcie z telefonu).
const driveFullUrl = (fileId: string) =>
  `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`;

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

// Pierścienie warstw (jeden na etap/warstwę budowy) — na wzór "activity
// rings" z iOS: każda warstwa to osobny, węższy pierścień, PIERWSZY etap
// w ŚRODKU (najmniejszy promień) a OSTATNI na zewnątrz (największy) —
// czyli w kolejności realizacji, patrząc od środka na zewnątrz — każdy w
// innym kolorze, wypełniony proporcjonalnie do % tej warstwy. Gdy budowa
// nie ma etapów, zostaje pojedynczy pierścień ogólnego postępu (obsłużone
// niżej przez ringsForStages z jednym elementem).
const RING_STROKE = 10;
const RING_GAP = 5;

function ringColor(index: number, total: number) {
  const hue = total > 0 ? (index * 360) / Math.max(total, 1) : 0;
  return `hsl(${Math.round(hue)}, 68%, 62%)`;
}

function Gauge({ view }: { view: PublicBuildView }) {
  const tone = view.statusColor ? STATUS_TONE[view.statusColor] : null;
  const percent = Math.max(0, Math.min(100, view.progressPercent));
  const offset = GAUGE_CIRCUMFERENCE * (1 - percent / 100);

  const rings = view.stages.map((stage, i) => {
    // Pierwszy etap (i=0) w ŚRODKU, ostatni na ZEWNĄTRZ — odwrócony
    // indeks, bo promień rośnie na zewnątrz.
    const reversedIndex = view.stages.length - 1 - i;
    const radius = GAUGE_RADIUS - reversedIndex * (RING_STROKE + RING_GAP);
    const circumference = 2 * Math.PI * radius;
    const stagePercent = Math.max(0, Math.min(100, stage.percent));
    return {
      stage,
      radius,
      circumference,
      offset: circumference * (1 - stagePercent / 100),
      color: ringColor(i, view.stages.length),
    };
  });

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
          {rings.length > 0 ? (
            rings.map((ring, i) => (
              <Fragment key={i}>
                <Circle
                  cx={GAUGE_SIZE / 2}
                  cy={GAUGE_SIZE / 2}
                  r={ring.radius}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={RING_STROKE}
                  fill="none"
                />
                <Circle
                  cx={GAUGE_SIZE / 2}
                  cy={GAUGE_SIZE / 2}
                  r={ring.radius}
                  stroke={ring.color}
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={ring.circumference}
                  strokeDashoffset={ring.offset}
                  fill="none"
                />
              </Fragment>
            ))
          ) : (
            <>
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
            </>
          )}
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

      {view.stages.length > 0 && (
        <Text
          style={{
            color: PC.accent2,
            fontSize: 17,
            marginTop: 14,
            fontWeight: "700",
          }}
        >
          {Math.round(percent)}% całości zlecenia
        </Text>
      )}

      <View style={{ alignItems: "center", marginTop: 34 }}>
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

      {rings.length > 1 && (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 10,
            marginTop: 18,
            paddingHorizontal: 4,
          }}
        >
          {rings.map((ring, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: ring.color,
                }}
              />
              <Text style={{ color: PC.txt2, fontSize: 11 }}>
                {ring.stage.name} · {Math.round(ring.stage.percent)}%
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function StagesStepper({ stages }: { stages: PublicBuildView["stages"] }) {
  if (!stages.length) return null;
  return (
    <View style={{ padding: 20 }}>
      {stages.map((s, i) => {
        const done = s.percent >= 100;
        // Etapy technologii nie muszą iść po kolei — materiał na kolejny
        // etap potrafi zejść, zanim poprzedni jest skończony. Każdy etap
        // pokazuje więc WŁASNY procent zamiast tylko "pierwszego
        // nieukończonego" (dawne `isCurrent`/`currentIndex`), które
        // sztywno traktowało wszystkie kolejne jako "Zaplanowane" 0%.
        const isCurrent = !done && s.percent > 0;
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

// Kafelek miniaturki — współdzielony między podglądem w karcie a pełną
// galerią w modalu, żeby nie duplikować stylu.
function PhotoTile({
  photo,
  widthPercent = 31,
  onPress,
}: {
  photo: PublicBuildView["photos"][number];
  widthPercent?: number;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: `${widthPercent}%`,
        aspectRatio: 4 / 3,
        borderRadius: 14,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: PC.line,
        backgroundColor: PC.surface2,
      }}
    >
      <Image
        source={{ uri: driveThumbUrl(photo.id) }}
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
        {formatDateShortPL(photo.createdAt)}
      </Text>
    </Pressable>
  );
}

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;

// Zdjęcie ze szczypaniem (pinch-to-zoom) + przesuwaniem po przybliżeniu +
// podwójne stuknięcie jako skrót. Gesture-handler/reanimated już są w
// projekcie (GestureHandlerRootView w app/_layout.tsx), więc bez nowej
// zależności. Szczypanie i przesuwanie działają RAZEM (Simultaneous) —
// przesuwanie ma efekt tylko, gdy zdjęcie jest przybliżone (sprawdzane w
// onUpdate); podwójny tap idzie osobnym torem (Race), bo miałby się
// gubić w kolejce ze szczypaniem/przesuwaniem.
function ZoomableImage({
  uri,
  width,
  height,
  onZoomChange,
}: {
  uri: string;
  width: number;
  height: number;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const resetZoom = () => {
    "worklet";
    scale.value = withTiming(1);
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), MAX_ZOOM);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        resetZoom();
        runOnJS(onZoomChange)(false);
      } else {
        runOnJS(onZoomChange)(true);
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) {
        resetZoom();
        runOnJS(onZoomChange)(false);
      } else {
        scale.value = withTiming(DOUBLE_TAP_ZOOM);
        savedScale.value = DOUBLE_TAP_ZOOM;
        runOnJS(onZoomChange)(true);
      }
    });

  const composed = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
        <Animated.Image
          source={{ uri }}
          style={[{ width: width - 24, height: height - 160 }, animatedStyle]}
          resizeMode="contain"
        />
      </Animated.View>
    </GestureDetector>
  );
}

// Pełnoekranowa przeglądarka — jedna, wspólna lista `photos` (zawsze
// PEŁNA view.photos, nie tylko podgląd/grupa dnia), żeby strzałki/swipe
// przechodziły płynnie przez WSZYSTKIE zdjęcia budowy, niezależnie od
// tego, z którego kafelka viewer został otwarty. Nawigacja: pozioma
// ScrollView z pagingEnabled daje swipe na dotyku za darmo (bez
// dodatkowej biblioteki gestów); strzałki i klawiatura (web) ustawiają
// pozycję przez scrollTo.
function PhotoViewerModal({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: PublicBuildView["photos"];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const { width, height } = useWindowDimensions();
  // Gdy dowolne zdjęcie jest przybliżone, wyłączamy swipe między
  // zdjęciami — inaczej przesuwanie przybliżonego zdjęcia gubiłoby się z
  // przechodzeniem do kolejnego. Reset przy każdej zmianie indeksu
  // (strzałka/klawiatura), żeby nie zostać "zablokowanym" na zoomie
  // poprzedniego zdjęcia w tle.
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (index == null) return;
    setZoomed(false);
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ x: index * width, animated: false }),
    );
  }, [index, width]);

  useEffect(() => {
    if (index == null || Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      else if (e.key === "ArrowRight" && index < photos.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onIndexChange, onClose]);

  if (index == null) return null;
  const photo = photos[index];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.96)" }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
            if (newIndex !== index && newIndex >= 0 && newIndex < photos.length) {
              onIndexChange(newIndex);
            }
          }}
          style={{ flex: 1 }}
        >
          {photos.map((p) => (
            <ZoomableImage
              key={p.id}
              uri={driveFullUrl(p.id)}
              width={width}
              height={height}
              onZoomChange={setZoomed}
            />
          ))}
        </ScrollView>

        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={{
            position: "absolute",
            top: 50,
            right: 20,
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.14)",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>✕</Text>
        </Pressable>

        {index > 0 && (
          <Pressable
            onPress={() => onIndexChange(index - 1)}
            hitSlop={12}
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              marginTop: -22,
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.14)",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "700" }}>‹</Text>
          </Pressable>
        )}
        {index < photos.length - 1 && (
          <Pressable
            onPress={() => onIndexChange(index + 1)}
            hitSlop={12}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              marginTop: -22,
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.14)",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "700" }}>›</Text>
          </Pressable>
        )}

        <View style={{ position: "absolute", bottom: 28, alignSelf: "center" }}>
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>
            {index + 1} / {photos.length} · {formatDateShortPL(photo.createdAt)}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

// Grupuje zdjęcia po dniu (klucz "YYYY-MM-DD" z createdAt), zachowując
// kolejność malejącą po dacie — zarówno dni, jak i zdjęcia w obrębie dnia
// przychodzą z backendu już posortowane malejąco (patrz get_public_build).
function groupPhotosByDay(photos: PublicBuildView["photos"]) {
  const groups: { day: string; photos: PublicBuildView["photos"] }[] = [];
  for (const p of photos) {
    const day = p.createdAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      last.photos.push(p);
    } else {
      groups.push({ day, photos: [p] });
    }
  }
  return groups;
}

function PhotosCard({ view }: { view: PublicBuildView }) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  // Indeks w PEŁNEJ, płaskiej liście view.photos — wspólny dla podglądu
  // w karcie i dla galerii w modalu, żeby strzałki/swipe w przeglądarce
  // przechodziły przez wszystkie zdjęcia budowy, nie tylko bieżącą grupę.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  if (view.photos.length === 0) return null;

  const byDay = groupPhotosByDay(view.photos);
  const latestDayPhotos = byDay[0]?.photos ?? [];
  const shown = latestDayPhotos.slice(0, 6);
  const latestDay = formatDateShortPL(view.photos[0].createdAt);

  return (
    <Card>
      <CardHeader
        title="Zdjęcia z budowy"
        right={`${latestDay} · ${shown.length} z ${latestDayPhotos.length}`}
      />
      <View style={{ padding: 20 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {shown.map((p) => (
            <PhotoTile
              key={p.id}
              photo={p}
              onPress={() => setViewerIndex(view.photos.indexOf(p))}
            />
          ))}
        </View>
        {view.photos.length > shown.length && (
          <Pressable
            onPress={() => setGalleryOpen(true)}
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
              Zobacz wszystkie zdjęcia ({view.photos.length})
            </Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={galleryOpen}
        animationType="slide"
        onRequestClose={() => setGalleryOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: PC.bg }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingTop: 54,
              paddingBottom: 14,
              borderBottomWidth: 1,
              borderBottomColor: PC.line,
            }}
          >
            <Text style={{ color: PC.txt, fontSize: 16, fontWeight: "800" }}>
              Zdjęcia z budowy ({view.photos.length})
            </Text>
            {/* X zamyka galerię i wraca do okna portalu — bez nawigacji na
                zewnątrz (dawniej: link do folderu na Google Drive). */}
            <Pressable
              onPress={() => setGalleryOpen(false)}
              hitSlop={12}
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: PC.surface2,
                borderWidth: 1,
                borderColor: PC.line,
              }}
            >
              <Text style={{ color: PC.txt, fontSize: 16, fontWeight: "700" }}>✕</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            {byDay.map((group) => (
              <View key={group.day} style={{ marginBottom: 22 }}>
                <Text
                  style={{
                    color: PC.txt3,
                    fontSize: 11,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    fontWeight: "700",
                    marginBottom: 10,
                  }}
                >
                  {formatDatePL(group.day)} · {group.photos.length}{" "}
                  {group.photos.length === 1 ? "zdjęcie" : "zdjęć"}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {group.photos.map((p) => (
                    <PhotoTile
                      key={p.id}
                      photo={p}
                      onPress={() => setViewerIndex(view.photos.indexOf(p))}
                    />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      <PhotoViewerModal
        photos={view.photos}
        index={viewerIndex}
        onIndexChange={setViewerIndex}
        onClose={() => setViewerIndex(null)}
      />
    </Card>
  );
}

function NotesCard({
  notes,
  aiSummary,
  allowClientAiSummary,
  generatingSummary,
  summaryError,
  onGenerateSummary,
}: {
  notes: PublicBuildView["notes"];
  aiSummary: PublicBuildView["aiSummary"];
  allowClientAiSummary: boolean;
  generatingSummary: boolean;
  summaryError: string | null;
  onGenerateSummary: () => void;
}) {
  if (notes.length === 0 && !aiSummary && !allowClientAiSummary) return null;
  return (
    <Card>
      <CardHeader title="Ostatnie aktualizacje" />
      {aiSummary && (
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: notes.length > 0 ? 10 : 16,
          }}
        >
          <Text style={{ color: PC.txt, fontSize: 14, lineHeight: 21 }}>{aiSummary}</Text>
        </View>
      )}
      {notes.length > 0 && (
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
      )}
      {allowClientAiSummary && (
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: notes.length > 0 || aiSummary ? 14 : 16,
            paddingBottom: 20,
            borderTopWidth: notes.length > 0 || aiSummary ? 1 : 0,
            borderTopColor: PC.line,
          }}
        >
          {summaryError && (
            <Text style={{ color: PC.danger, fontSize: 12, marginBottom: 10 }}>
              {summaryError}
            </Text>
          )}
          <Button
            label={generatingSummary ? "Generowanie…" : "Wygeneruj raport z budowy AI"}
            onPress={onGenerateSummary}
            disabled={generatingSummary}
            fullWidth
          />
        </View>
      )}
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
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const { width } = useWindowDimensions();

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

  // Klient generuje raport AI sam, na życzenie — dozwolone tylko gdy
  // Admin włączył "Klient może wygenerować raport AI" dla tej budowy
  // (view.allowClientAiSummary, patrz build-portal-section.tsx). Po
  // sukcesie doładowujemy widok (z zapamiętanym PIN-em, jeśli budowa go
  // wymaga), żeby świeże `aiSummary` pojawiło się od razu.
  const generateSummary = async () => {
    if (!token) return;
    setGeneratingSummary(true);
    setSummaryError(null);
    try {
      await generateClientSummaryPublic(token);
      await load(pinInput.trim() || undefined);
    } catch (err) {
      setSummaryError(
        err instanceof Error ? err.message : "Nie udało się wygenerować raportu.",
      );
    } finally {
      setGeneratingSummary(false);
    }
  };

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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={{ color: PC.txt3, fontSize: 11 }}>🔒 Podgląd dla zleceniodawcy</Text>
          {Platform.OS === "web" && (
            <Pressable
              onPress={() => {
                // Panel jest otwierany jako osobna karta/link (patrz
                // build-portal-section.tsx openLink), nie modal w apce —
                // "zamknięcie" to zamknięcie tej karty przeglądarki.
                if (typeof window !== "undefined") window.close();
              }}
              style={{
                width: 24,
                height: 24,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: PC.surface2,
                borderWidth: 1,
                borderColor: PC.line,
              }}
              accessibilityLabel="Zamknij panel"
            >
              <Text style={{ color: PC.txt2, fontSize: 13, fontWeight: "700" }}>✕</Text>
            </Pressable>
          )}
        </View>
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
          <NotesCard
            notes={view.notes}
            aiSummary={view.aiSummary}
            allowClientAiSummary={view.allowClientAiSummary}
            generatingSummary={generatingSummary}
            summaryError={summaryError}
            onGenerateSummary={generateSummary}
          />
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
