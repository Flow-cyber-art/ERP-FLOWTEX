import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

/**
 * Logowanie przez Supabase Auth (email + hasło) — zastępuje lokalny
 * przełącznik roli na ekranie "Dev" (ten był świadomie tymczasowy, patrz
 * jego opis: "Tryb lokalny do testowania widoczności paneli przed
 * podłączeniem Supabase Auth"). Konta zakłada Admin ręcznie w Supabase
 * Dashboard → Authentication → Users — patrz SUPABASE_SETUP.md.
 */

export type AppRole = "Admin" | "Brygadzista" | "Pracownik";

export type Profile = {
  id: string;
  role: AppRole;
  employeeId: number | null;
};

// Czytana przez lib/supabase.ts (webStorage) PRZED zapisem sesji, żeby
// trafiła do właściwego magazynu — musi więc być ustawiona zanim
// signInWithPassword zdąży zapisać token.
const REMEMBER_ME_KEY = "flowtex-remember-me";

export function setRememberMe(remember: boolean): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(REMEMBER_ME_KEY, remember ? "1" : "0");
    }
  } catch {
    // brak dostępu do localStorage — logowanie i tak zadziała, tylko bez zapamiętania wyboru.
  }
}

export async function signIn(
  email: string,
  password: string,
  remember = true,
): Promise<void> {
  setRememberMe(remember);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Rola + (opcjonalnie) powiązany pracownik dla aktualnie zalogowanego
 * konta. `null` jeśli konto istnieje w Supabase Auth, ale Admin nie
 * dopisał mu jeszcze wiersza w `profiles` (patrz SUPABASE_SETUP.md) —
 * UI powinien wtedy pokazać czytelny komunikat zamiast pustego ekranu.
 */
export async function getMyProfile(): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // Filtr po id jest tu konieczny, nie tylko "ładny" — Admin ma politykę
  // RLS, która pozwala mu widzieć WSZYSTKIE wiersze profiles (żeby mógł
  // zarządzać kontami innych), więc bez tego filtra to zapytanie zwraca
  // więcej niż 1 wiersz, gdy istnieje więcej niż jedno konto, a
  // `.maybeSingle()` się na tym wywala — objawiało się jako "konto bez
  // przypisanej roli" u Admina zaraz po założeniu drugiego konta.
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, employeeId")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: data.id, role: data.role as AppRole, employeeId: data.employeeId };
}

export function onAuthStateChange(callback: (session: Session | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}

export type MyAccount = {
  email: string | null;
};

/**
 * Konto aktualnie zalogowanego użytkownika (Ustawienia — samoobsługa,
 * inna ścieżka niż `getMyProfile`/rola). Nazwa wyświetlana
 * (`user_metadata.full_name`) NIE jest już tu edytowalna — ustawia ją
 * Admin przy edycji pracownika (admin-screen.tsx/AdminTeamSection,
 * `setAdminUserDisplayName` w lib/data/admin-users.ts), zsynchronizowana
 * z kartoteką HR zamiast dowolnej samoobsługowej wartości.
 */
export async function getMyAccount(): Promise<MyAccount | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return {
    email: user.email ?? null,
  };
}

export async function updateMyPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}
