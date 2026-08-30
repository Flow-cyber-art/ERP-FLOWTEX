import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  COLORS,
  Button,
  Field,
  confirmAction,
  formatPLN,
  IconBadge,
  QuantityStepper,
  StatusBadge,
  pluralPL,
} from "@/components/report-ui";
import { useAppData, type NewEmployeeInput, type NewTeamInput } from "@/contexts/app-data";
import {
  LEAVE_STATUS_BADGE,
  LEAVE_TYPE_LABELS,
  LeavePendingApprovals,
} from "@/components/screens/leave-screen";
import { AccountSettingsSection } from "@/components/account-settings-section";
import { WebPushSettingsSection } from "@/components/web-push-settings-section";
import type { AppRole } from "@/lib/data/auth";
import { signOut } from "@/lib/data/auth";
import {
  type AdminUser,
  createAdminUser,
  deleteAdminUser,
  isProtectedAdminEmail,
  listAdminUsers,
  setAdminUserDisplayName,
  setAdminUserEmail,
  setAdminUserPassword,
} from "@/lib/data/admin-users";

// Panel administracyjny — konfiguracja firmy, nie codzienna praca na
// budowie. Wszystko związane z pracownikiem (Zespół, stawki, konto
// logowania, Rozliczenie godzin, Obecności, Urlopy) mieszka teraz w
// osobnej zakładce nawigacji "HR" (patrz
// components/screens/hr-panel-screen.tsx, app/(tabs)/index.tsx) —
// AdminTeamSection/AdminLeaveSection zostają zdefiniowane w tym pliku (i
// eksportowane), żeby uniknąć przenoszenia dużych bloków kodu, ale
// renderuje je już tylko HrPanelScreen.
//
// Dawna osobna zakładka "Konta logowania" (email/hasło/rola OSOBNO od
// karty pracownika) została zlikwidowana — konto logowania jest teraz
// częścią karty pracownika w Zespole (AdminTeamSection), obok stawki:
// jeden pracownik, jedno miejsce edycji. Ta zakładka Admina ma już tylko
// Ustawienia firmy, więc pasek zakładek też znika.
export function AdminScreen() {
  return <AdminSettingsSection />;
}

// Sekcja na przyszłe ustawienia aplikacji. Stawka za km (Faza 7)
// przeniesiona do "Zespół i dniówka" (AdminTeamSection) — dniówka i
// stawka za km to ten sam rodzaj ustawienia (parametr rozliczeniowy),
// więc żyją razem. Wylogowanie celowo na samym końcu i z potwierdzeniem,
// żeby nie dało się go nacisnąć przez przypadek.
function AdminSettingsSection() {
  const {
    setDevRole,
    setTab,
    workdayHours,
    workdayHoursInput,
    kmRate,
    closeBuildPin,
    setWorkdayHoursInput,
    saveWorkdayHours,
    updateKmRate,
    updateCloseBuildPin,
  } = useAppData();

  const [workdayOpen, setWorkdayOpen] = useState(false);
  const [kmRateOpen, setKmRateOpen] = useState(false);
  const [kmRateInput, setKmRateInput] = useState(kmRate ? String(kmRate) : "");
  const [closeBuildPinOpen, setCloseBuildPinOpen] = useState(false);
  const [closeBuildPinInput, setCloseBuildPinInput] = useState(closeBuildPin ?? "");

  useEffect(() => {
    setKmRateInput(kmRate ? String(kmRate) : "");
  }, [kmRate]);

  useEffect(() => {
    setCloseBuildPinInput(closeBuildPin ?? "");
  }, [closeBuildPin]);

  return (
    <>
      {/* Dniówka, stawka za km i PIN zamknięcia budowy — jedna grupa
          parametrów rozliczeniowych firmy, jeden pod drugim (dawniej
          dniówka+km obok siebie w rzędzie — na mobile "Widok Brygadzisty"
          nad nimi wizualnie rozbijał tę grupę na dwie części). */}
      <Pressable
        onPress={() => {
          setWorkdayOpen(!workdayOpen);
          setKmRateOpen(false);
        }}
        className="bg-surface border border-border rounded-2xl overflow-hidden mb-3"
        style={{ flexDirection: "row", alignItems: "center", padding: 14 }}
      >
        <IconBadge name="schedule" size={18} />
        <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
          <Text style={{ color: COLORS.muted, fontSize: 11 }}>DNIÓWKA</Text>
          <Text
            style={{
              color: COLORS.foreground,
              fontWeight: "700",
              fontSize: 15,
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            {workdayHours} h / dzień
          </Text>
        </View>
        <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}>
          {workdayOpen ? "Zwiń" : "Zmień"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          setKmRateOpen(!kmRateOpen);
          setWorkdayOpen(false);
        }}
        className="bg-surface border border-border rounded-2xl overflow-hidden mb-3"
        style={{ flexDirection: "row", alignItems: "center", padding: 14 }}
      >
        <IconBadge name="directions-car" size={18} />
        <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
          <Text style={{ color: COLORS.muted, fontSize: 11 }}>STAWKA ZA KM</Text>
          <Text
            style={{
              color: COLORS.foreground,
              fontWeight: "700",
              fontSize: 15,
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            {kmRate.toFixed(2)} zł/km
          </Text>
        </View>
        <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}>
          {kmRateOpen ? "Zwiń" : "Zmień"}
        </Text>
      </Pressable>

      {workdayOpen && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-3">
          <Text className="text-xs text-muted uppercase mb-2">Dniówka (godz./dzień)</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <QuantityStepper
              value={workdayHoursInput}
              onChangeText={setWorkdayHoursInput}
            />
            <Text style={{ color: COLORS.muted }}>h / dzień</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Anuluj"
                secondary
                onPress={() => {
                  setWorkdayHoursInput(String(workdayHours));
                  setWorkdayOpen(false);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Zapisz"
                onPress={() => {
                  saveWorkdayHours();
                  setWorkdayOpen(false);
                }}
              />
            </View>
          </View>
        </View>
      )}

      {kmRateOpen && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-3">
          <Text className="text-xs text-muted uppercase mb-2">Stawka za km</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <QuantityStepper
              value={kmRateInput}
              onChangeText={setKmRateInput}
              step={0.5}
            />
            <Text style={{ color: COLORS.muted }}>zł / km</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Anuluj"
                secondary
                onPress={() => {
                  setKmRateInput(kmRate ? String(kmRate) : "");
                  setKmRateOpen(false);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Zapisz"
                onPress={async () => {
                  const value = Number(kmRateInput.replace(",", "."));
                  if (Number.isNaN(value) || value < 0) return;
                  await updateKmRate(value);
                  setKmRateOpen(false);
                }}
              />
            </View>
          </View>
        </View>
      )}

      {/* PIN zabezpieczający "Zamknij (i rozlicz) budowę" (patrz
          builds-screen.tsx) — ten sam wzorzec co Stawka za km wyżej. Puste
          pole = zabezpieczenie wyłączone (updateCloseBuildPin zapisuje
          wtedy null, patrz lib/data/settings.ts). */}
      <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-4">
        <Pressable
          onPress={() => setCloseBuildPinOpen(!closeBuildPinOpen)}
          style={{ flexDirection: "row", alignItems: "center", padding: 14 }}
        >
          <IconBadge name="lock" size={18} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: COLORS.muted, fontSize: 11 }}>
              PIN ZAMKNIĘCIA BUDOWY
            </Text>
            <Text
              style={{
                color: COLORS.foreground,
                fontWeight: "700",
                fontSize: 15,
                marginTop: 2,
              }}
            >
              {closeBuildPin ? "Włączony" : "Wyłączony"}
            </Text>
          </View>
          <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}>
            {closeBuildPinOpen ? "Zwiń" : "Zmień"}
          </Text>
        </Pressable>
        {closeBuildPinOpen && (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: COLORS.border,
              padding: 14,
            }}
          >
            <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 8 }}>
              Wpisany tu PIN będzie wymagany przy zamykaniu i rozliczaniu
              budowy. Zostaw puste, żeby wyłączyć zabezpieczenie.
            </Text>
            <Field
              placeholder="np. 1234 (puste = wyłączony)"
              value={closeBuildPinInput}
              onChangeText={setCloseBuildPinInput}
              keyboardType="number-pad"
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label="Anuluj"
                  secondary
                  onPress={() => {
                    setCloseBuildPinInput(closeBuildPin ?? "");
                    setCloseBuildPinOpen(false);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Zapisz"
                  onPress={async () => {
                    await updateCloseBuildPin(closeBuildPinInput);
                    setCloseBuildPinOpen(false);
                  }}
                />
              </View>
            </View>
          </View>
        )}
      </View>

      {/* "Widok Brygadzisty" — Admin bywa na budowie i chce od razu
          wypełnić raport dzienny bez zakładania osobnego konta
          brygadzisty. Przełącza tylko lokalny, nietrwały `devRole`
          (widok UI) — backend i tak autoryzuje Admina do wszystkiego, co
          może zrobić Brygadzista (submit_daily_report itd.), więc to
          czysto kosmetyczne uproszczenie ekranu, nie zmiana uprawnień.
          Powrót: zakładka "Admin" w widoku Brygadzisty pokazuje
          Ustawienia z przyciskiem "Wróć do widoku Admina" (patrz
          settings-screen.tsx + realRole w app-data.tsx). Celowo POD
          parametrami rozliczeniowymi (dniówka/km/PIN) wyżej — to osobna,
          drugorzędna akcja, nie konfiguracja firmy. */}
      <View
        className="bg-surface border border-border rounded-2xl p-4 mb-4"
        style={{ alignItems: "center" }}
      >
        <Button
          label="Zmień na widok Brygadzisty"
          secondary
          onPress={() => {
            setDevRole("Brygadzista");
            setTab("savedReports");
          }}
        />
      </View>

      <AccountSettingsSection />
      <WebPushSettingsSection />
      <View className="bg-surface border border-border rounded-2xl p-4 mt-4">
        <Button
          label="Wyloguj"
          secondary
          onPress={() =>
            confirmAction(
              "Wylogować się?",
              "Będzie trzeba zalogować się ponownie.",
              "Wyloguj",
              () => {
                signOut();
              },
            )
          }
        />
      </View>
    </>
  );
}

const EMPTY_NEW_EMPLOYEE: NewEmployeeInput = {
  name: "",
  role: "Pracownik",
  hourlyRate: "",
  costRate: "",
};

const TEAM_COL_NUMERIC = { flex: 1, textAlign: "right" as const };
const TEAM_TABLE_HEADER_STYLE = {
  color: COLORS.muted,
  fontSize: 10,
  fontWeight: "700" as const,
  flex: 2,
};
const TEAM_CELL_STYLE = { color: COLORS.foreground, fontSize: 12, fontWeight: "700" as const };

export function AdminTeamSection() {
  const {
    workdayHours,
    employees,
    saveEmployee,
    updateEmployeeName,
    updateEmployeeRate,
    updateEmployeeCostRate,
    setEmployeeActive,
  } = useAppData();

  const [newEmployee, setNewEmployee] = useState<NewEmployeeInput>(EMPTY_NEW_EMPLOYEE);
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [rateInput, setRateInput] = useState("");
  const [costRateInput, setCostRateInput] = useState("");
  // Archiwizacja — ten sam wzorzec co showArchivedMaterials w
  // warehouse-screen.tsx: pracownik nie jest usuwany (ma historię
  // raportów/urlopów/wpisów czasu), tylko chowany z domyślnej listy.
  const [showArchived, setShowArchived] = useState(false);
  const visibleEmployees = employees.filter((e) => showArchived || e.active);

  // Konto logowania — dawniej osobna zakładka "Konta logowania"
  // (AdminAccountsSection, usunięta), teraz część karty pracownika: jeden
  // pracownik = jedno miejsce edycji (imię, stawka, email, hasło).
  // employeeId (number) w AdminUser wiąże konto z konkretnym wierszem
  // employees — jeden pracownik ma co najwyżej jedno konto.
  const [accounts, setAccounts] = useState<AdminUser[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountEmailInput, setAccountEmailInput] = useState("");
  const [accountPasswordInput, setAccountPasswordInput] = useState("");
  const [accountEditingPassword, setAccountEditingPassword] = useState(false);

  const reloadAccounts = () => {
    setAccountsError(null);
    listAdminUsers()
      .then(setAccounts)
      .catch((err) => setAccountsError(err instanceof Error ? err.message : "Błąd."));
  };
  useEffect(reloadAccounts, []);

  const accountFor = (employeeId: string) =>
    accounts?.find((u) => u.employeeId === Number(employeeId)) ?? null;

  return (
    <>
      {/* Zespół — nagłówek z licznikiem i przyciskiem dodawania, lista jako
          jeden kontener z wierszami zamiast osobnej karty na osobę.
          Dniówka/stawka za km/PIN zamknięcia budowy — patrz zakładka
          Admin → Ustawienia (AdminSettingsSection): to konfiguracja
          firmy, nie samych pracowników. */}
      <View className="flex-row justify-between items-center mb-3">
        <Text className="text-base font-bold text-foreground">
          Zespół ({visibleEmployees.filter((e) => e.active).length})
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Pressable
            onPress={() => setShowArchived(!showArchived)}
            hitSlop={8}
            style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: showArchived ? COLORS.primary : COLORS.border,
                backgroundColor: showArchived ? COLORS.primary : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {showArchived && (
                <Text style={{ color: COLORS.background, fontSize: 10, fontWeight: "800" }}>
                  ✓
                </Text>
              )}
            </View>
            <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "600" }}>
              Archiwum
            </Text>
          </Pressable>
          <Pressable onPress={() => setAddEmployeeOpen(!addEmployeeOpen)}>
            <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
              {addEmployeeOpen ? "Anuluj" : "+ Dodaj pracownika"}
            </Text>
          </Pressable>
        </View>
      </View>

      {addEmployeeOpen && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-3">
          <Field
            placeholder="Imię i nazwisko"
            value={newEmployee.name}
            onChangeText={(value: string) =>
              setNewEmployee({ ...newEmployee, name: value })
            }
          />
          <View
            style={{ flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" }}
          >
            {["Brygadzista", "Pracownik"].map((role) => (
              <Pressable
                key={role}
                onPress={() => setNewEmployee({ ...newEmployee, role })}
                style={{
                  backgroundColor:
                    newEmployee.role === role
                      ? COLORS.primary
                      : COLORS.background,
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor:
                    newEmployee.role === role ? COLORS.primary : COLORS.border,
                }}
              >
                <Text
                  style={{
                    color:
                      newEmployee.role === role
                        ? COLORS.background
                        : COLORS.foreground,
                    fontWeight: "700",
                  }}
                >
                  {role}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ marginTop: 10 }}>
            <Text className="text-xs text-muted uppercase mb-2">
              Stawka godzinowa (PLN/h) — wypłata
            </Text>
            <QuantityStepper
              value={newEmployee.hourlyRate}
              onChangeText={(value: string) =>
                setNewEmployee({ ...newEmployee, hourlyRate: value })
              }
            />
          </View>
          <View style={{ marginTop: 10 }}>
            <Text className="text-xs text-muted uppercase mb-2">
              Stawka kosztowa (PLN/h) — koszt budowy
            </Text>
            <QuantityStepper
              value={newEmployee.costRate}
              onChangeText={(value: string) =>
                setNewEmployee({ ...newEmployee, costRate: value })
              }
            />
          </View>
          <View style={{ marginTop: 10 }}>
            <Button
              label="Dodaj pracownika"
              onPress={() => {
                saveEmployee(newEmployee, () => setNewEmployee(EMPTY_NEW_EMPLOYEE));
                setAddEmployeeOpen(false);
              }}
            />
          </View>
        </View>
      )}

      {visibleEmployees.length === 0 && (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-5">
          <Text className="text-sm text-muted">
            {showArchived ? "Brak zarchiwizowanych pracowników." : "Brak dodanych pracowników."}
          </Text>
        </View>
      )}
      {visibleEmployees.length > 0 && (
        <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-5">
          {/* Nagłówek tabeli — jeden użytkownik (właściciel), który zna
              swoich ludzi, korzysta na porównaniu stawek w pionie, czego
              karty nie dają. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: COLORS.border,
            }}
          >
            <Text style={TEAM_TABLE_HEADER_STYLE}>PRACOWNIK</Text>
            <Text style={[TEAM_TABLE_HEADER_STYLE, TEAM_COL_NUMERIC]}>DNIÓWKA</Text>
            <Text style={[TEAM_TABLE_HEADER_STYLE, TEAM_COL_NUMERIC]}>STAWKA</Text>
            <Text style={[TEAM_TABLE_HEADER_STYLE, TEAM_COL_NUMERIC]}>KOSZT BUDOWY</Text>
            <View style={{ width: 28 }} />
          </View>
          {visibleEmployees.map((employee, i) => {
            const editing = editingRateId === employee.id;
            // Heurystyka: brak spacji w imieniu = najpewniej wpisano samo
            // imię bez nazwiska — sygnał do uzupełnienia kartoteki, nie
            // twarda walidacja (może się mylić przy pseudonimach).
            const missingLastName = !employee.name.trim().includes(" ");
            return (
              <View
                key={employee.id}
                style={{
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: COLORS.border,
                  opacity: employee.active ? 1 : 0.5,
                }}
              >
                <Pressable
                  onPress={() => {
                    if (editing) {
                      setEditingRateId(null);
                    } else {
                      setEditingRateId(employee.id);
                      setNameInput(employee.name);
                      setRateInput(String(employee.hourlyRate || ""));
                      setCostRateInput(String(employee.costRate || ""));
                      setAccountEmailInput(accountFor(employee.id)?.email ?? "");
                      setAccountPasswordInput("");
                      setAccountEditingPassword(false);
                    }
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    minHeight: 44,
                  }}
                >
                  <View style={{ flex: 2, minWidth: 0, paddingRight: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Text
                        className="text-sm font-bold text-foreground"
                        numberOfLines={1}
                      >
                        {employee.name}
                      </Text>
                      {missingLastName && (
                        <Text style={{ color: COLORS.warning, fontSize: 12 }}>⚠</Text>
                      )}
                    </View>
                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 1 }}>
                      {employee.role}
                      {!employee.active ? " · zarchiwizowany" : ""}
                    </Text>
                  </View>
                  <Text style={[TEAM_CELL_STYLE, TEAM_COL_NUMERIC]} numberOfLines={1}>
                    {formatPLN(workdayHours * (employee.hourlyRate || 0))}
                  </Text>
                  <Text style={[TEAM_CELL_STYLE, TEAM_COL_NUMERIC]} numberOfLines={1}>
                    {formatPLN(employee.hourlyRate || 0)}/h
                  </Text>
                  <Text style={[TEAM_CELL_STYLE, TEAM_COL_NUMERIC]} numberOfLines={1}>
                    {employee.costRate ? `${formatPLN(employee.costRate)}/h` : "—"}
                  </Text>
                  <Text style={{ width: 28, textAlign: "right", color: COLORS.muted, fontSize: 16 }}>
                    ⋯
                  </Text>
                </Pressable>
                {editing && (
                  <View
                    style={{
                      paddingHorizontal: 14,
                      paddingBottom: 14,
                    }}
                  >
                    <Text className="text-xs text-muted uppercase mb-2">
                      Imię i nazwisko
                    </Text>
                    <Field
                      placeholder="Imię i nazwisko"
                      value={nameInput}
                      onChangeText={setNameInput}
                    />
                    <Text
                      className="text-xs text-muted uppercase mb-2"
                      style={{ marginTop: 10 }}
                    >
                      Stawka godzinowa (PLN/h) — wypłata
                    </Text>
                    <QuantityStepper value={rateInput} onChangeText={setRateInput} />
                    <Text
                      className="text-xs text-muted uppercase mb-2"
                      style={{ marginTop: 10 }}
                    >
                      Stawka kosztowa (PLN/h) — koszt budowy
                    </Text>
                    <QuantityStepper
                      value={costRateInput}
                      onChangeText={setCostRateInput}
                    />
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                      <Pressable
                        onPress={() => setEditingRateId(null)}
                        style={{
                          flex: 1,
                          borderRadius: 10,
                          paddingHorizontal: 16,
                          paddingVertical: 12,
                          justifyContent: "center",
                          alignItems: "center",
                          borderWidth: 1,
                          borderColor: COLORS.border,
                        }}
                      >
                        <Text style={{ color: COLORS.muted, fontWeight: "700" }}>
                          Anuluj
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          const trimmedName = nameInput.trim();
                          if (trimmedName && trimmedName !== employee.name) {
                            updateEmployeeName(employee.id, trimmedName);
                            const account = accountFor(employee.id);
                            if (account) {
                              setAdminUserDisplayName(account.id, trimmedName).catch(() => {
                                // Samo imię w kartotece i tak się zapisało —
                                // brak synchronizacji z nazwą konta logowania
                                // (np. chwilowy błąd sieci) nie blokuje reszty.
                              });
                            }
                          }
                          updateEmployeeRate(employee.id, Number(rateInput) || 0);
                          updateEmployeeCostRate(employee.id, Number(costRateInput) || 0);
                          setEditingRateId(null);
                        }}
                        style={{
                          flex: 1,
                          backgroundColor: COLORS.primary,
                          borderRadius: 10,
                          paddingHorizontal: 16,
                          paddingVertical: 12,
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ color: COLORS.background, fontWeight: "700" }}>
                          Zapisz
                        </Text>
                      </Pressable>
                    </View>

                    {/* Konto logowania — dawna osobna zakładka "Konta
                        logowania" (email/hasło/rola OSOBNO od karty
                        pracownika) zostaje zlikwidowana: jeden pracownik,
                        jedno miejsce edycji. Rola konta = employee.role
                        (Pracownik/Brygadzista) automatycznie — podniesienie
                        do Admina nie ma tu odpowiednika w kartotece
                        pracownika, więc zostaje poza tym widokiem. */}
                    {(() => {
                      const account = accountFor(employee.id);
                      const protectedAccount = isProtectedAdminEmail(account?.email);
                      return (
                        <View
                          style={{
                            marginTop: 12,
                            paddingTop: 12,
                            borderTopWidth: 1,
                            borderTopColor: COLORS.border,
                          }}
                        >
                          <Text className="text-xs text-muted uppercase mb-2">
                            Konto logowania
                          </Text>
                          {protectedAccount ? (
                            <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                              {account!.email} · konto główne administratora — email i hasło
                              zmienia się wyłącznie przez samoobsługę.
                            </Text>
                          ) : account ? (
                            <>
                              <Field
                                placeholder="Email logowania"
                                value={accountEmailInput}
                                onChangeText={setAccountEmailInput}
                                autoCapitalize="none"
                                keyboardType="email-address"
                              />
                              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                                <View style={{ flex: 1 }}>
                                  <Button
                                    label="Zapisz email"
                                    secondary
                                    disabled={accountBusy}
                                    onPress={async () => {
                                      const email = accountEmailInput.trim();
                                      if (!email) return;
                                      setAccountBusy(true);
                                      setAccountsError(null);
                                      try {
                                        await setAdminUserEmail(account.id, email);
                                        reloadAccounts();
                                      } catch (err) {
                                        setAccountsError(
                                          err instanceof Error ? err.message : "Błąd.",
                                        );
                                      } finally {
                                        setAccountBusy(false);
                                      }
                                    }}
                                  />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Button
                                    label={accountEditingPassword ? "Anuluj" : "Zmień hasło"}
                                    secondary
                                    onPress={() => {
                                      setAccountEditingPassword(!accountEditingPassword);
                                      setAccountPasswordInput("");
                                    }}
                                  />
                                </View>
                              </View>
                              {accountEditingPassword && (
                                <View style={{ marginTop: 8 }}>
                                  <Field
                                    placeholder="Nowe hasło (min. 10 znaków)"
                                    value={accountPasswordInput}
                                    onChangeText={setAccountPasswordInput}
                                    autoCapitalize="none"
                                    secureTextEntry
                                  />
                                  <View style={{ marginTop: 8 }}>
                                    <Button
                                      label={accountBusy ? "Zapisywanie…" : "Zapisz hasło"}
                                      disabled={accountBusy}
                                      onPress={async () => {
                                        if (accountPasswordInput.length < 10) {
                                          setAccountsError(
                                            "Hasło musi mieć co najmniej 10 znaków.",
                                          );
                                          return;
                                        }
                                        setAccountBusy(true);
                                        setAccountsError(null);
                                        try {
                                          await setAdminUserPassword(
                                            account.id,
                                            accountPasswordInput,
                                          );
                                          setAccountEditingPassword(false);
                                          setAccountPasswordInput("");
                                        } catch (err) {
                                          setAccountsError(
                                            err instanceof Error ? err.message : "Błąd.",
                                          );
                                        } finally {
                                          setAccountBusy(false);
                                        }
                                      }}
                                    />
                                  </View>
                                </View>
                              )}
                              <View style={{ marginTop: 10 }}>
                                <Pressable
                                  onPress={() =>
                                    confirmAction(
                                      "Usuń konto logowania",
                                      `${employee.name} straci dostęp do logowania. Kartoteka pracownika (stawka, historia) zostaje bez zmian.`,
                                      "Usuń konto",
                                      async () => {
                                        try {
                                          await deleteAdminUser(account.id);
                                          reloadAccounts();
                                        } catch (err) {
                                          setAccountsError(
                                            err instanceof Error ? err.message : "Błąd.",
                                          );
                                        }
                                      },
                                    )
                                  }
                                >
                                  <Text
                                    style={{ color: COLORS.danger, fontWeight: "700", fontSize: 12 }}
                                  >
                                    Usuń konto logowania
                                  </Text>
                                </Pressable>
                              </View>
                            </>
                          ) : (
                            <>
                              <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 8 }}>
                                Ten pracownik nie ma jeszcze konta logowania.
                              </Text>
                              <Field
                                placeholder="Email logowania"
                                value={accountEmailInput}
                                onChangeText={setAccountEmailInput}
                                autoCapitalize="none"
                                keyboardType="email-address"
                              />
                              <View style={{ marginTop: 8 }}>
                                <Field
                                  placeholder="Hasło (min. 10 znaków)"
                                  value={accountPasswordInput}
                                  onChangeText={setAccountPasswordInput}
                                  autoCapitalize="none"
                                  secureTextEntry
                                />
                              </View>
                              <View style={{ marginTop: 8 }}>
                                <Button
                                  label={accountBusy ? "Tworzenie…" : "Utwórz konto logowania"}
                                  disabled={accountBusy}
                                  onPress={async () => {
                                    const email = accountEmailInput.trim();
                                    if (!email || accountPasswordInput.length < 10) {
                                      setAccountsError(
                                        "Email i hasło (min. 10 znaków) są wymagane.",
                                      );
                                      return;
                                    }
                                    setAccountBusy(true);
                                    setAccountsError(null);
                                    try {
                                      const created = await createAdminUser(
                                        email,
                                        accountPasswordInput,
                                        employee.role as AppRole,
                                        employee.id,
                                      );
                                      await setAdminUserDisplayName(created.id, employee.name).catch(
                                        () => {},
                                      );
                                      setAccountPasswordInput("");
                                      reloadAccounts();
                                    } catch (err) {
                                      setAccountsError(
                                        err instanceof Error ? err.message : "Błąd.",
                                      );
                                    } finally {
                                      setAccountBusy(false);
                                    }
                                  }}
                                />
                              </View>
                            </>
                          )}
                          {accountsError && (
                            <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 8 }}>
                              {accountsError}
                            </Text>
                          )}
                        </View>
                      );
                    })()}

                    <Pressable
                      onPress={() =>
                        employee.active
                          ? confirmAction(
                              "Zarchiwizować pracownika?",
                              `${employee.name} zniknie z domyślnej listy Zespołu. Historia (raporty, godziny, urlopy) zostaje, a pracownika można później przywrócić z widoku "Archiwum".`,
                              "Archiwizuj",
                              () => setEmployeeActive(employee.id, false),
                            )
                          : setEmployeeActive(employee.id, true)
                      }
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTopWidth: 1,
                        borderTopColor: COLORS.border,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: employee.active ? COLORS.warning : COLORS.primary,
                          fontWeight: "700",
                          fontSize: 13,
                        }}
                      >
                        {employee.active ? "Archiwizuj pracownika" : "Przywróć pracownika"}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <AdminTeamsSubsection />
    </>
  );
}

// HR — Urlopy: pula dni urlopowych per pracownik (edytowalna, bo staż
// pracy nie jest nigdzie śledzony) + wszystkie wnioski do wglądu/decyzji.
// Zatwierdzanie samo w sobie może zrobić też Brygadzista (patrz
// team-time-screen.tsx) — Admin dodatkowo widzi historię i ustawia pulę.
// Tylko te dwa typy zużywają roczną pulę dni (polskie prawo pracy: urlop
// na żądanie to 4 dni Z puli urlopu wypoczynkowego, nie osobna pula) —
// ta sama reguła co w leave-screen.tsx (POOL_TYPES).
const LEAVE_POOL_TYPES = ["wypoczynkowy", "na_zadanie"];
const LEAVE_HISTORY_FILTERS = [
  ["all", "Wszystkie"],
  ["zatwierdzony", "Zatwierdzone"],
  ["odrzucony", "Odrzucone"],
  ["anulowany", "Anulowane"],
] as const;

export function AdminLeaveSection() {
  const { employees, leaveRequests, updateEmployeeLeaveDays } = useAppData();
  const [editingPoolId, setEditingPoolId] = useState<string | null>(null);
  const [poolInput, setPoolInput] = useState("");
  const [historyFilter, setHistoryFilter] =
    useState<(typeof LEAVE_HISTORY_FILTERS)[number][0]>("all");

  const currentYear = new Date().getFullYear();

  // Kolizje: dwóch lub więcej pracowników z zatwierdzonym/oczekującym
  // urlopem nakładającym się w czasie — realny problem planistyczny
  // (kto zostaje na budowie), nie tylko limit dni. Model apki to jedna
  // brygada, więc kolizja jest firmowa, nie "w obrębie zespołu".
  const collisions = useMemo(() => {
    const relevant = leaveRequests.filter(
      (r) => r.status === "zatwierdzony" || r.status === "oczekujący",
    );
    const found: { from: string; to: string; names: string[] }[] = [];
    for (let i = 0; i < relevant.length; i++) {
      for (let j = i + 1; j < relevant.length; j++) {
        const a = relevant[i];
        const b = relevant[j];
        if (a.employeeId === b.employeeId) continue;
        const from = a.dateFrom > b.dateFrom ? a.dateFrom : b.dateFrom;
        const to = a.dateTo < b.dateTo ? a.dateTo : b.dateTo;
        if (from > to) continue;
        const nameA = employees.find((e) => e.id === a.employeeId)?.name || "Pracownik";
        const nameB = employees.find((e) => e.id === b.employeeId)?.name || "Pracownik";
        found.push({ from, to, names: [nameA, nameB] });
      }
    }
    return found;
  }, [leaveRequests, employees]);

  const decidedRequests = leaveRequests
    .filter((r) => r.status !== "oczekujący")
    .filter((r) => historyFilter === "all" || r.status === historyFilter)
    .sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || ""))
    .slice(0, 20);

  return (
    <>
      <LeavePendingApprovals />

      <Text className="text-lg font-bold text-foreground mb-3">
        Pula urlopowa — {currentYear}
      </Text>
      <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-5">
        {employees.map((employee, i) => {
          const limit = employee.leaveDaysPerYear ?? 26;
          const used = leaveRequests
            .filter(
              (r) =>
                r.employeeId === employee.id &&
                r.status === "zatwierdzony" &&
                LEAVE_POOL_TYPES.includes(r.type) &&
                new Date(r.dateFrom).getFullYear() === currentYear,
            )
            .reduce((sum, r) => sum + r.businessDays, 0);
          const remaining = Math.max(0, limit - used);
          const usedFraction = limit > 0 ? Math.min(1, used / limit) : 0;
          return (
            <View
              key={employee.id}
              style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: COLORS.border }}
            >
              <Pressable
                onPress={() => {
                  if (editingPoolId === employee.id) {
                    setEditingPoolId(null);
                  } else {
                    setEditingPoolId(employee.id);
                    setPoolInput(String(limit));
                  }
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                }}
              >
                <View style={{ flex: 1.4, minWidth: 0, paddingRight: 8 }}>
                  <Text
                    style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 14 }}
                    numberOfLines={1}
                  >
                    {employee.name}
                  </Text>
                  <View
                    style={{
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: COLORS.background,
                      overflow: "hidden",
                      marginTop: 6,
                    }}
                  >
                    {usedFraction > 0 && (
                      <View
                        style={{
                          width: `${usedFraction * 100}%`,
                          height: "100%",
                          backgroundColor:
                            usedFraction >= 1 ? COLORS.warning : COLORS.primary,
                          borderRadius: 3,
                        }}
                      />
                    )}
                  </View>
                  <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 4 }}>
                    {used}/{limit} wykorzystane
                  </Text>
                </View>
                <Text
                  style={{
                    flex: 1,
                    textAlign: "right",
                    color: COLORS.foreground,
                    fontWeight: "700",
                    fontSize: 14,
                  }}
                >
                  {remaining} dni
                </Text>
              </Pressable>
              {editingPoolId === employee.id && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                  <Text className="text-xs text-muted uppercase mb-2">Pula dni na rok</Text>
                  <QuantityStepper value={poolInput} onChangeText={setPoolInput} step={1} />
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button label="Anuluj" secondary onPress={() => setEditingPoolId(null)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Zapisz"
                        onPress={() => {
                          updateEmployeeLeaveDays(employee.id, Number(poolInput) || 0);
                          setEditingPoolId(null);
                        }}
                      />
                    </View>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {collisions.length > 0 && (
        <View
          className="rounded-2xl p-4 mb-5"
          style={{ backgroundColor: COLORS.warningBg, borderWidth: 1, borderColor: COLORS.warning }}
        >
          <Text style={{ color: COLORS.warning, fontWeight: "700", fontSize: 13, marginBottom: 4 }}>
            ⚠ Nakładające się urlopy
          </Text>
          {collisions.map((c, i) => (
            <Text key={i} style={{ color: COLORS.warning, fontSize: 12, marginTop: i > 0 ? 4 : 0 }}>
              {c.from} – {c.to} · {c.names.join(" i ")} poza pracą jednocześnie
            </Text>
          ))}
        </View>
      )}

      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <Text className="text-lg font-bold text-foreground">Historia wniosków</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {LEAVE_HISTORY_FILTERS.map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => setHistoryFilter(value)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: historyFilter === value ? COLORS.primary : COLORS.border,
              backgroundColor: historyFilter === value ? COLORS.primary : "transparent",
            }}
          >
            <Text
              style={{
                color: historyFilter === value ? COLORS.background : COLORS.muted,
                fontWeight: "700",
                fontSize: 12,
              }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {decidedRequests.length === 0 ? (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-5">
          <Text className="text-sm text-muted">Brak wniosków dla wybranego filtra.</Text>
        </View>
      ) : (
        decidedRequests.map((r) => {
          const badge = LEAVE_STATUS_BADGE[r.status] ?? LEAVE_STATUS_BADGE.oczekujący;
          return (
            <View
              key={r.id}
              className="bg-surface border border-border rounded-2xl p-4 mb-3"
              style={{ flexDirection: "row", alignItems: "flex-start" }}
            >
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text className="text-sm font-bold text-foreground">
                  {employees.find((e) => e.id === r.employeeId)?.name || "Pracownik"} ·{" "}
                  {LEAVE_TYPE_LABELS[r.type]}
                </Text>
                <Text className="text-xs text-muted mt-1">
                  {r.dateFrom}
                  {r.dateFrom !== r.dateTo ? ` – ${r.dateTo}` : ""} · {r.businessDays} dni
                </Text>
              </View>
              <StatusBadge status={badge.status} label={badge.label} />
            </View>
          );
        })
      )}
    </>
  );
}

// Brygady i ich skład — patrz supabase/sql/040_planowany_koszt_
// robocizny.sql. Wcześniej `teams` istniała w bazie (lider budowy), ale
// bez UI i bez polityki zapisu — członkostwo (team_members) jest tu
// zupełnie nowe. Wzorzec identyczny jak lista pracowników wyżej: nagłówek
// z licznikiem + "+ Dodaj", lista jako jeden kontener z wierszami.
const EMPTY_NEW_TEAM: NewTeamInput = { name: "", leadEmployeeId: "" };

function AdminTeamsSubsection() {
  const {
    teams,
    teamMembers,
    employees,
    saveTeam,
    addTeamMember,
    removeTeamMember,
  } = useAppData();

  const [newTeam, setNewTeam] = useState<NewTeamInput>(EMPTY_NEW_TEAM);
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<number | null>(null);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);

  return (
    <>
      <View className="flex-row justify-between items-center mb-3 mt-2">
        <Text className="text-base font-bold text-foreground">
          Brygady ({teams.length})
        </Text>
        <Pressable onPress={() => setAddTeamOpen(!addTeamOpen)}>
          <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
            {addTeamOpen ? "Anuluj" : "+ Dodaj brygadę"}
          </Text>
        </Pressable>
      </View>

      {addTeamOpen && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-3">
          <Field
            placeholder="Nazwa brygady"
            value={newTeam.name}
            onChangeText={(value: string) => setNewTeam({ ...newTeam, name: value })}
          />
          <Text className="text-xs text-muted uppercase mb-2 mt-3">
            Lider (opcjonalnie)
          </Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {employees.map((e) => (
              <Pressable
                key={e.id}
                onPress={() =>
                  setNewTeam({
                    ...newTeam,
                    leadEmployeeId: e.id === newTeam.leadEmployeeId ? "" : e.id,
                  })
                }
                style={{
                  backgroundColor:
                    e.id === newTeam.leadEmployeeId ? COLORS.primary : COLORS.background,
                  borderRadius: 8,
                  paddingHorizontal: 9,
                  paddingVertical: 7,
                  borderWidth: 1,
                  borderColor:
                    e.id === newTeam.leadEmployeeId ? COLORS.primary : COLORS.border,
                }}
              >
                <Text
                  style={{
                    color: e.id === newTeam.leadEmployeeId ? COLORS.background : COLORS.foreground,
                    fontWeight: "700",
                    fontSize: 12,
                  }}
                >
                  {e.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ marginTop: 10 }}>
            <Button
              label="Dodaj brygadę"
              onPress={() => {
                saveTeam(newTeam, () => setNewTeam(EMPTY_NEW_TEAM));
                setAddTeamOpen(false);
              }}
            />
          </View>
        </View>
      )}

      {teams.length === 0 && (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-5">
          <Text className="text-sm text-muted">Brak dodanych brygad.</Text>
        </View>
      )}
      {teams.length > 0 && (
        <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-5">
          {teams.map((team, i) => {
            const members = teamMembers.filter((m) => m.teamId === team.id);
            const expanded = expandedTeamId === team.id;
            return (
              <View
                key={team.id}
                style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: COLORS.border }}
              >
                <Pressable
                  onPress={() => {
                    setExpandedTeamId(expanded ? null : team.id);
                    setMemberPickerOpen(false);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  }}
                >
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                      {team.name}
                    </Text>
                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                      {members.length} {pluralPL(members.length, "osoba", "osoby", "osób")}
                    </Text>
                  </View>
                  <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
                    {expanded ? "▲" : "▼"}
                  </Text>
                </Pressable>
                {expanded && (
                  <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                    {members.length === 0 && (
                      <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 8 }}>
                        Brak przypisanych pracowników.
                      </Text>
                    )}
                    {members.map((m) => {
                      const employee = employees.find((e) => e.id === String(m.employeeId));
                      return (
                        <View
                          key={m.employeeId}
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            paddingVertical: 4,
                          }}
                        >
                          <Text style={{ color: COLORS.foreground, fontSize: 13 }}>
                            {employee?.name ?? "Pracownik usunięty"}
                          </Text>
                          <Pressable onPress={() => removeTeamMember(team.id, m.employeeId)}>
                            <Text style={{ color: COLORS.danger, fontSize: 12, fontWeight: "700" }}>
                              Usuń
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })}
                    <Pressable
                      onPress={() => setMemberPickerOpen(!memberPickerOpen)}
                      style={{ marginTop: 8 }}
                    >
                      <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
                        {memberPickerOpen ? "Anuluj" : "+ Dodaj pracownika"}
                      </Text>
                    </Pressable>
                    {memberPickerOpen && (
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 6,
                          flexWrap: "wrap",
                          marginTop: 8,
                        }}
                      >
                        {employees
                          .filter((e) => !members.some((m) => String(m.employeeId) === e.id))
                          .map((e) => (
                            <Pressable
                              key={e.id}
                              onPress={() => {
                                addTeamMember(team.id, Number(e.id));
                                setMemberPickerOpen(false);
                              }}
                              style={{
                                backgroundColor: COLORS.background,
                                borderRadius: 8,
                                paddingHorizontal: 9,
                                paddingVertical: 7,
                                borderWidth: 1,
                                borderColor: COLORS.border,
                              }}
                            >
                              <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 12 }}>
                                {e.name}
                              </Text>
                            </Pressable>
                          ))}
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </>
  );
}
