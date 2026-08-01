import { ref, push, update, remove, set, get, increment } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { EMOJIS } from './constants.js';
import { attachmentHtml, avatarHtml, colorFor, confettiBurst, escapeHtml, formatCountdown, formatDate, friendlyDbError, getImagesFromContainer, initialOf, nickColorStyle, playSound, populateImagesContainer, setupAttachmentPicker, shopBadgeHtml, verifiedBadge } from './utils.js';
import { awardPassXP, passVipBadge } from './pass.js';
import { openUserProfile } from './profile.js';

export function myReactionOptions() {
            const me = state.usersData.find(u => u.id === state.currentUser.id);
            const custom = (me && me.pass && me.pass.unlocked && me.pass.unlocked.reactions) ? Object.values(me.pass.unlocked.reactions) : [];
            return [...EMOJIS, ...custom];
        }

        export function reactionButtonInner(e) {
            return /^https?:\/\//.test(e) ? `<img src="${e}" style="width:18px;height:18px;vertical-align:middle;">` : e;
        }

        export function currentMultiplier() {
            let mult = 1;
            if (state.economyData.eventMultiplierUntil && Date.now() < state.economyData.eventMultiplierUntil) {
                mult *= (state.economyData.eventMultiplier || 1);
            }
            const me = state.usersData.find(u => u.id === state.currentUser.id);
            if (me && me.buffUntil && Date.now() < me.buffUntil) {
                mult *= (me.buffMultiplier || 1);
            }
            return mult;
        }

        export function renderEventMultiplierBanner() {
            const el = document.getElementById('event-multiplier-banner');
            if (!el) return;
            const active = state.economyData.eventMultiplierUntil && Date.now() < state.economyData.eventMultiplierUntil;
            if (active) {
                el.classList.remove('hidden');
                el.textContent = `⚡ Ивент! Монеты x${state.economyData.eventMultiplier} до ${formatDate(state.economyData.eventMultiplierUntil)}`;
            } else {
                el.classList.add('hidden');
            }
        }

        export function updateBannerCountdowns() {
            document.querySelectorAll('.banner-countdown[data-target]').forEach(el => {
                const target = Number(el.getAttribute('data-target'));
                el.textContent = '⏳ ' + formatCountdown(target - Date.now());
            });
        }



        // ============================================================
        // БОСС-ИВЕНТ
        // ============================================================


        export function renderBossCard() {
            const container = document.getElementById('boss-container');
            if (!container) return;
            if (!state.bossData || !state.bossData.enabled) { container.innerHTML = ''; return; }

            const hp = Math.max(0, state.bossData.hp || 0);
            const maxHp = state.bossData.maxHp || 1;
            const pct = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
            const defeated = hp <= 0;

            container.innerHTML = `
                <div class="boss-card">
                    <div class="boss-name">🐲 ${escapeHtml(state.bossData.name || 'Босс')}</div>
                    <div class="boss-sub">${defeated ? 'Повержен! Награды уже разлетелись победителям 🎉' : 'Бей босса и получи уникальную награду'}</div>
                    <div class="boss-image-wrap">
                        <img src="${escapeHtml(state.bossData.image || '')}" class="boss-image" alt="${escapeHtml(state.bossData.name || 'Босс')}">
                    </div>
                    <div class="boss-hp-bar"><div class="boss-hp-fill" style="width:${pct}%"></div></div>
                    <div class="boss-hp-text">${hp} / ${maxHp} HP</div>
                    ${defeated
                        ? `<button class="btn" disabled>Босс повержен</button>`
                        : `<button class="btn" onclick="hitBoss()">⚔️ Ударить (-${state.bossData.hitCost} 🪙)</button>`
                    }
                </div>
            `;
        }

        window.hitBoss = function() {
            if (!state.bossData || !state.bossData.enabled || (state.bossData.hp || 0) <= 0) return;

            const me = state.usersData.find(u => u.id === state.currentUser.id);
            const coins = (me && me.coins) || 0;
            if (coins < state.bossData.hitCost) {
                tg.showAlert('Недостаточно монет для удара (нужно ' + state.bossData.hitCost + ' 🪙)');
                return;
            }

            const dmg = Math.floor(Math.random() * (state.bossData.dmgMax - state.bossData.dmgMin + 1)) + state.bossData.dmgMin;

            update(ref(state.db, 'users/' + state.currentUser.id), { coins: increment(-state.bossData.hitCost) }).catch(() => {});
            update(ref(state.db, 'settings/boss'), { hp: increment(-dmg) }).catch(() => {});
            awardPassXP(20, 'boss');
            update(ref(state.db, 'bossParticipants/' + state.currentUser.id), {
                name: state.currentUser.name || 'Игрок',
                hits: increment(1),
                damage: increment(dmg)
            }).catch(() => {});

            playSound('coin');
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
            showBossHitFeedback(dmg);
        };

        export function showBossHitFeedback(dmg) {
            const img = document.querySelector('#boss-container .boss-image');
            const wrap = document.querySelector('#boss-container .boss-image-wrap');
            if (img) { img.classList.remove('hit'); void img.offsetWidth; img.classList.add('hit'); }
            if (wrap) {
                const popup = document.createElement('div');
                popup.className = 'boss-dmg-popup';
                popup.textContent = '-' + dmg;
                wrap.appendChild(popup);
                setTimeout(() => popup.remove(), 800);
            }
        }

        export function distributeBossRewards(boss, cb) {
            get(ref(state.db, 'bossParticipants')).then(snap => {
                const participants = snap.val() || {};
                const ids = Object.keys(participants);
                if (!ids.length || !boss.rewardItemId) { remove(ref(state.db, 'bossParticipants')).catch(()=>{}); if (cb) cb(); return; }

                const updates = {};
                ids.forEach(uid => { updates['users/' + uid + '/inventory/' + boss.rewardItemId] = true; });

                update(ref(state.db), updates)
                    .then(() => remove(ref(state.db, 'bossParticipants')))
                    .then(() => {
                        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                        confettiBurst();
                        if (cb) cb();
                    })
                    .catch(err => { tg.showAlert('Ошибка выдачи наград: ' + friendlyDbError(err)); if (cb) cb(); });
            }).catch(() => { if (cb) cb(); });
        }

        export function populateBossAdminForm() {
            const b = state.bossData;
            const statusEl = document.getElementById('boss-admin-status');
            if (statusEl) {
                statusEl.textContent = (b && b.enabled)
                    ? `🟢 Активен — HP ${Math.max(0, b.hp || 0)}/${b.maxHp}`
                    : '⚪ Не запущен';
            }
            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
            setVal('boss-name', b ? (b.name || '') : '');
            setVal('boss-image', b ? (b.image || '') : '');
            setVal('boss-maxhp', b ? (b.maxHp || '') : '');
            setVal('boss-hitcost', b ? (b.hitCost || '') : '');
            setVal('boss-dmg-min', b ? (b.dmgMin || '') : '');
            setVal('boss-dmg-max', b ? (b.dmgMax || '') : '');
            setVal('boss-reward-type', b ? (b.rewardType || 'frame') : 'frame');
            setVal('boss-reward-name', b ? (b.rewardName || '') : '');
            setVal('boss-reward-image', b ? (b.rewardImage || '') : '');
        }

        export function renderBossParticipantsList() {
            const el = document.getElementById('boss-participants-list');
            if (!el) return;
            const arr = Object.entries(state.bossParticipantsData || {}).map(([id, v]) => ({ id, ...v }))
                .sort((a, b) => (b.damage || 0) - (a.damage || 0));

            el.innerHTML = arr.length
                ? arr.map(p => `
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-soft);">
                        <span>${escapeHtml(p.name || p.id)}</span>
                        <span>${p.damage || 0} урона · ${p.hits || 0} ударов</span>
                    </div>`).join('')
                : 'Пока никто не бил босса';
        }



        document.getElementById('btn-boss-launch').onclick = function() {
            const name = document.getElementById('boss-name').value.trim();
            const image = document.getElementById('boss-image').value.trim();
            const maxHp = parseInt(document.getElementById('boss-maxhp').value, 10);
            const hitCost = parseInt(document.getElementById('boss-hitcost').value, 10);
            const dmgMin = parseInt(document.getElementById('boss-dmg-min').value, 10);
            const dmgMax = parseInt(document.getElementById('boss-dmg-max').value, 10);
            const rewardType = document.getElementById('boss-reward-type').value;
            const rewardName = document.getElementById('boss-reward-name').value.trim();
            const rewardImage = document.getElementById('boss-reward-image').value.trim();

            if (!name || !image) return tg.showAlert('Укажи имя и картинку босса');
            if (!maxHp || maxHp < 1) return tg.showAlert('Укажи корректное HP');
            if (!hitCost || hitCost < 1) return tg.showAlert('Укажи стоимость удара');
            if (!dmgMin || !dmgMax || dmgMin < 1 || dmgMin > dmgMax) return tg.showAlert('Проверь урон за удар (мин ≤ макс)');
            if (!rewardName || !rewardImage) return tg.showAlert('Укажи название и картинку награды');

            const rewardItemId = 'boss_' + Date.now();
            const bossPayload = {
                name, image, maxHp, hp: maxHp, hitCost, dmgMin, dmgMax,
                rewardType, rewardName, rewardImage, rewardItemId,
                enabled: true, defeated: false, startedAt: Date.now()
            };

            remove(ref(state.db, 'bossParticipants')).catch(() => {});
            set(ref(state.db, 'settings/boss'), bossPayload)
                .then(() => set(ref(state.db, 'shopItems/' + rewardItemId), {
                    name: rewardName, image: rewardImage, category: rewardType,
                    price: 0, hidden: true, createdAt: Date.now()
                }))
                .then(() => tg.showPopup({ title: 'Босс запущен!', message: 'Он появился на главной странице', buttons: [{ type: 'ok' }] }))
                .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        document.getElementById('btn-boss-stop').onclick = function() {
            if (!state.bossData || !state.bossData.enabled) return tg.showAlert('Босс сейчас не запущен');
            tg.showConfirm('Остановить босса и выдать награду всем, кто его бил?', (ok) => {
                if (!ok) return;
                distributeBossRewards(state.bossData, () => {
                    update(ref(state.db, 'settings/boss'), { enabled: false, defeated: true })
                        .then(() => tg.showPopup({ title: 'Готово', message: 'Награды выданы, босс остановлен', buttons: [{ type: 'ok' }] }))
                        .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
                });
            });
        };



        export function renderBanners() {
            const el = document.getElementById('banners-container');
            if (!el) return;
            if (!state.bannersData.length) { el.innerHTML = ''; return; }

            el.innerHTML = `<div class="banners-carousel">${state.bannersData.map(b => `
                <div class="banner-card ${b.type === 'solid' ? 'banner-solid' : ''}" style="${b.type === 'solid' ? `background-image:none;background-color:${b.color || '#ed8f03'};` : `background-image:url('${b.image || ''}')`}" data-link="${escapeHtml(b.link || '')}">
                    <div class="banner-card-overlay">
                        ${b.pinned ? `<div style="font-size:11px;font-weight:700;opacity:.85;margin-bottom:4px;">📌 ЗАКРЕПЛЕНО</div>` : ''}
                        <div class="banner-card-title">${escapeHtml(b.title || '')}</div>
                        ${b.type === 'event' && b.eventAt ? `<div class="banner-countdown" data-target="${b.eventAt}">⏳ ${formatCountdown(b.eventAt - Date.now())}</div>` : ''}
                    </div>
                </div>
            `).join('')}</div>`;

            el.querySelectorAll('.banner-card').forEach(card => {
                const link = card.getAttribute('data-link');
                if (!link) return;
                card.onclick = () => {
                    if (tg.openLink) tg.openLink(link); else window.open(link, '_blank');
                };
            });
        }

        export function renderFeed() {
            const container = document.getElementById('feed-container');
            let list = state.postsData;
            
            if (state.feedSearchTerm) {
                const q = state.feedSearchTerm.toLowerCase();
                list = list.filter(p => (p.title || '').toLowerCase().includes(q) || (p.text || '').toLowerCase().includes(q));
            }
            
            if (!list.length) {
                container.innerHTML = state.postsData.length
                    ? '<div class="empty-state"><span class="icon">🔍</span><div class="title">Ничего не найдено</div></div>'
                    : '<div class="empty-state"><span class="icon">📭</span><div class="title">Пока нет новостей</div></div>';
                return;
            }
            
            container.innerHTML = list.map((post, idx) => {
                const reactions = post.reactions || {};
                const counts = {};
                Object.values(reactions).forEach(e => { counts[e] = (counts[e] || 0) + 1; });
                const topReactions = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
                
                const commentsCount = post.comments ? Object.keys(post.comments).length : 0;
                const imagesArr = post.images || (post.image ? [post.image] : []);
                const coverImage = imagesArr.length > 0 ? imagesArr[0] : null;
                
                const authorRow = post.authorId ? `
                    <div class="post-author-row" data-author-id="${post.authorId}" data-author-name="${escapeHtml(post.authorName)}">
                        ${avatarHtml(post.authorName, post.authorAvatar, 'avatar-sm')}
                        <span class="post-author-name" style="${nickColorStyle(post.authorId)}">${escapeHtml(post.authorName)}${verifiedBadge(post.authorId)}${shopBadgeHtml(post.authorId)}${passVipBadge(post.authorId)}${post.authorId === state.currentUser.id ? ' (вы)' : ''}</span>
                    </div>` : '<div style="color:var(--text-secondary);font-size:13px;font-weight:600;margin-bottom:8px;">📰 Новость от редакции</div>';
                
                return `
                <div class="card tappable card-anim" style="animation-delay:${Math.min(idx, 8) * 40}ms" data-post-id="${post.id}">
                    ${post.pinned ? `<div style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#ed8f03;background:#fff4e0;padding:3px 9px;border-radius:10px;margin-bottom:8px;">📌 Закреплено</div>` : ''}
                    ${authorRow}
                    ${coverImage ? `<img src="${coverImage}" class="card-image" onerror="this.style.display='none'">` : `<div class="cover-fallback" style="background:${colorFor(post.title || '')}">${initialOf(post.title)}</div>`}
                    <div class="card-title">${escapeHtml(post.title)}</div>
                    <div class="card-text clamp">${escapeHtml(post.text)}</div>
                    <div class="card-meta">${formatDate(post.createdAt)}</div>
                    <div class="reaction-bar">
                        ${topReactions.length ? topReactions.map(([e, c]) => `<span class="reaction-btn">${e} ${c}</span>`).join('') : ''}
                        <span class="comment-count-btn" style="margin-top:0;">💬 ${commentsCount}</span>
                    </div>
                </div>`;
            }).join('');
            
            document.querySelectorAll('#feed-container .card').forEach(c => {
                c.onclick = () => openPost(c.dataset.postId);
            });
            
            document.querySelectorAll('#feed-container .post-author-row').forEach(row => {
                row.onclick = (e) => {
                    e.stopPropagation();
                    const aid = row.getAttribute('data-author-id');
                    if (aid) openUserProfile(aid);
                };
            });
        }



        document.getElementById('feed-search').addEventListener('input', (e) => { 
            state.feedSearchTerm = e.target.value; 
            renderFeed(); 
        });
        
        document.getElementById('refresh-feed-btn').onclick = function() { 
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium'); 
            renderFeed(); 
        };

        // === КОМПОУЗЕР ===


        export function resetComposeForm() {
            state.editingUserPostId = null;
            document.getElementById('compose-heading').textContent = 'Написать в ленту';
            document.getElementById('compose-title').value = '';
            document.getElementById('compose-images-container').innerHTML = '';
            document.getElementById('compose-text').value = '';
            document.getElementById('btn-submit-compose').textContent = 'Опубликовать';
        }


        
        document.getElementById('btn-open-compose').onclick = function() {
            resetComposeForm(); 
            document.getElementById('compose-overlay').classList.add('active'); 
            state.activeOverlay = 'compose'; 
            tg.BackButton.show();
        };
        
        document.getElementById('close-compose-btn').onclick = function() {
            document.getElementById('compose-overlay').classList.remove('active'); 
            state.activeOverlay = null; 
            tg.BackButton.hide();
        };
        


        export function editOwnPost(id) {
            const post = state.postsData.find(p => p.id === id);
            if (!post) return;
            
            state.editingUserPostId = id;
            document.getElementById('compose-heading').textContent = 'Редактировать пост';
            document.getElementById('compose-title').value = post.title || '';
            
            const imagesArr = post.images || (post.image ? [post.image] : []);
            populateImagesContainer('compose-images-container', imagesArr);
            
            document.getElementById('compose-text').value = post.text || '';
            document.getElementById('btn-submit-compose').textContent = 'Сохранить изменения';
            document.getElementById('post-overlay').classList.remove('active');
            document.getElementById('compose-overlay').classList.add('active');
            state.activeOverlay = 'compose'; 
            tg.BackButton.show();
        }

        window.editOwnPost = editOwnPost;


        
        document.getElementById('btn-submit-compose').onclick = function() {
            const title = document.getElementById('compose-title').value.trim();
            const text = document.getElementById('compose-text').value.trim();
            const imagesArr = getImagesFromContainer('compose-images-container');
            
            if (!title || !text) return tg.showAlert('Заполните заголовок и текст');
            if (!state.db) return tg.showAlert('Firebase не подключен');

            if (state.editingUserPostId) {
                update(ref(state.db, 'posts/' + state.editingUserPostId), { 
                    title: title, 
                    images: imagesArr, 
                    text: text 
                }).then(() => { 
                    document.getElementById('close-compose-btn').click(); 
                    tg.showPopup({ title: 'Сохранено', message: 'Пост обновлён', buttons: [{ type: 'ok' }] }); 
                }).catch(err => tg.showAlert('Ошибка обновления: ' + friendlyDbError(err)));
            } else {
                const me = state.usersData.find(u => u.id === state.currentUser.id);
                push(ref(state.db, 'posts'), {
                    title: title, 
                    images: imagesArr, 
                    text: text, 
                    createdAt: Date.now(),
                    authorId: state.currentUser.id, 
                    authorName: state.currentUser.name, 
                    authorAvatar: (me && me.avatar) || ''
                }).then(() => { 
                    document.getElementById('close-compose-btn').click(); 
                    tg.showPopup({ title: 'Опубликовано!', message: 'Ваш пост появился в ленте', buttons: [{ type: 'ok' }] }); 
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
            }
        };
        


        export function deleteOwnPost(id) {
            tg.showConfirm('Удалить этот пост?', (ok) => { 
                if (ok) {
                    remove(ref(state.db, 'posts/' + id))
                        .then(() => document.getElementById('close-post-btn').click())
                        .catch(err => tg.showAlert('Ошибка удаления: ' + friendlyDbError(err)));
                } 
            });
        }

        window.deleteOwnPost = deleteOwnPost;



        // === ОВЕРЛЕЙ ПОСТА ===


        export function openPost(id) {
            state.currentPostId = id; 
            state.activeOverlay = 'post';
            document.getElementById('comment-sticker-picker').style.display = 'none';
            renderPostOverlay();
            document.getElementById('post-overlay').classList.add('active'); 
            tg.BackButton.show();
        }

        window.openPost = openPost;

        export function renderPostOverlay() {
            const post = state.postsData.find(p => p.id === state.currentPostId);
            if (!post) return;
            
            document.getElementById('post-overlay-title').textContent = post.title;
            
            const reactions = post.reactions || {};
            const counts = {}; 
            Object.values(reactions).forEach(e => { counts[e] = (counts[e] || 0) + 1 });
            
            const comments = post.comments ? Object.entries(post.comments).map(([cid, c]) => ({ id: cid, ...c })).sort((a, b) => a.createdAt - b.createdAt) : [];
            const isOwner = post.authorId && post.authorId === state.currentUser.id;

            const authorBlock = post.authorId ? `
                <div class="post-author-row" style="margin-bottom:12px;" data-author-id="${post.authorId}" data-author-name="${escapeHtml(post.authorName)}">
                    ${avatarHtml(post.authorName, post.authorAvatar, 'avatar-sm')}
                    <span class="post-author-name" style="${nickColorStyle(post.authorId)}">${escapeHtml(post.authorName)}${verifiedBadge(post.authorId)}${shopBadgeHtml(post.authorId)}${passVipBadge(post.authorId)}</span>
                </div>` : '<div style="color:var(--text-secondary);font-size:13px;font-weight:600;margin-bottom:10px;">📰 Новость от редакции</div>';

            const imagesArr = post.images || (post.image ? [post.image] : []);
            const imagesHtml = imagesArr.map(url => `<img src="${url}" style="width:100%; border-radius:16px; margin-bottom:12px; box-shadow: 0 4px 16px rgba(0,0,0,0.05);" onerror="this.style.display='none'">`).join('');

            document.getElementById('post-overlay-content').innerHTML = `
                ${authorBlock} 
                ${imagesHtml}
                <div style="font-size:15px;line-height:1.6;color:var(--text-primary);white-space:pre-wrap;">${escapeHtml(post.text)}</div>
                <div class="card-meta" style="margin-top: 12px;">${formatDate(post.createdAt)}</div>
                
                ${isOwner ? `
                <div style="display:flex;gap:8px;margin-top:14px;">
                    <button class="btn btn-secondary" style="margin:0;flex:1; border-radius:14px;" id="btn-edit-own-post">✏️ Изменить</button>
                    <button class="btn btn-danger" style="margin:0;flex:1; border-radius:14px;" id="btn-delete-own-post">🗑 Удалить</button>
                </div>` : ''}
                
                <div class="reaction-bar">
                    ${myReactionOptions().map(e => `<button class="reaction-btn ${reactions[state.currentUser.id] === e ? 'mine' : ''}" data-emoji="${e}">${reactionButtonInner(e)} ${counts[e] || ''}</button>`).join('')}
                </div>
                
                <button class="btn btn-secondary" style="margin-top:12px; border-radius:16px;" id="btn-share-post">📤 Поделиться</button>
                
                <div class="comments-block">
                    <div class="comments-title">Комментарии (${comments.length})</div>
                    ${comments.length ? comments.map(c => `
                        <div class="comment-item">
                            <div>
                                <span class="comment-author" data-uid="${c.userId || ''}" style="cursor:pointer;${nickColorStyle(c.userId)}">${escapeHtml(c.author)}${verifiedBadge(c.userId)}${shopBadgeHtml(c.userId)}${passVipBadge(c.userId)}</span>
                                <span class="comment-meta">${formatDate(c.createdAt)}</span>
                            </div>
                            ${c.sticker ? `<img src="${c.sticker}" class="comment-sticker">` : (c.attachment ? attachmentHtml(c.attachment) : `<div class="comment-text">${escapeHtml(c.text)}</div>`)}
                            ${(c.userId === state.currentUser.id || state.isAdmin) ? `<button class="comment-delete" data-cid="${c.id}">Удалить</button>` : ''}
                        </div>
                    `).join('') : '<div style="color:var(--text-secondary);font-size:13px;">Пока нет комментариев. Будьте первым!</div>'}
                </div>
            `;

            const row = document.querySelector('#post-overlay-content .post-author-row');
            if (row) {
                row.onclick = () => { 
                    const aid = row.getAttribute('data-author-id'); 
                    if (aid) openUserProfile(aid);
                };
            }

            document.querySelectorAll('#post-overlay-content .reaction-btn').forEach(b => {
                b.onclick = () => toggleReaction(post.id, b.dataset.emoji);
            });
            
            document.querySelectorAll('#post-overlay-content .comment-delete').forEach(b => {
                b.onclick = () => deleteComment(post.id, b.dataset.cid);
            });

            document.querySelectorAll('#post-overlay-content .comment-author').forEach(el => {
                el.onclick = () => { const uid = el.getAttribute('data-uid'); if (uid) openUserProfile(uid); };
            });
            
            if (document.getElementById('btn-share-post')) document.getElementById('btn-share-post').onclick = () => sharePost(post.id);
            if (document.getElementById('btn-edit-own-post')) document.getElementById('btn-edit-own-post').onclick = () => editOwnPost(post.id);
            if (document.getElementById('btn-delete-own-post')) document.getElementById('btn-delete-own-post').onclick = () => deleteOwnPost(post.id);
        }

        export function toggleReaction(postId, emoji) {
            const current = state.postsData.find(p => p.id === postId)?.reactions?.[state.currentUser.id];
            const newVal = current === emoji ? null : emoji;
            
            set(ref(state.db, `posts/${postId}/reactions/${state.currentUser.id}`), newVal);
            update(ref(state.db, 'users/' + state.currentUser.id), { 
                lastReactionEmoji: newVal, 
                lastReactionAt: newVal ? Date.now() : null 
            }).catch(()=>{});
            if (newVal) awardPassXP(3, 'reaction');
            
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
        }

        export function sharePost(postId) {
            const post = state.postsData.find(p => p.id === postId);
            if (!post) return;
            const shareText = post.title + '\n\n' + post.text;
            
            if (navigator.share) {
                navigator.share({ title: post.title, text: shareText }).catch(()=>{});
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(shareText).then(() => tg.showPopup({ title: 'Готово', message: 'Текст скопирован', buttons: [{ type: 'ok' }] }));
            }
        }



        document.getElementById('btn-send-comment').onclick = function() {
            const input = document.getElementById('comment-input');
            if (!input.value.trim() || !state.db) return;
            
            push(ref(state.db, `posts/${state.currentPostId}/comments`), { 
                author: state.currentUser.name, 
                userId: state.currentUser.id, 
                text: input.value.trim(), 
                createdAt: Date.now() 
            }).then(() => { 
                input.value = ''; 
                update(ref(state.db, 'users/' + state.currentUser.id), { commentsMade: increment(1) })
                    .catch(err => console.error('Не удалось обновить счётчик комментариев:', err));
                awardPassXP(10, 'comment');
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        document.getElementById('btn-toggle-comment-stickers').onclick = function() {
            const p = document.getElementById('comment-sticker-picker');
            p.style.display = p.style.display === 'none' ? 'flex' : 'none';
        };

        setupAttachmentPicker('comment-attach-file', async (attachment) => {
            if (!state.currentPostId || !state.db) return;
            await push(ref(state.db, `posts/${state.currentPostId}/comments`), {
                author: state.currentUser.name,
                userId: state.currentUser.id,
                text: '',
                attachment,
                createdAt: Date.now()
            });
        });



        window.sendCommentSticker = function(url) {
            if (!state.currentPostId || !state.db) return;
            
            push(ref(state.db, `posts/${state.currentPostId}/comments`), { 
                author: state.currentUser.name, 
                userId: state.currentUser.id, 
                text: '', 
                sticker: url, 
                createdAt: Date.now() 
            }).then(() => {
                document.getElementById('comment-sticker-picker').style.display = 'none';
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        export function deleteComment(postId, commentId) {
            tg.showConfirm('Удалить комментарий?', (ok) => { 
                if(ok) {
                    remove(ref(state.db, `posts/${postId}/comments/${commentId}`))
                        .catch(err => tg.showAlert('Ошибка удаления: ' + friendlyDbError(err)));
                } 
            });
        }



        document.getElementById('close-post-btn').onclick = function() {
            document.getElementById('post-overlay').classList.remove('active'); 
            state.activeOverlay = null; 
            tg.BackButton.hide();
        };

        // === КНИГИ ===
