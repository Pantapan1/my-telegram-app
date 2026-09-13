# Сборка APK с рабочими push-уведомлениями (Capacitor)

Это пошаговая инструкция. Я не могу сам запустить эти шаги (нет доступа в интернет,
Android Studio и Java в этой песочнице), но весь код на стороне сайта и сервера уже готов —
дальше нужно только выполнить команды на вашем компьютере.

## Почему Capacitor, а не просто «сайт в WebView»

Обычная обёртка сайта в WebView (многие no-code сервисы делают именно так) не может надёжно
получать уведомления, когда приложение закрыто — у неё нет доступа к нативному Firebase Cloud
Messaging на уровне ОС. Capacitor даёт настоящий Android-проект, в который можно поставить
официальный плагин `@capacitor/push-notifications` — тогда уведомления приходят так же, как в
любом обычном приложении, даже если само приложение не запущено.

Если вы уже выбрали другой конкретный сервис для сборки APK — напишите какой, я подскажу, что в
нём меняется (обычно это именно шаг с push-уведомлениями).

## Что уже готово в коде

- `capacitor.config.json` — конфиг Capacitor (заполните `appId`, `appName` и `server.url` своими).
- `firebase.json` теперь включает `hosting`, чтобы захостить сайт (`firebase deploy --only hosting`)
  и указать этот адрес в `server.url` — тогда APK всегда открывает актуальную версию сайта, без
  пересборки APK на каждое изменение.
- `functions/index.js` (перенесён из корня в `functions/`, как и требовал `firebase.json`) — при
  новом сообщении/посте/комментарии теперь шлёт уведомление и в Telegram (кому доступно), и через
  FCM на токены устройств из `users/{id}/fcmTokens`.
- `core.js` → `initNativePush()` — при запуске внутри Capacitor-приложения запрашивает разрешение
  на уведомления и сохраняет токен устройства в базу. Внутри Telegram и в обычном браузере эта
  функция ничего не делает (там уведомления и так работают через бота).

## Шаг 1. Хостинг сайта

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
```
Скопируйте выданный адрес (`https://<project-id>.web.app`) в `capacitor.config.json` → `server.url`.

## Шаг 2. Инициализация Capacitor-проекта

В корне проекта (рядом с `app.html`):
```bash
npm init -y                     # если ещё нет своего package.json в корне
npm install @capacitor/core @capacitor/android @capacitor/push-notifications
npx cap add android
```
Capacitor подхватит уже подготовленный `capacitor.config.json`.

## Шаг 3. Подключить Firebase к Android-проекту (для FCM)

1. В консоли Firebase → Project settings → Add app → Android.
2. Package name — **точно такой же**, как `appId` в `capacitor.config.json`.
3. Скачайте `google-services.json` и положите в `android/app/google-services.json`.
4. Синхронизируйте:
```bash
npx cap sync android
```

## Шаг 4. Секрет бота и Blaze-план

Уже описано в `README-push.md` (шаги 4–5) — план Blaze и
`firebase functions:secrets:set TELEGRAM_BOT_TOKEN` нужны в любом случае, FCM использует тот же
проект и тот же деплой функций:
```bash
firebase deploy --only functions
```

## Шаг 5. Сборка APK

```bash
npx cap open android
```
Откроется Android Studio → Build → Generate Signed Bundle / APK. Для тестов на своём телефоне
достаточно обычного Debug-APK (Build → Build Bundle(s)/APK(s) → Build APK(s)).

## Проверка

1. Установите APK на телефон, откройте приложение — при первом запуске должен появиться системный
   запрос разрешения на уведомления (Android 13+).
2. Зайдите в Профиль → «Логин и пароль», задайте логин/пароль (если аккаунт создавался через
   Telegram) — это даст доступ к тому же аккаунту вне Telegram.
3. Попросите кого-то написать вам сообщение или оставить пост — уведомление должно прийти даже
   если приложение свёрнуто/закрыто.
4. Логи по проблемам с функциями: `firebase functions:log`.

## Если что-то пойдёт не так

- Уведомление не приходит, но токен точно сохранился в `users/{id}/fcmTokens` — проверьте, что
  `google-services.json` реально лежит в `android/app/` и что `npx cap sync android` выполнялся
  после этого.
- `PushNotifications` в консоли браузера `undefined` — плагин не установлен/не синхронизирован,
  либо вы тестируете не в собранном APK, а в обычном браузере (там плагина нет и не будет — это
  ожидаемо).
