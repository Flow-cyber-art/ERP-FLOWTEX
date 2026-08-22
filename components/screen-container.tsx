import { View, type ViewProps } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { cn } from "@/lib/utils";

export interface ScreenContainerProps extends ViewProps {
  /**
   * SafeArea edges to apply. Defaults to ["top", "left", "right"].
   * Bottom is typically handled by Tab Bar.
   */
  edges?: Edge[];
  /**
   * Tailwind className for the content area.
   */
  className?: string;
  /**
   * Additional className for the outer container (background layer).
   */
  containerClassName?: string;
  /**
   * Additional className for the SafeAreaView (content layer).
   */
  safeAreaClassName?: string;
}

/**
 * A container component that properly handles SafeArea and background colors.
 *
 * The outer View extends to full screen (including status bar area) with the
 * background color, while the inner SafeAreaView ensures content is within
 * safe bounds.
 *
 * STAN CZYSTY: wersja bez recznego height:100% na webie (probowalismy,
 * nie pomoglo). Wysokosc plynie wylacznie przez flex.
 */
export function ScreenContainer({
  children,
  edges = ["top", "left", "right"],
  className,
  containerClassName,
  safeAreaClassName,
  style,
  ...props
}: ScreenContainerProps) {
  // minWidth 480 mial sens tylko jako ograniczenie panelu na desktopie.
  // Zastosowany globalnie lamal layout na waskich viewportach mobile-web.
  // Constrainty stosujemy wiec tylko od szerokosci desktopowej (>=1024px)
  // — i przez klase Tailwind (lg:), a NIE przez JS-owe
  // useWindowDimensions(), bo ten po hydratacji statycznego eksportu
  // zwraca nieaktualna wartosc.
  //
  // max-w byl kiedys "60%" (procent szerokosci VIEWPORTU, nie dostepnej
  // przestrzeni po sidebarze) — na typowym desktopie (>=1280px) dawalo to
  // ~256px calkowicie martwej, czarnej przestrzeni PO KAZDEJ stronie
  // (niewidoczne na ciemnym tle, wygladalo jak "tresc przyklejona do
  // lewej + pustka z prawej", a w rzeczywistosci bylo wysrodkowane).
  // Stale 1040px (sidebar 200px wliczony w ten box) daje wyraznie wiecej
  // miejsca na tresc list/kart bez rozciagania sie na cala szerokosc
  // ultrawide monitorow.
  return (
    <View
      className={cn("flex-1", "bg-background", containerClassName)}
      {...props}
    >
      <SafeAreaView
        edges={edges}
        className={cn("flex-1", safeAreaClassName)}
        style={style}
      >
        <View
          className={cn(
            "flex-1 w-full lg:max-w-[1040px] lg:min-w-[480px] lg:self-center",
            className,
          )}
        >
          {children}
        </View>
      </SafeAreaView>
    </View>
  );
}
