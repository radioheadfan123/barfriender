// Shared by every page: Supabase client, ingredient lookup, header, sign-in, toast.
// Supabase publishable key: safe in the browser, row level security limits it to reading suggestions
// and to each signed-in user's own saved combos.
// Errors in visitors' browsers go to our own server log (Railway logs): message, file, line, page.
// No personal data, at most 5 per page view.
let reported = 0;
function report(msg, src, line) {
  if (reported++ >= 5) return;
  const body = JSON.stringify({ msg: String(msg).slice(0, 300), src: String(src || "").slice(0, 200), line, page: location.pathname });
  try { navigator.sendBeacon("/api/log", new Blob([body], { type: "application/json" })); } catch {}
}
addEventListener("error", (e) => report(e.message, e.filename, e.lineno));
addEventListener("unhandledrejection", (e) => report(e.reason?.message || e.reason, "promise", 0));

const SUPABASE = "https://qadsopswciuagvepcuyh.supabase.co";
const KEY = "sb_publishable_s9VaMlYhtn9n6O1XfC6w0Q_iUfMGFZa";
const sb = supabase.createClient(SUPABASE, KEY);

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

// Work in progress (the mix, settings), so switching pages or reloading doesn't lose it.
// Browser storage can be blocked (private mode); then pages just start fresh.
const keep = {
  get(k) { try { return JSON.parse(localStorage.getItem("barfriender:" + k) ?? localStorage.getItem("pourpair:" + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("barfriender:" + k, JSON.stringify(v)); } catch {} },
};

// Two levels: 2 = recommended (any bold in the book), 1 = pairs well.
const STRENGTH = { 2: "Recommended", 1: "Pairs well" };

function chip(item, onClick) {
  const s = item.strength || 1;
  const b = el("button", { className: "chip s" + s, onclick: onClick }, item.name);
  b.title = STRENGTH[s];
  if (item.note) b.append(el("small", { textContent: item.note }));
  return b;
}

// --- ingredients --------------------------------------------------------------------------
const byName = new Map();           // name -> id
const byKey = new Map();            // normalized key -> name, so 'lime' finds 'limes'
const byId = new Map();             // id -> row (name, is_bar, taste profile)

// Mirrors singular()/norm() in scripts/load.py, enough for what people type.
function singular(w) {
  if (w === "leaves") return "leaf";
  if (w.length > 3 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && /(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}
const norm = (n) => (n.toLowerCase().replace(/’/g, "'").match(/[\w'&-]+/g) || []).map(singular).join(" ");
const find = (typed) => byName.has(typed) ? typed : byKey.get(typed.toLowerCase()) || byKey.get(norm(typed));

// One calm banner instead of a broken page when Supabase is down or the network drops.
function offline() {
  if ($("offline")) return;
  document.querySelector("header.top").after(el("div", { id: "offline", className: "banner", role: "alert",
    textContent: "We can't reach the pairing database right now. Check your connection and refresh in a minute." }));
}

const ready = (async () => {
  // PostgREST caps a response at 1000 rows, so page through all ingredients.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("ingredients").select("id, name, key, is_bar, taste, season, weight, volume")
      .order("name").range(from, from + 999);
    if (error) { offline(); report("ingredients: " + error.message, "common.js", 0); return; }
    data.forEach((r) => { byName.set(r.name, r.id); byKey.set(r.key, r.name); byKey.set(r.name.toLowerCase(), r.name); byId.set(r.id, r); });
    if (data.length < 1000) break;
  }
})();

// Each ingredient's pairings, fetched once: id -> Map(partner id -> { strength, note }).
const pairCache = new Map();
async function pairsOf(id) {
  if (!pairCache.has(id)) {
    const { data, error } = await sb.rpc("ingredient_pairings", { ing: id });
    if (error) { offline(); return new Map(); }                // not cached, so a retry can succeed
    pairCache.set(id, new Map(data.map((r) => [r.id, { strength: r.strength, note: r.note }])));
  }
  return pairCache.get(id);
}

// --- header ------------------------------------------------------------------------------
const PAGES = [["/", "Mix"], ["/saved.html", "Saved"], ["/menus.html", "Menus"]];   // "Menus" is a working name
const page = (p) => p.replace(/\.html$/, "").replace(/^\/index$/, "/");   // /menus and /menus.html are the same page
const here = page(location.pathname);
document.querySelector("header.top").append(
  el("div", { className: "brand" }, el("a", { className: "wordmark", href: "/", textContent: "barfriender" }),
    el("nav", {}, ...PAGES.map(([href, label]) => {
      const a = el("a", { href, textContent: label });
      if (page(href) === here) a.setAttribute("aria-current", "page");
      return a;
    }))),
  el("div", { id: "account" }));

document.body.insertAdjacentHTML("beforeend", `
<div id="toast" role="status" hidden></div>

<dialog id="authDlg">
  <form id="authForm" class="stack">
    <h2>Sign in</h2>
    <input id="email" type="email" placeholder="Email" autocomplete="email" required aria-label="Email">
    <input id="password" type="password" placeholder="Password (8+ characters)" minlength="8" required
           autocomplete="current-password" aria-label="Password">
    <div class="err" id="authErr" aria-live="polite"></div>
    <div class="row">
      <button class="btn primary" value="signin">Sign in</button>
      <button class="link" value="signup">Create account</button>
      <button class="link" value="forgot" formnovalidate>Forgot password?</button>
      <button class="link" value="close" formnovalidate>Cancel</button>
    </div>
  </form>
</dialog>

<dialog id="accountDlg">
  <form id="accountForm" class="stack">
    <h2>Account</h2>
    <p class="muted">Signed in as <span id="accountEmail"></span></p>
    <div class="row"><button class="btn" value="signout">Sign out</button><button class="link" value="close" formnovalidate>Close</button></div>
    <h3>Delete my account</h3>
    <p class="faint">Deletes your account and your private saves for good. Drinks you added to shared menus stay for the others, and menus you own pass to another member.</p>
    <input id="deleteConfirm" placeholder="Type DELETE to confirm" aria-label="Type DELETE to confirm" autocomplete="off">
    <div class="err" id="accountErr" aria-live="polite"></div>
    <button class="btn danger" value="delete">Delete my account</button>
  </form>
</dialog>

<dialog id="pwDlg">
  <form id="pwForm" class="stack">
    <h2>Set a new password</h2>
    <input id="newPw" type="password" placeholder="New password (8+ characters)" minlength="8" required
           autocomplete="new-password" aria-label="New password">
    <div class="err" id="pwErr" aria-live="polite"></div>
    <button class="btn primary">Save password</button>
  </form>
</dialog>`);

// Short message with optional actions, e.g. Saved · Rename · Undo.
let toastTimer;
function toast(text, actions = {}) {
  clearTimeout(toastTimer);
  $("toast").replaceChildren(el("span", { textContent: text }),
    ...Object.entries(actions).map(([label, fn]) => el("button", { textContent: label, onclick: () => { $("toast").hidden = true; fn(); } })));
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 6000);
}

// --- accounts ---------------------------------------------------------------------------
let user = null;
// Pages hook in with whenUser(fn): fn runs now if sign-in status is already known, and again on every change.
// (The first auth event can fire before a page's own script has loaded; a plain onUser hook then never ran.)
let authKnown = false;
function whenUser(fn) { window.onUser = fn; if (authKnown) fn(); }

sb.auth.onAuthStateChange((event, session) => {
  user = session?.user || null;
  if (event === "PASSWORD_RECOVERY") $("pwDlg").showModal();
  setTimeout(() => { authKnown = true; renderAccount(); window.onUser?.(); });   // never await sb calls inside this callback
});

function renderAccount() {
  const a = $("account");
  if (!user) return a.replaceChildren(el("button", { className: "link", textContent: "Sign in", onclick: () => $("authDlg").showModal() }));
  a.replaceChildren(el("button", { className: "link", textContent: user.email, title: "Account", onclick: () => {
    $("accountEmail").textContent = user.email; $("deleteConfirm").value = ""; $("accountErr").textContent = ""; $("accountDlg").showModal();
  } }));
}

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const action = e.submitter?.value || "signin";
  const email = $("email").value.trim(), password = $("password").value;
  $("authErr").textContent = "";
  if (action === "close") return $("authDlg").close();
  if (action === "forgot") {
    if (!email) { $("authErr").textContent = "Type your email first."; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    $("authErr").textContent = error ? error.message : "Check your email for a reset link.";
    return;
  }
  const { error } = action === "signup"
    ? await sb.auth.signUp({ email, password })
    : await sb.auth.signInWithPassword({ email, password });
  if (error) { $("authErr").textContent = error.message; return; }
  $("password").value = "";
  $("authDlg").close();
});

$("accountForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const action = e.submitter?.value;
  if (action === "close") return $("accountDlg").close();
  if (action === "signout") { await sb.auth.signOut(); return $("accountDlg").close(); }
  if (action !== "delete") return;
  if ($("deleteConfirm").value.trim() !== "DELETE") { $("accountErr").textContent = "Type DELETE to confirm."; return; }
  const { error } = await sb.rpc("delete_my_account");
  if (error) { $("accountErr").textContent = error.message; return; }
  await sb.auth.signOut({ scope: "local" });
  $("accountDlg").close();
  toast("Your account has been deleted.");
});

document.body.append(el("footer", { className: "foot" }, el("a", { href: "/privacy.html", textContent: "Privacy" })));

$("pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $("newPw").value });
  if (error) { $("pwErr").textContent = error.message; return; }
  $("newPw").value = "";
  $("pwDlg").close();
});
