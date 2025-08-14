const chat = document.getElementById("chat");
const input = document.getElementById("msg");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const ttsToggle = document.getElementById("ttsToggle");
const clearBtn = document.getElementById("clearBtn");

// Create or load a stable user id (so memory works across devices if you reuse the id)
let uid = localStorage.getItem("rin_uid");
if (!uid) {
  uid = crypto.randomUUID();
  localStorage.setItem("rin_uid", uid);
}

function addMsg(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "assistant");
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

async function send(text) {
  if (!text.trim()) return;
  addMsg("user", text);
  input.value = "";
  sendBtn.disabled = true;

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, uid })
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    addMsg("assistant", data.reply);

    if (ttsToggle.checked && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(data.reply);
      speechSynthesis.speak(u);
    }
  } catch (e) {
    addMsg("assistant", "Error: " + e.message);
  } finally {
    sendBtn.disabled = false;
  }
}

sendBtn.onclick = () => send(input.value);
input.onkeydown = (e) => { if (e.key === "Enter") send(input.value); };

clearBtn.onclick = async () => {
  if (!confirm("Clear all memory for this user?")) return;
  await fetch("/api/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid })
  });
  chat.innerHTML = "";
  addMsg("assistant", "Memory cleared for this user id.");
};

// Voice input (browser STT)
let recognizer = null;
if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognizer = new SR();
  recognizer.lang = "en-US";
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;
  recognizer.onresult = (e) => {
    const said = e.results[0][0].transcript;
    input.value = said;
    send(said);
  };
  recognizer.onerror = () => {};
}

micBtn.onmousedown = () => { if (recognizer) recognizer.start(); };
micBtn.onmouseup = () => { if (recognizer) recognizer.stop(); };

// Load past messages
(async function loadHistory() {
  try {
    const r = await fetch(`/api/history?uid=${encodeURIComponent(uid)}`);
    const data = await r.json();
    (data.messages || []).forEach(m => addMsg(m.role, m.content));
    if ((data.messages || []).length === 0) {
      addMsg("assistant", "Hey! I'm Rin. Tell me what you want me to remember about you and how I should help.");
    }
  } catch {}
})();
