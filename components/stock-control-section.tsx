import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, COLORS, formatPLN, notify } from "@/components/report-ui";
import { RADIUS } from "@/constants/radius";
import { useAppData } from "@/contexts/app-data";
import {
  approveMaterialLoss,
  listIntegrityAlerts,
  listLossRequests,
  listPendingStockReviews,
  listShortages,
  verifyStockOperation,
} from "@/lib/data/stock-v2";

/**
 * „Kontrola magazynu” (Admin, ekran Magazyn) — wszystko, co w magazynie v2
 * czeka na decyzję Admina, ze wszystkich budów naraz:
 *  - pobrania z magazynu zrobione przez brygadzistę (D3: ruch od razu,
 *    weryfikacja po fakcie),
 *  - zgłoszenia strat brygadzisty (D5),
 *  - niedobory do wyjaśnienia (szczegóły i wyjaśnianie — na karcie budowy),
 *  - alerty nocnej kontroli spójności (supabase/sql/123).
 * Gdy nic nie czeka — sekcja się nie pokazuje.
 */
export function StockControlSection() {
  const { materials, builds, devRole } = useAppData();
  const queryClient = useQueryClient();
  const isAdmin = devRole === "Admin";
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const reviewsQuery = useQuery({ queryKey: ["stockReviews", "list"], queryFn: listPendingStockReviews, enabled: isAdmin });
  const lossQuery = useQuery({ queryKey: ["lossRequests", "list"], queryFn: listLossRequests, enabled: isAdmin });
  const shortagesQuery = useQuery({ queryKey: ["shortages", "list"], queryFn: listShortages, enabled: isAdmin });
  const alertsQuery = useQuery({ queryKey: ["integrityAlerts", "list"], queryFn: listIntegrityAlerts, enabled: isAdmin });

  const materialById = useMemo(() => new Map(materials.map((m) => [Number(m.id), m])), [materials]);
  const buildName = (id: number | null) => {
    const b = builds.find((x) => Number(x.id) === id);
    return b ? `${b.number} · ${b.name}` : id ? `Budowa #${id}` : "—";
  };
  const mat = (id: number) => materialById.get(id);

  if (!isAdmin) return null;
  const reviews = reviewsQuery.data ?? [];
  const losses = (lossQuery.data ?? []).filter((r) => r.status === "oczekuje");
  const shortages = (shortagesQuery.data ?? []).filter((s) => s.status === "do_wyjasnienia");
  const alerts = alertsQuery.data ?? [];
  const total = reviews.length + losses.length + shortages.length + alerts.length;
  if (total === 0) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      for (const key of ["stockReviews", "lossRequests", "shortages", "buildMaterialLots", "buildMaterials", "buildMaterialReturns"]) {
        await queryClient.invalidateQueries({ queryKey: [key] });
      }
    } catch (error) {
      notify("Nie udało się zapisać", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const sectionTitle = (text: string) => (
    <Text style={{ color: COLORS.muted, fontWeight: "800", fontSize: 11, letterSpacing: 0.6, marginTop: 12 }}>{text}</Text>
  );

  return (
    <View
      style={{
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.card,
        borderWidth: 1,
        borderColor: alerts.length ? COLORS.danger : COLORS.warning,
        padding: 14,
        marginBottom: 16,
      }}
    >
      <Pressable onPress={() => setExpanded(!expanded)} style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: COLORS.foreground, fontWeight: "800", fontSize: 15 }}>
          Kontrola magazynu — {total} {total === 1 ? "sprawa" : total < 5 ? "sprawy" : "spraw"} do decyzji
        </Text>
        <Text style={{ color: COLORS.primary, fontWeight: "700" }}>{expanded ? "Zwiń" : "Pokaż"}</Text>
      </Pressable>

      {expanded && (
        <>
          {alerts.length > 0 && (
            <>
              {sectionTitle("ROZBIEŻNOŚCI W STANACH (NOCNA KONTROLA)")}
              {alerts.map((a) => (
                <Text key={a.id} style={{ color: COLORS.danger, fontSize: 13, marginTop: 6 }}>
                  {a.checkedAt.slice(0, 16).replace("T", " ")} — {a.issues.length}{" "}
                  {a.issues.length === 1 ? "rozbieżność" : "rozbieżności"} ({[...new Set(a.issues.map((i) => i.check))].join(", ")}).
                  Saldo partii nie zgadza się z księgą ruchów — zgłoś to, nie poprawiaj ręcznie.
                </Text>
              ))}
            </>
          )}

          {reviews.length > 0 && (
            <>
              {sectionTitle(`POBRANIA BRYGADZISTY DO WERYFIKACJI (${reviews.length})`)}
              {reviews.map((r) => (
                <View key={r.id} style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>{buildName(r.buildId)}</Text>
                    <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                      {r.lines
                        .map((l) => `${mat(l.materialId)?.name ?? `#${l.materialId}`} ${l.quantity} ${mat(l.materialId)?.unit ?? ""} (${formatPLN(l.quantity * l.unitPrice)})`)
                        .join(", ")}{" "}
                      · {r.createdAt.slice(0, 10)}
                    </Text>
                  </View>
                  <Button label="Potwierdzam" secondary disabled={busy} onPress={() => run(() => verifyStockOperation(r.id))} />
                </View>
              ))}
              <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 6 }}>
                Stan zmienił się już przy pobraniu. Jeśli pobranie było błędne — zwróć materiał z karty budowy (Materiały → Zwrot na magazyn).
              </Text>
            </>
          )}

          {losses.length > 0 && (
            <>
              {sectionTitle(`ZGŁOSZENIA STRAT (${losses.length})`)}
              {losses.map((r) => (
                <View key={r.id} style={{ marginTop: 8 }}>
                  <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
                    {buildName(r.buildId)}: {mat(r.materialId)?.name ?? `#${r.materialId}`} {r.qty} {mat(r.materialId)?.unit ?? ""}
                  </Text>
                  <Text style={{ color: COLORS.muted, fontSize: 12 }}>„{r.reason}”</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Button label="Odrzuć" secondary fullWidth disabled={busy} onPress={() => run(() => approveMaterialLoss(r.id, false))} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label="Zatwierdź stratę" fullWidth disabled={busy} onPress={() => run(() => approveMaterialLoss(r.id, true))} />
                    </View>
                  </View>
                </View>
              ))}
            </>
          )}

          {shortages.length > 0 && (
            <>
              {sectionTitle(`NIEDOBORY DO WYJAŚNIENIA (${shortages.length})`)}
              {shortages.map((s) => (
                <Text key={s.id} style={{ color: COLORS.foreground, fontSize: 13, marginTop: 6 }}>
                  {buildName(s.buildId)}: {mat(s.materialId)?.name ?? `#${s.materialId}`} {s.qtyOpen} {mat(s.materialId)?.unit ?? ""}{" "}
                  <Text style={{ color: COLORS.muted }}>(wyjaśnij na karcie budowy → Materiały)</Text>
                </Text>
              ))}
            </>
          )}
        </>
      )}
    </View>
  );
}
