// SAHAPRO SOLO — paylaşılan UI bileşenleri (DOM)
import { fmtTL, fmtNum, trDate, todayStr } from "./core.js";

export const qs = (s, r = document) => r.querySelector(s);
export const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
export function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function go(hash) {
  location.hash = hash;
}
export function back(fallback) {
  if (history.length > 1) history.back();
  else go(fallback || "#/");
}

// ---- App bar ----
export function appbar(title, sub = "", opts = {}) {
  return `<div class="appbar">
    ${opts.back === false ? "" : `<button class="back" data-act="back" aria-label="Geri">‹</button>`}
    <div class="title"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>
    ${opts.right || ""}
  </div>`;
}

// ---- Bileşenler ----
export function badge(text, kind = "") {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}
export function statusBadge(status) {
  const map = {
    Taslak: "",
    İmzalandı: "ok",
    Revize: "warn",
    İptal: "danger",
    Açık: "danger",
    Serviste: "warn",
    "Parça Bekliyor": "warn",
    Tamamlandı: "ok",
    PERSONELDE: "warn",
    TESLIM_BILDIRILDI: "info",
    KASAYA_TESLIM_EDILDI: "ok",
    Kesinleşti: "ok",
    Gönderildi: "info",
    Kabul: "ok",
    Red: "danger",
    Bekliyor: "warn",
    Ödendi: "ok",
    TAMAM: "ok",
    BEKLIYOR: "warn",
    HATA: "danger",
    YOK: "",
  };
  return badge(status, map[status] || "");
}
export function stat(v, l, cls = "") {
  return `<div class="stat ${cls}"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
}
export function li({
  ic = "•",
  t1 = "",
  t2 = "",
  end = "",
  href = "",
  badgeHtml = "",
  id = "",
}) {
  const inner = `<div class="ic">${ic}</div><div class="grow"><div class="t1 ellipsis">${t1}</div>${t2 ? `<div class="t2 ellipsis">${t2}</div>` : ""}</div>${badgeHtml}${end ? `<div class="end">${end}</div>` : ""}`;
  return href
    ? `<div class="li" data-go="${esc(href)}">${inner}</div>`
    : `<div class="li"${id ? ` data-rid="${esc(id)}"` : ""}>${inner}</div>`;
}
export function emptyState(ic, text, ctaHtml = "") {
  return `<div class="empty"><div class="ic">${ic}</div><div class="t">${esc(text)}</div>${ctaHtml ? `<div style="margin-top:12px">${ctaHtml}</div>` : ""}</div>`;
}
export function notice(kind, text) {
  return `<div class="notice ${kind}"><span>${kind === "danger" ? "⛔" : kind === "warn" ? "⚠" : kind === "ok" ? "✓" : "ℹ"}</span><span>${esc(text)}</span></div>`;
}
export function skeleton(n = 3) {
  return Array.from(
    { length: n },
    () => '<div class="skel" style="height:64px;margin-bottom:8px"></div>',
  ).join("");
}
export function kv(k, v) {
  return `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
}

// ---- Toast ----
export function toast(msg, kind = "") {
  const root = qs("#toast-root");
  const d = document.createElement("div");
  d.className = "toast " + (kind === "err" ? "err" : kind === "ok" ? "ok" : "");
  d.textContent = msg;
  d.setAttribute("role", kind === "err" ? "alert" : "status");
  root.replaceChildren(d);
  setTimeout(() => {
    d.style.opacity = "0";
    d.style.transition = "opacity .3s";
    setTimeout(() => d.remove(), 320);
  }, 2600);
}

// ---- Sheet (bottom modal) ----
export function sheet(html, opts = {}) {
  sheetClose(true);
  const root = qs("#sheet-root");
  const ov = document.createElement("div");
  ov.className = "sheet-overlay";
  const sh = document.createElement("div");
  sh.className = "sheet";
  sh.innerHTML = `<div class="grab"></div>${html}`;
  root.appendChild(ov);
  root.appendChild(sh);
  requestAnimationFrame(() => {
    ov.classList.add("show");
    sh.classList.add("show");
  });
  ov.addEventListener("click", () => {
    if (!opts.modal) sheetClose();
  });
  return sh;
}
export function sheetClose(immediate = false) {
  const root = qs("#sheet-root");
  for (const el of qsa(".sheet, .sheet-overlay", root)) {
    if (immediate) el.remove();
    else {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 240);
    }
  }
}
export function confirmDialog(title, text, okLabel = "Evet", danger = false) {
  return new Promise((resolve) => {
    const sh = sheet(
      `<h3>${esc(title)}</h3><p class="muted" style="margin:0 0 16px">${esc(text)}</p>
      <div class="row" style="gap:8px"><button class="btn ghost grow" data-x="0">Vazgeç</button><button class="btn ${danger ? "danger" : "primary"} grow" data-x="1">${esc(okLabel)}</button></div>`,
      { modal: true },
    );
    sh.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-x]");
      if (!b) return;
      sheetClose();
      resolve(b.dataset.x === "1");
    });
  });
}
export function promptDialog(title, label, value = "", opts = {}) {
  return new Promise((resolve) => {
    const sh = sheet(
      `<h3>${esc(title)}</h3>
      <div class="field"><label>${esc(label)}</label><input type="${opts.type === "password" ? "password" : "text"}" data-p value="${esc(value)}" autocomplete="off"></div>${opts.hint ? `<div class="tiny muted" style="margin:-6px 2px 10px">${esc(opts.hint)}</div>` : ""}
      <div class="row" style="gap:8px"><button class="btn ghost grow" data-x="0">Vazgeç</button><button class="btn primary grow" data-x="1">Tamam</button></div>`,
      { modal: true },
    );
    const inp = qs("[data-p]", sh);
    setTimeout(() => inp.focus(), 250);
    sh.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-x]");
      if (!b) return;
      const v = inp.value.trim();
      sheetClose();
      resolve(b.dataset.x === "1" ? v || null : null);
    });
  });
}

// ---- Form üreticiler ----
export function fText(label, name, val = "", opts = {}) {
  return `<div class="field"><label>${esc(label)}</label><input type="${opts.type || "text"}" name="${name}" value="${esc(val)}" placeholder="${esc(opts.ph || "")}" ${opts.req ? "required" : ""} ${opts.step ? `step="${opts.step}"` : ""} inputmode="${opts.inputmode || (opts.type === "number" ? "decimal" : "text")}" autocomplete="off"></div>`;
}
export function fNum(label, name, val = "", opts = {}) {
  return fText(label, name, val, { ...opts, type: "number" });
}
export function fDate(label, name, val = "", req = true) {
  return `<div class="field"><label>${esc(label)}${req ? " *" : ""}</label><input type="date" name="${name}" value="${esc(val || (req ? todayStr() : ""))}" ${req ? "required" : ""}></div>`;
}
export function fArea(label, name, val = "", ph = "") {
  return `<div class="field"><label>${esc(label)}</label><textarea name="${name}" placeholder="${esc(ph)}">${esc(val)}</textarea></div>`;
}
export function fSelect(label, name, options, val = "", opts = {}) {
  const optsHtml =
    (opts.empty === false
      ? ""
      : `<option value="">${esc(opts.emptyText || "— seç —")}</option>`) +
    options
      .map((o) => {
        const v = typeof o === "object" ? o.v : o;
        const t = typeof o === "object" ? o.t : o;
        return `<option value="${esc(v)}" ${String(v) === String(val) ? "selected" : ""}>${esc(t)}</option>`;
      })
      .join("");
  return `<div class="field"><label>${esc(label)}</label><select name="${name}" ${opts.req ? "required" : ""}>${optsHtml}</select></div>`;
}
// "Yeni ekle" destekli select: değer "__new__" seçilince onNew çağrılır
export function bindSmartSelect(rootSel, list, onNew) {
  const sel = qs(rootSel);
  if (!sel) return;
  sel.addEventListener("change", async () => {
    if (sel.value === "__new__") {
      sel.value = "";
      await onNew();
    }
  });
}
export function collectForm(root) {
  const out = {};
  for (const e of qsa("input[name], select[name], textarea[name]", root)) {
    if (e.type === "file" || e.disabled) continue;
    out[e.name] = e.value;
  }
  return out;
}
export function setForm(root, values) {
  for (const e of qsa("input[name], select[name], textarea[name]", root)) {
    if (e.type === "file") continue;
    if (values[e.name] != null) e.value = values[e.name];
  }
}

// ---- Liste yardımcıları ----
export function segBar(items, current, hrefFn) {
  return `<div class="segbar">${items.map((i) => `<button class="${i.v === current ? "on" : ""}" data-go="${esc(hrefFn(i.v))}">${esc(i.t)}</button>`).join("")}</div>`;
}
export function searchBar(ph = "Ara…", val = "") {
  return `<div class="searchbar"><input type="search" data-search placeholder="${esc(ph)}" value="${esc(val)}"></div>`;
}
// Progressive list: ilk N, "Daha fazla" ile büyür
export function pagedRender(container, items, renderItem, pageSize = 30) {
  let shown = 0;
  function more() {
    const next = items.slice(shown, shown + pageSize);
    const moreBtn = qs("[data-more]", container);
    if (moreBtn) moreBtn.remove();
    container.insertAdjacentHTML("beforeend", next.map(renderItem).join(""));
    shown += next.length;
    if (shown < items.length)
      container.insertAdjacentHTML(
        "beforeend",
        `<button class="btn ghost block" data-more>Daha fazla (${items.length - shown} kaldı)</button>`,
      );
  }
  container.innerHTML = "";
  if (container._pagedMoreHandler)
    container.removeEventListener("click", container._pagedMoreHandler);
  container._pagedMoreHandler = (event) => {
    const button = event.target.closest("[data-more]");
    if (button && container.contains(button)) {
      event.preventDefault();
      more();
    }
  };
  container.addEventListener("click", container._pagedMoreHandler);
  more();
}

// ---- Dosya indirme / paylaşma ----
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export async function shareOrDownload(blob, filename, title = "") {
  try {
    if (navigator.canShare) {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: title || filename });
        return "shared";
      }
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "aborted";
  }
  downloadBlob(blob, filename);
  return "downloaded";
}
export async function shareText(text) {
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "aborted";
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Panoya kopyalandı", "ok");
    return "copied";
  } catch (e) {
    return "fail";
  }
}

// ---- Para / tarih kısayollar ----
export { fmtTL, fmtNum, trDate, todayStr };

// ---- Print view (PDF fallback) ----
export function printHTML(title, bodyHtml) {
  const w = window.open("", "_blank");
  if (!w) {
    toast("Açılır pencere engellendi — PDF butonunu tekrar deneyin", "err");
    return false;
  }
  w.document
    .write(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>body{font-family:Segoe UI,Arial,sans-serif;margin:18px;color:#111;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:5px 7px;text-align:left}th{background:#eee}
  h1{font-size:19px;margin:0}h2{font-size:14px;margin:14px 0 6px}.r{text-align:right}.c{text-align:center}
  .head{display:flex;justify-content:space-between;border-bottom:2px solid #0d1a2b;padding-bottom:8px;margin-bottom:10px}
  .muted{color:#555;font-size:11px}.tot{font-size:14px;font-weight:700}.noborder td,.noborder th{border:0}
  @page{size:A4;margin:12mm}</style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
  }, 350);
  return true;
}
