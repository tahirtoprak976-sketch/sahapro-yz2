# Altın set (doğruluk ölçümü)
- `gold.json`: her kayıt `{ "t": mesaj, "rows": [ {customer, site, vehicle, personnel, type, qty, unit, date} ], "notice": opsiyonel }`. Değerler kart kimliğidir; `null` = "mesajdan belli değil, forma yazılmamalı"; yazılmayan alan ölçülmez.
- `fixture.mjs`: deneme kartları. Gerçek ölçüm için kendi SOLO yedeğinizden kartları buraya aktarın.
- `node tests/gold/run.mjs`: alan başına doğru / soruldu / sessiz-yanlış sayar. `node tests/gold/mutate.mjs`: ASCII, büyük harf, yazım hatası, harf düşmesi bozulmalarında yanlış kart seçilmediğini doğrular.
- Kural: sessiz yanlış = 0, satır sayısı hatası = 0, soru oranı ≤ %5. Gerçek mesajlar eklendikçe set büyütülür; bozulan eski örnek yamayı durdurur.
