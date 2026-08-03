import { ref, update, remove } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { colorFor, confettiBurst, escapeHtml, formatDate, formatTimeSpent, friendlyDbError, initialOf, nickColorStyle, playSound, shopBadgeHtml, showTerrariaToast, verifiedBadge } from './utils.js';
import { awardPassXP, passVipBadge, renderPassButton } from './pass.js';
import { currentMultiplier, populateBossAdminForm, renderBossParticipantsList } from './feed.js';
import { startChatWith } from './chats.js';
import { populateChapterBookSelect, populateEconomyAdminForm, populateThemeAdminForm, renderAdminBannersList, renderAdminBooksList, renderAdminEventsList, renderAdminPostsList, renderAdminQuestsList, renderAdminStickersList } from './admin.js';
import { populateDeckSettingsForm, populateFramesForm, renderAdminCardsList, renderAdminClassesList, renderAdminCombosList, renderAdminPacksList } from './cards.js';
import { populateStickerPackSelect } from './chats.js';

export function checkDailyCoinReward() {
            if (state.dailyRewardChecked) return;
            const me = state.usersData.find(u => u.id === state.currentUser.id);
            if (!me) return; // профиль ещё не создан в базе — подождём следующего обновления
            state.dailyRewardChecked = true;

            const today = new Date().toDateString();
            const payload = {};
            if (!me.joinedAt) payload.joinedAt = Date.now();
            let amount = 0;
            if (state.economyData.dailyEnabled && me.lastRewardDate !== today) {
                amount = Math.round((state.economyData.dailyAmount || 0) * currentMultiplier());
                payload.coins = (me.coins || 0) + amount;
                payload.lastRewardDate = today;
            } else if (me.lastRewardDate !== today) {
                // награда выключена админом, но дату всё равно фиксируем, чтобы не копить долги
                payload.lastRewardDate = today;
            }

            if (Object.keys(payload).length) {
                update(ref(state.db, 'users/' + state.currentUser.id), payload).then(() => {
                    if (amount > 0) {
                        tg.showPopup({ title: `🪙 +${amount} монет!`, message: 'Награда за ежедневный вход в приложение', buttons: [{ type: 'ok' }] });
                        playSound('coin');
                        confettiBurst();
                    }
                }).catch(() => {});
            }
        }



        // === Публичный профиль пользователя ===


        export function openUserProfile(userId) {
            if (!userId) return;
            if (userId === state.currentUser.id) {
                window.switchTab('profile');
                return;
            }
            state.viewingUserId = userId;
            state.activeOverlay = 'userprofile';
            renderUserProfileOverlay(userId);
            document.getElementById('user-profile-overlay').classList.add('active');
        }

        window.openUserProfile = openUserProfile;



        document.getElementById('close-user-profile-btn').onclick = function() {
            document.getElementById('user-profile-overlay').classList.remove('active');
            state.activeOverlay = null;
            state.viewingUserId = null;
        };



        export function renderUserProfileOverlay(userId) {
            const u = state.usersData.find(x => x.id === userId);
            const content = document.getElementById('user-profile-overlay-content');
            if (!u) { content.innerHTML = '<div class="empty-state"><span class="icon">🙈</span><div class="title">Пользователь не найден</div></div>'; return; }

            document.getElementById('user-profile-overlay-name').innerHTML = `<span style="${nickColorStyle(u.id)}">${escapeHtml(u.name || 'Без имени')}</span>` + verifiedBadge(u.id) + shopBadgeHtml(u.id);
            const joined = u.joinedAt ? formatDate(u.joinedAt) : '—';
            const frameItem = u.equipped && u.equipped.frame ? state.shopItemsData.find(i => i.id === u.equipped.frame) : null;
            const decorIds = (u.equipped && u.equipped.decorations) ? Object.keys(u.equipped.decorations) : [];
            const decorHtml = decorIds.map(id => {
                const item = state.shopItemsData.find(i => i.id === id);
                return item ? `<img src="${item.image}" title="${escapeHtml(item.name)}" style="width:26px;height:26px;object-fit:contain;">` : '';
            }).join('');

            content.innerHTML = `
                <div style="border-radius:20px;overflow:hidden;background:var(--input-bg);margin-bottom:16px;">
                    ${u.banner ? `<img src="${u.banner}" style="width:100%;height:110px;object-fit:cover;display:block;">` : `<div style="width:100%;height:60px;background:linear-gradient(135deg,#ffb75e,#ed8f03);"></div>`}
                    <div style="padding:16px;text-align:center;margin-top:-38px;">
                        <div style="position:relative;width:76px;margin:0 auto;">
                            ${u.avatar ? `<img src="${u.avatar}" style="width:76px;height:76px;border-radius:50%;object-fit:cover;border:4px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,0.15);">` : `<div class="cover-fallback" style="width:76px;height:76px;border-radius:50%;border:4px solid #fff;background:${colorFor(u.name || '')};font-size:28px;">${initialOf(u.name)}</div>`}
                            ${frameItem ? `<img src="${frameItem.image}" style="position:absolute;top:-8px;left:-8px;width:92px;height:92px;pointer-events:none;">` : ''}
                        </div>
                        <div style="font-weight:800;font-size:18px;margin-top:10px;color:var(--text-primary);"><span style="${nickColorStyle(u.id)}">${escapeHtml(u.name || 'Без имени')}</span>${verifiedBadge(u.id)}${shopBadgeHtml(u.id)}${passVipBadge(u.id)}</div>
                        ${u.bio ? `<div style="color:var(--text-secondary);font-size:14px;margin-top:4px;">${escapeHtml(u.bio)}</div>` : ''}
                        ${decorHtml ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:8px;">${decorHtml}</div>` : ''}
                        <div style="color:var(--text-secondary);font-size:12px;margin-top:8px;">📅 С нами с ${joined}</div>
                    </div>
                </div>
                <div class="card stats-grid">
                    <div>
                        <div class="stats-num" style="color:#2e7d32;">${u.booksReadCount || 0}</div>
                        <div class="stats-label">Прочитано</div>
                    </div>
                    <div class="stats-divider"></div>
                    <div>
                        <div class="stats-num" style="color:#e65100;">${u.streak || 0}</div>
                        <div class="stats-label">Дней подряд</div>
                    </div>
                    <div class="stats-divider"></div>
                    <div>
                        <div class="stats-num" style="color:#ed8f03;">${u.coins || 0}</div>
                        <div class="stats-label">🪙 Монет</div>
                    </div>
                </div>
                <button class="btn btn-secondary" id="btn-message-user" style="margin-top:16px;">💬 Написать сообщение</button>
            `;

            document.getElementById('btn-message-user').onclick = function() {
                document.getElementById('user-profile-overlay').classList.remove('active');
                state.activeOverlay = null;
                startChatWith(userId, u.name || 'Читатель');
            };
        }

        export function renderOwnProfileHeader() {
            const me = state.usersData.find(u => u.id === state.currentUser.id);
            const name = (me && me.name) || state.currentUser.name;
            const bio = (me && me.bio) || '';
            const avatar = (me && me.avatar) || '';
            const banner = (me && me.banner) || '';
            
            document.getElementById('profile-display-name').innerHTML = `<span style="${nickColorStyle(state.currentUser.id)}">${escapeHtml(name)}</span>` + verifiedBadge(state.currentUser.id) + shopBadgeHtml(state.currentUser.id) + passVipBadge(state.currentUser.id); 
            document.getElementById('profile-display-bio').textContent = bio;
            
            const avatarImg = document.getElementById('profile-avatar-img');
            const avatarFallback = document.getElementById('profile-avatar-fallback');
            
            if (avatar) { 
                avatarImg.src = avatar; 
                avatarImg.style.display = 'block'; 
                avatarFallback.style.display = 'none'; 
            } else { 
                avatarImg.style.display = 'none'; 
                avatarFallback.style.display = 'flex'; 
                avatarFallback.textContent = initialOf(name); 
                avatarFallback.style.background = colorFor(name); 
            }
            
            const bannerImg = document.getElementById('profile-banner-img');
            const bannerFallback = document.getElementById('profile-banner-fallback');
            
            if (banner) { 
                bannerImg.src = banner; 
                bannerImg.style.display = 'block'; 
                bannerFallback.style.display = 'none'; 
            } else { 
                bannerImg.style.display = 'none'; 
                bannerFallback.style.display = 'block'; 
                bannerFallback.style.background = `linear-gradient(135deg, ${colorFor(name)}, #ffe0b2)`; 
            }

            document.getElementById('btn-open-book-editor').classList.toggle('hidden', !(me && me.isPublisher));

            // Рамка аватара и декор из магазина
            const frameImg = document.getElementById('profile-frame-img');
            const frameItem = me && me.equipped && me.equipped.frame ? state.shopItemsData.find(i => i.id === me.equipped.frame) : null;
            if (frameItem) { frameImg.src = frameItem.image; frameImg.classList.remove('hidden'); } else { frameImg.classList.add('hidden'); }

            const decorIds = (me && me.equipped && me.equipped.decorations) ? Object.keys(me.equipped.decorations) : [];
            document.getElementById('profile-decorations-row').innerHTML = decorIds.map(id => {
                const item = state.shopItemsData.find(i => i.id === id);
                return item ? `<img src="${item.image}" title="${escapeHtml(item.name)}" style="width:26px;height:26px;object-fit:contain;">` : '';
            }).join('');

            if (!document.getElementById('profile-edit-panel').classList.contains('hidden')) return;
            
            document.getElementById('profile-name-input').value = (me && me.name) || ''; 
            document.getElementById('profile-bio-input').value = bio; 
            document.getElementById('profile-avatar-input').value = avatar; 
            document.getElementById('profile-banner-input').value = banner;
        }



        document.getElementById('btn-edit-profile').onclick = function() { 
            document.getElementById('profile-edit-panel').classList.toggle('hidden'); 
        };

        // Переход в отдельные страницы (магазин / заявка на публикацию / редактор книг),
        // передаём id и имя пользователя, чтобы там не нужно было логиниться заново


        export function goToSubpage(pageName) {
            const q = `?uid=${encodeURIComponent(state.currentUser.id)}&name=${encodeURIComponent(state.currentUser.name)}`;
            // Убираем имя текущего файла из пути и схлопываем случайные двойные слэши в адресе
            const dir = window.location.pathname.replace(/[^/]*$/, '').replace(/\/{2,}/g, '/');
            window.location.href = window.location.origin + dir + pageName + q;
        }


        document.getElementById('btn-open-shop').onclick = () => goToSubpage('shop.html');
        document.getElementById('btn-open-publisher-app').onclick = () => goToSubpage('publisher-application.html');
        document.getElementById('btn-open-book-editor').onclick = () => goToSubpage('book-editor.html');
        
        document.getElementById('btn-save-profile').onclick = function() {
            if (!state.db) return tg.showAlert('Firebase не подключен');
            
            const name = document.getElementById('profile-name-input').value.trim();
            update(ref(state.db, 'users/' + state.currentUser.id), { 
                name: name || state.currentUser.name, 
                bio: document.getElementById('profile-bio-input').value.trim(), 
                avatar: document.getElementById('profile-avatar-input').value.trim(), 
                banner: document.getElementById('profile-banner-input').value.trim() 
            }).then(() => { 
                if (name) state.currentUser.name = name; 
                document.getElementById('profile-edit-panel').classList.add('hidden'); 
                tg.showPopup({ title: 'Сохранено', message: 'Профиль обновлён', buttons: [{ type: 'ok' }] }); 
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        // === Задания (квесты события) ===


        export function questTypeLabel(t) {
            return { chapters: 'глав прочитано', books: 'книг дочитано', comments: 'комментариев', streak: 'дней подряд' }[t] || '';
        }

        export function questProgressValue(q, user) {
            if (!user) return 0;
            switch (q.type) {
                case 'chapters': return user.chaptersReadCount || 0;
                case 'books': return user.booksReadCount || 0;
                case 'comments': return user.commentsMade || 0;
                case 'streak': return user.streak || 0;
                default: return 0;
            }
        }

        export function renderQuestsList() {
            const container = document.getElementById('quests-list');
            const wrap = document.getElementById('quests-card-wrap');
            if (!container || !wrap || !state.currentUser) return;

            const now = Date.now();
            const active = state.questsData.filter(q => q.active && (!q.expiresAt || now < q.expiresAt));

            if (!active.length) { wrap.classList.add('hidden'); return; }
            wrap.classList.remove('hidden');

            const me = state.usersData.find(u => u.id === state.currentUser.id);
            container.innerHTML = active.map(q => {
                const progress = questProgressValue(q, me);
                const goal = q.goal || 1;
                const done = progress >= goal;
                const claimed = !!(me && me.questClaimed && me.questClaimed[q.id]);
                const pct = Math.min(100, Math.round((progress / goal) * 100));
                return `
                <div class="card" style="margin-bottom:10px;padding:14px 16px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <div style="font-weight:800;font-size:14px;color:var(--text-primary);">${escapeHtml(q.title || '')}</div>
                        <div style="font-weight:800;color:#ed8f03;font-size:13px;white-space:nowrap;">🪙 ${q.reward || 0}</div>
                    </div>
                    <div class="progress-outer"><div class="progress-inner" style="width:${pct}%;"></div></div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;">
                        <div class="card-meta">${Math.min(progress, goal)} / ${goal} · ${questTypeLabel(q.type)}</div>
                        ${claimed
                            ? '<span class="badge badge-read">✓ Получено</span>'
                            : (done ? `<button class="btn" style="width:auto;padding:8px 18px;margin:0;" onclick="claimQuest('${q.id}')">Забрать</button>` : '')}
                    </div>
                </div>`;
            }).join('');
        }

        window.claimQuest = function(id) {
            const q = state.questsData.find(x => x.id === id);
            if (!q || !state.db) return;
            const me = state.usersData.find(u => u.id === state.currentUser.id);
            if (!me) return;
            if (me.questClaimed && me.questClaimed[id]) return;

            const progress = questProgressValue(q, me);
            if (progress < (q.goal || 1)) return;

            const amount = Math.round((q.reward || 0) * currentMultiplier());
            const payload = { coins: (me.coins || 0) + amount };
            payload['questClaimed/' + id] = true;

            update(ref(state.db, 'users/' + state.currentUser.id), payload).then(() => {
                tg.showPopup({ title: '🏆 Задание выполнено!', message: `+${amount} монет`, buttons: [{ type: 'ok' }] });
                showTerrariaToast('Задание выполнено', (q.title || '') + ` · +${amount} монет`, '🏆');
                playSound('coin');
                confettiBurst();
                awardPassXP(50, 'quest');
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        export function renderProfileStats() {
            document.getElementById('stats-read').textContent = state.readBooks.length; 
            document.getElementById('stats-bookmarks').textContent = state.bookmarkedBooks.length; 
            document.getElementById('stats-streak').textContent = state.streakStore.count || 0;
            document.getElementById('stats-posts').textContent = state.postsData.filter(p => p.authorId === state.currentUser.id).length; 
            document.getElementById('stats-chats').textContent = state.chatsData.filter(c => c.participants && c.participants[state.currentUser.id]).length;

            const me = state.usersData.find(u => u.id === state.currentUser.id);
            document.getElementById('stats-coins').textContent = (me && me.coins) || 0;
            document.getElementById('stats-time-spent').textContent = formatTimeSpent((me && me.totalTimeSpent) || 0);
            
            const genreCounts = {}; 
            state.readBooks.forEach(id => { 
                const b = state.booksData.find(bk => bk.id === id); 
                if (b && b.genre) genreCounts[b.genre] = (genreCounts[b.genre] || 0) + 1; 
            });
            
            const entries = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
            const card = document.getElementById('genre-stats-card');
            
            if (entries.length) { 
                card.style.display = ''; 
                document.getElementById('genre-stats-container').innerHTML = entries.map(([g, c]) => `
                    <div class="genre-stat-row">
                        <span>${escapeHtml(g)}</span>
                        <span style="color:var(--text-secondary);">${c}</span>
                    </div>
                `).join(''); 
            } else { 
                card.style.display = 'none'; 
            }
        }



        tg.BackButton.onClick(() => {
            if (state.activeOverlay === 'post') document.getElementById('close-post-btn').click();
            else if (state.activeOverlay === 'reader') document.getElementById('close-reader-btn').click();
            else if (state.activeOverlay === 'chat') document.getElementById('close-chat-btn').click();
            else if (state.activeOverlay === 'newchat') document.getElementById('close-new-chat-btn').click();
            else if (state.activeOverlay === 'creategroup') document.getElementById('close-create-group-btn').click();
            else if (state.activeOverlay === 'editgroup') document.getElementById('close-edit-group-btn').click();
            else if (state.activeOverlay === 'compose') document.getElementById('close-compose-btn').click();
            else if (state.activeOverlay === 'userprofile') document.getElementById('close-user-profile-btn').click();
        });

        // === АДМИН ===
        document.getElementById('admin-login-btn').onclick = function() {
            if (state.isAdmin) { 
                document.getElementById('admin-panel').classList.toggle('hidden'); 
                return; 
            }
            
            const pwd = prompt("Пароль:");
            if (pwd === "admin123") { 
                state.isAdmin = true; 
                document.getElementById('admin-panel').classList.remove('hidden'); 
                document.getElementById('admin-panel').scrollIntoView({ behavior: 'smooth' }); 
                renderAdminPostsList(); 
                renderAdminBannersList();
                renderAdminBooksList(); 
                renderAdminStickersList(); 
                populateChapterBookSelect(); 
                populateThemeAdminForm();
                populateBossAdminForm();
                renderBossParticipantsList();
                populateEconomyAdminForm();
                renderAdminQuestsList();
                renderPassButton();
                renderAdminEventsList();
                renderAdminCardsList();
                renderAdminCombosList();
                renderAdminPacksList();
                renderAdminClassesList();
                populateDeckSettingsForm();
                populateFramesForm();
                populateStickerPackSelect();
            } else if (pwd) { 
                tg.showAlert('Неверный пароль'); 
            }
        };
