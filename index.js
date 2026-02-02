import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -5164103528;

const PRODUCTS = {
  INJECT: { name: "💉 Inject Pack", group: -1003801083393 },
  PHARM: { name: "🧪 Pharmacy Pack", group: -1003705721917 },
  BASIC: { name: "📱 Basic Pack", group: -1003899281136 }
};

/* ================= INIT ================= */

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const db = new sqlite3.Database("./database.sqlite");
let state = {};

/* ================= DATABASE ================= */

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admins (id INTEGER UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS keys (
    key TEXT UNIQUE,
    product TEXT,
    used INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS logs (
    key TEXT,
    product TEXT,
    user_id INTEGER,
    date TEXT
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

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
`👋 <b>Olá, seja bem-vindo!</b>

Envie sua <b>KEY</b> para liberar o acesso.`,
    { parse_mode: "HTML" }
  );
});

/* ================= SERVIÇO ================= */

bot.onText(/\/servico/, (msg) => {
  isAdmin(msg.from.id, (ok) => {
    if (!ok) return;

    bot.sendMessage(msg.chat.id, "🛠 <b>Painel de Serviço</b>", {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔑 Gerar Keys", callback_data: "gen_menu" }],
          [{ text: "📊 Logs", callback_data: "logs_menu" }],
          [{ text: "➕ Add Admin", callback_data: "add_admin" }]
        ]
      }
    });
  });
});

/* ================= CALLBACKS ================= */

bot.on("callback_query", (q) => {
  const id = q.from.id;
  const chat = q.message.chat.id;

  isAdmin(id, (ok) => {
    if (!ok) return;

    if (q.data === "gen_menu") {
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

    if (q.data.startsWith("gen_")) {
      state[id] = {
        step: "qty",
        product: q.data.replace("gen_", "")
      };
      return bot.sendMessage(chat, "Quantas keys deseja gerar?");
    }

    if (q.data === "add_admin") {
      state[id] = { step: "addadmin" };
      return bot.sendMessage(chat, "Envie o ID do novo admin:");
    }

    if (q.data === "logs_menu") {
      db.all(`SELECT rowid, date FROM logs ORDER BY rowid DESC LIMIT 10`, (_, rows) => {
        if (!rows.length)
          return bot.sendMessage(chat, "Nenhum log encontrado.");

        bot.sendMessage(chat, "Selecione um log:", {
          reply_markup: {
            inline_keyboard: rows.map(r => [
              { text: r.date, callback_data: "log_" + r.rowid }
            ])
          }
        });
      });
    }

    if (q.data.startsWith("log_")) {
      db.get(`SELECT * FROM logs WHERE rowid=?`, [q.data.replace("log_", "")], (_, l) => {
        if (!l) return;
        bot.sendMessage(chat,
`📊 LOG

KEY: ${l.key}
PRODUTO: ${l.product}
USUÁRIO: ${l.user_id}
DATA: ${l.date}`);
      });
    }
  });
});

/* ================= MESSAGES ================= */

bot.on("message", async (msg) => {
  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return;

  /* ===== ADD ADMIN ===== */
  if (state[id]?.step === "addadmin") {
    const uid = Number(text);
    if (!uid) {
      bot.sendMessage(msg.chat.id, "❌ ID inválido.");
      return;
    }

    db.run(`INSERT OR IGNORE INTO admins VALUES (?)`, [uid], function () {
      if (this.changes === 0)
        bot.sendMessage(msg.chat.id, "⚠️ Esse ID já é admin.");
      else
        bot.sendMessage(msg.chat.id, "✅ Admin adicionado com sucesso.");
    });

    state[id] = null;
    return;
  }

  /* ===== GERAR KEYS ===== */
  if (state[id]?.step === "qty") {
    const qty = parseInt(text);
    if (!qty || qty < 1 || qty > 100) {
      bot.sendMessage(msg.chat.id, "❌ Quantidade inválida.");
      return;
    }

    const prefix = state[id].product;
    let keys = [];

    for (let i = 0; i < qty; i++) {
      const key = genKey(prefix);
      keys.push(key);
      db.run(`INSERT INTO keys VALUES (?, ?, 0)`, [key, prefix]);
    }

    bot.sendMessage(msg.chat.id,
`✅ Keys geradas (${prefix})

<pre>${keys.join("\n")}</pre>`,
      { parse_mode: "HTML" }
    );

    state[id] = null;
    return;
  }

  /* ===== VALIDAR KEY ===== */
  if (!text.includes("-")) return;

  const prefix = text.split("-")[0];
  const product = PRODUCTS[prefix];
  if (!product) return;

  db.get(`SELECT * FROM keys WHERE key=?`, [text], async (_, row) => {
    if (!row || row.used) {
      bot.sendMessage(msg.chat.id, "❌ Key inválida ou já usada.");
      return;
    }

    const invite = await bot.createChatInviteLink(product.group, {
      member_limit: 1
    });

    db.run(`UPDATE keys SET used=1 WHERE key=?`, [text]);
    db.run(`INSERT INTO logs VALUES (?, ?, ?, ?)`, [
      text,
      product.name,
      id,
      nowBR()
    ]);

    bot.sendMessage(msg.chat.id,
`✅ Acesso liberado!

${invite.invite_link}`);
  });
});

console.log("🤖 BOT ESTÁVEL RODANDO");
