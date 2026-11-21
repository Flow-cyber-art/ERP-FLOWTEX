import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { COLORS, SegmentedControl } from "@/components/report-ui";
import { PayrollSection } from "@/components/screens/payroll-screen";
import { AdminLeaveSection, AdminTeamSection } from "@/components/screens/admin-screen";
import { SubcontractorsSection } from "@/components/screens/subcontractors-screen";
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
 *
 * Czwarta sekcja "Podwykonawcy" — firmy rozliczane za etap (m²/mb/szt),
 * nie za godziny; patrz subcontractors-screen.tsx i
 * supabase/sql/111_podwykonawcy.sql.
 */
type HrTab = "team" | "payroll" | "leaves" | "subcontractors";

export function HrPanelScreen() {
  const [section, setSection] = useState<HrTab>("payroll");

  return (
    <>
      {/* Cztery sekcje nie mieszczą się na wąskim telefonie w jednym
          wierszu — zawijają się do drugiego zamiast być ucięte. */}
      <View style={{ marginBottom: 20 }}>
        <SegmentedControl
          options={[
            { key: "payroll", label: "Rozliczenie" },
            { key: "leaves", label: "Urlopy" },
            { key: "team", label: "Zespół" },
            { key: "subcontractors", label: "Podwykonawcy" },
          ] as const}
          value={section}
          onChange={setSection}
          wrap
        />
      </View>

      {section === "team" ? (
        <AdminTeamSection />
      ) : section === "payroll" ? (
        <PayrollSection />
      ) : section === "subcontractors" ? (
        <SubcontractorsSection />
      ) : (
        <AdminLeaveSection />
      )}
    </>
  );
}
