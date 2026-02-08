import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import fs from "fs";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -1003713776395;

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
  db.run(`CREATE TABLE IF NOT EXISTS admins (id INTEGER UNIQUE)`);

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
  `${prefix}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

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
Nome: ${c.user.first_name || ""} ${c.user.last_name || ""}
Username: @${c.user.username || "N/A"}
ID: ${c.user.id}

Produto:
${c.product?.name || "NÃO SELECIONADO"}

Key:
${c.key || "NÃO INFORMADA"} (${c.valid === null ? "N/A" : c.valid ? "VALIDA" : "INVÁLIDA"})

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

  conversations[id] = {
    user: msg.from,
    product: null,
    key: null,
    valid: null,
    group: null,
    joinTime: null,
    messages: []
  };

  logMsg(id, "USUÁRIO", "/start");

  bot.sendMessage(
    msg.chat.id,
    "👋 <b>Olá, seja bem-vindo!</b>\n\nQual pack você deseja resgatar?",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💉 Inject Pack", callback_data: "user_INJECT" }],
          [{ text: "🧪 Pharmacy Pack", callback_data: "user_PHARM" }],
          [{ text: "📱 Basic Pack", callback_data: "user_BASIC" }]
        ]
      }
    }
  ).then(() => {
    logMsg(id, "BOT", "Menu de packs enviado");
  });

  // LOG IMEDIATO DO /START
  const file = generateTXT(id);
  bot.sendDocument(LOG_GROUP_ID, file, {
    caption: `📥 /START DETECTADO\n👤 ${msg.from.first_name}\n🕒 ${nowBR()}`
  });
});

/* ================= SERVIÇO ================= */

bot.onText(/\/servico/, (msg) => {
  isAdmin(msg.from.id, (ok) => {
    if (!ok) return bot.sendMessage(msg.chat.id, "⛔ Sem permissão.");

    const keyboard = [
      [{ text: "🔑 Gerar Keys", callback_data: "gen_menu" }],
      [{ text: "➕ Add Admin", callback_data: "add_admin" }],
      [{ text: "➖ Remover Admin", callback_data: "rem_admin" }]
    ];

    bot.sendMessage(msg.chat.id, "🛠 <b>Painel de Serviço</b>", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard }
    });
  });
});

/* ================= CALLBACKS ================= */

bot.on("callback_query", (q) => {
  const id = q.from.id;
  const chat = q.message.chat.id;

  if (q.data.startsWith("user_")) {
    const product = q.data.replace("user_", "");
    state[id] = { step: "await_key", product };

    conversations[id].product = PRODUCTS[product];
    logMsg(id, "USUÁRIO", PRODUCTS[product].name);

    return bot.sendMessage(
      chat,
      `📦 <b>${PRODUCTS[product].name}</b>\n\nEnvie sua <b>KEY</b>.`,
      { parse_mode: "HTML" }
    ).then(() => logMsg(id, "BOT", "Solicitou key"));
  }

  isAdmin(id, (ok) => {
    if (!ok) return;

    if (q.data === "add_admin") {
      state[id] = { step: "addadmin" };
      return bot.sendMessage(chat, "Envie o ID do novo admin:");
    }

    if (q.data === "rem_admin") {
      state[id] = { step: "remadmin" };
      return bot.sendMessage(chat, "Envie o ID do admin para remover:");
    }
  });
});

/* ================= MESSAGES ================= */

bot.on("message", async (msg) => {
  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return;

  logMsg(id, "USUÁRIO", text);

  if (state[id]?.step === "addadmin" && id === MASTER_ADMIN) {
    db.run(`INSERT OR IGNORE INTO admins VALUES (?)`, [Number(text)]);
    state[id] = null;
    return bot.sendMessage(msg.chat.id, "✅ Admin adicionado.");
  }

  if (state[id]?.step === "remadmin" && id === MASTER_ADMIN) {
    db.run(`DELETE FROM admins WHERE id=?`, [Number(text)]);
    state[id] = null;
    return bot.sendMessage(msg.chat.id, "✅ Admin removido.");
  }

  if (state[id]?.step === "await_key") {
    const productKey = state[id].product;
    const product = PRODUCTS[productKey];

    conversations[id].key = text;

    db.get(`SELECT * FROM keys WHERE key=?`, [text], async (_, row) => {
      if (!row || row.used || row.product !== productKey) {
        conversations[id].valid = false;

        const file = generateTXT(id);
        bot.sendDocument(LOG_GROUP_ID, file, {
          caption: `❌ TENTATIVA INVÁLIDA\n👤 ${msg.from.first_name}\n🕒 ${nowBR()}`
        });

        return bot.sendMessage(msg.chat.id, "❌ Key inválida.");
      }

      const invite = await bot.createChatInviteLink(product.group, {
        member_limit: 1
      });

      conversations[id].valid = true;
      conversations[id].group = product.group;

      bot.sendMessage(
        msg.chat.id,
        `✅ <b>Acesso liberado!</b>\n\n${invite.invite_link}`,
        { parse_mode: "HTML" }
      );

      const file = generateTXT(id);
      bot.sendDocument(LOG_GROUP_ID, file, {
        caption: `✅ RESGATE CONCLUÍDO\n📦 ${product.name}\n👤 ${msg.from.first_name}\n🕒 ${nowBR()}`
      });

      state[id] = null;
      delete conversations[id];
    });
  }
});

bot.on("chat_member", (u) => {
  const id = u.from?.id;
  if (conversations[id]) {
    conversations[id].joinTime = nowBR();
  }
});

console.log("🤖 BOT RODANDO COM LOG FORENSE ATIVO");
