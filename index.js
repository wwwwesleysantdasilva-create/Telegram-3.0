import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import fs from "fs";
import fetch from "node-fetch"; // <<< ADICIONADO

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -1003713776395;

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1470577182442000405/RvRTTT_-Rn15U_urvxLSzFzQ_1lNN9TCOJk5VOJ0aB0RINA6ub9iLsmltslaalfY_SO2";

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

/* ===== DISCORD EMBED BONITO ===== */
async function sendDiscord(data) {
  try {
    const embed = {
      title: "✅ NOVO RESGATE",
      color: 0x00ff99,
      fields: [
        { name: "👤 Usuário", value: data.user, inline: true },
        { name: "🆔 ID", value: String(data.id), inline: true },
        { name: "💉 Produto", value: data.product, inline: false },
        { name: "🔑 Key", value: `\`${data.key}\``, inline: false },
        { name: "⏰ Hora", value: data.time, inline: false }
      ],
      footer: { text: "Sistema WW App" },
      timestamp: new Date()
    };

    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] })
    });
  } catch (e) {}
}

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

    bot.sendMessage(msg.chat.id, "Escolha uma opção
