import { useMemo, useState } from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { COLORS, IconBadge } from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

/**
 * Zestawienie obecności: ile dni roboczych/godzin i ile dni urlopu miał
 * każdy pracownik w wybranym okresie (tydzień/miesiąc/rok) — właściciel
 * potrzebuje tego niezależnie od "Rozliczenia godzin" (hr-screen.tsx),
 * które nie zna urlopów. Kalendarz-timeline na dole (tylko w widoku
 * Miesiąc) to celowo prosty zalążek przyszłego modułu planowania —
 * pokazuje per dzień: obecność/urlop/brak, nic więcej na razie.
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
  const { employees, timeEntries, leaveRequests } = useAppData();
  const [mode, setMode] = useState<PeriodMode>("month");
  const [offset, setOffset] = useState(0);
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
        rows.map((row) => (
          <View
            key={row.employee.id}
            className="bg-surface border border-border rounded-2xl p-4 mb-3"
            style={{ flexDirection: "row", alignItems: "center" }}
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
            <View style={{ alignItems: "flex-end" }}>
              <Text className="text-xs text-muted uppercase">Urlop</Text>
              <Text style={{ color: COLORS.primary }} className="text-lg font-bold mt-0.5">
                {row.leaveDays}
              </Text>
            </View>
          </View>
        ))
      )}

      {mode === "month" && rows.length > 0 && (
        <MonthTimeline
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          today={today}
          rows={rows}
          timeEntries={timeEntries}
          leaveRequests={leaveRequests}
        />
      )}
    </>
  );
}

// Kalendarz-timeline: dla każdego pracownika pasek dni miesiąca z kolorem
// (zielony = obecność, niebieski = urlop zatwierdzony, bursztynowy =
// urlop oczekujący, czerwony = brak w dniu roboczym z przeszłości, szary
// = weekend/przyszłość). To jest CAŁA logika na razie — bez edycji,
// przeciągania, przypisywania do budów; to przyjdzie z modułem planowania.
function MonthTimeline({
  rangeStart,
  rangeEnd,
  today,
  rows,
  timeEntries,
  leaveRequests,
}: {
  rangeStart: string;
  rangeEnd: string;
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
    const list: string[] = [];
    for (let d = parseISO(rangeStart); d <= parseISO(rangeEnd); d.setDate(d.getDate() + 1)) {
      list.push(toISO(d));
    }
    return list;
  }, [rangeStart, rangeEnd]);

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
      <Text className="text-lg font-bold text-foreground mb-1">Kalendarz miesiąca</Text>
      <Text className="text-xs text-muted mb-3">
        Zielony = obecność · niebieski = urlop zatwierdzony · bursztynowy = urlop oczekujący ·
        czerwony = brak
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={{ flexDirection: "row", marginBottom: 4 }}>
            <View style={{ width: 110 }} />
            {days.map((date) => (
              <View key={date} style={{ width: 22, alignItems: "center" }}>
                <Text style={{ color: COLORS.muted, fontSize: 9 }}>
                  {date.slice(8, 10)}
                </Text>
              </View>
            ))}
          </View>
          {rows.map(({ employee }) => (
            <View
              key={employee.id}
              style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}
            >
              <Text
                style={{ width: 110, color: COLORS.foreground, fontSize: 12, fontWeight: "700" }}
                numberOfLines={1}
              >
                {employee.name}
              </Text>
              {days.map((date) => (
                <View key={date} style={{ width: 22, alignItems: "center" }}>
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
  );
}
