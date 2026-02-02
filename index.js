import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import fs from "fs";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN não definido");

const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -5164103528;

const PRODUCTS = {
  inject: { name: "Inject Pack", group: -1003801083393, prefix: "INJECT" },
  pharmacy: { name: "Pharmacy Pack", group: -1003705721917, prefix: "PHARMA" },
  basic: { name: "Basic Pack", group: -1003899281136, prefix: "BASIC" }
};

/* ================= INIT ================= */

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const db = new sqlite3.Database("./database.sqlite");

/* ================= DATABASE ================= */

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS keys (
    key TEXT PRIMARY KEY,
    pack TEXT,
    used INTEGER DEFAULT 0,
    user_id INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    user_id INTEGER,
    info TEXT,
    created_at TEXT
  )`);
});

/* ================= STATE ================= */

const userState = {};

/* ================= HELPERS ================= */

const now = () => new Date().toISOString();

function log(type, userId, info) {
  db.run(
    `INSERT INTO logs (type, user_id, info, created_at) VALUES (?,?,?,?)`,
    [type, userId, JSON.stringify(info), now()]
  );

  bot.sendMessage(
    LOG_GROUP_ID,
    `[${now()}]\n${type}\nID: ${userId}\nINFO: ${JSON.stringify(info)}`
  ).catch(() => {});
}

function genKey(prefix) {
  return `${prefix}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  userState[msg.from.id] = {};

  bot.sendMessage(
    msg.chat.id,
    `👋 Olá, seja bem-vindo!\n\nSelecione qual produto deseja resgatar:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💉 Inject Pack", callback_data: "pack_inject" }],
          [{ text: "🧪 Pharmacy Pack", callback_data: "pack_pharmacy" }],
          [{ text: "📱 Basic Pack", callback_data: "pack_basic" }]
        ]
      }
    }
  );
});

/* ================= ADMIN ================= */

bot.onText(/\/admin/, (msg) => {
  if (msg.from.id !== MASTER_ADMIN) return;

  bot.sendMessage(msg.chat.id, "🛠 Painel Admin", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💉 Gerar Inject", callback_data: "gen_inject" }],
        [{ text: "🧪 Gerar Pharmacy", callback_data: "gen_pharmacy" }],
        [{ text: "📱 Gerar Basic", callback_data: "gen_basic" }]
      ]
    }
  });
});

/* ================= LOGS ================= */

bot.onText(/\/logs/, (msg) => {
  if (msg.from.id !== MASTER_ADMIN) return;

  db.all(
    `SELECT * FROM logs ORDER BY id DESC LIMIT 10`,
    [],
    (_, rows) => {
      let text = "📊 Últimos logs:\n\n";
      rows.forEach((l) => {
        text += `[${l.created_at}]\n${l.type}\nID: ${l.user_id}\nINFO: ${l.info}\n\n`;
      });
      bot.sendMessage(msg.chat.id, text || "Sem logs.");
    }
  );
});

/* ================= CALLBACKS ================= */

bot.on("callback_query", async (q) => {
  const uid = q.from.id;
  const data = q.data;

  // USER PACK SELECTION
  if (data.startsWith("pack_")) {
    const pack = data.replace("pack_", "");
    userState[uid] = { pack };

    bot.sendMessage(
      q.message.chat.id,
      `⚠️ ATENÇÃO\n\nEnvie agora sua KEY para o ${PRODUCTS[pack].name}`
    );
    return;
  }

  // ADMIN KEY GENERATION
  if (uid === MASTER_ADMIN && data.startsWith("gen_")) {
    const pack = data.replace("gen_", "");
    userState[uid] = { genPack: pack };

    bot.sendMessage(
      q.message.chat.id,
      "🔢 Quantas keys deseja gerar? (1 a 100)"
    );
  }
});

/* ================= MESSAGE ================= */

bot.on("message", async (msg) => {
  const uid = msg.from.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  // ADMIN - GENERATE KEYS
  if (uid === MASTER_ADMIN && userState[uid]?.genPack) {
    const qty = Number(text);
    if (qty < 1 || qty > 100) return;

    const pack = userState[uid].genPack;
    let keys = [];

    for (let i = 0; i < qty; i++) {
      const key = genKey(PRODUCTS[pack].prefix);
      keys.push(key);
      db.run(`INSERT INTO keys VALUES (?, ?, 0, NULL)`, [key, pack]);
    }

    log("GERACAO_KEYS", uid, { pack, qty });

    bot.sendMessage(msg.chat.id, keys.join("\n"));
    userState[uid] = {};
    return;
  }

  // USER - VALIDATE KEY
  if (!userState[uid]?.pack) {
    log("KEY_INVALIDA", uid, text);
    return bot.sendMessage(msg.chat.id, "❌ Selecione um pack primeiro.");
  }

  const pack = userState[uid].pack;

  db.get(
    `SELECT * FROM keys WHERE key = ? AND pack = ? AND used = 0`,
    [text.trim(), pack],
    async (_, row) => {
      if (!row) {
        log("KEY_INVALIDA", uid, text);
        return bot.sendMessage(msg.chat.id, "❌ Key inválida.");
      }

      const invite = await bot.createChatInviteLink(PRODUCTS[pack].group, {
        member_limit: 1
      });

      db.run(`UPDATE keys SET used = 1, user_id = ? WHERE key = ?`, [
        uid,
        text.trim()
      ]);

      log("KEY_VALIDADA", uid, { key: text.trim(), pack });

      bot.sendMessage(msg.chat.id, invite.invite_link);
      userState[uid] = {};
    }
  );
});

console.log("🤖 BOT FINAL rodando...");
