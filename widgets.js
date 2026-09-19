import { ref, push, update, remove, get, set, increment } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { escapeHtml, showAppToast } from './utils.js';

// ===================== ВИДЖЕТЫ/ПЛАГИНЫ АДМИНКИ =====================
// Админ пишет произвольный HTML + JS-код и подключает его к одному из именованных "слотов"
// (см. WIDGET_SLOTS) — местам в приложении, куда виджет реально встраивается на странице.
// Ограничений на то, что можно писать — нет (как и в скриптах сюжета): обычный `fetch(...)`,
// динамический `import('https://...')`, работа с DOM через `el` — всё доступно. Защита ровно
// такая, какую попросили: код оборачивается в try/catch, чтобы поломанный виджет не ронял
// остальное приложение, а при ошибке админы (и только они) видят причину прямо под виджетом.
//
// Слот — это заранее подготовленное место в разметке (`<div id="widget-slot-имя">`), которое
// уже существует в HTML вне зависимости от того, открыт сейчас этот экран или нет (все "section"
// в приложении есть в DOM постоянно, просто скрываются классом). Поэтому виджет рендерится один
// раз — при загрузке списка виджетов, а не при каждой перерисовке ленты/профиля — иначе таймеры
// и подписчики событий внутри виджета плодились бы заново на каждый чих.
export const WIDGET_SLOTS = {
    feed_top: 'Лента новостей — сверху (под поиском)',
    feed_bottom: 'Лента новостей — снизу (под списком постов)',
    profile_top: 'Профиль — в самом верху',
    cardverse_menu_top: 'Карточная игра — верх главного меню',
};

// Готовые примеры — подсказки для старта, вставляются в форму одной кнопкой (см. HTML/insertWidgetExample)
export const WIDGET_EXAMPLES = {
    banner: {
        label: '🖼 Баннер-ссылка',
        html: `<div style="background:linear-gradient(135deg,#ed8f03,#ff9f0a);border-radius:14px;padding:14px 16px;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:space-between;gap:10px;">
  <span>🎉 Загляни в новый ивент!</span>
  <span style="font-size:20px;">→</span>
</div>`,
        js: `// el — контейнер этого виджета, api — см. подсказку выше
el.style.cursor = 'pointer';
el.onclick = () => api.switchTab('shop');`,
    },
    countdown: {
        label: '⏱ Обратный отсчёт',
        html: `<div style="background:#12151c;color:#fff;border-radius:14px;padding:14px;text-align:center;font-weight:700;">
  До конца акции: <span id="w-countdown">--:--:--</span>
</div>`,
        js: `const target = Date.now() + 3 * 60 * 60 * 1000; // например, 3 часа от текущего момента
const label = el.querySelector('#w-countdown');
function tick() {
  const left = Math.max(0, target - Date.now());
  const h = String(Math.floor(left / 3600000)).padStart(2, '0');
  const m = String(Math.floor(left / 60000) % 60).padStart(2, '0');
  const s = String(Math.floor(left / 1000) % 60).padStart(2, '0');
  if (label) label.textContent = h + ':' + m + ':' + s;
}
tick();
const timer = setInterval(tick, 1000);
// api.onCleanup нужен таймерам/подпискам — вызовется перед следующей перерисовкой этого виджета
api.onCleanup(() => clearInterval(timer));`,
    },
    greeting: {
        label: '👋 Приветствие по имени',
        html: `<div style="font-size:14px;font-weight:700;padding:6px 2px;"></div>`,
        js: `el.querySelector('div').textContent = api.user ? \`Привет, \${api.user.name}! 👋\` : 'Привет!';`,
    },
};

// Регистр функций очистки на слот — чтобы таймеры/подписки предыдущей версии виджета не текли
// при перерендере (например, после того как админ отредактировал виджет).
const cleanupsBySlot = {};

function runCleanup(slotName) {
    const fns = cleanupsBySlot[slotName] || [];
    fns.forEach(fn => { try { fn(); } catch (e) { /* тихо игнорируем ошибку самой очистки */ } });
    cleanupsBySlot[slotName] = [];
}

function buildWidgetApi(widget, slotName) {
    return {
        state, tg,
        db: state.db, ref, get, set, update, remove, push, increment,
        user: state.currentUser ? { id: state.currentUser.id, name: state.currentUser.name || '' } : null,
        isAdmin: !!state.isAdmin,
        toast: (text, emoji) => showAppToast(text || '', emoji || '✨'),
        popup: (title, message) => tg.showPopup({ title: title || '', message: message || '', buttons: [{ type: 'ok' }] }),
        switchTab: (name) => { if (window.switchTab) window.switchTab(name); },
        onCleanup: (fn) => { if (typeof fn === 'function') (cleanupsBySlot[slotName] = cleanupsBySlot[slotName] || []).push(fn); },
        widget: { id: widget.id, name: widget.name, slot: widget.slot },
    };
}

// Рендерит все включённые виджеты одного слота в его контейнер (если он есть на странице —
// слота может не быть, если этот экран для текущей версии приложения не завели).
export function renderWidgetSlot(slotName) {
    const container = document.getElementById('widget-slot-' + slotName);
    if (!container) return;

    runCleanup(slotName);

    const widgets = (state.widgetsData || [])
        .filter(w => w.slot === slotName && w.enabled)
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    if (!widgets.length) { container.innerHTML = ''; return; }

    try {
        container.innerHTML = widgets.map(w => `<div class="admin-widget-box" data-widget-id="${w.id}" style="margin-bottom:10px;overflow:hidden;"></div>`).join('');
    } catch (err) {
        console.error('Ошибка при вставке виджетов в слот ' + slotName, err);
        return;
    }

    widgets.forEach(w => {
        const el = container.querySelector(`[data-widget-id="${CSS.escape(w.id)}"]`);
        if (!el) return;
        try {
            el.innerHTML = w.html || '';
        } catch (err) {
            reportWidgetError(el, w, err);
            return;
        }
        if (!w.js || !w.js.trim()) return;
        try {
            const api = buildWidgetApi(w, slotName);
            const fn = new Function('el', 'api', `return (async () => {\n${w.js}\n})();`);
            Promise.resolve(fn(el, api)).catch(err => reportWidgetError(el, w, err));
        } catch (err) {
            reportWidgetError(el, w, err);
        }
    });
}

function reportWidgetError(el, widget, err) {
    console.error(`Ошибка в виджете «${widget.name || widget.id}»:`, err);
    // Ошибку видят только админы — обычным игрокам просто молча не покажется сломанная часть виджета
    if (state.isAdmin && el) {
        el.insertAdjacentHTML('beforeend', `<div style="color:#ff6b6b;font-size:11px;padding:6px 8px;background:rgba(255,0,0,0.08);border-radius:8px;margin-top:4px;">⚠️ Ошибка виджета «${escapeHtml(widget.name || widget.id)}» (видно только админам): ${escapeHtml(String((err && err.message) || err))}</div>`);
    }
}

export function renderAllWidgetSlots() {
    Object.keys(WIDGET_SLOTS).forEach(renderWidgetSlot);
}

// ===================== АДМИНКА: СПИСОК/РЕДАКТОР ВИДЖЕТОВ =====================

window.populateWidgetSlotSelect = function () {
    const sel = document.getElementById('widget-slot');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = Object.entries(WIDGET_SLOTS).map(([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`).join('');
    if (current) sel.value = current;
};

window.renderAdminWidgetsList = function () {
    const el = document.getElementById('admin-widgets-list');
    if (!el) return;
    window.populateWidgetSlotSelect();

    if (!state.widgetsData || !state.widgetsData.length) {
        el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Виджетов пока нет.</div>';
        return;
    }

    el.innerHTML = state.widgetsData.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map(w => `
        <div class="admin-item">
            <div class="admin-item-thumb cover-fallback small" style="background:${w.enabled ? '#2e7d32' : '#616161'};">${w.enabled ? '🟢' : '⚪️'}</div>
            <div class="admin-item-info">
                <div class="admin-item-title">${escapeHtml(w.name || 'Виджет')}</div>
                <div class="admin-item-sub">${escapeHtml(WIDGET_SLOTS[w.slot] || w.slot || '—')} · порядок ${w.order || 0}${w.enabled ? '' : ' · выключен'}</div>
            </div>
            <div class="admin-item-actions">
                <button class="icon-btn" onclick="window.editWidget('${w.id}')">✏️</button>
                <button class="icon-btn danger" onclick="window.deleteWidget('${w.id}')">🗑</button>
            </div>
        </div>`).join('');
};

window.insertWidgetExample = function (kind) {
    const ex = WIDGET_EXAMPLES[kind];
    if (!ex) return;
    document.getElementById('widget-html').value = ex.html;
    document.getElementById('widget-js').value = ex.js;
};

window.editWidget = function (id) {
    const w = (state.widgetsData || []).find(x => x.id === id);
    if (!w) return;

    state.editingWidgetId = id;
    window.populateWidgetSlotSelect();
    document.getElementById('widget-name').value = w.name || '';
    document.getElementById('widget-slot').value = w.slot || 'feed_top';
    document.getElementById('widget-order').value = w.order || 0;
    document.getElementById('widget-enabled').checked = w.enabled !== false;
    document.getElementById('widget-html').value = w.html || '';
    document.getElementById('widget-js').value = w.js || '';

    document.getElementById('widget-form-heading').textContent = 'Редактировать виджет';
    document.getElementById('btn-add-widget').textContent = 'Сохранить';
    document.getElementById('btn-cancel-edit-widget').classList.remove('hidden');
    document.getElementById('widget-name').scrollIntoView({ behavior: 'smooth' });
};

window.cancelEditWidget = function () {
    state.editingWidgetId = null;
    window.populateWidgetSlotSelect();
    document.getElementById('widget-name').value = '';
    document.getElementById('widget-order').value = '';
    document.getElementById('widget-enabled').checked = true;
    document.getElementById('widget-html').value = '';
    document.getElementById('widget-js').value = '';

    document.getElementById('widget-form-heading').textContent = 'Создать виджет';
    document.getElementById('btn-add-widget').textContent = 'Добавить виджет';
    document.getElementById('btn-cancel-edit-widget').classList.add('hidden');
};

window.saveWidget = function () {
    const name = document.getElementById('widget-name').value.trim();
    const slot = document.getElementById('widget-slot').value;
    const order = parseInt(document.getElementById('widget-order').value, 10) || 0;
    const enabled = document.getElementById('widget-enabled').checked;
    const html = document.getElementById('widget-html').value;
    const js = document.getElementById('widget-js').value;

    if (!name) return tg.showAlert('Укажи название виджета (для себя, в списке)');
    if (!slot) return tg.showAlert('Выбери, куда встраивать виджет');

    // Ловим синтаксическую ошибку кода при сохранении, а не когда виджет уже увидят игроки
    if (js && js.trim()) {
        try { new Function('el', 'api', `return (async () => {\n${js}\n})();`); }
        catch (err) { return tg.showAlert('Ошибка в JS-коде виджета: ' + err.message); }
    }

    const data = { name, slot, order, enabled, html, js };

    if (state.editingWidgetId) {
        update(ref(state.db, 'widgets/' + state.editingWidgetId), data).then(() => {
            window.cancelEditWidget();
            tg.showPopup({ title: 'Готово', message: 'Виджет обновлён', buttons: [{ type: 'ok' }] });
        }).catch(err => tg.showAlert('Ошибка: ' + err.message));
    } else {
        push(ref(state.db, 'widgets'), { ...data, createdAt: Date.now() }).then(() => {
            window.cancelEditWidget();
            tg.showPopup({ title: 'Супер!', message: 'Виджет создан', buttons: [{ type: 'ok' }] });
        }).catch(err => tg.showAlert('Ошибка: ' + err.message));
    }
};

window.deleteWidget = function (id) {
    if (!confirm('Точно удалить этот виджет?')) return;
    remove(ref(state.db, 'widgets/' + id)).catch(err => tg.showAlert('Ошибка: ' + err.message));
};

document.getElementById('btn-add-widget') && (document.getElementById('btn-add-widget').onclick = window.saveWidget);
document.getElementById('btn-cancel-edit-widget') && (document.getElementById('btn-cancel-edit-widget').onclick = window.cancelEditWidget);
