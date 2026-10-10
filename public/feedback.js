// Feedback form: posts to /api/feedback, which emails it to us (server.js).
const form = $("fbForm"), err = $("fbErr"), sendBtn = $("fbSend");
whenUser(() => { if (user?.email && !$("fbEmail").value) $("fbEmail").value = user.email; });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.textContent = "";
  if (!$("fbMessage").value.trim()) { err.textContent = "Write a message first."; return; }
  sendBtn.disabled = true; sendBtn.textContent = "Sending...";
  const body = { kind: form.kind.value, message: $("fbMessage").value, email: $("fbEmail").value.trim(),
    website: $("fbWebsite").value, page: document.referrer ? new URL(document.referrer).pathname : "" };
  let r = null;
  try { r = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch {}
  sendBtn.disabled = false; sendBtn.textContent = "Send";
  if (r?.ok) {
    form.replaceWith(el("p", { className: "ok", textContent: "Thanks! We got it." }));
  } else {
    err.textContent = r?.status === 429 ? "That's a lot of messages. Try again in an hour."
      : "It didn't send. Check your connection and try again in a minute.";
  }
});
