import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  Button,
  COLORS,
  Field,
  IconBadge,
  ScreenHeader,
  StatusBadge,
  confirmAction,
} from "@/components/report-ui";
import { DateField } from "@/components/date-field";
import { useAppData } from "@/contexts/app-data";
import type { LeaveType } from "@/lib/data/leave";

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  wypoczynkowy: "Urlop wypoczynkowy",
  na_zadanie: "Urlop na żądanie",
  L4: "Zwolnienie lekarskie (L4)",
  okolicznościowy: "Urlop okolicznościowy",
  bezpłatny: "Urlop bezpłatny",
};

const LEAVE_TYPES = Object.keys(LEAVE_TYPE_LABELS) as LeaveType[];

// Tylko te dwa typy zużywają roczną pulę dni (polskie prawo pracy: urlop
// na żądanie to 4 dni Z puli urlopu wypoczynkowego, nie osobna pula) —
// L4/okolicznościowy/bezpłatny mają inny reżim i nie są tu liczone jako
// "wykorzystany urlop wypoczynkowy".
const POOL_TYPES: LeaveType[] = ["wypoczynkowy", "na_zadanie"];

export const LEAVE_STATUS_BADGE: Record<
  string,
  { status: "ok" | "warning" | "danger"; label: string }
> = {
  oczekujący: { status: "warning", label: "Oczekuje" },
  zatwierdzony: { status: "ok", label: "Zatwierdzony" },
  odrzucony: { status: "danger", label: "Odrzucony" },
  anulowany: { status: "danger", label: "Anulowany" },
};

const dateLabelPL = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

// Podgląd liczby dni roboczych po stronie klienta — tylko do UX
// (pokazać "5 dni" zanim wniosek zostanie wysłany). Autorytatywne
// wyliczenie robi server (count_business_days w 049_urlopy.sql), bo
// klientowi się nie ufa.
function countBusinessDays(dateFrom: string, dateTo: string): number {
  if (!dateFrom || !dateTo) return 0;
  const from = new Date(dateFrom + "T00:00:00");
  const to = new Date(dateTo + "T00:00:00");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 0;
  let count = 0;
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function LeaveScreen() {
  const {
    myEmployeeId,
    employees,
    leaveRequests,
    submitLeaveRequest,
    updateLeaveRequest,
    cancelLeaveRequest,
  } = useAppData();
  const [view, setView] = useState<"list" | "form">("list");

  const me = employees.find((e) => e.id === myEmployeeId);
  const myRequests = useMemo(
    () =>
      leaveRequests
        .filter((r) => r.employeeId === myEmployeeId)
        .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom)),
    [leaveRequests, myEmployeeId],
  );
  const [editingRequest, setEditingRequest] = useState<
    (typeof myRequests)[number] | null
  >(null);

  const currentYear = new Date().getFullYear();
  const usedDays = myRequests
    .filter(
      (r) =>
        r.status === "zatwierdzony" &&
        POOL_TYPES.includes(r.type) &&
        new Date(r.dateFrom).getFullYear() === currentYear,
    )
    .reduce((sum, r) => sum + r.businessDays, 0);
  const grantedDays = me?.leaveDaysPerYear ?? 26;
  const remainingDays = Math.max(0, grantedDays - usedDays);

  if (!myEmployeeId) {
    return (
      <>
        <ScreenHeader title="Urlopy" />
        <View className="bg-surface border border-border rounded-2xl p-5 items-center">
          <IconBadge name="event-busy" />
          <Text className="text-sm text-muted mt-3 text-center">
            Twoje konto nie jest powiązane z pracownikiem — skontaktuj się z Adminem.
          </Text>
        </View>
      </>
    );
  }

  if (view === "form") {
    return (
      <LeaveRequestForm
        editing={editingRequest}
        onCancel={() => setView("list")}
        onSubmitted={() => setView("list")}
        submitLeaveRequest={submitLeaveRequest}
        updateLeaveRequest={updateLeaveRequest}
      />
    );
  }

  return (
    <>
      <ScreenHeader
        title="Urlopy"
        action={
          <Pressable
            onPress={() => {
              setEditingRequest(null);
              setView("form");
            }}
            style={({ pressed }) => ({
              backgroundColor: COLORS.primary,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 10,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text style={{ color: COLORS.background, fontWeight: "800", fontSize: 13 }}>
              + Nowy wniosek
            </Text>
          </Pressable>
        }
      />

      <View className="bg-surface border border-border rounded-2xl p-4 mb-5">
        <Text className="text-xs text-muted uppercase">Urlop wypoczynkowy</Text>
        <Text className="text-3xl font-bold text-foreground mt-1">
          {remainingDays} {remainingDays === 1 ? "dzień" : "dni"} pozostało
        </Text>
        <Text className="text-sm text-muted mt-1">
          {grantedDays} dni przyznane · {usedDays} dni wykorzystane
        </Text>
      </View>

      {myRequests.length === 0 ? (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center">
          <IconBadge name="event-busy" />
          <Text className="text-sm text-muted mt-3 text-center">
            Brak złożonych wniosków urlopowych.
          </Text>
        </View>
      ) : (
        myRequests.map((r) => (
          <View
            key={r.id}
            className="bg-surface border border-border rounded-2xl p-4 mb-3"
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text className="text-base font-bold text-foreground">
                  {dateLabelPL(r.dateFrom)}
                  {r.dateFrom !== r.dateTo ? ` – ${dateLabelPL(r.dateTo)}` : ""}
                </Text>
                <Text className="text-sm text-muted mt-1">
                  {LEAVE_TYPE_LABELS[r.type]}
                </Text>
                <Text className="text-xs text-muted mt-1">
                  {r.businessDays} {r.businessDays === 1 ? "dzień" : "dni"}
                </Text>
              </View>
              <StatusBadge
                status={(LEAVE_STATUS_BADGE[r.status] ?? LEAVE_STATUS_BADGE.oczekujący).status}
                label={(LEAVE_STATUS_BADGE[r.status] ?? LEAVE_STATUS_BADGE.oczekujący).label}
              />
            </View>
            {r.status === "oczekujący" && (
              <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
                <Pressable
                  onPress={() => {
                    setEditingRequest(r);
                    setView("form");
                  }}
                >
                  <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700" }}>
                    Edytuj
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    confirmAction(
                      "Anulować wniosek?",
                      "Wniosek zostanie anulowany. Będziesz mógł złożyć nowy na ten sam termin.",
                      "Anuluj wniosek",
                      () => cancelLeaveRequest(String(r.id)),
                    )
                  }
                >
                  <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "700" }}>
                    Anuluj wniosek
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ))
      )}
    </>
  );
}

// Wnioski oczekujące na decyzję — używane w team-time-screen.tsx
// (Brygadzista) i w sekcji HR panelu administratora. Model apki to jedna
// brygada, więc każdy Brygadzista/Admin widzi i zatwierdza wszystkie
// wnioski, nie tylko "swojego" zespołu (patrz 049_urlopy.sql).
export function LeavePendingApprovals() {
  const { employees, leaveRequests, decideLeaveRequest } = useAppData();
  const pending = useMemo(
    () =>
      leaveRequests
        .filter((r) => r.status === "oczekujący")
        .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom)),
    [leaveRequests],
  );

  if (pending.length === 0) return null;

  return (
    <View className="mb-5">
      <Text className="text-lg font-bold text-foreground mb-3">
        Wnioski urlopowe do zatwierdzenia ({pending.length})
      </Text>
      {pending.map((r) => (
        <View
          key={r.id}
          className="bg-surface border border-border rounded-2xl p-4 mb-3"
        >
          <Text className="text-base font-bold text-foreground">
            {employees.find((e) => e.id === r.employeeId)?.name || "Pracownik"}
          </Text>
          <Text className="text-sm text-muted mt-1">
            {LEAVE_TYPE_LABELS[r.type]} · {dateLabelPL(r.dateFrom)}
            {r.dateFrom !== r.dateTo ? ` – ${dateLabelPL(r.dateTo)}` : ""} ·{" "}
            {r.businessDays} {r.businessDays === 1 ? "dzień" : "dni"}
          </Text>
          {r.note ? (
            <Text className="text-xs text-muted mt-1">„{r.note}”</Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Odrzuć"
                secondary
                onPress={() => decideLeaveRequest(String(r.id), false)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Zatwierdź"
                onPress={() => decideLeaveRequest(String(r.id), true)}
              />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

type LeaveFormRequest = {
  id: number;
  type: LeaveType;
  dateFrom: string;
  dateTo: string;
  note: string | null;
};

function LeaveRequestForm({
  editing,
  onCancel,
  onSubmitted,
  submitLeaveRequest,
  updateLeaveRequest,
}: {
  editing: LeaveFormRequest | null;
  onCancel: () => void;
  onSubmitted: () => void;
  submitLeaveRequest: (input: {
    type: LeaveType;
    dateFrom: string;
    dateTo: string;
    note?: string;
  }) => Promise<boolean>;
  updateLeaveRequest: (
    requestId: string,
    input: { type: LeaveType; dateFrom: string; dateTo: string; note?: string },
  ) => Promise<boolean>;
}) {
  const [type, setType] = useState<LeaveType>(editing?.type ?? "wypoczynkowy");
  const [dateFrom, setDateFrom] = useState(editing?.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(editing?.dateTo ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [submitting, setSubmitting] = useState(false);

  const businessDays = countBusinessDays(dateFrom, dateTo || dateFrom);
  const canSubmit = !!dateFrom && !!dateTo && businessDays > 0 && !submitting;

  const submit = async () => {
    setSubmitting(true);
    const ok = editing
      ? await updateLeaveRequest(String(editing.id), { type, dateFrom, dateTo, note })
      : await submitLeaveRequest({ type, dateFrom, dateTo, note });
    setSubmitting(false);
    if (ok) onSubmitted();
  };

  return (
    <>
      <Pressable onPress={onCancel} style={{ marginBottom: 12 }}>
        <Text style={{ color: COLORS.primary, fontWeight: "700" }}>← Wróć</Text>
      </Pressable>
      <ScreenHeader title={editing ? "Edytuj wniosek" : "Nowy wniosek"} />

      <View className="bg-surface border border-border rounded-2xl p-4">
        <Text className="text-xs text-muted uppercase mb-2">Rodzaj urlopu</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {LEAVE_TYPES.map((t) => (
            <Pressable
              key={t}
              onPress={() => setType(t)}
              style={{
                backgroundColor: type === t ? COLORS.primary : COLORS.background,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderWidth: 1,
                borderColor: type === t ? COLORS.primary : COLORS.border,
              }}
            >
              <Text
                style={{
                  color: type === t ? COLORS.background : COLORS.foreground,
                  fontWeight: "700",
                  fontSize: 13,
                }}
              >
                {LEAVE_TYPE_LABELS[t]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text className="text-xs text-muted uppercase mb-2" style={{ marginTop: 18 }}>
          Termin
        </Text>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <DateField value={dateFrom} onChange={setDateFrom} />
          </View>
          <Text style={{ color: COLORS.muted }}>→</Text>
          <View style={{ flex: 1 }}>
            <DateField value={dateTo} onChange={setDateTo} />
          </View>
        </View>

        {businessDays > 0 && (
          <Text
            style={{
              color: COLORS.primary,
              fontWeight: "800",
              fontSize: 16,
              textAlign: "center",
              marginTop: 16,
            }}
          >
            {businessDays} {businessDays === 1 ? "dzień roboczy" : "dni roboczych"}
          </Text>
        )}

        <Text className="text-xs text-muted uppercase mb-2" style={{ marginTop: 18 }}>
          Notatka (opcjonalnie)
        </Text>
        <Field
          placeholder="np. wyjazd rodzinny"
          value={note}
          onChangeText={setNote}
        />

        <View style={{ flexDirection: "row", gap: 8, marginTop: 20 }}>
          <View style={{ flex: 1 }}>
            <Button label="Anuluj" secondary onPress={onCancel} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={
                submitting
                  ? "Zapisywanie…"
                  : editing
                    ? "Zapisz zmiany"
                    : "Złóż wniosek"
              }
              onPress={submit}
              disabled={!canSubmit}
            />
          </View>
        </View>
      </View>
    </>
  );
}
