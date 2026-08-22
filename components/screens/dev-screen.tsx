import { Pressable, Text, View } from "react-native";
import { COLORS } from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

export function DevScreen() {
  const { devRole, switchRole } = useAppData();

  const roleButton = (
    role: "Admin" | "Brygadzista" | "Pracownik",
    icon: string,
  ) => (
    <Pressable
      key={role}
      onPress={() => switchRole(role)}
      style={{
        backgroundColor: devRole === role ? COLORS.primary : COLORS.background,
        borderRadius: 12,
        padding: 14,
        marginTop: 10,
        borderWidth: 1,
        borderColor: devRole === role ? COLORS.primary : COLORS.border,
      }}
    >
      <Text
        style={{
          color: devRole === role ? COLORS.background : COLORS.foreground,
          fontWeight: "700",
        }}
      >
        {icon} {role}
      </Text>
    </Pressable>
  );

  return (
    <>
      <Text className="text-xs tracking-widest text-primary font-bold">
        DEVTOOLS / TESTOWANIE
      </Text>
      <Text className="text-3xl font-bold text-foreground mt-2">
        Wybór roli
      </Text>
      <Text className="text-sm text-muted mt-2 mb-5">
        Tryb lokalny do testowania widoczności paneli przed podłączeniem
        Supabase Auth.
      </Text>
      <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
        <Text className="text-xs text-muted uppercase">Aktywna rola</Text>
        {roleButton("Admin", "⚙")}
        {roleButton("Brygadzista", "♙")}
        {roleButton("Pracownik", "♤")}
      </View>
      <View className="bg-surface border border-border rounded-2xl p-4">
        <Text className="text-xs text-muted uppercase">Dostępne moduły</Text>
        <Text className="text-base font-bold text-foreground mt-3">
          {devRole}
        </Text>
        <Text className="text-sm text-muted mt-2">
          {devRole === "Admin"
            ? "Magazyn, budowy, raporty zarządcze i panel administracyjny."
            : devRole === "Brygadzista"
              ? "Raport dzienny materiałów i osób oraz podgląd czasu wybranego pracownika. Bez zarządzania budowami i magazynem."
              : "Własny wpis czasu i potwierdzenie pracy."}
        </Text>
      </View>
    </>
  );
}
