exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { prompt, system, model, apiKey } = body;
  const key = process.env.ANTHROPIC_API_KEY || apiKey;

  if (!key) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "No API key provided" }) };
  if (!prompt) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "No prompt" }) };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model || "claude-haiku-4-5-20251001",
        max_tokens: 8192,
        system: system || "You are a helpful assistant.",
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await res.json();
    return { statusCode: res.status, headers: cors, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
