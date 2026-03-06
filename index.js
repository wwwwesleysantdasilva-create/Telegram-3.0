import TelegramBot from "node-telegram-bot-api";

console.log("🚀 Iniciando bot...");

const token = process.env.BOT_TOKEN;

const bot = new TelegramBot(token, { polling: true });

console.log("🤖 BOT ONLINE — LOGS APENAS APÓS RESGATE");

bot.on("message", (msg) => {
    console.log("Mensagem recebida:", msg.text);
});