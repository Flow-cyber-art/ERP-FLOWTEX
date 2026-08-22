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
  ScreenHeader,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";
import { HrSection } from "@/components/screens/hr-screen";
import type { AppRole } from "@/lib/data/auth";
import {
  type AdminUser,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  setAdminUserPassword,
  setAdminUserRole,
} from "@/lib/data/admin-users";

// Panel administracyjny i HR były wcześniej dwiema osobnymi zakładkami
// nawigacji, mimo że oba dotyczą tego samego zespołu (kto pracuje, ile
// kosztuje jego godzina, ile faktycznie przepracował) — logicznie to
// jeden obszar "Zespół", tylko dwa różne widoki na te same dane.
// Połączone w jeden ekran z wewnętrznym przełącznikiem, żeby nie trzeba
// było skakać między dwiema pozycjami menu, żeby np. dodać pracownika,
// a potem od razu sprawdzić jego godziny.
type AdminTab = "team" | "hours" | "accounts";

export function AdminScreen() {
  const [section, setSection] = useState<AdminTab>("team");

  return (
    <>
      <ScreenHeader
        eyebrow="ADMINISTRACJA"
        title="Zespół"
        description="Pracownicy, dniówka i rozliczenie godzin."
      />

      <View className="bg-surface border border-border rounded-2xl p-2 mb-5">
        <View style={{ flexDirection: "row", gap: 6 }}>
          {(
            [
              ["team", "Zespół i dniówka"],
              ["hours", "Rozliczenie godzin"],
              ["accounts", "Konta logowania"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setSection(value)}
              style={{
                flex: 1,
                borderRadius: 10,
                paddingVertical: 10,
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
      ) : (
        <AdminAccountsSection />
      )}
    </>
  );
}

function AdminTeamSection() {
  const {
    workdayHours,
    workdayHoursInput,
    employees,
    newEmployee,
    setWorkdayHoursInput,
    setNewEmployee,
    saveWorkdayHours,
    saveEmployee,
    updateEmployeeRate,
  } = useAppData();

  const [workdayOpen, setWorkdayOpen] = useState(false);
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState("");

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
            <View style={{ marginTop: 10 }}>
              <Button
                label="Zapisz"
                onPress={() => {
                  saveWorkdayHours();
                  setWorkdayOpen(false);
                }}
              />
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
              </View>
              {editId === u.id && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                  <Text className="text-xs text-muted uppercase mb-2">Rola</Text>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    {ROLE_OPTIONS.map((role) => (
                      <Pressable
                        key={role}
                        onPress={() => setEditRole(role)}
                        style={{
                          backgroundColor: editRole === role ? COLORS.primary : COLORS.background,
                          borderRadius: 10,
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          borderWidth: 1,
                          borderColor: editRole === role ? COLORS.primary : COLORS.border,
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
                    ))}
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
