export const tg = window.Telegram.WebApp;

const _tgUser = tg.initDataUnsafe && tg.initDataUnsafe.user;
const _authUser = JSON.parse(localStorage.getItem('sr_auth_user') || 'null');
// Тот же id, что станет state.currentUser.id в core.js — нужен уже здесь, ДО того как currentUser
// определится, чтобы личные данные (прочитанное, прогресс чтения, стрик, закладки) читались сразу
// из-под своего пользователя, а не из-под того, кто последним заходил с этого браузера/устройства.
// Раньше все эти данные хранились под общими ключами localStorage без привязки к пользователю —
// поэтому при заходе другим аккаунтом на том же устройстве/браузере читалось (и правилось) чужое.
const _localUid = _tgUser ? String(_tgUser.id) : (_authUser ? String(_authUser.id) : 'guest');
function _loadUserLocal(key, fallbackJson) {
  try { return JSON.parse(localStorage.getItem(key + '__u' + _localUid) || fallbackJson); }
  catch (e) { return JSON.parse(fallbackJson); }
}

export const state = {
  currentUser: null,
  tgUser: _tgUser,
  authUser: _authUser,
  badgeColor: '#1da1f2',  // цвет по умолчанию для тех, у кого нет своего
  seasonPassData: null,  // { name, endsAt, premiumPrice, levels:{n:{...}}, weeklyQuests:{id:{...}} }
  myPassState: null,  // локальная копия users/{uid}/pass
  timeTrackingStarted: false,
  streakCheckedThisSession: false,
  sessionStartedAt: 0,
  lastFlushedAt: 0,
  postsData: [],
  bannersData: [],
  shopItemsData: [],
  editingBannerId: null,
  booksData: [],
  usersData: [],
  chatsData: [],
  stickersData: [],
  stickerPacksData: [],
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
  chatLastRead: _loadUserLocal('sr_chat_last_read', '{}'),
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
  renderedChatState: { chatId: null, signature: null },
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
  cardStatsData: {},
  storyChapters: [],
  storyCleared: {},
  storyLost: {},
  editingStoryChapterId: null,
  storyBossDeckDraft: {},
  storyPendingChapterId: null,
  storySettings: {},
  // === Вики группового чата ("Дроп"): категории и посты ===
  wikiChatId: null,              // группа, для которой открыта вики
  wikiCategoryId: null,          // категория, список постов которой сейчас открыт
  wikiPostId: null,              // пост, который сейчас открыт/редактируется
  wikiEditingPostId: null,       // id поста, который редактируется в редакторе (null = создание нового)
  wikiEditorImages: [],          // массив URL картинок в редакторе поста (черновик перед сохранением)
  wikiImageViewer: { images: [], index: 0 }, // полноэкранный просмотр картинки поста
};
