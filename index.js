import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import fs from "fs";

/* ================= CONFIG FIXA ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN não definido");
}

const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -5164103528;

const PRODUCTS = {
  inject: {
    name: "Inject",
    group: -1003801083393,
    prefix: "INJ"
  },
  pharmacy: {
    name: "Pharmacy",
    group: -1003705721917,
    prefix: "PHA"
  },
  basic: {
    name: "Basic",
    group: -1003899281136,
    prefix: "BAS"
  }
};

/* ============================================== */

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const db = new sqlite3.Database("./database.sqlite");

/* ================= DATABASE ================= */

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admins (user_id INTEGER UNIQUE)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS keys (
      key TEXT PRIMARY KEY,
      product TEXT,
      used INTEGER DEFAULT 0,
      user_id INTEGER,
      created_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER,
      product TEXT,
      UNIQUE(user_id, product)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS attempts (
      user_id INTEGER,
      count INTEGER,
      last_try INTEGER
    )
  `);
});

/* ================= HELPERS ================= */

const now = () => new Date().toLocaleString("pt-BR");

const generateKey = (prefix) =>
  `${prefix}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

const logFile = (key, text) => {
  fs.appendFileSync(`./${key}.txt`, text + "\n");
};

const logTG = (text) => {
  bot.sendMessage(LOG_GROUP_ID, text).catch(() => {});
};

function isAdmin(userId, cb) {
  if (userId === MASTER_ADMIN) return cb(true);
  db.get(
    `SELECT user_id FROM admins WHERE user_id = ?`,
    [userId],
    (_, row) => cb(!!row)
  );
}

/* ================= ANTI-BRUTE ================= */

function antiBrute(userId, ok, fail) {
  const time = Date.now();

  db.get(`SELECT * FROM attempts WHERE user_id = ?`, [userId], (_, row) => {
    if (!row) {
      db.run(`INSERT INTO attempts VALUES (?, ?, ?)`, [userId, 1, time]);
      return ok();
    }

    if (row.count >= 5 && time - row.last_try < 60000) {
      return fail();
    }

    db.run(
      `UPDATE attempts SET count = count + 1, last_try = ? WHERE user_id = ?`,
      [time, userId]
    );
    ok();
  });
}

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "🤖 Bot de acesso ativo.\n\nEnvie sua key para liberar o acesso."
  );
});

/* ================= PAINEL ADMIN ================= */

bot.onText(/\/admin/, (msg) => {
  isAdmin(msg.from.id, (ok) => {
    if (!ok) return;

    bot.sendMessage(msg.chat.id, "📊 Painel Admin", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Add Admin", callback_data: "add_admin" }],
          [{ text: "➖ Remover Admin", callback_data: "del_admin" }],
          [{ text: "🔑 Key Inject", callback_data: "gen_inject" }],
          [{ text: "🔑 Key Pharmacy", callback_data: "gen_pharmacy" }],
          [{ text: "🔑 Key Basic", callback_data: "gen_basic" }]
        ]
      }
    });
  });
});

/* ================= CALLBACKS ================= */

bot.on("callback_query", (q) => {
  const userId = q.from.id;

  isAdmin(userId, (ok) => {
    if (!ok) return;

    const chatId = q.message.chat.id;

    if (q.data === "add_admin") {
      bot.sendMessage(chatId, "Envie o ID do novo admin:");
      bot.once("message", (m) => {
        const uid = Number(m.text);
        if (!uid) return;
        db.run(`INSERT OR IGNORE INTO admins VALUES (?)`, [uid]);
        bot.sendMessage(chatId, "✅ Admin adicionado.");
      });
      return;
    }

    if (q.data === "del_admin") {
      bot.sendMessage(chatId, "Envie o ID do admin para remover:");
      bot.once("message", (m) => {
        const uid = Number(m.text);
        if (!uid || uid === MASTER_ADMIN) return;
        db.run(`DELETE FROM admins WHERE user_id = ?`, [uid]);
        bot.sendMessage(chatId, "❌ Admin removido.");
      });
      return;
    }

    const product = q.data.replace("gen_", "");
    const p = PRODUCTS[product];
    if (!p) return;

    const key = generateKey(p.prefix);

    db.run(
      `INSERT INTO keys VALUES (?, ?, 0, NULL, ?)`,
      [key, product, now()]
    );

    bot.sendMessage(chatId, `🔑 ${p.name}\n\n${key}`);
  });
});

/* ================= VALIDAR KEY ================= */

bot.on("message", (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const userId = msg.from.id;
  const keyInput = msg.text.trim();

  antiBrute(
    userId,
    () => {
      db.get(`SELECT * FROM keys WHERE key = ?`, [keyInput], async (_, keyRow) => {
        if (!keyRow || keyRow.used) {
          return bot.sendMessage(msg.chat.id, "❌ Key inválida.");
        }

        db.get(
          `SELECT * FROM users WHERE user_id = ? AND product = ?`,
          [userId, keyRow.product],
          async (_, userRow) => {
            if (userRow) {
              return bot.sendMessage(
                msg.chat.id,
                "⚠️ Você já usou uma key desse produto."
              );
            }

            const p = PRODUCTS[keyRow.product];

            const invite = await bot.createChatInviteLink(p.group, {
              member_limit: 1
            });

            db.run(`UPDATE keys SET used = 1, user_id = ? WHERE key = ?`, [
              userId,
              keyInput
            ]);

            db.run(`INSERT INTO users VALUES (?, ?)`, [
              userId,
              keyRow.product
            ]);

            const log = `
KEY: ${keyInput}
USER: ${userId}
PRODUTO: ${p.name}
HORA: ${now()}
STATUS: OK
            `.trim();

            logFile(keyInput, log);
            logTG("✅ Key usada\n" + log);

            bot.sendMessage(msg.chat.id, invite.invite_link);
          }
        );
      });
    },
    () => {
      bot.sendMessage(
        msg.chat.id,
        "🚫 Muitas tentativas. Aguarde 1 minuto."
      );
    }
  );
});

/* ================= SILENCIOSO ================= */

bot.on("new_chat_members", (msg) => {
  bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
});

console.log("🤖 BOT FINAL rodando...");
