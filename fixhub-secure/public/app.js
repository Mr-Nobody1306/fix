/* ServePoint Ghana — PART 4: app logic A (config, data, backend, router, home). Extracted from index.html; order matters (loads before flows.js). */
/* ServePoint — PART 4 (secure split). Public keys come from public/config.js
   (window.FIXHUB_CONFIG, filled with your Supabase + Paystack values).
   The Groq key lives only in the server .env — never in this file. */
function publicSetting(name) {
  if (typeof window !== "undefined" && window.FIXHUB_CONFIG && window.FIXHUB_CONFIG[name]) return String(window.FIXHUB_CONFIG[name]);
  if (typeof root !== "undefined" && root[name]) return String(root[name]);
  return "";
}
const CFG = {
  paystackKey: publicSetting("paystackPublicKey"),
  supabaseUrl: publicSetting("supabaseUrl"),
  supabaseKey: publicSetting("supabaseAnonKey")
};
function hasLivePaystack() {
  const key = (CFG.paystackKey || "").trim();
  return !!key && key.indexOf("PASTE") !== 0 && key.indexOf("YOUR_") !== 0 && typeof window !== "undefined" && !!window.PaystackPop;
}
const LIVE_PAY = hasLivePaystack();
const LIVE_DB = CFG.supabaseUrl && CFG.supabaseUrl.indexOf("PASTE") !== 0 && CFG.supabaseKey && CFG.supabaseKey.indexOf("PASTE") !== 0;
window.APP_REV = "secure-2026-11-12";

const SERVICES = [
  { id: "plumbing", name: "Plumbing", base: 80, tint: "#E0F2FE", color: "#0369A1", blurb: "Leaks, pipes, tanks & fittings",
    icon: '<path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3z"/>' },
  { id: "electrical", name: "Electrical", base: 90, tint: "#FEF3C7", color: "#B45309", blurb: "Wiring, sockets & faults",
    icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
  { id: "cleaning", name: "Deep Cleaning", base: 150, tint: "#E6F4EC", color: "#0A7A42", blurb: "Homes, offices & move-out",
    icon: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>' },
  { id: "carpentry", name: "Carpentry", base: 100, tint: "#FFF3E8", color: "#994700", blurb: "Doors, roofs & furniture",
    icon: '<path d="M11 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5"/><path d="M14 4l6 6L9 21H4v-5z"/>' },
  { id: "hvac", name: "HVAC", base: 120, tint: "#EDE9FE", color: "#6D28D9", blurb: "AC install & servicing",
    icon: '<path d="M12 2v20M4 6l16 12M20 6L4 18M12 6l-2-2m2 2l2-2m-2 14l-2 2m2-2l2 2M3.5 9L2 8m1.5 1L2 10m18.5-1L22 8m-1.5 1L22 10M3.5 15L2 16m1.5-1L2 14m18.5 1L22 16m-1.5-1l1.5 2"/>' }
];
let APP_NOTIFICATIONS = [];
/* Service areas cover all 16 regions of Ghana. AREAS stays flat for the
   fallback cycler and defaults; dropdowns group by region instead. */
const REGIONS = [
  { region: "Greater Accra", areas: ["Accra", "Spintex", "Osu", "East Legon", "Kaneshie", "Dansoman", "Achimota", "Madina", "Adenta", "Tema", "Ashaiman", "Nungua", "Teshie", "Sakumono", "Dodowa", "Prampram"] },
  { region: "Ashanti", areas: ["Kumasi – Asokwa", "Kumasi – Manhyia", "Obuasi", "Ejisu", "Mampong", "Konongo", "Bekwai"] },
  { region: "Western", areas: ["Takoradi – Anaji", "Sekondi", "Tarkwa", "Axim"] },
  { region: "Central", areas: ["Kasoa", "Cape Coast", "Winneba", "Agona Swedru"] },
  { region: "Eastern", areas: ["Koforidua", "Nkawkaw", "Suhum", "Nsawam", "Akosombo"] },
  { region: "Volta", areas: ["Ho", "Hohoe", "Keta", "Aflao", "Sogakope"] },
  { region: "Oti", areas: ["Dambai", "Nkwanta", "Kadjebi"] },
  { region: "Northern", areas: ["Tamale", "Yendi", "Savelugu"] },
  { region: "Savannah", areas: ["Damongo", "Bole", "Sawla"] },
  { region: "North East", areas: ["Nalerigu", "Walewale", "Gambaga"] },
  { region: "Upper East", areas: ["Bolgatanga", "Navrongo", "Bawku"] },
  { region: "Upper West", areas: ["Wa", "Tumu", "Lawra", "Jirapa"] },
  { region: "Bono", areas: ["Sunyani", "Berekum", "Dormaa Ahenkro"] },
  { region: "Bono East", areas: ["Techiman", "Kintampo", "Atebubu"] },
  { region: "Ahafo", areas: ["Goaso", "Bechem", "Duayaw Nkwanta"] },
  { region: "Western North", areas: ["Sefwi Wiawso", "Bibiani", "Juaboso"] }
];
const AREAS = REGIONS.reduce((all, g) => all.concat(g.areas), []);
const SLOTS = ["8–10am", "10–12pm", "12–2pm", "2–4pm", "4–6pm"];
const TRANSPORT = 20, SENIOR_RATE = 0.10;

/* ---------- persistent store (device) ---------- */
const Store = {
  load() {
    try {
      const s = JSON.parse(localStorage.getItem("fixhub_gh") || "{}");
      return { bookings: s.bookings || [], activeId: s.activeId || null, senior: !!s.senior, draft: s.draft || null, homeArea: s.homeArea || null, homeGeo: s.homeGeo || null, profile: s.profile || null };
    } catch (e) { return { bookings: [], activeId: null, senior: false, draft: null, homeArea: null, homeGeo: null, profile: null }; }
  },
  save(s) { try { localStorage.setItem("fixhub_gh", JSON.stringify(s)); } catch (e) {} }
};
let S = Store.load();
/* one-time purge of retired demo data (seeded jobs, demo applications) */
try {
  const before = (S.bookings || []).length;
  S.bookings = (S.bookings || []).filter(b => b && b.id !== "FX-1042" && b.id !== "FX-1017");
  if (S.bookings.length !== before) Store.save(S);
  localStorage.removeItem("fixhub_gh_seeded");
  Object.keys(localStorage).filter(k => k.indexOf("fixhub_demo_apps_") === 0).forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
} catch (e) {}
function gh(n) { return "GH₵ " + Number(n).toFixed(2); }
function persist() { Store.save(S); }

/* ---------- backend: Supabase when configured, else device ----------
   Secure mode: each device signs in anonymously (Supabase Auth) so the RLS
   policies in src/supabase.sql scope every row to its owner
   (owner_id = auth.uid()). Street address, voice notes and full photos never
   leave the device — only the hasPhoto flag syncs. */
const Auth = {
  key: "fixhub_sb_session",
  mem: null,
  load() {
    if (this.mem) return this.mem;
    try { this.mem = JSON.parse(localStorage.getItem(this.key) || "null"); } catch (e) { this.mem = null; }
    return this.mem;
  },
  persist(s) { this.mem = s; try { localStorage.setItem(this.key, JSON.stringify(s)); } catch (e) {} },
  uid() { const s = this.load(); return s && s.uid ? s.uid : null; },
  googleUid() { const s = this.load(); return s && s.provider === "google" && s.uid ? s.uid : null; },
  topUrl() {
    try { return location.origin + (location.pathname === "/admin" || location.pathname === "/admin/" ? "/" : location.pathname); }
    catch (e) { return ""; }
  },
  async fetchUser() {
    const s = this.load();
    if (!s || !s.access || s.uid) return s;
    const r = await fetch(CFG.supabaseUrl + "/auth/v1/user", {
      headers: { apikey: CFG.supabaseKey, Authorization: "Bearer " + s.access }
    });
    if (!r.ok) throw 0;
    const u = await r.json();
    const meta = (u && u.user_metadata) || {};
    const n = Object.assign({}, s, {
      uid: u.id,
      email: u.email || null,
      name: meta.full_name || meta.name || (u.email ? u.email.split("@")[0] : "ServePoint user"),
      artisanPhone: meta.artisan_phone || null
    });
    this.persist(n);
    return n;
  },
  loginWithGoogle(button) {
    if (!LIVE_DB) { toast("Backend not connected yet — add your Supabase URL + anon key in public/config.js, then reload"); return; }
    const redirect = this.topUrl() + "?oauth=done";
    const url = CFG.supabaseUrl + "/auth/v1/authorize?provider=google&redirect_to=" + encodeURIComponent(redirect);
    const w = window.open(url, "fixhub_login", "width=480,height=680");
    if (!w) { toast("Allow popups to log in with Google"); return; }
    const restoreButton = typeof beginButtonBusy === "function" ? beginButtonBusy(button, "Waiting for Google…") : function () {};
    toast("Finish Google login in the new tab…");
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        const raw = localStorage.getItem(this.key);
        const s = raw ? JSON.parse(raw) : null;
        if (s && s.access && s.provider === "google" && s.uid) {
          clearInterval(timer);
          restoreButton();
          this.mem = s;
          const profile = await ensureProfile();
          if (!profile) {
            toast("Signed in, but your profile could not load. Check the database setup and try again.");
            show(location.pathname === "/admin" || location.pathname === "/admin/" ? "admin" : "account");
            return;
          }
          toast(profile.phoneStorageError
            ? "Welcome — your profile loaded, but phone details could not sync. Check the database migration."
            : "Welcome" + (profile.name ? ", " + String(profile.name).split(" ")[0] : "") + "!");
          show(location.pathname === "/admin" || location.pathname === "/admin/" ? "admin" : "account");
        }
      } catch (e) {}
      if (tries > 120) {
        clearInterval(timer);
        restoreButton();
        toast("Google sign-in timed out — please try again");
      }
    }, 1500);
  },
  logout() {
    try { localStorage.removeItem(this.key); } catch (e) {}
    this.mem = null;
    S.profile = null; persist();
    toast("Logged out — browsing as guest");
    try { updateAvatar(); } catch (e) {}
    renderAccount();
  },
  async signup() {
    const r = await fetch(CFG.supabaseUrl + "/auth/v1/signup", {
      method: "POST",
      headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json" },
      body: "{}"
    });
    if (!r.ok) throw 0;
    const j = await r.json();
    if (!j.access_token || !j.user) throw 0;
    const s = { uid: j.user.id, access: j.access_token, refresh: j.refresh_token || null, exp: Date.now() + 50 * 60 * 1000 };
    this.persist(s);
    return s;
  },
  async refresh() {
    const s = this.load();
    if (!s || !s.refresh) throw 0;
    const r = await fetch(CFG.supabaseUrl + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh })
    });
    if (!r.ok) throw 0;
    const j = await r.json();
    if (!j.access_token) throw 0;
    const n = Object.assign({}, s, {
      uid: (j.user && j.user.id) || s.uid,
      access: j.access_token,
      refresh: j.refresh_token || s.refresh,
      exp: Date.now() + 50 * 60 * 1000
    });
    this.persist(n);
    return n;
  },
  async session() {
    if (!LIVE_DB) return null;
    const s = this.load();
    if (s && s.access && Date.now() < s.exp) return s;
    try { return await this.refresh(); }
    catch (e) {
      if (s && s.provider === "google") return null; // keep Google identity; never mint anon over it
      try { return await this.signup(); }
      catch (e2) { return null; } // anonymous sign-ins disabled → transitional mode
    }
  },
  async bearer() {
    const s = await this.session();
    return s ? s.access : CFG.supabaseKey;
  }
};
const Backend = {
  headers(token) { return { apikey: CFG.supabaseKey, Authorization: "Bearer " + token }; },
  async sbGet(path) {
    const token = await Auth.bearer();
    const r = await fetch(CFG.supabaseUrl + "/rest/v1/" + path, { headers: this.headers(token) });
    if (!r.ok) throw 0;
    return r.json();
  },
  async sbSend(path, method, body, prefer) {
    const token = await Auth.bearer();
    const headers = Object.assign(this.headers(token), { "Content-Type": "application/json" });
    if (prefer) headers.Prefer = prefer;
    const r = await fetch(CFG.supabaseUrl + "/rest/v1/" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error("Supabase request failed: " + r.status);
    try { return await r.json(); } catch (e) { return null; }
  },
  async apiPost(path, body) {
    const token = await Auth.bearer();
    const headers = this.headers(token);
    delete headers.apikey;
    headers["Content-Type"] = "application/json";
    const response = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Server request failed: " + response.status);
    return result;
  },
  async apiGet(path) {
    const token = await Auth.bearer();
    const headers = this.headers(token);
    delete headers.apikey;
    const response = await fetch(path, { headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Server request failed: " + response.status);
    return result;
  },
  async list() {
    if (!LIVE_DB) return [];
    try {
      const g = Auth.googleUid();
      const token = await Auth.bearer();
      const q = g
        ? "/rest/v1/bookings?select=*&customer_id=eq." + encodeURIComponent(g) + "&order=created_at.desc&limit=50"
        : "/rest/v1/bookings?select=*" + (Auth.uid() ? "&owner_id=eq." + encodeURIComponent(Auth.uid()) : "") + "&order=created_at.desc&limit=50";
      const r = await fetch(CFG.supabaseUrl + q, { headers: this.headers(token) });
      if (!r.ok) throw 0;
      const rows = await r.json();
      return rows.map(rowToBooking);
    } catch (e) { return S.bookings; }
  },
  async save(b) {
    S.bookings = [b].concat(S.bookings.filter(x => x.id !== b.id));
    persist();
    if (!LIVE_DB) return true;
    const token = await Auth.bearer();
    const r = await fetch(CFG.supabaseUrl + "/rest/v1/bookings", {
      method: "POST",
      headers: Object.assign(this.headers(token), { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify(bookingToRow(b))
    });
    if (!r.ok) throw new Error("Could not save booking: " + r.status);
    return true;
  },
  async openJobs() {
    if (!LIVE_DB) return [];
    const artisan = S.profile && S.profile.role === "artisan";
    if (artisan && S.profile.isSuspended) return [];
    const trade = artisan ? String(S.profile.trade || "") : "";
    if (artisan && !trade) return [];
    try {
      const filter = artisan ? "&service=eq." + encodeURIComponent(trade) : "";
      const rows = await this.sbGet("bookings?select=*&status=eq.open" + filter + "&order=created_at.desc&limit=20");
      return (rows || []).map(rowToBooking).filter((booking) => !artisan || booking.serviceId === trade);
    } catch (e) { return []; }
  },
  async applicants(bookingId) {
    if (!LIVE_DB) return [];
    try {
      const rows = await this.sbGet("applications?select=*&booking_id=eq." + encodeURIComponent(bookingId) + "&order=created_at.asc");
      return (rows || []).slice().sort((a, b) => ((Number(b.rating) || 0) - (Number(a.rating) || 0)) || ((Number(b.jobs) || 0) - (Number(a.jobs) || 0)));
    } catch (e) { return []; }
  },
  async artisans() {
    if (!LIVE_DB) return [];
    try {
      const rows = await this.sbGet("profiles?select=id,role,name,trade,area,rating,jobs&role=eq.artisan&is_suspended=eq.false&order=rating.desc&limit=50");
      return (rows || []).map(rowToProfile);
    } catch (e) { return []; }
  },
  async apply(booking) {
    const g = Auth.googleUid();
    if (!g || !S.profile || S.profile.role !== "artisan" || S.profile.isSuspended || !booking || booking.serviceId !== S.profile.trade || booking.status !== "open") {
      throw new Error(S.profile && S.profile.isSuspended
        ? "Your artisan account is suspended from new jobs."
        : "This request is not open for your trade.");
    }
    if (!LIVE_DB) throw 0;
    return await this.sbSend("applications", "POST", {
      booking_id: booking.id, artisan_id: g,
      artisan_name: String(S.profile.name || "Artisan").slice(0, 120),
      trade: S.profile.trade || null,
      rating: Number(S.profile.rating) || 5.0,
      jobs: Number(S.profile.jobs) || 0
    }, "resolution=ignore-duplicates");
  },
  async setApplication(id, status) {
    return await this.sbSend("applications?id=eq." + encodeURIComponent(id), "PATCH", { status });
  },
  async saveProfile(patch) {
    const g = Auth.googleUid();
    if (!g) throw 0;
    const rows = await this.sbSend("profiles?id=eq." + encodeURIComponent(g), "PATCH", patch, "return=representation");
    if (!rows || !rows.length) throw new Error("No profile was updated");
    S.profile = Object.assign({}, S.profile, patch);
    persist();
    return S.profile;
  },
  async artisanPhone(artisanId) {
    const rows = await this.sbGet("artisan_private_details?select=phone&artisan_id=eq." + encodeURIComponent(artisanId) + "&limit=1");
    return rows && rows[0] ? rows[0].phone : null;
  },
  async saveArtisanPhone(phone) {
    const artisanId = Auth.googleUid();
    if (!artisanId) throw new Error("Sign in as an artisan to save contact details");
    await this.sbSend("artisan_private_details", "POST", { artisan_id: artisanId, phone }, "resolution=merge-duplicates");
  },
  async acceptedArtisanContact(bookingId) {
    const applications = await this.sbGet("applications?select=artisan_id&booking_id=eq." + encodeURIComponent(bookingId) + "&status=eq.accepted&limit=1");
    if (!applications || !applications[0]) return null;
    const artisanId = applications[0].artisan_id;
    const phone = await this.artisanPhone(artisanId);
    return phone ? { artisanId, phone } : null;
  },
  async notifications() {
    if (!LIVE_DB) return [];
    return await this.sbGet("notifications?select=id,booking_id,type,message,read_at,created_at&order=created_at.desc&limit=30");
  },
  async markNotificationsRead(ids) {
    if (!LIVE_DB || !ids.length) return;
    const filter = ids.map((id) => encodeURIComponent(id)).join(",");
    await this.sbSend("notifications?id=in.(" + filter + ")&read_at=is.null", "PATCH", { read_at: new Date().toISOString() }, "return=minimal");
  },
  async assignedJobs() {
    const artisanId = Auth.googleUid();
    if (!LIVE_DB || !artisanId || !S.profile || S.profile.role !== "artisan") return [];
    const rows = await this.sbGet("bookings?select=*&artisan_id=eq." + encodeURIComponent(artisanId) +
      "&status=in.(enroute,arrived,working)&order=created_at.desc&limit=20");
    return (rows || []).map(rowToBooking);
  }
};
function bookingToRow(b) {
  return { id: b.id, owner_id: Auth.uid(), customer_id: b.customerId || null, artisan_id: b.artisanId || null, service: b.serviceId, description: b.desc, area: b.area, slot: b.slot, date: b.date, total: b.total, service_amount: b.service, transport_amount: b.transport, discount_amount: b.discount, payment_reference: b.payRef || null, method: b.method || null, status: b.status, tech: b.tech || null, prog: (typeof b.prog === "number" ? b.prog : null), offroute: !!b.offRoute, tech_rating: (b.techRating != null ? b.techRating : null), tech_jobs: (b.techJobs != null ? b.techJobs : null) };
}
function rowToBooking(r) {
  return { id: r.id, customerId: r.customer_id || null, artisanId: r.artisan_id || null, serviceId: r.service, desc: r.description, area: r.area, slot: r.slot, date: r.date, total: Number(r.total), service: r.service_amount == null ? null : Number(r.service_amount), transport: r.transport_amount == null ? null : Number(r.transport_amount), discount: r.discount_amount == null ? null : Number(r.discount_amount), payRef: r.payment_reference || null, method: r.method, status: r.status, tech: r.tech, prog: (r.prog != null ? Number(r.prog) : null), offRoute: !!r.offroute, techRating: (r.tech_rating != null ? Number(r.tech_rating) : null), techJobs: (r.tech_jobs != null ? Number(r.tech_jobs) : null) };
}
function rowToProfile(r) {
  return { id: r.id, role: r.role, name: r.name, trade: r.trade || null, area: r.area || null, rating: (r.rating != null ? Number(r.rating) : 5.0), jobs: (r.jobs != null ? Number(r.jobs) : 0), isSuspended: !!r.is_suspended, suspensionReason: r.suspension_reason || null, suspendedAt: r.suspended_at || null };
}
async function ensureProfile() {
  if (!LIVE_DB) return null;
  const s = Auth.load();
  if (!s || s.provider !== "google") return null;
  try {
    await Auth.fetchUser();
    const me = Auth.load();
    if (!me || !me.uid) return null;
    const token = await Auth.bearer();
    const r = await fetch(CFG.supabaseUrl + "/rest/v1/profiles?id=eq." + encodeURIComponent(me.uid) + "&select=*", { headers: Backend.headers(token) });
    if (!r.ok) throw 0;
    const rows = await r.json();
    if (rows && rows[0]) {
      S.profile = rowToProfile(rows[0]);
      if (S.profile.role === "artisan") {
        try {
          S.profile.phone = await Backend.artisanPhone(me.uid);
          if (!S.profile.phone && me.artisanPhone) {
            await Backend.saveArtisanPhone(me.artisanPhone);
            S.profile.phone = me.artisanPhone;
          }
        } catch (e) {
          S.profile.phone = me.artisanPhone || null;
          S.profile.phoneStorageError = true;
        }
      }
      persist();
      try { updateAvatar(); } catch (e) {}
      return S.profile;
    }
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem("fixhub_pending_role") || "null"); } catch (e) {}
    const role = pending && pending.role === "artisan" ? "artisan" : "customer";
    const body = {
      id: me.uid, role,
      name: String((role === "artisan" && pending && pending.name) || me.name || "ServePoint user").slice(0, 120),
      trade: role === "artisan" ? (pending && pending.trade) || null : null,
      area: role === "artisan" ? (pending && pending.area) || null : null,
      rating: 5.0, jobs: 0
    };
    const profileToken = await Auth.bearer();
    const w = await fetch(CFG.supabaseUrl + "/rest/v1/profiles", {
      method: "POST",
      headers: Object.assign(Backend.headers(profileToken), { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates" }),
      body: JSON.stringify(body)
    });
    if (!w.ok) throw 0;
    let phoneSaved = role !== "artisan" || !pending || !pending.phone;
    if (role === "artisan" && pending && pending.phone) {
      try { await Backend.saveArtisanPhone(pending.phone); phoneSaved = true; }
      catch (e) { phoneSaved = false; }
    }
    S.profile = { id: me.uid, role, name: body.name, phone: role === "artisan" && pending ? pending.phone : null, phoneStorageError: !phoneSaved, trade: body.trade, area: body.area, rating: 5.0, jobs: 0 };
    persist();
    if (phoneSaved) { try { localStorage.removeItem("fixhub_pending_role"); } catch (e) {} }
    try { updateAvatar(); } catch (e) {}
    return S.profile;
  } catch (e) { return null; }
}
/* OAuth popup lands back here top-level with #access_token — stash the
   session where the iframed app can read it (same origin), then close. */
(function oauthCallback() {
  try {
    if (!location.hash || location.hash.indexOf("access_token=") === -1) return;
    const h = {};
    location.hash.slice(1).split("&").forEach(kv => { const i = kv.indexOf("="); if (i > 0) h[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    if (!h.access_token) return;
    Auth.persist({ uid: null, access: h.access_token, refresh: h.refresh_token || null, exp: Date.now() + (Number(h.expires_in) || 3600) * 1000 - 60000, provider: "google" });
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    Auth.fetchUser().then(() => ensureProfile()).then(() => {
      if (window.opener && !window.opener.closed) {
        toast("Logged in with Google — this tab will close");
        setTimeout(() => { try { window.close(); } catch (e) {} }, 1500);
      }
    }).catch(() => {});
  } catch (e) {}
})();

/* ---------- tiny router ---------- */
const VIEWS = ["home", "diag", "services", "account", "privacy", "book1", "book2", "track", "pay", "history", "admin"];
let privacyFrom = "account";
function requireSignedInForProtectedView(name) {
  const protectedViews = ["services", "book1", "book2", "track", "pay", "history", "admin"];
  if (!protectedViews.includes(name)) return true;
  const signedIn = !!(Auth && typeof Auth.googleUid === "function" && Auth.googleUid()) && !!(S && S.profile);
  if (!signedIn) {
    toast(name === "admin" ? "Sign in with the authorized Google account to open the admin portal." : "Please sign in with Google before accessing services and bookings.");
    if (name !== "account") show("account");
    return false;
  }
  return true;
}
function show(name) {
  if (!VIEWS.includes(name)) name = "home";
  if (!requireSignedInForProtectedView(name)) return;
  VIEWS.forEach(v => { const el = document.getElementById("view-" + v); if (el) el.hidden = (v !== name); });
  closeNav();
  document.querySelectorAll(".sn-link").forEach(b => {
    const on = b.dataset.goto === name || ((name === "book1" || name === "book2") && b.dataset.goto === "home") || ((name === "track" || name === "pay") && b.dataset.goto === "history");
    b.classList.toggle("on", !!on);
  });
  updateNavUser();
  document.getElementById("screens").scrollTop = 0;
  window.scrollTo(0, 0);
  if (name === "home") renderHomeExtras();
  if (name === "diag") renderDiag();
  if (name === "services") renderServices();
  if (name === "account") renderAccount();
  if (name === "track") renderTrack();
  if (name === "history") renderHistory();
  if (name === "pay") renderPay();
  if (name === "admin" && typeof renderAdmin === "function") renderAdmin();
}
/* ---------- side navigation (drawer on phones, fixed sidebar on desktop) ---------- */
function openNav() {
  updateNavUser();
  document.body.classList.add("nav-open");
  const c = document.getElementById("navClose");
  if (c) c.focus();
}
function closeNav() { document.body.classList.remove("nav-open"); }
function updateNavUser() {
  let g = null;
  try { g = Auth.googleUid(); } catch (e) {}
  const signed = !!(g && S.profile);
  const r = document.getElementById("navRole");
  if (r) r.textContent = signed ? (S.profile.role === "artisan" ? "Artisan" : (S.profile.name || "Customer")) : "Guest";
  const ini = document.getElementById("navInitial");
  if (ini) ini.textContent = signed ? String(S.profile.name || "S")[0].toUpperCase() : "G";
  const so = document.getElementById("navSignout");
  if (so) so.hidden = !signed;
}
const BURGER_SVG = '<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
function wireBurger(b) {
  if (!b || b.dataset.navWired) return;
  b.dataset.navWired = "1";
  if (!b.innerHTML.trim()) b.innerHTML = BURGER_SVG;
  b.addEventListener("click", function (e) { e.stopPropagation(); openNav(); });
}
function ensureBurgers() {
  wireBurger(document.getElementById("burgerBtn"));
  document.querySelectorAll("[data-view] > header").forEach(function (h) {
    if (h.querySelector(".burgerBtn")) return;
    const b = document.createElement("button");
    b.className = "burgerBtn";
    b.setAttribute("aria-label", "Open navigation");
    h.insertBefore(b, h.firstChild);
    wireBurger(b);
  });
}
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) {
    if (g.dataset.goto === "privacy") {
      try { privacyFrom = VIEWS.find(v => !document.getElementById("view-" + v).hidden) || "account"; } catch (err) {}
    }
    show(g.dataset.goto); return;
  }
  const b = e.target.closest("[data-back]");
  if (b) { show(b.dataset.back); return; }
  const c = e.target.closest("[data-close]");
  if (c) { document.getElementById(c.dataset.close).hidden = true; }
});

/* ---------- toast ---------- */
let toastT = null, toastQueue = [], toastShowing = false;
function toast(msg) {
  const t = document.getElementById("toast");
  if (!t || !msg) return;
  toastQueue.push(String(msg));
  if (toastShowing) return;
  showNextToast();
}
function showNextToast() {
  const t = document.getElementById("toast");
  const message = toastQueue.shift();
  if (!t || !message) { toastShowing = false; return; }
  toastShowing = true;
  t.textContent = message;
  t.classList.add("toast-visible");
  toastT = setTimeout(() => {
    t.classList.remove("toast-visible");
    toastT = setTimeout(() => {
      toastT = null;
      showNextToast();
    }, 180);
  }, 3800);
}

/* ---------- home: categories, search, senior mode ---------- */
function svcIcon(s, cls) {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${s.icon}</svg>`;
}
/* CSP-safe service badge colors (style-src has no 'unsafe-inline', so style
   attributes are banned here).
   Unknown ids fall back to tint-default — never interpolates raw data into a class name. */
function tintCls(s) {
  const id = s && typeof s.id === "string" ? s.id : "";
  return "tint-" + (id === "plumbing" || id === "electrical" || id === "cleaning" || id === "carpentry" || id === "hvac" ? id : "default");
}
function renderCats(filter) {
  const grid = document.getElementById("catGrid");
  grid.innerHTML = "";
  const q = (filter || "").toLowerCase();
  SERVICES.filter(s => !q || s.name.toLowerCase().includes(q) || s.blurb.toLowerCase().includes(q)).forEach(s => {
    const b = document.createElement("button");
    b.className = "sphome-card";
    b.innerHTML = `<span class="sphome-ic ${tintCls(s)}">${svcIcon(s, "w-6 h-6")}</span>
      <span class="sphome-tx"><b>${s.name}</b><i data-prov="${s.id}">from ${gh(s.base)}</i></span>
      <span class="sphome-chev"><svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></span>`;
    b.onclick = () => startBooking(s.id);
    grid.appendChild(b);
  });
  if (!grid.children.length) grid.innerHTML = '<p class="emptyNote f14 soft py-6 spanall">No matches. Try "plumber" or "clean".</p>';
  else if (LIVE_DB) upgradeProvCounts(grid);
}
/* When the backend is connected, swap the price hint for live provider counts. */
async function upgradeProvCounts(grid) {
  try {
    const artisans = await Backend.artisans();
    const n = {};
    (artisans || []).forEach(p => {
      const t = String(p.trade || "").toLowerCase();
      const s = SERVICES.find(x => x.id === t || x.name.toLowerCase() === t);
      if (s) n[s.id] = (n[s.id] || 0) + 1;
    });
    grid.querySelectorAll("[data-prov]").forEach(el => {
      const c = n[el.dataset.prov] || 0;
      el.textContent = c > 0 ? c + (c === 1 ? " artisan" : " artisans") : "No artisans yet";
    });
  } catch (e) {}
}
const searchInputEl = document.getElementById("searchInput");
if (searchInputEl) searchInputEl.addEventListener("input", (e) => renderCats(e.target.value));
document.getElementById("svcSearch").addEventListener("input", (e) => { svcQuery = e.target.value; renderServices(); });
const homeSearchEl = document.getElementById("homeSearch");
function homeSearchGo() {
  const q = homeSearchEl.value.trim();
  const sv = document.getElementById("svcSearch");
  if (sv) sv.value = q;
  svcQuery = q;
  renderServices();
  show("services");
}
if (homeSearchEl) {
  homeSearchEl.addEventListener("keydown", (e) => { if (e.key === "Enter") homeSearchGo(); });
  document.getElementById("homeSearchGo").onclick = homeSearchGo;
  document.getElementById("homeLoc").onclick = () => locateUser({ silent: false });
}
function applySenior() {
  document.body.classList.toggle("easy-view", S.senior);
  document.querySelectorAll(".easyTBtn").forEach(b => {
    b.textContent = S.senior ? "Easy View: On" : "Easy View: Off";
    b.setAttribute("aria-pressed", S.senior ? "true" : "false");
  });
}
function toggleSenior() { S.senior = !S.senior; persist(); applySenior(); toast(S.senior ? "Easy View on: larger text" : "Easy View off"); }
const GOOGLE_G_SVG = '<svg class="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>';
function updateAvatar() {
  const btn = document.getElementById("avatarBtn");
  if (!btn) return;
  const name = S.profile && S.profile.name ? String(S.profile.name).trim() : "";
  btn.classList.toggle("avatarbtn-guest", !name);
  if (name) {
    btn.textContent = name[0].toUpperCase();
    btn.setAttribute("aria-label", "Account — signed in as " + name);
  } else {
    btn.innerHTML = GOOGLE_G_SVG;
    btn.setAttribute("aria-label", "Sign in with Google");
  }
}
function refreshAreaPill() {
  const el = document.getElementById("areaPillText");
  if (!el) return;
  if (S.homeGeo && S.homeGeo.label) el.textContent = S.homeGeo.label;
  else el.textContent = (S.homeArea || AREAS[0]) + ", Ghana";
  const chip = document.getElementById("photoAreaChip");
  if (chip) chip.textContent = "Home · " + String(el.textContent).split(",")[0];
  const hl = document.getElementById("homeLocText");
  if (hl) hl.textContent = el.textContent;
}
async function reverseLabel(lat, lng) {
  try {
    const r = await fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" + lat + "&longitude=" + lng + "&localityLanguage=en");
    if (!r.ok) throw 0;
    const j = await r.json();
    const place = j.city || j.locality || j.principalSubdivision || "";
    if (place) return (j.countryCode === "GH" || !j.countryCode) ? place + ", Ghana" : place;
  } catch (e) {}
  return null;
}
function cycleArea() {
  const i = AREAS.indexOf(S.homeArea || AREAS[0]);
  S.homeArea = AREAS[(i + 1) % AREAS.length];
  S.homeGeo = null;
  persist(); refreshAreaPill();
  toast("Home area set to " + S.homeArea);
}
/* Approximate area from the network IP (no permission prompt).
   Runs automatically when GPS is denied or unavailable, so the area pills
   still resolve on their own without the user doing anything. */
async function ipGeo() {
  try {
    const r = await fetch("https://get.geojs.io/v1/ip/geo.json");
    if (!r.ok) throw 0;
    const j = await r.json();
    const place = j.city || j.region || "";
    if (!place) return null;
    const label = (j.country_code === "GH" || !j.country_code) ? place + ", Ghana" : place;
    const lat = Number(j.latitude), lng = Number(j.longitude);
    return { lat: (isFinite(lat) ? lat : null), lng: (isFinite(lng) ? lng : null), label: label };
  } catch (e) { return null; }
}
function applyGeo(label, lat, lng, approx) {
  S.homeGeo = { lat: lat, lng: lng, label: label, ts: Date.now(), approx: !!approx };
  const short = String(label).split(",")[0].trim();
  if (short) S.homeArea = short;
  persist(); refreshAreaPill();
}
/* Fully automatic location: GPS first, IP-based area when GPS is denied
   or unavailable. Both area pills call this — no manual picking needed. */
async function locateUser(opts) {
  const silent = !!(opts && opts.silent);
  if (!silent) toast("Getting your current location…");
  if (("geolocation" in navigator)) {
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 9000, maximumAge: 600000 }));
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      let label = await reverseLabel(lat, lng);
      if (!label) label = "My location · " + lat.toFixed(2) + ", " + lng.toFixed(2);
      applyGeo(label, lat, lng, false);
      if (!silent) toast("Location set: " + label);
      return;
    } catch (e) { /* fall through to automatic IP detection */ }
  }
  const ip = await ipGeo();
  if (ip) {
    applyGeo(ip.label, ip.lat, ip.lng, true);
    if (!silent) toast("Location set: " + ip.label + " (approximate)");
    return;
  }
  if (!silent) {
    cycleArea();
    toast("Couldn't detect location — picked " + (S.homeArea || AREAS[0]) + " instead");
  }
}
function renderHomeExtras() {
  updateAvatar();
  refreshAreaPill();
  updateNotificationBadge();
  const isArtisan = S.profile && S.profile.role === "artisan";
  document.querySelectorAll(".sp-hero, .sp-photo-wrap, .sp-help").forEach(el => { el.hidden = !!isArtisan; });
  document.getElementById("jobsWrap").hidden = !isArtisan;
  if (isArtisan) {
    document.getElementById("activeBanner").hidden = true;
    document.getElementById("upcomingWrap").hidden = true;
    renderJobs();
    return;
  }
  const a = S.bookings.find(b => b.id === S.activeId && ["dispatched", "enroute", "arrived"].includes(b.status));
  document.getElementById("activeBanner").hidden = !a;
  if (a) {
    const who = a.tech || "A matching artisan";
    document.getElementById("activeBannerText").textContent = a.status === "arrived" ? who + " has arrived" :
      a.tech ? who + " accepted your request" + (a.etaMin ? " · ETA " + a.etaMin + " min" : "") : "Finding an artisan for your request";
  }
  renderUpcoming();
}
let liveJobsSignature = null;
async function renderJobs(silent) {
  const box = document.getElementById("jobsList");
  const assignedBox = document.getElementById("assignedJobsList");
  if (!box) return;
  if (!LIVE_DB) { box.innerHTML = '<div class="glasscard p-4"><p class="font-display font-bold f15">Backend not connected</p><p class="f13 soft mt-1">Open requests appear here once you add your Supabase URL + anon key in public/config.js and reload.</p></div>'; return; }
  if (!silent || liveJobsSignature === null) {
    if (assignedBox) assignedBox.innerHTML = '<p class="f13 soft">Loading your accepted requests…</p>';
    box.innerHTML = '<p class="f14 soft">Finding open requests…</p>';
  }
  let jobs = [], assigned = [];
  try { jobs = await Backend.openJobs(); } catch (e) { jobs = []; }
  try { assigned = await Backend.assignedJobs(); } catch (e) { assigned = []; }
  const signature = JSON.stringify([
    jobs.map((job) => [job.id, job.status, job.serviceId, job.area, job.date, job.slot, job.total, job.desc]),
    assigned.map((job) => [job.id, job.status, job.serviceId, job.area, job.date, job.slot])
  ]);
  if (silent && signature === liveJobsSignature) return;
  liveJobsSignature = signature;
  if (assignedBox) {
    assignedBox.innerHTML = "";
    if (!assigned.length) assignedBox.innerHTML = '<p class="f13 soft">No accepted requests yet.</p>';
    assigned.forEach((job) => {
      const service = svc(job.serviceId) || { name: job.serviceId };
      const next = job.status === "enroute" ? "arrived" : job.status === "arrived" ? "working" : null;
      const action = next === "arrived" ? "Mark arrived" : next === "working" ? "Start work" : "";
      const card = document.createElement("div");
      card.className = "glasscard p-4";
      card.innerHTML = `<p class="font-display font-bold f15">${escapeHtml(service.name)} · ${escapeHtml(job.id)}</p>
        <p class="f12 soft mt-1">${escapeHtml(job.area || "")} · ${escapeHtml(job.date || "")} · ${escapeHtml(job.status)}</p>
        ${action ? '<button class="btn-dark mt-2 w-full font-display font-bold f14 rounded-2xl py-3 mh50" data-job-status="' + next + '"></button>' : '<p class="f12 soft mt-2">The customer will confirm completion after you finish.</p>'}`;
      const button = card.querySelector("[data-job-status]");
      if (button) {
        button.textContent = action;
        button.onclick = (event) => withButtonBusy(event.currentTarget, "Updating…", async () => {
          try {
            await Backend.apiPost("/api/bookings/status", { bookingId: job.id, status: next });
            toast(next === "arrived" ? "Customer notified that you have arrived." : "Customer notified that work has started.");
            await renderJobs();
          } catch (e) { toast(e.message || "Could not update this request."); }
        });
      }
      assignedBox.appendChild(card);
    });
  }
  box.innerHTML = "";
  if (!jobs.length) {
    box.innerHTML = S.profile && S.profile.isSuspended
      ? '<div class="glasscard p-4" role="status"><p class="font-display font-bold f15">Your artisan profile is suspended</p><p class="f13 soft mt-1">You cannot see or apply for new jobs. Existing accepted jobs remain available.</p></div>'
      : '<p class="f14 soft glasscard p-4">No open requests right now. New customer jobs appear here — check back soon.</p>';
  }
  jobs.slice(0, 20).forEach(j => {
    const s = svc(j.serviceId) || { name: j.serviceId, tint: "#F1F5F9", color: "#4A5268", icon: "" };
    const el = document.createElement("div");
    el.className = "glasscard p-4";
    el.innerHTML = `<div class="flex items-center gap-3">
      <span class="w-12 h-12 rounded-full grid place-items-center flex-none ${tintCls(s)}">${svcIcon(s, "w-6 h-6")}</span>
      <div class="flex-1 min-w-0"><p class="font-display font-extrabold f15 truncate">${s.name}</p>
      <p class="f12 soft">${j.area || ""} · ${j.date || ""} · ${j.slot || ""}</p></div>
      <span class="font-display font-extrabold f15">${gh(j.total || 0)}</span></div>
      ${j.desc ? `<p class="f13 soft mt-2">“${escapeHtml(j.desc)}”</p>` : ""}
      <button class="btn-dark mt-2 w-full font-display font-bold f14 rounded-2xl py-3 mh50">Apply for this job</button>`;
    el.querySelector("button").onclick = (event) => withButtonBusy(event.currentTarget, "Sending application…", () => applyForJob(j));
    box.appendChild(el);
  });
}
async function applyForJob(j) {
  if (!LIVE_DB) { toast("Backend not connected yet — add your Supabase keys in public/config.js"); return; }
  if (!S.profile || S.profile.role !== "artisan" || !Auth.googleUid()) { toast("Log in as an artisan to apply"); show("account"); return; }
  try {
    await Backend.apply(j);
    toast("Application sent — the customer will review it");
  } catch (e) { toast(e.message || "Could not apply — you may have already applied"); }
}

function renderUpcoming() {
  const wrap = document.getElementById("upcomingWrap"), box = document.getElementById("upcomingCard");
  if (!wrap || !box) return;
  const a = S.bookings.find(b => b.id === S.activeId && ["dispatched", "enroute", "arrived", "working"].includes(b.status));
  const target = a || [...S.bookings].sort((x, y) => String(y.date).localeCompare(String(x.date)))[0];
  if (!target) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const s = svc(target.serviceId) || { name: target.serviceId, tint: "#F1F5F9", color: "#4A5268", icon: "" };
  const provider = target.tech || "Waiting for a matching artisan";
  box.innerHTML = "";
  const d = document.createElement("div");
  d.className = "glasscard p-4 flex items-center gap-3";
  d.innerHTML = `<span class="w-12 h-12 rounded-full grid place-items-center flex-none ${tintCls(s)}">${svcIcon(s, "w-6 h-6")}</span>
    <div class="flex-1 min-w-0"><p class="f11 font-bold uptime">${a ? (target.status === "arrived" ? "Artisan arrived" : "Artisan accepted") + " · " + target.slot : (target.date || "") + " · " + (target.slot || "")}</p>
    <p class="font-display font-extrabold f15 truncate">${s.name}</p>
    <p class="f12 soft truncate">${escapeHtml(provider)} · ${escapeHtml(target.area || "")}</p></div>
    <button class="chipx on flex-none" id="upcomingView">View</button>`;
  box.appendChild(d);
  document.getElementById("upcomingView").onclick = () => show(a ? "track" : "history");
}
function updateNotificationBadge() {
  const nd = document.getElementById("notifDot");
  if (nd) nd.hidden = !APP_NOTIFICATIONS.some((notification) => !notification.read_at);
}
document.getElementById("activeBannerBtn").onclick = () => show("track");
document.querySelectorAll("[data-start]").forEach(b => { b.onclick = () => startBooking(b.dataset.start); });
document.getElementById("areaPill").onclick = () => { locateUser({ silent: false }); };
applySenior();
renderCats("");