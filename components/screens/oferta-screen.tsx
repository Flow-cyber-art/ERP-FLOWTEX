import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { formatPLN, notify, confirmAction } from "@/components/report-ui";
import type { Profile } from "@/lib/data/auth";
import {
  listPilotTechnologies,
  listTechnologyDocumentPaths,
  getTechnologyPdfSignedUrl,
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
 * PALETA I WYGLĄD CELOWO NIE dzielone z resztą apki (report-ui.tsx) — to
 * dokładnie ten sam precedens co app/portal/[token].tsx: osobna, bespoke
 * identyfikacja wizualna dla jednego konkretnego ekranu, zamiast
 * ciemnego motywu reszty panelu. Kolory i kształty (bez zaokrągleń,
 * poza numerami kroków) odwzorowują zaakceptowany prototyp HTML wizardu
 * ofert. Lokalne komponenty OCard/OField/OButton/OStepper niżej — NIE
 * są re-eksportowane, żywią tylko ten plik.
 *
 * Świadomie POZA zakresem tej wersji: eksport do PDF, kategoryzacja kart
 * w foldery (na pilotażu jest ich najwyżej kilka), wersjonowanie ofert.
 * Czyta technologies/technology_stages/technology_materials wyłącznie do
 * odczytu (przez lib/data/offers.ts) i zapisuje tylko do nowych tabel
 * offers/offer_items — patrz supabase/sql/094_faza0_oferty.sql.
 */

// Ciemny wariant palety prototypu (ten, który faktycznie akceptowaliśmy —
// nie jasny, patrz rozmowa) — dokładne wartości z :root[data-theme="dark"]
// / prefers-color-scheme:dark w oferta-wizard.html.
const OC = {
  bg: "#15171B",
  surface: "#1D2025",
  surface2: "#22262C",
  border: "#343A42",
  borderStrong: "#454C56",
  ink: "#EDEAE1",
  inkMuted: "#A29C8C",
  inkFaint: "#726C5D",
  accent: "#D9A44C",
  accentInk: "#1B1408",
  accentSoft: "#3A2E17",
  accentStrong: "#EBC077",
  danger: "#C15850",
  dangerSoft: "#2E1D1B",
};
const RADIUS = 3; // prototyp: --radius: 3px — świadomie bez dużych zaokrągleń, poza numerami kroków (kółka)

/* ============================================================
   LOKALNE PRYMITYWY UI — świadomie NIE report-ui.tsx (patrz komentarz
   u góry pliku). Ten sam pomysł co Button/Field/WizardStepper tam, ale
   w palecie i kształcie prototypu.
   ============================================================ */

function OCard({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <View
      style={[
        { backgroundColor: OC.surface, borderWidth: 1, borderColor: OC.border, borderRadius: RADIUS, padding: 14, marginBottom: 14 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function OLabel({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontSize: 10.5, letterSpacing: 0.8, textTransform: "uppercase", color: OC.accentStrong, marginBottom: 8, fontWeight: "700" }}>
      {children}
    </Text>
  );
}

function OField({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  style,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "decimal-pad" | "phone-pad" | "email-address";
  style?: object;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={OC.inkFaint}
      keyboardType={keyboardType}
      style={[
        {
          backgroundColor: OC.bg,
          color: OC.ink,
          borderWidth: 1,
          borderColor: OC.borderStrong,
          borderRadius: RADIUS,
          paddingHorizontal: 11,
          paddingVertical: 9,
          fontSize: 13.5,
          minWidth: 0,
        },
        style,
      ]}
    />
  );
}

function OButton({
  label,
  onPress,
  secondary = false,
  disabled = false,
  fullWidth = false,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => ({
        backgroundColor: secondary ? OC.surface : danger ? OC.danger : OC.accent,
        borderWidth: 1,
        borderColor: secondary ? OC.borderStrong : danger ? OC.danger : OC.accent,
        borderRadius: RADIUS,
        paddingVertical: 11,
        paddingHorizontal: 18,
        minHeight: 40,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: fullWidth ? "stretch" : "flex-start",
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <Text
        style={{
          color: secondary ? OC.ink : OC.accentInk,
          fontWeight: "700",
          fontSize: 11.5,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function OStepper({ steps, current }: { steps: { n: number; label: string }[]; current: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 22 }}>
      {steps.flatMap((s, i) => {
        const circle = (
          <View key={`c${s.n}`} style={{ alignItems: "center", width: 78 }}>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: current === s.n ? OC.accent : "transparent",
                borderWidth: current === s.n ? 0 : 1,
                borderColor: current > s.n ? OC.accent : OC.borderStrong,
              }}
            >
              {current > s.n ? (
                <MaterialIcons name="check" size={14} color={OC.accent} />
              ) : (
                <Text style={{ color: current === s.n ? OC.accentInk : OC.inkMuted, fontWeight: "800", fontSize: 12 }}>{s.n}</Text>
              )}
            </View>
            <Text
              style={{
                color: current === s.n ? OC.accentStrong : OC.inkMuted,
                fontSize: 10.5,
                marginTop: 5,
                fontWeight: current === s.n ? "700" : "500",
                textAlign: "center",
              }}
            >
              {s.label}
            </Text>
          </View>
        );
        if (i === steps.length - 1) return [circle];
        const line = (
          <View key={`l${s.n}`} style={{ flex: 1, height: 1, backgroundColor: current > s.n ? OC.accent : OC.border, marginTop: 14 }} />
        );
        return [circle, line];
      })}
    </View>
  );
}

const WIZARD_STEPS = [
  { n: 1, label: "Zleceniodawca" },
  { n: 2, label: "Karty" },
  { n: 3, label: "Metraż i materiały" },
  { n: 4, label: "Ceny i zapis" },
];

const DRAFT_KEY = "oferta-wizard-draft-v1";

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
  materialCosts: Record<number, string>; // technology_materials.id -> cena/j. tekstowo
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

/**
 * Odporne na to, jak dokładnie Postgrest zserializuje kolumnę numeric
 * (string ALBO number, zależnie od zagnieżdżenia selecta) — wcześniejsza
 * wersja zakładała zawsze string i wywalała się na .replace, gdy
 * wartość przyszła jako liczba (np. materials.unitPrice w zagnieżdżonym
 * embedzie technology_materials(...materials(unitPrice))).
 */
const num = (v: string | number | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat((v ?? "").toString().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

type Draft = {
  step: number;
  client: ClientState;
  offerId: number | null;
  discountPercent: string;
  selected: Record<number, boolean>;
  lines: Record<number, LineState>;
  customItems: CustomItem[];
};

export function OfertaScreen({ profile }: { profile: Profile }) {
  const [step, setStep] = useState(1);
  const [pilotTechnologies, setPilotTechnologies] = useState<OfferPilotTechnologyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docPaths, setDocPaths] = useState<Record<number, string>>({});
  const [openingPdfId, setOpeningPdfId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const [client, setClient] = useState<ClientState>(blankClient);
  const [offerId, setOfferId] = useState<number | null>(null);
  const [discountPercent, setDiscountPercent] = useState("0");
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [lines, setLines] = useState<Record<number, LineState>>({});
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<OfferRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  useEffect(() => {
    listPilotTechnologies()
      .then(setPilotTechnologies)
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    // Ścieżki PDF-ów kart technicznych — osobny, cichy fetch: brak
    // podpiętego pliku dla danej technologii nie jest błędem (Admin
    // wgrywa je stopniowo), więc nie ustawiamy tu loadError.
    listTechnologyDocumentPaths()
      .then(setDocPaths)
      .catch(() => {});
  }, []);

  async function openTechnologyPdf(techId: number) {
    const path = docPaths[techId];
    if (!path) return;
    setOpeningPdfId(techId);
    try {
      const url = await getTechnologyPdfSignedUrl(path);
      if (Platform.OS === "web") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        await Linking.openURL(url);
      }
    } catch (e) {
      notify("Nie udało się otworzyć karty PDF", e instanceof Error ? e.message : String(e));
    } finally {
      setOpeningPdfId(null);
    }
  }

  // Wczytanie roboczej wersji z poprzedniej wizyty (raz, przy montowaniu).
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const draft = JSON.parse(raw) as Partial<Draft>;
          if (draft.step) setStep(draft.step);
          if (draft.client) setClient(draft.client);
          if (draft.offerId !== undefined) setOfferId(draft.offerId);
          if (draft.discountPercent !== undefined) setDiscountPercent(draft.discountPercent);
          if (draft.selected) setSelected(draft.selected);
          if (draft.lines) setLines(draft.lines);
          if (draft.customItems) setCustomItems(draft.customItems);
        } catch {
          // nieparsowalny/stary format — po prostu zaczynamy od czystego stanu
        }
      })
      .finally(() => setDraftLoaded(true));
  }, []);

  // Autosave: po każdej zmianie (nie tylko po przejściu między krokami) —
  // odświeżenie karty albo przypadkowe zamknięcie nie kasuje wypełnianej
  // oferty. Dopiero PO wczytaniu ewentualnego draftu (draftLoaded), żeby
  // pusty stan startowy nie nadpisał w ułamku sekundy tego, co dopiero
  // co odczytaliśmy z pamięci.
  useEffect(() => {
    if (!draftLoaded) return;
    const draft: Draft = { step, client, offerId, discountPercent, selected, lines, customItems };
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
  }, [draftLoaded, step, client, offerId, discountPercent, selected, lines, customItems]);

  const canWrite = profile.role === "Admin";

  function ensureLine(techId: number) {
    setLines((prev) => (prev[techId] ? prev : { ...prev, [techId]: { qty: "0", unitPrice: "0", materialCosts: {} } }));
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

  // m2/mb -> etykieta czytelna dla człowieka. Jednostka jest właściwością
  // technologii (offer_pilot_technologies.unit) — kanały liniowe,
  // dylatacje i cokoły rozliczają się w mb, reszta w m².
  const unitLabel = (tech: OfferPilotTechnologyRow) => (tech.unit === "mb" ? "mb" : "m²");

  // Grupowanie kroku 2 w rozwijane kategorie — jak w prototypie (foldery
  // z Księgi Technicznej), po realnej kolumnie
  // offer_pilot_technologies.category_name (pełna nazwa folderu z
  // Dysku — dwa foldery na Dysku dzielą ten sam krótki kod "SS:0", więc
  // pełna nazwa jest jedynym unikalnym kluczem, patrz
  // 095_faza0_ksiega_techniczna_pilotaz_katalog.sql).
  const technologyGroups = useMemo(() => {
    const groups = new Map<string, OfferPilotTechnologyRow[]>();
    for (const t of pilotTechnologies ?? []) {
      const key = t.categoryName?.trim() || "Inne";
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pilotTechnologies]);

  useEffect(() => {
    if (technologyGroups.length === 0) return;
    setOpenCategories((prev) => (Object.keys(prev).length > 0 ? prev : { [technologyGroups[0][0]]: true }));
  }, [technologyGroups]);

  function toggleCategory(categoryName: string) {
    setOpenCategories((prev) => ({ ...prev, [categoryName]: !prev[categoryName] }));
  }

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
        const cost = override !== undefined ? num(override) : num(m.linkedMaterialUnitPrice);
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

  // Podgląd/PDF oferty — ten sam wzorzec co eksport listy płac
  // (payroll-screen.tsx): wydruk-owalna strona HTML w nowym oknie +
  // dialog druku przeglądarki (zapis jako PDF to jedna z jego opcji,
  // bez dodatkowej biblioteki). Struktura i treść odwzorowują 1:1
  // realną ofertę FLOWTEX N/Ref 26103 (wzorzec dostarczony przez
  // użytkownika): strona tytułowa z powitaniem, po jednej stronie
  // "Karta Standardu Wykonawczego" na każdą wybraną technologię (tylko
  // te z uzupełnionym description/workPhases/investorBenefits — patrz
  // 099_faza0_tresc_dokumentu_oferty.sql), tabela cenowa, strona
  // warunków.
  function exportOfferPdf() {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      notify("Podgląd niedostępny", "Podgląd/PDF oferty działa na razie tylko w wersji web.");
      return;
    }
    const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const today = new Date().toLocaleDateString("pl-PL");

    const cardPagesHtml = selectedTechnologies
      .filter((t) => t.description && t.workPhases && t.investorBenefits)
      .map(
        (t) => `
      <div class="doc-page">
        <div class="doc-band">Dokument A: Karta Standardu Wykonawczego</div>
        <div class="doc-card-title">${escapeHtml(t.code)} – ${escapeHtml(t.name)}</div>
        <div class="doc-block-label">Opis technologii</div>
        <p class="doc-p">${escapeHtml(t.description!)}</p>
        <div class="doc-block-label">Przebieg prac</div>
        <ol class="doc-ol">${t.workPhases!.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ol>
        <div class="doc-block-label">Co zyskuje Inwestor?</div>
        <ul class="doc-ul">${t.investorBenefits!.map((k) => `<li>${escapeHtml(k)}</li>`).join("")}</ul>
        <div class="doc-footer"><span>Ciółkowo Małe 32, 07-215 Obryte — NIP: 7621744781</span><span>www.flowtex.pl</span></div>
      </div>`,
      )
      .join("");

    const priceRowsHtml = [
      ...selectedTechnologies.map((tech) => {
        const line = lines[tech.id] ?? { qty: "0", unitPrice: "0", materialCosts: {} };
        return `<tr><td class="mono">${escapeHtml(tech.code)}</td><td>${escapeHtml(tech.name)}</td><td>${escapeHtml(unitLabel(tech))}</td><td class="num mono">${escapeHtml(line.qty)}</td><td class="num mono">${formatPLN(num(line.unitPrice))}</td><td class="num mono">${formatPLN(lineSellTotal(tech))}</td></tr>`;
      }),
      ...customItems.map(
        (it) =>
          `<tr><td class="mono">—</td><td>${escapeHtml(it.name || "Pozycja własna")}</td><td>${escapeHtml(it.unit)}</td><td class="num mono">${escapeHtml(it.qty)}</td><td class="num mono">${formatPLN(num(it.price))}</td><td class="num mono">${formatPLN(num(it.qty) * num(it.price))}</td></tr>`,
      ),
    ].join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Oferta ${escapeHtml(client.ref)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#e9e9e9;color:#1a1a1a}
  .doc-sheet{background:#fff;max-width:780px;margin:0 auto}
  .doc-page{padding:52px 56px;border-bottom:2px dashed #ddd;position:relative;min-height:900px}
  .doc-page:last-child{border-bottom:none}
  .doc-logo{font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:20px;color:#0e2a3d;margin-bottom:34px}
  .doc-logo span{color:#8A5F1E}
  .doc-meta-row{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:30px;gap:20px}
  .doc-meta-row b{display:block;margin-bottom:3px}
  .doc-greeting p{font-size:13px;line-height:1.7;margin:0 0 14px}
  .doc-band{background:#0e2a3d;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:.06em;
    padding:9px 16px;margin:0 -56px 22px}
  .doc-card-title{font-size:15.5px;font-weight:700;margin-bottom:16px}
  .doc-block-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8A5F1E;font-weight:700;
    margin:18px 0 6px}
  .doc-block-label:first-of-type{margin-top:0}
  .doc-p{font-size:12.5px;line-height:1.65;margin:0 0 6px;text-align:justify}
  .doc-ul,.doc-ol{margin:4px 0 0;padding-left:18px;font-size:12.5px;line-height:1.6}
  .doc-ul li,.doc-ol li{margin-bottom:5px}
  .doc-footer{position:absolute;bottom:20px;left:56px;right:56px;display:flex;justify-content:space-between;
    font-size:9px;color:#888;border-top:1px solid #eee;padding-top:9px}
  .doc-price-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}
  .doc-price-table caption{text-align:left;font-weight:700;font-size:13px;margin-bottom:12px;caption-side:top}
  .doc-price-table th{background:#0e2a3d;color:#fff;font-weight:600;text-align:left;padding:8px 10px;font-size:11px}
  .doc-price-table th.num,.doc-price-table td.num{text-align:right}
  .doc-price-table td{padding:7px 10px;border-bottom:1px solid #e5e2d8}
  .doc-price-table tfoot td{background:#0e2a3d;color:#fff;font-weight:700;padding:9px 10px}
  .mono{font-family:'Courier New',monospace}
  .doc-terms{font-size:11.5px;line-height:1.7;margin-top:24px}
  .doc-terms h4{font-size:12px;margin:14px 0 4px;text-decoration:underline}
  .doc-terms ul{margin:2px 0;padding-left:16px}
  .close-btn{position:fixed;top:12px;right:12px;width:32px;height:32px;border-radius:16px;
    border:1px solid #ddd;background:#fff;color:#111;font-size:16px;line-height:1;cursor:pointer}
  @media print{
    body{background:#fff}
    .close-btn{display:none}
    .doc-page{border-bottom:none;page-break-after:always}
    .doc-page:last-child{page-break-after:auto}
  }
</style></head><body>
  <button class="close-btn" onclick="window.close()" aria-label="Zamknij" title="Zamknij">&times;</button>
  <div class="doc-sheet">
    <div class="doc-page">
      <div class="doc-logo">FLOWTEX <span>Polska</span></div>
      <div class="doc-meta-row">
        <div><b>N/Ref ${escapeHtml(client.ref)}</b>Oferta dotyczy: wykonanie prac wg pozycji poniżej${client.investmentAddress ? " — " + escapeHtml(client.investmentAddress) : ""}</div>
        <div style="text-align:right">
          <b>Sz. P. ${escapeHtml(client.contactPerson || "...")}</b>
          ${escapeHtml(client.companyName)}<br>
          ${escapeHtml(client.investmentAddress || client.address || "adres")}<br>
          Ciółkowo Małe dn. ${today}
        </div>
      </div>
      <div class="doc-greeting">
        <p>Szanowni Państwo,</p>
        <p>Dziękując za zapytanie ofertowe, pozwalamy sobie przesłać ofertę cenową powierzonego projektu.</p>
        <p>Celem otrzymania dodatkowych informacji w przypadku złożenia zamówienia uprzejmie prosimy o podanie numeru referencyjnego: <b>${escapeHtml(client.ref)}</b>.</p>
        <p>Pozostając do Państwa dyspozycji,</p>
        <p style="margin-top:26px">Łączę wyrazy szacunku<br><b>Paweł Najduk</b></p>
      </div>
    </div>

    ${cardPagesHtml}

    <div class="doc-page">
      <table class="doc-price-table">
        <caption>Tabela cen Flowtex Polska N/Ref ${escapeHtml(client.ref)}</caption>
        <thead><tr><th>Nr karty</th><th>Opis</th><th>j.m.</th><th class="num">Ilość</th><th class="num">Cena j.</th><th class="num">Suma</th></tr></thead>
        <tbody>${priceRowsHtml}</tbody>
        <tfoot>
          <tr><td colspan="5">Suma pozycji Netto</td><td class="num">${formatPLN(subtotal)}</td></tr>
          ${num(discountPercent) > 0 ? `<tr><td colspan="5">Rabat ${escapeHtml(discountPercent)}%</td><td class="num">-${formatPLN(discountAmount)}</td></tr>` : ""}
          <tr><td colspan="5">Łącznie Netto</td><td class="num">${formatPLN(total)}</td></tr>
        </tfoot>
      </table>
      <div class="doc-terms">
        <p><b>Cena:</b> Podane ceny są Netto &nbsp; <b>Warunki płatności:</b> 14 dni &nbsp; <b>Termin wykonania:</b> do ustalenia &nbsp; <b>Ważność oferty:</b> 30 dni</p>
        <p class="doc-p" style="margin-top:14px">W przypadku przestojów lub wstrzymania prac z przyczyn niezależnych od Wykonawcy, przysługuje mu wynagrodzenie za gotowość w wysokości 5000 zł netto za każdą rozpoczętą dobę przestoju (na jedną brygadę).</p>
        <h4>Założenia do oferty</h4>
        <ul>
          <li>Wykonanie prac przewiduje się w 2 etapach.</li>
          <li>Kontenery na odpady po stronie Zamawiającego.</li>
        </ul>
      </div>
      <div class="doc-footer" style="position:static;margin-top:24px">
        <span>Ciółkowo Małe 32, 07-215 Obryte — NIP: 7621744781</span><span>www.flowtex.pl</span>
      </div>
    </div>

    <div class="doc-page">
      <div class="doc-card-title">Warunki w miejscu wykonywania robót</div>
      <div class="doc-block-label">Zabezpieczenia</div>
      <ul class="doc-ul">
        <li>Pomieszczenia zostaną całkowicie opróżnione z wszelkich materiałów, towarów i innych instalacji, za wyjątkiem instalacji stałych.</li>
        <li>Celem uniknięcia jakichkolwiek zanieczyszczeń (pył, kurz, przeciągi itp.), strefy zostaną przez Państwa zabezpieczone oraz w trakcie wykonywania prac będą zamknięte dla innych wykonawców.</li>
      </ul>
      <div class="doc-block-label">Warunki wykonania</div>
      <ul class="doc-ul">
        <li>Strefy, w których wykonywane będą prace, muszą być ogrzane pomiędzy 12°C a 25°C.</li>
        <li>Temperatura podłoża musi zawierać się pomiędzy 10°C a 25°C.</li>
        <li>Wilgotność względna betonu nie może przekraczać 97% zgodnie z normą BS 8204 (beton powierzchniowo suchy).</li>
      </ul>
      <div class="doc-block-label">Stan podłoża</div>
      <ul class="doc-ul">
        <li>Podłoże musi charakteryzować się odpornością na odrywanie minimum 1,5 MPa (badania pull-off) i powinno być klasy min. C20/25.</li>
        <li>Podłoże (beton/wylewka) musi charakteryzować się gładkim wykończeniem, najlepiej zatarte mechanicznie zacieraczką do betonu.</li>
        <li>Pod płytą betonową powinna istnieć skuteczna izolacja przeciwwodna.</li>
        <li>Podczas wykonywania płyty betonowej nie stosować utwardzaczy chemicznych pod żywicę.</li>
        <li>W przypadku zastosowania utwardzaczy chemicznych do wykończenia posadzki betonowej lub zbyt grubej warstwy mleczka cementowego konieczny będzie podwójny przejazd śrutownicy — takie prace będą przedmiotem dodatkowego kosztorysu.</li>
        <li>Posadzka żywiczna jest odzwierciedleniem betonowego podłoża. Ceny nie zawierają ewentualnych dodatkowych równań betonu.</li>
        <li>Firma Flowtex nie jest zobowiązana do kontroli kształtu oraz równości podłoża przed przystąpieniem do prac, za wyjątkiem odrębnych postanowień pisemnych — przyjmuje się, że podłoże betonowe zostało wykonane zgodnie z normami/planami/projektami oraz odebrane przez Zamawiającego.</li>
      </ul>
      <div class="doc-block-label">Warunki po stronie Zamawiającego</div>
      <ul class="doc-ul">
        <li>Bieżąca woda.</li>
        <li>Energia elektryczna jednofazowa 220V 16 A i trójfazowa 220/380V 32 A z zabezpieczeniem C35.</li>
        <li>Zapewnienie warunków do rozładunku materiałów i ich transportu.</li>
        <li>Odpowiednie oświetlenie górne.</li>
        <li>Strefa składowania materiałów z temperaturą pomiędzy 10°C a 25°C.</li>
      </ul>
      <div class="doc-block-label">Warunki naszej oferty</div>
      <ul class="doc-ul">
        <li>Ceny opierają się na ilościach wskazanych w kosztorysie (m² – mb).</li>
        <li>Podane ceny są bez VAT.</li>
      </ul>
      <div class="doc-footer"><span>Ciółkowo Małe 32, 07-215 Obryte — NIP: 7621744781</span><span>www.flowtex.pl</span></div>
    </div>
  </div>
</body></html>`;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      notify("Nie udało się otworzyć okna", "Zezwól przeglądarce na wyskakujące okienka dla tej strony i spróbuj ponownie.");
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  function resetWizard() {
    setStep(1);
    setClient(blankClient());
    setOfferId(null);
    setDiscountPercent("0");
    setSelected({});
    setLines({});
    setCustomItems([]);
  }

  function handleClearAndRestart() {
    confirmAction("Wyczyść i zacznij od nowa", "Cały wizard zostanie wyczyszczony, łącznie z zapisanym roboczo stanem w tej przeglądarce. Kontynuować?", "Wyczyść", () => {
      resetWizard();
      AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
    });
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
          nextCustom.push({ id: "c" + it.id, name: it.name, unit: it.unit, qty: String(it.qty), price: String(it.unitPrice) });
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
        unit: unitLabel(tech),
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
      notify("Zapisano", `Oferta ${client.ref} zapisana. Otwieram podgląd...`);
      exportOfferPdf();
    } catch (e) {
      notify("Błąd zapisu", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!canWrite) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: OC.bg }}>
        <Text style={{ color: OC.ink, fontSize: 16, fontWeight: "700", textAlign: "center" }}>
          Wizard ofert jest na razie dostępny tylko dla roli Admin.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: OC.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 26, fontWeight: "800", color: OC.ink }}>Wizard ofert</Text>
            <Text style={{ color: OC.inkMuted, fontSize: 13, marginTop: 6 }}>
              Faza 0 (pilotaż) — oferta budowana z tych samych kart co technologie posadzek.
            </Text>
          </View>
          <OButton label="Wyczyść i zacznij od nowa" secondary onPress={handleClearAndRestart} />
        </View>

        <OStepper steps={WIZARD_STEPS} current={step} />

        {step === 1 && (
          <>
            <OCard>
              <OLabel>Firma / kontrahent</OLabel>
              <OField placeholder="Nazwa firmy *" value={client.companyName} onChangeText={(v) => setClient({ ...client, companyName: v })} />
              <OField placeholder="NIP" value={client.nip} onChangeText={(v) => setClient({ ...client, nip: v })} style={{ marginTop: 10 }} />
              <OField placeholder="Adres siedziby" value={client.address} onChangeText={(v) => setClient({ ...client, address: v })} style={{ marginTop: 10 }} />
            </OCard>

            <OCard>
              <OLabel>Osoba kontaktowa</OLabel>
              <OField placeholder="Imię i nazwisko *" value={client.contactPerson} onChangeText={(v) => setClient({ ...client, contactPerson: v })} />
              <OField placeholder="Telefon" value={client.phone} onChangeText={(v) => setClient({ ...client, phone: v })} keyboardType="phone-pad" style={{ marginTop: 10 }} />
              <OField placeholder="E-mail" value={client.email} onChangeText={(v) => setClient({ ...client, email: v })} keyboardType="email-address" style={{ marginTop: 10 }} />
            </OCard>

            <OCard>
              <OLabel>Inwestycja (jeśli inny adres)</OLabel>
              <OField placeholder="Adres inwestycji" value={client.investmentAddress} onChangeText={(v) => setClient({ ...client, investmentAddress: v })} />
            </OCard>

            <OCard>
              <OLabel>Numer referencyjny</OLabel>
              <OField placeholder="Nr referencyjny" value={client.ref} onChangeText={(v) => setClient({ ...client, ref: v })} />
              <Text style={{ color: OC.inkMuted, fontSize: 11.5, marginTop: 8 }}>Podpowiedziany automatycznie — możesz nadpisać właściwym numerem.</Text>
            </OCard>

            <OCard>
              <OLabel>Odzyskaj wcześniejszą ofertę (po numerze lub kliencie)</OLabel>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <OField placeholder="np. 261847 albo Testowa Sp. z o.o." value={searchQuery} onChangeText={setSearchQuery} style={{ flex: 1 }} />
                <OButton label="Szukaj" secondary onPress={runSearch} />
              </View>
              {searching && <ActivityIndicator color={OC.accent} style={{ marginTop: 12 }} />}
              {searchResults && (
                <View style={{ marginTop: 10 }}>
                  {searchResults.length === 0 ? (
                    <Text style={{ color: OC.inkMuted, fontSize: 13 }}>Brak wyników.</Text>
                  ) : (
                    searchResults.map((row) => (
                      <View
                        key={row.id}
                        style={{
                          backgroundColor: OC.surface2,
                          borderWidth: 1,
                          borderColor: OC.border,
                          borderRadius: RADIUS,
                          padding: 12,
                          marginBottom: 8,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => loadOffer(row)}>
                          <Text style={{ color: OC.ink, fontWeight: "700" }}>
                            {row.ref} — {row.companyName || "(bez nazwy)"}
                          </Text>
                          <Text style={{ color: OC.inkMuted, fontSize: 12 }}>{row.status}</Text>
                        </Pressable>
                        <OButton label="Wczytaj" secondary onPress={() => loadOffer(row)} />
                        <Pressable onPress={() => handleDeleteOffer(row)} hitSlop={8}>
                          <MaterialIcons name="delete-outline" size={20} color={OC.danger} />
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
              )}
            </OCard>

            <OButton label="Dalej: wybierz karty →" fullWidth onPress={() => setStep(2)} />
          </>
        )}

        {step === 2 && (
          <>
            {loadError && <Text style={{ color: OC.danger, marginBottom: 10 }}>{loadError}</Text>}
            {!pilotTechnologies ? (
              <ActivityIndicator color={OC.accent} />
            ) : pilotTechnologies.length === 0 ? (
              <Text style={{ color: OC.inkMuted, fontSize: 13 }}>
                Brak technologii dopuszczonych na pilotaż — Admin dodaje je w tabeli offer_pilot_technologies.
              </Text>
            ) : (
              technologyGroups.map(([categoryName, techs]) => {
                const open = !!openCategories[categoryName];
                const selectedCount = techs.filter((t) => selected[t.id]).length;
                return (
                  <View
                    key={categoryName}
                    style={{ backgroundColor: OC.surface, borderWidth: 1, borderColor: OC.border, borderRadius: RADIUS, marginBottom: 10, overflow: "hidden" }}
                  >
                    <Pressable onPress={() => toggleCategory(categoryName)} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                      <MaterialIcons name={open ? "expand-more" : "chevron-right"} size={20} color={OC.inkMuted} />
                      <MaterialIcons name="folder" size={17} color={OC.accentStrong} />
                      <Text style={{ color: OC.ink, fontWeight: "700", flex: 1 }}>{categoryName}</Text>
                      {selectedCount > 0 && (
                        <View style={{ borderWidth: 1, borderColor: OC.accent, backgroundColor: OC.accentSoft, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 }}>
                          <Text style={{ color: OC.accentStrong, fontSize: 10.5, fontWeight: "700" }}>wybrano {selectedCount}</Text>
                        </View>
                      )}
                      <View style={{ borderWidth: 1, borderColor: OC.borderStrong, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 }}>
                        <Text style={{ color: OC.inkMuted, fontSize: 10.5, fontWeight: "700" }}>{techs.length} {techs.length === 1 ? "karta" : "kart"}</Text>
                      </View>
                    </Pressable>
                    {open && (
                      <View style={{ borderTopWidth: 1, borderTopColor: OC.border }}>
                        {techs.map((tech) => (
                          <Pressable
                            key={tech.id}
                            onPress={() => toggleTechnology(tech.id)}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 12,
                              padding: 14,
                              backgroundColor: selected[tech.id] ? OC.accentSoft : "transparent",
                              borderTopWidth: 1,
                              borderTopColor: OC.border,
                            }}
                          >
                            <View
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 4,
                                borderWidth: 1.5,
                                borderColor: selected[tech.id] ? OC.accent : OC.borderStrong,
                                backgroundColor: selected[tech.id] ? OC.accent : "transparent",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {selected[tech.id] && <MaterialIcons name="check" size={14} color={OC.accentInk} />}
                            </View>
                            <Text style={{ color: OC.accentStrong, fontSize: 11.5, fontWeight: "700", width: 84 }}>{tech.code}</Text>
                            <Text style={{ color: OC.ink, flex: 1 }}>{tech.name}</Text>
                            <Text style={{ color: OC.inkMuted, fontSize: 10, textTransform: "uppercase" }}>{unitLabel(tech)}</Text>
                            {docPaths[tech.id] && (
                              <Pressable
                                onPress={(e) => {
                                  e.stopPropagation();
                                  openTechnologyPdf(tech.id);
                                }}
                                hitSlop={8}
                                style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: OC.borderStrong, borderRadius: RADIUS }}
                              >
                                {openingPdfId === tech.id ? (
                                  <ActivityIndicator size="small" color={OC.accent} />
                                ) : (
                                  <MaterialIcons name="picture-as-pdf" size={15} color={OC.accentStrong} />
                                )}
                                <Text style={{ color: OC.accentStrong, fontSize: 10.5, fontWeight: "700" }}>karta</Text>
                              </Pressable>
                            )}
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })
            )}
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 16 }}>
              <OButton label="← Wróć" secondary onPress={() => setStep(1)} />
              <OButton
                label="Dalej: metraż i materiały →"
                disabled={selectedTechnologies.length === 0 && customItems.length === 0}
                onPress={() => setStep(3)}
              />
            </View>
          </>
        )}

        {step === 3 && (
          <>
            {selectedTechnologies.map((tech) => {
              const line = lines[tech.id] ?? { qty: "0", unitPrice: "0", materialCosts: {} };
              const mat = lineMaterialCost(tech);
              return (
                <OCard key={tech.id}>
                  <Text style={{ color: OC.ink, fontWeight: "700", marginBottom: 10 }}>
                    {tech.code} — {tech.name}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ color: OC.inkMuted, fontSize: 11.5, textTransform: "uppercase" }}>{unitLabel(tech)}</Text>
                    <OField
                      keyboardType="decimal-pad"
                      value={line.qty}
                      onChangeText={(v) => setLines({ ...lines, [tech.id]: { ...line, qty: v } })}
                      style={{ width: 100 }}
                    />
                  </View>
                  {mat.rows.length === 0 ? (
                    <Text style={{ color: OC.inkMuted, fontSize: 11.5, marginTop: 10 }}>
                      Ta technologia nie ma zdefiniowanych etapów/materiałów w karcie.
                    </Text>
                  ) : (
                    mat.rows.map((r) => (
                      <View key={r.materialId} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
                        <Text style={{ color: OC.inkMuted, fontSize: 11.5, flex: 1 }}>
                          {r.stage} — {r.materialName} ({r.consumptionPerM2} {r.unit}/{unitLabel(tech)} × {line.qty} {unitLabel(tech)} = {r.totalQty.toFixed(2)} {r.unit})
                        </Text>
                        <OField
                          placeholder="Cena/j."
                          keyboardType="decimal-pad"
                          value={line.materialCosts[r.materialId] ?? (r.cost ? String(r.cost) : "")}
                          onChangeText={(v) =>
                            setLines({ ...lines, [tech.id]: { ...line, materialCosts: { ...line.materialCosts, [r.materialId]: v } } })
                          }
                          style={{ width: 80 }}
                        />
                        <Text style={{ color: OC.ink, fontSize: 12, width: 90, textAlign: "right" }}>{formatPLN(r.rowTotal)}</Text>
                      </View>
                    ))
                  )}
                  <Text style={{ color: OC.inkMuted, fontSize: 11.5, marginTop: 10 }}>
                    Koszt materiału razem: {formatPLN(mat.total)} (punkt odniesienia — cena sprzedaży w kroku 4 zawsze wpisywana ręcznie)
                  </Text>
                </OCard>
              );
            })}
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
              <OButton label="← Wróć" secondary onPress={() => setStep(2)} />
              <OButton label="Dalej: ceny i zapis →" onPress={() => setStep(4)} />
            </View>
          </>
        )}

        {step === 4 && (
          <>
            {selectedTechnologies.map((tech) => {
              const line = lines[tech.id] ?? { qty: "0", unitPrice: "0", materialCosts: {} };
              return (
                <View
                  key={tech.id}
                  style={{
                    backgroundColor: OC.surface,
                    borderWidth: 1,
                    borderColor: OC.border,
                    borderRadius: RADIUS,
                    padding: 14,
                    marginBottom: 10,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Text style={{ color: OC.ink, flex: 1 }}>
                    {tech.code} — {tech.name} ({line.qty} {unitLabel(tech)})
                  </Text>
                  <OField
                    placeholder={`Cena/${unitLabel(tech)}`}
                    keyboardType="decimal-pad"
                    value={line.unitPrice}
                    onChangeText={(v) => setLines({ ...lines, [tech.id]: { ...line, unitPrice: v } })}
                    style={{ width: 90 }}
                  />
                  <Text style={{ color: OC.ink, fontWeight: "700", width: 100, textAlign: "right" }}>{formatPLN(lineSellTotal(tech))}</Text>
                </View>
              );
            })}

            <OLabel>Pozycje własne (spoza katalogu)</OLabel>
            {customItems.map((it) => (
              <View key={it.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <OField placeholder="Nazwa" value={it.name} onChangeText={(v) => setCustomItems(customItems.map((x) => (x.id === it.id ? { ...x, name: v } : x)))} style={{ flex: 1 }} />
                <OField placeholder="j.m." value={it.unit} onChangeText={(v) => setCustomItems(customItems.map((x) => (x.id === it.id ? { ...x, unit: v } : x)))} style={{ width: 60 }} />
                <OField placeholder="Ilość" keyboardType="decimal-pad" value={it.qty} onChangeText={(v) => setCustomItems(customItems.map((x) => (x.id === it.id ? { ...x, qty: v } : x)))} style={{ width: 70 }} />
                <OField placeholder="Cena" keyboardType="decimal-pad" value={it.price} onChangeText={(v) => setCustomItems(customItems.map((x) => (x.id === it.id ? { ...x, price: v } : x)))} style={{ width: 80 }} />
                <Pressable onPress={() => setCustomItems(customItems.filter((x) => x.id !== it.id))} hitSlop={8}>
                  <MaterialIcons name="delete-outline" size={20} color={OC.danger} />
                </Pressable>
              </View>
            ))}
            <OButton label="+ Dodaj własną pozycję" secondary onPress={() => setCustomItems([...customItems, newCustomItem()])} />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18 }}>
              <OLabel>Rabat na całość</OLabel>
              <OField placeholder="%" keyboardType="decimal-pad" value={discountPercent} onChangeText={setDiscountPercent} style={{ width: 70 }} />
            </View>

            <View style={{ backgroundColor: OC.surface2, borderWidth: 1, borderColor: OC.border, borderRadius: RADIUS, padding: 14, marginTop: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: OC.inkMuted }}>Suma pozycji</Text>
                <Text style={{ color: OC.ink }}>{formatPLN(subtotal)}</Text>
              </View>
              {num(discountPercent) > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                  <Text style={{ color: OC.inkMuted }}>Rabat {discountPercent}%</Text>
                  <Text style={{ color: OC.ink }}>-{formatPLN(discountAmount)}</Text>
                </View>
              )}
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: OC.borderStrong }}>
                <Text style={{ color: OC.ink, fontWeight: "800", fontSize: 16 }}>Razem netto</Text>
                <Text style={{ color: OC.accentStrong, fontWeight: "800", fontSize: 16 }}>{formatPLN(total)}</Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 16 }}>
              <OButton label="← Wróć" secondary onPress={() => setStep(3)} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <OButton
                  label="Podgląd / PDF"
                  secondary
                  disabled={selectedTechnologies.length === 0 && customItems.length === 0}
                  onPress={exportOfferPdf}
                />
                <OButton label={saving ? "Zapisywanie..." : offerId ? "Zapisz zmiany" : "Zapisz ofertę"} disabled={saving} onPress={handleSave} />
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
