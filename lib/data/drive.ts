import { apiCall } from "@/lib/_core/api";

/**
 * Tworzy w Google Drive nowy podfolder (nazwany jak budowa) wewnątrz
 * skonfigurowanego folderu nadrzędnego — patrz
 * server/_core/googleDrive.ts. Jedyna operacja w apce, która wciąż
 * idzie przez serwer Express (a nie bezpośrednio do Supabase): klucz
 * konta serwisowego Google musi zostać po stronie serwera, nigdy w
 * buncie klienta.
 */
export async function createBuildDriveFolder(
  buildName: string,
): Promise<{ id: string; webViewLink: string }> {
  return apiCall<{ id: string; webViewLink: string }>(
    "/api/drive/create-build-folder",
    {
      method: "POST",
      body: JSON.stringify({ name: buildName }),
    },
  );
}
