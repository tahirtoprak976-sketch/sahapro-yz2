-- 0010_schema.sql — Sunucu dilimi veri modeli (public şema)
-- İş-kuralı sözleşmesi docs/ONAY_AKISI_CEKIRDEK.md'deki saf durum makinesinin
-- sunucu yansımasıdır: aynı durumlar, aynı geçişler, aynı op-key/fingerprint girdileri.
-- Bu dilimde hakediş/tahsilat/OCR/AI ve fotoğraf yükleme YOK (attachments sabit []).

create extension if not exists pgcrypto;  -- digest (fingerprint) için

-- Şirket (tenant)
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  -- şirket politikası: kontrolü yapan ile onaylayan aynı kişi olabilir mi?
  allow_same_actor_check_approve boolean not null default false,
  created_at timestamptz not null default now()
);

-- Üyelik: kullanıcının şirketteki rolü YALNIZ buradan okunur (istemci beyanı değil)
create table if not exists public.memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('sofor','ofis','yonetici')),
  display_name text not null default '',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, role)
);

-- Bildirim (şoför iş kaydı bildirimi)
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  op_key text not null,                 -- şirket kapsamlı kalıcı işlem kimliği (istemcinin ürettiği entry_id)
  driver_id uuid not null references auth.users(id),
  state text not null check (state in
    ('gonderildi','kontrolde','duzeltme_istendi','onay_bekliyor','onaylandi','reddedildi')),
  version int not null default 1,       -- iyimser eşzamanlılık: her geçiş +1
  rev_no int not null default 0,        -- içerik revizyonu
  fields jsonb not null,                -- güncel iş alanları (ofisin gördüğü/düzelttiği)
  entry jsonb,                          -- kaynağın ilettiği ham kayıt nesnesi
  fingerprint text not null,            -- sha256({attachments,entry,fields}) — bütünlük karşılaştırması; yetki/değişmezlik garantisi DEĞİL
  source jsonb not null,                -- ilk gönderim zarfı (istemci payload'ı + alınma zamanı)
  checked_by uuid, checked_rev_no int, checked_at timestamptz,
  check_revoked boolean not null default false,
  approved_by uuid, approved_rev_no int, approved_at timestamptz,
  work_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, op_key)
);

-- Revizyonlar: ofis düzeltmeleri eski→yeni + gerekçe ile
create table if not exists public.revisions (
  report_id uuid not null references public.reports(id) on delete cascade,
  rev_no int not null,
  fields jsonb not null,                -- tam snapshot
  changes jsonb not null,               -- {alan: {from, to}}
  reason text,
  edited_by uuid not null references auth.users(id),
  edited_at timestamptz not null default now(),
  primary key (report_id, rev_no)
);

-- Onaylı iş (tek): tenant+op_key unique → çift iş üretilemez
create table if not exists public.works (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  op_key text not null,
  report_id uuid not null unique references public.reports(id),
  fields jsonb not null,                -- onay anındaki revizyon snapshot'ı
  source_rev_no int not null,
  status text not null default 'kesin',
  created_at timestamptz not null default now(),
  unique (tenant_id, op_key)
);

-- Onay kaydı (tek): hangi revizyon, kim, ne zaman
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  op_key text not null,
  report_id uuid not null unique references public.reports(id),
  rev_no int not null,
  snapshot jsonb not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, op_key)
);

-- Audit zinciri
create table if not exists public.audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id),
  report_id uuid references public.reports(id) on delete set null,
  actor_id uuid,
  role text,
  action text not null,
  from_state text,
  to_state text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists reports_tenant_state_idx on public.reports (tenant_id, state);
create index if not exists reports_driver_idx on public.reports (driver_id);
create index if not exists revisions_report_idx on public.revisions (report_id);
create index if not exists audit_report_idx on public.audit (report_id);

-- Fingerprint: lab sözleşmesiyle aynı GİRDİLER {attachments, entry, fields}.
-- Kanonikleştirme burada jsonb'nin anahtar-sıralı metniyle yapılır (JS tarafındaki
-- canonicalStringify ile bayt-eşitliği iddia edilmez; fingerprint yalnız sunucuda
-- sunucunun ürettiği değerlerle karşılaştırılır).
create or replace function public.flow_fingerprint(p_fields jsonb, p_entry jsonb, p_attachments jsonb default '[]'::jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select encode(digest(
    jsonb_build_object(
      'attachments', coalesce(p_attachments, '[]'::jsonb),
      'entry',       p_entry,
      'fields',      p_fields
    )::text,
    'sha256'), 'hex');
$$;

-- Alan farkı: {alan: {from, to}} — eksik anahtar ile null değer bu dilimde aynı sayılır
create or replace function public.jsonb_diff(a jsonb, b jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(k.key, jsonb_build_object('from', a -> k.key, 'to', b -> k.key)), '{}'::jsonb)
  from (
    select distinct key
    from (
      select jsonb_object_keys(a) as key
      union
      select jsonb_object_keys(b) as key
    ) t
  ) k
  where (a -> k.key) is distinct from (b -> k.key);
$$;
