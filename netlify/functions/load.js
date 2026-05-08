import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const rawCode = url.searchParams.get("code") || "";
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);

  if (!code) {
    return new Response("Missing code", { status: 400 });
  }

  try {
    const store = getStore("trip-sync");
    const record = await store.get(code, { type: "json" });

    if (!record) {
      return new Response("Code not found", { status: 404 });
    }

    return Response.json({ ok: true, data: record.data, updatedAt: record.updatedAt });
  } catch (err) {
    console.error("load error:", err);
    return new Response("Storage error", { status: 500 });
  }
};

export const config = { path: "/.netlify/functions/load" };
