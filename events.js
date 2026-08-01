import { state } from './state.js';
import { escapeHtml, colorFor, initialOf } from './utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PX_PER_DAY = 64;

function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

function shortDate(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function renderEventsCalendar() {
    const wrap = document.getElementById('events-timeline-wrap');
    if (!wrap) return;

    const events = state.eventsData.slice().filter(e => e.startDate && e.endDate);

    if (!events.length) {
        wrap.innerHTML = '<div class="empty-state"><span class="icon">📅</span><div class="title">Событий пока нет</div><div class="sub">Загляните позже</div></div>';
        return;
    }

    events.sort((a, b) => a.startDate - b.startDate);

    const now = Date.now();
    const minDate = Math.min(...events.map(e => e.startDate));
    const maxDate = Math.max(...events.map(e => e.endDate));
    const totalDays = Math.max(daysBetween(minDate, maxDate), 1) + 1;
    const timelineWidth = (totalDays + 1) * PX_PER_DAY;

    // unique boundary dates for the date scale (start/end of every event), like the reference screenshot
    const boundarySet = new Set();
    events.forEach(e => { boundarySet.add(startOfDay(e.startDate)); boundarySet.add(startOfDay(e.endDate)); });
    const boundaries = Array.from(boundarySet).sort((a, b) => a - b);

    const dateScaleHtml = boundaries.map(ts => {
        const left = daysBetween(minDate, ts) * PX_PER_DAY;
        return `<div class="events-date-mark" style="left:${left}px;">${shortDate(ts)}</div>`;
    }).join('');

    const rowsHtml = events.map((e, idx) => {
        const left = daysBetween(minDate, e.startDate) * PX_PER_DAY;
        const width = Math.max(daysBetween(e.startDate, e.endDate), 1) * PX_PER_DAY;
        const ended = e.endDate < now;
        const notStarted = e.startDate > now;
        const thumb = e.image
            ? `<img src="${e.image}" class="event-bar-thumb" onerror="this.style.display='none'">`
            : `<div class="event-bar-thumb cover-fallback small" style="background:${colorFor(e.title || '')}">${initialOf(e.title)}</div>`;
        return `
        <div class="events-row">
            <div class="event-bar ${ended ? 'ended' : ''} ${notStarted ? 'upcoming' : ''}" style="left:${left}px;width:${width}px;">
                ${thumb}
                <span class="event-bar-title">${escapeHtml(e.title || '')}</span>
                ${ended ? '<div class="event-bar-stamp">Завершено</div>' : ''}
            </div>
        </div>`;
    }).join('');

    const todayLeft = daysBetween(minDate, now) * PX_PER_DAY;
    const todayMarker = (now >= minDate && now <= maxDate)
        ? `<div class="events-today-line" style="left:${todayLeft}px;"></div>`
        : '';

    wrap.innerHTML = `
        <div class="events-scroll" id="events-scroll">
            <div class="events-inner" style="width:${timelineWidth}px;">
                <div class="events-date-scale">${dateScaleHtml}</div>
                <div class="events-rows-wrap">
                    ${todayMarker}
                    ${rowsHtml}
                </div>
            </div>
        </div>`;

    // auto-scroll so "today" (or the first ongoing/upcoming event) is in view
    requestAnimationFrame(() => {
        const scrollEl = document.getElementById('events-scroll');
        if (!scrollEl) return;
        const target = Math.max(todayLeft - 40, 0);
        scrollEl.scrollLeft = target;
    });
}

window.openEventsCalendar = function () {
    state.activeOverlay = 'events';
    document.getElementById('events-overlay').classList.add('active');
    renderEventsCalendar();
};

window.closeEventsCalendar = function () {
    document.getElementById('events-overlay').classList.remove('active');
    state.activeOverlay = null;
};
