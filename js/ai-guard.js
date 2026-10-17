// İstek bazlı yerel emniyet: retry, model arama ve tool turları dahil her HTTP denemesi sayılır.
// Bu sayaç parasal veya sağlayıcı taraflı kota garantisi değildir.
export const DEFAULT_DAILY_AI_LIMIT = 60;
export const AI_BUDGET_KEY = 'ai_request_budget_v1';
const queues = new WeakMap();
export function aiDay(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now);
  const at = type => p.find(x => x.type === type).value;
  return `${at('year')}-${at('month')}-${at('day')}`;
}
const cap = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 500 ? Number(value) : DEFAULT_DAILY_AI_LIMIT;
function nextBudget(current, limit, day) {
  const used = current?.date === day ? current.attempts : 0;
  if (!Number.isSafeInteger(used) || used < 0) throw Error('AI istek sayacı geçersiz; ayarları kontrol edin');
  if (used >= cap(limit)) throw Error(`Günlük AI istek sınırı doldu (${cap(limit)}). Yerel kayıtlar kullanılabilir.`);
  return { date: day, attempts: used + 1, limit: cap(limit) };
}
export async function reserveAiRequest(db, now = new Date()) {
  const day = aiDay(now);
  if (db.openDB) {
    const connection = await db.openDB();
    return new Promise((resolve, reject) => {
      const tx = connection.transaction('meta','readwrite'), store = tx.objectStore('meta');
      let result, error;
      const budget = store.get(AI_BUDGET_KEY), limit = store.get('ai_daily_request_limit'), consent = store.get('gemini_consent');
      let remaining = 3;
      const prepare = () => {
        if (--remaining) return;
        try {
          if (consent.result?.value !== true) throw Error('Gemini veri gönderimi için açık onay gerekli');
          result = nextBudget(budget.result?.value, limit.result?.value, day);
          store.put({key:AI_BUDGET_KEY,value:result});
        } catch(e) {error=e;tx.abort();}
      };
      budget.onsuccess = limit.onsuccess = consent.onsuccess = prepare;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(error || tx.error || Error('AI sınırı kaydedilemedi; istek gönderilmedi'));
    });
  }
  // Saf test adaptörleri için aynı adapter üzerinde seri rezervasyon.
  const previous = queues.get(db) || Promise.resolve();
  const pending = previous.catch(()=>{}).then(async () => {
    if (await db.metaGet('gemini_consent') !== true) throw Error('Gemini veri gönderimi için açık onay gerekli');
    const value = nextBudget(await db.metaGet(AI_BUDGET_KEY), await db.metaGet('ai_daily_request_limit'),day);
    await db.metaSet(AI_BUDGET_KEY,value);
    return value;
  });
  queues.set(db,pending);return pending;
}
export function guardedAiFetch(db, fetchFn = fetch) {
  return async (url, init) => {
    await reserveAiRequest(db);
    return fetchFn(url,init);
  };
}
export async function aiBudgetStatus(db) {
  const b = await db.metaGet(AI_BUDGET_KEY);
  return { attempts:b?.date === aiDay() ? b.attempts : 0, limit:cap(await db.metaGet('ai_daily_request_limit')) };
}
