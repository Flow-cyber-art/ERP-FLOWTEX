import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { Button, COLORS, notify } from "@/components/report-ui";
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
  showFolderLink = true,
  variant = "default",
  onCountChange,
}: {
  buildId: number;
  driveFolderUrl: string | null;
  // Brygadzista dołącza zdjęcia z poziomu apki i nie ma powodu wychodzić
  // do zewnętrznego folderu (Drive) — link "Otwórz folder ↗" jest tylko
  // dla Admina, patrz report-screen.tsx.
  showFolderLink?: boolean;
  // "admin": hierarchia z panelu administratora — folder Drive jest
  // najczęstszą potrzebą (sprawdzenie już wysłanych zdjęć), więc jest
  // dużą, wyróżnioną kartą na górze; dodanie z galerii i zrobienie zdjęcia
  // to rzadsze, drugorzędne akcje pod spodem. "default" (brygadzista) ma
  // odwrotny scenariusz — najpierw dodaje zdjęcia, nie ma potrzeby
  // wychodzić do Drive — i zostaje bez zmian.
  variant?: "default" | "admin";
  // Łączna liczba zdjęć w folderze — do wyświetlenia w nagłówku sekcji
  // "ZDJĘCIA (n)" w builds-screen.tsx (Admin), poza tym komponentem.
  onCountChange?: (count: number) => void;
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
        onCountChange?.(photos.length);
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
      notify(
        "Zdjęcia wysłane",
        assets.length === 1
          ? "Zdjęcie zostało wysłane."
          : `Wysłano ${assets.length} zdjęć.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Nie udało się wysłać zdjęcia.";
      setError(message);
      notify("Nie udało się wysłać zdjęć", message);
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

  const uploadingIndicator = uploading ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
      <ActivityIndicator color={COLORS.primary} />
      <Text style={{ color: COLORS.muted, fontSize: 12 }}>
        Wysyłanie zdjęć{progress ? ` (${progress.done}/${progress.total})` : "…"}
      </Text>
    </View>
  ) : null;

  if (variant === "admin") {
    // Hierarchia Admina: 1) otwórz to, co już jest na Drive (najczęstsza
    // potrzeba) — duża, wyróżniona karta; 2) dodaj istniejące zdjęcia z
    // galerii; 3) zrób nowe zdjęcie — najrzadsze, więc mała, drugorzędna
    // akcja tekstowa, nie osobny duży przycisk jak pozostałe dwie.
    return (
      <View>
        {showFolderLink && (
          <Pressable
            onPress={openFolder}
            className="bg-background border border-border rounded-2xl items-center"
            style={{ paddingVertical: 22 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 15 }}>📁</Text>
              <Text style={{ color: COLORS.foreground, fontSize: 14, fontWeight: "700" }}>
                Otwórz folder zdjęć ↗
              </Text>
            </View>
            {newCount > 0 && (
              <Text style={{ color: COLORS.primary, fontSize: 12, marginTop: 4 }}>
                {newCount} {newCount === 1 ? "nowe zdjęcie" : "nowych zdjęć"}
              </Text>
            )}
          </Pressable>
        )}
        {uploadingIndicator}
        {!uploading && (
          <>
            <View style={{ marginTop: 12 }}>
              <Button
                label="Dodaj zdjęcia z galerii"
                icon="🖼️"
                secondary
                onPress={pickFromLibrary}
              />
            </View>
            <Pressable
              onPress={takePhoto}
              style={{
                alignSelf: "flex-end",
                marginTop: 12,
                padding: 4,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Text style={{ fontSize: 14 }}>📷</Text>
              <Text style={{ color: COLORS.muted, fontSize: 13, fontWeight: "700" }}>
                Zrób zdjęcie
              </Text>
            </Pressable>
          </>
        )}
        {error && (
          <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 8 }}>{error}</Text>
        )}
      </View>
    );
  }

  return (
    <View>
      {showFolderLink && (
        <Button
          label={newCount > 0 ? `Otwórz folder ↗ · ${newCount} nowe` : "Otwórz folder ↗"}
          secondary
          onPress={openFolder}
        />
      )}
      {uploadingIndicator || (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Zrób zdjęcie" icon="📷" secondary onPress={takePhoto} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Dołącz z galerii" icon="🖼️" secondary onPress={pickFromLibrary} />
          </View>
        </View>
      )}
      {error && (
        <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 8 }}>{error}</Text>
      )}
    </View>
  );
}
