import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps } from "react";
import type { StyleProp, TextStyle } from "react-native";

/**
 * Jedyny zestaw ikon aplikacji: Feather (cienkie, liniowe, jednolita
 * grubość kreski). Zamiast emoji i znaków tekstowych (▼ ⚠ 🔍 ✓ …), które
 * wyglądały jak z różnych zestawów. Nazwy: https://feathericons.com
 */
export type IconName = ComponentProps<typeof Feather>["name"];

export function Icon({
  name,
  size = 18,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color: string;
  style?: StyleProp<TextStyle>;
}) {
  return <Feather name={name} size={size} color={color} style={style} />;
}
