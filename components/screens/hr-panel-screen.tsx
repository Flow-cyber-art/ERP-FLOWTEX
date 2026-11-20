import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { COLORS, SegmentedControl } from "@/components/report-ui";
import { PayrollSection } from "@/components/screens/payroll-screen";
import { AdminLeaveSection, AdminTeamSection } from "@/components/screens/admin-screen";
import { RADIUS } from "@/constants/radius";

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
      <View style={{ marginBottom: 20 }}>
        <SegmentedControl
          options={[
            { key: "payroll", label: "Rozliczenie" },
            { key: "leaves", label: "Urlopy" },
            { key: "team", label: "Zespół" },
          ] as const}
          value={section}
          onChange={setSection}
          fullWidth
        />
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
