// Serves public/ on $PORT for Railway. Data comes straight from Supabase in the browser.
// The one other route, POST /api/log, writes browser errors to the server log (see report() in common.js).
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "public");
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8",
};
const SUPABASE = "https://qadsopswciuagvepcuyh.supabase.co";

// Every page script is a file (no inline JS), so the policy can stay strict.
const headers = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    `connect-src 'self' ${SUPABASE} ${SUPABASE.replace("https", "wss")}`,
    "img-src 'self' data:",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; "),
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function send(res, code, body = "", extra = {}) {
  res.writeHead(code, { ...headers, "Content-Type": "text/plain; charset=utf-8", ...extra });
  res.end(body);
}

// --- POST /api/log: small JSON, a few per minute per visitor, printed as one line ---------------
// ponytail: in-memory per-IP counter; fine on one instance, move to the platform's limiter if we scale out.
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();
function logError(req, res) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0].trim();
  if ((hits.get(ip) || 0) >= 20) { req.resume(); return send(res, 429); }
  hits.set(ip, (hits.get(ip) || 0) + 1);
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (c) => { body += c; if (body.length > 2000) req.destroy(); });
  req.on("end", () => {
    try {
      const e = JSON.parse(body);
      const clip = (v, n) => String(v ?? "").replace(/[\r\n]+/g, " ").slice(0, n);
      console.error("client-error " + JSON.stringify({ msg: clip(e.msg, 300), src: clip(e.src, 200), line: Number(e.line) || 0,
        page: clip(e.page, 100), ua: clip(req.headers["user-agent"], 120) }));
    } catch {}
    send(res, 204);
  });
}

// --- static files ------------------------------------------------------------------------------
function serve(res, file, code = 200) {
  fs.readFile(file, (err, body) => {
    if (err) return code === 404 ? send(res, 404, "not found") : serve(res, path.join(root, "404.html"), 404);
    // The vendor file name carries its version, so it can be cached for good; pages revalidate.
    const cache = file.includes(path.sep + "vendor" + path.sep) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(code, { ...headers, "Content-Type": types[path.extname(file)], "Cache-Control": cache });
    res.end(res.req.method === "HEAD" ? undefined : body);
  });
}

http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/log") return logError(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed", { Allow: "GET, HEAD" });
  let url;
  try { url = decodeURIComponent(req.url.split("?")[0]); } catch { return send(res, 400, "bad request"); }
  if (url.includes("\0")) return send(res, 400, "bad request");
  let file = path.join(root, url === "/" ? "index.html" : url);
  if (!file.startsWith(root + path.sep)) return send(res, 403, "forbidden");   // no ../ escapes, no sibling folders
  if (!path.extname(file)) file += ".html";                                    // /menus -> menus.html
  if (!types[path.extname(file)]) return serve(res, path.join(root, "404.html"), 404);   // only what the site uses
  serve(res, file);
}).listen(process.env.PORT || 3000, () => console.log(`barfriender on :${process.env.PORT || 3000}`));
