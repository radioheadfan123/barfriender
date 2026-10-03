// Serves public/ on $PORT for Railway. Data comes straight from Supabase in the browser.
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const SUPABASE = "https://qadsopswciuagvepcuyh.supabase.co";

// Every page script is a file (no inline JS), so the policy can stay strict.
const headers = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    `connect-src ${SUPABASE} ${SUPABASE.replace("https", "wss")}`,
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

http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed", { Allow: "GET, HEAD" });
  let url;
  try { url = decodeURIComponent(req.url.split("?")[0]); } catch { return send(res, 400, "bad request"); }
  if (url.includes("\0")) return send(res, 400, "bad request");
  const file = path.join(root, url === "/" ? "index.html" : url);
  if (!file.startsWith(root + path.sep)) return send(res, 403, "forbidden");   // no ../ escapes, no sibling folders
  const type = types[path.extname(file)];
  if (!type) return send(res, 404, "not found");                               // only serve what the site uses
  fs.readFile(file, (err, body) => {
    if (err) return send(res, 404, "not found");
    // The vendor file name carries its version, so it can be cached for good; pages revalidate.
    const cache = file.includes(path.sep + "vendor" + path.sep) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { ...headers, "Content-Type": type, "Cache-Control": cache });
    res.end(req.method === "HEAD" ? undefined : body);
  });
}).listen(process.env.PORT || 3000, () => console.log(`pourpair on :${process.env.PORT || 3000}`));
