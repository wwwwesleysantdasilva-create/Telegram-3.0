import TelegramBot from "node-telegram-bot-api";
import fs from "fs";

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = 8235876348; // teu ID
const LOG_GROUP_ID = -5164103528;

const bot = new TelegramBot(TOKEN, {
  polling: {
    autoStart: true,
    params: { timeout: 10 }
  }
});

// ===== STORAGE =====
let waitingGen = {}; // controle de estado

// ===== UTIL =====
function logEvent(type, userId, info = {}) {
  const log = {
    time: new Date().toISOString(),
    type,
    userId,
    info
  };

  const text =
`📊 <b>LOG</b>
🕒 <code>${log.time}</code>
📌 <b>${type}</b>
👤 <code>${userId}</code>
📦 <pre>${JSON.stringify(info, null, 2)}</pre>`;

  bot.sendMessage(LOG_GROUP_ID, text, { parse_mode: "HTML" }).catch(() => {});
}

function generateKey(prefix) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
`🤖 <b>WW BOT RESGATE</b>

🔑 Envie sua key para validar
🛠 Use /admin se for administrador`,
  { parse_mode: "HTML" }
  );
});

// ===== ADMIN =====
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;

  bot.sendMessage(msg.chat.id,
`🛠 <b>Painel Admin</b>

🔹 Gerar Inject
🔹 Gerar Pharmacy
🔹 Gerar Basic

Use:
<code>/gen inject</code>
<code>/gen pharmacy</code>
<code>/gen basic</code>`,
  { parse_mode: "HTML" }
  );
});

// ===== GERAR =====
bot.onText(/\/gen (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;

  const pack = match[1];
  if (!["inject", "pharmacy", "basic"].includes(pack)) {
    return bot.sendMessage(msg.chat.id, "❌ Pack inválido");
  }

  waitingGen[msg.from.id] = pack;

  bot.sendMessage(msg.chat.id,
`🔢 Quantas keys deseja gerar? (1 a 100)`,
  { parse_mode: "HTML" }
  );
});

// ===== QUANTIDADE =====
bot.on("message", (msg) => {
  const userId = msg.from.id;
  if (!waitingGen[userId]) return;
  if (!msg.text.match(/^\d+$/)) return;

  const qty = parseInt(msg.text);
  if (qty < 1 || qty > 100) {
    return bot.sendMessage(msg.chat.id, "❌ Quantidade inválida");
  }

  const pack = waitingGen[userId];
  delete waitingGen[userId];

  let prefix =
    pack === "inject" ? "INJECT" :
    pack === "pharmacy" ? "PHARM" : "BASIC";

  let keys = [];
  for (let i = 0; i < qty; i++) {
    keys.push(generateKey(prefix));
  }

  const formatted =
`✅ <b>Keys geradas (${pack.toUpperCase()})</b>

<pre>${keys.join("\n")}</pre>`;

  bot.sendMessage(msg.chat.id, formatted, { parse_mode: "HTML" });

  logEvent("GERACAO_KEYS", userId, { pack, qty });
});

// ===== LOGS =====
bot.onText(/\/logs/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;

  bot.sendMessage(msg.chat.id,
`📊 <b>Últimos logs</b>

Os logs completos são enviados
automaticamente no grupo.`,
  { parse_mode: "HTML" }
  );
});

console.log("🤖 BOT FINAL rodando...");
