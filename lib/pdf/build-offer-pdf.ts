import { PDFArray, PDFDocument, PDFFont, PDFImage, PDFName, PDFPage, PDFString, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/**
 * Składa finalny PDF oferty: strona tytułowa + PRAWDZIWE pliki PDF kart
 * technicznych (wgrane przez Admina do Supabase Storage — patrz
 * 097/098_faza0_karty_pdf_*.sql) doklejone stronami do dokumentu, plus
 * tabela cenowa i warunki. To jest "ustalenie" z rozmowy: PDF karty
 * wybranej w kroku 2 wizardu ma trafić DO oferty, nie tylko być
 * linkiem do otwarcia osobno.
 *
 * Standardowe fonty PDF (WinAnsi) nie obsługują polskich ogonków/kresek
 * (ą ć ę ł ń ó ś ź ż), więc tekst, który SAMI rysujemy (strona tytułowa,
 * tabela cen, warunki, karta zastępcza gdy brak realnego PDF-a) osadza
 * prawdziwy font Unicode — DejaVu Sans (public/fonts/, licencja
 * pozwala na redystrybucję/embedowanie), ładowany przez pdf-lib +
 * @pdf-lib/fontkit. Gdyby ładowanie fontu z jakiegoś powodu zawiodło
 * (np. plik niedostępny), spadamy na standardowy Helvetica +
 * transliterację do ASCII — degradacja czytelna, nie twardy błąd.
 * Treść PRAWDZIWYCH kart PDF (kopiowanych stronami, nie rysowanych)
 * zawsze ma pełne polskie znaki, niezależnie od tego fallbacku.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const NAVY = rgb(0x0e / 255, 0x2a / 255, 0x3d / 255);
const GOLD = rgb(0x8a / 255, 0x5f / 255, 0x1e / 255);
const GREY = rgb(0.45, 0.45, 0.45);
const INK = rgb(0.1, 0.1, 0.1);
const LINE = rgb(0.87, 0.87, 0.87);
const LINK_BLUE = rgb(0.16, 0.4, 0.7);
const PIN_RED = rgb(0.85, 0.25, 0.2);
const GLOBE_TEAL = rgb(0.15, 0.55, 0.55);

/**
 * Klikalny link "www.flowtex.pl" w stopce — na kartach PDF wgrywanych przez
 * Admina (Word/inne narzędzie) ten link jest realną, klikalną hiperłączem, a
 * nie samym niebieskim tekstem, więc stopka rysowana przez nas (strona
 * tytułowa/tabela cen/warunki) ma dostać dokładnie taką samą adnotację —
 * pdf-lib nie ma do tego gotowego helpera, więc budujemy adnotację Link
 * ręcznie na poziomie PDF-a.
 */
function addLinkAnnotation(page: PDFPage, url: string, rect: [number, number, number, number]) {
  const doc = page.doc;
  const annotRef = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: rect,
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    }),
  );
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing instanceof PDFArray) {
    existing.push(annotRef);
  } else {
    page.node.set(PDFName.of("Annots"), doc.context.obj([annotRef]));
  }
}

/** Mała pieczątka lokalizacji (kropka) przed adresem w stopce — patrz drawFooter. */
function drawPinIcon(page: PDFPage, x: number, y: number) {
  page.drawCircle({ x: x + 2, y: y + 2.5, size: 2.2, color: PIN_RED });
}

/** Mały "globus" (okrąg + równik/południk) przed linkiem w stopce — patrz drawFooter. */
function drawGlobeIcon(page: PDFPage, x: number, y: number) {
  const cx = x + 3, cy = y + 2.8, r = 3;
  page.drawCircle({ x: cx, y: cy, size: r, borderColor: GLOBE_TEAL, borderWidth: 0.6, color: undefined });
  page.drawLine({ start: { x: cx, y: cy - r }, end: { x: cx, y: cy + r }, thickness: 0.5, color: GLOBE_TEAL });
  page.drawLine({ start: { x: cx - r, y: cy }, end: { x: cx + r, y: cy }, thickness: 0.5, color: GLOBE_TEAL });
}

const ASCII_MAP: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "A", Ć: "C", Ę: "E", Ł: "L", Ń: "N", Ó: "O", Ś: "S", Ź: "Z", Ż: "Z",
  "„": '"', "”": '"', "‚": ",", "’": "'", "‘": "'", "–": "-", "—": "-", "…": "...",
};

function toAscii(s: string): string {
  return s.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ„”‚''–—…]/g, (c) => ASCII_MAP[c] ?? c);
}

async function embedFonts(doc: PDFDocument): Promise<{ font: PDFFont; fontBold: PDFFont; polish: boolean }> {
  try {
    doc.registerFontkit(fontkit);
    const [regularBytes, boldBytes] = await Promise.all([
      fetch("/fonts/DejaVuSans.ttf").then((r) => {
        if (!r.ok) throw new Error(`fetch DejaVuSans.ttf: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch("/fonts/DejaVuSans-Bold.ttf").then((r) => {
        if (!r.ok) throw new Error(`fetch DejaVuSans-Bold.ttf: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    const font = await doc.embedFont(regularBytes, { subset: true });
    const fontBold = await doc.embedFont(boldBytes, { subset: true });
    return { font, fontBold, polish: true };
  } catch {
    // Font niedostępny (np. offline / błąd sieci) — fallback: standardowy
    // Helvetica, tekst transliterowany do ASCII (patrz toAscii/text()).
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    return { font, fontBold, polish: false };
  }
}

/**
 * Prawdziwy logotyp FLOWTEX i pieczątka "Certyfikowany Wykonawca Systemów
 * Flowcrete" na stronie tytułowej (public/logo/ — wgrane przez Admina,
 * ustalenie z rozmowy: strona 1 ma wyglądać jak realnie wysyłana oferta, nie
 * tylko rysowany tekstem napis "FLOWTEX"). Jeśli plik z jakiegoś powodu nie
 * da się pobrać/osadzić, wracamy do starego tekstowego logo zamiast wywalać
 * cały eksport — patrz drawTitleLogo/badgeImage niżej.
 */
async function embedBrandImages(doc: PDFDocument): Promise<{ logo: PDFImage | null; badge: PDFImage | null }> {
  async function tryEmbed(path: string): Promise<PDFImage | null> {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      return await doc.embedPng(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  const [logo, badge] = await Promise.all([tryEmbed("/logo/logo.png"), tryEmbed("/logo/certyfikat-flowcrete.png")]);
  return { logo, badge };
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

class DocWriter {
  doc: PDFDocument;
  font: PDFFont;
  fontBold: PDFFont;
  polish: boolean;
  page!: PDFPage;
  y = 0;
  ref: string;

  constructor(doc: PDFDocument, font: PDFFont, fontBold: PDFFont, polish: boolean, ref: string) {
    this.doc = doc;
    this.font = font;
    this.fontBold = fontBold;
    this.polish = polish;
    this.ref = ref;
    this.newPage();
  }

  // Ostatnia linia obrony: jeśli osadzony font nie obsłużył jakiegoś
  // Unicode (np. nietypowy znak), zamiast wywalić cały render tekstu
  // transliterujemy tylko wtedy do ASCII — normalnie (polish=true) tekst
  // przechodzi bez zmian.
  private text(s: string): string {
    return this.polish ? s : toAscii(s);
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
    this.drawFooter();
  }

  // Stopka ma wygladać identycznie jak w kartach PDF wgrywanych przez Admina
  // (pinezka + adres, NIP na środku, globus + klikalny link po prawej) —
  // dawniej rysowaliśmy adres+NIP jednym ciągiem z myślnikiem po lewej i
  // "www.flowtex.pl" jako martwy tekst po prawej, więc nasze strony
  // (tytułowa/tabela cen/warunki) wizualnie odstawały od doklejonych
  // realnych kart.
  drawFooter() {
    const size = 8;
    const y = MARGIN - 24;
    const address = this.text("Ciółkowo Małe 32, 07-215 Obryte");
    drawPinIcon(this.page, MARGIN, y);
    this.page.drawText(address, { x: MARGIN + 9, y, size, font: this.font, color: GREY });

    const nip = "NIP: 7621744781";
    const nipX = PAGE_W / 2 - this.font.widthOfTextAtSize(nip, size) / 2;
    this.page.drawText(nip, { x: nipX, y, size, font: this.font, color: GREY });

    const url = "www.flowtex.pl";
    const urlW = this.font.widthOfTextAtSize(url, size);
    const urlX = PAGE_W - MARGIN - urlW;
    drawGlobeIcon(this.page, urlX - 11, y);
    this.page.drawText(url, { x: urlX, y, size, font: this.font, color: LINK_BLUE });
    this.page.drawLine({ start: { x: urlX, y: y - 1.5 }, end: { x: urlX + urlW, y: y - 1.5 }, thickness: 0.5, color: LINK_BLUE });
    addLinkAnnotation(this.page, "https://www.flowtex.pl", [urlX, y - 2, urlX + urlW, y + size]);
  }

  ensureSpace(h: number) {
    if (this.y - h < MARGIN) this.newPage();
  }

  band(text: string) {
    const h = 24;
    this.ensureSpace(h + 20);
    this.page.drawRectangle({ x: 0, y: this.y - h, width: PAGE_W, height: h, color: NAVY });
    this.page.drawText(this.text(text.toUpperCase()), {
      x: MARGIN,
      y: this.y - h + 8,
      size: 10,
      font: this.fontBold,
      color: rgb(1, 1, 1),
    });
    this.y -= h + 14;
  }

  heading(text: string, size = 14) {
    this.ensureSpace(size + 10);
    this.page.drawText(this.text(text), { x: MARGIN, y: this.y - size, size, font: this.fontBold, color: INK });
    this.y -= size + 12;
  }

  label(text: string) {
    this.ensureSpace(20);
    this.page.drawText(this.text(text.toUpperCase()), { x: MARGIN, y: this.y - 9, size: 9, font: this.fontBold, color: GOLD });
    this.y -= 18;
  }

  paragraph(text: string, opts: { size?: number; bold?: boolean; indent?: number; gapAfter?: number } = {}) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.fontBold : this.font;
    const indent = opts.indent ?? 0;
    const maxWidth = PAGE_W - 2 * MARGIN - indent;
    const lineH = size * 1.45;
    for (const line of wrapText(font, this.text(text), size, maxWidth)) {
      this.ensureSpace(lineH);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font, color: INK });
      this.y -= lineH;
    }
    this.y -= opts.gapAfter ?? 8;
  }

  list(items: string[], ordered: boolean) {
    const size = 10.5;
    const indent = 14;
    const maxWidth = PAGE_W - 2 * MARGIN - indent;
    const lineH = size * 1.45;
    items.forEach((item, i) => {
      const prefix = ordered ? `${i + 1}. ` : "-  ";
      const lines = wrapText(this.font, this.text(item), size, maxWidth - this.font.widthOfTextAtSize(prefix, size));
      lines.forEach((line, li) => {
        this.ensureSpace(lineH);
        this.page.drawText(li === 0 ? prefix + line : line, {
          x: MARGIN + indent,
          y: this.y - size,
          size,
          font: this.font,
          color: INK,
        });
        this.y -= lineH;
      });
    });
    this.y -= 6;
  }
}

export type OfferPdfItem = {
  code: string;
  name: string;
  unit: string;
  qty: string;
  unitPriceLabel: string;
  totalLabel: string;
  description: string | null;
  workPhases: string[] | null;
  investorBenefits: string[] | null;
  /** Realny plik PDF karty technicznej (Supabase Storage) — jeśli podany, jego strony są doklejane 1:1 zamiast generowanej karty zastępczej. */
  fetchRealPdf?: () => Promise<Uint8Array | null>;
};

export type OfferPdfCustomItem = {
  name: string;
  unit: string;
  qty: string;
  priceLabel: string;
  totalLabel: string;
};

export type BuildOfferPdfInput = {
  ref: string;
  date: string;
  companyName: string;
  contactPerson: string;
  address: string;
  investmentAddress: string;
  items: OfferPdfItem[];
  customItems: OfferPdfCustomItem[];
  subtotalLabel: string;
  discountPercent: number;
  discountLabel: string;
  totalLabel: string;
};

export type BuildOfferPdfResult = {
  bytes: Uint8Array;
  /** Pozycje, dla których nie udało się dokleić realnego pliku karty PDF ze Storage — UI powinien o tym poinformować, bo zamiast realnej karty poszła minimalna zastępcza. */
  missingRealPdf: string[];
};

export async function buildOfferPdf(input: BuildOfferPdfInput): Promise<BuildOfferPdfResult> {
  const doc = await PDFDocument.create();
  const { font, fontBold, polish } = await embedFonts(doc);
  const { logo, badge } = await embedBrandImages(doc);
  const w = new DocWriter(doc, font, fontBold, polish, input.ref);

  // ---- Strona tytułowa ----
  if (logo) {
    const logoW = 160;
    const logoH = (logo.height / logo.width) * logoW;
    w.page.drawImage(logo, { x: MARGIN, y: w.y - logoH, width: logoW, height: logoH });
    w.y -= logoH + 34; // 34pt zapasu, żeby tekst zaczynał się poniżej pieczątki w prawym górnym rogu (badgeH ~74pt)
  } else {
    // Fallback tekstowy — gdyby plik logo z jakiegoś powodu nie dał się pobrać/osadzić.
    w.page.drawText("FLOWTEX", { x: MARGIN, y: w.y - 22, size: 22, font: fontBold, color: NAVY });
    w.page.drawText("Polska", { x: MARGIN + fontBold.widthOfTextAtSize("FLOWTEX ", 22), y: w.y - 22, size: 22, font: fontBold, color: GOLD });
    w.y -= 50;
  }
  if (badge) {
    const badgeW = 74;
    const badgeH = (badge.height / badge.width) * badgeW;
    w.page.drawImage(badge, { x: PAGE_W - MARGIN - badgeW, y: PAGE_H - MARGIN - badgeH, width: badgeW, height: badgeH });
  }
  w.paragraph(`N/Ref ${input.ref}`, { bold: true, size: 11, gapAfter: 2 });
  w.paragraph(
    `Oferta dotyczy: wykonanie prac wg pozycji poniżej${input.investmentAddress ? " — " + input.investmentAddress : ""}`,
    { size: 10.5, gapAfter: 16 },
  );
  w.paragraph(`Sz. P. ${input.contactPerson || "..."}`, { bold: true, size: 11, gapAfter: 2 });
  if (input.companyName) w.paragraph(input.companyName, { size: 10.5, gapAfter: 2 });
  w.paragraph(input.investmentAddress || input.address || "adres", { size: 10.5, gapAfter: 2 });
  w.paragraph(`Ciółkowo Małe dn. ${input.date}`, { size: 10.5, gapAfter: 24 });
  w.paragraph("Szanowni Państwo,", { gapAfter: 10 });
  w.paragraph("Dziękując za zapytanie ofertowe, pozwalamy sobie przesłać ofertę cenową powierzonego projektu.", { gapAfter: 10 });
  w.paragraph(`Celem otrzymania dodatkowych informacji w przypadku złożenia zamówienia uprzejmie prosimy o podanie numeru referencyjnego: ${input.ref}.`, {
    gapAfter: 10,
  });
  w.paragraph("Pozostając do Państwa dyspozycji,", { gapAfter: 24 });
  w.paragraph("Łączę wyrazy szacunku", { gapAfter: 2 });
  w.paragraph("Paweł Najduk", { bold: true, gapAfter: 0 });

  // ---- Karty technologii: prawdziwy PDF jesli jest, inaczej wygenerowana karta zastepcza ----
  // Karta MUSI trafić do oferty dla każdej wybranej technologii — jeśli
  // pobranie realnego pliku zawiedzie (sieć, uszkodzony plik) i w bazie nie
  // ma opisu do narysowania, dawniej pozycja znikała z PDF-u bez śladu.
  // Teraz zawsze dorysowujemy przynajmniej minimalną kartę zastępczą, a
  // niepowodzenia realnych plików zbieramy do missingRealPdf, żeby UI mógł
  // o tym poinformować.
  const missingRealPdf: string[] = [];
  for (const item of input.items) {
    let attachedReal = false;
    if (item.fetchRealPdf) {
      try {
        const bytes = await item.fetchRealPdf();
        if (bytes) {
          // ignoreEncryption: karty wgrywane przez Admina bywają zapisane z
          // ograniczeniami wydruku/edycji (typowe dla PDF-ów robionych w
          // Wordzie/InDesignie) bez hasła do otwarcia — pdf-lib domyślnie
          // odmawia wczytania KAŻDEGO zaszyfrowanego pliku, nawet takiego,
          // który każda przeglądarka otwiera bez pytania o hasło (dlatego
          // link "otwórz" w kroku 2 działał, a doklejanie do PDF-u — nie).
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const copied = await doc.copyPages(src, src.getPageIndices());
          copied.forEach((p) => doc.addPage(p));
          attachedReal = true;
        } else {
          missingRealPdf.push(`${item.code} - ${item.name}`);
        }
      } catch {
        // realny plik nie do wczytania (np. uszkodzony/niedostępny) — spadamy na kartę generowaną poniżej
        missingRealPdf.push(`${item.code} - ${item.name}`);
      }
    }
    if (!attachedReal) {
      w.newPage();
      w.band("Dokument A: Karta Standardu Wykonawczego");
      w.heading(`${item.code} - ${item.name}`, 13.5);
      if (item.description) {
        w.label("Opis technologii");
        w.paragraph(item.description);
      }
      if (item.workPhases && item.workPhases.length > 0) {
        w.label("Przebieg prac");
        w.list(item.workPhases, true);
      }
      if (item.investorBenefits && item.investorBenefits.length > 0) {
        w.label("Co zyskuje Inwestor?");
        w.list(item.investorBenefits, false);
      }
      if (!item.description && !item.workPhases && !item.investorBenefits) {
        w.paragraph("Pełna karta techniczna tej technologii nie jest jeszcze dostępna w systemie.");
      }
    }
  }

  // ---- Tabela cenowa ----
  w.newPage();
  w.heading(`Tabela cen Flowtex Polska N/Ref ${input.ref}`, 13);
  // Kolumna "Suma" liczona względem colRight (prawy margines strony), a
  // poprzednie wartości colX zostawiały jej realnie ~18-28pt — stąd
  // duże kwoty (np. "211 950,00 zł", 62pt szerokości) nachodziły na
  // kolumnę "Cena j.". Przeliczone tak, by każda kolumna cenowa miała
  // realny zapas (Cena j. 70pt, Suma 83pt) na kwoty do 7 cyfr.
  const colX = [MARGIN, MARGIN + 55, MARGIN + 250, MARGIN + 280, MARGIN + 330, MARGIN + 400];
  const colRight = PAGE_W - MARGIN;
  const colEnd = [...colX.slice(1), colRight];
  const rowH = 16;
  const headerH = 20;
  const drawTableHeader = () => {
    w.ensureSpace(headerH + rowH);
    w.page.drawRectangle({ x: MARGIN, y: w.y - headerH, width: colRight - MARGIN, height: headerH, color: NAVY });
    const heads = ["Nr karty", "Opis", "j.m.", "Ilość", "Cena j.", "Suma"];
    heads.forEach((h, i) => {
      w.page.drawText(polish ? h : toAscii(h), { x: colX[i] + 4, y: w.y - headerH + 6, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    });
    w.y -= headerH;
  };
  drawTableHeader();
  // Kolumna "Opis" (indeks 1) dostawała nazwy technologii dłuższe niż jej
  // szerokość (np. "Systemowa posadzka epoksydowa Fontefloor EP Sand") i bez
  // zawijania nachodziła jedną linią na kolumny j.m./Ilość obok — stąd
  // "rozjeżdżająca się" tabela. Opis jest teraz zawijany do szerokości
  // własnej kolumny, a wysokość wiersza rośnie wraz z liczbą linii; reszta
  // kolumn (liczbowe, jednolinijkowe) jest rysowana przy górnej krawędzi
  // wiersza, na wysokości pierwszej linii opisu.
  const opisWidth = colEnd[1] - colX[1] - 8;
  const drawRow = (cells: string[]) => {
    const size = 9;
    const opisLines = wrapText(font, polish ? cells[1] : toAscii(cells[1]), size, opisWidth);
    const lineH = size * 1.35;
    const h = Math.max(rowH, opisLines.length * lineH + 6);
    const pageBefore = w.page;
    w.ensureSpace(h + 4);
    if (w.page !== pageBefore) drawTableHeader(); // ensureSpace rolled to a fresh page — repeat header there
    cells.forEach((c, i) => {
      if (i === 1) {
        opisLines.forEach((line, li) => {
          w.page.drawText(line, { x: colX[1] + 4, y: w.y - size - 4 - li * lineH, size, font, color: INK });
        });
        return;
      }
      const isNum = i >= 3;
      const text = polish ? c : toAscii(c);
      const x = isNum ? colEnd[i] - 4 - font.widthOfTextAtSize(text, size) : colX[i] + 4;
      w.page.drawText(text, { x, y: w.y - size - 4, size, font, color: INK });
    });
    w.page.drawLine({ start: { x: MARGIN, y: w.y - h }, end: { x: colRight, y: w.y - h }, thickness: 0.5, color: LINE });
    w.y -= h;
  };
  for (const it of input.items) {
    drawRow([it.code, it.name, it.unit, it.qty, it.unitPriceLabel, it.totalLabel]);
  }
  for (const it of input.customItems) {
    drawRow(["—", it.name || "Pozycja własna", it.unit, it.qty, it.priceLabel, it.totalLabel]);
  }
  const drawTotalRow = (labelTextRaw: string, valueTextRaw: string) => {
    const labelText = polish ? labelTextRaw : toAscii(labelTextRaw);
    const valueText = polish ? valueTextRaw : toAscii(valueTextRaw);
    w.ensureSpace(rowH + 6);
    w.page.drawRectangle({ x: MARGIN, y: w.y - rowH - 2, width: colRight - MARGIN, height: rowH + 2, color: NAVY });
    w.page.drawText(labelText, { x: MARGIN + 4, y: w.y - rowH + 4, size: 9.5, font: fontBold, color: rgb(1, 1, 1) });
    w.page.drawText(valueText, {
      x: colRight - 4 - fontBold.widthOfTextAtSize(valueText, 9.5),
      y: w.y - rowH + 4,
      size: 9.5,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    w.y -= rowH + 2;
  };
  w.y -= 4;
  drawTotalRow("Suma pozycji Netto", input.subtotalLabel);
  if (input.discountPercent > 0) drawTotalRow(`Rabat ${input.discountPercent}%`, `-${input.discountLabel}`);
  drawTotalRow("Łącznie Netto", input.totalLabel);
  w.y -= 20;

  w.paragraph("Cena: Podane ceny są Netto   Warunki płatności: 14 dni   Termin wykonania: do ustalenia   Ważność oferty: 30 dni", {
    size: 9.5,
    gapAfter: 10,
  });
  w.paragraph(
    "W przypadku przestojów lub wstrzymania prac z przyczyn niezależnych od Wykonawcy, przysługuje mu wynagrodzenie za gotowość w wysokości 5000 zł netto za każdą rozpoczętą dobę przestoju (na jedną brygadę).",
    { size: 9.5, gapAfter: 14 },
  );
  w.label("Założenia do oferty");
  w.list(["Wykonanie prac przewiduje się w 2 etapach.", "Kontenery na odpady po stronie Zamawiającego."], false);

  // ---- Warunki ----
  w.newPage();
  w.heading("Warunki w miejscu wykonywania robót", 14);
  w.label("Zabezpieczenia");
  w.list(
    [
      "Pomieszczenia zostaną całkowicie opróżnione z wszelkich materiałów, towarów i innych instalacji, za wyjątkiem instalacji stałych.",
      "Celem uniknięcia jakichkolwiek zanieczyszczeń (pył, kurz, przeciągi itp.), strefy zostaną przez Państwa zabezpieczone oraz w trakcie wykonywania prac będą zamknięte dla innych wykonawców.",
    ],
    false,
  );
  w.label("Warunki wykonania");
  w.list(
    [
      "Strefy, w których wykonywane będą prace, muszą być ogrzane pomiędzy 12°C a 25°C.",
      "Temperatura podłoża musi zawierać się pomiędzy 10°C a 25°C.",
      "Wilgotność względna betonu nie może przekraczać 97% zgodnie z normą BS 8204 (beton powierzchniowo suchy).",
    ],
    false,
  );
  w.label("Stan podłoża");
  w.list(
    [
      "Podłoże musi charakteryzować się odpornością na odrywanie minimum 1,5 MPa (badania pull-off) i powinno być klasy min. C20/25.",
      "Podłoże (beton/wylewka) musi charakteryzować się gładkim wykończeniem, najlepiej zatarte mechanicznie zacieraczką do betonu.",
      "Pod płytą betonową powinna istnieć skuteczna izolacja przeciwwodna.",
      "Podczas wykonywania płyty betonowej nie stosować utwardzaczy chemicznych pod żywicę.",
      "W przypadku zastosowania utwardzaczy chemicznych do wykończenia posadzki betonowej lub zbyt grubej warstwy mleczka cementowego konieczny będzie podwójny przejazd śrutownicy — takie prace będą przedmiotem dodatkowego kosztorysu.",
      "Posadzka żywiczna jest odzwierciedleniem betonowego podłoża. Ceny nie zawierają ewentualnych dodatkowych równań betonu.",
      "Firma Flowtex nie jest zobowiązana do kontroli kształtu oraz równości podłoża przed przystąpieniem do prac, za wyjątkiem odrębnych postanowień pisemnych — przyjmuje się, że podłoże betonowe zostało wykonane zgodnie z normami/planami/projektami oraz odebrane przez Zamawiającego.",
    ],
    false,
  );
  w.label("Warunki po stronie Zamawiającego");
  w.list(
    [
      "Bieżąca woda.",
      "Energia elektryczna jednofazowa 220V 16 A i trójfazowa 220/380V 32 A z zabezpieczeniem C35.",
      "Zapewnienie warunków do rozładunku materiałów i ich transportu.",
      "Odpowiednie oświetlenie górne.",
      "Strefa składowania materiałów z temperaturą pomiędzy 10°C a 25°C.",
    ],
    false,
  );
  w.label("Warunki naszej oferty");
  w.list(["Ceny opierają się na ilościach wskazanych w kosztorysie (m² – mb).", "Podane ceny są bez VAT."], false);

  // Numeracja stron, prawy dolny róg — jednym przebiegiem na końcu, po
  // tym jak znany jest już finalny komplet stron (łącznie z doklejonymi
  // realnymi kartami PDF). Rozmiar każdej strony liczony osobno
  // (page.getWidth/Height), bo doklejone realne karty mogą mieć inny
  // format niż nasze własne strony A4.
  const allPages = doc.getPages();
  allPages.forEach((page, i) => {
    const label = `${i + 1} / ${allPages.length}`;
    const size = 8;
    page.drawText(polish ? label : toAscii(label), {
      x: page.getWidth() - MARGIN - font.widthOfTextAtSize(label, size),
      y: 20,
      size,
      font,
      color: GREY,
    });
  });

  return { bytes: await doc.save(), missingRealPdf };
}
