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
  pluralPL,
  SearchField,
  ToggleChip,
} from "@/components/report-ui";
import { TechnologyPicker } from "@/components/technology-picker";
import { Icon } from "@/components/icon";
import { RADIUS } from "@/constants/radius";
import { useAppData } from "@/contexts/app-data";
import {
  EMPTY_SUBCONTRACTOR,
  createSubcontractor,
  deleteSubcontractorRate,
  listSubcontractorRates,
  listSubcontractors,
  listTeamSubcontractors,
  saveSubcontractorRate,
  setSubcontractorActive,
  setTeamSubcontractor,
  updateSubcontractor,
  type SubcontractorInput,
  type SubcontractorRateRow,
  type SubcontractorRow,
} from "@/lib/data/subcontractors";
import {
  TECHNOLOGY_UNIT_LABEL,
  listActiveTechnologies,
  type TechnologyRow,
  type TechnologyUnit,
} from "@/lib/data/technologies";

/**
 * HR → Podwykonawcy (krok 1, patrz supabase/sql/111_podwykonawcy.sql):
 * kartoteka firm, przypisanie brygad (brygada podwykonawcy = zwykła
 * brygada z ustawionym podwykonawcą) i cennik za etap technologii.
 * Zlecenia na budowie, odbiory etapów i protokoły to kolejne kroki.
 */

const SUBS_KEY = ["subcontractors", "list"] as const;
const RATES_KEY = ["subcontractorRates", "list"] as const;
const TEAM_SUBS_KEY = ["teamSubcontractors", "list"] as const;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Nieznany błąd.");

const parseAmount = (value: string) => {
  const n = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
};

function Chip({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: selected ? COLORS.primary : COLORS.background,
        borderRadius: RADIUS.control,
        paddingHorizontal: 9,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: selected ? COLORS.primary : COLORS.border,
        opacity: disabled ? 0.45 : 1,
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

function SubcontractorForm({
  value,
  onChange,
}: {
  value: SubcontractorInput;
  onChange: (next: SubcontractorInput) => void;
}) {
  const field = (key: keyof SubcontractorInput, placeholder: string, extra: object = {}) => (
    <Field
      placeholder={placeholder}
      value={value[key]}
      onChangeText={(text: string) => onChange({ ...value, [key]: text })}
      style={{ marginTop: 8 }}
      {...extra}
    />
  );
  return (
    <>
      {field("name", "Nazwa firmy *")}
      {field("nip", "NIP", { keyboardType: "number-pad" })}
      {field("contactPerson", "Osoba kontaktowa")}
      {field("phone", "Telefon", { keyboardType: "phone-pad" })}
      {field("email", "E-mail", { keyboardType: "email-address", autoCapitalize: "none" })}
      {field("bankAccount", "Numer konta", { keyboardType: "number-pad" })}
      {field("note", "Notatka", { multiline: true, numberOfLines: 3 })}
    </>
  );
}

export function SubcontractorsSection() {
  const queryClient = useQueryClient();
  const { teams } = useAppData();

  const subsQuery = useQuery({ queryKey: SUBS_KEY, queryFn: listSubcontractors });
  const ratesQuery = useQuery({ queryKey: RATES_KEY, queryFn: listSubcontractorRates });
  const teamSubsQuery = useQuery({ queryKey: TEAM_SUBS_KEY, queryFn: listTeamSubcontractors });
  const techQuery = useQuery({
    queryKey: ["technologies", "active"],
    queryFn: listActiveTechnologies,
  });

  const subcontractors = subsQuery.data ?? [];
  const rates = ratesQuery.data ?? [];
  const technologies = techQuery.data ?? [];

  const teamSubMap = useMemo(() => {
    const map = new Map<number, number | null>();
    for (const row of teamSubsQuery.data ?? []) map.set(row.teamId, row.subcontractorId);
    return map;
  }, [teamSubsQuery.data]);

  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newSub, setNewSub] = useState<SubcontractorInput>(EMPTY_SUBCONTRACTOR);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>, keys: readonly (readonly string[])[]) => {
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

  const q = query.trim().toLowerCase();
  const visible = subcontractors.filter(
    (s) =>
      (showArchived || s.active) &&
      (!q || s.name.toLowerCase().includes(q) || s.nip.includes(q)),
  );

  if (subsQuery.error) {
    return (
      <View className="bg-surface border border-border rounded-card p-5 mb-5">
        <Text className="text-sm font-bold text-foreground mb-1">
          Nie udało się wczytać podwykonawców
        </Text>
        <Text style={{ color: COLORS.muted, fontSize: 12 }}>
          {errorMessage(subsQuery.error)} — jeśli to pierwsze uruchomienie, wklej
          supabase/sql/111_podwykonawcy.sql w Supabase → SQL Editor.
        </Text>
      </View>
    );
  }

  return (
    <>
      {/* Tytuł i akcje w osobnych wierszach — w jednym nie mieściły się na
          telefonie ("+ Dodaj podwykonawcę" było ucięte). */}
      <View className="mb-3">
        <Text className="text-base font-bold text-foreground">
          Podwykonawcy ({subcontractors.filter((s) => s.active).length})
        </Text>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            columnGap: 16,
            rowGap: 8,
            marginTop: 10,
          }}
        >
          <ToggleChip label="Archiwum" value={showArchived} onChange={setShowArchived} />
          <Pressable onPress={() => setAddOpen(!addOpen)}>
            <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
              {addOpen ? "Anuluj" : "+ Dodaj podwykonawcę"}
            </Text>
          </Pressable>
        </View>
      </View>

      {addOpen && (
        <View className="bg-surface border border-border rounded-card p-4 mb-3">
          <SubcontractorForm value={newSub} onChange={setNewSub} />
          <View style={{ marginTop: 10 }}>
            <Button
              label="Dodaj podwykonawcę"
              disabled={busy}
              onPress={async () => {
                if (!newSub.name.trim()) {
                  notify("Uzupełnij wymagane pola", "Nazwa firmy");
                  return;
                }
                const ok = await run(() => createSubcontractor(newSub), [SUBS_KEY]);
                if (ok) {
                  setNewSub(EMPTY_SUBCONTRACTOR);
                  setAddOpen(false);
                }
              }}
            />
          </View>
        </View>
      )}

      {subcontractors.length > 3 && (
        <View style={{ marginBottom: 12 }}>
          <SearchField
            placeholder="Szukaj po nazwie lub NIP"
            value={query}
            onChangeText={setQuery}
          />
        </View>
      )}

      {subsQuery.isLoading && (
        <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 12 }}>Wczytywanie…</Text>
      )}

      {!subsQuery.isLoading && visible.length === 0 && (
        <View className="bg-surface border border-border rounded-card p-5 items-center mb-5">
          <Text className="text-sm text-muted">Brak podwykonawców.</Text>
        </View>
      )}

      {visible.length > 0 && (
        <View className="bg-surface border border-border rounded-card overflow-hidden mb-5">
          {visible.map((sub, i) => {
            const subRates = rates.filter((r) => r.subcontractorId === sub.id);
            const subTeams = teams.filter((t) => teamSubMap.get(t.id) === sub.id);
            const expanded = expandedId === sub.id;
            return (
              <View
                key={sub.id}
                style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: COLORS.border }}
              >
                <Pressable
                  onPress={() => setExpandedId(expanded ? null : sub.id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    opacity: sub.active ? 1 : 0.6,
                  }}
                >
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                      {sub.name}
                      {!sub.active ? " (archiwum)" : ""}
                    </Text>
                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                      {subTeams.length} {pluralPL(subTeams.length, "brygada", "brygady", "brygad")}
                      {" · "}
                      {subRates.length} {pluralPL(subRates.length, "stawka", "stawki", "stawek")}
                      {sub.nip ? ` · NIP ${sub.nip}` : ""}
                    </Text>
                  </View>
                  <Icon
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={COLORS.muted}
                  />
                </Pressable>
                {expanded && (
                  <SubcontractorDetails
                    sub={sub}
                    rates={subRates}
                    technologies={technologies}
                    teams={teams}
                    teamSubMap={teamSubMap}
                    subcontractors={subcontractors}
                    busy={busy}
                    run={run}
                  />
                )}
              </View>
            );
          })}
        </View>
      )}
    </>
  );
}

type RunFn = (
  action: () => Promise<void>,
  keys: readonly (readonly string[])[],
) => Promise<boolean>;

function SectionLabel({ children }: { children: string }) {
  return <Text className="text-xs text-muted uppercase mb-2 mt-4">{children}</Text>;
}

function SubcontractorDetails({
  sub,
  rates,
  technologies,
  teams,
  teamSubMap,
  subcontractors,
  busy,
  run,
}: {
  sub: SubcontractorRow;
  rates: SubcontractorRateRow[];
  technologies: TechnologyRow[];
  teams: { id: number; name: string; active: boolean }[];
  teamSubMap: Map<number, number | null>;
  subcontractors: SubcontractorRow[];
  busy: boolean;
  run: RunFn;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<SubcontractorInput>(sub);
  const [rateFormOpen, setRateFormOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<SubcontractorRateRow | null>(null);

  const techByCode = useMemo(() => {
    const map = new Map<string, TechnologyRow>();
    for (const t of technologies) map.set(t.code, t);
    return map;
  }, [technologies]);

  const ratesByTech = useMemo(() => {
    const groups = new Map<string, SubcontractorRateRow[]>();
    for (const r of rates) {
      const list = groups.get(r.technologyCode) ?? [];
      list.push(r);
      groups.set(r.technologyCode, list);
    }
    // Etapy w kolejności receptury, "cała technologia" na początku.
    for (const [code, list] of groups) {
      const stages = techByCode.get(code)?.technology_stages ?? [];
      const order = (name: string | null) =>
        name === null ? -1 : stages.find((s) => s.name === name)?.orderIndex ?? 999;
      list.sort((a, b) => order(a.stageName) - order(b.stageName));
    }
    return [...groups.entries()];
  }, [rates, techByCode]);

  const detailLine = (label: string, value: string) =>
    value ? (
      <Text style={{ color: COLORS.foreground, fontSize: 13, marginTop: 2 }}>
        <Text style={{ color: COLORS.muted }}>{label}: </Text>
        {value}
      </Text>
    ) : null;

  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
      {/* Dane firmy */}
      {editing ? (
        <>
          <SubcontractorForm value={form} onChange={setForm} />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Zapisz"
                disabled={busy}
                onPress={async () => {
                  if (!form.name.trim()) {
                    notify("Uzupełnij wymagane pola", "Nazwa firmy");
                    return;
                  }
                  const ok = await run(() => updateSubcontractor(sub.id, form), [SUBS_KEY]);
                  if (ok) setEditing(false);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Anuluj"
                secondary
                onPress={() => {
                  setForm(sub);
                  setEditing(false);
                }}
              />
            </View>
          </View>
        </>
      ) : (
        <>
          {detailLine("NIP", sub.nip)}
          {detailLine("Kontakt", sub.contactPerson)}
          {detailLine("Telefon", sub.phone)}
          {detailLine("E-mail", sub.email)}
          {detailLine("Konto", sub.bankAccount)}
          {detailLine("Notatka", sub.note)}
          <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
            <Pressable
              onPress={() => {
                setForm(sub);
                setEditing(true);
              }}
            >
              <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
                Edytuj dane
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                sub.active
                  ? confirmAction(
                      "Archiwizować podwykonawcę?",
                      `${sub.name} zniknie z listy aktywnych. Historia i cennik zostają.`,
                      "Archiwizuj",
                      () => run(() => setSubcontractorActive(sub.id, false), [SUBS_KEY]),
                    )
                  : run(() => setSubcontractorActive(sub.id, true), [SUBS_KEY])
              }
            >
              <Text
                style={{
                  color: sub.active ? COLORS.danger : COLORS.primary,
                  fontWeight: "700",
                  fontSize: 13,
                }}
              >
                {sub.active ? "Archiwizuj" : "Przywróć"}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {/* Brygady */}
      <SectionLabel>Brygady podwykonawcy</SectionLabel>
      <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 8 }}>
        Dotknij brygady, żeby ją przypisać lub odpiąć. Brygadę z liderem (brygadzistą
        podwykonawcy) zakładasz w zakładce Zespół → Brygady.
      </Text>
      {teams.length === 0 ? (
        <Text style={{ color: COLORS.muted, fontSize: 12 }}>Brak brygad.</Text>
      ) : (
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {teams
            .filter((t) => t.active || teamSubMap.get(t.id) === sub.id)
            .map((team) => {
              const ownerId = teamSubMap.get(team.id) ?? null;
              const mine = ownerId === sub.id;
              const other = ownerId !== null && !mine
                ? subcontractors.find((s) => s.id === ownerId)
                : undefined;
              return (
                <Chip
                  key={team.id}
                  label={other ? `${team.name} (${other.name})` : team.name}
                  selected={mine}
                  disabled={busy}
                  onPress={() => {
                    const apply = () =>
                      run(() => setTeamSubcontractor(team.id, mine ? null : sub.id), [
                        TEAM_SUBS_KEY,
                        ["teams"],
                      ]);
                    if (other) {
                      confirmAction(
                        "Przenieść brygadę?",
                        `Brygada ${team.name} jest przypisana do: ${other.name}. Przypisać ją do: ${sub.name}?`,
                        "Przenieś",
                        apply,
                      );
                    } else {
                      apply();
                    }
                  }}
                />
              );
            })}
        </View>
      )}

      {/* Cennik */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 16,
          marginBottom: 8,
        }}
      >
        <Text className="text-xs text-muted uppercase">Cennik za etap (netto)</Text>
        <Pressable
          onPress={() => {
            setEditingRate(null);
            setRateFormOpen(!rateFormOpen);
          }}
        >
          <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
            {rateFormOpen && !editingRate ? "Anuluj" : "+ Dodaj stawkę"}
          </Text>
        </Pressable>
      </View>

      {rateFormOpen && (
        <RateForm
          key={editingRate?.id ?? "new"}
          subcontractorId={sub.id}
          technologies={technologies}
          existing={editingRate}
          busy={busy}
          run={run}
          onDone={() => {
            setRateFormOpen(false);
            setEditingRate(null);
          }}
        />
      )}

      {ratesByTech.length === 0 && !rateFormOpen && (
        <Text style={{ color: COLORS.muted, fontSize: 12 }}>Brak stawek.</Text>
      )}

      {ratesByTech.map(([code, list]) => {
        const tech = techByCode.get(code);
        return (
          <View
            key={code}
            style={{
              borderWidth: 1,
              borderColor: COLORS.border,
              borderRadius: RADIUS.control,
              padding: 10,
              marginBottom: 8,
            }}
          >
            <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
              {code}
              {tech ? ` · ${tech.name}` : " · (technologia nieaktywna)"}
            </Text>
            {list.map((r) => (
              <View
                key={r.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 6,
                  gap: 8,
                }}
              >
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => {
                    setEditingRate(r);
                    setRateFormOpen(true);
                  }}
                >
                  <Text style={{ color: COLORS.foreground, fontSize: 13 }}>
                    {r.stageName ?? "Cała technologia"}
                  </Text>
                  {r.note ? (
                    <Text style={{ color: COLORS.muted, fontSize: 11 }}>{r.note}</Text>
                  ) : null}
                </Pressable>
                <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
                  {formatPLN(r.rate)}/{TECHNOLOGY_UNIT_LABEL[r.unit]}
                </Text>
                <Pressable
                  onPress={() =>
                    confirmAction(
                      "Usunąć stawkę?",
                      `${code} · ${r.stageName ?? "Cała technologia"}`,
                      "Usuń",
                      () => run(() => deleteSubcontractorRate(r.id), [RATES_KEY]),
                    )
                  }
                >
                  <Text style={{ color: COLORS.danger, fontSize: 12, fontWeight: "700" }}>
                    Usuń
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const WHOLE_TECHNOLOGY = "__whole__";
const UNITS: TechnologyUnit[] = ["m2", "mb", "szt"];

function RateForm({
  subcontractorId,
  technologies,
  existing,
  busy,
  run,
  onDone,
}: {
  subcontractorId: number;
  technologies: TechnologyRow[];
  existing: SubcontractorRateRow | null;
  busy: boolean;
  run: RunFn;
  onDone: () => void;
}) {
  const [techId, setTechId] = useState<number | null>(
    existing ? technologies.find((t) => t.code === existing.technologyCode)?.id ?? null : null,
  );
  const tech = technologies.find((t) => t.id === techId) ?? null;
  const [stage, setStage] = useState<string>(
    existing ? existing.stageName ?? WHOLE_TECHNOLOGY : "",
  );
  const [unit, setUnit] = useState<TechnologyUnit>(existing?.unit ?? "m2");
  const [rate, setRate] = useState(existing ? String(existing.rate).replace(".", ",") : "");
  const [note, setNote] = useState(existing?.note ?? "");

  const stages = useMemo(
    () => [...(tech?.technology_stages ?? [])].sort((a, b) => a.orderIndex - b.orderIndex),
    [tech],
  );

  const technologyCode = existing?.technologyCode ?? tech?.code ?? null;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: COLORS.primary,
        borderRadius: RADIUS.control,
        padding: 10,
        marginBottom: 10,
      }}
    >
      <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13, marginBottom: 6 }}>
        {existing ? `Edycja stawki · ${existing.technologyCode}` : "Nowa stawka"}
      </Text>

      {!existing && (
        <TechnologyPicker
          technologies={technologies}
          selectedId={techId}
          onSelect={(id) => {
            setTechId(id);
            setStage("");
            const picked = technologies.find((t) => t.id === id);
            if (picked) setUnit(picked.unit);
          }}
        />
      )}

      {technologyCode && (
        <>
          <SectionLabel>Etap</SectionLabel>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Chip
              label="Cała technologia"
              selected={stage === WHOLE_TECHNOLOGY}
              onPress={() => setStage(WHOLE_TECHNOLOGY)}
            />
            {stages.map((s) => (
              <Chip
                key={s.id}
                label={s.name}
                selected={stage === s.name}
                onPress={() => setStage(s.name)}
              />
            ))}
            {/* Etap, którego nie ma już w aktywnej wersji receptury. */}
            {existing?.stageName && !stages.some((s) => s.name === existing.stageName) && (
              <Chip
                label={existing.stageName}
                selected={stage === existing.stageName}
                onPress={() => setStage(existing.stageName!)}
              />
            )}
          </View>

          <SectionLabel>Jednostka</SectionLabel>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {UNITS.map((u) => (
              <Chip
                key={u}
                label={TECHNOLOGY_UNIT_LABEL[u]}
                selected={unit === u}
                onPress={() => setUnit(u)}
              />
            ))}
          </View>

          <SectionLabel>{`Stawka netto (zł/${TECHNOLOGY_UNIT_LABEL[unit]})`}</SectionLabel>
          <Field placeholder="np. 25,00" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
          <Field
            placeholder="Notatka (opcjonalnie)"
            value={note}
            onChangeText={setNote}
            style={{ marginTop: 8 }}
          />
        </>
      )}

      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Zapisz stawkę"
            disabled={busy || !technologyCode}
            onPress={async () => {
              const amount = parseAmount(rate);
              const missing: string[] = [];
              if (!technologyCode) missing.push("Technologia");
              if (!stage) missing.push("Etap");
              if (amount === null || amount < 0) missing.push("Stawka");
              if (missing.length) {
                notify("Uzupełnij wymagane pola", missing.join(", "));
                return;
              }
              const ok = await run(
                () =>
                  saveSubcontractorRate({
                    id: existing?.id,
                    subcontractorId,
                    technologyCode: technologyCode!,
                    stageName: stage === WHOLE_TECHNOLOGY ? null : stage,
                    unit,
                    rate: amount!,
                    note,
                  }),
                [RATES_KEY],
              );
              if (ok) onDone();
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Anuluj" secondary onPress={onDone} />
        </View>
      </View>
    </View>
  );
}
