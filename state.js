// Заглушка на случай, если window.Telegram недоступен (открыто не из Telegram, а скрипт
// telegram-web-app.js не загрузился/заблокирован) — иначе обращение к window.Telegram.WebApp
// падает прямо здесь, в самом первом импортируемом модуле, и обрывает загрузку всего приложения.
function createFallbackWebApp() {
    return {
        initData: '',
        initDataUnsafe: {},
        colorScheme: 'light',
        themeParams: {},
        expand: function () {},
        ready: function () {},
        close: function () {},
        openLink: function (url) { window.open(url, '_blank'); },
        showAlert: function (message, callback) { window.alert(message); if (callback) callback(); },
        showConfirm: function (message, callback) { const ok = window.confirm(message); if (callback) callback(ok); },
        showPopup: function (params, callback) {
            const text = params && (params.message || params.title) ? [params.title, params.message].filter(Boolean).join('\n') : '';
            window.alert(text);
            if (callback) callback('');
        },
        HapticFeedback: { impactOccurred: function () {}, notificationOccurred: function () {}, selectionChanged: function () {} },
        BackButton: { show: function () {}, hide: function () {}, onClick: function () {}, offClick: function () {} },
        MainButton: { show: function () {}, hide: function () {}, onClick: function () {}, offClick: function () {}, setText: function () {}, setParams: function () {} }
    };
}

export const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : createFallbackWebApp();

// showPopup/showAlert/showConfirm требуют Bot API 6.1+ и в целом работают только внутри
// настоящего Telegram. Вне его (открыто напрямую в браузере, через ?uid=&name= — этот вход
// поддерживается штатно, см. ниже) есть ДВА разных отказа:
//   1) старые клиенты кидают исключение при вызове — ловится try/catch (было починено раньше,
//      см. историю: сразу после успешной публикации поста звался tg.showPopup('Опубликовано!'),
//      он падал с ошибкой, а catch, пытаясь показать tg.showAlert с текстом ошибки, падал так же);
//   2) НЕ настоящий Telegram (initData пустой) — метод НЕ кидает исключение, а просто ничего не
//      делает: событие уходит нативному Telegram-клиенту, а слушать некому, callback не вызывается
//      никогда. try/catch тут бессилен — исключения нет. Это и есть причина серии багов "кнопка
//      ничего не делает" (удаление баннеров/постов в админке, закрытие кинотеатра в личных чатах,
//      покупка премиум-пасса) — все они спрятаны за tg.showConfirm/showPopup.
// Поэтому: если tg.initData пуст — используем фолбэк браузера СРАЗУ, не пытаясь звать родной метод
// (иначе он "съест" вызов и до фолбэка дело не дойдёт). Если initData не пуст (то есть мы вроде бы
// в настоящем Telegram), пробуем родной метод и подстраховываемся try/catch на случай (1).
const _isRealTelegramSession = !!tg.initData;
[['showPopup', (params, callback) => {
    const text = params && (params.message || params.title) ? [params.title, params.message].filter(Boolean).join('\n') : '';
    window.alert(text);
    if (callback) callback('');
}], ['showAlert', (message, callback) => { window.alert(message); if (callback) callback(); }],
  ['showConfirm', (message, callback) => { const ok = window.confirm(message); if (callback) callback(ok); }]
].forEach(([method, fallback]) => {
    const original = tg[method];
    if (typeof original !== 'function') return;
    if (!_isRealTelegramSession) { tg[method] = fallback; return; }
    tg[method] = function (...args) {
        try { return original.apply(tg, args); }
        catch (e) { return fallback(...args); }
    };
});

const _tgUser = tg.initDataUnsafe && tg.initDataUnsafe.user;
const _authUser = JSON.parse(localStorage.getItem('sr_auth_user') || 'null');
// Тот же id, что станет state.currentUser.id в core.js — нужен уже здесь, чтобы личные данные
// (прочитанное, прогресс, стрик, закладки) читались под своим пользователем, а не чужим на этом устройстве.
const _localUid = _tgUser ? String(_tgUser.id) : (_authUser ? String(_authUser.id) : 'guest');
function _loadUserLocal(key, fallbackJson) {
  try { return JSON.parse(localStorage.getItem(key + '__u' + _localUid) || fallbackJson); }
  catch (e) { return JSON.parse(fallbackJson); }
}

export const state = {
  currentUser: null,
  tgUser: _tgUser,
  authUser: _authUser,
  mascotUrl: null, // картинка маскота для экрана загрузки, задаётся в админке (settings/mascotUrl)
  badgeColor: '#1da1f2',  // цвет по умолчанию для тех, у кого нет своего
  badgeSymbol: '✦',  // символ значка издателя по умолчанию (не галочка ✓, чтобы не путать с прочитанным)
  seasonPassData: null,  // { name, endsAt, premiumPrice, levels:{n:{...}}, weeklyQuests:{id:{...}} }
  myPassState: null,  // локальная копия users/{uid}/pass
  timeTrackingStarted: false,
  streakCheckedThisSession: false,
  sessionStartedAt: 0,
  lastFlushedAt: 0,
  postsData: [],
  siteWidgetsData: [],
  editingSiteWidgetId: null,
  bannersData: [],
  shopItemsData: [],
  editingBannerId: null,
  booksData: [],
  usersData: [],
  chatsData: [],
  // Индикатор "печатает..." — отдельно от chatsData/chats-в-базе (см. пояснение в core.js рядом
  // с onValue(ref(db,'chatsTyping'))): { [chatId]: { [uid]: timestamp } }
  typingData: {},
  stickersData: [],
  stickerPacksData: [],
  myStickersData: [],
  bossData: null,
  bossParticipantsData: {},
  youtubeVideoId: null,
  readBooks: _loadUserLocal('sr_read', '[]'),
  bookmarkedBooks: _loadUserLocal('sr_bookmarks', '[]'),
  progressStore: _loadUserLocal('sr_progress', '{}'),
  chapterNotes: _loadUserLocal('sr_chapter_notes', '{}'),
  streakStore: _loadUserLocal('sr_streak', '{"count":0,"lastDate":null}'),
  lastSeenPostsCount: parseInt(localStorage.getItem('sr_last_seen_posts_count__u' + _localUid) || '0', 10),
  readerFontSize: parseInt(localStorage.getItem('sr_fontsize') || '18', 10),
  // Ручной выбор языка перевода (кнопка "🌐 Перевести" в чате): 'ru' | 'en' | 'ko' | null.
  // null — автоопределение по языку Telegram/браузера (нужно для тех, кто заходит не через Telegram).
  translateLang: _loadUserLocal('sr_translate_lang', 'null'),
  chatLastRead: _loadUserLocal('sr_chat_last_read', '{}'),
  wikiLastRead: _loadUserLocal('sr_wiki_last_read', '{}'),
  currentPostId: null,
  viewingUserId: null,
  dailyRewardChecked: false,
  currentBookId: null,
  currentChapters: [],
  currentChapterIndex: 0,
  currentChatId: null,
  activeOverlay: null,
  feedSearchTerm: '',
  bookSearchTerm: '',
  activeGenre: 'Все',
  activeType: 'all',
  sortMode: 'new',
  isAdmin: false,
  editingPostId: null,
  editingBookId: null,
  editingUserPostId: null,
  currentTheme: 'light',
  soundsData: {},
  effectsData: {},
  terrariaData: {},  // доп. фичи темы Terraria (день/ночь, boss hp, пиксель-иконки и т.д.)
  economyData: { dailyEnabled: true, dailyAmount: 10, chapterEnabled: false, chapterAmount: 0, bookEnabled: false, bookAmount: 0, streakEnabled: false, streakAmount: 0, streakEvery: 1, streakMax: 0, eventMultiplier: 1, eventMultiplierUntil: null },
  questsData: [],
  eventsData: [],
  editingEventId: null,
  cardsData: [],
  cardCombosData: [],
  cardPacksData: [],
  editingCardId: null,
  editingComboId: null,
  editingPackId: null,
  heroClassesData: [],
  editingClassId: null,
  cardFramesData: {},
  deckSettings: { deckSize: 30, maxCopies: 2 },
  myCollection: {},
  myDust: 0,
  craftingCardId: null,
  craftingView: false,
  myDecks: [],
  decksView: 'list',
  editingDeckId: null,
  deckDraft: null,
  inQueue: false,
  matchmakingTimer: null,
  battleListenerAttached: false,
  activeBattleId: null,
  battleData: null,
  mySlot: null,
  selectedAttackerIid: null,
  streakRewardStore: _loadUserLocal('sr_streak_reward', '{}'),
  terrariaDayNightTimer: null,
  renderedChatState: { chatId: null, signature: null, msgSigParts: [], charsLen: 0 },
  renderedChatPartnerId: null,
  renderedWikiPostState: { postId: null, heavySignature: null, fullSignature: null },
  replyingTo: null,
  editingMessageId: null,
  // === Ролевые группы: персонажи, инвентарь, отыгрыш ===
  editingCharacterId: null,      // персонаж, который сейчас редактируется в character-edit-overlay
  rpPanelChatId: null,           // группа, для которой открыта ролевая панель
  rpPanelCharacterId: null,      // персонаж, инвентарь которого сейчас открыт
  activeCharacterByChat: _loadUserLocal('sr_active_character', '{}'), // { chatId: characterId } — от чьего лица отправляются сообщения
  actionModeByChat: {},          // { chatId: true } — режим "реплика действия" (*текст*), не сохраняется между сессиями
  lastTypingSent: 0,
  typingClearTimer: null,
  editingQuestId: null,
  arenasData: [],
  // Покупные "Герои" (свой портрет/ХП/пассивка поверх обычного класса) — см. cards.js/battle.js
  customHeroesData: [],
  heroSkinsData: [],
  // Скины для существ (карт типа minion) — см. cards.js/battle.js/shop.html
  cardSkinsData: [],
  battleReactionsData: [],
  cardStatsData: {},
  storyChapters: [],
  storyCleared: {},
  storyLost: {},
  // Числовые переменные сюжета на игрока (репутация, очки морали и т.п.) — читаются/пишутся
  // из кастомного JS-кода главы, см. story.js runStoryChapterScript.
  storyVars: {},
  // Виджеты/плагины, которые админ встраивает в разные места приложения через свой HTML/JS-код,
  // см. widgets.js.
  widgetsData: [],
  editingWidgetId: null,
  editingStoryChapterId: null,
  storyBossDeckDraft: {},
  storyPendingChapterId: null,
  storySettings: {},
  // === Вики группового чата ("Дроп"): категории и посты ===
  wikiChatId: null,              // группа, для которой открыта вики
  wikiReturnChatId: null,        // чат, куда вернуться при закрытии вики (может быть доп.чатом, а не корневым)
  economyChatId: null,           // группа, для которой открыта панель экономики ГМ
  wikiCategoryId: null,          // категория, список постов которой сейчас открыт
  wikiPostId: null,              // пост, который сейчас открыт/редактируется
  wikiEditingPostId: null,       // id поста, который редактируется в редакторе (null = создание нового)
  wikiEditorImages: [],          // массив URL картинок в редакторе поста (черновик перед сохранением)
  wikiImageViewer: { images: [], index: 0 }, // полноэкранный просмотр картинки поста
  wikiEditingWidgetId: null,     // id виджета вики, который редактируется (null = создание нового)
  communityTab: 'mine', // 'mine' | 'discover' — подвкладка экрана "Сообщество" (бывшие "Чаты")
  previewGroupId: null, // id группы, чьё превью сейчас открыто (до вступления)
  // === 🎥 Кинотеатр в чате: совместный просмотр видео ===
  renderedCinemaState: { chatId: null, signature: null }, // чтобы не пересоздавать iframe на каждое обновление
  lastCinemaSyncedUpdatedAt: null,
  renderedCinemaWatchersSig: null,
  cinemaMinimizedByChat: {}, // { chatId: true } — локально свёрнутая панель плеера (не сохраняется между сессиями)
};
