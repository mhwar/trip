import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { code, data } = body;
  if (!code || typeof code !== "string" || code.length < 4 || !data) {
    return new Response("Missing or invalid code/data", { status: 400 });
  }

  const safeCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  if (!safeCode) return new Response("Invalid code", { status: 400 });

  try {
    const store = getStore("trip-sync");
    await store.setJSON(safeCode, { data, updatedAt: new Date().toISOString() });
    return Response.json({ ok: true, code: safeCode });
  } catch (err) {
    console.error("save error:", err);
    return new Response("Storage error", { status: 500 });
  }
};

export const config = { path: "/.netlify/functions/save" };
