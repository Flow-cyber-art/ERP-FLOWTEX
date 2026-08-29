import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { COLORS, IconBadge, formatPLN } from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

/**
 * Zestawienie obecności: ile dni roboczych/godzin i ile dni urlopu miał
 * każdy pracownik w wybranym okresie (tydzień/miesiąc/rok) — właściciel
 * potrzebuje tego niezależnie od "Rozliczenia godzin" (hr-screen.tsx),
 * które nie zna urlopów. Kalendarz-timeline na dole to celowo prosty
 * zalążek przyszłego modułu planowania — pokazuje per dzień:
 * obecność/urlop/brak, nic więcej na razie. Niezależny od przełącznika
 * okresu wyżej — jeden ciągły pasek dni, żeby dało się przewijać palcem
 * płynnie z miesiąca na miesiąc, bez skoków.
 */

type PeriodMode = "week" | "month" | "year";

const toISO = (d: Date) => d.toISOString().slice(0, 10);
const parseISO = (iso: string) => new Date(iso + "T00:00:00");
const addDays = (iso: string, days: number) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
};
// Tydzień pon–sob, tak samo jak w hr-screen.tsx (praca w budowlance
// zwykle obejmuje sobotę).
const mondayOf = (iso: string) => {
  const d = parseISO(iso);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return toISO(d);
};
const monthLabelPL = (iso: string) =>
  parseISO(iso).toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
const shortLabelPL = (iso: string) =>
  parseISO(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

function countBusinessDaysInRange(from: string, to: string): number {
  const start = parseISO(from);
  const end = parseISO(to);
  if (end < start) return 0;
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function AttendanceSection() {
  const { employees, timeEntries, leaveRequests, workdayHours } = useAppData();
  const [mode, setMode] = useState<PeriodMode>("month");
  const [offset, setOffset] = useState(0);
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);
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
    if (mode === "year") {
      const year = new Date().getFullYear() + offset;
      return {
        rangeStart: `${year}-01-01`,
        rangeEnd: `${year}-12-31`,
        rangeLabel: String(year),
      };
    }
    const base = parseISO(today);
    base.setDate(1);
    base.setMonth(base.getMonth() + offset);
    const first = toISO(base);
    const nextMonth = new Date(base);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const last = toISO(new Date(nextMonth.getTime() - 86400000));
    return { rangeStart: first, rangeEnd: last, rangeLabel: monthLabelPL(first) };
  }, [mode, offset, today]);

  const rows = useMemo(
    () =>
      employees.map((employee) => {
        const entries = timeEntries.filter(
          (e) => e.employeeId === employee.id && e.date >= rangeStart && e.date <= rangeEnd,
        );
        const workedDays = new Set(entries.map((e) => e.date)).size;
        const hours = entries.reduce((sum, e) => sum + e.hours, 0);
        const leaveDays = leaveRequests
          .filter(
            (r) =>
              r.employeeId === employee.id &&
              r.status === "zatwierdzony" &&
              r.dateFrom <= rangeEnd &&
              r.dateTo >= rangeStart,
          )
          .reduce((sum, r) => {
            const from = r.dateFrom > rangeStart ? r.dateFrom : rangeStart;
            const to = r.dateTo < rangeEnd ? r.dateTo : rangeEnd;
            return sum + countBusinessDaysInRange(from, to);
          }, 0);
        return { employee, workedDays, hours, leaveDays };
      }),
    [employees, timeEntries, leaveRequests, rangeStart, rangeEnd],
  );

  return (
    <>
      <View className="bg-surface border border-border rounded-2xl p-2 mb-5">
        <View style={{ flexDirection: "row", gap: 6 }}>
          {(
            [
              ["week", "Tydzień"],
              ["month", "Miesiąc"],
              ["year", "Rok"],
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
                backgroundColor: mode === value ? COLORS.primary : "transparent",
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
        style={{ flexDirection: "row", alignItems: "center", padding: 6 }}
      >
        <Pressable onPress={() => setOffset(offset - 1)} style={{ padding: 10 }}>
          <Text style={{ color: COLORS.primary, fontSize: 18, fontWeight: "800" }}>‹</Text>
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
          <Text style={{ color: COLORS.primary, fontSize: 18, fontWeight: "800" }}>›</Text>
        </Pressable>
      </View>

      <Text className="text-lg font-bold text-foreground mb-3">Obecność wg pracownika</Text>
      {rows.length === 0 ? (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-5">
          <IconBadge name="event-busy" />
          <Text className="text-sm text-muted mt-3 text-center">Brak pracowników.</Text>
        </View>
      ) : (
        rows.map((row) => {
          const expanded = expandedEmployeeId === row.employee.id;
          // Dniówka: godziny z Ustawień × stawka godzinowa — płaci się ją w
          // całości za każdy dzień z choćby jednym wpisem, niezależnie od
          // tego, ile faktycznie godzin tego dnia przepracowano (6 czy 10).
          // Do rozliczenia KOSZTU budowy liczą się realne godziny (patrz
          // settlement-screen.tsx) — to tutaj jest wyłącznie "ile do ręki".
          const dayRate = workdayHours * (row.employee.hourlyRate || 0);
          const payout = row.workedDays * dayRate;
          return (
            <View
              key={row.employee.id}
              className="bg-surface border border-border rounded-2xl mb-3 overflow-hidden"
            >
              <Pressable
                onPress={() => setExpandedEmployeeId(expanded ? null : row.employee.id)}
                style={{ flexDirection: "row", alignItems: "center", padding: 16 }}
              >
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text className="text-base font-bold text-foreground" numberOfLines={1}>
                    {row.employee.name}
                  </Text>
                  <Text className="text-xs text-muted mt-1">
                    {row.hours.toFixed(1)} godz. łącznie
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", marginRight: 18 }}>
                  <Text className="text-xs text-muted uppercase">Robocze</Text>
                  <Text className="text-lg font-bold text-foreground mt-0.5">
                    {row.workedDays}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", marginRight: 10 }}>
                  <Text className="text-xs text-muted uppercase">Urlop</Text>
                  <Text style={{ color: COLORS.primary }} className="text-lg font-bold mt-0.5">
                    {row.leaveDays}
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
                    padding: 16,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <Text className="text-sm text-muted">
                      Dniówka ({workdayHours} godz. × {formatPLN(row.employee.hourlyRate || 0)})
                    </Text>
                    <Text className="text-sm font-bold text-foreground">
                      {formatPLN(dayRate)}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    <Text className="text-sm text-muted">
                      {row.workedDays} {row.workedDays === 1 ? "dniówka" : "dniówek"} w tym
                      okresie
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      paddingTop: 10,
                      borderTopWidth: 1,
                      borderTopColor: COLORS.border,
                    }}
                  >
                    <Text className="text-base font-bold text-foreground">Do wypłaty</Text>
                    <Text style={{ color: COLORS.primary }} className="text-lg font-bold">
                      {formatPLN(payout)}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          );
        })
      )}

      {rows.length > 0 && (
        <MonthTimeline
          today={today}
          rows={rows}
          timeEntries={timeEntries}
          leaveRequests={leaveRequests}
        />
      )}
    </>
  );
}

// Kalendarz-timeline: dla każdego pracownika ciągły pasek dni z kolorem
// (zielony = obecność, niebieski = urlop zatwierdzony, bursztynowy =
// urlop oczekujący, czerwony = brak w dniu roboczym z przeszłości, puste
// = weekend/przyszłość). Celowo NIEZALEŻNY od przełącznika okresu wyżej —
// jeden ciągły ScrollView (±45 dni od dziś), żeby przewijanie palcem
// przechodziło między miesiącami płynnie, bez skoku na "‹ ›". To jest
// CAŁA logika na razie — bez edycji, przeciągania, przypisywania do
// budów; to przyjdzie z modułem planowania.
const TIMELINE_DAYS_BEFORE = 45;
const TIMELINE_DAYS_AFTER = 45;
const TIMELINE_CELL_WIDTH = 22;
const TIMELINE_NAME_WIDTH = 110;
// Wysokości wierszy nagłówka/pracownika — te same stałe po obu stronach
// (kolumna imion poza ScrollView + siatka dni w ScrollView), żeby wiersze
// zgadzały się co do piksela mimo że renderują się w dwóch osobnych
// drzewach.
const TIMELINE_MONTH_ROW_HEIGHT = 16;
const TIMELINE_DAY_ROW_HEIGHT = 16;
const TIMELINE_ROW_HEIGHT = 20;
const TIMELINE_ROW_GAP = 4;

function MonthTimeline({
  today,
  rows,
  timeEntries,
  leaveRequests,
}: {
  today: string;
  rows: { employee: { id: string; name: string } }[];
  timeEntries: { employeeId: string; date: string }[];
  leaveRequests: {
    employeeId: string;
    dateFrom: string;
    dateTo: string;
    status: string;
  }[];
}) {
  const days = useMemo(() => {
    const start = addDays(today, -TIMELINE_DAYS_BEFORE);
    const end = addDays(today, TIMELINE_DAYS_AFTER);
    const list: string[] = [];
    for (let d = parseISO(start); d <= parseISO(end); d.setDate(d.getDate() + 1)) {
      list.push(toISO(d));
    }
    return list;
  }, [today]);

  // Miesiąc pokazany tylko przy jego pierwszym dniu w widocznym zakresie
  // (albo przy samym pierwszym dniu paska, gdy okno zaczyna się w środku
  // miesiąca) — orientacja podczas przewijania bez zaśmiecania każdej
  // kolumny.
  const monthLabels = useMemo(
    () =>
      days
        .map((date, i) => ({ date, i, isFirst: parseISO(date).getDate() === 1 || i === 0 }))
        .filter((d) => d.isFirst),
    [days],
  );

  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    const todayIndex = days.indexOf(today);
    if (todayIndex >= 0) {
      const x = Math.max(0, (todayIndex - 3) * TIMELINE_CELL_WIDTH);
      // Bez animacji — to pozycjonowanie startowe, nie reakcja na akcję
      // użytkownika.
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ x, animated: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const cellColor = (employeeId: string, date: string) => {
    const d = parseISO(date);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const leave = leaveRequests.find(
      (r) =>
        r.employeeId === employeeId &&
        (r.status === "zatwierdzony" || r.status === "oczekujący") &&
        r.dateFrom <= date &&
        r.dateTo >= date,
    );
    if (leave) return leave.status === "zatwierdzony" ? "#2f6f4f" : "#7a6420";
    if (timeEntries.some((e) => e.employeeId === employeeId && e.date === date)) {
      return COLORS.primary;
    }
    if (isWeekend || date > today) return "transparent";
    return "#7a2f2f";
  };

  return (
    <View className="mb-5">
      <Text className="text-lg font-bold text-foreground mb-1">Kalendarz</Text>
      <Text className="text-xs text-muted mb-3">
        Przesuń palcem, żeby zobaczyć inne dni. Zielony = obecność · niebieski = urlop
        zatwierdzony · bursztynowy = urlop oczekujący · czerwony = brak
      </Text>
      {/* Imiona pracowników POZA horyzontalnym ScrollView — osobna, nie
          przewijająca się kolumna po lewej, żeby zostawały widoczne przy
          przesuwaniu dni w prawo. Wysokości wierszy po obu stronach
          (nagłówek miesiąca/dni + wiersz pracownika) muszą się zgadzać
          co do piksela, stąd te same stałe (TIMELINE_*_HEIGHT) w obu. */}
      <View style={{ flexDirection: "row" }}>
        <View
          style={{
            width: TIMELINE_NAME_WIDTH,
            borderRightWidth: 1,
            borderRightColor: COLORS.border,
          }}
        >
          <View style={{ height: TIMELINE_MONTH_ROW_HEIGHT }} />
          <View
            style={{
              height: TIMELINE_DAY_ROW_HEIGHT,
              marginBottom: TIMELINE_ROW_GAP,
            }}
          />
          {rows.map(({ employee }) => (
            <View
              key={employee.id}
              style={{
                height: TIMELINE_ROW_HEIGHT,
                marginBottom: TIMELINE_ROW_GAP,
                justifyContent: "center",
                paddingRight: 8,
              }}
            >
              <Text
                style={{ color: COLORS.foreground, fontSize: 12, fontWeight: "700" }}
                numberOfLines={1}
              >
                {employee.name}
              </Text>
            </View>
          ))}
        </View>
        <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={{ width: days.length * TIMELINE_CELL_WIDTH, height: TIMELINE_MONTH_ROW_HEIGHT }}>
              {monthLabels.map(({ date, i }) => (
                <Text
                  key={date}
                  style={{
                    position: "absolute",
                    left: i * TIMELINE_CELL_WIDTH,
                    color: COLORS.foreground,
                    fontSize: 10,
                    fontWeight: "800",
                    textTransform: "capitalize",
                  }}
                  numberOfLines={1}
                >
                  {monthLabelPL(date).split(" ")[0]}
                </Text>
              ))}
            </View>
            <View
              style={{
                flexDirection: "row",
                height: TIMELINE_DAY_ROW_HEIGHT,
                alignItems: "center",
                marginBottom: TIMELINE_ROW_GAP,
              }}
            >
              {days.map((date) => (
                <View
                  key={date}
                  style={{ width: TIMELINE_CELL_WIDTH, alignItems: "center" }}
                >
                  <Text
                    style={{
                      color: date === today ? COLORS.primary : COLORS.muted,
                      fontSize: 9,
                      fontWeight: date === today ? "800" : "400",
                    }}
                  >
                    {date.slice(8, 10)}
                  </Text>
                </View>
              ))}
            </View>
            {rows.map(({ employee }) => (
              <View
                key={employee.id}
                style={{
                  flexDirection: "row",
                  height: TIMELINE_ROW_HEIGHT,
                  alignItems: "center",
                  marginBottom: TIMELINE_ROW_GAP,
                }}
              >
                {days.map((date) => (
                  <View
                    key={date}
                    style={{ width: TIMELINE_CELL_WIDTH, alignItems: "center" }}
                  >
                    <View
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        backgroundColor: cellColor(employee.id, date),
                        borderWidth: cellColor(employee.id, date) === "transparent" ? 1 : 0,
                        borderColor: COLORS.border,
                      }}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
