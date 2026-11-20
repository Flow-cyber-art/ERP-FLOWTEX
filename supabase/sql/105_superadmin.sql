-- ============================================================
-- Super administrator: konto, które może zarządzać WSZYSTKIMI kontami
-- logowania (dodawać, usuwać, zmieniać hasła/maile/role/powiązania z
-- pracownikami), także tymi spoza listy pracowników, i którego nie da się
-- ruszyć żadnym innym Adminem.
--
-- Wcześniej "główne konto" było rozpoznawane po adresie e-mail
-- (PROTECTED_ADMIN_EMAIL w Edge Function admin-users) — zmiana adresu
-- gubiła ochronę. Teraz identyfikuje je tabela `superadmins` (po id konta),
-- więc można zmieniać e-mail bez ryzyka.
--
-- Tabela jest tylko do ODCZYTU własnego wiersza z aplikacji (RLS); zapis
-- tylko przez service_role (Edge Function) lub SQL Editor — żaden Admin
-- nie nada sobie tej roli z klienta.
--
-- Trigger poniżej zamyka też drogę "na skróty": polityka profiles_admin_all
-- pozwala KAŻDEMU Adminowi pisać do profiles wprost z klienta (PostgREST),
-- czyli mógłby zmienić rolę super admina albo skasować jego profil bez
-- Edge Function. Trigger blokuje to dla kont z `superadmins`, o ile
-- wywołujący sam nie jest super adminem / service_role / właścicielem bazy.
--
-- Nadanie roli (SQL Editor):
--   insert into superadmins (user_id) select id from auth.users where email = 'ds@flowtex.pl';
-- Odebranie:
--   delete from superadmins where user_id = (select id from auth.users where email = '...');
-- ============================================================

create table if not exists superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  "createdAt" timestamp not null default now()
);

alter table superadmins enable row level security;

drop policy if exists "superadmins_select_own" on superadmins;
create policy "superadmins_select_own" on superadmins
  for select to authenticated using (user_id = auth.uid());
-- Brak polityk INSERT/UPDATE/DELETE celowo: tylko service_role / SQL Editor.

create or replace function is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.superadmins where user_id = auth.uid());
$$;

create or replace function protect_superadmin_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.superadmins where user_id = old.id)
     and not (
       public.is_superadmin()
       or coalesce(auth.role(), '') = 'service_role'
       or current_user in ('postgres', 'supabase_admin')
     )
  then
    raise exception 'Konto super administratora jest chronione.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_superadmin on profiles;
create trigger profiles_protect_superadmin
  before update or delete on profiles
  for each row execute function protect_superadmin_profile();

-- Dotychczasowe "główne konto" (admin@flowtex.pl) zostaje super adminem.
insert into superadmins (user_id)
select id from auth.users where email = 'admin@flowtex.pl'
on conflict do nothing;
