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

const MIN_PASSWORD_LENGTH = 10;

// Super administrator — konto z tabeli `superadmins` (patrz
// supabase/sql/105_superadmin.sql), rozpoznawane po id konta, NIE po adresie
// e-mail (zmiana adresu nie gubi uprawnień ani ochrony).
//   - Super admin widzi i zarządza WSZYSTKIMI kontami logowania: także
//     kontami bez profilu / bez powiązania z pracownikiem, innymi Adminami,
//     może dodawać, usuwać, zmieniać hasła, e-maile, role i powiązania.
//   - Zwykły Admin nie widzi kont super adminów i nie może ich w żaden sposób
//     zmienić (hasło, e-mail, rola, usunięcie).
//   - Konta super admina nie da się usunąć ani pozbawić roli Admin przez tę
//     funkcję (żeby nikt nie odciął sobie dostępu); odebranie roli tylko ręcznie
//     w SQL Editorze (delete from superadmins ...).
async function isSuperAdminId(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("superadmins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
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
  const callerIsSuper = await isSuperAdminId(admin, user.id);
  if (callerProfile?.role !== "Admin" && !callerIsSuper) {
    return json({ error: "Wymagana rola Admin." }, 403);
  }

  // Zwykły Admin nie może ruszać kont super adminów (hasło, e-mail, rola,
  // nazwa, usunięcie) — super admin tak, z wyjątkami opisanymi wyżej.
  const forbidSuperTarget = async (targetId: string) =>
    !callerIsSuper && (await isSuperAdminId(admin, targetId));

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
    const { data: supers } = await admin.from("superadmins").select("user_id");
    const superIds = new Set((supers ?? []).map((r) => r.user_id as string));
    const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

    if (callerIsSuper) {
      // Wszystkie konta z auth.users — także bez profilu ("sieroty") i bez
      // powiązania z pracownikiem, oraz sam super admin.
      const users = page.users.map((u) => {
        const p = profileById.get(u.id);
        return {
          id: u.id,
          role: p?.role ?? null,
          employeeId: p?.employeeId ?? null,
          email: u.email ?? null,
          hasProfile: !!p,
          isSuperAdmin: superIds.has(u.id),
        };
      });
      return json({ users, callerIsSuperAdmin: true });
    }

    const emailById = new Map(page.users.map((u) => [u.id, u.email ?? null]));
    const users = (profiles ?? [])
      // Konta super adminów są niewidoczne dla zwykłych Adminów.
      .filter((p) => !superIds.has(p.id as string))
      .map((p) => ({
        id: p.id,
        role: p.role,
        employeeId: p.employeeId,
        email: emailById.get(p.id) ?? null,
        hasProfile: true,
        isSuperAdmin: false,
      }));
    return json({ users, callerIsSuperAdmin: false });
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
    // Hasła konta super administratora nie zmienia zwykły Admin. Super admin
    // może ustawić hasło każdemu (także sobie).
    if (await forbidSuperTarget(userId)) {
      return json({ error: "Brak uprawnień do zmiany hasła tego konta." }, 403);
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "setEmail") {
    const userId = String(body.userId ?? "");
    const email = String(body.email ?? "").trim();
    if (!userId || !email) return json({ error: "Wymagany userId i email." }, 400);
    if (await forbidSuperTarget(userId)) {
      return json({ error: "Brak uprawnień do zmiany e-maila tego konta." }, 403);
    }
    const { error } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "setDisplayName") {
    // Nazwa wyświetlana konta logowania — ustawiana WYŁĄCZNIE przez
    // Admina (patrz components/screens/admin-screen.tsx, karta
    // pracownika w Zespole), synchronizowana z employees.name. Osobne
    // konto NIE edytuje już tego pola samo sobie (dawne
    // updateMyDisplayName w Ustawieniach zostało usunięte z UI) — to pole
    // trafia m.in. do etykiety osoby wgrywającej zdjęcia (drive-photos).
    const userId = String(body.userId ?? "");
    const displayName = String(body.displayName ?? "").trim();
    if (!userId || !displayName) {
      return json({ error: "Wymagany userId i nazwa." }, 400);
    }
    if (await forbidSuperTarget(userId)) {
      return json({ error: "Brak uprawnień do zmiany tego konta." }, 403);
    }
    const { error } = await admin.auth.admin.updateUserById(userId, {
      user_metadata: { full_name: displayName },
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "setRole") {
    const userId = String(body.userId ?? "");
    const role = body.role;
    const employeeId = body.employeeId ? Number(body.employeeId) : null;
    if (!userId || !role) return json({ error: "Wymagany userId i rola." }, 400);
    if (await forbidSuperTarget(userId)) {
      return json({ error: "Brak uprawnień do zmiany tego konta." }, 403);
    }
    if (role !== "Admin" && (await isSuperAdminId(admin, userId))) {
      return json(
        { error: "Nie można odebrać roli Admin kontu super administratora." },
        400,
      );
    }
    // Super admin może też nadać profil kontu, które go nie ma (konto
    // "sierota" w auth.users) — zwykły Admin tylko aktualizuje istniejący.
    const { error } = callerIsSuper
      ? await admin.from("profiles").upsert({ id: userId, role, employeeId })
      : await admin.from("profiles").update({ role, employeeId }).eq("id", userId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "delete") {
    const userId = String(body.userId ?? "");
    if (!userId) return json({ error: "Wymagany userId." }, 400);
    if (userId === user.id) {
      return json({ error: "Nie można usunąć własnego konta." }, 400);
    }
    if (await isSuperAdminId(admin, userId)) {
      return json({ error: "Nie można usunąć konta super administratora." }, 400);
    }
    await admin.from("profiles").delete().eq("id", userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Nieznana akcja." }, 400);
});
