import { ref, push, update, remove, set } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { colorFor, escapeHtml, extractYoutubeId, formatDate, friendlyDbError, getImagesFromContainer, initialOf, populateImagesContainer, toLocalInputValue } from './utils.js';
import { getChapters } from './books.js';
import { questTypeLabel } from './profile.js';

window.switchAdminTab = function(tab) {
            ['posts', 'banners', 'books', 'stickers', 'theme', 'boss', 'economy', 'quests', 'events', 'cards', 'arenas'].forEach(t => { 
                document.getElementById('admin-tab-' + t).classList.toggle('hidden', tab !== t); 
                document.getElementById('admin-tab-btn-' + t).classList.toggle('active', tab === t); 
            });
        };



        // АДМИН - СТИКЕРЫ
        document.getElementById('btn-add-pack').onclick = function() {
            const name = document.getElementById('new-pack-name').value.trim();
            if (!name) return tg.showAlert('Введите название');
            
            push(ref(state.db, 'sticker_packs'), { 
                name: name, 
                createdAt: Date.now() 
            }).then(() => { 
                document.getElementById('new-pack-name').value = ''; 
            }).catch(err => tg.showAlert('Ошибка создания пака: ' + friendlyDbError(err)));
        }
        


        export function renderAdminStickersList() {
            const el = document.getElementById('admin-stickers-list'); 
            if (!el) return;
            
            let html = '';
            
            state.stickerPacksData.forEach(pack => {
                html += `
                    <div style="width:100%; font-weight:bold; font-size:14px; margin-top:10px;">
                        ${escapeHtml(pack.name)} 
                        <button class="icon-btn danger" style="display:inline-block; width:24px; height:24px; font-size:12px; margin-left:10px;" onclick="deleteStickerPack('${pack.id}')">🗑</button>
                    </div>`;
                    
                if (pack.stickers) {
                    Object.entries(pack.stickers).forEach(([sid, s]) => {
                        html += `
                            <div style="position:relative; width:48px; height:48px; background:var(--input-bg); border-radius:10px; padding:4px; display:inline-block; margin-right:8px; margin-top:8px;">
                                <img src="${s.url}" style="width:100%; height:100%; object-fit:contain;">
                                <button class="icon-btn danger" style="position:absolute; top:-6px; right:-6px; width:18px; height:18px; font-size:9px;" onclick="deletePackSticker('${pack.id}','${sid}')">✕</button>
                            </div>`;
                    });
                }
            });
            
            if (state.stickersData.length > 0) {
                 html += `<div style="width:100%; font-weight:bold; font-size:14px; margin-top:10px; color:var(--text-secondary);">Остальные (без пака)</div>`;
                 state.stickersData.forEach(s => {
                      html += `
                        <div style="position:relative; width:48px; height:48px; background:var(--input-bg); border-radius:10px; padding:4px; display:inline-block; margin-right:8px; margin-top:8px;">
                            <img src="${s.url}" style="width:100%; height:100%; object-fit:contain;">
                            <button class="icon-btn danger" style="position:absolute; top:-6px; right:-6px; width:18px; height:18px; font-size:9px;" onclick="deleteLooseSticker('${s.id}')">✕</button>
                        </div>`;
                 });
            }
            
            el.innerHTML = html;
        }

        window.deleteStickerPack = function(id) {
            if (!confirm('Удалить весь пак?')) return;
            remove(ref(state.db, 'sticker_packs/' + id)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        window.deletePackSticker = function(packId, stickerId) {
            if (!confirm('Удалить стикер?')) return;
            remove(ref(state.db, 'sticker_packs/' + packId + '/stickers/' + stickerId)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        window.deleteLooseSticker = function(id) {
            if (!confirm('Удалить стикер?')) return;
            remove(ref(state.db, 'stickers/' + id)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };



        // АДМИН - ПОСТЫ


        export function renderAdminPostsList() {
            const el = document.getElementById('admin-posts-list'); 
            if (!el) return;
            
            if (!state.postsData.length) { 
                el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Новостей пока нет</div>'; 
                return; 
            }
            
            el.innerHTML = state.postsData.map(post => {
                const cover = (post.images || (post.image ? [post.image] : []))[0];
                return `
                <div class="admin-item">
                    ${cover ? `<img src="${cover}" class="admin-item-thumb" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(post.title || '')}">${initialOf(post.title)}</div>`}
                    <div class="admin-item-info">
                        <div class="admin-item-title">${post.pinned ? '📌 ' : ''}${escapeHtml(post.title)}</div>
                        <div class="admin-item-sub">${post.authorId ? '👤 ' + escapeHtml(post.authorName) : formatDate(post.createdAt)}</div>
                    </div>
                    <div class="admin-item-actions">
                        <button class="icon-btn ${post.pinned ? 'active' : ''}" title="${post.pinned ? 'Открепить' : 'Закрепить'}" onclick="togglePinPost('${post.id}', ${!post.pinned})">📌</button>
                        <button class="icon-btn" onclick="editPost('${post.id}')">✏️</button>
                        <button class="icon-btn danger" onclick="deletePost('${post.id}')">🗑</button>
                    </div>
                </div>`;
            }).join('');
        }

        window.deletePost = function(id) {
            if (!confirm('Удалить новость?')) return;
            remove(ref(state.db, 'posts/' + id)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        window.togglePinPost = function(id, pinned) {
            update(ref(state.db, 'posts/' + id), { pinned: pinned, pinnedAt: pinned ? Date.now() : null })
                .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        window.editPost = function(id) {
            const post = state.postsData.find(p => p.id === id); 
            if (!post) return;
            
            state.editingPostId = id; 
            document.getElementById('post-title').value = post.title || ''; 
            populateImagesContainer('admin-post-images-container', post.images || (post.image ? [post.image] : [])); 
            document.getElementById('post-text').value = post.text || '';
            document.getElementById('post-form-heading').textContent = 'Редактировать новость'; 
            document.getElementById('btn-add-post').textContent = 'Сохранить изменения'; 
            document.getElementById('btn-cancel-edit-post').classList.remove('hidden'); 
            document.getElementById('post-title').scrollIntoView({ behavior: 'smooth' });
        };


        
        document.getElementById('btn-cancel-edit-post').onclick = function() {
            state.editingPostId = null; 
            document.getElementById('post-title').value = ''; 
            document.getElementById('admin-post-images-container').innerHTML = ''; 
            document.getElementById('post-text').value = '';
            document.getElementById('post-form-heading').textContent = 'Добавить новость'; 
            document.getElementById('btn-add-post').textContent = 'Опубликовать'; 
            document.getElementById('btn-cancel-edit-post').classList.add('hidden');
        };
        
        document.getElementById('btn-add-post').onclick = function() {
            const title = document.getElementById('post-title').value.trim();
            const text = document.getElementById('post-text').value.trim();
            
            if (!title || !text) return tg.showAlert('Заполни поля');
            
            const data = { 
                title: title, 
                images: getImagesFromContainer('admin-post-images-container'), 
                text: text 
            };
            
            if (state.editingPostId) { 
                update(ref(state.db, 'posts/' + state.editingPostId), data).then(() => { 
                    document.getElementById('btn-cancel-edit-post').click(); 
                    tg.showPopup({ title: 'Сохранено', message: 'Новость обновлена', buttons: [{ type: 'ok' }] }); 
                }).catch(err => tg.showAlert('Ошибка обновления: ' + friendlyDbError(err))); 
            } else { 
                push(ref(state.db, 'posts'), { ...data, createdAt: Date.now() }).then(() => { 
                    document.getElementById('btn-cancel-edit-post').click(); 
                    tg.showPopup({ title: 'Опубликовано!', message: 'Новость видна всем', buttons: [{ type: 'ok' }] }); 
                }).catch(err => tg.showAlert('Ошибка добавления: ' + friendlyDbError(err))); 
            }
        };

        // АДМИН - БАННЕРЫ


        export function renderAdminBannersList() {
            const el = document.getElementById('admin-banners-list');
            if (!el) return;

            if (!state.bannersData.length) {
                el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Баннеров пока нет</div>';
                return;
            }

            el.innerHTML = state.bannersData.map(b => `
                <div class="admin-item">
                    ${b.type === 'solid' ? `<div class="admin-item-thumb" style="background:${b.color || '#ed8f03'};"></div>` : (b.image ? `<img src="${b.image}" class="admin-item-thumb" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(b.title || '')}">${initialOf(b.title)}</div>`)}
                    <div class="admin-item-info">
                        <div class="admin-item-title">${b.pinned ? '📌 ' : ''}${escapeHtml(b.title || '(без заголовка)')}</div>
                        <div class="admin-item-sub">${b.type === 'event' ? '⏳ Событие · ' + formatDate(b.eventAt) : (b.type === 'solid' ? '🟧 Сплошной баннер' : 'Обычный баннер')}</div>
                    </div>
                    <div class="admin-item-actions">
                        <button class="icon-btn ${b.pinned ? 'active' : ''}" title="${b.pinned ? 'Открепить' : 'Закрепить'}" onclick="togglePinBanner('${b.id}', ${!b.pinned})">📌</button>
                        <button class="icon-btn" onclick="editBanner('${b.id}')">✏️</button>
                        <button class="icon-btn danger" onclick="deleteBanner('${b.id}')">🗑</button>
                    </div>
                </div>`).join('');
        }

        window.togglePinBanner = function(id, pinned) {
            update(ref(state.db, 'banners/' + id), { pinned: pinned, pinnedAt: pinned ? Date.now() : null })
                .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        window.editBanner = function(id) {
            const b = state.bannersData.find(x => x.id === id);
            if (!b) return;

            state.editingBannerId = id;
            document.getElementById('banner-title').value = b.title || '';
            document.getElementById('banner-image').value = b.image || '';
            document.getElementById('banner-color').value = b.color || '#ed8f03';
            document.getElementById('banner-link').value = b.link || '';
            document.getElementById('banner-type').value = b.type || 'simple';
            document.getElementById('banner-pinned').checked = !!b.pinned;
            document.getElementById('banner-event-at').classList.toggle('hidden', b.type !== 'event');
            document.getElementById('banner-image-row').classList.toggle('hidden', b.type === 'solid');
            document.getElementById('banner-color-row').classList.toggle('hidden', b.type !== 'solid');
            if (b.type === 'event' && b.eventAt) {
                const d = new Date(b.eventAt);
                const pad = n => String(n).padStart(2, '0');
                document.getElementById('banner-event-at').value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            }
            document.getElementById('banner-form-heading').textContent = 'Редактировать баннер';
            document.getElementById('btn-add-banner').textContent = 'Сохранить изменения';
            document.getElementById('btn-cancel-edit-banner').classList.remove('hidden');
            document.getElementById('banner-title').scrollIntoView({ behavior: 'smooth' });
        };



        document.getElementById('btn-cancel-edit-banner').onclick = function() {
            state.editingBannerId = null;
            document.getElementById('banner-title').value = '';
            document.getElementById('banner-image').value = '';
            document.getElementById('banner-color').value = '#ed8f03';
            document.getElementById('banner-link').value = '';
            document.getElementById('banner-type').value = 'simple';
            document.getElementById('banner-pinned').checked = false;
            document.getElementById('banner-event-at').value = '';
            document.getElementById('banner-event-at').classList.add('hidden');
            document.getElementById('banner-image-row').classList.remove('hidden');
            document.getElementById('banner-color-row').classList.add('hidden');
            document.getElementById('banner-form-heading').textContent = 'Добавить баннер';
            document.getElementById('btn-add-banner').textContent = 'Опубликовать баннер';
            document.getElementById('btn-cancel-edit-banner').classList.add('hidden');
        };

        document.getElementById('banner-type').addEventListener('change', function() {
            document.getElementById('banner-event-at').classList.toggle('hidden', this.value !== 'event');
            document.getElementById('banner-image-row').classList.toggle('hidden', this.value === 'solid');
            document.getElementById('banner-color-row').classList.toggle('hidden', this.value !== 'solid');
        });

        document.getElementById('btn-add-banner').onclick = function() {
            const title = document.getElementById('banner-title').value.trim();
            const image = document.getElementById('banner-image').value.trim();
            const color = document.getElementById('banner-color').value;
            const link = document.getElementById('banner-link').value.trim();
            const type = document.getElementById('banner-type').value;
            const pinned = document.getElementById('banner-pinned').checked;
            const eventAtRaw = document.getElementById('banner-event-at').value;

            if (type !== 'solid' && !image) return tg.showAlert('Добавь картинку баннера');
            if (type === 'solid' && !title) return tg.showAlert('Укажи заголовок сплошного баннера');
            if (type === 'event' && !eventAtRaw) return tg.showAlert('Укажи дату и время события');

            const data = {
                title, image: type === 'solid' ? '' : image, link,
                type,
                color: type === 'solid' ? color : null,
                pinned,
                pinnedAt: pinned ? Date.now() : null,
                eventAt: type === 'event' ? new Date(eventAtRaw).getTime() : null
            };

            if (state.editingBannerId) {
                update(ref(state.db, 'banners/' + state.editingBannerId), data).then(() => {
                    document.getElementById('btn-cancel-edit-banner').click();
                    tg.showPopup({ title: 'Сохранено', message: 'Баннер обновлён', buttons: [{ type: 'ok' }] });
                }).catch(err => tg.showAlert('Ошибка обновления: ' + friendlyDbError(err)));
            } else {
                push(ref(state.db, 'banners'), { ...data, createdAt: Date.now() }).then(() => {
                    document.getElementById('btn-cancel-edit-banner').click();
                    tg.showPopup({ title: 'Опубликовано!', message: 'Баннер виден всем', buttons: [{ type: 'ok' }] });
                }).catch(err => tg.showAlert('Ошибка добавления: ' + friendlyDbError(err)));
            }
        };



        window.deleteBanner = function(id) {
            if (!confirm('Удалить баннер?')) return;
            remove(ref(state.db, 'banners/' + id)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };



        // АДМИН - ОФОРМЛЕНИЕ (тема, звуки, эффекты)


        export function populateThemeAdminForm() {
            document.getElementById('theme-select').value = state.currentTheme;
            document.getElementById('sound-newMessage').value = state.soundsData.newMessage || '';
            document.getElementById('sound-newPost').value = state.soundsData.newPost || '';
            document.getElementById('sound-coin').value = state.soundsData.coin || '';
            document.getElementById('effect-confetti').checked = !!state.effectsData.confetti;
            document.getElementById('effect-particles').checked = !!state.effectsData.particles;
            document.getElementById('yt-video-id').value = state.youtubeVideoId || '';
            document.getElementById('terraria-daynight').checked = !!state.terrariaData.dayNight;
            document.getElementById('terraria-questhp').checked = !!state.terrariaData.questHp;
            document.getElementById('terraria-questhp-label').value = state.terrariaData.questHpLabel || '';
            document.getElementById('terraria-pixelicons').checked = !!state.terrariaData.pixelIcons;
            document.getElementById('terraria-achievements').checked = !!state.terrariaData.achievements;
            document.getElementById('terraria-grass').checked = !!state.terrariaData.grass;
            document.getElementById('terraria-cursor').checked = !!state.terrariaData.cursor;
            document.getElementById('terraria-oreglow').checked = !!state.terrariaData.oreGlow;
        }



        document.getElementById('btn-save-yt').onclick = function() {
            const raw = document.getElementById('yt-video-id').value.trim();
            const id = extractYoutubeId(raw);
            if (raw && !id) return tg.showAlert('Не получилось распознать ссылку/ID видео');
            set(ref(state.db, 'settings/youtubeVideoId'), id || null).then(() => {
                tg.showPopup({ title: 'Готово', message: 'Видео сохранено', buttons: [{ type: 'ok' }] });
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        document.getElementById('btn-save-theme').onclick = function() {
            const theme = document.getElementById('theme-select').value;
            set(ref(state.db, 'settings/theme'), theme).then(() => {
                tg.showPopup({ title: 'Готово', message: 'Тема применена для всех', buttons: [{ type: 'ok' }] });
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        document.getElementById('btn-save-sounds').onclick = function() {
            const data = {
                newMessage: document.getElementById('sound-newMessage').value.trim(),
                newPost: document.getElementById('sound-newPost').value.trim(),
                coin: document.getElementById('sound-coin').value.trim()
            };
            update(ref(state.db, 'settings/sounds'), data).then(() => {
                tg.showPopup({ title: 'Готово', message: 'Звуки сохранены', buttons: [{ type: 'ok' }] });
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        document.getElementById('btn-save-effects').onclick = function() {
            const data = {
                confetti: document.getElementById('effect-confetti').checked,
                particles: document.getElementById('effect-particles').checked
            };
            update(ref(state.db, 'settings/effects'), data).then(() => {
                tg.showPopup({ title: 'Готово', message: 'Эффекты сохранены', buttons: [{ type: 'ok' }] });
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        document.getElementById('btn-save-terraria').onclick = function() {
            const data = {
                dayNight: document.getElementById('terraria-daynight').checked,
                questHp: document.getElementById('terraria-questhp').checked,
                questHpLabel: document.getElementById('terraria-questhp-label').value.trim(),
                pixelIcons: document.getElementById('terraria-pixelicons').checked,
                achievements: document.getElementById('terraria-achievements').checked,
                grass: document.getElementById('terraria-grass').checked,
                cursor: document.getElementById('terraria-cursor').checked,
                oreGlow: document.getElementById('terraria-oreglow').checked
            };
            update(ref(state.db, 'settings/terrariaTheme'), data).then(() => {
                tg.showPopup({ title: 'Готово', message: 'Фичи темы Terraria сохранены для всех', buttons: [{ type: 'ok' }] });
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        // === АДМИН: Экономика ===


        export function populateEconomyAdminForm() {
            document.getElementById('econ-daily-enabled').checked = !!state.economyData.dailyEnabled;
            document.getElementById('econ-daily-amount').value = state.economyData.dailyAmount || 0;
            document.getElementById('econ-chapter-enabled').checked = !!state.economyData.chapterEnabled;
            document.getElementById('econ-chapter-amount').value = state.economyData.chapterAmount || 0;
            document.getElementById('econ-book-enabled').checked = !!state.economyData.bookEnabled;
            document.getElementById('econ-book-amount').value = state.economyData.bookAmount || 0;
            document.getElementById('econ-streak-enabled').checked = !!state.economyData.streakEnabled;
            document.getElementById('econ-streak-amount').value = state.economyData.streakAmount || 0;
            document.getElementById('econ-streak-every').value = state.economyData.streakEvery || 1;
            document.getElementById('econ-streak-max').value = state.economyData.streakMax || 0;
            document.getElementById('econ-event-multiplier').value = state.economyData.eventMultiplier || 1;
            document.getElementById('econ-event-until').value = toLocalInputValue(state.economyData.eventMultiplierUntil);

            const statusEl = document.getElementById('econ-event-status');
            const active = state.economyData.eventMultiplierUntil && Date.now() < state.economyData.eventMultiplierUntil;
            statusEl.textContent = active
                ? `⚡ Множитель x${state.economyData.eventMultiplier} активен до ${formatDate(state.economyData.eventMultiplierUntil)}`
                : '⚪ Множитель сейчас выключен';
        }



        document.getElementById('btn-save-economy').onclick = function() {
            const data = Object.assign({}, state.economyData, {
                dailyEnabled: document.getElementById('econ-daily-enabled').checked,
                dailyAmount: parseInt(document.getElementById('econ-daily-amount').value, 10) || 0,
                chapterEnabled: document.getElementById('econ-chapter-enabled').checked,
                chapterAmount: parseInt(document.getElementById('econ-chapter-amount').value, 10) || 0,
                bookEnabled: document.getElementById('econ-book-enabled').checked,
                bookAmount: parseInt(document.getElementById('econ-book-amount').value, 10) || 0,
                streakEnabled: document.getElementById('econ-streak-enabled').checked,
                streakAmount: parseInt(document.getElementById('econ-streak-amount').value, 10) || 0,
                streakEvery: Math.max(1, parseInt(document.getElementById('econ-streak-every').value, 10) || 1),
                streakMax: parseInt(document.getElementById('econ-streak-max').value, 10) || 0
            });
            set(ref(state.db, 'settings/economy'), data).then(() => {
                tg.showPopup({ title: 'Готово', message: 'Настройки экономики сохранены', buttons: [{ type: 'ok' }] });
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        document.getElementById('btn-save-event-multiplier').onclick = function() {
            const mult = parseFloat(document.getElementById('econ-event-multiplier').value) || 1;
            const untilRaw = document.getElementById('econ-event-until').value;
            if (!untilRaw) return tg.showAlert('Укажи дату и время окончания ивента');
            const until = new Date(untilRaw).getTime();

            const data = Object.assign({}, state.economyData, { eventMultiplier: mult, eventMultiplierUntil: until });
            set(ref(state.db, 'settings/economy'), data).then(() => {
                tg.showPopup({ title: 'Готово', message: `Множитель x${mult} включён до ${formatDate(until)}`, buttons: [{ type: 'ok' }] });
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        document.getElementById('btn-clear-event-multiplier').onclick = function() {
            const data = Object.assign({}, state.economyData, { eventMultiplier: 1, eventMultiplierUntil: null });
            set(ref(state.db, 'settings/economy'), data).then(() => {
                tg.showPopup({ title: 'Готово', message: 'Множитель выключен', buttons: [{ type: 'ok' }] });
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        // === АДМИН: Задания ===



        export function renderAdminQuestsList() {
            const el = document.getElementById('admin-quests-list');
            if (!el) return;
            if (!state.questsData.length) { el.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;">Заданий пока нет</div>'; return; }

            el.innerHTML = state.questsData.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(q => `
                <div class="admin-item">
                    <div class="admin-item-info">
                        <div class="admin-item-title">${escapeHtml(q.title || '')}${q.active ? '' : ' · выкл'}</div>
                        <div class="admin-item-sub">${questTypeLabel(q.type)} · цель ${q.goal || 0} · награда ${q.reward || 0}🪙${q.expiresAt ? ' · до ' + formatDate(q.expiresAt) : ''}</div>
                    </div>
                    <div class="admin-item-actions">
                        <button class="icon-btn" onclick="editQuest('${q.id}')">✏️</button>
                        <button class="icon-btn danger" onclick="deleteQuest('${q.id}')">🗑</button>
                    </div>
                </div>
            `).join('');
        }

        window.editQuest = function(id) {
            const q = state.questsData.find(x => x.id === id);
            if (!q) return;
            state.editingQuestId = id;
            document.getElementById('quest-title').value = q.title || '';
            document.getElementById('quest-type').value = q.type || 'chapters';
            document.getElementById('quest-goal').value = q.goal || '';
            document.getElementById('quest-reward').value = q.reward || '';
            document.getElementById('quest-expires').value = toLocalInputValue(q.expiresAt);
            document.getElementById('quest-active').checked = q.active !== false;
            document.getElementById('quest-form-heading').textContent = 'Редактировать задание';
            document.getElementById('btn-add-quest').textContent = 'Сохранить изменения';
            document.getElementById('btn-cancel-edit-quest').classList.remove('hidden');
            document.getElementById('quest-title').scrollIntoView({ behavior: 'smooth' });
        };



        document.getElementById('btn-cancel-edit-quest').onclick = function() {
            state.editingQuestId = null;
            document.getElementById('quest-title').value = '';
            document.getElementById('quest-goal').value = '';
            document.getElementById('quest-reward').value = '';
            document.getElementById('quest-expires').value = '';
            document.getElementById('quest-active').checked = true;
            document.getElementById('quest-form-heading').textContent = 'Добавить задание';
            document.getElementById('btn-add-quest').textContent = 'Добавить задание';
            document.getElementById('btn-cancel-edit-quest').classList.add('hidden');
        };



        window.deleteQuest = function(id) {
            tg.showConfirm('Удалить это задание?', (ok) => {
                if (ok) remove(ref(state.db, 'quests/' + id)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
            });
        };



        document.getElementById('btn-add-quest').onclick = function() {
            const title = document.getElementById('quest-title').value.trim();
            const goal = parseInt(document.getElementById('quest-goal').value, 10);
            const reward = parseInt(document.getElementById('quest-reward').value, 10);
            if (!title) return tg.showAlert('Укажи название задания');
            if (!goal || goal < 1) return tg.showAlert('Укажи цель (число больше 0)');
            if (!reward || reward < 1) return tg.showAlert('Укажи награду в монетах');

            const expiresRaw = document.getElementById('quest-expires').value;
            const data = {
                title,
                type: document.getElementById('quest-type').value,
                goal,
                reward,
                active: document.getElementById('quest-active').checked,
                expiresAt: expiresRaw ? new Date(expiresRaw).getTime() : null
            };

            if (state.editingQuestId) {
                update(ref(state.db, 'quests/' + state.editingQuestId), data).then(() => {
                    document.getElementById('btn-cancel-edit-quest').click();
                    tg.showPopup({ title: 'Сохранено', message: 'Задание обновлено', buttons: [{ type: 'ok' }] });
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
            } else {
                push(ref(state.db, 'quests'), { ...data, createdAt: Date.now() }).then(() => {
                    document.getElementById('btn-cancel-edit-quest').click();
                    tg.showPopup({ title: 'Добавлено!', message: 'Задание опубликовано', buttons: [{ type: 'ok' }] });
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
            }
        };

        // ============================================================
        // === КНОПКА ПАССА, ПИТОМЕЦ, ТИТУЛ В ПРОФИЛЕ =================
        // ============================================================


        export function renderAdminBooksList() {
            const el = document.getElementById('admin-books-list'); 
            if (!el) return;
            
            if (!state.booksData.length) { 
                el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Книг пока нет</div>'; 
                return; 
            }
            
            el.innerHTML = state.booksData.map(book => `
                <div class="admin-item">
                    ${book.coverImage ? `<img src="${book.coverImage}" class="admin-item-thumb" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(book.title || '')}">${initialOf(book.title)}</div>`}
                    <div class="admin-item-info">
                        <div class="admin-item-title">${escapeHtml(book.title)}</div>
                        <div class="admin-item-sub">${escapeHtml(book.author || 'Неизвестен')} · ${getChapters(book).length} гл.</div>
                    </div>
                    <div class="admin-item-actions">
                        <button class="icon-btn" onclick="editBook('${book.id}')">✏️</button>
                        <button class="icon-btn danger" onclick="deleteBook('${book.id}')">🗑</button>
                    </div>
                </div>`).join('');
        }

        window.editBook = function(id) {
            const book = state.booksData.find(b => b.id === id); 
            if (!book) return;
            
            state.editingBookId = id; 
            document.getElementById('book-title').value = book.title || ''; 
            document.getElementById('book-author').value = book.author || ''; 
            document.getElementById('book-cover').value = book.coverImage || ''; 
            document.getElementById('book-genre').value = book.genre || '';
            document.getElementById('book-form-heading').textContent = 'Редактировать книгу'; 
            document.getElementById('btn-add-book').textContent = 'Сохранить изменения'; 
            document.getElementById('btn-cancel-edit-book').classList.remove('hidden'); 
            document.getElementById('book-title').scrollIntoView({ behavior: 'smooth' });
        };


        
        document.getElementById('btn-cancel-edit-book').onclick = function() {
            state.editingBookId = null; 
            document.getElementById('book-title').value = ''; 
            document.getElementById('book-author').value = ''; 
            document.getElementById('book-cover').value = ''; 
            document.getElementById('book-genre').value = '';
            document.getElementById('book-form-heading').textContent = 'Добавить книгу'; 
            document.getElementById('btn-add-book').textContent = 'Добавить книгу'; 
            document.getElementById('btn-cancel-edit-book').classList.add('hidden');
        };

        // ИЗМЕНЕННАЯ ФУНКЦИЯ УДАЛЕНИЯ КНИГИ С ГАРАНТИЕЙ УДАЛЕНИЯ ИЗ FIREBASE


        window.deleteBook = function(id) {
            tg.showConfirm('Удалить книгу безвозвратно прямо из базы Firebase? Все главы будут стерты.', (ok) => {
                if (ok) {
                    remove(ref(state.db, 'books/' + id))
                        .then(() => {
                            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                            tg.showPopup({ title: 'Готово', message: 'Книга успешно стёрта из базы', buttons: [{ type: 'ok' }] });
                        })
                        .catch(err => tg.showAlert('Ошибка удаления из Firebase: ' + friendlyDbError(err)));
                }
            });
        };



        document.getElementById('btn-add-book').onclick = function() {
            const title = document.getElementById('book-title').value.trim();
            if (!title) return tg.showAlert('Укажи название книги');
            
            const data = { 
                title: title, 
                author: document.getElementById('book-author').value.trim() || 'Неизвестен', 
                coverImage: document.getElementById('book-cover').value.trim(), 
                genre: document.getElementById('book-genre').value.trim() 
            };
            
            if (state.editingBookId) { 
                update(ref(state.db, 'books/' + state.editingBookId), data).then(() => { 
                    document.getElementById('btn-cancel-edit-book').click(); 
                    tg.showPopup({ title: 'Сохранено', message: 'Книга обновлена', buttons: [{ type: 'ok' }] }); 
                }).catch(err => tg.showAlert('Ошибка обновления: ' + friendlyDbError(err))); 
            } else { 
                push(ref(state.db, 'books'), { ...data, createdAt: Date.now() }).then(() => { 
                    document.getElementById('btn-cancel-edit-book').click(); 
                    tg.showPopup({ title: 'Добавлено!', message: 'Теперь добавьте главы книги ниже', buttons: [{ type: 'ok' }] }); 
                }).catch(err => tg.showAlert('Ошибка добавления: ' + friendlyDbError(err))); 
            }
        };

        document.getElementById('chapter-book-select').addEventListener('change', renderAdminChaptersList);
        


        export function renderAdminChaptersList() {
            const bookId = document.getElementById('chapter-book-select').value;
            const container = document.getElementById('admin-chapters-list');
            
            if (!bookId) { 
                container.innerHTML = ''; 
                return; 
            }
            
            const book = state.booksData.find(b => b.id === bookId); 
            if (!book) { 
                container.innerHTML = ''; 
                return; 
            }
            
            const chapters = getChapters(book); 
            if (!chapters.length) { 
                container.innerHTML = '<div style="color:var(--text-secondary);font-size:12px; margin-bottom: 12px;">В этой книге пока нет глав</div>'; 
                return; 
            }
            
            container.innerHTML = chapters.map((ch, idx) => `
                <div class="admin-item" style="padding: 10px; min-height: auto; margin-bottom: 6px;">
                    <div class="admin-item-info">
                        <div class="admin-item-title" style="font-size: 13px;">${escapeHtml(ch.title || ('Глава ' + (idx + 1)))}</div>
                    </div>
                    <div class="admin-item-actions">
                        <button class="icon-btn danger" style="width:30px;height:30px;font-size:12px;" onclick="deleteChapter('${bookId}', '${ch.id}')">🗑</button>
                    </div>
                </div>
            `).join('') + '<div style="margin-bottom:12px;"></div>';
        }

        window.deleteChapter = function(bookId, chapterId) {
            tg.showConfirm('Удалить эту главу из Firebase?', (ok) => {
                if (ok) {
                    let refPath = `books/${bookId}/chapters/${chapterId}`;
                    if (chapterId === 'legacy') refPath = `books/${bookId}/text`;
                    
                    remove(ref(state.db, refPath))
                        .then(() => {
                            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                        })
                        .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
                }
            });
        };

        export function populateChapterBookSelect() {
            const sel = document.getElementById('chapter-book-select'); 
            if (!sel) return;
            
            const prevVal = sel.value; 
            sel.innerHTML = state.booksData.length 
                ? state.booksData.map(b => `<option value="${b.id}">${escapeHtml(b.title)}</option>`).join('') 
                : '<option value="">Сначала добавьте книгу</option>';
                
            if (state.booksData.some(b => b.id === prevVal)) {
                sel.value = prevVal; 
            } else if (state.booksData.length > 0) {
                sel.value = state.booksData[0].id; 
            }
            
            renderAdminChaptersList();
        }


        
        document.getElementById('btn-add-chapter').onclick = function() {
            const bookId = document.getElementById('chapter-book-select').value;
            const text = document.getElementById('chapter-text').value.trim();
            const title = document.getElementById('chapter-title').value.trim() || '';
            
            if (!bookId) return tg.showAlert('Сначала добавьте книгу'); 
            if (!text) return tg.showAlert('Введите текст главы');
            
            push(ref(state.db, 'books/' + bookId + '/chapters'), { 
                title: title, 
                text: text, 
                createdAt: Date.now() 
            }).then(() => { 
                document.getElementById('chapter-title').value = ''; 
                document.getElementById('chapter-text').value = ''; 
                tg.showPopup({ title: 'Глава добавлена!', message: 'Она появится в книге', buttons: [{ type: 'ok' }] }); 
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        // АДМИН - СОБЫТИЯ (календарь)

        export function renderAdminEventsList() {
            const el = document.getElementById('admin-events-list');
            if (!el) return;

            if (!state.eventsData.length) {
                el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Событий пока нет</div>';
                return;
            }

            const sorted = state.eventsData.slice().sort((a, b) => (a.startDate || 0) - (b.startDate || 0));
            el.innerHTML = sorted.map(e => {
                const ended = e.endDate && e.endDate < Date.now();
                return `
                <div class="admin-item">
                    ${e.image ? `<img src="${e.image}" class="admin-item-thumb" onerror="this.style.display='none'">` : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(e.title || '')}">${initialOf(e.title)}</div>`}
                    <div class="admin-item-info">
                        <div class="admin-item-title">${escapeHtml(e.title || '(без названия)')}</div>
                        <div class="admin-item-sub">${formatDate(e.startDate)} — ${formatDate(e.endDate)}${ended ? ' · Завершено' : ''}</div>
                    </div>
                    <div class="admin-item-actions">
                        <button class="icon-btn" onclick="editEvent('${e.id}')">✏️</button>
                        <button class="icon-btn danger" onclick="deleteEvent('${e.id}')">🗑</button>
                    </div>
                </div>`;
            }).join('');
        }

        window.editEvent = function(id) {
            const e = state.eventsData.find(x => x.id === id);
            if (!e) return;

            state.editingEventId = id;
            document.getElementById('event-title').value = e.title || '';
            document.getElementById('event-image').value = e.image || '';
            document.getElementById('event-start').value = e.startDate ? new Date(e.startDate).toISOString().slice(0, 10) : '';
            document.getElementById('event-end').value = e.endDate ? new Date(e.endDate).toISOString().slice(0, 10) : '';
            document.getElementById('event-form-heading').textContent = 'Редактировать событие';
            document.getElementById('btn-add-event').textContent = 'Сохранить изменения';
            document.getElementById('btn-cancel-edit-event').classList.remove('hidden');
            document.getElementById('event-title').scrollIntoView({ behavior: 'smooth' });
        };

        document.getElementById('btn-cancel-edit-event').onclick = function() {
            state.editingEventId = null;
            document.getElementById('event-title').value = '';
            document.getElementById('event-image').value = '';
            document.getElementById('event-start').value = '';
            document.getElementById('event-end').value = '';
            document.getElementById('event-form-heading').textContent = 'Добавить событие';
            document.getElementById('btn-add-event').textContent = 'Добавить событие';
            document.getElementById('btn-cancel-edit-event').classList.add('hidden');
        };

        document.getElementById('btn-add-event').onclick = function() {
            const title = document.getElementById('event-title').value.trim();
            const image = document.getElementById('event-image').value.trim();
            const startRaw = document.getElementById('event-start').value;
            const endRaw = document.getElementById('event-end').value;

            if (!title) return tg.showAlert('Укажи название события');
            if (!startRaw || !endRaw) return tg.showAlert('Укажи дату начала и окончания');

            const startDate = new Date(startRaw + 'T00:00:00').getTime();
            const endDate = new Date(endRaw + 'T23:59:59').getTime();
            if (endDate < startDate) return tg.showAlert('Дата окончания раньше даты начала');

            const data = { title, image, startDate, endDate };

            if (state.editingEventId) {
                update(ref(state.db, 'events/' + state.editingEventId), data).then(() => {
                    document.getElementById('btn-cancel-edit-event').click();
                    tg.showPopup({ title: 'Сохранено', message: 'Событие обновлено', buttons: [{ type: 'ok' }] });
                }).catch(err => tg.showAlert('Ошибка обновления: ' + friendlyDbError(err)));
            } else {
                push(ref(state.db, 'events'), { ...data, createdAt: Date.now() }).then(() => {
                    document.getElementById('btn-cancel-edit-event').click();
                    tg.showPopup({ title: 'Добавлено!', message: 'Событие появится в календаре', buttons: [{ type: 'ok' }] });
                }).catch(err => tg.showAlert('Ошибка добавления: ' + friendlyDbError(err)));
            }
        };

        window.deleteEvent = function(id) {
            if (!confirm('Удалить событие?')) return;
            remove(ref(state.db, 'events/' + id)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

