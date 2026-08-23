import { Text, View } from "react-native";
import { Button, COLORS, confirmAction, ScreenHeader } from "@/components/report-ui";
import { signOut } from "@/lib/data/auth";

// Zakładka "Admin" dla Brygadzisty i Pracownika — odpowiednik sekcji
// "Ustawienia" w panelu Admina (patrz components/screens/admin-screen.tsx).
// Wyloguj jest tu celowo pojedynczym przyciskiem z potwierdzeniem, a NIE
// osobną pozycją w pasku nawigacji — wcześniej dało się wylogować przez
// przypadkowe dotknięcie zakładki. W miarę potrzeb tu będą dochodzić
// kolejne ustawienia aplikacji.
export function SettingsScreen() {
  return (
    <>
      <ScreenHeader eyebrow="ADMIN" title="Ustawienia" description="Ustawienia aplikacji." />

      <View className="bg-surface border border-border rounded-2xl p-4">
        <Text style={{ color: COLORS.muted, fontSize: 13, marginBottom: 14 }}>
          Tutaj z czasem pojawią się kolejne ustawienia aplikacji.
        </Text>
        <Button
          label="Wyloguj"
          secondary
          onPress={() =>
            confirmAction(
              "Wylogować się?",
              "Będzie trzeba zalogować się ponownie.",
              "Wyloguj",
              () => {
                signOut();
              },
            )
          }
        />
      </View>
    </>
  );
}
