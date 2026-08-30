import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  COLORS,
  Button,
  confirmAction,
  DetailSection,
  Field,
  IconBadge,
  QuantityStepper,
  ScreenHeader,
  StatusBadge,
  UNIT_OPTIONS,
} from "@/components/report-ui";
import { useAppData, type OrderCartItem } from "@/contexts/app-data";
import { matchMaterialNames, normalizeMaterialName } from "@/lib/material-name-match";

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
    shortages,
    dismissShortage,
    materials,
    builds,
    buildOrders,
    updateOrderItemQuantity,
    markBuildOrderOrdered,
    cancelBuildOrder,
    deleteBuildOrder,
    receiveBuildOrder,
    submitOrderCart,
    createOrderFromShortage,
    markOrderOrdered,
    deleteOrder,
    receiveOrder,
  } = useAppData();

  const [orderMaterialNameRaw, setOrderMaterialNameRaw] = useState("");
  const [orderQuantity, setOrderQuantity] = useState("");
  const [orderUnit, setOrderUnit] = useState("szt.");
  const [orderSaved, setOrderSaved] = useState(false);
  // Czy wpisana nazwa (bez jednoznacznego dopasowania w magazynie) została
  // JAWNIE potwierdzona jako nowy materiał — patrz addToOrderCart niżej.
  // Reset przy każdej zmianie nazwy (setOrderMaterialName), żeby literówka
  // poprawiona na coś innego wymagała ponownego potwierdzenia.
  const [orderConfirmedNewMaterial, setOrderConfirmedNewMaterial] = useState(false);
  const orderMaterialName = orderMaterialNameRaw;
  const setOrderMaterialName = (name: string) => {
    setOrderMaterialNameRaw(name);
    setOrderConfirmedNewMaterial(false);
  };
  // Koszyk zamówienia ręcznego ("Zamów materiał spoza listy") — pozycje
  // zbierane lokalnie, zanim cokolwiek trafi do bazy. Dopiero finalne
  // zatwierdzenie (submitOrderCart, w contexts/app-data.tsx) tworzy
  // zamówienia w Supabase — po jednym na każdą pozycję koszyka.
  const [orderCart, setOrderCart] = useState<OrderCartItem[]>([]);
  // Dokłada bieżąco wpisany materiał+ilość do koszyka — NIE tworzy jeszcze
  // zamówienia w bazie. Formularz czyści się od razu, żeby dało się
  // dopisać kolejną pozycję.
  const addToOrderCart = () => {
    const quantity = Number(orderQuantity);
    if (!orderMaterialName.trim() || !quantity || quantity <= 0) return;
    const matched = materials.find(
      (m) => normalizeMaterialName(m.name) === normalizeMaterialName(orderMaterialName),
    );
    // Nazwa nie pasuje jednoznacznie do żadnego materiału w magazynie —
    // wymagamy jawnego potwierdzenia "to nowy materiał", żeby literówka nie
    // utworzyła po cichu pozycji niepowiązanej z żadnym wierszem
    // magazynowym (patrz docs/PROCES_ZARZADZANIE_MATERIALEM.md, Ryzyko 6).
    if (!matched && !orderConfirmedNewMaterial) return;
    setOrderCart((prev) => [
      ...prev,
      {
        id: `cart-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        materialName: orderMaterialName.trim(),
        quantity,
        unit: matched?.unit || orderUnit || "szt.",
        materialId: matched?.id,
      },
    ]);
    setOrderMaterialName("");
    setOrderQuantity("");
    setOrderUnit("szt.");
  };
  // Jawne potwierdzenie "materiału nie ma na liście, dodaj go jako nowy" —
  // pokazywane w UI tylko gdy wpisana nazwa nie ma jednoznacznego
  // dopasowania w magazynie.
  const confirmOrderNewMaterial = () => setOrderConfirmedNewMaterial(true);
  const removeFromOrderCart = (id: string) => {
    setOrderCart((prev) => prev.filter((item) => item.id !== id));
  };

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
    // Nie tylko "zawiera podciąg" — też prawdopodobne literówki (Piasek
    // pukany -> Piasek płukany), patrz lib/material-name-match.ts.
    const matches = matchMaterialNames(
      orderMaterialName,
      materials.map((m) => ({ id: m.id, name: m.name })),
    );
    const byId = new Map(materials.map((m) => [m.id, m]));
    return matches.map((m) => byId.get(m.candidate.id)).filter((m): m is (typeof materials)[number] => !!m);
  }, [orderMaterialName, materials]);
  const showSuggestions =
    nameFieldFocused && orderMaterialName.trim().length > 0;
  const exactMaterialMatch = materials.find(
    (m) => normalizeMaterialName(m.name) === normalizeMaterialName(orderMaterialName),
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

  // Zamówienia z koszyka (kilka materiałów zatwierdzonych naraz, patrz
  // submitOrderCart w contexts/app-data.tsx) dostają wspólny batchId — to
  // JEDNO zamówienie od zgłoszenia aż do przyjęcia na magazyn, więc karta
  // grupy zostaje jedna przez cały cykl (do realizacji -> zamówione),
  // dokładnie jak "Zamówienia z planu budów" (orders/order_items) wyżej.
  // Dopiero PRZYJĘCIE dostawy jest z natury per materiał (inna ilość/cena/
  // dzień) — więc to jedyny etap, na którym pozycje w karcie działają
  // osobno. Grupa znika z aktywnego widoku dopiero, gdy WSZYSTKIE pozycje
  // są "dostarczone" (wtedy trafiają do zwykłej, płaskiej historii).
  const batchGroups = useMemo(() => {
    const groups = new Map<string, typeof orders>();
    for (const o of orders) {
      if (!o.batchId) continue;
      const list = groups.get(o.batchId) ?? [];
      list.push(o);
      groups.set(o.batchId, list);
    }
    return [...groups.entries()]
      .map(([batchId, items]) => ({
        batchId,
        items,
        // Dopóki żadna pozycja nie została jeszcze złożona u dostawcy,
        // grupa pokazuje jedną parę przycisków (Złożono u dostawcy/Usuń).
        // Po złożeniu (bulk action przenosi WSZYSTKIE pozycje naraz)
        // przechodzi w tryb "przyjęcie per pozycja".
        allPending: items.every((i) => i.status === "do realizacji"),
        allDelivered: items.every((i) => i.status === "dostarczone"),
      }))
      .filter((g) => !g.allDelivered);
  }, [orders]);
  const batchedOrderIds = useMemo(
    () => new Set(batchGroups.flatMap((g) => g.items.map((i) => i.id))),
    [batchGroups],
  );

  // Jedna, spójna lista pozycji — każdy materiał ma dokładnie JEDEN status
  // w danym momencie (Brak -> Do realizacji -> Zamówione -> Dostarczone),
  // zamiast pojawiać się równocześnie w sekcji "Braki" i w sekcji zamówień.
  // Zamówienia będące częścią batchGroups (patrz wyżej) są tu pominięte —
  // renderują się osobno, zgrupowane.
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

    const orderRows: Row[] = orders
      .filter((o) => !batchedOrderIds.has(o.id))
      .map((o) => ({
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
  }, [shortages, orders, batchedOrderIds]);

  const brakiCount = rows.filter((r) => r.status === "brak").length;
  // Liczniki wliczają też zamówienia wygenerowane z planu technologii
  // budowy (buildOrders, sekcja "Zamówienia z planu budów" niżej) —
  // wcześniej liczyły wyłącznie zamówienia magazynowe (orders), więc
  // przyjęcie dostawy z zamówienia wygenerowanego z technologii nie
  // ruszało licznika "Dostarczone".
  const wDrodzeCount =
    orders.filter((o) => o.status === "do realizacji" || o.status === "zamówione").length +
    buildOrders.filter((o) => o.status === "robocze" || o.status === "zamówione").length;
  const dostarczoneCount =
    orders.filter((o) => o.status === "dostarczone").length +
    buildOrders.filter((o) => o.status === "przyjęte").length;

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

      {/* Zamówienie ręczne, spoza listy braków — zwinięte domyślnie,
          otwierane przyciskiem w nagłówku, tuż pod nim (nie na dole
          strony), żeby nie trzeba było szukać, gdzie się otworzyło. */}
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
          {/* Nazwa bez jednoznacznego dopasowania w magazynie (literówka
              albo faktycznie nowy materiał) — wymagamy jawnego
              potwierdzenia zamiast po cichu tworzyć pozycję niepowiązaną
              z żadnym wierszem magazynowym (patrz
              docs/PROCES_ZARZADZANIE_MATERIALEM.md, Ryzyko 6). */}
          {!exactMaterialMatch && orderMaterialName.trim().length > 0 && (
            orderConfirmedNewMaterial ? (
              <Text style={{ color: COLORS.success, fontSize: 11, marginTop: 4 }}>
                Potwierdzone — „{orderMaterialName.trim()}" trafi do magazynu
                jako nowy materiał przy przyjęciu dostawy.
              </Text>
            ) : (
              <>
                <Text style={{ color: COLORS.warning, fontSize: 11, marginTop: 4 }}>
                  Nie ma takiego materiału w magazynie. Sprawdź podpowiedzi
                  wyżej — jeśli to literówka, wybierz istniejący materiał,
                  albo potwierdź, że to naprawdę nowy.
                </Text>
                <Pressable onPress={confirmOrderNewMaterial} style={{ marginTop: 6 }}>
                  <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700" }}>
                    To nowy materiał — dodaj do zamówienia
                  </Text>
                </Pressable>
              </>
            )
          )}
          {!exactMaterialMatch && orderMaterialName.trim().length > 0 && (
            <View style={{ marginTop: 10 }}>
              <Text className="text-xs text-muted uppercase mb-2">Jednostka</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {UNIT_OPTIONS.map((unit) => (
                  <Pressable
                    key={unit}
                    onPress={() => setOrderUnit(unit)}
                    style={{
                      backgroundColor:
                        orderUnit === unit ? COLORS.primary : COLORS.background,
                      borderRadius: 10,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderWidth: 1,
                      borderColor: orderUnit === unit ? COLORS.primary : COLORS.border,
                    }}
                  >
                    <Text
                      style={{
                        color: orderUnit === unit ? COLORS.background : COLORS.foreground,
                        fontWeight: "700",
                      }}
                    >
                      {unit}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Field
                placeholder="albo wpisz własną jednostkę"
                value={orderUnit}
                onChangeText={setOrderUnit}
                style={{ marginTop: 8 }}
              />
            </View>
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
            <Button
              label="+ Dodaj do koszyka"
              onPress={addToOrderCart}
              disabled={
                !exactMaterialMatch &&
                !orderConfirmedNewMaterial &&
                orderMaterialName.trim().length > 0
              }
            />
          </View>

          {orderCart.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text
                style={{ color: COLORS.muted, fontSize: 11, marginBottom: 8 }}
                className="uppercase"
              >
                Koszyk ({orderCart.length})
              </Text>
              {orderCart.map((item) => (
                <View
                  key={item.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    backgroundColor: COLORS.background,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    marginBottom: 6,
                  }}
                >
                  <Text
                    style={{ color: COLORS.foreground, fontSize: 13, flex: 1 }}
                    numberOfLines={1}
                  >
                    {item.materialName}{" "}
                    <Text style={{ color: COLORS.muted }}>
                      · {item.quantity} {item.unit}
                    </Text>
                  </Text>
                  <Pressable onPress={() => removeFromOrderCart(item.id)} style={{ marginLeft: 10 }}>
                    <Text style={{ color: COLORS.danger, fontWeight: "700", fontSize: 12 }}>
                      Usuń
                    </Text>
                  </Pressable>
                </View>
              ))}
              <View style={{ marginTop: 6 }}>
                <Button
                  label="Utwórz zamówienie"
                  onPress={async () => {
                    const ok = await submitOrderCart(orderCart);
                    if (ok) {
                      setOrderCart([]);
                      setOrderSaved(true);
                    }
                  }}
                />
              </View>
            </View>
          )}
          {orderSaved && (
            <Text
              style={{ color: COLORS.success, fontWeight: "700", marginTop: 10 }}
            >
              Zamówienie zapisane.
            </Text>
          )}
        </View>
      )}

      {/* Zamówienia z planu materiałowego budowy (Faza 3) — generowane z
          karty budowy przyciskiem "+ Z planu", ale statusy i przyjęcie
          dostawy obsługujemy tu, w jednym miejscu ze wszystkimi
          zamówieniami, zamiast rozproszone po poszczególnych budowach. */}
      {buildOrders.length > 0 && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-5">
          <DetailSection label="Zamówienia z planu budów" count={buildOrders.length} style={{ marginTop: 0 }}>
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

                {order.status === "anulowane" && (
                  <View style={{ marginTop: 10 }}>
                    <Button
                      label="Usuń zamówienie"
                      secondary
                      fullWidth
                      onPress={() =>
                        confirmAction(
                          "Skasować zamówienie?",
                          `${order.orderNumber} zostanie trwale usunięte z listy.`,
                          "Usuń",
                          () => deleteBuildOrder(order.id),
                        )
                      }
                    />
                  </View>
                )}
              </View>
            );
          })}
          </DetailSection>
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

      {/* LISTA — zagęszczona, jeden wiersz = jeden materiał, jeden status. */}
      {filter !== "aktywne" && (
        <Pressable onPress={() => setFilter("aktywne")} style={{ marginBottom: 10 }}>
          <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
            ← Pokaż wszystkie aktywne
          </Text>
        </Pressable>
      )}

      {/* Zamówienia złożone naraz z koszyka (kilka materiałów, wspólny
          batchId) — jedna karta przez cały cykl zamówienia. Dopóki
          group.allPending, jedna para przycisków działa na całość. Po
          złożeniu u dostawcy karta zostaje, ale przyjęcie dostawy jest już
          per pozycja (inna ilość/cena per materiał) — patrz batchGroups. */}
      {(filter === "aktywne" || filter === "wdrodze") &&
        batchGroups.map((group) => (
          <View
            key={group.batchId}
            className="bg-surface border border-border rounded-xl px-4 py-3 mb-2"
          >
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-sm font-bold text-foreground">
                  Zamówienie · {group.items.length} pozycje
                </Text>
              </View>
              <StatusBadge
                status="warning"
                label={group.allPending ? "Do realizacji" : "Zamówione"}
              />
            </View>

            {group.allPending ? (
              <>
                {group.items.map((item) => (
                  <Text
                    key={item.id}
                    className="text-xs text-foreground mt-1"
                    numberOfLines={1}
                  >
                    {item.materialName} · {item.quantity} {item.unit}
                  </Text>
                ))}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  <Pressable
                    onPress={async () => {
                      for (const item of group.items) await markOrderOrdered(item.id);
                    }}
                    style={({ pressed }) => ({
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
                  <Pressable
                    onPress={() =>
                      confirmAction(
                        "Usunąć zamówienie?",
                        `${group.items.length} pozycji. Tej operacji nie da się cofnąć.`,
                        "Usuń",
                        async () => {
                          for (const item of group.items) await deleteOrder(item.id);
                        },
                      )
                    }
                    style={({ pressed }) => ({
                      borderWidth: 1,
                      borderColor: COLORS.danger,
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: COLORS.danger, fontWeight: "700", fontSize: 12 }}>
                      Usuń
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              // Złożone u dostawcy — karta zostaje jedna, ale przyjęcie
              // dostawy jest już per materiał (inna ilość/cena/dzień),
              // dokładnie jak w "Zamówieniach z planu budów" wyżej.
              group.items.map((item) => {
                const isReceivingItem = receivingId === item.id;
                return (
                  <View
                    key={item.id}
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTopWidth: 1,
                      borderTopColor: COLORS.border,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 8,
                        justifyContent: "space-between",
                      }}
                    >
                      <Text
                        style={{ color: COLORS.foreground, fontSize: 12, flex: 1, minWidth: 0 }}
                        numberOfLines={1}
                      >
                        {item.materialName} ·{" "}
                        {item.status === "dostarczone"
                          ? `przyjęto ${item.receivedQuantity} ${item.unit}`
                          : `${item.quantity} ${item.unit}`}
                      </Text>
                      {item.status === "zamówione" && !isReceivingItem && (
                        <Pressable
                          onPress={() => {
                            const currentPrice =
                              materials.find((m) => m.id === item.materialId)?.unitPrice ?? 0;
                            setReceiveDrafts({
                              ...receiveDrafts,
                              [item.id]: String(item.quantity ?? 0),
                            });
                            setReceivePriceDrafts({
                              ...receivePriceDrafts,
                              [item.id]: String(currentPrice || ""),
                            });
                            setReceivingId(item.id);
                          }}
                          style={({ pressed }) => ({
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
                      {item.status === "dostarczone" && (
                        <StatusBadge status="ok" label="Dostarczone" />
                      )}
                    </View>

                    {isReceivingItem && (
                      <View style={{ marginTop: 10 }}>
                        <View style={{ flexDirection: "row", gap: 10 }}>
                          <View style={{ flex: 1 }}>
                            <Text className="text-xs text-muted uppercase">
                              Ilość ({item.unit})
                            </Text>
                            <QuantityStepper
                              style={{ marginTop: 8 }}
                              value={receiveDrafts[item.id] ?? String(item.quantity ?? 0)}
                              onChangeText={(v: string) =>
                                setReceiveDrafts({ ...receiveDrafts, [item.id]: v })
                              }
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text className="text-xs text-muted uppercase">
                              Cena tej dostawy (PLN)
                            </Text>
                            <QuantityStepper
                              style={{ marginTop: 8 }}
                              value={receivePriceDrafts[item.id] ?? ""}
                              onChangeText={(v: string) =>
                                setReceivePriceDrafts({ ...receivePriceDrafts, [item.id]: v })
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
                              value={receiveDocumentDrafts[item.id] ?? ""}
                              onChangeText={(v: string) =>
                                setReceiveDocumentDrafts({
                                  ...receiveDocumentDrafts,
                                  [item.id]: v,
                                })
                              }
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text className="text-xs text-muted uppercase">Dostawca</Text>
                            <Field
                              style={{ marginTop: 8 }}
                              placeholder="opcjonalnie"
                              value={receiveSupplierDrafts[item.id] ?? ""}
                              onChangeText={(v: string) =>
                                setReceiveSupplierDrafts({
                                  ...receiveSupplierDrafts,
                                  [item.id]: v,
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
                              onPress={async () => {
                                const qty = Number(receiveDrafts[item.id]);
                                if (!qty || qty <= 0) return;
                                const price = Number(receivePriceDrafts[item.id]) || undefined;
                                await receiveOrder(
                                  item.id,
                                  qty,
                                  price,
                                  receiveDocumentDrafts[item.id],
                                  receiveSupplierDrafts[item.id],
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
              })
            )}
          </View>
        ))}

      {visibleRows.length === 0 && batchGroups.length === 0 && (
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
              style={{ opacity: row.status === "dostarczone" ? 0.7 : 1 }}
            >
              {/* Status + akcje NAD nazwą materiału — z długimi etykietami
                  przycisków ("Złożono u dostawcy") w jednym wierszu obok
                  nazwy, na wąskim mobile obu brakowało miejsca i nazwa
                  łamała się pojedynczymi literami. Osobny wiersz niżej ma
                  zawsze pełną szerokość karty dla samej nazwy. */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                  justifyContent: "space-between",
                }}
              >
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
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {row.status === "brak" && (
                    <>
                      <Pressable
                        onPress={() =>
                          row.materialId &&
                          row.missing &&
                          createOrderFromShortage(row.materialId, row.missing)
                        }
                        style={({ pressed }) => ({
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
                      {/* Materiał ma już 0 na magazynie, ale Admin wie, że go
                          NIE zamawia teraz (ma go gdzie indziej / po innej
                          cenie) — krzyżyk chowa alert, dopóki niedobór nie
                          urośnie. Patrz dismissShortage w contexts/app-data.tsx. */}
                      <Pressable
                        onPress={() =>
                          row.materialId != null &&
                          row.missing != null &&
                          confirmAction(
                            "Nie zamawiać teraz?",
                            `${row.name} — alert o braku zniknie z Zamówień, dopóki niedobór nie wzrośnie ponad ${row.missing} ${row.unit}.`,
                            "Nie zamawiaj",
                            () => dismissShortage(row.materialId!, row.missing!),
                          )
                        }
                        style={({ pressed }) => ({
                          borderWidth: 1,
                          borderColor: COLORS.border,
                          borderRadius: 8,
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Text style={{ color: COLORS.muted, fontWeight: "800", fontSize: 12 }}>
                          ✕
                        </Text>
                      </Pressable>
                    </>
                  )}
                  {row.status === "do realizacji" && row.orderId && (
                    <>
                      <Pressable
                        onPress={() => markOrderOrdered(row.orderId!)}
                        style={({ pressed }) => ({
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
                      <Pressable
                        onPress={() =>
                          confirmAction(
                            "Usunąć zamówienie?",
                            `${row.name} · ${row.qtyLabel}. Tej operacji nie da się cofnąć.`,
                            "Usuń",
                            () => deleteOrder(row.orderId!),
                          )
                        }
                        style={({ pressed }) => ({
                          borderWidth: 1,
                          borderColor: COLORS.danger,
                          borderRadius: 8,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Text style={{ color: COLORS.danger, fontWeight: "700", fontSize: 12 }}>
                          Usuń
                        </Text>
                      </Pressable>
                    </>
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
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    marginRight: 12,
                    flexShrink: 0,
                    backgroundColor:
                      row.status === "brak"
                        ? COLORS.danger
                        : row.status === "dostarczone"
                          ? COLORS.success
                          : COLORS.warning,
                  }}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text className="text-xs text-muted mt-0.5" numberOfLines={2}>
                    {row.qtyLabel} · {row.metaLabel}
                  </Text>
                </View>
              </View>
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
