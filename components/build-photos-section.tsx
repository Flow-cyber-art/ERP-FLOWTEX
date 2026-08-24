import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import { Button, COLORS } from "@/components/report-ui";
import { listBuildPhotos, uploadBuildPhoto } from "@/lib/data/drive-photos";

const lastSeenKey = (buildId: number) => `build-photos-last-seen:${buildId}`;

// Dołączanie zdjęć budowy — w całości w apce, bez logowania do Google
// Drive (aparat/galeria → auto-upload). Współdzielone przez
// builds-screen.tsx (Admin) i report-screen.tsx (Brygadzista).
//
// Świadomie BEZ miniatur/galerii w apce: Drive i tak zawsze pokazuje
// wszystko poprawnie po otwarciu linku, więc nie ma sensu dublować tego
// w środku apki. Jedyne, czego brakowało bez tego, to wiedza "czy jest
// coś nowego, zanim w ogóle otworzę Drive" — stąd licznik nowych zdjęć
// (per urządzenie, w AsyncStorage: kiedy ostatnio KTOŚ NA TYM URZĄDZENIU
// kliknął "Otwórz folder"), zerowany przy kliknięciu linku.
export function BuildPhotosSection({
  buildId,
  driveFolderUrl,
}: {
  buildId: number;
  driveFolderUrl: string | null;
}) {
  const [newCount, setNewCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshNewCount = () => {
    Promise.all([listBuildPhotos(buildId), AsyncStorage.getItem(lastSeenKey(buildId))])
      .then(([photos, lastSeen]) => {
        const lastSeenAt = lastSeen ? new Date(lastSeen).getTime() : 0;
        setNewCount(photos.filter((p) => new Date(p.createdAt).getTime() > lastSeenAt).length);
      })
      .catch(() => {
        // Cichy fallback — licznik "nowych" to tylko wygoda, nie krytyczna
        // informacja, nie ma sensu straszyć błędem przy samym wejściu.
      });
  };

  useEffect(refreshNewCount, [buildId]);

  const openFolder = async () => {
    if (!driveFolderUrl) return;
    // Zapis MUSI się dokończyć przed nawigacją — na webie Linking.openURL
    // potrafi przenieść całą stronę, a AsyncStorage (na webie de facto
    // IndexedDB) jest asynchroniczny; bez await-a nawigacja czasem
    // przerywała zapis w połowie, więc po powrocie licznik pokazywał
    // starą wartość, mimo że setNewCount(0) lokalnie zadziałało (ale przy
    // pełnym przeładowaniu strony ten lokalny stan i tak ginie).
    setNewCount(0);
    await AsyncStorage.setItem(lastSeenKey(buildId), new Date().toISOString());
    Linking.openURL(driveFolderUrl);
  };

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
      refreshNewCount();
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

  if (!driveFolderUrl) {
    return (
      <Text style={{ color: COLORS.muted, fontSize: 12 }}>
        Ta budowa nie ma jeszcze katalogu na zdjęcia.
      </Text>
    );
  }

  return (
    <View>
      <Button
        label={newCount > 0 ? `Otwórz folder ↗ · ${newCount} nowe` : "Otwórz folder ↗"}
        secondary
        onPress={openFolder}
      />
      {uploading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={{ color: COLORS.muted, fontSize: 12 }}>
            Wysyłanie zdjęć{progress ? ` (${progress.done}/${progress.total})` : "…"}
          </Text>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
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
    </View>
  );
}
