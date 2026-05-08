// SiliconFlow AI proxy (OpenAI-compatible API)
// Free models: Qwen/Qwen2.5-7B-Instruct, THUDM/glm-4-9b-chat, internlm/internlm2_5-7b-chat
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
  const key = process.env.SILICONFLOW_API_KEY || apiKey;

  if (!key) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "No API key provided" }) };
  if (!prompt) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "No prompt" }) };

  try {
    const res = await fetch("https://api.siliconflow.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model: model || "Qwen/Qwen2.5-7B-Instruct",
        max_tokens: 4096,
        temperature: 0.4,
        messages: [
          { role: "system", content: system || "You are a helpful assistant." },
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await res.json();
    // Normalize response shape so client code keeps working with `content[0].text`
    if (res.ok && data.choices?.[0]?.message?.content) {
      const text = data.choices[0].message.content;
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          content: [{ type: "text", text }],
          usage: data.usage,
          model: data.model
        })
      };
    }
    return { statusCode: res.status, headers: cors, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
