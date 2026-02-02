import TelegramBot from "node-telegram-bot-api";
import fs from "fs";

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error("BOT_TOKEN não definido");

const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -5164103528;

const bot = new TelegramBot(TOKEN, { polling: true });

// ===== STORAGE =====
let waitingGen = {};
let admins = new Set([MASTER_ADMIN]);

if (fs.existsSync("./admins.json")) {
  admins = new Set(JSON.parse(fs.readFileSync("./admins.json")));
}

function saveAdmins() {
  fs.writeFileSync("./admins.json", JSON.stringify([...admins]));
}

// ===== UTIL =====
function isAdmin(id) {
  return admins.has(id);
}

function now() {
  return new Date().toLocaleString("pt-BR");
}

function generateKey(prefix) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

function logKey(key, data) {
  const line =
`DATA: ${now()}
KEY: ${key}
USER: ${data.userId}
CHAT: ${data.chatId}
PACK: ${data.pack}
COMANDO: ${data.command}
----------------------\n`;

  fs.appendFileSync(`./logs_${key}.log`, line);

  bot.sendMessage(
    LOG_GROUP_ID,
    `📊 <b>LOG KEY</b>\n<pre>${line}</pre>`,
    { parse_mode: "HTML" }
  ).catch(() => {});
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
`🤖 <b>WW BOT RESGATE</b>

🔑 Envie sua key para validar
🛠 /admin para painel`,
    { parse_mode: "HTML" }
  );
});

// ===== ADMIN PANEL =====
bot.onText(/\/admin/, (msg) => {
  if (!isAdmin(msg.from.id)) return;

  bot.sendMessage(
    msg.chat.id,
`🛠 <b>Painel Admin</b>

🔑 /gen inject
🔑 /gen pharmacy
🔑 /gen basic

👤 /addadmin ID
👤 /deladmin ID
📋 /listadmins

📊 /logs KEY`,
    { parse_mode: "HTML" }
  );
});

// ===== ADMIN MANAGEMENT =====
bot.onText(/\/addadmin (\d+)/, (msg, match) => {
  if (msg.from.id !== MASTER_ADMIN) return;

  admins.add(Number(match[1]));
  saveAdmins();
  bot.sendMessage(msg.chat.id, "✅ Admin adicionado");
});

bot.onText(/\/deladmin (\d+)/, (msg, match) => {
  if (msg.from.id !== MASTER_ADMIN) return;

  admins.delete(Number(match[1]));
  saveAdmins();
  bot.sendMessage(msg.chat.id, "❌ Admin removido");
});

bot.onText(/\/listadmins/, (msg) => {
  if (!isAdmin(msg.from.id)) return;

  bot.sendMessage(
    msg.chat.id,
    `<pre>${[...admins].join("\n")}</pre>`,
    { parse_mode: "HTML" }
  );
});

// ===== GERAR KEYS =====
bot.onText(/\/gen (inject|pharmacy|basic)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  waitingGen[msg.from.id] = match[1];

  bot.sendMessage(
    msg.chat.id,
    "🔢 Quantas keys deseja gerar? (1 a 100)"
  );
});

// ===== QUANTIDADE =====
bot.on("message", (msg) => {
  const userId = msg.from.id;
  if (!waitingGen[userId]) return;
  if (!/^\d+$/.test(msg.text)) return;

  const qty = Number(msg.text);
  if (qty < 1 || qty > 100) {
    return bot.sendMessage(msg.chat.id, "❌ Quantidade inválida");
  }

  const pack = waitingGen[userId];
  delete waitingGen[userId];

  const prefix =
    pack === "inject" ? "INJECT" :
    pack === "pharmacy" ? "PHARM" :
    "BASIC";

  let keys = [];
  for (let i = 0; i < qty; i++) {
    const key = generateKey(prefix);
    keys.push(key);

    logKey(key, {
      userId,
      chatId: msg.chat.id,
      pack,
      command: "/gen"
    });
  }

  bot.sendMessage(
    msg.chat.id,
`✅ <b>Keys geradas (${pack.toUpperCase()})</b>

<pre>${keys.join("\n")}</pre>`,
    { parse_mode: "HTML" }
  );
});

// ===== LOGS POR KEY =====
bot.onText(/\/logs (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const key = match[1];
  const file = `./logs_${key}.log`;

  if (!fs.existsSync(file)) {
    return bot.sendMessage(msg.chat.id, "❌ Nenhum log encontrado");
  }

  const content = fs.readFileSync(file, "utf8");

  bot.sendMessage(
    msg.chat.id,
`📊 <b>Logs da key ${key}</b>

<pre>${content}</pre>`,
    { parse_mode: "HTML" }
  );
});

console.log("🤖 WW BOT RESGATE rodando...");
