import { lazy, Suspense, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { COLORS } from "@/components/report-ui";
import { LogoMark } from "@/components/logo-mark";
import { AppDataProvider, useAppData } from "@/contexts/app-data";
import { AuthGate } from "@/components/auth-gate";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const StartScreen = lazy(() =>
  import("@/components/screens/start-screen").then((m) => ({
    default: m.StartScreen,
  })),
);
const WarehouseScreen = lazy(() =>
  import("@/components/screens/warehouse-screen").then((m) => ({
    default: m.WarehouseScreen,
  })),
);
const BuildsScreen = lazy(() =>
  import("@/components/screens/builds-screen").then((m) => ({
    default: m.BuildsScreen,
  })),
);
const OrdersScreen = lazy(() =>
  import("@/components/screens/orders-screen").then((m) => ({
    default: m.OrdersScreen,
  })),
);
const ManagerScreen = lazy(() =>
  import("@/components/screens/manager-screen").then((m) => ({
    default: m.ManagerScreen,
  })),
);
const AdminScreen = lazy(() =>
  import("@/components/screens/admin-screen").then((m) => ({
    default: m.AdminScreen,
  })),
);
const ReportScreen = lazy(() =>
  import("@/components/screens/report-screen").then((m) => ({
    default: m.ReportScreen,
  })),
);
const TeamTimeScreen = lazy(() =>
  import("@/components/screens/team-time-screen").then((m) => ({
    default: m.TeamTimeScreen,
  }))
);
const SavedReportsScreen = lazy(() =>
  import("@/components/screens/saved-reports-screen").then((m) => ({
    default: m.SavedReportsScreen,
  }))
);
const WorkerScreen = lazy(() =>
  import("@/components/screens/worker-screen").then((m) => ({
    default: m.WorkerScreen,
  })),
);
const TechnologiesScreen = lazy(() =>
  import("@/components/screens/technologies-screen").then((m) => ({
    default: m.TechnologiesScreen,
  })),
);
const SettingsScreen = lazy(() =>
  import("@/components/screens/settings-screen").then((m) => ({
    default: m.SettingsScreen,
  })),
);
const SettlementScreen = lazy(() =>
  import("@/components/screens/settlement-screen").then((m) => ({
    default: m.SettlementScreen,
  })),
);
const LeaveScreen = lazy(() =>
  import("@/components/screens/leave-screen").then((m) => ({
    default: m.LeaveScreen,
  })),
);
const HrPanelScreen = lazy(() =>
  import("@/components/screens/hr-panel-screen").then((m) => ({
    default: m.HrPanelScreen,
  })),
);

function HomeScreenInner() {
  const {
    tab,
    devRole,
    setTab,
    buildsView,
    setBuildsView,
    warehouseView,
    setWarehouseView,
    belowMinimumMaterials,
    orders,
    shortages,
    reportsPendingApprovalCount,
    reportsNeedingFixCount,
  } = useAppData();
  const shortageCount = belowMinimumMaterials.length;
  // Badge Zamówień: zamówienia już zgłoszone ("do realizacji") + braki,
  // które JESZCZE nie mają żadnego zamówienia (status "brak" w
  // orders-screen.tsx — tam samo, żeby liczba na ikonie zgadzała się z
  // tym, co faktycznie widać po wejściu w zakładkę). Bez tego materiał,
  // który dopiero co spadł do zera, nie podświetlał w ogóle Zamówień —
  // widać go było wyłącznie po wejściu w sam ekran.
  const pendingOrdersCount =
    orders.filter((o) => o.status === "do realizacji").length +
    shortages.filter(
      (row) =>
        !orders.some(
          (o) => o.materialId === row.material.id && o.status !== "dostarczone",
        ),
    ).length;
  // Nie używamy useWindowDimensions() bezpośrednio: przy statycznym eksporcie
  // (`expo export -p web`) ten hook potrafi po hydratacji zwrócić nieaktualną
  // wartość i "obudzić się" dopiero po realnym evencie resize (np. otwarcie/
  // zamknięcie DevTools).
  //
  // WAŻNE (fix błędu hydratacji / React #418): Dimensions.get("window").width
  // NIE MOŻE wpływać na pierwszy render. Podczas `expo export -p web` ten
  // pierwszy render dzieje się bez prawdziwego okna przeglądarki, więc
  // Dimensions.get() zwraca tam inną wartość niż realna szerokość w
  // przeglądarce klienta przy hydratacji. isDesktop zależy od tej wartości
  // i zmienia całe drzewo JSX (sidebar vs. pasek dolny, inny zestaw
  // przycisków) — różne drzewa po stronie serwera i klienta = hydration
  // mismatch. Dlatego: `mounted` jest `false` identycznie w obu przebiegach
  // pierwszego renderu (eksport i hydratacja), a realna szerokość jest
  // odczytywana i stosowana dopiero w useEffect, czyli wyłącznie po stronie
  // klienta, już po udanej hydratacji.
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
  const isDesktop = mounted && Platform.OS === "web" && width >= 900;
  const SIDEBAR_WIDTH = 200;
  // Dolny pasek nawigacji na mobile jest wyrenderowany jako `position:
  // absolute, bottom: 0` WEWNĄTRZ ScreenContainera, ale ScreenContainer
  // celowo nie stosuje bezpiecznego marginesu od dołu (edges domyślnie
  // = ["top","left","right"] — patrz components/screen-container.tsx),
  // bo to dokładnie pasek zakładek ma sam sobie doliczyć inset dolny
  // (home indicator na iOS / gesture bar na Androidzie). Stąd insets
  // tutaj, niezależnie od tych używanych przez ScreenContainer.
  const insets = useSafeAreaInsets();

  const routeButton = (
    key: string,
    icon: string,
    label: string,
    opts?: { onPress?: () => void; isActive?: boolean; badgeCount?: number },
  ) => {
    const isActive = opts?.isActive ?? tab === key;
    const badgeCount = opts?.badgeCount ?? 0;
    // Mała "pigułka" z liczbą przy pozycji nawigacji, która wymaga uwagi
    // (braki magazynowe, zamówienia do realizacji) — żeby nie trzeba było
    // wchodzić po kolei w każdą zakładkę, żeby się zorientować, czy jest
    // tam coś do zrobienia.
    const badge =
      badgeCount > 0 ? (
        <View
          style={{
            backgroundColor: isActive ? COLORS.background : COLORS.warning,
            borderRadius: 8,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: isActive ? COLORS.warning : COLORS.background,
              fontSize: 10,
              fontWeight: "800",
            }}
          >
            {badgeCount}
          </Text>
        </View>
      ) : null;
    return (
    <Pressable
      key={key}
      onPress={opts?.onPress ?? (() => setTab(key))}
      style={
        isDesktop
          ? {
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              borderRadius: 10,
              paddingVertical: 11,
              paddingHorizontal: 14,
              backgroundColor: isActive ? COLORS.primary : "transparent",
            }
          : {
              flex: 1,
              borderRadius: 10,
              paddingVertical: 8,
              alignItems: "center",
              backgroundColor: isActive ? COLORS.primary : "transparent",
            }
      }
    >
      {isDesktop ? (
        <>
          <Text
            style={{
              color: isActive ? COLORS.background : COLORS.muted,
              fontSize: 16,
            }}
          >
            {icon}
          </Text>
          <Text
            style={{
              flex: 1,
              color: isActive ? COLORS.background : COLORS.muted,
              fontSize: 13,
              fontWeight: "700",
            }}
          >
            {label}
          </Text>
          {badge}
        </>
      ) : (
        <>
          <View>
            <Text
              style={{
                color: isActive ? COLORS.background : COLORS.muted,
                fontSize: 18,
                lineHeight: 22,
              }}
            >
              {icon}
            </Text>
            {badgeCount > 0 && (
              <View
                style={{
                  position: "absolute",
                  top: -4,
                  right: -8,
                  backgroundColor: COLORS.warning,
                  borderRadius: 7,
                  minWidth: 14,
                  height: 14,
                  paddingHorizontal: 3,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: COLORS.background,
                    fontSize: 9,
                    fontWeight: "800",
                  }}
                >
                  {badgeCount}
                </Text>
              </View>
            )}
          </View>
          <Text
            style={{
              color: isActive ? COLORS.background : COLORS.muted,
              fontSize: 10,
              fontWeight: "700",
              marginTop: 2,
            }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
    );
  };
  // "Budowy" i "Archiwum budów" to jedna zakładka z filtrem wewnątrz
  // ekranu (mały przełącznik "Archiwum" obok wyszukiwarki, ten sam
  // standard co w Magazynie/Raportach/Rozliczeniu) — wejście zawsze
  // pokazuje aktywne budowy, buildsView (filtr) zostaje w kontekście
  // tylko dlatego, że steruje nim ekran builds-screen.tsx, a nie ten pasek.
  const buildsButton = routeButton("builds", "⌂", "Budowy", {
    isActive: tab === "builds",
    onPress: () => {
      setTab("builds");
      setBuildsView("active");
    },
  });
  // Budowy/Rozliczenie: tak samo jak Magazyn/Technologie i Zamówienia/
  // Raporty wyżej — mobile ma za mało miejsca w dolnym pasku na dwie
  // osobne pozycje. Budowy pierwsze (domyślne wejście), powtórne
  // wciśnięcie przełącza na Rozliczenie. Desktop zostaje przy dwóch
  // osobnych pozycjach (buildsButton + settlementButton).
  const isSettlementView = tab === "settlement";
  const buildsSettlementButton = routeButton(
    "buildsSettlement",
    isSettlementView ? "Σ" : "⌂",
    isSettlementView ? "Rozliczenie" : "Budowy",
    {
      isActive: tab === "builds" || tab === "settlement",
      onPress: () => {
        if (tab === "builds") {
          setTab("settlement");
        } else {
          setTab("builds");
          setBuildsView("active");
        }
      },
    },
  );
  const settlementButton = routeButton("settlement", "Σ", "Rozliczenie");
  // Admin: od scalenia z HR (patrz admin-screen.tsx) to jedna zakładka
  // z wewnętrznym przełącznikiem "Zespół i dniówka" / "Rozliczenie
  // godzin" — bez osobnej pozycji nawigacji ani przełączania na
  // poziomie zakładek.
  const adminButton = routeButton("admin", "⚙", "Admin");
  // Magazyn/Technologie: desktop ma miejsce na dwie osobne pozycje menu
  // (technologiesButton niżej). Mobile ma za mało miejsca w dolnym
  // pasku — jedna pozycja "Magazyn", a powtórne wciśnięcie (gdy ta
  // zakładka jest już otwarta) przełącza na Technologie, tak samo jak
  // buildsButton przełącza Budowy/Archiwum.
  const isTechnologiesView = tab === "warehouse" && warehouseView === "technologies";
  const warehouseButton = isDesktop
    ? routeButton("warehouse", "▦", "Magazyn", { badgeCount: shortageCount })
    : routeButton(
        "warehouse",
        isTechnologiesView ? "⬡" : "▦",
        isTechnologiesView ? "Technologie" : "Magazyn",
        {
          isActive: tab === "warehouse",
          badgeCount: shortageCount,
          onPress: () => {
            if (tab === "warehouse") {
              setWarehouseView(warehouseView === "materials" ? "technologies" : "materials");
            } else {
              setTab("warehouse");
              setWarehouseView("materials");
            }
          },
        },
      );
  const technologiesButton = routeButton("technologies", "⬡", "Technologie");
  // Zamówienia/Raporty: tak samo jak Magazyn/Technologie wyżej, mobile ma
  // za mało miejsca w dolnym pasku na dwie osobne pozycje — jedna
  // pozycja, która pokazuje aktualnie wybraną z tych dwóch zakładek, a
  // powtórne wciśnięcie przełącza na drugą. Desktop (sidebar, miejsca pod
  // dostatkiem) zostaje przy dwóch osobnych pozycjach.
  const ordersManagerButton = routeButton(
    "ordersManager",
    tab === "manager" ? "▥" : "▧",
    tab === "manager" ? "Raporty" : "Zamówienia",
    {
      isActive: tab === "orders" || tab === "manager",
      badgeCount: pendingOrdersCount + reportsPendingApprovalCount,
      onPress: () => setTab(tab === "orders" ? "manager" : "orders"),
    },
  );
  // Kolejność wg cyklu życia budowy: Budowy → Technologie (receptura) →
  // Magazyn (materiały, sparowane z Technologie jako toggle na mobile) →
  // Zamówienia → Raporty → Rozliczenie → HR i Admin na końcu jako funkcje
  // "meta", poza flow budowy (HR = pracownicy, Admin = konfiguracja firmy).
  const visibleRoutes =
    devRole === "Admin"
      ? [
          ...(isDesktop ? [buildsButton] : [buildsSettlementButton]),
          ...(isDesktop ? [technologiesButton] : []),
          warehouseButton,
          ...(isDesktop
            ? [
                routeButton("orders", "▧", "Zamówienia", {
                  badgeCount: pendingOrdersCount,
                }),
                routeButton("manager", "▥", "Raporty", {
                  badgeCount: reportsPendingApprovalCount,
                }),
              ]
            : [ordersManagerButton]),
          ...(isDesktop ? [settlementButton] : []),
          routeButton("hr", "◈", "HR"),
          adminButton,
        ]
      : devRole === "Brygadzista"
        ? [
            // Połączone "Raport" + "Moje raporty" w jedną zakładkę: lista
            // raportów (dawne "Moje raporty") jest teraz jedynym wejściem do
            // raportów, a nowy raport zaczyna się przyciskiem "+ Nowy
            // raport" w jej nagłówku (patrz saved-reports-screen.tsx). Tab
            // pozostaje podświetlony też na ekranie "report" (formularz
            // nowego/edytowanego raportu), bo z punktu widzenia nawigacji
            // to wciąż ta sama sekcja.
            routeButton("savedReports", "▤", "Raporty", {
              isActive: tab === "savedReports" || tab === "report",
              badgeCount: reportsNeedingFixCount,
            }),
            routeButton("teamTime", "◷", "Czas zespołu"),
            routeButton("leaves", "☼", "Urlopy"),
            routeButton("admin", "⚙", "Admin"),
          ]
        : [
            routeButton("worker", "◷", "Mój czas"),
            routeButton("leaves", "☼", "Urlopy"),
            routeButton("admin", "⚙", "Admin"),
          ];
  const nav = isDesktop ? (
    <View
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: SIDEBAR_WIDTH,
        flexDirection: "column",
        gap: 3,
        padding: 12,
        paddingTop: 24,
        backgroundColor: COLORS.background,
        borderRightWidth: 1,
        borderRightColor: COLORS.border,
      }}
    >
      <View style={{ marginBottom: 16, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <LogoMark size={26} />
        <View>
          <Text
            style={{
              color: COLORS.foreground,
              fontSize: 18,
              fontWeight: "800",
              letterSpacing: 0.5,
            }}
          >
            FLOWTEX <Text style={{ color: COLORS.primary }}>Polska</Text>
          </Text>
          <Text
            style={{
              color: COLORS.muted,
              fontSize: 9,
              letterSpacing: 1.1,
              marginTop: 4,
            }}
          >
            BUDOWY / MAGAZYN / RAPORTY
          </Text>
        </View>
      </View>
      {visibleRoutes}
    </View>
  ) : (
    <View
      style={{
        // position: "fixed" na webie, "absolute" na nativie.
        //
        // Dlaczego fixed: pomiar DOM pokazal, ze WSZYSTKIE warstwy od
        // #root w dol maja pelna wysokosc ekranu (797px = window.innerHeight),
        // a mimo to pasek z bottom:0 ladowal ~117px nad dolem ekranu.
        // Znaczy to, ze containing block tego paska (najblizszy przodek
        // z position != static) NIE jest zadna z tych pelnowymiarowych
        // warstw — cos glebiej w drzewie react-navigation / RNW tworzy
        // wlasny kontekst pozycjonowania o mniejszej wysokosci.
        //
        // position:fixed pozycjonuje wzgledem VIEWPORTU i calkowicie
        // ignoruje containing blocki, wiec pasek zawsze siedzi na dole
        // ekranu — niezaleznie od tego, co dzieje sie w drzewie wyzej.
        // RN nie zna wartosci "fixed" w typach, stad rzutowanie.
        ...(Platform.OS === "web"
          ? ({ position: "fixed" } as { position: "absolute" })
          : ({ position: "absolute" } as const)),
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: "row",
        gap: 3,
        paddingHorizontal: 8,
        paddingTop: 10,
        // NIE "12 + insets.bottom": root _layout.tsx wymusza juz minimum
        // na insecie, wiec dodawanie kolejnych 12px liczylo dolny
        // margines dwa razy.
        paddingBottom: Math.max(insets.bottom, 12),
        backgroundColor: COLORS.background,
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
      }}
    >
      {visibleRoutes}
    </View>
  );
  return (
    <ScreenContainer className="pt-0">
      <View style={{ flex: 1, marginLeft: isDesktop ? SIDEBAR_WIDTH : 0 }}>
        {!isDesktop && (
          <View
            style={{
              backgroundColor: COLORS.background,
              paddingHorizontal: 20,
              paddingTop: 18,
              paddingBottom: 18,
              borderBottomWidth: 1,
              borderBottomColor: COLORS.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <LogoMark size={28} />
              <View>
                <Text
                  style={{
                    color: COLORS.foreground,
                    fontSize: 24,
                    fontWeight: "800",
                    letterSpacing: 1,
                  }}
                >
                  FLOWTEX <Text style={{ color: COLORS.primary }}>Polska</Text>
                </Text>
                <Text
                  style={{
                    color: COLORS.muted,
                    fontSize: 11,
                    letterSpacing: 1.5,
                    marginTop: 4,
                  }}
                >
                  BUDOWY / MAGAZYN / RAPORTY
                </Text>
              </View>
            </View>
          </View>
        )}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: 20,
            // Pasek jest position:fixed, wiec NACHODZI na tresc — trzeba
            // zarezerwowac jego wysokosc. 76px = realna wysokosc paska
            // (1 border + 10 padTop + 16 padVert + 22 ikona + 15 label
            // + 12 padBottom), + 16px oddechu pod ostatnim elementem.
            paddingBottom: isDesktop
              ? 40
              : 76 + Math.max(insets.bottom, 12) + 16,
          }}
        >
          {mounted ? (
            // Suspense + lazy() dopięte DOPIERO po mount (patrz komentarz
            // przy `mounted` wyżej — ten sam fix co błąd hydratacji #418).
            // `expo export -p web` renderuje statyczny HTML po stronie
            // Node — React tam nie potrafi dokończyć rozwiązywania
            // dynamicznych import() w Suspense i po cichu poddaje ten
            // boundary (błąd #419 w konsoli), przełączając się w locie na
            // renderowanie kliencki. Efekt: apka i tak działa, ale traci
            // SSR i straszy błędem. Renderując lazy-loadowane ekrany
            // wyłącznie po `mounted` (czyli tylko w przeglądarce, już po
            // udanej hydratacji statycznego szkieletu), Node nigdy nie
            // próbuje ich importować — a per-rolowy code-splitting
            // (osobne bundle'e Pracownik/Brygadzista/Admin) zostaje bez
            // zmian, bo `lazy()` samo w sobie nic nie ładuje przed
            // pierwszym użyciem.
            <Suspense
              fallback={
                <ActivityIndicator
                  color={COLORS.primary}
                  style={{ marginTop: 40 }}
                />
              }
            >
              {tab === "start" && <StartScreen />}
              {tab === "warehouse" &&
                devRole === "Admin" &&
                (!isDesktop && warehouseView === "technologies" ? (
                  <TechnologiesScreen />
                ) : (
                  <WarehouseScreen />
                ))}
              {tab === "technologies" && devRole === "Admin" && <TechnologiesScreen />}
              {tab === "builds" && devRole === "Admin" && <BuildsScreen />}
              {tab === "orders" && devRole === "Admin" && <OrdersScreen />}
              {tab === "manager" && devRole === "Admin" && <ManagerScreen />}
              {tab === "settlement" && devRole === "Admin" && <SettlementScreen />}
              {tab === "hr" && devRole === "Admin" && <HrPanelScreen />}
              {tab === "admin" && devRole === "Admin" && <AdminScreen />}
              {tab === "report" && devRole === "Brygadzista" && <ReportScreen />}
              {tab === "savedReports" && devRole === "Brygadzista" && (
                <SavedReportsScreen />
              )}
              {tab === "teamTime" && devRole === "Brygadzista" && (
                <TeamTimeScreen />
              )}
              {tab === "worker" && devRole === "Pracownik" && <WorkerScreen />}
              {tab === "leaves" &&
                (devRole === "Pracownik" || devRole === "Brygadzista") && (
                  <LeaveScreen />
                )}
              {tab === "admin" &&
                (devRole === "Brygadzista" || devRole === "Pracownik") && (
                  <SettingsScreen />
                )}
            </Suspense>
          ) : (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
          )}
        </ScrollView>
      </View>
      {nav}
    </ScreenContainer>
  );
}

export default function HomeScreen() {
  return (
    <AuthGate>
      {(profile) => (
        <AppDataProvider
          initialRole={profile.role}
          myProfileId={profile.id}
          myEmployeeId={profile.employeeId != null ? String(profile.employeeId) : null}
        >
          <HomeScreenInner />
        </AppDataProvider>
      )}
    </AuthGate>
  );
}
