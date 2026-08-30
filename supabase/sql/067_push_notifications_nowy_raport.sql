-- ============================================================
-- Powiadomienia push dla Admina o nowym raporcie dziennym.
--
-- Kontekst: notatka dla klienta (reports.client_note) generuje się
-- automatycznie dopiero PRZY ZATWIERDZENIU raportu przez Admina (patrz
-- 063_portal_klienta_podsumowanie_ai.sql, approveReport w
-- contexts/app-data.tsx) — więc żeby to działo się "na bieżąco", Admin
-- musi wiedzieć od razu, że nowy raport czeka na sprawdzenie, zamiast
-- odkrywać to przy następnym otwarciu apki.
--
-- push_tokens: token Expo Push per zalogowany profil (jedno urządzenie =
-- jeden wiersz, unikalny po tokenie — ten sam token nadpisuje właściciela,
-- gdyby telefon zmienił konto). Rejestrowany z apki (lib/data/push-
-- tokens.ts) tylko dla roli Admin — patrz komponent rejestrujący w
-- app/_layout.tsx. Wysyłkę robi Edge Function `send-report-notification`
-- (supabase/functions/send-report-notification/index.ts), wołana
-- fire-and-forget zaraz po wysłaniu raportu (submitDailyReport w
-- contexts/app-data.tsx) — najpierw pobiera tokeny wszystkich Adminów z
-- tej tabeli, potem woła Expo Push API.
--
-- Uruchom w dowolnym momencie. Bezpieczne do wielokrotnego wklejenia.
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

create table if not exists push_tokens (
  id serial primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  token text not null unique,
  platform text,
  created_at timestamptz not null default now()
);

create index if not exists push_tokens_profile_id_idx on push_tokens(profile_id);

alter table push_tokens enable row level security;

-- Brak zwykłych policy insert/update: rejestracja idzie WYŁĄCZNIE przez
-- register_push_token (niżej) — SECURITY DEFINER, bo upsert po tokenie
-- (nie po profile_id, żeby to samo urządzenie mogło zmienić właściciela
-- po ponownym zalogowaniu na inne konto) nie da się bezpiecznie wyrazić
-- zwykłą RLS policy z insert+update na raz (ON CONFLICT DO UPDATE
-- sprawdzałby "using" starego wiersza, należącego jeszcze do poprzedniego
-- właściciela, i odrzucał upsert).
drop policy if exists "push_tokens_own_select" on push_tokens;
create policy "push_tokens_own_select" on push_tokens
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "push_tokens_own_delete" on push_tokens;
create policy "push_tokens_own_delete" on push_tokens
  for delete to authenticated
  using (profile_id = auth.uid());

create or replace function register_push_token(p_token text, p_platform text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Wymagana sesja.';
  end if;
  insert into push_tokens (profile_id, token, platform)
    values (auth.uid(), p_token, p_platform)
    on conflict (token) do update
      set profile_id = excluded.profile_id, platform = excluded.platform;
end;
$$;

grant execute on function register_push_token(text, text) to authenticated;
