// Service worker aplikacji Budowy — offline dla statycznych assetów
// (JS/CSS/obrazki/fonty), NIE dla API i NIE dla version.json.
//
// Nazwa cache'a zawiera CACHE_VERSION — ta wartość jest podbijana ręcznie
// tylko gdy zmienia się LOGIKA tego service workera (np. inna strategia
// cache'owania). Nie trzeba jej ruszać przy zwykłych wdrożeniach appki —
// od tego jest osobny mechanizm: app/version.json + BUILD_VERSION,
// patrz lib/pwa/useVersionCheck.ts.
const CACHE_VERSION = "v1";
const CACHE_NAME = `budowy-static-${CACHE_VERSION}`;

// Ścieżki, które NIGDY nie mają trafić do cache'a — zawsze świeże z
// sieci. To m.in. dane biznesowe (tRPC/API) i plik wersji, który służy
// właśnie do wykrywania nowego builda (gdyby był cache'owany, apka
// nigdy nie zauważyłaby aktualizacji).
const NEVER_CACHE_PATTERNS = [
  /\/api\//,
  /\/trpc\b/,
  /\/version\.json(\?.*)?$/,
  /\/manus-storage\//,
];

function shouldBypassCache(url) {
  return NEVER_CACHE_PATTERNS.some((re) => re.test(url.pathname));
}

// Tylko GET-y do własnego origin trafiają do cache'a — nie cache'ujemy
// requestów cross-origin (fonty/CDN mają własne reguły przeglądarki) ani
// mutacji.
function isCacheableStaticAsset(request, url) {
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    !shouldBypassCache(url)
  );
}

self.addEventListener("install", () => {
  // Nie czekamy na zamknięcie starych tabów — nowy SW przejmuje kontrolę
  // dopiero gdy dostanie komunikat SKIP_WAITING (patrz niżej), żeby nie
  // podmieniać assetów pod użytkownikiem w trakcie pracy bez ostrzeżenia.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("budowy-static-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (!isCacheableStaticAsset(request, url)) {
    // Sieć bez pytania cache'a — API/tRPC/version.json mają być zawsze
    // aktualne. Jeśli sieci nie ma, request po prostu failuje (offline
    // = brak danych z serwera, ale statyczna powłoka appki dalej działa).
    return;
  }

  // Stale-while-revalidate: od razu oddajemy to co w cache'u (szybko,
  // działa offline), a w tle dociągamy świeżą wersję i podmieniamy wpis
  // na przyszłość. Dzięki temu zwykłe odświeżenie assetów (np. po
  // deployu, zanim useVersionCheck zdąży wymusić pełny reset cache'a)
  // dzieje się samo, bez migania/białego ekranu.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => undefined);
      return cached || (await networkPromise) || Response.error();
    })(),
  );
});

// ---------------------------------------------------------------------
// Web Push (Safari iOS 16.4+, patrz 068_web_push_ios_safari.sql i
// lib/notifications/use-register-web-push.ts) — Admin dostaje
// powiadomienie o nowym raporcie nawet gdy appka jest zamknięta.
// Payload wysyłany przez send-report-notification to JSON
// {title, body, data:{buildId, date, url}}.
//
// UWAGA iOS: KAŻDY push MUSI zakończyć się showNotification() wewnątrz
// event.waitUntil(). Jeżeli handler choć raz nie pokaże powiadomienia,
// WebKit może unieważnić subskrypcję (brak wsparcia dla silent push).
// Dlatego poniżej nie ma ŻADNEJ ścieżki wyjścia bez notyfikacji.
// ---------------------------------------------------------------------
self.addEventListener("push", (event) => {
  const fallback = {
    title: "Nowy raport dzienny",
    body: "Otwórz aplikację, żeby zobaczyć szczegóły.",
    data: {},
  };

  let payload = fallback;
  try {
    if (event.data) {
      // Najpierw JSON, a gdy to nie JSON — czysty tekst jako body.
      let parsed = null;
      try {
        parsed = event.data.json();
      } catch {
        const text = event.data.text();
        parsed = text ? { body: text } : null;
      }
      if (parsed && typeof parsed === "object") {
        payload = { ...fallback, ...parsed };
      }
    }
  } catch {
    // Cokolwiek by się nie stało — pokazujemy powiadomienie domyślne,
    // bo brak notyfikacji na iOS = ryzyko utraty subskrypcji.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || fallback.title, {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // tag + renotify: kolejny raport podmienia poprzednie powiadomienie
      // zamiast budować stos kilkunastu wpisów na ekranie blokady.
      tag: payload.tag || "raport",
      renotify: true,
      data: payload.data ?? {},
    }),
  );
});

// Kliknięcie w powiadomienie: skup istniejącą kartę appki, jeśli jest
// otwarta, zamiast zawsze otwierać nową. Gdy payload niesie data.url —
// nawiguj tam (np. prosto do raportu).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = clientsList.find((c) => "focus" in c);
      if (existing) {
        // navigate() bywa niedostępne/rzuca na iOS — focus jest
        // ważniejszy niż deep link, więc nawigacja jest best-effort.
        try {
          if ("navigate" in existing && targetUrl) {
            await existing.navigate(targetUrl);
          }
        } catch {
          // ignorujemy — zostaje samo skupienie okna
        }
        await existing.focus();
        return;
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});

// iOS potrafi wygasić/odnowić subskrypcję bez udziału użytkownika.
// Ten handler zapisuje nową subskrypcję od razu, bez czekania aż ktoś
// otworzy Ustawienia i kliknie "Włącz powiadomienia" ponownie.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const applicationServerKey =
          event.oldSubscription?.options?.applicationServerKey;
        if (!applicationServerKey) return;
        const fresh = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
        // Endpoint trafia do wszystkich otwartych klientów — appka
        // dosyła go do Supabase przez register_web_push_subscription
        // (patrz lib/pwa/registerServiceWorker.ts).
        const clientsList = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of clientsList) {
          client.postMessage({
            type: "PUSH_SUBSCRIPTION_CHANGED",
            subscription: fresh.toJSON(),
          });
        }
      } catch {
        // Bez sesji użytkownika i tak nie zapiszemy — przy następnym
        // otwarciu appki zrobi to useRegisterWebPush().
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "CLEAR_CACHE") {
    // Odpowiadamy na porcie zwrotnym DOPIERO gdy cache faktycznie zniknie
    // — inaczej strona wywołująca reload wyścigowo trafiała na mieszankę
    // starych (z cache'a) i nowych (z sieci) assetów, np. HTML z jednego
    // builda + CSS z drugiego, co gubiło część klas Tailwind (m.in.
    // ograniczenie szerokości layoutu). Patrz registerServiceWorker.ts.
    const replyPort = event.ports && event.ports[0];
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) => key.startsWith("budowy-static-"))
            .map((key) => caches.delete(key)),
        );
        replyPort?.postMessage({ type: "CACHE_CLEARED" });
      })(),
    );
  }
});