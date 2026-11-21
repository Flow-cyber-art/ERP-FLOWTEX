import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COLORS,
  Button,
  Field,
  confirmAction,
  formatPLN,
  notify,
  StatusBadge,
  todayISO,
} from "@/components/report-ui";
import { DateField } from "@/components/date-field";
import { Icon } from "@/components/icon";
import { RADIUS } from "@/constants/radius";
import { useAppData } from "@/contexts/app-data";
import { listSubcontractorRates, listSubcontractors } from "@/lib/data/subcontractors";
import {
  deleteBuildSubcontract,
  deleteSubcontractAcceptance,
  listBuildSubcontracts,
  listSubcontractAcceptances,
  saveBuildSubcontract,
  saveSubcontractAcceptance,
  setAcceptancePaid,
  type AcceptanceRow,
  type BuildSubcontractRow,
  type MaterialBy,
  type SaveAcceptanceItem,
} from "@/lib/data/subcontracts";
import { TECHNOLOGY_UNIT_LABEL, type TechnologyUnit } from "@/lib/data/technologies";

/**
 * Karta budowy → "Podwykonawcy" (krok 3, patrz
 * supabase/sql/113_podwykonawcy_zlecenia_i_odbiory.sql). Per podwykonawca
 * pracujący na budowie:
 *   * ZLECENIE — pozycje per etap: ilość zlecona, stawka zamrożona z
 *     cennika, czyj materiał,
 *   * PROTOKOŁY ODBIORU — odebrana ilość (podpowiedź z raportów
 *     brygadzisty) × stawka + prace dodatkowe − potrącenia; data zapłaty,
 *   * podsumowanie: wartość zlecenia / odebrano / zapłacono / do zapłaty.
 * Suma protokołów wchodzi do kosztu budowy (close_build, Rozliczenie).
 */

const SUBCONTRACTS_KEY = ["buildSubcontracts", "list"] as const;
const ACCEPTANCES_KEY = ["subcontractAcceptances", "list"] as const;
const WHOLE = "__whole__";
const UNITS: TechnologyUnit[] = ["m2", "mb", "szt"];

const parseNum = (value: string) => {
  const n = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
};
const fmtQty = (n: number) => n.toLocaleString("pl-PL", { maximumFractionDigits: 3 });
const toInput = (n: number) => (n ? String(Math.round(n * 1000) / 1000).replace(".", ",") : "");
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Nieznany błąd.");

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: selected ? COLORS.primary : COLORS.background,
        borderRadius: RADIUS.control,
        paddingHorizontal: 9,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: selected ? COLORS.primary : COLORS.border,
      }}
    >
      <Text style={{ color: selected ? COLORS.background : COLORS.foreground, fontWeight: "700", fontSize: 12 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Label({ children, top = 12 }: { children: string; top?: number }) {
  return <Text className="text-xs text-muted uppercase" style={{ marginTop: top, marginBottom: 6 }}>{children}</Text>;
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
      <Text style={{ color: strong ? COLORS.foreground : COLORS.muted, fontSize: 13, fontWeight: strong ? "800" : "400" }}>
        {label}
      </Text>
      <Text style={{ color: COLORS.foreground, fontSize: 13, fontWeight: strong ? "800" : "700" }}>{value}</Text>
    </View>
  );
}

function Link({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={6}>
      <Text style={{ color: danger ? COLORS.danger : COLORS.primary, fontWeight: "700", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

const box = {
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: RADIUS.control,
  padding: 10,
  marginTop: 10,
} as const;

export function BuildSubcontractsSection({ buildId, isClosed }: { buildId: string; isClosed: boolean }) {
  const { builds, buildTeams, teams, teamSubcontractorMap, buildTechnologySnapshots, buildMaterialPlans, savedReports } =
    useAppData();
  const queryClient = useQueryClient();
  const subsQuery = useQuery({ queryKey: ["subcontractors", "list"], queryFn: listSubcontractors });
  const ratesQuery = useQuery({ queryKey: ["subcontractorRates", "list"], queryFn: listSubcontractorRates });
  const linesQuery = useQuery({ queryKey: SUBCONTRACTS_KEY, queryFn: listBuildSubcontracts });
  const accQuery = useQuery({ queryKey: ACCEPTANCES_KEY, queryFn: listSubcontractAcceptances });
  const [busy, setBusy] = useState(false);

  const numericBuildId = Number(buildId);
  const build = builds.find((b) => b.id === buildId);
  const snapshot = buildTechnologySnapshots.find((s) => s.buildId === numericBuildId);

  const stages = useMemo(() => {
    if (snapshot?.stageNames.length) return snapshot.stageNames;
    const order: string[] = [];
    for (const p of buildMaterialPlans) {
      if (p.buildId === numericBuildId && !order.includes(p.stageName)) order.push(p.stageName);
    }
    return order;
  }, [snapshot, buildMaterialPlans, numericBuildId]);

  // Ilość budowy w danej jednostce: podstawowa (areaM2) albo druga miara.
  const buildQuantity = (unit: TechnologyUnit) => {
    if (snapshot?.unit2 && unit === snapshot.unit2 && unit !== snapshot.unit) return Number(build?.quantity2) || 0;
    return Number(build?.areaM2) || 0;
  };

  const run = async (action: () => Promise<unknown>, keys: readonly (readonly string[])[]) => {
    setBusy(true);
    try {
      await action();
      await Promise.all(keys.map((k) => queryClient.invalidateQueries({ queryKey: [...k] })));
      return true;
    } catch (err) {
      notify("Nie udało się zapisać", errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const lines = (linesQuery.data ?? []).filter((l) => l.buildId === numericBuildId);
  const acceptances = (accQuery.data ?? []).filter((a) => a.buildId === numericBuildId);

  // Podwykonawcy na tej budowie: przez brygadę (build_teams) albo przez
  // istniejące zlecenie/protokół (np. brygada już odpięta).
  const subTeams = new Map<number, { teamId: number; stageNames: string[] | null }[]>();
  for (const bt of buildTeams.filter((x) => x.buildId === numericBuildId)) {
    const subId = teamSubcontractorMap.get(bt.teamId);
    if (subId == null) continue;
    subTeams.set(subId, [...(subTeams.get(subId) ?? []), { teamId: bt.teamId, stageNames: bt.stageNames }]);
  }
  const subIds = [
    ...new Set([...subTeams.keys(), ...lines.map((l) => l.subcontractorId), ...acceptances.map((a) => a.subcontractorId)]),
  ];

  if (linesQuery.error || accQuery.error) {
    return (
      <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 10 }}>
        {errorMessage(linesQuery.error ?? accQuery.error)} — jeśli to pierwsze uruchomienie, wklej
        supabase/sql/113_podwykonawcy_zlecenia_i_odbiory.sql w Supabase → SQL Editor.
      </Text>
    );
  }

  if (subIds.length === 0) {
    return (
      <Text style={{ color: COLORS.muted, fontSize: 13, marginTop: 10 }}>
        Na tej budowie nie pracuje żaden podwykonawca. Dodaj jego brygadę w zakładce Przegląd → Brygady na
        budowie, a tu pojawi się zlecenie i protokoły odbioru.
      </Text>
    );
  }

  return (
    <>
      {subIds.map((subId) => (
        <SubcontractorBlock
          key={subId}
          subId={subId}
          subName={subsQuery.data?.find((s) => s.id === subId)?.name ?? "Podwykonawca"}
          teamsOnBuild={subTeams.get(subId) ?? []}
          teamNames={teams}
          lines={lines.filter((l) => l.subcontractorId === subId)}
          acceptances={acceptances.filter((a) => a.subcontractorId === subId)}
          rates={(ratesQuery.data ?? []).filter((r) => r.subcontractorId === subId)}
          stages={stages}
          technologyCode={snapshot?.technologyCode ?? ""}
          defaultUnit={snapshot?.unit ?? "m2"}
          buildQuantity={buildQuantity}
          reportedByStage={(stageName) => {
            const teamIds = (subTeams.get(subId) ?? []).map((t) => t.teamId);
            return savedReports
              .filter((r) => r.buildId === buildId && r.teamId != null && teamIds.includes(r.teamId))
              .flatMap((r) => r.stageProgress ?? [])
              .filter((sp) => stageName === null || sp.stageName === stageName)
              .reduce((sum, sp) => sum + sp.quantity, 0);
          }}
          buildId={numericBuildId}
          isClosed={isClosed}
          busy={busy}
          run={run}
        />
      ))}
    </>
  );
}

type RunFn = (action: () => Promise<unknown>, keys: readonly (readonly string[])[]) => Promise<boolean>;

function SubcontractorBlock({
  subId,
  subName,
  teamsOnBuild,
  teamNames,
  lines,
  acceptances,
  rates,
  stages,
  technologyCode,
  defaultUnit,
  buildQuantity,
  reportedByStage,
  buildId,
  isClosed,
  busy,
  run,
}: {
  subId: number;
  subName: string;
  teamsOnBuild: { teamId: number; stageNames: string[] | null }[];
  teamNames: { id: number; name: string }[];
  lines: BuildSubcontractRow[];
  acceptances: AcceptanceRow[];
  rates: { technologyCode: string; stageName: string | null; unit: TechnologyUnit; rate: number }[];
  stages: string[];
  technologyCode: string;
  defaultUnit: TechnologyUnit;
  buildQuantity: (unit: TechnologyUnit) => number;
  reportedByStage: (stageName: string | null) => number;
  buildId: number;
  isClosed: boolean;
  busy: boolean;
  run: RunFn;
}) {
  const [lineForm, setLineForm] = useState<"new" | number | null>(null);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [expandedAcc, setExpandedAcc] = useState<number | null>(null);

  const stageOrder = (name: string | null) => (name === null ? -1 : stages.indexOf(name) === -1 ? 999 : stages.indexOf(name));
  const sortedLines = [...lines].sort((a, b) => stageOrder(a.stageName) - stageOrder(b.stageName));

  const acceptedQty = (lineId: number) =>
    acceptances.flatMap((a) => a.items).filter((i) => i.subcontractId === lineId).reduce((s, i) => s + (i.quantity ?? 0), 0);

  const contractValue = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const acceptedValue = acceptances.reduce((s, a) => s + a.total, 0);
  const paidValue = acceptances.filter((a) => a.paidOn).reduce((s, a) => s + a.total, 0);

  // Zakres etapów brygad(y) tego podwykonawcy na budowie (null = wszystkie).
  const scope = teamsOnBuild.some((t) => t.stageNames === null)
    ? null
    : [...new Set(teamsOnBuild.flatMap((t) => t.stageNames ?? []))];
  const scopeStages = scope ?? stages;

  const rateFor = (stageName: string | null) =>
    rates.find((r) => r.technologyCode === technologyCode && r.stageName === stageName) ?? null;

  // Zlecenie z cennika: brakujące pozycje dla etapów z zakresu. Gdy cennik
  // ma tylko stawkę "cała technologia" — jedna pozycja na całość.
  const fillFromPriceList = () => {
    const existing = new Set(lines.map((l) => l.stageName ?? WHOLE));
    const stageRates = scopeStages.filter((s) => rateFor(s));
    const whole = rateFor(null);
    const toCreate: { stageName: string | null; unit: TechnologyUnit; rate: number }[] = [];
    if (stageRates.length === 0 && whole) {
      if (!existing.has(WHOLE)) toCreate.push({ stageName: null, unit: whole.unit, rate: whole.rate });
    } else {
      for (const s of scopeStages) {
        if (existing.has(s)) continue;
        const r = rateFor(s);
        toCreate.push({ stageName: s, unit: r?.unit ?? defaultUnit, rate: r?.rate ?? 0 });
      }
    }
    if (toCreate.length === 0) {
      notify("Nic do dodania", "Zlecenie ma już pozycje dla wszystkich etapów z zakresu brygady.");
      return;
    }
    const missingRates = toCreate.filter((c) => c.rate === 0).map((c) => c.stageName ?? "Cała technologia");
    run(async () => {
      for (const c of toCreate) {
        await saveBuildSubcontract({
          buildId,
          subcontractorId: subId,
          teamId: teamsOnBuild[0]?.teamId ?? null,
          technologyCode,
          stageName: c.stageName,
          unit: c.unit,
          quantity: buildQuantity(c.unit),
          rate: c.rate,
          materialBy: "flowtex",
          note: "",
        });
      }
    }, [SUBCONTRACTS_KEY]).then((ok) => {
      if (ok && missingRates.length) {
        notify(
          "Brak stawek w cenniku",
          `Dla etapów: ${missingRates.join(", ")} cennik nie ma stawki — pozycje dodane ze stawką 0 zł, uzupełnij je.`,
        );
      }
    });
  };

  return (
    <View style={{ ...box, marginTop: 14, padding: 12 }}>
      <Text style={{ color: COLORS.foreground, fontWeight: "800", fontSize: 15 }}>{subName}</Text>
      <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
        {teamsOnBuild.length
          ? teamsOnBuild
              .map((t) => `${teamNames.find((x) => x.id === t.teamId)?.name ?? "Brygada"}: ${t.stageNames ? t.stageNames.join(", ") : "wszystkie etapy"}`)
              .join(" · ")
          : "Brygada nie jest już przypisana do budowy"}
      </Text>

      <View style={{ marginTop: 10 }}>
        <Row label="Wartość zlecenia" value={formatPLN(contractValue)} />
        <Row label="Odebrano (protokoły)" value={formatPLN(acceptedValue)} />
        <Row label="Zapłacono" value={formatPLN(paidValue)} />
        <Row label="Do zapłaty" value={formatPLN(acceptedValue - paidValue)} strong />
      </View>

      {/* ---------- Zlecenie ---------- */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <Text className="text-xs text-muted uppercase">Zlecenie</Text>
        {!isClosed && (
          <View style={{ flexDirection: "row", gap: 14 }}>
            <Link label="Z cennika" onPress={fillFromPriceList} />
            <Link label={lineForm === "new" ? "Anuluj" : "+ Pozycja"} onPress={() => setLineForm(lineForm === "new" ? null : "new")} />
          </View>
        )}
      </View>
      {lineForm === "new" && (
        <LineForm
          existing={null}
          stages={scopeStages}
          takenStages={lines.map((l) => l.stageName)}
          rateFor={rateFor}
          defaultUnit={defaultUnit}
          buildQuantity={buildQuantity}
          busy={busy}
          onCancel={() => setLineForm(null)}
          onSave={async (v) => {
            const ok = await run(
              () =>
                saveBuildSubcontract({
                  ...v,
                  buildId,
                  subcontractorId: subId,
                  teamId: teamsOnBuild[0]?.teamId ?? null,
                  technologyCode,
                }),
              [SUBCONTRACTS_KEY],
            );
            if (ok) setLineForm(null);
          }}
        />
      )}
      {sortedLines.length === 0 && lineForm !== "new" && (
        <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>
          Brak pozycji zlecenia. „Z cennika” doda etapy z zakresu brygady ze stawkami z cennika.
        </Text>
      )}
      {sortedLines.map((l) => {
        const accepted = acceptedQty(l.id);
        const reported = reportedByStage(l.stageName);
        const unit = TECHNOLOGY_UNIT_LABEL[l.unit];
        return (
          <View key={l.id} style={{ paddingTop: 8, marginTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
                  {l.stageName ?? "Cała technologia"}
                </Text>
                <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                  {fmtQty(l.quantity)} {unit} × {formatPLN(l.rate)} = {formatPLN(l.quantity * l.rate)}
                </Text>
                <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                  Odebrano {fmtQty(accepted)} / {fmtQty(l.quantity)} {unit} · zgłoszono w raportach {fmtQty(reported)} {unit}
                </Text>
                <Text style={{ color: l.materialBy === "flowtex" ? COLORS.muted : COLORS.primary, fontSize: 11, marginTop: 2 }}>
                  Materiał: {l.materialBy === "flowtex" ? "nasz (z magazynu)" : "podwykonawcy"}
                  {l.rate === 0 ? " · brak stawki!" : ""}
                </Text>
              </View>
              {!isClosed && (
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Link label="Edytuj" onPress={() => setLineForm(lineForm === l.id ? null : l.id)} />
                  <Link
                    label="Usuń"
                    danger
                    onPress={() =>
                      confirmAction("Usunąć pozycję zlecenia?", l.stageName ?? "Cała technologia", "Usuń", () =>
                        run(() => deleteBuildSubcontract(l.id), [SUBCONTRACTS_KEY]),
                      )
                    }
                  />
                </View>
              )}
            </View>
            {lineForm === l.id && (
              <LineForm
                existing={l}
                stages={scopeStages}
                takenStages={[]}
                rateFor={rateFor}
                defaultUnit={defaultUnit}
                buildQuantity={buildQuantity}
                busy={busy}
                onCancel={() => setLineForm(null)}
                onSave={async (v) => {
                  const ok = await run(() => saveBuildSubcontract({ ...l, ...v, id: l.id }), [SUBCONTRACTS_KEY]);
                  if (ok) setLineForm(null);
                }}
              />
            )}
          </View>
        );
      })}

      {/* ---------- Protokoły ---------- */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
        <Text className="text-xs text-muted uppercase">Protokoły odbioru ({acceptances.length})</Text>
        {!isClosed && (
          <Link
            label={protocolOpen ? "Anuluj" : "+ Protokół odbioru"}
            onPress={() => {
              if (!protocolOpen && lines.length === 0) {
                notify("Brak zlecenia", "Najpierw dodaj pozycje zlecenia — protokół odbiera ilości z zlecenia.");
                return;
              }
              setProtocolOpen(!protocolOpen);
            }}
          />
        )}
      </View>

      {protocolOpen && (
        <ProtocolForm
          lines={sortedLines}
          acceptedQty={acceptedQty}
          reportedByStage={reportedByStage}
          busy={busy}
          onCancel={() => setProtocolOpen(false)}
          onSave={async (v) => {
            const ok = await run(
              () => saveSubcontractAcceptance({ ...v, buildId, subcontractorId: subId }),
              [ACCEPTANCES_KEY],
            );
            if (ok) setProtocolOpen(false);
          }}
        />
      )}

      {acceptances.length === 0 && !protocolOpen && (
        <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>Brak protokołów.</Text>
      )}
      {acceptances.map((a) => {
        const open = expandedAcc === a.id;
        return (
          <View key={a.id} style={{ paddingTop: 8, marginTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border }}>
            <Pressable
              onPress={() => setExpandedAcc(open ? null : a.id)}
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
                  Protokół z {a.acceptedOn} · {formatPLN(a.total)}
                </Text>
                {a.note ? <Text style={{ color: COLORS.muted, fontSize: 11 }} numberOfLines={1}>{a.note}</Text> : null}
              </View>
              <StatusBadge
                status={a.paidOn ? "ok" : "warning"}
                label={a.paidOn ? `Zapłacony ${a.paidOn}` : "Do zapłaty"}
              />
              <Icon name={open ? "chevron-up" : "chevron-down"} size={16} color={COLORS.muted} />
            </Pressable>
            {open && (
              <View style={{ marginTop: 6 }}>
                {a.items.map((i) => (
                  <View key={i.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, gap: 8 }}>
                    <Text style={{ color: COLORS.muted, fontSize: 12, flex: 1 }}>
                      {i.kind === "etap"
                        ? `${i.description}: ${fmtQty(i.quantity ?? 0)} × ${formatPLN(i.rate ?? 0)}`
                        : `${i.kind === "potracenie" ? "Potrącenie" : "Dodatkowe"}: ${i.description}`}
                    </Text>
                    <Text style={{ color: i.amount < 0 ? COLORS.danger : COLORS.foreground, fontSize: 12, fontWeight: "700" }}>
                      {formatPLN(i.amount)}
                    </Text>
                  </View>
                ))}
                <View style={{ flexDirection: "row", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                  <Link
                    label={a.paidOn ? "Cofnij zapłatę" : "Oznacz jako zapłacony"}
                    onPress={() => run(() => setAcceptancePaid(a.id, a.paidOn ? null : todayISO()), [ACCEPTANCES_KEY])}
                  />
                  {!isClosed && (
                    <Link
                      label="Usuń protokół"
                      danger
                      onPress={() =>
                        confirmAction(
                          "Usunąć protokół?",
                          `Protokół z ${a.acceptedOn} na ${formatPLN(a.total)}.`,
                          "Usuń",
                          () => run(() => deleteSubcontractAcceptance(a.id), [ACCEPTANCES_KEY]),
                        )
                      }
                    />
                  )}
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function LineForm({
  existing,
  stages,
  takenStages,
  rateFor,
  defaultUnit,
  buildQuantity,
  busy,
  onSave,
  onCancel,
}: {
  existing: BuildSubcontractRow | null;
  stages: string[];
  takenStages: (string | null)[];
  rateFor: (stageName: string | null) => { unit: TechnologyUnit; rate: number } | null;
  defaultUnit: TechnologyUnit;
  buildQuantity: (unit: TechnologyUnit) => number;
  busy: boolean;
  onSave: (v: { stageName: string | null; unit: TechnologyUnit; quantity: number; rate: number; materialBy: MaterialBy; note: string }) => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<string>(existing ? existing.stageName ?? WHOLE : "");
  const [unit, setUnit] = useState<TechnologyUnit>(existing?.unit ?? defaultUnit);
  const [qty, setQty] = useState(existing ? toInput(existing.quantity) : "");
  const [rate, setRate] = useState(existing ? toInput(existing.rate) : "");
  const [materialBy, setMaterialBy] = useState<MaterialBy>(existing?.materialBy ?? "flowtex");
  const [note, setNote] = useState(existing?.note ?? "");

  const pickStage = (s: string) => {
    setStage(s);
    const r = rateFor(s === WHOLE ? null : s);
    const u = r?.unit ?? defaultUnit;
    setUnit(u);
    if (r) setRate(toInput(r.rate));
    if (!qty) setQty(toInput(buildQuantity(u)));
  };

  return (
    <View style={{ ...box, borderColor: COLORS.primary }}>
      {!existing && (
        <>
          <Label top={0}>Etap</Label>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {[WHOLE, ...stages]
              .filter((s) => !takenStages.includes(s === WHOLE ? null : s))
              .map((s) => (
                <Chip key={s} label={s === WHOLE ? "Cała technologia" : s} selected={stage === s} onPress={() => pickStage(s)} />
              ))}
          </View>
        </>
      )}
      <Label top={existing ? 0 : 12}>Jednostka</Label>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {UNITS.map((u) => (
          <Chip key={u} label={TECHNOLOGY_UNIT_LABEL[u]} selected={unit === u} onPress={() => setUnit(u)} />
        ))}
      </View>
      <Label>{`Ilość zlecona (${TECHNOLOGY_UNIT_LABEL[unit]})`}</Label>
      <Field value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="np. 500" style={{ marginTop: 0 }} />
      <Label>{`Stawka netto (zł/${TECHNOLOGY_UNIT_LABEL[unit]}) — zamrożona w zleceniu`}</Label>
      <Field value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="np. 25,00" style={{ marginTop: 0 }} />
      <Label>Materiał</Label>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <Chip label="Nasz (z magazynu)" selected={materialBy === "flowtex"} onPress={() => setMaterialBy("flowtex")} />
        <Chip label="Podwykonawcy" selected={materialBy === "podwykonawca"} onPress={() => setMaterialBy("podwykonawca")} />
      </View>
      <Field value={note} onChangeText={setNote} placeholder="Notatka (opcjonalnie)" style={{ marginTop: 10 }} />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Zapisz"
            disabled={busy}
            onPress={() => {
              const q = parseNum(qty);
              const r = parseNum(rate);
              const missing: string[] = [];
              if (!existing && !stage) missing.push("Etap");
              if (q === null || q < 0) missing.push("Ilość");
              if (r === null || r < 0) missing.push("Stawka");
              if (missing.length) {
                notify("Uzupełnij wymagane pola", missing.join(", "));
                return;
              }
              onSave({
                stageName: existing ? existing.stageName : stage === WHOLE ? null : stage,
                unit,
                quantity: q!,
                rate: r!,
                materialBy,
                note,
              });
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Anuluj" secondary onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}

type ExtraDraft = { key: number; kind: "dodatkowe" | "potracenie"; description: string; amount: string };

function ProtocolForm({
  lines,
  acceptedQty,
  reportedByStage,
  busy,
  onSave,
  onCancel,
}: {
  lines: BuildSubcontractRow[];
  acceptedQty: (lineId: number) => number;
  reportedByStage: (stageName: string | null) => number;
  busy: boolean;
  onSave: (v: { acceptedOn: string; note: string; items: SaveAcceptanceItem[] }) => void;
  onCancel: () => void;
}) {
  // Podpowiedź: to, co brygadzista zgłosił w raportach, a nie zostało
  // jeszcze odebrane (nie więcej niż reszta zlecenia).
  const [qtys, setQtys] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      lines.map((l) => {
        const accepted = acceptedQty(l.id);
        const suggestion = Math.max(0, Math.min(reportedByStage(l.stageName), l.quantity) - accepted);
        return [l.id, toInput(suggestion)];
      }),
    ),
  );
  const [extras, setExtras] = useState<ExtraDraft[]>([]);
  const [acceptedOn, setAcceptedOn] = useState(todayISO());
  const [note, setNote] = useState("");

  const total =
    lines.reduce((s, l) => s + Math.round((parseNum(qtys[l.id] ?? "") ?? 0) * l.rate * 100) / 100, 0) +
    extras.reduce((s, e) => s + (e.kind === "potracenie" ? -1 : 1) * Math.abs(parseNum(e.amount) ?? 0), 0);

  const addExtra = (kind: ExtraDraft["kind"]) =>
    setExtras([...extras, { key: Date.now(), kind, description: "", amount: "" }]);

  return (
    <View style={{ ...box, borderColor: COLORS.primary }}>
      <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 8 }}>
        Wpisz ilości faktycznie odebrane (obmiar). Podpowiedź = zgłoszone w raportach, jeszcze nieodebrane.
      </Text>
      {lines.map((l) => {
        const accepted = acceptedQty(l.id);
        const q = parseNum(qtys[l.id] ?? "") ?? 0;
        const over = accepted + q > l.quantity + 0.0001;
        return (
          <View key={l.id} style={{ marginBottom: 10 }}>
            <Text style={{ color: COLORS.foreground, fontSize: 13, fontWeight: "700" }}>{l.stageName ?? "Cała technologia"}</Text>
            <Text style={{ color: COLORS.muted, fontSize: 11 }}>
              Odebrano {fmtQty(accepted)} z {fmtQty(l.quantity)} {TECHNOLOGY_UNIT_LABEL[l.unit]} · zgłoszono{" "}
              {fmtQty(reportedByStage(l.stageName))} · {formatPLN(l.rate)}/{TECHNOLOGY_UNIT_LABEL[l.unit]}
            </Text>
            <Field
              value={qtys[l.id] ?? ""}
              onChangeText={(v: string) => setQtys({ ...qtys, [l.id]: v })}
              keyboardType="decimal-pad"
              placeholder={`Odebrano teraz (${TECHNOLOGY_UNIT_LABEL[l.unit]})`}
              style={{ marginTop: 6 }}
            />
            {over && (
              <Text style={{ color: COLORS.warning, fontSize: 11, marginTop: 4 }}>
                Razem więcej niż zlecono — sprawdź obmiar albo zwiększ ilość w zleceniu.
              </Text>
            )}
          </View>
        );
      })}

      {extras.map((e) => (
        <View key={e.key} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: e.kind === "potracenie" ? COLORS.danger : COLORS.foreground, fontSize: 13, fontWeight: "700" }}>
              {e.kind === "potracenie" ? "Potrącenie" : "Prace dodatkowe"}
            </Text>
            <Link label="Usuń" danger onPress={() => setExtras(extras.filter((x) => x.key !== e.key))} />
          </View>
          <Field
            value={e.description}
            onChangeText={(v: string) => setExtras(extras.map((x) => (x.key === e.key ? { ...x, description: v } : x)))}
            placeholder="Opis"
            style={{ marginTop: 6 }}
          />
          <Field
            value={e.amount}
            onChangeText={(v: string) => setExtras(extras.map((x) => (x.key === e.key ? { ...x, amount: v } : x)))}
            keyboardType="decimal-pad"
            placeholder="Kwota netto (zł)"
            style={{ marginTop: 6 }}
          />
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
        <Link label="+ Prace dodatkowe" onPress={() => addExtra("dodatkowe")} />
        <Link label="+ Potrącenie" onPress={() => addExtra("potracenie")} />
      </View>

      <Label>Data odbioru</Label>
      <DateField value={acceptedOn} onChange={setAcceptedOn} />
      <Field value={note} onChangeText={setNote} placeholder="Notatka (opcjonalnie)" style={{ marginTop: 10 }} />

      <View style={{ marginTop: 10 }}>
        <Row label="Kwota protokołu (netto)" value={formatPLN(total)} strong />
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Zapisz protokół"
            disabled={busy}
            onPress={() => {
              const items: SaveAcceptanceItem[] = [
                ...lines
                  .map((l) => ({ kind: "etap" as const, subcontractId: l.id, quantity: parseNum(qtys[l.id] ?? "") ?? 0 }))
                  .filter((i) => i.quantity > 0),
                ...extras
                  .map((e) => ({ kind: e.kind, description: e.description, amount: Math.abs(parseNum(e.amount) ?? 0) }))
                  .filter((i) => i.amount > 0),
              ];
              if (items.length === 0) {
                notify("Pusty protokół", "Wpisz odebraną ilość albo kwotę prac dodatkowych/potrącenia.");
                return;
              }
              onSave({ acceptedOn: acceptedOn || todayISO(), note, items });
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Anuluj" secondary onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}
