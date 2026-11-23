import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, COLORS, IconBadge, notify, QuantityStepper } from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";
import { listPeriodLocks, setPeriodLock, updateReportBackdateDays } from "@/lib/data/settings";
import { localISODate } from "@/lib/utils";

const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/**
 * Admin → Ustawienia: raporty wstecz i zamknięte okresy (124).
 *  - ile dni wstecz Brygadzista może raportować prace (Admin — bez limitu),
 *  - zamknięcie miesiąca (np. po wypłatach): raportów z niego nie da się
 *    już wysłać, poprawić ani zatwierdzić, dopóki Admin go nie otworzy.
 */
export function ReportPeriodsSection() {
  const { reportBackdateDays } = useAppData();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [daysInput, setDaysInput] = useState(String(reportBackdateDays));
  const [busy, setBusy] = useState(false);
  const locksQuery = useQuery({ queryKey: ["periodLocks", "list"], queryFn: listPeriodLocks, enabled: open });
  const locked = new Set((locksQuery.data ?? []).map((l) => l.month.slice(0, 7)));

  // Bieżący i 5 poprzednich miesięcy.
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    return localISODate(d).slice(0, 8) + "01";
  });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["periodLocks"] });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch (error) {
      notify("Nie udało się zapisać", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: COLORS.border }}>
      <Pressable
        onPress={() => {
          setDaysInput(String(reportBackdateDays));
          setOpen(!open);
        }}
        style={{ flexDirection: "row", alignItems: "center", padding: 14 }}
      >
        <IconBadge name="calendar" size={18} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: COLORS.muted, fontSize: 11 }}>RAPORTY WSTECZ I ZAMKNIĘTE OKRESY</Text>
          <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 15, marginTop: 2 }}>
            Brygadzista: do {reportBackdateDays} {reportBackdateDays === 1 ? "dnia" : "dni"} wstecz
          </Text>
        </View>
        <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}>{open ? "Zwiń" : "Zmień"}</Text>
      </Pressable>

      {open && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
          <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 6 }}>
            Data raportu to dzień wykonania prac. Brygadzista może dodać raport za dziś i podaną liczbę dni wstecz;
            starsze wpisuje Admin. Raport odesłany do poprawy da się poprawić niezależnie od daty.
          </Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <QuantityStepper value={daysInput} onChangeText={setDaysInput} step={1} />
            <Text style={{ color: COLORS.muted }}>dni wstecz</Text>
            <View style={{ flex: 1 }}>
              <Button
                label="Zapisz"
                secondary
                disabled={busy}
                onPress={() => {
                  const value = Math.round(Number(daysInput.replace(",", ".")));
                  if (!Number.isFinite(value) || value < 0 || value > 31) {
                    notify("Nieprawidłowa wartość", "Podaj liczbę dni od 0 do 31.");
                    return;
                  }
                  run(() => updateReportBackdateDays(value));
                }}
              />
            </View>
          </View>

          <Text style={{ color: COLORS.muted, fontSize: 11, fontWeight: "800", marginTop: 16, letterSpacing: 0.6 }}>
            ZAMKNIĘTE OKRESY
          </Text>
          <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>
            Zamknięty miesiąc blokuje wysyłanie, poprawianie i zatwierdzanie raportów z tego miesiąca — także Adminowi.
          </Text>
          {months.map((m) => {
            const isLocked = locked.has(m.slice(0, 7));
            return (
              <View
                key={m}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}
              >
                <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
                  {monthLabel(m)}
                  <Text style={{ color: isLocked ? COLORS.danger : COLORS.success, fontWeight: "400", fontSize: 12 }}>
                    {"  "}
                    {isLocked ? "zamknięty" : "otwarty"}
                  </Text>
                </Text>
                <Button
                  label={isLocked ? "Otwórz" : "Zamknij"}
                  secondary
                  disabled={busy || locksQuery.isLoading}
                  onPress={() => run(() => setPeriodLock(m, !isLocked))}
                />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
