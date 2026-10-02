// Shared by every page: Supabase client, ingredient lookup, header, sign-in, toast.
// Supabase publishable key: safe in the browser, row level security limits it to reading suggestions
// and to each signed-in user's own saved combos.
const SUPABASE = "https://qadsopswciuagvepcuyh.supabase.co";
const KEY = "sb_publishable_s9VaMlYhtn9n6O1XfC6w0Q_iUfMGFZa";
const sb = supabase.createClient(SUPABASE, KEY);

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

// Work in progress (the mix, settings), so switching pages or reloading doesn't lose it.
// Browser storage can be blocked (private mode); then pages just start fresh.
const keep = {
  get(k) { try { return JSON.parse(localStorage.getItem("pourpair:" + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("pourpair:" + k, JSON.stringify(v)); } catch {} },
};

// Book strength from typography: plain 1, bold 2, BOLD CAPS 3, *BOLD CAPS 4.
const STRENGTH = { 4: "Classic match", 3: "Highly recommended", 2: "Recommended", 1: "Pairs well" };

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

const ready = (async () => {
  // PostgREST caps a response at 1000 rows, so page through all ingredients.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("ingredients").select("id, name, key, is_bar, taste, season, weight, volume")
      .order("name").range(from, from + 999);
    if (error) throw error;
    data.forEach((r) => { byName.set(r.name, r.id); byKey.set(r.key, r.name); byKey.set(r.name.toLowerCase(), r.name); byId.set(r.id, r); });
    if (data.length < 1000) break;
  }
  $("names")?.replaceChildren(...[...byId.values()].map((r) => el("option", { value: r.name })));
})();

// Each ingredient's pairings, fetched once: id -> Map(partner id -> { strength, note }).
const pairCache = new Map();
async function pairsOf(id) {
  if (!pairCache.has(id)) {
    const { data } = await sb.rpc("ingredient_pairings", { ing: id });
    pairCache.set(id, new Map((data || []).map((r) => [r.id, { strength: r.strength, note: r.note }])));
  }
  return pairCache.get(id);
}

// --- header ------------------------------------------------------------------------------
const PAGES = [["/", "Mix"], ["/saved.html", "Saved"]];
const here = location.pathname === "/index.html" ? "/" : location.pathname;
document.querySelector("header.top").append(
  el("div", { className: "brand" }, el("a", { className: "wordmark", href: "/", textContent: "pourpair" }),
    el("nav", {}, ...PAGES.map(([href, label]) => {
      const a = el("a", { href, textContent: label });
      if (href === here) a.setAttribute("aria-current", "page");
      return a;
    }))),
  el("div", { id: "account" }));

document.body.insertAdjacentHTML("beforeend", `
<datalist id="names"></datalist>
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

sb.auth.onAuthStateChange((event, session) => {
  user = session?.user || null;
  if (event === "PASSWORD_RECOVERY") $("pwDlg").showModal();
  setTimeout(() => { renderAccount(); window.onUser?.(); });   // never await sb calls inside this callback
});

function renderAccount() {
  const a = $("account");
  if (!user) return a.replaceChildren(el("button", { className: "link", textContent: "Sign in", onclick: () => $("authDlg").showModal() }));
  a.replaceChildren(user.email + " · ", el("button", { className: "link", textContent: "Sign out", onclick: () => sb.auth.signOut() }));
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

$("pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $("newPw").value });
  if (error) { $("pwErr").textContent = error.message; return; }
  $("newPw").value = "";
  $("pwDlg").close();
});
