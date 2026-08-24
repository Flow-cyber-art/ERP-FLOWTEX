import { Pressable, Text, View } from "react-native";
import { COLORS } from "@/components/report-ui";
import { useVersionCheck } from "@/lib/pwa/useVersionCheck";

// Pasek na górze ekranu, gdy /version.json pokaże nowszy build niż ten
// załadowany w przeglądarce (patrz lib/pwa/useVersionCheck.ts). Celowo
// NIE odświeża strony automatycznie — ktoś w środku wypełniania raportu
// dziennego straciłby niezapisaną pracę przy nagłym reloadzie w tle.
export function UpdateAvailableBanner() {
  const { updateAvailable, applyUpdate } = useVersionCheck();

  if (!updateAvailable) return null;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: COLORS.warning,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: COLORS.background, fontSize: 13, fontWeight: "700", flex: 1 }}>
        Dostępna nowa wersja aplikacji.
      </Text>
      <Pressable
        onPress={applyUpdate}
        style={{
          backgroundColor: COLORS.background,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 6,
          marginLeft: 10,
        }}
      >
        <Text style={{ color: COLORS.warning, fontWeight: "700", fontSize: 13 }}>
          Odśwież
        </Text>
      </Pressable>
    </View>
  );
}
