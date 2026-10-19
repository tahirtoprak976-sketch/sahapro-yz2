-- 0030_rpc.sql — Sunucu tarafı geçişler (tümü tek transaction'da, SECURITY DEFINER)
--
-- js/flow-core.js'deki saf durum makinesinin SQL yansıması:
--   submit_work      : (yok)→gonderildi · duzeltme_istendi→gonderildi (sürücü düzeltmesi)
--   start_check      : gonderildi→kontrolde
--   request_fix      : kontrolde→duzeltme_istendi (gerekçe zorunlu)
--   edit_report      : kontrolde→kontrolde / onay_bekliyor→kontrolde (T12: kontrol otomatik geçersiz)
--   complete_check   : kontrolde→onay_bekliyor
--   approve_report   : onay_bekliyor→onaylandi (iş+onay+durum+audit TEK TX)
--   reject_report    : kontrolde/onay_bekliyor→reddedildi (gerekçe zorunlu)
--
-- Hata sözleşmesi: SQLSTATE 42501 (=HTTP 403) yetki hataları; P0001 (=HTTP 400) iş
-- kuralı hataları. Mesaj her zaman "KOD: açıklama" biçimindedir.
--
-- Güvenlik modeli: fonksiyonlar SECURITY DEFINER (sahibi postgres; RLS'i aşar) —
-- bu yüzden her fonksiyon yetkiyi auth.uid() + memberships üzerinden AÇIKÇA denetler.
-- İstemcinin gönderdiği user_id/role/tenant_id/approved_by alanları hiçbir yerde
-- okunmaz; tenant ve aktör yalnız JWT + memberships'tan türetilir.

-- ---- iç yardımcılar (API'ye açılmaz; EXECUTE grant'i verilmez) ----

create or replace function public._req_uid() returns uuid
language plpgsql stable set search_path = public, pg_temp
as $$
declare v uuid;
begin
  v := auth.uid();
  if v is null then
    raise exception 'AUTH_REQUIRED: oturum gerekli' using errcode = '42501';
  end if;
  return v;
end;
$$;

create or replace function public._actor_role(p_tenant uuid, p_allowed text[]) returns text
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_role text;
begin
  select m.role into v_role
  from public.memberships m
  where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.role = any(p_allowed)
  limit 1;
  if v_role is null then
    raise exception 'FORBIDDEN_ROLE: bu şirkette bu işlem için yetkili rolünüz yok' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- Kaydı kimlikten yükle + işlem boyunca kilitle. Kayıt yoksa ya da çağıranın o
-- şirkette üyeliği yoksa TEK tip 403 (varlık sızıntısı yok).
create or replace function public._report_locked(p_id uuid)
returns public.reports
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  r public.reports%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 7));
  select * into r from public.reports rep where rep.id = p_id;
  if not found then
    raise exception 'FORBIDDEN: kayıt yok veya erişim yok' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships m
                 where m.tenant_id = r.tenant_id and m.user_id = auth.uid()) then
    raise exception 'FORBIDDEN: kayıt yok veya erişim yok' using errcode = '42501';
  end if;
  return r;
end;
$$;

create or replace function public._audit(p_tenant uuid, p_report uuid, p_actor uuid, p_role text,
                                         p_action text, p_from text, p_to text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.audit (tenant_id, report_id, actor_id, role, action, from_state, to_state, reason)
  values (p_tenant, p_report, p_actor, p_role, p_action, p_from, p_to, p_reason);
end;
$$;

-- ---- oturum bilgisi ----

create or replace function public.my_session() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_uid uuid;
begin
  v_uid := public._req_uid();
  return jsonb_build_object(
    'user_id', v_uid,
    'email', (select u.email from auth.users u where u.id = v_uid),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tenant_id', t.id, 'tenant_slug', t.slug, 'tenant_name', t.name,
               'role', m.role, 'display_name', m.display_name,
               'allow_same_actor_check_approve', t.allow_same_actor_check_approve))
      from public.memberships m join public.tenants t on t.id = m.tenant_id
      where m.user_id = v_uid), '[]'::jsonb)
  );
end;
$$;

-- ---- şoför: bildirim gönder (idempotent) ----

create or replace function public.submit_work(p_op_key text, p_fields jsonb,
                                              p_entry jsonb default null, p_source jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_tenant uuid;
  v_tenants int;
  v_fp text;
  v_entry jsonb;
  v_changes jsonb;
  v_new_rev int;
  r public.reports%rowtype;
begin
  v_uid := public._req_uid();

  -- tenant istemciden ALINMAZ: şoför üyeliğinden türetilir
  select count(distinct m.tenant_id) into v_tenants
  from public.memberships m
  where m.user_id = v_uid and m.role = 'sofor';

  if coalesce(v_tenants, 0) = 0 then
    raise exception 'FORBIDDEN_ROLE: bu işlem şoför üyeliği ister' using errcode = '42501';
  elsif v_tenants > 1 then
    raise exception 'AMBIGUOUS_TENANT: birden çok şirkette şoför üyeliği var (bu dilimde desteklenmez)';
  end if;

  select m.tenant_id into v_tenant
  from public.memberships m
  where m.user_id = v_uid and m.role = 'sofor'
  limit 1;

  if p_op_key is null or length(p_op_key) < 8 or length(p_op_key) > 80 then
    raise exception 'PACKET_INVALID: op_key 8-80 karakter olmalı';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'PACKET_INVALID: fields nesne olmalı';
  end if;

  v_entry := coalesce(p_entry, p_fields);
  v_fp := public.flow_fingerprint(p_fields, v_entry, '[]'::jsonb);

  -- aynı (tenant, op_key) için eşzamanlı ilk gönderimler sıraya girer
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '/' || p_op_key, 42));

  select * into r from public.reports rep where rep.tenant_id = v_tenant and rep.op_key = p_op_key;

  if not found then
    insert into public.reports (tenant_id, op_key, driver_id, state, fields, entry, fingerprint, source)
    values (v_tenant, p_op_key, v_uid, 'gonderildi', p_fields, v_entry, v_fp,
            coalesce(p_source, '{}'::jsonb) || jsonb_build_object('received_at', now()))
    returning * into r;
    insert into public.revisions (report_id, rev_no, fields, changes, reason, edited_by)
    values (r.id, 0, p_fields, '{}'::jsonb, null, v_uid);
    perform public._audit(v_tenant, r.id, v_uid, 'sofor', 'gonderildi', null, 'gonderildi');
    return jsonb_build_object('result','created','report_id',r.id,'state',r.state,'version',r.version,'rev_no',r.rev_no);
  end if;

  if r.driver_id <> v_uid then
    raise exception 'FORBIDDEN_OWNER: bu işlem kimliği başka sürücüye ait' using errcode = '42501';
  end if;

  -- aynı içerikle tekrar: sunucu yanıtı kaybolsa bile yeni bildirim AÇILMAZ
  if r.fingerprint = v_fp then
    return jsonb_build_object('result','existing','report_id',r.id,'state',r.state,'version',r.version,'rev_no',r.rev_no);
  end if;

  -- içerik değişmiş: yalnız düzeltme istenmişse sürücü yeni revizyonla dönebilir
  if r.state = 'duzeltme_istendi' then
    v_changes := public.jsonb_diff(r.fields, p_fields);
    v_new_rev := r.rev_no + 1;
    insert into public.revisions (report_id, rev_no, fields, changes, reason, edited_by)
    values (r.id, v_new_rev, p_fields, v_changes, 'sürücü düzeltmesi', v_uid);
    update public.reports rep
       set rev_no = v_new_rev, fields = p_fields, entry = v_entry, fingerprint = v_fp,
           state = 'gonderildi', version = rep.version + 1, updated_at = now(),
           check_revoked = false, checked_by = null, checked_rev_no = null, checked_at = null
     where rep.id = r.id
    returning * into r;
    perform public._audit(v_tenant, r.id, v_uid, 'sofor', 'yeniden_gonderim_duzeltme', 'duzeltme_istendi', 'gonderildi', 'sürücü düzeltmesi');
    return jsonb_build_object('result','resubmitted','report_id',r.id,'state',r.state,'version',r.version,'rev_no',r.rev_no);
  end if;

  raise exception 'OP_CONFLICT: aynı işlem kimliği farklı içerikle gönderildi';
end;
$$;

-- ---- ofis: kontrole başla ----

create or replace function public.start_check(p_report_id uuid, p_expected_version int)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid; v_role text; r public.reports%rowtype;
begin
  v_uid := public._req_uid();
  r := public._report_locked(p_report_id);
  v_role := public._actor_role(r.tenant_id, array['ofis']);
  if r.state <> 'gonderildi' then
    raise exception 'BAD_STATE: kontrole başlama için durum gonderildi olmalı (şu an: %)', r.state;
  end if;
  if r.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: beklenen sürüm %, güncel %', p_expected_version, r.version;
  end if;
  update public.reports rep set state = 'kontrolde', version = rep.version + 1, updated_at = now()
   where rep.id = r.id returning * into r;
  perform public._audit(r.tenant_id, r.id, v_uid, v_role, 'kontrol_baslangic', 'gonderildi', 'kontrolde');
  return jsonb_build_object('result','ok','state',r.state,'version',r.version,'rev_no',r.rev_no);
end;
$$;

-- ---- ofis: düzeltme iste ----

create or replace function public.request_fix(p_report_id uuid, p_reason text, p_expected_version int)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid; v_role text; r public.reports%rowtype;
begin
  v_uid := public._req_uid();
  r := public._report_locked(p_report_id);
  v_role := public._actor_role(r.tenant_id, array['ofis']);
  if r.state <> 'kontrolde' then
    raise exception 'BAD_STATE: düzeltme isteme için durum kontrolde olmalı (şu an: %)', r.state;
  end if;
  if r.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: beklenen sürüm %, güncel %', p_expected_version, r.version;
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'MISSING_REASON: düzeltme gerekçesi zorunlu';
  end if;
  update public.reports rep set state = 'duzeltme_istendi', version = rep.version + 1, updated_at = now()
   where rep.id = r.id returning * into r;
  perform public._audit(r.tenant_id, r.id, v_uid, v_role, 'duzeltme_istendi', 'kontrolde', 'duzeltme_istendi', p_reason);
  return jsonb_build_object('result','ok','state',r.state,'version',r.version,'rev_no',r.rev_no);
end;
$$;

-- ---- ofis: alan düzeltmesi (revizyon + eski kontrol geçersiz) ----

create or replace function public.edit_report(p_report_id uuid, p_fields jsonb, p_reason text, p_expected_version int)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid; v_role text;
  r public.reports%rowtype;
  v_changes jsonb;
  v_new_rev int;
  v_to text;
begin
  v_uid := public._req_uid();
  r := public._report_locked(p_report_id);
  v_role := public._actor_role(r.tenant_id, array['ofis']);
  if r.state not in ('kontrolde','onay_bekliyor') then
    raise exception 'BAD_STATE: düzeltme için durum kontrolde/onay_bekliyor olmalı (şu an: %)', r.state;
  end if;
  if r.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: beklenen sürüm %, güncel %', p_expected_version, r.version;
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'MISSING_REASON: düzeltme gerekçesi zorunlu';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'PACKET_INVALID: fields nesne olmalı';
  end if;

  v_changes := public.jsonb_diff(r.fields, p_fields);
  if v_changes = '{}'::jsonb then
    return jsonb_build_object('result','nochange','state',r.state,'version',r.version,'rev_no',r.rev_no);
  end if;

  v_new_rev := r.rev_no + 1;
  insert into public.revisions (report_id, rev_no, fields, changes, reason, edited_by)
  values (r.id, v_new_rev, p_fields, v_changes, p_reason, v_uid);

  -- T12: onay beklerken içerik değişirse kontrol geçersizleşir ve kayıt kontrole düşer
  v_to := r.state;
  if r.state = 'onay_bekliyor' then
    v_to := 'kontrolde';
    perform public._audit(r.tenant_id, r.id, v_uid, v_role, 'kontrol_gecersiz', 'onay_bekliyor', 'kontrolde',
                          'içerik değişti: kontrol yeniden gerekli');
  end if;

  update public.reports rep
     set fields = p_fields, rev_no = v_new_rev, check_revoked = true,
         state = v_to, version = rep.version + 1, updated_at = now()
   where rep.id = r.id
  returning * into r;
  perform public._audit(r.tenant_id, r.id, v_uid, v_role, 'duzeltme', null, null, p_reason);
  return jsonb_build_object('result','ok','state',r.state,'version',r.version,'rev_no',r.rev_no,'changes',v_changes);
end;
$$;

-- ---- ofis: kontrolü tamamla ----

create or replace function public.complete_check(p_report_id uuid, p_expected_version int)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid; v_role text; r public.reports%rowtype;
begin
  v_uid := public._req_uid();
  r := public._report_locked(p_report_id);
  v_role := public._actor_role(r.tenant_id, array['ofis']);
  if r.state <> 'kontrolde' then
    raise exception 'BAD_STATE: kontrol tamamlama için durum kontrolde olmalı (şu an: %)', r.state;
  end if;
  if r.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: beklenen sürüm %, güncel %', p_expected_version, r.version;
  end if;
  update public.reports rep
     set state = 'onay_bekliyor', checked_by = v_uid, checked_rev_no = rep.rev_no,
         checked_at = now(), check_revoked = false, version = rep.version + 1, updated_at = now()
   where rep.id = r.id returning * into r;
  perform public._audit(r.tenant_id, r.id, v_uid, v_role, 'kontrol_tamam', 'kontrolde', 'onay_bekliyor');
  return jsonb_build_object('result','ok','state',r.state,'version',r.version,'rev_no',r.rev_no);
end;
$$;

-- ---- yönetici: onay (iş + onay + durum + audit TEK TRANSACTION) ----

create or replace function public.approve_report(p_report_id uuid, p_expected_version int, p_rev_no int)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid; v_role text;
  r public.reports%rowtype;
  v_allow_same boolean;
  v_work_id uuid;
  v_approval_id uuid;
begin
  v_uid := public._req_uid();
  r := public._report_locked(p_report_id);   -- danışma kilidi: eşzamanlı onaylar sıraya girer
  v_role := public._actor_role(r.tenant_id, array['yonetici']);

  -- idempotent: zaten onaylanmışsa mevcut işi döndür (yarışı kaybeden / yanıtı kaybolan tekrar)
  if r.state = 'onaylandi' then
    return jsonb_build_object('result','existing','work_id',r.work_id,'state',r.state,'version',r.version,'rev_no',r.rev_no);
  end if;
  if r.state <> 'onay_bekliyor' then
    raise exception 'BAD_STATE: onay için durum onay_bekliyor olmalı (şu an: %)', r.state;
  end if;
  if r.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: beklenen sürüm %, güncel %', p_expected_version, r.version;
  end if;

  -- kontrol güncel revizyona ait ve geçerli olmalı
  if p_rev_no is distinct from r.checked_rev_no then
    raise exception 'REV_MISMATCH: onaylanan revizyon %, kontrol edilen %', p_rev_no, r.checked_rev_no;
  end if;
  if r.check_revoked or r.checked_rev_no is null or r.checked_rev_no <> r.rev_no then
    raise exception 'CHECK_STALE: kontrol güncel revizyona ait değil; yeniden kontrol gerekli';
  end if;

  -- şirket politikası: kontrolü yapan onaylayabilir mi?
  select t.allow_same_actor_check_approve into v_allow_same from public.tenants t where t.id = r.tenant_id;
  if not v_allow_same and r.checked_by = v_uid then
    raise exception 'SAME_ACTOR: şirket politikası kontrolü yapanın onaylamasına izin vermiyor';
  end if;

  insert into public.works (tenant_id, op_key, report_id, fields, source_rev_no)
  values (r.tenant_id, r.op_key, r.id, r.fields, r.rev_no)
  on conflict (tenant_id, op_key) do nothing
  returning id into v_work_id;
  if v_work_id is null then  -- savunma amaçlı: kilit dışı senaryoda mevcut iş
    select w.id into v_work_id from public.works w where w.tenant_id = r.tenant_id and w.op_key = r.op_key;
  end if;

  insert into public.approvals (tenant_id, op_key, report_id, rev_no, snapshot, actor_id)
  values (r.tenant_id, r.op_key, r.id, r.rev_no, r.fields, v_uid)
  returning id into v_approval_id;

  update public.reports rep
     set state = 'onaylandi', version = rep.version + 1,
         approved_by = v_uid, approved_rev_no = rep.rev_no, approved_at = now(),
         work_id = v_work_id, updated_at = now()
   where rep.id = r.id returning * into r;

  perform public._audit(r.tenant_id, r.id, v_uid, v_role, 'onaylandi', 'onay_bekliyor', 'onaylandi');
  return jsonb_build_object('result','approved','work_id',v_work_id,'approval_id',v_approval_id,
                            'state',r.state,'version',r.version,'rev_no',r.rev_no);
end;
$$;

-- ---- reddet (ofis: kontrolde / yönetici: onay_bekliyor) ----

create or replace function public.reject_report(p_report_id uuid, p_reason text, p_expected_version int)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid; v_role text; r public.reports%rowtype; v_from text;
begin
  v_uid := public._req_uid();
  r := public._report_locked(p_report_id);
  if r.state = 'kontrolde' then
    v_role := public._actor_role(r.tenant_id, array['ofis']);
  elsif r.state = 'onay_bekliyor' then
    v_role := public._actor_role(r.tenant_id, array['yonetici']);
  else
    raise exception 'BAD_STATE: red için durum kontrolde/onay_bekliyor olmalı (şu an: %)', r.state;
  end if;
  if r.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: beklenen sürüm %, güncel %', p_expected_version, r.version;
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'MISSING_REASON: red gerekçesi zorunlu';
  end if;
  v_from := r.state;
  update public.reports rep set state = 'reddedildi', version = rep.version + 1, updated_at = now()
   where rep.id = r.id returning * into r;
  perform public._audit(r.tenant_id, r.id, v_uid, v_role, 'reddedildi', v_from, 'reddedildi', p_reason);
  return jsonb_build_object('result','ok','state',r.state,'version',r.version,'rev_no',r.rev_no);
end;
$$;

-- EXECUTE yüzeyi: yalnız API fonksiyonları, yalnız authenticated
grant execute on function public.my_session() to authenticated;
grant execute on function public.submit_work(text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.start_check(uuid, int) to authenticated;
grant execute on function public.request_fix(uuid, text, int) to authenticated;
grant execute on function public.edit_report(uuid, jsonb, text, int) to authenticated;
grant execute on function public.complete_check(uuid, int) to authenticated;
grant execute on function public.approve_report(uuid, int, int) to authenticated;
grant execute on function public.reject_report(uuid, text, int) to authenticated;
