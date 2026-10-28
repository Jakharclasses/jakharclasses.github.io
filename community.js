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
  /* Part 2: ek hi icon family (inline SVG, currentColor) */
  const ic = d => '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>";
  const IC = {
    feed: ic('<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>'),
    groups: ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.7a3.5 3.5 0 010 6.6M18 14.8c2 .6 3.2 2.4 3.5 5.2"/>'),
    plus: ic('<path d="M12 5v14M5 12h14"/>'),
    heart: ic('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z"/>'),
    flag: ic('<path d="M5 21V4m0 1h12l-2 4 2 4H5"/>'),
    trash: ic('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    eyeOff: ic('<path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0112 6c5 0 8.5 4 9.5 6-.5 1-1.5 2.4-3 3.6M6.5 7.6C4.5 9 3.2 10.9 2.5 12c1 2 4.5 6 9.5 6 1.3 0 2.5-.3 3.6-.8"/>'),
    eye: ic('<path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6z"/><circle cx="12" cy="12" r="2.8"/>'),
    home: ic('<path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z"/>'),
    bell: ic('<path d="M6 17V11a6 6 0 1112 0v6l1.5 2h-15zM10 21h4"/>'),
    user: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.200 2 8 6"/>'),
    search: ic('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
    share: ic('<path d="M21 4L3 11l7 3 3 7z"/><path d="M10 14l5-5"/>'),
    save: ic('<path d="M6 4h12v17l-6-4-6 4z"/>'),
    more: ic('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
    photo: ic('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.800"/><path d="M21 16l-5-5-8 8"/>'),
    pdf: ic('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 14h6M10 17h4"/>'),
    file: ic('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
    settings: ic('<circle cx="12" cy="12" r="3"/><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800"/>'),
    edit: ic('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    download: ic('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>'),
    upload: ic('<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>'),
    mic: ic('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),
    send: ic('<path d="M3 11l18-8-8 18-2-8z"/>'),
    emoji: ic('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.500 2.500 4 2.500S16 14 16 14M9 9.500v.5M15 9.500v.5"/>'),
    sun: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.500 1.500M17.500 17.500L19 19M5 19l1.500-1.500M17.500 6.500L19 5"/>'),
    moon: ic('<path d="M20 14.500A8 8 0 019.500 4 8 8 0 1020 14.500z"/>'),
    auto: ic('<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 010 18z" fill="currentColor"/>'),
    camera: ic('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.500"/>'),
    check: ic('<path d="M4 12l5 5L20 6"/>'),
    close: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
    poll: ic('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
    globe: ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
    chat: ic('<path d="M4 5h16v11H9l-5 4z"/>'),
    info: ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>')
  };
  let ME = null, SUPER = false, HUBTAB = "feed", GTAB = "mine";
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
    if ((o.mime || "").indexOf("image/") === 0) return '<a href="' + u + '" target="_blank" rel="noopener" data-fp="1" data-n="' + esc(o.file_name || "Image") + '" data-s="' + (o.file_size || 0) + '" data-m="image"><img class="cmimg" loading="lazy" alt="" src="' + u + '"></a>';
    return '<a class="cmpdf" href="' + u + '" target="_blank" rel="noopener" data-fp="1" data-n="' + esc(o.file_name || "PDF") + '" data-s="' + (o.file_size || 0) + '" data-m="pdf">' + IC.pdf + '<span class="pfx">' + esc(o.file_name || "PDF") + "</span><small>" + (o.file_size ? fsz(o.file_size) : "") + "</small></a>";
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
    const SOON = { notif: ["bell", "Notifications", "जल्द आ रहा है"] };
  /* ---- Settings: Language + Theme ---- */
  function settingsPanel() {
    const lg = JKLang.get() || "hi", th = JKTheme.mode();
    const pills = (k, cur, items) => '<div class="cmpills sm" data-k="' + k + '">' + items.map(i => '<button data-v="' + i[0] + '" class="' + (cur === i[0] ? "on" : "") + '">' + i[1] + "</button>").join("") + "</div>";
    return '<div class="cmset"><small>भाषा · Language</small>' + pills("lang", lg, [["hi", "हिन्दी"], ["en", "English"]]) + "<small>थीम · Theme</small>" + pills("theme", th, [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]]) + "</div>";
  }
  function settingsBind(root, after) {
    root.addEventListener("click", e => {
      const b = e.target.closest("[data-v]"); if (!b || !b.parentNode.dataset.k) return; const k = b.parentNode.dataset.k, v = b.dataset.v;
      if (k === "lang") { if (v === (JKLang.get() || "hi")) return; JKLang.set(v); location.reload(); return; }
      JKTheme.set(v); b.parentNode.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); if (after) after();
    });
  }
  function settingsSheet() {
    const el = document.createElement("div"); el.className = "cmsheet cmbot";
    el.innerHTML = '<div class="cmbk"></div><div class="cmbsh"><b>Settings</b>' + settingsPanel() + "</div>"; document.body.appendChild(el);
    settingsBind(el); el.addEventListener("click", e => { if (e.target.closest(".cmbk")) el.remove(); });
  }
  /* ---- Profile (own tab + other users). Tables `follows`, profiles.interests: Part 9 ---- */
  const cnt = async p => { try { return ((await api("GET", p)) || []).length; } catch (e) { return 0; } };
  async function profileBody(box, id, own) {
    box.innerHTML = '<div class="cmempty">लोड हो रहा है…</div>';
    let p; try { p = one(await api("GET", "/rest/v1/profiles?id=eq." + id + "&select=id,username,display_name,bio,exam,avatar_url,verified")); } catch (e) { box.innerHTML = '<div class="cmempty">' + esc(emsg(e)) + "</div>"; return; }
    if (!p) { box.innerHTML = '<div class="cmempty">प्रोफ़ाइल नहीं मिली</div>'; return; }
    const r = await Promise.all([cnt("/rest/v1/posts?select=id&author_id=eq." + id + "&is_hidden=eq.false&limit=1000"), cnt("/rest/v1/follows?select=follower_id&followee_id=eq." + id + "&limit=5000"), cnt("/rest/v1/follows?select=followee_id&follower_id=eq." + id + "&limit=5000"),
      own ? 0 : cnt("/rest/v1/follows?select=followee_id&follower_id=eq." + uid() + "&followee_id=eq." + id)]);
    let fol = !!r[3], fc = r[1];
    const chips = [p.exam].concat(Array.isArray(p.interests) ? p.interests : []).filter(Boolean).map(x => '<span class="pfchip pfx">' + esc(x) + "</span>").join(" ");
    const draw = () => {
      box.innerHTML = '<div class="cmprof">' + av(p).replace("pfa", "pfa big") + '<h2 class="pfx">' + nm(p) + vfy(p) + '</h2><div class="cmpun pfx">@' + esc(p.username || "") + "</div>" + (p.bio ? '<p class="pfx cmpbio">' + esc(p.bio.split("\n")[0]) + "</p>" : "") +
        '<div class="cmstats"><div><b>' + r[0] + "</b><small>Posts</small></div><div><b>" + fc + "</b><small>Followers</small></div><div><b>" + r[2] + "</b><small>Following</small></div></div>" +
        '<div class="cmrow">' + (own ? '<button class="btn" id="pfEd">' + IC.edit + " Edit Profile</button>" : '<button class="btn' + (fol ? " ghost" : "") + '" id="pfFo">' + (fol ? "Following" : IC.plus + " Follow") + '</button><button class="btn ghost" id="pfMs">' + IC.chat + " Message</button>") + "</div></div>" +
        '<div class="card"><b>About Me</b><p class="pfx" style="white-space:pre-wrap;overflow-wrap:anywhere;color:var(--mute)">' + (p.bio ? esc(p.bio) : "—") + "</p>" + (chips ? '<div class="cmchips">' + chips + "</div>" : "") + "</div>" +
        (own ? '<div class="card"><b>Settings</b>' + settingsPanel() + "</div>" : "");
      if (own) { $("pfEd").onclick = editProfile; settingsBind(box); return; }
      $("pfMs").onclick = () => dmView(id, { name: p.display_name || p.username, avatar_url: p.avatar_url });
      $("pfFo").onclick = async () => { const b = $("pfFo"); b.disabled = true;
        try { if (fol) await api("DELETE", "/rest/v1/follows?followee_id=eq." + id + "&follower_id=eq." + uid()); else await api("POST", "/rest/v1/follows", { followee_id: id }, { Prefer: "return=minimal" }); fol = !fol; fc += fol ? 1 : -1; draw(); } catch (e) { if (e.code === "DUP") { fol = true; draw(); } else { fail(e); b.disabled = false; } } };
    };
    const editProfile = () => {
      const d = dlg('<h2>Edit Profile</h2><label class="cml">Name</label><input id="epN" class="cmc pfx" maxlength="40" value="' + esc(p.display_name || "") + '"><label class="cml">Bio</label><textarea id="epB" class="cmc pfx" rows="3" maxlength="150">' + esc(p.bio || "") + '</textarea><label class="cml">Exam</label><input id="epX" class="cmc pfx" maxlength="30" value="' + esc(p.exam || "") + '"><div class="cmcol"><button class="btn" id="epS">Save</button><button class="btn ghost" id="epC">Cancel</button></div><div class="pfm" id="epM"></div>');
      d.querySelector("#epC").onclick = () => d.remove();
      d.querySelector("#epS").onclick = async () => { const b = d.querySelector("#epS"), v = { display_name: d.querySelector("#epN").value.trim(), bio: d.querySelector("#epB").value.trim(), exam: d.querySelector("#epX").value.trim() }; b.disabled = true;
        try { if ((await modCheck(v.display_name + " " + v.bio + " " + v.exam)) === "block") throw err("BANNED_WORD"); await api("PATCH", "/rest/v1/profiles?id=eq." + id, v, { Prefer: "return=minimal" }); Object.assign(p, v); if (ME) Object.assign(ME, v); d.remove(); toast("सेव हो गया ✅"); draw(); }
        catch (e) { const m = d.querySelector("#epM"); m.className = "pfm bad"; m.textContent = emsg(e); b.disabled = false; } };
    };
    draw();
  }
  function profileScreen(id) {
    if (id === uid()) return hub("profile");
    view('<header class="hd">' + BACK + '<div class="bt"><h1>Profile</h1></div></header><main class="pg cm"><div id="cmBody"></div></main>', "", false, () => hub(HUBTAB));
    profileBody($("cmBody"), id, false);
  }
  /* ---- Chats list (groups + personal) ---- */
  const chatTime = ts => { const d = new Date(ts), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" }); };
  async function chatsView(box) {
    let rows = [], f = "all", qs = "";
    box.innerHTML = '<div class="cmsearch">' + IC.search + '<input id="chQ" placeholder="Search conversations..."></div><div class="cmpills sm">' +
      [["all", "All"], ["dm", "Personal"], ["group", "Groups"]].map(x => '<button data-f="' + x[0] + '" class="' + (x[0] === "all" ? "on" : "") + '">' + x[1] + "</button>").join("") + '</div><div id="chL"><div class="cmempty">लोड हो रहा है…</div></div>';
    const draw = () => {
      const r = rows.filter(c => (f === "all" || c.kind === f) && (!qs || (c.name || "").toLowerCase().indexOf(qs) >= 0));
      $("chL").innerHTML = r.length ? r.map(c => '<button class="cmcr" data-k="' + c.kind + '" data-id="' + esc(c.id) + '"><span class="cmcrav">' + av({ display_name: c.name, avatar_url: c.avatar_url || (c.avatar_key ? UP.url(c.avatar_key) : null) }) + (c.online ? '<i class="cmon"></i>' : "") + '</span><span class="cmcrm"><b class="pfx">' + esc(c.name) + '</b><small class="pfx">' + esc(c.last_text || "") + '</small></span><span class="cmcrt"><small>' + (c.last_at ? chatTime(c.last_at) : "") + "</small>" + (c.unread ? '<span class="cmbadge">' + c.unread + "</span>" : "") + "</span></button>").join("") : '<div class="cmempty">अभी कोई मैसेज नहीं।</div>';
    };
    try { rows = (await rpc("my_chats")) || []; }
    catch (e) { try { rows = ((await api("GET", "/rest/v1/group_members?select=group:groups(id,name,avatar_key)&user_id=eq." + uid())) || []).filter(x => x.group).map(x => ({ kind: "group", id: x.group.id, name: x.group.name })); } catch (e2) { rows = []; } }
    draw();
    $("chQ").oninput = e => { qs = e.target.value.trim().toLowerCase(); draw(); };
    box.querySelectorAll(".cmpills button").forEach(b => { b.onclick = () => { f = b.dataset.f; box.querySelectorAll(".cmpills button").forEach(x => x.classList.toggle("on", x === b)); draw(); }; });
    $("chL").onclick = e => { const b = e.target.closest(".cmcr"); if (!b) return; if (b.dataset.k === "group") openGroup(b.dataset.id, "chat"); else dmView(b.dataset.id, rows.find(c => c.id === b.dataset.id)); };
  }
  /* ---- Personal (1-to-1) chat. Table `dm_messages`: Part 9 mein SQL ---- */
  async function dmView(peer, info) {
    info = info || {}; const me = uid(); let last = 0, timer = null; const seq = ++CHSEQ;
    const ticks = m => m.sender_id === me ? '<span class="cmtk' + (m.read_at ? " rd" : "") + '">' + IC.check.replace('class="ic"', 'class="ic" style="width:13px;height:13px;vertical-align:-2px"') + (m.read_at || true ? IC.check.replace('class="ic"', 'class="ic" style="width:13px;height:13px;vertical-align:-2px;margin-left:-8px"') : "") + "</span>" : "";
    view('<header class="hd">' + BACK + av({ display_name: info.name, avatar_url: info.avatar_url }) + '<div class="bt"><h1>' + esc(info.name || "Chat") + "</h1><small>" + (info.online ? "Online" : "Offline") + '</small></div></header><main class="pg cm cmdm"><div class="cmdml" id="dmL"></div></main>' +
      '<div class="cmdmbar"><button class="ib" id="dmP" aria-label="जोड़ें">' + IC.plus + '</button><input id="dmI" class="cmc" maxlength="1000" placeholder="Type a message..."><button class="ib" id="dmE" aria-label="Emoji">' + IC.emoji + '</button><button class="ib" id="dmS" aria-label="भेजें" style="background:var(--main);color:#fff;border:0">' + IC.send + "</button></div>", "", false, () => hub("chats"));
    const L = $("dmL"); let day = "";
    const dl = ts => { const d = new Date(ts), n = new Date(); return d.toDateString() === n.toDateString() ? "आज" : d.toDateString() === new Date(n - 864e5).toDateString() ? "कल" : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }); };
    const add = ms => { ms.forEach(m => { const k = new Date(m.created_at).toDateString(); if (k !== day) { day = k; L.insertAdjacentHTML("beforeend", '<div class="cmdate">' + dl(m.created_at) + "</div>"); }
      L.insertAdjacentHTML("beforeend", '<div class="cmbub' + (m.sender_id === me ? " me" : "") + '"><div class="pfx">' + lnk(m.body) + '</div><div class="cmt">' + chatTime(m.created_at) + ticks(m) + "</div></div>"); last = Math.max(last, +m.id || 0); }); if (ms.length) window.scrollTo(0, document.body.scrollHeight); };
    const flt = "&or=(and(sender_id.eq." + me + ",receiver_id.eq." + peer + "),and(sender_id.eq." + peer + ",receiver_id.eq." + me + "))";
    const pull = async () => { if (seq !== CHSEQ || !document.body.contains(L)) return clearInterval(timer); try { const rs = (await api("GET", "/rest/v1/dm_messages?select=*" + flt + "&order=id.asc&limit=100" + (last ? "&id=gt." + last : ""))) || []; add(rs); if (rs.some(m => m.sender_id === peer && !m.read_at)) rpc("dm_mark_read", { p_peer: peer }).catch(() => {}); } catch (e) {} };
    await pull(); if (!L.children.length) L.innerHTML = '<div class="cmempty">पहला मैसेज आप भेजें! 👋</div>';
    timer = setInterval(pull, 4000);
    const send = async () => { const t = $("dmI").value.trim(); if (!t) return; $("dmS").disabled = true;
      try { if ((await modCheck(t)) === "block") throw err("BANNED_WORD"); const e0 = L.querySelector(".cmempty"); if (e0) e0.remove();
        add([one(await api("POST", "/rest/v1/dm_messages?select=*", { receiver_id: peer, body: t }, { Prefer: "return=representation" }))]); $("dmI").value = ""; } catch (e) { fail(e); }
      $("dmS").disabled = false; };
    $("dmS").onclick = send; $("dmI").onkeydown = e => { if (e.key === "Enter") send(); };
    $("dmP").onclick = () => toast("जल्द आ रहा है");
    $("dmE").onclick = () => { const o = document.querySelector(".cmemo"); if (o) return o.remove(); const d = document.createElement("div"); d.className = "cmemo"; d.innerHTML = ["😀", "😂", "😍", "👍", "🙏", "🔥", "🎯", "📚", "💪", "🎉", "😅", "❤️"].map(x => "<button>" + x + "</button>").join(""); d.onclick = e => { const b = e.target.closest("button"); if (b) { $("dmI").value += b.textContent; $("dmI").focus(); } }; document.body.appendChild(d); };
  }
  /* ---- Search: Users / Groups / Posts / Files (sirf public cheezein) ---- */
  const RK = "jk_recent_search";
  const recents = () => { try { return JSON.parse(localStorage.getItem(RK) || "[]"); } catch (e) { return []; } };
  const saveRecent = q => { try { localStorage.setItem(RK, JSON.stringify([q].concat(recents().filter(x => x !== q)).slice(0, 8))); } catch (e) {} };
  function searchScreen() {
    view('<header class="hd">' + BACK + '<div class="bt"><h1>Search</h1></div></header><main class="pg cm"><div class="cmsearch">' + IC.search + '<input id="sQ" placeholder="Search users, groups, posts..." maxlength="40" autocomplete="off"></div><div class="cmpills sm" id="sT">' +
      [["users", "Users"], ["groups", "Groups"], ["posts", "Posts"], ["files", "Files"]].map((x, i) => '<button data-f="' + x[0] + '" class="' + (i ? "" : "on") + '">' + x[1] + "</button>").join("") + '</div><div id="sB"></div></main>', "", false, () => hub(HUBTAB));
    let f = "users", tmr = null; const mineIds = new Set(); let myLoaded = false;
    const body = $("sB"), clean = v => v.replace(/[*,()%\\]/g, "").trim(), empty = t => '<div class="cmempty">' + t + "</div>";
    const ago = ts => tm(ts);
    async function suggested() {
      try { if (!myLoaded) { myLoaded = true; ((await api("GET", "/rest/v1/group_members?select=group_id&user_id=eq." + uid())) || []).forEach(x => mineIds.add(x.group_id)); }
        const gs = ((await api("GET", "/rest/v1/groups?type=eq.public&is_active=eq.true&select=id,name,description,type,avatar_key,member_count&order=member_count.desc&limit=8")) || []).filter(g => !mineIds.has(g.id)).slice(0, 5);
        return gs.length ? '<div class="cmh" style="display:flex;justify-content:space-between;align-items:center">Suggested Groups <button class="cmrp" id="sSee">See All</button></div>' + gs.map(g => '<div class="cmcr cmsg"><button class="cmcr" data-g="' + g.id + '" style="border:0;flex:1;min-width:0"><span class="cmcrav">' + gAv(g) + '</span><span class="cmcrm"><b class="pfx">' + esc(g.name) + "</b><small>" + (g.member_count || 0) + " सदस्य · " + (g.type === "private" ? "🔒 प्राइवेट" : "🌐 पब्लिक") + '</small></span></button><button class="btn" data-j="' + g.id + '" style="flex:none;padding:7px 16px">जुड़ें</button></div>').join("") : "";
      } catch (e) { return ""; }
    }
    async function home() {
      const r = recents();
      body.innerHTML = (r.length ? '<div class="cmh" style="display:flex;justify-content:space-between;align-items:center">Recent Searches <button class="cmrp" id="sCl">Clear All</button></div>' + r.map(x => '<button class="cmcr" data-r="' + esc(x) + '"><span class="cmnti n-an" style="width:36px;height:36px">' + IC.search + '</span><span class="cmcrm"><b class="pfx">' + esc(x) + "</b></span></button>").join("") : "") + '<div id="sSg"></div>';
      const c = $("sCl"); if (c) c.onclick = () => { try { localStorage.removeItem(RK); } catch (e) {} home(); };
      const sg = await suggested(); const el = $("sSg"); if (el) { el.innerHTML = sg; const se = $("sSee"); if (se) se.onclick = () => { GTAB = "disc"; hub("groups"); }; }
    }
    async function run() {
      if (!$("sQ")) return; const q = clean($("sQ").value); if (!q) return home();
      body.innerHTML = empty("लोड हो रहा है…"); const my = q;
      try {
        let rows, html;
        if (f === "users") { rows = (await api("GET", "/rest/v1/profiles?select=id,username,display_name,avatar_url,verified,exam&or=(username.ilike.*" + encodeURIComponent(q) + "*,display_name.ilike.*" + encodeURIComponent(q) + "*)&limit=20")) || [];
          html = rows.map(u => '<button class="cmcr" data-u2="' + u.id + '"><span class="cmcrav">' + av(u) + '</span><span class="cmcrm"><b class="pfx">' + nm(u) + vfy(u) + '</b><small class="pfx">@' + esc(u.username || "") + (u.exam ? " · " + esc(u.exam) : "") + "</small></span></button>").join(""); }
        else if (f === "groups") { if (!myLoaded) { myLoaded = true; ((await api("GET", "/rest/v1/group_members?select=group_id&user_id=eq." + uid())) || []).forEach(x => mineIds.add(x.group_id)); }
          rows = (await api("GET", "/rest/v1/groups?type=eq.public&is_active=eq.true&name=ilike.*" + encodeURIComponent(q) + "*&select=id,name,description,type,avatar_key,member_count&order=member_count.desc&limit=20")) || []; html = rows.map(g => gCard(g, mineIds.has(g.id))).join(""); }
        else if (f === "posts") { rows = (await api("GET", "/rest/v1/posts?select=id,body,created_at,author:profiles(" + AUTH + ")&group_id=is.null&is_hidden=eq.false&body=ilike.*" + encodeURIComponent(q) + "*&order=created_at.desc&limit=20")) || [];
          html = rows.map(p => '<button class="cmcr" data-p2="' + p.id + '"><span class="cmcrav">' + av(p.author) + '</span><span class="cmcrm"><b class="pfx">' + nm(p.author) + '</b><small class="pfx">' + esc((p.body || "").slice(0, 90)) + '</small></span><span class="cmcrt"><small>' + ago(p.created_at) + "</small></span></button>").join(""); }
        else { rows = (await api("GET", "/rest/v1/posts?select=id,file_key,file_name,file_size,mime,created_at&group_id=is.null&is_hidden=eq.false&file_key=not.is.null&file_name=ilike.*" + encodeURIComponent(q) + "*&order=created_at.desc&limit=20")) || []; html = rows.map(r => attHtml(r)).join(""); }
        if (!$("sQ") || clean($("sQ").value) !== my) return;
        body.innerHTML = rows.length ? html : empty("कोई परिणाम नहीं मिला।");
      } catch (e) { body.innerHTML = empty(esc(emsg(e))); }
    }
    $("sQ").oninput = () => { clearTimeout(tmr); tmr = setTimeout(run, 350); };
    $("sQ").onkeydown = e => { if (e.key === "Enter") { const q = clean($("sQ").value); if (q) saveRecent(q); clearTimeout(tmr); run(); } };
    $("sT").onclick = e => { const b = e.target.closest("button"); if (!b) return; f = b.dataset.f; document.querySelectorAll("#sT button").forEach(x => x.classList.toggle("on", x === b)); run(); };
    body.onclick = async e => {
      if (e.target.closest("#sSee") || !$("sQ")) return;
      const q = clean($("sQ").value), rc = e.target.closest("[data-r]"); if (rc) { $("sQ").value = rc.dataset.r; return run(); }
      const j = e.target.closest("[data-j]"); if (j) { e.stopPropagation(); j.disabled = true; try { await rpc("join_group", { p_group: j.dataset.j, p_code: null }); j.outerHTML = '<span class="cmgb o">Joined</span>'; toast("ग्रुप से जुड़ गए 🎉"); } catch (er) { fail(er); j.disabled = false; } return; }
      const g = e.target.closest("[data-g]"); if (g) { if (q) saveRecent(q); return openGroup(g.dataset.g); }
      const u = e.target.closest("[data-u2]"); if (u) { if (q) saveRecent(q); return profileScreen(u.dataset.u2); }
      const p = e.target.closest("[data-p2]"); if (p) { if (q) saveRecent(q); return comments(p.dataset.p2, null); }
      const fp = e.target.closest("[data-fp]"); if (fp) { e.preventDefault(); filePreview({ url: fp.getAttribute("href"), name: fp.dataset.n, size: +fp.dataset.s, kind: fp.dataset.m }); }
    };
    home(); $("sQ").focus();
  }
  /* ---- Notifications (table `notifications` + triggers: Part 9) ---- */
  const NT = { like: ["heart", "n-like"], comment: ["chat", "n-cm"], mention: ["user", "n-mn"], follow: ["user", "n-fo"], group_msg: ["groups", "n-gr"], announce: ["bell", "n-an"] };
  const NSUF = { like: "ने आपकी पोस्ट लाइक की", comment: "ने आपकी पोस्ट पर कमेंट किया", mention: "ने आपको कमेंट में मेंशन किया", follow: "ने आपको फ़ॉलो करना शुरू किया" };
  function setBadge(n) {
    document.querySelectorAll(".cmnav button[data-t=notif] .cmdot, #cmBl .cmdot").forEach(e => e.remove());
    if (n > 0) document.querySelectorAll(".cmnav button[data-t=notif], #cmBl").forEach(b => b.insertAdjacentHTML("beforeend", '<i class="cmdot">' + (n > 9 ? "9+" : n) + "</i>"));
  }
  async function notifView(box) {
    let rows = [], tab = "all";
    const unread = () => rows.filter(r => !r.read_at).length;
    box.innerHTML = '<div class="cmnt0"><div class="cmpills sm" id="nT">' + [["all", "All"], ["unread", "Unread"], ["mention", "Mentions"]].map(x => '<button data-f="' + x[0] + '" class="' + (x[0] === "all" ? "on" : "") + '">' + x[1] + (x[0] === "unread" ? ' <span class="cmbadge" id="nU"></span>' : "") + "</button>").join("") + '</div><button class="cmmini" id="nAll" aria-label="सब पढ़ा हुआ करें" title="सब पढ़ा हुआ करें">' + IC.check + '</button></div><div id="nL"><div class="cmempty">लोड हो रहा है…</div></div>';
    const row = r => { const t = NT[r.type] || NT.announce, a = r.actor || {}, g = r.group || {};
      const head = r.type === "group_msg" ? '<b class="pfx">' + esc(g.name || "Group") + '</b><small class="pfx">' + esc(r.body || "नया मैसेज") + "</small>" : r.type === "announce" ? '<b class="pfx">' + esc(r.body || "") + "</b>" : '<span class="pfx"><b>' + nm(a) + "</b> " + NSUF[r.type] + "</span>";
      return '<button class="cmcr cmnt' + (r.read_at ? "" : " un") + '" data-id="' + r.id + '"><span class="cmnti ' + t[1] + '">' + IC[t[0]] + '</span><span class="cmcrm">' + head + "<small>" + tm(r.created_at) + '</small></span><i class="cmud"></i></button>'; };
    const draw = () => { const r = rows.filter(x => tab === "all" || (tab === "unread" ? !x.read_at : x.type === "mention")); $("nL").innerHTML = r.length ? r.map(row).join("") : '<div class="cmempty">कोई सूचना नहीं।</div>'; const n = unread(); $("nU").textContent = n || ""; $("nU").style.display = n ? "" : "none"; setBadge(n); };
    try { rows = (await api("GET", "/rest/v1/notifications?select=id,type,post_id,group_id,actor_id,body,created_at,read_at,actor:profiles!actor_id(" + AUTH + "),group:groups(name)&order=created_at.desc&limit=60")) || []; draw(); }
    catch (e) { $("nL").innerHTML = '<div class="cmempty">सूचनाएँ अभी उपलब्ध नहीं हैं।</div>'; return; }
    box.querySelectorAll("#nT button").forEach(b => { b.onclick = () => { tab = b.dataset.f; box.querySelectorAll("#nT button").forEach(x => x.classList.toggle("on", x === b)); draw(); }; });
    $("nAll").onclick = async () => { if (!unread()) return; try { await api("PATCH", "/rest/v1/notifications?read_at=is.null&user_id=eq." + uid(), { read_at: new Date().toISOString() }, { Prefer: "return=minimal" }); rows.forEach(r => { r.read_at = r.read_at || new Date().toISOString(); }); draw(); } catch (e) { fail(e); } };
    $("nL").onclick = async e => { const b = e.target.closest(".cmnt"); if (!b) return; const r = rows.find(x => String(x.id) === b.dataset.id); if (!r) return;
      if (!r.read_at) { r.read_at = new Date().toISOString(); api("PATCH", "/rest/v1/notifications?id=eq." + r.id, { read_at: r.read_at }, { Prefer: "return=minimal" }).catch(() => {}); setBadge(unread()); }
      if (r.type === "follow") return profileScreen(r.actor_id); if (r.type === "group_msg" || r.type === "announce") return r.group_id ? openGroup(r.group_id, "chat") : draw();
      if ((r.type === "comment" || r.type === "mention") && r.post_id) return comments(r.post_id, null); hub("feed"); };
  }
  function hub(tab) {
    HUBTAB = tab || HUBTAB;
    const T = { feed: "JAKHAR Community", chats: "Chats", groups: "Groups", notif: "Notifications", profile: "Profile" };
    const nav = [["feed", "home", "Feed"], ["chats", "chat", "Chats"], ["groups", "groups", "Groups"], ["notif", "bell", "Alerts"], ["profile", "user", "Profile"]];
    view('<header class="hd"><button class="logo" id="bk" aria-label="वापस">J</button><div class="bt"><h1>' + T[HUBTAB] + "</h1>" + (HUBTAB === "feed" ? "<small>Learn • Share • Grow</small>" : "") + '</div><div class="hr">' +
      '<button class="ib" id="cmSr" aria-label="Search">' + IC.search + "</button>" +
      (HUBTAB === "groups" ? '<button class="ib" id="cmNew" aria-label="नया ग्रुप">' + IC.plus + "</button>" : '<button class="ib" id="cmBl" aria-label="Notifications">' + IC.bell + "</button>") +
      '<button class="ib" id="cmTh" aria-label="Settings">' + IC.settings + "</button></div></header>" +
      '<main class="pg cm cmhub"><div id="cmBody"></div><nav class="cmtabs cmnav" aria-label="Community">' +
      nav.map(n => '<button data-t="' + n[0] + '" class="' + (HUBTAB === n[0] ? "on" : "") + '">' + IC[n[1]] + "<span>" + n[2] + "</span></button>").join("") + "</nav></main>", "", false, seeMore);
    if ($("cmNew")) $("cmNew").onclick = createGroup;
    if ($("cmBl")) $("cmBl").onclick = () => hub("notif");
    $("cmSr").onclick = searchScreen;
    $("cmTh").onclick = settingsSheet;
    document.querySelectorAll(".cmnav button").forEach(b => { b.onclick = () => hub(b.dataset.t); });
    if (HUBTAB === "feed") feedView($("cmBody"), { gid: null, canPost: true, isMod: SUPER });
    else if (HUBTAB === "groups") groupsView($("cmBody"));
    else if (HUBTAB === "chats") chatsView($("cmBody"));
    else if (HUBTAB === "profile") profileBody($("cmBody"), uid(), true);
    else if (HUBTAB === "notif") notifView($("cmBody"));
    else { const x = SOON[HUBTAB]; $("cmBody").innerHTML = '<div class="card cmsoon">' + IC[x[0]] + "<b>" + x[1] + "</b><span>" + x[2] + "</span></div>"; }
    if (HUBTAB !== "notif") cnt("/rest/v1/notifications?select=id&read_at=is.null&limit=100").then(setBadge);
  }

  /* =========================== FEED (global + group posts) =========================== */
  function pollHtml(p, o) {
    if (!p.poll || !p.poll.options) return ""; (o.polls = o.polls || {})[p.id] = p;
    const c = p.poll_counts || [], tot = c.reduce((a, b) => a + b, 0), my = p.my_vote;
    return '<div class="cmpoll">' + p.poll.options.map((t, i) => { const pc = tot ? Math.round((c[i] || 0) * 100 / tot) : 0;
      return '<button class="cmpo' + (my === i ? " on" : "") + '" data-pv="' + i + '">' + (my != null ? '<i style="width:' + pc + '%"></i>' : "") + '<span class="pfx">' + esc(t) + "</span>" + (my != null ? "<b>" + pc + "%</b>" : "") + "</button>"; }).join("") + "<small>" + tot + " votes</small></div>";
  }
  function postHtml(p, o) {
    const mine = p.author_id === uid(), mod = o.isMod;
    return '<article class="card cmpost" data-id="' + p.id + '" data-au="' + p.author_id + '"><div class="cmph"><button class="cmau" data-u="' + p.author_id + '">' + av(p.author) + '</button>' +
      '<div class="cmwho"><b class="pfx">' + nm(p.author) + vfy(p.author) + '</b><small class="pfx">@' + esc((p.author && p.author.username) || "") + " · " + tm(p.created_at) + " · " + (p.group_id ? "Group" : "Public") + "</small></div></div>" +
      (p.is_hidden ? '<div class="cmhid">🙈 छुपाई गई पोस्ट' + (p.hidden_reason ? " — " + esc(p.hidden_reason) : "") + "</div>" : "") +
      (p.body ? '<div class="cmbody pfx">' + lnk(p.body) + "</div>" : "") + attHtml(p) + pollHtml(p, o) +
      '<div class="cmact"><button class="cmmini' + (o.liked.has(p.id) ? " on" : "") + '" data-l="1" aria-label="लाइक">' + IC.heart + " <span>" + (p.like_count || 0) + "</span></button>" +
      '<button class="cmmini" data-c="1" aria-label="कमेंट">' + IC.chat + " <span>" + (p.comment_count || 0) + "</span></button>" +
      '<button class="cmmini" data-sh="1" aria-label="शेयर">' + IC.share + "</button>" +
      '<button class="cmmini sv' + (o.saved && o.saved.has(p.id) ? " on" : "") + '" data-sv="1" aria-label="सेव">' + IC.save + "</button>" +
      '<button class="cmmini" data-mo="1" aria-label="और">' + IC.more + "</button></div>" +
      '<div class="cmmenu" hidden><button class="cmmini" data-rep="1">' + IC.flag + " रिपोर्ट</button>" + (mine || mod ? '<button class="cmmini" data-del="1">' + IC.trash + " हटाएँ</button>" : "") +
      (mod ? '<button class="cmmini" data-hide="' + (p.is_hidden ? 0 : 1) + '">' + (p.is_hidden ? IC.eye + " दिखाएँ" : IC.eyeOff + " छुपाएँ") + "</button>" : "") + "</div></article>";
  }
  let FEEDMODE = "latest";
  /* ---- Create Post screen (full-screen sheet) ---- */
  function composer(o, auto, done) {
    const S = { pend: null, url: null }, el = document.createElement("div"); el.className = "cmsheet";
    el.innerHTML = '<header class="cmsh"><button class="ib" id="cpX" aria-label="बंद करें">' + IC.close + "</button><h2>Create Post</h2>" +
      '<button class="btn" id="cpPost">Post</button></header><div class="cmcpb"><div class="cmrow">' + av(ME) + '<div><b>' + nm(ME) + '</b><div class="cmpub">' + IC.globe + (o.gid ? " Group" : " Public") + "</div></div></div>" +
      '<textarea id="cpTx" class="cmc" maxlength="2000" rows="6" placeholder="What\'s on your mind?"></textarea><div id="cpPoll" class="cmpollc" hidden></div><div id="cpPend"></div><div class="pfm" id="cpPm"></div>' +
      '<div class="cmadd"><small>Add to your post</small><div class="cmqa"><button class="cmmini" id="cpPh">' + IC.photo + " Photo</button><button class=\"cmmini\" id=\"cpPd\">" + IC.pdf + " PDF</button><button class=\"cmmini\" id=\"cpCm\">" + IC.camera + " Camera</button><button class=\"cmmini\" id=\"cpPl\">" + IC.poll + " Poll</button></div></div>" +
      '<input type="file" id="cpFc" accept="image/*" capture="environment" hidden><input type="file" id="cpFi" accept="image/*" hidden><input type="file" id="cpFd" accept="application/pdf,.pdf" hidden></div>';
    document.body.appendChild(el); document.body.style.overflow = "hidden";
    const q = id => el.querySelector("#" + id), close = () => { if (S.url) URL.revokeObjectURL(S.url); el.remove(); document.body.style.overflow = ""; };
    function pendUi() {
      const f = S.pend; if (S.url) { URL.revokeObjectURL(S.url); S.url = null; }
      if (f && f.type.indexOf("image/") === 0) S.url = URL.createObjectURL(f);
      q("cpPend").innerHTML = f ? '<div class="cmthumb">' + (S.url ? '<img src="' + S.url + '" alt="">' : '<div class="cmchip"><span>' + IC.pdf + " " + esc(f.name) + " · " + fsz(f.size) + "</span></div>") + '<button class="ib" id="cpPx" aria-label="हटाएँ">' + IC.close + "</button></div>" : "";
      if (f) q("cpPx").onclick = () => { S.pend = null; pendUi(); };
    }
    async function pick(file, pdf) {
      if (!file) return; S.pend = file; pendUi();
      if (pdf || file.type === "application/pdf") { try { q("cpPm").textContent = UP.usageText(await UP.usage()); } catch (e) {} } else q("cpPm").textContent = "";
    }
    q("cpX").onclick = close; q("cpPh").onclick = () => q("cpFi").click(); q("cpPd").onclick = () => q("cpFd").click(); q("cpCm").onclick = () => q("cpFc").click(); q("cpFc").onchange = e => { pick(e.target.files[0], false); e.target.value = ""; };
    const pl = () => { const b = q("cpPoll"); if (!b.hidden) { b.hidden = true; b.innerHTML = ""; return; } b.hidden = false; b.innerHTML = '<b>Poll</b><button class="ib" id="cpPlX" aria-label="हटाएँ">' + IC.close + '</button><input class="cmc cpo" maxlength="60" placeholder="विकल्प 1"><input class="cmc cpo" maxlength="60" placeholder="विकल्प 2"><button class="cmmini" id="cpPlA">' + IC.plus + " विकल्प जोड़ें</button>"; q("cpPlX").onclick = pl; q("cpPlA").onclick = () => { const n = b.querySelectorAll(".cpo").length; if (n >= 4) return; q("cpPlA").insertAdjacentHTML("beforebegin", '<input class="cmc cpo" maxlength="60" placeholder="विकल्प ' + (n + 1) + '">'); }; };
    q("cpPl").onclick = pl;
    q("cpFi").onchange = e => { pick(e.target.files[0], false); e.target.value = ""; }; q("cpFd").onchange = e => { pick(e.target.files[0], true); e.target.value = ""; };
    q("cpPost").onclick = async () => {
      const btn = q("cpPost"), text = q("cpTx").value.trim(), pm = q("cpPm");
      const opts = [...el.querySelectorAll(".cpo")].map(i => i.value.trim()).filter(Boolean);
      if (!q("cpPoll").hidden && opts.length < 2) { pm.className = "pfm bad"; pm.textContent = "Poll के लिए कम से कम 2 विकल्प लिखें।"; return; }
      if (!text && !S.pend && !opts.length) { pm.className = "pfm bad"; pm.textContent = "कुछ लिखें या फ़ोटो/PDF जोड़ें।"; return; }
      btn.disabled = true; pm.className = "pfm"; pm.textContent = "";
      try {
        const mc = await modCheck(text + " " + opts.join(" ") + " " + (S.pend ? S.pend.name : ""));
        if (mc === "block") throw err("BANNED_WORD");
        const body = { body: text }; if (o.gid) body.group_id = o.gid; if (!q("cpPoll").hidden && opts.length >= 2) body.poll = { options: opts };
        if (S.pend) { const up = await UP.upload(S.pend, { onProgress: p => { btn.textContent = p + "%"; } }); Object.assign(body, { file_key: up.key, file_name: up.name, file_size: up.size, mime: up.mime }); }
        btn.textContent = "…";
        const r = one(await api("POST", "/rest/v1/posts?select=" + POST_SEL, body, { Prefer: "return=representation" }));
        close(); done(r, mc); return;
      } catch (e) { pm.className = "pfm bad"; pm.textContent = emsg(e); console.warn("post:", e); }
      btn.disabled = false; btn.textContent = "Post";
    };
    if (auto === "img") q("cpFi").click(); else if (auto === "pdf") q("cpFd").click(); else if (auto === "cam") q("cpFc").click(); else if (auto === "poll") pl(); else q("cpTx").focus();
  }
  /* ---- Comments sheet (table `comments`: Part 9 mein SQL) ---- */
  async function comments(pid, card) {
    const el = document.createElement("div"); el.className = "cmsheet cmsmall"; let rp = null;
    el.innerHTML = '<header class="cmsh"><button class="ib" id="ccX" aria-label="बंद करें">' + IC.close + "</button><h2>Comments</h2><span class=\"ib\"></span></header>" +
      '<div class="cmcpb" id="ccL"><div class="cmempty">लोड हो रहा है…</div></div><div id="ccR"></div><div class="cmbar cmcbar"><input id="ccI" class="cmc" maxlength="500" placeholder="कमेंट लिखें…"><button class="btn" id="ccS" aria-label="भेजें" style="flex:none">' + IC.send + "</button></div>";
    document.body.appendChild(el); document.body.style.overflow = "hidden";
    const q = id => el.querySelector("#" + id), close = () => { el.remove(); document.body.style.overflow = ""; };
    const row = (c, top) => '<div class="cmcm" data-cid="' + c.id + '"><div>' + av(c.author) + '</div><div class="cmcb"><b class="pfx">' + nm(c.author) + vfy(c.author) + "</b> <small>" + tm(c.created_at) + '</small><div class="pfx">' + lnk(c.body) + "</div>" +
      (top ? '<button class="cmrp" data-rp="' + c.id + '" data-n="' + esc(nm(c.author)) + '">Reply</button><div class="cmrep"></div>' : "") + "</div></div>";
    const setRp = r => { rp = r; q("ccR").innerHTML = r ? '<div class="cmchip" style="margin:0 14px"><span>↩ ' + esc(r.n) + ' को जवाब</span><button id="ccRx" aria-label="रद्द">' + IC.close + "</button></div>" : ""; q("ccI").placeholder = r ? "जवाब लिखें…" : "कमेंट लिखें…"; if (r) q("ccRx").onclick = () => setRp(null); };
    const put = c => { const L = q("ccL"); if (c.parent_id) { const par = L.querySelector('[data-cid="' + c.parent_id + '"] .cmrep'); if (par) { par.insertAdjacentHTML("beforeend", row(c, false)); return; } } L.insertAdjacentHTML("beforeend", row(c, !c.parent_id)); };
    q("ccX").onclick = close;
    q("ccL").onclick = e => { const b = e.target.closest("[data-rp]"); if (b) { setRp({ id: b.dataset.rp, n: b.dataset.n }); q("ccI").focus(); } };
    try { const rows = await api("GET", "/rest/v1/comments?select=" + POST_SEL + "&post_id=eq." + pid + "&order=created_at.asc&limit=200") || []; q("ccL").innerHTML = ""; if (!rows.length) q("ccL").innerHTML = '<div class="cmempty">अभी कोई कमेंट नहीं।<br>पहला कमेंट आप करें!</div>'; rows.forEach(put); }
    catch (e) { q("ccL").innerHTML = '<div class="cmempty">कमेंट अभी उपलब्ध नहीं हैं।</div>'; }
    q("ccS").onclick = async () => {
      const t = q("ccI").value.trim(); if (!t) return; q("ccS").disabled = true;
      try {
        if ((await modCheck(t)) === "block") throw err("BANNED_WORD");
        const body = { post_id: pid, body: t }; if (rp) body.parent_id = rp.id;
        const r = one(await api("POST", "/rest/v1/comments?select=" + POST_SEL, body, { Prefer: "return=representation" }));
        const L = q("ccL"), em = L.querySelector(".cmempty"); if (em) em.remove(); put(r); q("ccI").value = ""; setRp(null);
        const sp = card && card.querySelector("[data-c] span"); if (sp) sp.textContent = (+sp.textContent || 0) + 1;
      } catch (e) { fail(e); }
      q("ccS").disabled = false;
    };
  }
  /* ---- File Preview + Attachment options (bottom sheet) ---- */
  function filePreview(f) {
    const img = f.kind === "image", el = document.createElement("div"); el.className = "cmsheet cmsmall";
    el.innerHTML = '<header class="cmsh"><button class="ib" id="fpX" aria-label="बंद करें">' + IC.close + "</button><h2>File Preview</h2><span class=\"ib\"></span></header><div class=\"cmcpb\">" +
      '<div class="card cmfp"><span class="cmfpi">' + (img ? IC.photo : IC.pdf) + '</span><div class="pfx"><b>' + esc(f.name) + "</b><small>" + (f.size ? fsz(f.size) + " • " : "") + (img ? "Image" : "PDF") + "</small></div></div>" +
      (img ? '<div class="cmthumb"><img src="' + esc(f.url) + '" alt=""><button class="btn ghost" id="fpFs" style="position:absolute;right:8px;bottom:8px;padding:6px 12px">Full Screen</button></div>' : "") +
      '<div class="cmrow"><a class="btn" href="' + esc(f.url) + '" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">' + IC.file + ' Open</a><a class="btn ghost" href="' + esc(f.url) + '" download="' + esc(f.name) + '" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">' + IC.download + " Download</a></div></div>";
    document.body.appendChild(el); document.body.style.overflow = "hidden";
    const close = () => { el.remove(); document.body.style.overflow = ""; }; el.querySelector("#fpX").onclick = close;
    const fs = el.querySelector("#fpFs"); if (fs) fs.onclick = () => { const v = document.createElement("div"); v.className = "cmfs"; v.innerHTML = '<img src="' + esc(f.url) + '" alt="">'; v.onclick = () => v.remove(); document.body.appendChild(v); };
  }
  function attachSheet(o, done) {
    const el = document.createElement("div"); el.className = "cmsheet cmbot";
    const it = [["camera", "Camera", "cam"], ["photo", "Gallery", "img"], ["file", "Document", "pdf"], ["poll", "Poll", "poll"]];
    el.innerHTML = '<div class="cmbk"></div><div class="cmbsh"><b>Attachment Options</b><div class="cmab">' + it.map(x => '<button data-a="' + x[2] + '"><span>' + IC[x[0]] + "</span>" + x[1] + "</button>").join("") + "</div></div>";
    document.body.appendChild(el);
    el.onclick = e => { const b = e.target.closest("[data-a]"); if (!b && !e.target.closest(".cmbk")) return; el.remove(); if (b) composer(o, b.dataset.a, done); };
  }

  function feedView(box, o) {
    o.liked = new Set(); const S = { before: null, done: false, busy: false, pend: null, io: null };
    const gm = muteOn();
    o.saved = new Set(); const mode = o.gid ? "latest" : FEEDMODE;
    const comp = gm ? muteNote() : o.canPost === false ? (o.joinBar || "") :
      '<div class="card cmcomp"><div class="cmrow">' + av(ME) + '<button class="cmfake" id="cmOpen">Create Post…</button></div>' +
      '<div class="cmqa"><button class="cmmini" id="cmPh">' + IC.photo + " Photo</button><button class=\"cmmini\" id=\"cmPd\">" + IC.pdf + " PDF</button>" +
      '<button class="cmmini" id="cmPl">' + IC.poll + ' Poll</button><button class="cmmini" id="cmMo">' + IC.more + " More</button></div></div>";
    const modes = o.gid ? "" : '<div class="cmpills">' + [["latest", "Feed"], ["explore", "Explore"], ["following", "Following"]].map(m => '<button data-m="' + m[0] + '" class="' + (mode === m[0] ? "on" : "") + '">' + m[1] + "</button>").join("") + "</div>";
    box.innerHTML = modes + comp + '<div id="cmList"></div><div id="cmMore"></div>';
    box.querySelectorAll(".cmpills button").forEach(b => { b.onclick = () => { FEEDMODE = b.dataset.m; feedView(box, o); }; });
    const list = $("cmList"), more = $("cmMore");
    if (o.canPost !== false && !gm) {
      const done = (r, mc) => { const empty = list.querySelector(".cmempty"); if (empty) empty.remove(); if (mc === "flag") toast("पोस्ट समीक्षा के लिए भेजी गई — जाँच के बाद दिखेगी"); else { list.insertAdjacentHTML("afterbegin", postHtml(r, o)); toast("पोस्ट हो गई ✅"); } };
      $("cmOpen").onclick = () => composer(o, null, done); $("cmPh").onclick = () => composer(o, "img", done); $("cmPd").onclick = () => composer(o, "pdf", done);
      $("cmPl").onclick = () => composer(o, "poll", done); $("cmMo").onclick = () => attachSheet(o, done);
    }
    async function loadMore() {
      if (S.busy || S.done) return; S.busy = true; more.innerHTML = '<div class="cmempty">लोड हो रहा है…</div>';
      try {
        if (mode === "following") { if (!S.fl) { try { S.fl = ((await api("GET", "/rest/v1/follows?select=followee_id&follower_id=eq." + uid() + "&limit=500")) || []).map(x => x.followee_id); } catch (e) { S.fl = []; } }
          if (!S.fl.length) { S.done = true; more.innerHTML = '<div class="cmempty">आप अभी किसी को फ़ॉलो नहीं करते।</div>'; S.busy = false; return; } }
        const q = "/rest/v1/posts?select=" + POST_SEL + "&" + (o.gid ? "group_id=eq." + o.gid : "group_id=is.null") + (o.isMod ? "" : "&is_hidden=eq.false") +
          (mode === "following" ? "&author_id=in.(" + S.fl.join(",") + ")" : "") + (S.before && mode !== "explore" ? "&created_at=lt." + encodeURIComponent(S.before) : "") + "&order=" + (mode === "explore" ? "like_count.desc,created_at.desc" : "created_at.desc") + "&limit=" + PAGE;
        const rows = await api("GET", q) || [];
        if (rows.length) {
          const ids = rows.map(r => r.id).join(",");
          try { (await api("GET", "/rest/v1/post_likes?select=post_id&post_id=in.(" + ids + ")") || []).forEach(l => o.liked.add(l.post_id)); } catch (e) {}
          try { (await api("GET", "/rest/v1/post_saves?select=post_id&post_id=in.(" + ids + ")") || []).forEach(l => o.saved.add(l.post_id)); } catch (e) {}
          const pids = rows.filter(r => r.poll).map(r => r.id);
          if (pids.length) try { const mv = {}; (await api("GET", "/rest/v1/poll_votes?select=post_id,option_idx&post_id=in.(" + pids.join(",") + ")") || []).forEach(v => { mv[v.post_id] = v.option_idx; }); rows.forEach(r => { if (r.poll && mv[r.id] != null) r.my_vote = mv[r.id]; }); } catch (e) {}
          list.insertAdjacentHTML("beforeend", rows.map(r => postHtml(r, o)).join("")); S.before = rows[rows.length - 1].created_at;
        }
        if (rows.length < PAGE || mode === "explore") S.done = true;
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
        const setUi = v => { l.classList.toggle("on", v); sp.textContent = Math.max(0, n + (v ? 1 : 0) - (on ? 1 : 0)); if (v) o.liked.add(id); else o.liked.delete(id); };
        setUi(!on);
        try { if (!on) await api("POST", "/rest/v1/post_likes", { post_id: id }, { Prefer: "return=minimal" }); else await api("DELETE", "/rest/v1/post_likes?post_id=eq." + id + "&user_id=eq." + uid()); }
        catch (er) { if (!(er.code === "DUP" && !on)) { setUi(on); l.classList.toggle("on", on); sp.textContent = n; fail(er); } }
        return;
      }
      const pv = e.target.closest("[data-pv]");
      if (pv) { const p = o.polls && o.polls[id]; if (!p || p.my_vote != null) return; const i = +pv.dataset.pv;
        try { await api("POST", "/rest/v1/poll_votes", { post_id: id, option_idx: i }, { Prefer: "return=minimal" }); p.my_vote = i; p.poll_counts = (p.poll_counts || p.poll.options.map(() => 0)).slice(); p.poll_counts[i] = (p.poll_counts[i] || 0) + 1; card.querySelector(".cmpoll").outerHTML = pollHtml(p, o); } catch (er) { fail(er); } return; }
      const fp = e.target.closest("[data-fp]");
      if (fp) { e.preventDefault(); return filePreview({ url: fp.getAttribute("href"), name: fp.dataset.n, size: +fp.dataset.s, kind: fp.dataset.m }); }
      if (e.target.closest("[data-mo]")) { const m = card.querySelector(".cmmenu"); m.hidden = !m.hidden; return; }
      if (e.target.closest("[data-c]")) return comments(id, card);
      if (e.target.closest("[data-sh]")) { const url = location.origin + location.pathname + "#feed", tx = (card.querySelector(".cmbody") || {}).textContent || "JAKHAR Community"; try { if (navigator.share) await navigator.share({ title: "JAKHAR Community", text: tx.slice(0, 120), url }); else { await navigator.clipboard.writeText(url); toast("लिंक कॉपी हो गया"); } } catch (er) {} return; }
      const sv = e.target.closest("[data-sv]");
      if (sv) { const on = sv.classList.contains("on"); sv.classList.toggle("on", !on); try { if (!on) await api("POST", "/rest/v1/post_saves", { post_id: id }, { Prefer: "return=minimal" }); else await api("DELETE", "/rest/v1/post_saves?post_id=eq." + id + "&user_id=eq." + uid()); toast(on ? "सेव हटाया" : "सेव हो गया"); } catch (er) { if (!(er.code === "DUP" && !on)) { sv.classList.toggle("on", on); fail(er); } } return; }
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
    return '<button class="cmcr" data-g="' + g.id + '"><span class="cmcrav">' + gAv(g) + '</span><span class="cmcrm"><b class="pfx">' + esc(g.name) + "</b><small>" + (g.type === "private" ? "🔒 प्राइवेट" : "🌐 पब्लिक") + " · " + (g.member_count || 0) + " सदस्य</small>" +
      (g.description ? '<small class="pfx">' + esc(g.description.slice(0, 60)) + "</small>" : "") + '</span><span class="cmgb' + (mine ? " o" : "") + '">' + (mine ? "खोलें" : "जुड़ें") + "</span></button>";
  }
  function codeOf(raw) { raw = String(raw || "").trim(); const m = /[?&]join=([0-9a-f]{8,40})/i.exec(raw) || /([0-9a-f]{12})\s*$/i.exec(raw); return m ? m[1].toLowerCase() : ""; }
  async function groupsView(box) {
    let tab = GTAB, f = "all", qs = "", mine = [], tmr = null; GTAB = "mine"; const mineIds = new Set();
    box.innerHTML = '<div class="cmpills" id="gTabs"><button data-t="mine" class="' + (tab === "mine" ? "on" : "") + '">My Groups</button><button data-t="disc" class="' + (tab === "disc" ? "on" : "") + '">Discover</button></div><div class="cmsearch">' + IC.search + '<input id="cmQ" placeholder="Search groups..." maxlength="40"></div>' +
      '<div class="cmpills sm" id="gF">' + [["all", "All"], ["public", "Public"], ["private", "Private"]].map(x => '<button data-f="' + x[0] + '" class="' + (x[0] === "all" ? "on" : "") + '">' + x[1] + "</button>").join("") + '</div><div id="gL"><div class="cmempty">लोड हो रहा है…</div></div>' +
      '<div class="card" style="margin-top:14px"><div class="cmh" style="margin-top:0">इनवाइट कोड / लिंक</div><div class="cmrow"><input id="cmCode" class="cmc" placeholder="इनवाइट कोड / लिंक" maxlength="200"><button class="btn" id="cmJoin" style="flex:none;padding:11px 16px">जुड़ें</button></div></div>';
    box.addEventListener("click", e => { const g = e.target.closest("[data-g]"); if (g) openGroup(g.dataset.g); });
    $("cmJoin").onclick = () => { const c = codeOf($("cmCode").value); if (!c) return toast("सही इनवाइट कोड या लिंक डालें"); handleJoin(c); };
    const empty = t => '<div class="cmempty">' + t + "</div>";
    const drawMine = () => { const r = mine.filter(g => (f === "all" || g.type === f) && (!qs || g.name.toLowerCase().indexOf(qs) >= 0)); $("gL").innerHTML = r.length ? r.map(g => gCard(g, true)).join("") : empty(mine.length ? "कोई ग्रुप नहीं मिला।" : "आप अभी किसी ग्रुप में नहीं हैं।<br>Discover से जुड़ें, या ऊपर ＋ से अपना ग्रुप बनाएँ।"); };
    async function pub(term) {
      const c = $("gL"); if (!c || tab !== "disc") return;
      try {
        const q = "/rest/v1/groups?type=eq.public&is_active=eq.true&select=id,name,description,type,avatar_key,member_count" + (term ? "&name=ilike.*" + encodeURIComponent(term) + "*" : "") + "&order=member_count.desc,created_at.desc&limit=30";
        const rows = await api("GET", q) || [];
        c.innerHTML = rows.length ? rows.map(g => gCard(g, mineIds.has(g.id))).join("") : empty(term ? "कोई ग्रुप नहीं मिला।" : "अभी कोई सार्वजनिक ग्रुप नहीं है।<br>पहला ग्रुप आप बनाएँ!");
      } catch (e) { c.innerHTML = empty(esc(emsg(e))); }
    }
    const show = () => { $("gF").style.display = tab === "mine" ? "" : "none"; if (tab === "mine") drawMine(); else pub(qs); };
    try {
      const m = await api("GET", "/rest/v1/group_members?user_id=eq." + uid() + "&banned=eq.false&select=role,group:groups(id,name,description,type,avatar_key,member_count,is_active)&order=joined_at.desc") || [];
      mine = m.map(x => x.group).filter(Boolean); mine.forEach(g => mineIds.add(g.id)); show();
    } catch (e) { $("gL").innerHTML = empty(esc(emsg(e))); }
    box.querySelectorAll("#gTabs button").forEach(b => { b.onclick = () => { tab = b.dataset.t; box.querySelectorAll("#gTabs button").forEach(x => x.classList.toggle("on", x === b)); show(); }; });
    box.querySelectorAll("#gF button").forEach(b => { b.onclick = () => { f = b.dataset.f; box.querySelectorAll("#gF button").forEach(x => x.classList.toggle("on", x === b)); drawMine(); }; });
    $("cmQ").oninput = () => { qs = $("cmQ").value.replace(/[*,()%\\]/g, "").trim().toLowerCase(); if (tab === "mine") return drawMine(); clearTimeout(tmr); tmr = setTimeout(() => pub(qs), 400); };
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
    if (G.me && tab === "chat") rpc("group_mark_read", { p_group: gid }).catch(() => {});
    G.mod = can(G.me && G.me.role, "hide_content") || SUPER;
    G.adm = can(G.me && G.me.role, "kick_member") || SUPER;
    G.own = !!(G.me && G.me.role === "owner") || SUPER;
    const tabs = G.me ? [["chat", IC.chat + " चैट"], ["posts", IC.feed + " पोस्ट"], ["info", IC.info + " जानकारी"]] : [["posts", IC.feed + " पोस्ट"], ["info", IC.info + " जानकारी"]];
    let t = tabs.some(x => x[0] === tab) ? tab : tabs[0][0];
    function draw() {
      CHSEQ++;
      view((t === "chat" ? '<header class="hd">' + BACK + av({ display_name: g.name, avatar_url: g.avatar_url }) + '<div class="bt"><h1>' + esc(g.name) + "</h1><small>" + (g.member_count || 0) + " सदस्य</small></div></header>" : hdr(BACK, "", esc(g.name.length > 24 ? g.name.slice(0, 23) + "…" : g.name))) + '<main class="pg cm"><div class="cmtabs">' + tabs.map(x => '<button data-t="' + x[0] + '" class="' + (x[0] === t ? "on" : "") + '">' + x[1] + "</button>").join("") + '</div><div id="cmBody"></div></main>', "", false, () => hub("groups"));
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
  const dayLbl = ts => { const d = new Date(ts), n = new Date(); return d.toDateString() === n.toDateString() ? "आज" : d.toDateString() === new Date(n - 864e5).toDateString() ? "कल" : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }); };
  const TK = '<span class="cmtk">' + IC.check.replace('class="ic"', 'class="ic" style="width:13px;height:13px;vertical-align:-2px"') + IC.check.replace('class="ic"', 'class="ic" style="width:13px;height:13px;vertical-align:-2px;margin-left:-8px"') + "</span>";
  function emojiPop(inp, anchor) {
    const o = document.querySelector(".cmemo"); if (o) return o.remove();
    const d = document.createElement("div"); d.className = "cmemo"; if (anchor) d.style.bottom = (innerHeight - anchor.getBoundingClientRect().top + 4) + "px";
    d.innerHTML = ["😀", "😂", "😍", "👍", "🙏", "🔥", "🎯", "📚", "💪", "🎉", "😅", "❤️"].map(x => "<button>" + x + "</button>").join("");
    d.onclick = e => { const b = e.target.closest("button"); if (b) { inp.value += b.textContent; inp.focus(); } }; document.body.appendChild(d);
  }
  function msgHtml(m, G) {
    const mine = m.author_id === uid();
    if (m.kind === "system") return '<div class="cmsys" data-id="' + m.id + '" data-ts="' + m.created_at + '">' + esc(nm(m.author)) + " ग्रुप से जुड़े</div>";
    return '<div class="cmbub' + (mine ? " me" : "") + (m.is_hidden ? " hid" : "") + '" data-id="' + m.id + '" data-ts="' + m.created_at + '">' +
      (mine ? "" : '<div class="cmn pfx"><button class="cmau" data-u="' + m.author_id + '">' + nm(m.author) + "</button>" + vfy(m.author) + "</div>") +
      (m.body ? '<div class="cmmsg pfx">' + lnk(m.body) + "</div>" : "") + attHtml(m) +
      '<div class="cmt">' + hm(m.created_at) + (m.is_hidden ? " · छुपाया गया" : "") + (mine ? TK : "") + "</div>" +
      '<div class="cmaa"><button data-r="1">🚩 रिपोर्ट</button>' + (mine || G.mod ? '<button data-d="1">🗑 हटाएँ</button>' : "") + (G.mod ? '<button data-h="' + (m.is_hidden ? 0 : 1) + '">' + (m.is_hidden ? "👁 दिखाएँ" : "🙈 छुपाएँ") + "</button>" : "") + "</div></div>";
  }
  function chatView(box, G) {
    const my = ++CHSEQ, gid = G.g.id, mu = muteOn() ? MOD.muted_until : G.me.muted_until, muted = mu && new Date(mu) > new Date();
    box.innerHTML = '<div class="cmchat" id="cmChat"><div class="cmempty">लोड हो रहा है…</div></div>' +
      (muted ? '<div class="cmnote">आप म्यूट हैं (' + esc(hm(mu)) + " तक), इसलिए अभी मैसेज नहीं भेज सकते।</div>" :
        '<div id="cmPendC"></div><div class="cmbar"><button class="ib cmplus" id="cmAt" aria-label="फ़ाइल जोड़ें">' + IC.plus + '</button><textarea id="cmMt" class="cmc" rows="1" maxlength="2000" placeholder="मैसेज लिखें…"></textarea><button class="ib" id="cmEm" aria-label="Emoji">' + IC.emoji + '</button><button class="ib" id="cmMic" aria-label="Voice">' + IC.mic + '</button><button class="ib cmplus" id="cmSend" aria-label="भेजें">' + IC.send + '</button></div><div class="pfm" id="cmCm"></div><input type="file" id="cmCF" accept="image/*,application/pdf,.pdf" hidden>');
    const chat = $("cmChat"), ids = new Set(); let last = 0, oldest = 0, idle = 0, pend = null, lastRows = 0;
    const near = () => chat.scrollHeight - chat.scrollTop - chat.clientHeight < 140;
    const bottom = () => { chat.scrollTop = chat.scrollHeight; };
    const q = (extra) => "/rest/v1/messages?group_id=eq." + gid + "&select=" + MSG_SEL + (G.mod ? "" : "&is_hidden=eq.false") + extra;
    function add(rows, where) {
      const fresh = rows.filter(r => !ids.has(r.id)); if (!fresh.length) return 0;
      fresh.forEach(r => ids.add(r.id));
      let pd = where === "top" ? "" : (chat.dataset.day || ""); const sep = r => { const k = new Date(r.created_at).toDateString(); if (k === pd) return ""; pd = k; return '<div class="cmdate">' + dayLbl(r.created_at) + "</div>"; };
      const html = fresh.map(r => sep(r) + msgHtml(r, G)).join("");
      if (where !== "top") chat.dataset.day = pd;
      if (where === "top") { const f0 = chat.querySelector("[data-ts]"); if (f0 && new Date(f0.dataset.ts).toDateString() === pd) { const ps = f0.previousElementSibling; if (ps && ps.classList.contains("cmdate")) ps.remove(); } }
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
      const fp = e.target.closest("[data-fp]"); if (fp) { e.preventDefault(); return filePreview({ url: fp.getAttribute("href"), name: fp.dataset.n, size: +fp.dataset.s, kind: fp.dataset.m }); }
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
    $("cmAt").onclick = () => $("cmCF").click(); $("cmEm").onclick = () => emojiPop($("cmMt"), document.querySelector(".cmbar")); $("cmMic").onclick = () => toast("जल्द आ रहा है");
    $("cmCF").onchange = async e => { pend = e.target.files[0] || null; e.target.value = ""; pendUi(); if (pend && (pend.type === "application/pdf" || /\.pdf$/i.test(pend.name))) { try { $("cmCm").textContent = UP.usageText(await UP.usage()); } catch (er) {} } };
    const mt = $("cmMt"); mt.oninput = () => { mt.style.height = "auto"; mt.style.height = Math.min(mt.scrollHeight, 110) + "px"; };
    $("cmSend").onclick = async () => {
      const text = mt.value.trim(), btn = $("cmSend"), cm = $("cmCm"); if (!text && !pend) return; const eo = document.querySelector(".cmemo"); if (eo) eo.remove();
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
      btn.disabled = false; btn.innerHTML = IC.send;
    };
  }

  /* ---------- group info / members / invite ---------- */
  function infoView(box, G, redraw) {
    const g = G.g, link = location.origin + location.pathname + "?join=" + g.invite_code;
    const acts = [["chat", IC.chat, "Chat", !!G.me], ["add", IC.plus, "Add Members", !!G.me], ["find", IC.search, "Search", true], ["more", IC.more, "More", true]].filter(x => x[3]);
    box.innerHTML = '<div class="cmhero"><div class="cmban"></div><div class="cmhav">' + gAv(g).replace("pfa", "pfa big") + "</div></div>" +
      '<div class="cmhi"><div style="min-width:0"><h2 class="pfx" style="margin:0">' + esc(g.name) + "</h2><small>" + (g.type === "private" ? "🔒 प्राइवेट" : "🌐 पब्लिक") + " · " + (g.member_count || 0) + " सदस्य</small></div>" +
      (G.me ? '<button class="btn ghost" id="cmJd" disabled style="flex:none;padding:8px 14px">' + IC.check.replace('class="ic"', 'class="ic" style="width:16px;height:16px;vertical-align:-3px"') + " Joined</button>" : '<button class="btn" id="cmJ3" style="flex:none;padding:8px 18px">जुड़ें</button>') + "</div>" +
      (g.description ? '<p class="pfx cmdesc">' + esc(g.description) + "</p>" : "") +
      '<div class="cmacts">' + acts.map(x => '<button data-ga="' + x[0] + '"><span>' + x[1] + "</span>" + x[2] + "</button>").join("") + "</div>" +
      '<div class="cmsub" id="gSub">' + [["mem", "Members"], ["med", "Media"], ["fil", "Files"], ["inf", "Info"]].map((x, i) => '<button data-p="' + x[0] + '" class="' + (i ? "" : "on") + '">' + x[1] + "</button>").join("") + "</div>" +
      '<div id="pmem" class="gp"><div id="cmMem"><div class="cmempty">लोड हो रहा है…</div></div></div><div id="pmed" class="gp" hidden></div><div id="pfil" class="gp" hidden></div>' +
      '<div id="pinf" class="gp" hidden>' +
      (G.me ? '<div class="card"><b>' + IC.file.replace('class="ic"', 'class="ic" style="width:18px;height:18px;vertical-align:-4px"') + ' 🔗 इनवाइट लिंक</b><div class="cmlink">' + esc(link) + '</div><div class="cmrow"><button class="btn ghost" id="cmCp">कॉपी करें</button><button class="btn" id="cmSh">शेयर करें</button></div>' +
        (G.adm ? '<div class="cmrow" style="margin-top:10px"><button class="btn ghost" id="cmRs" style="font-size:13px">🔄 नया कोड (पुराना लिंक बंद)</button><button class="btn ghost" id="cmEd" style="font-size:13px">✏️ ग्रुप एडिट</button></div>' : "") + "</div>" : "") +
      '<div class="card"><div class="cmrow" style="flex-wrap:wrap"><button class="btn ghost" id="cmRg" style="font-size:13px">🚩 ग्रुप रिपोर्ट करें</button>' +
      ((G.me && can(G.me.role, "view_reports")) || SUPER ? '<button class="btn ghost" id="cmGR" style="font-size:13px">🛡 ग्रुप की रिपोर्ट्स</button>' : "") +
      (G.me && G.me.role !== "owner" ? '<button class="btn ghost" id="cmLv" style="font-size:13px;color:var(--bad);border-color:var(--bad)">ग्रुप छोड़ें</button>' : "") +
      (G.own ? '<button class="btn ghost" id="cmDg" style="font-size:13px;color:var(--bad);border-color:var(--bad)">🗑 ग्रुप हटाएँ</button>' : "") + "</div></div></div>";
    const pane = k => { box.querySelectorAll("#gSub button").forEach(x => x.classList.toggle("on", x.dataset.p === k)); ["mem", "med", "fil", "inf"].forEach(p => { $("p" + p).hidden = p !== k; }); if (k === "med" || k === "fil") gFiles(G, k); };
    box.querySelectorAll("#gSub button").forEach(b => { b.onclick = () => pane(b.dataset.p); });
    box.querySelectorAll("[data-ga]").forEach(b => { b.onclick = async () => { const k = b.dataset.ga;
      if (k === "chat") return openGroup(g.id, "chat"); if (k === "find") return groupSearch(G); if (k === "more") { pane("inf"); return $("pinf").scrollIntoView({ behavior: "smooth" }); }
      if (navigator.share) { try { await navigator.share({ title: g.name, text: "JAKHAR ऐप में मेरे ग्रुप से जुड़ें: " + g.name, url: link }); } catch (e) {} } else toast(await copyTxt(link) ? "लिंक कॉपी हो गया ✅" : "शेयर उपलब्ध नहीं"); }; });
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

  /* ---- Search inside a group: messages + posts of this group ---- */
  function groupSearch(G) {
    const g = G.g, el = document.createElement("div"); el.className = "cmsheet cmsmall";
    el.innerHTML = '<header class="cmsh"><button class="ib" id="gsX" aria-label="बंद करें">' + IC.close + "</button><h2>" + esc(g.name.length > 22 ? g.name.slice(0, 21) + "…" : g.name) + '</h2><span class="ib"></span></header><div class="cmcpb"><div class="cmsearch">' + IC.search + '<input id="gsQ" placeholder="Search in this group..." maxlength="40" autocomplete="off"></div><div class="cmpills sm" id="gsT"><button data-f="msg" class="on">Messages</button><button data-f="post">Posts</button></div><div id="gsB"></div></div>';
    document.body.appendChild(el); document.body.style.overflow = "hidden";
    const q = id => el.querySelector("#" + id), close = () => { el.remove(); document.body.style.overflow = ""; };
    let f = "msg", tmr = null; const clean = v => v.replace(/[*,()%\\]/g, "").trim(), empty = t => '<div class="cmempty">' + t + "</div>";
    q("gsX").onclick = close;
    async function run() {
      const t = clean(q("gsQ").value), box = q("gsB"); if (!t) { box.innerHTML = empty("किसी शब्द से खोजें।"); return; }
      box.innerHTML = empty("लोड हो रहा है…");
      try {
        const hid = G.mod ? "" : "&is_hidden=eq.false", enc = encodeURIComponent(t);
        const rows = f === "msg" ? (await api("GET", "/rest/v1/messages?group_id=eq." + g.id + "&select=" + MSG_SEL + hid + "&body=ilike.*" + enc + "*&order=id.desc&limit=30")) || []
          : (await api("GET", "/rest/v1/posts?group_id=eq." + g.id + "&select=" + POST_SEL + hid + "&body=ilike.*" + enc + "*&order=created_at.desc&limit=30")) || [];
        if (clean(q("gsQ").value) !== t) return;
        box.innerHTML = rows.length ? rows.map(r => '<button class="cmcr" data-k="' + (f === "msg" ? "chat" : "posts") + '"><span class="cmcrav">' + av(r.author) + '</span><span class="cmcrm"><b class="pfx">' + nm(r.author) + '</b><small class="pfx">' + esc((r.body || "").slice(0, 90)) + '</small></span><span class="cmcrt"><small>' + tm(r.created_at) + "</small></span></button>").join("") : empty("कोई परिणाम नहीं मिला।");
      } catch (e) { box.innerHTML = empty(esc(emsg(e))); }
    }
    q("gsQ").oninput = () => { clearTimeout(tmr); tmr = setTimeout(run, 350); };
    q("gsT").onclick = e => { const b = e.target.closest("button"); if (!b) return; f = b.dataset.f; q("gsT").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); run(); };
    q("gsB").onclick = e => { const b = e.target.closest("[data-k]"); if (!b) return; close(); openGroup(g.id, b.dataset.k); };
    run(); q("gsQ").focus();
  }
  async function gFiles(G, k) {
    const c = $(k === "med" ? "pmed" : "pfil"); if (!c || c.dataset.l) return; c.dataset.l = "1"; c.innerHTML = '<div class="cmempty">लोड हो रहा है…</div>';
    try {
      const mime = k === "med" ? "like.image/*" : "eq.application/pdf";
      const rows = await api("GET", "/rest/v1/messages?group_id=eq." + G.g.id + "&mime=" + mime + "&select=id,file_key,file_name,file_size,mime,created_at&order=id.desc&limit=60") || [];
      c.innerHTML = !rows.length ? '<div class="cmempty">' + (k === "med" ? "No media yet." : "No files yet.") + "</div>" :
        k === "med" ? '<div class="cmgrid">' + rows.map(r => attHtml(r)).join("") + "</div>" : rows.map(r => attHtml(r)).join("");
      c.onclick = e => { const fp = e.target.closest("[data-fp]"); if (fp) { e.preventDefault(); filePreview({ url: fp.getAttribute("href"), name: fp.dataset.n, size: +fp.dataset.s, kind: fp.dataset.m }); } };
    } catch (e) { c.dataset.l = ""; c.innerHTML = '<div class="cmempty">' + esc(emsg(e)) + "</div>"; }
  }
  const RANK = { owner: 4, admin: 3, moderator: 2, member: 1 }, RNAME = { owner: "👑 मालिक", admin: "एडमिन", moderator: "मॉडरेटर", member: "Member" };
  async function members(G) {
    const c = $("cmMem"); if (!c) return;
    try {
      const rows = await api("GET", "/rest/v1/group_members?group_id=eq." + G.g.id + "&select=user_id,role,muted_until,banned,user:profiles(" + AUTH + ")&order=joined_at.asc&limit=200") || [];
      rows.sort((a, b) => (RANK[b.role] || 0) - (RANK[a.role] || 0));
      c.innerHTML = rows.map(r => '<button class="cmmem" data-m="' + r.user_id + '">' + av(r.user) + '<span class="tx"><b class="pfx">' + nm(r.user) + vfy(r.user) + '</b><small class="pfx">@' + esc((r.user && r.user.username) || "") + (r.banned ? " · 🚫 बैन" : r.muted_until && new Date(r.muted_until) > new Date() ? " · 🔇 म्यूट" : "") + "</small></span>" + (RNAME[r.role] ? '<span class="cmrole r-' + r.role + '">' + RNAME[r.role] + "</span>" : "") + "</button>").join("") || '<div class="cmempty">कोई सदस्य नहीं।</div>';
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
  function showUser(id) { profileScreen(id); }
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
