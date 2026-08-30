// Powiadomienie push dla wszystkich Adminów o nowym/zaktualizowanym
// raporcie dziennym — wołane fire-and-forget zaraz po udanym
// `submitDailyReport` (patrz lib/offline-outbox.ts, flushOutbox).
//
// Dwa niezależne kanały:
//  - Expo Push (push_tokens, 067) — natywny build Android/iOS przez EAS.
//  - Web Push (web_push_subscriptions, 068_web_push_ios_safari.sql) —
//    Safari na iPhonie, appka dodana "Do ekranu głównego" (iOS 16.4+).
//
// ZMIANA vs. poprzednia wersja (przyczyna "push nie działa na iOS"):
//  1. `npm:web-push` NIE działa niezawodnie na Deno Deploy (opiera się na
//     node:https / node:crypto i strumieniach Node). Zamienione na
//     `jsr:@negrel/webpush`, które używa natywnego WebCrypto — to jest
//     rekomendowana droga dla Supabase Edge Functions.
//  2. Wszystkie błędy web push są teraz RAPORTOWANE w odpowiedzi
//     (wcześniej brak sekretu VAPID_PRIVATE_KEY albo błąd 400/403 z
//     Apple przechodził bezszelestnie i funkcja zwracała "sukces").
//
// Wymagane sekrety (Supabase Dashboard -> Edge Functions -> Secrets):
//   VAPID_PRIVATE_KEY — klucz prywatny z tej samej pary co
//     VAPID_PUBLIC_KEY poniżej (JWK "d" albo base64url raw).
//   VAPID_SUBJECT — opcjonalnie, np. "mailto:ktos@flowtex.pl".
//     MUSI zaczynać się od "mailto:" lub "https://" — inaczej Apple
//     odrzuca żądanie błędem 400 BadJwtToken.
//
// Deploy: Supabase Dashboard -> Edge Functions -> send-report-notification.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3.0";

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

// Klucz publiczny VAPID — nie sekret, MUSI być identyczny z
// app.config.ts (extra.vapidPublicKey), bo to jedna para kluczy.
const VAPID_PUBLIC_KEY =
  "BL6QFXgICW6_AXZAPTupcdpjYXE6UjCV_K7fliF5x7cQRGjFWlaCf_1pLI6YgvL_q0Ie4txSBFuX7rLSWi9S5vg";

/**
 * Klucz prywatny może być podany na dwa sposoby:
 *  - jako pełny JWK w JSON (najwygodniejsze, gdy generujesz przez
 *    `webpush.generateVapidKeys()` i robisz `exportVapidKeys`),
 *  - jako sam parametr "d" w base64url (format z web-push CLI).
 * Obsługujemy oba, żeby nie było zgadywania przy wklejaniu sekretu.
 */
async function importVapidKeys(privateKeyRaw: string) {
  const trimmed = privateKeyRaw.trim();

  if (trimmed.startsWith("{")) {
    return await webpush.importVapidKeys(JSON.parse(trimmed), { extractable: false });
  }

  // Klucz publiczny (65 bajtów, 0x04 + X + Y) rozbijamy na współrzędne
  // JWK, bo WebCrypto przyjmuje wyłącznie format JWK/PKCS8.
  const pub = decodeBase64Url(VAPID_PUBLIC_KEY);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY nie jest poprawnym niezaskompresowanym punktem P-256.");
  }
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(pub.slice(1, 33)),
    y: encodeBase64Url(pub.slice(33, 65)),
    d: trimmed,
  };
  return await webpush.importVapidKeys(
    { publicKey: { ...jwk, key_ops: ["verify"] }, privateKey: { ...jwk, key_ops: ["sign"] } },
    { extractable: false },
  );
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  return Uint8Array.from(atob(withPadding), (c) => c.charCodeAt(0));
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Brak nagłówka autoryzacji." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@flowtex.pl";

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) return json({ error: "Nieprawidłowa sesja." }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Nieprawidłowe body żądania." }, 400);
  }
  // `debug: true` w body -> odpowiedź zawiera pełną diagnostykę kanału
  // web push (ile subskrypcji, jakie błędy) zamiast samych liczników.
  const debug = body.debug === true;
  const buildId = Number(body.buildId);
  const date = typeof body.date === "string" ? body.date : null;
  if (!buildId || !date) return json({ error: "Brak buildId lub date." }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: build } = await admin
    .from("builds")
    .select("name, number")
    .eq("id", buildId)
    .maybeSingle();

  const { data: adminProfiles } = await admin.from("profiles").select("id").eq("role", "Admin");
  const adminIds = (adminProfiles ?? []).map((p: { id: string }) => p.id);
  if (adminIds.length === 0) {
    return json({ sentExpo: 0, sentWeb: 0, errors: ["brak profili z rolą Admin"] });
  }

  const title = "Nowy raport dzienny";
  const buildLabel = build ? `${build.number} · ${build.name}` : `budowa #${buildId}`;
  const bodyText = `${buildLabel} — ${date}. Sprawdź i zatwierdź, żeby klient zobaczył aktualizację.`;

  let sentExpo = 0;
  let sentWeb = 0;
  const errors: string[] = [];
  const diagnostics: Record<string, unknown> = { adminIds: adminIds.length };

  // --- Kanał 1: Expo Push (natywny build) ---
  try {
    const { data: tokenRows } = await admin
      .from("push_tokens")
      .select("token")
      .in("profile_id", adminIds);
    const tokens = [...new Set((tokenRows ?? []).map((r: { token: string }) => r.token))];
    const messages = tokens.map((to) => ({
      to,
      title,
      body: bodyText,
      data: { buildId, date },
      sound: "default",
    }));
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
      if (!response.ok) {
        errors.push(`expo ${response.status}: ${await response.text()}`);
      }
    }
    sentExpo = tokens.length;
  } catch (err) {
    errors.push(`expo: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- Kanał 2: Web Push (Safari na iPhonie) ---
  if (!vapidPrivateKey) {
    // KLUCZOWE: wcześniej ten przypadek po cichu pomijał cały kanał i
    // funkcja zwracała "sukces" z sentWeb: 0.
    errors.push("web: brak sekretu VAPID_PRIVATE_KEY w Edge Functions");
  } else if (!/^(mailto:|https:\/\/)/.test(vapidSubject)) {
    errors.push(`web: VAPID_SUBJECT musi zaczynać się od mailto: lub https:// (jest "${vapidSubject}")`);
  } else {
    try {
      const vapidKeys = await importVapidKeys(vapidPrivateKey);
      const appServer = await webpush.ApplicationServer.new({
        contactInformation: vapidSubject,
        vapidKeys,
      });

      const { data: subs, error: subsError } = await admin
        .from("web_push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .in("profile_id", adminIds);

      if (subsError) errors.push(`web-select: ${subsError.message}`);
      diagnostics.webSubscriptions = subs?.length ?? 0;
      diagnostics.appleEndpoints = (subs ?? []).filter((s: { endpoint: string }) =>
        s.endpoint.includes("web.push.apple.com"),
      ).length;

      const payload = JSON.stringify({
        title,
        body: bodyText,
        data: { buildId, date, url: "/" },
      });

      const staleIds: number[] = [];
      await Promise.all(
        (subs ?? []).map(
          async (s: { id: number; endpoint: string; p256dh: string; auth: string }) => {
            try {
              const subscriber = appServer.subscribe({
                endpoint: s.endpoint,
                keys: { p256dh: s.p256dh, auth: s.auth },
              });
              await subscriber.pushTextMessage(payload, {});
              sentWeb += 1;
            } catch (err: unknown) {
              // 404/410 = subskrypcja martwa (odinstalowana PWA,
              // wyczyszczone dane) — sprzątamy.
              if (err instanceof webpush.PushMessageError && err.isGone()) {
                staleIds.push(s.id);
                return;
              }
              // KAŻDY inny błąd (400 BadJwtToken, 403 zły VAPID, 413 za
              // duży payload) musi być widoczny, a nie połknięty.
              const status = (err as { response?: { status?: number } })?.response?.status;
              errors.push(
                `web-send[${s.endpoint.slice(0, 45)}…] ${status ?? "?"}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }
          },
        ),
      );

      if (staleIds.length) {
        await admin.from("web_push_subscriptions").delete().in("id", staleIds);
        diagnostics.removedStale = staleIds.length;
      }
    } catch (err) {
      errors.push(`web-init: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Nieudana wysyłka pushy NIGDY nie może zepsuć samego zapisu raportu —
  // stąd zawsze 200, błędy tylko informacyjnie w odpowiedzi.
  return json({
    sentExpo,
    sentWeb,
    errors: errors.length ? errors : undefined,
    diagnostics: debug ? diagnostics : undefined,
  });
});
