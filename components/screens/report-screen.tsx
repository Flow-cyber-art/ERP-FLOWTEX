import AsyncStorage from "@react-native-async-storage/async-storage";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import {
  COLORS,
  todayLabelPL,
  Button,
  Field,
  IconBadge,
  QuantityStepper,
  ExtraCostsSection,
  ReportStepper,
  ScreenHeader,
  TimeOptionsList,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

export function ReportScreen() {
  const {
    devRole,
    materials,
    builds,
    picker,
    reportValues,
    reasons,
    reportSaved,
    reportStep,
    editingReportId,
    savedReports,
    employees,
    selectedEmployeeId,
    employeePickerOpen,
    personStart,
    personEnd,
    timePicker,
    draftPeople,
    draftExtraCosts,
    setSelectedBuildId,
    setPicker,
    setReportValues,
    setReasons,
    setReportSaved,
    setReportStep,
    setSelectedEmployeeId,
    setEmployeePickerOpen,
    setPersonStart,
    setPersonEnd,
    setTimePicker,
    setDraftExtraCosts,
    activeBuild,
    buildAssignments,
    saveDailyReport,
    addPersonToDraft,
    addExtraCostToDraft,
    removeExtraCostFromDraft,
    updateBuildPhotosUrl,
  } = useAppData();

  const editingReport = editingReportId
    ? savedReports.find((report) => report.id === editingReportId)
    : undefined;
  const reportApproved = editingReport?.status === "approved";

  // Edycja linku do zdjęć wybranej budowy (np. folder Google Drive) —
  // ten sam wzorzec co w builds-screen.tsx (Admin), tu dostępny dla
  // brygadzisty przy budowie, na której właśnie raportuje.
  const [editingPhotos, setEditingPhotos] = useState(false);
  const [photosUrlInput, setPhotosUrlInput] = useState("");

  return (
    <>
      <ScreenHeader
        eyebrow={`RAPORT / ${todayLabelPL()}`}
        title="Zużycie dzienne"
      />

      <ReportStepper step={reportStep} />

      <View className="bg-surface border border-border rounded-2xl overflow-hidden">
        {reportApproved && (
          <View
            style={{
              backgroundColor: COLORS.successBg,
              borderRadius: 12,
              padding: 13,
              margin: 16,
              marginBottom: 0,
            }}
          >
            <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
              Raport zatwierdzony przez administratora — edycja zablokowana.
            </Text>
          </View>
        )}

        {reportStep === 1 && (
          <>
            <View className="p-4 flex-row items-center gap-3">
              <IconBadge name="business" />
              <Pressable
                disabled={reportApproved}
                onPress={() => {
                  if (reportApproved) return;
                  setPicker(picker === "build" ? null : "build");
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                    Budowa
                  </Text>
                  <Text
                    style={{
                      color: COLORS.foreground,
                      fontWeight: "700",
                      marginTop: 2,
                    }}
                  >
                    {activeBuild?.number}
                  </Text>
                  <Text
                    style={{
                      color: COLORS.muted,
                      fontSize: 12,
                      marginTop: 1,
                    }}
                    numberOfLines={2}
                  >
                    {activeBuild?.name}
                  </Text>
                </View>
                <MaterialIcons
                  name={picker === "build" ? "expand-less" : "chevron-right"}
                  size={22}
                  color={COLORS.primary}
                />
              </Pressable>
            </View>

            {picker === "build" && (
              <View
                style={{
                  backgroundColor: COLORS.background,
                  borderRadius: 10,
                  padding: 10,
                  marginHorizontal: 16,
                  marginBottom: 16,
                }}
              >
                <ScrollView
                  style={{ maxHeight: 180 }}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  {builds
                    .filter((b) => b.status !== "zamknięta")
                    .map((b) => (
                    <Pressable
                      disabled={reportApproved}
                      key={b.id}
                      onPress={() => {
                        setSelectedBuildId(b.id);
                        setPicker(null);
                        setReportValues({});
                        setDraftExtraCosts([]);
                        setReportSaved(false);
                      }}
                      style={{
                        paddingVertical: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: COLORS.border,
                      }}
                    >
                      <Text
                        style={{
                          color: COLORS.foreground,
                          fontWeight: "700",
                        }}
                      >
                        {b.number}
                      </Text>
                      <Text
                        style={{
                          color: COLORS.muted,
                          fontSize: 12,
                          marginTop: 3,
                        }}
                      >
                        {b.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Zdjęcia budowy — zwykły link (np. Google Drive), wklejany
                ręcznie. Kliknięcie otwiera go poza aplikacją. */}
            <View
              className="border-t border-border p-4"
              style={{ paddingBottom: editingPhotos ? 16 : 14 }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                {activeBuild?.photosUrl ? (
                  <Pressable
                    onPress={() => Linking.openURL(activeBuild.photosUrl!)}
                    style={{ flex: 1, marginRight: 8 }}
                  >
                    <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                      ZDJĘCIA BUDOWY
                    </Text>
                    <Text
                      style={{
                        color: COLORS.primary,
                        fontWeight: "700",
                        fontSize: 13,
                        marginTop: 2,
                      }}
                    >
                      Otwórz folder ↗
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={{ color: COLORS.muted, fontSize: 12, flex: 1 }}>
                    Brak linku do zdjęć tej budowy.
                  </Text>
                )}
                <Pressable
                  disabled={reportApproved || !activeBuild}
                  onPress={() => {
                    setEditingPhotos(!editingPhotos);
                    setPhotosUrlInput(activeBuild?.photosUrl || "");
                  }}
                >
                  <Text
                    style={{
                      color: reportApproved ? COLORS.muted : COLORS.primary,
                      fontSize: 13,
                      fontWeight: "700",
                    }}
                  >
                    {editingPhotos
                      ? "Zwiń"
                      : activeBuild?.photosUrl
                        ? "Zmień"
                        : "+ Dodaj link"}
                  </Text>
                </Pressable>
              </View>
              {editingPhotos && (
                <View style={{ marginTop: 10 }}>
                  <Field
                    placeholder="https://drive.google.com/..."
                    value={photosUrlInput}
                    onChangeText={setPhotosUrlInput}
                    autoCapitalize="none"
                  />
                  <View style={{ marginTop: 10 }}>
                    <Button
                      label="Zapisz link"
                      onPress={() => {
                        if (!activeBuild) return;
                        updateBuildPhotosUrl(
                          activeBuild.id,
                          photosUrlInput.trim(),
                        );
                        setEditingPhotos(false);
                      }}
                    />
                  </View>
                </View>
              )}
            </View>

            <View className="border-t border-border p-4">
              <Text className="text-xs text-muted uppercase mb-2">
                Materiały
              </Text>
              {buildAssignments.map((a, i) => {
                const m = materials.find((x) => x.id === a.materialId);
                const currentValue = Number(reportValues[a.materialId] || 0);
                const different =
                  devRole === "Admin" &&
                  reportValues[a.materialId] !== undefined &&
                  currentValue !== a.planned;
                return (
                  <View key={a.materialId}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingVertical: 12,
                        borderTopWidth: i > 0 ? 1 : 0,
                        borderTopColor: COLORS.border,
                      }}
                    >
                      {/* lewa kolumna — elastyczna, może się zwężać */}
                      <View
                        style={{
                          flex: 1,
                          minWidth: 0,
                          flexDirection: "row",
                          alignItems: "center",
                          paddingRight: 8,
                        }}
                      >
                        <IconBadge name="layers" size={16} badgeSize={32} />
                        <View
                          style={{
                            marginLeft: 8,
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <Text
                            className="text-sm font-semibold text-foreground"
                            numberOfLines={2}
                          >
                            {m?.name || "Materiał usunięty z magazynu"}
                          </Text>
                          <Text
                            className="text-xs text-muted mt-0.5"
                            numberOfLines={2}
                          >
                            {!m
                              ? `ID: ${a.materialId}`
                              : devRole === "Admin"
                                ? `plan ${a.planned} ${m.unit} · pozostało ${Math.max(0, a.planned - currentValue)} ${m.unit}`
                                : "Materiał przypisany do budowy"}
                          </Text>
                        </View>
                      </View>

                      {/* prawa kolumna — sztywna szerokość steppera */}
                      <QuantityStepper
                        disabled={reportApproved}
                        value={reportValues[a.materialId] || "0"}
                        onChangeText={(v) =>
                          setReportValues({
                            ...reportValues,
                            [a.materialId]: v,
                          })
                        }
                      />
                    </View>
                    {currentValue > a.planned && (
                      // Ostrzeżenie PRZED wysłaniem raportu, nie dopiero przy
                      // rozliczeniu budowy — brygadzista widzi na bieżąco, że
                      // wpisana ilość przekracza to, co zaplanowano.
                      <Text
                        style={{
                          color: COLORS.warning,
                          fontSize: 11,
                          marginTop: -4,
                          marginBottom: 8,
                        }}
                      >
                        ⚠ Przekracza plan o {(currentValue - a.planned).toFixed(2)}{" "}
                        {m?.unit}
                      </Text>
                    )}
                    {different && (
                      <Field
                        editable={!reportApproved}
                        placeholder="Dlaczego wystąpiła różnica?"
                        value={reasons[a.materialId] || ""}
                        onChangeText={(v: string) =>
                          setReasons({ ...reasons, [a.materialId]: v })
                        }
                      />
                    )}
                  </View>
                );
              })}
            </View>

            <View className="border-t border-border p-4">
              <Text className="text-xs text-muted uppercase mb-2">
                Dodatkowe koszty
              </Text>
              <ExtraCostsSection
                costs={draftExtraCosts}
                disabled={reportApproved}
                onAdd={addExtraCostToDraft}
                onRemove={removeExtraCostFromDraft}
              />
            </View>
          </>
        )}

        {reportStep === 2 && (
          <View className="p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-muted uppercase">
                Osoby pracujące
              </Text>
              {draftPeople.length > 0 && (
                <Text className="text-xs text-primary font-bold">
                  {draftPeople.length}
                </Text>
              )}
            </View>

            {draftPeople.length > 0 && (
              <View style={{ marginTop: 10 }}>
                {draftPeople.map((person, i) => {
                  const employee = employees.find(
                    (item) => item.id === person.employeeId,
                  );
                  return (
                    <View
                      key={person.employeeId}
                      className={`flex-row items-center justify-between py-2 ${i > 0 ? "border-t border-border" : ""}`}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          flex: 1,
                          minWidth: 0,
                          paddingRight: 8,
                        }}
                      >
                        <IconBadge name="person" size={18} badgeSize={32} />
                        <Text
                          className="text-sm text-foreground"
                          numberOfLines={1}
                          style={{
                            marginLeft: 10,
                            fontWeight: "700",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {employee?.name}
                        </Text>
                      </View>
                      <Text
                        className="text-sm text-muted"
                        style={{ flexShrink: 0 }}
                      >
                        {person.start}–{person.end}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={{ marginTop: draftPeople.length ? 14 : 10 }}>
              <Pressable
                disabled={reportApproved}
                onPress={() => setEmployeePickerOpen(!employeePickerOpen)}
                style={{
                  backgroundColor: COLORS.background,
                  borderRadius: 10,
                  padding: 12,
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Text
                  style={{
                    color: COLORS.foreground,
                    fontWeight: "600",
                    fontSize: 13,
                    flex: 1,
                    minWidth: 0,
                  }}
                  numberOfLines={1}
                >
                  {employees.find(
                    (employee) => employee.id === selectedEmployeeId,
                  )?.name || "Wybierz pracownika"}
                </Text>
                <Text style={{ color: COLORS.primary, marginLeft: 8 }}>
                  {employeePickerOpen ? "▲" : "▼"}
                </Text>
              </Pressable>

              {employeePickerOpen && (
                <View
                  style={{
                    backgroundColor: COLORS.background,
                    borderRadius: 10,
                    padding: 8,
                    marginTop: 6,
                  }}
                >
                  {employees.map((employee) => (
                    <Pressable
                      disabled={reportApproved}
                      key={employee.id}
                      onPress={() => {
                        setSelectedEmployeeId(employee.id);
                        setEmployeePickerOpen(false);
                      }}
                      style={{
                        paddingVertical: 11,
                        borderBottomWidth: 1,
                        borderBottomColor: COLORS.border,
                      }}
                    >
                      <Text
                        style={{
                          color: COLORS.foreground,
                          fontWeight: "700",
                        }}
                      >
                        {employee.name}
                      </Text>
                      <Text
                        style={{
                          color: COLORS.muted,
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        {employee.role}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Pressable
                    disabled={reportApproved}
                    onPress={() =>
                      setTimePicker(timePicker === "start" ? null : "start")
                    }
                    style={{
                      backgroundColor: COLORS.background,
                      borderRadius: 10,
                      padding: 11,
                      borderWidth: 1,
                      borderColor:
                        timePicker === "start"
                          ? COLORS.primary
                          : COLORS.background,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View>
                      <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                        OD
                      </Text>
                      <Text
                        style={{
                          color: personStart ? COLORS.foreground : COLORS.muted,
                          fontWeight: "700",
                          marginTop: 2,
                        }}
                      >
                        {personStart || "— : —"}
                      </Text>
                    </View>
                    <MaterialIcons
                      name="schedule"
                      size={18}
                      color={COLORS.primary}
                    />
                  </Pressable>
                  {timePicker === "start" && (
                    <TimeOptionsList
                      disabled={reportApproved}
                      value={personStart}
                      onSelect={(time) => {
                        setPersonStart(time);
                        setTimePicker(null);
                        AsyncStorage.setItem(
                          "lastPersonTime",
                          JSON.stringify({
                            start: time,
                            end: personEnd,
                          }),
                        );
                      }}
                    />
                  )}
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Pressable
                    disabled={reportApproved}
                    onPress={() =>
                      setTimePicker(timePicker === "end" ? null : "end")
                    }
                    style={{
                      backgroundColor: COLORS.background,
                      borderRadius: 10,
                      padding: 11,
                      borderWidth: 1,
                      borderColor:
                        timePicker === "end"
                          ? COLORS.primary
                          : COLORS.background,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View>
                      <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                        DO
                      </Text>
                      <Text
                        style={{
                          color: personEnd ? COLORS.foreground : COLORS.muted,
                          fontWeight: "700",
                          marginTop: 2,
                        }}
                      >
                        {personEnd || "— : —"}
                      </Text>
                    </View>
                    <MaterialIcons
                      name="schedule"
                      size={18}
                      color={COLORS.primary}
                    />
                  </Pressable>
                  {timePicker === "end" && (
                    <TimeOptionsList
                      disabled={reportApproved}
                      value={personEnd}
                      onSelect={(time) => {
                        setPersonEnd(time);
                        setTimePicker(null);
                        AsyncStorage.setItem(
                          "lastPersonTime",
                          JSON.stringify({
                            start: personStart,
                            end: time,
                          }),
                        );
                      }}
                    />
                  )}
                </View>
              </View>

              {!reportApproved && (
                <Pressable
                  onPress={addPersonToDraft}
                  style={({ pressed }) => ({
                    borderWidth: 1,
                    borderColor: COLORS.primary,
                    borderRadius: 12,
                    paddingVertical: 13,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    opacity: pressed ? 0.7 : 1,
                    marginTop: 10,
                  })}
                >
                  <MaterialIcons
                    name="add-circle-outline"
                    size={20}
                    color={COLORS.primary}
                  />
                  <Text style={{ color: COLORS.primary, fontWeight: "700" }}>
                    Dodaj osobę
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {reportStep === 3 && (
          <View className="p-4">
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <IconBadge name="business" size={18} badgeSize={32} />
              <View style={{ marginLeft: 12, flex: 1, minWidth: 0 }}>
                <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                  Budowa
                </Text>
                <Text
                  style={{
                    color: COLORS.foreground,
                    fontWeight: "700",
                    marginTop: 2,
                  }}
                  numberOfLines={2}
                >
                  {activeBuild?.number} · {activeBuild?.name}
                </Text>
              </View>
            </View>

            <Text className="text-xs text-muted uppercase mt-5 mb-1">
              Materiały
            </Text>
            {buildAssignments.map((a, i) => {
              const m = materials.find((x) => x.id === a.materialId);
              return (
                <View
                  key={a.materialId}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 8,
                    borderTopWidth: i > 0 ? 1 : 0,
                    borderTopColor: COLORS.border,
                  }}
                >
                  <Text
                    className="text-sm text-foreground"
                    numberOfLines={2}
                    style={{ flex: 1, minWidth: 0, marginRight: 8 }}
                  >
                    {m?.name || "Materiał usunięty z magazynu"}
                  </Text>
                  <Text
                    className="text-sm font-bold text-foreground"
                    style={{ flexShrink: 0 }}
                  >
                    {reportValues[a.materialId] || "0"} {m?.unit}
                  </Text>
                </View>
              );
            })}

            {draftExtraCosts.length > 0 && (
              <>
                <Text className="text-xs text-muted uppercase mt-5 mb-1">
                  Dodatkowe koszty
                </Text>
                <ExtraCostsSection
                  costs={draftExtraCosts}
                  disabled
                  onAdd={() => {}}
                  onRemove={() => {}}
                />
              </>
            )}

            <Text className="text-xs text-muted uppercase mt-5 mb-1">
              Zespół
            </Text>
            {draftPeople.length === 0 ? (
              <Text className="text-sm text-muted py-2">
                Nie dodano jeszcze osób.
              </Text>
            ) : (
              draftPeople.map((person, i) => {
                const employee = employees.find(
                  (item) => item.id === person.employeeId,
                );
                return (
                  <View
                    key={person.employeeId}
                    className={`flex-row items-center justify-between py-2 ${i > 0 ? "border-t border-border" : ""}`}
                  >
                    <Text
                      className="text-sm text-foreground"
                      numberOfLines={1}
                      style={{ flex: 1, minWidth: 0, marginRight: 8 }}
                    >
                      {employee?.name}
                    </Text>
                    <Text
                      className="text-sm text-muted"
                      style={{ flexShrink: 0 }}
                    >
                      {person.start}–{person.end}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        )}
      </View>

      {reportSaved && (
        <View
          style={{
            backgroundColor: COLORS.successBg,
            borderRadius: 12,
            padding: 13,
            marginTop: 16,
          }}
        >
          <Text
            style={{
              color: COLORS.foreground,
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            Raport zapisany — materiały zdjęte z magazynu, godziny zapisane
          </Text>
        </View>
      )}

      {reportStep === 3 && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginTop: 16,
          }}
        >
          <MaterialIcons
            name="check-circle"
            size={18}
            color={COLORS.success}
          />
          <Text
            style={{ color: COLORS.muted, fontSize: 13, flex: 1, minWidth: 0 }}
          >
            Gotowe do zapisania · {draftPeople.length}{" "}
            {draftPeople.length === 1 ? "osoba" : "osoby"} ·{" "}
            {buildAssignments.length}{" "}
            {buildAssignments.length === 1 ? "materiał" : "materiały"}
          </Text>
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
        {reportStep > 1 && (
          <View style={{ flex: 1 }}>
            <Button
              label="Wstecz"
              secondary
              fullWidth
              onPress={() => setReportStep((reportStep - 1) as 1 | 2)}
            />
          </View>
        )}
        <View style={{ flex: 2 }}>
          {reportStep < 3 ? (
            <Button
              label="Dalej"
              fullWidth
              onPress={() => setReportStep((reportStep + 1) as 2 | 3)}
            />
          ) : reportApproved ? (
            <Text
              style={{
                color: COLORS.success,
                fontWeight: "700",
                textAlign: "center",
                paddingVertical: 14,
              }}
            >
              Raport zatwierdzony
            </Text>
          ) : (
            <Button
              label={
                reportSaved
                  ? "Zapisano raport"
                  : editingReportId
                    ? "Zapisz zmiany"
                    : "Zapisz raport dzienny"
              }
              fullWidth
              onPress={saveDailyReport}
            />
          )}
        </View>
      </View>
    </>
  );
}
