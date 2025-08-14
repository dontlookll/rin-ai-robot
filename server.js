import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// --- Config you can edit later in Render env vars ---
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `You are Rin, a friendly, concise assistant for the user.
- Be practical and clear.
- Remember important personal facts the user shares (name, preferences, goals).
- If asked, summarize or forget stored memory.
- Keep answers short unless the user asks for detail.`;

// Supabase (memory database)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Groq (LLM)
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

// --- Express middleware ---
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.static("static"));

// Simple health
app.get("/api/health", (_, res) => res.json({ ok: true }));

// Fetch chat history
app.get("/api/history", async (req, res) => {
  try {
    const uid = req.query.uid;
    if (!uid) return res.status(400).json({ error: "uid required" });
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("uid", uid)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw error;
    res.json({ messages: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Clear history
app.post("/api/clear", async (req, res) => {
  try {
    const { uid } = req.body || {};
    if (!uid) return res.status(400).json({ error: "uid required" });
    const { error } = await supabase.from("messages").delete().eq("uid", uid);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Main chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { text, uid } = req.body || {};
    if (!text || !uid) return res.status(400).json({ error: "text and uid required" });

    // Load last ~30 turns for context
    const { data: history, error: hErr } = await supabase
      .from("messages")
      .select("role,content,created_at")
      .eq("uid", uid)
      .order("created_at", { ascending: true })
      .limit(60);
    if (hErr) throw hErr;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history || []),
      { role: "user", content: text }
    ];

    // Save user message
    await supabase.from("messages").insert({ uid, role: "user", content: text });

    // Call Groq (OpenAI-compatible)
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0.6,
        max_tokens: 400
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Groq error ${r.status}: ${errText}`);
    }

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "…";

    // Save assistant reply
    await supabase.from("messages").insert({ uid, role: "assistant", content: reply });

    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
