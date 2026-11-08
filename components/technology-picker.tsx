import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { COLORS, Field } from "@/components/report-ui";
import type { TechnologyRow } from "@/lib/data/technologies";

// Wybór technologii w dwóch krokach (wspólny dla kreatora budowy i zmiany
// technologii na karcie budowy): najpierw firma (kafelki z liczbą pozycji),
// dopiero potem lista technologii tej firmy w pionowych wierszach. Lista
// pojawia się też od razu, gdy ktoś wpisze nazwę albo zakres grubości —
// wtedy firma nie jest wymagana. Po wyborze lista zwija się do jednej
// karty z przyciskiem "Zmień".
//
// Technologie bez firmy (demontaż, naprawy, iniekcje itp.) lądują pod
// kafelkiem "Inne / bez firmy" — inaczej byłyby nieosiągalne.
//
// Filtr grubości dopasowuje po nakładaniu się przedziałów, tak jak w
// ofercie: technologie BEZ zdefiniowanej grubości nie znikają przy
// aktywnym filtrze.

type Props = {
  technologies: TechnologyRow[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
};

const NO_COMPANY = "__none__";
const norm = (s: string) => s.toLocaleLowerCase("pl").trim();
const companyKey = (t: TechnologyRow) => t.company?.trim() || NO_COMPANY;

export function TechnologyPicker({ technologies, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const toNum = (v: string) => Number(v.trim().replace(",", "."));
  const fromN = from.trim() !== "" && !isNaN(toNum(from)) ? toNum(from) : null;
  const toN = to.trim() !== "" && !isNaN(toNum(to)) ? toNum(to) : null;
  const searchActive = query.trim() !== "" || fromN !== null || toN !== null;

  // Szukajka + grubość — bez firmy; to z tego liczymy kafelki firm, żeby
  // liczby na nich odpowiadały aktualnym filtrom.
  const baseFiltered = useMemo(() => {
    const q = norm(query);
    return technologies.filter((t) => {
      if (q && !norm(`${t.name} ${t.code}`).includes(q)) return false;
      if (fromN !== null || toN !== null) {
        const min = t.thicknessMinMm != null ? Number(t.thicknessMinMm) : null;
        const max = t.thicknessMaxMm != null ? Number(t.thicknessMaxMm) : null;
        if (min !== null && max !== null) {
          if (toN !== null && min > toN) return false;
          if (fromN !== null && max < fromN) return false;
        }
      }
      return true;
    });
  }, [technologies, query, fromN, toN]);

  const companyCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of baseFiltered) map.set(companyKey(t), (map.get(companyKey(t)) ?? 0) + 1);
    const named = Array.from(map.entries())
      .filter(([k]) => k !== NO_COMPANY)
      .sort((a, b) => a[0].localeCompare(b[0], "pl"));
    const none = map.get(NO_COMPANY) ?? 0;
    return none > 0 ? [...named, [NO_COMPANY, none] as [string, number]] : named;
  }, [baseFiltered]);

  const companyLabel = (key: string) => (key === NO_COMPANY ? "Inne / bez firmy" : key);

  const selected = technologies.find((t) => t.id === selectedId) ?? null;

  if (selected) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          backgroundColor: COLORS.surface,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: COLORS.primary,
          padding: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: COLORS.muted, fontSize: 11 }}>WYBRANO</Text>
          <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13, marginTop: 2 }}>
            {selected.name} · v{selected.version}
          </Text>
        </View>
        <Pressable onPress={() => onSelect(null)}>
          <Text
            style={{
              color: COLORS.primary,
              fontWeight: "700",
              fontSize: 12,
              textDecorationLine: "underline",
            }}
          >
            Zmień
          </Text>
        </Pressable>
      </View>
    );
  }

  const results = company ? baseFiltered.filter((t) => companyKey(t) === company) : baseFiltered;
  const showList = company !== null || searchActive;

  return (
    <View>
      <Field placeholder="Szukaj technologii…" value={query} onChangeText={setQuery} />

      <Text className="text-xs text-muted uppercase mb-2 mt-3">Grubość (mm)</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field placeholder="od" value={from} onChangeText={setFrom} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field placeholder="do" value={to} onChangeText={setTo} keyboardType="decimal-pad" />
        </View>
      </View>

      <Text className="text-xs text-muted uppercase mb-2 mt-4">Firma</Text>
      {company === null ? (
        companyCounts.length === 0 ? (
          <Text style={{ color: COLORS.muted, fontSize: 12 }}>
            Brak technologii pasujących do filtrów.
          </Text>
        ) : (
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {companyCounts.map(([key, count]) => (
              <Pressable
                key={key}
                onPress={() => setCompany(key)}
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  minWidth: 110,
                }}
              >
                <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
                  {companyLabel(key)}
                </Text>
                <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                  {count} {count === 1 ? "technologia" : "technologii"}
                </Text>
              </Pressable>
            ))}
          </View>
        )
      ) : (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: COLORS.surface,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: COLORS.primary,
            paddingHorizontal: 14,
            paddingVertical: 11,
          }}
        >
          <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
            {companyLabel(company)}
          </Text>
          <Pressable onPress={() => setCompany(null)}>
            <Text
              style={{
                color: COLORS.primary,
                fontWeight: "700",
                fontSize: 12,
                textDecorationLine: "underline",
              }}
            >
              Zmień
            </Text>
          </Pressable>
        </View>
      )}

      {!showList ? (
        <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 12 }}>
          Wybierz firmę albo wpisz nazwę / grubość, żeby zobaczyć technologie.
        </Text>
      ) : (
        <View style={{ marginTop: 14 }}>
          <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 6 }}>
            {results.length} {results.length === 1 ? "technologia" : "technologii"}
          </Text>
          {results.length === 0 ? (
            <Text style={{ color: COLORS.muted, fontSize: 12 }}>
              Brak technologii pasujących do filtrów.
            </Text>
          ) : (
            results.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => onSelect(t.id)}
                style={{
                  paddingVertical: 11,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  backgroundColor: COLORS.background,
                  marginBottom: 6,
                }}
              >
                <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
                  {t.name} · v{t.version}
                </Text>
                {company === null && (
                  <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                    {companyLabel(companyKey(t))}
                  </Text>
                )}
              </Pressable>
            ))
          )}
        </View>
      )}
    </View>
  );
}
