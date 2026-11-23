-- ============================================================
-- 119: Urlopy — dni robocze z pominięciem polskich świąt ustawowych (F29)
-- count_business_days liczył tylko poniedziałek–piątek, więc wniosek
-- 23–28.12.2026 zabierał z puli 4 dni (Wigilia i Boże Narodzenie liczone
-- jako robocze) zamiast 2. Reguły świąt identyczne jak w lib/workdays.ts
-- (budowy): stałe + Poniedziałek Wielkanocny + Boże Ciało, Wigilia od 2025.
-- ============================================================
BEGIN;

-- Wielkanoc (algorytm Meeusa/Jonesa/Butchera, kalendarz gregoriański)
CREATE OR REPLACE FUNCTION public.easter_date(p_year integer)
 RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
declare
  a int := p_year % 19;  b int := p_year / 100;  c int := p_year % 100;
  d int := b / 4;        e int := b % 4;         f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;        k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
  mon int := (h + l - 7 * m + 114) / 31;
  dy int := ((h + l - 7 * m + 114) % 31) + 1;
begin
  return make_date(p_year, mon, dy);
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_polish_holiday(p_day date)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  select to_char(p_day, 'MM-DD') in ('01-01','01-06','05-01','05-03','08-15','11-01','11-11','12-25','12-26')
      or (extract(year from p_day) >= 2025 and to_char(p_day, 'MM-DD') = '12-24')
      or p_day = easter_date(extract(year from p_day)::int) + 1    -- Poniedziałek Wielkanocny
      or p_day = easter_date(extract(year from p_day)::int) + 60;  -- Boże Ciało
$function$;

CREATE OR REPLACE FUNCTION public.count_business_days(p_from date, p_to date)
 RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  select count(*)::integer
  from generate_series(p_from, p_to, interval '1 day') as g(d)
  where extract(isodow from g.d) < 6
    and not is_polish_holiday(g.d::date);
$function$;

-- Przelicz wnioski, które liczą się do puli (oczekujące i zatwierdzone).
UPDATE leave_requests
   SET "businessDays" = count_business_days("dateFrom", "dateTo"),
       "updatedAt" = now()
 WHERE status IN ('oczekujący', 'zatwierdzony')
   AND "businessDays" <> count_business_days("dateFrom", "dateTo");

REVOKE EXECUTE ON FUNCTION easter_date(integer), is_polish_holiday(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION easter_date(integer), is_polish_holiday(date) TO authenticated, service_role;

COMMIT;

-- Kontrola: select count_business_days('2026-12-23','2026-12-28'); -- = 2
--           select count_business_days('2027-03-26','2027-03-30'); -- = 2 (Wielkanoc 28.03.2027)
