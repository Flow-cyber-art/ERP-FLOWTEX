import { lazy, Suspense } from "react";
import { ActivityIndicator, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { COLORS } from "@/components/report-ui";
import { AuthGate } from "@/components/auth-gate";

/**
 * /oferta — Wizard Ofert, Faza 0 (pilotaż). Trasa samodzielna (jak
 * app/portal/[token].tsx), NIE zagnieżdżona pod app/(tabs)/index.tsx —
 * więc celowo NIE korzysta z AppDataProvider/useAppData() (ten kontekst
 * żyje tylko wewnątrz (tabs)/index.tsx). Dane wizardu ładują się
 * niezależnie, przez lib/data/offers.ts — dokładnie tak samo jak
 * TechnologiesScreen ładuje własną listę technologii bez kontekstu.
 *
 * Zalogowanie wymagane (AuthGate, jak w (tabs)/index.tsx) — w
 * przeciwieństwie do portal/[token].tsx to NIE jest publiczna wizytówka
 * dla klienta, tylko wewnętrzne narzędzie do składania oferty.
 */
const OfertaScreen = lazy(() =>
  import("@/components/screens/oferta-screen").then((m) => ({
    default: m.OfertaScreen,
  })),
);

export default function OfertaRoute() {
  return (
    <ScreenContainer>
      <AuthGate>
        {(profile) => (
          <Suspense
            fallback={
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator color={COLORS.primary} />
              </View>
            }
          >
            <OfertaScreen profile={profile} />
          </Suspense>
        )}
      </AuthGate>
    </ScreenContainer>
  );
}
