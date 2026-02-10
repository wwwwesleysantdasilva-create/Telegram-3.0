import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import fs from "fs";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -1003713776395;

// SEU WEBHOOK DISCORD
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1470577182442000405/RvRTTT_-Rn15U_urvxLSzFzQ_1lNN9TCOJk5VOJ0aB0RINA6ub9iLsmltslaalfY_SO2";

const PRODUCTS = {
  INJECT: { name: "💉 Inject Pack", group: -1003801083393 },
  PHARM: { name: "🧪 Pharmacy Pack", group: -1003705721917 },
  BASIC: { name: "📱 Basic Pack", group: -1003899281136 }
};

/* ================= INIT ================= */

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const db = new sqlite3.Database("./database.sqlite");

let state = {};
let conversations = {};

/* ================= DATABASE ================= */

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS keys (
    key TEXT UNIQUE,
    product TEXT,
    used INTEGER DEFAULT 0
  )`);
});

/* ================= HELPERS ================= */

const nowBR = () =>
  new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

const genKey = (prefix) =>
  `${prefix}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

function logMsg(uid, sender, text) {
  if (!conversations[uid]) return;
  conversations[uid].messages.push({ time: nowBR(), sender, text });
}

function generateTXT(uid) {
  const c = conversations[uid];
  if (!c) return null;

  let content = `===== LOG DE ATENDIMENTO =====

Usuário:
Nome: ${c.user.first_name || ""}
Username: @${c.user.username || "N/A"}
ID: ${c.user.id}

Produto:
${c.product?.name || "NÃO SELECIONADO"}

Key:
${c.key || "NÃO INFORMADA"} (${c.valid ? "VÁLIDA" : "INVÁLIDA"})

Grupo:
${c.group || "NENHUM"}

Entrou no Grupo:
${c.joinTime || "NÃO"}

===== CONVERSA =====
`;

  c.messages.forEach(m => {
    content += `[${m.time}] ${m.sender}: ${m.text}\n`;
  });

  const path = `./log_${uid}_${Date.now()}.txt`;
  fs.writeFileSync(path, content);
  return path;
}

// Enviar log para Discord
function sendDiscord(msg) {
  fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: msg })
  }).catch(() => {});
}

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  const id = msg.from.id;
  const userName = msg.from.first_name || "Usuário";

  conversations[id] = {
    user: msg.from,
    product: null,
    key: null,
    valid: null,
    group: null,
    joinTime: null,
    messages: []
  };

  state[id] = null;
  logMsg(id, "USER", "/start");

  const keyboard = [
    [{ text: "💉 Inject Pack", callback_data: "user_INJECT" }],
    [{ text: "🧪 Pharmacy Pack", callback_data: "user_PHARM" }],
    [{ text: "📱 Basic Pack", callback_data: "user_BASIC" }]
  ];

  bot.sendMessage(msg.chat.id, "Escolha o pack:", {
    reply_markup: { inline_keyboard: keyboard }
  });
});

/* ================= CALLBACK ================= */

bot.on("callback_query", (q) => {
  const id = q.from.id;
  const product = q.data.replace("user_", "");

  if (q.data.startsWith("user_")) {
    state[id] = { step: "await_key", product };
    conversations[id].product = PRODUCTS[product];

    bot.sendMessage(q.message.chat.id, "Envie sua KEY:");
  }
});

/* ================= MESSAGE ================= */

bot.on("message", (msg) => {
  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return;

  logMsg(id, "USER", text);

  if (state[id]?.step === "await_key") {
    const productKey = state[id].product;
    const product = PRODUCTS[productKey];

    conversations[id].key = text;

    db.get(`SELECT * FROM keys WHERE key=?`, [text], async (_, row) => {
      if (!row || row.used || row.product !== productKey) {
        conversations[id].valid = false;
        return bot.sendMessage(msg.chat.id, "❌ Key inválida.");
      }

      const invite = await bot.createChatInviteLink(product.group, {
        member_limit: 1
      });

      db.run(`UPDATE keys SET used=1 WHERE key=?`, [text]);

      conversations[id].valid = true;
      conversations[id].group = product.group;

      bot.sendMessage(msg.chat.id, `✅ Acesso liberado:\n${invite.invite_link}`);
      state[id] = null;
    });
  }
});

/* ================= DETECTAR ENTRADA NO GRUPO ================= */

bot.on("chat_member", (u) => {
  const user = u.new_chat_member?.user;
  const chatId = u.chat?.id;
  if (!user) return;

  const id = user.id;

  for (const p of Object.values(PRODUCTS)) {
    if (p.group === chatId && conversations[id]) {
      conversations[id].joinTime = nowBR();
      logMsg(id, "BOT", "Entrou no grupo");

      const file = generateTXT(id);
      bot.sendDocument(LOG_GROUP_ID, file, {
        caption: `👤 ENTROU NO GRUPO\nID: ${id}`
      });

      sendDiscord(`✅ CLIENTE ENTROU\nUser: ${user.first_name}\nID: ${id}\nGrupo: ${p.name}\nHora: ${nowBR()}`);

      delete conversations[id]; // agora pode apagar
    }
  }
});

console.log("BOT ONLINE");
