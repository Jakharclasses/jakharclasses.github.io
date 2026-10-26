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

/* =====================================================================================
   Part 7 — Community UI  (window.JKCom)   ·   index.html से: openCommunity() -> JKCom.open()
   Screens: hub (Feed | Groups) · group (Chat | Posts | Info) · create group · profile card · report · invite join
   Chat: simple polling (4 sec, tab chhupa ho to ruka) — Realtime baad me jod sakte hain (table publication on hai).
   ===================================================================================== */
(function () {
  if (window.JKCom) return;
  const BASE = SM_BASE, KEY = SM_KEY, $ = id => document.getElementById(id), esc = smE, UP = window.JKUpload;
  const PAGE = 12, MPAGE = 40;
  const AUTH = "username,display_name,avatar_url,verified";
  const POST_SEL = "*,author:profiles!author_id(" + AUTH + ")", MSG_SEL = "*,author:profiles!author_id(" + AUTH + ")";
  const err = (c, x) => { const e = new Error(c); e.code = c; if (x) Object.assign(e, x); return e; };
  let ME = null, SUPER = false, HUBTAB = "feed";
  /* Part 8: global ban/mute stithi + roles ki permissions (ek hi jagah: SQL table role_permissions; na mile to PERMS0) */
  let MOD = { banned: false, reason: "", muted_until: null };
  const PERMS0 = { member: ["post", "chat", "like", "report"], moderator: ["view_reports", "hide_content", "mute_member"], admin: ["kick_member", "ban_member", "make_mod", "edit_group", "reset_invite", "delete_content"], owner: ["make_admin", "delete_group"] };
  const ROLE_ORDER = ["member", "moderator", "admin", "owner"];
  let PERMS = null;
  const can = (role, perm) => { const i = ROLE_ORDER.indexOf(role); if (i < 0) return false; const P = PERMS || PERMS0; return ROLE_ORDER.slice(0, i + 1).some(r => (P[r] || []).includes(perm)); };
  const muteOn = () => !!(MOD.muted_until && new Date(MOD.muted_until) > new Date());

  /* ---------- CSS (sirf tab load hota hai jab Community khule) ---------- */
  const st = document.createElement("style"); st.id = "cm-css";
  st.textContent = `
.cm .cmtabs{display:flex;gap:6px;background:#fff;border-radius:14px;padding:5px;margin-bottom:12px;box-shadow:0 2px 10px rgba(20,40,80,.08)}
.cm .cmtabs button{flex:1;border:0;background:transparent;border-radius:10px;padding:10px 4px;font-weight:700;font-size:14px;color:var(--mute)}
.cm .cmtabs button.on{background:var(--main);color:#fff}
.cmc{display:block;width:100%;box-sizing:border-box;border:1.5px solid var(--line);border-radius:12px;padding:11px 12px;font:inherit;background:#fff;color:var(--ink)}
.cmc:focus{outline:0;border-color:var(--main)}textarea.cmc{resize:none}
.cm label.cml{display:block;font-weight:700;font-size:14px;margin:12px 0 6px}
.cmrow{display:flex;gap:8px;align-items:center}
.cmmini{border:0;background:transparent;color:var(--mute);font-weight:700;font-size:13px;padding:7px 9px;border-radius:8px}
.cmmini.on{color:#e11d48}.cmmini:disabled{opacity:.4}
.cmpost .cmph{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.cm .pfa{width:40px;height:40px;font-size:18px;flex:none}.cm .pfa.big{width:96px;height:96px;font-size:40px}
.cmau{border:0;background:none;padding:0;flex:none;border-radius:50%;color:inherit;font:inherit;text-align:left}
.cmwho{min-width:0;flex:1}.cmwho b{display:block;font-size:15px;overflow-wrap:anywhere}.cmwho small{color:var(--mute)}
.cmv{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;background:#1d9bf0;color:#fff;font-size:10px;margin-left:4px;vertical-align:1px}
.cmbody{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55;font-size:15px}
.cmbody a,.cmmsg a{color:var(--main);text-decoration:underline}
.cmimg{display:block;max-width:100%;max-height:360px;border-radius:12px;margin-top:8px;object-fit:cover}
.cmpdf{display:flex;gap:8px;align-items:center;border:1.5px solid var(--line);border-radius:12px;padding:10px;margin-top:8px;color:inherit;text-decoration:none}
.cmpdf span{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:600}.cmpdf small{color:var(--mute)}
.cmact{display:flex;gap:2px;margin-top:8px;border-top:1px solid var(--line);padding-top:6px;flex-wrap:wrap}
.cmhid{font-size:12px;color:var(--bad);font-weight:700;margin-bottom:4px}
.cmempty{text-align:center;color:var(--mute);padding:26px 10px;font-size:14px}
.cmg{display:flex;gap:12px;align-items:center;text-align:left;width:100%;border:0;background:#fff;border-radius:14px;padding:12px;margin-bottom:10px;box-shadow:0 2px 10px rgba(20,40,80,.08);color:var(--ink)}
.cmg .tx{min-width:0;flex:1}.cmg b{display:block;overflow-wrap:anywhere}.cmg small{display:block;color:var(--mute);overflow-wrap:anywhere}
.cmg .pfa{border-radius:14px}
.cmgb{flex:none;border:0;border-radius:10px;padding:8px 12px;font-weight:700;background:var(--main);color:#fff;font-size:13px}.cmgb.o{background:#eaf1ff;color:var(--main)}
.cmh{font-weight:800;font-size:15px;margin:14px 2px 8px}
.cmchat{display:flex;flex-direction:column;gap:8px;height:calc(100vh - 330px);min-height:240px;overflow-y:auto;padding:4px 2px 8px}
.cmbub{max-width:86%;align-self:flex-start;background:#fff;border-radius:14px 14px 14px 4px;padding:8px 10px;box-shadow:0 1px 4px rgba(20,40,80,.1)}
.cmbub.me{align-self:flex-end;background:var(--main);color:#fff;border-radius:14px 14px 4px 14px}
.cmbub.me a,.cmbub.me .cmpdf{color:#fff}.cmbub.me .cmt{color:#dbe8ff}.cmbub.me .cmpdf{border-color:rgba(255,255,255,.5)}
.cmbub .cmn{font-size:12px;font-weight:700;color:var(--main);margin-bottom:2px}
.cmbub .cmmsg{white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.45}
.cmbub .cmt{font-size:11px;color:var(--mute);margin-top:3px;text-align:right}
.cmbub .cmaa{display:none;gap:4px;margin-top:6px;flex-wrap:wrap}.cmbub.sel .cmaa{display:flex}
.cmaa button{border:0;border-radius:8px;padding:5px 9px;font-size:12px;font-weight:700;background:rgba(0,0,0,.1);color:inherit}
.cmbub.hid{opacity:.55}
.cmbar{display:flex;gap:6px;align-items:flex-end;position:sticky;bottom:0;background:var(--bg);padding:8px 0 4px}
.cmbar textarea{flex:1;max-height:110px}.cmbar .btn{flex:none;padding:11px 16px}
.cmnote{background:#fff7ed;color:#9a3412;border-radius:12px;padding:10px 12px;font-size:13.5px;margin-bottom:10px}
.cmchip{display:flex;align-items:center;gap:8px;background:#eaf1ff;color:var(--navy);border-radius:10px;padding:6px 10px;font-size:13px;margin-top:8px}.cmchip span{flex:1;min-width:0;overflow-wrap:anywhere}
.cmchip button{border:0;background:none;font-size:16px;color:inherit}
.cmmem{display:flex;gap:10px;align-items:center;width:100%;border:0;background:transparent;text-align:left;padding:8px 0;border-bottom:1px solid var(--line);color:var(--ink)}
.cmmem .tx{flex:1;min-width:0}.cmmem b{display:block;overflow-wrap:anywhere}.cmmem small{color:var(--mute)}
.cmrole{font-size:11px;font-weight:700;border-radius:8px;padding:2px 8px;background:#eaf1ff;color:var(--navy);flex:none}
.cmlink{word-break:break-all;background:#f1f5f9;border-radius:10px;padding:10px;font-size:13px;margin:8px 0;color:var(--ink)}
.cmdlg .card{width:100%;max-height:90vh;overflow-y:auto}.cmdlg .btn{flex:none}.cmdlg .cmcol{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.cmdlg h2{margin:0 0 6px}.cmdlg .cmc{margin-top:6px}
.cmtype{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cmtype button{border:2px solid var(--line);background:#fff;border-radius:12px;padding:10px 6px;font-weight:700;color:var(--ink);font-size:13.5px}.cmtype button.on{border-color:var(--main);background:#eaf1ff;color:var(--main)}
.dark .cm .cmtabs,.dark .cmbub,.dark .cmg{background:#19243a}.dark .cmc,.dark .cmtype button{background:#0f1726;color:#e6ebf5;border-color:#2b3956}
.dark .cmtype button.on,.dark .cmgb.o,.dark .cmchip,.dark .cmrole{background:#26324e;color:#cfe0ff}.dark .cmbub.me{background:var(--main)}.dark .cmlink{background:#0f1726}
.dark .cmnote{background:#3a2a17;color:#fdba74}
.dnupi{display:flex;align-items:center;gap:8px;background:#f1f5f9;border-radius:10px;padding:10px 12px;font-weight:700;word-break:break-all;margin:8px 0}.dnupi span{flex:1;min-width:0}
.dnamt{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.dnamt button{border:2px solid var(--line);background:#fff;border-radius:10px;padding:8px 14px;font-weight:700;color:var(--ink)}.dnamt button.on{border-color:var(--main);background:#eaf1ff;color:var(--main)}
a.dnpay{display:block;text-align:center;text-decoration:none;background:#16a34a;color:#fff;border-radius:12px;padding:12px;font-weight:800;margin-top:8px}a.dnpay.off{background:#94a3b8;pointer-events:none}
.dnqr{display:block;max-width:220px;width:100%;margin:8px auto;border-radius:12px}
.dnst{border-radius:12px;padding:10px 12px;font-size:14px;margin-bottom:10px;background:#eaf1ff;color:var(--navy)}.dnst.ok{background:#e7f8ec;color:#166534}.dnst.bad{background:#fdecec;color:#991b1b}
.dark .dnupi{background:#0f1726}.dark .dnamt button{background:#0f1726;color:#e6ebf5;border-color:#2b3956}.dark .dnamt button.on,.dark .dnst{background:#26324e;color:#cfe0ff}.dark .dnst.ok{background:#173a26;color:#86efac}.dark .dnst.bad{background:#4a1d1d;color:#fca5a5}`;
  document.head.appendChild(st);

  /* ---------- helpers ---------- */
  const uid = () => JKAuth.uid();
  const URLRE = /(https?:\/\/(?:(?!&quot;|&lt;|&gt;|&#39;)[^\s<])+)/g;
  const lnk = s => esc(s).replace(URLRE, u => { const c = u.replace(/[.,;:!?)\]]+$/, ""), t = u.slice(c.length); return '<a href="' + c + '" target="_blank" rel="noopener noreferrer nofollow">' + c + "</a>" + t; });
  function tm(ts) {
    const d = new Date(ts), m = Math.round((Date.now() - d.getTime()) / 6e4);
    if (m < 1) return "अभी"; if (m < 60) return m + " मिनट पहले"; if (m < 1440) return Math.round(m / 60) + " घंटे पहले";
    if (m < 43200) return Math.round(m / 1440) + " दिन पहले";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  const hm = ts => { const d = new Date(ts), t = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }); return d.toDateString() === new Date().toDateString() ? t : d.getDate() + "/" + (d.getMonth() + 1) + " " + t; };
  const vfy = a => a && a.verified ? '<span class="cmv" title="Verified">✔</span>' : "";
  const nm = a => esc((a && a.display_name) || "JAKHAR विद्यार्थी");
  const av = a => JKProfile.avatar(a || { display_name: "J", username: "x" });
  const gAv = g => JKProfile.avatar({ display_name: g.name, username: g.name, avatar_url: g.avatar_key ? UP.url(g.avatar_key) : null });
  const fsz = b => b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const UPCODES = ["UNCONFIGURED", "MIME", "EMPTY", "IMG", "TOOBIG", "DAILY_COUNT", "DAILY_BYTES", "STORE_FAILED"];
  function emsg(e) {
    const c = e && e.code;
    if (UPCODES.includes(c)) return UP.msg(e);
    return ({
      LOGIN: "दोबारा लॉगिन करें।", NET: "इंटरनेट नहीं है। फिर कोशिश करें।",
      DENIED: "आप यहाँ नहीं भेज सकते (सदस्य नहीं हैं, या म्यूट/बैन हैं)।",
      GROUP_LIMIT: "आप और ग्रुप नहीं बना सकते — सीमा पूरी हो गई।", BADCODE: "इनवाइट कोड सही नहीं है।", NOGROUP: "ग्रुप नहीं मिला।",
      BANNED: "आपको इस ग्रुप से बैन किया गया है।", FORBIDDEN: "इसकी अनुमति आपके पास नहीं है।", NOTMEMBER: "यह सदस्य अब ग्रुप में नहीं है।",
      DUP: "यह पहले ही हो चुका है।", INVALID: "जानकारी नियम के मुताबिक नहीं है। जाँचकर फिर कोशिश करें।", NOPROFILE: "पहले अपनी प्रोफ़ाइल खोलकर देखें।",
      BADFILE: "फ़ाइल सही नहीं है। दोबारा चुनें।", BADTYPE: "ग्रुप का प्रकार सही नहीं है।", SELF: "यह खुद पर नहीं हो सकता।",
      USER_BANNED: "आपका Community अकाउंट बैन है। गलती लगे तो ईमेल से संपर्क करें।", USER_MUTED: "आप कुछ समय के लिए म्यूट हैं, अभी कुछ भेज नहीं सकते।",
      BANNED_WORD: "इसमें ऐसे शब्द हैं जो Community नियमों के खिलाफ हैं। बदलकर फिर भेजें।",
      ALREADY: "आपकी प्रोफ़ाइल पर ब्लू टिक पहले से है।", MINAMOUNT: "ब्लू टिक के लिए कम से कम ₹5 का सहयोग ज़रूरी है।", NOTFOUND: "यह अब मौजूद नहीं है।"
    })[c] || "कुछ गड़बड़ हुई। थोड़ी देर बाद फिर कोशिश करें।";
  }
  async function sess() {
    try { await JKAuth.refresh(); } catch (e) {}
    let s = JKAuth.getSession(); if (!s) throw err("LOGIN");
    if (!s.uid) { await JKAuth.ensureUid(); s = JKAuth.getSession(); }
    if (!s || !s.uid) throw err("LOGIN");
    return s;
  }
  async function api(method, path, body, extra) {
    const s = await sess();
    const h = { apikey: KEY, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json" }; if (extra) Object.assign(h, extra);
    const ac = new AbortController(), tmo = setTimeout(() => ac.abort(), 15000); let r;
    try { r = await fetch(BASE + path, { method, headers: h, body: body == null ? undefined : JSON.stringify(body), signal: ac.signal }); }
    catch (e) { throw err("NET"); } finally { clearTimeout(tmo); }
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
    if (!r.ok) {
      const m = (j && (j.message || j.msg)) || "";
      const c = /^[A-Z_]{3,}$/.test(m) ? m : j && j.code === "23505" ? "DUP" : j && j.code === "23514" ? "INVALID" : j && j.code === "42501" ? "DENIED" : r.status === 401 ? "LOGIN" : "SERVER";
      throw err(c, { status: r.status, raw: j });
    }
    return j;
  }
  const rpc = (fn, b) => api("POST", "/rest/v1/rpc/" + fn, b || {});
  const one = r => Array.isArray(r) ? r[0] : r;
  const fail = e => { console.warn("community:", e); toast(emsg(e)); };
  /* Part 8: bhejne se pehle shabd-jaanch. 'ok' | 'flag' | 'block' (server trigger phir bhi apni jaanch karta hai) */
  async function modCheck(t) {
    if (!t || !t.trim()) return "ok";
    try { const r = await rpc("check_text", { p_text: t }); return r === "block" || r === "flag" ? r : "ok"; } catch (e) { return "ok"; }
  }
  const muteNote = () => '<div class="cmnote">आप ' + esc(hm(MOD.muted_until)) + ' तक म्यूट हैं, इसलिए अभी पोस्ट/मैसेज नहीं भेज सकते।</div>';

  function dlg(html, cls) {
    const d = document.createElement("div"); d.className = "mdl cmdlg";
    d.innerHTML = '<div class="card ' + (cls || "") + '">' + html + "</div>";
    d.addEventListener("click", e => { if (e.target === d) d.remove(); });
    document.body.appendChild(d); return d;
  }
  async function copyTxt(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
    try { const ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;opacity:0;top:0"; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok; } catch (e) { return false; }
  }
  function attHtml(o) {
    if (!o.file_key || !UP.configured()) return "";
    const u = esc(UP.url(o.file_key));
    if ((o.mime || "").indexOf("image/") === 0) return '<a href="' + u + '" target="_blank" rel="noopener"><img class="cmimg" loading="lazy" alt="" src="' + u + '"></a>';
    return '<a class="cmpdf" href="' + u + '" target="_blank" rel="noopener">📄<span class="pfx">' + esc(o.file_name || "PDF") + "</span><small>" + (o.file_size ? fsz(o.file_size) : "") + "</small></a>";
  }

  /* ---------- screen: loading / error ---------- */
  const TITLE = "Student Community";
  function shell(title, msg, retry) {
    view(hdr(BACK, "", title || TITLE) + '<main class="pg cm"><div class="card cmempty">' + msg + (retry ? '<br><br><button class="btn" id="cmRetry" style="width:100%">फिर कोशिश करें</button>' : "") + "</div></main>", "", false, seeMore);
    if (retry) $("cmRetry").onclick = retry;
  }

  /* ---------- entry ---------- */
  async function open() {
    shell(TITLE, "लोड हो रही है...");
    try { ME = await JKProfile.load(); } catch (e) { console.warn("community open:", e); ME = null; }
    if (!ME) return shell(TITLE, "Community अभी खुल नहीं पा रही। इंटरनेट जाँचकर फिर कोशिश करें।", open);
    SUPER = false; try { SUPER = (await rpc("is_admin")) === true; } catch (e) {}
    MOD = { banned: false, reason: "", muted_until: null }; try { MOD = (await rpc("community_state")) || MOD; } catch (e) {}
    try { const rp = await api("GET", "/rest/v1/role_permissions?select=role,perm"); if (rp && rp.length) { PERMS = {}; rp.forEach(x => (PERMS[x.role] = PERMS[x.role] || []).push(x.perm)); } } catch (e) {}
    if (MOD.banned && !SUPER) {
      const mail = (typeof CONTACT !== "undefined" && CONTACT.mail) || "";
      return shell(TITLE, "🚫 आपका Community अकाउंट बैन किया गया है।" + (MOD.reason ? "<br><small>कारण: " + esc(MOD.reason) + "</small>" : "") + (mail ? "<br><small>गलती लगे तो " + esc(mail) + " पर ईमेल करें।</small>" : ""));
    }
    hub(HUBTAB);
  }
  function hub(tab) {
    HUBTAB = tab || HUBTAB;
    view(hdr(BACK, '<button class="ib" id="cmNew" aria-label="नया ग्रुप" style="font-size:26px">＋</button>', TITLE) +
      '<main class="pg cm"><div class="cmtabs"><button data-t="feed" class="' + (HUBTAB === "feed" ? "on" : "") + '">📰 Feed</button><button data-t="groups" class="' + (HUBTAB === "groups" ? "on" : "") + '">👥 Groups</button></div><div id="cmBody"></div></main>', "", false, seeMore);
    $("cmNew").onclick = createGroup;
    document.querySelectorAll(".cmtabs button").forEach(b => { b.onclick = () => hub(b.dataset.t); });
    if (HUBTAB === "feed") feedView($("cmBody"), { gid: null, canPost: true, isMod: SUPER }); else groupsView($("cmBody"));
  }

  /* =========================== FEED (global + group posts) =========================== */
  function postHtml(p, o) {
    const mine = p.author_id === uid(), mod = o.isMod;
    return '<article class="card cmpost" data-id="' + p.id + '" data-au="' + p.author_id + '"><div class="cmph"><button class="cmau" data-u="' + p.author_id + '">' + av(p.author) + '</button>' +
      '<div class="cmwho"><b class="pfx">' + nm(p.author) + vfy(p.author) + '</b><small class="pfx">@' + esc((p.author && p.author.username) || "") + " · " + tm(p.created_at) + "</small></div></div>" +
      (p.is_hidden ? '<div class="cmhid">🙈 छुपाई गई पोस्ट' + (p.hidden_reason ? " — " + esc(p.hidden_reason) : "") + "</div>" : "") +
      (p.body ? '<div class="cmbody pfx">' + lnk(p.body) + "</div>" : "") + attHtml(p) +
      '<div class="cmact"><button class="cmmini' + (o.liked.has(p.id) ? " on" : "") + '" data-l="1">' + (o.liked.has(p.id) ? "♥" : "♡") + " <span>" + (p.like_count || 0) + "</span></button>" +
      '<button class="cmmini" data-rep="1">🚩 रिपोर्ट</button>' + (mine || mod ? '<button class="cmmini" data-del="1">🗑 हटाएँ</button>' : "") +
      (mod ? '<button class="cmmini" data-hide="' + (p.is_hidden ? 0 : 1) + '">' + (p.is_hidden ? "👁 दिखाएँ" : "🙈 छुपाएँ") + "</button>" : "") + "</div></article>";
  }
  function feedView(box, o) {
    o.liked = new Set(); const S = { before: null, done: false, busy: false, pend: null, io: null };
    const gm = muteOn();
    const comp = gm ? muteNote() : o.canPost === false ? (o.joinBar || "") :
      '<div class="card cmcomp"><div class="cmrow" style="align-items:flex-start">' + av(ME) + '<textarea id="cmTx" class="cmc" maxlength="2000" rows="2" placeholder="विद्यार्थियों के साथ कुछ साझा करें…"></textarea></div>' +
      '<div id="cmPend"></div><div class="cmrow" style="margin-top:8px;justify-content:space-between"><div class="cmrow"><button class="cmmini" id="cmPh">📷 फ़ोटो</button><button class="cmmini" id="cmPd">📄 PDF</button></div>' +
      '<button class="btn" id="cmPost" style="flex:none;padding:9px 18px">पोस्ट करें</button></div><div class="pfm" id="cmPm"></div>' +
      '<input type="file" id="cmFi" accept="image/*" hidden><input type="file" id="cmFd" accept="application/pdf,.pdf" hidden></div>';
    box.innerHTML = comp + '<div id="cmList"></div><div id="cmMore"></div>';
    const list = $("cmList"), more = $("cmMore");
    function pendUi() {
      const f = S.pend; $("cmPend").innerHTML = f ? '<div class="cmchip"><span>' + (f.type.indexOf("image/") === 0 ? "🖼 " : "📄 ") + esc(f.name) + " · " + fsz(f.size) + '</span><button id="cmPx" aria-label="हटाएँ">✕</button></div>' : "";
      if (f) $("cmPx").onclick = () => { S.pend = null; pendUi(); };
    }
    async function pick(file, pdf) {
      if (!file) return;
      const t = file.type || (pdf ? "application/pdf" : ""); S.pend = file; pendUi();
      if (t === "application/pdf" || pdf) { try { $("cmPm").textContent = UP.usageText(await UP.usage()); } catch (e) {} } else $("cmPm").textContent = "";
    }
    if (o.canPost !== false && !gm) {
      $("cmPh").onclick = () => $("cmFi").click(); $("cmPd").onclick = () => $("cmFd").click();
      $("cmFi").onchange = e => { pick(e.target.files[0], false); e.target.value = ""; };
      $("cmFd").onchange = e => { pick(e.target.files[0], true); e.target.value = ""; };
      $("cmPost").onclick = async () => {
        const btn = $("cmPost"), text = $("cmTx").value.trim(), pm = $("cmPm");
        if (!text && !S.pend) { pm.className = "pfm bad"; pm.textContent = "कुछ लिखें या फ़ोटो/PDF जोड़ें।"; return; }
        btn.disabled = true; pm.className = "pfm"; pm.textContent = "";
        try {
          const mc = await modCheck(text + " " + (S.pend ? S.pend.name : ""));
          if (mc === "block") throw err("BANNED_WORD");
          const body = { body: text }; if (o.gid) body.group_id = o.gid;
          if (S.pend) {
            const up = await UP.upload(S.pend, { onProgress: p => { btn.textContent = "अपलोड " + p + "%"; } });
            Object.assign(body, { file_key: up.key, file_name: up.name, file_size: up.size, mime: up.mime });
          }
          btn.textContent = "भेज रहे हैं…";
          const r = one(await api("POST", "/rest/v1/posts?select=" + POST_SEL, body, { Prefer: "return=representation" }));
          $("cmTx").value = ""; S.pend = null; pendUi(); pm.textContent = "";
          const empty = list.querySelector(".cmempty"); if (empty) empty.remove();
          if (mc === "flag") toast("पोस्ट समीक्षा के लिए भेजी गई — जाँच के बाद दिखेगी");
          else { list.insertAdjacentHTML("afterbegin", postHtml(r, o)); toast("पोस्ट हो गई ✅"); }
        } catch (e) { pm.className = "pfm bad"; pm.textContent = emsg(e); console.warn("post:", e); }
        btn.disabled = false; btn.textContent = "पोस्ट करें";
      };
    }
    async function loadMore() {
      if (S.busy || S.done) return; S.busy = true; more.innerHTML = '<div class="cmempty">लोड हो रहा है…</div>';
      try {
        const q = "/rest/v1/posts?select=" + POST_SEL + "&" + (o.gid ? "group_id=eq." + o.gid : "group_id=is.null") + (o.isMod ? "" : "&is_hidden=eq.false") +
          (S.before ? "&created_at=lt." + encodeURIComponent(S.before) : "") + "&order=created_at.desc&limit=" + PAGE;
        const rows = await api("GET", q) || [];
        if (rows.length) {
          const ids = rows.map(r => r.id).join(",");
          try { (await api("GET", "/rest/v1/post_likes?select=post_id&post_id=in.(" + ids + ")") || []).forEach(l => o.liked.add(l.post_id)); } catch (e) {}
          list.insertAdjacentHTML("beforeend", rows.map(r => postHtml(r, o)).join("")); S.before = rows[rows.length - 1].created_at;
        }
        if (rows.length < PAGE) S.done = true;
        if (!list.children.length) more.innerHTML = '<div class="cmempty">अभी कोई पोस्ट नहीं है।<br>पहली पोस्ट आप करें! ✍️</div>';
        else more.innerHTML = S.done ? '<div class="cmempty">— और पोस्ट नहीं हैं —</div>' : '<button class="btn ghost" id="cmLM" style="width:100%">और पोस्ट देखें</button>';
        if (!S.done && $("cmLM")) { $("cmLM").onclick = loadMore; if (window.IntersectionObserver) { if (S.io) S.io.disconnect(); S.io = new IntersectionObserver(en => { if (en[0].isIntersecting && document.body.contains(more)) loadMore(); }, { rootMargin: "300px" }); S.io.observe(more); } }
      } catch (e) { more.innerHTML = '<div class="cmempty">पोस्ट लोड नहीं हो पाईं।<br><br><button class="btn" id="cmLR" style="width:100%">फिर कोशिश करें</button></div>'; $("cmLR").onclick = loadMore; console.warn("feed:", e); }
      S.busy = false;
    }
    list.addEventListener("click", async e => {
      const card = e.target.closest(".cmpost"); if (!card) return; const id = card.dataset.id;
      const u = e.target.closest("[data-u]"); if (u) return showUser(u.dataset.u);
      const l = e.target.closest("[data-l]");
      if (l) {
        const on = l.classList.contains("on"), sp = l.querySelector("span"), n = +sp.textContent || 0;
        const setUi = v => { l.classList.toggle("on", v); l.firstChild.textContent = v ? "♥ " : "♡ "; sp.textContent = Math.max(0, n + (v ? 1 : 0) - (on ? 1 : 0)); if (v) o.liked.add(id); else o.liked.delete(id); };
        setUi(!on);
        try { if (!on) await api("POST", "/rest/v1/post_likes", { post_id: id }, { Prefer: "return=minimal" }); else await api("DELETE", "/rest/v1/post_likes?post_id=eq." + id + "&user_id=eq." + uid()); }
        catch (er) { if (!(er.code === "DUP" && !on)) { setUi(on); l.classList.toggle("on", on); sp.textContent = n; fail(er); } }
        return;
      }
      if (e.target.closest("[data-rep]")) return reportDlg("post", id);
      if (e.target.closest("[data-del]")) {
        if (!confirm("यह पोस्ट हटाएँ?")) return;
        try { await api("DELETE", "/rest/v1/posts?id=eq." + id); card.remove(); toast("पोस्ट हटा दी गई"); } catch (er) { fail(er); }
        return;
      }
      const h = e.target.closest("[data-hide]");
      if (h) {
        const hide = h.dataset.hide === "1";
        try { await rpc("set_hidden", { p_type: "post", p_id: id, p_hidden: hide, p_reason: hide ? "मॉडरेटर द्वारा छुपाया गया" : null }); toast(hide ? "पोस्ट छुपा दी गई" : "पोस्ट फिर दिखने लगी"); if (!hide || o.isMod) { feedView(box, o); } } catch (er) { fail(er); }
      }
    });
    loadMore();
  }

  /* =========================== GROUPS (list / search / join by code) =========================== */
  function gCard(g, mine) {
    return '<button class="cmg" data-g="' + g.id + '">' + gAv(g) + '<span class="tx"><b class="pfx">' + esc(g.name) + "</b><small>" + (g.type === "private" ? "🔒 प्राइवेट" : "🌐 पब्लिक") + " · " + (g.member_count || 0) + " सदस्य</small>" +
      (g.description ? '<small class="pfx">' + esc(g.description.slice(0, 80)) + "</small>" : "") + '</span><span class="cmgb' + (mine ? " o" : "") + '">' + (mine ? "खोलें" : "जुड़ें") + "</span></button>";
  }
  function codeOf(raw) { raw = String(raw || "").trim(); const m = /[?&]join=([0-9a-f]{8,40})/i.exec(raw) || /([0-9a-f]{12})\s*$/i.exec(raw); return m ? m[1].toLowerCase() : ""; }
  async function groupsView(box) {
    box.innerHTML = '<div class="card"><div class="cmrow"><input id="cmQ" class="cmc" placeholder="🔍 ग्रुप खोजें (नाम से)" maxlength="40"></div>' +
      '<div class="cmrow" style="margin-top:10px"><input id="cmCode" class="cmc" placeholder="इनवाइट कोड / लिंक" maxlength="200"><button class="btn" id="cmJoin" style="flex:none;padding:11px 16px">जुड़ें</button></div></div>' +
      '<div class="cmh">मेरे ग्रुप</div><div id="cmMine"><div class="cmempty">लोड हो रहा है…</div></div><div class="cmh">सार्वजनिक ग्रुप</div><div id="cmPub"><div class="cmempty">लोड हो रहा है…</div></div>';
    const mineIds = new Set();
    box.addEventListener("click", e => { const g = e.target.closest("[data-g]"); if (g) openGroup(g.dataset.g); });
    $("cmJoin").onclick = () => { const c = codeOf($("cmCode").value); if (!c) return toast("सही इनवाइट कोड या लिंक डालें"); handleJoin(c); };
    try {
      const m = await api("GET", "/rest/v1/group_members?user_id=eq." + uid() + "&banned=eq.false&select=role,group:groups(id,name,description,type,avatar_key,member_count,is_active)&order=joined_at.desc") || [];
      const gs = m.map(x => x.group).filter(Boolean); gs.forEach(g => mineIds.add(g.id));
      $("cmMine").innerHTML = gs.length ? gs.map(g => gCard(g, true)).join("") : '<div class="cmempty">आप अभी किसी ग्रुप में नहीं हैं।<br>नीचे से जुड़ें, या ऊपर ＋ से अपना ग्रुप बनाएँ।</div>';
    } catch (e) { $("cmMine").innerHTML = '<div class="cmempty">' + esc(emsg(e)) + "</div>"; }
    let tmr = null;
    async function pub(term) {
      const c = $("cmPub"); if (!c) return;
      try {
        const q = "/rest/v1/groups?type=eq.public&is_active=eq.true&select=id,name,description,type,avatar_key,member_count" + (term ? "&name=ilike.*" + encodeURIComponent(term) + "*" : "") + "&order=member_count.desc,created_at.desc&limit=30";
        const rows = await api("GET", q) || [];
        c.innerHTML = rows.length ? rows.map(g => gCard(g, mineIds.has(g.id))).join("") : '<div class="cmempty">' + (term ? "कोई ग्रुप नहीं मिला।" : "अभी कोई सार्वजनिक ग्रुप नहीं है।<br>पहला ग्रुप आप बनाएँ!") + "</div>";
      } catch (e) { c.innerHTML = '<div class="cmempty">' + esc(emsg(e)) + "</div>"; }
    }
    $("cmQ").oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => pub($("cmQ").value.replace(/[*,()%\\]/g, "").trim()), 400); };
    pub("");
  }

  /* =========================== CREATE GROUP =========================== */
  function createGroup() {
    view(hdr(BACK, "", "नया ग्रुप") + '<main class="pg cm"><div class="card"><div style="text-align:center"><div id="cmGAv"></div><button class="cmmini" id="cmGPick">📷 ग्रुप की फ़ोटो (वैकल्पिक)</button><input type="file" id="cmGF" accept="image/*" hidden></div>' +
      '<label class="cml" for="cmGN">ग्रुप का नाम</label><input id="cmGN" class="cmc pfx" maxlength="50" placeholder="जैसे: RAS 2026 तैयारी">' +
      '<label class="cml" for="cmGD">विवरण</label><textarea id="cmGD" class="cmc pfx" rows="3" maxlength="300" placeholder="ग्रुप किस बारे में है?"></textarea>' +
      '<label class="cml">ग्रुप का प्रकार</label><div class="cmtype"><button data-t="public" class="on">🌐 पब्लिक<br><small>कोई भी खोजकर जुड़ सकता है</small></button><button data-t="private">🔒 प्राइवेट<br><small>सिर्फ़ इनवाइट लिंक से</small></button></div>' +
      '<button class="btn" id="cmGGo" style="width:100%;margin-top:16px">ग्रुप बनाएँ</button><div class="pfm" id="cmGM"></div></div></main>', "", false, () => hub("groups"));
    let type = "public", file = null;
    const prev = () => { $("cmGAv").innerHTML = file ? '<div class="cmchip" style="justify-content:center"><span>🖼 ' + esc(file.name) + '</span><button id="cmGX">✕</button></div>' : JKProfile.avatar({ display_name: $("cmGN").value || "G", username: "g" }, 1); if (file) $("cmGX").onclick = () => { file = null; prev(); }; };
    prev(); $("cmGN").oninput = () => { if (!file) prev(); };
    $("cmGPick").onclick = () => $("cmGF").click(); $("cmGF").onchange = e => { file = e.target.files[0] || null; e.target.value = ""; prev(); };
    document.querySelectorAll(".cmtype button").forEach(b => { b.onclick = () => { type = b.dataset.t; document.querySelectorAll(".cmtype button").forEach(x => x.classList.toggle("on", x === b)); }; });
    $("cmGGo").onclick = async () => {
      const name = $("cmGN").value.replace(/\s+/g, " ").trim(), desc = $("cmGD").value.trim(), m = $("cmGM"), b = $("cmGGo");
      m.className = "pfm bad";
      if (Array.from(name).length < 3) { m.textContent = "ग्रुप का नाम कम से कम 3 अक्षर का हो।"; return; }
      b.disabled = true; m.className = "pfm"; m.textContent = "बन रहा है…";
      try {
        let key = null; if (file) key = (await UP.upload(file, { onProgress: p => { m.textContent = "फ़ोटो अपलोड " + p + "%"; } })).key;
        const g = one(await rpc("create_group", { p_name: name, p_desc: desc, p_type: type, p_avatar_key: key }));
        toast("ग्रुप बन गया 🎉"); openGroup(g.id, "info");
      } catch (e) { m.className = "pfm bad"; m.textContent = emsg(e); console.warn("create group:", e); b.disabled = false; }
    };
  }

  /* =========================== GROUP SCREEN =========================== */
  let CHSEQ = 0;
  async function openGroup(gid, tab) {
    CHSEQ++; shell(TITLE, "लोड हो रहा है...");
    let g, m;
    try {
      const r = await Promise.all([api("GET", "/rest/v1/groups?id=eq." + gid + "&select=*"), api("GET", "/rest/v1/group_members?group_id=eq." + gid + "&user_id=eq." + uid() + "&select=role,muted_until,banned")]);
      g = r[0] && r[0][0]; m = r[1] && r[1][0] || null;
    } catch (e) { return shell(TITLE, esc(emsg(e)), () => openGroup(gid, tab)); }
    if (!g) return shell(TITLE, "यह ग्रुप नहीं मिला।", () => hub("groups"));
    const G = { g, me: m && !m.banned ? m : null, banned: !!(m && m.banned) };
    G.mod = can(G.me && G.me.role, "hide_content") || SUPER;
    G.adm = can(G.me && G.me.role, "kick_member") || SUPER;
    G.own = !!(G.me && G.me.role === "owner") || SUPER;
    const tabs = G.me ? [["chat", "💬 चैट"], ["posts", "📰 पोस्ट"], ["info", "ℹ️ जानकारी"]] : [["posts", "📰 पोस्ट"], ["info", "ℹ️ जानकारी"]];
    let t = tabs.some(x => x[0] === tab) ? tab : tabs[0][0];
    function draw() {
      CHSEQ++;
      view(hdr(BACK, "", esc(g.name.length > 24 ? g.name.slice(0, 23) + "…" : g.name)) + '<main class="pg cm"><div class="cmtabs">' + tabs.map(x => '<button data-t="' + x[0] + '" class="' + (x[0] === t ? "on" : "") + '">' + x[1] + "</button>").join("") + '</div><div id="cmBody"></div></main>', "", false, () => hub("groups"));
      document.querySelectorAll(".cmtabs button").forEach(b => { b.onclick = () => { t = b.dataset.t; draw(); }; });
      const box = $("cmBody");
      if (G.banned) { box.innerHTML = '<div class="card cmempty">आपको इस ग्रुप से बैन किया गया है।</div>'; return; }
      if (t === "chat") chatView(box, G);
      else if (t === "posts") feedView(box, { gid: g.id, canPost: !!G.me && !(G.me.muted_until && new Date(G.me.muted_until) > new Date()), isMod: G.mod,
        joinBar: G.me ? '<div class="cmnote">आप म्यूट हैं, इसलिए अभी पोस्ट नहीं कर सकते।</div>' : '<div class="card cmempty">पोस्ट करने के लिए ग्रुप से जुड़ें।<br><br><button class="btn" id="cmJ2" style="width:100%">ग्रुप से जुड़ें</button></div>' });
      else infoView(box, G, draw);
      const j = $("cmJ2"); if (j) j.onclick = async () => { try { await rpc("join_group", { p_group: g.id, p_code: g.type === "private" ? g.invite_code : null }); toast("ग्रुप से जुड़ गए 🎉"); openGroup(g.id, "chat"); } catch (e) { fail(e); } };
    }
    draw();
  }

  /* ---------- group chat (polling) ---------- */
  function msgHtml(m, G) {
    const mine = m.author_id === uid();
    return '<div class="cmbub' + (mine ? " me" : "") + (m.is_hidden ? " hid" : "") + '" data-id="' + m.id + '">' +
      (mine ? "" : '<div class="cmn pfx"><button class="cmau" data-u="' + m.author_id + '">' + nm(m.author) + "</button>" + vfy(m.author) + "</div>") +
      (m.body ? '<div class="cmmsg pfx">' + lnk(m.body) + "</div>" : "") + attHtml(m) +
      '<div class="cmt">' + hm(m.created_at) + (m.is_hidden ? " · छुपाया गया" : "") + "</div>" +
      '<div class="cmaa"><button data-r="1">🚩 रिपोर्ट</button>' + (mine || G.mod ? '<button data-d="1">🗑 हटाएँ</button>' : "") + (G.mod ? '<button data-h="' + (m.is_hidden ? 0 : 1) + '">' + (m.is_hidden ? "👁 दिखाएँ" : "🙈 छुपाएँ") + "</button>" : "") + "</div></div>";
  }
  function chatView(box, G) {
    const my = ++CHSEQ, gid = G.g.id, mu = muteOn() ? MOD.muted_until : G.me.muted_until, muted = mu && new Date(mu) > new Date();
    box.innerHTML = '<div class="cmchat" id="cmChat"><div class="cmempty">लोड हो रहा है…</div></div>' +
      (muted ? '<div class="cmnote">आप म्यूट हैं (' + esc(hm(mu)) + " तक), इसलिए अभी मैसेज नहीं भेज सकते।</div>" :
        '<div id="cmPendC"></div><div class="cmbar"><button class="cmmini" id="cmAt" aria-label="फ़ाइल जोड़ें" style="font-size:20px">📎</button><textarea id="cmMt" class="cmc" rows="1" maxlength="2000" placeholder="मैसेज लिखें…"></textarea><button class="btn" id="cmSend">भेजें</button></div><div class="pfm" id="cmCm"></div><input type="file" id="cmCF" accept="image/*,application/pdf,.pdf" hidden>');
    const chat = $("cmChat"), ids = new Set(); let last = 0, oldest = 0, idle = 0, pend = null, lastRows = 0;
    const near = () => chat.scrollHeight - chat.scrollTop - chat.clientHeight < 140;
    const bottom = () => { chat.scrollTop = chat.scrollHeight; };
    const q = (extra) => "/rest/v1/messages?group_id=eq." + gid + "&select=" + MSG_SEL + (G.mod ? "" : "&is_hidden=eq.false") + extra;
    function add(rows, where) {
      const fresh = rows.filter(r => !ids.has(r.id)); if (!fresh.length) return 0;
      fresh.forEach(r => ids.add(r.id)); const html = fresh.map(r => msgHtml(r, G)).join("");
      if (where === "top") { const h0 = chat.scrollHeight; chat.insertAdjacentHTML("afterbegin", html); chat.scrollTop += chat.scrollHeight - h0; }
      else { const stick = near(); chat.insertAdjacentHTML("beforeend", html); if (stick) bottom(); }
      fresh.forEach(r => { last = Math.max(last, r.id); oldest = oldest ? Math.min(oldest, r.id) : r.id; });
      return fresh.length;
    }
    function olderBtn(show) { const o = $("cmOld"); if (o) o.remove(); if (show) chat.insertAdjacentHTML("afterbegin", '<button class="btn ghost" id="cmOld" style="flex:none;align-self:center;padding:7px 14px;font-size:13px">⬆ पुराने मैसेज</button>'); if (show) $("cmOld").onclick = older; }
    async function older() { try { const rows = (await api("GET", q("&id=lt." + oldest + "&order=id.desc&limit=" + MPAGE)) || []).reverse(); olderBtn(false); add(rows, "top"); olderBtn(rows.length >= MPAGE); } catch (e) { fail(e); } }
    (async () => {
      try {
        const rows = (await api("GET", q("&order=id.desc&limit=" + MPAGE)) || []).reverse(); chat.innerHTML = ""; lastRows = rows.length;
        if (!rows.length) chat.innerHTML = '<div class="cmempty" id="cmNone">अभी कोई मैसेज नहीं।<br>पहला मैसेज आप भेजें! 👋</div>'; else { add(rows); olderBtn(rows.length >= MPAGE); }
        bottom(); loop();
      } catch (e) { chat.innerHTML = '<div class="cmempty">चैट लोड नहीं हो पाई।<br><br><button class="btn" id="cmCR" style="width:100%">फिर कोशिश करें</button></div>'; $("cmCR").onclick = () => chatView(box, G); console.warn("chat:", e); }
    })();
    async function loop() {
      if (my !== CHSEQ || !$("cmChat")) return;
      if (!document.hidden) {
        try { const rows = await api("GET", q("&id=gt." + last + "&order=id.asc&limit=100")) || []; if (rows.length) { const n = $("cmNone"); if (n) n.remove(); add(rows); idle = 0; } else idle++; } catch (e) {}
      }
      setTimeout(loop, idle > 15 ? 10000 : 4000);
    }
    chat.addEventListener("click", async e => {
      const u = e.target.closest("[data-u]"); if (u) return showUser(u.dataset.u);
      if (e.target.closest("a")) return;
      const b = e.target.closest(".cmbub"); if (!b) return; const id = b.dataset.id;
      if (e.target.closest("[data-r]")) return reportDlg("message", id);
      if (e.target.closest("[data-d]")) { if (!confirm("यह मैसेज हटाएँ?")) return; try { await api("DELETE", "/rest/v1/messages?id=eq." + id); b.remove(); } catch (er) { fail(er); } return; }
      const h = e.target.closest("[data-h]");
      if (h) { const hide = h.dataset.h === "1"; try { await rpc("set_hidden", { p_type: "message", p_id: id, p_hidden: hide, p_reason: hide ? "मॉडरेटर द्वारा छुपाया गया" : null }); b.classList.toggle("hid", hide); h.dataset.h = hide ? 0 : 1; h.textContent = hide ? "👁 दिखाएँ" : "🙈 छुपाएँ"; } catch (er) { fail(er); } return; }
      document.querySelectorAll(".cmbub.sel").forEach(x => { if (x !== b) x.classList.remove("sel"); }); b.classList.toggle("sel");
    });
    if (muted) return;
    const pendUi = () => { $("cmPendC").innerHTML = pend ? '<div class="cmchip"><span>' + (pend.type.indexOf("image/") === 0 ? "🖼 " : "📄 ") + esc(pend.name) + " · " + fsz(pend.size) + '</span><button id="cmPX">✕</button></div>' : ""; if (pend) $("cmPX").onclick = () => { pend = null; pendUi(); }; };
    $("cmAt").onclick = () => $("cmCF").click();
    $("cmCF").onchange = async e => { pend = e.target.files[0] || null; e.target.value = ""; pendUi(); if (pend && (pend.type === "application/pdf" || /\.pdf$/i.test(pend.name))) { try { $("cmCm").textContent = UP.usageText(await UP.usage()); } catch (er) {} } };
    const mt = $("cmMt"); mt.oninput = () => { mt.style.height = "auto"; mt.style.height = Math.min(mt.scrollHeight, 110) + "px"; };
    $("cmSend").onclick = async () => {
      const text = mt.value.trim(), btn = $("cmSend"), cm = $("cmCm"); if (!text && !pend) return;
      btn.disabled = true; cm.className = "pfm"; cm.textContent = "";
      try {
        const mc = await modCheck(text + " " + (pend ? pend.name : ""));
        if (mc === "block") throw err("BANNED_WORD");
        const body = { group_id: gid, body: text };
        if (pend) { const up = await UP.upload(pend, { onProgress: p => { btn.textContent = p + "%"; } }); Object.assign(body, { file_key: up.key, file_name: up.name, file_size: up.size, mime: up.mime }); }
        const r = one(await api("POST", "/rest/v1/messages?select=" + MSG_SEL, body, { Prefer: "return=representation" }));
        mt.value = ""; mt.style.height = "auto"; pend = null; pendUi();
        if (mc === "flag") toast("मैसेज समीक्षा के लिए भेजा गया — जाँच के बाद दिखेगा");
        else { const n = $("cmNone"); if (n) n.remove(); add([r]); bottom(); idle = 0; }
      } catch (er) { cm.className = "pfm bad"; cm.textContent = emsg(er); console.warn("send:", er); }
      btn.disabled = false; btn.textContent = "भेजें";
    };
  }

  /* ---------- group info / members / invite ---------- */
  function infoView(box, G, redraw) {
    const g = G.g, link = location.origin + location.pathname + "?join=" + g.invite_code;
    box.innerHTML = '<div class="card" style="text-align:center">' + gAv(g).replace("pfa", "pfa big") + '<h2 class="pfx" style="margin:10px 0 2px">' + esc(g.name) + "</h2><small>" + (g.type === "private" ? "🔒 प्राइवेट" : "🌐 पब्लिक") + " · " + (g.member_count || 0) + " सदस्य</small>" +
      (g.description ? '<p class="pfx" style="white-space:pre-wrap;overflow-wrap:anywhere;text-align:left">' + esc(g.description) + "</p>" : "") + "</div>" +
      (G.me ? '<div class="card"><b>🔗 इनवाइट लिंक</b><div class="cmlink">' + esc(link) + '</div><div class="cmrow"><button class="btn ghost" id="cmCp">कॉपी करें</button><button class="btn" id="cmSh">शेयर करें</button></div>' +
        (G.adm ? '<div class="cmrow" style="margin-top:10px"><button class="btn ghost" id="cmRs" style="font-size:13px">🔄 नया कोड (पुराना लिंक बंद)</button><button class="btn ghost" id="cmEd" style="font-size:13px">✏️ ग्रुप एडिट</button></div>' : "") + "</div>" : "") +
      '<div class="card"><div class="cmh" style="margin-top:0">सदस्य</div><div id="cmMem"><div class="cmempty">लोड हो रहा है…</div></div></div>' +
      '<div class="card"><div class="cmrow" style="flex-wrap:wrap"><button class="btn ghost" id="cmRg" style="font-size:13px">🚩 ग्रुप रिपोर्ट करें</button>' +
      ((G.me && can(G.me.role, "view_reports")) || SUPER ? '<button class="btn ghost" id="cmGR" style="font-size:13px">🛡 ग्रुप की रिपोर्ट्स</button>' : "") +
      (G.me && G.me.role !== "owner" ? '<button class="btn ghost" id="cmLv" style="font-size:13px;color:var(--bad);border-color:var(--bad)">ग्रुप छोड़ें</button>' : "") +
      (G.own ? '<button class="btn ghost" id="cmDg" style="font-size:13px;color:var(--bad);border-color:var(--bad)">🗑 ग्रुप हटाएँ</button>' : "") + "</div>" +
      (!G.me ? '<button class="btn" id="cmJ3" style="width:100%;margin-top:10px">ग्रुप से जुड़ें</button>' : "") + "</div>";
    const on = (id, f) => { const e = $(id); if (e) e.onclick = f; };
    on("cmCp", async () => toast(await copyTxt(link) ? "लिंक कॉपी हो गया ✅" : "कॉपी नहीं हो पाया"));
    on("cmSh", async () => { if (navigator.share) { try { await navigator.share({ title: g.name, text: "JAKHAR ऐप में मेरे ग्रुप से जुड़ें: " + g.name, url: link }); } catch (e) {} } else toast(await copyTxt(link) ? "लिंक कॉपी हो गया ✅" : "शेयर उपलब्ध नहीं"); });
    on("cmRs", async () => { if (!confirm("नया कोड बनेगा; पुराना इनवाइट लिंक बंद हो जाएगा। ठीक है?")) return; try { await rpc("reset_invite", { p_group: g.id }); toast("नया कोड बन गया"); openGroup(g.id, "info"); } catch (e) { fail(e); } });
    on("cmEd", () => {
      const d = dlg('<h2>ग्रुप एडिट</h2><input id="cmEn" class="cmc pfx" maxlength="50" value="' + esc(g.name) + '"><textarea id="cmEd2" class="cmc pfx" rows="3" maxlength="300">' + esc(g.description) + '</textarea><div class="cmcol"><button class="btn" id="cmEs">सेव करें</button><button class="btn ghost" id="cmEc">रद्द करें</button></div><div class="pfm" id="cmEm"></div>');
      d.querySelector("#cmEc").onclick = () => d.remove();
      d.querySelector("#cmEs").onclick = async () => { try { await rpc("update_group", { p_group: g.id, p_name: d.querySelector("#cmEn").value, p_desc: d.querySelector("#cmEd2").value }); d.remove(); toast("सेव हो गया ✅"); openGroup(g.id, "info"); } catch (e) { d.querySelector("#cmEm").className = "pfm bad"; d.querySelector("#cmEm").textContent = emsg(e); } };
    });
    on("cmRg", () => reportDlg("group", g.id));
    on("cmGR", () => groupReports(g.id));
    on("cmLv", async () => { if (!confirm("क्या आप यह ग्रुप छोड़ना चाहते हैं?")) return; try { await api("DELETE", "/rest/v1/group_members?group_id=eq." + g.id + "&user_id=eq." + uid()); toast("ग्रुप छोड़ दिया"); hub("groups"); } catch (e) { fail(e); } });
    on("cmDg", async () => { if (!confirm("ग्रुप \"" + g.name + "\" और उसके सारे पोस्ट/चैट हमेशा के लिए हट जाएँगे। पक्का हटाएँ?")) return; try { await api("DELETE", "/rest/v1/groups?id=eq." + g.id); toast("ग्रुप हटा दिया गया"); hub("groups"); } catch (e) { fail(e); } });
    on("cmJ3", async () => { try { await rpc("join_group", { p_group: g.id, p_code: g.type === "private" ? g.invite_code : null }); toast("ग्रुप से जुड़ गए 🎉"); openGroup(g.id, "chat"); } catch (e) { fail(e); } });
    members(G);
  }
  const RANK = { owner: 4, admin: 3, moderator: 2, member: 1 }, RNAME = { owner: "👑 मालिक", admin: "एडमिन", moderator: "मॉडरेटर", member: "" };
  async function members(G) {
    const c = $("cmMem"); if (!c) return;
    try {
      const rows = await api("GET", "/rest/v1/group_members?group_id=eq." + G.g.id + "&select=user_id,role,muted_until,banned,user:profiles(" + AUTH + ")&order=joined_at.asc&limit=200") || [];
      rows.sort((a, b) => (RANK[b.role] || 0) - (RANK[a.role] || 0));
      c.innerHTML = rows.map(r => '<button class="cmmem" data-m="' + r.user_id + '">' + av(r.user) + '<span class="tx"><b class="pfx">' + nm(r.user) + vfy(r.user) + '</b><small class="pfx">@' + esc((r.user && r.user.username) || "") + (r.banned ? " · 🚫 बैन" : r.muted_until && new Date(r.muted_until) > new Date() ? " · 🔇 म्यूट" : "") + "</small></span>" + (RNAME[r.role] ? '<span class="cmrole">' + RNAME[r.role] + "</span>" : "") + "</button>").join("") || '<div class="cmempty">कोई सदस्य नहीं।</div>';
      c.onclick = e => { const b = e.target.closest("[data-m]"); if (!b) return; const r = rows.find(x => x.user_id === b.dataset.m); if (r) memberSheet(G, r); };
    } catch (e) { c.innerHTML = '<div class="cmempty">' + esc(emsg(e)) + "</div>"; }
  }
  function memberSheet(G, r) {
    const ra = SUPER ? 5 : RANK[(G.me || {}).role] || 0, rt = RANK[r.role] || 0, self = r.user_id === uid(), a = [];
    const muted = r.muted_until && new Date(r.muted_until) > new Date();
    if (!self && ra >= 2 && ra > rt) {
      a.push(muted ? ["unmute", "🔊 म्यूट हटाएँ"] : ["mute", "🔇 24 घंटे म्यूट"]); if (!muted) a.push(["mute7", "🔇 7 दिन म्यूट"]);
      a.push(["kick", "🚪 ग्रुप से हटाएँ"]);
      if (ra >= 3) { a.push(r.banned ? ["unban", "✅ बैन हटाएँ"] : ["ban", "🚫 बैन करें"]); if (r.role === "member") a.push(["make_mod", "🛡 मॉडरेटर बनाएँ"]); if (r.role === "moderator") a.push(["make_member", "⬇ सदस्य बनाएँ"]); }
      if (ra >= 4 && r.role !== "admin") a.push(["make_admin", "⭐ एडमिन बनाएँ"]);
    }
    const d = dlg('<div style="text-align:center">' + av(r.user).replace("pfa", "pfa big") + '<h2 class="pfx" style="margin:8px 0 0">' + nm(r.user) + vfy(r.user) + '</h2><small class="pfx">@' + esc((r.user && r.user.username) || "") + '</small></div><div class="cmcol"><button class="btn ghost" data-p="1">👤 प्रोफ़ाइल देखें</button>' +
      a.map(x => '<button class="btn ghost" data-a="' + x[0] + '">' + x[1] + "</button>").join("") + '<button class="btn" data-x="1">बंद करें</button></div>');
    d.onclick = async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.x) return d.remove(); if (b.dataset.p) { d.remove(); return showUser(r.user_id); }
      let act = b.dataset.a, until = null; if (act === "mute7") { act = "mute"; until = new Date(Date.now() + 7 * 864e5).toISOString(); }
      if ((act === "kick" || act === "ban") && !confirm("पक्का करें?")) return;
      try { await rpc("group_manage", { p_group: G.g.id, p_user: r.user_id, p_action: act, p_until: until }); d.remove(); toast("हो गया ✅"); members(G); } catch (er) { fail(er); }
    };
  }

  /* ---------- profile card / report / join ---------- */
  async function showUser(id) {
    const d = dlg('<div class="cmempty">लोड हो रहा है…</div>');
    try {
      const p = one(await api("GET", "/rest/v1/profiles?id=eq." + id + "&select=id,username,display_name,bio,exam,avatar_url,verified"));
      if (!p) { d.remove(); return toast("प्रोफ़ाइल नहीं मिली"); }
      d.querySelector(".card").innerHTML = '<div style="text-align:center">' + av(p).replace("pfa", "pfa big") + '<h2 class="pfx" style="margin:10px 0 0">' + nm(p) + vfy(p) + '</h2><div class="pfx" style="color:var(--main);font-weight:700">@' + esc(p.username) + "</div>" +
        (p.exam ? '<span class="pfchip pfx">' + esc(p.exam) + "</span>" : "") + (p.bio ? '<p class="pfx" style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:10px">' + esc(p.bio) + "</p>" : "") + '</div><div class="cmcol"><button class="btn" id="cmUx">बंद करें</button></div>';
      d.querySelector("#cmUx").onclick = () => d.remove();
    } catch (e) { d.remove(); fail(e); }
  }
  const REASONS = ["स्पैम / विज्ञापन", "गाली-गलौज / अभद्र भाषा", "फ़र्ज़ी या भ्रामक जानकारी", "निजी जानकारी साझा की गई", "अन्य"];
  function reportDlg(type, id) {
    const d = dlg("<h2>🚩 रिपोर्ट करें</h2><small>कारण चुनें — हमारी टीम जाँच करेगी।</small>" +
      '<select id="cmRr" class="cmc">' + REASONS.map(r => "<option>" + r + "</option>").join("") + '</select><textarea id="cmRt" class="cmc" rows="2" maxlength="200" placeholder="और कुछ बताना चाहें तो लिखें (वैकल्पिक)"></textarea>' +
      '<div class="cmcol"><button class="btn" id="cmRs2">रिपोर्ट भेजें</button><button class="btn ghost" id="cmRc">रद्द करें</button></div><div class="pfm" id="cmRm"></div>');
    d.querySelector("#cmRc").onclick = () => d.remove();
    d.querySelector("#cmRs2").onclick = async () => {
      const b = d.querySelector("#cmRs2"), why = d.querySelector("#cmRr").value, extra = d.querySelector("#cmRt").value.trim(); b.disabled = true;
      try { await api("POST", "/rest/v1/reports", { target_type: type, target_id: String(id), reason: (why + (extra ? " — " + extra : "")).slice(0, 300) }, { Prefer: "return=minimal" }); d.remove(); toast("रिपोर्ट भेज दी गई। धन्यवाद 🙏"); }
      catch (e) { const m = d.querySelector("#cmRm"); m.className = "pfm bad"; m.textContent = e.code === "DUP" ? "आप इसे पहले ही रिपोर्ट कर चुके हैं।" : emsg(e); b.disabled = false; }
    };
  }
  async function handleJoin(raw) {
    try { sessionStorage.removeItem("jk_join"); } catch (e) {}
    const code = codeOf(raw); if (!code) return toast("गलत इनवाइट कोड");
    try {
      if (!ME) ME = await JKProfile.load(); if (!ME) throw err("NET");
      const g = await rpc("group_by_code", { p_code: code });
      const d = dlg('<div style="text-align:center">' + gAv(g).replace("pfa", "pfa big") + '<h2 class="pfx" style="margin:10px 0 2px">' + esc(g.name) + "</h2><small>" + (g.type === "private" ? "🔒 प्राइवेट" : "🌐 पब्लिक") + " · " + (g.member_count || 0) + " सदस्य</small>" +
        (g.description ? '<p class="pfx" style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(g.description) + "</p>" : "") + '</div><div class="cmcol"><button class="btn" id="cmJy">इस ग्रुप से जुड़ें</button><button class="btn ghost" id="cmJn">अभी नहीं</button></div><div class="pfm" id="cmJm"></div>');
      d.querySelector("#cmJn").onclick = () => d.remove();
      d.querySelector("#cmJy").onclick = async () => { try { const r = await rpc("join_by_code", { p_code: code }); d.remove(); HUBTAB = "groups"; openGroup(r.group_id, "chat"); } catch (e) { const m = d.querySelector("#cmJm"); m.className = "pfm bad"; m.textContent = emsg(e); } };
    } catch (e) { fail(e); }
  }


  /* =========================== Part 8: group moderation queue =========================== */
  async function groupReports(gid) {
    const d = dlg('<h2>🛡 ग्रुप की रिपोर्ट्स</h2><small>रिपोर्ट हुई पोस्ट/मैसेज — छुपाएँ या खारिज करें।</small><div id="cmGRb" style="margin-top:8px"><div class="cmempty">लोड हो रहा है…</div></div><div class="cmcol"><button class="btn ghost" id="cmGRx">बंद करें</button></div>');
    d.querySelector("#cmGRx").onclick = () => d.remove();
    const body = d.querySelector("#cmGRb");
    async function load() {
      try {
        const rows = (await rpc("group_reports", { p_group: String(gid) })) || [];
        body.innerHTML = rows.length ? rows.map(r => { const c = r.c || {};
          return '<div class="card" style="margin:8px 0" data-t="' + esc(r.type) + '" data-g="' + esc(r.target) + '"><small>' + (r.type === "post" ? "📰 पोस्ट" : "💬 मैसेज") + " · " + (r.n || 1) + ' रिपोर्ट · <span class="pfx">@' + esc(c.author || "") + "</span>" + (c.hidden ? " · 🙈 छुपा हुआ" : "") + '</small>' +
            '<div class="cmbody pfx" style="margin-top:4px">' + (c.body ? lnk(c.body) : "<i>(सिर्फ़ फ़ाइल)</i>") + "</div>" + attHtml(c) + '<small class="pfx" style="display:block;margin-top:4px">' + esc(r.reasons || "") + "</small>" +
            '<div class="cmrow" style="margin-top:8px"><button class="btn" data-a="hide" style="flex:1;padding:8px">🙈 छुपाएँ</button><button class="btn ghost" data-a="dismiss" style="flex:1;padding:8px">खारिज</button></div></div>'; }).join("")
          : '<div class="cmempty">कोई नई रिपोर्ट नहीं 🎉</div>';
      } catch (e) { body.innerHTML = '<div class="cmempty">' + esc(emsg(e)) + "</div>"; }
    }
    body.onclick = async e => {
      const b = e.target.closest("[data-a]"); if (!b) return; const c = b.closest("[data-t]"); b.disabled = true;
      try { await rpc("group_resolve_report", { p_group: String(gid), p_type: c.dataset.t, p_target: c.dataset.g, p_action: b.dataset.a }); c.remove(); toast("हो गया ✅"); if (!body.querySelector("[data-t]")) load(); }
      catch (er) { b.disabled = false; fail(er); }
    };
    load();
  }

  /* =========================== Part 8: Donate Us + Blue Tick request ===========================
     UPI ID / naam index.html ke `DONATE` constant me hai (khaali = "jald hi"). QR chahiye to DONATE.qr me image ka URL do. */
  async function donate() {
    const D = (typeof DONATE !== "undefined" && DONATE) || {}, MINAMT = 5, logged = !!(window.JKAuth && JKAuth.isLoggedIn());
    const back = () => { if (typeof profile === "function") profile(); };
    const page = html => { view(hdr(BACK, "", "💝 Donate Us") + '<main class="pg cm">' + html + "</main>", "prof", false, back); };
    page('<div class="card cmempty">लोड हो रही है…</div>');
    let me = null, reqs = [];
    if (logged) {
      try { me = await JKProfile.load(); } catch (e) {}
      try { reqs = (await api("GET", "/rest/v1/verification_requests?select=*&order=created_at.desc&limit=3")) || []; } catch (e) {}
    }
    const pend = reqs.find(r => r.status === "pending"), last = reqs[0];
    let amt = 10;
    const upiLink = a => "upi://pay?pa=" + encodeURIComponent(D.upi) + "&pn=" + encodeURIComponent(D.name || "JAKHAR Classes") + "&am=" + encodeURIComponent(a) + "&cu=INR&tn=" + encodeURIComponent("JAKHAR Support");
    const stat = me && me.verified ? '<div class="dnst ok">✔ आपकी प्रोफ़ाइल पर ब्लू टिक है। सहयोग के लिए धन्यवाद 🙏</div>'
      : pend ? '<div class="dnst">⏳ आपका ब्लू टिक अनुरोध जाँच में है (₹' + esc(pend.amount) + " · ID " + esc(pend.txn_id) + "). स्वीकृति में कुछ समय लग सकता है।</div>"
      : last && last.status === "rejected" ? '<div class="dnst bad">❌ पिछला अनुरोध स्वीकार नहीं हुआ' + (last.admin_note ? ": " + esc(last.admin_note) : "") + "। सही जानकारी के साथ दोबारा भेज सकते हैं।</div>" : "";
    const payCard = '<div class="card"><b>💝 सहयोग करें</b><p style="margin:6px 0;color:var(--mute);font-size:14px">JAKHAR को मुफ़्त चलाए रखने में मदद करें। <b>कम से कम ₹' + MINAMT + '</b> — ज़्यादा की कोई सीमा नहीं (₹10, ₹50 या जो चाहें)।</p>' +
      (D.upi ? '<div class="dnupi"><span id="dnU">' + esc(D.upi) + '</span><button class="cmgb o" id="dnCp">कॉपी</button></div>' + (D.name ? '<small>नाम: <b class="pfx">' + esc(D.name) + "</b></small>" : "") +
        (D.qr ? '<img class="dnqr" alt="UPI QR" src="' + esc(D.qr) + '">' : "") +
        '<div class="dnamt" id="dnA">' + [5, 10, 20, 50, 100].map(v => '<button data-a="' + v + '"' + (v === amt ? ' class="on"' : "") + ">₹" + v + "</button>").join("") + '</div><input id="dnC" class="cmc" type="number" min="' + MINAMT + '" inputmode="numeric" placeholder="या अपनी राशि (₹)" value="">' +
        '<a class="dnpay" id="dnP" href="' + esc(upiLink(amt)) + '">📲 UPI ऐप से भुगतान करें</a><small style="display:block;margin-top:6px;color:var(--mute)">UPI ऐप न खुले तो ऊपर की UPI ID कॉपी करके खुद भुगतान करें।</small>'
        : '<div class="dnst">UPI ID जल्द ही यहाँ जोड़ी जाएगी। तब तक आप ब्लू टिक का अनुरोध नहीं भेज पाएँगे।</div>') + "</div>";
    const formCard = !logged ? '<div class="card cmempty">ब्लू टिक का अनुरोध भेजने के लिए पहले प्रोफ़ाइल में लॉगिन करें।</div>'
      : (me && me.verified) || pend ? "" : !D.upi ? "" :
      '<div class="card"><b>✔ ब्लू टिक का अनुरोध</b><p style="margin:6px 0;color:var(--mute);font-size:14px">भुगतान के बाद UPI ट्रांज़ैक्शन आईडी (UTR) और चाहें तो स्क्रीनशॉट भेजें। हम जाँचकर ब्लू टिक लगा देंगे।</p>' +
      '<label class="cml" for="dnAm">भुगतान की राशि (₹)</label><input id="dnAm" class="cmc" type="number" min="' + MINAMT + '" inputmode="numeric" value="' + amt + '">' +
      '<label class="cml" for="dnT">UPI ट्रांज़ैक्शन आईडी (UTR)</label><input id="dnT" class="cmc" maxlength="40" autocomplete="off" placeholder="जैसे 4xxxxxxxxxxx">' +
      '<label class="cml">पेमेंट का स्क्रीनशॉट (वैकल्पिक)</label><div class="cmrow"><button class="btn ghost" id="dnSb" style="flex:none;padding:9px 14px">📷 फ़ोटो चुनें</button><span id="dnSn" style="font-size:13px;color:var(--mute)"></span></div><input type="file" id="dnSf" accept="image/*" hidden>' +
      '<label class="cml" for="dnN">कुछ बताना हो तो (वैकल्पिक)</label><input id="dnN" class="cmc" maxlength="200">' +
      '<button class="btn" id="dnSend" style="width:100%;margin-top:12px">अनुरोध भेजें</button><div class="pfm" id="dnM"></div></div>';
    page(stat + payCard + formCard + '<div class="cmnote" style="margin-top:4px">ब्लू टिक कोई सरकारी/आधिकारिक पहचान नहीं है। भुगतान आपके अपने UPI ऐप से होता है; हम आपका UPI पिन या बैंक पासवर्ड कभी नहीं माँगते। विवरण: प्रोफ़ाइल → Privacy Policy (धारा 8)।</div>');
    const on = (id, f) => { const e = $(id); if (e) e.onclick = f; };
    on("dnCp", async () => toast(await copyTxt(D.upi) ? "UPI ID कॉपी हो गई ✅" : "कॉपी नहीं हो पाई"));
    const setAmt = v => { v = Math.max(0, Math.floor(+v || 0)); amt = v; const P = $("dnP"); if (P) { P.classList.toggle("off", v < MINAMT); P.href = v >= MINAMT ? upiLink(v) : "#"; } const F = $("dnAm"); if (F) F.value = v || ""; document.querySelectorAll("#dnA button").forEach(b => b.classList.toggle("on", +b.dataset.a === v)); };
    const A = $("dnA"); if (A) A.onclick = e => { const b = e.target.closest("[data-a]"); if (b) { setAmt(b.dataset.a); const c = $("dnC"); if (c) c.value = ""; } };
    const C = $("dnC"); if (C) C.oninput = () => setAmt(C.value);
    let shot = null;
    on("dnSb", () => $("dnSf").click());
    const sf = $("dnSf"); if (sf) sf.onchange = e => { shot = e.target.files[0] || null; e.target.value = ""; $("dnSn").textContent = shot ? shot.name : ""; };
    on("dnSend", async () => {
      const b = $("dnSend"), m = $("dnM"), amount = +$("dnAm").value, txn = $("dnT").value.trim();
      const bad = t => { m.className = "pfm bad"; m.textContent = t; };
      if (!(amount >= MINAMT)) return bad("राशि कम से कम ₹" + MINAMT + " होनी चाहिए।");
      if (txn.length < 6) return bad("सही UPI ट्रांज़ैक्शन आईडी (UTR) लिखें।");
      b.disabled = true; m.className = "pfm"; m.textContent = "";
      try {
        let key = null; if (shot) { const up = await UP.upload(shot, { onProgress: p => { b.textContent = "अपलोड " + p + "%"; } }); key = up.key; }
        b.textContent = "भेज रहे हैं…";
        await rpc("submit_verification", { p_amount: amount, p_txn: txn, p_shot: key, p_note: $("dnN").value.trim() || null });
        toast("अनुरोध भेज दिया गया ✅"); donate();
      } catch (e) { bad(e.code === "DUP" ? "यह ट्रांज़ैक्शन आईडी पहले इस्तेमाल हो चुकी है, या आपका एक अनुरोध पहले से जाँच में है।" : emsg(e)); b.disabled = false; b.textContent = "अनुरोध भेजें"; console.warn("verify:", e); }
    });
  }

  window.JKCom = { open, handleJoin, openGroup, donate };
})();
