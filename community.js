/* JAKHAR — community.js  (अलग फ़ाइल: index.html के साथ, उसी folder में रखें)
 * Community का सारा कोड यहाँ रहेगा ताकि index.html (पढ़ाई वाला ऐप) भारी न हो।
 * index.html इसे तभी लोड करता है जब user Community खोलता है: `await jkLoadCommunity()`.
 * Part 6: JKUpload (PDF/photo upload -> Cloudflare Worker -> R2).  Part 7: UI यहीं जुड़ेगी.
 * Globals जो index.html से मिलते हैं: SM_BASE, SM_KEY, JKAuth, smE, view, hdr, BACK, toast, JKProfile.
 */
(function () {
  if (window.JKUpload) return;

  /* ⚠ Cloudflare Worker deploy करने के बाद उसका URL यहाँ डालें (बिना आख़िरी "/" के), जैसे:
     "https://jakhar-files.aapka-naam.workers.dev"    — खाली रहने पर upload बंद रहेगा (UNCONFIGURED). */
  const UPLOAD_API = "https://jakhar-files.nvinu2259.workers.dev";

  const BASE = SM_BASE, KEY = SM_KEY;
  const TYPES = { "application/pdf": "pdf", "image/jpeg": "img", "image/png": "img", "image/webp": "img" };
  const MB = 1048576, fmtMB = b => (b / MB >= 10 ? Math.round(b / MB) : Math.round(b / MB * 10) / 10) + " MB";
  let LIM = { pdf_max_bytes: 15 * MB, pdf_daily_bytes: 20 * MB, pdf_daily_count: 3, img_max_bytes: 5 * MB, img_daily_bytes: 0, img_daily_count: 50 };

  function mimeOf(f) {
    let t = (f.type || "").toLowerCase();
    if (!t && /\.pdf$/i.test(f.name || "")) t = "application/pdf";
    if (t === "image/jpg") t = "image/jpeg";
    return t;
  }
  async function tok() {
    if (!window.JKAuth) return null;
    try { await JKAuth.refresh(); } catch (e) {}
    const s = JKAuth.getSession();
    return s ? s.access_token : null;
  }
  const err = (code, extra) => { const e = new Error(code); e.code = code; if (extra) Object.assign(e, extra); return e; };

  /* आज कितना use हुआ + limits (server से; DB का community_config असली सच है) */
  async function usage() {
    const t = await tok(); if (!t) throw err("LOGIN");
    let r;
    try {
      r = await fetch(BASE + "/rest/v1/rpc/my_upload_usage", {
        method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: "{}"
      });
    } catch (e) { throw err("NET"); }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw err("SERVER");
    LIM = Object.assign(LIM, j.limits || {});
    return j;
  }
  /* "आज: PDF 12/20 MB · 2/3 फ़ाइल" */
  function usageText(u) {
    const l = u.limits || LIM, p = [];
    p.push("PDF " + fmtMB(u.pdf_bytes) + (l.pdf_daily_bytes ? "/" + fmtMB(l.pdf_daily_bytes) : "") + " · " + u.pdf_count + (l.pdf_daily_count ? "/" + l.pdf_daily_count : "") + " फ़ाइल");
    return "आज: " + p.join(" · ");
  }

  /* Photo: लंबी तरफ़ 1600px, JPEG ~0.82 (छोटी हो तो वैसी ही रहने दो) */
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const M = 1600, sc = Math.min(1, M / Math.max(img.width, img.height));
        if (sc === 1 && file.size <= 1.5 * MB && file.type === "image/jpeg") return res(file);
        const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => (b && b.size < file.size) || (b && sc < 1) ? res(b) : res(file), "image/jpeg", .82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(err("IMG")); };
      img.src = url;
    });
  }

  /* upload(file, {onProgress(0-100)}) -> {key,name,size,mime,url}.  Errors: e.code (LOGIN, MIME, TOOBIG, DAILY_COUNT, DAILY_BYTES,
     EMPTY, IMG, NET, SERVER, STORE_FAILED, UNCONFIGURED) — Hindi text के लिए JKUpload.msg(e) */
  async function upload(file, opts) {
    opts = opts || {};
    if (!UPLOAD_API) throw err("UNCONFIGURED");
    if (!file || !file.size) throw err("EMPTY");
    let mime = mimeOf(file); const kind = TYPES[mime];
    if (!kind) throw err("MIME");
    let blob = file;
    if (kind === "img") { blob = await shrink(file); mime = blob.type || "image/jpeg"; }
    const max = kind === "pdf" ? LIM.pdf_max_bytes : LIM.img_max_bytes;
    if (max && blob.size > max) throw err("TOOBIG", { max });
    const t = await tok(); if (!t) throw err("LOGIN");
    const name = (file.name || (kind === "pdf" ? "file.pdf" : "photo.jpg")).slice(0, 120);
    return new Promise((ok, no) => {
      const x = new XMLHttpRequest();
      x.open("PUT", UPLOAD_API + "/upload?name=" + encodeURIComponent(name));
      x.setRequestHeader("Authorization", "Bearer " + t);
      x.setRequestHeader("Content-Type", mime);
      x.timeout = 120000;
      if (x.upload && opts.onProgress) x.upload.onprogress = e => { if (e.lengthComputable) opts.onProgress(Math.round(e.loaded / e.total * 100)); };
      x.onload = () => {
        let j = null; try { j = JSON.parse(x.responseText); } catch (e) {}
        if (x.status === 200 && j && j.key) { if (opts.onProgress) opts.onProgress(100); ok(j); }
        else no(err((j && j.error) || "SERVER", { max }));
      };
      x.onerror = x.ontimeout = () => no(err("NET"));
      x.send(blob);
    });
  }

  function msg(e) {
    const c = e && e.code, l = LIM;
    return ({
      UNCONFIGURED: "फ़ाइल अपलोड अभी चालू नहीं है।",
      LOGIN: "फ़ाइल भेजने के लिए दोबारा लॉगिन करें।",
      MIME: "सिर्फ़ PDF या फ़ोटो (JPG/PNG/WebP) भेज सकते हैं।",
      EMPTY: "फ़ाइल खाली है।",
      IMG: "यह फ़ोटो पढ़ी नहीं जा सकी। JPG/PNG फ़ोटो चुनें।",
      TOOBIG: "फ़ाइल बहुत बड़ी है" + (e && e.max ? " (अधिकतम " + fmtMB(e.max) + ")" : "") + "।",
      DAILY_COUNT: "आज की फ़ाइल-सीमा पूरी हो गई" + (l.pdf_daily_count ? " (रोज़ " + l.pdf_daily_count + " PDF)" : "") + "। कल फिर भेजें।",
      DAILY_BYTES: "आज की अपलोड-सीमा पूरी हो गई" + (l.pdf_daily_bytes ? " (रोज़ " + fmtMB(l.pdf_daily_bytes) + ")" : "") + "। कल फिर भेजें।",
      NET: "इंटरनेट नहीं है। फिर कोशिश करें।",
      STORE_FAILED: "फ़ाइल सेव नहीं हो पाई। थोड़ी देर बाद फिर कोशिश करें।"
    })[c] || "फ़ाइल नहीं भेजी जा सकी। थोड़ी देर बाद फिर कोशिश करें।";
  }

  /* DB में सिर्फ़ key रखी जाती है (posts.file_key / messages.file_key / groups.avatar_key); URL यहाँ से बनता है,
     इसलिए Worker का address बदले तो पुराना डेटा नहीं बिगड़ता। */
  const url = key => (key && UPLOAD_API) ? UPLOAD_API + "/f/" + key : "";

  window.JKUpload = { upload, usage, usageText, msg, url, fmtMB, limits: () => LIM, configured: () => !!UPLOAD_API, types: Object.keys(TYPES) };
})();
