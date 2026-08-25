import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { AppRole } from "@/lib/data/auth";

export type AdminUser = {
  id: string;
  role: AppRole;
  employeeId: number | null;
  email: string | null;
};

// Konto głównego Admina — chronione po stronie serwera (Edge Function
// admin-users, patrz supabase/functions/admin-users/index.ts) przed
// usunięciem i odebraniem roli Admin, żeby zarządzanie kontami nie mogło
// nigdy zablokować dostępu do panelu admina. Ta stała jest tylko do UI
// (wyszarzenie przycisków) — jeśli zmienisz docelowy email, ustaw też
// sekret PROTECTED_ADMIN_EMAIL dla Edge Function, inaczej ochrona
// serwerowa nadal będzie pilnować starego adresu.
export const PROTECTED_ADMIN_EMAIL = "admin@flowtex.pl";

export const isProtectedAdminEmail = (email: string | null | undefined): boolean =>
  (email ?? "").trim().toLowerCase() === PROTECTED_ADMIN_EMAIL;

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

export const listAdminUsers = () => invoke<{ users: AdminUser[] }>("list").then((r) => r.users);

export const createAdminUser = (
  email: string,
  password: string,
  role: AppRole,
  employeeId?: string | number | null,
) => invoke<{ ok: true; id: string }>("create", { email, password, role, employeeId });

export const setAdminUserPassword = (userId: string, password: string) =>
  invoke<{ ok: true }>("setPassword", { userId, password });

export const setAdminUserRole = (
  userId: string,
  role: AppRole,
  employeeId?: string | number | null,
) => invoke<{ ok: true }>("setRole", { userId, role, employeeId });

export const deleteAdminUser = (userId: string) =>
  invoke<{ ok: true }>("delete", { userId });
