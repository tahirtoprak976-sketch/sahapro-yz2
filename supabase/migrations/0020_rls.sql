-- 0020_rls.sql — Satır düzeyi güvenlik (RLS) ve erişim sözleşmesi
--
-- Model: API'ye yalnızca `authenticated` rolü okuma hakkıyla çıkar; `anon` hiçbir
-- tabloya erişemez. Tüm YAZMALAR SECURITY DEFINER RPC'ler üzerinden yapılır
-- (0030_rpc.sql); tablolarda insert/update/delete POLİTİKASI YOKTUR ve bu rollere
-- o haklar GRANT da edilmez — dolayısıyla doğrudan tablo yazımı hem GRANT hem
-- RLS katmanında reddedilir. Okumalar aşağıdaki SELECT politikalarıyla şirket ve
-- rol kapsamına göre süzülür. SECURITY DEFINER fonksiyonlar sahibi (postgres)
-- olarak çalışır ve RLS'i aşar; bu yüzden her biri kendi yetki kontrolünü
-- auth.uid() + memberships üzerinden açıkça yapar (yetki sunucuda, veritabanında).
--
-- Üyelik kontrolleri politika içinden SECURITY DEFINER yardımcılarla yapılır;
-- aksi hâlde memberships politikasının memberships'i sorgulaması sonsuz
-- özyinelemeye düşer (PostgreSQL bunu reddeder).

alter table public.tenants    enable row level security;
alter table public.memberships enable row level security;
alter table public.reports    enable row level security;
alter table public.revisions  enable row level security;
alter table public.works      enable row level security;
alter table public.approvals  enable row level security;
alter table public.audit      enable row level security;

-- ---- RLS yardımcıları (SECURITY DEFINER: sahibi RLS'i aşar → özyineleme yok) ----

create or replace function public.rls_is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships
                 where tenant_id = p_tenant and user_id = auth.uid());
$$;

create or replace function public.rls_has_role(p_tenant uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships
                 where tenant_id = p_tenant and user_id = auth.uid() and role = any(p_roles));
$$;

-- ---- SELECT politikaları ----

-- tenants: yalnız üyesi olduğu şirketi görebilir
drop policy if exists tenants_member_select on public.tenants;
create policy tenants_member_select on public.tenants
  for select to authenticated
  using (public.rls_is_member(id));

-- memberships: aynı şirketin üyeleri üyelik listesini görebilir (isim/rol gösterimi için)
drop policy if exists memberships_tenant_select on public.memberships;
create policy memberships_tenant_select on public.memberships
  for select to authenticated
  using (public.rls_is_member(tenant_id));

-- reports: ofis/yönetici şirketin tüm bildirimlerini; şoför YALNIZ KENDİ bildirimlerini
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
  for select to authenticated
  using (public.rls_has_role(tenant_id, array['ofis','yonetici'])
         or (public.rls_has_role(tenant_id, array['sofor']) and driver_id = auth.uid()));

-- revisions: ofis/yönetici şirket kaydının revizyonlarını; şoför kendi kaydınınkini
drop policy if exists revisions_select on public.revisions;
create policy revisions_select on public.revisions
  for select to authenticated
  using (exists (select 1 from public.reports r
                 where r.id = revisions.report_id
                   and (public.rls_has_role(r.tenant_id, array['ofis','yonetici'])
                        or r.driver_id = auth.uid())));

-- works: ofis/yönetici şirketin işleri; şoför kendi işini
drop policy if exists works_select on public.works;
create policy works_select on public.works
  for select to authenticated
  using (exists (select 1 from public.reports r
                 where r.id = works.report_id
                   and (public.rls_has_role(r.tenant_id, array['ofis','yonetici'])
                        or r.driver_id = auth.uid())));

-- approvals: works ile aynı kapsam
drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals
  for select to authenticated
  using (exists (select 1 from public.reports r
                 where r.id = approvals.report_id
                   and (public.rls_has_role(r.tenant_id, array['ofis','yonetici'])
                        or r.driver_id = auth.uid())));

-- audit: works ile aynı kapsam (şoför kendi kaydının geçmişini görür — düzeltme gerekçesi dahil)
drop policy if exists audit_select on public.audit;
create policy audit_select on public.audit
  for select to authenticated
  using (exists (select 1 from public.reports r
                 where r.id = audit.report_id
                   and (public.rls_has_role(r.tenant_id, array['ofis','yonetici'])
                        or r.driver_id = auth.uid())));

-- Bilinçli olarak HİÇBİR tabloda insert/update/delete politikası yok:
-- tüm yazmalar SECURITY DEFINER RPC'lerdedir.

-- GRANT yüzeyi: anon'a hiçbir şey yok; authenticated'a yalnız SELECT + RPC EXECUTE.
grant usage on schema public to authenticated;
grant select on public.tenants, public.memberships, public.reports, public.revisions,
                public.works, public.approvals, public.audit to authenticated;
revoke all on public.tenants, public.memberships, public.reports, public.revisions,
              public.works, public.approvals, public.audit from anon;

-- Fonksiyonlar varsayılan olarak PUBLIC'e execute açık gelir; kapatıp teker teker açıyoruz
alter default privileges revoke execute on functions from public;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.jwt_claims(), auth.uid(), auth.role() to authenticated, anon;
