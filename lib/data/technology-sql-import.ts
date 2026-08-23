// Import technologii z wklejonego SQL-a (panel "Nowa" → "Przez SQL" w
// technologies-screen.tsx). Ten parser NIE wykonuje żadnego SQL-a na bazie
// i nie łączy się z Supabase — jedynie wyciąga wartości z tekstu, żeby
// wypełnić nimi ten sam formularz co tryb "Tradycyjnie". Zapis nadal idzie
// wyłącznie przez saveTechnology()/updateTechnologyMeta() (bezpieczne RPC),
// więc wklejony SQL nigdy nie trafia bezpośrednio do bazy.
//
// Oczekiwany kształt SQL-a to insert do technologies + insert do
// technology_stages (CROSS JOIN VALUES) + insert do technology_materials
// (JOIN VALUES ... ON stage_name), dokładnie jak w przykładzie
// wygenerowanym dla tego modułu. To NIE jest ogólny parser SQL — nie
// próbuje rozumieć dowolnych zapytań, tylko ten konkretny, powtarzalny
// wzorzec.

export type ParsedTechnologyMaterial = {
  name: string;
  unit: string;
  consumptionPerM2: number;
};

export type ParsedTechnologyStage = {
  name: string;
  materials: ParsedTechnologyMaterial[];
};

export type ParsedTechnology = {
  code: string;
  name: string;
  company: string | null;
  thicknessMinMm: number | null;
  thicknessMaxMm: number | null;
  stages: ParsedTechnologyStage[];
};

// Dzieli listę wartości SQL-owego VALUES(...) po przecinkach na najwyższym
// poziomie, ignorując przecinki wewnątrz '...' (stringi mogą zawierać
// przecinki, np. nazwy materiałów).
function splitTopLevelValues(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      // '' wewnątrz stringa SQL to escapowany apostrof, nie koniec stringa
      if (inString && text[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inString = !inString;
      current += ch;
      continue;
    }
    if (ch === "," && !inString) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function unquoteSqlLiteral(raw: string): string | number | boolean | null {
  const v = raw.trim().replace(/::\s*\w+$/i, "").trim();
  if (/^null$/i.test(v)) return null;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  if (v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  const num = Number(v);
  if (!Number.isNaN(num) && v !== "") return num;
  return v;
}

export function parseTechnologySql(sql: string): ParsedTechnology {
  const src = sql.trim();
  if (!src) throw new Error("Wklej SQL do wczytania.");

  const techMatch = src.match(
    /insert\s+into\s+technologies\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\)\s*returning/i,
  );
  if (!techMatch) {
    throw new Error(
      "Nie znaleziono 'insert into technologies (...) values (...) returning'.",
    );
  }
  const columns = techMatch[1].split(",").map((c) => c.trim().toLowerCase());
  const values = splitTopLevelValues(techMatch[2]).map(unquoteSqlLiteral);
  if (columns.length !== values.length) {
    throw new Error(
      `Liczba kolumn (${columns.length}) i wartości (${values.length}) w insert into technologies się nie zgadza.`,
    );
  }
  const row: Record<string, string | number | boolean | null> = {};
  columns.forEach((col, i) => {
    row[col] = values[i];
  });

  const code = row["code"];
  const name = row["name"];
  if (typeof code !== "string" || !code.trim()) {
    throw new Error("Kolumna 'code' jest wymagana w insert into technologies.");
  }
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Kolumna 'name' jest wymagana w insert into technologies.");
  }
  const company = typeof row["company"] === "string" ? (row["company"] as string) : null;
  const thicknessMinMm =
    typeof row["thickness_min_mm"] === "number" ? (row["thickness_min_mm"] as number) : null;
  const thicknessMaxMm =
    typeof row["thickness_max_mm"] === "number" ? (row["thickness_max_mm"] as number) : null;

  // Etapy: cross join ( values ('Nazwa', 1), ... ) as stage_data(name, order_index)
  const stagesMatch = src.match(
    /cross\s+join\s*\(\s*values([\s\S]*?)\)\s*as\s+stage_data/i,
  );
  if (!stagesMatch) {
    throw new Error(
      "Nie znaleziono etapów: 'cross join (values (...), ...) as stage_data(name, order_index)'.",
    );
  }
  const stageTupleRe = /\(\s*'((?:[^']|'')*)'\s*,\s*(\d+)\s*\)/g;
  const stageNames: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = stageTupleRe.exec(stagesMatch[1]))) {
    stageNames.push(sm[1].replace(/''/g, "'"));
  }
  if (stageNames.length === 0) {
    throw new Error("Nie udało się odczytać żadnego etapu z listy VALUES.");
  }

  // Materiały: join ( values ('Etap', 'Materiał', 'jedn', 0.35::numeric), ... )
  //   as material_data(stage_name, material_name, unit, consumption_per_m2)
  const materialsMatch = src.match(
    /join\s*\(\s*values([\s\S]*?)\)\s*as\s+material_data/i,
  );
  const stages: ParsedTechnologyStage[] = stageNames.map((n) => ({ name: n, materials: [] }));
  if (materialsMatch) {
    const materialTupleRe =
      /\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*([0-9.]+)(?:\s*::\s*\w+)?\s*\)/g;
    let mm: RegExpExecArray | null;
    while ((mm = materialTupleRe.exec(materialsMatch[1]))) {
      const stageName = mm[1].replace(/''/g, "'");
      const stage = stages.find((s) => s.name === stageName);
      if (!stage) continue;
      stage.materials.push({
        name: mm[2].replace(/''/g, "'"),
        unit: mm[3].replace(/''/g, "'"),
        consumptionPerM2: Number(mm[4]),
      });
    }
  }

  return { code: code.trim(), name: name.trim(), company, thicknessMinMm, thicknessMaxMm, stages };
}
