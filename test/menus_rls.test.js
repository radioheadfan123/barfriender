// Checks who can see and change menus, members, invites and combos, against the real database.
// Everything runs inside one transaction that is rolled back, so nothing is left behind.
// Needs the connection string in .env (DATABASE_URL=... or the bare URL); skipped without it.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const envFile = path.join(__dirname, "..", ".env");
const url = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").split(/\r?\n/)[0].replace(/^DATABASE_URL=/, "").trim() : "";

test("menu access rules", { skip: !url && "no .env" }, async () => {
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const ids = { A: crypto.randomUUID(), B: crypto.randomUUID(), C: crypto.randomUUID(), D: crypto.randomUUID() };

  // Run as a signed-in user, the way the API does.
  const as = async (who, sql, args = []) => {
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: ids[who], role: "authenticated", email: who.toLowerCase() + "@test.invalid" })]);
    await db.query("set local role authenticated");
    return (await db.query(sql, args)).rows;
  };
  // Statements that must be refused: run in a savepoint so the transaction survives.
  const refused = async (who, sql, args = []) => {
    await db.query("savepoint s");
    try { await as(who, sql, args); } catch { await db.query("rollback to savepoint s"); return true; }
    await db.query("release savepoint s");
    return false;
  };

  try {
    await db.query("begin");
    for (const [k, id] of Object.entries(ids)) {
      await db.query("insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')", [id, k.toLowerCase() + "@test.invalid"]);
    }
    const ing = (await db.query("select id from ingredients order by id limit 2")).rows.map((r) => r.id);

    // A makes a menu (owner row added automatically) and a private combo of their own.
    const [menu] = await as("A", "insert into menus (name) values ('Test menu') returning id");
    assert.deepEqual(await as("A", "select role from menu_members where menu_id = $1", [menu.id]), [{ role: "owner" }]);
    const [mine] = await as("A", "insert into combos (user_id, name) values ($1, 'A private') returning id", [ids.A]);

    // Edit link -> B joins as editor; then a view link -> C joins as viewer.
    const [inv] = await as("A", "insert into menu_invites (menu_id, role) values ($1, 'editor') returning code", [menu.id]);
    assert.equal((await as("B", "select join_menu($1) as m", [inv.code]))[0].m, menu.id);
    const [inv2] = await as("A", "update menu_invites set role = 'viewer', code = replace(gen_random_uuid()::text, '-', '') where menu_id = $1 returning code", [menu.id]);
    await as("C", "select join_menu($1)", [inv2.code]);
    assert.ok(await refused("D", "select join_menu($1)", [inv.code]), "old link stops working after a reset");

    // A copies a drink into the menu.
    const [mc] = await as("A", "insert into combos (user_id, menu_id, name) values ($1, $2, 'Shared drink') returning id", [ids.A, menu.id]);
    await as("A", "insert into combo_items (combo_id, ingredient_id) values ($1, $2)", [mc.id, ing[0]]);

    // Who sees what.
    assert.equal((await as("B", "select id from combos where id = $1", [mc.id])).length, 1, "editor sees menu drinks");
    assert.equal((await as("C", "select combo_id from combo_items where combo_id = $1", [mc.id])).length, 1, "viewer sees items");
    assert.equal((await as("D", "select id from menus where id = $1", [menu.id])).length, 0, "outsider can't see the menu");
    assert.equal((await as("D", "select id from combos where id = $1", [mc.id])).length, 0, "outsider can't see menu drinks");
    assert.equal((await as("B", "select id from combos where id = $1", [mine.id])).length, 0, "members can't see the owner's private saves");
    assert.equal((await as("B", "select code from menu_invites where menu_id = $1", [menu.id])).length, 0, "only the owner sees the link");

    // Who can change what.
    assert.equal((await as("B", "update combos set name = 'Edited' where id = $1 returning id", [mc.id])).length, 1, "editor edits");
    assert.equal((await as("B", "insert into combo_items (combo_id, ingredient_id) values ($1, $2) returning combo_id", [mc.id, ing[1]])).length, 1, "editor adds items");
    assert.equal((await as("C", "update combos set name = 'Nope' where id = $1 returning id", [mc.id])).length, 0, "viewer can't edit");
    assert.ok(await refused("C", "insert into combos (user_id, menu_id, name) values ($1, $2, 'x')", [ids.C, menu.id]), "viewer can't add");
    assert.equal((await as("C", "delete from combos where id = $1 returning id", [mc.id])).length, 0, "viewer can't delete");
    assert.ok(await refused("B", "update combos set user_id = $1 where id = $2", [ids.B, mc.id]), "creator can't be changed");
    assert.ok(await refused("B", "update combos set menu_id = null where id = $1", [mc.id]), "can't move a drink out");
    assert.equal((await as("B", "update menus set name = 'Mine now' where id = $1 returning id", [menu.id])).length, 0, "only the owner renames");

    // Membership.
    assert.equal((await as("B", "update menu_members set role = 'owner' where menu_id = $1 and user_id = $2 returning role", [menu.id, ids.B])).length, 0, "can't promote yourself");
    assert.ok(await refused("D", "insert into menu_members (menu_id, user_id, role) values ($1, $2, 'editor')", [menu.id, ids.D]), "can't add yourself");
    assert.equal((await as("A", "update menu_members set role = 'editor' where menu_id = $1 and user_id = $2 returning role", [menu.id, ids.C])).length, 1, "owner changes roles");
    assert.equal((await as("C", "delete from menu_members where menu_id = $1 and user_id = $2 returning user_id", [menu.id, ids.B])).length, 0, "members can't remove others");
    assert.equal((await as("B", "delete from menu_members where menu_id = $1 and user_id = $2 returning user_id", [menu.id, ids.B])).length, 1, "members can leave");
    assert.equal((await as("B", "select id from combos where id = $1", [mc.id])).length, 0, "after leaving, drinks are gone");
    assert.equal((await as("A", "delete from menu_members where menu_id = $1 and user_id = $2 returning user_id", [menu.id, ids.A])).length, 0, "owner can't leave (delete the menu instead)");
    assert.equal((await as("A", "delete from menus where id = $1 returning id", [menu.id])).length, 1, "owner deletes the menu");
    assert.equal((await as("A", "select id from combos where id = $1", [mine.id])).length, 1, "private saves survive");
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
});
