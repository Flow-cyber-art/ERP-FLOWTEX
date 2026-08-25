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
  if (error) throw new Error(error.message);
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
