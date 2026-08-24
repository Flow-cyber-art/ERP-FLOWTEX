import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { Button, COLORS } from "@/components/report-ui";
import {
  listBuildPhotos,
  uploadBuildPhoto,
  type BuildPhotoRow,
} from "@/lib/data/drive-photos";

// Dołączanie i przeglądanie zdjęć budowy — w całości w apce, bez
// przechodzenia do Google Drive/logowania Gmailem. Współdzielone przez
// builds-screen.tsx (Admin) i report-screen.tsx (Brygadzista, raport
// dzienny) — ten sam formularz, ta sama galeria miniatur w obu miejscach.
//
// Dlaczego galeria w ogóle: konta ludzi w apce logują się przez Supabase
// Auth, nie mają (i nie muszą mieć) dostępu do Shared Drive konta
// serwisowego — link "Otwórz folder" wymaga osobnego logowania Gmailem i
// prośby o dostęp, na którą nikt nie odpowie (konto serwisowe to nie
// osoba). Miniatury (thumbnailUrl, drive-photos edge function nadaje im
// "anyone with the link: reader") pozwalają oglądać zdjęcia wprost w
// apce — Drive zostaje czystym magazynem plików w tle, nie czymś, do
// czego trzeba wchodzić na co dzień.
export function BuildPhotosSection({
  buildId,
  hasDriveFolder,
}: {
  buildId: number;
  hasDriveFolder: boolean;
}) {
  const [photos, setPhotos] = useState<BuildPhotoRow[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    listBuildPhotos(buildId)
      .then(setPhotos)
      .catch((err) => setError(err instanceof Error ? err.message : "Błąd wczytywania zdjęć."));
  };

  useEffect(reload, [buildId]);

  const uploadPickedPhotos = async (assets: ImagePicker.ImagePickerAsset[]) => {
    if (assets.length === 0) return;
    setError(null);
    setUploading(true);
    setProgress({ done: 0, total: assets.length });
    try {
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        if (!asset.base64) continue;
        const fileName = asset.fileName || `zdjecie-${Date.now()}-${i}.jpg`;
        const mimeType = asset.mimeType || "image/jpeg";
        await uploadBuildPhoto(buildId, fileName, mimeType, asset.base64);
        setProgress({ done: i + 1, total: assets.length });
      }
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się wysłać zdjęcia.");
    } finally {
      setUploading(false);
    }
  };

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Brak zgody na dostęp do galerii.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled) await uploadPickedPhotos(result.assets);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Brak zgody na dostęp do aparatu.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true });
    if (!result.canceled) await uploadPickedPhotos(result.assets);
  };

  if (!hasDriveFolder) {
    return (
      <Text style={{ color: COLORS.muted, fontSize: 12 }}>
        Ta budowa nie ma jeszcze katalogu na zdjęcia.
      </Text>
    );
  }

  return (
    <View>
      {uploading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={{ color: COLORS.muted, fontSize: 12 }}>
            Wysyłanie zdjęć{progress ? ` (${progress.done}/${progress.total})` : "…"}
          </Text>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button label="📷 Zrób zdjęcie" secondary onPress={takePhoto} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="🖼 Dołącz z galerii" secondary onPress={pickFromLibrary} />
          </View>
        </View>
      )}
      {error && (
        <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 8 }}>{error}</Text>
      )}

      {photos && photos.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {photos.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => Linking.openURL(p.driveFileUrl)}
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 10,
                  overflow: "hidden",
                  backgroundColor: COLORS.background,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                }}
              >
                {p.thumbnailUrl ? (
                  <Image
                    source={{ uri: p.thumbnailUrl }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 22 }}>🖼</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
