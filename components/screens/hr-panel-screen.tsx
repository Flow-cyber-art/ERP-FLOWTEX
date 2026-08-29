import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { COLORS } from "@/components/report-ui";
import { PayrollSection } from "@/components/screens/payroll-screen";
import { AdminLeaveSection, AdminTeamSection } from "@/components/screens/admin-screen";

/**
 * "HR" — osobna zakładka nawigacji, wydzielona z panelu Admina: wszystko
 * związane z pracownikiem w jednym miejscu (włącznie z kontem logowania —
 * email/hasło edytowane bezpośrednio przy karcie pracownika w Zespole,
 * patrz AdminTeamSection), oddzielone od konfiguracji firmy (Ustawienia),
 * która zostaje w zakładce "Admin" (admin-screen.tsx). Trzy sekcje —
 * Rozliczenie / Urlopy / Zespół, w tej kolejności (Rozliczenie jest tym,
 * co HR sprawdza najczęściej, więc jest pierwsze i domyślnie otwarte) —
 * dawne osobne "Rozliczenie godzin" i "Obecności" pokazywały w większości
 * te same dane w dwóch miejscach, więc scalone w jedną "Rozliczenie"
 * (patrz payroll-screen.tsx).
 */
type HrTab = "team" | "payroll" | "leaves";

export function HrPanelScreen() {
  const [section, setSection] = useState<HrTab>("payroll");

  return (
    <>
      <View className="bg-surface border border-border rounded-2xl p-2 mb-5">
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 6,
            justifyContent: "center",
          }}
        >
          {(
            [
              ["payroll", "Rozliczenie"],
              ["leaves", "Urlopy"],
              ["team", "Zespół"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setSection(value)}
              style={{
                borderRadius: 10,
                paddingVertical: 10,
                paddingHorizontal: 16,
                alignItems: "center",
                backgroundColor:
                  section === value ? COLORS.primary : "transparent",
              }}
            >
              <Text
                style={{
                  color: section === value ? COLORS.background : COLORS.muted,
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

      {section === "team" ? (
        <AdminTeamSection />
      ) : section === "payroll" ? (
        <PayrollSection />
      ) : (
        <AdminLeaveSection />
      )}
    </>
  );
}
