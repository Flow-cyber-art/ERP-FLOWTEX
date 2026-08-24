import { supabase } from "@/lib/supabase";

/**
 * Klient dla Edge Function `drive-photos` (Google Drive: katalog budowy +
 * upload zdjęć) — patrz supabase/functions/drive-photos/index.ts. Cała
 * rozmowa z Google Drive (i klucz konta serwisowego) żyje wyłącznie w tej
 * funkcji, nigdy w apce — ten plik tylko ją woła, tak jak
 * lib/data/admin-users.ts woła admin-users.
 */

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("drive-photos", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export async function createBuildDriveFolder(
  buildId: number,
): Promise<{ folderId: string; url: string }> {
  return invoke({ action: "createBuildFolder", buildId });
}

export async function uploadBuildPhoto(
  buildId: number,
  fileName: string,
  mimeType: string,
  base64Data: string,
): Promise<{ fileId: string; url: string }> {
  return invoke({ action: "uploadPhoto", buildId, fileName, mimeType, base64Data });
}

export type BuildPhotoRow = {
  id: number;
  createdAt: string;
};

// Czytane wprost z Supabase (RLS: select dla każdego zalogowanego, patrz
// 021_google_drive_zdjecia.sql) — bez wołania edge function, to zwykły
// odczyt tabeli. Używane tylko do policzenia "ile nowych zdjęć od
// ostatniego otwarcia folderu" (build-photos-section.tsx) — samych zdjęć
// apka nie wyświetla, Google Drive i tak zawsze pokazuje wszystko
// poprawnie po otwarciu linku.
export async function listBuildPhotos(buildId: number): Promise<BuildPhotoRow[]> {
  const { data, error } = await supabase
    .from("build_photos")
    .select("id, createdAt")
    .eq("buildId", buildId)
    .order("createdAt", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BuildPhotoRow[];
}
