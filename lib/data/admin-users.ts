import { supabase } from "@/lib/supabase";
import type { AppRole } from "@/lib/data/auth";

export type AdminUser = {
  id: string;
  role: AppRole;
  employeeId: number | null;
  email: string | null;
};

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
