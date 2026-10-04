// --- state ---------------------------------------------------------------------------------
const fresh = () => ({ items: [], notes: "", name: "", savedId: null, showAmounts: false });
let mix = { ...fresh(), ...(keep.get("mix") || {}) };          // items: [{ id, name, amount }]
let barOnly = keep.get("barOnly") ?? true;
let checked = new Set();                                        // filter: show what pairs with these
let exploring = null;                                           // id open in the panel
const expanded = new Set();                                     // suggestion groups showing everything

const ids = () => mix.items.map((i) => i.id);
const name = (id) => byId.get(id).name;
function changed() { keep.set("mix", mix); render(); }

function add(typed) {
  const n = find(typed), id = byName.get(n);
  if (!id) { if (typed) toast(`No ingredient called "${typed}". Try the dropdown.`); return; }
  if (!ids().includes(id) && mix.items.length >= 30) { toast("A mix can have up to 30 ingredients."); return; }
  if (!ids().includes(id)) mix.items.push({ id, name: n, amount: "" });
  $("search").value = "";
  changed();
}
// Our own dropdown: phone browsers barely show a <datalist> while you type.
const search = $("search"), matches = $("matches");
let shown = [], active = -1;
function showMatches() {
  shown = matchNames([...byName.keys()], search.value);                       // pairing.js
  active = shown.length ? 0 : -1;
  matches.replaceChildren(...shown.map((n, i) => el("li", { id: "m" + i, role: "option", textContent: n,
    onpointerdown: (e) => e.preventDefault(),                                   // keep focus (and the keyboard) on the input
    onclick: () => { add(n); closeMatches(); } })));
  highlight();
}
function highlight() {
  [...matches.children].forEach((li, i) => li.setAttribute("aria-selected", i === active));
  matches.hidden = !shown.length;
  search.setAttribute("aria-expanded", shown.length > 0);
  active >= 0 ? search.setAttribute("aria-activedescendant", "m" + active) : search.removeAttribute("aria-activedescendant");
}
function closeMatches() { shown = []; active = -1; highlight(); }
search.addEventListener("input", showMatches);
search.addEventListener("blur", closeMatches);
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!shown.length) return;
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
    highlight(); matches.children[active].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    add(active >= 0 ? shown[active] : search.value.trim());
    closeMatches();
  } else if (e.key === "Escape") closeMatches();
});

// --- the mix -------------------------------------------------------------------------------
function renderMix() {
  $("pills").replaceChildren(...mix.items.map((it) => el("span", { className: "pill" + (it.id === exploring ? " on" : "") },
    el("button", { className: "name", textContent: it.name, title: "Explore " + it.name, onclick: () => explore(it.id) }),
    Object.assign(el("button", { className: "x", textContent: "×", onclick: () => {
      mix.items = mix.items.filter((x) => x !== it); checked.delete(it.id); changed(); } }), { ariaLabel: "Remove " + it.name }))));
  const has = mix.items.length > 0;
  $("actions").hidden = $("mixLinks").hidden = $("suggest").hidden = !has;
  if (!has) $("together").textContent = "Add an ingredient to start. Tap anything in your mix to explore it.";
  $("amounts").hidden = !(has && mix.showAmounts);
  $("amountsBtn").textContent = mix.showAmounts ? "Hide amounts" : "+ Add amounts and notes";
  $("mixName").value = mix.name;
  $("notes").value = mix.notes;
  $("amountRows").replaceChildren(...mix.items.map((it) => el("div", { className: "item" }, el("span", { textContent: it.name }),
    Object.assign(el("input", { value: it.amount, placeholder: "amount", maxLength: 40,
      oninput: (e) => { it.amount = e.target.value; keep.set("mix", mix); } }), { ariaLabel: "Amount of " + it.name }))));
  $("saveBtn").textContent = mix.savedId ? "Save changes" : "Save";
}
$("amountsBtn").onclick = () => { mix.showAmounts = !mix.showAmounts; changed(); };
$("clearBtn").onclick = () => { mix = fresh(); checked.clear(); changed(); };
$("mixName").oninput = (e) => { mix.name = e.target.value; keep.set("mix", mix); };
$("notes").oninput = (e) => { mix.notes = e.target.value; keep.set("mix", mix); };

// --- suggestions, grouped by exactly which mix ingredients they pair with --------------------
// A label plus one bubble per group, e.g. Pair well together [rum + limes] [mint + sugar].
const bubbles = (label, texts, cls) => el("div", { className: "bubbles " + cls },
  el("span", { className: "label", textContent: label }), ...texts.map((t) => el("span", { className: "bubble", textContent: t })));

async function suggest() {
  const list = ids();
  if (!list.length) return;
  const pm = new Map(await Promise.all(list.map(async (id) => [id, await pairsOf(id)])));
  if (ids().join() !== list.join()) return;                    // mix changed while loading

  const tg = list.length > 1 ? together(list, pm) : [];
  const alone = list.filter((id) => list.length > 1 && !tg.some((g) => g.includes(id)));
  $("together").replaceChildren(...(tg.length === 1 && tg[0].length === list.length
    ? [el("span", { className: "ok", textContent: list.length === 2 ? "These two pair well." : `All ${list.length} pair well together.` })]
    : [tg.length ? bubbles("Pair well together", tg.map((g) => g.map(name).join(" + ")), "ok") : "",
       alone.length ? bubbles("No known pairing yet", alone.map(name), "") : ""]));

  const sorted = suggestionGroups(list, pm, byId, { barOnly, checked });   // pairing.js

  $("filter").hidden = list.length < 2;
  $("filter").replaceChildren("Only show what pairs with:", ...list.map((id) => el("label", {},
    el("input", { type: "checkbox", checked: checked.has(id), onchange: (e) => { e.target.checked ? checked.add(id) : checked.delete(id); suggest(); } }),
    name(id))));
  $("status").textContent = sorted.length ? "Strongest first. Tap one to add it." : barOnly ? "Nothing on the bar list. Try turning off Bar only." : "No suggestions.";
  $("groups").replaceChildren(...sorted.map((g) => {
    const k = g.with.join(","), all = g.with.length === list.length && list.length > 1, only = g.with.length === 1 && list.length > 1;
    const title = all ? (list.length === 2 ? "Pairs with both" : `Pairs with all ${list.length}`)
      : only ? "Only " + name(g.with[0]) : "Pairs with " + g.with.map(name).join(" + ");
    const shown = expanded.has(k) ? g.items : g.items.slice(0, 10);
    const chips = shown.map((r) => chip(r, () => add(r.name)));
    if (shown.length < g.items.length) chips.push(el("button", { className: "chip more", textContent: `+${g.items.length - shown.length} more`,
      onclick: () => { expanded.add(k); suggest(); } }));
    return el("section", { className: "group" + (all ? " all" : only ? " only" : "") },
      el("h3", {}, title, el("small", { textContent: g.items.length })), el("div", { className: "chips" }, ...chips));
  }));
}
$("barOnly").checked = barOnly;
$("barOnly").onchange = (e) => { barOnly = e.target.checked; keep.set("barOnly", barOnly); suggest(); };

// --- explore panel ---------------------------------------------------------------------------
async function explore(id) {
  exploring = id;
  const ing = byId.get(id);
  $("layout").classList.add("open");
  $("panel").hidden = false;
  renderMix();
  const inMix = ids().includes(id);
  const head = el("div", { className: "mixrow" },
    el("div", {}, el("span", { className: "label", textContent: "Explore" }), el("h2", { textContent: ing.name })),
    Object.assign(el("button", { className: "close", textContent: "×", onclick: closePanel }), { ariaLabel: "Close" }));
  const profile = [ing.taste, ing.weight, ing.volume && ing.volume + " flavor", ing.season].filter(Boolean).join(" · ");
  const action = inMix ? el("p", { className: "ok", textContent: "In your mix." })
    : el("button", { className: "btn primary", textContent: "Add to mix", onclick: () => { add(ing.name); explore(id); } });
  $("panel").replaceChildren(head, profile ? el("p", { className: "muted", textContent: profile }) : "", action);

  const [pm, aff] = await Promise.all([pairsOf(id), sb.from("affinities").select("ingredient_ids").contains("ingredient_ids", [id])]);
  if (exploring !== id) return;                                // moved on while loading
  const combos = (aff.data || []).map((a) => a.ingredient_ids.filter((i) => byId.has(i)));
  if (combos.length) {
    const box = el("div", { className: "combos" });
    const link = (c) => el("a", { href: "#", textContent: c.map(name).join(" + "),
      onclick: (e) => { e.preventDefault(); c.forEach((i) => ids().includes(i) || mix.items.push({ id: i, name: name(i), amount: "" })); changed(); explore(id); } });
    const fill = (n) => box.replaceChildren(el("span", { className: "label", textContent: `Classic combos · ${combos.length} · tap to add` }),
      ...combos.slice(0, n).map(link), ...(combos.length > n ? [el("button", { className: "link", textContent: `+${combos.length - n} more`, onclick: () => fill(combos.length) })] : []));
    fill(5);
    $("panel").append(box);
  }
  const rows = [...pm].map(([pid, p]) => ({ id: pid, name: name(pid), ...p })).filter((r) => byId.has(r.id));
  for (const s of [2, 1]) {
    const list = rows.filter((r) => r.strength === s).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) continue;
    const box = el("div", { className: "chips" });
    const fill = (n) => box.replaceChildren(...list.slice(0, n).map((r) => chip(r, () => explore(r.id))),
      ...(list.length > n ? [el("button", { className: "chip more", textContent: `+${list.length - n} more`, onclick: () => fill(list.length) })] : []));
    fill(12);
    $("panel").append(el("div", { className: "stack" }, el("span", { className: "label", textContent: `${STRENGTH[s]} · ${list.length}` }), box));
  }
}
function closePanel() { exploring = null; $("panel").hidden = true; $("layout").classList.remove("open"); renderMix(); }

// --- saving: one tap, auto name, Rename / Undo in the toast ----------------------------------
const autoName = () => mix.items.map((i) => i.name).join(" + ").slice(0, 80);

async function writeItems(id, items) {
  const rows = items.map((it, position) => ({ combo_id: id, ingredient_id: it.id, amount: it.amount.trim() || null, position }));
  // Upsert first, then drop removed rows, so a failed save never loses what was there.
  const up = await sb.from("combo_items").upsert(rows, { onConflict: "combo_id,ingredient_id" });
  if (up.error) return up.error;
  const del = await sb.from("combo_items").delete().eq("combo_id", id).not("ingredient_id", "in", `(${rows.map((r) => r.ingredient_id).join(",")})`);
  return del.error;
}

async function save(andNew) {
  if (!user) return $("authDlg").showModal();
  if (!mix.items.length) return;
  const snapshot = structuredClone(mix);
  const fields = { name: mix.name.trim() || autoName(), notes: mix.notes.trim() || null, is_drink: mix.items.some((i) => i.amount.trim()) };
  let id = mix.savedId, isNew = id === null, error;
  if (isNew) {
    const res = await sb.from("combos").insert({ ...fields, user_id: user.id }).select("id").single();
    error = res.error; id = res.data?.id;
  } else ({ error } = await sb.from("combos").update(fields).eq("id", id));
  error = error || await writeItems(id, mix.items);
  if (error) return toast("Couldn't save: " + error.message);
  if (andNew) { mix = fresh(); checked.clear(); closePanel(); } else { mix.savedId = id; mix.name = fields.name; }
  changed();
  toast(`Saved “${fields.name}”`, {
    Rename: () => { $("renameInput").value = fields.name; $("renameDlg").dataset.id = id; $("renameDlg").showModal(); },
    ...(isNew ? { Undo: async () => {
      await sb.from("combos").delete().eq("id", id);
      mix = snapshot; mix.savedId = null; changed(); toast("Undone.");
    } } : {}),
  });
}
$("saveBtn").onclick = () => save(false);
$("saveNewBtn").onclick = () => save(true);

$("renameForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.submitter?.value === "close") return $("renameDlg").close();
  const id = Number($("renameDlg").dataset.id), n = $("renameInput").value.trim();
  const { error } = await sb.from("combos").update({ name: n }).eq("id", id);
  $("renameDlg").close();
  if (error) return toast("Couldn't rename: " + error.message);
  if (mix.savedId === id) { mix.name = n; changed(); }
  toast(`Renamed to “${n}”`);
});

// --- start ---------------------------------------------------------------------------------
function render() { renderMix(); suggest(); }

// '#combo=12' opens a saved combo from the Saved page; '#ids=1,2' adds ingredients.
async function fromHash() {
  const c = location.hash.match(/^#combo=(\d+)$/), l = location.hash.match(/^#ids=([\d,]+)$/);
  if (c) {
    const { data } = await sb.from("combos").select("id, name, notes, menu_id, combo_items(ingredient_id, amount, position)").eq("id", c[1]).maybeSingle();
    // From a shared menu: editors save back into the menu; viewers save their own copy.
    const role = data?.menu_id ? (await sb.rpc("menu_role", { m: data.menu_id })).data : null;
    if (role === "viewer") toast("You can view this menu, so saving makes your own copy.");
    else if (role) toast("Changes you save go to the shared menu.");
    if (data) mix = { savedId: role === "viewer" ? null : data.id, name: data.name, notes: data.notes || "",
      items: data.combo_items.sort((a, b) => a.position - b.position).filter((i) => byId.has(i.ingredient_id))
        .map((i) => ({ id: i.ingredient_id, name: name(i.ingredient_id), amount: i.amount || "" })),
      showAmounts: data.combo_items.some((i) => i.amount) };
  }
  if (l) l[1].split(",").map(Number).filter((id) => byId.has(id) && !ids().includes(id)).forEach((id) => mix.items.push({ id, name: name(id), amount: "" }));
  if (c || l) history.replaceState(null, "", "/");
  checked.clear();
  changed();
}
window.addEventListener("hashchange", fromHash);
ready.then(fromHash);
