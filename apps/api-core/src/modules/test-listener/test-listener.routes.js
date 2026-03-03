const express = require("express");

const router = express.Router();

const MAX_MESSAGES = 100;
const messages = [];
const sseClients = new Set();

const textBodyParser = express.text({
  type: ["text/*", "application/xml", "application/x-www-form-urlencoded"],
  limit: "2mb",
});

function makeMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBody(body) {
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (body === undefined) return null;
  return body;
}

function pushMessage(message) {
  messages.unshift(message);
  if (messages.length > MAX_MESSAGES) messages.pop();

  const eventPayload = `data: ${JSON.stringify(message)}\n\n`;
  for (const client of sseClients) {
    client.write(eventPayload);
  }
}

router.get("/test-listener", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Test Listener</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #0f172a;
        --panel: #e2e8f0;
        --text: #f8fafc;
        --muted: #94a3b8;
        --accent: #22d3ee;
        --card-bg: #020617;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", Tahoma, sans-serif;
        background: radial-gradient(circle at 20% 20%, #1e293b, var(--bg));
        color: var(--text);
      }

      .container {
        max-width: 1100px;
        margin: 0 auto;
        padding: 20px;
      }

      h1 {
        margin: 0 0 8px;
      }

      .endpoint {
        background: #020617;
        border: 1px solid #1e293b;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 8px;
        color: #7dd3fc;
        word-break: break-all;
      }

      .status {
        margin-bottom: 16px;
        color: var(--muted);
      }

      .hint {
        margin: 0 0 16px;
        color: var(--panel);
      }

      .messages {
        display: grid;
        gap: 12px;
      }

      .card {
        border: 1px solid #1e293b;
        border-radius: 10px;
        background: var(--card-bg);
        overflow: hidden;
      }

      .meta {
        padding: 8px 10px;
        border-bottom: 1px solid #1e293b;
        color: var(--accent);
        font-size: 13px;
      }

      pre {
        margin: 0;
        padding: 10px;
        overflow: auto;
        font-size: 13px;
        line-height: 1.4;
      }
    </style>
  </head>
  <body>
    <main class="container">
      <h1>Test Listener</h1>
      <div class="endpoint" id="endpoint"></div>
      <p class="status" id="status">Connexion en cours...</p>
      <p class="hint">
        Envoie des donnees en POST vers cet endpoint, la page se met a jour en direct.
      </p>
      <section class="messages" id="messages"></section>
    </main>

    <script>
      const endpointPath = "/test-listener/endpoint";
      const messagesEl = document.getElementById("messages");
      const statusEl = document.getElementById("status");
      const endpointEl = document.getElementById("endpoint");

      endpointEl.textContent = window.location.origin + endpointPath;

      function addMessage(message, prepend = true) {
        const card = document.createElement("article");
        card.className = "card";

        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = message.receivedAt + " | " + message.method + " | id=" + message.id;

        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(message, null, 2);

        card.appendChild(meta);
        card.appendChild(pre);

        if (prepend) messagesEl.prepend(card);
        else messagesEl.appendChild(card);
      }

      async function loadHistory() {
        try {
          const response = await fetch("/test-listener/messages");
          const payload = await response.json();
          const ordered = [...payload.messages].reverse();
          for (const message of ordered) addMessage(message, false);
        } catch (error) {
          statusEl.textContent = "Impossible de charger l'historique.";
        }
      }

      function openStream() {
        const source = new EventSource("/test-listener/stream");
        source.onopen = () => {
          statusEl.textContent = "Connecte en temps reel.";
        };
        source.onmessage = (event) => {
          try {
            addMessage(JSON.parse(event.data), true);
          } catch (_) {
            // Ignore malformed event payloads.
          }
        };
        source.onerror = () => {
          statusEl.textContent = "Connexion perdue, tentative de reconnexion...";
        };
      }

      loadHistory();
      openStream();
    </script>
  </body>
</html>`);
});

router.get("/test-listener/messages", (req, res) => {
  res.json({ ok: true, count: messages.length, messages });
});

router.get("/test-listener/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  res.write("retry: 3000\n\n");
  sseClients.add(res);

  const keepAlive = setInterval(() => {
    res.write(`event: ping\ndata: {"time":"${new Date().toISOString()}"}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

router.all("/test-listener/endpoint", textBodyParser, (req, res) => {
  const message = {
    id: makeMessageId(),
    receivedAt: new Date().toISOString(),
    method: req.method,
    ip: req.ip,
    query: req.query || {},
    headers: req.headers || {},
    body: normalizeBody(req.body),
  };

  pushMessage(message);

  res.status(202).json({
    ok: true,
    stored: true,
    id: message.id,
    total: messages.length,
  });
});

module.exports = router;
