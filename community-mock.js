/* JAKHAR Community — MOCK data layer (sirf dev/preview ke liye).
   Supabase ke /rest/v1 calls ko nakli data se jawab deta hai; community.js ko chhua nahi gaya.
   FINAL se pehle: community.html me window.JK_MOCK=false karo (aur is file ko hata sakte ho). */
(function () {
  if (window.JK_MOCKED) return; window.JK_MOCKED = true;
  const UID = "u-me", now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const P = {
    "u-me": { id: "u-me", username: "jakhar000001", display_name: "मैं (डेमो)", bio: "NEET की तैयारी 💪", exam: "NEET", avatar_url: null, verified: false },
    "u-a": { id: "u-a", username: "riya_neet", display_name: "रिया शर्मा", bio: "Biology लवर", exam: "NEET", avatar_url: null, verified: true },
    "u-b": { id: "u-b", username: "aman_jee", display_name: "अमन वर्मा", bio: "JEE 2027", exam: "JEE", avatar_url: null, verified: false },
    "u-c": { id: "u-c", username: "pooja_ssc", display_name: "पूजा यादव", bio: "", exam: "SSC", avatar_url: null, verified: false }
  };
  const pub = id => { const p = P[id]; return { username: p.username, display_name: p.display_name, avatar_url: p.avatar_url, verified: p.verified }; };
  const G = [
    { id: "g1", name: "NEET 2027 Warriors", description: "रोज़ के टेस्ट और डाउट्स", type: "public", avatar_key: null, member_count: 128, is_active: true, invite_code: "a1b2c3d4e5" },
    { id: "g2", name: "Physics Doubt Club", description: "Physics के सवाल यहाँ पूछें", type: "private", avatar_key: null, member_count: 24, is_active: true, invite_code: "f6a7b8c9d0" },
    { id: "g3", name: "SSC CGL Group", description: "SSC की तैयारी, नोट्स और टेस्ट", type: "public", avatar_key: null, member_count: 310, is_active: true, invite_code: "0a9b8c7d6e" }
  ];
  const MEM = { g1: "owner", g2: "member" };
  const txt = ["सब लोग आज का टेस्ट दे चुके?", "Biology के NCERT नोट्स किसके पास हैं?", "कल सुबह 6 बजे revision शुरू करते हैं", "Physics का numerical समझ नहीं आ रहा 😅", "सबको All the best! 🎯", "Mock test का लिंक भेजो", "आज 8 घंटे पढ़ाई पूरी ✅", "Chemistry के organic reactions कैसे याद करें?"];
  const au = ["u-a", "u-b", "u-c", "u-me"];
  let seq = 100;
  const posts = [
    ["u-a", null, "आज की टिप: NCERT की हर लाइन दो बार पढ़ो, Biology में 90% सवाल वहीं से आते हैं।", 14],
    ["u-b", null, "JEE Main के लिए कौन सी किताब best है? सुझाव दें 🙏", 55],
    ["u-c", null, "आज से daily 50 questions practice का चैलेंज, कौन जुड़ेगा?", 190],
    ["u-a", "g1", "NEET टेस्ट सीरीज़ कल से शुरू, सब तैयार रहें!", 30],
    ["u-b", "g2", "Rotational motion के notes यहाँ डाल रहा हूँ।", 75]
  ].map((x, i) => ({ id: "p" + (i + 1), author_id: x[0], group_id: x[1], body: x[2], created_at: ago(x[3]), like_count: (i * 3) % 7, is_hidden: false, file_key: null }));
  posts.push({ id: "p6", author_id: "u-a", group_id: null, body: "इस हफ़्ते कौन सा विषय सबसे मुश्किल लगा?", created_at: ago(8), like_count: 4, is_hidden: false, file_key: null, poll: { options: ["Physics", "Chemistry", "Biology"] } });
  posts.push({ id: "p7", author_id: "u-b", group_id: null, body: "Data Structures के नोट्स, सब देख लें 📚", created_at: ago(22), like_count: 5, is_hidden: false, file_key: "mock/ds-notes.pdf", file_name: "Data Structures Notes.pdf", file_size: 2516582, mime: "application/pdf" });
  const votes = { p6: { counts: [4, 2, 7], my: null } };
  const msgs = [];
  ["g1", "g2"].forEach((gid, k) => { for (let i = 0; i < 8; i++) msgs.push({ id: ++seq, group_id: gid, author_id: au[(i + k) % 4], body: txt[(i + k * 3) % txt.length], created_at: ago(120 - i * 12), is_hidden: false, file_key: null }); });
  const dms = [["u-a", "u-me", "Biology के नोट्स भेज दूँ?", 300, 1], ["u-me", "u-a", "हाँ प्लीज़ 🙏", 290, 1], ["u-a", "u-me", "ठीक है, शाम तक भेजती हूँ", 12, 0], ["u-b", "u-me", "कल का टेस्ट कैसा रहा?", 1500, 1], ["u-me", "u-b", "ठीक रहा, 160 आए", 1490, 1], ["u-c", "u-me", "ग्रुप में जुड़ गई 👍", 60, 0]].map((x, i) => ({ id: 900 + i, sender_id: x[0], receiver_id: x[1], body: x[2], created_at: ago(x[3]), read_at: x[4] ? ago(x[3] - 1) : null }));
  msgs.splice(2, 0, { id: 190, group_id: "g1", author_id: "u-b", kind: "system", body: "joined", created_at: ago(115), is_hidden: false, file_key: null });
  msgs.push({ id: 191, group_id: "g1", author_id: "u-a", body: "सब नोट्स डाउनलोड कर लेना 👇", file_key: "mock/ds.pdf", file_name: "Data Structures Notes.pdf", file_size: 2516582, mime: "application/pdf", created_at: ago(20), is_hidden: false });
  const follows = [{ follower_id: "u-me", followee_id: "u-a" }, { follower_id: "u-b", followee_id: "u-me" }, { follower_id: "u-c", followee_id: "u-me" }, { follower_id: "u-a", followee_id: "u-me" }, { follower_id: "u-b", followee_id: "u-a" }];
  P["u-me"].interests = ["Biology", "Physics", "Chemistry"]; P["u-a"].interests = ["Biology", "NEET"];
  const nots = [["n1", "like", "u-b", "p1", null, null, 6, 0], ["n2", "comment", "u-a", "p2", null, null, 25, 0], ["n3", "follow", "u-c", null, null, null, 90, 0], ["n4", "group_msg", "u-a", null, "g1", "नया मैसेज", 130, 0], ["n5", "mention", "u-b", "p1", null, null, 300, 1], ["n6", "announce", "u-a", null, "g1", "Admin: Important Announcement", 700, 1]].map(x => ({ id: x[0], type: x[1], actor_id: x[2], post_id: x[3], group_id: x[4], body: x[5], created_at: ago(x[6]), read_at: x[7] ? ago(x[6] - 1) : null }));
  const liked = new Set(), saved = new Set();
  const cms = [["c1", "p1", "u-b", "बहुत काम की टिप, धन्यवाद! 🙏", 8], ["c2", "p1", "u-c", "मैं भी यही करती हूँ।", 5], ["c3", "p2", "u-a", "HC Verma और DC Pandey दोनों देखो।", 40]].map(x => ({ id: x[0], post_id: x[1], author_id: x[2], body: x[3], created_at: ago(x[4]) }));
  const withAuthor = r => Object.assign({}, r, { author: pub(r.author_id), comment_count: cms.filter(c => c.post_id === r.id).length }, votes[r.id] ? { poll_counts: votes[r.id].counts, my_vote: votes[r.id].my } : {});
  const memGroup = g => ({ id: g.id, name: g.name, description: g.description, type: g.type, avatar_key: g.avatar_key, member_count: g.member_count, is_active: g.is_active });

  const ok = (d, s) => new Response(d == null ? "" : JSON.stringify(d), { status: s || 200, headers: { "Content-Type": "application/json" } });
  const flt = (q, k) => { const v = q.get(k); return v ? v.replace(/^[a-z]+\./, "") : null; };

  function handle(method, url, body) {
    const path = url.pathname.replace("/rest/v1/", ""), q = url.searchParams;
    if (path.indexOf("rpc/") === 0) {
      const fn = path.slice(4);
      if (fn === "my_upload_usage") return { limits: { pdf_max_bytes: 15728640, pdf_daily_bytes: 20971520, pdf_daily_count: 3, img_max_bytes: 5242880, img_daily_bytes: 0, img_daily_count: 50 }, pdf_bytes: 0, pdf_count: 0, img_bytes: 0, img_count: 0 };
      if (fn === "is_admin") return false;
      if (fn === "my_chats") {
        const out = [];
        ["g1", "g2"].forEach((gid, i) => { const ms = msgs.filter(x => x.group_id === gid), l = ms[ms.length - 1], g = G.find(x => x.id === gid); if (l) out.push({ kind: "group", id: gid, name: g.name, last_text: P[l.author_id].display_name.split(" ")[0] + ": " + l.body, last_at: l.created_at, unread: i ? 0 : 5, online: false }); });
        ["u-a", "u-b", "u-c"].forEach((pid, i) => { const ms = dms.filter(x => x.sender_id === pid || x.receiver_id === pid), l = ms[ms.length - 1]; out.push({ kind: "dm", id: pid, name: P[pid].display_name, last_text: l.body, last_at: l.created_at, unread: ms.filter(x => x.sender_id === pid && !x.read_at).length, online: i !== 1 }); });
        return out.sort((a, b) => b.last_at.localeCompare(a.last_at));
      }
      if (fn === "dm_mark_read" || fn === "group_mark_read") return fn === "dm_mark_read" ? 0 : null;
      if (fn === "community_state") return { banned: false, reason: "", muted_until: null };
      if (fn === "check_text") return "ok";
      if (fn === "create_group") { const g = { id: "g" + (++seq), name: body.p_name, description: body.p_desc || "", type: body.p_type || "public", avatar_key: body.p_avatar_key || null, member_count: 1, is_active: true, invite_code: "mock" + seq }; G.push(g); MEM[g.id] = "owner"; return [g]; }
      if (fn === "join_group") { MEM[body.p_group] = "member"; return true; }
      if (fn === "group_by_code") { const g = G.find(x => x.invite_code === body.p_code) || G[1]; return { id: g.id, name: g.name, description: g.description, type: g.type, member_count: g.member_count }; }
      if (fn === "join_by_code") { const g = G.find(x => x.invite_code === body.p_code) || G[1]; MEM[g.id] = MEM[g.id] || "member"; return { group_id: g.id }; }
      if (fn === "update_group") { const g = G.find(x => x.id === body.p_group); if (g) { g.name = body.p_name; g.description = body.p_desc; } return true; }
      if (fn === "group_reports") return [];
      return true;
    }
    if (path === "role_permissions") return [];
    if (path === "verification_requests") return method === "GET" ? [] : null;
    if (path === "reports") return null;
    if (path === "notifications") {
      if (method === "GET") { let r = nots.slice(); if ((q.get("read_at") || "").indexOf("is.null") === 0) r = r.filter(x => !x.read_at); return r.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(n => Object.assign({}, n, { actor: pub(n.actor_id), group: n.group_id ? { name: (G.find(g => g.id === n.group_id) || {}).name } : null })); }
      const id = flt(q, "id"); nots.forEach(n => { if ((!id || n.id === id) && !n.read_at) n.read_at = body.read_at; }); return null;
    }
    if (path === "follows") {
      const fr = flt(q, "follower_id"), fe = flt(q, "followee_id");
      if (method === "GET") return follows.filter(x => (!fr || x.follower_id === fr) && (!fe || x.followee_id === fe));
      if (method === "POST") { follows.push({ follower_id: UID, followee_id: body.followee_id }); return null; }
      const i = follows.findIndex(x => x.follower_id === fr && x.followee_id === fe); if (i >= 0) follows.splice(i, 1); return null;
    }
    if (path === "profiles" && method === "PATCH") { Object.assign(P[UID], body); return null; }
    if (path === "profiles") {
      const orq = q.get("or"); if (orq) { const t = ((/ilike\.\*([^*]*)\*/.exec(orq) || [])[1] || "").toLowerCase(); return Object.values(P).filter(p => p.id !== UID && (p.username.toLowerCase().indexOf(t) >= 0 || p.display_name.toLowerCase().indexOf(t) >= 0)); }
      const id = flt(q, "id"); return id && P[id] ? [P[id]] : [];
    }
    if (path === "post_likes") {
      if (method === "GET") return [...liked].map(id => ({ post_id: id }));
      if (method === "POST") { liked.add(body.post_id); const p = posts.find(x => x.id === body.post_id); if (p) p.like_count++; return null; }
      const id = flt(q, "post_id"); liked.delete(id); const p = posts.find(x => x.id === id); if (p && p.like_count > 0) p.like_count--; return null;
    }
    if (path === "dm_messages") {
      if (method === "GET") { const peers = ((q.get("or") || "").match(/u-[a-z]+/g) || []).filter(x => x !== UID), peer = peers[0]; const idf = q.get("id") || "", n = +idf.replace(/^[a-z]+\./, "");
        return dms.filter(x => (x.sender_id === peer || x.receiver_id === peer) && (idf.indexOf("gt.") !== 0 || x.id > n)).sort((a, b) => a.id - b.id); }
      const d = { id: ++seq + 900, sender_id: UID, receiver_id: body.receiver_id, body: body.body, created_at: new Date().toISOString(), read_at: null }; dms.push(d); return [d];
    }
    if (path === "poll_votes") { const v = votes[body.post_id]; if (v && v.my == null) { v.counts[body.option_idx]++; v.my = body.option_idx; } return null; }
    if (path === "post_saves") {
      if (method === "GET") return [...saved].map(id => ({ post_id: id }));
      if (method === "POST") { saved.add(body.post_id); return null; }
      saved.delete(flt(q, "post_id")); return null;
    }
    if (path === "comments") {
      if (method === "GET") return cms.filter(c => c.post_id === flt(q, "post_id")).map(withAuthor);
      const c = { id: "c" + (++seq), post_id: body.post_id, parent_id: body.parent_id || null, author_id: UID, body: body.body, created_at: new Date().toISOString() }; cms.push(c); return [withAuthor(c)];
    }
    if (path === "posts") {
      if (method === "GET") {
        const gid = flt(q, "group_id"), isNull = (q.get("group_id") || "").indexOf("is.null") === 0;
        const au = flt(q, "author_id"), inl = /^in\.\(/.test(q.get("author_id") || "") ? (q.get("author_id").slice(4, -1).split(",")) : null;
        let r = posts.filter(p => inl ? (!p.group_id && inl.indexOf(p.author_id) >= 0) : au ? p.author_id === au : isNull ? !p.group_id : p.group_id === gid);
        const term = k => ((/ilike\.\*([^*]*)\*/.exec(q.get(k) || "") || [])[1] || "").toLowerCase();
        if (q.get("body")) r = r.filter(p => (p.body || "").toLowerCase().indexOf(term("body")) >= 0);
        if (q.get("file_name")) r = r.filter(p => p.file_key && (p.file_name || "").toLowerCase().indexOf(term("file_name")) >= 0);
        r.sort((a, b) => (q.get("order") || "").indexOf("like_count") === 0 ? (b.like_count - a.like_count) || b.created_at.localeCompare(a.created_at) : b.created_at.localeCompare(a.created_at));
        const off = +q.get("offset") || 0, lim = +q.get("limit") || 12;
        return r.slice(off, off + lim).map(withAuthor);
      }
      if (method === "POST") { const p = Object.assign({ like_count: 0, is_hidden: false, file_key: null, group_id: null }, body, { id: "p" + (++seq), author_id: UID, created_at: new Date().toISOString() }); posts.unshift(p); if (p.poll) votes[p.id] = { counts: p.poll.options.map(() => 0), my: null }; return [withAuthor(p)]; }
      const id = flt(q, "id"); const i = posts.findIndex(x => x.id === id); if (i >= 0) posts.splice(i, 1); return null;
    }
    if (path === "messages") {
      const gid = flt(q, "group_id");
      if (method === "GET") {
        let r = msgs.filter(m => m.group_id === gid);
        if (q.get("body")) { const t = ((/ilike\.\*([^*]*)\*/.exec(q.get("body")) || [])[1] || "").toLowerCase(); r = r.filter(x => (x.body || "").toLowerCase().indexOf(t) >= 0); }
        const mm = q.get("mime"); if (mm) r = r.filter(x => mm.indexOf("like.") === 0 ? (x.mime || "").indexOf(mm.slice(5, -1)) === 0 : x.mime === mm.slice(3));
        const idf = q.get("id") || "", n = +idf.replace(/^[a-z]+\./, "");
        if (idf.indexOf("gt.") === 0) r = r.filter(m => m.id > n);
        if (idf.indexOf("lt.") === 0) r = r.filter(m => m.id < n);
        r.sort((a, b) => q.get("order") === "id.desc" ? b.id - a.id : a.id - b.id);
        return r.slice(0, +q.get("limit") || 40).map(withAuthor);
      }
      if (method === "POST") { const m = Object.assign({ is_hidden: false, file_key: null }, body, { id: ++seq, author_id: UID, created_at: new Date().toISOString() }); msgs.push(m); return [withAuthor(m)]; }
      const id = +flt(q, "id"); const i = msgs.findIndex(x => x.id === id); if (i >= 0) msgs.splice(i, 1); return null;
    }
    if (path === "groups") {
      const id = flt(q, "id");
      if (method === "DELETE") { const i = G.findIndex(x => x.id === id); if (i >= 0) G.splice(i, 1); delete MEM[id]; return null; }
      if (id) { if (typeof lastGid !== "undefined") lastGid = id; return G.filter(g => g.id === id); }
      let r = G.filter(g => g.type === "public" && g.is_active);
      const nm = (q.get("name") || "").replace(/^ilike\.\*|\*$/g, "").toLowerCase(); if (nm) r = r.filter(g => g.name.toLowerCase().indexOf(nm) >= 0);
      return r;
    }
    if (path === "group_members") {
      const gid = flt(q, "group_id"), uid = flt(q, "user_id");
      if (method === "DELETE") { delete MEM[gid]; return null; }
      if (uid && !gid) return G.filter(g => MEM[g.id]).map(g => ({ role: MEM[g.id], group_id: g.id, group: memGroup(g) }));
      if (uid && gid) return MEM[gid] ? [{ role: MEM[gid], muted_until: null, banned: false }] : [];
      return Object.keys(P).map((id, i) => ({ user_id: id, role: id === UID ? (MEM[gid] || "member") : i === 1 ? "admin" : "member", muted_until: null, banned: false, user: pub(id) }));
    }
    return method === "GET" ? [] : null;
  }

  const prev = window.fetch.bind(window);
  window.fetch = function (u, o) {
    const s = String(u);
    if (typeof SM_BASE !== "undefined" && s.indexOf(SM_BASE + "/rest/v1/") === 0) {
      const method = ((o && o.method) || "GET").toUpperCase();
      let body = null; try { body = o && o.body ? JSON.parse(o.body) : null; } catch (e) {}
      try { return Promise.resolve(ok(handle(method, new URL(s), body || {}))); } catch (e) { console.warn("mock:", e); return Promise.resolve(ok({ message: "SERVER" }, 500)); }
    }
    return prev(u, o);
  };
  /* nakli session + profile (asli JKAuth/JKProfile ko usi object par badal diya) */
  const S = { access_token: "mock", refresh_token: "mock", expires_at: 9999999999, email: "demo@jakhar.app", uid: UID };
  Object.assign(window.JKAuth, { getSession: () => S, isLoggedIn: () => true, uid: () => UID, ensureUid: async () => UID, refresh: async () => {} });
  Object.assign(window.JKProfile, { load: async () => P[UID], get: () => P[UID] });
})();
