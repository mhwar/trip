const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const rawCode = event.queryStringParameters?.code || "";
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);

  if (!code) {
    return { statusCode: 400, body: "Missing code" };
  }

  try {
    const store = getStore("trip-sync");
    const record = await store.get(code, { type: "json" });

    if (!record) {
      return { statusCode: 404, body: "Code not found" };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, data: record.data, updatedAt: record.updatedAt })
    };
  } catch (err) {
    console.error("load error:", err);
    return { statusCode: 500, body: "Storage error" };
  }
};
