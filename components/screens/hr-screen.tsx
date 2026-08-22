import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { COLORS, IconBadge } from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

type PeriodMode = "week" | "month" | "day";

const toISO = (d: Date) => d.toISOString().slice(0, 10);
const parseISO = (iso: string) => new Date(iso + "T00:00:00");
const addDays = (iso: string, days: number) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
};
// Poniedziałek jako początek tygodnia roboczego (praca w budowlance zwykle
// obejmuje też sobotę, stąd tydzień pon–sob, nie pon–niedz).
const mondayOf = (iso: string) => {
  const d = parseISO(iso);
  const day = d.getDay(); // 0 = niedziela
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return toISO(d);
};
const monthLabelPL = (iso: string) =>
  parseISO(iso).toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
const dayLabelPL = (iso: string) =>
  parseISO(iso).toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
const shortLabelPL = (iso: string) =>
  parseISO(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

export function HrSection() {
  const { timeEntries, employees, builds } = useAppData();

  const [mode, setMode] = useState<PeriodMode>("week");
  const [offset, setOffset] = useState(0); // ile okresów wstecz od bieżącego
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(
    null,
  );

  const today = toISO(new Date());

  const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
    if (mode === "week") {
      const monday = addDays(mondayOf(today), offset * 7);
      const saturday = addDays(monday, 5);
      return {
        rangeStart: monday,
        rangeEnd: saturday,
        rangeLabel: `${shortLabelPL(monday)} – ${shortLabelPL(saturday)}`,
      };
    }
    if (mode === "month") {
      const base = parseISO(today);
      base.setDate(1);
      base.setMonth(base.getMonth() + offset);
      const first = toISO(base);
      const nextMonth = new Date(base);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const last = toISO(new Date(nextMonth.getTime() - 86400000));
      return {
        rangeStart: first,
        rangeEnd: last,
        rangeLabel: monthLabelPL(first),
      };
    }
    const day = addDays(today, offset);
    return { rangeStart: day, rangeEnd: day, rangeLabel: dayLabelPL(day) };
  }, [mode, offset, today]);

  const periodEntries = useMemo(
    () =>
      timeEntries.filter(
        (entry) => entry.date >= rangeStart && entry.date <= rangeEnd,
      ),
    [timeEntries, rangeStart, rangeEnd],
  );

  const byEmployee = useMemo(() => {
    const map = new Map<
      string,
      { hours: number; days: Set<string>; entries: typeof periodEntries }
    >();
    periodEntries.forEach((entry) => {
      const bucket = map.get(entry.employeeId) || {
        hours: 0,
        days: new Set<string>(),
        entries: [],
      };
      bucket.hours += entry.hours;
      bucket.days.add(entry.date);
      bucket.entries.push(entry);
      map.set(entry.employeeId, bucket);
    });
    return [...map.entries()]
      .map(([employeeId, bucket]) => ({
        employee: employees.find((e) => e.id === employeeId),
        employeeId,
        hours: bucket.hours,
        daysWorked: bucket.days.size,
        entries: bucket.entries.sort((a, b) => a.date.localeCompare(b.date)),
      }))
      .sort((a, b) => b.hours - a.hours);
  }, [periodEntries, employees]);

  const totalHours = periodEntries.reduce((sum, e) => sum + e.hours, 0);
  const maxHours = Math.max(1, ...byEmployee.map((row) => row.hours));

  return (
    <>
      <View className="bg-surface border border-border rounded-2xl p-2 mb-5">
        <View style={{ flexDirection: "row", gap: 6 }}>
          {(
            [
              ["week", "Tydzień"],
              ["month", "Miesiąc"],
              ["day", "Dzień"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => {
                setMode(value);
                setOffset(0);
              }}
              style={{
                flex: 1,
                borderRadius: 10,
                paddingVertical: 10,
                alignItems: "center",
                backgroundColor:
                  mode === value ? COLORS.primary : "transparent",
              }}
            >
              <Text
                style={{
                  color: mode === value ? COLORS.background : COLORS.muted,
                  fontWeight: "700",
                  fontSize: 13,
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View
        className="bg-surface border border-border rounded-2xl mb-5"
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: 6,
        }}
      >
        <Pressable
          onPress={() => setOffset(offset - 1)}
          style={{ padding: 10 }}
        >
          <Text style={{ color: COLORS.primary, fontSize: 18, fontWeight: "800" }}>
            ‹
          </Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text
            style={{
              color: COLORS.foreground,
              fontWeight: "700",
              fontSize: 15,
              textTransform: "capitalize",
            }}
          >
            {rangeLabel}
          </Text>
        </View>
        <Pressable
          onPress={() => setOffset(Math.min(0, offset + 1))}
          disabled={offset >= 0}
          style={{ padding: 10, opacity: offset >= 0 ? 0.3 : 1 }}
        >
          <Text style={{ color: COLORS.primary, fontSize: 18, fontWeight: "800" }}>
            ›
          </Text>
        </Pressable>
      </View>

      <View
        className="bg-surface border border-border rounded-2xl mb-5"
        style={{ flexDirection: "row", overflow: "hidden" }}
      >
        <View style={{ flex: 1, padding: 16 }}>
          <Text className="text-xs text-muted uppercase">Godziny łącznie</Text>
          <Text className="text-3xl font-bold text-foreground mt-1">
            {totalHours.toFixed(2)}
          </Text>
        </View>
        <View style={{ width: 1, backgroundColor: COLORS.border }} />
        <View style={{ flex: 1, padding: 16 }}>
          <Text className="text-xs text-muted uppercase">Osoby z wpisami</Text>
          <Text
            style={{ color: COLORS.primary }}
            className="text-3xl font-bold mt-1"
          >
            {byEmployee.length}
          </Text>
        </View>
      </View>

      {/* Wizualizacja: kto ile przepracował w wybranym okresie */}
      {byEmployee.length > 0 && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-5">
          <Text className="text-xs text-muted uppercase mb-3">
            Godziny wg pracownika
          </Text>
          {byEmployee.map((row) => (
            <View key={row.employeeId} style={{ marginBottom: 12 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <Text style={{ color: COLORS.foreground, fontSize: 13, fontWeight: "700" }}>
                  {row.employee?.name || row.employeeId}
                </Text>
                <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: "800" }}>
                  {row.hours.toFixed(2)} h
                </Text>
              </View>
              <View
                style={{
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: COLORS.background,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    width: `${Math.max(4, (row.hours / maxHours) * 100)}%`,
                    height: "100%",
                    backgroundColor: COLORS.primary,
                    borderRadius: 5,
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      <Text className="text-lg font-bold text-foreground mb-3">
        Szczegóły pracowników
      </Text>
      {byEmployee.length === 0 ? (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center">
          <IconBadge name="event-busy" />
          <Text className="text-sm text-muted mt-3 text-center">
            Brak zapisanych godzin w wybranym okresie.
          </Text>
        </View>
      ) : (
        byEmployee.map((row) => {
          const expanded = expandedEmployeeId === row.employeeId;
          return (
            <View
              key={row.employeeId}
              className="bg-surface border border-border rounded-2xl mb-3 overflow-hidden"
            >
              <Pressable
                onPress={() =>
                  setExpandedEmployeeId(expanded ? null : row.employeeId)
                }
                style={{ flexDirection: "row", alignItems: "center", padding: 14 }}
              >
                <IconBadge name="person" size={20} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text className="text-base font-bold text-foreground">
                    {row.employee?.name || row.employeeId}
                  </Text>
                  <Text className="text-sm text-muted mt-1">
                    {row.hours.toFixed(2)} godz. · {row.daysWorked}{" "}
                    {row.daysWorked === 1 ? "dzień" : "dni"} pracy
                  </Text>
                </View>
                <Text style={{ color: COLORS.primary, fontSize: 16 }}>
                  {expanded ? "▲" : "▼"}
                </Text>
              </Pressable>
              {expanded && (
                <View
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: COLORS.border,
                    padding: 14,
                  }}
                >
                  {row.entries.map((entry, i) => (
                    <View
                      key={entry.id}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        paddingVertical: 8,
                        borderTopWidth: i > 0 ? 1 : 0,
                        borderTopColor: COLORS.border,
                      }}
                    >
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text className="text-sm text-foreground">
                          {entry.date}
                        </Text>
                        <Text className="text-xs text-muted mt-0.5">
                          {builds.find((b) => b.id === entry.buildId)?.name ||
                            "Budowa"}{" "}
                          · {entry.start || "—"}–{entry.end || "—"}
                        </Text>
                      </View>
                      <Text className="text-sm font-bold text-primary">
                        {entry.hours.toFixed(2)} h
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })
      )}
    </>
  );
}
