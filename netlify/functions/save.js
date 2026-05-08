const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { code, data } = body;
  if (!code || typeof code !== "string" || code.length < 4 || !data) {
    return { statusCode: 400, body: "Missing or invalid code/data" };
  }

  const safeCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  if (!safeCode) return { statusCode: 400, body: "Invalid code" };

  try {
    const store = getStore("trip-sync");
    await store.setJSON(safeCode, { data, updatedAt: new Date().toISOString() });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, code: safeCode })
    };
  } catch (err) {
    console.error("save error:", err);
    return { statusCode: 500, body: "Storage error" };
  }
};
