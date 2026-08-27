import React from "react";
import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft, ArrowRight, CircleAlert, CheckCircle2, Phone, Mail } from "lucide-react";
import { COLORS } from "../theme.js";
import { ContactForm } from "../components/ContactForm.jsx";
import "../styles/defect-catalog.css";
import { DEFECTS } from "../data/defects.js";

const IMAGE = "/images/flowtex/";


function Detail({ defect }) {
  const canonicalUrl = `https://www.flowtex.pl/katalog-wad/${defect.id}`;
  const metaDescription = `${defect.intro} Poznaj możliwe przyczyny i kierunek naprawy — bezpłatna wycena FLOWTEX Polska.`;

  return <article className="defect-detail-page">
    <Helmet>
      <title>{defect.title} — przyczyny i naprawa | FLOWTEX Polska</title>
      <meta name="description" content={metaDescription} />
      <link rel="canonical" href={canonicalUrl} />
      <meta property="og:title" content={`${defect.title} — przyczyny i naprawa | FLOWTEX Polska`} />
      <meta property="og:description" content={metaDescription} />
      <meta property="og:url" content={canonicalUrl} />
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Article",
              headline: defect.title,
              description: metaDescription,
              about: defect.title,
              mainEntityOfPage: canonicalUrl,
              author: { "@type": "Organization", name: "FLOWTEX Polska" },
              publisher: { "@type": "Organization", name: "FLOWTEX Polska" },
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Strona główna", item: "https://www.flowtex.pl/" },
                { "@type": "ListItem", position: 2, name: "Katalog wad", item: "https://www.flowtex.pl/katalog-wad" },
                { "@type": "ListItem", position: 3, name: defect.title, item: canonicalUrl },
              ],
            },
          ],
        })}
      </script>
    </Helmet>
    <nav className="defect-breadcrumbs" aria-label="Ścieżka nawigacji">
      <Link to="/">Strona główna</Link>
      <span>/</span>
      <Link to="/katalog-wad">Katalog wad</Link>
      <span>/</span>
      <span aria-current="page">{defect.title}</span>
    </nav>
    <div className="defect-detail-hero">
      <div>
        <Link className="defect-back" to="/katalog-wad"><ArrowLeft size={15} /> Wróć do katalogu</Link>
        <p className="defect-kicker"><span>{defect.no}</span> KARTA WADY / {defect.tag.toUpperCase()}</p>
        <h1>{defect.title}</h1>
        <p className="defect-lede">{defect.intro}</p>
      </div>
      <img src={`${IMAGE}${defect.image}`} alt={`Przykład: ${defect.title.toLowerCase()}`} width="960" height="720" loading="eager" fetchpriority="high" decoding="async" />
    </div>
    <div className="defect-detail-body">
      <section className="defect-summary"><p className="defect-kicker"><span>01</span> ROZPOZNANIE</p><h2>Co może oznaczać ten objaw?</h2><p>Ten sam objaw może mieć kilka przyczyn. Przed wyborem technologii naprawy warto sprawdzić podłoże, sposób użytkowania i warunki panujące w obiekcie.</p><p className="defect-disclaimer"><strong>Ważne:</strong> opis ma charakter edukacyjny i nie jest diagnozą ani projektem naprawy. Dobór technologii wymaga oceny podłoża, obciążeń, wody, temperatury i chemikaliów oraz potwierdzenia w aktualnej karcie technicznej konkretnego systemu.</p></section>
      <div className="defect-detail-columns"><section className="defect-panel"><p className="defect-panel-label">MOŻLIWE POWODY POWSTAWANIA</p><ul>{defect.causes.map((cause) => <li key={cause}><CircleAlert size={15} />{cause}</li>)}</ul></section><section className="defect-panel defect-panel-dark"><p className="defect-panel-label">SUGESTIE ROZWIĄZANIA</p><ul>{defect.solutions.map((solution) => <li key={solution}><CheckCircle2 size={15} />{solution}</li>)}</ul></section></div>
      <section id="defect-kontakt" className="defect-funnel defect-funnel-form">
        <div className="defect-funnel-copy">
          <p className="defect-kicker"><span>02</span> NASTĘPNY KROK</p>
          <p className="defect-funnel-highlight"><strong>Widzisz ten problem u siebie?</strong> Możemy Ci pomóc — rozpoznamy przyczynę i zaproponujemy naprawę.</p>
          <h2>Szukasz wykonawcy?<br />Zadzwoń albo napisz.</h2>
          <p>Opisz problem — wrócimy z możliwym kierunkiem działania i przygotujemy bezpłatną wycenę. Możesz też zadzwonić od razu.</p>
          <div className="defect-funnel-quick-contact">
            <a href="tel:+48507394552"><Phone size={16} /> +48 507 394 552</a>
            <a href="mailto:kontakt@flowtex.pl"><Mail size={16} /> kontakt@flowtex.pl</a>
          </div>
        </div>
        <ContactForm prefillContext={`Katalog wad — ${defect.title}`} submitLabel="Poproś o bezpłatną wycenę" />
      </section>
      <Link className="cross-tool-link" to="/dobor-posadzki">Planujesz nową posadzkę od podstaw? Skorzystaj z narzędzia doboru systemu <ArrowRight size={14} /></Link>
    </div>
  </article>;
}

export default function DefectCatalog() {
  const { defectId } = useParams();
  const defect = DEFECTS.find((item) => item.id === defectId);
  if (defect) return <Detail defect={defect} />;
  return <div className="defect-catalog-page">
    <Helmet>
      <title>Katalog wad posadzek przemysłowych — objawy, przyczyny, naprawa | FLOWTEX Polska</title>
      <meta
        name="description"
        content="Rozpoznaj problem widoczny na posadzce: pęknięcia, ubytki, odspojoną żywicę, pylenie i inne. 14 typów wad posadzek przemysłowych z przyczynami i kierunkiem naprawy — bezpłatna wycena FLOWTEX Polska."
      />
      <link rel="canonical" href="https://www.flowtex.pl/katalog-wad" />
      <meta property="og:title" content="Katalog wad posadzek przemysłowych | FLOWTEX Polska" />
      <meta
        property="og:description"
        content="Wybierz problem widoczny na posadzce i poznaj możliwe przyczyny oraz kierunek naprawy."
      />
      <meta property="og:url" content="https://www.flowtex.pl/katalog-wad" />
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "CollectionPage",
              name: "Katalog wad posadzek przemysłowych",
              description: "14 typów wad posadzek przemysłowych i żywicznych z przyczynami i kierunkiem naprawy.",
              url: "https://www.flowtex.pl/katalog-wad",
              mainEntity: {
                "@type": "ItemList",
                itemListElement: DEFECTS.map((item, index) => ({
                  "@type": "ListItem",
                  position: index + 1,
                  name: item.title,
                  url: `https://www.flowtex.pl/katalog-wad/${item.id}`,
                })),
              },
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Strona główna", item: "https://www.flowtex.pl/" },
                { "@type": "ListItem", position: 2, name: "Katalog wad", item: "https://www.flowtex.pl/katalog-wad" },
              ],
            },
          ],
        })}
      </script>
    </Helmet>
    <nav className="defect-breadcrumbs" aria-label="Ścieżka nawigacji">
      <Link to="/">Strona główna</Link>
      <span>/</span>
      <span aria-current="page">Katalog wad</span>
    </nav>
    <section className="defect-catalog-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(16,16,17,.96), rgba(27,27,29,.56)), url(${IMAGE}hero.webp)` }}><div><p className="defect-kicker light"><CircleAlert size={14} /> KATALOG WAD POSADZEK</p><h1>Najpierw objaw.<br /><em>Potem rozwiązanie.</em></h1><p>Wybierz problem, który widzisz na posadzce. Poznaj możliwe przyczyny, kierunki naprawy i przejdź do bezpłatnej wyceny.</p></div></section>
    <section className="defect-catalog-list"><div className="defect-section-head"><p className="defect-kicker"><span>01</span> KATALOG</p><h2>Wybierz wadę.</h2><p>Każda karta prowadzi do osobnego opisu problemu, jego możliwych powodów i sugestii rozwiązania.</p></div><div className="defect-grid">{DEFECTS.map((item) => <Link className="defect-card" to={`/katalog-wad/${item.id}`} key={item.id}><img className="defect-card-thumb" src={`${IMAGE}${item.image}`} alt={item.title} width="960" height="720" loading="lazy" decoding="async" /><div className="defect-card-footer"><span className="defect-card-no">{item.no}</span><span><strong>{item.title}</strong><small>{item.intro}</small></span><ArrowRight size={18} /></div></Link>)}</div></section>
  </div>;
}
