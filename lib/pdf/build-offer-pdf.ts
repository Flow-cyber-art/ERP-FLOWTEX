import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

/**
 * Składa finalny PDF oferty: strona tytułowa + PRAWDZIWE pliki PDF kart
 * technicznych (wgrane przez Admina do Supabase Storage — patrz
 * 097/098_faza0_karty_pdf_*.sql) doklejone stronami do dokumentu, plus
 * tabela cenowa i warunki. To jest "ustalenie" z rozmowy: PDF karty
 * wybranej w kroku 2 wizardu ma trafić DO oferty, nie tylko być
 * linkiem do otwarcia osobno.
 *
 * Standardowe fonty PDF (WinAnsi) nie obsługują polskich ogonków/kresek
 * (ą ć ę ł ń ó ś ź ż) — d s tego tekst, który SAMI rysujemy (strona
 * tytułowa, tabela cen, warunki, karta zastępcza gdy brak realnego
 * PDF-a) jest transliterowany do ASCII. Treść PRAWDZIWYCH kart PDF
 * (kopiowanych stronami, nie rysowanych) zachowuje pełne polskie znaki
 * bez zmian — to one niosą właściwy tekst kart.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const NAVY = rgb(0x0e / 255, 0x2a / 255, 0x3d / 255);
const GOLD = rgb(0x8a / 255, 0x5f / 255, 0x1e / 255);
const GREY = rgb(0.45, 0.45, 0.45);
const INK = rgb(0.1, 0.1, 0.1);
const LINE = rgb(0.87, 0.87, 0.87);

const ASCII_MAP: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "A", Ć: "C", Ę: "E", Ł: "L", Ń: "N", Ó: "O", Ś: "S", Ź: "Z", Ż: "Z",
  "„": '"', "”": '"', "‚": ",", "’": "'", "‘": "'", "–": "-", "—": "-", "…": "...",
};

function toAscii(s: string): string {
  return s.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ„”‚''–—…]/g, (c) => ASCII_MAP[c] ?? c);
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
  page!: PDFPage;
  y = 0;
  ref: string;

  constructor(doc: PDFDocument, font: PDFFont, fontBold: PDFFont, ref: string) {
    this.doc = doc;
    this.font = font;
    this.fontBold = fontBold;
    this.ref = ref;
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
    this.drawFooter();
  }

  drawFooter() {
    const size = 8;
    this.page.drawText(toAscii("Ciolkowo Male 32, 07-215 Obryte  --  NIP: 7621744781"), {
      x: MARGIN,
      y: MARGIN - 24,
      size,
      font: this.font,
      color: GREY,
    });
    const right = "www.flowtex.pl";
    this.page.drawText(right, {
      x: PAGE_W - MARGIN - this.font.widthOfTextAtSize(right, size),
      y: MARGIN - 24,
      size,
      font: this.font,
      color: GREY,
    });
  }

  ensureSpace(h: number) {
    if (this.y - h < MARGIN) this.newPage();
  }

  band(text: string) {
    const h = 24;
    this.ensureSpace(h + 20);
    this.page.drawRectangle({ x: 0, y: this.y - h, width: PAGE_W, height: h, color: NAVY });
    this.page.drawText(toAscii(text.toUpperCase()), {
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
    this.page.drawText(toAscii(text), { x: MARGIN, y: this.y - size, size, font: this.fontBold, color: INK });
    this.y -= size + 12;
  }

  label(text: string) {
    this.ensureSpace(20);
    this.page.drawText(toAscii(text.toUpperCase()), { x: MARGIN, y: this.y - 9, size: 9, font: this.fontBold, color: GOLD });
    this.y -= 18;
  }

  paragraph(text: string, opts: { size?: number; bold?: boolean; indent?: number; gapAfter?: number } = {}) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.fontBold : this.font;
    const indent = opts.indent ?? 0;
    const maxWidth = PAGE_W - 2 * MARGIN - indent;
    const lineH = size * 1.45;
    for (const line of wrapText(font, toAscii(text), size, maxWidth)) {
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
      const lines = wrapText(this.font, toAscii(item), size, maxWidth - this.font.widthOfTextAtSize(prefix, size));
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

export async function buildOfferPdf(input: BuildOfferPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new DocWriter(doc, font, fontBold, input.ref);

  // ---- Strona tytulowa ----
  w.page.drawText("FLOWTEX", { x: MARGIN, y: w.y - 22, size: 22, font: fontBold, color: NAVY });
  w.page.drawText("Polska", { x: MARGIN + fontBold.widthOfTextAtSize("FLOWTEX ", 22), y: w.y - 22, size: 22, font: fontBold, color: GOLD });
  w.y -= 50;
  w.paragraph(`N/Ref ${input.ref}`, { bold: true, size: 11, gapAfter: 2 });
  w.paragraph(
    `Oferta dotyczy: wykonanie prac wg pozycji ponizej${input.investmentAddress ? " -- " + input.investmentAddress : ""}`,
    { size: 10.5, gapAfter: 16 },
  );
  w.paragraph(`Sz. P. ${input.contactPerson || "..."}`, { bold: true, size: 11, gapAfter: 2 });
  if (input.companyName) w.paragraph(input.companyName, { size: 10.5, gapAfter: 2 });
  w.paragraph(input.investmentAddress || input.address || "adres", { size: 10.5, gapAfter: 2 });
  w.paragraph(`Ciolkowo Male dn. ${input.date}`, { size: 10.5, gapAfter: 24 });
  w.paragraph("Szanowni Panstwo,", { gapAfter: 10 });
  w.paragraph("Dziekujac za zapytanie ofertowe, pozwalamy sobie przeslac oferte cenowa powierzonego projektu.", { gapAfter: 10 });
  w.paragraph(`Celem otrzymania dodatkowych informacji w przypadku zlozenia zamowienia uprzejmie prosimy o podanie numeru referencyjnego: ${input.ref}.`, {
    gapAfter: 10,
  });
  w.paragraph("Pozostajac do Panstwa dyspozycji,", { gapAfter: 24 });
  w.paragraph("Lacze wyrazy szacunku", { gapAfter: 2 });
  w.paragraph("Pawel Najduk", { bold: true, gapAfter: 0 });

  // ---- Karty technologii: prawdziwy PDF jesli jest, inaczej wygenerowana karta zastepcza ----
  for (const item of input.items) {
    let attachedReal = false;
    if (item.fetchRealPdf) {
      try {
        const bytes = await item.fetchRealPdf();
        if (bytes) {
          const src = await PDFDocument.load(bytes);
          const copied = await doc.copyPages(src, src.getPageIndices());
          copied.forEach((p) => doc.addPage(p));
          attachedReal = true;
        }
      } catch {
        // realny plik nie do wczytania (np. uszkodzony/niedostępny) — spadamy na kartę generowaną poniżej
      }
    }
    if (!attachedReal && item.description && item.workPhases && item.investorBenefits) {
      w.newPage();
      w.band("Dokument A: Karta Standardu Wykonawczego");
      w.heading(`${item.code} - ${item.name}`, 13.5);
      w.label("Opis technologii");
      w.paragraph(item.description);
      w.label("Przebieg prac");
      w.list(item.workPhases, true);
      w.label("Co zyskuje Inwestor?");
      w.list(item.investorBenefits, false);
    }
  }

  // ---- Tabela cenowa ----
  w.newPage();
  w.heading(`Tabela cen Flowtex Polska N/Ref ${input.ref}`, 13);
  const colX = [MARGIN, MARGIN + 70, MARGIN + 300, MARGIN + 335, MARGIN + 400, MARGIN + 465];
  const colRight = PAGE_W - MARGIN;
  const colEnd = [...colX.slice(1), colRight];
  const rowH = 16;
  const headerH = 20;
  const drawTableHeader = () => {
    w.ensureSpace(headerH + rowH);
    w.page.drawRectangle({ x: MARGIN, y: w.y - headerH, width: colRight - MARGIN, height: headerH, color: NAVY });
    const heads = ["Nr karty", "Opis", "j.m.", "Ilosc", "Cena j.", "Suma"];
    heads.forEach((h, i) => {
      const x = colX[i] + (i >= 3 ? 0 : 0);
      w.page.drawText(h, { x: x + 4, y: w.y - headerH + 6, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    });
    w.y -= headerH;
  };
  drawTableHeader();
  const drawRow = (cells: string[]) => {
    const pageBefore = w.page;
    w.ensureSpace(rowH + 4);
    if (w.page !== pageBefore) drawTableHeader(); // ensureSpace rolled to a fresh page — repeat header there
    cells.forEach((c, i) => {
      const size = 9;
      const isNum = i >= 3;
      const text = toAscii(c);
      const x = isNum ? colEnd[i] - 4 - font.widthOfTextAtSize(text, size) : colX[i] + 4;
      w.page.drawText(text, { x, y: w.y - rowH + 5, size, font, color: INK });
    });
    w.page.drawLine({ start: { x: MARGIN, y: w.y - rowH }, end: { x: colRight, y: w.y - rowH }, thickness: 0.5, color: LINE });
    w.y -= rowH;
  };
  for (const it of input.items) {
    drawRow([it.code, it.name, it.unit, it.qty, it.unitPriceLabel, it.totalLabel]);
  }
  for (const it of input.customItems) {
    drawRow(["--", it.name || "Pozycja wlasna", it.unit, it.qty, it.priceLabel, it.totalLabel]);
  }
  const drawTotalRow = (labelTextRaw: string, valueTextRaw: string) => {
    const labelText = toAscii(labelTextRaw);
    const valueText = toAscii(valueTextRaw);
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
  drawTotalRow("Lacznie Netto", input.totalLabel);
  w.y -= 20;

  w.paragraph("Cena: Podane ceny sa Netto   Warunki platnosci: 14 dni   Termin wykonania: do ustalenia   Waznosc oferty: 30 dni", {
    size: 9.5,
    gapAfter: 10,
  });
  w.paragraph(
    "W przypadku przestojow lub wstrzymania prac z przyczyn niezaleznych od Wykonawcy, przysluguje mu wynagrodzenie za gotowosc w wysokosci 5000 zl netto za kazda rozpoczeta dobe przestoju (na jedna brygade).",
    { size: 9.5, gapAfter: 14 },
  );
  w.label("Zalozenia do oferty");
  w.list(["Wykonanie prac przewiduje sie w 2 etapach.", "Kontenery na odpady po stronie Zamawiajacego."], false);

  // ---- Warunki ----
  w.newPage();
  w.heading("Warunki w miejscu wykonywania robot", 14);
  w.label("Zabezpieczenia");
  w.list(
    [
      "Pomieszczenia zostana calkowicie oprozniona z wszelkich materialow, towarow i innych instalacji, za wyjatkiem instalacji stalych.",
      "Celem uniknieia jakichkolwiek zanieczyszczen (pyl, kurz, przeciagi itp.), strefy zostana przez Panstwa zabezpieczone oraz w trakcie wykonywania prac beda zamkniete dla innych wykonawcow.",
    ],
    false,
  );
  w.label("Warunki wykonania");
  w.list(
    [
      "Strefy, w ktorych wykonywane beda prace, musza byc ogrzane pomiedzy 12C a 25C.",
      "Temperatura podloza musi zawierac sie pomiedzy 10C a 25C.",
      "Wilgotnosc wzgledna betonu nie moze przekraczac 97% zgodnie z norma BS 8204 (beton powierzchniowo suchy).",
    ],
    false,
  );
  w.label("Stan podloza");
  w.list(
    [
      "Podloze musi charakteryzowac sie odpornoscia na odrywanie minimum 1,5 MPa (badania pull-off) i powinno byc klasy min. C20/25.",
      "Podloze (beton/wylewka) musi charakteryzowac sie gladkim wykonczeniem, najlepiej zatarte mechanicznie zacieraczka do betonu.",
      "Pod plyta betonowa powinna istniec skuteczna izolacja przeciwwodna.",
      "Podczas wykonywania plyty betonowej nie stosowac utwardzaczy chemicznych pod zywice.",
      "W przypadku zastosowania utwardzaczy chemicznych do wykonczenia posadzki betonowej lub zbyt grubej warstwy mleczka cementowego konieczny bedzie podwojny przejazd srutownicy -- takie prace beda przedmiotem dodatkowego kosztorysu.",
      "Posadzka zywiczna jest odzwierciedleniem betonowego podloza. Ceny nie zawieraja ewentualnych dodatkowych rownan betonu.",
      "Firma Flowtex nie jest zobowiazana do kontroli ksztaltu oraz rownosci podloza przed przystapieniem do prac, za wyjatkiem odrebnych postanowien pisemnych -- przyjmuje sie, ze podloze betonowe zostalo wykonane zgodnie z normami/planami/projektami oraz odebrane przez Zamawiajacego.",
    ],
    false,
  );
  w.label("Warunki po stronie Zamawiajacego");
  w.list(
    [
      "Biezaca woda.",
      "Energia elektryczna jednofazowa 220V 16 A i trojfazowa 220/380V 32 A z zabezpieczeniem C35.",
      "Zapewnienie warunkow do rozladunku materialow i ich transportu.",
      "Odpowiednie oswietlenie gorne.",
      "Strefa skladowania materialow z temperatura pomiedzy 10C a 25C.",
    ],
    false,
  );
  w.label("Warunki naszej oferty");
  w.list(["Ceny opieraja sie na ilosciach wskazanych w kosztorysie (m2 - mb).", "Podane ceny sa bez VAT."], false);

  return doc.save();
}
