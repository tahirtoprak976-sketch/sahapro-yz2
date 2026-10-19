# SAHAPRO YZ2 — Yerel Sunucu Dilimi (Supabase bileşenleri, hesapsız)

Bu klasör YZ2'nin **ilk ortak sunucu dilimi**nin veritabanı tarafını tutar. Amaç: dış servis
hesabı AÇMADAN, Supabase'in gerçek bileşenleriyle (PostgreSQL + GoTrue + PostgREST) aynı
sözleşmeyi yerelde doğrulamak. Bu dilimde canlı yayın, dış hesap ve gerçek veri YOK.

## Bileşenler (hepsi bu makinede, tamamı ücretsiz)

| Bileşen | Sürüm | Port | Rolü |
|---|---|---|---|
| PostgreSQL (Debian paketi) | 15 | 55432 | Veri + RLS + RPC |
| GoTrue (supabase/auth) | v2.197.0 | 53002 | Gerçek oturum/JWT üretimi |
| PostgREST | v16.4 | 53001 | JWT doğrulama + rol geçişi + REST/RPC API |

## Kurulum (asgari gereksinimler)

- Linux (Debian tabanlı), `postgresql-15` paketi, `curl`, Python 3
- İnternet: yalnız ilk `up` sırasında iki binary indirilir (PostgREST ~8 MB, GoTrue ~24 MB)
- Komutlar:

```bash
python3 tests/server_local_stack.py up       # küme + migration'lar + servisler + TEST tohumu
python3 tests/sunucu_api_test.py             # API kabul + saldırgan senaryolar (33 kontrol)
python3 tests/sunucu_browser_test.py         # 3 oturumlu tarayıcı kabul suiti (17 kontrol)
python3 tests/sunucu_rpc_denetim_test.py     # SECURITY DEFINER/yetki yüzeyi denetimi (27 kontrol)
python3 tests/sunucu_oturum_kuyruk_test.py   # oturum + kuyruk sahibi kilidi (13 kontrol)
python3 tests/sunucu_yedek_test.py           # yedek → ayrı DB'ye geri yükleme kanıtı (17 kontrol)
python3 tests/server_local_stack.py down     # servisleri durdur (küme kalır)
python3 tests/server_local_stack.py backup yedek.dump            # yedek al
python3 tests/server_local_stack.py restore yedek.dump yz2_geri  # ayrı/boş DB'ye geri yükle
python3 tests/server_local_stack.py wipe --evet                  # HER ŞEYİ sil (VERİ SİLME — geri dönüş değil)
```

- **Sürüm ve bütünlük sabitlemesi**: binary'ler yalnız resmi kanallardan kurulur
  (GitHub release varlıkları; GoTrue için ayrıca resmi `ghcr.io/supabase/auth` OCI imajı)
  ve `server_local_stack.py` içindeki sha256 pinleriyle doğrulanır — uyuşmazlıkta kurulum
  durur. Bu oturumda GitHub asset CDN'i ağdan erişilemediği için GoTrue binary'si resmi
  ghcr imajından çıkarıldı; iki kanalın pinleri ayrı etiketlerle scriptte yazılıdır.
- **Sır politikası**: jwt_secret çalışma anında üretilir; bilinen örnek/placeholder sırlar
  ve kısa değerler reddedilir. `/tmp/yz2srv` 0700, sır içeren dosyalar 0600'dır.
- **wipe koruması**: wipe yalnız açık `--evet` onayı ve `TEST_ORTAMI` işaretiyle çalışır.
  wipe geri dönüş DEĞİL, veri silmedir; geri dönüş backup/restore iledir.

- İstemci: `sunucu.html` (depo kökünden statik servisle, ör. `python3 -m http.server 8124`).
  Yalnız TEST hesapları: `test-sofor-1@example.invalid`, `test-ofis-1@example.invalid`,
  `test-yonetici-1/2@example.invalid`, `test-rakip-sofor@example.invalid` — parola tohumda.

## Dürüstlük notları (yerel ≠ hosted farkları)

1. **JWT sırrı** çalışma anında üretilir, yalnız `/tmp/yz2srv/jwt_secret` içinde durur; depoya girmez.
2. **PostgreSQL `trust` auth** yalnız 127.0.0.1 yerel geliştirme içindir; hosted'da platform yönetir.
3. **GoTrue'nun DB rolü yerelde superuser'dır** — GoTrue'nun şemasız çalışma sorguları için yerel
   kısayol. Hosted Supabase'de bu ayrımı platform yönetir; üretim kurulumunda dar yetkili rol gerekir.
4. **0001 migration'ı yalnız yereldir**: hosted Supabase'de `anon`/`authenticated`/`authenticator`
   rolleri hazır gelir; bu dosya üretimde çalıştırılmaz.
5. **E-posta**: `GOTRUE_MAILER_AUTOCONFIRM=true` — yerel testte doğrulama e-postası atlanır.
   Hosted'da bu kapalı tutulur.
6. **service_role / gizli anahtar istemcide YOK**: istemci yalnız kullanıcının kendi oturum
   JWT'sini kullanır. Hosted'a geçişte publishable (anon) key eklenir; secret key asla istemciye girmez.
7. Bu dilim **fotoğraf/dosya deposu içermez** (attachments sabit `[]`). Dosya deposu + SQL tek
   transaction olamaz; yarım-yükleme tasarımı ayrıca belgelenecektir (bkz. `docs/SUNUCU_DILIM.md`).
