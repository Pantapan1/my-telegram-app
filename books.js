import { ref, push, update, remove, increment } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { colorFor, confettiBurst, escapeHtml, friendlyDbError, initialOf, playSound, saveLocal, showTerrariaToast, updateReaderBossLabel } from './utils.js';
import { awardPassXP } from './pass.js';
import { currentMultiplier } from './feed.js';
import { renderProfileStats } from './profile.js';

export function getChapters(book) {
            if (book.chapters) {
                return Object.entries(book.chapters)
                    .map(([id, c]) => ({ id, ...c }))
                    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            }
            if (book.text) return [{ id: 'legacy', title: 'Глава 1', text: book.text }];
            return [];
        }

        export function bookProgress(book) {
            const chapters = getChapters(book);
            if (!chapters.length) return { readCount: 0, total: 0, pct: 0 };
            
            const readCount = state.progressStore[book.id]?.readIdx?.length || 0;
            return { 
                readCount, 
                total: chapters.length, 
                pct: Math.round((readCount / chapters.length) * 100) 
            };
        }

        export function renderGenreFilterRow() {
            const genres = Array.from(new Set(state.booksData.map(b => b.genre).filter(Boolean)));
            const row = document.getElementById('genre-filter-row');
            
            if (!genres.length) { 
                row.innerHTML = ''; 
                return; 
            }
            
            row.innerHTML = ['Все', ...genres].map(g => `
                <button class="chip ${state.activeGenre === g ? 'active' : ''}" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</button>
            `).join('');
            
            row.querySelectorAll('.chip').forEach(c => {
                c.onclick = () => { 
                    state.activeGenre = c.dataset.genre; 
                    renderGenreFilterRow(); 
                    renderBooks(); 
                };
            });
        }

        window.setTypeFilter = function(type) {
            state.activeType = type;
            document.querySelectorAll('#type-filter-row .chip').forEach(c => {
                c.classList.toggle('active', c.dataset.type === type);
            });
            renderBooks();
        };

        export function maybeShowMangaAnnouncement() {
            const hasManga = state.booksData.some(b => b.type === 'manga' || b.type === 'manhwa');
            const dismissed = localStorage.getItem('sr_manga_announce_dismissed') === '1';
            document.getElementById('manga-announce-banner').style.display = (hasManga && !dismissed) ? 'flex' : 'none';
        }


        document.getElementById('manga-announce-close').onclick = function() {
            localStorage.setItem('sr_manga_announce_dismissed', '1');
            document.getElementById('manga-announce-banner').style.display = 'none';
        };



        window.setSort = function(mode) {
            state.sortMode = mode; 
            document.querySelectorAll('#section-books .chip[data-sort]').forEach(c => {
                c.classList.toggle('active', c.dataset.sort === mode)
            }); 
            renderBooks();
        };


        
        document.getElementById('book-search').addEventListener('input', (e) => { 
            state.bookSearchTerm = e.target.value; 
            renderBooks(); 
        });



        export function renderBooks() {
            const container = document.getElementById('books-container');
            let list = state.booksData.slice();
            
            if (state.bookSearchTerm) {
                const term = state.bookSearchTerm.toLowerCase();
                list = list.filter(b => (b.title || '').toLowerCase().includes(term) || (b.author || '').toLowerCase().includes(term));
            }
            
            if (state.activeGenre !== 'Все') {
                list = list.filter(b => b.genre === state.activeGenre);
            }

            if (state.activeType !== 'all') {
                list = list.filter(b => (b.type || 'book') === state.activeType);
            }
            
            if (state.sortMode === 'unread') list = list.filter(b => !state.readBooks.includes(b.id));
            if (state.sortMode === 'read') list = list.filter(b => state.readBooks.includes(b.id));
            if (state.sortMode === 'bookmark') list = list.filter(b => state.bookmarkedBooks.includes(b.id));

            if (!list.length) { 
                container.innerHTML = '<div class="empty-state"><span class="icon">🔍</span><div class="title">Ничего не найдено</div></div>'; 
                return; 
            }
            
            const typeLabels = { book: '📖 Книга', manga: '🇯🇵 Манга', manhwa: '🇰🇷 Манхва' };
            container.innerHTML = list.map((book, idx) => {
                const isRead = state.readBooks.includes(book.id);
                const isBookmarked = state.bookmarkedBooks.includes(book.id);
                const prog = bookProgress(book);
                const type = book.type || 'book';
                
                return `
                <div class="card tappable card-anim" style="animation-delay:${Math.min(idx, 8) * 40}ms" onclick="openBook('${book.id}')">
                    ${book.coverImage ? `<img src="${book.coverImage}" class="card-image" onerror="this.style.display='none'">` : `<div class="cover-fallback" style="background:${colorFor(book.title || '')}">${initialOf(book.title)}</div>`}
                    <div><span class="type-tag type-${type}">${typeLabels[type]}</span>${book.genre ? `<span class="genre-tag" style="margin-left:6px;">${escapeHtml(book.genre)}</span>` : ''}</div>
                    <div class="card-title">${escapeHtml(book.title)}</div>
                    <div class="card-subtitle">${escapeHtml(book.author || 'Неизвестен')}</div>
                    ${isRead ? '<span class="badge badge-read">✓ Прочитано</span>' : ''} 
                    ${isBookmarked ? '<span class="badge badge-bookmark">🔖 Закладка</span>' : ''}
                    ${prog.total > 1 && !isRead ? `<div class="progress-outer" style="margin:10px 0 0;"><div class="progress-inner" style="width:${prog.pct}%;"></div></div><div class="card-meta" style="margin-top:6px;">Прочитано ${prog.readCount} из ${prog.total} глав</div>` : ''}
                </div>`;
            }).join('');
            
            document.getElementById('stats-read').textContent = state.readBooks.length; 
            document.getElementById('stats-bookmarks').textContent = state.bookmarkedBooks.length;
        }

        window.openBook = function(id) {
            const book = state.booksData.find(b => b.id === id);
            if (!book) return;
            
            state.currentBookId = id; 
            state.activeOverlay = 'reader'; 
            state.currentChapters = getChapters(book);
            
            document.getElementById('reader-overlay').classList.add('active'); 
            tg.BackButton.show();
            
            if (state.currentChapters.length <= 1) {
                openChapter(id, 0); 
            } else {
                renderChapterListView(book);
            }
        };

        export function renderChapterListView(book) {
            document.getElementById('reader-title').textContent = book.title; 
            document.getElementById('reader-author').textContent = book.author || '';
            document.getElementById('reader-font-controls').classList.add('hidden'); 
            document.getElementById('reader-progress-wrap').classList.remove('hidden'); 
            document.getElementById('reader-actions-chapter').classList.add('hidden');
            
            const prog = bookProgress(book);
            const readIdx = state.progressStore[book.id]?.readIdx || [];
            
            document.getElementById('reader-progress-inner').style.width = prog.pct + '%';
            updateReaderBossLabel(prog.readCount, prog.total);
            document.getElementById('reader-body').innerHTML = `
                <div style="margin-bottom:14px;color:var(--text-secondary);font-size:13px;font-weight:600;">Выберите главу (${prog.readCount}/${prog.total} прочитано)</div>
                ${state.currentChapters.map((ch, idx) => `
                    <div class="chapter-item ${readIdx.includes(idx) ? 'is-read' : ''}" onclick="openChapter('${book.id}', ${idx})">
                        <span class="chapter-item-title">${escapeHtml(ch.title || ('Глава ' + (idx + 1)))}</span>
                        ${readIdx.includes(idx) ? '<span class="chapter-item-check">✓</span>' : '<span style="color:var(--text-secondary); font-weight:800;">→</span>'}
                    </div>
                `).join('')}
            `;
        }

        export function openChapter(bookId, idx) {
            const book = state.booksData.find(b => b.id === bookId); 
            if (!book) return;
            
            state.currentBookId = bookId; 
            state.currentChapters = getChapters(book); 
            state.currentChapterIndex = idx;
            
            if (!state.progressStore[bookId]) {
                state.progressStore[bookId] = { readIdx: [], lastIdx: 0 };
            }
            state.progressStore[bookId].lastIdx = idx; 
            saveLocal('sr_progress', state.progressStore);

            const chapter = state.currentChapters[idx];
            const isPaged = !!(chapter && chapter.pages && chapter.pages.length);
            document.getElementById('reader-title').textContent = book.title + (state.currentChapters.length > 1 ? ' · ' + (chapter.title || ('Глава ' + (idx + 1))) : '');
            document.getElementById('reader-author').textContent = book.author || '';

            const readerBody = document.getElementById('reader-body');
            if (isPaged) {
                document.getElementById('reader-font-controls').classList.add('hidden');
                readerBody.style.fontSize = '';
                readerBody.innerHTML = `<div class="manga-pages">${chapter.pages.map(url => `<img src="${url}" loading="lazy" onerror="this.style.display='none'">`).join('')}</div>`;
            } else {
                document.getElementById('reader-font-controls').classList.remove('hidden');
                readerBody.style.fontSize = state.readerFontSize + 'px';
                readerBody.textContent = chapter.text;
            }
            document.getElementById('reader-actions-chapter').classList.remove('hidden');

            const readIdx = state.progressStore[bookId].readIdx || [];
            document.getElementById('reader-progress-wrap').classList.remove('hidden');
            document.getElementById('reader-progress-inner').style.width = Math.round((readIdx.length / state.currentChapters.length) * 100) + '%';
            updateReaderBossLabel(readIdx.length, state.currentChapters.length);
            
            document.getElementById('btn-prev-chapter').disabled = idx === 0; 
            document.getElementById('btn-next-chapter').disabled = idx === state.currentChapters.length - 1;
            document.getElementById('btn-bookmark').textContent = state.bookmarkedBooks.includes(bookId) ? '🔖✓' : '🔖';
        }

        window.openChapter = openChapter;



        document.getElementById('btn-prev-chapter').onclick = () => { 
            if (state.currentChapterIndex > 0) openChapter(state.currentBookId, state.currentChapterIndex - 1); 
        };
        
        document.getElementById('btn-next-chapter').onclick = () => { 
            if (state.currentChapterIndex < state.currentChapters.length - 1) openChapter(state.currentBookId, state.currentChapterIndex + 1); 
        };
        
        document.getElementById('font-dec').onclick = () => { 
            state.readerFontSize = Math.max(14, state.readerFontSize - 2); 
            localStorage.setItem('sr_fontsize', String(state.readerFontSize)); 
            document.getElementById('reader-body').style.fontSize = state.readerFontSize + 'px'; 
        };
        
        document.getElementById('font-inc').onclick = () => { 
            state.readerFontSize = Math.min(28, state.readerFontSize + 2); 
            localStorage.setItem('sr_fontsize', String(state.readerFontSize)); 
            document.getElementById('reader-body').style.fontSize = state.readerFontSize + 'px'; 
        };
        
        document.getElementById('btn-share-chapter').onclick = () => {
            const book = state.booksData.find(b => b.id === state.currentBookId); 
            if (!book) return;
            const chapter = state.currentChapters[state.currentChapterIndex];
            const shareText = book.title + (chapter ? ' — ' + (chapter.title || '') : '');
            if (navigator.share) {
                navigator.share({ title: book.title, text: shareText }).catch(()=>{}); 
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(shareText);
                tg.showPopup({ title: 'Готово', message: 'Ссылка скопирована', buttons: [{ type: 'ok' }] });
            }
        };
        


        export function updateStreak() {
            const today = new Date().toDateString();
            const yesterday = new Date(Date.now() - 86400000).toDateString();
            if (state.streakStore.lastDate === today) return;
            
            state.streakStore.count = (state.streakStore.lastDate === yesterday) ? state.streakStore.count + 1 : 1;
            state.streakStore.lastDate = today; 
            saveLocal('sr_streak', state.streakStore);
            // Пишем стрик в Firebase сразу — иначе задания типа "дней подряд" никогда не увидят актуальное значение
            if (state.db && state.currentUser) {
                update(ref(state.db, 'users/' + state.currentUser.id), { streak: state.streakStore.count })
                    .catch(err => console.error('Не удалось обновить стрик:', err));
            }
            maybeRewardStreak();
        }



        // === Монеты за стрик чтения (настраивается в админке) ===


        export function maybeRewardStreak() {
            if (!state.economyData.streakEnabled) return;
            const every = Math.max(1, state.economyData.streakEvery || 1);
            const max = state.economyData.streakMax || 0;
            const count = state.streakStore.count || 0;
            if (count % every !== 0) return;
            if (max && count > max) return;
            if (count <= (state.streakRewardStore.lastCount || 0)) return;

            state.streakRewardStore.lastCount = count;
            saveLocal('sr_streak_reward', state.streakRewardStore);

            const amount = Math.round((state.economyData.streakAmount || 0) * currentMultiplier());
            if (amount <= 0 || !state.db) return;

            const me = state.usersData.find(u => u.id === state.currentUser.id);
            update(ref(state.db, 'users/' + state.currentUser.id), { coins: (me && me.coins || 0) + amount }).then(() => {
                tg.showPopup({ title: `🔥 +${amount} монет!`, message: `Награда за ${count} ${count === 1 ? 'день' : 'дней'} чтения подряд`, buttons: [{ type: 'ok' }] });
                playSound('coin');
                confettiBurst();
            }).catch(() => {});
        }


        
        document.getElementById('btn-read').onclick = function() {
            if (!state.progressStore[state.currentBookId]) {
                state.progressStore[state.currentBookId] = { readIdx: [], lastIdx: 0 };
            }
            const isNewChapter = !state.progressStore[state.currentBookId].readIdx.includes(state.currentChapterIndex);
            if (isNewChapter) { 
                state.progressStore[state.currentBookId].readIdx.push(state.currentChapterIndex); 
                saveLocal('sr_progress', state.progressStore); 
                awardPassXP(15, 'chapter');
            }

            const me = state.usersData.find(u => u.id === state.currentUser.id);
            let chapterCoins = 0;
            if (isNewChapter && state.economyData.chapterEnabled) {
                chapterCoins = Math.round((state.economyData.chapterAmount || 0) * currentMultiplier());
            }

            const bookJustCompleted = state.progressStore[state.currentBookId].readIdx.length >= state.currentChapters.length && !state.readBooks.includes(state.currentBookId);
            let bookCoins = 0;

            const payload = {};
            // increment() — атомарное изменение на сервере, без риска потерять счётчик из-за устаревшего локального значения me
            if (isNewChapter) payload.chaptersReadCount = increment(1);

            if (bookJustCompleted) {
                state.readBooks.push(state.currentBookId); 
                saveLocal('sr_read', state.readBooks); 
                updateStreak(); 
                renderProfileStats();
                awardPassXP(30, 'book');

                if (state.economyData.bookEnabled) {
                    bookCoins = Math.round((state.economyData.bookAmount || 0) * currentMultiplier());
                }
                payload.booksReadCount = state.readBooks.length;
                payload.streak = state.streakStore.count || 0;
            }

            const totalCoins = chapterCoins + bookCoins;
            if (totalCoins > 0) payload.coins = increment(totalCoins);

            if ((isNewChapter || bookJustCompleted) && state.db) {
                update(ref(state.db, 'users/' + state.currentUser.id), payload).then(() => {
                    if (totalCoins > 0) { playSound('coin'); confettiBurst(); }
                }).catch(err => {
                    console.error('Не удалось обновить прогресс чтения (задания/монеты):', err);
                    tg.showAlert && tg.showAlert('Не удалось сохранить прогресс: ' + friendlyDbError(err));
                });
            }

            if (bookJustCompleted) {
                const msg = bookCoins > 0 ? `Поздравляем! +${bookCoins} 🪙` : 'Поздравляем!';
                tg.showPopup({ title: 'Книга прочитана! 🎉', message: msg, buttons: [{ type: 'ok' }] });
                const finishedBook = state.booksData.find(b => b.id === state.currentBookId);
                showTerrariaToast('Победа!', (finishedBook ? finishedBook.title : 'Книга') + ' прочитана', '🐉');
            } else {
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            }
            
            const percent = Math.round((state.progressStore[state.currentBookId].readIdx.length / state.currentChapters.length) * 100);
            document.getElementById('reader-progress-inner').style.width = percent + '%';
            updateReaderBossLabel(state.progressStore[state.currentBookId].readIdx.length, state.currentChapters.length);
        };
        
        document.getElementById('btn-bookmark').onclick = function() {
            const idx = state.bookmarkedBooks.indexOf(state.currentBookId);
            if (idx > -1) { 
                state.bookmarkedBooks.splice(idx, 1); 
                tg.showAlert('Удалено из закладок'); 
            } else { 
                state.bookmarkedBooks.push(state.currentBookId); 
            }
            saveLocal('sr_bookmarks', state.bookmarkedBooks); 
            document.getElementById('btn-bookmark').textContent = state.bookmarkedBooks.includes(state.currentBookId) ? '🔖✓' : '🔖';
        };
        
        document.getElementById('close-reader-btn').onclick = function() { 
            document.getElementById('reader-overlay').classList.remove('active'); 
            state.activeOverlay = null; 
            tg.BackButton.hide(); 
            renderBooks(); 
        };

        // === ЧАТЫ И ГРУППЫ ===
