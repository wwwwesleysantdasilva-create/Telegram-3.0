import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import fs from "fs";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -5164103528;

const PRODUCTS = {
  inject: { name: "💉 Inject Pack", prefix: "INJECT", group: -1003801083393 },
  pharmacy: { name: "🧪 Pharmacy Pack", prefix: "PHARM", group: -1003705721917 },
  basic: { name: "📱 Basic Pack", prefix: "BASIC", group: -1003899281136 }
};

/* ================= INIT ================= */

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const db = new sqlite3.Database("./database.sqlite");

let state = {};

/* ================= DATABASE ================= */

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admins (id INTEGER UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS logs (
    key TEXT,
    product TEXT,
    user_id INTEGER,
    date TEXT
  )`);
});

/* ================= HELPERS ================= */

const now = () => new Date().toLocaleString("pt-BR");

const genKey = (p) =>
  `${p}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

const isAdmin = (id, cb) => {
  if (id === MASTER_ADMIN) return cb(true);
  db.get(`SELECT id FROM admins WHERE id=?`, [id], (_, r) => cb(!!r));
};

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
`👋 <b>Olá, seja bem-vindo!</b>

Bem-vindo à validação e entrega do seu produto.
Selecione qual produto você deseja resgatar:`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💉 Inject Pack", callback_data: "res_inject" }],
          [{ text: "🧪 Pharmacy Pack", callback_data: "res_pharmacy" }],
          [{ text: "📱 Basic Pack", callback_data: "res_basic" }]
        ]
      }
    }
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
          [{ text: "➕ Add Admin", callback_data: "add_admin" }],
          [{ text: "📋 Listar Admins", callback_data: "list_admins" }]
        ]
      }
    });
  });
});

/* ================= CALLBACKS ================= */

bot.on("callback_query", async (q) => {
  const id = q.from.id;
  const chat = q.message.chat.id;

  /* ===== RESGATE ===== */
  if (q.data.startsWith("res_")) {
    const product = q.data.replace("res_", "");
    state[id] = { action: "rescue", product };
    return bot.sendMessage(chat, "🔑 Envie sua KEY:");
  }

  /* ===== ADMIN CHECK ===== */
  isAdmin(id, (ok) => {
    if (!ok) return;

    /* ===== GERAR MENU ===== */
    if (q.data === "gen_menu") {
      return bot.sendMessage(chat, "Escolha o pack:", {
        reply_markup: {
          inline_keyboard: Object.keys(PRODUCTS).map(p => [
            { text: PRODUCTS[p].name, callback_data: "gen_" + p }
          ])
        }
      });
    }

    /* ===== GERAR ===== */
    if (q.data.startsWith("gen_")) {
      state[id] = { action: "gen", product: q.data.replace("gen_", "") };
      return bot.sendMessage(chat, "Quantas keys deseja gerar?");
    }

    /* ===== LOGS ===== */
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
`📊 <b>LOG</b>

KEY: <code>${l.key}</code>
PRODUTO: ${l.product}
USUÁRIO: ${l.user_id}
DATA: ${l.date}`,
          { parse_mode: "HTML" }
        );
      });
    }

    /* ===== ADD ADMIN ===== */
    if (q.data === "add_admin") {
      bot.sendMessage(chat, "Envie o ID do novo admin:");
      state[id] = { action: "addadmin" };
    }

    if (q.data === "list_admins") {
      db.all(`SELECT id FROM admins`, (_, rows) => {
        const list = rows.map(r => r.id).join("\n") || "Nenhum";
        bot.sendMessage(chat, `<pre>${list}</pre>`, { parse_mode: "HTML" });
      });
    }
  });
});

/* ================= MESSAGES ================= */

bot.on("message", async (msg) => {
  const id = msg.from.id;
  const text = msg.text;
  if (!state[id]) return;

  /* ===== GERAR KEYS ===== */
  if (state[id].action === "gen") {
    const qty = parseInt(text);
    if (!qty || qty < 1 || qty > 100) return;

    const p = PRODUCTS[state[id].product];
    let keys = [];

    for (let i = 0; i < qty; i++) keys.push(genKey(p.prefix));

    bot.sendMessage(msg.chat.id,
`✅ <b>Keys geradas (${p.name})</b>

<pre>${keys.join("\n")}</pre>`,
      { parse_mode: "HTML" }
    );

    state[id] = null;
  }

  /* ===== ADD ADMIN ===== */
  if (state[id].action === "addadmin") {
    const uid = Number(text);
    if (!uid) return;

    db.run(`INSERT OR IGNORE INTO admins VALUES (?)`, [uid]);
    bot.sendMessage(msg.chat.id, "✅ Admin adicionado com sucesso.");
    state[id] = null;
  }

  /* ===== RESGATE ===== */
  if (state[id].action === "rescue") {
    const product = PRODUCTS[state[id].product];
    const key = text.trim();

    const invite = await bot.createChatInviteLink(product.group, {
      member_limit: 1
    });

    db.run(`INSERT INTO logs VALUES (?, ?, ?, ?)`, [
      key,
      product.name,
      id,
      now()
    ]);

    bot.sendMessage(msg.chat.id,
`✅ <b>Acesso liberado!</b>

${invite.invite_link}`,
      { parse_mode: "HTML" }
    );

    state[id] = null;
  }
});

console.log("🤖 BOT FINAL rodando...");
