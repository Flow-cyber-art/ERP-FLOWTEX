import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/components/report-ui";
import { useVersionCheck } from "@/lib/pwa/useVersionCheck";

// Pasek na górze ekranu, gdy /version.json pokaże nowszy build niż ten
// załadowany w przeglądarce (patrz lib/pwa/useVersionCheck.ts). Celowo
// NIE odświeża strony automatycznie — ktoś w środku wypełniania raportu
// dziennego straciłby niezapisaną pracę przy nagłym reloadzie w tle.
export function UpdateAvailableBanner() {
  const { updateAvailable, applyUpdate } = useVersionCheck();
  // Banner renderuje się w app/_layout.tsx NAD Stackiem, poza
  // ScreenContainerem każdego ekranu (patrz components/screen-container.tsx),
  // więc nie dziedziczy jego SafeAreaView — bez własnego insets.top
  // nachodził na pasek statusu/zegar na telefonie.
  const insets = useSafeAreaInsets();

  if (!updateAvailable) return null;

  return (
    // Tło paska rozciąga się na całą szerokość (jak pasek statusu), ale
    // TREŚĆ wewnątrz trzyma się tego samego ograniczenia szerokości co
    // reszta appki na desktopie (ScreenContainer: lg:max-w-[1040px]
    // lg:self-center, patrz components/screen-container.tsx) — inaczej na
    // szerokim ekranie pasek wyglądał inaczej (od krawędzi do krawędzi)
    // niż treść pod nim (wyśrodkowana, węższa).
    <View style={{ backgroundColor: COLORS.warning, paddingTop: insets.top }}>
      <View
        className="w-full lg:max-w-[1040px] lg:self-center"
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
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
    </View>
  );
}
