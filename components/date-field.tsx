import { useState } from "react";
import { Platform, Pressable, Text } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { COLORS } from "@/components/report-ui";

/**
 * Pole daty (format "YYYY-MM-DD") — na webie natywny `<input type="date">`
 * przeglądarki (kalendarz, walidacja formatu za darmo), na iOS/Android
 * `@react-native-community/datetimepicker`. Zastępuje wpisywanie daty
 * ręcznie jako zwykły tekst (podatne na literówki i zły format).
 */
export function DateField({
  value,
  onChange,
  placeholder = "Wybierz datę",
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: object;
}) {
  const [showPicker, setShowPicker] = useState(false);

  if (Platform.OS === "web") {
    return (
      <input
        type="date"
        // Bez tego pole pokazuje datę w formacie wynikającym z locale
        // przeglądarki (np. US → MM/DD/YYYY) — wymuszamy polski DD/MM/YYYY
        // niezależnie od ustawień przeglądarki użytkownika.
        lang="pl-PL"
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        style={{
          backgroundColor: COLORS.background,
          color: value ? COLORS.foreground : COLORS.muted,
          borderRadius: 10,
          padding: "11px 13px",
          marginTop: 8,
          border: "none",
          outline: "none",
          fontSize: 15,
          fontFamily: "inherit",
          colorScheme: "dark",
          width: "100%",
          boxSizing: "border-box",
          ...style,
        }}
      />
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setShowPicker(true)}
        style={[
          {
            backgroundColor: COLORS.background,
            borderRadius: 10,
            paddingHorizontal: 13,
            paddingVertical: 11,
            marginTop: 8,
          },
          style,
        ]}
      >
        <Text style={{ color: value ? COLORS.foreground : COLORS.muted }}>
          {value || placeholder}
        </Text>
      </Pressable>
      {showPicker && (
        <DateTimePicker
          value={value ? new Date(`${value}T12:00:00`) : new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(_event, selectedDate) => {
            // Android zamyka picker automatycznie po wyborze; iOS (spinner)
            // zostaje otwarty, dopóki użytkownik nie zamknie go inaczej —
            // stąd zostawiamy `true`, żeby dało się poprawiać wybór.
            setShowPicker(Platform.OS === "ios");
            if (selectedDate) {
              onChange(selectedDate.toISOString().slice(0, 10));
            }
          }}
        />
      )}
    </>
  );
}
