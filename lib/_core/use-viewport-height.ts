import { useEffect } from "react";
import { Platform } from "react-native";

/**
 * STAN CZYSTY — hook celowo NIC NIE USTAWIA.
 *
 * Historia: wczesniejsza wersja wpisywala window.visualViewport.height
 * do zmiennej CSS --app-height. W standalone PWA na Androidzie ta
 * wartosc bywa MNIEJSZA niz ekran (nie liczy obszaru pod paskiem
 * gestow), wiec skracala kontener i sama tworzyla gap — objaw
 * "przy starcie gapu nie ma, po ulamku sekundy jest".
 *
 * Zostaje wylacznie sztuczny event "resize" po mount: react-native-web
 * przelicza wtedy Dimensions, ktore przy statycznym eksporcie potrafia
 * zostac z wartoscia sprzed hydratacji. Zero ustawiania wymiarow,
 * wiec zero ryzyka.
 *
 * Plik istnieje, bo app/_layout.tsx go importuje.
 */
export function useViewportHeight() {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined") return;

    const kick = () => window.dispatchEvent(new Event("resize"));
    const raf = requestAnimationFrame(kick);
    const t = setTimeout(kick, 300);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, []);
}
