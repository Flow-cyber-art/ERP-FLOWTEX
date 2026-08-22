import Svg, { Path } from "react-native-svg";

import { COLORS } from "@/components/report-ui";

// Znak graficzny FLOWTEX Polska — trzy warstwy nawiązujące do przekroju
// posadzki. Źródło: dostarczony przez firmę logo-mark.svg (viewBox 24x24),
// przerysowany tu jako react-native-svg, żeby działał identycznie na
// web/iOS/Android i dziedziczył kolor z motywu (COLORS.primary) zamiast
// mieć go zaszytego na sztywno.
export function LogoMark({ size = 22, color = COLORS.primary }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <Path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <Path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </Svg>
  );
}
