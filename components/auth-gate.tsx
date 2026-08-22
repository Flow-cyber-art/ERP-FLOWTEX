import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { ReactNode } from "react";
import { COLORS } from "@/components/report-ui";
import { LoginScreen } from "@/components/screens/login-screen";
import { getMyProfile, getSession, onAuthStateChange, signOut, type Profile } from "@/lib/data/auth";

/**
 * Bramka logowania — zastępuje dawny lokalny przełącznik roli (ekran
 * "Dev"). Bez sesji Supabase Auth: ekran logowania. Z sesją, ale bez
 * wiersza w `profiles` (Admin jeszcze nie przypisał roli nowo
 * założonemu kontu — patrz SUPABASE_SETUP.md): czytelny komunikat
 * zamiast pustego/zepsutego ekranu. Dopiero z obiema rzeczami renderuje
 * właściwą apkę, przekazując jej rozstrzygnięty profil.
 */
export function AuthGate({
  children,
}: {
  children: (profile: Profile) => ReactNode;
}) {
  const [status, setStatus] = useState<"loading" | "signed-out" | "no-profile" | "ready">(
    "loading",
  );
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const session = await getSession();
      if (cancelled) return;
      if (!session) {
        setStatus("signed-out");
        return;
      }
      try {
        const p = await getMyProfile();
        if (cancelled) return;
        if (!p) {
          setStatus("no-profile");
          return;
        }
        setProfile(p);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("no-profile");
      }
    }

    resolve();
    const unsubscribe = onAuthStateChange(() => resolve());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (status === "loading") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: COLORS.background,
        }}
      >
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (status === "signed-out") {
    return <LoginScreen />;
  }

  if (status === "no-profile") {
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
        <Text style={{ color: COLORS.foreground, fontSize: 16, fontWeight: "700", textAlign: "center" }}>
          Konto zalogowane, ale bez przypisanej roli.
        </Text>
        <Text style={{ color: COLORS.muted, fontSize: 13, textAlign: "center", marginTop: 8 }}>
          Poproś administratora, żeby dodał wiersz w tabeli "profiles" dla
          tego konta (rola: Admin / Brygadzista / Pracownik).
        </Text>
        <Text
          style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700", marginTop: 20 }}
          onPress={() => signOut()}
        >
          Wyloguj się
        </Text>
      </View>
    );
  }

  return <>{children(profile!)}</>;
}
