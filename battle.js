import { ref, onValue, off, update, remove, set, get, push, increment } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { escapeHtml, colorFor, initialOf, cardFrameStyle } from './utils.js';

const BOT_NAMES = ['Артём', 'Максим', 'Соня', 'Данил', 'Егор', 'Полина', 'Тимур', 'Вика'];

function randId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function expandDeck(cards) {
    // cards: { cardId: count } -> flat array of cardIds
    const pile = [];
    Object.entries(cards || {}).forEach(([cardId, count]) => {
        for (let i = 0; i < count; i++) pile.push(cardId);
    });
    return shuffle(pile);
}

function buildRandomBotDeck() {
    const { deckSize, maxCopies } = state.deckSettings;
    const pool = state.cardsData;
    const cards = {};
    let total = 0;
    let guard = 0;
    while (total < deckSize && pool.length && guard < deckSize * 20) {
        guard++;
        const card = pool[Math.floor(Math.random() * pool.length)];
        const current = cards[card.id] || 0;
        if (current >= maxCopies) continue;
        cards[card.id] = current + 1;
        total++;
    }
    return cards;
}

function initPlayerState(uid, name, isBot, deckCards) {
    const pile = expandDeck(deckCards);
    const hand = {};
    for (let i = 0; i < 3; i++) {
        const cardId = pile.shift();
        if (cardId) hand[randId()] = cardId;
    }
    return {
        uid, name, isBot: !!isBot,
        heroHealth: 30, maxHealth: 30,
        mana: 1, maxMana: 1,
        deck: pile,
        hand, board: {},
        fatigue: 0,
        firedCombos: {},
    };
}

function cardById(id) {
    return state.cardsData.find(c => c.id === id);
}

// Firebase Realtime Database не хранит пустые объекты ({}) — если стол/рука/комбо
// становятся пустыми, при следующем чтении это поле пропадает (undefined) вместо {}.
// Без этой нормализации попытка actor.board[id] = ... падает с ошибкой и запись в базу не происходит.
function normalizePlayerState(p) {
    if (!p) return p;
    p.hand = p.hand || {};
    p.board = p.board || {};
    p.firedCombos = p.firedCombos || {};
    return p;
}

function drawCards(player, n, log) {
    for (let i = 0; i < n; i++) {
        if (player.deck && player.deck.length) {
            const cardId = player.deck.shift();
            player.hand[randId()] = cardId;
        } else {
            player.fatigue = (player.fatigue || 0) + 1;
            player.heroHealth -= player.fatigue;
            log.push(`${player.name} получает ${player.fatigue} урона от истощения колоды`);
        }
    }
}

// actor — тот, кто получает бонус эффекта; opponent — противник (для урона по герою)
function applyEffect(actor, opponent, effectType, value, log) {
    if (!effectType || !value) return;
    switch (effectType) {
        case 'battlecry_damage':
        case 'deathrattle_damage':
            opponent.heroHealth -= value;
            log.push(`${actor.name}: эффект наносит ${value} урона герою соперника`);
            break;
        case 'battlecry_heal':
            actor.heroHealth = Math.min(actor.maxHealth, actor.heroHealth + value);
            log.push(`${actor.name}: эффект лечит на ${value}`);
            break;
        case 'battlecry_draw':
        case 'deathrattle_draw':
            drawCards(actor, value, log);
            log.push(`${actor.name}: эффект добирает ${value} карт(ы)`);
            break;
        case 'buff_attack_random': {
            const minions = Object.values(actor.board || {});
            if (minions.length) {
                const m = minions[Math.floor(Math.random() * minions.length)];
                m.attack += value;
                log.push(`${actor.name}: эффект даёт «${m.name}» +${value} атаки`);
            }
            break;
        }
    }
}

// проверяет и запускает комбо-бонусы для игрока actor после того, как на его столе появилась новая карта
function checkCombos(actor, opponent, log) {
    const ownedCardIds = new Set(Object.values(actor.board || {}).map(m => m.cardId));
    actor.firedCombos = actor.firedCombos || {};
    state.cardCombosData.forEach(combo => {
        if (actor.firedCombos[combo.id]) return;
        const ids = combo.cardIds || [];
        if (ids.length < 2) return;
        const allPresent = ids.every(id => ownedCardIds.has(id));
        if (!allPresent) return;
        actor.firedCombos[combo.id] = true;
        log.push(`✨ Комбо «${combo.name}» активировано!`);
        if (combo.effectType) applyEffect(actor, opponent, combo.effectType, combo.effectValue, log);
    });
}

function hasTaunt(boardObj) {
    return Object.values(boardObj || {}).some(m => m.taunt);
}

function makeBoardEntry(card) {
    return {
        cardId: card.id, name: card.name, image: card.image || '',
        attack: card.attack || 0, health: card.health || 1, maxHealth: card.health || 1,
        canAttack: false, taunt: !!card.taunt,
        deathrattleType: card.effectType && card.effectType.startsWith('deathrattle_') ? card.effectType : null,
        deathrattleValue: card.effectValue || 0,
    };
}

// ===================== МАТЧМЕЙКИНГ =====================

let queueListenerRef = null;
let assignmentListenerRef = null;

export function startMatchmaking() {
    if (state.myDecks.length === 1) {
        beginQueue(state.myDecks[0].id);
    } else {
        showDeckPickerForBattle();
    }
}

function showDeckPickerForBattle() {
    state.activeOverlay = 'battle';
    document.getElementById('battle-overlay').classList.add('active');
    document.getElementById('battle-header-title').textContent = 'Выбери колоду';
    const body = document.getElementById('battle-body');
    body.innerHTML = state.myDecks.map(d => `
        <div class="admin-item" onclick="pickBattleDeck('${d.id}')" style="cursor:pointer;margin:10px 12px 0;">
            <div class="admin-item-thumb cover-fallback small" style="background:${colorFor(d.name || '')};">🃏</div>
            <div class="admin-item-info"><div class="admin-item-title">${escapeHtml(d.name || '')}</div></div>
        </div>`).join('');
}

window.pickBattleDeck = function (deckId) {
    beginQueue(deckId);
};

function beginQueue(deckId) {
    state.activeOverlay = 'battle';
    document.getElementById('battle-overlay').classList.add('active');
    document.getElementById('battle-header-title').textContent = 'Поиск игры';
    document.getElementById('battle-body').innerHTML = `
        <div class="empty-state">
            <span class="icon">⚔️</span>
            <div class="title">Ищем соперника...</div>
            <div class="sub">Если за 5 секунд никого не найдём — бой с ботом</div>
        </div>`;

    state.inQueue = true;
    const myUid = state.currentUser.id;

    set(ref(state.db, 'matchmakingQueue/' + myUid), { name: state.currentUser.name || 'Игрок', deckId, ts: Date.now() });

    assignmentListenerRef = ref(state.db, 'battleAssignment/' + myUid);
    onValue(assignmentListenerRef, (snap) => {
        const data = snap.val();
        if (data && data.battleId && state.inQueue) {
            remove(ref(state.db, 'battleAssignment/' + myUid)).catch(() => {});
            finishQueueing();
            enterBattle(data.battleId);
        }
    });

    queueListenerRef = ref(state.db, 'matchmakingQueue');
    onValue(queueListenerRef, (snap) => {
        if (!state.inQueue) return;
        const all = snap.val() || {};
        const others = Object.entries(all).filter(([uid]) => uid !== myUid);
        if (!others.length) return;

        const [oppUid, oppInfo] = others[0];
        const STALE_MS = 12000;
        if (Date.now() - (oppInfo.ts || 0) > STALE_MS) {
            // "призрак" от прерванной сессии — не матчимся, а подчищаем
            remove(ref(state.db, 'matchmakingQueue/' + oppUid)).catch(() => {});
            return;
        }
        if (myUid < oppUid) {
            // мы отвечаем за создание боя
            finishQueueing();
            remove(ref(state.db, 'matchmakingQueue/' + myUid)).catch(() => {});
            remove(ref(state.db, 'matchmakingQueue/' + oppUid)).catch(() => {});
            createBattle(
                { uid: myUid, name: state.currentUser.name || 'Игрок', deckId },
                { uid: oppUid, name: oppInfo.name || 'Игрок', deckId: oppInfo.deckId },
                false
            ).then(battleId => {
                set(ref(state.db, 'battleAssignment/' + oppUid), { battleId });
                enterBattle(battleId);
            });
        }
        // если наш uid больше — просто ждём, нас заберёт другой клиент
    });

    state.matchmakingTimer = setTimeout(() => {
        if (!state.inQueue) return;
        finishQueueing();
        remove(ref(state.db, 'matchmakingQueue/' + myUid)).catch(() => {});
        startBotBattle(deckId);
    }, 5000);
}

function finishQueueing() {
    state.inQueue = false;
    clearTimeout(state.matchmakingTimer);
    if (queueListenerRef) { off(queueListenerRef); queueListenerRef = null; }
    if (assignmentListenerRef) { off(assignmentListenerRef); assignmentListenerRef = null; }
}

function startBotBattle(deckId) {
    const myUid = state.currentUser.id;
    const botUid = 'BOT_' + randId();
    const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    createBattle(
        { uid: myUid, name: state.currentUser.name || 'Игрок', deckId },
        { uid: botUid, name: botName, deckId: null, isBot: true },
        true
    ).then(battleId => enterBattle(battleId));
}

export function cancelMatchmaking() {
    if (!state.inQueue) return;
    finishQueueing();
    remove(ref(state.db, 'matchmakingQueue/' + state.currentUser.id)).catch(() => {});
}

// подчищаем очередь, если страница закрывается/сворачивается прямо во время поиска
window.addEventListener('beforeunload', () => {
    if (state.inQueue && state.currentUser && state.currentUser.id) {
        remove(ref(state.db, 'matchmakingQueue/' + state.currentUser.id)).catch(() => {});
    }
});
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.inQueue && state.currentUser && state.currentUser.id) {
        remove(ref(state.db, 'matchmakingQueue/' + state.currentUser.id)).catch(() => {});
    }
});

// ===================== СОЗДАНИЕ БОЯ =====================

function createBattle(p1info, p2info, isBot) {
    const p1Deck = (state.myDecks.find(d => d.id === p1info.deckId) || {}).cards || {};

    const p2DeckPromise = isBot
        ? Promise.resolve(buildRandomBotDeck())
        : get(ref(state.db, 'users/' + p2info.uid + '/decks/' + p2info.deckId))
            .then(snap => (snap.val() || {}).cards || {})
            .catch(() => ({}));

    return p2DeckPromise.then(p2Deck => {
        const goesFirst = Math.random() < 0.5 ? 'p1' : 'p2';

        const battle = {
            status: 'active',
            createdAt: Date.now(),
            turnPlayer: goesFirst,
            turnNumber: 1,
            isBot: !!isBot,
            winner: null,
            p1: initPlayerState(p1info.uid, p1info.name, false, p1Deck),
            p2: initPlayerState(p2info.uid, p2info.name, !!isBot, p2Deck),
            log: { [randId()]: { t: Date.now(), text: 'Бой начался!' } },
        };

        const battleRef = push(ref(state.db, 'battles'));
        return set(battleRef, battle).then(() => battleRef.key);
    });
}

// ===================== ВХОД В БОЙ / СИНХРОНИЗАЦИЯ =====================

let battleRefListener = null;
let activeBotRunKey = null;

function enterBattle(battleId) {
    state.activeBattleId = battleId;
    state.selectedAttackerIid = null;
    prevHealth = { mine: null, opp: null };
    activeBotRunKey = null;
    document.getElementById('battle-header-title').textContent = 'Бой';

    if (battleRefListener) off(battleRefListener);
    battleRefListener = ref(state.db, 'battles/' + battleId);
    onValue(battleRefListener, (snap) => {
        const data = snap.val();
        if (!data) return;
        state.battleData = data;
        state.mySlot = data.p1.uid === state.currentUser.id ? 'p1' : 'p2';

        renderBattleView();

        const oppSlot = state.mySlot === 'p1' ? 'p2' : 'p1';
        if (data.status === 'active' && data.turnPlayer === oppSlot && data[oppSlot].isBot) {
            // защита от повторного запуска: ход бота стартует один раз на turnNumber,
            // а не при каждом изменении данных (иначе несколько параллельных запусков мешают друг другу)
            const runKey = battleId + ':' + data.turnNumber + ':' + oppSlot;
            if (activeBotRunKey !== runKey) {
                activeBotRunKey = runKey;
                runBotTurn(battleId).catch((err) => {
                    console.error('Ошибка хода бота, завершаю ход принудительно:', err);
                    const fresh = state.battleData;
                    if (fresh && fresh.status === 'active' && fresh.turnPlayer === oppSlot) {
                        endTurn(battleId, fresh, oppSlot);
                    }
                });
            }
        }
        watchOpponentInactivity(battleId, data, state.mySlot, oppSlot);
    });
}

window.surrenderBattle = function () {
    const data = state.battleData;
    if (!data || data.status !== 'active') return;
    if (!confirm('Точно сдаться?')) return;
    const mySlot = state.mySlot;
    const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
    update(ref(state.db), {
        ['battles/' + state.activeBattleId + '/status']: 'finished',
        ['battles/' + state.activeBattleId + '/winner']: oppSlot,
        ['battles/' + state.activeBattleId + '/log/' + randId()]: { t: Date.now(), text: `${data[mySlot].name} сдался` },
    });
};

const INACTIVITY_TIMEOUT_MS = 90000;
let inactivityTimer = null;

function watchOpponentInactivity(battleId, data, mySlot, oppSlot) {
    clearTimeout(inactivityTimer);
    if (data.status !== 'active' || data.turnPlayer !== oppSlot || data[oppSlot].isBot) return;

    const lastAction = data.lastActionAt || data.createdAt || Date.now();
    const elapsed = Date.now() - lastAction;
    const remaining = INACTIVITY_TIMEOUT_MS - elapsed;

    if (remaining <= 0) {
        update(ref(state.db), {
            ['battles/' + battleId + '/status']: 'finished',
            ['battles/' + battleId + '/winner']: mySlot,
            ['battles/' + battleId + '/log/' + randId()]: { t: Date.now(), text: `${data[oppSlot].name} не отвечает — засчитано поражение` },
        });
        return;
    }

    inactivityTimer = setTimeout(() => {
        const fresh = state.battleData;
        if (fresh && fresh.status === 'active' && fresh.turnPlayer === oppSlot) {
            watchOpponentInactivity(battleId, fresh, mySlot, oppSlot);
        }
    }, remaining + 500);
}

window.leaveBattle = function () {
    cancelMatchmaking();
    clearTimeout(inactivityTimer);
    if (battleRefListener) { off(battleRefListener); battleRefListener = null; }
    state.activeBattleId = null;
    state.battleData = null;
    document.getElementById('battle-overlay').classList.remove('active');
    state.activeOverlay = 'cardGameMenu';
    document.getElementById('card-game-menu-overlay').classList.add('active');
};

// ===================== РЕНДЕР =====================

function renderMinion(iid, m, isMine, canSelect) {
    const selected = state.selectedAttackerIid === iid;
    const displayName = m.name || 'Существо';
    return `
    <div class="battle-minion ${canSelect ? 'can-attack' : ''} ${selected ? 'selected' : ''}"
         onclick="${isMine ? `battleMinionTap('${iid}')` : `battleAttackTarget('${iid}')`}">
        <div class="bm-portrait">
            ${m.taunt ? '<div class="battle-taunt-badge">🛡️</div>' : ''}
            <div class="battle-minion-fallback" style="background:${colorFor(displayName)}">${initialOf(displayName)}</div>
            ${m.image ? `<img src="${m.image}" style="position:absolute;top:0;left:0;" onerror="this.remove()">` : ''}
        </div>
        <div class="bm-badges">
            <div class="bm-atk">⚔${m.attack}</div>
            <div class="bm-hp">❤${m.health}</div>
        </div>
        <div class="battle-minion-name">${escapeHtml(displayName)}</div>
    </div>`;
}

function renderHandCard(iid, cardId, playable) {
    const card = cardById(cardId);
    if (!card) return '';
    const isMinion = card.type === 'minion';
    const displayName = card.name || 'Карта';
    return `
    <div class="battle-hand-card ${playable ? 'playable' : 'unplayable'}" onclick="battlePlayCard('${iid}')">
        <div class="bhc-portrait" style="${cardFrameStyle(card.rarity)}">
            <div class="battle-minion-fallback" style="background:${colorFor(displayName)}">${initialOf(displayName)}</div>
            ${card.image ? `<img src="${card.image}" style="position:absolute;top:0;left:0;" onerror="this.remove()">` : ''}
            <div class="bhc-name">${escapeHtml(displayName)}</div>
        </div>
        <div class="battle-hand-mana">${card.mana || 0}</div>
        ${isMinion
            ? `<div class="bhc-atk">${card.attack || 0}</div><div class="bhc-hp">${card.health || 0}</div>`
            : `<div class="bhc-spell-tag">✨ Закл.</div>`}
    </div>`;
}

let prevHealth = { mine: null, opp: null };

function renderBattleView() {
    const body = document.getElementById('battle-body');
    const data = state.battleData;
    if (!body || !data) return;

    const mySlot = state.mySlot;
    const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
    const me = data[mySlot];
    const opp = data[oppSlot];
    const myTurn = data.status === 'active' && data.turnPlayer === mySlot;

    if (data.status === 'finished') {
        const iWon = data.winner === mySlot;
        body.innerHTML = `
            <div class="empty-state" style="padding-top:60px;">
                <span class="icon">${iWon ? '🏆' : '💀'}</span>
                <div class="title">${iWon ? 'Победа!' : 'Поражение'}</div>
                <div class="sub">${iWon ? 'Ты получил 20 🪙 за победу' : 'В следующий раз повезёт'}</div>
                <button class="btn" onclick="leaveBattle()" style="margin-top:16px;">Выйти</button>
            </div>`;
        return;
    }

    const oppHandCount = Object.keys(opp.hand || {}).length;
    const oppBoardHtml = Object.entries(opp.board || {}).map(([iid, m]) => renderMinion(iid, m, false, myTurn)).join('')
        || '<div class="battle-empty-zone">Стол соперника пуст</div>';
    const myBoardHtml = Object.entries(me.board || {}).map(([iid, m]) => renderMinion(iid, m, true, myTurn && m.canAttack)).join('')
        || '<div class="battle-empty-zone">Твой стол пуст</div>';
    const myHandHtml = Object.entries(me.hand || {}).map(([iid, cardId]) => {
        const card = cardById(cardId);
        const playable = myTurn && card && card.mana <= me.mana;
        return renderHandCard(iid, cardId, playable);
    }).join('') || '<div class="battle-empty-zone">Рука пуста</div>';

    const showHint = !state.battleHintShown;
    state.battleHintShown = true;
    const hintHtml = showHint ? `<div class="battle-hint">Тапни карту в руке, чтобы разыграть · тапни своё существо, потом цель, чтобы атаковать</div>` : '';

    body.innerHTML = `
    <div class="battle-arena">
        <div class="battle-player-row opp">
            <div class="battle-hero" id="battle-hero-opp" onclick="${myTurn ? `battleAttackTarget('hero')` : ''}">
                <div class="battle-hero-name">${escapeHtml(opp.name || 'Соперник')} ${opp.isBot ? '🤖' : ''}</div>
                <div class="battle-hero-stats">❤️${opp.heroHealth} · 💧${opp.mana}/${opp.maxMana}</div>
            </div>
            <div class="battle-hand-back">${'🂠'.repeat(Math.min(oppHandCount, 8))}</div>
        </div>
        ${hintHtml}
        <div class="battle-zone-label">🛡 Стол соперника</div>
        <div class="battle-board opp-board">${oppBoardHtml}</div>
        <div class="battle-turn-indicator">${myTurn ? '⚡ Твой ход' : `⏳ Ход соперника`} · раунд ${data.turnNumber}</div>
        <div class="battle-zone-label">🛡 Твой стол</div>
        <div class="battle-board my-board">${myBoardHtml}</div>
        <div class="battle-zone-label">🎴 Рука</div>
        <div class="battle-hand">${myHandHtml}</div>
        <div class="battle-player-row mine">
            <div class="battle-hero" id="battle-hero-mine">
                <div class="battle-hero-name">Ты</div>
                <div class="battle-hero-stats">❤️${me.heroHealth} · 💧${me.mana}/${me.maxMana}</div>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary" onclick="surrenderBattle()" style="padding:10px 14px;">Сдаться</button>
                <button class="btn ${myTurn ? 'battle-pulse' : ''}" id="battle-end-turn-btn" onclick="battleEndTurn()" ${myTurn ? '' : 'disabled style="opacity:.4;"'}>Закончить ход</button>
            </div>
        </div>
    </div>`;

    if (prevHealth.opp !== null && opp.heroHealth < prevHealth.opp) showDamagePopup('battle-hero-opp', prevHealth.opp - opp.heroHealth);
    if (prevHealth.mine !== null && me.heroHealth < prevHealth.mine) showDamagePopup('battle-hero-mine', prevHealth.mine - me.heroHealth);
    prevHealth = { mine: me.heroHealth, opp: opp.heroHealth };
}

function showDamagePopup(elId, amount) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.add('hero-hit');
    const num = document.createElement('div');
    num.className = 'battle-dmg-popup';
    num.textContent = '-' + amount;
    el.appendChild(num);
    setTimeout(() => num.remove(), 900);
    setTimeout(() => el.classList.remove('hero-hit'), 400);
}

// ===================== ДЕЙСТВИЯ ИГРОКА =====================

window.battleMinionTap = function (iid) {
    const data = state.battleData;
    if (data.turnPlayer !== state.mySlot) { tg.showAlert('Сейчас не твой ход'); return; }
    const me = data[state.mySlot];
    const minion = (me.board || {})[iid];
    if (!minion) return;
    if (!minion.canAttack) { tg.showAlert('Это существо уже атаковало в этом ходу или ещё не может атаковать'); return; }
    state.selectedAttackerIid = state.selectedAttackerIid === iid ? null : iid;
    renderBattleView();
};

window.battlePlayCard = function (iid) {
    const data = state.battleData;
    if (data.turnPlayer !== state.mySlot) { tg.showAlert('Сейчас не твой ход'); return; }
    const mySlot = state.mySlot;
    const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
    const me = data[mySlot];
    const cardId = (me.hand || {})[iid];
    const card = cardById(cardId);
    if (!card) { tg.showAlert('Эта карта больше не существует в игре (удалена из админки)'); return; }
    if (card.mana > me.mana) { tg.showAlert(`Не хватает маны: нужно 💧${card.mana}, у тебя 💧${me.mana}`); return; }

    playCardInternal(state.activeBattleId, data, mySlot, oppSlot, iid, card);
};

function playCardInternal(battleId, data, actorSlot, opponentSlot, iid, card) {
    const actor = normalizePlayerState(JSON.parse(JSON.stringify(data[actorSlot])));
    const opponent = normalizePlayerState(JSON.parse(JSON.stringify(data[opponentSlot])));
    const log = [`${actor.name} играет «${card.name}»`];

    actor.mana -= card.mana;
    delete actor.hand[iid];

    if (card.type === 'minion') {
        const newIid = randId();
        actor.board[newIid] = makeBoardEntry(card);
    }

    if (card.effectType && card.effectType.startsWith('battlecry_')) {
        applyEffect(actor, opponent, card.effectType, card.effectValue, log);
    }
    checkCombos(actor, opponent, log);

    const updates = {};
    updates['battles/' + battleId + '/' + actorSlot] = actor;
    updates['battles/' + battleId + '/' + opponentSlot] = opponent;
    updates['battles/' + battleId + '/log/' + randId()] = { t: Date.now(), text: log.join('; ') };
    updates['battles/' + battleId + '/lastActionAt'] = Date.now();

    if (opponent.heroHealth <= 0) {
        updates['battles/' + battleId + '/status'] = 'finished';
        updates['battles/' + battleId + '/winner'] = actorSlot;
        if (!data[actorSlot].isBot) update(ref(state.db, 'users/' + actor.uid), { coins: increment(20) }).catch(() => {});
    } else if (actor.heroHealth <= 0) {
        updates['battles/' + battleId + '/status'] = 'finished';
        updates['battles/' + battleId + '/winner'] = opponentSlot;
    }

    update(ref(state.db), updates).catch(e => tg.showAlert('Ошибка сохранения хода: ' + (e && e.message ? e.message : e)));
}

window.battleAttackTarget = function (targetIid) {
    const data = state.battleData;
    if (data.turnPlayer !== state.mySlot || !state.selectedAttackerIid) return;

    const mySlot = state.mySlot;
    const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
    const me = data[mySlot];
    const opp = data[oppSlot];
    const attacker = (me.board || {})[state.selectedAttackerIid];
    if (!attacker || !attacker.canAttack) return;

    if (hasTaunt(opp.board)) {
        const targetIsTaunt = targetIid !== 'hero' && (opp.board || {})[targetIid] && (opp.board || {})[targetIid].taunt;
        if (!targetIsTaunt) { tg.showAlert ? tg.showAlert('Сначала нужно атаковать существо с провокацией') : alert('Сначала нужно атаковать существо с провокацией'); return; }
    }

    resolveAttack(state.activeBattleId, data, mySlot, oppSlot, state.selectedAttackerIid, targetIid);
    state.selectedAttackerIid = null;
};

function resolveAttack(battleId, data, mySlot, oppSlot, attackerIid, targetIid) {
    const me = normalizePlayerState(JSON.parse(JSON.stringify(data[mySlot])));
    const opp = normalizePlayerState(JSON.parse(JSON.stringify(data[oppSlot])));
    const attacker = me.board[attackerIid];
    if (!attacker) return;

    const log = [];

    if (targetIid === 'hero') {
        opp.heroHealth -= attacker.attack;
        log.push(`${me.name}: «${attacker.name}» бьёт героя на ${attacker.attack}`);
    } else {
        const target = opp.board[targetIid];
        if (!target) return;
        target.health -= attacker.attack;
        attacker.health -= target.attack;
        log.push(`${me.name}: «${attacker.name}» атакует «${target.name}»`);
        if (target.health <= 0) {
            delete opp.board[targetIid];
            log.push(`«${target.name}» погибает`);
            if (target.deathrattleType) applyEffect(opp, me, target.deathrattleType, target.deathrattleValue, log);
        }
    }
    attacker.canAttack = false;
    if (attacker.health <= 0) {
        delete me.board[attackerIid];
        log.push(`«${attacker.name}» погибает`);
        if (attacker.deathrattleType) applyEffect(me, opp, attacker.deathrattleType, attacker.deathrattleValue, log);
    }

    const updates = {};
    updates['battles/' + battleId + '/' + mySlot] = me;
    updates['battles/' + battleId + '/' + oppSlot] = opp;
    updates['battles/' + battleId + '/log/' + randId()] = { t: Date.now(), text: log.join('; ') };
    updates['battles/' + battleId + '/lastActionAt'] = Date.now();

    if (opp.heroHealth <= 0) {
        updates['battles/' + battleId + '/status'] = 'finished';
        updates['battles/' + battleId + '/winner'] = mySlot;
        if (!data[mySlot].isBot) update(ref(state.db, 'users/' + me.uid), { coins: increment(20) }).catch(() => {});
    } else if (me.heroHealth <= 0) {
        updates['battles/' + battleId + '/status'] = 'finished';
        updates['battles/' + battleId + '/winner'] = oppSlot;
    }

    update(ref(state.db), updates);
}

window.battleEndTurn = function () {
    const data = state.battleData;
    if (!data || data.turnPlayer !== state.mySlot || data.status !== 'active') return;
    endTurn(state.activeBattleId, data, state.mySlot);
};

function endTurn(battleId, data, currentSlot) {
    const nextSlot = currentSlot === 'p1' ? 'p2' : 'p1';
    const nextPlayer = normalizePlayerState(JSON.parse(JSON.stringify(data[nextSlot])));

    nextPlayer.maxMana = Math.min((nextPlayer.maxMana || 1) + 1, 10);
    nextPlayer.mana = nextPlayer.maxMana;

    if (nextPlayer.deck && nextPlayer.deck.length) {
        const cardId = nextPlayer.deck.shift();
        nextPlayer.hand[randId()] = cardId;
    } else {
        nextPlayer.fatigue = (nextPlayer.fatigue || 0) + 1;
        nextPlayer.heroHealth -= nextPlayer.fatigue;
    }

    Object.values(nextPlayer.board || {}).forEach(m => { m.canAttack = true; });

    const updates = {};
    updates['battles/' + battleId + '/' + nextSlot] = nextPlayer;
    updates['battles/' + battleId + '/turnPlayer'] = nextSlot;
    updates['battles/' + battleId + '/turnNumber'] = (data.turnNumber || 1) + 1;
    updates['battles/' + battleId + '/log/' + randId()] = { t: Date.now(), text: `Ход переходит к ${nextPlayer.name}` };
    updates['battles/' + battleId + '/lastActionAt'] = Date.now();

    if (nextPlayer.heroHealth <= 0) {
        updates['battles/' + battleId + '/status'] = 'finished';
        updates['battles/' + battleId + '/winner'] = currentSlot;
        if (!data[currentSlot].isBot) update(ref(state.db, 'users/' + data[currentSlot].uid), { coins: increment(20) }).catch(() => {});
    }

    update(ref(state.db), updates);
}

// ===================== БОТ (человекоподобный ИИ) =====================

const rand = (min, max) => min + Math.random() * (max - min);
const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function runBotTurn(battleId) {
    await delay(rand(700, 1800));

    let data = state.battleData;
    if (!data || data.status !== 'active') return;
    const botSlot = data.turnPlayer;
    const oppSlot = botSlot === 'p1' ? 'p2' : 'p1';
    if (!data[botSlot].isBot) return;

    // фаза розыгрыша карт — не всегда тратит всю ману до конца, иногда "придерживает" карту
    let guard = 0;
    while (guard < 10) {
        guard++;
        data = state.battleData;
        if (!data || data.status !== 'active' || data.turnPlayer !== botSlot) return;
        const bot = data[botSlot];
        const affordable = Object.entries(bot.hand || {})
            .map(([iid, cardId]) => ({ iid, card: cardById(cardId) }))
            .filter(x => x.card && x.card.mana <= bot.mana);
        if (!affordable.length) break;
        if (Math.random() < 0.22) break; // человеческая непоследовательность — иногда не доигрывает руку

        const pick = affordable[Math.floor(Math.random() * affordable.length)];
        await delay(rand(500, 1300));
        data = state.battleData;
        if (!data || data.turnPlayer !== botSlot) return;
        playCardInternal(battleId, data, botSlot, oppSlot, pick.iid, pick.card);
        await delay(rand(200, 500));
    }

    await delay(rand(500, 1200));

    // фаза атаки
    data = state.battleData;
    if (!data || data.status !== 'active' || data.turnPlayer !== botSlot) return;
    const attackers = Object.entries(data[botSlot].board || {}).filter(([, m]) => m.canAttack);
    for (const [iid] of attackers) {
        data = state.battleData;
        if (!data || data.status !== 'active' || data.turnPlayer !== botSlot) return;
        const bot = data[botSlot];
        const attacker = (bot.board || {})[iid];
        if (!attacker || !attacker.canAttack) continue;
        if (Math.random() < 0.15) continue; // иногда не атакует — держит блокера

        const opp = data[oppSlot];
        const oppMinions = Object.entries(opp.board || {});
        const tauntMinions = oppMinions.filter(([, m]) => m.taunt);
        const targetPool = tauntMinions.length ? tauntMinions : oppMinions;
        let targetIid = 'hero';
        if (tauntMinions.length) {
            targetIid = tauntMinions[Math.floor(Math.random() * tauntMinions.length)][0];
        } else if (targetPool.length && Math.random() < 0.6) {
            targetIid = targetPool[Math.floor(Math.random() * targetPool.length)][0];
        }

        await delay(rand(500, 1100));
        data = state.battleData;
        if (!data || data.turnPlayer !== botSlot) return;
        resolveAttack(battleId, data, botSlot, oppSlot, iid, targetIid);
    }

    await delay(rand(400, 900));
    data = state.battleData;
    if (!data || data.status !== 'active' || data.turnPlayer !== botSlot) return;
    endTurn(battleId, data, botSlot);
}
