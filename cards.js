import { ref, push, update, remove, get } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { escapeHtml, colorFor, initialOf, friendlyDbError } from './utils.js';

const RARITY_LABELS = { common: 'Обычная', rare: 'Редкая', epic: 'Эпическая', legendary: 'Легендарная' };
const RARITY_COLORS = { common: '#9e9e9e', rare: '#0a84ff', epic: '#bf5af2', legendary: '#ff9f0a' };

function rarityBadge(rarity) {
    const label = RARITY_LABELS[rarity] || 'Обычная';
    const color = RARITY_COLORS[rarity] || RARITY_COLORS.common;
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:800;color:#fff;background:${color};">${label}</span>`;
}

// ===================== КАРТОЧКИ =====================

export function renderAdminCardsList() {
    const el = document.getElementById('admin-cards-list');
    if (!el) return;

    if (!state.cardsData.length) {
        el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Карточек пока нет</div>';
    } else {
        const sorted = state.cardsData.slice().sort((a, b) => (a.mana || 0) - (b.mana || 0));
        el.innerHTML = sorted.map(c => {
            const cls = state.heroClassesData.find(x => x.id === c.classId);
            const classTag = cls
                ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:800;color:#fff;background:${cls.color || '#0a84ff'};">${cls.icon || ''} ${escapeHtml(cls.name || '')}</span>`
                : `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:800;color:var(--text-secondary);background:rgba(127,127,127,.2);">Нейтральная</span>`;
            return `
            <div class="admin-item">
                ${c.image ? `<img src="${c.image}" class="admin-item-thumb" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(c.name || '')}">${initialOf(c.name)}</div>`}
                <div class="admin-item-info">
                    <div class="admin-item-title">${escapeHtml(c.name || '(без названия)')} ${rarityBadge(c.rarity)} ${classTag}</div>
                    <div class="admin-item-sub">
                        💧${c.mana || 0}
                        ${c.type === 'minion' ? ` · ⚔️${c.attack || 0} · ❤️${c.health || 0}` : ' · Заклинание'}
                    </div>
                </div>
                <div class="admin-item-actions">
                    <button class="icon-btn" onclick="editCard('${c.id}')">✏️</button>
                    <button class="icon-btn danger" onclick="deleteCard('${c.id}')">🗑</button>
                </div>
            </div>`;
        }).join('');
    }

    populateComboCardSelects();
    populateGrantCardSelect();
}

function populateComboCardSelects() {
    const opts = '<option value="">—</option>' + state.cardsData
        .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(c => `<option value="${c.id}">${escapeHtml(c.name || '(без названия)')}</option>`).join('');

    ['combo-card-1', 'combo-card-2', 'combo-card-3'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = (id === 'combo-card-3' ? '<option value="">Карта 3 (необязательно)...</option>' : '<option value="">Карта...</option>') + opts;
        if (current) sel.value = current;
    });
}

window.editCard = function (id) {
    const c = state.cardsData.find(x => x.id === id);
    if (!c) return;

    state.editingCardId = id;
    document.getElementById('card-name').value = c.name || '';
    document.getElementById('card-image').value = c.image || '';
    document.getElementById('card-class').value = c.classId || '';
    document.getElementById('card-type').value = c.type || 'minion';
    document.getElementById('card-rarity').value = c.rarity || 'common';
    document.getElementById('card-mana').value = c.mana ?? '';
    document.getElementById('card-attack').value = c.attack ?? '';
    document.getElementById('card-health').value = c.health ?? '';
    document.getElementById('card-effect').value = c.effect || '';
    document.getElementById('card-effect-type').value = c.effectType || '';
    document.getElementById('card-effect-value').value = c.effectValue ?? '';
    document.getElementById('card-taunt').checked = !!c.taunt;
    document.getElementById('card-lifesteal').checked = !!c.lifesteal;
    document.getElementById('card-charge').checked = !!c.charge;
    document.getElementById('card-form-heading').textContent = 'Редактировать карточку';
    document.getElementById('btn-add-card').textContent = 'Сохранить изменения';
    document.getElementById('btn-cancel-edit-card').classList.remove('hidden');
    document.getElementById('card-name').scrollIntoView({ behavior: 'smooth' });
};

document.getElementById('btn-cancel-edit-card').onclick = function () {
    state.editingCardId = null;
    ['card-name', 'card-image', 'card-mana', 'card-attack', 'card-health', 'card-effect', 'card-effect-value'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('card-class').value = '';
    document.getElementById('card-type').value = 'minion';
    document.getElementById('card-effect-type').value = '';
    document.getElementById('card-taunt').checked = false;
    document.getElementById('card-lifesteal').checked = false;
    document.getElementById('card-charge').checked = false;
    document.getElementById('card-rarity').value = 'common';
    document.getElementById('card-form-heading').textContent = 'Добавить карточку';
    document.getElementById('btn-add-card').textContent = 'Добавить карточку';
    document.getElementById('btn-cancel-edit-card').classList.add('hidden');
};

document.getElementById('btn-add-card').onclick = function () {
    const name = document.getElementById('card-name').value.trim();
    const image = document.getElementById('card-image').value.trim();
    const classId = document.getElementById('card-class').value;
    const type = document.getElementById('card-type').value;
    const rarity = document.getElementById('card-rarity').value;
    const mana = parseInt(document.getElementById('card-mana').value, 10) || 0;
    const attack = parseInt(document.getElementById('card-attack').value, 10) || 0;
    const health = parseInt(document.getElementById('card-health').value, 10) || 0;
    const effect = document.getElementById('card-effect').value.trim();
    const effectType = document.getElementById('card-effect-type').value;
    const effectValue = parseInt(document.getElementById('card-effect-value').value, 10) || 0;
    const taunt = document.getElementById('card-taunt').checked;
    const lifesteal = document.getElementById('card-lifesteal').checked;
    const charge = document.getElementById('card-charge').checked;

    if (!name) return tg.showAlert('Укажи название карточки');
    if (mana < 0 || mana > 10) return tg.showAlert('Стоимость маны от 0 до 10');

    const data = { name, image, classId, type, rarity, mana, attack, health, effect, effectType, effectValue, taunt, lifesteal, charge };

    if (state.editingCardId) {
        update(ref(state.db, 'cards/' + state.editingCardId), data).then(() => {
            document.getElementById('btn-cancel-edit-card').click();
            tg.showPopup({ title: 'Сохранено', message: 'Карточка обновлена', buttons: [{ type: 'ok' }] });
        }).catch(err => tg.showAlert('Ошибка обновления: ' + friendlyDbError(err)));
    } else {
        push(ref(state.db, 'cards'), { ...data, createdAt: Date.now() }).then(() => {
            document.getElementById('btn-cancel-edit-card').click();
            tg.showPopup({ title: 'Добавлено!', message: 'Карточка создана', buttons: [{ type: 'ok' }] });
        }).catch(err => tg.showAlert('Ошибка добавления: ' + friendlyDbError(err)));
    }
};

window.deleteCard = function (id) {
    if (!confirm('Удалить карточку? Она также пропадёт из всех комбо, где участвует.')) return;
    remove(ref(state.db, 'cards/' + id)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

// ===================== КОМБО =====================

export function renderAdminCombosList() {
    const el = document.getElementById('admin-combos-list');
    if (!el) return;

    if (!state.cardCombosData.length) {
        el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Комбо пока нет</div>';
        return;
    }

    const cardName = (id) => {
        const c = state.cardsData.find(x => x.id === id);
        return c ? (c.name || '?') : '(удалена)';
    };

    el.innerHTML = state.cardCombosData.map(combo => {
        const names = (combo.cardIds || []).map(cardName).join(' + ');
        return `
        <div class="admin-item">
            <div class="admin-item-thumb cover-fallback small" style="background:#bf5af2;">🔗</div>
            <div class="admin-item-info">
                <div class="admin-item-title">${escapeHtml(combo.name || '(без названия)')}</div>
                <div class="admin-item-sub">${escapeHtml(names)}</div>
            </div>
            <div class="admin-item-actions">
                <button class="icon-btn" onclick="editCombo('${combo.id}')">✏️</button>
                <button class="icon-btn danger" onclick="deleteCombo('${combo.id}')">🗑</button>
            </div>
        </div>`;
    }).join('');
}

window.editCombo = function (id) {
    const combo = state.cardCombosData.find(x => x.id === id);
    if (!combo) return;

    state.editingComboId = id;
    document.getElementById('combo-name').value = combo.name || '';
    document.getElementById('combo-effect').value = combo.effect || '';
    document.getElementById('combo-effect-type').value = combo.effectType || '';
    document.getElementById('combo-effect-value').value = combo.effectValue ?? '';
    const ids = combo.cardIds || [];
    document.getElementById('combo-card-1').value = ids[0] || '';
    document.getElementById('combo-card-2').value = ids[1] || '';
    document.getElementById('combo-card-3').value = ids[2] || '';
    document.getElementById('combo-form-heading').textContent = 'Редактировать комбо';
    document.getElementById('btn-add-combo').textContent = 'Сохранить изменения';
    document.getElementById('btn-cancel-edit-combo').classList.remove('hidden');
    document.getElementById('combo-name').scrollIntoView({ behavior: 'smooth' });
};

document.getElementById('btn-cancel-edit-combo').onclick = function () {
    state.editingComboId = null;
    document.getElementById('combo-name').value = '';
    document.getElementById('combo-effect').value = '';
    document.getElementById('combo-effect-type').value = '';
    document.getElementById('combo-effect-value').value = '';
    document.getElementById('combo-card-1').value = '';
    document.getElementById('combo-card-2').value = '';
    document.getElementById('combo-card-3').value = '';
    document.getElementById('combo-form-heading').textContent = 'Добавить комбо';
    document.getElementById('btn-add-combo').textContent = 'Добавить комбо';
    document.getElementById('btn-cancel-edit-combo').classList.add('hidden');
};

document.getElementById('btn-add-combo').onclick = function () {
    const name = document.getElementById('combo-name').value.trim();
    const effect = document.getElementById('combo-effect').value.trim();
    const effectType = document.getElementById('combo-effect-type').value;
    const effectValue = parseInt(document.getElementById('combo-effect-value').value, 10) || 0;
    const c1 = document.getElementById('combo-card-1').value;
    const c2 = document.getElementById('combo-card-2').value;
    const c3 = document.getElementById('combo-card-3').value;
    const cardIds = [c1, c2, c3].filter(Boolean);

    if (!name) return tg.showAlert('Укажи название комбо');
    if (cardIds.length < 2) return tg.showAlert('Выбери хотя бы 2 карточки для комбо');

    const data = { name, effect, effectType, effectValue, cardIds };

    if (state.editingComboId) {
        update(ref(state.db, 'cardCombos/' + state.editingComboId), data).then(() => {
            document.getElementById('btn-cancel-edit-combo').click();
            tg.showPopup({ title: 'Сохранено', message: 'Комбо обновлено', buttons: [{ type: 'ok' }] });
        }).catch(err => tg.showAlert('Ошибка обновления: ' + friendlyDbError(err)));
    } else {
        push(ref(state.db, 'cardCombos'), { ...data, createdAt: Date.now() }).then(() => {
            document.getElementById('btn-cancel-edit-combo').click();
            tg.showPopup({ title: 'Добавлено!', message: 'Комбо создано', buttons: [{ type: 'ok' }] });
        }).catch(err => tg.showAlert('Ошибка добавления: ' + friendlyDbError(err)));
    }
};

window.deleteCombo = function (id) {
    if (!confirm('Удалить комбо?')) return;
    remove(ref(state.db, 'cardCombos/' + id)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

// ===================== НАБОРЫ (ПАКИ) =====================

export function renderAdminPacksList() {
    const el = document.getElementById('admin-packs-list');
    if (!el) return;

    if (!state.cardPacksData.length) {
        el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Наборов пока нет</div>';
        return;
    }

    el.innerHTML = state.cardPacksData.map(p => `
        <div class="admin-item">
            ${p.image ? `<img src="${p.image}" class="admin-item-thumb" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(p.name || '')}">${initialOf(p.name)}</div>`}
            <div class="admin-item-info">
                <div class="admin-item-title">${escapeHtml(p.name || '(без названия)')}</div>
                <div class="admin-item-sub">🪙${p.price || 0} · ${p.count || 1} карт${p.minRarity ? ' · мин. ' + (RARITY_LABELS[p.minRarity] || '') : ''}</div>
            </div>
            <div class="admin-item-actions">
                <button class="icon-btn" onclick="editPack('${p.id}')">✏️</button>
                <button class="icon-btn danger" onclick="deletePack('${p.id}')">🗑</button>
            </div>
        </div>`).join('');
}

window.editPack = function (id) {
    const p = state.cardPacksData.find(x => x.id === id);
    if (!p) return;

    state.editingPackId = id;
    document.getElementById('pack-name').value = p.name || '';
    document.getElementById('pack-image').value = p.image || '';
    document.getElementById('pack-price').value = p.price ?? '';
    document.getElementById('pack-count').value = p.count ?? 3;
    document.getElementById('pack-min-rarity').value = p.minRarity || '';
    document.getElementById('pack-form-heading').textContent = 'Редактировать набор';
    document.getElementById('btn-add-cardpack').textContent = 'Сохранить изменения';
    document.getElementById('btn-cancel-edit-cardpack').classList.remove('hidden');
    document.getElementById('pack-name').scrollIntoView({ behavior: 'smooth' });
};

document.getElementById('btn-cancel-edit-cardpack').onclick = function () {
    state.editingPackId = null;
    document.getElementById('pack-name').value = '';
    document.getElementById('pack-image').value = '';
    document.getElementById('pack-price').value = '';
    document.getElementById('pack-count').value = 3;
    document.getElementById('pack-min-rarity').value = '';
    document.getElementById('pack-form-heading').textContent = 'Добавить набор карточек';
    document.getElementById('btn-add-cardpack').textContent = 'Добавить набор';
    document.getElementById('btn-cancel-edit-cardpack').classList.add('hidden');
};

document.getElementById('btn-add-cardpack').onclick = function () {
    const name = document.getElementById('pack-name').value.trim();
    const image = document.getElementById('pack-image').value.trim();
    const price = parseInt(document.getElementById('pack-price').value, 10) || 0;
    const count = parseInt(document.getElementById('pack-count').value, 10) || 1;
    const minRarity = document.getElementById('pack-min-rarity').value;

    if (!name) return tg.showAlert('Укажи название набора');
    if (count < 1) return tg.showAlert('В наборе должна быть хотя бы 1 карточка');

    const data = { name, image, price, count, minRarity };

    if (state.editingPackId) {
        update(ref(state.db, 'cardPacks/' + state.editingPackId), data).then(() => {
            document.getElementById('btn-cancel-edit-cardpack').click();
            tg.showPopup({ title: 'Сохранено', message: 'Набор обновлён', buttons: [{ type: 'ok' }] });
        }).catch(err => tg.showAlert('Ошибка обновления: ' + friendlyDbError(err)));
    } else {
        push(ref(state.db, 'cardPacks'), { ...data, createdAt: Date.now() }).then(() => {
            document.getElementById('btn-cancel-edit-cardpack').click();
            tg.showPopup({ title: 'Добавлено!', message: 'Набор создан', buttons: [{ type: 'ok' }] });
        }).catch(err => tg.showAlert('Ошибка добавления: ' + friendlyDbError(err)));
    }
};

window.deletePack = function (id) {
    if (!confirm('Удалить набор?')) return;
    remove(ref(state.db, 'cardPacks/' + id)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

// ===================== РАМКИ КАРТОЧЕК ПО РЕДКОСТИ =====================

const FRAME_RARITIES = ['common', 'rare', 'epic', 'legendary'];

export function populateFramesForm() {
    FRAME_RARITIES.forEach(r => {
        const el = document.getElementById('frame-image-' + r);
        if (el) el.value = (state.cardFramesData && state.cardFramesData[r]) || '';
    });
}

document.getElementById('btn-save-frames').onclick = function () {
    const data = {};
    FRAME_RARITIES.forEach(r => {
        data[r] = document.getElementById('frame-image-' + r).value.trim();
    });
    update(ref(state.db, 'cardFrames'), data).then(() => {
        tg.showPopup({ title: 'Сохранено', message: 'Рамки обновлены', buttons: [{ type: 'ok' }] });
    }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

// ===================== КЛАССЫ ГЕРОЕВ =====================

export function renderAdminClassesList() {
    const el = document.getElementById('admin-classes-list');
    if (!el) return;

    if (!state.heroClassesData.length) {
        el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Классов пока нет — карточки будут нейтральными</div>';
    } else {
        el.innerHTML = state.heroClassesData.map(cl => `
            <div class="admin-item">
                <div class="admin-item-thumb cover-fallback small" style="background:${cl.color || '#0a84ff'};">${cl.icon || '⚔️'}</div>
                <div class="admin-item-info">
                    <div class="admin-item-title">${escapeHtml(cl.name || '(без названия)')}</div>
                </div>
                <div class="admin-item-actions">
                    <button class="icon-btn" onclick="editClass('${cl.id}')">✏️</button>
                    <button class="icon-btn danger" onclick="deleteClass('${cl.id}')">🗑</button>
                </div>
            </div>`).join('');
    }

    populateCardClassSelect();
}

function populateCardClassSelect() {
    const opts = state.heroClassesData
        .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(cl => `<option value="${cl.id}">${cl.icon || ''} ${escapeHtml(cl.name || '')}</option>`).join('');
    const sel = document.getElementById('card-class');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Нейтральная (доступна всем)</option>' + opts;
    if (current) sel.value = current;
}

window.editClass = function (id) {
    const cl = state.heroClassesData.find(x => x.id === id);
    if (!cl) return;

    state.editingClassId = id;
    document.getElementById('class-name').value = cl.name || '';
    document.getElementById('class-icon').value = cl.icon || '';
    document.getElementById('class-color').value = cl.color || '#0a84ff';
    document.getElementById('btn-add-class').textContent = 'Сохранить изменения';
    document.getElementById('btn-cancel-edit-class').classList.remove('hidden');
    document.getElementById('class-name').scrollIntoView({ behavior: 'smooth' });
};

document.getElementById('btn-cancel-edit-class').onclick = function () {
    state.editingClassId = null;
    document.getElementById('class-name').value = '';
    document.getElementById('class-icon').value = '';
    document.getElementById('class-color').value = '#0a84ff';
    document.getElementById('btn-add-class').textContent = 'Добавить класс';
    document.getElementById('btn-cancel-edit-class').classList.add('hidden');
};

document.getElementById('btn-add-class').onclick = function () {
    const name = document.getElementById('class-name').value.trim();
    const icon = document.getElementById('class-icon').value.trim();
    const color = document.getElementById('class-color').value;

    if (!name) return tg.showAlert('Укажи название класса');

    const data = { name, icon, color };

    if (state.editingClassId) {
        update(ref(state.db, 'heroClasses/' + state.editingClassId), data).then(() => {
            document.getElementById('btn-cancel-edit-class').click();
        }).catch(err => tg.showAlert('Ошибка обновления: ' + friendlyDbError(err)));
    } else {
        push(ref(state.db, 'heroClasses'), { ...data, createdAt: Date.now() }).then(() => {
            document.getElementById('btn-cancel-edit-class').click();
        }).catch(err => tg.showAlert('Ошибка добавления: ' + friendlyDbError(err)));
    }
};

window.deleteClass = function (id) {
    if (!confirm('Удалить класс? Карточки этого класса станут нейтральными.')) return;
    remove(ref(state.db, 'heroClasses/' + id)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

// ===================== ПРАВИЛА СБОРКИ КОЛОДЫ =====================

export function populateDeckSettingsForm() {
    const sizeEl = document.getElementById('deck-size-setting');
    const copiesEl = document.getElementById('deck-max-copies-setting');
    if (!sizeEl || !copiesEl) return;
    sizeEl.value = state.deckSettings.deckSize;
    copiesEl.value = state.deckSettings.maxCopies;
}

document.getElementById('btn-save-deck-settings').onclick = function () {
    const deckSize = parseInt(document.getElementById('deck-size-setting').value, 10) || 30;
    const maxCopies = parseInt(document.getElementById('deck-max-copies-setting').value, 10) || 2;

    if (deckSize < 1) return tg.showAlert('Размер колоды должен быть больше 0');
    if (maxCopies < 1) return tg.showAlert('Лимит копий должен быть больше 0');

    update(ref(state.db, 'cardGameSettings'), { deckSize, maxCopies }).then(() => {
        tg.showPopup({ title: 'Сохранено', message: 'Правила сборки колоды обновлены', buttons: [{ type: 'ok' }] });
    }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

// ===================== ВЫДАТЬ КАРТОЧКУ ИГРОКУ =====================

function populateGrantCardSelect() {
    const sel = document.getElementById('grant-card-id');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Карточка...</option>' + state.cardsData
        .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(c => `<option value="${c.id}">${escapeHtml(c.name || '(без названия)')}</option>`).join('');
    if (current) sel.value = current;
}

document.getElementById('btn-grant-card').onclick = function () {
    const userId = document.getElementById('grant-user-id').value.trim();
    const cardId = document.getElementById('grant-card-id').value;
    const count = parseInt(document.getElementById('grant-count').value, 10) || 1;

    if (!userId) return tg.showAlert('Укажи ID игрока');
    if (!cardId) return tg.showAlert('Выбери карточку');

    const path = 'users/' + userId + '/cardCollection/' + cardId;
    get(ref(state.db, path)).then(snap => {
        const current = snap.exists() ? (snap.val() || 0) : 0;
        return update(ref(state.db, 'users/' + userId + '/cardCollection'), { [cardId]: current + count });
    }).then(() => {
        document.getElementById('grant-user-id').value = '';
        document.getElementById('grant-count').value = 1;
        tg.showPopup({ title: 'Выдано!', message: 'Карточка добавлена игроку', buttons: [{ type: 'ok' }] });
    }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

