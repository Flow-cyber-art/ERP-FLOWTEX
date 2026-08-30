import { supabase } from "@/lib/supabase";

/**
 * Rejestracja tokenu Expo Push dla powiadomień o nowym raporcie (Admin) —
 * patrz 067_push_notifications_nowy_raport.sql i
 * supabase/functions/send-report-notification/index.ts. Upsert po
 * tokenie idzie przez RPC (SECURITY DEFINER), nie wprost do tabeli — patrz
 * komentarz w migracji.
 */
export async function registerPushToken(token: string, platform?: string): Promise<void> {
  const { error } = await supabase.rpc("register_push_token", {
    p_token: token,
    p_platform: platform ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Web Push (Safari iOS 16.4+, patrz lib/notifications/use-register-web-
 * push.ts) — odpowiednik registerPushToken dla przeglądarki zamiast
 * natywnego tokenu Expo. `subscription` to wynik
 * `PushSubscription.toJSON()`.
 */
export async function registerWebPushSubscription(subscription: {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}): Promise<void> {
  if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
    throw new Error("Subskrypcja push nie ma kompletu kluczy szyfrowania.");
  }
  const { error } = await supabase.rpc("register_web_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.keys.p256dh,
    p_auth: subscription.keys.auth,
  });
  if (error) throw new Error(error.message);
}

/**
 * Fire-and-forget: wołane zaraz po udanym `submitDailyReport` (patrz
 * lib/offline-outbox.ts) żeby Admin dostał push "na bieżąco". Błąd tutaj
 * (brak sieci, funkcja niezdeployowana) NIE powinien nigdy zepsuć ani
 * cofnąć zapisu raportu, który już się udał — dlatego wywołujący ma
 * połykać wyjątek, nie czekać na tę funkcję przed pokazaniem sukcesu.
 */
export async function notifyNewReport(buildId: number, date: string): Promise<void> {
  const { error } = await supabase.functions.invoke("send-report-notification", {
    body: { buildId, date },
  });
  if (error) throw new Error(error.message);
}
