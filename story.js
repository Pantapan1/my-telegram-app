import { ref, push, update, remove, get } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { colorFor, escapeHtml, friendlyDbError, initialOf, showStoryDialogue } from './utils.js';
import { startStoryBattle } from './battle.js';

// ===================== ОБЩЕЕ =====================

function sortedStoryChapters() {
    return (state.storyChapters || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

function isChapterUnlocked(chapters, idx) {
    if (idx <= 0) return true;
    const cleared = state.storyCleared || {};
    return !!cleared[chapters[idx - 1].id];
}

// ===================== ИГРОК: СПИСОК ГЛАВ =====================

export function renderStoryListView() {
    const body = document.getElementById('story-mode-body');
    if (!body) return;

    const chapters = sortedStoryChapters();
    if (!chapters.length) {
        body.innerHTML = '<div class="empty-state"><span class="icon">📖</span><div class="title">Сюжет пока не готов</div><div class="sub">Автор ещё пишет главы — загляни позже</div></div>';
        return;
    }

    const cleared = state.storyCleared || {};
    body.innerHTML = chapters.map((c, idx) => {
        const isCleared = !!cleared[c.id];
        const unlocked = isChapterUnlocked(chapters, idx);
        const statusText = isCleared ? '✅ Пройдено' : (unlocked ? '⚔️ Доступно' : '🔒 Заблокировано');
        const thumbStyle = unlocked ? '' : 'filter:grayscale(1);opacity:.55;';
        return `
        <div class="admin-item ${unlocked ? '' : 'story-chapter-locked'}" onclick="window.startStoryChapter('${c.id}')" style="cursor:pointer;">
            ${c.bossAvatar
                ? `<img src="${c.bossAvatar}" class="admin-item-thumb" style="${thumbStyle}" onerror="this.style.display='none'">`
                : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(c.bossName || '')};${thumbStyle}">${initialOf(c.bossName || '?')}</div>`}
            <div class="admin-item-info">
                <div class="admin-item-title">${idx + 1}. ${escapeHtml(c.name || 'Глава')}</div>
                <div class="admin-item-sub">${statusText} · Соперник: ${escapeHtml(c.bossName || '—')}</div>
            </div>
        </div>`;
    }).join('');
}

window.openStoryMode = function () {
    state.activeOverlay = 'storyMode';
    document.getElementById('story-mode-overlay').classList.add('active');
    renderStoryListView();
};

window.closeStoryMode = function () {
    document.getElementById('story-mode-overlay').classList.remove('active');
    state.activeOverlay = null;
};

// ===================== ИГРОК: ЗАПУСК ГЛАВЫ =====================

window.startStoryChapter = function (chapterId) {
    const chapters = sortedStoryChapters();
    const idx = chapters.findIndex(c => c.id === chapterId);
    if (idx === -1) return;

    if (!isChapterUnlocked(chapters, idx)) {
        return tg.showPopup({ title: 'Глава закрыта', message: 'Сначала пройди предыдущую главу', buttons: [{ type: 'ok' }] });
    }
    if (!state.myDecks.length) {
        return tg.showPopup({ title: 'Нет колод', message: 'Сначала собери колоду из своей коллекции', buttons: [{ type: 'ok' }] });
    }

    const chapter = chapters[idx];
    if (state.myDecks.length === 1) {
        beginStoryDialogueAndBattle(chapter, state.myDecks[0].id);
    } else {
        state.storyPendingChapterId = chapterId;
        renderStoryDeckPicker(chapter);
    }
};

function renderStoryDeckPicker(chapter) {
    const body = document.getElementById('story-mode-body');
    if (!body) return;
    body.innerHTML = `<div style="padding:4px 2px 14px;font-weight:800;color:var(--text-primary);">Выбери колоду для боя с «${escapeHtml(chapter.bossName || '')}»</div>` +
        state.myDecks.map(d => `
        <div class="admin-item" onclick="window.pickStoryDeck('${d.id}')" style="cursor:pointer;">
            <div class="admin-item-thumb cover-fallback small" style="background:${colorFor(d.name || '')};">🃏</div>
            <div class="admin-item-info"><div class="admin-item-title">${escapeHtml(d.name || '')}</div></div>
        </div>`).join('');
}

window.pickStoryDeck = function (deckId) {
    const chapters = sortedStoryChapters();
    const chapter = chapters.find(c => c.id === state.storyPendingChapterId);
    if (chapter) beginStoryDialogueAndBattle(chapter, deckId);
};

function beginStoryDialogueAndBattle(chapter, deckId) {
    const overlay = document.getElementById('story-mode-overlay');
    if (overlay) overlay.classList.remove('active');

    const intro = (chapter.introDialogue && chapter.introDialogue.length)
        ? chapter.introDialogue
        : [{ speaker: chapter.bossName || 'Соперник', text: 'Готовься к бою!' }];

    showStoryDialogue(intro, chapter.bossAvatar, chapter.bossName, () => {
        state.activeOverlay = 'battle';
        document.getElementById('battle-overlay').classList.add('active');
        document.getElementById('battle-header-title').textContent = chapter.bossName ? ('Бой: ' + chapter.bossName) : 'Бой';
        startStoryBattle(chapter, deckId);
    });
}

// ===================== АДМИНКА: РЕДАКТОР ГЛАВ =====================

function parseDialogueLines(text) {
    return (text || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const i = line.indexOf(':');
        if (i === -1) return { speaker: '', text: line };
        return { speaker: line.slice(0, i).trim(), text: line.slice(i + 1).trim() };
    }).filter(l => l.text);
}

function serializeDialogueLines(lines) {
    return (lines || []).map(l => `${l.speaker || ''}: ${l.text || ''}`).join('\n');
}

function parseDuringDialogueLines(text) {
    const out = {};
    (text || '').split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
        const parts = line.split('|');
        if (parts.length < 3) return;
        const turn = parseInt(parts[0], 10);
        const speaker = parts[1].trim();
        const dtext = parts.slice(2).join('|').trim();
        if (!turn || !dtext) return;
        const key = String(turn);
        if (!out[key]) out[key] = [];
        out[key].push({ speaker, text: dtext });
    });
    return out;
}

function serializeDuringDialogue(obj) {
    const lines = [];
    Object.entries(obj || {}).forEach(([turn, arr]) => {
        (arr || []).forEach(l => lines.push(`${turn}|${l.speaker || ''}|${l.text || ''}`));
    });
    return lines.join('\n');
}

export function renderStoryBossDeckPicker() {
    const el = document.getElementById('story-boss-deck-picker');
    if (!el) return;

    const draft = state.storyBossDeckDraft || {};
    const total = Object.values(draft).reduce((s, n) => s + n, 0);

    if (!state.cardsData || !state.cardsData.length) {
        el.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;">Сначала добавь карточки во вкладке «Карточки».</div>`;
        return;
    }

    const rows = state.cardsData.slice().sort((a, b) => (a.mana || 0) - (b.mana || 0)).map(card => {
        const n = draft[card.id] || 0;
        return `
        <div class="admin-item">
            ${card.image ? `<img src="${card.image}" class="admin-item-thumb" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(card.name || '')};">${initialOf(card.name)}</div>`}
            <div class="admin-item-info">
                <div class="admin-item-title">${escapeHtml(card.name || '')}</div>
                <div class="admin-item-sub">💧${card.mana || 0}</div>
            </div>
            <div class="admin-item-actions" style="align-items:center;">
                <button class="icon-btn" onclick="window.changeStoryBossCardCount('${card.id}', -1)">−</button>
                <span style="min-width:16px;text-align:center;font-weight:800;color:var(--text-primary);">${n}</span>
                <button class="icon-btn" onclick="window.changeStoryBossCardCount('${card.id}', 1)">+</button>
            </div>
        </div>`;
    }).join('');

    el.innerHTML = `<div style="font-weight:800;color:var(--text-primary);margin:2px 0 8px;">🃏 Колода соперника (${total} карт)</div>` + rows;
}

window.changeStoryBossCardCount = function (cardId, delta) {
    if (!state.storyBossDeckDraft) state.storyBossDeckDraft = {};
    const cur = state.storyBossDeckDraft[cardId] || 0;
    const next = Math.max(0, Math.min(4, cur + delta));
    if (next === 0) delete state.storyBossDeckDraft[cardId];
    else state.storyBossDeckDraft[cardId] = next;
    renderStoryBossDeckPicker();
};

export function populateStoryRewardCardSelect() {
    const sel = document.getElementById('story-reward-card');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Без карточки</option>' + (state.cardsData || [])
        .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(c => `<option value="${c.id}">${escapeHtml(c.name || '(без названия)')}</option>`).join('');
    if (current) sel.value = current;
}

export function renderAdminStoryList() {
    const el = document.getElementById('admin-story-list');
    if (!el) return;

    const chapters = sortedStoryChapters();
    if (!chapters.length) {
        el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Глав пока нет.</div>';
        return;
    }

    el.innerHTML = chapters.map(c => `
        <div class="admin-item">
            ${c.bossAvatar ? `<img src="${c.bossAvatar}" class="admin-item-thumb" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(c.bossName || '')};">${initialOf(c.bossName || '?')}</div>`}
            <div class="admin-item-info">
                <div class="admin-item-title">#${c.order ?? 0} · ${escapeHtml(c.name || 'Глава')}</div>
                <div class="admin-item-sub">Босс: ${escapeHtml(c.bossName || '—')} · Карт в колоде: ${Object.values(c.bossDeck || {}).reduce((s, n) => s + n, 0)}</div>
            </div>
            <div class="admin-item-actions">
                <button class="icon-btn" onclick="window.editStoryChapter('${c.id}')">✏️</button>
                <button class="icon-btn danger" onclick="window.deleteStoryChapter('${c.id}')">🗑</button>
            </div>
        </div>`).join('');
}

window.editStoryChapter = function (id) {
    const c = (state.storyChapters || []).find(x => x.id === id);
    if (!c) return;

    state.editingStoryChapterId = id;
    state.storyBossDeckDraft = { ...(c.bossDeck || {}) };

    document.getElementById('story-chapter-name').value = c.name || '';
    document.getElementById('story-chapter-order').value = c.order ?? 0;
    document.getElementById('story-boss-name').value = c.bossName || '';
    document.getElementById('story-boss-image').value = c.bossAvatar || '';
    document.getElementById('story-dialogue-intro').value = serializeDialogueLines(c.introDialogue);
    document.getElementById('story-dialogue-during').value = serializeDuringDialogue(c.duringDialogue);
    document.getElementById('story-dialogue-win').value = serializeDialogueLines(c.winDialogue);
    document.getElementById('story-dialogue-lose').value = serializeDialogueLines(c.loseDialogue);
    document.getElementById('story-reward-coins').value = c.rewardCoins || 0;
    document.getElementById('story-reward-card-count').value = c.rewardCardCount || 1;
    populateStoryRewardCardSelect();
    document.getElementById('story-reward-card').value = c.rewardCardId || '';
    renderStoryBossDeckPicker();

    document.getElementById('story-chapter-form-heading').textContent = 'Редактировать главу';
    document.getElementById('btn-add-story-chapter').textContent = 'Сохранить';
    document.getElementById('btn-cancel-edit-story-chapter').classList.remove('hidden');
    document.getElementById('story-chapter-name').scrollIntoView({ behavior: 'smooth' });
};

window.cancelEditStoryChapter = function () {
    state.editingStoryChapterId = null;
    state.storyBossDeckDraft = {};

    ['story-chapter-name', 'story-boss-name', 'story-boss-image', 'story-dialogue-intro', 'story-dialogue-during', 'story-dialogue-win', 'story-dialogue-lose'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('story-chapter-order').value = '';
    document.getElementById('story-reward-coins').value = '';
    document.getElementById('story-reward-card-count').value = 1;
    const sel = document.getElementById('story-reward-card');
    if (sel) sel.value = '';
    renderStoryBossDeckPicker();

    document.getElementById('story-chapter-form-heading').textContent = 'Создать главу';
    document.getElementById('btn-add-story-chapter').textContent = 'Добавить главу';
    document.getElementById('btn-cancel-edit-story-chapter').classList.add('hidden');
};

window.saveStoryChapter = function () {
    const name = document.getElementById('story-chapter-name').value.trim();
    const order = parseInt(document.getElementById('story-chapter-order').value, 10) || 0;
    const bossName = document.getElementById('story-boss-name').value.trim();
    const bossAvatar = document.getElementById('story-boss-image').value.trim();
    const rewardCoins = parseInt(document.getElementById('story-reward-coins').value, 10) || 0;
    const rewardCardId = document.getElementById('story-reward-card').value || null;
    const rewardCardCount = parseInt(document.getElementById('story-reward-card-count').value, 10) || 1;

    if (!name) return tg.showAlert('Укажи название главы');
    if (!bossName) return tg.showAlert('Укажи имя соперника');

    const bossDeck = state.storyBossDeckDraft || {};
    if (!Object.keys(bossDeck).length) return tg.showAlert('Собери колоду соперника — выбери хотя бы одну карту');

    const data = {
        name, order, bossName, bossAvatar, bossDeck,
        introDialogue: parseDialogueLines(document.getElementById('story-dialogue-intro').value),
        duringDialogue: parseDuringDialogueLines(document.getElementById('story-dialogue-during').value),
        winDialogue: parseDialogueLines(document.getElementById('story-dialogue-win').value),
        loseDialogue: parseDialogueLines(document.getElementById('story-dialogue-lose').value),
        rewardCoins, rewardCardId, rewardCardCount,
    };

    if (state.editingStoryChapterId) {
        update(ref(state.db, 'storyChapters/' + state.editingStoryChapterId), data).then(() => {
            window.cancelEditStoryChapter();
            tg.showPopup({ title: 'Готово', message: 'Глава обновлена', buttons: [{ type: 'ok' }] });
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
    } else {
        push(ref(state.db, 'storyChapters'), { ...data, createdAt: Date.now() }).then(() => {
            window.cancelEditStoryChapter();
            tg.showPopup({ title: 'Супер!', message: 'Глава создана', buttons: [{ type: 'ok' }] });
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
    }
};

window.deleteStoryChapter = function (id) {
    if (!confirm('Точно удалить эту главу?')) return;
    remove(ref(state.db, 'storyChapters/' + id)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};
