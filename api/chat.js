// Vercel Serverless Function — proxies chat requests to Google Gemini API.
// Free tier friendly. The API key lives ONLY here (server-side env var).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
  }

  try {
    const { system, messages } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    // Map to Gemini format: role "assistant" → "model", cap history & size
    const contents = messages.slice(-10).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content).slice(0, 2000) }],
    }));

    const upstream = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: String(system || "").slice(0, 6000) }],
          },
          contents,
          generationConfig: {
            maxOutputTokens: 1000,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error("Gemini API error:", JSON.stringify(data));
      return res.status(upstream.status).json({ error: "Upstream API error" });
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("\n") || "";

    return res.status(200).json({ text });
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}