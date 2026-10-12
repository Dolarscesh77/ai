// Netlify Function (v2): /api/ai  ->  Groq (streaming)
const MODEL = Netlify.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile";
const hits = new Map();
const LIMIT = 12; // hartum / rope / IP

export default async (req, context) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const ip = context.ip || "x";
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  if (arr.length > LIMIT) return new Response("Too many requests", { status: 429 });

  let messages;
  try { ({ messages } = await req.json()); } catch { return new Response("Bad request", { status: 400 }); }
  if (!Array.isArray(messages) || !messages.length) return new Response("Bad request", { status: 400 });

  const up = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + Netlify.env.get("GROQ_API_KEY") },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, stream: true, messages }),
  });
  if (!up.ok) return new Response(await up.text(), { status: up.status });

  const enc = new TextEncoder(), dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      let buf = "";
      try {
        for await (const chunk of up.body) {
          buf += dec.decode(chunk, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const l of lines) {
            if (!l.startsWith("data:") || l.includes("[DONE]")) continue;
            try {
              const t = JSON.parse(l.slice(5)).choices?.[0]?.delta?.content;
              if (t) controller.enqueue(enc.encode(t));
            } catch {}
          }
        }
      } catch {}
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
};

export const config = { path: "/api/ai" };
