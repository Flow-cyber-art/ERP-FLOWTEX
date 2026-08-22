import {
  Text,
  View,
} from "react-native";
import {
  todayLabelPL,
  Button,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

export function StartScreen() {
  const {
    materials,
    builds,
    setTab,
    buildAssignments,
  } = useAppData();

  return (
    <>
  <>
    <Text className="text-xs tracking-widest text-primary font-bold">
      FLOWTEX / OPERATIONS
    </Text>
    <Text className="text-3xl font-bold text-foreground mt-2">
      Dzień dobry, brygadzisto.
    </Text>
    <Text className="text-sm text-muted mt-1 mb-6">
      {todayLabelPL()}
    </Text>
    <View className="bg-surface border border-border rounded-3xl p-5 mb-4">
      <Text className="text-xs text-muted">RAPORT DZIENNY</Text>
      <Text className="text-xl font-bold text-foreground mt-2">
        {buildAssignments.length} materiały do rozliczenia
      </Text>
      <View style={{ marginTop: 15 }}>
        <Button
          label="Uzupełnij raport"
          onPress={() => setTab("report")}
        />
      </View>
    </View>
    <View className="flex-row gap-3 mb-5">
      <View className="flex-1 bg-surface border border-border rounded-2xl p-4">
        <Text className="text-xs text-muted">Materiały</Text>
        <Text className="text-3xl font-bold text-foreground mt-2">
          {materials.length}
        </Text>
        <Text className="text-xs text-warning mt-1">
          {materials.filter((m) => m.stock <= m.min).length} niski
          stan
        </Text>
      </View>
      <View className="flex-1 bg-surface border border-border rounded-2xl p-4">
        <Text className="text-xs text-muted">Aktywne budowy</Text>
        <Text className="text-3xl font-bold text-foreground mt-2">
          {builds.length}
        </Text>
        <Text className="text-xs text-muted mt-1">w realizacji</Text>
      </View>
    </View>
    <Text className="text-lg font-bold text-foreground mb-3">
      Aktywne budowy
    </Text>
    {builds.slice(0, 2).map((b) => (
      <View
        key={b.id}
        className="bg-surface border border-border rounded-2xl p-4 mb-3"
      >
        <Text className="text-xs text-primary font-bold">
          {b.number}
        </Text>
        <Text className="text-base font-bold text-foreground mt-1">
          {b.name}
        </Text>
        <Text className="text-xs text-muted mt-2">
          Odpowiedzialny: {b.manager}
        </Text>
      </View>
    ))}
  </>
    </>
  );
}
