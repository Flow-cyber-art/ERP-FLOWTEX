import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { AppRole } from "@/lib/data/auth";

export type AdminUser = {
  id: string;
  // null = konto w auth.users bez profilu (tylko dla super admina na liście).
  role: AppRole | null;
  employeeId: number | null;
  email: string | null;
  hasProfile?: boolean;
  // Konto super administratora (tabela `superadmins`, patrz
  // supabase/sql/105_superadmin.sql) — chronione po stronie serwera.
  isSuperAdmin?: boolean;
};

async function invoke<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action, ...payload },
  });
  if (error) {
    // Gdy Edge Function odpowie statusem innym niż 2xx (nasz `json()` w
    // supabase/functions/admin-users/index.ts zawsze zwraca wtedy body
    // `{ error: "konkretny powód" }`), supabase-js NIE czyta tego body —
    // `error.message` to wtedy zawsze ten sam generyczny tekst "Edge
    // Function returned a non-2xx status code", niezależnie od
    // faktycznej przyczyny (zajęty email, zła rola, itd.). Trzeba
    // ręcznie doczytać prawdziwy komunikat z `error.context` (surowy
    // Response) — patrz FunctionsHttpError w @supabase/supabase-js.
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      throw new Error(body?.error || error.message);
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const listAdminAccounts = () =>
  invoke<{ users: AdminUser[]; callerIsSuperAdmin: boolean }>("list");

export const listAdminUsers = () => listAdminAccounts().then((r) => r.users);

export const createAdminUser = (
  email: string,
  password: string,
  role: AppRole,
  employeeId?: string | number | null,
) => invoke<{ ok: true; id: string }>("create", { email, password, role, employeeId });

export const setAdminUserPassword = (userId: string, password: string) =>
  invoke<{ ok: true }>("setPassword", { userId, password });

export const setAdminUserEmail = (userId: string, email: string) =>
  invoke<{ ok: true }>("setEmail", { userId, email });

// Nazwa wyświetlana konta — patrz komentarz przy akcji "setDisplayName"
// w supabase/functions/admin-users/index.ts: Admin ustawia ją stąd (przy
// zapisie imienia i nazwiska pracownika w Zespole), konto nie edytuje
// jej już samo w Ustawieniach.
export const setAdminUserDisplayName = (userId: string, displayName: string) =>
  invoke<{ ok: true }>("setDisplayName", { userId, displayName });

export const setAdminUserRole = (
  userId: string,
  role: AppRole,
  employeeId?: string | number | null,
) => invoke<{ ok: true }>("setRole", { userId, role, employeeId });

export const deleteAdminUser = (userId: string) =>
  invoke<{ ok: true }>("delete", { userId });
