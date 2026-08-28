import { Text, View } from "react-native";
import { Button, confirmAction, COLORS, ScreenHeader } from "@/components/report-ui";
import { AccountSettingsSection } from "@/components/account-settings-section";
import { useAppData } from "@/contexts/app-data";
import { signOut } from "@/lib/data/auth";

// Zakładka "Admin" dla Brygadzisty i Pracownika — odpowiednik sekcji
// "Ustawienia" w panelu Admina (patrz components/screens/admin-screen.tsx).
// Wyloguj jest tu celowo pojedynczym przyciskiem z potwierdzeniem, a NIE
// osobną pozycją w pasku nawigacji — wcześniej dało się wylogować przez
// przypadkowe dotknięcie zakładki. W miarę potrzeb tu będą dochodzić
// kolejne ustawienia aplikacji.
export function SettingsScreen() {
  const { realRole, devRole, setDevRole, setTab } = useAppData();
  // Admin, który przełączył się na widok Brygadzisty (admin-screen.tsx —
  // "Przełącz na widok Brygadzisty"), ląduje właśnie tutaj (zakładka
  // "Admin" w widoku Brygadzisty pokazuje ten ekran, nie pełny panel) —
  // stąd musi tu być droga powrotna. `realRole` to prawdziwa rola z
  // profilu (nie zmienia się przy przełączaniu widoku), `devRole` to
  // aktualnie oglądany widok.
  const canReturnToAdmin = realRole === "Admin" && devRole !== "Admin";

  return (
    <>
      <ScreenHeader title="Ustawienia" description="Ustawienia aplikacji." />

      {canReturnToAdmin && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
          <Text className="text-xs text-muted uppercase">Widok</Text>
          <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 6 }}>
            Oglądasz teraz widok Brygadzisty.
          </Text>
          <View style={{ marginTop: 12 }}>
            <Button
              label="Wróć do widoku Admina"
              onPress={() => {
                setDevRole("Admin");
                setTab("warehouse");
              }}
            />
          </View>
        </View>
      )}

      <AccountSettingsSection />

      <View className="bg-surface border border-border rounded-2xl p-4 mt-4">
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
