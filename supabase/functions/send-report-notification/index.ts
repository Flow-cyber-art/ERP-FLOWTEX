// Powiadomienie push dla wszystkich Adminów o nowym/zaktualizowanym
// raporcie dziennym — wołane fire-and-forget zaraz po udanym
// `submitDailyReport` (patrz lib/offline-outbox.ts, flushOutbox), żeby
// Admin dowiedział się "na bieżąco", że jest raport do sprawdzenia,
// zamiast odkrywać to dopiero przy następnym otwarciu apki. Notatka dla
// klienta i tak generuje się dopiero PRZY ZATWIERDZENIU (patrz
// 063_portal_klienta_podsumowanie_ai.sql) — to push jest tym, co
// przyspiesza dotarcie do tego momentu.
//
// Dwa niezależne kanały, bo Adminowie pracują z telefonów, na które nie
// da się (jeszcze) zbudować natywnej appki bez konta Apple Developer:
//  - Expo Push (push_tokens, 067) — natywny build Android/iOS przez EAS.
//  - Web Push (web_push_subscriptions, 068_web_push_ios_safari.sql) —
//    Safari na iPhonie, appka dodana "Do ekranu głównego" (iOS 16.4+).
// Wysyłamy do obu naraz; kto nie ma subskrypcji w danym kanale, po
// prostu nic stamtąd nie dostanie.
//
// Wymaga (Supabase Dashboard -> Edge Functions -> Secrets) dla kanału
// Web Push:
//   VAPID_PRIVATE_KEY — wygenerowany RAZEM z VAPID_PUBLIC_KEY poniżej
//     (para kluczy web-push.generateVAPIDKeys()) — muszą pasować do
//     siebie, inaczej przeglądarki odrzucą wysyłkę.
//   VAPID_SUBJECT — opcjonalnie, "mailto:ktos@flowtex.pl"; domyślnie
//     "mailto:admin@flowtex.pl" jeśli sekret nie ustawiony.
// Expo Push nie wymaga żadnego sekretu.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy new function ->
// nazwa "send-report-notification" -> wklej ten plik -> Deploy.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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
// Trzymany tu wprost (nie jako sekret) właśnie po to, żeby nie dało się
// go przypadkiem rozjechać z tym po stronie klienta.
const VAPID_PUBLIC_KEY = "BL6QFXgICW6_AXZAPTupcdpjYXE6UjCV_K7fliF5x7cQRGjFWlaCf_1pLI6YgvL_q0Ie4txSBFuX7rLSWi9S5vg";

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
  // Dowolny zalogowany użytkownik może wysłać raport (Brygadzista) — nie
  // wymagamy roli Admin, bo to WŁAŚNIE brygadzista wywołuje tę funkcję po
  // swoim zgłoszeniu.
  if (!user) return json({ error: "Nieprawidłowa sesja." }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Nieprawidłowe body żądania." }, 400);
  }
  const buildId = Number(body.buildId);
  const date = typeof body.date === "string" ? body.date : null;
  if (!buildId || !date) return json({ error: "Brak buildId lub date." }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: build } = await admin
    .from("builds")
    .select("name, number")
    .eq("id", buildId)
    .maybeSingle();

  const { data: adminProfiles } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "Admin");
  const adminIds = (adminProfiles ?? []).map((p: { id: string }) => p.id);
  if (adminIds.length === 0) return json({ sentExpo: 0, sentWeb: 0 });

  const title = "Nowy raport dzienny";
  const buildLabel = build ? `${build.number} · ${build.name}` : `budowa #${buildId}`;
  const bodyText = `${buildLabel} — ${date}. Sprawdź i zatwierdź, żeby klient zobaczył aktualizację.`;

  let sentExpo = 0;
  let sentWeb = 0;
  const errors: string[] = [];

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
    // Expo Push API przyjmuje maks. 100 wiadomości na request.
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
    }
    sentExpo = tokens.length;
  } catch (err) {
    errors.push(`expo: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- Kanał 2: Web Push (Safari na iPhonie) ---
  if (vapidPrivateKey) {
    try {
      webpush.setVapidDetails(vapidSubject, VAPID_PUBLIC_KEY, vapidPrivateKey);
      const { data: subs } = await admin
        .from("web_push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .in("profile_id", adminIds);
      const payload = JSON.stringify({ title, body: bodyText, data: { buildId, date } });
      const staleIds: number[] = [];
      await Promise.all(
        (subs ?? []).map(async (s: { id: number; endpoint: string; p256dh: string; auth: string }) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              payload,
            );
            sentWeb += 1;
          } catch (err: unknown) {
            // 404/410 = subskrypcja martwa (użytkownik odinstalował PWA,
            // wyczyścił dane przeglądarki) — sprzątamy, żeby nie próbować
            // w nieskończoność za każdym kolejnym raportem.
            const status = (err as { statusCode?: number })?.statusCode;
            if (status === 404 || status === 410) staleIds.push(s.id);
          }
        }),
      );
      if (staleIds.length) {
        await admin.from("web_push_subscriptions").delete().in("id", staleIds);
      }
    } catch (err) {
      errors.push(`web: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Nieudana wysyłka pushy NIGDY nie może zepsuć samego zapisu raportu
  // (który już się udał, zanim ta funkcja została wywołana) — stąd
  // zawsze 200, błędy tylko informacyjnie w odpowiedzi.
  return json({ sentExpo, sentWeb, errors: errors.length ? errors : undefined });
});
