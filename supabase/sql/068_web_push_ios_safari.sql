-- ============================================================
-- Web Push (Safari na iPhone) dla powiadomień o nowym raporcie.
--
-- Kontekst: telefony, na których faktycznie pracuje Admin, to iPhone'y —
-- natywny build EAS wymaga konta Apple Developer (99$/rok), którego na
-- razie nie ma. Safari od iOS 16.4 obsługuje prawdziwe Web Push dla
-- stron dodanych "Do ekranu głównego" — bez App Store, za darmo. Ta
-- migracja dokłada drugi kanał powiadomień OBOK Expo Push (push_tokens,
-- 067_push_notifications_nowy_raport.sql) — dokładnie ten sam wzorzec,
-- tylko subskrypcja przeglądarki (endpoint + klucze szyfrowania) zamiast
-- tokenu Expo.
--
-- web_push_subscriptions: jedna subskrypcja per przeglądarka/urządzenie
-- (unikalna po endpoint — URL push service Apple/Google, jednoznacznie
-- identyfikuje instalację). register_web_push_subscription (RPC,
-- SECURITY DEFINER) upsert po tym samym powodzie co register_push_token
-- w 067 — endpoint może zmienić właściciela po ponownym zalogowaniu na
-- inne konto na tym samym urządzeniu.
--
-- Klucz publiczny VAPID (do subskrypcji w przeglądarce) jest wpisany
-- wprost w app.config.ts (`extra.vapidPublicKey`) — nie jest sekretem.
-- Klucz PRYWATNY VAPID (do podpisywania wysyłki) żyje wyłącznie jako
-- sekret Edge Function VAPID_PRIVATE_KEY — patrz
-- supabase/functions/send-report-notification/index.ts.
--
-- Uruchom w dowolnym momencie. Bezpieczne do wielokrotnego wklejenia.
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

create table if not exists web_push_subscriptions (
  id serial primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists web_push_subscriptions_profile_id_idx
  on web_push_subscriptions(profile_id);

alter table web_push_subscriptions enable row level security;

-- Brak zwykłych policy insert/update — patrz uzasadnienie w 067 dla
-- push_tokens (ON CONFLICT DO UPDATE po endpoint, nie po profile_id).
drop policy if exists "web_push_subscriptions_own_select" on web_push_subscriptions;
create policy "web_push_subscriptions_own_select" on web_push_subscriptions
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "web_push_subscriptions_own_delete" on web_push_subscriptions;
create policy "web_push_subscriptions_own_delete" on web_push_subscriptions
  for delete to authenticated
  using (profile_id = auth.uid());

create or replace function register_web_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Wymagana sesja.';
  end if;
  insert into web_push_subscriptions (profile_id, endpoint, p256dh, auth)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update
      set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

grant execute on function register_web_push_subscription(text, text, text) to authenticated;
