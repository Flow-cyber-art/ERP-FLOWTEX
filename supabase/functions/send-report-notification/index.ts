// Powiadomienie push dla wszystkich Adminów o nowym/zaktualizowanym
// raporcie dziennym — wołane fire-and-forget zaraz po udanym
// `submitDailyReport` (patrz lib/offline-outbox.ts, flushOutbox), żeby
// Admin dowiedział się "na bieżąco", że jest raport do sprawdzenia,
// zamiast odkrywać to dopiero przy następnym otwarciu apki. Notatka dla
// klienta i tak generuje się dopiero PRZY ZATWIERDZENIU (patrz
// 063_portal_klienta_podsumowanie_ai.sql) — to push jest tym, co
// przyspiesza dotarcie do tego momentu.
//
// Bez sekretów zewnętrznych — Expo Push API jest publiczne i nie wymaga
// klucza dla zwykłych (nie-FCM-v1) wysyłek.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy new function ->
// nazwa "send-report-notification" -> wklej ten plik -> Deploy.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Brak nagłówka autoryzacji." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  if (adminIds.length === 0) return json({ sent: 0 });

  const { data: tokenRows } = await admin
    .from("push_tokens")
    .select("token")
    .in("profile_id", adminIds);
  const tokens = [...new Set((tokenRows ?? []).map((r: { token: string }) => r.token))];
  if (tokens.length === 0) return json({ sent: 0 });

  const title = "Nowy raport dzienny";
  const buildLabel = build ? `${build.number} · ${build.name}` : `budowa #${buildId}`;
  const bodyText = `${buildLabel} — ${date}. Sprawdź i zatwierdź, żeby klient zobaczył aktualizację.`;

  const messages = tokens.map((to) => ({
    to,
    title,
    body: bodyText,
    data: { buildId, date },
    sound: "default",
  }));

  try {
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
    return json({ sent: tokens.length });
  } catch (err) {
    // Nieudana wysyłka pushy NIGDY nie może zepsuć samego zapisu raportu
    // (który już się udał, zanim ta funkcja została wywołana) — stąd 200
    // z informacją o błędzie, nie 5xx.
    return json({ sent: 0, error: err instanceof Error ? err.message : String(err) });
  }
});
