import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Button, COLORS, Field } from "@/components/report-ui";
import { LogoMark } from "@/components/logo-mark";
import { signIn } from "@/lib/data/auth";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      await signIn(email.trim(), password, remember);
      // Nic więcej nie trzeba tu robić — onAuthStateChange w komponencie
      // nadrzędnym (patrz components/auth-gate.tsx) sam wykryje sesję i
      // przełączy z ekranu logowania na apkę.
    } catch (err) {
      setError(
        err instanceof Error
          ? "Nieprawidłowy email lub hasło."
          : "Nie udało się zalogować.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backgroundColor: COLORS.background,
      }}
    >
      <View style={{ width: "100%", maxWidth: 360 }}>
        <View style={{ alignItems: "center", marginBottom: 4 }}>
          <LogoMark size={40} />
        </View>
        <Text
          style={{
            color: COLORS.foreground,
            fontSize: 26,
            fontWeight: "800",
            textAlign: "center",
          }}
        >
          FLOWTEX <Text style={{ color: COLORS.primary }}>Polska</Text>
        </Text>
        <Text
          style={{
            color: COLORS.muted,
            fontSize: 13,
            textAlign: "center",
            marginTop: 6,
            marginBottom: 28,
          }}
        >
          Zaloguj się, żeby zobaczyć budowy, magazyn i raporty.
        </Text>

        <View className="bg-surface border border-border rounded-2xl p-4">
          <Text className="text-xs text-muted uppercase">Email</Text>
          <Field
            placeholder="jan.kowalski@flowtex.pl"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text className="text-xs text-muted uppercase mt-4">Hasło</Text>
          <Field
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            secureTextEntry
            style={{ marginBottom: 4 }}
          />
          <Pressable
            onPress={() => setRemember(!remember)}
            style={{ flexDirection: "row", alignItems: "center", marginTop: 14 }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                borderWidth: 1.5,
                borderColor: remember ? COLORS.primary : COLORS.border,
                backgroundColor: remember ? COLORS.primary : "transparent",
                alignItems: "center",
                justifyContent: "center",
                marginRight: 8,
              }}
            >
              {remember && (
                <MaterialIcons name="check" size={13} color={COLORS.background} />
              )}
            </View>
            <Text style={{ color: COLORS.muted, fontSize: 12 }}>
              Nie wylogowuj mnie na tym urządzeniu
            </Text>
          </Pressable>
          {error && (
            <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 10 }}>
              {error}
            </Text>
          )}
          <View style={{ marginTop: 16 }}>
            {loading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <Button label="Zaloguj się" onPress={submit} />
            )}
          </View>
        </View>

        <Text
          style={{
            color: COLORS.muted,
            fontSize: 11,
            textAlign: "center",
            marginTop: 16,
          }}
        >
          Nie masz konta? Poproś administratora o założenie go.
        </Text>
      </View>
    </View>
  );
}
