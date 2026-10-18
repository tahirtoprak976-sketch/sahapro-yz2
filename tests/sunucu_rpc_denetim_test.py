#!/usr/bin/env python3
"""SAHAPRO YZ2 — SECURITY DEFINER RPC ve yetki-yüzeyi denetimi.

Görev maddesi 2: "RLS varlığı tek başına yeterli değildir; SECURITY DEFINER
içindeki yetki kontrolünü ayrıca test et."

Kanıtlar:
  D1  EXECUTE grant matrisi (pg_proc ACL'lerinden okunur — grep değil, katalog)
  D2  fonksiyon sahipleri HTTP'e açık roller DEĞİL; authenticator NOINHERIT
  D3  tabloya dokunan her fonksiyonda güvenli search_path (public, pg_temp)
  D4  dinamik SQL yokluğu (statik tarama — sınırı raporda açıkça yazılır)
  D5  sahte/bozuk JWT'ler reddedilir: yanlış imza, süresi dolmuş, yanlış aud,
      alg=none, var olmayan role claim'i
  D6  istemcinin gönderdiği actor/tenant/role alanları yetki KAYNAĞI DEĞİL:
      fazladan otorite parametreleri PostgREST tarafından reddedilir
  D7  üyelik kaldırılınca eski (hâlâ imzası geçerli) JWT iş yapamaz → 403
  D8  ban/devre dışı davranışı: login + refresh reddedilir; eldeki access
      token'ın exp'ye kadar çalışması GoTrue/JWT mimarisinin BİLİNEN sınırıdır
      (gizlenmez, dürüstçe belgelenir)
  D9  binary bütünlük pini bozuk dosyayı yakalar (verify_binary sabotaj testi)

Çıkış: TAP benzeri satırlar + PASS/FAIL özeti.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
import uuid

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import server_local_stack as S  # noqa: E402

RESULTS: list[tuple[bool, str]] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    RESULTS.append((bool(cond), name + (f" — {detail}" if detail and not cond else "")))
    print(f"{'ok' if cond else 'FAIL'} {len(RESULTS)} - {name}" + (f" :: {detail}" if detail else ""))


def sql(q: str, db: str = S.DB) -> str:
    return S.psql(q, db=db, extra=["-tA"]).stdout.strip()


def login(email: str) -> dict:
    st, b = S.http("POST", f"{S.GOTRUE_URL}/token?grant_type=password",
                   {"email": email, "password": S.TEST_PASSWORD})
    assert st == 200, f"login {email}: {st} {b}"
    return b


def rpc(tok: str, name: str, args: dict):
    return S.http("POST", f"{S.PGRST_URL}/rpc/{name}", args, {"Authorization": f"Bearer {tok}"})


def get(tok: str, path: str):
    return S.http("GET", f"{S.PGRST_URL}{path}", None, {"Authorization": f"Bearer {tok}"})


# ---------- JWT üretimi (yalnız denetim için; sır /tmp'den okunur, depoya girmez) ----------

def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def forge_jwt(secret: str, claims: dict, *, alg: str = "HS256", sign: bool = True) -> str:
    head = b64u(json.dumps({"alg": alg, "typ": "JWT"}).encode())
    body = b64u(json.dumps(claims).encode())
    if not sign or alg == "none":
        return f"{head}.{body}."
    sig = b64u(hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"{head}.{body}.{sig}"


def valid_claims(sub: str, **over) -> dict:
    c = {"sub": sub, "role": "authenticated", "aud": "authenticated",
         "iss": "supabase", "iat": int(time.time()), "exp": int(time.time()) + 600}
    c.update(over)
    return c


RPCS = ["my_session()", "submit_work(text,jsonb,jsonb,jsonb)", "start_check(uuid,integer)",
        "request_fix(uuid,text,integer)", "edit_report(uuid,jsonb,text,integer)",
        "complete_check(uuid,integer)", "approve_report(uuid,integer,integer)",
        "reject_report(uuid,text,integer)"]
POLICY_HELPERS = ["rls_is_member(uuid)", "rls_has_role(uuid,text[])"]
AUTH_HELPERS = ["jwt_claims()", "uid()", "role()"]
INTERNALS = ["flow_fingerprint(jsonb,jsonb,jsonb)", "jsonb_diff(jsonb,jsonb)",
             "_req_uid()", "_actor_role(uuid,text[])", "_report_locked(uuid)",
             "_audit(uuid,uuid,uuid,text,text,text,text,text)"]


def norm_args(args: str) -> str:
    """'p_tenant uuid, p_allowed text[]' → 'uuid,text[]' (türler tek sözcük)."""
    if not args.strip():
        return ""
    return ",".join(p.strip().split()[-1] for p in args.split(","))


def main() -> int:
    subprocess.run([sys.executable, __file__.rsplit("/", 1)[0] + "/server_local_stack.py", "up"],
                   check=True, capture_output=True)

    # ---------- D1: EXECUTE grant matrisi (katalogdan) ----------
    # DİKKAT: proacl NULL = "varsayılan yetkiler" demektir ve fonksiyonlar için
    # varsayılan, PUBLIC'e EXECUTE içerir. Bu yüzden NULL, PUBLIC açığı sayılır.
    rows = sql("""
      select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
             coalesce(p.proacl::text, '__NULL__'),
             has_function_privilege('anon', p.oid, 'EXECUTE'),
             has_function_privilege('authenticated', p.oid, 'EXECUTE')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','auth')
        and p.proname in ('my_session','submit_work','start_check','request_fix',
                          'edit_report','complete_check','approve_report','reject_report',
                          'rls_is_member','rls_has_role','jwt_claims','uid','role',
                          'flow_fingerprint','jsonb_diff','_req_uid','_actor_role',
                          '_report_locked','_audit')
      order by 1, 2
    """)
    mat = {}
    for line in rows.splitlines():
        sch, name, args, acl, anon_ok, authd_ok = line.split("|")
        # PUBLIC hakkı: proacl NULL (varsayılan) veya grantee'siz "=X/" girdisi
        pub = acl == "__NULL__" or bool(re.search(r"(^|[{,])=X/", acl))
        mat[(sch, f"{name}({norm_args(args)})")] = (pub, anon_ok == "t", authd_ok == "t", acl)

    def has(sch: str, sig: str):
        return mat.get((sch, sig))

    pub_list = [("public", x) for x in RPCS + POLICY_HELPERS + INTERNALS] + \
               [("auth", x) for x in AUTH_HELPERS]
    missing = [f"{s}.{g}" for s, g in pub_list if has(s, g) is None]
    check("D1a denetim listesindeki tüm fonksiyonlar katalogda bulundu", not missing, str(missing))

    bad_pub = [f"{s}.{g}" for s, g in pub_list if has(s, g) and has(s, g)[0]]
    check("D1b hiçbir fonksiyonda PUBLIC EXECUTE yok (NULL proacl dahil)", not bad_pub, str(bad_pub))

    bad_anon = [f"{s}.{g}" for s, g in pub_list if has(s, g) and has(s, g)[1]]
    check("D1c anon rolünde EXECUTE yok (RPC + yardımcılar)", not bad_anon, str(bad_anon))

    no_authd = [g for g in RPCS + POLICY_HELPERS if has("public", g) and not has("public", g)[2]] + \
               [g for g in AUTH_HELPERS if has("auth", g) and not has("auth", g)[2]]
    check("D1d authenticated gerekli fonksiyonlarda EXECUTE'a sahip", not no_authd, str(no_authd))

    leaked = [g for g in INTERNALS if has("public", g) and has("public", g)[2]]
    check("D1e iç yardımcılar authenticated'a kapalı (yalnız owner)", not leaked, str(leaked))

    # ---------- D2: fonksiyon sahipleri + rol hiyerarşisi ----------
    owners = [o for o in sql("""
      select distinct pg_get_userbyid(p.proowner)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    """).splitlines() if o]
    http_roles = {"anon", "authenticated", "authenticator", "gotrue"}
    check("D2a public fonksiyon sahipleri HTTP'e açık rol değil",
          not (set(owners) & http_roles), str(owners))
    noinherit = sql("select rolinherit from pg_roles where rolname='authenticator'")
    check("D2b authenticator NOINHERIT (üyelikten yetki miras almaz)", noinherit == "f", noinherit)

    # ---------- D3: search_path ----------
    # Yalnız BİZİM migration'larda tanımlı fonksiyonlar denetlenir; GoTrue'nun
    # kurduğu pgcrypto eklenti fonksiyonları (digest, crypt, …) kapsam dışıdır —
    # tabloya dokunmazlar ve sahiplikleri eklentidedir.
    sp_rows = sql("""
      select p.proname, coalesce(array_to_string(p.proconfig, ';'), '')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('my_session','submit_work','start_check','request_fix',
                          'edit_report','complete_check','approve_report','reject_report',
                          'rls_is_member','rls_has_role','flow_fingerprint','jsonb_diff',
                          '_req_uid','_actor_role','_report_locked','_audit')
    """).splitlines()
    bad_sp = []
    for line in sp_rows:
        name, cfg = line.split("|")
        m = re.search(r"search_path=([^;]+)", cfg)
        if not m or m.group(1).replace('"', "") != "public, pg_temp":
            bad_sp.append(f"{name}:{cfg or '(bos)'}")
    check("D3 public fonksiyonların tamamında search_path='public, pg_temp'", not bad_sp, str(bad_sp))
    # auth yardımcıları tablo çözümlemez (yalnız current_setting okur) — search_path
    # muafiyeti bilinçlidir; 0002 dosya başlığında yazılıdır.

    # ---------- D4: dinamik SQL statik taraması ----------
    dyn_hits = []
    for f in ["0002_auth_helpers.sql", "0010_schema.sql", "0020_rls.sql", "0030_rpc.sql",
              "0040_denetim_sertlestirme.sql"]:
        src = open(os.path.join(S.MIG, f)).read()
        for i, line in enumerate(src.splitlines(), 1):
            if re.search(r"\bexecute\s+(format\s*\(|'|\")", line, re.I):
                dyn_hits.append(f"{f}:{i}:{line.strip()[:60]}")
    check("D4 dinamik SQL (EXECUTE format/'…') yok", not dyn_hits, str(dyn_hits))

    # ---------- D5: sahte/bozuk JWT reddi ----------
    secret = open("/tmp/yz2srv/jwt_secret").read().strip()
    uid_sofor = sql("select id from auth.users where email='test-sofor-1@example.invalid'")
    # kontrol: doğru imzalı token ÇALIŞMALI (imzalama yöntemimiz doğru mu — negatifler ancak o zaman anlamlı)
    good = forge_jwt(secret, valid_claims(uid_sofor))
    st, b = get(good, "/reports?select=id&limit=1")
    check("D5a kontrol: test-imzalı geçerli JWT kabul edilir", st == 200, f"{st} {b}")

    wrong = forge_jwt("baska-bir-sifr-1234567890abcdef1234567890", valid_claims(uid_sofor))
    st, _ = get(wrong, "/reports?select=id&limit=1")
    check("D5b yanlış imza anahtarı → 401", st == 401, f"{st}")

    expired = forge_jwt(secret, valid_claims(uid_sofor, exp=int(time.time()) - 60))
    st, _ = get(expired, "/reports?select=id&limit=1")
    check("D5c süresi dolmuş JWT → 401", st == 401, f"{st}")

    bad_aud = forge_jwt(secret, valid_claims(uid_sofor, aud="baska-servis"))
    st, _ = get(bad_aud, "/reports?select=id&limit=1")
    check("D5d yanlış aud → 401 (jwt-aud sınırı)", st == 401, f"{st}")

    none_alg = forge_jwt(secret, valid_claims(uid_sofor), alg="none", sign=False)
    st, _ = get(none_alg, "/reports?select=id&limit=1")
    check("D5e alg=none → 401", st == 401, f"{st}")

    ghost = forge_jwt(secret, valid_claims(uid_sofor, role="service_role"))
    st, b = get(ghost, "/reports?select=id&limit=1")
    check("D5f var olmayan role claim'i (service_role) → 4xx, veri yok",
          st in (400, 401, 403), f"{st} {b}")

    # ---------- D6: istemci-gönderdi otorite alanları kabul EDİLMEZ ----------
    tok_sofor = login("test-sofor-1@example.invalid")["access_token"]
    base_args = {"p_op_key": str(uuid.uuid4()),
                 "p_fields": {"date": "2026-10-18", "vehicle": "TEST-34 ABC 01",
                              "customer": "TEST-Müşteri Ümraniye", "work_type": "Mıcır",
                              "quantity": 3, "unit": "Sefer", "note": "TEST D6"}}
    st, b = rpc(tok_sofor, "submit_work", {**base_args, "p_user_id": str(uuid.uuid4())})
    check("D6a fazladan p_user_id → imza uyuşmazlığıyla red", st >= 400, f"{st} {b}")
    st, b = rpc(tok_sofor, "submit_work", {**base_args, "p_tenant_id": str(uuid.uuid4())})
    check("D6b fazladan p_tenant_id → red", st >= 400, f"{st} {b}")
    st, b = rpc(tok_sofor, "submit_work", {**base_args, "p_role": "yonetici"})
    check("D6c fazladan p_role → red", st >= 400, f"{st} {b}")
    st, b = rpc(tok_sofor, "approve_report", {"p_report_id": str(uuid.uuid4()),
                                              "p_expected_version": 1, "p_rev_no": 0,
                                              "p_approved_by": str(uuid.uuid4())})
    check("D6d approve'a p_approved_by sokuşturma → red", st >= 400, f"{st} {b}")

    # ---------- D7: üyelik kaldırılınca eski JWT yetkisiz ----------
    tok_rakip = login("test-rakip-sofor@example.invalid")["access_token"]
    op_a = str(uuid.uuid4())
    st, b = rpc(tok_rakip, "submit_work", {"p_op_key": op_a,
                                           "p_fields": {"date": "2026-10-18", "vehicle": "TEST-06 DEF 02",
                                                        "customer": "TEST-Müşteri Ataşehir",
                                                        "work_type": "Mıcır", "quantity": 2,
                                                        "unit": "Sefer", "note": "TEST D7-önce"}})
    check("D7a üyelik varken submit çalışır (taban)", st == 200, f"{st} {b}")
    uid_rakip = sql("select id from auth.users where email='test-rakip-sofor@example.invalid'")
    sql(f"delete from public.memberships where user_id='{uid_rakip}'")
    try:
        st, b = rpc(tok_rakip, "submit_work", {"p_op_key": str(uuid.uuid4()),
                                               "p_fields": {"date": "2026-10-18", "vehicle": "TEST-06 DEF 02",
                                                            "customer": "TEST-Müşteri Ataşehir",
                                                            "work_type": "Mıcır", "quantity": 2,
                                                            "unit": "Sefer", "note": "TEST D7-sonra"}})
        check("D7b üyelik kalkınca aynı JWT ile submit → 403", st == 403, f"{st} {b}")
        st, b = get(tok_rakip, "/reports?select=id&limit=1")
        check("D7c üyelik kalkınca aynı JWT ile SELECT boş döner", st == 200 and b == [], f"{st} {b}")
        st, b = rpc(tok_rakip, "my_session", {})
        check("D7d my_session üyeliksiz kullanıcıyı tenantsız gösterir",
              st == 200 and (b.get("memberships") in (None, [])), f"{st} {b}")
    finally:
        sql("insert into public.memberships (tenant_id, user_id, role, display_name) "
            f"select t.id, '{uid_rakip}', 'sofor', 'TEST-Rakip Şoför' from public.tenants t "
            "where t.slug='test-b' on conflict do nothing")

    # ---------- D8: ban/devre dışı davranışı (dürüst belgeleme) ----------
    ban_email = f"test-ban-{uuid.uuid4().hex[:8]}@example.invalid"
    st, b = S.http("POST", f"{S.GOTRUE_URL}/signup", {"email": ban_email, "password": S.TEST_PASSWORD})
    check("D8a ban testi kullanıcısı açıldı", st in (200, 201), f"{st} {b}")
    sess = login(ban_email)
    sql(f"update auth.users set banned_until = now() + interval '1 hour' where email='{ban_email}'")
    st, b = S.http("POST", f"{S.GOTRUE_URL}/token?grant_type=password",
                   {"email": ban_email, "password": S.TEST_PASSWORD})
    check("D8b banlı kullanıcı login olamaz", st >= 400, f"{st} {b}")
    st, b = S.http("POST", f"{S.GOTRUE_URL}/token?grant_type=refresh_token",
                   {"refresh_token": sess["refresh_token"]})
    refresh_reddedildi = st >= 400
    check("D8c banlı kullanıcının refresh'i reddedilir", refresh_reddedildi, f"{st} {b}")
    st, b = get(sess["access_token"], "/reports?select=id&limit=1")
    # Bilinen mimari sınır: ban, ELDEKİ access token'ı exp öncesi geçersiz KILMAZ
    # (JWT stateless'tır; PostgREST ban tablosuna bakmaz). Üyelik kontrolü (D7) olmadan
    # tek başına ban veri yazımını durdurmaz — bu yüzden devre dışı bırakmanın doğru
    # yolu üyelik silmedir. Bu davranış raporda gizlenmez.
    print(f"     not: ban sonrası eldeki access token durumu → HTTP {st} "
          f"({'hâlâ geçerli — bilinen JWT sınırı' if st == 200 else 'reddedildi'})")
    sql(f"delete from auth.users where email='{ban_email}'")

    # ---------- D9: binary pin doğrulaması sabotajı yakalar ----------
    src = os.path.join(S.BIN, "postgrest")
    if os.path.exists(src):
        kopya = "/tmp/yz2_pin_sabotaj.bin"
        data = bytearray(open(src, "rb").read())
        data[len(data) // 2] ^= 0xFF
        open(kopya, "wb").write(bytes(data))
        try:
            S.verify_binary(kopya, S.PGRST_SHA256, "postgrest", S.PGRST_VER)
            yakaladi = False
        except RuntimeError:
            yakaladi = True
        os.remove(kopya)
        check("D9 bozuk binary sha256 pinine takılır", yakaladi)
    else:
        check("D9 bozuk binary sha256 pinine takılır", False, "binary bulunamadı")

    # ---------- özet ----------
    ok = sum(1 for c, _ in RESULTS if c)
    print(f"\n{'PASS' if ok == len(RESULTS) else 'FAIL'} — {ok}/{len(RESULTS)} denetim kontrolü")
    return 0 if ok == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
