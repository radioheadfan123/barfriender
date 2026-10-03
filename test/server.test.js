// Starts server.js and checks it survives hostile URLs and sends its security headers.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const PORT = 3999;
let proc;

before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT } });
  await new Promise((r) => proc.stdout.once("data", r));
});
after(() => proc.kill());

// Raw request so malformed paths reach the server untouched.
const get = (p, method = "GET") => new Promise((resolve, reject) => {
  http.request({ host: "localhost", port: PORT, path: p, method }, (res) => {
    res.resume(); res.on("end", () => resolve(res));
  }).on("error", reject).end();
});

test("pages are served with security headers", async () => {
  const res = await get("/");
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-security-policy"], /script-src 'self'/);
  assert.match(res.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
});

test("hostile paths are refused and the server stays up", async () => {
  assert.equal((await get("/%")).statusCode, 400);            // used to crash the process
  assert.equal((await get("/%00.js")).statusCode, 400);
  assert.equal((await get("/../server.js")).statusCode, 403);
  assert.equal((await get("/%2e%2e/server.js")).statusCode, 403);
  assert.equal((await get("/../package.json")).statusCode, 403);
  assert.equal((await get("/", "POST")).statusCode, 405);
  assert.equal((await get("/")).statusCode, 200);             // still alive
});

test("only site file types are served", async () => {
  assert.equal((await get("/vendor/supabase-2.117.2.js")).statusCode, 200);
  assert.equal((await get("/missing.html")).statusCode, 404);
  assert.equal((await get("/x.env")).statusCode, 404);
});

const post = (p, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: "localhost", port: PORT, path: p, method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
    res.resume(); res.on("end", () => resolve(res));
  });
  r.on("error", reject); r.end(body);
});

test("short URLs and a real 404 page", async () => {
  assert.equal((await get("/menus")).statusCode, 200);
  assert.equal((await get("/privacy")).statusCode, 200);
  assert.equal((await get("/favicon.svg")).statusCode, 200);
  const missing = await get("/nope");
  assert.equal(missing.statusCode, 404);
  assert.match(missing.headers["content-type"], /text\/html/, "404s get the friendly page");
});

test("error log endpoint accepts small reports and rate-limits", async () => {
  assert.equal((await post("/api/log", JSON.stringify({ msg: "test", page: "/" }))).statusCode, 204);
  assert.equal((await post("/api/log", "not json")).statusCode, 204);
  const codes = [];
  for (let i = 0; i < 25; i++) codes.push((await post("/api/log", "{}")).statusCode);
  assert.ok(codes.includes(429), "too many reports from one visitor get refused");
  assert.equal((await get("/")).statusCode, 200);
});
