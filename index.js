/**
 * Серверные функции, которые следят за Firebase Realtime Database и шлют
 * уведомления пользователям через Telegram-бота (sendMessage), даже когда
 * приложение закрыто.
 *
 * ВАЖНО: токен бота нигде не хранится в клиентском коде — он лежит в Firebase
 * Secret Manager (см. README.md, шаг с `firebase functions:secrets:set`).
 */

const { onValueCreated } = require("firebase-functions/v2/database");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();

const BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

// Регион можно поменять на ближайший к вашей RTDB (europe-west1, us-central1 и т.д.)
setGlobalOptions({ region: "europe-west1" });

function truncate(str, n) {
  if (!str) return "";
  const s = String(str);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function sendTelegram(token, chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("Telegram API вернул ошибку:", data.description, "chatId:", chatId);
    }
  } catch (e) {
    console.error("Не удалось отправить сообщение в Telegram:", e);
  }
}

// Возвращает { uid: userRecord } только для тех, кому можно слать уведомления
async function getNotifiableUsers() {
  const snap = await db.ref("users").get();
  const users = snap.val() || {};
  const result = {};
  for (const [uid, u] of Object.entries(users)) {
    if (u && u.telegramId && u.notificationsEnabled !== false) result[uid] = u;
  }
  return result;
}

// === Новый пост в ленте — уведомляем всех, кроме автора ===
exports.notifyNewPost = onValueCreated(
  { ref: "/posts/{postId}", secrets: [BOT_TOKEN] },
  async (event) => {
    const post = event.data.val();
    if (!post) return;

    const token = BOT_TOKEN.value();
    const users = await getNotifiableUsers();

    const jobs = Object.entries(users)
      .filter(([uid]) => uid !== post.authorId)
      .map(([, u]) => {
        const authorPart = post.authorName ? ` от ${post.authorName}` : "";
        const preview = truncate(post.title || post.text, 200);
        return sendTelegram(token, u.telegramId, `📰 Новый пост${authorPart}\n${preview}`);
      });

    await Promise.all(jobs);
  }
);

// === Новое сообщение в чате/группе — уведомляем всех участников, кроме отправителя ===
exports.notifyNewMessage = onValueCreated(
  { ref: "/chats/{chatId}/messages/{messageId}", secrets: [BOT_TOKEN] },
  async (event) => {
    const message = event.data.val();
    if (!message) return;

    const chatId = event.params.chatId;
    const chatSnap = await db.ref(`chats/${chatId}`).get();
    const chat = chatSnap.val();
    if (!chat || !chat.participants) return;

    const token = BOT_TOKEN.value();
    const users = await getNotifiableUsers();

    const recipientIds = Object.keys(chat.participants).filter((uid) => uid !== message.senderId);
    const jobs = recipientIds
      .filter((uid) => users[uid])
      .map((uid) => {
        const preview = message.sticker ? "🖼 стикер" : truncate(message.text, 200);
        return sendTelegram(token, users[uid].telegramId, `💬 ${message.senderName || "Сообщение"}: ${preview}`);
      });

    await Promise.all(jobs);
  }
);

// === Новый комментарий к посту — уведомляем автора поста ===
exports.notifyNewComment = onValueCreated(
  { ref: "/posts/{postId}/comments/{commentId}", secrets: [BOT_TOKEN] },
  async (event) => {
    const comment = event.data.val();
    if (!comment) return;

    const postId = event.params.postId;
    const postSnap = await db.ref(`posts/${postId}`).get();
    const post = postSnap.val();
    if (!post || !post.authorId || post.authorId === comment.userId) return; // не шлём автору его же комментарий

    const authorSnap = await db.ref(`users/${post.authorId}`).get();
    const author = authorSnap.val();
    if (!author || !author.telegramId || author.notificationsEnabled === false) return;

    const token = BOT_TOKEN.value();
    const preview = comment.sticker ? "🖼 стикер" : truncate(comment.text, 200);
    await sendTelegram(token, author.telegramId, `💭 ${comment.author || "Кто-то"} прокомментировал ваш пост: ${preview}`);
  }
);
