import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { COLORS, Field } from "@/components/report-ui";
import type { TechnologyRow } from "@/lib/data/technologies";

// Wybór technologii z filtrami (wyszukiwarka, firma, grubość od–do) —
// wspólny dla kreatora budowy (krok 2) i zmiany technologii na karcie
// budowy. Po wyborze lista zwija się do jednej karty z przyciskiem "Zmień".
//
// Filtr grubości dopasowuje po nakładaniu się przedziałów, tak jak w
// ofercie: technologie BEZ zdefiniowanej grubości (naprawy, cokoły,
// dylatacje) nie znikają przy aktywnym filtrze.

type Props = {
  technologies: TechnologyRow[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
};

const norm = (s: string) => s.toLocaleLowerCase("pl").trim();

export function TechnologyPicker({ technologies, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const companies = useMemo(
    () =>
      Array.from(
        new Set(technologies.map((t) => t.company?.trim()).filter((c): c is string => !!c)),
      ).sort((a, b) => a.localeCompare(b, "pl")),
    [technologies],
  );

  const toNum = (v: string) => Number(v.trim().replace(",", "."));
  const fromN = from.trim() !== "" && !isNaN(toNum(from)) ? toNum(from) : null;
  const toN = to.trim() !== "" && !isNaN(toNum(to)) ? toNum(to) : null;

  const filtered = useMemo(() => {
    const q = norm(query);
    return technologies.filter((t) => {
      if (q && !norm(`${t.name} ${t.code}`).includes(q)) return false;
      if (company && t.company?.trim() !== company) return false;
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
  }, [technologies, query, company, fromN, toN]);

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

  const chip = (label: string, active: boolean, onPress: () => void, key: string) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={{
        backgroundColor: active ? COLORS.primary : COLORS.background,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: active ? COLORS.primary : COLORS.border,
      }}
    >
      <Text
        style={{
          color: active ? COLORS.background : COLORS.foreground,
          fontWeight: "700",
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  const filtersActive = query.trim() !== "" || company !== null || fromN !== null || toN !== null;

  return (
    <View>
      <Field placeholder="Szukaj technologii…" value={query} onChangeText={setQuery} />

      {companies.length > 0 && (
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {chip("Wszystkie", company === null, () => setCompany(null), "__all")}
          {companies.map((c) => chip(c, company === c, () => setCompany(company === c ? null : c), c))}
        </View>
      )}

      <Text className="text-xs text-muted uppercase mb-2 mt-3">Grubość (mm)</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field placeholder="od" value={from} onChangeText={setFrom} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field placeholder="do" value={to} onChangeText={setTo} keyboardType="decimal-pad" />
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 12,
          marginBottom: 8,
        }}
      >
        <Text style={{ color: COLORS.muted, fontSize: 11 }}>
          {filtered.length} z {technologies.length}
        </Text>
        {filtersActive && (
          <Pressable
            onPress={() => {
              setQuery("");
              setCompany(null);
              setFrom("");
              setTo("");
            }}
          >
            <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700" }}>
              Wyczyść filtry
            </Text>
          </Pressable>
        )}
      </View>

      {filtered.length === 0 ? (
        <Text style={{ color: COLORS.muted, fontSize: 12 }}>
          Brak technologii pasujących do filtrów.
        </Text>
      ) : (
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {filtered.map((t) => chip(`${t.name} · v${t.version}`, false, () => onSelect(t.id), String(t.id)))}
        </View>
      )}
    </View>
  );
}
