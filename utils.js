import { remove } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { COVER_COLORS, IMGBB_API_KEY, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET, TERRARIA_PIXEL_BITMAPS } from './constants.js';
import { openChapter, renderChapterListView } from './books.js';

export function cardFrameStyle(rarity) {
    const url = state.cardFramesData && state.cardFramesData[rarity || 'common'];
    if (!url) return '';
    return `border-image: url('${url}') 30 stretch; border-width: 6px; border-style: solid;`;
}

export function colorFor(str) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
            return COVER_COLORS[Math.abs(hash) % COVER_COLORS.length];
        }

        export function initialOf(str) { 
            return (str || '?').trim().charAt(0).toUpperCase() || '?'; 
        }

        export function escapeHtml(str) {
            return String(str || '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
        }



        // Значок-галочка рядом с именем одобренных издателей


        export function verifiedBadge(userId) {
            const u = state.usersData.find(x => x.id === userId);
            if (!u || !u.isPublisher) return '';
            const color = u.badgeColor || state.badgeColor;
            return `<span class="verified-badge" style="background:${color}" title="Проверенный издатель">✓</span>`;
        }



        // === Значок и цвет ника из магазина ===


        export function shopBadgeHtml(userId) {
            const u = state.usersData.find(x => x.id === userId);
            const badgeId = u && u.equipped && u.equipped.badge;
            if (!badgeId) return '';
            const item = state.shopItemsData.find(i => i.id === badgeId);
            if (!item) return '';
            return `<img src="${item.image}" alt="" title="${escapeHtml(item.name)}" style="width:14px;height:14px;object-fit:contain;vertical-align:-2px;margin-left:2px;">`;
        }



        // ============================================================
        // === СЕЗОННЫЙ ПАСС (Battle Pass) ============================
        // ============================================================
        // Типы наград пасса. Первые 5 — это РЕАЛЬНЫЕ категории магазина (shopItems):
        // при сохранении уровня для них автоматически создаётся скрытый товар в магазине
        // (hidden:true), который выдаётся игроку в инвентарь — экипировка работает
        // через уже существующую систему (users/{uid}/equipped.frame/badge/nickColor/decorations),
        // и такой предмет также появится в разделе «Мои трофеи» в shop.html.


        export function pad2v(n) { return String(n).padStart(2, '0'); }

        export function passNickAccent(userId) {
            const u = state.usersData.find(x => x.id === userId);
            const c = u && u.equipped && u.equipped.passAccent;
            return c ? `color:${c};` : '';
        }

        export function nickColorStyle(userId) {
            const u = state.usersData.find(x => x.id === userId);
            const colorId = u && u.equipped && u.equipped.nickColor;
            if (!colorId) return '';
            const item = state.shopItemsData.find(i => i.id === colorId);
            if (!item || !item.color) return '';
            return `color:${item.color};`;
        }



        // === Мини-плеер YouTube («отдохнуть», удержание пользователей) ===


        export function extractYoutubeId(input) {
            if (!input) return null;
            const trimmed = input.trim();
            if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
            const patterns = [
                /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
            ];
            for (const re of patterns) {
                const m = trimmed.match(re);
                if (m) return m[1];
            }
            return null;
        }



        document.getElementById('btn-open-yt').onclick = function() {
            if (!state.youtubeVideoId) return;
            document.getElementById('yt-mini-frame-wrap').innerHTML =
                `<iframe src="https://www.youtube.com/embed/${state.youtubeVideoId}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
            document.getElementById('yt-mini-player').classList.remove('hidden');
        };

        document.getElementById('btn-close-yt').onclick = function() {
            document.getElementById('yt-mini-player').classList.add('hidden');
            document.getElementById('yt-mini-frame-wrap').innerHTML = ''; // сброс iframe останавливает видео
        };
        


        export function formatDate(ts) {
            if (!ts) return '';
            const d = new Date(ts);
            return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' в ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        }



        // === Время на сайте ===


        export function formatTimeSpent(ms) {
            if (!ms || ms < 60000) return 'меньше минуты';
            const totalMin = Math.floor(ms / 60000);
            const h = Math.floor(totalMin / 60);
            const m = totalMin % 60;
            if (h <= 0) return `${m} мин`;
            return `${h} ч ${m} мин`;
        }

        export function lastSeenText(ts) {
            if (!ts) return 'не в сети';
            const diff = Date.now() - ts;
            if (diff < 120000) return '🟢 в сети';
            if (diff < 86400000) return 'был(а) недавно';
            return 'офлайн';
        }

        export function avatarHtml(name, avatarUrl, cls) {
            if (avatarUrl) return `<img src="${avatarUrl}" class="${cls}">`;
            return `<div class="${cls}-fallback" style="background:${colorFor(name || '')}">${initialOf(name)}</div>`;
        }

        export function saveLocal(key, val) { 
            localStorage.setItem(key, JSON.stringify(val)); 
        }

        export function withTimeout(promise, ms, timeoutMessage) {
            return Promise.race([
                promise, 
                new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms))
            ]);
        }

        export function friendlyDbError(err) {
            const msg = (err && err.message) || String(err);
            if (msg.includes('PERMISSION_DENIED')) return 'Нет доступа к базе данных.';
            return 'Ошибка: ' + msg;
        }



        // Получи бесплатный ключ на https://api.imgbb.com/ (регистрация по email, карта не нужна)
        // и вставь его сюда вместо строки ниже.


        export function friendlyUploadError(err) {
            const msg = (err && err.message) || String(err);
            if (msg.includes('ключ ImgBB')) return msg;
            if (msg.includes('зависла')) return 'Слабое соединение — загрузка прервана. Попробуйте ещё раз.';
            if (msg.includes('Сетевая ошибка') || msg.includes('network')) return 'Проблема с интернет-соединением. Проверьте сеть и попробуйте снова.';
            return 'Ошибка загрузки: ' + msg;
        }



        // Сжимает изображение на устройстве перед загрузкой (уменьшает размер и время аплоада).
        // Если файл маленький/не картинка для canvas — просто отдаём исходный файл.


        export function compressImage(file, maxDim = 1600, quality = 0.82) {
            return new Promise((resolve) => {
                try {
                    const img = new Image();
                    const objectUrl = URL.createObjectURL(file);
                    img.onload = () => {
                        URL.revokeObjectURL(objectUrl);
                        let { width, height } = img;
                        if (width <= maxDim && height <= maxDim && file.size <= 1.2 * 1024 * 1024) {
                            resolve(file); // и так маленькое — не трогаем
                            return;
                        }
                        const scale = Math.min(1, maxDim / Math.max(width, height));
                        const w = Math.round(width * scale);
                        const h = Math.round(height * scale);
                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, w, h);
                        canvas.toBlob((blob) => {
                            if (!blob) { resolve(file); return; }
                            const compressed = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
                            resolve(compressed.size < file.size ? compressed : file);
                        }, 'image/jpeg', quality);
                    };
                    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
                    img.src = objectUrl;
                } catch (e) { resolve(file); }
            });
        }



        // Грузит файл на ImgBB через XHR (нужен именно XHR, а не fetch — чтобы получать
        // реальный прогресс загрузки). Таймаут — только если прогресс завис на STALL_MS,
        // а не по общему жёсткому лимиту.


        export function uploadToImgbb(file, onProgress, stallMs = 25000) {
            return new Promise((resolve, reject) => {
                if (!IMGBB_API_KEY || IMGBB_API_KEY.includes('ВСТАВЬ_СЮДА')) {
                    reject(new Error('Не задан ключ ImgBB. Получи бесплатный ключ на api.imgbb.com и вставь в код (IMGBB_API_KEY).'));
                    return;
                }

                const formData = new FormData();
                formData.append('image', file);

                const xhr = new XMLHttpRequest();
                xhr.open('POST', `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`);

                let lastPct = -1;
                let stallTimer = null;
                const resetStallTimer = () => {
                    if (stallTimer) clearTimeout(stallTimer);
                    stallTimer = setTimeout(() => {
                        xhr.abort();
                        reject(new Error('Загрузка зависла — нет соединения'));
                    }, stallMs);
                };
                resetStallTimer();

                xhr.upload.onprogress = (e) => {
                    if (!e.lengthComputable) return;
                    const pct = Math.round((e.loaded / e.total) * 100);
                    if (pct !== lastPct) { lastPct = pct; resetStallTimer(); if (onProgress) onProgress(pct); }
                };

                xhr.onload = () => {
                    if (stallTimer) clearTimeout(stallTimer);
                    let res;
                    try { res = JSON.parse(xhr.responseText); } catch (e) { reject(new Error('Некорректный ответ сервера')); return; }
                    if (xhr.status >= 200 && xhr.status < 300 && res && res.success) {
                        resolve(res.data.url);
                    } else {
                        reject(new Error((res && res.error && res.error.message) || ('Сервер вернул ошибку ' + xhr.status)));
                    }
                };
                xhr.onerror = () => { if (stallTimer) clearTimeout(stallTimer); reject(new Error('Сетевая ошибка')); };
                xhr.send(formData);
            });
        }



        // === Вложения в чат/комментарии (фото, видео, аудио через "скрепку") ===
        // Фото по-прежнему грузятся на ImgBB. Видео и аудио — на Cloudinary (тоже бесплатно, без карты).
        // Получить бесплатно: cloudinary.com → Dashboard (Cloud name) → Settings → Upload →
        // Add upload preset → Signing Mode: Unsigned → сохранить и вписать имя пресета сюда.


        export function categoryForMime(mime) {
            if (!mime) return null;
            if (mime.startsWith('image/')) return 'image';
            if (mime.startsWith('video/')) return 'video';
            if (mime.startsWith('audio/')) return 'audio';
            return null;
        }

        export function uploadToCloudinary(file, onProgress, stallMs = 40000) {
            return new Promise((resolve, reject) => {
                if (!CLOUDINARY_CLOUD_NAME || CLOUDINARY_CLOUD_NAME.includes('ВСТАВЬ_СЮДА') || !CLOUDINARY_UPLOAD_PRESET || CLOUDINARY_UPLOAD_PRESET.includes('ВСТАВЬ_СЮДА')) {
                    reject(new Error('Не задан Cloudinary (CLOUDINARY_CLOUD_NAME / CLOUDINARY_UPLOAD_PRESET). См. инструкцию в коде рядом с этими константами.'));
                    return;
                }

                const formData = new FormData();
                formData.append('file', file);
                formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

                const xhr = new XMLHttpRequest();
                xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`);

                let lastPct = -1;
                let stallTimer = null;
                const resetStallTimer = () => {
                    if (stallTimer) clearTimeout(stallTimer);
                    stallTimer = setTimeout(() => {
                        xhr.abort();
                        reject(new Error('Загрузка зависла — нет соединения'));
                    }, stallMs);
                };
                resetStallTimer();

                xhr.upload.onprogress = (e) => {
                    if (!e.lengthComputable) return;
                    const pct = Math.round((e.loaded / e.total) * 100);
                    if (pct !== lastPct) { lastPct = pct; resetStallTimer(); if (onProgress) onProgress(pct); }
                };

                xhr.onload = () => {
                    if (stallTimer) clearTimeout(stallTimer);
                    let res;
                    try { res = JSON.parse(xhr.responseText); } catch (e) { reject(new Error('Некорректный ответ сервера')); return; }
                    if (xhr.status >= 200 && xhr.status < 300 && res && res.secure_url) {
                        resolve(res.secure_url);
                    } else {
                        reject(new Error((res && res.error && res.error.message) || ('Сервер вернул ошибку ' + xhr.status)));
                    }
                };
                xhr.onerror = () => { if (stallTimer) clearTimeout(stallTimer); reject(new Error('Сетевая ошибка')); };
                xhr.send(formData);
            });
        }



        // Единая точка входа для вложений из "скрепки": сама решает, куда грузить — ImgBB или Cloudinary
        async function uploadAttachmentFile(file, onProgress) {
            const category = categoryForMime(file.type);
            if (!category) throw new Error('Этот тип файла не поддерживается. Можно фото, видео или аудио.');

            if (category === 'image') {
                const compressed = await compressImage(file);
                const url = await uploadToImgbb(compressed, onProgress);
                return { url, type: 'image', mime: compressed.type };
            }

            const maxSize = 50 * 1024 * 1024;
            if (file.size > maxSize) throw new Error('Файл слишком большой (максимум 50 МБ)');

            const url = await uploadToCloudinary(file, onProgress);
            return { url, type: category, mime: file.type };
        }



        export function setupAttachmentPicker(fileInputId, onUploaded) {
            const fileInput = document.getElementById(fileInputId);
            if (!fileInput) return;
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const label = document.querySelector(`label[for="${fileInputId}"]`);
                const originalContent = label ? label.textContent : '';
                if (label) { label.style.pointerEvents = 'none'; label.textContent = '⏳'; }

                try {
                    const attachment = await uploadAttachmentFile(file, (pct) => {
                        if (label) label.textContent = pct < 100 ? pct + '%' : '⏳';
                    });
                    await onUploaded(attachment);
                    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                } catch (err) {
                    tg.showAlert((err && err.message) || 'Ошибка загрузки вложения');
                } finally {
                    if (label) { label.style.pointerEvents = ''; label.textContent = originalContent; }
                    fileInput.value = '';
                }
            });
        }

        export function attachmentHtml(att) {
            if (!att) return '';
            if (att.type === 'image') return `<img src="${att.url}" class="attachment-img" onerror="this.style.display='none'">`;
            if (att.type === 'video') return `<video src="${att.url}" class="attachment-video" controls playsinline></video>`;
            if (att.type === 'audio') return `<audio src="${att.url}" class="attachment-audio" controls></audio>`;
            return '';
        }

        export function setupImageUploadFlex(fileInput, textInput, btn, pathPrefix, onDone) {
            if (!fileInput || !btn) return;
            fileInput.addEventListener('change', async (e) => {
                let file = e.target.files[0];
                if (!file) return;

                if (!file.type.startsWith('image/')) { 
                    tg.showAlert('Выберите файл изображения'); 
                    fileInput.value = ''; 
                    return; 
                }
                if (file.size > 30 * 1024 * 1024) { 
                    tg.showAlert('Файл слишком большой (максимум 30 МБ)'); 
                    fileInput.value = ''; 
                    return; 
                }
                
                btn.classList.add('uploading'); 
                btn.textContent = '⏳';

                const attemptUpload = async (isRetry = false) => {
                    try {
                        file = await compressImage(file);

                        const url = await uploadToImgbb(file, (pct) => {
                            btn.textContent = pct < 100 ? pct + '%' : '⏳';
                        });

                        if (textInput) textInput.value = url;
                        if (onDone) onDone(url);
                        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                    } catch (err) {
                        // Одна автоматическая повторная попытка при обрыве соединения
                        if (!isRetry) {
                            await attemptUpload(true);
                            return;
                        }
                        tg.showAlert(friendlyUploadError(err));
                    }
                };

                try {
                    await attemptUpload(false);
                } finally {
                    btn.classList.remove('uploading');
                    btn.textContent = '📁';
                    fileInput.value = '';
                }
            });
        }

        export function setupImageUpload(fileInputId, textInputId, uploadBtnId, pathPrefix, onDone) {
            setupImageUploadFlex(
                document.getElementById(fileInputId), 
                document.getElementById(textInputId), 
                document.getElementById(uploadBtnId), 
                pathPrefix, 
                onDone
            );
        }



        setupImageUpload('book-cover-file', 'book-cover', 'book-cover-upload-btn', 'books');
        setupImageUpload('banner-image-file', 'banner-image', 'banner-image-upload-btn', 'banners');
        setupImageUpload('profile-avatar-file', 'profile-avatar-input', 'profile-avatar-upload-btn', 'avatars');
        setupImageUpload('profile-banner-file', 'profile-banner-input', 'profile-banner-upload-btn', 'banners');
        setupImageUpload('sticker-file', 'sticker-url-input', 'sticker-upload-btn', 'stickers');
        setupImageUpload('boss-image-file', 'boss-image', 'boss-image-upload-btn', 'boss');
        setupImageUpload('boss-reward-image-file', 'boss-reward-image', 'boss-reward-image-upload-btn', 'boss');
        setupImageUpload('event-image-file', 'event-image', 'event-image-upload-btn', 'events');
        setupImageUpload('card-image-file', 'card-image', 'card-image-upload-btn', 'cards');
        setupImageUpload('pack-image-file', 'pack-image', 'pack-image-upload-btn', 'card-packs');
        setupImageUpload('frame-file-common', 'frame-image-common', 'frame-upload-btn-common', 'card-frames');
        setupImageUpload('frame-file-rare', 'frame-image-rare', 'frame-upload-btn-rare', 'card-frames');
        setupImageUpload('frame-file-epic', 'frame-image-epic', 'frame-upload-btn-epic', 'card-frames');
        setupImageUpload('frame-file-legendary', 'frame-image-legendary', 'frame-upload-btn-legendary', 'card-frames');
        setupImageUpload('group-avatar-file', 'group-avatar', 'group-avatar-upload-btn', 'avatars');
        setupImageUpload('edit-group-avatar-file', 'edit-group-avatar', 'edit-group-avatar-upload-btn', 'avatars');
        setupImageUpload('arena-image-file', 'arena-image', 'arena-image-upload-btn', 'arenas');
        setupImageUpload('story-boss-image-file', 'story-boss-image', 'story-boss-image-upload-btn', 'story');
        setupImageUpload('story-global-bg-file', 'story-global-bg', 'story-global-bg-upload-btn', 'story');



        // ===================== СЮЖЕТНЫЙ РЕЖИМ: ДИАЛОГИ (ВИЗУАЛЬНАЯ НОВЕЛЛА) =====================

        let storyDialogueQueue = [];
        let storyDialogueOnDone = null;
        let storyDialogueAvatar = '';
        let storyDialogueBossName = '';

        const STORY_PLAYER_SPEAKER_NAMES = ['ты', 'игрок', 'player', 'you'];

        function renderStoryDialogueLine() {
            const box = document.getElementById('story-dialogue-box');
            if (!box) return;
            const line = storyDialogueQueue[0];
            if (!line) { window.advanceStoryDialogue(); return; }

            const isPlayer = STORY_PLAYER_SPEAKER_NAMES.includes((line.speaker || '').trim().toLowerCase());
            const avatarHtml = isPlayer
                ? `<div class="story-dlg-avatar story-dlg-avatar-player">🧑</div>`
                : (storyDialogueAvatar
                    ? `<img src="${storyDialogueAvatar}" class="story-dlg-avatar" onerror="this.outerHTML='<div class=&quot;story-dlg-avatar&quot; style=&quot;background:${colorFor(storyDialogueBossName)}&quot;>${initialOf(storyDialogueBossName)}</div>';">`
                    : `<div class="story-dlg-avatar" style="background:${colorFor(storyDialogueBossName)}">${initialOf(storyDialogueBossName)}</div>`);

            box.innerHTML = `
                ${avatarHtml}
                <div class="story-dlg-textwrap">
                    <div class="story-dlg-name">${escapeHtml(line.speaker || storyDialogueBossName || 'Соперник')}</div>
                    <div class="story-dlg-text">${escapeHtml(line.text || '')}</div>
                    <div class="story-dlg-hint">${storyDialogueQueue.length > 1 ? 'Тапни, чтобы продолжить ▶' : 'Тапни, чтобы закрыть ✓'}</div>
                </div>`;
        }

        // Показывает очередь диалоговых реплик поверх всего интерфейса (перед боем, по ходам, после боя).
        // lines: [{speaker, text}], avatarUrl/bossName — для портрета соперника, onDone — вызывается после закрытия.
        export function showStoryDialogue(lines, avatarUrl, bossName, onDone) {
            const overlay = document.getElementById('story-dialogue-overlay');
            if (!overlay || !lines || !lines.length) { if (onDone) onDone(); return; }

            storyDialogueQueue = lines.slice();
            storyDialogueOnDone = onDone || null;
            storyDialogueAvatar = avatarUrl || '';
            storyDialogueBossName = bossName || 'Соперник';

            overlay.classList.add('active');
            renderStoryDialogueLine();
        }

        window.advanceStoryDialogue = function () {
            storyDialogueQueue.shift();
            if (!storyDialogueQueue.length) {
                const overlay = document.getElementById('story-dialogue-overlay');
                if (overlay) overlay.classList.remove('active');
                const cb = storyDialogueOnDone;
                storyDialogueOnDone = null;
                if (cb) cb();
                return;
            }
            renderStoryDialogueLine();
        };

        window.skipStoryDialogue = function (event) {
            if (event) event.stopPropagation();
            storyDialogueQueue = [];
            const overlay = document.getElementById('story-dialogue-overlay');
            if (overlay) overlay.classList.remove('active');
            const cb = storyDialogueOnDone;
            storyDialogueOnDone = null;
            if (cb) cb();
        };

        export function createPostImageField(containerId, url = '') {
            const id = 'img_' + Math.random().toString(36).substr(2, 9);
            const div = document.createElement('div');
            div.className = 'image-field-row dynamic-img-row';
            div.innerHTML = `
                <input type="text" class="input post-image-input" placeholder="Ссылка на картинку" value="${escapeHtml(url)}">
                <label class="upload-btn" for="file_${id}" id="btn_${id}">📁</label>
                <input type="file" id="file_${id}" accept="image/*" class="hidden">
                <button class="icon-btn danger" onclick="this.parentElement.remove()" style="width:48px;height:48px;flex-shrink:0;">🗑</button>
            `;
            document.getElementById(containerId).appendChild(div);
            setupImageUploadFlex(div.querySelector(`#file_${id}`), div.querySelector('.post-image-input'), div.querySelector(`#btn_${id}`), 'posts');
        }

        window.createPostImageField = createPostImageField;



        document.getElementById('btn-admin-add-image').onclick = () => createPostImageField('admin-post-images-container');
        document.getElementById('btn-compose-add-image').onclick = () => createPostImageField('compose-images-container');



        export function getImagesFromContainer(containerId) {
            return Array.from(document.getElementById(containerId).querySelectorAll('.post-image-input')).map(inp => inp.value.trim()).filter(Boolean);
        }

        export function populateImagesContainer(containerId, imagesArr) {
            document.getElementById(containerId).innerHTML = '';
            imagesArr.forEach(url => createPostImageField(containerId, url));
        }

        export function truncateText(str, n) {
            if (!str) return '';
            const s = String(str);
            return s.length > n ? s.slice(0, n) + '…' : s;
        }

        export function notificationsAllowed() {
            return ('Notification' in window) 
                && Notification.permission === 'granted' 
                && localStorage.getItem('sr_notifications_enabled') !== '0';
        }

        export function showNotification(title, body, tag) {
            if (!notificationsAllowed()) return;
            // Не шлём, если вкладка и так открыта и активна — человек и так всё видит
            if (document.visibilityState === 'visible' && document.hasFocus()) return;
            try {
                const n = new Notification(title, { body, tag });
                n.onclick = () => { window.focus(); n.close(); };
            } catch (e) { /* некоторые WebView могут блокировать Notification API — просто игнорируем */ }
        }



        // === Тема оформления (задаётся админом на весь сайт) ===


        export function applyTheme(theme) {
            state.currentTheme = theme || 'light';
            document.body.classList.toggle('theme-dark', state.currentTheme === 'dark');
            document.body.classList.toggle('theme-terraria', state.currentTheme === 'terraria');
            applyTerrariaFeatures();
        }



        // === Звуковое сопровождение (URL-ы задаются админом) ===


        export function soundAllowed() {
            return localStorage.getItem('sr_sound_enabled') !== '0';
        }

        export function playSound(key) {
            if (!soundAllowed()) return;
            const url = state.soundsData[key];
            if (!url) return;
            try {
                const a = new Audio(url);
                a.volume = 0.55;
                a.play().catch(() => {});
            } catch (e) {}
        }



        // === Спецэффекты (включаются админом) ===



        export function confettiBurst() {
            if (!state.effectsData.confetti) return;
            const colors = ['#ff9f0a', '#ed8f03', '#4fc3f7', '#81c784', '#ba68c8', '#f06292'];
            const container = document.createElement('div');
            container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:hidden;';
            document.body.appendChild(container);

            for (let i = 0; i < 26; i++) {
                const piece = document.createElement('div');
                const size = 6 + Math.random() * 6;
                const startX = 50 + (Math.random() * 30 - 15);
                const endX = startX + (Math.random() * 40 - 20);
                const rotate = Math.random() * 720 - 360;
                const duration = 1.2 + Math.random() * 0.8;
                piece.style.cssText = `
                    position:absolute; top:35%; left:${startX}%; width:${size}px; height:${size * 1.4}px;
                    background:${colors[i % colors.length]}; border-radius:2px;
                    transform:translate(-50%,-50%); opacity:1;
                    animation: confettiFall ${duration}s cubic-bezier(0.25,0.46,0.45,0.94) forwards;
                    --end-x: ${endX}%;
                    --rotate: ${rotate}deg;
                `;
                container.appendChild(piece);
            }
            setTimeout(() => container.remove(), 2200);
        }

        export function renderAmbientParticles() {
            const existing = document.getElementById('ambient-particles');
            if (!state.effectsData.particles) { if (existing) existing.remove(); return; }
            if (existing) return; // уже отрисованы

            const container = document.createElement('div');
            container.id = 'ambient-particles';
            container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1;overflow:hidden;';
            const emojis = ['✨', '⭐', '🌟'];
            for (let i = 0; i < 12; i++) {
                const p = document.createElement('div');
                const left = Math.random() * 100;
                const delay = Math.random() * 6;
                const duration = 6 + Math.random() * 6;
                const size = 10 + Math.random() * 10;
                p.textContent = emojis[i % emojis.length];
                p.style.cssText = `
                    position:absolute; left:${left}%; bottom:-30px; font-size:${size}px; opacity:0.25;
                    animation: float ${duration}s ease-in-out ${delay}s infinite;
                `;
                container.appendChild(p);
            }
            document.body.appendChild(container);
        }



        // ==================================================================
        // ДОПОЛНИТЕЛЬНЫЕ ФИЧИ ТЕМЫ TERRARIA (управляются из админ-панели)
        // ==================================================================



        export function applyTerrariaFeatures() {
            const active = state.currentTheme === 'terraria';

            // 5. Трава на карточках / 6. курсор-кирка / 7. свечение галочки — простые CSS-классы на body
            document.body.classList.toggle('terraria-grass-on', active && !!state.terrariaData.grass);
            document.body.classList.toggle('terraria-cursor-on', active && !!state.terrariaData.cursor);
            document.body.classList.toggle('terraria-oreglow-on', active && !!state.terrariaData.oreGlow);

            // 1. День/ночь
            const dayNightOn = active && !!state.terrariaData.dayNight;
            if (dayNightOn) {
                updateTerrariaDayNight();
                if (!state.terrariaDayNightTimer) state.terrariaDayNightTimer = setInterval(updateTerrariaDayNight, 5 * 60 * 1000);
            } else {
                if (state.terrariaDayNightTimer) { clearInterval(state.terrariaDayNightTimer); state.terrariaDayNightTimer = null; }
                document.getElementById('terraria-daynight-overlay').style.opacity = 0;
                document.getElementById('terraria-daynight-stars').style.opacity = 0;
            }

            // 2. Прогресс чтения как Boss HP — просто переключаем класс, содержимое обновляется в openChapter/renderChapterListView
            const questHpOn = active && !!state.terrariaData.questHp;
            document.getElementById('reader-progress-wrap').classList.toggle('terraria-questhp-bar', questHpOn);
            if (!questHpOn) document.getElementById('reader-boss-label').style.display = 'none';

            // 3. Пиксельные иконки навигации
            applyTerrariaPixelIcons(active && !!state.terrariaData.pixelIcons);
        }

        export function updateTerrariaDayNight() {
            const hour = new Date().getHours() + new Date().getMinutes() / 60;
            // ночь 22:00–5:00 (макс.), плавные переходы рассвет 5–8 и закат 18–22
            let factor = 0;
            if (hour >= 22 || hour < 5) factor = 1;
            else if (hour >= 5 && hour < 8) factor = 1 - (hour - 5) / 3;
            else if (hour >= 8 && hour < 18) factor = 0;
            else if (hour >= 18 && hour < 22) factor = (hour - 18) / 4;
            document.getElementById('terraria-daynight-overlay').style.opacity = (factor * 0.88).toFixed(2);
            document.getElementById('terraria-daynight-stars').style.opacity = (factor * 0.9).toFixed(2);
        }



        // Генератор простых пиксельных SVG-иконок из битовой карты


        export function pixelSvg(bitmap, cell) {
            cell = cell || 4;
            const dim = bitmap.length * cell;
            let rects = '';
            bitmap.forEach((row, y) => {
                for (let x = 0; x < row.length; x++) {
                    if (row[x] === '1') rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="currentColor"/>`;
                }
            });
            return `<svg viewBox="0 0 ${dim} ${dim}">${rects}</svg>`;
        }

        export function applyTerrariaPixelIcons(enable) {
            const iconEls = document.querySelectorAll('.bottom-nav .nav-btn .icon');
            iconEls.forEach((iconEl, idx) => {
                const textNode = Array.from(iconEl.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
                if (!textNode) return;
                if (enable) {
                    if (!iconEl.dataset.pixelApplied) {
                        iconEl.dataset.originalEmoji = textNode.textContent;
                        const span = document.createElement('span');
                        span.className = 'pixel-icon-svg';
                        span.innerHTML = pixelSvg(TERRARIA_PIXEL_BITMAPS[idx] || TERRARIA_PIXEL_BITMAPS[0]);
                        textNode.parentNode.insertBefore(span, textNode);
                        textNode.textContent = '';
                        iconEl.dataset.pixelApplied = '1';
                    }
                } else if (iconEl.dataset.pixelApplied) {
                    const span = iconEl.querySelector('.pixel-icon-svg');
                    if (span) span.remove();
                    textNode.textContent = iconEl.dataset.originalEmoji || '';
                    delete iconEl.dataset.pixelApplied;
                }
            });
        }



        // 4. Тосты ачивок в стиле игры


        export function showTerrariaToast(title, text, icon) {
            if (!(state.currentTheme === 'terraria' && state.terrariaData.achievements)) return;
            const el = document.createElement('div');
            el.className = 'terraria-toast';
            el.innerHTML = `<span class="tt-icon">${icon || '🏆'}</span><div><div class="tt-title">${escapeHtml(title)}</div><div class="tt-text">${escapeHtml(text)}</div></div>`;
            document.body.appendChild(el);
            requestAnimationFrame(() => el.classList.add('show'));
            setTimeout(() => {
                el.classList.remove('show');
                setTimeout(() => el.remove(), 600);
            }, 3800);
        }



        // Обновляет подпись Boss HP над прогресс-баром читалки (вызывается из openChapter/renderChapterListView)


        export function updateReaderBossLabel(readCount, total) {
            const label = document.getElementById('reader-boss-label');
            const on = state.currentTheme === 'terraria' && !!state.terrariaData.questHp;
            if (!on || !total) { label.style.display = 'none'; return; }
            const bossName = state.terrariaData.questHpLabel || 'Виверна Бездны';
            const remaining = Math.max(0, total - readCount);
            label.style.display = 'flex';
            label.innerHTML = `<span>🐲 ${escapeHtml(bossName)}</span><span>${remaining} / ${total} HP</span>`;
        }

        export function renderNotificationsToggle() {
            const btn = document.getElementById('btn-toggle-notifications');
            if (!('Notification' in window)) { btn.classList.add('hidden'); return; } // не поддерживается этим браузером/WebView
            btn.classList.remove('hidden');

            if (Notification.permission === 'denied') {
                btn.textContent = '🔕 Уведомления заблокированы в браузере';
                return;
            }
            if (Notification.permission === 'default') {
                btn.textContent = '🔔 Включить уведомления';
                return;
            }
            const enabled = localStorage.getItem('sr_notifications_enabled') !== '0';
            btn.textContent = enabled ? '🔔 Уведомления: вкл' : '🔕 Уведомления: выкл';
        }

        export function renderSoundToggle() {
            const btn = document.getElementById('btn-toggle-sound');
            btn.textContent = soundAllowed() ? '🔊 Звук: вкл' : '🔇 Звук: выкл';
        }



        document.getElementById('btn-toggle-sound').onclick = function() {
            const enabled = soundAllowed();
            localStorage.setItem('sr_sound_enabled', enabled ? '0' : '1');
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            renderSoundToggle();
            if (!enabled) playSound('coin'); // короткий тестовый звук, чтобы сразу услышать эффект от включения
        };

        document.getElementById('btn-toggle-notifications').onclick = function() {
            if (!('Notification' in window)) return;

            if (Notification.permission === 'denied') {
                tg.showAlert('Уведомления заблокированы в настройках браузера для этого сайта. Разреши их вручную в настройках сайта, чтобы включить.');
                return;
            }
            if (Notification.permission === 'default') {
                Notification.requestPermission().then((perm) => {
                    if (perm === 'granted') localStorage.setItem('sr_notifications_enabled', '1');
                    renderNotificationsToggle();
                    renderSoundToggle();
                });
                return;
            }
            const enabled = localStorage.getItem('sr_notifications_enabled') !== '0';
            localStorage.setItem('sr_notifications_enabled', enabled ? '0' : '1');
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            renderNotificationsToggle();
                    renderSoundToggle();
        };

        // === Монеты за ежедневный вход ===


        export function formatCountdown(ms) {
            if (ms <= 0) return 'Началось!';
            const totalSec = Math.floor(ms / 1000);
            const days = Math.floor(totalSec / 86400);
            const hours = Math.floor((totalSec % 86400) / 3600);
            const mins = Math.floor((totalSec % 3600) / 60);
            const secs = totalSec % 60;
            const pad = n => String(n).padStart(2, '0');
            if (days > 0) return `${days}д ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
            return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
        }

        export function pad2(n) { return String(n).padStart(2, '0'); }

        export function toLocalInputValue(ts) {
            if (!ts) return '';
            const d = new Date(ts);
            return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
        }

        export function setupSoundUploadField(fileInputId, textInputId, btnId) {
            const fileInput = document.getElementById(fileInputId);
            const btn = document.getElementById(btnId);
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const original = btn.textContent;
                btn.textContent = '⏳';
                btn.style.pointerEvents = 'none';
                try {
                    const attachment = await uploadAttachmentFile(file, (pct) => { btn.textContent = pct < 100 ? pct + '%' : '⏳'; });
                    document.getElementById(textInputId).value = attachment.url;
                } catch (err) {
                    tg.showAlert((err && err.message) || 'Ошибка загрузки звука');
                } finally {
                    btn.textContent = original;
                    btn.style.pointerEvents = '';
                    fileInput.value = '';
                }
            });
        }


        setupSoundUploadField('sound-newMessage-file', 'sound-newMessage', 'sound-newMessage-btn');
        setupSoundUploadField('sound-newPost-file', 'sound-newPost', 'sound-newPost-btn');
        setupSoundUploadField('sound-coin-file', 'sound-coin', 'sound-coin-btn');
        setupSoundUploadField('arena-bgm-file', 'arena-bgm', 'arena-bgm-upload-btn');

        // АДМИН - КНИГИ И ГЛАВЫ
