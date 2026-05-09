// Save function — writes trip data to Netlify Blobs.
// Auth model:
//   - Bearer session token (owner/team)            → full write
//   - body.shareToken with perms="full"            → full write
//   - body.shareToken with perms="tasks"           → partial write (tasks/done/notes only)
//   - everything else                              → 403

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

async function getShareFromBody(body) {
  if (!body || !body.shareToken) return null;
  const sharesStore = getStore("trip-shares");
  return await sharesStore.get(body.shareToken, { type: "json" });
}

// Partial-write merge: keep base data, allow only tasks + per-item done/note updates.
function mergePartial(existing, incoming) {
  const base = existing && existing.data ? { ...existing.data } : {};
  if (Array.isArray(incoming.tasks)) base.tasks = incoming.tasks;
  if (Array.isArray(incoming.itinerary) && Array.isArray(base.itinerary)) {
    const inMap = new Map(incoming.itinerary.map(d => [d.date || d.id, d]));
    base.itinerary = base.itinerary.map(day => {
      const inDay = inMap.get(day.date || day.id);
      if (!inDay || !Array.isArray(inDay.items)) return day;
      const inItems = new Map((inDay.items || []).map(it => [it.id, it]));
      return {
        ...day,
        items: (day.items || []).map(it => {
          const u = inItems.get(it.id);
          if (!u) return it;
          const out = { ...it };
          if (typeof u.done === "boolean") out.done = u.done;
          if (typeof u.note === "string")  out.note = u.note;
          return out;
        })
      };
    });
  }
  return base;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Invalid JSON" }; }

  const { code, data } = body;
  if (!code || typeof code !== "string" || code.length < 4 || !data) {
    return { statusCode: 400, body: "Missing or invalid code/data" };
  }
  const safeCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  if (!safeCode) return { statusCode: 400, body: "Invalid code" };

  // Authorization
  const session = await getSessionFromHeader(event);
  let writePerms = null;        // "full" | "tasks"
  let actor = null;

  if (session && (session.role === "owner" || session.role === "team")) {
    writePerms = "full";
    actor = `user:${session.email}`;
  } else {
    const share = await getShareFromBody(body);
    if (share && share.tripCode === safeCode) {
      if (share.perms === "full" || share.perms === "tasks") {
        writePerms = share.perms;
        actor = `share:${String(body.shareToken).slice(0, 8)}`;
      }
    }
  }

  if (!writePerms) {
    return { statusCode: 403, body: "Forbidden" };
  }

  try {
    const store = getStore("trip-sync");
    let toStore;
    if (writePerms === "full") {
      toStore = data;
    } else {
      const existing = await store.get(safeCode, { type: "json" });
      toStore = mergePartial(existing, data);
    }
    await store.setJSON(safeCode, {
      data: toStore,
      updatedAt: new Date().toISOString(),
      lastEditor: actor
    });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, code: safeCode, perms: writePerms })
    };
  } catch (err) {
    console.error("save error:", err);
    return { statusCode: 500, body: "Storage error" };
  }
};
