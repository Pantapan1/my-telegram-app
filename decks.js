import { ref, push, set, update, remove } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { escapeHtml, colorFor, initialOf, cardFrameStyle } from './utils.js';
import { startMatchmaking } from './battle.js';

function deckCardCount(cards) {
    return Object.values(cards || {}).reduce((sum, n) => sum + n, 0);
}

function classById(id) {
    return state.heroClassesData.find(c => c.id === id) || null;
}

export function renderDecksView() {
    const body = document.getElementById('decks-body');
    const title = document.getElementById('decks-header-title');
    const saveBtn = document.getElementById('deck-save-btn');
    if (!body) return;

    saveBtn.classList.toggle('hidden', state.decksView !== 'editor');

    if (state.decksView === 'classpicker') {
        title.textContent = 'Выбери класс героя';
        renderClassPickerView(body);
    } else if (state.decksView === 'editor') {
        title.textContent = state.deckDraft ? (state.deckDraft.name || 'Новая колода') : 'Колода';
        renderDeckEditorView(body);
    } else {
        title.textContent = 'Мои колоды';
        renderDecksListView(body);
    }
}

function renderDecksListView(body) {
    if (!state.myDecks.length) {
        body.innerHTML = `
            <div class="empty-state"><span class="icon">🃏</span><div class="title">Колод пока нет</div><div class="sub">Собери первую колоду из своей коллекции</div></div>
            <button class="btn" onclick="startNewDeck()" style="margin-top:14px;">+ Новая колода</button>`;
        return;
    }

    const rows = state.myDecks.map(deck => {
        const cls = classById(deck.classId);
        const count = deckCardCount(deck.cards);
        const badge = cls
            ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:800;color:#fff;background:${cls.color || '#0a84ff'};">${cls.icon || ''} ${escapeHtml(cls.name || '')}</span>`
            : `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:800;color:var(--text-secondary);background:rgba(127,127,127,.2);">Нейтральная</span>`;
        return `
        <div class="admin-item">
            <div class="admin-item-thumb cover-fallback small" style="background:${cls ? cls.color : colorFor(deck.name || '')};">${cls ? (cls.icon || '⚔️') : initialOf(deck.name)}</div>
            <div class="admin-item-info">
                <div class="admin-item-title">${escapeHtml(deck.name || 'Без названия')} ${badge}</div>
                <div class="admin-item-sub">${count} / ${state.deckSettings.deckSize} карт</div>
            </div>
            <div class="admin-item-actions">
                <button class="icon-btn" onclick="openDeckEditor('${deck.id}')">✏️</button>
                <button class="icon-btn danger" onclick="deleteDeck('${deck.id}')">🗑</button>
            </div>
        </div>`;
    }).join('');

    body.innerHTML = rows + '<button class="btn" onclick="startNewDeck()" style="margin-top:14px;">+ Новая колода</button>';
}

function renderClassPickerView(body) {
    const neutralCard = `
        <div class="admin-item" onclick="pickDeckClass('')" style="cursor:pointer;">
            <div class="admin-item-thumb cover-fallback small" style="background:#8a8f98;">⚔️</div>
            <div class="admin-item-info"><div class="admin-item-title">Без класса</div><div class="admin-item-sub">Только нейтральные карточки</div></div>
        </div>`;

    const classCards = state.heroClassesData.map(cl => `
        <div class="admin-item" onclick="pickDeckClass('${cl.id}')" style="cursor:pointer;">
            <div class="admin-item-thumb cover-fallback small" style="background:${cl.color || '#0a84ff'};">${cl.icon || '⚔️'}</div>
            <div class="admin-item-info"><div class="admin-item-title">${escapeHtml(cl.name || '')}</div></div>
        </div>`).join('');

    if (!state.heroClassesData.length) {
        body.innerHTML = neutralCard + '<div style="color:var(--text-secondary);font-size:13px;margin-top:10px;">Классы героев ещё не добавлены</div>';
    } else {
        body.innerHTML = classCards + neutralCard;
    }
}

function renderDeckEditorView(body) {
    const draft = state.deckDraft;
    const cls = classById(draft.classId);
    const total = deckCardCount(draft.cards);
    const { deckSize, maxCopies } = state.deckSettings;

    const owned = Object.entries(state.myCollection || {}).filter(([, n]) => n > 0);
    const availableCards = owned
        .map(([cardId, ownedCount]) => ({ card: state.cardsData.find(c => c.id === cardId), ownedCount }))
        .filter(x => x.card && (!x.card.classId || x.card.classId === draft.classId))
        .sort((a, b) => (a.card.mana || 0) - (b.card.mana || 0));

    const header = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div class="admin-item-thumb cover-fallback small" style="background:${cls ? cls.color : '#8a8f98'};">${cls ? (cls.icon || '⚔️') : '⚔️'}</div>
            <input type="text" id="deck-name-input" class="input" style="margin:0;flex:1;" value="${escapeHtml(draft.name || '')}" placeholder="Название колоды" oninput="updateDeckDraftName(this.value)">
        </div>
        <div style="font-weight:800;color:${total > deckSize ? '#ff453a' : 'var(--text-primary)'};margin-bottom:10px;">${total} / ${deckSize} карт (макс. ${maxCopies} копий одной карты)</div>`;

    if (!availableCards.length) {
        body.innerHTML = header + `<div class="empty-state"><span class="icon">📭</span><div class="title">Нет доступных карточек</div><div class="sub">Купи набор в магазине или получи карты из пасса</div></div>`;
        return;
    }

    const rows = availableCards.map(({ card, ownedCount }) => {
        const inDeck = (draft.cards[card.id] || 0);
        const canAdd = inDeck < Math.min(maxCopies, ownedCount) && total < deckSize;
        return `
        <div class="admin-item">
            ${card.image ? `<img src="${card.image}" class="admin-item-thumb" style="${cardFrameStyle(card.rarity)}" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(card.name || '')};${cardFrameStyle(card.rarity)}">${initialOf(card.name)}</div>`}
            <div class="admin-item-info">
                <div class="admin-item-title">${escapeHtml(card.name || '')}</div>
                <div class="admin-item-sub">💧${card.mana || 0} · есть: ${ownedCount}</div>
            </div>
            <div class="admin-item-actions" style="align-items:center;">
                <button class="icon-btn" onclick="changeDeckCardCount('${card.id}', -1)" ${inDeck === 0 ? 'disabled style="opacity:.35;"' : ''}>−</button>
                <span style="min-width:16px;text-align:center;font-weight:800;color:var(--text-primary);">${inDeck}</span>
                <button class="icon-btn" onclick="changeDeckCardCount('${card.id}', 1)" ${canAdd ? '' : 'disabled style="opacity:.35;"'}>+</button>
            </div>
        </div>`;
    }).join('');

    body.innerHTML = header + rows;
}

window.updateDeckDraftName = function (value) {
    if (state.deckDraft) state.deckDraft.name = value;
};

// ===================== ГЛАВНОЕ МЕНЮ КАРТОЧНОЙ ИГРЫ =====================

function renderCardGameMenu() {
    const body = document.getElementById('card-game-menu-body');
    if (!body) return;

    const deckCount = state.myDecks.length;
    const uniqueCards = Object.values(state.myCollection || {}).filter(n => n > 0).length;
    const totalCards = Object.values(state.myCollection || {}).reduce((s, n) => s + n, 0);

    body.innerHTML = `
        <div class="cg-menu-header">
            <div class="cg-title">Врата Бездны</div>
            <div class="cg-stats">Колод: ${deckCount} | Карт собрано: ${uniqueCards} (${totalCards} шт.)</div>
        </div>
        <div class="cg-menu-grid">
            <div class="cg-main-btn" onclick="startCardBattle()">
                <div class="cg-icon">⚔️</div>
                <div class="cg-label">В БОЙ</div>
                <div class="cg-sub">Искать противника</div>
            </div>
            
            <div class="cg-side-btns">
                <div class="cg-btn" onclick="openDecksOverlay()">
                    <div style="font-size:24px; margin-bottom:4px;">🃏</div>
                    Мои колоды
                </div>
                <div class="cg-btn" onclick="openCardCollection()">
                    <div style="font-size:24px; margin-bottom:4px;">📚</div>
                    Коллекция
                </div>
                <button class="cg-btn full-width" onclick="openPackShop()">
                    🛍 Магазин наборов
                </button>
            </div>
        </div>
    `;
}

window.openCardGameMenu = function () {
    state.activeOverlay = 'cardGameMenu';
    document.getElementById('card-game-menu-overlay').classList.add('active');
    renderCardGameMenu();
};

window.closeCardGameMenu = function () {
    document.getElementById('card-game-menu-overlay').classList.remove('active');
    state.activeOverlay = null;
};

window.startCardBattle = function () {
    if (!state.myDecks.length) {
        return tg.showPopup({ title: 'Нет колод', message: 'Сначала собери колоду из своей коллекции', buttons: [{ type: 'ok' }] });
    }
    startMatchmaking();
};

// ===================== КОЛЛЕКЦИЯ =====================

export function renderCardCollectionView() {
    const body = document.getElementById('card-collection-body');
    if (!body) return;

    const owned = Object.entries(state.myCollection || {}).filter(([, n]) => n > 0);
    if (!owned.length) {
        body.innerHTML = '<div class="empty-state"><span class="icon">📭</span><div class="title">Коллекция пуста</div><div class="sub">Купи набор в магазине или получи карты из пасса</div></div>';
        return;
    }

    const rows = owned
        .map(([cardId, count]) => ({ card: state.cardsData.find(c => c.id === cardId), count }))
        .filter(x => x.card)
        .sort((a, b) => (a.card.mana || 0) - (b.card.mana || 0));

    body.innerHTML = rows.map(({ card, count }) => {
        const cls = classById(card.classId);
        const classTag = cls
            ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:800;color:#fff;background:${cls.color || '#0a84ff'};">${cls.icon || ''} ${escapeHtml(cls.name || '')}</span>`
            : `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:800;color:var(--text-secondary);background:rgba(127,127,127,.2);">Нейтральная</span>`;
        return `
        <div class="admin-item">
            ${card.image ? `<img src="${card.image}" class="admin-item-thumb" style="${cardFrameStyle(card.rarity)}" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(card.name || '')};${cardFrameStyle(card.rarity)}">${initialOf(card.name)}</div>`}
            <div class="admin-item-info">
                <div class="admin-item-title">${escapeHtml(card.name || '')} ${classTag}</div>
                <div class="admin-item-sub">💧${card.mana || 0}${card.type === 'minion' ? ` · ⚔️${card.attack || 0} · ❤️${card.health || 0}` : ' · Заклинание'}</div>
            </div>
            <div class="admin-item-actions">
                <span style="font-weight:800;color:var(--text-primary);">×${count}</span>
            </div>
        </div>`;
    }).join('');
}

window.openCardCollection = function () {
    state.activeOverlay = 'cardCollection';
    document.getElementById('card-collection-overlay').classList.add('active');
    renderCardCollectionView();
};

window.closeCardCollection = function () {
    document.getElementById('card-collection-overlay').classList.remove('active');
    state.activeOverlay = 'cardGameMenu';
};

window.openDecksOverlay = function () {
    state.activeOverlay = 'decks';
    state.decksView = 'list';
    document.getElementById('decks-overlay').classList.add('active');
    renderDecksView();
};

window.decksGoBack = function () {
    if (state.decksView === 'editor') {
        state.decksView = state.editingDeckId ? 'list' : 'classpicker';
        if (state.editingDeckId) { state.deckDraft = null; state.editingDeckId = null; }
        renderDecksView();
    } else if (state.decksView === 'classpicker') {
        state.decksView = 'list';
        renderDecksView();
    } else {
        document.getElementById('decks-overlay').classList.remove('active');
        document.getElementById('card-game-menu-overlay').classList.add('active');
        state.activeOverlay = 'cardGameMenu';
        renderCardGameMenu();
    }
};

window.startNewDeck = function () {
    state.editingDeckId = null;
    state.deckDraft = { name: 'Новая колода', classId: null, cards: {} };
    state.decksView = 'classpicker';
    renderDecksView();
};

window.pickDeckClass = function (classId) {
    state.deckDraft.classId = classId || null;
    state.decksView = 'editor';
    renderDecksView();
};

window.openDeckEditor = function (deckId) {
    const deck = state.myDecks.find(d => d.id === deckId);
    if (!deck) return;
    state.editingDeckId = deckId;
    state.deckDraft = { name: deck.name || '', classId: deck.classId || null, cards: { ...(deck.cards || {}) } };
    state.decksView = 'editor';
    renderDecksView();
};

window.changeDeckCardCount = function (cardId, delta) {
    const draft = state.deckDraft;
    const current = draft.cards[cardId] || 0;
    const next = current + delta;
    if (next <= 0) {
        delete draft.cards[cardId];
    } else {
        draft.cards[cardId] = next;
    }
    renderDecksView();
};

window.deleteDeck = function (id) {
    if (!confirm('Удалить колоду?')) return;
    remove(ref(state.db, 'users/' + state.currentUser.id + '/decks/' + id)).catch(err => tg.showAlert('Ошибка: ' + err.message));
};

window.saveDeck = function () {
    const draft = state.deckDraft;
    const nameInput = document.getElementById('deck-name-input');
    if (nameInput) draft.name = nameInput.value.trim();
    if (!draft.name) return tg.showAlert('Укажи название колоды');
    if (!Object.keys(draft.cards).length) return tg.showAlert('Добавь хотя бы одну карточку в колоду');

    const path = 'users/' + state.currentUser.id + '/decks/' + (state.editingDeckId || push(ref(state.db, 'users/' + state.currentUser.id + '/decks')).key);
    set(ref(state.db, path), { name: draft.name, classId: draft.classId || null, cards: draft.cards, updatedAt: Date.now() })
        .then(() => {
            state.decksView = 'list';
            state.deckDraft = null;
            state.editingDeckId = null;
            renderDecksView();
            tg.showPopup({ title: 'Сохранено!', message: 'Колода сохранена', buttons: [{ type: 'ok' }] });
        })
        .catch(err => tg.showAlert('Ошибка сохранения: ' + err.message));
};

// ===================== МАГАЗИН НАБОРОВ (ПАКОВ) =====================

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
const RARITY_WEIGHTS = { common: 100, rare: 30, epic: 10, legendary: 3 };
const RARITY_LABELS_RU = { common: 'Обычная', rare: 'Редкая', epic: 'Эпическая', legendary: 'Легендарная' };

function weightedRandomCard(pool) {
    const total = pool.reduce((s, c) => s + (RARITY_WEIGHTS[c.rarity] || RARITY_WEIGHTS.common), 0);
    let r = Math.random() * total;
    for (const c of pool) {
        r -= (RARITY_WEIGHTS[c.rarity] || RARITY_WEIGHTS.common);
        if (r <= 0) return c;
    }
    return pool[pool.length - 1];
}

function drawPackCards(pack) {
    const pool = state.cardsData;
    if (!pool.length) return [];
    const drawn = [];
    const minIdx = pack.minRarity ? RARITY_ORDER.indexOf(pack.minRarity) : -1;
    const count = Math.max(pack.count || 1, 1);

    for (let i = 0; i < count; i++) {
        let candidatePool = pool;
        // первая карта в наборе — гарантия минимальной редкости, если она задана
        if (i === 0 && minIdx >= 0) {
            const eligible = pool.filter(c => RARITY_ORDER.indexOf(c.rarity || 'common') >= minIdx);
            if (eligible.length) candidatePool = eligible;
        }
        drawn.push(weightedRandomCard(candidatePool));
    }
    return drawn;
}

function renderPackShopView() {
    const body = document.getElementById('pack-shop-body');
    if (!body) return;

    if (!state.cardsData.length) {
        body.innerHTML = '<div class="empty-state"><span class="icon">🃏</span><div class="title">Карточек ещё нет</div><div class="sub">Загляни позже</div></div>';
        return;
    }
    if (!state.cardPacksData.length) {
        body.innerHTML = '<div class="empty-state"><span class="icon">🛍</span><div class="title">Наборов пока нет</div><div class="sub">Загляни позже</div></div>';
        return;
    }

    const me = state.usersData.find(u => u.id === state.currentUser.id);
    const coins = (me && me.coins) || 0;

    body.innerHTML = `
        <div style="text-align:right;font-weight:800;color:var(--text-primary);margin-bottom:12px;">🪙 ${coins}</div>
        ${state.cardPacksData.map(p => {
            const canAfford = coins >= (p.price || 0);
            return `
            <div class="admin-item">
                ${p.image ? `<img src="${p.image}" class="admin-item-thumb" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(p.name || '')}">${initialOf(p.name)}</div>`}
                <div class="admin-item-info">
                    <div class="admin-item-title">${escapeHtml(p.name || '')}</div>
                    <div class="admin-item-sub">${p.count || 1} карт${p.minRarity ? ' · мин. ' + (RARITY_LABELS_RU[p.minRarity] || '') : ''}</div>
                </div>
                <div class="admin-item-actions">
                    <button class="btn" style="width:auto;margin:0;padding:8px 14px;font-size:13px;${canAfford ? '' : 'opacity:.4;'}" ${canAfford ? `onclick="buyPack('${p.id}')"` : 'disabled'}>🪙 ${p.price || 0}</button>
                </div>
            </div>`;
        }).join('')}
    `;
}

window.renderPackShopView = renderPackShopView;

window.openPackShop = function () {
    state.activeOverlay = 'packShop';
    document.getElementById('pack-shop-overlay').classList.add('active');
    renderPackShopView();
};

window.closePackShop = function () {
    document.getElementById('pack-shop-overlay').classList.remove('active');
    state.activeOverlay = 'cardGameMenu';
};

window.buyPack = function (packId) {
    const pack = state.cardPacksData.find(p => p.id === packId);
    if (!pack) return;

    const me = state.usersData.find(u => u.id === state.currentUser.id);
    const coins = (me && me.coins) || 0;
    if (coins < (pack.price || 0)) return tg.showAlert('Недостаточно монет');

    const drawn = drawPackCards(pack);
    if (!drawn.length) return tg.showAlert('Не удалось открыть набор — нет доступных карточек');

    // считаем новые количества для коллекции поверх уже имеющихся
    const newCollection = { ...(state.myCollection || {}) };
    drawn.forEach(card => { newCollection[card.id] = (newCollection[card.id] || 0) + 1; });

    const uid = state.currentUser.id;
    Promise.all([
        update(ref(state.db, 'users/' + uid), { coins: coins - (pack.price || 0) }),
        update(ref(state.db, 'users/' + uid + '/cardCollection'), drawn.reduce((acc, card) => {
            acc[card.id] = newCollection[card.id];
            return acc;
        }, {}))
    ]).then(() => {
        renderPackOpeningReveal(drawn);
    }).catch(err => tg.showAlert('Ошибка покупки: ' + err.message));
};

function renderPackOpeningReveal(drawn) {
    const body = document.getElementById('pack-shop-body');
    if (!body) return;

    body.innerHTML = `
        <div style="text-align:center;font-weight:800;color:var(--text-primary);font-size:16px;margin-bottom:16px;">🎉 Новые карточки!</div>
        ${drawn.map(card => {
            const color = { common: '#9e9e9e', rare: '#0a84ff', epic: '#bf5af2', legendary: '#ff9f0a' }[card.rarity] || '#9e9e9e';
            return `
            <div class="admin-item" style="border:2px solid ${color};">
                ${card.image ? `<img src="${card.image}" class="admin-item-thumb" style="${cardFrameStyle(card.rarity)}" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(card.name || '')};${cardFrameStyle(card.rarity)}">${initialOf(card.name)}</div>`}
                <div class="admin-item-info">
                    <div class="admin-item-title">${escapeHtml(card.name || '')}</div>
                    <div class="admin-item-sub" style="color:${color};font-weight:800;">${RARITY_LABELS_RU[card.rarity] || 'Обычная'}</div>
                </div>
            </div>`;
        }).join('')}
        <button class="btn" onclick="renderPackShopView()" style="margin-top:14px;">Продолжить</button>
    `;
}
