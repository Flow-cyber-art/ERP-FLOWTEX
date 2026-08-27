// Zarządzanie kontami logowania (Supabase Auth) z poziomu panelu Admina.
//
// Dlaczego Edge Function, a nie zapis wprost z klienta: tworzenie konta,
// zmiana/reset hasła i usuwanie konta to operacje na auth.users, które
// wymagają klucza service_role — nigdy nie może on trafić do aplikacji
// klienckiej (anon key owszem, jest jawny, service_role NIE). Ta funkcja
// działa więc jako serwerowy pośrednik: sama trzyma service_role (Supabase
// wstrzykuje go automatycznie jako zmienną środowiskową Edge Function),
// a każde wywołanie najpierw sprawdza, że wywołujący jest zalogowany i ma
// rolę Admin (patrz profiles / assert_role w 003_auth_rls.sql).
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy new function ->
// nazwa "admin-users" -> wklej ten plik -> Deploy. Zmienne SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY są dostępne automatycznie,
// nie trzeba ich ustawiać ręcznie. Patrz SUPABASE_SETUP.md.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Appka wywołuje tę funkcję z przeglądarki (supabase.functions.invoke w
// lib/data/admin-users.ts), a przeglądarka przed właściwym POST-em (który
// niesie nagłówek Authorization) wysyła preflight OPTIONS. Bez poniższych
// nagłówków CORS na OBU odpowiedziach (OPTIONS i właściwej) przeglądarka
// blokuje żądanie, zanim dotrze do reszty kodu — po stronie klienta
// wygląda to jak "Failed to send a request to the Edge Function", bez
// żadnego konkretnego błędu z logiki funkcji.
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

// Konto "głównego" Admina — chronione przed usunięciem i odebraniem roli
// Admin przez TEN endpoint, nawet przez innego Admina. Bez tego zabezpieczenia
// jeden nieostrożny klik w panelu "Konta logowania" (albo czyszczenie bazy
// testowej, patrz scripts/reset-test-data.sql) może zablokować dostęp do
// funkcji administracyjnych na dobre — a jedyną drogą powrotną jest ręczny
// SQL w Supabase Dashboardzie (patrz SUPABASE_SETUP.md, krok 5.2-5.3).
//
// Nadpisywalne zmienną środowiskową Edge Function (Supabase Dashboard ->
// Edge Functions -> admin-users -> Settings -> dodaj sekret
// PROTECTED_ADMIN_EMAIL), żeby nie trzeba było zmieniać kodu przy zmianie
// docelowego adresu głównego admina.
const MIN_PASSWORD_LENGTH = 10;

const PROTECTED_ADMIN_EMAIL = (
  Deno.env.get("PROTECTED_ADMIN_EMAIL") ?? "admin@flowtex.pl"
).trim().toLowerCase();

async function isProtectedAdmin(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) return false;
  return data.user.email.trim().toLowerCase() === PROTECTED_ADMIN_EMAIL;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Brak nagłówka autoryzacji." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Klient "jako wywołujący" — tylko po to, żeby bezpiecznie ustalić, KIM
  // jest wywołujący (auth.getUser weryfikuje podpis JWT).
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) return json({ error: "Nieprawidłowa sesja." }, 401);

  // Klient z pełnymi uprawnieniami (service_role) — do faktycznych operacji.
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (callerProfile?.role !== "Admin") {
    return json({ error: "Wymagana rola Admin." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Nieprawidłowe body żądania." }, 400);
  }
  const action = body.action;

  if (action === "list") {
    const { data: profiles, error } = await admin
      .from("profiles")
      .select('id, role, "employeeId"');
    if (error) return json({ error: error.message }, 400);
    const { data: page, error: listError } = await admin.auth.admin.listUsers({
      perPage: 1000,
    });
    if (listError) return json({ error: listError.message }, 400);
    const emailById = new Map(page.users.map((u) => [u.id, u.email ?? null]));
    const users = (profiles ?? [])
      // Konto głównego Admina jest "super administratorem" — celowo
      // niewidoczne w tej liście, nawet dla innych Adminów (i dla samego
      // siebie, gdy zalogowany jako inne konto). Nie da się go stąd ani
      // zarządzać (patrz ochrony przy setRole/delete/setPassword wyżej),
      // ani nawet zobaczyć, że istnieje.
      .filter((p) => emailById.get(p.id)?.trim().toLowerCase() !== PROTECTED_ADMIN_EMAIL)
      .map((p) => ({
        id: p.id,
        role: p.role,
        employeeId: p.employeeId,
        email: emailById.get(p.id) ?? null,
      }));
    return json({ users });
  }

  if (action === "create") {
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    const role = body.role;
    const employeeId = body.employeeId ? Number(body.employeeId) : null;
    if (!email || password.length < MIN_PASSWORD_LENGTH || !role) {
      return json(
        { error: `Email, hasło (min. ${MIN_PASSWORD_LENGTH} znaków) i rola są wymagane.` },
        400,
      );
    }
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) return json({ error: error.message }, 400);
    const { error: profileError } = await admin
      .from("profiles")
      .insert({ id: created.user.id, role, employeeId });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: profileError.message }, 400);
    }
    return json({ ok: true, id: created.user.id });
  }

  if (action === "setPassword") {
    const userId = String(body.userId ?? "");
    const password = String(body.password ?? "");
    if (!userId || password.length < MIN_PASSWORD_LENGTH) {
      return json(
        { error: `Wymagany userId i hasło (min. ${MIN_PASSWORD_LENGTH} znaków).` },
        400,
      );
    }
    // Hasła głównego konta administratora NIE da się ustawić stąd — nawet
    // sobie samemu. To celowe: panel "Konta logowania" pokazuje listę
    // WSZYSTKICH kont innym Adminom, więc jakiekolwiek pole do zmiany
    // hasła tego konta w tym miejscu to punkt, przez który dowolny inny
    // Admin mógłby je przejąć. Właściciel zmienia własne hasło przez
    // samoobsługę w Ustawieniach (updateMyPassword w lib/data/auth.ts),
    // która działa tylko na koncie, na którym jest aktualnie zalogowany.
    if (await isProtectedAdmin(admin, userId)) {
      return json(
        {
          error:
            "Hasła głównego konta administratora nie można zmienić stąd — użyj samoobsługi w Ustawieniach, zalogowany na tym koncie.",
        },
        400,
      );
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "setRole") {
    const userId = String(body.userId ?? "");
    const role = body.role;
    const employeeId = body.employeeId ? Number(body.employeeId) : null;
    if (!userId || !role) return json({ error: "Wymagany userId i rola." }, 400);
    if (role !== "Admin" && (await isProtectedAdmin(admin, userId))) {
      return json(
        { error: "Nie można odebrać roli Admin głównemu kontu administratora." },
        400,
      );
    }
    const { error } = await admin
      .from("profiles")
      .update({ role, employeeId })
      .eq("id", userId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "delete") {
    const userId = String(body.userId ?? "");
    if (!userId) return json({ error: "Wymagany userId." }, 400);
    if (userId === user.id) {
      return json({ error: "Nie można usunąć własnego konta." }, 400);
    }
    if (await isProtectedAdmin(admin, userId)) {
      return json({ error: "Nie można usunąć głównego konta administratora." }, 400);
    }
    await admin.from("profiles").delete().eq("id", userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Nieznana akcja." }, 400);
});
