import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import fs from "fs";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -5164103528;

const PRODUCTS = {
  inject: { name: "Inject", group: -1003801083393, prefix: "INJECT" },
  pharmacy: { name: "Pharmacy", group: -1003705721917, prefix: "PHARM" },
  basic: { name: "Basic", group: -1003899281136, prefix: "BASIC" }
};

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const db = new sqlite3.Database("./database.sqlite");

let state = {};

/* ================= DATABASE ================= */

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admins (user_id INTEGER UNIQUE)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT,
      type TEXT,
      user_id INTEGER,
      info TEXT
    )
  `);
});

/* ================= HELPERS ================= */

const now = () => new Date().toLocaleString("pt-BR");

function isAdmin(id, cb) {
  if (id === MASTER_ADMIN) return cb(true);
  db.get(`SELECT user_id FROM admins WHERE user_id = ?`, [id], (_, r) => cb(!!r));
}

function saveLog(type, userId, info) {
  db.run(
    `INSERT INTO logs (time, type, user_id, info) VALUES (?, ?, ?, ?)`,
    [now(), type, userId, JSON.stringify(info)]
  );
}

function generateKey(prefix) {
  return `${prefix}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "🤖 Bot ativo.\n\nEnvie sua key para validar.");
});

/* ================= SERVIÇO ================= */

bot.onText(/\/serviço/, (msg) => {
  isAdmin(msg.from.id, (ok) => {
    if (!ok) return;

    bot.sendMessage(msg.chat.id, "🛠 Painel de Serviço", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔑 Gerar Key", callback_data: "svc_gen" }],
          [{ text: "📊 Logss", callback_data: "svc_logs" }]
        ]
      }
    });
  });
});

/* ================= ADD ADMIN ================= */

bot.onText(/\/addadmin/, (msg) => {
  if (msg.from.id !== MASTER_ADMIN) return;

  state[msg.from.id] = { action: "addadmin" };
  bot.sendMessage(msg.chat.id, "Envie o ID do novo admin:");
});

bot.on("message", (msg) => {
  const s = state[msg.from.id];
  if (!s) return;

  if (s.action === "addadmin") {
    const id = Number(msg.text);
    if (!id) return;

    db.run(`INSERT OR IGNORE INTO admins VALUES (?)`, [id]);
    delete state[msg.from.id];

    bot.sendMessage(msg.chat.id, "✅ Admin adicionado com sucesso.");
  }

  if (s.action === "qty") {
    const qty = Number(msg.text);
    if (!qty || qty < 1 || qty > 100) return;

    const pack = s.pack;
    delete state[msg.from.id];

    let keys = [];
    for (let i = 0; i < qty; i++) {
      keys.push(generateKey(PRODUCTS[pack].prefix));
    }

    bot.sendMessage(
      msg.chat.id,
      `✅ Keys geradas (${PRODUCTS[pack].name})\n\n<pre>${keys.join("\n")}</pre>`,
      { parse_mode: "HTML" }
    );

    saveLog("GERACAO_KEYS", msg.from.id, { pack, qty });
  }
});

/* ================= CALLBACKS ================= */

bot.on("callback_query", (q) => {
  const id = q.from.id;

  isAdmin(id, (ok) => {
    if (!ok) return;

    if (q.data === "svc_gen") {
      bot.sendMessage(q.message.chat.id, "Escolha o pack:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "💉 Inject", callback_data: "gen_inject" }],
            [{ text: "🧪 Pharmacy", callback_data: "gen_pharmacy" }],
            [{ text: "📦 Basic", callback_data: "gen_basic" }]
          ]
        }
      });
    }

    if (q.data.startsWith("gen_")) {
      const pack = q.data.replace("gen_", "");
      state[id] = { action: "qty", pack };
      bot.sendMessage(q.message.chat.id, "Quantas keys deseja gerar?");
    }

    if (q.data === "svc_logs") {
      db.all(`SELECT * FROM logs ORDER BY id DESC LIMIT 5`, [], (_, rows) => {
        const buttons = rows.map(r => [
          { text: `${r.time}`, callback_data: `log_${r.id}` }
        ]);

        bot.sendMessage(q.message.chat.id, "📊 Logs:", {
          reply_markup: { inline_keyboard: buttons }
        });
      });
    }

    if (q.data.startsWith("log_")) {
      const idlog = q.data.replace("log_", "");
      db.get(`SELECT * FROM logs WHERE id = ?`, [idlog], (_, r) => {
        if (!r) return;

        bot.sendMessage(
          q.message.chat.id,
`📊 LOG DETALHADO

🕒 ${r.time}
📌 ${r.type}
👤 ${r.user_id}

<pre>${r.info}</pre>`,
          { parse_mode: "HTML" }
        );
      });
    }
  });
});

console.log("🤖 BOT rodando");
