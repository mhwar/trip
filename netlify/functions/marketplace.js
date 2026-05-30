// Marketplace function — manages public trip listings for resale/sharing.
// Storage: trip-marketplace (Netlify Blobs)
//
// Schema: { listingId, tripCode, title, description, destination, destinationFlag,
//           duration, price, currency, category, tags, coverImage, createdBy,
//           agencyName, agencyWA, createdAt, views, inquiries, published }
//
// Endpoints:
//   POST ?action=publish    — owner only: publish a trip as a listing
//   GET  ?action=list       — public: get all published listings (with filters)
//   GET  ?action=get&id=ID  — public: get single listing + increment views
//   POST ?action=inquire    — public: register interest (increments inquiries)
//   POST ?action=unpublish  — owner only: remove listing
//   POST ?action=update     — owner only: update listing metadata

const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

function newId() { return crypto.randomBytes(12).toString("hex"); }
function json(s, b) {
  return {
    statusCode: s,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(b)
  };
}

async function getSession(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = auth.match(/^Bearer\s+(\S+)/i);
  if (!m) return null;
  try {
    const s = await getStore("auth-sessions").get(m[1], { type: "json" });
    if (!s) return null;
    if (s.expiresAt && Date.parse(s.expiresAt) < Date.now()) return null;
    return s;
  } catch { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE" }, body: "" };
  }

  const action = (event.queryStringParameters?.action || "").toLowerCase();
  const store = getStore("trip-marketplace");

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch { return json(400, { error: "Invalid JSON" }); }
  }

  // ─── PUBLISH ────────────────────────────────────────────────────────────
  if (action === "publish" && event.httpMethod === "POST") {
    const session = await getSession(event);
    if (!session) return json(401, { error: "auth required" });
    if (session.role !== "owner" && session.role !== "team") return json(403, { error: "forbidden" });

    const title       = String(body.title || "").trim().slice(0, 100);
    const description = String(body.description || "").trim().slice(0, 600);
    const destination = String(body.destination || "").trim().slice(0, 80);
    const destinationFlag = String(body.destinationFlag || "✈️").slice(0, 4);
    const duration    = Math.max(1, Math.min(90, parseInt(body.duration) || 1));
    const price       = Math.max(0, parseFloat(body.price) || 0);
    const category    = ["tourism", "study", "umrah", "work", "other"].includes(body.category) ? body.category : "tourism";
    const tags        = (Array.isArray(body.tags) ? body.tags : []).filter(t => typeof t === "string").map(t => t.slice(0, 30)).slice(0, 8);
    const coverImage  = typeof body.coverImage === "string" ? body.coverImage.slice(0, 50000) : null;
    const agencyName  = String(body.agencyName || session.email || "خطّار").slice(0, 60);
    const agencyWA    = String(body.agencyWA || "").replace(/[^+\d]/g, "").slice(0, 20);
    const tripCode    = String(body.tripCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);

    if (!title)       return json(400, { error: "title required" });
    if (!destination) return json(400, { error: "destination required" });

    const listingId = newId();
    const listing = {
      listingId,
      tripCode,
      title,
      description,
      destination,
      destinationFlag,
      duration,
      price,
      currency: "SAR",
      category,
      tags,
      coverImage,
      agencyName,
      agencyWA,
      createdBy: session.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      views: 0,
      inquiries: 0,
      published: true
    };

    await store.setJSON(listingId, listing);
    return json(200, { ok: true, listingId, listing });
  }

  // ─── LIST ────────────────────────────────────────────────────────────────
  if (action === "list" && event.httpMethod === "GET") {
    const q     = event.queryStringParameters || {};
    const dest  = (q.destination || "").toLowerCase();
    const cat   = q.category || "";
    const maxP  = parseFloat(q.maxPrice) || Infinity;
    const minD  = parseInt(q.minDays) || 0;
    const maxD  = parseInt(q.maxDays) || 999;
    const limit = Math.min(50, parseInt(q.limit) || 50);
    const sort  = q.sort || "newest"; // newest | popular | price_asc | price_desc

    let items = [];
    try {
      const listed = await store.list();
      const promises = (listed.blobs || []).map(b => store.get(b.key, { type: "json" }).catch(() => null));
      const raw = await Promise.all(promises);
      items = raw.filter(l => l && l.published);
    } catch { items = []; }

    // Filter
    if (dest) items = items.filter(l => l.destination.toLowerCase().includes(dest));
    if (cat)  items = items.filter(l => l.category === cat);
    items = items.filter(l => l.price <= maxP && l.duration >= minD && l.duration <= maxD);

    // Sort
    if (sort === "popular") items.sort((a, b) => (b.views + b.inquiries * 3) - (a.views + a.inquiries * 3));
    else if (sort === "price_asc") items.sort((a, b) => a.price - b.price);
    else if (sort === "price_desc") items.sort((a, b) => b.price - a.price);
    else items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Strip cover image from list (heavy) — client fetches on detail page
    const slim = items.slice(0, limit).map(l => {
      const { coverImage, ...rest } = l;
      return { ...rest, hasCover: !!coverImage };
    });

    return json(200, { ok: true, listings: slim, total: items.length });
  }

  // ─── GET (single) ────────────────────────────────────────────────────────
  if (action === "get" && event.httpMethod === "GET") {
    const id = event.queryStringParameters?.id || "";
    if (!id) return json(400, { error: "missing id" });
    try {
      const listing = await store.get(id, { type: "json" });
      if (!listing || !listing.published) return json(404, { error: "not found" });
      listing.views = (listing.views || 0) + 1;
      await store.setJSON(id, listing);
      return json(200, { ok: true, listing });
    } catch { return json(404, { error: "not found" }); }
  }

  // ─── INQUIRE ─────────────────────────────────────────────────────────────
  if (action === "inquire" && event.httpMethod === "POST") {
    const id = String(body.listingId || "");
    if (!id) return json(400, { error: "missing listingId" });
    try {
      const listing = await store.get(id, { type: "json" });
      if (!listing || !listing.published) return json(404, { error: "not found" });
      listing.inquiries = (listing.inquiries || 0) + 1;
      await store.setJSON(id, listing);
      return json(200, { ok: true, inquiries: listing.inquiries });
    } catch { return json(500, { error: "failed" }); }
  }

  // ─── UNPUBLISH ───────────────────────────────────────────────────────────
  if (action === "unpublish" && event.httpMethod === "POST") {
    const session = await getSession(event);
    if (!session) return json(401, { error: "auth required" });

    const id = String(body.listingId || "");
    if (!id) return json(400, { error: "missing listingId" });

    try {
      const listing = await store.get(id, { type: "json" });
      if (!listing) return json(404, { error: "not found" });
      if (listing.createdBy !== session.email && session.role !== "owner") return json(403, { error: "forbidden" });
      listing.published = false;
      await store.setJSON(id, listing);
      return json(200, { ok: true });
    } catch { return json(500, { error: "failed" }); }
  }

  // ─── UPDATE ──────────────────────────────────────────────────────────────
  if (action === "update" && event.httpMethod === "POST") {
    const session = await getSession(event);
    if (!session) return json(401, { error: "auth required" });

    const id = String(body.listingId || "");
    if (!id) return json(400, { error: "missing listingId" });

    try {
      const listing = await store.get(id, { type: "json" });
      if (!listing) return json(404, { error: "not found" });
      if (listing.createdBy !== session.email && session.role !== "owner") return json(403, { error: "forbidden" });

      const allowed = ["title","description","price","tags","coverImage","agencyWA","agencyName","category"];
      allowed.forEach(k => { if (body[k] !== undefined) listing[k] = body[k]; });
      listing.updatedAt = new Date().toISOString();
      await store.setJSON(id, listing);
      return json(200, { ok: true, listing });
    } catch { return json(500, { error: "failed" }); }
  }

  return json(404, { error: "unknown action" });
};
