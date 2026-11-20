import { Pressable, Text, View } from "react-native";
import { useMemo, useState } from "react";
import {
  COLORS,
  Button,
  IconBadge,
  ScreenHeader,
  todayISO,
  SegmentedControl,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";
import { LeavePendingApprovals } from "@/components/screens/leave-screen";
import { RADIUS } from "@/constants/radius";
import { Icon } from "@/components/icon";
import { useWideLayout } from "@/hooks/use-wide-layout";

export function TeamTimeScreen() {
  const isWide = useWideLayout();
  const { builds, employees, timeEntries, myEmployeeId } = useAppData();

  // Brygadzista ma tu widzieć nie tylko czas swoich Pracowników, ale też
  // WŁASNY (dopisuje siebie do "osób pracujących" w raporcie dziennym,
  // patrz addPersonToDraft — to generuje jego własny time_entries).
  // Wcześniej lista (domyślna i w pickerze) obejmowała wyłącznie rolę
  // "Pracownik", więc własne wpisy brygadzisty nigdy się tu nie
  // pojawiały, mimo że realnie istnieją w bazie.
  const selectableEmployees = useMemo(
    () =>
      employees.filter(
        (employee) => employee.role === "Pracownik" || employee.id === myEmployeeId,
      ),
    [employees, myEmployeeId],
  );

  const [teamPeriod, setTeamPeriod] = useState<
    "Dzień" | "Tydzień" | "Miesiąc" | "Rok"
  >("Dzień");
  const [supervisedEmployeeIds, setSupervisedEmployeeIds] = useState(() =>
    employees
      .filter((employee) => employee.role === "Pracownik" || employee.id === myEmployeeId)
      .map((employee) => employee.id),
  );
  const [supervisorPickerOpen, setSupervisorPickerOpen] = useState(false);
  const teamEntries = useMemo(() => {
    const today = new Date();
    return timeEntries.filter((entry) => {
      if (!supervisedEmployeeIds.includes(entry.employeeId)) return false;
      const date = new Date(`${entry.date}T12:00:00`);
      if (teamPeriod === "Dzień") return entry.date === todayISO();
      if (teamPeriod === "Rok")
        return date.getFullYear() === today.getFullYear();
      if (teamPeriod === "Miesiąc")
        return (
          date.getFullYear() === today.getFullYear() &&
          date.getMonth() === today.getMonth()
        );
      const difference = Math.round(
        (today.getTime() - date.getTime()) / 86400000,
      );
      return difference >= 0 && difference < 7;
    });
  }, [timeEntries, supervisedEmployeeIds, teamPeriod]);
  const teamChart = useMemo(() => {
    const grouped = new Map<string, number>();
    teamEntries.forEach((entry) =>
      grouped.set(entry.date, (grouped.get(entry.date) || 0) + entry.hours),
    );
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([date, hours]) => ({ date, hours }));
  }, [teamEntries]);

  const selectedEmployee = employees.find(
    (employee) => employee.id === supervisedEmployeeIds[0],
  );

  return (
    <>
      <ScreenHeader
        title="Czas pracy zespołu"
        description="Wybierz jednego pracownika, aby zobaczyć jego indywidualną ewidencję."
      />

      <LeavePendingApprovals />

      <View className="bg-surface border border-border rounded-card overflow-hidden mb-5">
        <Pressable
          onPress={() => setSupervisorPickerOpen(!supervisorPickerOpen)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            padding: 16,
          }}
        >
          <IconBadge name="user" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: COLORS.muted, fontSize: 11 }}>
              PRACOWNIK
            </Text>
            <Text
              style={{
                color: COLORS.foreground,
                fontWeight: "700",
                fontSize: 16,
                marginTop: 2,
              }}
            >
              {selectedEmployee?.name || "Wybierz pracownika"}
            </Text>
          </View>
          <Icon name={supervisorPickerOpen ? "chevron-up" : "chevron-down"} size={18} color={COLORS.muted} />
        </Pressable>
        {supervisorPickerOpen && (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: COLORS.border,
              padding: 10,
            }}
          >
            {selectableEmployees.map((employee) => (
                <Pressable
                  key={employee.id}
                  onPress={() => {
                    setSupervisedEmployeeIds([employee.id]);
                    setSupervisorPickerOpen(false);
                  }}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: COLORS.border,
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      color: COLORS.foreground,
                      fontWeight: "700",
                    }}
                  >
                    {employee.name}
                  </Text>
                  <Icon
 name={supervisedEmployeeIds[0] === employee.id ? "check-circle" : "circle"}
 size={18}
 color={supervisedEmployeeIds[0] === employee.id ? COLORS.primary : COLORS.muted}
 />
                </Pressable>
              ))}
            <View style={{ marginTop: 10 }}>
              <Button
                label="Zamknij wybór"
                onPress={() => setSupervisorPickerOpen(false)}
                secondary
              />
            </View>
          </View>
        )}
      </View>

      <View
        className="bg-surface border border-border rounded-card mb-5"
        style={{ flexDirection: "row", overflow: "hidden" }}
      >
        <View style={{ flex: 1, padding: 16 }}>
          <Text className="text-xs text-muted uppercase">Suma godzin</Text>
          <Text className="text-3xl font-bold text-foreground mt-1">
            {teamEntries
              .reduce((sum, entry) => sum + entry.hours, 0)
              .toFixed(2)}
          </Text>
        </View>
        <View style={{ width: 1, backgroundColor: COLORS.border }} />
        <View style={{ flex: 1, padding: 16 }}>
          <Text className="text-xs text-muted uppercase">Dni pracy</Text>
          <Text
            style={{ color: COLORS.primary }}
            className="text-3xl font-bold mt-1"
          >
            {new Set(teamEntries.map((entry) => entry.date)).size}
          </Text>
        </View>
      </View>

      <View className="bg-surface border border-border rounded-card p-4 mb-5">
        <Text className="text-xs text-muted uppercase mb-2">Okres</Text>
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <SegmentedControl
            options={(["Dzień", "Tydzień", "Miesiąc", "Rok"] as const).map((period) => ({ key: period, label: period }))}
            value={teamPeriod}
            onChange={setTeamPeriod}
          />
        </View>
      </View>

      <View className="bg-surface border border-border rounded-card p-4 mb-5">
        <View className="flex-row justify-between items-center">
          <Text className="text-xs text-muted uppercase">
            Godziny w okresie
          </Text>
          <Text className="text-xs text-primary font-bold">
            słupki dzienne
          </Text>
        </View>
        <View
          style={{
            height: 150,
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 10,
            marginTop: 18,
            borderBottomWidth: 1,
            borderBottomColor: COLORS.border,
            paddingHorizontal: 4,
          }}
        >
          {teamChart.length ? (
            teamChart.map((item) => {
              const maxHours = Math.max(1, ...teamChart.map((bar) => bar.hours));
              const barHeight = Math.max(8, (item.hours / maxHours) * 112);
              return (
                <View
                  key={item.date}
                  style={{
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "flex-end",
                    height: 132,
                  }}
                >
                  <Text
                    style={{
                      color: COLORS.foreground,
                      fontSize: 10,
                      fontWeight: "700",
                      marginBottom: 5,
                    }}
                  >
                    {item.hours.toFixed(1)}
                  </Text>
                  <View
                    style={{
                      width: "70%",
                      maxWidth: 34,
                      height: barHeight,
                      backgroundColor: COLORS.primary,
                      borderRadius: RADIUS.chip,
                    }}
                  />
                  <Text
                    style={{
                      color: COLORS.muted,
                      fontSize: 9,
                      marginTop: 7,
                    }}
                  >
                    {item.date.slice(5)}
                  </Text>
                </View>
              );
            })
          ) : (
            <Text className="text-sm text-muted">
              Brak danych dla wybranych osób.
            </Text>
          )}
        </View>
      </View>

      <Text className="text-lg font-bold text-foreground mb-3">
        Wpisy zespołu
      </Text>
      {teamEntries.length ? (
        <>
          {isWide && (
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 }}>
              <Text style={{ flex: 2, color: COLORS.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Pracownik</Text><Text style={{ width: 110, color: COLORS.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Data</Text><Text style={{ width: 130, color: COLORS.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Godziny</Text><Text style={{ flex: 2, color: COLORS.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Budowa</Text><Text style={{ width: 90, textAlign: "right", color: COLORS.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Czas</Text>
            </View>
          )}
          {teamEntries.map((entry) => (
          <View
            key={entry.id}
            className={isWide ? "bg-surface border border-border rounded-card px-4 py-3 mb-2" : "bg-surface border border-border rounded-card p-4 mb-3"}
            style={{ flexDirection: "row", alignItems: "center" }}
          >
            {isWide ? (
              <>
                <Text style={{ flex: 2, color: COLORS.foreground, fontSize: 14, fontWeight: "700" }} numberOfLines={1}>
                  {employees.find((employee) => employee.id === entry.employeeId)?.name || "Pracownik"}
                </Text>
                <Text style={{ width: 110, color: COLORS.foreground, fontSize: 13 }}>{entry.date}</Text>
                <Text style={{ width: 130, color: COLORS.muted, fontSize: 13 }}>
                  {entry.start || "—"} – {entry.end || "—"}
                </Text>
                <Text style={{ flex: 2, color: COLORS.muted, fontSize: 13 }} numberOfLines={1}>
                  {builds.find((build) => build.id === entry.buildId)?.name || "Budowa"}
                </Text>
                <Text style={{ width: 90, textAlign: "right", color: COLORS.foreground, fontSize: 14, fontWeight: "700" }}>
                  {entry.hours.toFixed(2)} godz.
                </Text>
              </>
            ) : (
              <>
            <IconBadge name="clock" size={20} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text
                  className="text-base font-bold text-foreground"
                  numberOfLines={1}
                  style={{ flex: 1, marginRight: 8 }}
                >
                  {employees.find((employee) => employee.id === entry.employeeId)
                    ?.name || "Pracownik"}
                </Text>
                <Text
                  className="text-base font-bold text-primary"
                  style={{ flexShrink: 0 }}
                >
                  {entry.hours.toFixed(2)} godz.
                </Text>
              </View>
              <Text className="text-sm text-muted mt-1">
                {entry.date} · {entry.start || "—"} – {entry.end || "—"}
              </Text>
              <Text className="text-xs text-muted mt-1">
                {builds.find((build) => build.id === entry.buildId)?.name ||
                  "Budowa"}
              </Text>
            </View>
              </>
            )}
          </View>
        ))}
        </>
      ) : (
        <View className="bg-surface border border-border rounded-card p-5 items-center">
          <IconBadge name="calendar" />
          <Text className="text-sm text-muted mt-3 text-center">
            Brak zapisanych wpisów dla wybranych osób.
          </Text>
        </View>
      )}
    </>
  );
}
