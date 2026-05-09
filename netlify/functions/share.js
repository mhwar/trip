// Share function — owner generates per-trip share links with permission levels.
// Storage:
//   trip-shares : key=shareToken → { tripCode, perms, createdBy, createdAt, label }
//
// Permission levels:
//   "view"       — read only
//   "tasks"      — view + toggle tasks/checklist + add notes
//   "full"       — full edit (acts like a team member, no admin)

const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

const PERM_LEVELS = ["view", "tasks", "full"];

function newToken() { return crypto.randomBytes(16).toString("hex"); }
function json(s, b) { return { statusCode: s, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }; }

async function getSessionFromEvent(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = auth.match(/^Bearer\s+(\S+)/i);
  const token = m ? m[1] : null;
  if (!token) return null;
  const sess = getStore("auth-sessions");
  const s = await sess.get(token, { type: "json" });
  if (!s) return null;
  if (s.expiresAt && Date.parse(s.expiresAt) < Date.now()) return null;
  return s;
}

exports.handler = async (event) => {
  const action = (event.queryStringParameters?.action || "").toLowerCase();
  const sharesStore = getStore("trip-shares");

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch { return json(400, { error: "Invalid JSON" }); }
  }

  // ─── create (owner/team) ───────────────────────────────────────────────
  if (action === "create" && event.httpMethod === "POST") {
    const session = await getSessionFromEvent(event);
    if (!session) return json(401, { error: "auth required" });
    if (session.role !== "owner" && session.role !== "team") return json(403, { error: "forbidden" });

    const tripCode = String(body.tripCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    if (!tripCode) return json(400, { error: "missing tripCode" });

    const perms = PERM_LEVELS.includes(body.perms) ? body.perms : "view";
    const label = String(body.label || "").slice(0, 80);

    const shareToken = newToken();
    await sharesStore.setJSON(shareToken, {
      tripCode,
      perms,
      label,
      createdBy: session.email,
      createdAt: new Date().toISOString()
    });
    return json(200, { ok: true, shareToken, tripCode, perms, label });
  }

  // ─── resolve (public, used by client opening ?share=TOKEN) ─────────────
  if (action === "resolve" && event.httpMethod === "GET") {
    const shareToken = event.queryStringParameters?.token || "";
    if (!shareToken) return json(400, { error: "missing token" });
    const share = await sharesStore.get(shareToken, { type: "json" });
    if (!share) return json(404, { error: "invalid share" });
    return json(200, { ok: true, tripCode: share.tripCode, perms: share.perms, label: share.label });
  }

  // ─── list (owner/team) ─────────────────────────────────────────────────
  if (action === "list" && event.httpMethod === "GET") {
    const session = await getSessionFromEvent(event);
    if (!session) return json(401, { error: "auth required" });

    const tripCode = String(event.queryStringParameters?.tripCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    const out = [];
    try {
      const list = await sharesStore.list();
      for (const blob of (list.blobs || [])) {
        const s = await sharesStore.get(blob.key, { type: "json" });
        if (!s) continue;
        if (tripCode && s.tripCode !== tripCode) continue;
        out.push({ token: blob.key, ...s });
      }
    } catch (err) {
      console.error("share list error:", err);
    }
    return json(200, { ok: true, shares: out });
  }

  // ─── revoke (owner/team) ───────────────────────────────────────────────
  if (action === "revoke" && event.httpMethod === "POST") {
    const session = await getSessionFromEvent(event);
    if (!session) return json(401, { error: "auth required" });
    const shareToken = String(body.shareToken || "");
    if (!shareToken) return json(400, { error: "missing shareToken" });
    try { await sharesStore.delete(shareToken); } catch {}
    return json(200, { ok: true });
  }

  return json(400, { error: "unknown action" });
};
