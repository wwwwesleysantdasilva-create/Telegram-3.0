import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import fs from "fs";
import fetch from "node-fetch";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -1003713776395;

// ⚠️ SEU WEBHOOK DISCORD
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1470577182442000405/RvRTTT_-Rn15U_urvxLSzFzQ_1lNN9TCOJk5VOJ0aB0RINA6ub9iLsmltslaalfY_SO2";

const PRODUCTS = {
  INJECT: { name: "💉 Inject Pack", group: -1003801083393 },
  PHARM: { name: "🧪 Pharmacy Pack", group: -1003705721917 },
  BASIC: { name: "📱 Basic Pack", group: -1003899281136 }
};

/* ================= INIT ================= */

// FORÇA RECEBER TODOS OS EVENTOS DO TELEGRAM
const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    params: { allowed_updates: ["*"] }
  }
});

const db = new sqlite3.Database("./database.sqlite");

let state = {};
let conversations = {};

/* ================= DATABASE ================= */

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admins (id INTEGER UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS keys (
    key TEXT UNIQUE,
    product TEXT,
    used INTEGER DEFAULT 0
  )`);
});

/* ================= DISCORD LOG ================= */

function sendDiscord(msg) {
  fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: msg })
  }).catch(() => {});
}

/* ================= HELPERS ================= */

const nowBR = () =>
  new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

const genKey = (prefix) =>
  `${prefix}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

const isAdmin = (id, cb) => {
  if (id === MASTER_ADMIN) return cb(true);
  db.get(`SELECT id FROM admins WHERE id=?`, [id], (_, r) => cb(!!r));
};

function logMsg(uid, sender, text) {
  if (!conversations[uid]) return;
  conversations[uid].messages.push({
    time: nowBR(),
    sender,
    text
  });
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
${c.key || "NÃO INFORMADA"} (${c.valid === null ? "N/A" : c.valid ? "VÁLIDA" : "INVÁLIDA"})

Grupo Liberado:
${c.group || "NENHUM"}

Horário Entrada:
${c.joinTime || "NÃO ENTROU"}

===== CONVERSA =====
`;

  c.messages.forEach(m => {
    content += `[${m.time}] ${m.sender}: ${m.text}\n`;
  });

  const path = `./log_${uid}_${Date.now()}.txt`;
  fs.writeFileSync(path, content);
  return path;
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
  logMsg(id, `👤 ${userName}`, "/start");

  isAdmin(id, (isAdm) => {
    const keyboard = [
      [{ text: "💉 Inject Pack", callback_data: "user_INJECT" }],
      [{ text: "🧪 Pharmacy Pack", callback_data: "user_PHARM" }],
      [{ text: "📱 Basic Pack", callback_data: "user_BASIC" }]
    ];

    if (isAdm) keyboard.push([{ text: "🛠 Painel Admin", callback_data: "admin_panel" }]);

    bot.sendMessage(
      msg.chat.id,
      "👋 <b>Olá, seja bem-vindo!</b>\n\nEscolha uma opção:",
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard }
      }
    );
  });

  const file = generateTXT(id);
  bot.sendDocument(LOG_GROUP_ID, file, {
    caption: `📥 /START\n👤 ${userName}\n🕒 ${nowBR()}`
  });
});

/* ================= CALLBACKS ================= */

bot.on("callback_query", (q) => {
  const id = q.from.id;
  const chat = q.message.chat.id;
  const userName = q.from.first_name || "Usuário";

  if (q.data.startsWith("user_")) {
    const product = q.data.replace("user_", "");
    state[id] = { step: "await_key", product };

    conversations[id].product = PRODUCTS[product];
    logMsg(id, `👤 ${userName}`, PRODUCTS[product].name);

    bot.sendMessage(chat, `📦 <b>${PRODUCTS[product].name}</b>\n\nEnvie sua <b>KEY</b>:`, {
      parse_mode: "HTML"
    });
  }
});

/* ================= MESSAGES ================= */

bot.on("message", (msg) => {
  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return;

  const userName = msg.from.first_name || "Usuário";
  logMsg(id, `👤 ${userName}`, text);

  if (state[id]?.step === "await_key") {
    const productKey = state[id].product;
    const product = PRODUCTS[productKey];

    conversations[id].key = text;

    db.get(`SELECT * FROM keys WHERE key=?`, [text], async (_, row) => {
      if (!row || row.used || row.product !== productKey) {
        conversations[id].valid = false;
        const file = generateTXT(id);
        bot.sendDocument(LOG_GROUP_ID, file, {
          caption: `❌ KEY INVÁLIDA\n👤 ${userName}\n🕒 ${nowBR()}`
        });
        return bot.sendMessage(msg.chat.id, "❌ Key inválida.");
      }

      const invite = await bot.createChatInviteLink(product.group, {
        expire_date: Math.floor(Date.now() / 1000) + 3600
      });

      db.run(`UPDATE keys SET used=1 WHERE key=?`, [text]);

      conversations[id].valid = true;
      conversations[id].group = product.group;

      bot.sendMessage(msg.chat.id, `✅ <b>Acesso liberado!</b>\n\n${invite.invite_link}`, {
        parse_mode: "HTML"
      });

      const file = generateTXT(id);
      bot.sendDocument(LOG_GROUP_ID, file, {
        caption: `✅ RESGATE CONCLUÍDO\n📦 ${product.name}\n👤 ${userName}\n🕒 ${nowBR()}`
      });

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
      const time = nowBR();

      conversations[id].joinTime = time;
      logMsg(id, "🤖 BOT", "Usuário entrou no grupo");

      const file = generateTXT(id);
      bot.sendDocument(LOG_GROUP_ID, file, {
        caption: `👤 ENTROU NO GRUPO\n🆔 ${id}\n🕒 ${time}`
      });

      // 🔥 ENVIA PRO DISCORD (PROVA DE ENTREGA)
      sendDiscord(`
✅ CLIENTE ENTROU NO PRODUTO
👤 ID TELEGRAM: ${id}
📦 Produto: ${p.name}
🕒 Hora: ${time}
`);

      delete conversations[id];
    }
  }
});

console.log("🤖 BOT ONLINE — LOG TELEGRAM + DISCORD ATIVO");
