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

    if (isAdm) {
      keyboard.push([{ text: "🛠 Painel Admin", callback_data: "admin_panel" }]);
    }

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

  /* ===== PAINEL ADMIN ===== */
  if (q.data === "admin_panel") {
    return isAdmin(id, (ok) => {
      if (!ok) return;

      state[id] = null;

      const buttons = [
        [{ text: "🔑 Gerar Keys", callback_data: "admin_gen" }]
      ];

      if (id === MASTER_ADMIN) {
        buttons.push(
          [{ text: "➕ Add Admin", callback_data: "admin_add" }],
          [{ text: "➖ Remover Admin", callback_data: "admin_remove" }]
        );
      }

      bot.sendMessage(chat, "🛠 <b>Painel Administrativo</b>", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons }
      });

      logMsg(id, "🤖 BOT", "Painel admin aberto");
    });
  }

  /* ===== ADMIN ACTIONS ===== */

  if (q.data === "admin_gen") {
    state[id] = { step: "gen_choose" };
    return bot.sendMessage(chat, "Escolha o pack:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💉 Inject", callback_data: "gen_INJECT" }],
          [{ text: "🧪 Pharmacy", callback_data: "gen_PHARM" }],
          [{ text: "📱 Basic", callback_data: "gen_BASIC" }]
        ]
      }
    });
  }

  if (q.data === "admin_add" && id === MASTER_ADMIN) {
    state[id] = { step: "add_admin" };
    return bot.sendMessage(chat, "Envie o ID do novo admin:");
  }

  if (q.data === "admin_remove" && id === MASTER_ADMIN) {
    state[id] = { step: "remove_admin" };
    return bot.sendMessage(chat, "Envie o ID do admin para remover:");
  }

  if (q.data.startsWith("gen_")) {
    state[id] = { step: "gen_qty", product: q.data.replace("gen_", "") };
    return bot.sendMessage(chat, "Quantas keys deseja gerar?");
  }

  /* ===== USUÁRIO ===== */

  if (q.data.startsWith("user_")) {
    const product = q.data.replace("user_", "");
    state[id] = { step: "await_key", product };

    conversations[id].product = PRODUCTS[product];
    logMsg(id, `👤 ${userName}`, PRODUCTS[product].name);

    bot.sendMessage(
      chat,
      `📦 <b>${PRODUCTS[product].name}</b>\n\nEnvie sua <b>KEY</b>:`,
      { parse_mode: "HTML" }
    );
  }
});

/* ================= MESSAGES ================= */

bot.on("message", (msg) => {
  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return;

  const userName = msg.from.first_name || "Usuário";
  logMsg(id, `👤 ${userName}`, text);

  /* ===== ADD ADMIN ===== */
  if (state[id]?.step === "add_admin" && id === MASTER_ADMIN) {
    db.run(`INSERT OR IGNORE INTO admins VALUES (?)`, [Number(text)]);
    state[id] = null;
    return bot.sendMessage(msg.chat.id, "✅ Admin adicionado.");
  }

  /* ===== REMOVE ADMIN ===== */
  if (state[id]?.step === "remove_admin" && id === MASTER_ADMIN) {
    db.run(`DELETE FROM admins WHERE id=?`, [Number(text)]);
    state[id] = null;
    return bot.sendMessage(msg.chat.id, "✅ Admin removido.");
  }

  /* ===== GERAR KEYS ===== */
  if (state[id]?.step === "gen_qty") {
    const qty = parseInt(text);
    if (!qty || qty < 1 || qty > 100)
      return bot.sendMessage(msg.chat.id, "❌ Quantidade inválida.");

    const prefix = state[id].product;
    let keys = [];

    for (let i = 0; i < qty; i++) {
      const key = genKey(prefix);
      keys.push(key);
      db.run(`INSERT INTO keys (key, product, used) VALUES (?, ?, 0)`, [
        key,
        prefix
      ]);
    }

    state[id] = null;
    return bot.sendMessage(
      msg.chat.id,
      `✅ Keys geradas:\n\n<pre>${keys.join("\n")}</pre>`,
      { parse_mode: "HTML" }
    );
  }

  /* ===== VALIDAR KEY (SÓ AQUI) ===== */
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
        member_limit: 1
      });

      db.run(`UPDATE keys SET used=1 WHERE key=?`, [text]);

      conversations[id].valid = true;
      conversations[id].group = product.group;

      bot.sendMessage(
        msg.chat.id,
        `✅ <b>Acesso liberado!</b>\n\n${invite.invite_link}`,
        { parse_mode: "HTML" }
      );

      const file = generateTXT(id);
      bot.sendDocument(LOG_GROUP_ID, file, {
        caption: `✅ RESGATE CONCLUÍDO\n📦 ${product.name}\n👤 ${userName}\n🕒 ${nowBR()}`
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
    logMsg(id, "🤖 BOT", "Usuário entrou no grupo");
  }
});

console.log("🤖 BOT ONLINE — PAINEL ADMIN E KEYS FUNCIONAIS");
