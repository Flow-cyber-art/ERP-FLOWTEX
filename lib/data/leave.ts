import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla wniosków urlopowych — patrz
 * supabase/sql/049_urlopy.sql. Zapis idzie przez RPC (request_leave/
 * cancel_leave_request/decide_leave_request), odczyt wprost z tabeli
 * (RLS filtruje: Pracownik widzi tylko swoje wnioski, Admin/Brygadzista
 * wszystkie — tak jak time_entries).
 */

export type LeaveType =
  | "wypoczynkowy"
  | "na_zadanie"
  | "L4"
  | "okolicznościowy"
  | "bezpłatny";

export type LeaveStatus = "oczekujący" | "zatwierdzony" | "odrzucony" | "anulowany";

export type LeaveRequestRow = {
  id: number;
  employeeId: number;
  type: LeaveType;
  dateFrom: string;
  dateTo: string;
  businessDays: number;
  status: LeaveStatus;
  note: string | null;
  decidedBy: number | null;
  decidedAt: string | null;
  createdAt: string;
};

export async function listLeaveRequests(): Promise<LeaveRequestRow[]> {
  const { data, error } = await supabase
    .from("leave_requests")
    .select(
      "id, employeeId, type, dateFrom, dateTo, businessDays, status, note, decidedBy, decidedAt, createdAt",
    )
    .order("dateFrom", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LeaveRequestRow[];
}

export async function requestLeave(input: {
  type: LeaveType;
  dateFrom: string;
  dateTo: string;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("request_leave", {
    p_type: input.type,
    p_date_from: input.dateFrom,
    p_date_to: input.dateTo,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function updateLeaveRequest(
  requestId: number,
  input: {
    type: LeaveType;
    dateFrom: string;
    dateTo: string;
    note?: string;
  },
): Promise<void> {
  const { error } = await supabase.rpc("update_leave_request", {
    p_request_id: requestId,
    p_type: input.type,
    p_date_from: input.dateFrom,
    p_date_to: input.dateTo,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function cancelLeaveRequest(requestId: number): Promise<void> {
  const { error } = await supabase.rpc("cancel_leave_request", {
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
}

export async function decideLeaveRequest(
  requestId: number,
  approve: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("decide_leave_request", {
    p_request_id: requestId,
    p_approve: approve,
  });
  if (error) throw new Error(error.message);
}

export async function updateEmployeeLeaveDays(
  employeeId: number,
  leaveDaysPerYear: number,
): Promise<void> {
  const { error } = await supabase
    .from("employees")
    .update({ leaveDaysPerYear, updatedAt: new Date().toISOString() })
    .eq("id", employeeId);
  if (error) throw new Error(error.message);
}
