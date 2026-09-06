import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla Wizardu Ofert — Faza 0 (pilotaż), patrz
 * supabase/sql/094_faza0_oferty.sql. Czyta `technologies` /
 * `technology_stages` / `technology_materials` (i przez nie `materials`
 * po cenę magazynową sugerowaną jako domyślny koszt materiału) —
 * NIGDY nie zapisuje do żadnej z tych trzech tabel. Zapisuje wyłącznie
 * do nowych, w pełni odwracalnych tabel: offers / offer_items /
 * offer_pilot_technologies.
 *
 * Zapis oferty to prosty upsert + "replace items" (skasuj stare pozycje,
 * wstaw bieżące) — nie RPC jak `save_technology`, bo tu nie ma
 * wersjonowania ani zamrażania na potrzeby budowy w toku: jedna oferta =
 * jeden aktualny stan, edytowalny do woli, dopóki nie zostanie wysłana.
 */

export type OfferPilotMaterialRow = {
  id: number;
  materialName: string;
  unit: string;
  consumptionPerM2: string;
  linkedMaterialId: number | null;
  // Cena magazynowa materiału (materials.unitPrice), jeśli
  // technology_materials.linked_material_id wskazuje na realny materiał —
  // sugerowany domyślny koszt/j. w kroku 2 wizardu, zamiast zgadywania.
  linkedMaterialUnitPrice: string | null;
};

export type OfferPilotStageRow = {
  id: number;
  name: string;
  orderIndex: number;
  technology_materials: OfferPilotMaterialRow[];
};

export type OfferPilotTechnologyRow = {
  id: number;
  code: string;
  name: string;
  company: string | null;
  // Pełna nazwa folderu z Księgi Technicznej (Dysk Google) — klucz
  // grupowania w akordeonie kroku 2. Pełna nazwa, nie krótki kod: dwa
  // różne foldery na Dysku dzielą ten sam krótki kod "SS:0" (patrz
  // 095_faza0_ksiega_techniczna_pilotaz_katalog.sql).
  categoryName: string | null;
  // "m2" albo "mb" — część kategorii (kanały, dylatacje, cokoły)
  // rozlicza się w mb, nie w m², więc jednostka jest właściwością samej
  // technologii/pilotażowego przypisania, nie sztywnym założeniem wizardu.
  unit: string;
  // Treść "Karty Standardu Wykonawczego" do dokumentu oferty — patrz
  // 099_faza0_tresc_dokumentu_oferty.sql. Nullable: nie każda z 27 kart
  // pilotażu ma dziś tę treść uzupełnioną, sekcja po prostu nie
  // renderuje się w dokumencie, gdy jej brak.
  description: string | null;
  workPhases: string[] | null;
  investorBenefits: string[] | null;
  // Cena sprzedaży/j.m. z ostatniej oferty, w której użyto tej
  // technologii — podpowiedź w kroku 4, edytowalna, patrz
  // 100_faza0_domyslna_cena_sprzedazy.sql i saveDefaultUnitPrices niżej.
  defaultUnitPrice: string | null;
  technology_stages: OfferPilotStageRow[];
};

const PILOT_TECH_SELECT =
  "technology_id, categoryName:category_name, unit, defaultUnitPrice:default_unit_price, " +
  "technologies(id, code, name, company, " +
  "description, workPhases:work_phases, investorBenefits:investor_benefits, " +
  "technology_stages(id, name, orderIndex:order_index, " +
  "technology_materials(id, materialName:material_name, unit, consumptionPerM2:consumption_per_m2, " +
  "linkedMaterialId:linked_material_id, materials(unitPrice))))";

/** Technologie dopuszczone do wizardu ofert na pilotaż (patrz offer_pilot_technologies). */
export async function listPilotTechnologies(): Promise<OfferPilotTechnologyRow[]> {
  const { data, error } = await supabase
    .from("offer_pilot_technologies")
    .select(PILOT_TECH_SELECT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[])
    .map((row) => {
      const t = row.technologies;
      if (!t) return null;
      return {
        id: t.id,
        code: t.code,
        name: t.name,
        company: t.company,
        categoryName: row.categoryName ?? null,
        unit: row.unit ?? "m2",
        description: t.description ?? null,
        workPhases: t.workPhases ?? null,
        investorBenefits: t.investorBenefits ?? null,
        defaultUnitPrice: row.defaultUnitPrice !== null && row.defaultUnitPrice !== undefined ? String(row.defaultUnitPrice) : null,
        technology_stages: (t.technology_stages ?? []).map((s: any) => ({
          id: s.id,
          name: s.name,
          orderIndex: s.orderIndex,
          technology_materials: (s.technology_materials ?? []).map((m: any) => ({
            id: m.id,
            materialName: m.materialName,
            unit: m.unit,
            consumptionPerM2: m.consumptionPerM2,
            linkedMaterialId: m.linkedMaterialId,
            linkedMaterialUnitPrice: m.materials?.unitPrice ?? null,
          })),
        })),
      } as OfferPilotTechnologyRow;
    })
    .filter((x): x is OfferPilotTechnologyRow => x !== null);
}

/**
 * Realne PDF-y kart technicznych (Admin wgrał je ręcznie do prywatnego
 * bucketu `karty technologiczne` — patrz 097/098_faza0_karty_pdf_*.sql).
 * Mapowanie technology_id -> ścieżka w buckecie; osobne od
 * listPilotTechnologies, bo to zwykła tabela 1:1 bez zagnieżdżania.
 */
const TECHNOLOGY_DOCUMENTS_BUCKET = "karty technologiczne";

export async function listTechnologyDocumentPaths(): Promise<Record<number, string>> {
  const { data, error } = await supabase.from("technology_documents").select("technologyId:technology_id, storagePath:storage_path");
  if (error) throw new Error(error.message);
  const map: Record<number, string> = {};
  for (const row of (data ?? []) as any[]) map[row.technologyId] = row.storagePath;
  return map;
}

/** Krótko żyjący (1h) podpisany URL do pobrania/otwarcia karty PDF z prywatnego bucketu. */
export async function getTechnologyPdfSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(TECHNOLOGY_DOCUMENTS_BUCKET).createSignedUrl(storagePath, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/**
 * Zapamiętuje cenę sprzedaży/j.m. użytą przy zapisie oferty jako
 * podpowiedź na następną ofertę (offer_pilot_technologies.default_unit_price)
 * — patrz 100_faza0_domyslna_cena_sprzedazy.sql. Osobne od zapisu samej
 * oferty: to nie jest historyczna cena TEJ oferty (ta zostaje
 * nienaruszona w offer_items), tylko globalna podpowiedź per technologia.
 */
export async function saveDefaultUnitPrices(prices: { technologyId: number; unitPrice: number }[]): Promise<void> {
  await Promise.all(
    prices
      .filter((p) => p.unitPrice > 0)
      .map((p) => supabase.from("offer_pilot_technologies").update({ default_unit_price: p.unitPrice }).eq("technology_id", p.technologyId)),
  );
}

/** Ustawia listę technologii dopuszczonych na pilotaż (Admin only — patrz RLS write_admin). */
export async function setPilotTechnologyIds(technologyIds: number[]): Promise<void> {
  const { error: delErr } = await supabase
    .from("offer_pilot_technologies")
    .delete()
    .not("technology_id", "is", null);
  if (delErr) throw new Error(delErr.message);
  if (technologyIds.length === 0) return;
  const { error: insErr } = await supabase
    .from("offer_pilot_technologies")
    .insert(technologyIds.map((technology_id) => ({ technology_id })));
  if (insErr) throw new Error(insErr.message);
}

export type OfferItemInput = {
  technologyId: number | null;
  code: string;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  isCustom: boolean;
  sortOrder: number;
  materialCosts: {
    materialId: number;
    stage: string;
    materialName: string;
    unit: string;
    consumptionPerM2: number;
    cost: number;
  }[];
};

export type OfferInput = {
  ref: string;
  companyName: string;
  contactPerson: string;
  address: string;
  investmentAddress: string;
  nip: string;
  email: string;
  phone: string;
  discountPercent: number;
  status?: string;
};

export type OfferRow = OfferInput & {
  id: number;
  createdAt: string;
  updatedAt: string;
};

export type OfferItemRow = {
  id: number;
  offerId: number;
  technologyId: number | null;
  code: string;
  name: string;
  unit: string;
  qty: string;
  unitPrice: string;
  isCustom: boolean;
  sortOrder: number;
  materialCostsJson: string;
};

const OFFER_COLUMNS =
  "id, ref, companyName:company_name, contactPerson:contact_person, address, investmentAddress:investment_address, " +
  "nip, email, phone, discountPercent:discount_percent, status, createdAt, updatedAt";

const OFFER_ITEM_COLUMNS =
  "id, offerId:offer_id, technologyId:technology_id, code, name, unit, qty, unitPrice:unit_price, " +
  "isCustom:is_custom, sortOrder:sort_order, materialCostsJson:material_costs_json";

/** Szuka ofert po numerze referencyjnym LUB nazwie firmy (odzyskiwanie oferty). */
export async function searchOffers(query: string): Promise<OfferRow[]> {
  let q = supabase.from("offers").select(OFFER_COLUMNS).order("updatedAt", { ascending: false }).limit(50);
  const trimmed = query.trim();
  if (trimmed) {
    q = q.or(`ref.ilike.%${trimmed}%,company_name.ilike.%${trimmed}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OfferRow[];
}

export async function getOfferWithItems(
  offerId: number,
): Promise<{ offer: OfferRow; items: OfferItemRow[] }> {
  const { data: offer, error: offerErr } = await supabase
    .from("offers")
    .select(OFFER_COLUMNS)
    .eq("id", offerId)
    .single();
  if (offerErr) throw new Error(offerErr.message);
  const { data: items, error: itemsErr } = await supabase
    .from("offer_items")
    .select(OFFER_ITEM_COLUMNS)
    .eq("offer_id", offerId)
    .order("sort_order");
  if (itemsErr) throw new Error(itemsErr.message);
  return { offer: offer as unknown as OfferRow, items: (items ?? []) as unknown as OfferItemRow[] };
}

/** Generuje kolejny wolny numer referencyjny w formacie 26XXXX — podpowiedź, edytowalna przez użytkownika. */
export function suggestOfferRef(): string {
  return "26" + Math.floor(1000 + Math.random() * 8999);
}

/**
 * Zapisuje ofertę: upsert wiersza `offers` (po `ref`, unikalnym) + pełne
 * zastąpienie jej `offer_items` bieżącym zestawem. To NIE jest wersjonowana
 * receptura jak technologie — jedna oferta ma jeden aktualny stan.
 */
export async function saveOffer(
  input: OfferInput,
  items: OfferItemInput[],
): Promise<number> {
  const { data: existing, error: findErr } = await supabase
    .from("offers")
    .select("id")
    .eq("ref", input.ref)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);

  const row = {
    ref: input.ref,
    company_name: input.companyName,
    contact_person: input.contactPerson,
    address: input.address,
    investment_address: input.investmentAddress,
    nip: input.nip,
    email: input.email,
    phone: input.phone,
    discount_percent: input.discountPercent,
    status: input.status ?? "szkic",
    updatedAt: new Date().toISOString(),
  };

  let offerId: number;
  if (existing) {
    offerId = existing.id;
    const { error } = await supabase.from("offers").update(row).eq("id", offerId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase.from("offers").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    offerId = data.id;
  }

  const { error: delErr } = await supabase.from("offer_items").delete().eq("offer_id", offerId);
  if (delErr) throw new Error(delErr.message);

  if (items.length > 0) {
    const { error: insErr } = await supabase.from("offer_items").insert(
      items.map((it) => ({
        offer_id: offerId,
        technology_id: it.technologyId,
        code: it.code,
        name: it.name,
        unit: it.unit,
        qty: it.qty,
        unit_price: it.unitPrice,
        is_custom: it.isCustom,
        sort_order: it.sortOrder,
        material_costs_json: JSON.stringify(it.materialCosts),
      })),
    );
    if (insErr) throw new Error(insErr.message);
  }

  return offerId;
}

export async function deleteOffer(offerId: number): Promise<void> {
  const { error } = await supabase.from("offers").delete().eq("id", offerId);
  if (error) throw new Error(error.message);
}
