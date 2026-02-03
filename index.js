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
    username TEXT,
    first_name TEXT,
    last_name TEXT,
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
  state[msg.from.id] = { step: "choose_pack" };

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
  );
});

/* ================= SERVIÇO ================= */

bot.onText(/\/servico/, (msg) => {
  isAdmin(msg.from.id, (ok) => {
    if (!ok) {
      bot.sendMessage(msg.chat.id, "⛔ Você não tem permissão.");
      return;
    }

    const keyboard = [
      [{ text: "🔑 Gerar Keys", callback_data: "gen_menu" }],
      [{ text: "📊 Logs", callback_data: "logs_menu" }]
    ];

    if (msg.from.id === MASTER_ADMIN)
      keyboard.push([{ text: "➕ Add Admin", callback_data: "add_admin" }]);

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

  /* ===== USER PACK ===== */
  if (q.data.startsWith("user_")) {
    const product = q.data.replace("user_", "");
    state[id] = { step: "await_key", product };

    return bot.sendMessage(
      chat,
      `📦 <b>${PRODUCTS[product].name}</b>\n\nEnvie sua <b>KEY</b> para liberar o acesso.`,
      { parse_mode: "HTML" }
    );
  }

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

    if (q.data === "add_admin" && id === MASTER_ADMIN) {
      state[id] = { step: "addadmin" };
      return bot.sendMessage(chat, "Envie o ID do novo admin:");
    }

    if (q.data === "logs_menu") {
      db.all(
        `SELECT rowid, date FROM logs ORDER BY rowid DESC LIMIT 10`,
        (_, rows) => {
          if (!rows.length)
            return bot.sendMessage(chat, "Nenhum log encontrado.");

          bot.sendMessage(chat, "Selecione um log:", {
            reply_markup: {
              inline_keyboard: rows.map(r => [
                { text: r.date, callback_data: "log_" + r.rowid }
              ])
            }
          });
        }
      );
    }

    if (q.data.startsWith("log_")) {
      db.get(
        `SELECT * FROM logs WHERE rowid=?`,
        [q.data.replace("log_", "")],
        (_, l) => {
          if (!l) return;

          bot.sendMessage(
            chat,
`📊 <b>LOG DE RESGATE</b>

<b>USUÁRIO:</b>
ID: <code>${l.user_id}</code>
Username: ${l.username || "N/A"}
Nome: ${l.first_name || ""} ${l.last_name || ""}

<b>KEY USADA:</b>
<code>${l.key}</code>

<b>PRODUTO:</b>
${l.product}

<b>DATA / HORÁRIO:</b>
${l.date}`,
            { parse_mode: "HTML" }
          );
        }
      );
    }
  });
});

/* ================= MESSAGES ================= */

bot.on("message", async (msg) => {
  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return;

  /* ===== ADD ADMIN ===== */
  if (state[id]?.step === "addadmin" && id === MASTER_ADMIN) {
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

  /* ===== VALIDAR KEY (USER) ===== */
  if (state[id]?.step === "await_key") {
    const productKey = state[id].product;
    const product = PRODUCTS[productKey];

    db.get(`SELECT * FROM keys WHERE key=?`, [text], async (_, row) => {
      if (!row || row.used || row.product !== productKey) {
        bot.sendMessage(msg.chat.id, "❌ Key inválida para este pack.");
        return;
      }

      const invite = await bot.createChatInviteLink(product.group, {
        member_limit: 1
      });

      db.run(`UPDATE keys SET used=1 WHERE key=?`, [text]);
      db.run(
        `INSERT INTO logs VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          text,
          product.name,
          id,
          msg.from.username || null,
          msg.from.first_name || null,
          msg.from.last_name || null,
          nowBR()
        ]
      );

      bot.sendMessage(
        msg.chat.id,
        `✅ <b>Acesso liberado!</b>\n\n${invite.invite_link}`,
        { parse_mode: "HTML" }
      );

      state[id] = null;
    });
  }
});

console.log("🤖 BOT ESTÁVEL RODANDO");
