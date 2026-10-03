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
