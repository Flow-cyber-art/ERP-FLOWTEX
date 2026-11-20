import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import {
  Button,
  COLORS,
  Field,
  SegmentedControl,
  StatusBadge,
  confirmAction,
  notify,
} from "@/components/report-ui";
import { Icon } from "@/components/icon";
import { useAppData } from "@/contexts/app-data";
import {
  type AdminUser,
  createAdminUser,
  deleteAdminUser,
  listAdminAccounts,
  setAdminUserEmail,
  setAdminUserPassword,
  setAdminUserRole,
} from "@/lib/data/admin-users";
import type { AppRole } from "@/lib/data/auth";
import { RADIUS } from "@/constants/radius";

const ROLES: { key: AppRole; label: string }[] = [
  { key: "Admin", label: "Admin" },
  { key: "Brygadzista", label: "Brygadzista" },
  { key: "Pracownik", label: "Pracownik" },
];

const MIN_PASSWORD = 10;

/**
 * Panel super administratora: wszystkie konta logowania (także bez profilu i
 * bez powiązania z pracownikiem), dodawanie, usuwanie, zmiana hasła, e-maila,
 * roli i powiązania z pracownikiem. Widoczny TYLKO dla konta z tabeli
 * `superadmins` (serwer — Edge Function admin-users — i tak sprawdza to
 * ponownie przy każdej operacji, ukrycie panelu to tylko wygoda).
 */
export function SuperAdminAccountsSection() {
  const { employees } = useAppData();
  const [accounts, setAccounts] = useState<AdminUser[] | null>(null);
  const [isSuper, setIsSuper] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [roleInput, setRoleInput] = useState<AppRole>("Pracownik");
  const [employeeInput, setEmployeeInput] = useState<number | null>(null);

  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("Pracownik");
  const [newEmployee, setNewEmployee] = useState<number | null>(null);

  const reload = () => {
    setError(null);
    listAdminAccounts()
      .then((r) => {
        setAccounts(r.users);
        setIsSuper(r.callerIsSuperAdmin);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Błąd."));
  };
  useEffect(reload, []);

  // Zwykły Admin nie widzi tego panelu w ogóle.
  if (!isSuper) return null;

  const employeeName = (id: number | null) =>
    id == null ? null : (employees.find((e) => Number(e.id) === id)?.name ?? `#${id}`);

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      if (success) notify("Gotowe", success);
      reload();
    } catch (e) {
      notify("Nie udało się", e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (a: AdminUser) => {
    if (editingId === a.id) {
      setEditingId(null);
      return;
    }
    setEditingId(a.id);
    setEmailInput(a.email ?? "");
    setPasswordInput("");
    setRoleInput(a.role ?? "Pracownik");
    setEmployeeInput(a.employeeId);
  };

  const EmployeePicker = ({
    value,
    onChange,
  }: {
    value: number | null;
    onChange: (id: number | null) => void;
  }) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {[{ id: null as number | null, name: "Brak" }, ...employees.map((e) => ({ id: Number(e.id), name: e.name }))].map(
          (opt) => {
            const selected = value === opt.id;
            return (
              <Pressable
                key={String(opt.id)}
                onPress={() => onChange(opt.id)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: RADIUS.control,
                  borderWidth: 1,
                  borderColor: selected ? COLORS.muted : COLORS.border,
                  backgroundColor: selected ? COLORS.border : "transparent",
                }}
              >
                <Text
                  style={{
                    color: selected ? COLORS.foreground : COLORS.muted,
                    fontSize: 13,
                    fontWeight: "600",
                  }}
                >
                  {opt.name}
                </Text>
              </Pressable>
            );
          },
        )}
      </View>
    </ScrollView>
  );

  return (
    <View style={{ marginTop: 24 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="shield" size={18} color={COLORS.foreground} />
          <Text className="text-base font-bold text-foreground">Konta logowania</Text>
          <StatusBadge status="ok" label="SUPER ADMIN" />
        </View>
        <Pressable onPress={() => setAdding(!adding)}>
          <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
            {adding ? "Anuluj" : "+ Dodaj konto"}
          </Text>
        </Pressable>
      </View>
      <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 12 }}>
        Wszystkie konta, także bez profilu i bez powiązania z pracownikiem. Widoczne tylko dla
        super administratora.
      </Text>

      {adding && (
        <View className="bg-surface border border-border rounded-card p-4 mb-3">
          <Field
            placeholder="E-mail"
            value={newEmail}
            onChangeText={setNewEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Field
            placeholder={`Hasło (min. ${MIN_PASSWORD} znaków)`}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoCapitalize="none"
          />
          <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 12, marginBottom: 6 }}>Rola</Text>
          <SegmentedControl
            options={ROLES}
            value={newRole}
            onChange={setNewRole}
          />
          <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 12 }}>Powiązany pracownik</Text>
          <EmployeePicker value={newEmployee} onChange={setNewEmployee} />
          <View style={{ marginTop: 14 }}>
            <Button
              label="Utwórz konto"
              disabled={busy || !newEmail.trim() || newPassword.length < MIN_PASSWORD}
              onPress={() =>
                run(async () => {
                  await createAdminUser(newEmail.trim(), newPassword, newRole, newEmployee);
                  setNewEmail("");
                  setNewPassword("");
                  setNewRole("Pracownik");
                  setNewEmployee(null);
                  setAdding(false);
                }, "Konto zostało utworzone.")
              }
            />
          </View>
        </View>
      )}

      {error && <Text style={{ color: COLORS.danger, fontSize: 12, marginBottom: 8 }}>{error}</Text>}
      {!accounts && !error && <ActivityIndicator color={COLORS.primary} />}

      {accounts && (
        <View className="bg-surface border border-border rounded-card overflow-hidden">
          {accounts.map((a, i) => {
            const open = editingId === a.id;
            return (
              <View key={a.id} style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: COLORS.border }}>
                <Pressable
                  onPress={() => startEdit(a)}
                  style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 }}
                >
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                      {a.email ?? "(brak e-maila)"}
                    </Text>
                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                      {employeeName(a.employeeId) ?? "bez powiązania z pracownikiem"}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginRight: 10 }}>
                    {a.isSuperAdmin && <StatusBadge status="ok" label="SUPER ADMIN" />}
                    {!a.hasProfile ? (
                      <StatusBadge status="warning" label="bez profilu" />
                    ) : (
                      <StatusBadge status="ok" label={a.role ?? ""} />
                    )}
                  </View>
                  <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={COLORS.muted} />
                </Pressable>

                {open && (
                  <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                    <Text style={{ color: COLORS.muted, fontSize: 11 }}>E-mail</Text>
                    <Field value={emailInput} onChangeText={setEmailInput} autoCapitalize="none" keyboardType="email-address" />
                    <View style={{ marginTop: 8 }}>
                      <Button
                        label="Zmień e-mail"
                        secondary
                        disabled={busy || !emailInput.trim() || emailInput.trim() === a.email}
                        onPress={() => run(() => setAdminUserEmail(a.id, emailInput.trim()), "E-mail został zmieniony.")}
                      />
                    </View>

                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 14 }}>Nowe hasło</Text>
                    <Field
                      placeholder={`min. ${MIN_PASSWORD} znaków`}
                      value={passwordInput}
                      onChangeText={setPasswordInput}
                      secureTextEntry
                      autoCapitalize="none"
                    />
                    <View style={{ marginTop: 8 }}>
                      <Button
                        label="Ustaw hasło"
                        secondary
                        disabled={busy || passwordInput.length < MIN_PASSWORD}
                        onPress={() =>
                          run(async () => {
                            await setAdminUserPassword(a.id, passwordInput);
                            setPasswordInput("");
                          }, "Hasło zostało zmienione.")
                        }
                      />
                    </View>

                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 14, marginBottom: 6 }}>Rola</Text>
                    <SegmentedControl options={ROLES} value={roleInput} onChange={setRoleInput} />
                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 12 }}>Powiązany pracownik</Text>
                    <EmployeePicker value={employeeInput} onChange={setEmployeeInput} />
                    <View style={{ marginTop: 10 }}>
                      <Button
                        label={a.hasProfile ? "Zapisz rolę i powiązanie" : "Nadaj profil"}
                        disabled={busy}
                        onPress={() =>
                          run(() => setAdminUserRole(a.id, roleInput, employeeInput), "Zapisano.")
                        }
                      />
                    </View>

                    {!a.isSuperAdmin && (
                      <View style={{ marginTop: 14 }}>
                        <Button
                          label="Usuń konto"
                          secondary
                          disabled={busy}
                          onPress={() =>
                            confirmAction(
                              "Usunąć konto?",
                              `${a.email ?? "To konto"} zostanie trwale usunięte razem z profilem i powiązaniem z pracownikiem. Pracownik (kartoteka, godziny, raporty) zostaje. Tej operacji nie da się cofnąć.`,
                              "Usuń konto",
                              () => run(() => deleteAdminUser(a.id), "Konto zostało usunięte."),
                            )
                          }
                        />
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
