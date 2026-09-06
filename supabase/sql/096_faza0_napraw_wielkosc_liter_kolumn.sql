-- ============================================================
-- Fix: "Could not find the 'updatedAt' column of 'offers' in the
-- schema cache" przy zapisie oferty w kroku 4 wizardu.
--
-- Przyczyna: 094_faza0_oferty.sql deklarował createdBy/createdAt/
-- updatedAt (i offer_pilot_technologies.addedAt) BEZ cudzysłowów —
-- Postgres domyślnie składa niecytowane identyfikatory do małych liter,
-- więc realne kolumny w bazie to createdby/createdat/updatedat/addedat,
-- a nie camelCase, którego oczekuje lib/data/offers.ts (i PostgREST,
-- które w schema cache widzi tylko to, co faktycznie jest w katalogu).
-- Reszta kolumn (snake_case) nie miała tego problemu.
--
-- Naprawa: RENAME COLUMN z jawnym cudzysłowem, żeby zachować dokładnie
-- camelCase — dokładnie tak samo jak realne "createdAt"/"createdBy" w
-- technologies (patrz 000_faza0-2_fundament_schematu.sql, gdzie te
-- kolumny powstały z cytowanego dumpu). Tabele offers/offer_items/
-- offer_pilot_technologies są w tym momencie puste (żaden zapis się
-- nie udał przez ten sam błąd) — zero ryzyka utraty danych.
-- ============================================================

alter table offers rename column createdby to "createdBy";
alter table offers rename column createdat to "createdAt";
alter table offers rename column updatedat to "updatedAt";

alter table offer_pilot_technologies rename column addedat to "addedAt";
