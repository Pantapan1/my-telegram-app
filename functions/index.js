/**
 * Серверные функции, которые следят за Firebase Realtime Database и шлют
 * уведомления пользователям двумя способами, даже когда приложение закрыто:
 *  1) через Telegram-бота (sendMessage) — для тех, кто открывал приложение через Telegram;
 *  2) через нативный пуш (Firebase Cloud Messaging) — для тех, у кого приложение установлено
 *     как отдельное APK/PWA и сохранило хотя бы один fcmTokens-токен устройства.
 * Оба канала независимы: пользователю могут прийти оба уведомления, одно или ни одного —
 * в зависимости от того, что у него подключено.
 *
 * ВАЖНО: токен Telegram-бота нигде не хранится в клиентском коде — он лежит в Firebase
 * Secret Manager (см. README-push.md, шаг с `firebase functions:secrets:set`).
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

// Все пользователи, у которых вообще не отключены уведомления (notificationsEnabled !== false).
// Из этого общего списка ниже отдельно берём тех, у кого есть telegramId (для бота) и/или
// fcmTokens (для нативного пуша) — это разные, не обязательно пересекающиеся множества.
async function getNotifiableUsers() {
  const snap = await db.ref("users").get();
  const users = snap.val() || {};
  const result = {};
  for (const [uid, u] of Object.entries(users)) {
    if (u && u.notificationsEnabled !== false) result[uid] = u;
  }
  return result;
}

// Шлёт нативный пуш через FCM всем токенам устройств указанных пользователей.
// Невалидные/просроченные токены (registration-token-not-registered) тихо удаляются из базы,
// чтобы список токенов не разрастался мусором.
async function sendFcmToUids(users, uids, { title, body }) {
  const tokenToUid = {};
  uids.forEach((uid) => {
    const u = users[uid];
    if (u && u.fcmTokens) Object.keys(u.fcmTokens).forEach((t) => { tokenToUid[t] = uid; });
  });

  const tokens = Object.keys(tokenToUid);
  if (!tokens.length) return;

  try {
    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
    });
    resp.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        const uid = tokenToUid[tokens[i]];
        if (uid) db.ref(`users/${uid}/fcmTokens/${tokens[i]}`).remove().catch(() => {});
      } else {
        console.error("FCM ошибка отправки:", code || r.error);
      }
    });
  } catch (e) {
    console.error("Не удалось отправить FCM push:", e);
  }
}

// === Новый пост в ленте — уведомляем всех, кроме автора ===
exports.notifyNewPost = onValueCreated(
  { ref: "/posts/{postId}", secrets: [BOT_TOKEN] },
  async (event) => {
    const post = event.data.val();
    if (!post) return;

    const token = BOT_TOKEN.value();
    const users = await getNotifiableUsers();
    const authorPart = post.authorName ? ` от ${post.authorName}` : "";
    const preview = truncate(post.title || post.text, 200);
    const recipientIds = Object.keys(users).filter((uid) => uid !== post.authorId);

    const telegramJobs = recipientIds
      .filter((uid) => users[uid].telegramId)
      .map((uid) => sendTelegram(token, users[uid].telegramId, `📰 Новый пост${authorPart}\n${preview}`));

    await Promise.all([
      ...telegramJobs,
      sendFcmToUids(users, recipientIds, { title: `📰 Новый пост${authorPart}`, body: preview }),
    ]);
  }
);

// === Новое сообщение в чате/группе — уведомляем всех участников, кроме отправителя ===
// Если в сообщении есть упоминания (message.mentions — массив uid), упомянутые
// получают отдельный текст-«пинг» вместо обычного уведомления о сообщении.
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
    const mentionedIds = new Set(Array.isArray(message.mentions) ? message.mentions : []);
    const chatName = chat.name ? `«${chat.name}»` : "чате";
    const preview = message.sticker ? "🖼 стикер" : truncate(message.text, 200);

    const recipientIds = Object.keys(chat.participants).filter((uid) => uid !== message.senderId && users[uid]);
    const mentioned = recipientIds.filter((uid) => mentionedIds.has(uid));
    const regular = recipientIds.filter((uid) => !mentionedIds.has(uid));

    const telegramJobs = recipientIds
      .filter((uid) => users[uid].telegramId)
      .map((uid) => {
        const text = mentionedIds.has(uid)
          ? `🔔 ${message.senderName || "Кто-то"} упомянул(а) вас в ${chatName}: ${preview}`
          : `💬 ${message.senderName || "Сообщение"}: ${preview}`;
        return sendTelegram(token, users[uid].telegramId, text);
      });

    await Promise.all([
      ...telegramJobs,
      sendFcmToUids(users, mentioned, { title: `🔔 ${message.senderName || "Кто-то"} упомянул(а) вас в ${chatName}`, body: preview }),
      sendFcmToUids(users, regular, { title: message.senderName || "Новое сообщение", body: preview }),
    ]);
  }
);

// === Новый пост в вики чата/группы (раздел "Дроп") — уведомляем участников, кроме автора ===
exports.notifyNewWikiPost = onValueCreated(
  { ref: "/chats/{chatId}/wiki/posts/{postId}", secrets: [BOT_TOKEN] },
  async (event) => {
    const post = event.data.val();
    if (!post) return;

    const chatId = event.params.chatId;
    const chatSnap = await db.ref(`chats/${chatId}`).get();
    const chat = chatSnap.val();
    if (!chat || !chat.participants) return;

    const token = BOT_TOKEN.value();
    const users = await getNotifiableUsers();
    const chatName = chat.name ? `«${chat.name}»` : "группы";
    const preview = truncate(post.title || post.text, 200);
    const recipientIds = Object.keys(chat.participants).filter((uid) => uid !== post.authorId && users[uid]);

    const telegramJobs = recipientIds
      .filter((uid) => users[uid].telegramId)
      .map((uid) => sendTelegram(token, users[uid].telegramId, `📦 Новый пост в вики ${chatName}\n${preview}`));

    await Promise.all([
      ...telegramJobs,
      sendFcmToUids(users, recipientIds, { title: `📦 Новый пост в вики ${chatName}`, body: preview }),
    ]);
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
    if (!author || author.notificationsEnabled === false) return;

    const token = BOT_TOKEN.value();
    const preview = comment.sticker ? "🖼 стикер" : truncate(comment.text, 200);
    const title = `💭 ${comment.author || "Кто-то"} прокомментировал ваш пост`;

    const jobs = [];
    if (author.telegramId) jobs.push(sendTelegram(token, author.telegramId, `${title}: ${preview}`));
    jobs.push(sendFcmToUids({ [post.authorId]: author }, [post.authorId], { title, body: preview }));
    await Promise.all(jobs);
  }
);
