// Serves public/ on $PORT for Railway. Data comes straight from Supabase in the browser.
// Two other routes: POST /api/log (browser errors to the server log) and POST /api/feedback (emailed to the owner).
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

// --- small JSON POSTs, counted per visitor ------------------------------------------------------
// ponytail: in-memory per-IP counters; fine on one instance, move to the platform's limiter if we scale out.
function limiter(max, ms) {
  const hits = new Map();
  setInterval(() => hits.clear(), ms).unref();
  return (req) => {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0].trim();
    hits.set(ip, (hits.get(ip) || 0) + 1);
    return hits.get(ip) > max;
  };
}
function readJson(req, max, done) {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (c) => { body += c; if (body.length > max) req.destroy(); });
  req.on("end", () => { let v = null; try { v = JSON.parse(body); } catch {} done(v); });
}
const clip = (v, n) => String(v ?? "").replace(/[\r\n]+/g, " ").slice(0, n);

// POST /api/log: browser errors, printed as one line (see report() in common.js).
const logLimited = limiter(20, 60_000);
function logError(req, res) {
  if (logLimited(req)) { req.resume(); return send(res, 429); }
  readJson(req, 2000, (e) => {
    if (e) console.error("client-error " + JSON.stringify({ msg: clip(e.msg, 300), src: clip(e.src, 200), line: Number(e.line) || 0,
      page: clip(e.page, 100), ua: clip(req.headers["user-agent"], 120) }));
    send(res, 204);
  });
}

// POST /api/feedback: emailed to the owner through Resend (RESEND_API_KEY + FEEDBACK_TO set in Railway).
// Without them it is refused with 503, so the visitor is never told a message sent when it didn't.
const feedbackLimited = limiter(5, 3_600_000);
function feedback(req, res) {
  if (feedbackLimited(req)) { req.resume(); return send(res, 429, "too many"); }
  readJson(req, 6000, async (f) => {
    if (!f) return send(res, 400, "bad request");
    if (f.website) return send(res, 204);                          // honeypot: only bots fill the hidden field
    const message = String(f.message ?? "").trim().slice(0, 4000);
    if (!message) return send(res, 400, "empty");
    const email = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i.test(f.email ?? "") ? f.email : "";
    const kind = f.kind === "bug" ? "Bug" : "Feedback";
    const page = clip(f.page, 200), ua = clip(req.headers["user-agent"], 200);
    console.log("feedback " + JSON.stringify({ kind, page, reply: !!email, chars: message.length }));
    if (!process.env.RESEND_API_KEY || !process.env.FEEDBACK_TO) return send(res, 503, "not configured");
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.FEEDBACK_FROM || "barfriender <onboarding@resend.dev>",
          to: process.env.FEEDBACK_TO,
          ...(email && { reply_to: email }),
          subject: `[barfriender] ${kind}: ${clip(message, 60)}`,
          text: `${message}\n\n--\nFrom: ${email || "(no email given)"}\nPage: ${page}\nBrowser: ${ua}`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new Error(`resend ${r.status} ${clip(await r.text(), 200)}`);
      send(res, 204);
    } catch (e) {
      console.error("feedback-send-failed " + clip(e.message, 300));
      send(res, 502, "send failed");
    }
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
  if (req.method === "POST" && req.url === "/api/feedback") return feedback(req, res);
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
