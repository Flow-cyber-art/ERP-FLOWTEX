import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Platform } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";
import {
  initManusRuntime,
  subscribeSafeAreaInsets,
} from "@/lib/_core/manus-runtime";
import { registerServiceWorker } from "@/lib/pwa/registerServiceWorker";
import { UpdateAvailableBanner } from "@/components/update-available-banner";
import { useViewportHeight } from "@/lib/_core/use-viewport-height";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;
  // Insety z mostka podglądu Manus (postMessage od kontenera-rodzica
  // wewnątrz iframe'a) — celowo TRZYMANE OSOBNO od zwykłego kontekstu
  // SafeAreaProvider. `null` dopóki żaden komunikat nie przyjdzie.
  //
  // Dlaczego to ważne: mostek (lib/_core/manus-runtime.ts) podpina się
  // WYŁĄCZNIE gdy appka działa w iframe'ie podglądu Manus — na realnym
  // telefonie (zainstalowane jako PWA na ekranie głównym, patrz
  // lib/pwa/*) nikt nigdy nie wyśle "setSafeAreaInsets", więc te insety
  // zostają `null` na zawsze. Wcześniej appka i tak nadpisywała kontekst
  // SafeArea sztywnym zerem na całym webie, przez co notch/pasek na
  // dole telefonu nie były respektowane w prawdziwym PWA. Teraz: jeśli
  // mostek Manusa nic nie przysłał, w ogóle nie nadpisujemy kontekstu —
  // zostaje domyślny SafeAreaProvider, którego web-owa implementacja
  // (react-native-safe-area-context/.../NativeSafeAreaProvider.web.tsx)
  // sama odczytuje prawdziwe `env(safe-area-inset-*)` z przeglądarki.
  const [manusInsets, setManusInsets] = useState<EdgeInsets | null>(null);
  const [manusFrame, setManusFrame] = useState<Rect | null>(null);

  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
  }, []);

  // PWA (web-only): rejestracja service workera dla trybu offline
  // (statyczne assety). Sprawdzanie nowszego builda na serwerze —
  // <UpdateAvailableBanner /> niżej, przez lib/pwa/useVersionCheck.ts.
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // WEB-ONLY: wymusza przeliczenie wysokości viewportu po starcie.
  // Bez tego w standalone PWA layout zostaje z wysokością zapamiętaną
  // przy hydratacji (dolny pasek nawigacji wisi w połowie ekranu)
  // i naprawia się dopiero po obrocie telefonu.
  // Szczegóły: lib/_core/use-viewport-height.ts
  useViewportHeight();

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setManusInsets(metrics.insets);
    setManusFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
          },
        },
      }),
  );
  // Insety startowe dla SafeAreaProvider.
  //
  // WEB: nie zgadujemy. app/+html.tsx ma już `viewport-fit=cover`, więc
  // webowa implementacja SafeAreaProvider odczytuje prawdziwe
  // env(safe-area-inset-*). Poprzednia wersja wymuszała tu bottom >= 12,
  // a dolny pasek nawigacji w app/(tabs)/index.tsx dodawał kolejne 12 px
  // — dolny margines był liczony DWA RAZY.
  //
  // NATIVE: minimum tylko u góry (notch). Dół zostawiamy systemowi, bo
  // inset dolny konsumuje wyłącznie pasek nawigacji z index.tsx.
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? {
      insets: initialInsets,
      frame: initialFrame,
    };

    if (Platform.OS === "web") return metrics;

    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <UpdateAvailableBanner />
        {/* Default to hiding native headers so raw route segments don't appear (e.g. "(tabs)", "products/[id]"). */}
        {/* If a screen needs the native header, explicitly enable it and set a human title via Stack.Screen options. */}
        {/* in order for ios apps tab switching to work properly, use presentation: "fullScreenModal" for login page, whenever you decide to use presentation: "modal*/}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="oauth/callback" />
        </Stack>
        <StatusBar style="auto" />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );

  // Nadpisujemy kontekst SafeArea WYŁĄCZNIE gdy mostek Manusa faktycznie
  // przysłał insety (podgląd w iframe'ie). W przeciwnym razie (m.in.
  // realne, zainstalowane PWA na telefonie) zostawiamy domyślny
  // SafeAreaProvider, który sam poprawnie odczytuje env(safe-area-inset-*).
  if (Platform.OS === "web" && manusInsets) {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider
            value={manusFrame ?? providerInitialMetrics.frame}
          >
            <SafeAreaInsetsContext.Provider value={manusInsets}>
              {content}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>
        {content}
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
