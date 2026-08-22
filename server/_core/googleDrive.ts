import type { Express, Request, Response } from "express";
import { SignJWT, importPKCS8 } from "jose";
import { ENV } from "./env";
import { sdk } from "./sdk";

/**
 * Automatyczny podfolder ze zdjęciami w Google Drive dla każdej nowej
 * budowy — nazwany tak samo jak budowa, tworzony wewnątrz jednego,
 * skonfigurowanego folderu nadrzędnego (GOOGLE_DRIVE_PARENT_FOLDER_ID).
 *
 * Uwierzytelnianie do Drive API: konto serwisowe Google (service
 * account), bo to serwer, nie użytkownik, tworzy folder — standardowy
 * flow OAuth2 "JWT Bearer" (RFC 7523): podpisujemy krótkotrwały JWT
 * kluczem prywatnym konta serwisowego, wymieniamy go na access token w
 * Google, i tym tokenem wołamy Drive API v3.
 *
 * WYMAGA jednorazowej konfiguracji w Google Cloud Console (patrz
 * SUPABASE_SETUP.md — mimo nazwy pliku, ta sekcja jest o Drive, nie
 * Supabase): włączonego Drive API, konta serwisowego z kluczem JSON,
 * i udostępnienia docelowego folderu temu kontu jako edytor. Folder
 * nadrzędny MUSI być Dyskiem współdzielonym (Shared Drive) — konto
 * serwisowe nie ma własnego limitu miejsca, więc tworzenie plików w
 * zwykłym "Mój dysk" (nawet udostępnionym) kończy się błędem kwoty.
 */

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }
  if (
    !ENV.googleDriveServiceAccountEmail ||
    !ENV.googleDriveServiceAccountPrivateKey
  ) {
    throw new Error(
      "Brak konfiguracji konta serwisowego Google Drive (GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL / GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY).",
    );
  }

  // Klucz prywatny w env var trzyma znaki nowej linii jako dosłowne "\n"
  // (bo env vary są jednoliniowe) — trzeba je odtworzyć przed importem PEM.
  const privateKey = await importPKCS8(
    ENV.googleDriveServiceAccountPrivateKey.replace(/\\n/g, "\n"),
    "RS256",
  );

  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: DRIVE_SCOPE })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(ENV.googleDriveServiceAccountEmail)
    .setSubject(ENV.googleDriveServiceAccountEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text().catch(() => "");
    throw new Error(
      `Nie udało się uzyskać tokenu Google (status ${tokenResponse.status}): ${body}`,
    );
  }

  const data = (await tokenResponse.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

export function registerGoogleDriveRoutes(app: Express) {
  app.post(
    "/api/drive/create-build-folder",
    async (req: Request, res: Response) => {
      try {
        await sdk.authenticateRequest(req);
      } catch {
        res.status(401).json({ error: "Wymagane zalogowanie." });
        return;
      }

      const name =
        typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name) {
        res.status(400).json({ error: "Brak nazwy budowy." });
        return;
      }
      if (!ENV.googleDriveParentFolderId) {
        res
          .status(500)
          .json({ error: "Brak GOOGLE_DRIVE_PARENT_FOLDER_ID w konfiguracji serwera." });
        return;
      }

      try {
        const accessToken = await getAccessToken();
        const createResponse = await fetch(
          `${DRIVE_FILES_URL}?supportsAllDrives=true&fields=id,webViewLink`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name,
              mimeType: "application/vnd.google-apps.folder",
              parents: [ENV.googleDriveParentFolderId],
            }),
          },
        );

        if (!createResponse.ok) {
          const body = await createResponse.text().catch(() => "");
          console.error(
            `[GoogleDrive] create folder failed: ${createResponse.status} ${body}`,
          );
          res
            .status(502)
            .json({ error: "Nie udało się utworzyć folderu w Google Drive." });
          return;
        }

        const folder = (await createResponse.json()) as {
          id: string;
          webViewLink: string;
        };
        res.json({ id: folder.id, webViewLink: folder.webViewLink });
      } catch (error) {
        console.error("[GoogleDrive] create-build-folder error:", error);
        res.status(500).json({
          error: error instanceof Error ? error.message : "Nieznany błąd.",
        });
      }
    },
  );
}
