import { useEffect, useState } from "react";
import { Dimensions, Platform } from "react-native";

/**
 * Szeroki układ (zwarte listy z kolumnami) — tylko web od 900px, ta sama
 * zasada co isDesktop w app/(tabs)/index.tsx.
 *
 * `mounted` jest false w pierwszym renderze (eksport statyczny i
 * hydratacja), żeby drzewo JSX było identyczne po stronie serwera i
 * klienta (błąd hydratacji React #418); realna szerokość jest
 * stosowana dopiero w useEffect.
 */
export function useWideLayout() {
  const [mounted, setMounted] = useState(false);
  const [width, setWidth] = useState(() => Dimensions.get("window").width);
  useEffect(() => {
    setWidth(Dimensions.get("window").width);
    setMounted(true);
    const sub = Dimensions.addEventListener("change", ({ window }) =>
      setWidth(window.width),
    );
    return () => sub.remove();
  }, []);
  return mounted && Platform.OS === "web" && width >= 900;
}
