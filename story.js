import { ref, push, update, remove, get, set } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { colorFor, escapeHtml, friendlyDbError, initialOf, showStoryDialogue, showTerrariaToast } from './utils.js';
import { startStoryBattle } from './battle.js';

// ===================== ОБЩЕЕ =====================

function sortedStoryChapters() {
    return (state.storyChapters || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

function isChapterUnlocked(chapters, idx) {
    if (idx <= 0) return true;
    const cleared = state.storyCleared || {};
    const lost = state.storyLost || {};
    const thisId = chapters[idx].id;

    // Явные ветки (заданы в админке): ищем главу, которая ведёт именно сюда через
    // победу или через "сюжетное поражение".
    const explicitlyUnlocked = chapters.some(c =>
        (c.nextChapterOnWin === thisId && cleared[c.id]) ||
        (c.nextChapterOnLose === thisId && lost[c.id])
    );
    if (explicitlyUnlocked) return true;

    // Если хоть одна глава явно ссылается на эту (веткой) — она не откроется просто по
    // порядку, только через нужную ветку (чтобы не спойлерить и не давать обходной путь).
    const isBranchTarget = chapters.some(c => c.nextChapterOnWin === thisId || c.nextChapterOnLose === thisId);
    if (isBranchTarget) return false;

    // Запасной вариант — обычный линейный порядок, если у предыдущей главы нет
    // собственной ветки на победу, уводящей в другое место.
    const prev = chapters[idx - 1];
    if (!prev) return false;
    if (prev.nextChapterOnWin && prev.nextChapterOnWin !== thisId) return false;
    return !!cleared[prev.id];
}

// Определяет, к какой главе ведёт исход БОЯ (победа/поражение) для конкретной главы —
// с учётом явных веток, а без них — следующая по порядку (только для победы).
function resolveNextChapter(chapters, chapter, won) {
    const targetId = won ? chapter.nextChapterOnWin : chapter.nextChapterOnLose;
    if (targetId) return chapters.find(c => c.id === targetId) || null;
    if (!won) return null; // без явной ветки поражение никуда не ведёт (обычная попытка/ретрай)
    const idx = chapters.findIndex(c => c.id === chapter.id);
    return chapters[idx + 1] || null;
}

// Глава считается "концовкой", если из неё нет пути дальше вообще ни при каком исходе
// (ни явной ветки, ни следующей по порядку главы).
function isEndingChapter(chapters, chapter) {
    if (chapter.nextChapterOnWin || chapter.nextChapterOnLose) return false;
    const idx = chapters.findIndex(c => c.id === chapter.id);
    return !chapters[idx + 1];
}

// Простая оценка сложности главы по колоде босса: считаем суммарную ману карт —
// чем она больше, тем сильнее соперник. Порогов три — от 1 до 3 звёзд.
function chapterDifficultyStars(chapter) {
    const deck = chapter.bossDeck || {};
    let totalMana = 0, totalCards = 0;
    Object.entries(deck).forEach(([cardId, count]) => {
        const card = (state.cardsData || []).find(c => c.id === cardId);
        totalMana += (card ? (card.mana || 0) : 0) * (count || 0);
        totalCards += count || 0;
    });
    if (!totalCards) return 1;
    const avgMana = totalMana / totalCards;
    if (avgMana >= 5) return 3;
    if (avgMana >= 3) return 2;
    return 1;
}

function difficultyStarsHtml(n) {
    return '⭐'.repeat(n) + '<span style="opacity:.25;">' + '⭐'.repeat(3 - n) + '</span>';
}

// Показывает тост «Новая глава открыта!» или экран концовки после боя, который продвинул
// сюжет (победа, либо «сюжетное» поражение с заданной веткой). isFirstTime=false для
// farm-повторов уже пройденной ветки — тогда ничего нового не показываем.
export function handleStoryChapterOutcome(chapterId, won, isFirstTime) {
    const chapters = sortedStoryChapters();
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return;

    if (isEndingChapter(chapters, chapter)) {
        if (!isFirstTime) return;
        setTimeout(() => {
            tg.showPopup({
                title: '🏁 Конец пути' + (chapter.endingName ? ': ' + chapter.endingName : ''),
                message: 'Эта ветка сюжета завершена. Другие главы и решения могут вести к другим концовкам.',
                buttons: [{ type: 'ok' }],
            });
        }, 400);
        if (state.currentUser) {
            update(ref(state.db, 'users/' + state.currentUser.id + '/storyEndingsReached'), { [chapterId]: true }).catch(() => {});
        }
        return;
    }

    if (!isFirstTime) return;
    const next = resolveNextChapter(chapters, chapter, won);
    if (!next) return;
    setTimeout(() => showTerrariaToast('Новая глава открыта!', next.name || '', '🔓'), 400);
}

// ===================== ИГРОК: СПИСОК ГЛАВ =====================

export function renderStoryListView() {
    const body = document.getElementById('story-mode-body');
    if (!body) return;

    // Общий фон сюжетного режима, если задан в админке
    const bg = (state.storySettings && state.storySettings.bgImage) || '';
    body.classList.toggle('story-has-bg', !!bg);
    body.style.backgroundImage = bg ? `url('${bg}')` : '';

    const chapters = sortedStoryChapters();
    const progressWrap = document.getElementById('story-progress-wrap');
    const searchInput = document.getElementById('story-search-input');

    if (!chapters.length) {
        if (progressWrap) progressWrap.classList.add('hidden');
        if (searchInput) searchInput.classList.add('hidden');
        body.innerHTML = '<div class="empty-state"><span class="icon">📖</span><div class="title">Сюжет пока не готов</div><div class="sub">Автор ещё пишет главы — загляни позже</div></div>';
        return;
    }

    const cleared = state.storyCleared || {};
    const lost = state.storyLost || {};
    const clearedCount = chapters.filter(c => cleared[c.id]).length;

    // Общий прогресс по сюжету — показываем, только если глав больше одной
    if (progressWrap) {
        const pct = Math.round((clearedCount / chapters.length) * 100);
        if (chapters.length > 1) {
            progressWrap.classList.remove('hidden');
            document.getElementById('story-progress-label').textContent = `Пройдено ${clearedCount} из ${chapters.length}`;
            document.getElementById('story-progress-pct').textContent = pct + '%';
            document.getElementById('story-progress-bar').style.width = pct + '%';
        } else {
            progressWrap.classList.add('hidden');
        }
    }

    // Поиск по названию главы / имени соперника — показываем, только если глав достаточно много
    if (searchInput) {
        if (chapters.length > 5) searchInput.classList.remove('hidden');
        else searchInput.classList.add('hidden');
    }

    const term = (searchInput && !searchInput.classList.contains('hidden') ? searchInput.value : '').trim().toLowerCase();

    // Главы, на которые ведёт чья-то ЯВНАЯ ветка (победа/поражение) и которые ещё не открыты,
    // скрываем из списка полностью — чтобы не спойлерить, куда ведёт та или иная развилка.
    // Обычные "следующие по порядку" заблокированные главы, наоборот, остаются видны как раньше.
    const visibleChapters = chapters.filter(c => {
        const idx = chapters.indexOf(c);
        if (isChapterUnlocked(chapters, idx)) return true;
        const isBranchTarget = chapters.some(o => o.nextChapterOnWin === c.id || o.nextChapterOnLose === c.id);
        return !isBranchTarget;
    });

    const filtered = term
        ? visibleChapters.filter(c =>
            (c.name || '').toLowerCase().includes(term) ||
            (c.bossName || '').toLowerCase().includes(term))
        : visibleChapters;

    if (term && !filtered.length) {
        body.innerHTML = '<div class="empty-state"><span class="icon">🔍</span><div class="title">Ничего не найдено</div><div class="sub">Попробуй другой запрос</div></div>';
        return;
    }

    body.innerHTML = filtered.map((c, i) => {
        const idx = chapters.indexOf(c);
        const isCleared = !!cleared[c.id];
        const isLost = !!lost[c.id];
        const unlocked = isChapterUnlocked(chapters, idx);
        const ending = isEndingChapter(chapters, c);
        const hasBranch = !!(c.nextChapterOnWin || c.nextChapterOnLose);
        const statusClass = isCleared ? 'cleared' : (unlocked ? 'available' : 'locked');
        const statusText = isCleared ? '✅ Пройдено' : (unlocked ? '⚔️ Доступно' : '🔒 Заблокировано');
        const stars = difficultyStarsHtml(chapterDifficultyStars(c));
        const bannerStyle = c.bossAvatar ? `background-image:url('${c.bossAvatar}');` : `background:${colorFor(c.bossName || '')};`;

        // Значки награды: за первое прохождение или, если глава уже пройдена, за повтор
        let rewardHtml;
        if (isCleared) {
            rewardHtml = c.replayCoins
                ? `<span class="story-replay-badge">🔁 🪙${c.replayCoins}</span>`
                : `<span class="story-replay-badge" style="opacity:.6;">🔁 без награды</span>`;
        } else {
            const parts = [];
            if (c.rewardCoins) parts.push(`🪙${c.rewardCoins}`);
            if (c.rewardCardId) parts.push(`🃏×${c.rewardCardCount || 1}`);
            rewardHtml = parts.length ? `<span class="story-reward-badge">${parts.join(' · ')}</span>` : '';
        }

        const connector = idx > 0 ? '<div class="story-chapter-connector"></div>' : '';

        return `${connector}
        <div class="story-chapter-card ${statusClass}" onclick="window.startStoryChapter('${c.id}')" style="animation-delay:${Math.min(i, 8) * 0.05}s;">
            <div class="story-chapter-banner" style="${bannerStyle}">
                <div class="story-chapter-number">${idx + 1}</div>
            </div>
            <div class="story-chapter-body">
                <div class="story-chapter-name">${escapeHtml(c.name || 'Глава')}${isLost && !isCleared ? ' <span style="opacity:.6;font-weight:600;font-size:11px;">(пройдена через поражение)</span>' : ''}</div>
                <div class="story-chapter-boss">Соперник: ${escapeHtml(c.bossName || '—')}</div>
                <div class="story-chapter-meta">
                    <span class="story-status-pill ${statusClass}">${statusText}</span>
                    <span class="story-chapter-stars">${stars}</span>
                    ${c.phase2Threshold ? '<span style="color:#ff9f0a;font-weight:700;">⚡ 2 фазы</span>' : ''}
                    ${hasBranch ? '<span style="color:#a970ff;font-weight:700;">🔀 Развилка</span>' : ''}
                    ${ending ? '<span style="color:#ff6b6b;font-weight:700;">🏁 Концовка</span>' : ''}
                    ${rewardHtml}
                </div>
            </div>
        </div>`;
    }).join('');
}

window.renderStoryListView = renderStoryListView;

window.openStoryMode = function () {
    state.activeOverlay = 'storyMode';
    const search = document.getElementById('story-search-input');
    if (search) search.value = '';
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

    renderStoryChapterPreview(chapters[idx], idx);
};

// Экран-«визитка» главы перед боем: портрет, лор, звёзды сложности,
// превью колоды соперника и итоговая награда — чтобы игрок понимал, на что идёт.
function renderStoryChapterPreview(chapter, idx) {
    const body = document.getElementById('story-mode-body');
    if (!body) return;
    document.getElementById('story-progress-wrap')?.classList.add('hidden');
    document.getElementById('story-search-input')?.classList.add('hidden');

    const isCleared = !!(state.storyCleared || {})[chapter.id];
    const stars = difficultyStarsHtml(chapterDifficultyStars(chapter));

    const deckEntries = Object.entries(chapter.bossDeck || {});
    const deckPreview = deckEntries.slice(0, 10).map(([cardId, count]) => {
        const card = (state.cardsData || []).find(c => c.id === cardId);
        const name = card ? (card.name || '?') : '?';
        return `<div class="story-deck-chip" title="${escapeHtml(name)}">
            ${card && card.image ? `<img src="${card.image}" onerror="this.style.display='none'">` : '🃏'}
            <span class="story-deck-chip-count">×${count}</span>
        </div>`;
    }).join('');
    const extraCount = deckEntries.length > 10 ? deckEntries.length - 10 : 0;

    let rewardHtml;
    if (isCleared) {
        rewardHtml = chapter.replayCoins
            ? `🔁 За повтор: <b>🪙 ${chapter.replayCoins}</b>`
            : `🔁 Повтор без награды`;
    } else {
        const parts = [];
        if (chapter.rewardCoins) parts.push(`🪙 ${chapter.rewardCoins}`);
        if (chapter.rewardCardId) parts.push(`🃏 × ${chapter.rewardCardCount || 1}`);
        rewardHtml = parts.length ? 'Награда: <b>' + parts.join(' · ') + '</b>' : '';
    }

    body.innerHTML = `
    <div class="story-preview-banner" style="${chapter.bossAvatar ? `background-image:url('${chapter.bossAvatar}');` : `background:${colorFor(chapter.bossName || '')};`}">
        <div class="story-preview-banner-fade"></div>
        <div class="story-preview-banner-title">
            <div class="story-preview-chapter-idx">Глава ${idx + 1}</div>
            <div class="story-preview-name">${escapeHtml(chapter.name || '')}</div>
        </div>
    </div>
    <div style="padding:14px 16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-weight:800;color:var(--text-primary);font-size:15px;">⚔️ ${escapeHtml(chapter.bossName || 'Соперник')}</div>
            <div style="font-size:14px;">${stars}</div>
        </div>
        ${chapter.phase2Threshold ? `<div style="font-size:12px;font-weight:700;color:#ff9f0a;margin:-4px 0 10px;">⚡ У этого босса есть вторая фаза — при ${chapter.phase2Threshold}% HP он станет сильнее</div>` : ''}
        ${chapter.nextChapterOnLose ? `<div style="font-size:12px;font-weight:700;color:#a970ff;margin:-4px 0 10px;">🔀 Кажется, исход этого боя может повернуть сюжет по-разному...</div>` : ''}
        ${chapter.description ? `<div class="story-preview-lore">${escapeHtml(chapter.description)}</div>` : ''}
        ${deckPreview ? `<div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin:12px 0 6px;">Колода соперника</div><div class="story-deck-preview-row">${deckPreview}${extraCount ? `<div class="story-deck-chip" style="opacity:.6;">+${extraCount}</div>` : ''}</div>` : ''}
        ${rewardHtml ? `<div style="margin-top:14px;padding:10px 14px;border-radius:12px;background:rgba(237,143,3,.12);color:var(--text-primary);font-size:13px;">${rewardHtml}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:18px;">
            <button class="btn btn-secondary" style="flex:0 0 auto;width:auto;" onclick="window.renderStoryListView()">← Назад</button>
            <button class="btn" style="flex:1;" onclick="window.confirmStartStoryChapter('${chapter.id}')">${isCleared ? 'Играть снова ⚔️' : 'В бой! ⚔️'}</button>
        </div>
    </div>`;
}

window.confirmStartStoryChapter = function (chapterId) {
    const chapters = sortedStoryChapters();
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return;

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
    document.getElementById('story-progress-wrap')?.classList.add('hidden');
    document.getElementById('story-search-input')?.classList.add('hidden');
    body.innerHTML = `<div style="padding:4px 2px 14px;font-weight:800;color:var(--text-primary);">Выбери колоду для боя с «${escapeHtml(chapter.bossName || '')}»</div>` +
        state.myDecks.map(d => `
        <div class="admin-item" onclick="window.pickStoryDeck('${d.id}')" style="cursor:pointer;">
            <div class="admin-item-thumb cover-fallback small" style="background:${colorFor(d.name || '')};">🃏</div>
            <div class="admin-item-info"><div class="admin-item-title">${escapeHtml(d.name || '')}</div></div>
        </div>`).join('') +
        `<button class="btn btn-secondary" style="margin-top:10px;" onclick="window.renderStoryListView()">← Назад к списку</button>`;
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

// Заполняет выпадающий список карточек для награды за прохождение главы
export function populateStoryRewardCardSelect() {
    const sel = document.getElementById('story-reward-card');
    if (!sel) return;

    const prevVal = sel.value;
    const options = (state.cardsData || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(c => `<option value="${c.id}">${escapeHtml(c.name || '')}</option>`).join('');
    sel.innerHTML = '<option value="">Без карточки</option>' + options;

    if ((state.cardsData || []).some(c => c.id === prevVal)) sel.value = prevVal;
}

export function populateStoryAdminSettingsForm() {
    const input = document.getElementById('story-global-bg');
    if (input) input.value = (state.storySettings && state.storySettings.bgImage) || '';
}

window.saveStoryGlobalSettings = function () {
    const bgImage = (document.getElementById('story-global-bg').value || '').trim();
    set(ref(state.db, 'settings/story'), { bgImage }).then(() => {
        tg.showPopup({ title: 'Готово', message: 'Оформление сюжета обновлено', buttons: [{ type: 'ok' }] });
    }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

export function renderAdminStoryList() {
    const el = document.getElementById('admin-story-list');
    if (!el) return;

    const chapters = sortedStoryChapters();
    if (!chapters.length) {
        el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Глав пока нет.</div>';
        return;
    }

    el.innerHTML = chapters.map(c => {
        const branchBits = [];
        if (c.nextChapterOnWin) {
            const t = chapters.find(x => x.id === c.nextChapterOnWin);
            branchBits.push(`победа → «${escapeHtml(t ? t.name : '?')}»`);
        }
        if (c.nextChapterOnLose) {
            const t = chapters.find(x => x.id === c.nextChapterOnLose);
            branchBits.push(`поражение → «${escapeHtml(t ? t.name : '?')}»`);
        }
        const ending = isEndingChapter(chapters, c);
        return `
        <div class="admin-item">
            ${c.bossAvatar ? `<img src="${c.bossAvatar}" class="admin-item-thumb" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(c.bossName || '')};">${initialOf(c.bossName || '?')}</div>`}
            <div class="admin-item-info">
                <div class="admin-item-title">#${c.order ?? 0} · ${escapeHtml(c.name || 'Глава')}${ending ? ' · 🏁' : ''}</div>
                <div class="admin-item-sub">Босс: ${escapeHtml(c.bossName || '—')} · Карт в колоде: ${Object.values(c.bossDeck || {}).reduce((s, n) => s + n, 0)} · 🔁 ${c.replayCoins || 0}🪙 за повтор${c.phase2Threshold ? ` · ⚡ Фаза 2 при ${c.phase2Threshold}% HP` : ''}${branchBits.length ? ' · 🔀 ' + branchBits.join(', ') : ''}</div>
            </div>
            <div class="admin-item-actions">
                <button class="icon-btn" onclick="window.editStoryChapter('${c.id}')">✏️</button>
                <button class="icon-btn danger" onclick="window.deleteStoryChapter('${c.id}')">🗑</button>
            </div>
        </div>`;
    }).join('');
}

// Заполняет выпадающие списки веток ("глава при победе/поражении") всеми главами,
// кроме той, что сейчас редактируется (чтобы не создавать ветку главы саму на себя).
export function populateStoryBranchSelects(excludeId) {
    const chapters = sortedStoryChapters().filter(c => c.id !== excludeId);
    const optionsHtml = chapters.map(c => `<option value="${c.id}">${escapeHtml(c.name || 'Глава')}</option>`).join('');
    const winSel = document.getElementById('story-next-on-win');
    const loseSel = document.getElementById('story-next-on-lose');
    if (winSel) winSel.innerHTML = '<option value="">По умолчанию — следующая по порядку</option>' + optionsHtml;
    if (loseSel) loseSel.innerHTML = '<option value="">Обычное поражение — можно попробовать снова</option>' + optionsHtml;
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
    document.getElementById('story-chapter-description').value = c.description || '';
    document.getElementById('story-dialogue-intro').value = serializeDialogueLines(c.introDialogue);
    document.getElementById('story-dialogue-during').value = serializeDuringDialogue(c.duringDialogue);
    document.getElementById('story-dialogue-hp').value = serializeDuringDialogue(c.hpDialogue);
    document.getElementById('story-phase2-threshold').value = c.phase2Threshold || 0;
    document.getElementById('story-phase2-mana-bonus').value = c.phase2ManaBonus || 0;
    document.getElementById('story-dialogue-win').value = serializeDialogueLines(c.winDialogue);
    document.getElementById('story-dialogue-lose').value = serializeDialogueLines(c.loseDialogue);
    document.getElementById('story-reward-coins').value = c.rewardCoins || 0;
    document.getElementById('story-reward-card-count').value = c.rewardCardCount || 1;
    document.getElementById('story-reward-replay-coins').value = c.replayCoins || 0;
    populateStoryRewardCardSelect();
    document.getElementById('story-reward-card').value = c.rewardCardId || '';
    populateStoryBranchSelects(id);
    document.getElementById('story-next-on-win').value = c.nextChapterOnWin || '';
    document.getElementById('story-next-on-lose').value = c.nextChapterOnLose || '';
    document.getElementById('story-lose-reward-coins').value = c.loseRewardCoins || 0;
    document.getElementById('story-ending-name').value = c.endingName || '';
    renderStoryBossDeckPicker();

    document.getElementById('story-chapter-form-heading').textContent = 'Редактировать главу';
    document.getElementById('btn-add-story-chapter').textContent = 'Сохранить';
    document.getElementById('btn-cancel-edit-story-chapter').classList.remove('hidden');
    document.getElementById('story-chapter-name').scrollIntoView({ behavior: 'smooth' });
};

window.cancelEditStoryChapter = function () {
    state.editingStoryChapterId = null;
    state.storyBossDeckDraft = {};

    ['story-chapter-name', 'story-boss-name', 'story-boss-image', 'story-chapter-description', 'story-dialogue-intro', 'story-dialogue-during', 'story-dialogue-hp', 'story-dialogue-win', 'story-dialogue-lose', 'story-ending-name'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('story-chapter-order').value = '';
    document.getElementById('story-reward-coins').value = '';
    document.getElementById('story-reward-card-count').value = 1;
    document.getElementById('story-reward-replay-coins').value = 0;
    document.getElementById('story-phase2-threshold').value = 0;
    document.getElementById('story-phase2-mana-bonus').value = 0;
    document.getElementById('story-lose-reward-coins').value = 0;
    const sel = document.getElementById('story-reward-card');
    if (sel) sel.value = '';
    populateStoryBranchSelects(null);
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
    const description = document.getElementById('story-chapter-description').value.trim();
    const rewardCoins = parseInt(document.getElementById('story-reward-coins').value, 10) || 0;
    const rewardCardId = document.getElementById('story-reward-card').value || null;
    const rewardCardCount = parseInt(document.getElementById('story-reward-card-count').value, 10) || 1;
    const replayCoins = parseInt(document.getElementById('story-reward-replay-coins').value, 10) || 0;
    const phase2Threshold = Math.min(99, Math.max(0, parseInt(document.getElementById('story-phase2-threshold').value, 10) || 0));
    const phase2ManaBonus = parseInt(document.getElementById('story-phase2-mana-bonus').value, 10) || 0;
    const nextChapterOnWin = document.getElementById('story-next-on-win').value || null;
    const nextChapterOnLose = document.getElementById('story-next-on-lose').value || null;
    const loseRewardCoins = parseInt(document.getElementById('story-lose-reward-coins').value, 10) || 0;
    const endingName = document.getElementById('story-ending-name').value.trim();

    if (!name) return tg.showAlert('Укажи название главы');
    if (!bossName) return tg.showAlert('Укажи имя соперника');

    const bossDeck = state.storyBossDeckDraft || {};
    if (!Object.keys(bossDeck).length) return tg.showAlert('Собери колоду соперника — выбери хотя бы одну карту');

    const data = {
        name, order, bossName, bossAvatar, description, bossDeck,
        introDialogue: parseDialogueLines(document.getElementById('story-dialogue-intro').value),
        duringDialogue: parseDuringDialogueLines(document.getElementById('story-dialogue-during').value),
        winDialogue: parseDialogueLines(document.getElementById('story-dialogue-win').value),
        loseDialogue: parseDialogueLines(document.getElementById('story-dialogue-lose').value),
        hpDialogue: parseDuringDialogueLines(document.getElementById('story-dialogue-hp').value),
        rewardCoins, rewardCardId, rewardCardCount, replayCoins, phase2Threshold, phase2ManaBonus,
        nextChapterOnWin, nextChapterOnLose, loseRewardCoins, endingName,
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
