import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Button, COLORS, Field, notify } from "@/components/report-ui";
import {
  getMyAccount,
  updateMyDisplayName,
  updateMyPassword,
} from "@/lib/data/auth";

// Samoobsługa własnego konta — nazwa wyświetlana i hasło. Współdzielona
// przez settings-screen.tsx (Brygadzista/Pracownik) i AdminSettingsSection
// w admin-screen.tsx, żeby nie duplikować tego samego formularza dwa
// razy. Dotyczy WYŁĄCZNIE konta aktualnie zalogowanego — zarządzanie
// hasłami/rolami INNYCH kont to osobna, admin-only ścieżka
// (lib/data/admin-users.ts, sekcja "Konta logowania").
export function AccountSettingsSection() {
  const [email, setEmail] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [nameSaving, setNameSaving] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  useEffect(() => {
    getMyAccount().then((account) => {
      if (!account) return;
      setEmail(account.email);
      setNameInput(account.displayName);
    });
  }, []);

  const saveName = async () => {
    setNameSaving(true);
    try {
      await updateMyDisplayName(nameInput.trim());
      notify("Zapisano", "Nazwa wyświetlana została zaktualizowana.");
    } catch (error) {
      notify(
        "Nie udało się zapisać",
        error instanceof Error ? error.message : "Spróbuj ponownie.",
      );
    } finally {
      setNameSaving(false);
    }
  };

  const savePassword = async () => {
    if (newPassword.length < 10) {
      notify("Za krótkie hasło", "Nowe hasło musi mieć co najmniej 10 znaków.");
      return;
    }
    if (newPassword !== confirmPassword) {
      notify("Hasła się nie zgadzają", "Wpisz to samo hasło w obu polach.");
      return;
    }
    setPasswordSaving(true);
    try {
      await updateMyPassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      notify("Zapisano", "Hasło zostało zmienione.");
    } catch (error) {
      notify(
        "Nie udało się zmienić hasła",
        error instanceof Error ? error.message : "Spróbuj ponownie.",
      );
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <View className="bg-surface border border-border rounded-2xl p-4">
      <Text style={{ color: COLORS.muted, fontSize: 13, marginBottom: 4 }}>
        Moje konto{email ? ` · ${email}` : ""}
      </Text>
      <Text className="text-xs text-muted uppercase mt-3 mb-2">
        Nazwa wyświetlana
      </Text>
      <Field
        placeholder="np. Jan Kowalski"
        value={nameInput}
        onChangeText={setNameInput}
      />
      <View style={{ marginTop: 10 }}>
        <Button
          label={nameSaving ? "Zapisywanie…" : "Zapisz nazwę"}
          secondary
          disabled={nameSaving}
          onPress={saveName}
        />
      </View>

      <Text className="text-xs text-muted uppercase mt-5 mb-2">
        Zmień hasło
      </Text>
      <Field
        placeholder="Nowe hasło (min. 10 znaków)"
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
      />
      <View style={{ marginTop: 8 }}>
        <Field
          placeholder="Powtórz nowe hasło"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />
      </View>
      <View style={{ marginTop: 10 }}>
        <Button
          label={passwordSaving ? "Zapisywanie…" : "Zmień hasło"}
          secondary
          disabled={passwordSaving}
          onPress={savePassword}
        />
      </View>
    </View>
  );
}
