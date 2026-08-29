import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { Button, COLORS, IconBadge, formatPLN } from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

/**
 * "Rozliczenie" (HR) — połączenie dawnych osobnych "Rozliczenie godzin"
 * (hr-screen.tsx) i "Obecności" (attendance-screen.tsx), które pokazywały
 * w dużej mierze te same dane w dwóch miejscach. Jedno źródło prawdy:
 * ile dniówek, ile urlopu, ile do wypłaty i czy dniówki są już
 * zatwierdzone (patrz "zamknięta" niżej), per pracownik, w wybranym
 * okresie — z widokiem listy i widokiem kalendarza.
 *
 * "Zatwierdzona dniówka" to NIE nowa kolumna w bazie — to pochodna
 * istniejącego statusu raportu dziennego (reports.status, patrz
 * savedReports w app-data.tsx): dniówka pracownika na dany dzień liczy
 * się za zatwierdzoną, gdy WSZYSTKIE raporty obejmujące go tego dnia mają
 * status "approved". Dzięki temu zatwierdzanie tutaj to dokładnie ta sama
 * operacja co "Zatwierdź" w Raportach (approveReport) — jeden mechanizm,
 * dwa miejsca wejścia.
 */

type PeriodMode = "week" | "month" | "year";
type ViewMode = "list" | "calendar";

const toISO = (d: Date) => d.toISOString().slice(0, 10);
const parseISO = (iso: string) => new Date(iso + "T00:00:00");
const addDays = (iso: string, days: number) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
};
// Tydzień pon–sob (praca w budowlance zwykle obejmuje sobotę).
const mondayOf = (iso: string) => {
  const d = parseISO(iso);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return toISO(d);
};
const dateLabelPL = (iso: string) =>
  parseISO(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
const monthLabelPL = (iso: string) =>
  parseISO(iso).toLocaleDateString("pl-PL", { month: "long", year: "numeric" });

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

export function PayrollSection() {
  const { employees, timeEntries, leaveRequests, savedReports, workdayHours, approveReport } =
    useAppData();
  const [mode, setMode] = useState<PeriodMode>("month");
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<ViewMode>("list");
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);
  const today = toISO(new Date());

  const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
    if (mode === "week") {
      const monday = addDays(mondayOf(today), offset * 7);
      const saturday = addDays(monday, 5);
      return {
        rangeStart: monday,
        rangeEnd: saturday,
        rangeLabel: `${dateLabelPL(monday)} – ${dateLabelPL(saturday)}`,
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
    return {
      rangeStart: first,
      rangeEnd: last,
      rangeLabel: `${dateLabelPL(first)} – ${dateLabelPL(last)}`,
    };
  }, [mode, offset, today]);

  // Raporty (buildId+date+status+people[]) obejmujące dany dzień — źródło
  // statusu zatwierdzenia. Jeden dzień może mieć kilka raportów (kilka
  // budów naraz), stąd grupowanie po dacie.
  const reportsByDate = useMemo(() => {
    const map = new Map<string, typeof savedReports>();
    for (const r of savedReports) {
      if (r.date < rangeStart || r.date > rangeEnd) continue;
      const bucket = map.get(r.date) ?? [];
      bucket.push(r);
      map.set(r.date, bucket);
    }
    return map;
  }, [savedReports, rangeStart, rangeEnd]);

  const rows = useMemo(
    () =>
      employees.map((employee) => {
        const entries = timeEntries.filter(
          (e) => e.employeeId === employee.id && e.date >= rangeStart && e.date <= rangeEnd,
        );
        const dates = Array.from(new Set(entries.map((e) => e.date))).sort();
        const hours = entries.reduce((sum, e) => sum + e.hours, 0);

        // Dla każdego dnia z wpisem: zatwierdzony, gdy WSZYSTKIE raporty
        // tego dnia obejmujące tego pracownika mają status "approved".
        const dayLocks = dates.map((date) => {
          const reportsThatDay = (reportsByDate.get(date) ?? []).filter((r) =>
            r.people.some((p) => p.employeeId === employee.id),
          );
          const approved =
            reportsThatDay.length > 0 && reportsThatDay.every((r) => r.status === "approved");
          const openReportIds = reportsThatDay
            .filter((r) => r.status !== "approved")
            .map((r) => r.id);
          return { date, approved, openReportIds };
        });
        const approvedDays = dayLocks.filter((d) => d.approved).length;
        const openReportIds = Array.from(
          new Set(dayLocks.flatMap((d) => d.openReportIds)),
        );

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

        const expectedDays = countBusinessDaysInRange(rangeStart, rangeEnd);
        const missingDays = Math.max(0, expectedDays - dates.length - leaveDays);

        // Dniówka: godziny z Ustawień × stawka godzinowa — płaci się w
        // całości za każdy dzień z choćby jednym wpisem, niezależnie od
        // tego, ile faktycznie godzin tego dnia przepracowano. Do kosztu
        // budowy liczą się realne godziny (patrz settlement-screen.tsx) —
        // to tutaj jest wyłącznie "ile do ręki".
        const dayRate = workdayHours * (employee.hourlyRate || 0);
        const payout = dates.length * dayRate;

        return {
          employee,
          workedDays: dates.length,
          approvedDays,
          hours,
          leaveDays,
          missingDays,
          payout,
          dayRate,
          dayLocks,
          openReportIds,
        };
      }),
    [employees, timeEntries, leaveRequests, reportsByDate, rangeStart, rangeEnd, workdayHours],
  );

  const totals = rows.reduce(
    (acc, r) => ({
      workedDays: acc.workedDays + r.workedDays,
      leaveDays: acc.leaveDays + r.leaveDays,
      missingDays: acc.missingDays + r.missingDays,
      payout: acc.payout + r.payout,
    }),
    { workedDays: 0, leaveDays: 0, missingDays: 0, payout: 0 },
  );

  return (
    <>
      <View className="bg-surface border border-border rounded-2xl p-2 mb-3">
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
          <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 14 }}>
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
        {offset !== 0 && (
          <Pressable
            onPress={() => setOffset(0)}
            style={{
              marginLeft: 6,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: COLORS.border,
            }}
          >
            <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "700" }}>Dziś</Text>
          </Pressable>
        )}
      </View>

      {/* Cztery kafelki podsumowania — to samo, co i tak jest w tabeli
          niżej, tylko zsumowane, żeby nie liczyć w głowie. */}
      <View
        className="bg-surface border border-border rounded-2xl mb-5"
        style={{ flexDirection: "row", flexWrap: "wrap", overflow: "hidden" }}
      >
        {(
          [
            ["DNIÓWKI", String(totals.workedDays), COLORS.foreground],
            ["DO WYPŁATY", formatPLN(totals.payout), COLORS.primary],
            ["URLOP", String(totals.leaveDays), COLORS.foreground],
            ["BRAK WPISU", String(totals.missingDays), totals.missingDays > 0 ? COLORS.warning : COLORS.foreground],
          ] as const
        ).map(([label, value, color], i) => (
          <View
            key={label}
            style={{
              flexBasis: "50%",
              padding: 14,
              borderLeftWidth: i % 2 === 1 ? 1 : 0,
              borderTopWidth: i >= 2 ? 1 : 0,
              borderColor: COLORS.border,
            }}
          >
            <Text className="text-xs text-muted uppercase">{label}</Text>
            <Text style={{ color, fontWeight: "800", fontSize: 20, marginTop: 2 }}>
              {value}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}>
        {(
          [
            ["list", "Lista"],
            ["calendar", "Kalendarz"],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => setView(value)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: view === value ? COLORS.primary : COLORS.border,
              backgroundColor: view === value ? COLORS.primary : "transparent",
            }}
          >
            <Text
              style={{
                color: view === value ? COLORS.background : COLORS.muted,
                fontWeight: "700",
                fontSize: 13,
              }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {view === "calendar" ? (
        rows.length > 0 && (
          <MonthTimeline today={today} rows={rows} timeEntries={timeEntries} leaveRequests={leaveRequests} />
        )
      ) : rows.length === 0 ? (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-5">
          <IconBadge name="event-busy" />
          <Text className="text-sm text-muted mt-3 text-center">Brak pracowników.</Text>
        </View>
      ) : (
        <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-5">
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: COLORS.border,
            }}
          >
            <Text style={PAY_TABLE_HEADER}>PRACOWNIK</Text>
            <Text style={[PAY_TABLE_HEADER, PAY_COL_NUMERIC]}>DNIÓWKI</Text>
            <Text style={[PAY_TABLE_HEADER, PAY_COL_NUMERIC]}>URLOP</Text>
            <Text style={[PAY_TABLE_HEADER, PAY_COL_STATUS]}>STATUS</Text>
            <Text style={[PAY_TABLE_HEADER, PAY_COL_NUMERIC]}>DO WYPŁATY</Text>
            <View style={{ width: 20 }} />
          </View>

          {rows.map((row) => {
            const expanded = expandedEmployeeId === row.employee.id;
            return (
              <View
                key={row.employee.id}
                style={{ borderTopWidth: 1, borderTopColor: COLORS.border }}
              >
                <Pressable
                  onPress={() =>
                    setExpandedEmployeeId(expanded ? null : row.employee.id)
                  }
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    minHeight: 44,
                  }}
                >
                  <Text style={PAY_COL_NAME} numberOfLines={1}>
                    {row.employee.name}
                  </Text>
                  <Text style={[PAY_CELL, PAY_COL_NUMERIC]}>{row.workedDays}</Text>
                  <Text style={[PAY_CELL, PAY_COL_NUMERIC]}>{row.leaveDays}</Text>
                  <View style={PAY_COL_STATUS}>
                    {row.workedDays === 0 ? (
                      <Text style={{ color: COLORS.muted, fontSize: 12, textAlign: "right" }}>
                        brak
                      </Text>
                    ) : (
                      <Text
                        style={{
                          color: row.approvedDays === row.workedDays ? COLORS.primary : COLORS.warning,
                          fontSize: 12,
                          fontWeight: "700",
                          textAlign: "right",
                        }}
                      >
                        🔒 {row.approvedDays}/{row.workedDays}
                      </Text>
                    )}
                  </View>
                  <Text style={[PAY_CELL, PAY_COL_NUMERIC, { color: COLORS.primary }]}>
                    {row.payout > 0 ? formatPLN(row.payout) : "—"}
                  </Text>
                  <Text style={{ width: 20, textAlign: "right", color: COLORS.primary, fontSize: 14 }}>
                    {expanded ? "▲" : "▼"}
                  </Text>
                </Pressable>

                {expanded && (
                  <View style={{ borderTopWidth: 1, borderTopColor: COLORS.border, padding: 14 }}>
                    {row.dayLocks.length === 0 ? (
                      <Text className="text-sm text-muted">Brak wpisów w tym okresie.</Text>
                    ) : (
                      row.dayLocks.map((day) => (
                        <View
                          key={day.date}
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            paddingVertical: 6,
                          }}
                        >
                          <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                            {day.approved ? "🔒 " : ""}
                            {dateLabelPL(day.date)}
                          </Text>
                          <Text style={{ color: COLORS.foreground, fontSize: 12 }}>
                            {formatPLN(row.dayRate)}
                          </Text>
                        </View>
                      ))
                    )}
                    {row.openReportIds.length > 0 && (
                      <View style={{ marginTop: 10 }}>
                        <Button
                          label={`✓ Zatwierdź pozostałe ${row.openReportIds.length}`}
                          onPress={() => row.openReportIds.forEach((id) => approveReport(id))}
                        />
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {/* RAZEM — suma na dole tabeli, nie tylko w kafelkach u góry. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderTopWidth: 1,
              borderTopColor: COLORS.border,
              backgroundColor: COLORS.background,
            }}
          >
            <Text style={[PAY_COL_NAME, { fontWeight: "800" }]}>RAZEM</Text>
            <Text style={[PAY_CELL, PAY_COL_NUMERIC, { fontWeight: "800" }]}>
              {totals.workedDays}
            </Text>
            <Text style={[PAY_CELL, PAY_COL_NUMERIC, { fontWeight: "800" }]}>
              {totals.leaveDays}
            </Text>
            <View style={PAY_COL_STATUS} />
            <Text
              style={[PAY_CELL, PAY_COL_NUMERIC, { fontWeight: "800", color: COLORS.primary }]}
            >
              {formatPLN(totals.payout)}
            </Text>
            <View style={{ width: 20 }} />
          </View>
        </View>
      )}
    </>
  );
}

const PAY_COL_NUMERIC = { flex: 1, textAlign: "right" as const };
const PAY_COL_STATUS = { flex: 1.3, alignItems: "flex-end" as const };
const PAY_TABLE_HEADER = { color: COLORS.muted, fontSize: 10, fontWeight: "700" as const, flex: 2 };
const PAY_CELL = { color: COLORS.foreground, fontSize: 12, fontWeight: "700" as const };
const PAY_COL_NAME = { flex: 2, color: COLORS.foreground, fontSize: 13, fontWeight: "700" as const };

// Kalendarz-timeline: dla każdego pracownika ciągły pasek dni z kolorem
// (zielony = obecność, niebieski = urlop zatwierdzony, bursztynowy =
// urlop oczekujący, czerwony = brak w dniu roboczym z przeszłości, puste
// = weekend/przyszłość). Celowo NIEZALEŻNY od przełącznika okresu wyżej —
// jeden ciągły ScrollView (±45 dni od dziś), żeby przewijanie palcem
// przechodziło między miesiącami płynnie, bez skoku na "‹ ›".
const TIMELINE_DAYS_BEFORE = 45;
const TIMELINE_DAYS_AFTER = 45;
const TIMELINE_CELL_WIDTH = 22;
const TIMELINE_NAME_WIDTH = 110;
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
      <Text className="text-xs text-muted mb-3">
        Przesuń palcem, żeby zobaczyć inne dni. Zielony = obecność · niebieski = urlop
        zatwierdzony · bursztynowy = urlop oczekujący · czerwony = brak
      </Text>
      <View style={{ flexDirection: "row" }}>
        <View
          style={{
            width: TIMELINE_NAME_WIDTH,
            borderRightWidth: 1,
            borderRightColor: COLORS.border,
          }}
        >
          <View style={{ height: TIMELINE_MONTH_ROW_HEIGHT }} />
          <View style={{ height: TIMELINE_DAY_ROW_HEIGHT, marginBottom: TIMELINE_ROW_GAP }} />
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
            <View
              style={{
                width: days.length * TIMELINE_CELL_WIDTH,
                height: TIMELINE_MONTH_ROW_HEIGHT,
              }}
            >
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
                <View key={date} style={{ width: TIMELINE_CELL_WIDTH, alignItems: "center" }}>
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
                  <View key={date} style={{ width: TIMELINE_CELL_WIDTH, alignItems: "center" }}>
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
