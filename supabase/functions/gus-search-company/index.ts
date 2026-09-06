// Wyszukiwarka firm po nazwie przez GUS REGON (API BIR1, wersja 2014/07),
// do autouzupełniania kroku 1 Wizardu Ofert — użytkownik: "zaczynam
// wpisywac firme od razu podpowiada mi cane. po 3 wpisanych literach
// podpowiada mi cala firem". Wybrano GUS REGON (nie Google Places, nie
// CEIDG) bo jako jedyny z tej trójki: (a) nie wymaga płatnego klucza,
// (b) obejmuje WSZYSTKIE podmioty (sp. z o.o., sp.k. itd.), nie tylko
// jednoosobowe działalności jak CEIDG, (c) zwraca od razu NIP i adres
// siedziby, potrzebne w formularzu.
//
// GUS BIR1 to SOAP 1.2 (nie REST) i wymaga logowania sesyjnego (Zaloguj
// -> sid), które musi towarzyszyć każdemu kolejnemu wywołaniu jako
// nagłówek HTTP "sid" — stąd logujemy się na nowo przy każdym
// zapytaniu (prościej i pewniej niż cache'ować sid między wywołaniami
// edge function, które i tak są bezstanowe/krótko żyjące).
//
// UWAGA: ta implementacja NIE była przetestowana na żywo (sandbox tej
// sesji Claude ma zablokowany dostęp do wyszukiwarkaregontest.stat.gov.pl
// przez politykę egress) — napisana wprost z oficjalnej dokumentacji
// BIR1 (schemat SOAP, kształt DaneSzukajPodmiotyResult). Przetestuj po
// wgraniu klucza produkcyjnego.
//
// Wymaga (Supabase Dashboard -> Edge Functions -> Secrets):
//   GUS_API_KEY — "klucz użytkownika" z https://api.stat.gov.pl (zakładka
//                 "Dane osobowe" po zalogowaniu na konto na portalu GUS).
//   GUS_ENV     — opcjonalny, "test" (domyślnie, korzysta z darmowego
//                 klucza publicznego środowiska testowego, działa "od
//                 ręki" bez rejestracji) albo "prod" (środowisko
//                 produkcyjne — ustaw po zarejestrowaniu własnego klucza).
//
// Cofnięcie: usuń funkcję w Supabase Dashboard -> Edge Functions. Nie
// dotyka żadnej tabeli.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// Publiczny klucz testowy GUS (środowisko testowe, bez rejestracji) —
// domyślny, dopóki nie ustawisz sekretu GUS_API_KEY z prawdziwym kluczem.
const GUS_TEST_KEY = "abcde12345abcde12345";

const ENDPOINTS = {
  test: "https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc",
  prod: "https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc",
};

const SOAP_NS = "http://CIS/BIR/PUBL/2014/07";

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

async function soapCall(endpoint: string, soapAction: string, body: string, sid?: string): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/soap+xml; charset=utf-8",
      ...(sid ? { sid } : {}),
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GUS HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text;
}

async function gusLogin(endpoint: string, key: string): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="${SOAP_NS}">
  <soap12:Header/>
  <soap12:Body>
    <ns:Zaloguj>
      <ns:pKluczUzytkownika>${key}</ns:pKluczUzytkownika>
    </ns:Zaloguj>
  </soap12:Body>
</soap12:Envelope>`;
  const resp = await soapCall(endpoint, `${SOAP_NS}/IUslugaBIRzewnPubl/Zaloguj`, body);
  const sid = extractTag(resp, "ZalogujResult");
  if (!sid) throw new Error("Logowanie do GUS nie powiodło się — sprawdź GUS_API_KEY / GUS_ENV.");
  return sid;
}

export type GusCompanyMatch = {
  name: string;
  nip: string | null;
  address: string | null;
};

async function gusSearchByName(endpoint: string, sid: string, nazwa: string): Promise<GusCompanyMatch[]> {
  const escaped = nazwa.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="${SOAP_NS}" xmlns:dat="${SOAP_NS}/DataContract">
  <soap12:Header/>
  <soap12:Body>
    <ns:DaneSzukajPodmioty>
      <ns:pParametryWyszukiwania>
        <dat:Nazwa>${escaped}</dat:Nazwa>
      </ns:pParametryWyszukiwania>
    </ns:DaneSzukajPodmioty>
  </soap12:Body>
</soap12:Envelope>`;
  const resp = await soapCall(endpoint, `${SOAP_NS}/IUslugaBIRzewnPubl/DaneSzukajPodmioty`, body, sid);
  const resultRaw = extractTag(resp, "DaneSzukajPodmiotyResult");
  if (!resultRaw) return [];
  const inner = decodeXmlEntities(resultRaw);

  const errorCode = extractTag(inner, "ErrorCode");
  if (errorCode) {
    const msg = extractTag(inner, "ErrorMessagePl") ?? `Błąd GUS ${errorCode}`;
    throw new Error(msg);
  }

  const blocks = inner.match(/<dane>[\s\S]*?<\/dane>/g) ?? [];
  return blocks.slice(0, 20).map((b) => {
    const nazwaOut = extractTag(b, "Nazwa") ?? extractTag(b, "NazwaSkr") ?? "";
    const ulica = extractTag(b, "Ulica");
    const nr = extractTag(b, "NrNieruchomosci");
    const lok = extractTag(b, "NrLokalu");
    const kod = extractTag(b, "KodPocztowy");
    const miejsc = extractTag(b, "Miejscowosc");
    const streetPart = [ulica, nr ? (lok ? `${nr}/${lok}` : nr) : null].filter(Boolean).join(" ");
    const cityPart = [kod, miejsc].filter(Boolean).join(" ");
    const address = [streetPart, cityPart].filter(Boolean).join(", ") || null;
    return { name: nazwaOut, nip: extractTag(b, "Nip"), address };
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let query: string;
  try {
    const body = await req.json();
    query = String(body?.query ?? "").trim();
  } catch {
    return json({ error: "Nieprawidłowe body żądania" }, 400);
  }
  if (query.length < 3) return json({ results: [] });

  const env = (Deno.env.get("GUS_ENV") ?? "test").toLowerCase() === "prod" ? "prod" : "test";
  const key = Deno.env.get("GUS_API_KEY") || GUS_TEST_KEY;
  const endpoint = ENDPOINTS[env];

  try {
    const sid = await gusLogin(endpoint, key);
    const results = await gusSearchByName(endpoint, sid, query);
    return json({ results });
  } catch (e) {
    return json({ results: [], error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
