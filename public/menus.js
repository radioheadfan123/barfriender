// Menus: named collections of drinks and combos. Private while it's just you; shared once you make an
// invite link. Roles: owner (everything), editor (add, edit, remove drinks), viewer (look, copy to own saves).
// The database enforces all of this; the page only hides buttons people can't use.

const ROLE = { owner: "Owner", editor: "Can edit", viewer: "Can view" };
let channel = null, refreshTimer = null, current = null;

const hashView = () => ({
  menu: Number((location.hash.match(/^#menu=(\d+)$/) || [])[1]) || null,
  join: (location.hash.match(/^#join=([0-9a-f]{32})$/) || [])[1] || null,
});
const show = (...kids) => $("view").replaceChildren(...kids);

function stopLive() {
  if (channel) sb.removeChannel(channel);
  channel = null;
}

async function route() {
  stopLive();
  current = null;
  const v = hashView();
  if (!user) return show(el("h1", { textContent: "Menus" }),
    el("p", {}, v.join ? "Sign in to join this menu. " : "Sign in to make menus of your drinks and share them. ",
      el("button", { className: "link", textContent: "Sign in", onclick: () => $("authDlg").showModal() })));
  if (/^#join=/.test(location.hash) && !v.join) { toast("That invite link looks cut off. Ask for the link again."); location.hash = ""; return; }
  if (v.join) {
    const { data, error } = await sb.rpc("join_menu", { invite: v.join });
    if (error) { toast(error.message); location.hash = ""; return; }
    location.replace("#menu=" + data);           // fires hashchange -> route
    return;
  }
  return v.menu ? openMenu(v.menu) : listMenus();
}
whenUser(route);
addEventListener("hashchange", route);

// --- list -----------------------------------------------------------------------------------
async function listMenus() {
  const { data, error } = await sb.from("menus")
    .select("id, name, menu_members(user_id, role), combos(count)").order("created_at", { ascending: false });
  if (error) return show(el("p", { textContent: "Couldn't load menus: " + error.message }));

  const form = el("form", { className: "row", onsubmit: async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    const { data: m, error } = await sb.from("menus").insert({ name }).select("id").single();
    if (error) return toast("Couldn't create: " + error.message);
    location.hash = "#menu=" + m.id;
  } });
  const input = el("input", { placeholder: "New menu name, e.g. Fall cocktails", maxLength: 80, required: true, ariaLabel: "New menu name" });
  input.classList.add("grow");
  form.append(input, el("button", { className: "btn primary", textContent: "Create" }));

  show(el("div", { className: "toolbar" }, el("h1", { textContent: "Menus" })),
    el("p", { className: "faint", textContent: "Group drinks and combos. Keep a menu to yourself, or share a link so others can view or edit it with you, live." }),
    form,
    ...(data.length ? data.map((m) => {
      const me = m.menu_members.find((x) => x.user_id === user.id);
      const others = m.menu_members.length - 1;
      return el("a", { className: "saved", href: "#menu=" + m.id },
        el("div", { className: "top" }, el("h2", { textContent: m.name }), el("span", { className: "label", textContent: ROLE[me?.role] || "" })),
        el("p", { className: "muted tight", textContent: `${m.combos[0]?.count || 0} saved · ` + (others ? `shared with ${others} ${others === 1 ? "person" : "people"}` : "private") }));
    }) : [el("p", { className: "muted", textContent: "No menus yet." })]));
}

// --- one menu -------------------------------------------------------------------------------
async function openMenu(id) {
  const { data: m, error } = await sb.from("menus")
    .select("id, name, owner_id, menu_members(user_id, role, email), combos(id, name, notes, is_drink, combo_items(ingredient_id, amount, position, ingredients(name)))")
    .eq("id", id).maybeSingle();
  if (error || !m) { toast(error ? "Couldn't load: " + error.message : "That menu isn't available to you."); location.hash = ""; return; }
  const role = m.menu_members.find((x) => x.user_id === user.id)?.role;
  const invite = role === "owner" ? (await sb.from("menu_invites").select("code, role").eq("menu_id", id).maybeSingle()).data : null;
  current = { ...m, role, invite };
  renderMenu();
  if (!channel) live(id);
}

function renderMenu() {
  const m = current, canEdit = m.role === "owner" || m.role === "editor";
  const others = m.menu_members.length - 1;
  const actions = el("div", { className: "row" });
  if (canEdit) actions.append(el("button", { className: "btn primary", textContent: "Add from your saves", onclick: openAdd }));
  if (m.role === "owner") actions.append(
    el("button", { className: "link", textContent: "Rename", onclick: () => { $("nameInput").value = m.name; $("nameDlg").showModal(); } }),
    el("button", { className: "link", textContent: "Delete menu", onclick: deleteMenu }));
  else actions.append(el("button", { className: "link", textContent: "Leave menu", onclick: leaveMenu }));

  const drinks = m.combos.length ? m.combos.map((c) => {
    const items = c.combo_items.sort((a, b) => a.position - b.position)
      .map((i) => (i.amount ? i.amount + " " : "") + i.ingredients.name).join(", ");
    const card = el("a", { className: "saved", href: "/#combo=" + c.id },
      el("div", { className: "top" }, el("h2", { textContent: c.name }), el("span", { className: "label", textContent: c.is_drink ? "drink" : "combo" })),
      el("p", { className: "muted tight", textContent: items }),
      c.notes ? el("p", { className: "faint tight", textContent: c.notes }) : "");
    if (canEdit) card.append(el("button", { className: "link", textContent: "Remove from menu", onclick: async (e) => {
      e.preventDefault();
      if (!confirm(`Remove “${c.name}” from this menu?`)) return;
      const { error } = await sb.from("combos").delete().eq("id", c.id);
      if (error) return toast("Couldn't remove: " + error.message);
      refreshSoon();
    } }));
    return card;
  }) : [el("p", { className: "muted", textContent: canEdit ? "Nothing here yet. Add drinks and combos from your saves." : "Nothing here yet." })];

  show(el("a", { href: "#", className: "label", textContent: "← Menus" }),
    el("div", { className: "toolbar" }, el("h1", { textContent: m.name }),
      el("span", { className: "label", textContent: (others ? `Shared · ${ROLE[m.role]}` : "Private") + (channel ? " · updates live" : "") })),
    m.role === "viewer" ? el("p", { className: "faint", textContent: "You can view this menu. Open a drink to make your own copy in Mix." }) : "",
    actions, m.role === "owner" ? shareBox() : "", ...drinks,
    others || m.role === "owner" ? membersBox() : "");
}

function shareBox() {
  const m = current, box = el("section", { className: "card" }, el("h2", { textContent: "Share" }));
  if (!m.invite) {
    box.append(el("p", { className: "faint", textContent: "Make a link. Anyone signed in who opens it joins this menu." }),
      el("div", { className: "row" },
        el("button", { className: "btn", textContent: "Link that can edit", onclick: () => makeLink("editor") }),
        el("button", { className: "btn", textContent: "Link that can view", onclick: () => makeLink("viewer") })));
    return box;
  }
  const url = `${location.origin}/menus.html#join=${m.invite.code}`;
  const field = el("input", { value: url, readOnly: true, ariaLabel: "Invite link" });
  field.classList.add("grow");
  box.append(el("p", { className: "faint", textContent: `Anyone with this link joins and ${m.invite.role === "editor" ? "can edit" : "can view"}.` }),
    el("div", { className: "row" }, field, el("button", { className: "btn primary", textContent: "Copy", onclick: async () => {
      try { await navigator.clipboard.writeText(url); toast("Link copied."); } catch { field.select(); toast("Press Ctrl+C to copy."); }
    } })),
    el("div", { className: "row" },
      el("button", { className: "link", textContent: m.invite.role === "editor" ? "Make it view-only" : "Let it edit", onclick: () => makeLink(m.invite.role === "editor" ? "viewer" : "editor", true) }),
      el("button", { className: "link", textContent: "New link (old one stops working)", onclick: () => makeLink(m.invite.role, true) }),
      el("button", { className: "link", textContent: "Turn off link", onclick: async () => {
        const { error } = await sb.from("menu_invites").delete().eq("menu_id", m.id);
        if (error) return toast("Couldn't turn off: " + error.message);
        refreshSoon();
      } })));
  return box;
}

// A role change keeps the link; "new link" swaps the code so the old one stops working.
async function makeLink(role, existing = false) {
  const m = current;
  const q = existing
    ? sb.from("menu_invites").update(role === m.invite.role ? { code: newCode() } : { role }).eq("menu_id", m.id)
    : sb.from("menu_invites").insert({ menu_id: m.id, role });
  const { error } = await q;
  if (error) return toast("Couldn't update the link: " + error.message);
  refreshSoon();
}
const newCode = () => crypto.randomUUID().replaceAll("-", "");

function membersBox() {
  const m = current, box = el("section", { className: "card" }, el("h2", { textContent: "People" }));
  for (const p of [...m.menu_members].sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0))) {
    const row = el("div", { className: "row between" }, el("span", { textContent: (p.email || "Someone") + (p.user_id === user.id ? " (you)" : "") }));
    if (m.role === "owner" && p.role !== "owner") {
      const sel = el("select", { ariaLabel: "Role for " + (p.email || "member"), onchange: async () => {
        const { error } = await sb.from("menu_members").update({ role: sel.value }).eq("menu_id", m.id).eq("user_id", p.user_id);
        if (error) return toast("Couldn't change role: " + error.message);
        refreshSoon();
      } }, ...["editor", "viewer"].map((r) => el("option", { value: r, textContent: ROLE[r], selected: p.role === r })));
      row.append(el("span", { className: "row" }, sel, el("button", { className: "link", textContent: "Remove", onclick: async () => {
        if (!confirm(`Remove ${p.email || "this person"} from the menu?`)) return;
        const { error } = await sb.from("menu_members").delete().eq("menu_id", m.id).eq("user_id", p.user_id);
        if (error) return toast("Couldn't remove: " + error.message);
        refreshSoon();
      } })));
    } else row.append(el("span", { className: "label", textContent: ROLE[p.role] }));
    box.append(row);
  }
  return box;
}

// --- actions --------------------------------------------------------------------------------
async function openAdd() {
  const { data, error } = await sb.from("combos").select("id, name, notes, is_drink, combo_items(ingredient_id, amount, position)")
    .eq("user_id", user.id).is("menu_id", null).order("created_at", { ascending: false });
  if (error) return toast("Couldn't load your saves: " + error.message);
  $("addList").replaceChildren(...(data.length ? data.map((c) => el("label", { className: "pick" },
    Object.assign(el("input", { type: "checkbox", value: c.id }), { combo: c }), el("span", { textContent: c.name })))
    : [el("p", { className: "muted" }, "You haven't saved anything yet. ", el("a", { href: "/", textContent: "Start a mix" }))]));
  $("addDlg").showModal();
}

$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.submitter?.value === "close") return $("addDlg").close();
  let picked = [...$("addList").querySelectorAll("input:checked")].map((i) => i.combo);
  $("addDlg").close();
  // Adding copies, so adding the same save twice makes a duplicate: ask first. Cancel skips just those.
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const dupes = picked.filter((c) => current.combos.some((x) => same(x.name, c.name)));
  if (dupes.length && !confirm(`This menu already has ${dupes.map((c) => `“${c.name}”`).join(", ")}. Add another copy?`
    + (dupes.length < picked.length ? " (Cancel adds the others without it.)" : ""))) picked = picked.filter((c) => !dupes.includes(c));
  for (const c of picked) {
    const err = await copyInto(current.id, c);
    if (err) { toast("Couldn't add “" + c.name + "”: " + err.message); break; }
  }
  if (picked.length) { toast(`Added ${picked.length} to the menu.`); refreshSoon(); }
});

async function copyInto(menuId, c) {
  const { data, error } = await sb.from("combos")
    .insert({ user_id: user.id, menu_id: menuId, name: c.name, notes: c.notes, is_drink: c.is_drink }).select("id").single();
  if (error) return error;
  const items = c.combo_items.map((i) => ({ combo_id: data.id, ingredient_id: i.ingredient_id, amount: i.amount, position: i.position }));
  return items.length ? (await sb.from("combo_items").insert(items)).error : null;
}

$("nameForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.submitter?.value === "close") return $("nameDlg").close();
  const name = $("nameInput").value.trim();
  if (!name) { $("nameInput").value = ""; return $("nameInput").reportValidity(); }
  const { error } = await sb.from("menus").update({ name }).eq("id", current.id);
  $("nameDlg").close();
  if (error) return toast("Couldn't rename: " + error.message);
  refreshSoon();
});

async function deleteMenu() {
  if (!confirm(`Delete “${current.name}” for everyone? The drinks in it are deleted too. Everyone's own saves stay.`)) return;
  const { error } = await sb.from("menus").delete().eq("id", current.id);
  if (error) return toast("Couldn't delete: " + error.message);
  location.hash = "";
}

async function leaveMenu() {
  if (!confirm(`Leave “${current.name}”? You'll need a new link to come back.`)) return;
  const { error } = await sb.from("menu_members").delete().eq("menu_id", current.id).eq("user_id", user.id);
  if (error) return toast("Couldn't leave: " + error.message);
  location.hash = "";
}

// --- live updates ---------------------------------------------------------------------------
// Any change to this menu or its drinks (item edits bump their drink) reloads the view.
// Deletes can't be filtered server-side, so a delete anywhere also triggers a cheap reload.
function live(id) {
  channel = sb.channel("menu-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "combos", filter: `menu_id=eq.${id}` }, refreshSoon)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "combos" }, refreshSoon)
    .on("postgres_changes", { event: "*", schema: "public", table: "menus", filter: `id=eq.${id}` }, refreshSoon)
    .subscribe((status) => { if (status === "SUBSCRIBED" && current) renderMenu(); });
}

function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (current) openMenu(current.id); }, 400);
}
