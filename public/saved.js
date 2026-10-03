let kind = "all", rows = [];

function render() {
  if (!user) return $("list").replaceChildren(el("p", {}, "Sign in to see what you've saved. ",
    el("button", { className: "link", textContent: "Sign in", onclick: () => $("authDlg").showModal() })));
  const shown = rows.filter((c) => kind === "all" || (kind === "drink") === c.is_drink);
  if (!shown.length) return $("list").replaceChildren(el("p", { className: "muted" }, "Nothing here yet. ", el("a", { href: "/", textContent: "Start a mix" })));
  $("list").replaceChildren(...shown.map((c) => {
    const items = c.combo_items.sort((a, b) => a.position - b.position)
      .map((i) => (i.amount ? i.amount + " " : "") + i.ingredients.name).join(", ");
    const del = el("button", { className: "link", textContent: "Delete", onclick: async (e) => {
      e.preventDefault();
      if (!confirm(`Delete “${c.name}”?`)) return;
      const { error } = await sb.from("combos").delete().eq("id", c.id);
      if (error) return toast("Couldn't delete: " + error.message);
      rows = rows.filter((x) => x !== c); render();
    } });
    return el("a", { className: "saved", href: "/#combo=" + c.id },
      el("div", { className: "top" }, el("h2", { textContent: c.name }), el("span", { className: "label", textContent: c.is_drink ? "drink" : "combo" })),
      el("p", { className: "muted", textContent: items, style: "margin: 6px 0" }),
      c.notes ? el("p", { className: "faint", textContent: c.notes, style: "margin: 0 0 6px" }) : "", del);
  }));
}

async function load() {
  if (!user) return render();
  const { data, error } = await sb.from("combos")
    .select("id, name, notes, is_drink, combo_items(amount, position, ingredients(name))")
    .eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) return $("list").replaceChildren("Couldn't load: " + error.message);
  rows = data;
  render();
}
window.onUser = load;

$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  kind = b.dataset.kind;
  $("tabs").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  render();
});
