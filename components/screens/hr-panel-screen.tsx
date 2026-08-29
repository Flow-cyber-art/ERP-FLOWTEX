import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { COLORS } from "@/components/report-ui";
import { HrSection } from "@/components/screens/hr-screen";
import { AttendanceSection } from "@/components/screens/attendance-screen";
import { AdminLeaveSection, AdminTeamSection } from "@/components/screens/admin-screen";

/**
 * "HR" — osobna zakładka nawigacji, wydzielona z panelu Admina: wszystko
 * związane z pracownikiem (skład zespołu i stawki, rozliczenie godzin,
 * obecności, urlopy) w jednym miejscu, oddzielone od konfiguracji firmy
 * (Ustawienia/Konta logowania), która zostaje w zakładce "Admin"
 * (admin-screen.tsx). Sekcje same w sobie się nie zmieniły — tylko
 * przeniosło się ich wejście z wewnętrznego przełącznika Admina tutaj.
 */
type HrTab = "team" | "hours" | "attendance" | "leaves";

export function HrPanelScreen() {
  const [section, setSection] = useState<HrTab>("team");

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
              ["team", "Zespół i dniówka"],
              ["hours", "Rozliczenie godzin"],
              ["attendance", "Obecności"],
              ["leaves", "Urlopy"],
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
      ) : section === "hours" ? (
        <HrSection />
      ) : section === "attendance" ? (
        <AttendanceSection />
      ) : (
        <AdminLeaveSection />
      )}
    </>
  );
}
