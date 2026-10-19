#!/usr/bin/env python3
"""SAHAPRO YZ2 — yerel sunucu dilimi yığın yöneticisi (geliştirme/test).

Gerçek bileşenler, hesapsız yerel kurulum:
  - PostgreSQL 15 (Debian paketi; küme: yz2srv, port 55432)
  - GoTrue / supabase-auth v2.197.0 (gerçek oturum/JWT üretimi, port 53002)
  - PostgREST v16.4 (JWT doğrulama + rol geçişi + RPC, port 53001)

Hiçbir dış servis hesabı AÇILMAZ; tüm süreçler bu makinede çalışır ve `down` ile durur.
Binary'ler ve çalışma dizini /tmp/yz2srv altındadır (yeniden üretilebilir: `up` hepsini kurar).
JWT sırrı çalışma anında üretilir ve yalnız /tmp/yz2srv altına yazılır — depoya girmez.

Kullanım:
  python3 tests/server_local_stack.py up       # küme + db + migration'lar + gotrue + postgrest + tohum
  python3 tests/server_local_stack.py seed     # yalnız TEST tohumunu yeniden uygular
  python3 tests/server_local_stack.py down     # postgrest/gotrue durur (küme açık kalır)
  python3 tests/server_local_stack.py wipe --evet   # TEST ortamını tamamen siler (VERİ SİLME — geri dönüş değil)
  python3 tests/server_local_stack.py backup <dosya>                # pg_dump (özel biçim) + satır sayımı özeti
  python3 tests/server_local_stack.py restore <dosya> <hedef_db>    # ayrı/boş bir DB'ye geri yükleme

wipe GİZLİLİK NOTU: wipe bir "geri dönüş" çözümü DEĞİLDİR; test ortamındaki tüm veriyi
siler. Yalnızca bu scriptin kurduğu açık TEST ortamında (TEST_ORTAMI işaret dosyası varsa)
ve açık `--evet` onayıyla çalışır. Gerçek veri kurtarma ancak backup/restore ile olur.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG = os.path.join(REPO, "supabase", "migrations")
RUN = "/tmp/yz2srv"
BIN = os.path.join(RUN, "bin")
PG_PORT = 55432
PGRST_PORT = 53001
GOTRUE_PORT = 53002
DB = "sahapro_srv"
PGRST_URL = f"http://127.0.0.1:{PGRST_PORT}"
GOTRUE_URL = f"http://127.0.0.1:{GOTRUE_PORT}"

PGRST_VER = "v16.4"
PGRST_ASSET = f"postgrest-{PGRST_VER}-linux-static-x86-64.tar.xz"
PGRST_DL = f"https://github.com/PostgREST/postgrest/releases/download/{PGRST_VER}/{PGRST_ASSET}"
GOTRUE_VER = "v2.197.0"
GOTRUE_ASSET = f"auth-{GOTRUE_VER}-x86.tar.gz"
GOTRUE_DL = f"https://github.com/supabase/auth/releases/download/{GOTRUE_VER}/{GOTRUE_ASSET}"

# Sürüm ve bütünlük sabitlemesi: binary'ler yalnız RESMİ kaynaklardan kurulur ve
# sha256'ları aşağıdaki değerlerle birebir eşleşmelidir.
# Anlamı: "çalışan bayt, test edilen resmi sürümün baytıdır" — bozuk veya değiştirilmiş
# indirme sessizce kurulamaz. Sürüm yükseltmek isteyen bilinçli olarak burayı günceller.
PGRST_SHA256 = "d6e3dd25b08b1ba0a953b9c834b465c3c20ba24c37a4cce076574f208a662ae6"
# GoTrue/auth için iki resmi dağıtım kanalı vardır; her ikisinin de baytları sabitlenebilir.
# None = o kanalın baytı henüz doğrulanmadı → o kanaldan kurulum reddedilir (fail-closed).
GOTRUE_SHA256 = {
    "ghcr.io/supabase/auth:v2.197.0 imajındaki /usr/local/bin/auth":
        "f2aa147268461f74784ddc8b2240aa446ee71ceb9633bac41c30e7b852a860aa",
    "github release asset auth-v2.197.0-x86.tar.gz içindeki auth": None,
}

# Bilinen örnek/placeholder sırlar gerçek kurulumda kabul edilmez (tripwire).
KNOWN_EXAMPLE_SECRETS = {
    "super-secret-jwt-token-with-at-least-32-characters-long",   # Supabase doküman örneği
    "your-super-secret-jwt-token-with-at-least-32-characters",
    "changeme", "secret", "postgres",
}
MIN_SECRET_LEN = 32

# TEST tohumu — yalnız yerel deneme kullanıcıları; üretim sırrı değildir.
TEST_PASSWORD = "TEST-parola-2026"
TENANT_A = {"slug": "test-a", "name": "TEST-Şirket A", "allow_same": False}
TENANT_B = {"slug": "test-b", "name": "TEST-Şirket B (rakip)", "allow_same": False}
USERS = [
    {"email": "test-sofor-1@example.invalid", "name": "TEST-Şoför Bir", "tenant": "test-a", "role": "sofor"},
    {"email": "test-ofis-1@example.invalid", "name": "TEST-Ofis Bir", "tenant": "test-a", "role": "ofis"},
    {"email": "test-yonetici-1@example.invalid", "name": "TEST-Yönetici Bir", "tenant": "test-a", "role": "yonetici"},
    {"email": "test-yonetici-2@example.invalid", "name": "TEST-Yönetici İki", "tenant": "test-a", "role": "yonetici"},
    {"email": "test-rakip-sofor@example.invalid", "name": "TEST-Rakip Şoför", "tenant": "test-b", "role": "sofor"},
]


def sh(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def psql(sql: str, db: str = DB, check: bool = True, extra: list[str] | None = None) -> subprocess.CompletedProcess:
    r = sh(["psql", "-h", "127.0.0.1", "-p", str(PG_PORT), "-U", "postgres", "-d", db,
            *(extra or []), "-v", "ON_ERROR_STOP=1", "-c", sql])
    if check and r.returncode != 0:
        raise RuntimeError(f"psql hatası: {r.stderr.strip()[:500]}")
    return r


def psql_file(path: str, db: str = DB) -> None:
    r = sh(["psql", "-h", "127.0.0.1", "-p", str(PG_PORT), "-U", "postgres", "-d", db,
            "-v", "ON_ERROR_STOP=1", "-f", path])
    if r.returncode != 0:
        raise RuntimeError(f"migration hatası ({os.path.basename(path)}): {r.stderr.strip()[:800]}")


def http(method: str, url: str, body=None, headers=None, timeout=30):
    req = urllib.request.Request(url, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "null")
        except json.JSONDecodeError:
            return e.code, {"raw": raw}


def wait_http(url: str, timeout_s: int = 60) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                if resp.status < 500:
                    return
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.5)
    raise RuntimeError(f"servis hazır olmadı: {url}")


def curl_resume(url: str, dest: str, rounds: int = 40) -> None:
    """Yavaş CDN'e karşı devam-etmeli indirme."""
    for _ in range(rounds):
        r = sh(["curl", "-sL", "-C", "-", "--max-time", "240", "-o", dest, url])
        t = sh(["bash", "-c", f"file {dest} | grep -qE 'gzip|XZ' && tar tf {dest} >/dev/null 2>&1"])
        if r.returncode == 0 and t.returncode == 0:
            return
        time.sleep(2)
    raise RuntimeError(f"indirilemedi: {url}")


def ensure_binaries() -> None:
    os.makedirs(BIN, exist_ok=True)
    pg = os.path.join(BIN, "postgrest")
    gt = os.path.join(BIN, "gotrue")
    if not os.path.exists(pg):
        arc = os.path.join(BIN, "postgrest.tar.xz")
        curl_resume(PGRST_DL, arc)
        subprocess.run(["tar", "xf", arc, "-C", BIN], check=True)
        os.chmod(pg, 0o755)
        os.remove(arc)
    if not os.path.exists(gt):
        arc = os.path.join(BIN, "gotrue.tar.gz")
        curl_resume(GOTRUE_DL, arc)
        subprocess.run(["tar", "xzf", arc, "-C", BIN], check=True)
        # arşiv düzeni sürüme göre değişebilir; binary'yi bul
        for root, _dirs, files in os.walk(BIN):
            for f in files:
                if f in ("auth", "gotrue"):
                    os.replace(os.path.join(root, f), gt)
                    break
        os.chmod(gt, 0o755)
        os.remove(arc)
    verify_binary(pg, PGRST_SHA256, "postgrest", PGRST_VER)
    verify_binary(gt, GOTRUE_SHA256, "gotrue", GOTRUE_VER)


def verify_binary(path: str, want_sha, name: str, ver: str) -> None:
    """Kurulu binary'nin sabitlenmiş resmi sürüm baytlarıyla aynı olduğunu doğrular.

    want_sha: tek digest (str) veya {kaynak_etiketi: digest|None} sözlüğü.
    None girdisi 'o kanal henüz doğrulanmadı' demektir ve kabul EDİLMEZ (fail-closed).
    """
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    got = h.hexdigest()
    pins = {want_sha: "resmi sürüm"} if isinstance(want_sha, str) else \
           {v: k for k, v in want_sha.items() if v}
    if not pins:
        raise RuntimeError(f"{name} için doğrulanmış sha256 pini yok ({ver}); kurulum reddedildi")
    if got not in pins:
        beklenen = ", ".join(f"[{lab[:40]}…]={dig[:12]}…" for dig, lab in pins.items())
        raise RuntimeError(
            f"{name} sha256 UYUŞMAZLIĞI: bulunan {got[:16]}…, kabul edilenler: {beklenen} — "
            f"binary silinip resmi kaynaktan yeniden kurulmalı: {path}")
    print(f"binary doğrulandı: {name} {ver} [{pins[got]}] sha256={got[:12]}…")


def ensure_cluster() -> None:
    r = sh(["pg_lsclusters"])
    if "yz2srv" not in r.stdout:
        subprocess.run(["pg_createcluster", "15", "yz2srv", f"--port={PG_PORT}", "--",
                        "-A", "trust", "-E", "UTF8", "--locale=C.UTF-8"],
                       check=True, capture_output=True, text=True)
    if "online" not in [l for l in sh(["pg_lsclusters"]).stdout.splitlines() if "yz2srv" in l][0]:
        subprocess.run(["pg_ctlcluster", "15", "yz2srv", "start"], check=True)
    dbs = psql("select 1 from pg_database where datname='%s'" % DB, db="postgres", extra=["-tA"]).stdout.strip()
    if dbs != "1":
        subprocess.run(["createdb", "-h", "127.0.0.1", "-p", str(PG_PORT), "-U", "postgres", DB], check=True)
    # GoTrue migration'ları auth şemasının var olduğunu varsayar (hosted Supabase'de platform kurar)
    psql("create schema if not exists auth")
    # GoTrue'nun çalışma sorguları şemasızdır; kendi rolünün search_path'i auth'u içermeli.
    # Yerel geliştirme kısayolu: superuser. Hosted'da bu ayrımı platform yönetir.
    psql("""do $d$ begin
              if not exists (select from pg_roles where rolname = 'gotrue') then
                create role gotrue login superuser;
              end if;
            end $d$""")
    psql("alter role gotrue set search_path = auth, public")


def check_secret(name: str, value: str) -> None:
    """Örnek/zayıf sır tripwire'ı — gerçek kurulumda placeholder kabul edilmez."""
    if len(value) < MIN_SECRET_LEN:
        raise RuntimeError(f"{name} çok kısa (en az {MIN_SECRET_LEN} karakter)")
    if value.strip().lower() in KNOWN_EXAMPLE_SECRETS:
        raise RuntimeError(f"{name} bilinen bir ÖRNEK sır — gerçek kurulumda kabul edilmez")


def write_configs() -> dict:
    jwt_path = os.path.join(RUN, "jwt_secret")
    if os.path.exists(jwt_path):
        jwt_secret = open(jwt_path).read().strip()
    else:
        jwt_secret = secrets.token_urlsafe(48)
        open(jwt_path, "w").write(jwt_secret)
    os.chmod(jwt_path, 0o600)
    check_secret("jwt_secret", jwt_secret)
    auth_pw = "dev-" + secrets.token_urlsafe(12)
    psql(f"alter role authenticator login password '{auth_pw}'")
    pgrst_conf = os.path.join(RUN, "postgrest.conf")
    open(pgrst_conf, "w").write("\n".join([
        f'db-uri = "postgres://authenticator:{auth_pw}@127.0.0.1:{PG_PORT}/{DB}"',
        'db-schemas = "public"',
        'db-anon-role = "anon"',
        f'jwt-secret = "{jwt_secret}"',
        "jwt-secret-is-base64 = false",
        # yalnız bu servisin ürettiği kitle kabul edilir (yanlış-aud token reddedilir)
        'jwt-aud = "authenticated"',
        # kötüye kullanım sınırları: tek istekte en çok 1000 satır döner
        "db-max-rows = 1000",
        f"server-port = {PGRST_PORT}",
        'server-host = "127.0.0.1"',
        "",
    ]))
    os.chmod(pgrst_conf, 0o600)   # içinde DB parolası var
    gotrue_env = os.path.join(RUN, "gotrue.env")
    open(gotrue_env, "w").write("\n".join([
        "GOTRUE_DB_DRIVER=postgres",
        f"GOTRUE_DB_DATABASE_URL=postgres://gotrue@127.0.0.1:{PG_PORT}/{DB}?sslmode=disable",
        "GOTRUE_DB_NAMESPACE=auth",
        "GOTRUE_API_HOST=127.0.0.1",
        f"GOTRUE_API_PORT={GOTRUE_PORT}",
        f"GOTRUE_API_EXTERNAL_URL=http://127.0.0.1:{GOTRUE_PORT}",
        # bu sürüm (auth v2.197) bazı zorunlu anahtarı yalın adıyla ister:
        f"API_EXTERNAL_URL=http://127.0.0.1:{GOTRUE_PORT}",
        f"GOTRUE_JWT_SECRET={jwt_secret}",
        "GOTRUE_JWT_EXP=28800",
        "GOTRUE_JWT_AUD=authenticated",
        "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
        "GOTRUE_SITE_URL=http://127.0.0.1:8124",
        "GOTRUE_MAILER_AUTOCONFIRM=true",
        "GOTRUE_DISABLE_SIGNUP=false",
        "GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
        "",
    ]))
    os.chmod(gotrue_env, 0o600)   # içinde JWT sırrı var
    return {"jwt_secret": jwt_secret}


def harden_db() -> None:
    """İstek süre/kötüye kullanım sınırları — veritabanı düzeyinde varsayılanlar.

    statement_timeout PostgREST oturumlarına (authenticator) uygulanır; yönetim
    (postgres) ve auth servisi (gotrue) muaf tutulur ki migration/bakım işleri
    yarıda kesilmesin. Gövde boyutu sınırı PostgREST'te YOKTUR; hosted geçişte
    ön proxy (veya platform) sınırı planlanmalıdır — dokümanda açık nottur.
    """
    psql(f"alter database {DB} set statement_timeout = '8s'")
    psql(f"alter database {DB} set idle_in_transaction_session_timeout = '30s'")
    psql(f"alter role postgres in database {DB} set statement_timeout = 0")
    psql(f"alter role gotrue in database {DB} set statement_timeout = 0")


def start_proc(name: str, argv: list[str], env=None) -> None:
    log = open(os.path.join(RUN, f"{name}.log"), "ab")
    p = subprocess.Popen(argv, stdout=log, stderr=log, env=env)
    open(os.path.join(RUN, f"{name}.pid"), "w").write(str(p.pid))


def stop_proc(name: str) -> None:
    pid_path = os.path.join(RUN, f"{name}.pid")
    if os.path.exists(pid_path):
        try:
            os.kill(int(open(pid_path).read().strip()), 15)
        except ProcessLookupError:
            pass
        os.remove(pid_path)


def up() -> None:
    os.makedirs(RUN, exist_ok=True)
    os.chmod(RUN, 0o700)          # çalışma dizini: sır ve pid dosyaları yalnız sahibine
    ensure_binaries()
    ensure_cluster()
    # 1) roller (küme düzeyi önkoşul) — config'deki ALTER ROLE'den önce gelmeli
    psql_file(os.path.join(MIG, "0001_bootstrap_roles.sql"))
    cfg = write_configs()
    harden_db()
    # 2) GoTrue: ilk açılışta auth şemasını kurar
    stop_proc("gotrue")
    env = dict(os.environ)
    for line in open(os.path.join(RUN, "gotrue.env")):
        if "=" in line:
            k, v = line.strip().split("=", 1)
            env[k] = v
    start_proc("gotrue", [os.path.join(BIN, "gotrue")], env=env)
    wait_http(f"{GOTRUE_URL}/health", 90)
    # 3) uygulama migration'ları (auth şeması hazırken)
    for f in ["0002_auth_helpers.sql", "0010_schema.sql", "0020_rls.sql", "0030_rpc.sql",
              "0040_denetim_sertlestirme.sql"]:
        psql_file(os.path.join(MIG, f))
    # 4) PostgREST
    stop_proc("postgrest")
    start_proc("postgrest", [os.path.join(BIN, "postgrest"), os.path.join(RUN, "postgrest.conf")])
    wait_http(f"{PGRST_URL}/", 60)
    seed()
    # açık test-ortamı işareti — wipe bu işaret olmadan çalışmaz
    with open(os.path.join(RUN, "TEST_ORTAMI"), "w") as f:
        f.write(f"yerel TEST yığını; kurulum {time.strftime('%Y-%m-%d %H:%M:%S')}; "
                f"db={DB} pg_port={PG_PORT}\n")
    print(f"YIGIN HAZIR — postgrest:{PGRST_PORT} gotrue:{GOTRUE_PORT} pg:{PG_PORT}")


def seed() -> None:
    # JWT 'role' claim'i auth.users.role'den gelir; boş kalmış kullanıcıları düzelt
    psql("update auth.users set role='authenticated' where role is null or role=''")
    # tenant'lar (idempotent)
    for t in (TENANT_A, TENANT_B):
        psql("insert into public.tenants (slug, name, allow_same_actor_check_approve) "
             f"values ('{t['slug']}', '{t['name']}', {str(t['allow_same']).lower()}) "
             "on conflict (slug) do nothing")
    # kullanıcılar: gerçek GoTrue signup (autoconfirm) — üyelikler SQL ile bağlanır
    for u in USERS:
        status, body = http("POST", f"{GOTRUE_URL}/signup",
                            {"email": u["email"], "password": TEST_PASSWORD})
        if status in (200, 201):
            uid = body.get("id") or (body.get("user") or {}).get("id")
        elif status == 422 or (isinstance(body, dict) and "already" in json.dumps(body).lower()):
            uid = None  # var: aşağıda auth.users'tan okunur
        else:
            raise RuntimeError(f"signup başarısız {u['email']}: {status} {body}")
        if not uid:
            uid = psql(f"select id from auth.users where email='{u['email']}'", extra=["-tA"]).stdout.strip()
        psql("insert into public.memberships (tenant_id, user_id, role, display_name) "
             f"select t.id, '{uid}', '{u['role']}', '{u['name']}' from public.tenants t "
             f"where t.slug='{u['tenant']}' on conflict do nothing")
    print(f"TOHUM TAMAM — {len(USERS)} TEST kullanıcısı, 2 TEST şirketi")


def down() -> None:
    stop_proc("postgrest")
    stop_proc("gotrue")
    print("postgrest + gotrue durduruldu (PostgreSQL kümesi açık bırakıldı)")


def wipe(confirm: bool = False) -> None:
    """TEST ortamını tamamen siler. Geri dönüş DEĞİLDİR — veri silmedir.

    İki koruma: (1) yalnız bu scriptin kurduğu açık TEST ortamı (TEST_ORTAMI
    işareti + beklenen sabitler), (2) açık `--evet` onayı.
    """
    marker = os.path.join(RUN, "TEST_ORTAMI")
    if not os.path.exists(marker):
        raise RuntimeError("wipe reddedildi: TEST_ORTAMI işareti yok — bu dizin bu scriptin "
                           "kurduğu açık test ortamı olarak doğrulanamadı")
    if not (DB.startswith("sahapro_srv") and PG_PORT == 55432):
        raise RuntimeError("wipe reddedildi: hedef sabitleri beklenen test değerleri değil")
    if not confirm:
        print("wipe ONAYSIZ çalışmaz. Silinecekler: PostgreSQL kümesi 'yz2srv' (TÜM TEST VERİSİ),")
        print(f"çalışma dizini {RUN} (binary'ler, sırlar, loglar). Bu bir geri dönüş değil,")
        print("veri silmedir. Onay için:  python3 tests/server_local_stack.py wipe --evet")
        sys.exit(1)
    down()
    subprocess.run(["pg_ctlcluster", "15", "yz2srv", "stop"], capture_output=True)
    subprocess.run(["pg_dropcluster", "15", "yz2srv", "--stop"], capture_output=True)
    subprocess.run(["rm", "-rf", RUN], capture_output=True)
    print("yerel TEST yığını tamamen silindi (küme + binary'ler + çalışma dizini)")


# ---------- yedek / geri yükleme (geri dönüşün gerçek mekanizması) ----------

COMPARE_TABLES = ["tenants", "memberships", "reports", "revisions", "works", "approvals", "audit"]


def backup(path: str) -> None:
    """Veritabanının fiziksel kopyasını alır (pg_dump özel biçimi) + özet basar."""
    r = sh(["pg_dump", "-h", "127.0.0.1", "-p", str(PG_PORT), "-U", "postgres",
            "-Fc", "-f", path, DB])
    if r.returncode != 0:
        raise RuntimeError(f"pg_dump hatası: {r.stderr.strip()[:500]}")
    print(f"YEDEK YAZILDI: {path} ({os.path.getsize(path)} bayt)")
    for t in COMPARE_TABLES:
        n = psql(f"select count(*) from public.{t}", extra=["-tA"]).stdout.strip()
        print(f"  {t}: {n} satır")


def restore(path: str, target_db: str) -> None:
    """Yedeği AYRI, boş bir veritabanına geri yükler (karşılaştırma için)."""
    if target_db == DB:
        raise RuntimeError("restore hedefi canlı test DB'si olamaz; ayrı bir DB adı verin")
    if not target_db.startswith("yz2_"):
        raise RuntimeError("restore hedef DB adı 'yz2_' ile başlamalı (test dışı DB'ye yazılmaz)")
    psql(f'drop database if exists "{target_db}"', db="postgres")
    psql(f'create database "{target_db}"', db="postgres")
    r = sh(["pg_restore", "-h", "127.0.0.1", "-p", str(PG_PORT), "-U", "postgres",
            "-d", target_db, "--no-owner", path])
    if r.returncode != 0:
        raise RuntimeError(f"pg_restore hatası: {r.stderr.strip()[:500]}")
    print(f"GERİ YÜKLENDİ: {path} → {target_db}")
    for t in COMPARE_TABLES:
        n = psql(f"select count(*) from public.{t}", db=target_db, extra=["-tA"]).stdout.strip()
        print(f"  {t}: {n} satır")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "up"
    if cmd == "wipe":
        wipe(confirm="--evet" in sys.argv[2:])
    elif cmd == "backup":
        if len(sys.argv) < 3:
            sys.exit("kullanım: backup <dosya>")
        backup(sys.argv[2])
    elif cmd == "restore":
        if len(sys.argv) < 4:
            sys.exit("kullanım: restore <dosya> <hedef_db>")
        restore(sys.argv[2], sys.argv[3])
    elif cmd in ("up", "seed", "down"):
        {"up": up, "seed": seed, "down": down}[cmd]()
    else:
        sys.exit(f"bilinmeyen komut: {cmd}")
