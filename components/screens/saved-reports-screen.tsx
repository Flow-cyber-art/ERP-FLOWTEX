import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import {
  COLORS,
  IconBadge,
  StatusBadge,
  ScreenHeader,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

type StatusFilter = "all" | "pending" | "approved";

export function SavedReportsScreen() {
  const { builds, savedReports, openSavedReport, startNewReport, devRole, myProfileId } =
    useAppData();

  // Wybór budowy PRZED listą — z czasem raportów robi się sporo, więc
  // jedna wspólna lista wszystkich budów naraz przestaje być użyteczna.
  // "Wszystkie budowy" zostaje jako domyślna opcja.
  const [buildsFilter, setBuildsFilter] = useState<"active" | "archived">(
    "active",
  );
  const [selectedBuildId, setSelectedBuildId] = useState<string | "all">(
    "all",
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  const visibleBuilds = useMemo(
    () =>
      builds.filter((b) =>
        buildsFilter === "active" ? b.status !== "zamknięta" : b.status === "zamknięta",
      ),
    [builds, buildsFilter],
  );
  const switchBuildsFilter = (next: "active" | "archived") => {
    setBuildsFilter(next);
    setSelectedBuildId("all");
  };

  // Brygadzista widzi tylko swoje raporty — nie ma po co porównywać się z
  // innymi brygadzistami na tej samej/innej budowie, to tylko szum.
  // Raporty bez znanego autora (submittedByProfileId null — sprzed 025,
  // albo lokalne jeszcze niezsynchronizowane) zostają widoczne: nie da
  // się ich przypisać komuś INNEMU, więc bezpieczniej pokazać niż ukryć
  // być może własną, jeszcze niewysłaną pracę. Admin i Pracownik widzą
  // bez zmian — to ograniczenie dotyczy wyłącznie Brygadzisty.
  const mineOnly =
    devRole === "Brygadzista"
      ? savedReports.filter(
          (r) => !r.submittedByProfileId || r.submittedByProfileId === myProfileId,
        )
      : savedReports;

  const reportsInScope =
    selectedBuildId === "all"
      ? mineOnly.filter((r) => visibleBuilds.some((b) => b.id === r.buildId))
      : mineOnly.filter((r) => r.buildId === selectedBuildId);

  const approvedCount = reportsInScope.filter(
    (r) => r.status === "approved",
  ).length;
  const pendingCount = reportsInScope.length - approvedCount;

  const filteredByStatus = reportsInScope.filter((r) => {
    if (statusFilter === "approved") return r.status === "approved";
    if (statusFilter === "pending") return r.status !== "approved";
    return true;
  });

  const sorted = [...filteredByStatus].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  const selectedBuild = builds.find((b) => b.id === selectedBuildId);
  const selectedBuildLabel =
    selectedBuildId === "all"
      ? "Wszystkie budowy"
      : selectedBuild
        ? `${selectedBuild.number} · ${selectedBuild.name}`
        : "Wszystkie budowy";

  const pickerBuilds = visibleBuilds.filter((b) => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      b.number.toLowerCase().includes(q) || b.name.toLowerCase().includes(q)
    );
  });

  const openPicker = () => {
    setPickerQuery("");
    setPickerOpen(true);
  };

  const pickBuild = (id: string | "all") => {
    setSelectedBuildId(id);
    setPickerOpen(false);
  };

  return (
    <>
      <ScreenHeader
        title="Raporty"
        description="Zapisane raporty dzienne i ich aktualny stan."
        action={
          <Pressable
            onPress={() => startNewReport()}
            style={({ pressed }) => ({
              backgroundColor: COLORS.primary,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 10,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text
              style={{ color: COLORS.background, fontWeight: "800", fontSize: 13 }}
            >
              + Nowy raport
            </Text>
          </Pressable>
        }
      />

      {builds.length > 0 && (
        <>
          <View
            className="bg-surface border border-border rounded-2xl overflow-hidden mb-3"
            style={{ flexDirection: "row" }}
          >
            <Pressable
              onPress={() => switchBuildsFilter("active")}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: "center",
                backgroundColor:
                  buildsFilter === "active" ? COLORS.primary : "transparent",
              }}
            >
              <Text
                style={{
                  color: buildsFilter === "active" ? COLORS.background : COLORS.muted,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                Aktywne budowy
              </Text>
            </Pressable>
            <Pressable
              onPress={() => switchBuildsFilter("archived")}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: "center",
                backgroundColor:
                  buildsFilter === "archived" ? COLORS.primary : "transparent",
              }}
            >
              <Text
                style={{
                  color: buildsFilter === "archived" ? COLORS.background : COLORS.muted,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                Zarchiwizowane
              </Text>
            </Pressable>
          </View>

          <Text className="text-xs text-muted uppercase mb-1.5">Budowa</Text>
          <Pressable
            onPress={openPicker}
            className="bg-surface border border-border rounded-2xl mb-4"
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          >
            <Text
              className="text-foreground"
              style={{ fontSize: 14, fontWeight: "700" }}
              numberOfLines={1}
            >
              {selectedBuildLabel}
            </Text>
            <MaterialIcons name="expand-more" size={20} color={COLORS.muted} />
          </Pressable>

          <Modal
            visible={pickerOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setPickerOpen(false)}
          >
            <Pressable
              onPress={() => setPickerOpen(false)}
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
                    value={pickerQuery}
                    onChangeText={setPickerQuery}
                    placeholder="Szukaj budowy..."
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
                  <Pressable
                    onPress={() => pickBuild("all")}
                    style={({ pressed }) => ({
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      backgroundColor: pressed ? COLORS.background : "transparent",
                    })}
                  >
                    <Text style={{ color: COLORS.foreground, fontSize: 14, fontWeight: "700" }}>
                      Wszystkie budowy
                    </Text>
                    {selectedBuildId === "all" && (
                      <MaterialIcons name="check" size={18} color={COLORS.primary} />
                    )}
                  </Pressable>
                  {pickerBuilds.map((b) => (
                    <Pressable
                      key={b.id}
                      onPress={() => pickBuild(b.id)}
                      style={({ pressed }) => ({
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        borderTopWidth: 1,
                        borderTopColor: COLORS.border,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        backgroundColor: pressed ? COLORS.background : "transparent",
                      })}
                    >
                      <Text style={{ color: COLORS.foreground, fontSize: 14 }} numberOfLines={1}>
                        <Text style={{ fontWeight: "700" }}>{b.number}</Text> · {b.name}
                      </Text>
                      {selectedBuildId === b.id && (
                        <MaterialIcons name="check" size={18} color={COLORS.primary} />
                      )}
                    </Pressable>
                  ))}
                  {pickerBuilds.length === 0 && (
                    <Text
                      style={{ color: COLORS.muted, fontSize: 13, padding: 14 }}
                    >
                      Brak budów pasujących do wyszukiwania.
                    </Text>
                  )}
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>
        </>
      )}

      {reportsInScope.length > 0 && (
        <View
          className="bg-surface border border-border rounded-2xl overflow-hidden mb-5"
          style={{ flexDirection: "row" }}
        >
          {(
            [
              { key: "all", label: "Wszystkie", count: reportsInScope.length },
              { key: "pending", label: "Do edycji", count: pendingCount },
              { key: "approved", label: "Zatwierdzone", count: approvedCount },
            ] as { key: StatusFilter; label: string; count: number }[]
          ).map((tab, i) => {
            const active = statusFilter === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setStatusFilter(tab.key)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  alignItems: "center",
                  borderLeftWidth: i === 0 ? 0 : 1,
                  borderLeftColor: COLORS.border,
                  backgroundColor: active ? COLORS.primary : "transparent",
                }}
              >
                <Text
                  style={{
                    color: active ? COLORS.background : COLORS.foreground,
                    fontWeight: "700",
                    fontSize: 12,
                  }}
                >
                  {tab.label} ({tab.count})
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {sorted.length === 0 ? (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center">
          <IconBadge name={statusFilter === "pending" ? "check-circle" : "description"} />
          <Text className="text-base font-bold text-foreground mt-3">
            {statusFilter === "pending" && reportsInScope.length > 0
              ? "Wszystkie raporty są aktualne"
              : "Brak zapisanych raportów"}
          </Text>
          {!(statusFilter === "pending" && reportsInScope.length > 0) && (
            <Text className="text-sm text-muted mt-2 text-center">
              {selectedBuildId === "all"
                ? "Zapisane raporty pojawią się tutaj po zakończeniu raportu dziennego."
                : "Ta budowa nie ma jeszcze żadnych raportów."}
            </Text>
          )}
        </View>
      ) : (
        sorted.map((report) => {
          const approved = report.status === "approved";
          const materialsCount = Object.keys(report.materialValues).length;
          const peopleCount = report.people.length;
          return (
            <Pressable
              key={report.id}
              onPress={() => openSavedReport(report.id)}
              style={({ pressed }) => ({
                backgroundColor: COLORS.surface,
                borderWidth: 1,
                borderColor: approved ? COLORS.success : COLORS.border,
                borderRadius: 16,
                padding: 14,
                marginBottom: 12,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <Text className="text-base font-bold text-foreground" numberOfLines={1}>
                  {report.buildNumber} · {report.buildName}
                </Text>
                <Text className="text-xs text-muted" style={{ marginLeft: 8 }}>
                  {report.date}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 10,
                }}
              >
                <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                  {peopleCount} {peopleCount === 1 ? "osoba" : "osoby"} ·{" "}
                  {materialsCount}{" "}
                  {materialsCount === 1 ? "materiał" : "materiały"}
                </Text>
                <StatusBadge
                  status={approved ? "ok" : "warning"}
                  label={approved ? "Zatwierdzony" : "Do edycji"}
                />
              </View>
            </Pressable>
          );
        })
      )}
    </>
  );
}
