import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import {
  Button,
  COLORS,
  Field,
  QuantityStepper,
  ScreenHeader,
  WizardStepper,
  formatPLN,
  notify,
  confirmAction,
} from "@/components/report-ui";
import type { Profile } from "@/lib/data/auth";
import {
  listPilotTechnologies,
  searchOffers,
  getOfferWithItems,
  saveOffer,
  deleteOffer,
  suggestOfferRef,
  type OfferPilotTechnologyRow,
  type OfferItemInput,
  type OfferRow,
} from "@/lib/data/offers";

/**
 * Wizard Ofert — Faza 0 (pilotaż). Trasa: app/oferta.tsx (/oferta).
 *
 * Świadomie POZA zakresem tej wersji (patrz rozmowa): eksport do PDF,
 * kategoryzacja kart w foldery (na pilotażu jest ich najwyżej kilka —
 * płaska lista wystarcza), wersjonowanie ofert. Wszystko poniżej czyta
 * `technologies`/`technology_stages`/`technology_materials` wyłącznie do
 * odczytu (przez lib/data/offers.ts) i zapisuje tylko do nowych tabel
 * offers/offer_items — patrz supabase/sql/094_faza0_oferty.sql.
 */

const WIZARD_STEPS = [
  { n: 1, label: "Zleceniodawca" },
  { n: 2, label: "Karty" },
  { n: 3, label: "Metraż i materiały" },
  { n: 4, label: "Ceny i zapis" },
];

type ClientState = {
  ref: string;
  companyName: string;
  contactPerson: string;
  address: string;
  investmentAddress: string;
  nip: string;
  email: string;
  phone: string;
};

function blankClient(): ClientState {
  return {
    ref: suggestOfferRef(),
    companyName: "",
    contactPerson: "",
    address: "",
    investmentAddress: "",
    nip: "",
    email: "",
    phone: "",
  };
}

type LineState = {
  qty: string;
  unitPrice: string;
  materialCosts: Record<number, string>; // technology_materials.id -> cost/j. tekstowo
};

type CustomItem = {
  id: string;
  name: string;
  unit: string;
  qty: string;
  price: string;
};

function newCustomItem(): CustomItem {
  return { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: "", unit: "szt", qty: "1", price: "0" };
}

const num = (s: string | undefined) => {
  const n = parseFloat((s ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export function OfertaScreen({ profile }: { profile: Profile }) {
  const [step, setStep] = useState(1);
  const [pilotTechnologies, setPilotTechnologies] = useState<OfferPilotTechnologyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [client, setClient] = useState<ClientState>(blankClient);
  const [offerId, setOfferId] = useState<number | null>(null);
  const [discountPercent, setDiscountPercent] = useState("0");
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [lines, setLines] = useState<Record<number, LineState>>({});
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<OfferRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    listPilotTechnologies()
      .then(setPilotTechnologies)
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  const canWrite = profile.role === "Admin";

  function ensureLine(techId: number) {
    setLines((prev) =>
      prev[techId]
        ? prev
        : { ...prev, [techId]: { qty: "0", unitPrice: "0", materialCosts: {} } },
    );
  }

  function toggleTechnology(techId: number) {
    setSelected((prev) => {
      const next = { ...prev, [techId]: !prev[techId] };
      if (!prev[techId]) ensureLine(techId);
      return next;
    });
  }

  const selectedTechnologies = useMemo(
    () => (pilotTechnologies ?? []).filter((t) => selected[t.id]),
    [pilotTechnologies, selected],
  );

  function lineMaterialCost(tech: OfferPilotTechnologyRow) {
    const line = lines[tech.id];
    const qty = num(line?.qty);
    const rows: {
      materialId: number;
      stage: string;
      materialName: string;
      unit: string;
      consumptionPerM2: number;
      totalQty: number;
      cost: number;
      rowTotal: number;
    }[] = [];
    let total = 0;
    for (const stage of tech.technology_stages) {
      for (const m of stage.technology_materials) {
        const consumption = num(m.consumptionPerM2);
        const totalQty = consumption * qty;
        const override = line?.materialCosts[m.id];
        const cost = override !== undefined ? num(override) : num(m.linkedMaterialUnitPrice ?? "0");
        const rowTotal = totalQty * cost;
        total += rowTotal;
        rows.push({
          materialId: m.id,
          stage: stage.name,
          materialName: m.materialName,
          unit: m.unit,
          consumptionPerM2: consumption,
          totalQty,
          cost,
          rowTotal,
        });
      }
    }
    return { rows, total };
  }

  function lineSellTotal(tech: OfferPilotTechnologyRow) {
    const line = lines[tech.id];
    return num(line?.qty) * num(line?.unitPrice);
  }

  const customItemsTotal = customItems.reduce((sum, it) => sum + num(it.qty) * num(it.price), 0);
  const subtotal = selectedTechnologies.reduce((sum, t) => sum + lineSellTotal(t), 0) + customItemsTotal;
  const discountAmount = subtotal * (num(discountPercent) / 100);
  const total = subtotal - discountAmount;

  function resetWizard() {
    setStep(1);
    setClient(blankClient());
    setOfferId(null);
    setDiscountPercent("0");
    setSelected({});
    setLines({});
    setCustomItems([]);
  }

  async function runSearch() {
    setSearching(true);
    try {
      const results = await searchOffers(searchQuery);
      setSearchResults(results);
    } catch (e) {
      notify("Błąd wyszukiwania", e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  async function loadOffer(row: OfferRow) {
    try {
      const { offer, items } = await getOfferWithItems(row.id);
      setOfferId(offer.id);
      setClient({
        ref: offer.ref,
        companyName: offer.companyName,
        contactPerson: offer.contactPerson,
        address: offer.address,
        investmentAddress: offer.investmentAddress,
        nip: offer.nip,
        email: offer.email,
        phone: offer.phone,
      });
      setDiscountPercent(String(offer.discountPercent));
      const nextSelected: Record<number, boolean> = {};
      const nextLines: Record<number, LineState> = {};
      const nextCustom: CustomItem[] = [];
      for (const it of items) {
        if (it.isCustom || it.technologyId === null) {
          nextCustom.push({
            id: "c" + it.id,
            name: it.name,
            unit: it.unit,
            qty: String(it.qty),
            price: String(it.unitPrice),
          });
        } else {
          nextSelected[it.technologyId] = true;
          const materialCosts: Record<number, string> = {};
          try {
            const parsed = JSON.parse(it.materialCostsJson) as { materialId: number; cost: number }[];
            for (const p of parsed) materialCosts[p.materialId] = String(p.cost);
          } catch {
            // brak/nieparsowalny JSON — zostaw domyślne ceny sugerowane z magazynu
          }
          nextLines[it.technologyId] = { qty: String(it.qty), unitPrice: String(it.unitPrice), materialCosts };
        }
      }
      setSelected(nextSelected);
      setLines(nextLines);
      setCustomItems(nextCustom);
      setStep(1);
      notify("Wczytano", `Oferta ${offer.ref} wczytana do edycji.`);
    } catch (e) {
      notify("Błąd wczytywania", e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeleteOffer(row: OfferRow) {
    confirmAction("Usuń ofertę", `Usunąć ofertę ${row.ref} (${row.companyName})? Tej operacji nie da się cofnąć.`, "Usuń", async () => {
      try {
        await deleteOffer(row.id);
        await runSearch();
      } catch (e) {
        notify("Błąd usuwania", e instanceof Error ? e.message : String(e));
      }
    });
  }

  async function handleSave() {
    if (!client.companyName.trim() || !client.contactPerson.trim()) {
      notify("Uzupełnij dane", "Podaj przynajmniej nazwę firmy i osobę kontaktową.");
      return;
    }
    const items: OfferItemInput[] = [];
    selectedTechnologies.forEach((tech, i) => {
      const mat = lineMaterialCost(tech);
      items.push({
        technologyId: tech.id,
        code: tech.code,
        name: tech.name,
        unit: "m²",
        qty: num(lines[tech.id]?.qty),
        unitPrice: num(lines[tech.id]?.unitPrice),
        isCustom: false,
        sortOrder: i,
        materialCosts: mat.rows.map((r) => ({
          materialId: r.materialId,
          stage: r.stage,
          materialName: r.materialName,
          unit: r.unit,
          consumptionPerM2: r.consumptionPerM2,
          cost: r.cost,
        })),
      });
    });
    customItems.forEach((it, i) => {
      items.push({
        technologyId: null,
        code: "",
        name: it.name,
        unit: it.unit,
        qty: num(it.qty),
        unitPrice: num(it.price),
        isCustom: true,
        sortOrder: selectedTechnologies.length + i,
        materialCosts: [],
      });
    });

    setSaving(true);
    try {
      const id = await saveOffer(
        {
          ref: client.ref,
          companyName: client.companyName,
          contactPerson: client.contactPerson,
          address: client.address,
          investmentAddress: client.investmentAddress,
          nip: client.nip,
          email: client.email,
          phone: client.phone,
          discountPercent: num(discountPercent),
        },
        items,
      );
      setOfferId(id);
      notify("Zapisano", `Oferta ${client.ref} zapisana.`);
    } catch (e) {
      notify("Błąd zapisu", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!canWrite) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: COLORS.foreground, fontSize: 16, fontWeight: "700", textAlign: "center" }}>
          Wizard ofert jest na razie dostępny tylko dla roli Admin.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <ScreenHeader
        title="Wizard ofert"
        description="Faza 0 (pilotaż) — oferta budowana z tych samych kart co technologie posadzek."
        action={<Button label="Nowa oferta" secondary onPress={() => resetWizard()} />}
      />
      <WizardStepper steps={WIZARD_STEPS} current={step} />

      {step === 1 && (
        <>
          <Text className="text-xs text-muted uppercase mt-2 mb-2">Firma / kontrahent</Text>
          <Field placeholder="Nazwa firmy *" value={client.companyName} onChangeText={(v: string) => setClient({ ...client, companyName: v })} />
          <Field placeholder="NIP" value={client.nip} onChangeText={(v: string) => setClient({ ...client, nip: v })} style={{ marginTop: 10 }} />
          <Field placeholder="Adres siedziby" value={client.address} onChangeText={(v: string) => setClient({ ...client, address: v })} style={{ marginTop: 10 }} />

          <Text className="text-xs text-muted uppercase mt-4 mb-2">Osoba kontaktowa</Text>
          <Field placeholder="Imię i nazwisko *" value={client.contactPerson} onChangeText={(v: string) => setClient({ ...client, contactPerson: v })} />
          <Field placeholder="Telefon" value={client.phone} onChangeText={(v: string) => setClient({ ...client, phone: v })} keyboardType="phone-pad" style={{ marginTop: 10 }} />
          <Field placeholder="E-mail" value={client.email} onChangeText={(v: string) => setClient({ ...client, email: v })} keyboardType="email-address" style={{ marginTop: 10 }} />

          <Text className="text-xs text-muted uppercase mt-4 mb-2">Inwestycja (jeśli inny adres)</Text>
          <Field placeholder="Adres inwestycji" value={client.investmentAddress} onChangeText={(v: string) => setClient({ ...client, investmentAddress: v })} />

          <Text className="text-xs text-muted uppercase mt-4 mb-2">Numer referencyjny</Text>
          <Field placeholder="Nr referencyjny" value={client.ref} onChangeText={(v: string) => setClient({ ...client, ref: v })} />
          <Text className="text-xs text-muted mt-1">Podpowiedziany automatycznie — możesz nadpisać właściwym numerem.</Text>

          <Text className="text-xs text-muted uppercase mt-6 mb-2">Odzyskaj wcześniejszą ofertę (po numerze lub kliencie)</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Field
              placeholder="np. 261847 albo Testowa Sp. z o.o."
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={{ flex: 1 }}
            />
            <Button label="Szukaj" secondary onPress={runSearch} />
          </View>
          {searching && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 12 }} />}
          {searchResults && (
            <View style={{ marginTop: 10 }}>
              {searchResults.length === 0 ? (
                <Text className="text-sm text-muted">Brak wyników.</Text>
              ) : (
                searchResults.map((row) => (
                  <View
                    key={row.id}
                    className="bg-surface border border-border rounded-2xl"
                    style={{ padding: 12, marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                  >
                    <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => loadOffer(row)}>
                      <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
                        {row.ref} — {row.companyName || "(bez nazwy)"}
                      </Text>
                      <Text style={{ color: COLORS.muted, fontSize: 12 }}>{row.status}</Text>
                    </Pressable>
                    <Button label="Wczytaj" secondary onPress={() => loadOffer(row)} />
                    <Pressable onPress={() => handleDeleteOffer(row)} hitSlop={8}>
                      <MaterialIcons name="delete-outline" size={20} color={COLORS.danger} />
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          )}

          <View style={{ marginTop: 20 }}>
            <Button label="Dalej: wybierz karty →" fullWidth onPress={() => setStep(2)} />
          </View>
        </>
      )}

      {step === 2 && (
        <>
          {loadError && <Text style={{ color: COLORS.danger }}>{loadError}</Text>}
          {!pilotTechnologies ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : pilotTechnologies.length === 0 ? (
            <Text className="text-sm text-muted">
              Brak technologii dopuszczonych na pilotaż — Admin dodaje je w tabeli offer_pilot_technologies.
            </Text>
          ) : (
            pilotTechnologies.map((tech) => (
              <Pressable
                key={tech.id}
                onPress={() => toggleTechnology(tech.id)}
                className="bg-surface border border-border rounded-2xl"
                style={{
                  padding: 14,
                  marginBottom: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  borderColor: selected[tech.id] ? COLORS.primary : COLORS.border,
                }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    borderWidth: 1.5,
                    borderColor: selected[tech.id] ? COLORS.primary : COLORS.border,
                    backgroundColor: selected[tech.id] ? COLORS.primary : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {selected[tech.id] && <MaterialIcons name="check" size={16} color={COLORS.background} />}
                </View>
                <Text className="text-xs text-muted" style={{ width: 76 }}>{tech.code}</Text>
                <Text style={{ color: COLORS.foreground, flex: 1 }}>{tech.name}</Text>
              </Pressable>
            ))
          )}
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 16 }}>
            <Button label="← Wróć" secondary onPress={() => setStep(1)} />
            <Button label="Dalej: metraż i materiały →" disabled={selectedTechnologies.length === 0 && customItems.length === 0} onPress={() => setStep(3)} />
          </View>
        </>
      )}

      {step === 3 && (
        <>
          {selectedTechnologies.map((tech) => {
            const line = lines[tech.id] ?? { qty: "0", unitPrice: "0", materialCosts: {} };
            const mat = lineMaterialCost(tech);
            return (
              <View key={tech.id} className="bg-surface border border-border rounded-2xl" style={{ padding: 14, marginBottom: 14 }}>
                <Text style={{ color: COLORS.foreground, fontWeight: "700", marginBottom: 8 }}>
                  {tech.code} — {tech.name}
                </Text>
                <QuantityStepper
                  value={line.qty}
                  onChangeText={(v: string) => setLines({ ...lines, [tech.id]: { ...line, qty: v } })}
                  step={1}
                  unit="m²"
                />
                {mat.rows.length === 0 ? (
                  <Text className="text-xs text-muted" style={{ marginTop: 8 }}>
                    Ta technologia nie ma zdefiniowanych etapów/materiałów w karcie.
                  </Text>
                ) : (
                  mat.rows.map((r) => (
                    <View key={r.materialId} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                      <Text style={{ color: COLORS.muted, fontSize: 12, flex: 1 }}>
                        {r.stage} — {r.materialName} ({r.consumptionPerM2} {r.unit}/m² × {line.qty} m² = {r.totalQty.toFixed(2)} {r.unit})
                      </Text>
                      <Field
                        placeholder="Cena/j."
                        keyboardType="decimal-pad"
                        value={line.materialCosts[r.materialId] ?? (r.cost ? String(r.cost) : "")}
                        onChangeText={(v: string) =>
                          setLines({
                            ...lines,
                            [tech.id]: { ...line, materialCosts: { ...line.materialCosts, [r.materialId]: v } },
                          })
                        }
                        style={{ width: 90 }}
                      />
                      <Text style={{ color: COLORS.foreground, fontSize: 12, width: 90, textAlign: "right" }}>
                        {formatPLN(r.rowTotal)}
                      </Text>
                    </View>
                  ))
                )}
                <Text className="text-xs text-muted" style={{ marginTop: 8 }}>
                  Koszt materiału razem: {formatPLN(mat.total)} (punkt odniesienia — cena sprzedaży w kroku 4 zawsze wpisywana ręcznie)
                </Text>
              </View>
            );
          })}
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
            <Button label="← Wróć" secondary onPress={() => setStep(2)} />
            <Button label="Dalej: ceny i zapis →" onPress={() => setStep(4)} />
          </View>
        </>
      )}

      {step === 4 && (
        <>
          {selectedTechnologies.map((tech) => {
            const line = lines[tech.id] ?? { qty: "0", unitPrice: "0", materialCosts: {} };
            return (
              <View key={tech.id} className="bg-surface border border-border rounded-2xl" style={{ padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ color: COLORS.foreground, flex: 1 }}>
                  {tech.code} — {tech.name} ({line.qty} m²)
                </Text>
                <Field
                  placeholder="Cena/m²"
                  keyboardType="decimal-pad"
                  value={line.unitPrice}
                  onChangeText={(v: string) => setLines({ ...lines, [tech.id]: { ...line, unitPrice: v } })}
                  style={{ width: 90 }}
                />
                <Text style={{ color: COLORS.foreground, fontWeight: "700", width: 100, textAlign: "right" }}>{formatPLN(lineSellTotal(tech))}</Text>
              </View>
            );
          })}

          <Text className="text-xs text-muted uppercase mt-2 mb-2">Pozycje własne (spoza katalogu)</Text>
          {customItems.map((it) => (
            <View key={it.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Field placeholder="Nazwa" value={it.name} onChangeText={(v: string) => setCustomItems(customItems.map((x) => (x.id === it.id ? { ...x, name: v } : x)))} style={{ flex: 1 }} />
              <Field placeholder="j.m." value={it.unit} onChangeText={(v: string) => setCustomItems(customItems.map((x) => (x.id === it.id ? { ...x, unit: v } : x)))} style={{ width: 60 }} />
              <Field placeholder="Ilość" keyboardType="decimal-pad" value={it.qty} onChangeText={(v: string) => setCustomItems(customItems.map((x) => (x.id === it.id ? { ...x, qty: v } : x)))} style={{ width: 70 }} />
              <Field placeholder="Cena" keyboardType="decimal-pad" value={it.price} onChangeText={(v: string) => setCustomItems(customItems.map((x) => (x.id === it.id ? { ...x, price: v } : x)))} style={{ width: 80 }} />
              <Pressable onPress={() => setCustomItems(customItems.filter((x) => x.id !== it.id))} hitSlop={8}>
                <MaterialIcons name="delete-outline" size={20} color={COLORS.danger} />
              </Pressable>
            </View>
          ))}
          <Button label="+ Dodaj własną pozycję" secondary onPress={() => setCustomItems([...customItems, newCustomItem()])} />

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
            <Text className="text-xs text-muted uppercase">Rabat na całość</Text>
            <Field placeholder="%" keyboardType="decimal-pad" value={discountPercent} onChangeText={setDiscountPercent} style={{ width: 70 }} />
          </View>

          <View className="bg-surface border border-border rounded-2xl" style={{ padding: 14, marginTop: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: COLORS.muted }}>Suma pozycji</Text>
              <Text style={{ color: COLORS.foreground }}>{formatPLN(subtotal)}</Text>
            </View>
            {num(discountPercent) > 0 && (
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                <Text style={{ color: COLORS.muted }}>Rabat {discountPercent}%</Text>
                <Text style={{ color: COLORS.foreground }}>-{formatPLN(discountAmount)}</Text>
              </View>
            )}
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border }}>
              <Text style={{ color: COLORS.foreground, fontWeight: "800", fontSize: 16 }}>Razem netto</Text>
              <Text style={{ color: COLORS.primary, fontWeight: "800", fontSize: 16 }}>{formatPLN(total)}</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 16 }}>
            <Button label="← Wróć" secondary onPress={() => setStep(3)} />
            <Button label={saving ? "Zapisywanie..." : offerId ? "Zapisz zmiany" : "Zapisz ofertę"} disabled={saving} onPress={handleSave} />
          </View>
        </>
      )}
    </ScrollView>
  );
}
