/**
 * Серверные функции, которые следят за Firebase Realtime Database и шлют
 * уведомления пользователям через Telegram-бота (sendMessage), даже когда
 * приложение закрыто.
 *
 * ВАЖНО: токен бота нигде не хранится в клиентском коде — он лежит в Firebase
 * Secret Manager (см. README.md, шаг с `firebase functions:secrets:set`).
 */

const { onValueCreated } = require("firebase-functions/v2/database");
const { onRequest } = require("firebase-functions/v2/https");
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

    const recipientIds = Object.keys(chat.participants).filter((uid) => uid !== message.senderId);
    const jobs = recipientIds
      .filter((uid) => users[uid])
      .map((uid) => {
        const preview = message.sticker ? "🖼 стикер" : truncate(message.text, 200);
        const text = mentionedIds.has(uid)
          ? `🔔 ${message.senderName || "Кто-то"} упомянул(а) вас в ${chatName}: ${preview}`
          : `💬 ${message.senderName || "Сообщение"}: ${preview}`;
        return sendTelegram(token, users[uid].telegramId, text);
      });

    await Promise.all(jobs);
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

    const recipientIds = Object.keys(chat.participants).filter((uid) => uid !== post.authorId);
    const jobs = recipientIds
      .filter((uid) => users[uid])
      .map((uid) => {
        const preview = truncate(post.title || post.text, 200);
        return sendTelegram(token, users[uid].telegramId, `📦 Новый пост в вики ${chatName}\n${preview}`);
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

// === Перевод сообщений/постов/глав (кнопка "🌐 Перевести" в приложении) ===
// Провайдер — MyMemory (api.mymemory.translated.net): бесплатно, без ключа и без регистрации.
// Лимиты MyMemory (официальные, см. https://mymemory.translated.net/doc/usagelimits.php):
//   • анонимно (без email в параметре de)         — 5 000 слов/сутки на IP
//   • с указанным контактным email (параметр de)  — 50 000 слов/сутки на этот email
// Чтобы не упираться в 5 000/сутки, ниже можно перечислить один или несколько своих реальных
// email-адресов в MYMEMORY_CONTACT_EMAILS — уже с одним адресом лимит становится 50 000/сутки
// (в 5 раз больше требуемых 10 000). Если добавить несколько адресов, запросы идут по кругу
// (round-robin) и при ответе "лимит исчерпан" от одного адреса автоматически пробуется следующий —
// это и есть "автосмена", суммарная квота растёт пропорционально числу адресов.
// Если оставить массив пустым — работает анонимный режим (5 000 слов/сутки на IP функции).
const MYMEMORY_CONTACT_EMAILS = [
  // "you@example.com",
  // "you2@example.com",
];

// Кэш в самой базе (рядом с сообщением) — чтобы один и тот же текст переводился один раз,
// а не при каждом нажатии любым читателем чата.
let mymemoryRotationIndex = 0;

function utf8ByteLength(str) {
  return Buffer.byteLength(str, "utf8");
}

// MyMemory ограничивает один запрос 500 байтами (UTF-8) — режем длинный текст по границам
// предложений/строк, чтобы уложиться в лимит, и переводим по кускам.
function splitIntoChunks(text, maxBytes = 480) {
  const parts = text.split(/(?<=[.!?\n])\s+/);
  const chunks = [];
  let current = "";
  for (const part of parts) {
    const candidate = current ? current + " " + part : part;
    if (utf8ByteLength(candidate) > maxBytes && current) {
      chunks.push(current);
      current = part;
    } else {
      current = candidate;
    }
    // Даже одно "предложение" может само по себе быть длиннее лимита — рубим его жёстко по буквам.
    while (utf8ByteLength(current) > maxBytes) {
      let cut = current.length;
      while (cut > 0 && utf8ByteLength(current.slice(0, cut)) > maxBytes) cut--;
      chunks.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

// MyMemory не поддерживает автоопределение исходного языка (параметр "autodetect" им отклоняется),
// поэтому определяем его сами по алфавиту — этого достаточно для языков, которые есть в переключателе.
function guessSourceLang(text) {
  if (/[\uAC00-\uD7A3]/.test(text)) return "ko"; // хангыль
  if (/[\u3040-\u30FF]/.test(text)) return "ja"; // хирагана/катакана
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh"; // иероглифы
  if (/[\u0400-\u04FF]/.test(text)) return "ru"; // кириллица
  return "en";
}

function nextContact(skip) {
  const pool = MYMEMORY_CONTACT_EMAILS.filter((e) => !skip.has(e));
  if (!pool.length) return null;
  const email = pool[mymemoryRotationIndex % pool.length];
  mymemoryRotationIndex++;
  return email;
}

async function mymemoryTranslateChunk(text, source, target) {
  const tried = new Set();
  // Сколько email-ов настроено — столько и попыток при "лимит исчерпан"; если список пуст,
  // делаем ровно одну анонимную попытку.
  const attempts = Math.max(MYMEMORY_CONTACT_EMAILS.length, 1);

  for (let i = 0; i < attempts; i++) {
    const contact = nextContact(tried);
    if (contact) tried.add(contact);

    const params = new URLSearchParams({ q: text, langpair: `${source}|${target}` });
    if (contact) params.set("de", contact);

    const apiRes = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`);
    const data = await apiRes.json();

    const quotaExceeded = data && (
      data.responseStatus === 403 ||
      data.responseStatus === "403" ||
      /quota/i.test(data.responseDetails || "") ||
      data.quotaFinished === true
    );

    if (quotaExceeded && contact) {
      // Этот email выбрал свою суточную квоту — пробуем следующий по кругу.
      console.error(`MyMemory: квота исчерпана для ${contact}, переключаюсь на следующий адрес`);
      continue;
    }
    if (quotaExceeded) {
      throw new Error("MyMemory: суточная квота исчерпана (анонимный лимит 5000 слов/сутки)");
    }

    const translated = data && data.responseData && data.responseData.translatedText;
    if (!translated || (data.responseStatus && data.responseStatus !== 200 && data.responseStatus !== "200")) {
      throw new Error("MyMemory вернул неожиданный ответ: " + JSON.stringify(data).slice(0, 300));
    }
    return translated;
  }

  throw new Error("MyMemory: квота исчерпана на всех настроенных адресах");
}

async function mymemoryTranslate(text, source, target) {
  const chunks = splitIntoChunks(text);
  const results = [];
  for (const chunk of chunks) {
    results.push(await mymemoryTranslateChunk(chunk, source, target));
  }
  return results.join(" ");
}

exports.translateText = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Только POST" });
    return;
  }

  const { text, target, chatId, messageId } = req.body || {};
  if (!text || !target) {
    res.status(400).json({ error: "Нужны поля text и target" });
    return;
  }

  // Для сообщений в чате кэш лежит рядом с самим сообщением — так следующий читатель
  // с тем же языком получает готовый перевод мгновенно и бесплатно (без нового запроса к MyMemory).
  const cacheRef = (chatId && messageId)
    ? db.ref(`chats/${chatId}/messages/${messageId}/translations/${target}`)
    : null;

  if (cacheRef) {
    const cached = await cacheRef.get();
    if (cached.exists()) {
      res.json({ translated: cached.val(), cached: true });
      return;
    }
  }

  const source = guessSourceLang(text);
  if (source === target) {
    // Уже на нужном языке — не тратим квоту на перевод самого в себя.
    if (cacheRef) await cacheRef.set(text);
    res.json({ translated: text, cached: false });
    return;
  }

  try {
    const translated = await mymemoryTranslate(text, source, target);
    if (cacheRef) await cacheRef.set(translated);
    res.json({ translated, cached: false });
  } catch (e) {
    console.error("Ошибка при обращении к MyMemory:", e.message || e);
    res.status(502).json({ error: e.message || "Сервис перевода сейчас недоступен" });
  }
});
