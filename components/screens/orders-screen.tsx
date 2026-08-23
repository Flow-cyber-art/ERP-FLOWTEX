import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  COLORS,
  Button,
  confirmAction,
  Field,
  IconBadge,
  QuantityStepper,
  ScreenHeader,
  StatusBadge,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

const BUILD_ORDER_STATUS_LABEL: Record<string, string> = {
  robocze: "Robocze",
  zamówione: "Zamówione",
  przyjęte: "Przyjęte",
  anulowane: "Anulowane",
};

type Filter = "aktywne" | "braki" | "wdrodze" | "dostarczone";

type Row = {
  key: string;
  name: string;
  qtyLabel: string;
  metaLabel: string;
  status: "brak" | "do realizacji" | "zamówione" | "dostarczone";
  materialId?: string;
  missing?: number;
  orderId?: string;
  orderQuantity?: number;
  unit: string;
};

const capitalizeFirst = (v: string) =>
  v.length ? v.charAt(0).toUpperCase() + v.slice(1) : v;

const STATUS_LABEL: Record<Row["status"], string> = {
  brak: "Brak",
  "do realizacji": "Do realizacji",
  zamówione: "Zamówione",
  dostarczone: "Dostarczone",
};

export function OrdersScreen() {
  const {
    orders,
    orderMaterialName,
    orderQuantity,
    orderSaved,
    setOrderMaterialName,
    setOrderQuantity,
    setOrderSaved,
    shortages,
    materials,
    builds,
    buildOrders,
    updateOrderItemQuantity,
    markBuildOrderOrdered,
    cancelBuildOrder,
    receiveBuildOrder,
    createOrder,
    createOrderFromShortage,
    markOrderOrdered,
    receiveOrder,
  } = useAppData();

  // Zamówienia z planu materiałowego budowy (Faza 3) — te same akcje co
  // w karcie budowy, tylko zebrane w jednym miejscu razem ze statusami,
  // zamiast być rozproszone po poszczególnych budowach.
  const [buildOrderReceivingId, setBuildOrderReceivingId] = useState<number | null>(
    null,
  );
  const [buildOrderReceiveDrafts, setBuildOrderReceiveDrafts] = useState<
    Record<number, { qty: string; price: string }>
  >({});
  const [buildOrderReceiveDocument, setBuildOrderReceiveDocument] = useState("");
  const [buildOrderReceiveSupplier, setBuildOrderReceiveSupplier] = useState("");
  const [buildOrderReceiveBusy, setBuildOrderReceiveBusy] = useState(false);
  const [editingBuildOrderItemId, setEditingBuildOrderItemId] = useState<
    number | null
  >(null);
  const [buildOrderQtyDraft, setBuildOrderQtyDraft] = useState("");

  const [manualFormOpen, setManualFormOpen] = useState(false);
  // Podpowiedzi z magazynu podczas wpisywania nazwy w formularzu "Zamów
  // materiał spoza listy" — żeby nie tworzyć duplikatu literówką, gdy
  // materiał tak naprawdę już jest w magazynie. Pokazujemy tylko gdy pole
  // ma focus i coś pasuje; znika po wybraniu podpowiedzi lub po opuszczeniu
  // pola.
  const [nameFieldFocused, setNameFieldFocused] = useState(false);
  const materialSuggestions = useMemo(() => {
    const q = orderMaterialName.trim().toLowerCase();
    if (!q) return [];
    return materials
      .filter((m) => `${m.name} ${m.index}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [orderMaterialName, materials]);
  const showSuggestions =
    nameFieldFocused && orderMaterialName.trim().length > 0;
  const exactMaterialMatch = materials.find(
    (m) => m.name.trim().toLowerCase() === orderMaterialName.trim().toLowerCase(),
  );
  // Ilość faktycznie dostarczona — edytowalna per zamówienie tuż przed
  // przyjęciem na magazyn, bo dostawca mógł przywieźć inną ilość niż zamówiono.
  const [receiveDrafts, setReceiveDrafts] = useState<Record<string, string>>(
    {},
  );
  // Cena tej konkretnej dostawy — dostawca mógł zmienić cennik od
  // ostatniego zamówienia, więc edytowalna tuż przed przyjęciem, tak
  // samo jak ilość.
  const [receivePriceDrafts, setReceivePriceDrafts] = useState<
    Record<string, string>
  >({});
  // Dokument dostawy i dostawca (Faza 4) — opcjonalne, zapisywane na
  // przyjmowanej partii; jeden dokument/dostawca na to jedno przyjęcie.
  const [receiveDocumentDrafts, setReceiveDocumentDrafts] = useState<
    Record<string, string>
  >({});
  const [receiveSupplierDrafts, setReceiveSupplierDrafts] = useState<
    Record<string, string>
  >({});
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("aktywne");

  // Jedna, spójna lista pozycji — każdy materiał ma dokładnie JEDEN status
  // w danym momencie (Brak -> Do realizacji -> Zamówione -> Dostarczone),
  // zamiast pojawiać się równocześnie w sekcji "Braki" i w sekcji zamówień.
  const rows: Row[] = useMemo(() => {
    const shortageRows: Row[] = shortages
      .filter(
        (row) =>
          !orders.some(
            (o) => o.materialId === row.material.id && o.status !== "dostarczone",
          ),
      )
      .map((row) => ({
        key: `shortage-${row.material.id}`,
        name: row.material.name,
        qtyLabel: `brakuje ${row.missing} ${row.material.unit}`,
        metaLabel: `plan ${row.needed} · magazyn ${row.material.stock} ${row.material.unit}`,
        status: "brak",
        materialId: row.material.id,
        missing: row.missing,
        unit: row.material.unit,
      }));

    const orderRows: Row[] = orders.map((o) => ({
      key: `order-${o.id}`,
      name: o.materialName,
      qtyLabel:
        o.status === "dostarczone"
          ? `przyjęto ${o.receivedQuantity} ${o.unit}`
          : `${o.quantity} ${o.unit}`,
      metaLabel:
        o.status === "dostarczone"
          ? `${o.receivedAt}`
          : o.status === "zamówione"
            ? `zamówiono ${o.orderedAt || o.createdAt}`
            : `zgłoszono ${o.createdAt}`,
      status: o.status,
      materialId: o.materialId,
      orderId: o.id,
      orderQuantity: o.quantity,
      unit: o.unit,
    }));

    const order = { brak: 0, "do realizacji": 1, zamówione: 2, dostarczone: 3 };
    return [...shortageRows, ...orderRows].sort(
      (a, b) => order[a.status] - order[b.status],
    );
  }, [shortages, orders]);

  const brakiCount = rows.filter((r) => r.status === "brak").length;
  const wDrodzeCount = rows.filter(
    (r) => r.status === "do realizacji" || r.status === "zamówione",
  ).length;
  const dostarczoneCount = rows.filter((r) => r.status === "dostarczone").length;

  const visibleRows = rows.filter((r) => {
    if (filter === "braki") return r.status === "brak";
    if (filter === "wdrodze")
      return r.status === "do realizacji" || r.status === "zamówione";
    if (filter === "dostarczone") return r.status === "dostarczone";
    return r.status !== "dostarczone"; // "aktywne" — historia domyślnie ukryta
  });

  const kpi = (
    label: string,
    count: number,
    color: string,
    value: Filter,
  ) => {
    const active = filter === value;
    return (
      <Pressable
        onPress={() => setFilter(active ? "aktywne" : value)}
        style={({ pressed }) => ({
          flex: 1,
          padding: 16,
          backgroundColor: active ? COLORS.background : "transparent",
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Text className="text-xs text-muted uppercase">{label}</Text>
        <Text
          style={{ color: count ? color : COLORS.foreground }}
          className="text-3xl font-bold mt-1"
        >
          {count}
        </Text>
      </Pressable>
    );
  };

  return (
    <>
      <ScreenHeader
        title="Zamówienia"
        description="Braki materiałowe, zamówienia w drodze i przyjęcia na magazyn."
        action={
          <Pressable
            onPress={() => setManualFormOpen(!manualFormOpen)}
            style={({ pressed }) => ({
              backgroundColor: COLORS.primary,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 10,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text style={{ color: COLORS.background, fontWeight: "800", fontSize: 13 }}>
              {manualFormOpen ? "Zwiń" : "+ Nowe zamówienie"}
            </Text>
          </Pressable>
        }
      />

      {/* Zamówienia z planu materiałowego budowy (Faza 3) — generowane z
          karty budowy przyciskiem "+ Z planu", ale statusy i przyjęcie
          dostawy obsługujemy tu, w jednym miejscu ze wszystkimi
          zamówieniami, zamiast rozproszone po poszczególnych budowach. */}
      {buildOrders.length > 0 && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-5">
          <Text className="text-xs text-muted uppercase mb-3">
            Zamówienia z planu budów
          </Text>
          {buildOrders.map((order) => {
            const build = builds.find((b) => b.id === String(order.buildId));
            const isReceiving = buildOrderReceivingId === order.id;
            return (
              <View
                key={order.id}
                style={{
                  backgroundColor: COLORS.background,
                  borderRadius: 10,
                  padding: 10,
                  marginBottom: 10,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
                      {order.orderNumber}
                    </Text>
                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                      {build ? `${build.number} · ${build.name}` : `budowa #${order.buildId}`}
                    </Text>
                  </View>
                  <StatusBadge
                    status={
                      order.status === "przyjęte"
                        ? "ok"
                        : order.status === "anulowane"
                          ? "danger"
                          : "warning"
                    }
                    label={BUILD_ORDER_STATUS_LABEL[order.status]}
                  />
                </View>

                {order.order_items.map((item) => (
                  <View
                    key={item.id}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 6,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: COLORS.foreground, fontSize: 12 }}>
                        {item.materialName}
                      </Text>
                      {/* Faza 3b: część planu pokryta wolnym magazynem
                          (nieprzypisanym do żadnej budowy) — już odjęta
                          od ilości zamawianej po prawej. */}
                      {Number(item.availableFreeQuantity) > 0 && (
                        <Text style={{ color: COLORS.success, fontSize: 10, marginTop: 2 }}>
                          Na magazynie (wolne): {item.availableFreeQuantity} {item.unit}
                        </Text>
                      )}
                    </View>
                    {order.status === "robocze" && editingBuildOrderItemId === item.id ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ width: 90 }}>
                          <QuantityStepper
                            value={buildOrderQtyDraft}
                            onChangeText={setBuildOrderQtyDraft}
                          />
                        </View>
                        <Pressable
                          onPress={async () => {
                            const qty = Number(buildOrderQtyDraft);
                            if (qty > 0) await updateOrderItemQuantity(item.id, qty);
                            setEditingBuildOrderItemId(null);
                          }}
                        >
                          <Text style={{ color: COLORS.success, fontSize: 12, fontWeight: "700" }}>
                            OK
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        disabled={order.status !== "robocze"}
                        onPress={() => {
                          setEditingBuildOrderItemId(item.id);
                          setBuildOrderQtyDraft(item.orderedQuantity);
                        }}
                      >
                        <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                          {item.orderedQuantity} {item.unit}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ))}

                {order.status === "robocze" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Złożono u dostawcy"
                        fullWidth
                        onPress={() => markBuildOrderOrdered(order.id)}
                      />
                    </View>
                    <Pressable
                      onPress={() =>
                        confirmAction(
                          "Anulować zamówienie?",
                          `${order.orderNumber} zostanie oznaczone jako anulowane.`,
                          "Anuluj zamówienie",
                          () => cancelBuildOrder(order.id),
                        )
                      }
                      style={{ justifyContent: "center", paddingHorizontal: 10 }}
                    >
                      <Text style={{ color: COLORS.danger, fontSize: 12, fontWeight: "700" }}>
                        Anuluj
                      </Text>
                    </Pressable>
                  </View>
                )}

                {order.status === "zamówione" && !isReceiving && (
                  <View style={{ marginTop: 10 }}>
                    <Button
                      label="Dostawa dotarła"
                      fullWidth
                      onPress={() => {
                        const drafts: Record<number, { qty: string; price: string }> = {};
                        for (const item of order.order_items) {
                          const material = materials.find(
                            (m) => m.id === String(item.linkedMaterialId ?? ""),
                          );
                          drafts[item.id] = {
                            qty: item.orderedQuantity,
                            price: material ? String(material.unitPrice ?? "") : "",
                          };
                        }
                        setBuildOrderReceiveDrafts(drafts);
                        setBuildOrderReceiveDocument("");
                        setBuildOrderReceiveSupplier("");
                        setBuildOrderReceivingId(order.id);
                      }}
                    />
                  </View>
                )}

                {order.status === "zamówione" && isReceiving && (
                  <View style={{ marginTop: 10 }}>
                    {order.order_items.map((item) => (
                      <View key={item.id} style={{ marginTop: 8 }}>
                        <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                          {item.materialName}
                        </Text>
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                              Ilość ({item.unit})
                            </Text>
                            <QuantityStepper
                              value={buildOrderReceiveDrafts[item.id]?.qty ?? ""}
                              onChangeText={(v: string) =>
                                setBuildOrderReceiveDrafts({
                                  ...buildOrderReceiveDrafts,
                                  [item.id]: { ...buildOrderReceiveDrafts[item.id], qty: v },
                                })
                              }
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                              Cena (PLN)
                            </Text>
                            <QuantityStepper
                              value={buildOrderReceiveDrafts[item.id]?.price ?? ""}
                              onChangeText={(v: string) =>
                                setBuildOrderReceiveDrafts({
                                  ...buildOrderReceiveDrafts,
                                  [item.id]: { ...buildOrderReceiveDrafts[item.id], price: v },
                                })
                              }
                            />
                          </View>
                        </View>
                      </View>
                    ))}
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                          Nr dokumentu (PZ)
                        </Text>
                        <Field
                          style={{ marginTop: 4 }}
                          placeholder="opcjonalnie"
                          value={buildOrderReceiveDocument}
                          onChangeText={setBuildOrderReceiveDocument}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: COLORS.muted, fontSize: 10 }}>Dostawca</Text>
                        <Field
                          style={{ marginTop: 4 }}
                          placeholder="opcjonalnie"
                          value={buildOrderReceiveSupplier}
                          onChangeText={setBuildOrderReceiveSupplier}
                        />
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Anuluj"
                          secondary
                          fullWidth
                          onPress={() => setBuildOrderReceivingId(null)}
                        />
                      </View>
                      <View style={{ flex: 2 }}>
                        <Button
                          label="Przyjmij na magazyn"
                          fullWidth
                          onPress={async () => {
                            setBuildOrderReceiveBusy(true);
                            try {
                              await receiveBuildOrder(
                                order.id,
                                order.order_items.map((item) => ({
                                  itemId: item.id,
                                  receivedQuantity:
                                    Number(buildOrderReceiveDrafts[item.id]?.qty) || 0,
                                  receivedUnitPrice:
                                    Number(buildOrderReceiveDrafts[item.id]?.price) || undefined,
                                })),
                                buildOrderReceiveDocument,
                                buildOrderReceiveSupplier,
                              );
                              setBuildOrderReceivingId(null);
                            } finally {
                              setBuildOrderReceiveBusy(false);
                            }
                          }}
                        />
                      </View>
                    </View>
                    {buildOrderReceiveBusy && (
                      <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 6 }}>
                        Zapisywanie…
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* KPI = jednocześnie filtry. Tap przełącza widok listy poniżej. */}
      <View
        className="bg-surface border border-border rounded-2xl mb-5"
        style={{ flexDirection: "row", overflow: "hidden" }}
      >
        {kpi("Braki", brakiCount, COLORS.danger, "braki")}
        <View style={{ width: 1, backgroundColor: COLORS.border }} />
        {kpi("W drodze", wDrodzeCount, COLORS.primary, "wdrodze")}
        <View style={{ width: 1, backgroundColor: COLORS.border }} />
        {kpi("Dostarczone", dostarczoneCount, COLORS.success, "dostarczone")}
      </View>

      {/* Zamówienie ręczne, spoza listy braków — zwinięte domyślnie,
          otwierane przyciskiem w nagłówku, żeby nie zajmowało stałego
          miejsca w treści widoku. */}
      {manualFormOpen && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-5">
          <Text className="text-sm font-bold text-foreground">
            Zamów materiał spoza listy
          </Text>
          <Text className="text-xs text-muted mt-1">
            Coś, czego nie ma jeszcze w magazynie ani w planach budów.
          </Text>
          <Field
            placeholder="Nazwa materiału"
            value={orderMaterialName}
            onChangeText={(v: string) => setOrderMaterialName(capitalizeFirst(v))}
            onFocus={() => setNameFieldFocused(true)}
            onBlur={() => {
              // Małe opóźnienie, żeby tapnięcie w podpowiedź zdążyło się
              // zarejestrować zanim lista zniknie (onBlur odpala się
              // przed onPress na liście, gdyby zniknęła natychmiast).
              setTimeout(() => setNameFieldFocused(false), 150);
            }}
          />
          {showSuggestions && materialSuggestions.length > 0 && (
            <View
              style={{
                backgroundColor: COLORS.background,
                borderRadius: 10,
                marginTop: 6,
                overflow: "hidden",
              }}
            >
              {materialSuggestions.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => {
                    setOrderMaterialName(m.name);
                    setNameFieldFocused(false);
                  }}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: COLORS.border,
                  }}
                >
                  <Text
                    style={{
                      color: COLORS.foreground,
                      fontSize: 13,
                      fontWeight: "600",
                    }}
                  >
                    {m.name}
                  </Text>
                  <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                    {m.index} · na magazynie: {m.stock ?? 0} {m.unit}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {exactMaterialMatch && (
            <Text
              style={{ color: COLORS.success, fontSize: 11, marginTop: 4 }}
            >
              Materiał już jest w magazynie ({exactMaterialMatch.index}) —
              zamówienie zostanie do niego dopięte.
            </Text>
          )}
          <Text
            style={{ color: COLORS.muted, fontSize: 11, marginTop: 10 }}
            className="uppercase"
          >
            Ilość do zamówienia
          </Text>
          <QuantityStepper
            style={{ marginTop: 8 }}
            value={orderQuantity}
            onChangeText={setOrderQuantity}
          />
          <View style={{ marginTop: 12 }}>
            <Button label="Utwórz zamówienie" onPress={createOrder} />
          </View>
          {orderSaved && (
            <Text
              style={{ color: COLORS.success, fontWeight: "700", marginTop: 10 }}
            >
              Zamówienie zapisane.
            </Text>
          )}
        </View>
      )}

      {/* LISTA — zagęszczona, jeden wiersz = jeden materiał, jeden status. */}
      {filter !== "aktywne" && (
        <Pressable onPress={() => setFilter("aktywne")} style={{ marginBottom: 10 }}>
          <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
            ← Pokaż wszystkie aktywne
          </Text>
        </Pressable>
      )}

      {visibleRows.length === 0 && (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center">
          <IconBadge name="local-shipping" />
          <Text className="text-sm text-muted mt-3 text-center">
            Brak pozycji w tym widoku.
          </Text>
        </View>
      )}

      {visibleRows.map((row, i) => {
        const isReceiving = row.orderId && receivingId === row.orderId;
        return (
          <View key={row.key}>
            <View
              className="bg-surface border border-border rounded-xl px-4 py-3 mb-2"
              style={{ flexDirection: "row", alignItems: "center", opacity: row.status === "dostarczone" ? 0.7 : 1 }}
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  marginRight: 12,
                  backgroundColor:
                    row.status === "brak"
                      ? COLORS.danger
                      : row.status === "dostarczone"
                        ? COLORS.success
                        : COLORS.warning,
                }}
              />
              <View style={{ flex: 1 }}>
                <Text className="text-sm font-bold text-foreground">
                  {row.name}
                </Text>
                <Text className="text-xs text-muted mt-0.5">
                  {row.qtyLabel} · {row.metaLabel}
                </Text>
              </View>
              <StatusBadge
                status={
                  row.status === "brak"
                    ? "danger"
                    : row.status === "dostarczone"
                      ? "ok"
                      : "warning"
                }
                label={STATUS_LABEL[row.status]}
              />
              {row.status === "brak" && (
                <Pressable
                  onPress={() =>
                    row.materialId &&
                    row.missing &&
                    createOrderFromShortage(row.materialId, row.missing)
                  }
                  style={({ pressed }) => ({
                    marginLeft: 10,
                    backgroundColor: COLORS.primary,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Text style={{ color: COLORS.background, fontWeight: "800", fontSize: 12 }}>
                    Zamów
                  </Text>
                </Pressable>
              )}
              {row.status === "do realizacji" && row.orderId && (
                <Pressable
                  onPress={() => markOrderOrdered(row.orderId!)}
                  style={({ pressed }) => ({
                    marginLeft: 10,
                    borderWidth: 1,
                    borderColor: COLORS.primary,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 12 }}>
                    Złożono u dostawcy
                  </Text>
                </Pressable>
              )}
              {row.status === "zamówione" && row.orderId && !isReceiving && (
                <Pressable
                  onPress={() => {
                    const currentPrice =
                      materials.find((m) => m.id === row.materialId)?.unitPrice ?? 0;
                    setReceiveDrafts({
                      ...receiveDrafts,
                      [row.orderId!]: String(row.orderQuantity ?? 0),
                    });
                    setReceivePriceDrafts({
                      ...receivePriceDrafts,
                      [row.orderId!]: String(currentPrice || ""),
                    });
                    setReceivingId(row.orderId!);
                  }}
                  style={({ pressed }) => ({
                    marginLeft: 10,
                    backgroundColor: COLORS.successBg,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: COLORS.success, fontWeight: "700", fontSize: 12 }}>
                    Dostawa dotarła
                  </Text>
                </Pressable>
              )}
            </View>

            {isReceiving && row.orderId && (
              <View
                className="bg-surface border border-border rounded-xl p-4 mb-2"
                style={{ marginTop: -6 }}
              >
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text className="text-xs text-muted uppercase">
                      Ilość ({row.unit})
                    </Text>
                    <QuantityStepper
                      style={{ marginTop: 8 }}
                      value={receiveDrafts[row.orderId] ?? String(row.orderQuantity ?? 0)}
                      onChangeText={(v: string) =>
                        setReceiveDrafts({ ...receiveDrafts, [row.orderId!]: v })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text className="text-xs text-muted uppercase">
                      Cena tej dostawy (PLN)
                    </Text>
                    <QuantityStepper
                      style={{ marginTop: 8 }}
                      value={receivePriceDrafts[row.orderId] ?? ""}
                      onChangeText={(v: string) =>
                        setReceivePriceDrafts({ ...receivePriceDrafts, [row.orderId!]: v })
                      }
                    />
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text className="text-xs text-muted uppercase">Nr dokumentu (PZ)</Text>
                    <Field
                      style={{ marginTop: 8 }}
                      placeholder="opcjonalnie"
                      value={receiveDocumentDrafts[row.orderId!] ?? ""}
                      onChangeText={(v: string) =>
                        setReceiveDocumentDrafts({
                          ...receiveDocumentDrafts,
                          [row.orderId!]: v,
                        })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text className="text-xs text-muted uppercase">Dostawca</Text>
                    <Field
                      style={{ marginTop: 8 }}
                      placeholder="opcjonalnie"
                      value={receiveSupplierDrafts[row.orderId!] ?? ""}
                      onChangeText={(v: string) =>
                        setReceiveSupplierDrafts({
                          ...receiveSupplierDrafts,
                          [row.orderId!]: v,
                        })
                      }
                    />
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Anuluj"
                      secondary
                      fullWidth
                      onPress={() => setReceivingId(null)}
                    />
                  </View>
                  <View style={{ flex: 2 }}>
                    <Button
                      label="Przyjmij na magazyn"
                      fullWidth
                      onPress={() => {
                        const qty = Number(receiveDrafts[row.orderId!]);
                        if (!qty || qty <= 0) return;
                        const price = Number(receivePriceDrafts[row.orderId!]);
                        receiveOrder(
                          row.orderId!,
                          qty,
                          price > 0 ? price : undefined,
                          receiveDocumentDrafts[row.orderId!],
                          receiveSupplierDrafts[row.orderId!],
                        );
                        setReceivingId(null);
                      }}
                    />
                  </View>
                </View>
              </View>
            )}
          </View>
        );
      })}
    </>
  );
}
