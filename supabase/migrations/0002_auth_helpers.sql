-- 0002_auth_helpers.sql — Supabase uyumlu JWT yardımcıları
-- Hosted Supabase'de auth.uid()/auth.role() hazır gelir. Yerelde GoTrue (auth sunucusu)
-- kendi auth şemasını kurar; biz yalnız aynı imzalı yardımcıları ekleriz.
-- Bu fonksiyonlar PostgREST'in istek bağlamına koyduğu request.jwt.claims'i okur.
-- İstemciden gelen hiçbir alan (user_id/role/tenant_id) yetki kanıtı sayılmaz;
-- tek kanıt, PostgREST'in doğruladığı JWT'nin claim'leridir.

create or replace function auth.jwt_claims() returns jsonb
language sql stable
as $$
  select case
           when nullif(current_setting('request.jwt.claims', true), '') is null then '{}'::jsonb
           else nullif(current_setting('request.jwt.claims', true), '')::jsonb
         end;
$$;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select case
           when (auth.jwt_claims() ->> 'sub') is null then null
           else (auth.jwt_claims() ->> 'sub')::uuid
         end;
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select auth.jwt_claims() ->> 'role';
$$;
