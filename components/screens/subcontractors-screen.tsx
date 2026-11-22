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
import { Icon } from "@/components/icon";
import { RADIUS } from "@/constants/radius";
import { useAppData } from "@/contexts/app-data";
import {
  EMPTY_SUBCONTRACTOR,
  createSubcontractor,
  listSubcontractors,
  listTeamSubcontractors,
  parseRateInput,
  setSubcontractorActive,
  setTeamSubcontractor,
  subcontractorToInput,
  updateSubcontractor,
  type SubcontractorInput,
  type SubcontractorRow,
} from "@/lib/data/subcontractors";

/**
 * Podwykonawcy (osobna zakładka; na mobile przełączana z HR):
 * kartoteka firm z JEDNĄ stawką netto zł/m² (niezależną od technologii,
 * patrz supabase/sql/114_podwykonawca_jedna_stawka_m2.sql) i przypisanie
 * brygad (brygada podwykonawcy = zwykła brygada z ustawionym
 * podwykonawcą). Zlecenia i protokoły odbioru są na karcie budowy.
 */

const SUBS_KEY = ["subcontractors", "list"] as const;
const TEAM_SUBS_KEY = ["teamSubcontractors", "list"] as const;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Nieznany błąd.");

/** Walidacja formularza firmy — lista brakujących/błędnych pól. */
const validateSubcontractor = (input: SubcontractorInput) => {
  const problems: string[] = [];
  if (!input.name.trim()) problems.push("Nazwa firmy");
  if (parseRateInput(input.rate) === null) problems.push("Stawka (liczba, np. 25,00)");
  return problems;
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
      {field("rate", "Stawka netto (zł/m²), np. 25,00", { keyboardType: "decimal-pad" })}
      {field("nip", "NIP", { keyboardType: "number-pad" })}
      {field("contactPerson", "Osoba kontaktowa")}
      {field("phone", "Telefon", { keyboardType: "phone-pad" })}
      {field("email", "E-mail", { keyboardType: "email-address", autoCapitalize: "none" })}
      {field("bankAccount", "Numer konta", { keyboardType: "number-pad" })}
      {field("note", "Notatka", { multiline: true, numberOfLines: 3 })}
    </>
  );
}

/** Osobna zakładka nawigacji "Podwykonawcy" (na mobile przełączana z HR). */
export function SubcontractorsScreen() {
  return <SubcontractorsSection />;
}

export function SubcontractorsSection() {
  const queryClient = useQueryClient();
  const { teams } = useAppData();

  const subsQuery = useQuery({ queryKey: SUBS_KEY, queryFn: listSubcontractors });
  const teamSubsQuery = useQuery({ queryKey: TEAM_SUBS_KEY, queryFn: listTeamSubcontractors });

  const subcontractors = subsQuery.data ?? [];

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
          <View style={{ marginTop: 12 }}>
            <Button
              label="Dodaj podwykonawcę"
              disabled={busy}
              onPress={async () => {
                const problems = validateSubcontractor(newSub);
                if (problems.length) {
                  notify("Uzupełnij wymagane pola", problems.join(", "));
                  return;
                }
                const ok = await run(async () => {
                  await createSubcontractor(newSub);
                }, [SUBS_KEY]);
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
                      {sub.rate > 0 ? `${formatPLN(sub.rate)}/m²` : "bez stawki"}
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
  teams,
  teamSubMap,
  subcontractors,
  busy,
  run,
}: {
  sub: SubcontractorRow;
  teams: { id: number; name: string; active: boolean }[];
  teamSubMap: Map<number, number | null>;
  subcontractors: SubcontractorRow[];
  busy: boolean;
  run: RunFn;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<SubcontractorInput>(() => subcontractorToInput(sub));

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
                  const problems = validateSubcontractor(form);
                  if (problems.length) {
                    notify("Uzupełnij wymagane pola", problems.join(", "));
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
                  setForm(subcontractorToInput(sub));
                  setEditing(false);
                }}
              />
            </View>
          </View>
        </>
      ) : (
        <>
          {detailLine("Stawka", sub.rate > 0 ? `${formatPLN(sub.rate)} netto za m²` : "nie ustawiona")}
          {detailLine("NIP", sub.nip)}
          {detailLine("Kontakt", sub.contactPerson)}
          {detailLine("Telefon", sub.phone)}
          {detailLine("E-mail", sub.email)}
          {detailLine("Konto", sub.bankAccount)}
          {detailLine("Notatka", sub.note)}
          <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
            <Pressable
              onPress={() => {
                setForm(subcontractorToInput(sub));
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
                      `${sub.name} zniknie z listy aktywnych. Historia zostaje.`,
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

    </View>
  );
}
