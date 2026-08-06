import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getDatabase, ref, onValue, push, update, remove, set, get, child, increment } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { sessionStartTime, notifiedIds } from './constants.js';
import { applyTerrariaFeatures, applyTheme, friendlyDbError, playSound, renderAmbientParticles, renderNotificationsToggle, renderSoundToggle, saveLocal, showNotification, truncateText } from './utils.js';
import { currentSeasonId, ensurePassSeason, renderPassButton, renderPassPetWidget } from './pass.js';
import { distributeBossRewards, populateBossAdminForm, renderBanners, renderBossCard, renderBossParticipantsList, renderEventMultiplierBanner, renderFeed, renderPostOverlay, updateBannerCountdowns } from './feed.js';
import { getChapters, maybeShowMangaAnnouncement, renderBooks, renderChapterListView, renderGenreFilterRow, updateStreak } from './books.js';
import { checkDailyCoinReward, renderOwnProfileHeader, renderProfileStats, renderQuestsList, renderUserProfileOverlay } from './profile.js';
import { populateStickerPackSelect, renderChatOverlay, renderChatsList, renderStickerPicker, renderUserPickList } from './chats.js';
import { populateChapterBookSelect, populateEconomyAdminForm, renderAdminBannersList, renderAdminBooksList, renderAdminEventsList, renderAdminPostsList, renderAdminQuestsList, renderAdminStickersList } from './admin.js';
import { renderAdminCardsList, renderAdminClassesList, renderAdminCombosList, renderAdminPacksList, populateDeckSettingsForm, populateFramesForm } from './cards.js';
import { renderDecksView, renderCardCollectionView } from './decks.js';
import { renderEventsCalendar } from './events.js';
import { renderAdminStoryList, renderStoryBossDeckPicker, populateStoryRewardCardSelect, renderStoryListView } from './story.js';

const firebaseConfig = {
    apiKey: "AIzaSyAfrRE3nCFmodNEPac_plnoBuc_NvJbIgQ",
    authDomain: "book-2b50d.firebaseapp.com",
    databaseURL: "https://book-2b50d-default-rtdb.firebaseio.com",
    projectId: "book-2b50d",
    messagingSenderId: "461145405797",
    appId: "1:461145405797:web:ca65bb4b7f457d6b25098c"
};

try {
    const app = initializeApp(firebaseConfig);
    state.db = getDatabase(app);
} catch (e) {
    console.error('Firebase ошибка инициализации:', e);
}

try {
    tg.expand();
    tg.ready();
} catch (e) {}

// === АВТОРИЗАЦИЯ ===

export function initApp() {
    const authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) authOverlay.style.display = 'none';
    startFirebaseListeners();
    if (state.db) ensureUserProfile();
}

if (state.tgUser) {
    state.currentUser = { 
        id: String(state.tgUser.id), 
        name: [state.tgUser.first_name, state.tgUser.last_name].filter(Boolean).join(' ') || state.tgUser.username || 'Читатель' 
    };
    initApp();
} else if (state.authUser) {
    state.currentUser = state.authUser;
    initApp();
} else {
    const authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) authOverlay.style.display = 'flex';
}

const regAuthBtn = document.getElementById('btn-register-auth');
if (regAuthBtn) {
    regAuthBtn.onclick = function() {
        if (!state.db) return alert('База данных недоступна');
        const un = document.getElementById('auth-username').value.trim();
        const pw = document.getElementById('auth-password').value.trim();
        if (!un || !pw) return alert('Введите никнейм и пароль');
        
        const safeUn = un.replace(/[^a-zA-Z0-9_]/g, '');
        if (!safeUn) return alert('Используйте только английские буквы и цифры для ника');
        
        get(child(ref(state.db), `auth_users/${safeUn}`)).then((snapshot) => {
            if (snapshot.exists()) {
                 alert('Никнейм уже занят!');
            } else {
                 const newId = 'usr_' + Date.now();
                 set(ref(state.db, `auth_users/${safeUn}`), { password: pw, id: newId }).then(() => {
                     localStorage.setItem('sr_auth_user', JSON.stringify({id: newId, name: un}));
                     location.reload();
                 }).catch(e => alert(friendlyDbError(e)));
            }
        }).catch(e => alert(friendlyDbError(e)));
    };
}

const loginAuthBtn = document.getElementById('btn-login-auth');
if (loginAuthBtn) {
    loginAuthBtn.onclick = function() {
        if (!state.db) return alert('База данных недоступна');
        const un = document.getElementById('auth-username').value.trim();
        const pw = document.getElementById('auth-password').value.trim();
        if (!un || !pw) return alert('Введите никнейм и пароль');
        
        const safeUn = un.replace(/[^a-zA-Z0-9_]/g, '');
        get(child(ref(state.db), `auth_users/${safeUn}`)).then((snapshot) => {
            if (snapshot.exists() && snapshot.val().password === pw) {
                 localStorage.setItem('sr_auth_user', JSON.stringify({id: snapshot.val().id, name: un}));
                 location.reload();
            } else {
                 alert('Неверный никнейм или пароль');
            }
        }).catch(e => alert(friendlyDbError(e)));
    };
}

const logoutBtn = document.getElementById('btn-logout');
if (logoutBtn) {
    logoutBtn.onclick = function() {
        if (confirm('Выйти из аккаунта?')) {
            localStorage.removeItem('sr_auth_user');
            location.reload();
        }
    };
}

export function flushTimeSpent() {
    if (!state.sessionStartedAt || !state.db || !state.currentUser) return;
    const now = Date.now();
    const delta = now - state.lastFlushedAt;
    state.lastFlushedAt = now;
    if (delta <= 0) return;
    update(ref(state.db, 'users/' + state.currentUser.id), { totalTimeSpent: increment(delta) }).catch(() => {});
}

export function startTimeTracking() {
    state.sessionStartedAt = Date.now();
    state.lastFlushedAt = state.sessionStartedAt;
    setInterval(() => { if (document.visibilityState === 'visible') flushTimeSpent(); }, 30000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushTimeSpent();
        else state.lastFlushedAt = Date.now();
    });
    window.addEventListener('beforeunload', flushTimeSpent);
}

window.switchTab = function(tabName) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const targetSection = document.getElementById('section-' + tabName);
    if (targetSection) targetSection.classList.add('active');

    const order = ['feed', 'books', 'chats', 'profile'];
    document.querySelectorAll('.nav-btn').forEach((btn, index) => {
        btn.classList.remove('active');
        if (order[index] === tabName) btn.classList.add('active');
    });

    if (tabName === 'feed') {
        state.lastSeenPostsCount = state.postsData.length;
        localStorage.setItem('sr_last_seen_posts_count', String(state.lastSeenPostsCount));
        const badge = document.getElementById('feed-nav-badge');
        if (badge) badge.classList.add('hidden');
    }
    if (tabName === 'chats') {
        state.chatsData.forEach(c => { 
            if (c.participants && c.participants[state.currentUser.id]) state.chatLastRead[c.id] = Date.now(); 
        });
        saveLocal('sr_chat_last_read', state.chatLastRead);
        const badge = document.getElementById('chats-nav-badge');
        if (badge) badge.classList.add('hidden');
        renderChatsList();
    }
    if (tabName === 'profile') {
        renderProfileStats();
    }
    
    try { if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light'); } catch (e) {}
};

export function ensureUserProfile() {
    if (!state.currentUser) return;
    const payload = { 
        name: state.currentUser.name, 
        lastSeen: Date.now() 
    };
    if (state.tgUser && state.tgUser.id) payload.telegramId = state.tgUser.id;
    update(ref(state.db, 'users/' + state.currentUser.id), payload).catch(() => {});
}

export function startFirebaseListeners() {
    setInterval(ensureUserProfile, 60000);

    let feedLoaded = false;
    const feedWatchdog = setTimeout(() => {
        if (feedLoaded) return;
        feedLoaded = true;
        const container = document.getElementById('feed-container');
        if (container) {
            container.innerHTML = '<div class="empty-state"><span class="icon">📡</span><div class="title">Не удалось загрузить данные</div><div class="sub">Проверьте интернет-соединение или VPN</div><button class="btn" style="margin-top:12px;" onclick="location.reload()">Обновить</button></div>';
        }
    }, 7000); // Сократили тайм-аут до 7 секунд для быстрого отклика при сбое

    onValue(ref(state.db, 'posts'), (snapshot) => {
        if (!feedLoaded) {
            feedLoaded = true;
            clearTimeout(feedWatchdog);
        }
        const data = snapshot.val();
        state.postsData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })).sort((a, b) => {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            return b.createdAt - a.createdAt;
        }) : [];
        
        const feedSection = document.getElementById('section-feed');
        if (state.postsData.length > state.lastSeenPostsCount && feedSection && !feedSection.classList.contains('active')) {
            const badge = document.getElementById('feed-nav-badge');
            if (badge) badge.classList.remove('hidden');
        }

        state.postsData.forEach(post => {
            if (state.currentUser && post.createdAt > sessionStartTime && post.authorId !== state.currentUser.id && !notifiedIds.has('post:' + post.id)) {
                notifiedIds.add('post:' + post.id);
                const authorPart = post.authorName ? ` от ${post.authorName}` : '';
                showNotification(`📰 Новый пост${authorPart}`, truncateText(post.title || post.text, 150), 'post:' + post.id);
                playSound('newPost');
            }
            if (state.currentUser && post.authorId === state.currentUser.id && post.comments) {
                Object.entries(post.comments).forEach(([cid, c]) => {
                    if (c.createdAt > sessionStartTime && c.userId !== state.currentUser.id && !notifiedIds.has('comment:' + cid)) {
                        notifiedIds.add('comment:' + cid);
                        const attIcons = { image: '🖼 фото', video: '🎬 видео', audio: '🎧 аудио' };
                        const preview = c.sticker ? '🖼 стикер' : (c.attachment ? attIcons[c.attachment.type] : truncateText(c.text, 150));
                        showNotification(`💭 ${c.author || 'Кто-то'} прокомментировал ваш пост`, preview, 'comment:' + cid);
                        playSound('newMessage');
                    }
                });
            }
        });
        
        renderFeed(); 
        renderProfileStats();
        
        if (state.isAdmin) renderAdminPostsList();
        if (state.activeOverlay === 'post') renderPostOverlay();
    }, (error) => {
        if (!feedLoaded) {
            feedLoaded = true;
            clearTimeout(feedWatchdog);
        }
        console.error('Firebase (posts) ошибка:', error);
        const container = document.getElementById('feed-container');
        if (container) container.innerHTML = `<div class="empty-state"><span class="icon">⚠️</span><div class="title">${friendlyDbError(error)}</div></div>`;
    });

    onValue(ref(state.db, 'banners'), (snapshot) => {
        const data = snapshot.val();
        state.bannersData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })).sort((a, b) => {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            return (a.createdAt||0) - (b.createdAt||0);
        }) : [];
        renderBanners();
        if (state.isAdmin) renderAdminBannersList();
    });

    onValue(ref(state.db, 'shopItems'), (snapshot) => {
        const data = snapshot.val();
        state.shopItemsData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        renderOwnProfileHeader();
        if (state.activeOverlay === 'userprofile' && state.viewingUserId) renderUserProfileOverlay(state.viewingUserId);
    });

    onValue(ref(state.db, 'settings/boss'), (snapshot) => {
        state.bossData = snapshot.val();
        renderBossCard();
        if (state.isAdmin) populateBossAdminForm();

        if (state.bossData && state.bossData.enabled && !state.bossData.defeated && (state.bossData.hp || 0) <= 0) {
            update(ref(state.db, 'settings/boss'), { defeated: true }).then(() => {
                distributeBossRewards(state.bossData, () => {
                    update(ref(state.db, 'settings/boss'), { enabled: false }).catch(() => {});
                });
            }).catch(() => {});
        }
    });

    onValue(ref(state.db, 'bossParticipants'), (snapshot) => {
        state.bossParticipantsData = snapshot.val() || {};
        if (state.isAdmin) renderBossParticipantsList();
    });

    onValue(ref(state.db, 'settings/youtubeVideoId'), (snapshot) => {
        state.youtubeVideoId = snapshot.val() || null;
        const btn = document.getElementById('btn-open-yt');
        if (btn) btn.classList.toggle('hidden', !state.youtubeVideoId);
        if (state.isAdmin) {
            const ytInput = document.getElementById('yt-video-id');
            if (ytInput) ytInput.value = state.youtubeVideoId || '';
        }
    });

    onValue(ref(state.db, 'settings/badgeColor'), (snapshot) => {
        if (snapshot.val()) state.badgeColor = snapshot.val();
        renderFeed();
        renderOwnProfileHeader();
        if (state.activeOverlay === 'post') renderPostOverlay();
        if (state.activeOverlay === 'userprofile' && state.viewingUserId) renderUserProfileOverlay(state.viewingUserId);
        if (state.activeOverlay === 'chat' && state.currentChatId) {
            state.renderedChatState = { chatId: null, signature: null };
            const chat = state.chatsData.find(c => c.id === state.currentChatId);
            if (chat) renderChatOverlay(chat);
        }
    });

    onValue(ref(state.db, 'settings/theme'), (snapshot) => {
        applyTheme(snapshot.val() || 'light');
    });

    onValue(ref(state.db, 'settings/sounds'), (snapshot) => {
        state.soundsData = snapshot.val() || {};
    });

    onValue(ref(state.db, 'settings/effects'), (snapshot) => {
        state.effectsData = snapshot.val() || {};
        renderAmbientParticles();
    });

    onValue(ref(state.db, 'settings/terrariaTheme'), (snapshot) => {
        state.terrariaData = snapshot.val() || {};
        applyTerrariaFeatures();
    });

    onValue(ref(state.db, 'seasonPass/' + currentSeasonId()), (snapshot) => {
        state.seasonPassData = snapshot.val() || { name: 'Сезонный пасс', endsAt: null, premiumPrice: 300, levels: {}, weeklyQuests: {} };
        renderPassButton();
    });

    onValue(ref(state.db, 'settings/economy'), (snapshot) => {
        state.economyData = Object.assign(
            { dailyEnabled: true, dailyAmount: 10, chapterEnabled: false, chapterAmount: 0, bookEnabled: false, bookAmount: 0, streakEnabled: false, streakAmount: 0, streakEvery: 1, streakMax: 0, eventMultiplier: 1, eventMultiplierUntil: null },
            snapshot.val() || {}
        );
        renderEventMultiplierBanner();
        renderQuestsList();
        if (state.isAdmin) populateEconomyAdminForm();
        if (!state.streakCheckedThisSession && state.currentUser) { 
            state.streakCheckedThisSession = true; 
            updateStreak(); 
        }
    });

    onValue(ref(state.db, 'quests'), (snapshot) => {
        const data = snapshot.val();
        state.questsData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        renderQuestsList();
        if (state.isAdmin) renderAdminQuestsList();
    });

    onValue(ref(state.db, 'events'), (snapshot) => {
        const data = snapshot.val();
        state.eventsData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        if (state.isAdmin) renderAdminEventsList();
        if (state.activeOverlay === 'events') renderEventsCalendar();
    });

    onValue(ref(state.db, 'cards'), (snapshot) => {
        const data = snapshot.val();
        state.cardsData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        if (state.isAdmin) { renderAdminCardsList(); renderAdminCombosList(); renderStoryBossDeckPicker(); populateStoryRewardCardSelect(); }
    });

    onValue(ref(state.db, 'storyChapters'), (snapshot) => {
        const data = snapshot.val();
        state.storyChapters = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        if (state.isAdmin) renderAdminStoryList();
        if (state.activeOverlay === 'storyMode') renderStoryListView();
    });

    onValue(ref(state.db, 'arenas'), (snapshot) => {
        const data = snapshot.val();
        state.arenasData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        if (state.isAdmin && window.renderAdminArenasList) window.renderAdminArenasList();
    });

    onValue(ref(state.db, 'cardCombos'), (snapshot) => {
        const data = snapshot.val();
        state.cardCombosData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        if (state.isAdmin) renderAdminCombosList();
    });

    onValue(ref(state.db, 'cardPacks'), (snapshot) => {
        const data = snapshot.val();
        state.cardPacksData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        if (state.isAdmin) renderAdminPacksList();
    });

    onValue(ref(state.db, 'heroClasses'), (snapshot) => {
        const data = snapshot.val();
        state.heroClassesData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        if (state.isAdmin) renderAdminClassesList();
    });

    onValue(ref(state.db, 'cardGameSettings'), (snapshot) => {
        const data = snapshot.val();
        if (data) state.deckSettings = { deckSize: data.deckSize || 30, maxCopies: data.maxCopies || 2 };
        if (state.isAdmin) populateDeckSettingsForm();
    });

    onValue(ref(state.db, 'cardFrames'), (snapshot) => {
        state.cardFramesData = snapshot.val() || {};
        if (state.isAdmin) populateFramesForm();
    });

    if (state.currentUser) {
        onValue(ref(state.db, 'users/' + state.currentUser.id + '/cardCollection'), (snapshot) => {
            state.myCollection = snapshot.val() || {};
            if (state.activeOverlay === 'decks') renderDecksView();
            if (state.activeOverlay === 'cardCollection') renderCardCollectionView();
        });

        onValue(ref(state.db, 'users/' + state.currentUser.id + '/decks'), (snapshot) => {
            const data = snapshot.val();
            state.myDecks = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
            if (state.activeOverlay === 'decks') renderDecksView();
        });

        onValue(ref(state.db, 'users/' + state.currentUser.id + '/storyCleared'), (snapshot) => {
            state.storyCleared = snapshot.val() || {};
            if (state.activeOverlay === 'storyMode') renderStoryListView();
        });
    }

    setInterval(renderEventMultiplierBanner, 30000);
    setInterval(updateBannerCountdowns, 1000);

    onValue(ref(state.db, 'books'), (snapshot) => {
        const data = snapshot.val();
        state.booksData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.createdAt - a.createdAt) : [];
        
        renderBooks(); 
        renderGenreFilterRow();
        maybeShowMangaAnnouncement();
        
        if (state.isAdmin) { 
            renderAdminBooksList(); 
            populateChapterBookSelect(); 
        }
        
        if (state.activeOverlay === 'reader' && state.currentBookId) {
            const book = state.booksData.find(b => b.id === state.currentBookId);
            if (book) { 
                state.currentChapters = getChapters(book); 
                renderChapterListView(book); 
            }
        }
    });

    onValue(ref(state.db, 'users'), (snapshot) => {
        const data = snapshot.val();
        state.usersData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        
        renderChatsList(); 
        renderOwnProfileHeader();
        renderNotificationsToggle();
        renderSoundToggle();
        checkDailyCoinReward();
        ensurePassSeason();
        renderPassButton();
        renderPassPetWidget();

        if (!state.timeTrackingStarted && state.currentUser) { 
            state.timeTrackingStarted = true; 
            startTimeTracking(); 
        }
        renderQuestsList();
        renderFeed();
        if (state.activeOverlay === 'post') renderPostOverlay();
        
        if (state.activeOverlay === 'newchat' || state.activeOverlay === 'creategroup') {
            renderUserPickList();
        }
        
        if (state.activeOverlay === 'chat' && state.currentChatId) {
            const chat = state.chatsData.find(c => c.id === state.currentChatId);
            if (chat) renderChatOverlay(chat);
        }
        if (state.activeOverlay === 'userprofile' && state.viewingUserId) {
            renderUserProfileOverlay(state.viewingUserId);
        }
        if (state.activeOverlay === 'packShop' && window.renderPackShopView) {
            window.renderPackShopView();
        }
    });

    onValue(ref(state.db, 'chats'), (snapshot) => {
        const data = snapshot.val();
        state.chatsData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];

        state.chatsData.forEach(chat => {
            if (!state.currentUser || !chat.participants || !chat.participants[state.currentUser.id]) return;
            if (!chat.messages) return;
            const isViewingThisChat = state.activeOverlay === 'chat' && state.currentChatId === chat.id
                && document.visibilityState === 'visible' && document.hasFocus();
            if (isViewingThisChat) return;

            Object.entries(chat.messages).forEach(([mid, m]) => {
                if (m.createdAt > sessionStartTime && m.senderId !== state.currentUser.id && !notifiedIds.has('msg:' + mid)) {
                    notifiedIds.add('msg:' + mid);
                    const attIcons2 = { image: '🖼 фото', video: '🎬 видео', audio: '🎧 аудио' };
                    const preview = m.soundSticker ? '🔊 звук-стикер' : (m.sticker ? '🖼 стикер' : (m.attachment ? attIcons2[m.attachment.type] : truncateText(m.text, 150)));
                    showNotification(`💬 ${m.senderName || 'Сообщение'}`, preview, 'msg:' + mid);
                    playSound('newMessage');
                }
            });
        });
        
        renderChatsList(); 
        renderProfileStats();
        
        if (state.activeOverlay === 'chat' && state.currentChatId) {
            const chat = state.chatsData.find(c => c.id === state.currentChatId);
            if (chat) renderChatOverlay(chat);
        }
    });

    onValue(ref(state.db, 'stickers'), (snapshot) => {
        const data = snapshot.val();
        state.stickersData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        
        if (state.isAdmin) renderAdminStickersList();
        renderStickerPicker();
    });
    
    onValue(ref(state.db, 'sticker_packs'), (snapshot) => {
        const data = snapshot.val();
        state.stickerPacksData = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })) : [];
        
        if (state.isAdmin) { 
            populateStickerPackSelect(); 
            renderAdminStickersList(); 
        }
        renderStickerPicker();
    });
}
