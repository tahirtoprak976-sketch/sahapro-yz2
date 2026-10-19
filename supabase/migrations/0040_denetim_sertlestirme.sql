-- 0040_denetim_sertlestirme.sql — fonksiyon EXECUTE yüzeyinin açık matrise sabitlenmesi
--
-- Denetim bulgusu: 0010/0020'deki fonksiyonlar, 0020'deki
-- `alter default privileges revoke execute` ifadesinden ÖNCE yaratıldığı için
-- PUBLIC EXECUTE hakkıyla doğmuştu. SECURITY DEFINER RPC'ler yetkiyi içeride
-- denetlediği için bu tek başına açık değildi; ancak gereksiz yüzey kapatılır.
--
-- Hedef matris:
--   fonksiyon                                   PUBLIC  anon   authenticated
--   my_session + 7 akış RPC'si                    —      —        EXECUTE
--   rls_is_member / rls_has_role                  —      —        EXECUTE  (RLS politikaları kullanır)
--   auth.uid / auth.role / auth.jwt_claims        —      —        EXECUTE  (politikalar + RPC içi)
--   flow_fingerprint / jsonb_diff                 —      —         —       (yalnız RPC içinden)
--   _req_uid / _actor_role / _report_locked / _audit —   —         —       (iç yardımcı)
--
-- Neden yardımcılar dışa kapalı olabilir: SECURITY DEFINER bir RPC'nin içinden
-- yapılan fonksiyon çağrılarında EXECUTE kontrolü, etkin kullanıcı = fonksiyon
-- sahibi (postgres) üzerinden yapılır; çağıran istemci rolünün yardımcıda hakka
-- ihtiyacı yoktur. RLS politika ifadelerindeki fonksiyonlar ise sorgulayan rol
-- (authenticated) adına denetlendiği için onlara EXECUTE ŞARTTIR.

revoke execute on all functions in schema public from public, anon;
revoke execute on function auth.jwt_claims(), auth.uid(), auth.role() from public, anon;

-- akış RPC'leri (0030'daki grant'lerle aynı; burada matrisin tek yerden okunması için)
grant execute on function public.my_session() to authenticated;
grant execute on function public.submit_work(text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.start_check(uuid, int) to authenticated;
grant execute on function public.request_fix(uuid, text, int) to authenticated;
grant execute on function public.edit_report(uuid, jsonb, text, int) to authenticated;
grant execute on function public.complete_check(uuid, int) to authenticated;
grant execute on function public.approve_report(uuid, int, int) to authenticated;
grant execute on function public.reject_report(uuid, text, int) to authenticated;

-- politika yardımcıları (RLS ifadeleri çağırır)
grant execute on function public.rls_is_member(uuid) to authenticated;
grant execute on function public.rls_has_role(uuid, text[]) to authenticated;

-- JWT yardımcıları (politika ifadeleri + RPC gövdeleri okur)
grant execute on function auth.jwt_claims(), auth.uid(), auth.role() to authenticated;
