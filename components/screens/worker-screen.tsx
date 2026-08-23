import {
  Pressable,
  Text,
  View,
} from "react-native";
import {
  COLORS,
  ScreenHeader,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

export function WorkerScreen() {
  const {
    workerPeriod,
    workerEmployeeId,
    builds,
    employees,
    setWorkerPeriod,
    workerEntries,
    workerChart,
  } = useAppData();

  return (
    <>
  <>
    <ScreenHeader
      title="Mój czas pracy"
      description="Podgląd własnych godzin. Ten widok nie pozwala edytować wpisów."
    />
    <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
      <Text className="text-xs text-muted uppercase">Okres</Text>
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 10,
        }}
      >
        {(["Dzień", "Tydzień", "Miesiąc", "Rok"] as const).map(
          (period) => (
            <Pressable
              key={period}
              onPress={() => setWorkerPeriod(period)}
              style={{
                backgroundColor:
                  workerPeriod === period
                    ? COLORS.primary
                    : COLORS.background,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor:
                  workerPeriod === period
                    ? COLORS.primary
                    : COLORS.border,
              }}
            >
              <Text
                style={{
                  color:
                    workerPeriod === period
                      ? COLORS.background
                      : COLORS.foreground,
                  fontWeight: "700",
                }}
              >
                {period}
              </Text>
            </Pressable>
          ),
        )}
      </View>
    </View>
    <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
      <Text className="text-xs text-muted uppercase">
        Podsumowanie
      </Text>
      <Text className="text-3xl font-bold text-foreground mt-2">
        {workerEntries
          .reduce((sum, entry) => sum + entry.hours, 0)
          .toFixed(2)}{" "}
        godz.
      </Text>
      <Text className="text-sm text-muted mt-1">
        {employees.find(
          (employee) => employee.id === workerEmployeeId,
        )?.name || "Pracownik"}{" "}
        · okres: {workerPeriod.toLowerCase()}
      </Text>
      <Text className="text-base font-bold text-primary mt-3">
        {new Set(workerEntries.map((entry) => entry.date)).size} dni
        pracy
      </Text>
    </View>
    <View className="bg-surface border border-border rounded-2xl p-4 mb-5">
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
        {workerChart.length ? (
          workerChart.map((item) => {
            const maxHours = Math.max(
              1,
              ...workerChart.map((bar) => bar.hours),
            );
            const barHeight = Math.max(
              8,
              (item.hours / maxHours) * 112,
            );
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
                    borderRadius: 6,
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
            Brak danych do wykresu w wybranym okresie.
          </Text>
        )}
      </View>
    </View>
    <Text className="text-lg font-bold text-foreground mb-3">
      Wpisy czasu
    </Text>
    {workerEntries.length ? (
      workerEntries.map((entry) => (
        <View
          key={entry.id}
          className="bg-surface border border-border rounded-2xl p-4 mb-3"
        >
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
              {entry.date}
            </Text>
            <Text
              className="text-base font-bold text-primary"
              style={{ flexShrink: 0 }}
            >
              {entry.hours.toFixed(2)} godz.
            </Text>
          </View>
          <Text className="text-sm text-muted mt-2">
            {entry.start || "—"} – {entry.end || "—"}
          </Text>
          <Text className="text-xs text-muted mt-2">
            {builds.find((build) => build.id === entry.buildId)
              ?.name || "Budowa"}
          </Text>
        </View>
      ))
    ) : (
      <View className="bg-surface border border-border rounded-2xl p-4">
        <Text className="text-sm text-muted">
          Brak zapisanych wpisów w wybranym okresie.
        </Text>
      </View>
    )}
  </>
    </>
  );
}
