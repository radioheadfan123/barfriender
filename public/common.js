// Shared by every page: Supabase client, ingredient lookup, nav, sign-in, saved combos.
// Supabase publishable key: safe in the browser, row level security limits it to reading suggestions
// and to each signed-in user's own combos.
const SUPABASE = "https://qadsopswciuagvepcuyh.supabase.co";
const KEY = "sb_publishable_s9VaMlYhtn9n6O1XfC6w0Q_iUfMGFZa";
const sb = supabase.createClient(SUPABASE, KEY);

const $ = (id) => document.getElementById(id);

// Per-page work in progress (picks, explored ingredient, the glass), so switching tabs doesn't lose it.
// Browser storage can be blocked (private mode); then pages just start fresh.
const keep = {
  get(k) { try { return JSON.parse(localStorage.getItem("pourpair:" + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("pourpair:" + k, JSON.stringify(v)); } catch {} },
};
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

// Book strength from typography: plain 1, bold 2, BOLD CAPS 3, *BOLD CAPS 4.
const STRENGTH = { 4: "Classic match", 3: "Highly recommended", 2: "Recommended", 1: "Pairs well" };

function chip(item, cls, onClick) {
  const s = item.strength || 0;
  const b = el("button", { className: "chip " + cls + (s === 4 ? " classic" : s === 3 ? " strong" : ""), onclick: onClick },
    cls === "picked" ? item.name + " ×" : item.name);
  if (s) b.title = STRENGTH[s];
  if (item.note) b.append(" ", el("small", { textContent: item.note }));
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
  const opts = (rows) => rows.map((r) => el("option", { value: r.name }));
  $("names").replaceChildren(...opts([...byId.values()]));
})();

// --- page shell: nav + dialogs ---------------------------------------------------------------
const PAGES = [["/", "Pair"], ["/explore.html", "Explore"], ["/craft.html", "Craft"]];
const here = location.pathname === "/index.html" ? "/" : location.pathname;
document.querySelector("header").after(el("nav", {}, ...PAGES.map(([href, label]) => {
  const a = el("a", { href, textContent: label });
  if (href === here) a.setAttribute("aria-current", "page");
  return a;
})));

document.body.insertAdjacentHTML("beforeend", `
<datalist id="names"></datalist>

<dialog id="authDlg">
  <form id="authForm" class="stack">
    <h2>Sign in</h2>
    <input id="email" type="email" placeholder="Email" autocomplete="email" required aria-label="Email">
    <input id="password" type="password" placeholder="Password (8+ characters)" minlength="8" required
           autocomplete="current-password" aria-label="Password">
    <div class="err" id="authErr" aria-live="polite"></div>
    <div class="row">
      <button class="primary" value="signin">Sign in</button>
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
    <button class="primary">Save password</button>
  </form>
</dialog>

<dialog id="comboDlg">
  <form id="comboForm" class="stack">
    <input id="cName" placeholder="Name" maxlength="80" required aria-label="Name">
    <div id="cItems"></div>
    <input id="cAdd" list="names" placeholder="Add an ingredient" autocomplete="off" aria-label="Add an ingredient">
    <textarea id="cNotes" rows="4" placeholder="Notes: method, glass, garnish, ideas" aria-label="Notes"></textarea>
    <div class="err" id="comboErr" aria-live="polite"></div>
    <div class="row">
      <button class="primary" value="save">Save</button>
      <button class="link" value="show" formnovalidate id="cShow">See pairings</button>
      <button class="link" value="delete" formnovalidate id="cDelete">Delete</button>
      <button class="link" value="close" formnovalidate>Close</button>
    </div>
  </form>
</dialog>`);

// --- accounts ---------------------------------------------------------------------------
let user = null;

sb.auth.onAuthStateChange((event, session) => {
  user = session?.user || null;
  if (event === "PASSWORD_RECOVERY") $("pwDlg").showModal();
  setTimeout(() => { renderAccount(); loadCombos(); window.onUser?.(); });   // never await sb calls inside this callback
});

function renderAccount() {
  const a = $("account");
  if (!user) {
    a.replaceChildren(el("button", { className: "link", textContent: "Sign in", onclick: () => $("authDlg").showModal() }));
    return;
  }
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

// --- saved combos -----------------------------------------------------------------------
// A combo is a name, ingredients with optional amounts ('2 oz', 'dash'), and notes.
// A drink is a combo with is_drink set; it opens in Craft instead of Pair.
let editing = null;   // { id: number|null, is_drink, items: [{ id, name, amount }] }

async function loadCombos() {
  if (!$("mine")) return;
  $("mine").hidden = !user;
  if (!user) return;
  const { data, error } = await sb.from("combos")
    .select("id, name, notes, is_drink, combo_items(ingredient_id, amount, position, ingredients(name))")
    .eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) { $("comboList").textContent = "Couldn't load your combos: " + error.message; return; }
  if (!data.length) { $("comboList").textContent = "Nothing saved yet."; return; }
  $("comboList").replaceChildren(...data.map((c) => {
    const items = c.combo_items.sort((a, b) => a.position - b.position)
      .map((i) => ({ id: i.ingredient_id, name: i.ingredients.name, amount: i.amount || "" }));
    const b = el("button", { className: "combo" }, c.name);
    if (c.is_drink) b.append(el("span", { className: "tag", textContent: "drink" }));
    b.append(el("small", { textContent: items.map((i) => (i.amount ? i.amount + " " : "") + i.name).join(", ") }));
    b.onclick = () => openCombo({ ...c, notes: c.notes || "", items });
    return b;
  }));
}

function openCombo(c) {
  editing = { id: c.id, is_drink: !!c.is_drink, items: c.items };
  $("cName").value = c.name;
  $("cNotes").value = c.notes;
  $("cDelete").hidden = c.id === null;
  $("cShow").textContent = c.is_drink ? "Open in Craft" : "See pairings";
  $("comboErr").textContent = "";
  renderItems();
  $("comboDlg").showModal();
}

function renderItems() {
  $("cItems").replaceChildren(...editing.items.map((it) => {
    const amt = el("input", { value: it.amount, placeholder: "amount", maxLength: 40, oninput: (e) => { it.amount = e.target.value; } });
    amt.setAttribute("aria-label", "Amount of " + it.name);
    const rm = el("button", { type: "button", className: "link", textContent: "×",
      onclick: () => { editing.items = editing.items.filter((x) => x !== it); renderItems(); } });
    rm.setAttribute("aria-label", "Remove " + it.name);
    return el("div", { className: "item" }, el("span", { textContent: it.name }), amt, rm);
  }));
}

function addToCombo() {
  const typed = $("cAdd").value.trim(), name = find(typed), id = byName.get(name);
  if (!typed) return;
  if (!id) { $("comboErr").textContent = `No ingredient called "${typed}".`; return; }
  if (!editing.items.some((i) => i.id === id)) editing.items.push({ id, name, amount: "" });
  $("cAdd").value = "";
  $("comboErr").textContent = "";
  renderItems();
}
$("cAdd").addEventListener("change", addToCombo);
$("cAdd").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addToCombo(); } });   // Enter adds, not saves

$("comboForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const action = e.submitter?.value || "save";
  const err = (m) => { $("comboErr").textContent = m; };
  if (action === "close") return $("comboDlg").close();
  if (action === "show") {
    $("comboDlg").close();
    if (editing.is_drink) { if (editing.id !== null) location.href = "/craft.html#combo=" + editing.id; return; }
    location.href = "/#ids=" + editing.items.map((i) => i.id).join(",");
    return;
  }
  if (action === "delete") {
    if (!confirm("Delete this?")) return;
    const { error } = await sb.from("combos").delete().eq("id", editing.id);
    if (error) return err(error.message);
    $("comboDlg").close();
    window.onComboSaved?.(null);
    return loadCombos();
  }
  if (!editing.items.length) return err("Add at least one ingredient.");
  const fields = { name: $("cName").value.trim(), notes: $("cNotes").value.trim() || null, is_drink: editing.is_drink };
  let id = editing.id;
  if (id === null) {
    const { data, error } = await sb.from("combos").insert({ ...fields, user_id: user.id }).select("id").single();
    if (error) return err(error.message);
    id = editing.id = data.id;
  } else {
    const { error } = await sb.from("combos").update(fields).eq("id", id);
    if (error) return err(error.message);
  }
  // Upsert first, then drop removed rows, so a failed save never loses what was there.
  const rows = editing.items.map((it, position) =>
    ({ combo_id: id, ingredient_id: it.id, amount: it.amount.trim() || null, position }));
  const up = await sb.from("combo_items").upsert(rows, { onConflict: "combo_id,ingredient_id" });
  if (up.error) return err(up.error.message);
  const del = await sb.from("combo_items").delete().eq("combo_id", id)
    .not("ingredient_id", "in", `(${rows.map((r) => r.ingredient_id).join(",")})`);
  if (del.error) return err(del.error.message);
  $("comboDlg").close();
  window.onComboSaved?.(id);
  loadCombos();
});
