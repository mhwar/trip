// Load function — reads trip data from Netlify Blobs.
// Two access modes:
//   - GET /?code=XXXX            → public read (legacy, view-only access)
//   - GET /?share=TOKEN          → resolves the share token, returns trip + permissions
//   - Bearer session             → unrestricted

const { getStore } = require("@netlify/blobs");

async function getSessionFromHeader(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = auth.match(/^Bearer\s+(\S+)/i);
  if (!m) return null;
  const sess = getStore("auth-sessions");
  const s = await sess.get(m[1], { type: "json" });
  if (!s) return null;
  if (s.expiresAt && Date.parse(s.expiresAt) < Date.now()) return null;
  return s;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const q = event.queryStringParameters || {};
  const session = await getSessionFromHeader(event);

  let safeCode = "";
  let perms = "view";
  let shareLabel = null;

  if (q.share) {
    const sharesStore = getStore("trip-shares");
    const share = await sharesStore.get(String(q.share), { type: "json" });
    if (!share) return { statusCode: 404, body: "Invalid share" };
    safeCode = share.tripCode;
    perms    = share.perms || "view";
    shareLabel = share.label || null;
  } else if (q.code) {
    safeCode = String(q.code).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    if (!safeCode) return { statusCode: 400, body: "Missing code" };
    perms = session ? "full" : "view";
  } else {
    return { statusCode: 400, body: "Missing code or share token" };
  }

  if (session && (session.role === "owner" || session.role === "team")) {
    perms = "full";
  }

  try {
    const store = getStore("trip-sync");
    const record = await store.get(safeCode, { type: "json" });
    if (!record) return { statusCode: 404, body: "Code not found" };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        code: safeCode,
        data: record.data,
        updatedAt: record.updatedAt,
        perms,
        shareLabel
      })
    };
  } catch (err) {
    console.error("load error:", err);
    return { statusCode: 500, body: "Storage error" };
  }
};
