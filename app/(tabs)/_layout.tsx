import { Tabs } from "expo-router";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

/**
 * Pasek zakładek Expo Router jest tu CELOWO wyłączony
 * (tabBarStyle: { display: "none" }) — całą nawigację (dolny pasek na
 * mobile / sidebar na desktopie) renderuje app/(tabs)/index.tsx.
 *
 * Usunięte względem poprzedniej wersji:
 *   - useSafeAreaInsets() + bottomPadding + tabBarHeight  -> martwy kod,
 *     nigdzie nie używany (pasek i tak ma display:none).
 * Dodane:
 *   - sceneStyle z tłem motywu: domyślny kontener scen react-navigation
 *     ma na webie BIAŁE tło, co dawało jasne przebłyski przy przejściach.
 */
export default function TabLayout() {
  const colors = useColors();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: { display: "none" },
        // Jeśli Twoja wersja expo-router/react-navigation nie zna
        // `sceneStyle`, użyj `sceneContainerStyle` na <Tabs>.
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="house.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
