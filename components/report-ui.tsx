import { useRef, useState, type ReactNode } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

// react-native-web's Alert.alert (0.21.x) is a complete no-op — no
// window.alert/confirm fallback, nothing — so on web every Alert.alert
// call (confirm dialogs with a Tak/Nie choice AND plain info/error
// popups) silently does nothing: the user sees no dialog and no error,
// it just looks like the button didn't work. window.confirm/window.alert
// are the web equivalents that actually show something.
export const confirmAction = (
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
) => {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Anuluj", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
};

// Odpowiednik confirmAction dla zwykłych komunikatów bez wyboru (błędy
// zapisu, walidacja formularza) — patrz komentarz wyżej, ten sam powód.
export const notify = (title: string, message: string) => {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
};

type Material = {
  id: string;
  name: string;
  index: string;
  unit: string;
  stock: number;
  min: number;
  unitPrice: number;
  // Archiwizacja zamiast usuwania (materiał ze stanem zero, którego
  // historia — partie/zamówienia/raporty — wciąż go referencjuje po ID) —
  // domyślnie ukryty w Magazynie, ale wciąż podpowiadany przy dopasowaniu
  // nazwy, żeby nie powstał duplikat indeksu/nazwy.
  active: boolean;
};

type BuildStatus = "aktywna" | "zamknięta";

// Zapisywane raz, w momencie zamknięcia budowy — snapshot końcowego
// rozliczenia, żeby nie przeliczać go w nieskończoność, jeśli dane
// źródłowe (raporty, magazyn, stawki) kiedyś się zmienią.
type BuildSettlement = {
  closedAt: string;
  totalHours: number;
  materials: {
    materialId: string;
    planned: number;
    used: number;
    unitPrice: number;
    // Realny koszt zużytego materiału, wyliczony metodą FIFO z faktycznych
    // partii zdjętych z magazynu w trakcie raportów — niezależny od
    // unitPrice zamrożonego przy planowaniu budowy (`unitPrice` powyżej
    // zostaje tylko jako punkt odniesienia "ile zakładaliśmy na starcie").
    actualCost: number;
  }[];
  totalExtraCosts: number;
  // Koszt materiałowy = suma actualCost (rzeczywisty koszt zakupu
  // zużytego towaru), nie used × unitPrice.
  materialsCost: number;
  // Koszt robocizny: suma godzin z ewidencji czasu pracy tej budowy
  // × stawka godzinowa każdego pracownika.
  laborCost: number;
  totalCost: number;
};

type Build = {
  id: string;
  number: string;
  name: string;
  manager: string;
  startDate: string;
  durationDays: number;
  status: BuildStatus;
  photosUrl?: string | null;
  driveFolderId?: string | null;
  settlement?: BuildSettlement;
  // Faza 0/2 modułu Technologia.
  clientName?: string | null;
  address?: string | null;
  areaM2?: string | null;
  contractValue?: string | null;
  // Planowany koszt robocizny (patrz supabase/sql/040_planowany_koszt_
  // robocizny.sql).
  teamId?: number | null;
  plannedHoursPerDay?: number;
};

// Single source of truth for colors — mirrors theme.config.js tokens.
// Keeping this in one place means every inline style (Pressable/TextInput
// can't take Tailwind classes reliably) stays visually consistent with the rest of the app.
const COLORS = {
  primary: "#E2A73B",
  background: "#1B1B1D",
  surface: "#242427",
  foreground: "#F8F5EE",
  muted: "#A8A39A",
  border: "#3A3A3D",
  success: "#63C58C",
  successBg: "#1F3D2C",
  warning: "#D98C3D",
  warningBg: "#3D2E14",
  danger: "#F0958E",
  dangerBg: "#3A1F1F",
};

type Assignment = {
  buildId: string;
  materialId: string;
  planned: number;
  used: number;
  // Cena jednostkowa materiału "zamrożona" w momencie przypisania do
  // budowy — żeby późniejsza zmiana ceny w magazynie nie przeliczała
  // wstecz kosztu już trwających/zamkniętych budów.
  unitPrice: number;
  // Skumulowany, RZECZYWISTY koszt FIFO tego, co faktycznie zeszło z
  // partii przy raportach dziennych (build_materials."actualCost",
  // liczone przez submit_daily_report) — NIE to samo co `used * unitPrice`
  // (ta ostatnia to tylko cena zamrożona przy przypisaniu, uśredniona,
  // niezależna od realnych cen konkretnych partii, z których materiał
  // faktycznie zszedł).
  actualCost: number;
};

export type ExtraCost = {
  id: string;
  label: string;
  amount: number;
  note?: string;
  // Kategoria kosztu (Faza 7) — pole opisowe bez walidacji, patrz
  // EXTRA_COST_CATEGORIES niżej dla podpowiedzi w UI.
  category?: string;
};

// Podpowiedzi kategorii kosztu dodatkowego (product_spec.md / plan
// wdrożenia, Faza 7) — brygadzista może też wpisać własną w polu tekstowym.
const EXTRA_COST_CATEGORIES = ["nocleg", "parking", "zakup", "inne"] as const;

type Employee = {
  id: string;
  name: string;
  role: string;
  // Stawka godzinowa (PLN/h) — ustawiana i edytowana przy zarządzaniu
  // zespołem (panel administratora). Widoczna tylko tam, nie na
  // ekranach Brygadzisty/Pracownika.
  hourlyRate: number;
};

type TimeEntry = {
  id: string;
  date: string;
  buildId: string;
  employeeId: string;
  hours: number;
  start?: string;
  end?: string;
};

type MaterialOrder = {
  id: string;
  materialId?: string;
  materialName: string;
  quantity: number;
  unit: string;
  status: "do realizacji" | "zamówione" | "dostarczone";
  createdAt: string;
  orderedAt?: string;
  receivedQuantity?: number;
  receivedAt?: string;
  // Cena jednostkowa tej konkretnej dostawy — może różnić się od ceny
  // poprzednich partii tego samego materiału w magazynie.
  receivedUnitPrice?: number;
  // Grupuje pozycje utworzone naraz z koszyka w jedno zamówienie w UI —
  // patrz orderCart/submitOrderCart w contexts/app-data.tsx.
  batchId?: string;
};

// Pojedyncza partia zakupowa materiału — magazyn danej pozycji to suma
// partii, a nie jedna liczba. Dzięki temu widać, że np. 18 szt. kupiono
// po 58 zł, a kolejne 24 szt. po 63 zł, zamiast nadpisywać jedną cenę.
type MaterialBatch = {
  id: string;
  materialId: string;
  quantity: number;
  unitPrice: number;
  receivedAt: string;
  // Skąd wzięła się partia — "stan początkowy", "zamówienie", "korekta".
  source: string;
};

const initialMaterials: Material[] = [
  {
    id: "m1",
    name: "Klej do płytek elastyczny",
    index: "KLEJ-EL-25",
    unit: "worek",
    stock: 84,
    min: 20,
    unitPrice: 58,
    active: true,
  },
  {
    id: "m2",
    name: "Płyta GK impregnowana",
    index: "GKBI-12-5",
    unit: "szt.",
    stock: 42,
    min: 30,
    unitPrice: 34,
    active: true,
  },
  {
    id: "m3",
    name: "Profil CD 60",
    index: "PRO-CD60",
    unit: "mb",
    stock: 118,
    min: 50,
    unitPrice: 6.5,
    active: true,
  },
  {
    id: "m4",
    name: "Wkręty TN 25",
    index: "WKR-TN25",
    unit: "opak.",
    stock: 8,
    min: 15,
    unitPrice: 12,
    active: true,
  },
];

const initialBuilds: Build[] = [
  {
    id: "b1",
    number: "BUD-024",
    name: "Osiedle Brzozowa — etap II",
    manager: "Marek Kowalski",
    startDate: "2026-08-04",
    durationDays: 20,
    status: "aktywna",
  },
  {
    id: "b2",
    number: "BUD-019",
    name: "Dom jednorodzinny Zielona",
    manager: "Anna Nowak",
    startDate: "2026-08-11",
    durationDays: 8,
    status: "aktywna",
  },
];

const initialAssignments: Assignment[] = [
  { buildId: "b1", materialId: "m1", planned: 18, used: 0, unitPrice: 58, actualCost: 0 },
  { buildId: "b1", materialId: "m2", planned: 24, used: 0, unitPrice: 34, actualCost: 0 },
  { buildId: "b1", materialId: "m4", planned: 4, used: 0, unitPrice: 12, actualCost: 0 },
  { buildId: "b2", materialId: "m3", planned: 36, used: 0, unitPrice: 6.5, actualCost: 0 },
];

const initialEmployees: Employee[] = [
  { id: "e1", name: "Piotr Zieliński", role: "Brygadzista", hourlyRate: 45 },
  { id: "e2", name: "Tomasz Wójcik", role: "Pracownik", hourlyRate: 35 },
  { id: "e3", name: "Kamil Mazur", role: "Pracownik", hourlyRate: 35 },
];

const initialTimeEntries: TimeEntry[] = [];

const TIME_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 5).flatMap(
  (hour) =>
    ["00", "30"].map((minute) => `${String(hour).padStart(2, "0")}:${minute}`),
);

// Domyślne jednostki magazynowe — dobrane pod posadzki żywiczne (żywica i
// utwardzacz zwykle w kg/l albo w gotowych zestawach A+B, kwarc/piasek w
// workach, listwy/taśmy dylatacyjne na metry bieżące). Pole jednostki
// zostaje zwykłym tekstem (patrz warehouse-screen.tsx) — te pigułki tylko
// wypełniają je jednym dotknięciem, można też wpisać własną.
const UNIT_OPTIONS = [
  "szt.",
  "kg",
  "l",
  "zestaw",
  "worek",
  "wiadro",
  "opak.",
  "mb",
  "m²",
];

const todayISO = () => new Date().toISOString().slice(0, 10);

const formatPLN = (amount: number) =>
  `${amount.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

const addDaysISO = (dateStr: string, days: number) => {
  if (!dateStr || !Number.isFinite(days)) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + Math.max(0, Math.round(days) - 1));
  return d.toISOString().slice(0, 10);
};

const todayLabelPL = () =>
  new Date().toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

// Domyślnie przycisk NIE rozciąga się na całą szerokość rodzica — RN/View
// ma domyślnie alignItems: "stretch", więc bez jawnego alignSelf każdy
// Pressable w kolumnowym kontenerze zajmuje 100% szerokości. Tam, gdzie
// przycisk faktycznie ma być pełnej szerokości (np. główne CTA w stopce
// kroku raportu), przekazujemy fullWidth.
const Button = ({
  label,
  onPress,
  secondary = false,
  fullWidth = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    hitSlop={8}
    style={({ pressed }) => ({
      backgroundColor: secondary ? COLORS.surface : COLORS.primary,
      borderWidth: secondary ? 1 : 0,
      borderColor: COLORS.border,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 20,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: fullWidth ? "stretch" : "center",
      opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
    })}
  >
    <Text
      style={{
        color: secondary ? COLORS.foreground : COLORS.background,
        fontWeight: "700",
      }}
    >
      {label}
    </Text>
  </Pressable>
);

// FIX: minWidth: 0 w stylu bazowym.
// Na React Native Web TextInput renderuje się jako <input size=20>, który ma
// intrinsic width ~177px i min-width: auto. Bez minWidth: 0 pole ustawione
// przez flex: 1 / flex: 2 NIE MOŻE się zwężyć i ucina placeholder
// (np. "Nazwa kosztu (np. paliwo)") albo rozpycha cały wiersz.
const Field = ({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  editable,
  onFocus,
  onBlur,
  autoCapitalize,
  secureTextEntry,
  style,
  // Domyślnie pojedynczy wiersz (jak dotąd) — `multiline` + `numberOfLines`
  // przekazywane tylko tam, gdzie pole faktycznie ma być wieloliniowe (np.
  // notatka do raportu w report-screen.tsx), żeby nie zmieniać wyglądu
  // wszystkich pozostałych, jednowierszowych użyć tego komponentu.
  multiline,
  numberOfLines,
}: any) => (
  <TextInput
    value={value}
    onChangeText={onChangeText}
    placeholder={placeholder}
    placeholderTextColor={COLORS.muted}
    keyboardType={keyboardType}
    editable={editable}
    onFocus={onFocus}
    onBlur={onBlur}
    autoCapitalize={autoCapitalize}
    secureTextEntry={secureTextEntry}
    multiline={multiline}
    numberOfLines={numberOfLines}
    style={[
      {
        backgroundColor: COLORS.background,
        color: COLORS.foreground,
        borderRadius: 10,
        paddingHorizontal: 13,
        paddingVertical: 11,
        marginTop: 8,
        minWidth: 0,
      },
      multiline ? { textAlignVertical: "top" } : null,
      style,
    ]}
  />
);

// Kompaktowy stepper ilości (− / wpisz / +), ten sam wzorzec co w kroku
// "Zużycie dzienne" brygadzisty — używamy go teraz wszędzie tam, gdzie
// wpisuje się jakąś ilość (magazyn, budowy, zamówienia), zamiast samego
// pola tekstowego.
//
// FIX (kluczowy): TextInput miał szerokosc zapisana z wielkiej litery W,
// czyli "W-idth: 28" zamiast "width", co RN
// ignoruje w całości. Na web <input> przyjmował wtedy domyślną szerokość
// ~177px, której nie da się skurczyć, więc stepper zjadał 2/3 wiersza,
// a nazwa materiału zwijała się do "K…". Po obrocie ekranu było szerzej,
// więc problem "znikał".
const QuantityStepper = ({
  value,
  onChangeText,
  min = 0,
  step = 1,
  disabled = false,
  style,
  unit,
}: {
  value: string;
  onChangeText: (v: string) => void;
  min?: number;
  // Skok przycisków +/- (domyślnie 1, np. dla stawki za km 0.5) —
  // patrz stawkaKmInput w admin-screen.tsx (Faza 7).
  step?: number;
  disabled?: boolean;
  style?: object;
  // Opcjonalna jednostka wyświetlana tuż obok steppera (np. "kg", "m²") —
  // bez niej sama liczba nie mówi, w czym się ją wpisuje (patrz
  // renderMaterialRow w report-screen.tsx, gdzie brygadzista wpisuje
  // zużycie materiału bez żadnego innego kontekstu jednostki obok).
  unit?: string;
}) => {
  const current = Number(value) || 0;
  // Ilości materiałów mają w bazie do 3 miejsc po przecinku (niepełne
  // litry/wiadra przy posadzkach żywicznych), a stawki (np. km) do 2 —
  // round2 zaokrągla WYŁĄCZNIE to, co dopisują tu przyciski +/-, żeby nie
  // narastały błędy zmiennoprz. (np. 2.3 - 1 w JS bez zaokrąglenia potrafi
  // dać 1.2999999999999998).
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: COLORS.background,
          borderRadius: 10,
          alignSelf: "flex-start",
          // sztywny rozmiar — stepper nigdy nie rośnie i nie kurczy się
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: "auto",
          overflow: "hidden",
        },
        style,
      ]}
    >
      <Pressable
        disabled={disabled}
        hitSlop={10}
        onPress={() => onChangeText(String(round2(Math.max(min, current - step))))}
        style={{
          width: 34,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MaterialIcons
          name="remove"
          size={16}
          color={disabled ? COLORS.muted : COLORS.primary}
        />
      </Pressable>
      <TextInput
        editable={!disabled}
        // "decimal-pad" (nie "numeric") — na telefonie z pl-PL klawiatura
        // domyślnie pokazuje separator dziesiętny (kropkę lub przecinek,
        // zależnie od ustawień systemowych), inaczej nie da się wpisać
        // niepełnej ilości (np. 2.5 l). Przecinek normalizujemy do kropki
        // przed przekazaniem dalej, bo cała reszta apki parsuje Number(x).
        keyboardType="decimal-pad"
        value={value}
        onChangeText={(v: string) => onChangeText(v.replace(",", "."))}
        style={{
          width: 44,
          minWidth: 0,
          padding: 0,
          textAlign: "center",
          color: COLORS.foreground,
          fontWeight: "800",
          fontSize: 16,
        }}
      />
      <Pressable
        disabled={disabled}
        hitSlop={10}
        onPress={() => onChangeText(String(round2(current + step)))}
        style={{
          width: 34,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MaterialIcons
          name="add"
          size={16}
          color={disabled ? COLORS.muted : COLORS.primary}
        />
      </Pressable>
      {unit ? (
        <Text
          style={{
            color: COLORS.muted,
            fontSize: 12,
            fontWeight: "700",
            paddingRight: 10,
          }}
        >
          {unit}
        </Text>
      ) : null}
    </View>
  );
};

// Sekcja "Dodatkowe koszty" w raporcie dziennym — pozwala brygadziście
// dopisać koszty niezwiązane z materiałami z magazynu (np. wynajem
// sprzętu, paliwo, drobne zakupy), przypisane do tej samej budowy co
// reszta raportu, żeby trafiły do rozliczenia kosztów budowy.
const ExtraCostsSection = ({
  costs,
  onAdd,
  onRemove,
  disabled = false,
}: {
  costs: ExtraCost[];
  onAdd: (label: string, amount: number, note?: string, category?: string) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) => {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("");
  const [customCategory, setCustomCategory] = useState("");
  const total = costs.reduce((sum, c) => sum + c.amount, 0);
  const submit = () => {
    const value = Number(amount.replace(",", "."));
    if (!label.trim() || !value || value <= 0) return;
    const resolvedCategory =
      category === "inne" ? customCategory.trim() || "inne" : category || undefined;
    onAdd(label.trim(), value, undefined, resolvedCategory);
    setLabel("");
    setAmount("");
    setCategory("");
    setCustomCategory("");
  };
  // Wybór podpowiedzi (nocleg/parking/zakup) od razu podstawia jej nazwę do
  // pola "Nazwa kosztu" — najczęściej jest to i tak docelowa nazwa (jeden
  // "Parking" na raport), więc nie trzeba wpisywać tego samego dwa razy.
  // "inne" celowo pomijamy: tam nazwę i tak trzeba wpisać ręcznie, bo sama
  // kategoria nią nie jest. Odklikanie aktywnej podpowiedzi czyści nazwę,
  // ale tylko jeśli użytkownik jej po drodze ręcznie nie zmienił — inaczej
  // zgubilibyśmy to, co właśnie wpisał.
  const selectCategory = (option: (typeof EXTRA_COST_CATEGORIES)[number]) => {
    const capitalized = option.charAt(0).toUpperCase() + option.slice(1);
    if (category === option) {
      setCategory("");
      if (label === capitalized) setLabel("");
      return;
    }
    setCategory(option);
    if (option !== "inne") setLabel(capitalized);
  };
  return (
    <View>
      {costs.map((c, i) => (
        <View
          key={c.id}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 10,
            borderTopWidth: i > 0 ? 1 : 0,
            borderTopColor: COLORS.border,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{ color: COLORS.foreground, fontSize: 14 }}
              numberOfLines={1}
            >
              {c.label}
            </Text>
            {!!c.category && (
              <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 1 }}>
                {c.category}
              </Text>
            )}
          </View>
          <Text
            style={{
              color: COLORS.foreground,
              fontWeight: "700",
              fontSize: 14,
              marginLeft: 8,
              flexShrink: 0,
            }}
          >
            {c.amount.toFixed(2)} zł
          </Text>
          {!disabled && (
            <Pressable
              onPress={() => onRemove(c.id)}
              hitSlop={8}
              style={{ marginLeft: 10, padding: 4, flexShrink: 0 }}
            >
              <MaterialIcons name="close" size={16} color={COLORS.muted} />
            </Pressable>
          )}
        </View>
      ))}
      {costs.length > 0 && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            paddingTop: 10,
            marginTop: costs.length > 1 ? 0 : 4,
            borderTopWidth: 1,
            borderTopColor: COLORS.border,
          }}
        >
          <Text
            style={{ color: COLORS.muted, fontSize: 13, fontWeight: "700" }}
          >
            Razem
          </Text>
          <Text
            style={{ color: COLORS.primary, fontWeight: "800", fontSize: 14 }}
          >
            {total.toFixed(2)} zł
          </Text>
        </View>
      )}
      {!disabled && (
        // flexWrap zamiast sztywnego jednego wiersza: na wąskim ekranie
        // (mobile) "Nazwa kosztu" i "Kwota" nie mieszczą się obok siebie
        // bez ucinania placeholdera — przy minWidth większym niż dostępna
        // szerokość pole samo spada do nowej linii, na szerszych
        // ekranach zostają w jednym rzędzie jak dotychczas.
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}
        >
          <Field
            placeholder="Nazwa kosztu (np. paliwo)"
            value={label}
            onChangeText={setLabel}
            style={{ flexGrow: 2, flexBasis: 160, marginTop: 0, minWidth: 0 }}
          />
          <Field
            placeholder="Kwota"
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
            style={{ flexGrow: 1, flexBasis: 90, marginTop: 0, minWidth: 0 }}
          />
        </View>
      )}
      {!disabled && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {EXTRA_COST_CATEGORIES.map((option) => {
            const active = category === option;
            return (
              <Pressable
                key={option}
                onPress={() => selectCategory(option)}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: active ? COLORS.primary : COLORS.background,
                  borderWidth: 1,
                  borderColor: active ? COLORS.primary : COLORS.border,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "700",
                    color: active ? COLORS.background : COLORS.muted,
                    textTransform: "capitalize",
                  }}
                >
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {!disabled && category === "inne" && (
        <Field
          placeholder="Własna kategoria (opcjonalnie)"
          value={customCategory}
          onChangeText={setCustomCategory}
          style={{ marginTop: 8 }}
        />
      )}
      {!disabled && (
        <View style={{ marginTop: 8 }}>
          <Button label="+ Dodaj koszt" secondary onPress={submit} />
        </View>
      )}
    </View>
  );
};

// Wysokość jednego wiersza godziny na liście wyboru — stała wartość (zamiast
// samego paddingu), żeby dokładnie wyliczyć, o ile przewinąć listę.
const TIME_ROW_HEIGHT = 40;

// Lista godzin do wyboru (OD / DO), która przy otwarciu sama przewija się
// do aktualnie wybranej / najbliższej godziny — wcześniej zawsze otwierała
// się od góry (5:00), niezależnie od tego, która godzina była już wybrana.
const TimeOptionsList = ({
  value,
  onSelect,
  disabled = false,
}: {
  value: string;
  onSelect: (time: string) => void;
  disabled?: boolean;
}) => {
  const exactIndex = TIME_OPTIONS.findIndex((t) => t === value);
  const targetIndex =
    exactIndex >= 0
      ? exactIndex
      : (() => {
          const [h, m] = (value || "").split(":").map(Number);
          if (!Number.isFinite(h)) return 0;
          let best = 0;
          let bestDiff = Infinity;
          TIME_OPTIONS.forEach((t, i) => {
            const [th, tm] = t.split(":").map(Number);
            const diff = Math.abs(th * 60 + tm - (h * 60 + (m || 0)));
            if (diff < bestDiff) {
              bestDiff = diff;
              best = i;
            }
          });
          return best;
        })();
  // Wyśrodkuj wybraną godzinę zamiast chować ją na samym dole widoku.
  const initialOffset = Math.max(
    0,
    targetIndex * TIME_ROW_HEIGHT - TIME_ROW_HEIGHT,
  );
  // `contentOffset` (prop) tylko na natywnych platformach ustawia
  // pozycję startową scrolla niezawodnie — react-native-web często ją
  // ignoruje po zamontowaniu (lista i tak otwiera się od góry, na
  // "05:00"), więc doń wymuszamy przez ref + scrollTo w onLayout,
  // które działa tak samo na obu platformach.
  const scrollRef = useRef<ScrollView>(null);
  return (
    <View
      style={{
        backgroundColor: COLORS.background,
        borderRadius: 10,
        marginTop: 6,
        borderWidth: 1,
        borderColor: COLORS.border,
      }}
    >
      <ScrollView
        ref={scrollRef}
        style={{ maxHeight: 180 }}
        nestedScrollEnabled
        contentOffset={{ x: 0, y: initialOffset }}
        onLayout={() => scrollRef.current?.scrollTo({ y: initialOffset, animated: false })}
      >
        {TIME_OPTIONS.map((time) => (
          <Pressable
            disabled={disabled}
            key={time}
            onPress={() => onSelect(time)}
            style={{
              height: TIME_ROW_HEIGHT,
              justifyContent: "center",
              paddingHorizontal: 13,
              backgroundColor: value === time ? COLORS.surface : "transparent",
            }}
          >
            <Text
              style={{
                color: value === time ? COLORS.primary : COLORS.foreground,
                fontWeight: value === time ? "800" : "500",
              }}
            >
              {time}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
};

type BadgeStatus = "ok" | "warning" | "danger";

const STATUS_STYLES: Record<BadgeStatus, { fg: string; bg: string }> = {
  ok: { fg: COLORS.success, bg: COLORS.successBg },
  warning: { fg: COLORS.warning, bg: COLORS.warningBg },
  danger: { fg: COLORS.danger, bg: COLORS.dangerBg },
};

// Small circular icon badge used to give rows (budowa / osoba / materiał) a
// visual anchor, matching the reference mockup, without pulling in a full
// icon-per-row image asset pipeline — just MaterialIcons + a tinted circle.
const IconBadge = ({
  name,
  size = 22,
  badgeSize = 44,
}: {
  name: keyof typeof MaterialIcons.glyphMap;
  size?: number;
  badgeSize?: number;
}) => (
  <View
    style={{
      width: badgeSize,
      height: badgeSize,
      borderRadius: badgeSize / 2,
      borderWidth: 1,
      borderColor: COLORS.border,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: COLORS.background,
      flexShrink: 0,
    }}
  >
    <MaterialIcons name={name} size={size} color={COLORS.primary} />
  </View>
);

export function ScreenHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  // Opcjonalny przycisk akcji w prawym górnym rogu nagłówka (np. "+ Nowe
  // zamówienie"), zamiast pompowania osobnej, dużej karty w treści widoku.
  action?: ReactNode;
}) {
  return (
    <View
      style={{
        marginBottom: description ? 20 : 16,
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text className="text-3xl font-bold text-foreground">{title}</Text>
        {description ? (
          <Text className="text-sm text-muted mt-2">{description}</Text>
        ) : null}
      </View>
      {action ? <View style={{ marginTop: 2 }}>{action}</View> : null}
    </View>
  );
}

const REPORT_STEPS: { n: 1 | 2 | 3; label: string }[] = [
  { n: 1, label: "Zużycie" },
  { n: 2, label: "Zespół" },
  { n: 3, label: "Podsumowanie" },
];

// Top-of-card progress indicator for the daily report flow: numbered circles
// connected by a line, filled/checked once passed, so the brygadzista always
// knows where they are without the whole form competing for attention at once.
//
// FIX: w key brakowalo otwierajacej klamry przed template literalem
// (było: key=backtick..., miało być: key={backtick...}), co całkowicie
// psuło parsowanie JSX i wywalało cały plik.
const ReportStepper = ({ step }: { step: 1 | 2 | 3 }) => (
  <View
    style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 20 }}
  >
    {REPORT_STEPS.flatMap((s, i) => {
      const circle = (
        <View key={`c${s.n}`} style={{ alignItems: "center", width: 76 }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: step === s.n ? COLORS.primary : "transparent",
              borderWidth: step === s.n ? 0 : 1,
              borderColor: step > s.n ? COLORS.primary : COLORS.border,
            }}
          >
            {step > s.n ? (
              <MaterialIcons name="check" size={16} color={COLORS.primary} />
            ) : (
              <Text
                style={{
                  color: step === s.n ? COLORS.background : COLORS.muted,
                  fontWeight: "800",
                }}
              >
                {s.n}
              </Text>
            )}
          </View>
          <Text
            style={{
              color: step === s.n ? COLORS.primary : COLORS.muted,
              fontSize: 11,
              marginTop: 6,
              fontWeight: step === s.n ? "700" : "500",
              textAlign: "center",
            }}
          >
            {s.label}
          </Text>
        </View>
      );
      if (i === REPORT_STEPS.length - 1) return [circle];
      const line = (
        <View
          key={`l${s.n}`}
          style={{
            flex: 1,
            height: 1,
            backgroundColor: step > s.n ? COLORS.primary : COLORS.border,
            marginTop: 16,
          }}
        />
      );
      return [circle, line];
    })}
  </View>
);

// One consistent way to signal state (dot + label) instead of ad-hoc mixes of
// emoji and colored text that varied from screen to screen.
const StatusBadge = ({
  status,
  label,
}: {
  status: BadgeStatus;
  label: string;
}) => {
  const s = STATUS_STYLES[status];
  return (
    <View
      style={{
        backgroundColor: s.bg,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      <View
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.fg }}
      />
      <Text style={{ color: s.fg, fontWeight: "700", fontSize: 12 }}>
        {label}
      </Text>
    </View>
  );
};

// Dane raportu wymagane przez ReportCard — zdefiniowane strukturalnie
// (nie importowane z app-data.tsx), żeby uniknąć zależności cyklicznej;
// SavedReport z app-data.tsx spełnia ten kształt.
export type ReportCardData = {
  id: string;
  date: string;
  buildNumber: string;
  buildName: string;
  materialValues: Record<string, string>;
  // Rzeczywisty koszt FIFO doliczony w tym raporcie, per materiał —
  // pozwala pokazać kwotę przy pozycji zamiast samej ilości.
  materialCosts?: Record<string, number>;
  reasons: Record<string, string>;
  people: { employeeId: string; start: string; end: string }[];
  extraCosts: ExtraCost[];
  status: "submitted" | "approved";
  // Notatka brygadzisty do tego raportu (Decyzja B) — jedna, dowolna,
  // czysto informacyjna.
  note?: string;
};

// Jedna karta raportu dziennego, używana zarówno w globalnej skrzynce
// "Raporty" (przekrojowo po wszystkich budowach) jak i w szczegółach
// pojedynczej budowy — żeby wygląd i logika zatwierdzania raportu nie
// rozjeżdżały się w dwóch miejscach.
// Nagłówek sekcji ze wspólnym rytmem odstępów — wydzielone z ReportCard,
// żeby ten sam "duży odstęp + wytłuszczony nagłówek + licznik" dało się
// odtworzyć w innych szczegółowych kartach (rozliczenie budowy, magazyn,
// zamówienia), które dziś każde robią to inaczej i płasko. Separator
// między pozycjami zostaje w geście wywołującego (child listy) — celowo
// NIE ma go między sekcjami, tylko odstęp (zasada Gestalt: bliskość).
export function DetailSection({
  label,
  count,
  children,
  style,
}: {
  label: string;
  count?: number | string;
  children: ReactNode;
  style?: object;
}) {
  return (
    <View style={[{ marginTop: 24 }, style]}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
        }}
      >
        <Text
          style={{ color: COLORS.muted, fontSize: 12, fontWeight: "800" }}
          className="uppercase"
        >
          {label}
        </Text>
        {count !== undefined && (
          <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "700" }}>
            {count}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

export type SearchablePickerItem = {
  key: string;
  title: string;
  subtitle?: string;
};

// Wyszukiwany modal wyboru z listy — wydzielone z saved-reports-screen.tsx
// (wybór budowy). manager-screen.tsx i settlement-screen.tsx miały
// wcześniej DOSŁOWNIE tę samą funkcję (rozwijany inline picker z
// wyszukiwarką), skopiowaną osobno w każdym pliku — jeden wspólny
// komponent zamiast trzech wariantów tego samego. Modal (nie inline
// rozwijanie) skaluje się lepiej przy długich listach i nie przesuwa
// reszty ekranu w dół.
export function SearchablePicker({
  visible,
  onClose,
  query,
  onQueryChange,
  placeholder = "Szukaj…",
  items,
  selectedKey,
  onSelect,
  emptyLabel = "Brak pozycji pasujących do wyszukiwania.",
}: {
  visible: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  placeholder?: string;
  items: SearchablePickerItem[];
  selectedKey?: string;
  onSelect: (key: string) => void;
  emptyLabel?: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "center",
          alignItems: "center",
          padding: 20,
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="bg-surface border border-border rounded-2xl"
          style={{ maxHeight: "70%", overflow: "hidden", width: "100%", maxWidth: 480 }}
        >
          <View
            className="border-border"
            style={{
              flexDirection: "row",
              alignItems: "center",
              borderBottomWidth: 1,
              paddingHorizontal: 14,
              paddingVertical: 4,
            }}
          >
            <MaterialIcons name="search" size={18} color={COLORS.muted} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={onQueryChange}
              placeholder={placeholder}
              placeholderTextColor={COLORS.muted}
              style={{
                flex: 1,
                color: COLORS.foreground,
                fontSize: 14,
                paddingVertical: 10,
                paddingHorizontal: 8,
              }}
            />
          </View>
          <ScrollView>
            {items.map((item, i) => {
              const selected = selectedKey === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => onSelect(item.key)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: COLORS.border,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    backgroundColor: pressed ? COLORS.background : "transparent",
                  })}
                >
                  <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                    <Text
                      style={{ color: COLORS.foreground, fontSize: 14, fontWeight: "700" }}
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                    {item.subtitle && (
                      <Text
                        style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}
                        numberOfLines={1}
                      >
                        {item.subtitle}
                      </Text>
                    )}
                  </View>
                  {selected && (
                    <MaterialIcons name="check" size={18} color={COLORS.primary} />
                  )}
                </Pressable>
              );
            })}
            {items.length === 0 && (
              <Text style={{ color: COLORS.muted, fontSize: 13, padding: 14 }}>
                {emptyLabel}
              </Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const ReportCard = ({
  report,
  build,
  materials,
  assignments,
  employees,
  expanded,
  onToggle,
  onApprove,
  showBuildInfo = true,
}: {
  report: ReportCardData;
  build?: Build;
  materials: Material[];
  assignments: Assignment[];
  employees: Employee[];
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  showBuildInfo?: boolean;
}) => {
  const approved = report.status === "approved";
  const planned = assignments.filter((a) => a.buildId === build?.id);
  const totalHours = report.people.reduce((sum, person) => {
    const [sh, sm] = person.start.split(":").map(Number);
    const [eh, em] = person.end.split(":").map(Number);
    if (
      ![sh, sm, eh, em].every(Number.isFinite) ||
      eh * 60 + em <= sh * 60 + sm
    )
      return sum;
    return sum + (eh * 60 + em - (sh * 60 + sm)) / 60;
  }, 0);

  return (
    <View
      className="bg-surface border border-border rounded-2xl mb-3 overflow-hidden"
      style={{ borderColor: approved ? COLORS.success : COLORS.border }}
    >
      <Pressable
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", padding: 14 }}
      >
        <IconBadge name={approved ? "lock" : "description"} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text className="text-base font-bold text-foreground">
              {showBuildInfo ? report.buildNumber : "Raport dzienny"}
            </Text>
            <Text className="text-xs text-muted">{report.date}</Text>
          </View>
          {showBuildInfo && (
            <Text className="text-sm text-muted mt-1" numberOfLines={1}>
              {report.buildName}
            </Text>
          )}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <Text style={{ color: COLORS.muted, fontSize: 12 }}>
              {report.people.length}{" "}
              {report.people.length === 1 ? "osoba" : "osoby"} ·{" "}
              {Object.keys(report.materialValues).length}{" "}
              {Object.keys(report.materialValues).length === 1
                ? "materiał"
                : "materiały"}
            </Text>
            <StatusBadge
              status={approved ? "ok" : "warning"}
              label={approved ? "Zatwierdzony" : "Do sprawdzenia"}
            />
          </View>
        </View>
        <Text style={{ color: COLORS.primary, fontSize: 18, fontWeight: "700", marginLeft: 8 }}>
          {expanded ? "⌄" : "›"}
        </Text>
      </Pressable>

      {expanded && (
        <View
          style={{ borderTopWidth: 1, borderTopColor: COLORS.border, padding: 16 }}
        >
          {build && (
            <Text style={{ color: COLORS.muted, fontSize: 12 }}>
              Kierownik: {build.manager}
            </Text>
          )}

          {/* Sekcje rozdzielone dużym odstępem pionowym (zasada Gestalt:
              bliskość = przynależność) zamiast jednakowo ciasnych bloków —
              to samo "MATERIAŁY / KOSZTY / ZESPÓŁ" jedno pod drugim bez
              oddechu sprawiało, że całość czytała się jak jeden nierozróżnialny
              blob, mimo że treściowo to cztery różne grupy informacji. */}
          <DetailSection label="Materiały" count={Object.keys(report.materialValues).length}>
            {Object.keys(report.materialValues).length === 0 ? (
              <Text className="text-sm text-muted py-1">
                Nie zgłoszono zużycia materiałów.
              </Text>
            ) : (
              Object.entries(report.materialValues).map(
                ([materialId, used], i) => {
                  const material = materials.find((m) => m.id === materialId);
                  const assignment = planned.find(
                    (a) => a.materialId === materialId,
                  );
                  const plan = assignment?.planned;
                  // `used` w report.materialValues to DZISIEJSZE zużycie
                  // TEGO raportu (od 047_raport_dzienna_ilosc_nie_
                  // skumulowana.sql), nie stan całkowity budowy — do
                  // porównania z planem bierzemy ŻYWY licznik budowy
                  // (assignment.used), nie wartość z tego pojedynczego
                  // raportu. Dla raportu, który jest najnowszym dla tej
                  // budowy/materiału (typowy przypadek: przegląd świeżo
                  // wysłanego raportu), to dokładny stan "do tej pory";
                  // dla starszych, już zatwierdzonych raportów pokazuje
                  // aktualny stan budowy, nie historyczny zamrożony stan z
                  // dnia wysyłki (ta historia już nigdzie nie jest
                  // trzymana, patrz nagłówek migracji 047).
                  const usedNum = Number(used) || 0;
                  const totalUsed = assignment ? assignment.used : usedNum;
                  const ratio = plan ? totalUsed / plan : null;
                  // Zielony = w normie, pomarańczowy = lekkie przekroczenie,
                  // czerwony = znaczne — żeby nie trzeba było porównywać dwóch
                  // liczb w głowie, sam kolor/pasek już to mówi.
                  const barColor =
                    ratio === null || ratio <= 1
                      ? COLORS.success
                      : ratio <= 1.15
                        ? COLORS.warning
                        : COLORS.danger;
                  const differs = plan !== undefined && totalUsed !== plan;
                  const reason = report.reasons[materialId];
                  const cost = report.materialCosts?.[materialId];
                  return (
                    <View
                      key={materialId}
                      style={{
                        paddingVertical: 10,
                        borderTopWidth: i > 0 ? 1 : 0,
                        borderTopColor: COLORS.border,
                      }}
                    >
                      <Text className="text-sm font-semibold text-foreground">
                        {material?.name || materialId}
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          marginTop: 4,
                        }}
                      >
                        <Text
                          style={{
                            color: COLORS.foreground,
                            fontWeight: "800",
                            fontSize: 15,
                          }}
                        >
                          dziś: {usedNum} {material?.unit}
                        </Text>
                        <Text
                          style={{
                            color: differs ? COLORS.warning : COLORS.muted,
                            fontSize: 12,
                          }}
                        >
                          {plan !== undefined
                            ? `łącznie ${totalUsed} z ${plan} ${material?.unit} planu`
                            : `łącznie ${totalUsed} ${material?.unit}`}
                        </Text>
                      </View>
                      {plan !== undefined && plan > 0 && (
                        <View
                          style={{
                            height: 4,
                            borderRadius: 2,
                            backgroundColor: COLORS.background,
                            marginTop: 6,
                            overflow: "hidden",
                          }}
                        >
                          <View
                            style={{
                              height: 4,
                              borderRadius: 2,
                              width: `${Math.min(100, (totalUsed / plan) * 100)}%`,
                              backgroundColor: barColor,
                            }}
                          />
                        </View>
                      )}
                      {cost !== undefined && (
                        <Text
                          style={{
                            color: COLORS.muted,
                            fontSize: 12,
                            marginTop: 4,
                            textAlign: "right",
                          }}
                        >
                          {formatPLN(cost)}
                        </Text>
                      )}
                      {reason ? (
                        <Text
                          style={{
                            color: COLORS.warning,
                            fontSize: 12,
                            marginTop: 4,
                          }}
                        >
                          Powód odchylenia: {reason}
                        </Text>
                      ) : null}
                    </View>
                  );
                },
              )
            )}
          </DetailSection>

          {report.extraCosts && report.extraCosts.length > 0 && (
            <DetailSection label="Koszty dodatkowe" count={report.extraCosts.length}>
              {report.extraCosts.map((cost) => (
                <View
                  key={cost.id}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingVertical: 5,
                  }}
                >
                  <Text
                    className="text-sm text-foreground"
                    numberOfLines={1}
                    style={{ flex: 1, marginRight: 8 }}
                  >
                    {cost.label}
                  </Text>
                  <Text
                    style={{
                      color: COLORS.foreground,
                      fontWeight: "700",
                      fontSize: 13,
                    }}
                  >
                    {cost.amount.toFixed(2)} zł
                  </Text>
                </View>
              ))}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingTop: 10,
                  marginTop: 6,
                  borderTopWidth: 1,
                  borderTopColor: COLORS.border,
                }}
              >
                <Text
                  style={{ color: COLORS.foreground, fontSize: 12, fontWeight: "800" }}
                  className="uppercase"
                >
                  Razem
                </Text>
                <Text
                  style={{ color: COLORS.primary, fontWeight: "800", fontSize: 15 }}
                >
                  {report.extraCosts
                    .reduce((sum, c) => sum + c.amount, 0)
                    .toFixed(2)}{" "}
                  zł
                </Text>
              </View>
            </DetailSection>
          )}

          <DetailSection
            label="Zespół"
            count={`${report.people.length} ${report.people.length === 1 ? "osoba" : "osoby"} · ${totalHours.toFixed(2)} godz.`}
          >
            {report.people.length === 0 ? (
              <Text className="text-sm text-muted py-1">
                Nie dodano osób do raportu.
              </Text>
            ) : (
              report.people.map((person, i) => {
                const employee = employees.find(
                  (e) => e.id === person.employeeId,
                );
                return (
                  <View
                    key={person.employeeId}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      paddingVertical: 8,
                      borderTopWidth: i > 0 ? 1 : 0,
                      borderTopColor: COLORS.border,
                    }}
                  >
                    <Text className="text-sm text-foreground">
                      {employee?.name || person.employeeId}
                    </Text>
                    <Text className="text-sm text-muted">
                      {person.start}–{person.end}
                    </Text>
                  </View>
                );
              })
            )}
          </DetailSection>

          {report.note && (
            <View
              style={{
                marginTop: 24,
                backgroundColor: COLORS.background,
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Text
                style={{ color: COLORS.muted, fontSize: 11, fontWeight: "800" }}
                className="uppercase"
              >
                Notatka brygadzisty
              </Text>
              <Text style={{ color: COLORS.foreground, fontSize: 13, marginTop: 6 }}>
                {report.note}
              </Text>
            </View>
          )}

          <View style={{ marginTop: 24 }}>
            {approved ? (
              <Text
                style={{
                  color: COLORS.success,
                  fontWeight: "700",
                  textAlign: "center",
                  paddingVertical: 6,
                }}
              >
                ✓ Raport zatwierdzony
              </Text>
            ) : (
              <Button label="Zatwierdź raport" onPress={onApprove} />
            )}
          </View>
        </View>
      )}
    </View>
  );
};

export type {
  Material,
  Build,
  BuildStatus,
  BuildSettlement,
  Assignment,
  Employee,
  TimeEntry,
  MaterialOrder,
  MaterialBatch,
  BadgeStatus,
};

export {
  COLORS,
  STATUS_STYLES,
  TIME_OPTIONS,
  UNIT_OPTIONS,
  todayISO,
  addDaysISO,
  todayLabelPL,
  formatPLN,
  Button,
  Field,
  QuantityStepper,
  ExtraCostsSection,
  TimeOptionsList,
  IconBadge,
  ReportStepper,
  ReportCard,
  StatusBadge,
  initialMaterials,
  initialBuilds,
  initialAssignments,
  initialEmployees,
  initialTimeEntries,
};
