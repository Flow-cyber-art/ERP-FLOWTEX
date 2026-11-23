import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  COLORS,
  IconBadge,
  StatusBadge,
  ScreenHeader,
  SearchablePicker,
  pluralPL,
  SegmentedControl, ReportListHeader } from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";
import { RADIUS } from "@/constants/radius";
import { Icon } from "@/components/icon";
import { useWideLayout } from "@/hooks/use-wide-layout";
import { getPendingReports, onOutboxFlushed, type PendingReportSubmission } from "@/lib/offline-outbox";

type StatusFilter = "all" | "pending" | "approved";

export function SavedReportsScreen() {
  const isWide = useWideLayout();
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

  // Raporty zapisane w telefonie, które jeszcze nie dotarły na serwer
  // (brak zasięgu). Bez tego znikały z listy do czasu wysłania (F28).
  const [pendingReports, setPendingReports] = useState<PendingReportSubmission[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      getPendingReports()
        .then((items) => alive && setPendingReports(items))
        .catch(() => undefined);
    refresh();
    const interval = setInterval(refresh, 15_000);
    const off = onOutboxFlushed(refresh);
    return () => {
      alive = false;
      clearInterval(interval);
      off();
    };
  }, []);

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
              borderRadius: RADIUS.control,
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
      {pendingReports.length > 0 && (
        <View
          style={{
            borderWidth: 1,
            borderColor: COLORS.warning,
            borderRadius: RADIUS.control,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: COLORS.warning, fontWeight: "800", fontSize: 13 }}>
            {pendingReports.length === 1
              ? "1 raport czeka w telefonie na wysłanie"
              : `${pendingReports.length} raporty czekają w telefonie na wysłanie`}
          </Text>
          {pendingReports.map((r) => (
            <Text key={`${r.buildId}:${r.date}:${r.teamId ?? ""}`} style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>
              {(builds.find((b) => b.id === String(r.buildId))?.name ?? `Budowa #${r.buildId}`) + " · " + r.date}
              {r.isNetworkError === false && r.lastError ? ` — serwer odrzucił: ${r.lastError}` : " — wyśle się sam, gdy będzie internet"}
            </Text>
          ))}
        </View>
      )}

      {builds.length > 0 && (
        <>
          <View
            className="bg-surface border border-border rounded-card overflow-hidden mb-3"
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
            className="bg-surface border border-border rounded-card mb-4"
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
            <Icon name="chevron-down" size={20} color={COLORS.muted} />
          </Pressable>

          <SearchablePicker
            visible={pickerOpen}
            onClose={() => setPickerOpen(false)}
            query={pickerQuery}
            onQueryChange={setPickerQuery}
            placeholder="Szukaj budowy..."
            selectedKey={selectedBuildId}
            onSelect={(key) => pickBuild(key as string | "all")}
            emptyLabel="Brak budów pasujących do wyszukiwania."
            items={[
              { key: "all", title: "Wszystkie budowy" },
              ...pickerBuilds.map((b) => ({
                key: b.id,
                title: `${b.number} · ${b.name}`,
              })),
            ]}
          />
        </>
      )}

      {reportsInScope.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <SegmentedControl
            options={[
              { key: "all", label: `Wszystkie (${reportsInScope.length})` },
              { key: "pending", label: `Do edycji (${pendingCount})` },
              { key: "approved", label: `Zatwierdzone (${approvedCount})` },
            ] as { key: StatusFilter; label: string }[]}
            value={statusFilter}
            onChange={setStatusFilter}
            fullWidth
          />
        </View>
      )}

      {sorted.length === 0 ? (
        <View className="bg-surface border border-border rounded-card p-5 items-center">
          <IconBadge name={statusFilter === "pending" ? "check-circle" : "file-text"} />
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
        <>
        {isWide && <ReportListHeader showBuildInfo />}
        {sorted.map((report) => {
          const approved = report.status === "approved";
          const needsFix = report.status === "do_poprawy";
          const badge = (
            <StatusBadge
              status={approved ? "ok" : needsFix ? "danger" : "warning"}
              label={approved ? "Zatwierdzony" : needsFix ? "Do poprawy" : "Do edycji"}
            />
          );
          const materialsCount = Object.keys(report.materialValues).length;
          const peopleCount = report.people.length;
          return (
            <Pressable
              key={report.id}
              onPress={() => openSavedReport(report.id)}
              style={({ pressed }) => ({
                backgroundColor: COLORS.surface,
                borderWidth: 1,
                borderColor: approved ? COLORS.success : needsFix ? COLORS.danger : COLORS.border,
                borderRadius: RADIUS.card,
                padding: isWide ? 12 : 14,
                paddingHorizontal: isWide ? 16 : 14,
                marginBottom: isWide ? 8 : 12,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              {isWide ? (
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 3, paddingRight: 12 }}>
                    <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                      {report.buildName}
                    </Text>
                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                      {report.buildNumber}
                    </Text>
                  </View>
                  <Text style={{ width: 110, color: COLORS.foreground, fontSize: 13 }}>{report.date}</Text>
                  <Text style={{ flex: 2, color: COLORS.muted, fontSize: 13 }}>
                    {peopleCount} {pluralPL(peopleCount, "osoba", "osoby", "osób")} · {materialsCount}{" "}
                    {pluralPL(materialsCount, "materiał", "materiały", "materiałów")}
                  </Text>
                  <View style={{ width: 150, alignItems: "flex-start" }}>
                    {badge}
                  </View>
                  <View style={{ width: 36, alignItems: "flex-end" }}>
                    <Icon name="chevron-right" size={18} color={COLORS.muted} />
                  </View>
                </View>
              ) : (
                <>
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
                  {peopleCount} {pluralPL(peopleCount, "osoba", "osoby", "osób")} ·{" "}
                  {materialsCount}{" "}
                  {pluralPL(materialsCount, "materiał", "materiały", "materiałów")}
                </Text>
                {badge}
              </View>
                </>
              )}
              {needsFix && report.adminComment ? (
                <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 8 }}>
                  Do poprawy: „{report.adminComment}” — otwórz raport, popraw i wyślij ponownie.
                </Text>
              ) : null}
            </Pressable>
          );
        })}
        </>
      )}
    </>
  );
}
