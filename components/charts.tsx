import { Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { COLORS, formatPLN } from "@/components/report-ui";

/**
 * Proste wykresy do raportów (m.in. domknięcie budowy w Rozliczeniu),
 * budowane ręcznie na react-native-svg — jedynej bibliotece graficznej,
 * która już jest w projekcie (nie dorzucamy nowej zależności typu
 * victory-native). Działają identycznie na web i natywnie.
 */

export type ChartSegment = {
  key: string;
  label: string;
  value: number;
  color: string;
};

// Poziomy wykres słupkowy — dobry do zestawień "koszt wg kategorii",
// gdzie chcemy jednocześnie czytelne etykiety i wartości PLN z boku.
export function BarChart({
  data,
  formatValue = formatPLN,
}: {
  data: ChartSegment[];
  formatValue?: (value: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));

  return (
    <View style={{ gap: 12 }}>
      {data.map((d) => {
        const widthPct = Math.min(100, (Math.abs(d.value) / max) * 100);
        return (
          <View key={d.key}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <Text style={{ color: COLORS.foreground, fontSize: 12 }} numberOfLines={1}>
                {d.label}
              </Text>
              <Text style={{ color: COLORS.foreground, fontSize: 12, fontWeight: "700" }}>
                {formatValue(d.value)}
              </Text>
            </View>
            <View
              style={{
                height: 10,
                borderRadius: 6,
                backgroundColor: COLORS.background,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: `${widthPct}%`,
                  height: "100%",
                  borderRadius: 6,
                  backgroundColor: d.color,
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Dwuseryjny wykres słupkowy do porównań "plan vs wykonanie" (tu:
// kontrakt vs koszt budowy).
export function ComparisonBarChart({
  items,
}: {
  items: { key: string; label: string; a: ChartSegment; b: ChartSegment }[];
}) {
  const max = Math.max(1, ...items.flatMap((i) => [i.a.value, i.b.value]));

  return (
    <View style={{ gap: 18 }}>
      {items.map((item) => (
        <View key={item.key}>
          <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 6 }}>
            {item.label}
          </Text>
          {[item.a, item.b].map((seg) => {
            const widthPct = Math.min(100, (Math.max(0, seg.value) / max) * 100);
            return (
              <View key={seg.key} style={{ marginBottom: 6 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 3,
                  }}
                >
                  <Text style={{ color: COLORS.muted, fontSize: 11 }}>{seg.label}</Text>
                  <Text style={{ color: COLORS.foreground, fontSize: 11, fontWeight: "700" }}>
                    {formatPLN(seg.value)}
                  </Text>
                </View>
                <View
                  style={{
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: COLORS.background,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      width: `${widthPct}%`,
                      height: "100%",
                      borderRadius: 7,
                      backgroundColor: seg.color,
                    }}
                  />
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// Wykres kołowy (donut) do udziału kategorii kosztów w całości — jedyny
// z tych wykresów, który faktycznie potrzebuje SVG (stroke-dasharray na
// okręgu). Legenda pod spodem jest zwykłym RN Text (czytelniejsze i
// pewniejsze niż SVG <Text> na różnych platformach).
export function DonutChart({
  data,
  size = 140,
  strokeWidth = 22,
  centerLabel,
  centerValue,
}: {
  data: ChartSegment[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let offsetAcc = 0;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={COLORS.background}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {total > 0 &&
            data.map((d) => {
              const value = Math.max(0, d.value);
              if (value === 0) return null;
              const fraction = value / total;
              const dash = fraction * circumference;
              const gap = circumference - dash;
              const rotation = (offsetAcc / total) * 360 - 90;
              offsetAcc += value;
              return (
                <Circle
                  key={d.key}
                  cx={center}
                  cy={center}
                  r={radius}
                  stroke={d.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dash} ${gap}`}
                  strokeLinecap="butt"
                  fill="none"
                  rotation={rotation}
                  origin={`${center}, ${center}`}
                />
              );
            })}
        </Svg>
        {(centerLabel || centerValue) && (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {centerValue ? (
              <Text style={{ color: COLORS.foreground, fontWeight: "800", fontSize: 13 }}>
                {centerValue}
              </Text>
            ) : null}
            {centerLabel ? (
              <Text style={{ color: COLORS.muted, fontSize: 9 }}>{centerLabel}</Text>
            ) : null}
          </View>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 120, gap: 6 }}>
        {data.map((d) => {
          const pct = total > 0 ? (Math.max(0, d.value) / total) * 100 : 0;
          return (
            <View key={d.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  backgroundColor: d.color,
                  flexShrink: 0,
                }}
              />
              <Text style={{ color: COLORS.foreground, fontSize: 11, flex: 1 }} numberOfLines={1}>
                {d.label}
              </Text>
              <Text style={{ color: COLORS.muted, fontSize: 11 }}>{pct.toFixed(0)}%</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// Kafelek KPI do siatki wskaźników w raporcie domknięcia.
export function KpiTile({
  label,
  value,
  color = COLORS.foreground,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 140,
        backgroundColor: COLORS.background,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <Text style={{ color: COLORS.muted, fontSize: 10, textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text style={{ color, fontSize: 16, fontWeight: "800", marginTop: 4 }}>{value}</Text>
    </View>
  );
}
