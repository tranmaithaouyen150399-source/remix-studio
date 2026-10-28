// Remix Studio server: serves the web app and keeps the API keys (Claude, Google TTS) off the browser.
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const PORT = Number(process.env.PORT) || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || "";
// a placeholder such as "-" or "none" (Render asks for every value up front) counts as not configured
const realKey = (v) => (v && v.trim().length >= 20 ? v.trim() : "");
const TTS_KEY = realKey(process.env.GOOGLE_TTS_API_KEY);
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const anthropic = realKey(process.env.ANTHROPIC_API_KEY) ? new Anthropic({ apiKey: realKey(process.env.ANTHROPIC_API_KEY) }) : null;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "40mb" }));

const authed = (req) => !APP_PASSWORD || req.get("x-app-password") === APP_PASSWORD;

app.get("/api/health", (req, res) => {
  res.json({ ai: !!anthropic, tts: !!TTS_KEY, needPassword: !!APP_PASSWORD, authed: authed(req) });
});

app.use("/api", (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: "Sai mật khẩu" })));

// small in-memory limiter so a leaked link can't burn through the API budget
const hits = new Map();
function limit(name, perMinute) {
  return (req, res, next) => {
    const key = name + ":" + req.ip, now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < 60_000);
    if (list.length >= perMinute) return res.status(429).json({ error: "Quá nhiều yêu cầu, thử lại sau ít phút." });
    list.push(now); hits.set(key, list); next();
  };
}

/* ---------- Claude: scripts, frame descriptions, scene matching ---------- */
app.post("/api/ai", limit("ai", 40), async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: "Máy chủ chưa cấu hình ANTHROPIC_API_KEY." });
  const { prompt, images = [], tier = "default" } = req.body || {};
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 262_144) return res.status(400).json({ error: "Nội dung yêu cầu không hợp lệ." });
  if (!Array.isArray(images) || images.length > 12 || images.some((d) => typeof d !== "string" || d.length > 7_000_000)) {
    return res.status(400).json({ error: "Ảnh gửi lên không hợp lệ (tối đa 12 ảnh JPEG)." });
  }
  const content = [
    ...images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
    { type: "text", text: prompt },
  ];
  try {
    const msg = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: tier === "quick" ? "low" : "medium" },
      messages: [{ role: "user", content }],
    });
    if (msg.stop_reason === "refusal") return res.status(422).json({ error: "AI từ chối yêu cầu này. Hãy sửa lại mô tả." });
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    res.json({ text, truncated: msg.stop_reason === "max_tokens" });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "AI đang quá tải, thử lại sau ít phút." });
    if (e instanceof Anthropic.AuthenticationError) return res.status(502).json({ error: "ANTHROPIC_API_KEY không hợp lệ." });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: `Lỗi từ Claude API (${e.status ?? "mạng"}): ${e.message}` });
    console.error(e);
    res.status(500).json({ error: "Lỗi máy chủ khi gọi AI." });
  }
});

/* ---------- Google Cloud Text-to-Speech ---------- */
const GTTS = "https://texttospeech.googleapis.com/v1";
let voicesCache = null;

app.get("/api/voices", limit("voices", 30), async (req, res) => {
  if (!TTS_KEY) return res.status(503).json({ error: "Máy chủ chưa cấu hình GOOGLE_TTS_API_KEY." });
  try {
    if (!voicesCache) {
      const r = await fetch(`${GTTS}/voices?languageCode=vi-VN&key=${encodeURIComponent(TTS_KEY)}`);
      const j = await r.json();
      if (!r.ok) return res.status(502).json({ error: "Google TTS: " + (j.error?.message || r.status) });
      voicesCache = (j.voices || [])
        .filter((v) => v.languageCodes?.includes("vi-VN"))
        .map((v) => ({ name: v.name, gender: v.ssmlGender, type: v.name.replace(/^vi-VN-/, "").replace(/-[^-]+$/, "") }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    res.json(voicesCache);
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Không kết nối được Google TTS." });
  }
});

app.post("/api/tts", limit("tts", 240), async (req, res) => {
  if (!TTS_KEY) return res.status(503).json({ error: "Máy chủ chưa cấu hình GOOGLE_TTS_API_KEY." });
  const { text, voice, rate = 1 } = req.body || {};
  if (typeof text !== "string" || !text.trim() || text.length > 2000) return res.status(400).json({ error: "Câu cần đọc trống hoặc quá dài." });
  if (typeof voice !== "string" || !/^vi-VN-[A-Za-z0-9-]+$/.test(voice)) return res.status(400).json({ error: "Tên giọng không hợp lệ." });
  const body = {
    input: { text: text.trim() },
    voice: { languageCode: "vi-VN", name: voice },
    audioConfig: { audioEncoding: "MP3", speakingRate: Math.min(1.3, Math.max(0.7, Number(rate) || 1)) },
  };
  const call = () => fetch(`${GTTS}/text:synthesize?key=${encodeURIComponent(TTS_KEY)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    let r = await call();
    // some voice families reject speakingRate; read at normal speed instead of failing
    if (r.status === 400 && body.audioConfig.speakingRate !== 1) { delete body.audioConfig.speakingRate; r = await call(); }
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: "Google TTS: " + (j.error?.message || r.status) });
    res.type("audio/mpeg").send(Buffer.from(j.audioContent, "base64"));
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Không kết nối được Google TTS." });
  }
});

app.use(express.static("public", { extensions: ["html"], maxAge: "1h" }));

app.listen(PORT, () => {
  console.log(`Remix Studio chạy ở http://localhost:${PORT}`);
  console.log(`  Claude AI: ${anthropic ? "bật (" + MODEL + ")" : "tắt — thiếu ANTHROPIC_API_KEY"}`);
  console.log(`  Giọng Google: ${TTS_KEY ? "bật" : "tắt — thiếu GOOGLE_TTS_API_KEY"}`);
  console.log(`  Mật khẩu: ${APP_PASSWORD ? "bật" : "TẮT — ai có link cũng dùng được"}`);
});
