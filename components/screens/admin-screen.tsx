import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  COLORS,
  Button,
  Field,
  confirmAction,
  formatPLN,
  IconBadge,
  QuantityStepper,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";
import { HrSection } from "@/components/screens/hr-screen";
import { AccountSettingsSection } from "@/components/account-settings-section";
import type { AppRole } from "@/lib/data/auth";
import { signOut } from "@/lib/data/auth";
import {
  type AdminUser,
  createAdminUser,
  deleteAdminUser,
  isProtectedAdminEmail,
  listAdminUsers,
  setAdminUserPassword,
  setAdminUserRole,
} from "@/lib/data/admin-users";

// Panel administracyjny, HR i konta logowania były wcześniej (albo w
// koncepcji, albo w kodzie) osobnymi zakładkami nawigacji, mimo że
// wszystkie dotyczą tego samego: jak firma jest skonfigurowana, nie
// codziennej pracy na budowie. Jeden ekran z wewnętrznym przełącznikiem,
// żeby nie trzeba było skakać między pozycjami menu. Technologie NIE są
// tu (mimo że to też "konfiguracja firmy") — mają własną pozycję w
// nawigacji (patrz app/(tabs)/index.tsx), bo na desktopie zasługują na
// stałą widoczność, a na mobile dzielą miejsce z zakładką Magazyn.
type AdminTab = "team" | "hours" | "accounts" | "settings";

export function AdminScreen() {
  const [section, setSection] = useState<AdminTab>("team");

  return (
    <>
      {/* Bez ScreenHeader tutaj — jego tytuł ("Zespół", "Rozliczenie
          godzin"...) tylko powtarzał to, co już mówi podświetlony
          przycisk poniżej, i zabierał miejsce bez potrzeby. Przyciski
          same pełnią rolę i nawigacji, i wskaźnika aktualnej sekcji. */}
      <View className="bg-surface border border-border rounded-2xl p-2 mb-5">
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 6,
            justifyContent: "center",
          }}
        >
          {(
            [
              ["team", "Zespół i dniówka"],
              ["hours", "Rozliczenie godzin"],
              ["accounts", "Konta logowania"],
              ["settings", "Ustawienia"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setSection(value)}
              style={{
                borderRadius: 10,
                paddingVertical: 10,
                paddingHorizontal: 16,
                alignItems: "center",
                backgroundColor:
                  section === value ? COLORS.primary : "transparent",
              }}
            >
              <Text
                style={{
                  color: section === value ? COLORS.background : COLORS.muted,
                  fontWeight: "700",
                  fontSize: 13,
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {section === "team" ? (
        <AdminTeamSection />
      ) : section === "hours" ? (
        <HrSection />
      ) : section === "accounts" ? (
        <AdminAccountsSection />
      ) : (
        <AdminSettingsSection />
      )}
    </>
  );
}

// Sekcja na przyszłe ustawienia aplikacji. Na razie tylko wylogowanie —
// celowo na samym końcu i z potwierdzeniem, żeby nie dało się go
// nacisnąć przez przypadek. Stawka za km (Faza 7) przeniesiona do
// "Zespół i dniówka" (AdminTeamSection) — dniówka i stawka za km to ten
// sam rodzaj ustawienia (parametr rozliczeniowy), więc żyją razem.
function AdminSettingsSection() {
  return (
    <>
      <AccountSettingsSection />
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

function AdminTeamSection() {
  const {
    workdayHours,
    workdayHoursInput,
    kmRate,
    closeBuildPin,
    employees,
    newEmployee,
    setWorkdayHoursInput,
    setNewEmployee,
    saveWorkdayHours,
    updateKmRate,
    updateCloseBuildPin,
    saveEmployee,
    updateEmployeeRate,
  } = useAppData();

  const [workdayOpen, setWorkdayOpen] = useState(false);
  const [kmRateOpen, setKmRateOpen] = useState(false);
  const [kmRateInput, setKmRateInput] = useState(kmRate ? String(kmRate) : "");
  const [closeBuildPinOpen, setCloseBuildPinOpen] = useState(false);
  const [closeBuildPinInput, setCloseBuildPinInput] = useState(closeBuildPin ?? "");
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState("");

  useEffect(() => {
    setKmRateInput(kmRate ? String(kmRate) : "");
  }, [kmRate]);

  useEffect(() => {
    setCloseBuildPinInput(closeBuildPin ?? "");
  }, [closeBuildPin]);

  return (
    <>
      {/* Dniówka — jedna zwarta linia zamiast pełnej karty; edycja tylko na żądanie */}
      <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-3">
        <Pressable
          onPress={() => setWorkdayOpen(!workdayOpen)}
          style={{ flexDirection: "row", alignItems: "center", padding: 14 }}
        >
          <IconBadge name="schedule" size={18} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: COLORS.muted, fontSize: 11 }}>DNIÓWKA</Text>
            <Text
              style={{
                color: COLORS.foreground,
                fontWeight: "700",
                fontSize: 15,
                marginTop: 2,
              }}
            >
              {workdayHours} h / dzień
            </Text>
          </View>
          <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}>
            {workdayOpen ? "Zwiń" : "Zmień"}
          </Text>
        </Pressable>
        {workdayOpen && (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: COLORS.border,
              padding: 14,
            }}
          >
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
      </View>

      {/* Stawka za km (Faza 7) — ten sam wzorzec co Dniówka wyżej:
          zwarta linia, edycja (stepper +/- 0,50 zł) tylko na żądanie.
          Zapis idzie od razu do bazy (updateKmRate, RLS: tylko Admin),
          w odróżnieniu od dniówki, która zostaje czysto lokalna. */}
      <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-3">
        <Pressable
          onPress={() => setKmRateOpen(!kmRateOpen)}
          style={{ flexDirection: "row", alignItems: "center", padding: 14 }}
        >
          <IconBadge name="directions-car" size={18} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: COLORS.muted, fontSize: 11 }}>STAWKA ZA KM</Text>
            <Text
              style={{
                color: COLORS.foreground,
                fontWeight: "700",
                fontSize: 15,
                marginTop: 2,
              }}
            >
              {kmRate.toFixed(2)} zł / km
            </Text>
          </View>
          <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}>
            {kmRateOpen ? "Zwiń" : "Zmień"}
          </Text>
        </Pressable>
        {kmRateOpen && (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: COLORS.border,
              padding: 14,
            }}
          >
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
      </View>

      {/* PIN zabezpieczający "Zamknij (i rozlicz) budowę" (patrz
          builds-screen.tsx) — ten sam wzorzec co Stawka za km wyżej. Puste
          pole = zabezpieczenie wyłączone (updateCloseBuildPin zapisuje
          wtedy null, patrz lib/data/settings.ts). */}
      <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-3">
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

      {/* Zespół — nagłówek z licznikiem i przyciskiem dodawania, lista jako
          jeden kontener z wierszami zamiast osobnej karty na osobę. */}
      <View className="flex-row justify-between items-center mb-3">
        <Text className="text-base font-bold text-foreground">
          Zespół ({employees.length})
        </Text>
        <Pressable onPress={() => setAddEmployeeOpen(!addEmployeeOpen)}>
          <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
            {addEmployeeOpen ? "Anuluj" : "+ Dodaj pracownika"}
          </Text>
        </Pressable>
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
            {["Brygadzista", "Pracownik", "Admin"].map((role) => (
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
              Stawka godzinowa (PLN/h)
            </Text>
            <QuantityStepper
              value={newEmployee.hourlyRate}
              onChangeText={(value: string) =>
                setNewEmployee({ ...newEmployee, hourlyRate: value })
              }
            />
          </View>
          <View style={{ marginTop: 10 }}>
            <Button
              label="Dodaj pracownika"
              onPress={() => {
                saveEmployee();
                setAddEmployeeOpen(false);
              }}
            />
          </View>
        </View>
      )}

      {employees.length === 0 && (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-5">
          <Text className="text-sm text-muted">
            Brak dodanych pracowników.
          </Text>
        </View>
      )}
      <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-5">
        {employees.map((employee, i) => (
          <View
            key={employee.id}
            style={{
              borderTopWidth: i > 0 ? 1 : 0,
              borderTopColor: COLORS.border,
            }}
          >
            <Pressable
              onPress={() => {
                if (editingRateId === employee.id) {
                  setEditingRateId(null);
                } else {
                  setEditingRateId(employee.id);
                  setRateInput(String(employee.hourlyRate || ""));
                }
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            >
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text
                  className="text-sm font-bold text-foreground"
                  numberOfLines={1}
                >
                  {employee.name}
                </Text>
                <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                  {formatPLN(employee.hourlyRate || 0)}/h
                </Text>
              </View>
              <Text
                style={{
                  color: COLORS.muted,
                  fontSize: 12,
                  fontWeight: "700",
                }}
              >
                {employee.role}
              </Text>
            </Pressable>
            {editingRateId === employee.id && (
              <View
                style={{
                  paddingHorizontal: 14,
                  paddingBottom: 14,
                }}
              >
                <Text className="text-xs text-muted uppercase mb-2">
                  Stawka godzinowa (PLN/h)
                </Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <QuantityStepper
                      value={rateInput}
                      onChangeText={setRateInput}
                    />
                  </View>
                  <Pressable
                    onPress={() => setEditingRateId(null)}
                    style={{
                      borderRadius: 10,
                      paddingHorizontal: 16,
                      justifyContent: "center",
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
                      updateEmployeeRate(employee.id, Number(rateInput) || 0);
                      setEditingRateId(null);
                    }}
                    style={{
                      backgroundColor: COLORS.primary,
                      borderRadius: 10,
                      paddingHorizontal: 16,
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: COLORS.background, fontWeight: "700" }}>
                      Zapisz
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        ))}
      </View>

      <AdminTeamsSubsection />
    </>
  );
}

// Brygady i ich skład — patrz supabase/sql/040_planowany_koszt_
// robocizny.sql. Wcześniej `teams` istniała w bazie (lider budowy), ale
// bez UI i bez polityki zapisu — członkostwo (team_members) jest tu
// zupełnie nowe. Wzorzec identyczny jak lista pracowników wyżej: nagłówek
// z licznikiem + "+ Dodaj", lista jako jeden kontener z wierszami.
function AdminTeamsSubsection() {
  const {
    teams,
    teamMembers,
    employees,
    newTeam,
    setNewTeam,
    saveTeam,
    addTeamMember,
    removeTeamMember,
  } = useAppData();

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
                saveTeam();
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
                      {members.length} {members.length === 1 ? "osoba" : "osób"}
                    </Text>
                  </View>
                  <Text style={{ color: COLORS.primary, fontSize: 18, fontWeight: "700" }}>
                    {expanded ? "⌄" : "›"}
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

const ROLE_OPTIONS: AppRole[] = ["Admin", "Brygadzista", "Pracownik"];

// Konta logowania (Supabase Auth) — osobno od "Zespołu": pracownik to
// wpis w tabeli employees (stawka, dniówka), konto logowania to osobny
// byt w auth.users + profiles (e-mail, hasło, rola dostępu). Jeden
// pracownik może, ale nie musi mieć konta logowania (patrz employeeId
// jako opcjonalne powiązanie). Zarządzanie idzie przez Edge Function
// admin-users (patrz supabase/functions/admin-users) — tylko tam wolno
// dotykać auth.users (tworzenie, reset hasła, usuwanie), bo wymaga to
// klucza service_role, którego apka kliencka nigdy nie ma.
function AdminAccountsSection() {
  const { employees } = useAppData();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [newAccount, setNewAccount] = useState({
    email: "",
    password: "",
    role: "Pracownik" as AppRole,
    employeeId: "" as string,
  });

  const [passwordEditId, setPasswordEditId] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<AppRole>("Pracownik");
  const [editEmployeeId, setEditEmployeeId] = useState("");

  const reload = () => {
    setLoadError(null);
    listAdminUsers()
      .then(setUsers)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Błąd."));
  };

  useEffect(reload, []);

  const employeeName = (employeeId: number | null) =>
    employeeId != null
      ? employees.find((e) => e.id === String(employeeId))?.name ?? `#${employeeId}`
      : null;

  return (
    <>
      <View className="flex-row justify-between items-center mb-3">
        <Text className="text-base font-bold text-foreground">
          Konta logowania {users ? `(${users.length})` : ""}
        </Text>
        <Pressable onPress={() => setAddOpen(!addOpen)}>
          <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
            {addOpen ? "Anuluj" : "+ Dodaj konto"}
          </Text>
        </Pressable>
      </View>

      {addOpen && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-3">
          <Text className="text-xs text-muted uppercase mb-2">Email</Text>
          <Field
            placeholder="jan.kowalski@flowtex.pl"
            value={newAccount.email}
            onChangeText={(value: string) =>
              setNewAccount({ ...newAccount, email: value })
            }
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text className="text-xs text-muted uppercase mb-2 mt-3">
            Hasło (min. 6 znaków)
          </Text>
          <Field
            placeholder="••••••••"
            value={newAccount.password}
            onChangeText={(value: string) =>
              setNewAccount({ ...newAccount, password: value })
            }
            autoCapitalize="none"
            secureTextEntry
          />
          <Text className="text-xs text-muted uppercase mb-2 mt-3">Rola</Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {ROLE_OPTIONS.map((role) => (
              <Pressable
                key={role}
                onPress={() => setNewAccount({ ...newAccount, role })}
                style={{
                  backgroundColor:
                    newAccount.role === role ? COLORS.primary : COLORS.background,
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor:
                    newAccount.role === role ? COLORS.primary : COLORS.border,
                }}
              >
                <Text
                  style={{
                    color:
                      newAccount.role === role ? COLORS.background : COLORS.foreground,
                    fontWeight: "700",
                  }}
                >
                  {role}
                </Text>
              </Pressable>
            ))}
          </View>
          {employees.length > 0 && (
            <>
              <Text className="text-xs text-muted uppercase mb-2 mt-3">
                Powiązany pracownik (opcjonalnie)
              </Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                <Pressable
                  onPress={() => setNewAccount({ ...newAccount, employeeId: "" })}
                  style={{
                    backgroundColor:
                      newAccount.employeeId === "" ? COLORS.primary : COLORS.background,
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderWidth: 1,
                    borderColor:
                      newAccount.employeeId === "" ? COLORS.primary : COLORS.border,
                  }}
                >
                  <Text
                    style={{
                      color:
                        newAccount.employeeId === ""
                          ? COLORS.background
                          : COLORS.foreground,
                      fontWeight: "700",
                    }}
                  >
                    Brak
                  </Text>
                </Pressable>
                {employees.map((e) => (
                  <Pressable
                    key={e.id}
                    onPress={() => setNewAccount({ ...newAccount, employeeId: e.id })}
                    style={{
                      backgroundColor:
                        newAccount.employeeId === e.id
                          ? COLORS.primary
                          : COLORS.background,
                      borderRadius: 10,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderWidth: 1,
                      borderColor:
                        newAccount.employeeId === e.id ? COLORS.primary : COLORS.border,
                    }}
                  >
                    <Text
                      style={{
                        color:
                          newAccount.employeeId === e.id
                            ? COLORS.background
                            : COLORS.foreground,
                        fontWeight: "700",
                      }}
                    >
                      {e.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {loadError && (
            <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 10 }}>
              {loadError}
            </Text>
          )}
          <View style={{ marginTop: 12 }}>
            {busy ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <Button
                label="Utwórz konto"
                onPress={async () => {
                  setBusy(true);
                  setLoadError(null);
                  try {
                    await createAdminUser(
                      newAccount.email.trim(),
                      newAccount.password,
                      newAccount.role,
                      newAccount.employeeId || null,
                    );
                    setNewAccount({ email: "", password: "", role: "Pracownik", employeeId: "" });
                    setAddOpen(false);
                    reload();
                  } catch (err) {
                    setLoadError(err instanceof Error ? err.message : "Błąd.");
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )}
          </View>
        </View>
      )}

      {!addOpen && loadError && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-3">
          <Text style={{ color: COLORS.danger, fontSize: 12 }}>{loadError}</Text>
        </View>
      )}

      {users === null && !loadError && (
        <View className="items-center py-6">
          <ActivityIndicator color={COLORS.primary} />
        </View>
      )}

      {users?.length === 0 && (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-5">
          <Text className="text-sm text-muted">Brak kont logowania.</Text>
        </View>
      )}

      {users && users.length > 0 && (
        <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-5">
          {users.map((u, i) => (
            <View
              key={u.id}
              style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: COLORS.border }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                }}
              >
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                    {u.email ?? "(brak emaila)"}
                  </Text>
                  <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                    {u.role}
                    {employeeName(u.employeeId) ? ` · ${employeeName(u.employeeId)}` : ""}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setEditId(editId === u.id ? null : u.id);
                    setEditRole(u.role);
                    setEditEmployeeId(u.employeeId != null ? String(u.employeeId) : "");
                    setPasswordEditId(null);
                  }}
                  style={{ marginRight: 14 }}
                >
                  <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 12 }}>
                    Edytuj
                  </Text>
                </Pressable>
                {!isProtectedAdminEmail(u.email) && (
                  <Pressable
                    onPress={() => {
                      setPasswordEditId(passwordEditId === u.id ? null : u.id);
                      setPasswordInput("");
                      setEditId(null);
                    }}
                    style={{ marginRight: 14 }}
                  >
                    <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 12 }}>
                      Zmień hasło
                    </Text>
                  </Pressable>
                )}
                {isProtectedAdminEmail(u.email) ? (
                  <Text style={{ color: COLORS.muted, fontSize: 11, fontStyle: "italic" }}>
                    Konto główne
                  </Text>
                ) : (
                  <Pressable
                    onPress={() =>
                      confirmAction(
                        "Usuń konto",
                        `Usunąć konto ${u.email ?? u.id}? Tej operacji nie można cofnąć.`,
                        "Usuń",
                        async () => {
                          try {
                            await deleteAdminUser(u.id);
                            reload();
                          } catch (err) {
                            setLoadError(err instanceof Error ? err.message : "Błąd.");
                          }
                        },
                      )
                    }
                  >
                    <Text style={{ color: COLORS.danger, fontWeight: "700", fontSize: 12 }}>
                      Usuń
                    </Text>
                  </Pressable>
                )}
              </View>
              {editId === u.id && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                  {isProtectedAdminEmail(u.email) && (
                    <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 8 }}>
                      To konto główne administratora — rola Admin jest chroniona i nie da się jej
                      tu odebrać.
                    </Text>
                  )}
                  <Text className="text-xs text-muted uppercase mb-2">Rola</Text>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    {ROLE_OPTIONS.map((role) => {
                      const disabled = isProtectedAdminEmail(u.email) && role !== "Admin";
                      return (
                        <Pressable
                          key={role}
                          disabled={disabled}
                          onPress={() => setEditRole(role)}
                          style={{
                            backgroundColor: editRole === role ? COLORS.primary : COLORS.background,
                            borderRadius: 10,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                            borderWidth: 1,
                            borderColor: editRole === role ? COLORS.primary : COLORS.border,
                            opacity: disabled ? 0.4 : 1,
                          }}
                        >
                          <Text
                            style={{
                              color: editRole === role ? COLORS.background : COLORS.foreground,
                              fontWeight: "700",
                            }}
                          >
                            {role}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {employees.length > 0 && (
                    <>
                      <Text className="text-xs text-muted uppercase mb-2 mt-3">
                        Powiązany pracownik
                      </Text>
                      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                        <Pressable
                          onPress={() => setEditEmployeeId("")}
                          style={{
                            backgroundColor:
                              editEmployeeId === "" ? COLORS.primary : COLORS.background,
                            borderRadius: 10,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                            borderWidth: 1,
                            borderColor: editEmployeeId === "" ? COLORS.primary : COLORS.border,
                          }}
                        >
                          <Text
                            style={{
                              color: editEmployeeId === "" ? COLORS.background : COLORS.foreground,
                              fontWeight: "700",
                            }}
                          >
                            Brak
                          </Text>
                        </Pressable>
                        {employees.map((e) => (
                          <Pressable
                            key={e.id}
                            onPress={() => setEditEmployeeId(e.id)}
                            style={{
                              backgroundColor:
                                editEmployeeId === e.id ? COLORS.primary : COLORS.background,
                              borderRadius: 10,
                              paddingHorizontal: 10,
                              paddingVertical: 8,
                              borderWidth: 1,
                              borderColor:
                                editEmployeeId === e.id ? COLORS.primary : COLORS.border,
                            }}
                          >
                            <Text
                              style={{
                                color:
                                  editEmployeeId === e.id ? COLORS.background : COLORS.foreground,
                                fontWeight: "700",
                              }}
                            >
                              {e.name}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  )}
                  <View style={{ marginTop: 12 }}>
                    <Pressable
                      onPress={async () => {
                        try {
                          await setAdminUserRole(u.id, editRole, editEmployeeId || null);
                          setEditId(null);
                          reload();
                        } catch (err) {
                          setLoadError(err instanceof Error ? err.message : "Błąd.");
                        }
                      }}
                      style={{
                        backgroundColor: COLORS.primary,
                        borderRadius: 10,
                        paddingVertical: 10,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: COLORS.background, fontWeight: "700" }}>
                        Zapisz
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
              {passwordEditId === u.id && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                  <Text className="text-xs text-muted uppercase mb-2">
                    Nowe hasło (min. 6 znaków)
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Field
                        placeholder="••••••••"
                        value={passwordInput}
                        onChangeText={setPasswordInput}
                        autoCapitalize="none"
                        secureTextEntry
                      />
                    </View>
                    <Pressable
                      onPress={async () => {
                        if (passwordInput.length < 6) return;
                        try {
                          await setAdminUserPassword(u.id, passwordInput);
                          setPasswordEditId(null);
                        } catch (err) {
                          setLoadError(err instanceof Error ? err.message : "Błąd.");
                        }
                      }}
                      style={{
                        backgroundColor: COLORS.primary,
                        borderRadius: 10,
                        paddingHorizontal: 16,
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ color: COLORS.background, fontWeight: "700" }}>
                        Zapisz
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </>
  );
}
