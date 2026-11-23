import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { COLORS, Button, confirmAction } from "@/components/report-ui";
import { RADIUS } from "@/constants/radius";
import { useAppData } from "@/contexts/app-data";
import { listSubcontractors } from "@/lib/data/subcontractors";
import type { BuildTeamRow } from "@/lib/data/build-teams";

/**
 * "Brygady na budowie" na karcie budowy (Admin) — patrz
 * supabase/sql/112_podwykonawcy_raport_i_brygady_budowy.sql. Brygady
 * własne i podwykonawców, każda z zakresem etapów, dopinane w dowolnym
 * momencie — także gdy budowa zaczęła się brygadą własną, a w trakcie
 * część etapów przejmuje podwykonawca. Brygada główna (plan robocizny)
 * trafia tu sama i zmienia się ją w planie robocizny.
 */

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
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
      <Text
        style={{
          color: selected ? COLORS.background : COLORS.foreground,
          fontWeight: "700",
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function BuildTeamsSection({
  buildId,
  mainTeamId,
  readOnly,
}: {
  buildId: string;
  mainTeamId: number | string | null | undefined;
  readOnly: boolean;
}) {
  const {
    teams,
    buildTeams,
    teamSubcontractorMap,
    buildTechnologySnapshots,
    buildMaterialPlans,
    saveBuildTeam,
    addSubcontractorToBuild,
    removeBuildTeam,
  } = useAppData();
  const subsQuery = useQuery({ queryKey: ["subcontractors", "list"], queryFn: listSubcontractors });

  const numericBuildId = Number(buildId);
  const mainTeam = mainTeamId != null && mainTeamId !== "" ? Number(mainTeamId) : null;
  const rows = buildTeams.filter((bt) => bt.buildId === numericBuildId);

  // Etapy budowy: zamrożona receptura (wszystkie etapy), awaryjnie plan
  // materiałowy (tylko etapy z materiałami).
  const stages = useMemo(() => {
    const snapshot = buildTechnologySnapshots.find((s) => s.buildId === numericBuildId);
    if (snapshot?.stageNames.length) return snapshot.stageNames;
    const order: string[] = [];
    for (const p of buildMaterialPlans) {
      if (p.buildId === numericBuildId && !order.includes(p.stageName)) order.push(p.stageName);
    }
    return order;
  }, [buildTechnologySnapshots, buildMaterialPlans, numericBuildId]);

  const subName = (teamId: number) => {
    const subId = teamSubcontractorMap.get(teamId);
    if (subId == null) return null;
    return subsQuery.data?.find((s) => s.id === subId)?.name ?? "Podwykonawca";
  };

  // null = formularz zamknięty; "new" = dodawanie; liczba = edycja zakresu.
  const [editing, setEditing] = useState<"new" | number | null>(null);
  const [draftTeamId, setDraftTeamId] = useState<number | null>(null);
  // Podwykonawca (firma) bez własnej brygady — przy zapisie baza zakłada
  // mu brygadę i dopina ją do budowy (117).
  const [draftSubId, setDraftSubId] = useState<number | null>(null);
  const [draftStages, setDraftStages] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const openNew = () => {
    setEditing(editing === "new" ? null : "new");
    setDraftTeamId(null);
    setDraftSubId(null);
    setDraftStages(null);
  };
  const openEdit = (row: BuildTeamRow) => {
    setEditing(row.teamId);
    setDraftTeamId(row.teamId);
    setDraftStages(row.stageNames);
  };

  const toggleStage = (stage: string) => {
    const current = draftStages ?? [];
    const next = current.includes(stage)
      ? current.filter((s) => s !== stage)
      : stages.filter((s) => s === stage || current.includes(s));
    setDraftStages(next.length ? next : null);
  };

  const save = async () => {
    if (draftSubId != null) {
      setBusy(true);
      const ok = await addSubcontractorToBuild(numericBuildId, draftSubId, draftStages);
      setBusy(false);
      if (ok) setEditing(null);
      return;
    }
    if (draftTeamId == null) return;
    const row: BuildTeamRow = { buildId: numericBuildId, teamId: draftTeamId, stageNames: draftStages };
    // Ten sam etap u dwóch podwykonawców = niejasne, komu zapłacić za
    // odbiór — ostrzegamy, ale nie blokujemy (bywa podział metrażu).
    const conflicts =
      subName(draftTeamId) == null
        ? []
        : rows
            .filter((r) => r.teamId !== draftTeamId && subName(r.teamId) != null)
            .flatMap((r) =>
              (draftStages ?? stages)
                .filter((s) => r.stageNames == null || r.stageNames.includes(s))
                .map((s) => `${s} (${teams.find((t) => t.id === r.teamId)?.name ?? "brygada"})`),
            );
    const apply = async () => {
      setBusy(true);
      const ok = await saveBuildTeam(row);
      setBusy(false);
      if (ok) setEditing(null);
    };
    if (conflicts.length) {
      confirmAction(
        "Etap ma już innego podwykonawcę",
        `Te etapy są już w zakresie innej brygady podwykonawcy: ${conflicts.join(", ")}. Zapisać mimo to?`,
        "Zapisz",
        apply,
      );
    } else {
      await apply();
    }
  };

  const availableTeams = teams.filter(
    (t) => t.active && !rows.some((r) => r.teamId === t.id),
  );
  // Firmy, które nie mają jeszcze żadnej aktywnej brygady — inaczej nie
  // dałoby się ich wybrać bez wcześniejszego zakładania brygady.
  const availableFirms = (subsQuery.data ?? []).filter(
    (sub) =>
      sub.active &&
      !teams.some((t) => t.active && teamSubcontractorMap.get(t.id) === sub.id),
  );

  const stagePicker = (
    <>
      <Text className="text-xs text-muted uppercase mt-3 mb-2">Zakres etapów</Text>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <Chip
          label="Wszystkie etapy"
          selected={draftStages == null}
          onPress={() => setDraftStages(null)}
        />
        {stages.map((stage) => (
          <Chip
            key={stage}
            label={stage}
            selected={draftStages?.includes(stage) ?? false}
            onPress={() => toggleStage(stage)}
          />
        ))}
      </View>
      {stages.length === 0 && (
        <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 6 }}>
          Budowa nie ma jeszcze technologii — zakres etapów ustawisz po jej przypisaniu.
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Button
            label={busy ? "Zapisywanie…" : "Zapisz"}
            disabled={busy || (draftTeamId == null && draftSubId == null)}
            onPress={save}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Anuluj" secondary onPress={() => setEditing(null)} />
        </View>
      </View>
    </>
  );

  return (
    <View
      style={{
        marginTop: 10,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: RADIUS.control,
        padding: 10,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text className="text-xs text-muted uppercase">Brygady na budowie</Text>
        {!readOnly && (
          <Pressable onPress={openNew}>
            <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
              {editing === "new" ? "Anuluj" : "+ Dodaj brygadę / podwykonawcę"}
            </Text>
          </Pressable>
        )}
      </View>

      {rows.length === 0 && editing !== "new" && (
        <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 6 }}>
          Brak przypisanych brygad.
        </Text>
      )}

      {rows.map((row) => {
        const team = teams.find((t) => t.id === row.teamId);
        const sub = subName(row.teamId);
        const isMain = row.teamId === mainTeam;
        return (
          <View
            key={row.teamId}
            style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
                  {team?.name ?? `Brygada #${row.teamId}`}
                  {isMain ? " · główna" : ""}
                </Text>
                <Text style={{ color: sub ? COLORS.primary : COLORS.muted, fontSize: 11, marginTop: 2 }}>
                  {sub ? `Podwykonawca: ${sub}` : "Brygada własna"}
                </Text>
                <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                  {row.stageNames ? row.stageNames.join(", ") : "Wszystkie etapy"}
                </Text>
              </View>
              {!readOnly && (
                <>
                  <Pressable onPress={() => (editing === row.teamId ? setEditing(null) : openEdit(row))}>
                    <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 12 }}>
                      Zakres
                    </Text>
                  </Pressable>
                  {!isMain && (
                    <Pressable
                      onPress={() =>
                        confirmAction(
                          "Odpiąć brygadę od budowy?",
                          `${team?.name ?? "Brygada"} nie będzie mogła raportować na tej budowie. Zapisane raporty zostają.`,
                          "Odepnij",
                          () => removeBuildTeam(numericBuildId, row.teamId),
                        )
                      }
                    >
                      <Text style={{ color: COLORS.danger, fontWeight: "700", fontSize: 12 }}>
                        Odepnij
                      </Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
            {editing === row.teamId && stagePicker}
          </View>
        );
      })}

      {editing === "new" && (
        <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border }}>
          <Text className="text-xs text-muted uppercase mb-2">Brygada / podwykonawca</Text>
          {availableTeams.length === 0 && availableFirms.length === 0 ? (
            <Text style={{ color: COLORS.muted, fontSize: 12 }}>
              Wszystkie aktywne brygady i podwykonawcy są już na tej budowie.
            </Text>
          ) : (
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {availableTeams.map((t) => {
                const sub = subName(t.id);
                return (
                  <Chip
                    key={t.id}
                    label={sub ? `${t.name} (${sub})` : t.name}
                    selected={draftTeamId === t.id}
                    onPress={() => {
                      setDraftSubId(null);
                      setDraftTeamId(draftTeamId === t.id ? null : t.id);
                    }}
                  />
                );
              })}
              {availableFirms.map((sub) => (
                <Chip
                  key={`sub-${sub.id}`}
                  label={`${sub.name} (podwykonawca)`}
                  selected={draftSubId === sub.id}
                  onPress={() => {
                    setDraftTeamId(null);
                    setDraftSubId(draftSubId === sub.id ? null : sub.id);
                  }}
                />
              ))}
            </View>
          )}
          {stagePicker}
        </View>
      )}

      {!readOnly && mainTeam != null && (
        <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 8 }}>
          Brygadę główną zmieniasz w planie robocizny powyżej.
        </Text>
      )}
    </View>
  );
}
