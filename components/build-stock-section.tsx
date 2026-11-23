import { useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, COLORS, Field, formatPLN, notify } from "@/components/report-ui";
import { RADIUS } from "@/constants/radius";
import { useAppData } from "@/contexts/app-data";
import { listBuildMaterialLots } from "@/lib/data/build-materials";
import {
  approveMaterialLoss,
  listLossRequests,
  listShortages,
  reportMaterialLoss,
  resolveShortage,
  returnMaterialToWarehouse,
} from "@/lib/data/stock-v2";

/**
 * „Stan na budowie i niedobory” (magazyn v2, supabase/sql/121–122) na karcie
 * budowy: saldo materiałów leżących na budowie, zwrot na magazyn i strata
 * w trakcie prac, niedobory do wyjaśnienia i zgłoszenia strat brygadzisty.
 * Stan zmieniają wyłącznie funkcje bazy — tu tylko formularze i odczyt.
 */

type Form =
  | { kind: "return"; materialId: number; qty: string; text: string }
  | { kind: "loss"; materialId: number; qty: string; text: string }
  | { kind: "shortage"; shortageId: number; asLoss: boolean; text: string }
  | null;

const STOCK_KEYS = ["buildMaterialLots", "buildMaterials", "warehouseBatches", "materials", "shortages", "lossRequests", "buildMaterialReturns"];

const parseQty = (value: string) => Number(value.replace(",", "."));

export function BuildStockSection({ buildId, isClosed }: { buildId: string; isClosed: boolean }) {
  const { materials, devRole } = useAppData();
  const isAdmin = devRole === "Admin";
  const queryClient = useQueryClient();
  const numericBuildId = Number(buildId);

  const lotsQuery = useQuery({ queryKey: ["buildMaterialLots", "list"], queryFn: listBuildMaterialLots });
  const shortagesQuery = useQuery({ queryKey: ["shortages", "list"], queryFn: listShortages });
  const lossQuery = useQuery({ queryKey: ["lossRequests", "list"], queryFn: listLossRequests });

  const [form, setForm] = useState<Form>(null);
  const [busy, setBusy] = useState(false);

  const materialById = useMemo(() => new Map(materials.map((m) => [Number(m.id), m])), [materials]);
  const nameOf = (id: number) => materialById.get(id)?.name ?? `Materiał #${id}`;
  const unitOf = (id: number) => materialById.get(id)?.unit ?? "";

  const onSite = useMemo(() => {
    const map = new Map<number, { qty: number; value: number; batches: number }>();
    for (const lot of lotsQuery.data ?? []) {
      const qty = Number(lot.quantity);
      if (lot.buildId !== numericBuildId || qty <= 0) continue;
      const row = map.get(lot.materialId) ?? { qty: 0, value: 0, batches: 0 };
      row.qty += qty;
      row.value += qty * Number(lot.unitPrice);
      row.batches += 1;
      map.set(lot.materialId, row);
    }
    return [...map.entries()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0]), "pl"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotsQuery.data, numericBuildId, materialById]);

  const openShortages = (shortagesQuery.data ?? []).filter(
    (s) => s.buildId === numericBuildId && s.status === "do_wyjasnienia",
  );
  const pendingLosses = (lossQuery.data ?? []).filter(
    (r) => r.buildId === numericBuildId && r.status === "oczekuje",
  );

  const refresh = async () => {
    await Promise.all(STOCK_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  };

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await action();
      setForm(null);
      await refresh();
      notify("Zapisano", done);
    } catch (error) {
      notify("Nie udało się zapisać", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submitForm = () => {
    if (!form) return;
    if (form.kind === "shortage") {
      if (form.text.trim().length < 3) return notify("Brak opisu", "Opisz, dlaczego niedoboru nie da się wyjaśnić dostawą ani korektą raportu.");
      return run(
        () => resolveShortage(form.shortageId, form.asLoss, form.text),
        form.asLoss ? "Niedobór przeniesiony do strat materiałowych." : "Niedobór zostaje kosztem zużycia budowy.",
      );
    }
    const qty = parseQty(form.qty);
    if (!Number.isFinite(qty) || qty <= 0) return notify("Nieprawidłowa ilość", "Podaj ilość większą od zera.");
    if (form.kind === "return") {
      return run(
        () => returnMaterialToWarehouse(numericBuildId, form.materialId, qty, form.text),
        `${nameOf(form.materialId)}: ${qty} ${unitOf(form.materialId)} wraca na magazyn po swojej cenie.`,
      );
    }
    if (form.text.trim().length < 3) return notify("Brak powodu", "Podaj powód straty (np. rozdarty worek, przeterminowany).");
    return run(
      () => reportMaterialLoss(numericBuildId, form.materialId, qty, form.text),
      isAdmin
        ? `Strata zaksięgowana — doliczona do kosztu budowy jako „Straty materiałowe”.`
        : `Zgłoszenie straty wysłane do Admina — stan zmieni się po zatwierdzeniu.`,
    );
  };

  const card = {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginTop: 8,
  } as const;

  const inlineForm = (title: string, qtyLabel: string | null, textPlaceholder: string, extra?: ReactNode) =>
    form && (
      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>{title}</Text>
        {qtyLabel && form.kind !== "shortage" && (
          <Field
            value={form.qty}
            onChangeText={(qty: string) => setForm({ ...form, qty })}
            placeholder={qtyLabel}
            keyboardType="decimal-pad"
          />
        )}
        {extra}
        <Field value={form.text} onChangeText={(text: string) => setForm({ ...form, text })} placeholder={textPlaceholder} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button label="Anuluj" secondary fullWidth onPress={() => setForm(null)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={busy ? "Zapisywanie…" : "Zapisz"} fullWidth disabled={busy} onPress={submitForm} />
          </View>
        </View>
      </View>
    );

  return (
    <View style={{ marginTop: 14 }}>
      {openShortages.length > 0 && (
        <View style={{ ...card, borderColor: COLORS.warning }}>
          <Text style={{ color: COLORS.warning, fontWeight: "800", fontSize: 13 }}>
            NIEDOBORY DO WYJAŚNIENIA ({openShortages.length})
          </Text>
          <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>
            Zużyto więcej, niż było na budowie. Dostawa, wydanie z magazynu albo transfer na tę budowę
            wyjaśnią niedobór automatycznie; korekta raportu w dół też. Budowy nie da się zamknąć z
            otwartym niedoborem.
          </Text>
          {openShortages.map((s) => (
            <View key={s.id} style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 }}>
              <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
                {nameOf(s.materialId)}: {s.qtyOpen} {unitOf(s.materialId)}
              </Text>
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                wycena tymczasowa {formatPLN(s.qtyOpen * s.provisionalPrice)} ({formatPLN(s.provisionalPrice)}/{unitOf(s.materialId)})
                {s.stageName ? ` · etap ${s.stageName}` : ""} · {s.createdAt.slice(0, 10)}
              </Text>
              {isAdmin && !isClosed && form?.kind === "shortage" && form.shortageId === s.id
                ? inlineForm(
                    "Różnica inwentaryzacyjna — nie da się ustalić źródła",
                    null,
                    "Wyjaśnienie (wymagane)",
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Wbudowano — koszt zużycia"
                          secondary={form.asLoss}
                          fullWidth
                          onPress={() => setForm({ ...form, asLoss: false })}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Utracono — strata"
                          secondary={!form.asLoss}
                          fullWidth
                          onPress={() => setForm({ ...form, asLoss: true })}
                        />
                      </View>
                    </View>,
                  )
                : isAdmin && !isClosed && (
                    <View style={{ marginTop: 8 }}>
                      <Button
                        label="Wyjaśnij jako różnicę inwentaryzacyjną"
                        secondary
                        fullWidth
                        onPress={() => setForm({ kind: "shortage", shortageId: s.id, asLoss: false, text: "" })}
                      />
                    </View>
                  )}
            </View>
          ))}
        </View>
      )}

      {isAdmin && pendingLosses.length > 0 && (
        <View style={{ ...card, borderColor: COLORS.warning }}>
          <Text style={{ color: COLORS.warning, fontWeight: "800", fontSize: 13 }}>
            ZGŁOSZENIA STRAT DO ZATWIERDZENIA ({pendingLosses.length})
          </Text>
          {pendingLosses.map((r) => (
            <View key={r.id} style={{ marginTop: 10 }}>
              <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
                {nameOf(r.materialId)}: {r.qty} {unitOf(r.materialId)}
              </Text>
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>„{r.reason}” · {r.createdAt.slice(0, 10)}</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                <View style={{ flex: 1 }}>
                  <Button label="Odrzuć" secondary fullWidth onPress={() => run(() => approveMaterialLoss(r.id, false), "Zgłoszenie odrzucone.")} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Zatwierdź stratę" fullWidth onPress={() => run(() => approveMaterialLoss(r.id, true), "Strata zaksięgowana.")} />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={card}>
        <Text style={{ color: COLORS.muted, fontWeight: "800", fontSize: 12, letterSpacing: 0.6 }}>STAN NA BUDOWIE</Text>
        {onSite.length === 0 ? (
          <Text style={{ color: COLORS.muted, fontSize: 13, marginTop: 6 }}>Na budowie nie leży teraz żaden materiał.</Text>
        ) : (
          onSite.map(([materialId, row]) => (
            <View key={materialId} style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: COLORS.foreground, fontWeight: "700", flex: 1 }}>{nameOf(materialId)}</Text>
                <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
                  {Math.round(row.qty * 1000) / 1000} {unitOf(materialId)}
                </Text>
              </View>
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                wartość {formatPLN(row.value)} · {row.batches} {row.batches === 1 ? "partia" : "partie"}
              </Text>
              {!isClosed &&
                (form && form.kind !== "shortage" && form.materialId === materialId ? (
                  form.kind === "return"
                    ? inlineForm("Zwrot na magazyn (te same partie i ceny)", `Ilość (${unitOf(materialId)})`, "Uwaga (opcjonalnie)")
                    : inlineForm(
                        isAdmin ? "Strata — zniszczony, utracony, przeterminowany" : "Zgłoś stratę do Admina",
                        `Ilość (${unitOf(materialId)})`,
                        "Powód (wymagany)",
                      )
                ) : (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    {isAdmin && (
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Zwrot na magazyn"
                          secondary
                          fullWidth
                          onPress={() => setForm({ kind: "return", materialId, qty: String(Math.round(row.qty * 1000) / 1000), text: "" })}
                        />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Button
                        label={isAdmin ? "Strata" : "Zgłoś stratę"}
                        secondary
                        fullWidth
                        onPress={() => setForm({ kind: "loss", materialId, qty: "", text: "" })}
                      />
                    </View>
                  </View>
                ))}
            </View>
          ))
        )}
      </View>
    </View>
  );
}
