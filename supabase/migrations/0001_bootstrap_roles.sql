-- 0001_bootstrap_roles.sql — PostgREST rolleri (küme düzeyinde, bir kez)
-- Hosted Supabase'de anon/authenticated/authenticator rolleri hazır gelir; bu dosya
-- yalnız YEREL geliştirme kümesini aynı sözleşmeye getirir. Üretimde çalıştırılmaz.
-- Not: authenticator şifresi stack-up betiği tarafından çalışma anında üretilen
-- rastgele değerle değiştirilir; buradaki değer yalnız ilk create içindir.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'STACKUP-DEGISTIR';
  end if;
end
$$;

grant anon to authenticator;
grant authenticated to authenticator;
