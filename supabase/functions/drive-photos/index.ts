// Katalogi ze zdjęciami budowy na Google Drive — Admin tworzy folder
// budowy jednym przyciskiem, Brygadzista wrzuca zdjęcia z raportu
// dziennego do podfolderu {data}_{jego nazwa}. Ten sam powód co
// admin-users/index.ts: klucz konta serwisowego Google (Drive API) nigdy
// nie może trafić do apki klienckiej, więc cała rozmowa z Google idzie
// przez tę Edge Function — klient tylko ją woła.
//
// Wymaga (Supabase Dashboard -> Edge Functions -> Secrets):
//   GOOGLE_SERVICE_ACCOUNT_JSON — cała treść klucza JSON konta
//     serwisowego (Google Cloud Console -> IAM -> Service Accounts ->
//     Keys -> Add key -> JSON).
//   GOOGLE_DRIVE_ROOT_ID — ID Shared Drive (albo folderu na nim), w
//     którym mają powstawać foldery budów. Konto serwisowe musi być
//     dodane do tego Shared Drive jako Content Manager/Manager — bez
//     Shared Drive zwykłe, prywatne konto Google service account NIE MA
//     własnego miejsca na dysku (0 GB kwoty), więc upload zawsze zwróci
//     błąd "storageQuotaExceeded".
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy new function ->
// nazwa "drive-photos" -> wklej ten plik -> Deploy. Patrz
// GOOGLE_DRIVE_SETUP.md po pełną instrukcję konfiguracji Google.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5";

// Wywoływane też z web (Vercel), nie tylko z aplikacji natywnej — bez tych
// nagłówków przeglądarka blokuje request na etapie CORS preflight (OPTIONS),
// zanim ciało funkcji w ogóle się wykona (stąd błąd widoczny w konsoli, nie
// w logach Edge Function). "*" jest bezpieczne tutaj: funkcja i tak wymaga
// ważnego JWT-a w Authorization, więc origin sam w sobie niczego nie
// autoryzuje.
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

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

// Token OAuth2 konta serwisowego (JWT Bearer flow) — ważny 1h, nie ma
// sensu go cache'ować między wywołaniami Edge Function (każde wywołanie
// to osobna, krótkotrwała instancja), więc generujemy od nowa za każdym
// razem. Koszt: jedno dodatkowe round-tripowe wywołanie do Google na
// każdą akcję — zaniedbywalne wobec samego uploadu zdjęcia.
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/drive",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google OAuth: ${data.error_description ?? data.error ?? res.status}`);
  }
  return data.access_token as string;
}

async function driveFetch(accessToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Drive API: ${data.error?.message ?? res.status}`);
  }
  return data;
}

// Szuka folderu o danej nazwie wewnątrz `parentId` (Shared Drive-świadome
// zapytanie); tworzy go, jeśli nie istnieje. Używane zarówno pod folder
// budowy (parent = root Shared Drive), jak i podfolder {data}_{osoba}
// (parent = folder budowy) — ta sama logika find-or-create w obu miejscach.
async function findOrCreateFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<{ id: string; webViewLink: string }> {
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents ` +
      `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const list = await driveFetch(
    accessToken,
    `/drive/v3/files?q=${q}&fields=files(id,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`,
  );
  if (list.files?.length > 0) {
    return { id: list.files[0].id, webViewLink: list.files[0].webViewLink };
  }
  const created = await driveFetch(
    accessToken,
    "/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    },
  );
  // "Anyone with the link: reader" — bez tego otwarcie linku wymaga
  // logowania na konto realnie dodane do Shared Drive, a jedyne takie
  // konto to konto serwisowe (nie jest osobą, nie odpowie na prośbę o
  // dostęp). Nadajemy tylko przy TWORZENIU (nie przy każdym znalezieniu
  // istniejącego folderu) — jedno wywołanie API na cały cykl życia folderu.
  try {
    await driveFetch(accessToken, `/drive/v3/files/${created.id}/permissions?supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "anyone", role: "reader" }),
    });
  } catch {
    // Niekrytyczne — folder i tak istnieje, tylko podgląd może wymagać
    // logowania. Nie przerywamy z tego powodu.
  }
  return created;
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
  const rootFolderId = Deno.env.get("GOOGLE_DRIVE_ROOT_ID");
  const saJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!rootFolderId || !saJson) {
    return json(
      { error: "Integracja z Google Drive nie jest skonfigurowana (brak sekretów Edge Function)." },
      500,
    );
  }
  const serviceAccount = JSON.parse(saJson) as ServiceAccount;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) return json({ error: "Nieprawidłowa sesja." }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: callerProfile } = await admin
    .from("profiles")
    .select('role, "employeeId"')
    .eq("id", user.id)
    .maybeSingle();
  if (!callerProfile) return json({ error: "Brak profilu użytkownika." }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Nieprawidłowe body żądania." }, 400);
  }
  const action = body.action;

  // ------------------------------------------------------------
  // createBuildFolder — tylko Admin. Tworzy folder budowy wprost pod
  // rootFolderId (Shared Drive) i zapisuje jego id + link w builds.
  // ------------------------------------------------------------
  if (action === "createBuildFolder") {
    if (callerProfile.role !== "Admin") {
      return json({ error: "Wymagana rola Admin." }, 403);
    }
    const buildId = Number(body.buildId);
    if (!buildId) return json({ error: "Brak buildId." }, 400);

    const { data: build, error: buildError } = await admin
      .from("builds")
      .select('id, number, name, "driveFolderId":drive_folder_id')
      .eq("id", buildId)
      .maybeSingle();
    if (buildError || !build) return json({ error: "Nie znaleziono budowy." }, 404);
    if (build.driveFolderId) {
      return json({ error: "Ta budowa ma już katalog na zdjęcia." }, 409);
    }

    try {
      const accessToken = await getAccessToken(serviceAccount);
      const folder = await findOrCreateFolder(
        accessToken,
        `${build.number} - ${build.name}`,
        rootFolderId,
      );
      await admin
        .from("builds")
        .update({ drive_folder_id: folder.id, photosUrl: folder.webViewLink })
        .eq("id", buildId);
      return json({ folderId: folder.id, url: folder.webViewLink });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  // ------------------------------------------------------------
  // uploadPhoto — Admin lub Brygadzista. Wrzuca jedno zdjęcie (base64) do
  // podfolderu {dzisiejsza data}_{nazwa wywołującego} w folderze budowy,
  // tworząc ten podfolder przy pierwszym zdjęciu danego dnia/osoby.
  // ------------------------------------------------------------
  if (action === "uploadPhoto") {
    if (!["Admin", "Brygadzista"].includes(callerProfile.role)) {
      return json({ error: "Brak uprawnień." }, 403);
    }
    const buildId = Number(body.buildId);
    const fileName = String(body.fileName ?? "zdjecie.jpg");
    const mimeType = String(body.mimeType ?? "image/jpeg");
    const base64Data = String(body.base64Data ?? "");
    if (!buildId || !base64Data) {
      return json({ error: "Brak buildId lub danych zdjęcia." }, 400);
    }

    const { data: build, error: buildError } = await admin
      .from("builds")
      .select('id, "driveFolderId":drive_folder_id')
      .eq("id", buildId)
      .maybeSingle();
    if (buildError || !build) return json({ error: "Nie znaleziono budowy." }, 404);
    if (!build.driveFolderId) {
      return json(
        { error: "Ta budowa nie ma jeszcze katalogu na zdjęcia — poproś Admina o jego utworzenie." },
        409,
      );
    }

    let uploaderName = user.email ?? "użytkownik";
    if (callerProfile.employeeId) {
      const { data: employee } = await admin
        .from("employees")
        .select("name")
        .eq("id", callerProfile.employeeId)
        .maybeSingle();
      if (employee?.name) uploaderName = employee.name;
    }
    const today = new Date().toISOString().slice(0, 10);
    const subfolderName = `${today}_${uploaderName}`.replace(/[\\/]/g, "-");

    try {
      const accessToken = await getAccessToken(serviceAccount);
      const subfolder = await findOrCreateFolder(accessToken, subfolderName, build.driveFolderId);

      const boundary = crypto.randomUUID();
      const metadata = { name: fileName, parents: [subfolder.id] };
      const bodyParts =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        `${base64Data}\r\n` +
        `--${boundary}--`;

      const uploaded = await driveFetch(
        accessToken,
        "/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
        {
          method: "POST",
          headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          body: bodyParts,
        },
      );
      // Osobne uprawnienie per plik nie jest potrzebne — folder budowy i
      // każdy jego podfolder dnia/osoby (findOrCreateFolder wyżej) już
      // mają "anyone with the link: reader", a to wystarcza do otwarcia
      // zdjęcia linkiem bez logowania do Gmaila/Drive.

      await admin.from("build_photos").insert({
        buildId,
        uploadedByName: uploaderName,
        driveFileId: uploaded.id,
        driveFileUrl: uploaded.webViewLink,
        driveFolderName: subfolderName,
      });

      return json({ fileId: uploaded.id, url: uploaded.webViewLink });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  return json({ error: "Nieznana akcja." }, 400);
});
