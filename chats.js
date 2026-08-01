import { ref, push, update, remove, set } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { attachmentHtml, avatarHtml, escapeHtml, formatDate, friendlyDbError, lastSeenText, nickColorStyle, saveLocal, setupAttachmentPicker, shopBadgeHtml, verifiedBadge } from './utils.js';
import { awardPassXP, passVipBadge } from './pass.js';
import { openUserProfile } from './profile.js';

export function otherParticipant(chat) {
            const ids = Object.keys(chat.participants || {});
            const otherId = ids.find(id => id !== state.currentUser.id) || state.currentUser.id;
            const names = chat.participantNames || {};
            const userRec = state.usersData.find(u => u.id === otherId);
            return {
                id: otherId, 
                name: (userRec && userRec.name) || names[otherId] || 'Читатель',
                avatar: userRec ? userRec.avatar : null, 
                lastSeen: userRec ? userRec.lastSeen : null,
                mood: (userRec && userRec.lastReactionAt && (Date.now() - userRec.lastReactionAt < 86400000)) ? userRec.lastReactionEmoji : null
            };
        }

        export function renderChatsList() {
            const container = document.getElementById('chats-container');
            const myChats = state.chatsData.filter(c => c.participants && c.participants[state.currentUser.id]);
            
            if (!myChats.length) {
                container.innerHTML = '<div class="empty-state"><span class="icon">💬</span><div class="title">Пока нет чатов</div></div>';
                document.getElementById('chats-nav-badge').classList.add('hidden'); 
                return;
            }
            
            myChats.sort((a, b) => (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0));
            let anyUnread = false;
            
            container.innerHTML = myChats.map((chat, idx) => {
                const lastReadTime = state.chatLastRead[chat.id] || 0;
                const unread = chat.messages ? Object.values(chat.messages).filter(m => m.senderId !== state.currentUser.id && m.createdAt > lastReadTime).length : 0;
                if (unread > 0) anyUnread = true;
                
                let avatarHTML, nameStr, moodStr = '';
                
                if (chat.type === 'group') {
                    avatarHTML = avatarHtml(chat.name, chat.avatar, 'chat-avatar');
                    nameStr = escapeHtml(chat.name);
                } else {
                    const other = otherParticipant(chat);
                    avatarHTML = avatarHtml(other.name, other.avatar, 'chat-avatar');
                    nameStr = escapeHtml(other.name);
                    moodStr = other.mood ? `<span class="mood-badge">${other.mood}</span>` : '';
                }

                return `
                <div class="chat-list-item card-anim" style="animation-delay:${Math.min(idx, 8) * 30}ms" data-chat-id="${chat.id}">
                    <div class="chat-avatar-wrap">${avatarHTML}${moodStr}</div>
                    <div class="chat-info">
                        <div class="chat-info-top">
                            <span class="chat-name">${nameStr}</span>
                            <span class="chat-time">${chat.lastMessageAt ? formatDate(chat.lastMessageAt).split(' в ')[0] : ''}</span>
                        </div>
                        <div class="chat-preview">${escapeHtml(chat.lastMessage || 'Нет сообщений')}</div>
                    </div>
                    ${unread > 0 ? `<div class="chat-unread-dot"></div>` : ''}
                </div>`;
            }).join('');
            
            document.querySelectorAll('#chats-container .chat-list-item').forEach(item => {
                item.onclick = () => openChat(item.getAttribute('data-chat-id'))
            });
            document.getElementById('chats-nav-badge').classList.toggle('hidden', !anyUnread);
        }

        export function openChat(chatId) {
            state.currentChatId = chatId; 
            state.activeOverlay = 'chat';
            document.getElementById('chat-overlay').classList.add('active'); 
            tg.BackButton.show();
            document.getElementById('chat-sticker-picker').style.display = 'none';
            state.renderedChatState = { chatId: null, signature: null }; // сбрасываем кэш, чтобы новый чат точно отрисовался и проскроллился вниз
            
            const chat = state.chatsData.find(c => c.id === chatId);
            if (chat) renderChatOverlay(chat);
        }

        window.openChat = openChat;

        export function renderChatOverlay(chat) {
            const me = state.usersData.find(u => u.id === state.currentUser.id);
            const chatBg = me && me.equipped && me.equipped.passChatBg;
            const chatBodyEl = document.getElementById('chat-body');
            if (chatBodyEl) {
                if (chatBg) {
                    // !important здесь специально: обои — платная награда пасса, они должны
                    // быть видны при любом оформлении сайта (Terraria, Roblox и т.д.),
                    // даже если у темы есть свой фон для #chat-body.
                    chatBodyEl.style.setProperty('background-image', `url('${chatBg}')`, 'important');
                    chatBodyEl.style.setProperty('background-size', 'cover', 'important');
                    chatBodyEl.style.setProperty('background-position', 'center', 'important');
                } else {
                    chatBodyEl.style.removeProperty('background-image');
                    chatBodyEl.style.removeProperty('background-size');
                    chatBodyEl.style.removeProperty('background-position');
                }
            }

            if (chat.type === 'group') {
                document.getElementById('chat-partner-name').textContent = chat.name;
                document.getElementById('chat-partner-avatar-wrap').innerHTML = avatarHtml(chat.name, chat.avatar, 'avatar-sm');
                document.getElementById('chat-partner-status').textContent = Object.keys(chat.participants || {}).length + ' участников';
                document.getElementById('chat-edit-group-btn').classList.toggle('hidden', chat.adminId !== state.currentUser.id);
            } else {
                const other = otherParticipant(chat);
                document.getElementById('chat-partner-name').textContent = other.name;
                document.getElementById('chat-partner-avatar-wrap').innerHTML = avatarHtml(other.name, other.avatar, 'avatar-sm');
                document.getElementById('chat-partner-status').textContent = lastSeenText(other.lastSeen) + (other.mood ? ' · настроение ' + other.mood : '');
                document.getElementById('chat-edit-group-btn').classList.add('hidden');
            }

            const pinned = chat.pinnedQuote;
            document.getElementById('chat-pinned-bar').classList.toggle('hidden', !pinned);
            if (pinned) {
                document.getElementById('chat-pinned-text').textContent = '"' + pinned.text + '" — ' + pinned.author;
            }
            document.getElementById('chat-quote-watermark').textContent = pinned ? '"' + pinned.text + '"' : '';
            updateTypingIndicator(chat);

            const messages = chat.messages ? Object.entries(chat.messages).map(([id, m]) => ({ id, ...m })).sort((a, b) => a.createdAt - b.createdAt) : [];
            const listEl = document.getElementById('chat-messages-list');
            const signature = messages.map(m => m.id + (m.edited ? ':e' : '') + (m.text ? m.text.length : 0)).join(',') + '|' + (pinned ? pinned.pinnedAt : '');

            // Ничего нового: пропускаем полную перерисовку сообщений, чтобы не моргали картинки/видео и не дёргался скролл
            if (state.renderedChatState.chatId === chat.id && state.renderedChatState.signature === signature) {
                state.chatLastRead[chat.id] = Date.now(); 
                saveLocal('sr_chat_last_read', state.chatLastRead);
                document.getElementById('chats-nav-badge').classList.add('hidden');
                return;
            }

            const body = document.getElementById('chat-body');
            const wasNearBottom = state.renderedChatState.chatId !== chat.id || (body.scrollHeight - body.scrollTop - body.clientHeight < 120);
            
            listEl.innerHTML = messages.length ? messages.map(m => {
                const timeStr = new Date(m.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                const isMine = m.senderId === state.currentUser.id;
                const canModify = isMine || state.isAdmin;
                const senderName = (chat.type === 'group' && !isMine) 
                    ? `<div class="msg-sender-name" data-uid="${m.senderId}" style="font-size:11px; font-weight:700; ${nickColorStyle(m.senderId) || 'color:#ff9f0a;'} margin-bottom:2px; cursor:pointer;">${escapeHtml(m.senderName)}${verifiedBadge(m.senderId)}${shopBadgeHtml(m.senderId)}${passVipBadge(m.senderId)}</div>` 
                    : '';

                const senderInfo = state.usersData.find(u => u.id === m.senderId);
                const avatarBlock = !isMine ? `<div class="msg-avatar-click" data-uid="${m.senderId}">${avatarHtml(senderInfo ? senderInfo.name : m.senderName, senderInfo ? senderInfo.avatar : null, 'msg-avatar')}</div>` : '';

                const replyPreview = m.replyTo ? `<div class="msg-reply-quote"><b>${escapeHtml(m.replyTo.author)}</b>: ${escapeHtml(m.replyTo.text)}</div>` : '';
                const editedMark = m.edited ? '<span style="opacity:0.6;font-size:10px;"> (изменено)</span>' : '';
                
                if (m.soundSticker) {
                    const btnId = 'snd_' + m.id;
                    setTimeout(() => {
                        const b = document.getElementById(btnId);
                        if (b) b.onclick = () => { try { new Audio(m.soundSticker).play().catch(() => {}); } catch (e) {} };
                    }, 0);
                    return `
                    <div class="msg-row ${isMine ? 'mine' : ''}">
                        ${avatarBlock}
                        <div class="msg-sticker-wrap">
                            ${senderName}
                            ${replyPreview}
                            <button id="${btnId}" style="border:none;border-radius:16px;padding:14px 20px;font-size:22px;cursor:pointer;background:var(--card-bg);box-shadow:0 2px 8px rgba(0,0,0,0.08);">🔊</button>
                            <span class="msg-time sticker-time">${timeStr}</span>
                        </div>
                    </div>`;
                }

                if (m.sticker) {
                    return `
                    <div class="msg-row ${isMine ? 'mine' : ''}">
                        ${avatarBlock}
                        <div class="msg-sticker-wrap">
                            ${senderName}
                            ${replyPreview}
                            <img src="${m.sticker}" class="msg-sticker">
                            <span class="msg-time sticker-time">${timeStr}</span>
                        </div>
                    </div>`;
                }

                if (m.attachment) {
                    return `
                    <div class="msg-row ${isMine ? 'mine' : ''}">
                        ${avatarBlock}
                        <div class="msg-bubble">
                            ${senderName}
                            ${replyPreview}
                            ${attachmentHtml(m.attachment)}
                            ${m.text ? escapeHtml(m.text) : ''}
                            <span class="msg-time">${timeStr}${editedMark}</span>
                        </div>
                    </div>`;
                }
                
                return `
                <div class="msg-row ${isMine ? 'mine' : ''}">
                    ${avatarBlock}
                    <div class="msg-bubble">
                        ${senderName}
                        ${replyPreview}
                        ${escapeHtml(m.text)}
                        <span class="msg-time">${timeStr}${editedMark}</span>
                    </div>
                </div>`;
            }).join('') : '<div style="color:var(--text-secondary);font-size:13px;text-align:center;margin-top:20px;position:relative;z-index:1;">Начните диалог</div>';

            attachMessageGestures(listEl, messages, chat, state.currentUser.id, state.isAdmin);

            listEl.querySelectorAll('.msg-sender-name, .msg-avatar-click').forEach(el => {
                el.onclick = () => { const uid = el.getAttribute('data-uid'); if (uid) openUserProfile(uid); };
            });

            state.chatLastRead[chat.id] = Date.now(); 
            saveLocal('sr_chat_last_read', state.chatLastRead);
            document.getElementById('chats-nav-badge').classList.add('hidden');
            
            state.renderedChatState = { chatId: chat.id, signature };
            if (wasNearBottom) body.scrollTop = body.scrollHeight;
        }

        export function pinQuote(chatId, text, author) { 
            update(ref(state.db, 'chats/' + chatId), { pinnedQuote: { text, author, pinnedAt: Date.now() } }); 
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success'); 
        }



        // === Жесты сообщений: свайп влево = ответить, долгое нажатие = меню (удалить/закрепить/изменить) ===


        export function deleteMessageWithConfirm(chatId, id) {
            tg.showConfirm('Удалить это сообщение?', (ok) => {
                if (!ok) return;
                remove(ref(state.db, 'chats/' + chatId + '/messages/' + id))
                    .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
            });
        }

        export function closeMessageContextMenu() {
            const el = document.getElementById('msg-context-backdrop');
            if (el) el.remove();
        }

        export function openMessageContextMenu(chat, m, canModify) {
            closeMessageContextMenu();
            const isTextMsg = !m.sticker && !m.attachment && !m.soundSticker;
            const replyText = m.soundSticker ? '🔊 Звук-стикер' : (m.sticker ? '🖼 Стикер' : (m.attachment ? '📎 Вложение' : m.text));

            const items = [];
            items.push({ ico: '↩️', label: 'Ответить', action: () => startReply(m.id, m.senderName, replyText) });
            if (isTextMsg) items.push({ ico: '📌', label: 'Закрепить как цитату', action: () => pinQuote(chat.id, m.text, m.senderName) });
            if (isTextMsg && canModify) items.push({ ico: '✏️', label: 'Редактировать', action: () => startEditMessage(m.id, m.text) });
            if (canModify) items.push({ ico: '🗑', label: 'Удалить', danger: true, action: () => deleteMessageWithConfirm(chat.id, m.id) });

            const backdrop = document.createElement('div');
            backdrop.className = 'msg-context-backdrop';
            backdrop.id = 'msg-context-backdrop';
            backdrop.innerHTML = `
                <div class="msg-context-sheet">
                    <div class="msg-context-quote">${escapeHtml(replyText).slice(0, 80)}</div>
                    ${items.map((it, i) => `<div class="msg-context-item ${it.danger ? 'danger' : ''}" data-i="${i}"><span class="ico">${it.ico}</span>${escapeHtml(it.label)}</div>`).join('')}
                </div>
            `;
            backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeMessageContextMenu(); });
            backdrop.querySelectorAll('.msg-context-item').forEach(el => {
                el.onclick = () => {
                    const it = items[parseInt(el.getAttribute('data-i'), 10)];
                    closeMessageContextMenu();
                    if (it) it.action();
                };
            });
            document.body.appendChild(backdrop);
        }

        export function attachMessageGestures(listEl, messages, chat, myId, adminFlag) {
            const rows = listEl.querySelectorAll('.msg-row');
            rows.forEach((row, i) => {
                const m = messages[i];
                if (!m) return;
                const isMine = m.senderId === myId;
                const canModify = isMine || adminFlag;
                const content = row.querySelector('.msg-bubble, .msg-sticker-wrap');
                if (!content) return;

                let startX = 0, startY = 0, active = false, moved = false, swiped = false, longPressTimer = null;

                function clearLongPress() { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } }

                function reset() {
                    content.style.transition = 'transform .2s ease';
                    content.style.transform = 'translateX(0)';
                }

                row.addEventListener('pointerdown', (e) => {
                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                    startX = e.clientX; startY = e.clientY;
                    active = true; moved = false; swiped = false;
                    content.style.transition = 'none';
                    clearLongPress();
                    longPressTimer = setTimeout(() => {
                        if (active && !moved) {
                            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
                            openMessageContextMenu(chat, m, canModify);
                            active = false;
                            reset();
                        }
                    }, 450);
                });

                row.addEventListener('pointermove', (e) => {
                    if (!active) return;
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) { moved = true; clearLongPress(); return; }
                    if (Math.abs(dx) > 8) moved = true;
                    if (moved) clearLongPress();
                    if (dx < 0) {
                        const clamped = Math.max(dx, -64);
                        content.style.transform = `translateX(${clamped}px)`;
                        if (clamped <= -56 && !swiped) { swiped = true; if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light'); }
                        else if (clamped > -56 && swiped) { swiped = false; }
                    }
                });

                function endHandler() {
                    clearLongPress();
                    const wasActive = active;
                    active = false;
                    if (wasActive && swiped) startReply(m.id, m.senderName, m.sticker ? '🖼 Стикер' : (m.attachment ? '📎 Вложение' : m.text));
                    reset();
                }
                row.addEventListener('pointerup', endHandler);
                row.addEventListener('pointercancel', endHandler);
                row.addEventListener('pointerleave', () => { if (active) endHandler(); });
            });
        }


        
        document.getElementById('btn-unpin-quote').onclick = function() { 
            update(ref(state.db, 'chats/' + state.currentChatId), { pinnedQuote: null }); 
        };
        
        // === Ответ на сообщение ===



        export function startReply(id, author, text) {
            cancelEditMessage(); // ответ и редактирование не могут быть одновременно
            state.replyingTo = { id, author, text };
            document.getElementById('chat-reply-author').textContent = author;
            document.getElementById('chat-reply-preview').textContent = text;
            document.getElementById('chat-reply-bar').classList.remove('hidden');
            document.getElementById('chat-message-input').focus();
        }



        document.getElementById('btn-cancel-reply').onclick = function() {
            state.replyingTo = null;
            document.getElementById('chat-reply-bar').classList.add('hidden');
        };

        // === Редактирование своего сообщения ===



        export function startEditMessage(id, text) {
            state.replyingTo = null; 
            document.getElementById('chat-reply-bar').classList.add('hidden'); // редактирование и ответ не могут быть одновременно

            state.editingMessageId = id;
            const input = document.getElementById('chat-message-input');
            input.value = text;
            autoResizeChatInput();
            document.getElementById('chat-edit-bar').classList.remove('hidden');
            input.focus();
        }

        export function cancelEditMessage() {
            if (!state.editingMessageId) return;
            state.editingMessageId = null;
            document.getElementById('chat-edit-bar').classList.add('hidden');
            const input = document.getElementById('chat-message-input');
            input.value = '';
            autoResizeChatInput();
        }



        document.getElementById('btn-cancel-edit-msg').onclick = cancelEditMessage;



        export function sendChatMessage() {
            const input = document.getElementById('chat-message-input');
            const text = input.value.trim();
            if (!text || !state.currentChatId || !state.db) return;

            if (state.editingMessageId) {
                update(ref(state.db, 'chats/' + state.currentChatId + '/messages/' + state.editingMessageId), { text, edited: true }).then(() => {
                    input.value = '';
                    autoResizeChatInput();
                    state.editingMessageId = null;
                    document.getElementById('chat-edit-bar').classList.add('hidden');
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
                return;
            }
            
            const payload = { 
                senderId: state.currentUser.id, 
                senderName: state.currentUser.name, 
                text, 
                createdAt: Date.now() 
            };
            if (state.replyingTo) payload.replyTo = { id: state.replyingTo.id, author: state.replyingTo.author, text: state.replyingTo.text };

            push(ref(state.db, 'chats/' + state.currentChatId + '/messages'), payload).then(() => {
                update(ref(state.db, 'chats/' + state.currentChatId), { 
                    lastMessage: text, 
                    lastMessageAt: Date.now() 
                }); 
                input.value = '';
                autoResizeChatInput();
                clearTypingStatus();
                state.replyingTo = null;
                document.getElementById('chat-reply-bar').classList.add('hidden');
                awardPassXP(5, 'message');
            });
        }


        
        document.getElementById('btn-send-chat-message').onclick = sendChatMessage;

        setupAttachmentPicker('chat-attach-file', async (attachment) => {
            if (!state.currentChatId || !state.db) return;
            const captionByType = { image: '📎 Фото', video: '📎 Видео', audio: '📎 Аудио' };
            const payload = {
                senderId: state.currentUser.id,
                senderName: state.currentUser.name,
                text: '',
                attachment,
                createdAt: Date.now()
            };
            if (state.replyingTo) payload.replyTo = { id: state.replyingTo.id, author: state.replyingTo.author, text: state.replyingTo.text };
            await push(ref(state.db, 'chats/' + state.currentChatId + '/messages'), payload);
            update(ref(state.db, 'chats/' + state.currentChatId), {
                lastMessage: captionByType[attachment.type] || '📎 Вложение',
                lastMessageAt: Date.now()
            });
            state.replyingTo = null;
            document.getElementById('chat-reply-bar').classList.add('hidden');
        });
        document.getElementById('chat-message-input').addEventListener('keydown', (e) => { 
            // Enter теперь просто переносит строку (стандартное поведение textarea).
            // Отправка — только по кнопке ➤ или Ctrl+Enter/Cmd+Enter для удобства.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                sendChatMessage();
            }
        });



        export function autoResizeChatInput() {
            const el = document.getElementById('chat-message-input');
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 120) + 'px';
        }



        // === Индикатор "печатает..." ===



        export function clearTypingStatus() {
            if (state.typingClearTimer) { clearTimeout(state.typingClearTimer); state.typingClearTimer = null; }
            if (state.currentChatId && state.db) remove(ref(state.db, 'chats/' + state.currentChatId + '/typing/' + state.currentUser.id)).catch(() => {});
        }



        document.getElementById('chat-message-input').addEventListener('input', function() {
            autoResizeChatInput();
            if (!state.currentChatId || !state.db) return;
            const now = Date.now();
            if (now - state.lastTypingSent > 1500) {
                state.lastTypingSent = now;
                update(ref(state.db, 'chats/' + state.currentChatId + '/typing'), { [state.currentUser.id]: now }).catch(() => {});
            }
            if (state.typingClearTimer) clearTimeout(state.typingClearTimer);
            state.typingClearTimer = setTimeout(clearTypingStatus, 3000);
        });



        export function updateTypingIndicator(chat) {
            const el = document.getElementById('chat-typing-indicator');
            if (!el || !chat) return;
            const now = Date.now();
            const typerIds = chat.typing ? Object.entries(chat.typing).filter(([uid, ts]) => uid !== state.currentUser.id && (now - ts) < 5000).map(([uid]) => uid) : [];

            if (!typerIds.length) { el.classList.add('hidden'); return; }
            el.classList.remove('hidden');

            if (chat.type === 'group') {
                const names = typerIds.map(uid => { const u = state.usersData.find(x => x.id === uid); return u ? u.name : 'Кто-то'; });
                el.textContent = (names.length > 1 ? names.join(', ') + ' печатают...' : names[0] + ' печатает...');
            } else {
                el.textContent = 'печатает...';
            }
        }



        // Проверяем актуальность статуса раз в 1.5с — чтобы индикатор пропадал сам по себе, даже без новых событий из базы
        setInterval(() => {
            if (state.activeOverlay === 'chat' && state.currentChatId) {
                const chat = state.chatsData.find(c => c.id === state.currentChatId);
                if (chat) updateTypingIndicator(chat);
            }
        }, 1500);

        document.getElementById('close-chat-btn').onclick = function() {
            clearTypingStatus();
            state.replyingTo = null;
            document.getElementById('chat-reply-bar').classList.add('hidden');
            document.getElementById('chat-overlay').classList.remove('active'); 
            state.activeOverlay = null; 
            state.currentChatId = null; 
            tg.BackButton.hide(); 
            renderChatsList();
        };

        // НОВЫЙ ЧАТ/ГРУППА
        document.getElementById('btn-new-chat').onclick = function() {
            document.getElementById('user-search').value = ''; 
            document.getElementById('new-chat-overlay').classList.add('active'); 
            state.activeOverlay = 'newchat'; 
            tg.BackButton.show(); 
            renderUserPickList();
        };
        
        document.getElementById('close-new-chat-btn').onclick = function() {
            document.getElementById('new-chat-overlay').classList.remove('active'); 
            state.activeOverlay = null; 
            tg.BackButton.hide();
        };
        
        document.getElementById('btn-open-create-group').onclick = function() {
            document.getElementById('new-chat-overlay').classList.remove('active');
            document.getElementById('create-group-overlay').classList.add('active');
            state.activeOverlay = 'creategroup';
            
            document.getElementById('group-name').value = ''; 
            document.getElementById('group-desc').value = ''; 
            document.getElementById('group-avatar').value = '';
            
            renderUserPickList();
        };
        
        document.getElementById('close-create-group-btn').onclick = function() {
            document.getElementById('create-group-overlay').classList.remove('active'); 
            state.activeOverlay = null; 
            tg.BackButton.hide();
        };



        export function renderUserPickList() {
            const q = document.getElementById('user-search').value.trim().toLowerCase();
            let list = state.usersData.filter(u => u.id !== state.currentUser.id);
            if (q) {
                list = list.filter(u => (u.name || '').toLowerCase().includes(q));
            }
            
            if (state.activeOverlay === 'creategroup') {
                const container = document.getElementById('group-user-pick-list');
                if (!list.length) { 
                    container.innerHTML = '<div style="color:var(--text-secondary); font-size:13px; text-align:center;">Нет пользователей</div>'; 
                    return; 
                }
                container.innerHTML = list.map(u => `
                    <label style="display:flex; align-items:center; gap:10px; padding:6px; cursor:pointer;">
                        <input type="checkbox" value="${u.id}" class="group-user-cb">
                        ${avatarHtml(u.name, u.avatar, 'avatar-sm')}
                        <span style="font-weight:600; font-size:14px; color:var(--text-primary);">${escapeHtml(u.name || 'Читатель')}</span>
                    </label>
                `).join('');
            } else {
                const container = document.getElementById('user-pick-list');
                if (!list.length) { 
                    container.innerHTML = '<div class="empty-state"><div class="title">Никого не найдено</div></div>'; 
                    return; 
                }
                container.innerHTML = list.map(u => `
                    <div class="user-pick-item" onclick="startChatWith('${u.id}', '${escapeHtml(u.name || 'Читатель')}')">
                        ${avatarHtml(u.name, u.avatar, 'avatar-sm')}
                        <div>
                            <div style="font-weight:700;font-size:14px;color:var(--text-primary);">${escapeHtml(u.name || 'Читатель')}</div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${lastSeenText(u.lastSeen)}</div>
                        </div>
                    </div>
                `).join('');
            }
        }


        
        document.getElementById('user-search').addEventListener('input', renderUserPickList);



        export function startChatWith(otherId, otherName) {
            const chatId = [state.currentUser.id, otherId].sort().join('_');
            document.getElementById('new-chat-overlay').classList.remove('active');
            
            if (!state.chatsData.find(c => c.id === chatId)) {
                set(ref(state.db, 'chats/' + chatId), { 
                    participants: { [state.currentUser.id]: true, [otherId]: true }, 
                    participantNames: { [state.currentUser.id]: state.currentUser.name, [otherId]: otherName }, 
                    createdAt: Date.now() 
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
            }
            openChat(chatId);
        }

        window.startChatWith = startChatWith;



        // Логика создания группы
        document.getElementById('btn-submit-group').onclick = function() {
            const name = document.getElementById('group-name').value.trim();
            if (!name) {
                return tg.showAlert('Введите название группы');
            }
            
            const participants = { [state.currentUser.id]: true };
            document.querySelectorAll('.group-user-cb:checked').forEach(cb => {
                participants[cb.value] = true;
            });
            
            const chatId = 'group_' + Date.now();
            set(ref(state.db, 'chats/' + chatId), {
                type: 'group', 
                name: name, 
                desc: document.getElementById('group-desc').value.trim(), 
                avatar: document.getElementById('group-avatar').value.trim(),
                adminId: state.currentUser.id, 
                participants: participants, 
                createdAt: Date.now(), 
                lastMessage: 'Группа создана', 
                lastMessageAt: Date.now()
            }).then(() => { 
                document.getElementById('close-create-group-btn').click(); 
                openChat(chatId); 
            }).catch(err => tg.showAlert('Ошибка создания группы: ' + friendlyDbError(err)));
        };

        // Логика редактирования группы
        document.getElementById('chat-edit-group-btn').onclick = function() {
            const chat = state.chatsData.find(c => c.id === state.currentChatId);
            if (!chat || chat.type !== 'group') return;
            
            document.getElementById('edit-group-name').value = chat.name || '';
            document.getElementById('edit-group-desc').value = chat.desc || '';
            document.getElementById('edit-group-avatar').value = chat.avatar || '';
            
            document.getElementById('chat-overlay').classList.remove('active');
            document.getElementById('edit-group-overlay').classList.add('active');
            state.activeOverlay = 'editgroup';
        };
        
        document.getElementById('close-edit-group-btn').onclick = function() {
            document.getElementById('edit-group-overlay').classList.remove('active');
            openChat(state.currentChatId);
        };
        
        document.getElementById('btn-save-edit-group').onclick = function() {
            const name = document.getElementById('edit-group-name').value.trim();
            if (!name) return tg.showAlert('Название не может быть пустым');
            
            update(ref(state.db, 'chats/' + state.currentChatId), { 
                name: name, 
                desc: document.getElementById('edit-group-desc').value.trim(), 
                avatar: document.getElementById('edit-group-avatar').value.trim() 
            }).then(() => {
                document.getElementById('close-edit-group-btn').click();
            }).catch(err => tg.showAlert('Ошибка сохранения: ' + friendlyDbError(err)));
        };

        // === СТИКЕРЫ (С ПАКАМИ) ===
        document.getElementById('btn-toggle-stickers').onclick = function() {
            const p = document.getElementById('chat-sticker-picker');
            p.style.display = p.style.display === 'none' ? 'flex' : 'none';
            const body = document.getElementById('chat-body'); 
            body.scrollTop = body.scrollHeight;
        };



        export function renderStickerPicker() {
            const pickers = [
                { el: document.getElementById('chat-sticker-picker'), action: 'sendSticker' }, 
                { el: document.getElementById('comment-sticker-picker'), action: 'sendCommentSticker' }
            ];
            
            let allPacks = [...state.stickerPacksData];
            
            if (state.stickersData.length > 0) {
                allPacks.push({ 
                    id: 'legacy', 
                    name: 'Остальные', 
                    stickers: state.stickersData.reduce((acc, s) => ({...acc, [s.id]: s}), {}) 
                });
            }

            pickers.forEach(picker => {
                if (!picker.el) return;
                
                if (!allPacks.length) { 
                    picker.el.innerHTML = '<div style="font-size:12px; color:var(--text-secondary);">Нет стикеров</div>'; 
                    return; 
                }
                
                let html = '';
                allPacks.forEach(pack => {
                    if (!pack.stickers) return;
                    html += `
                        <div style="display:flex; flex-direction:column; gap:4px; margin-right:12px; flex-shrink:0;">
                            <span style="font-size:10px; font-weight:700; color:var(--text-secondary); padding-left:4px; text-transform:uppercase;">${escapeHtml(pack.name)}</span>
                            <div style="display:flex; gap:6px;">
                                ${Object.values(pack.stickers).map(s => `
                                    <img src="${s.url}" onclick="${picker.action}('${s.url}')" style="width:50px;height:50px;object-fit:contain;background:var(--input-bg);border-radius:10px;padding:4px;cursor:pointer;">
                                `).join('')}
                            </div>
                        </div>`;
                });
                picker.el.innerHTML = html;

                if (picker.action === 'sendSticker') {
                    const me = state.usersData.find(u => u.id === state.currentUser.id);
                    const sounds = (me && me.pass && me.pass.unlocked && me.pass.unlocked.sounds) ? Object.values(me.pass.unlocked.sounds) : [];
                    if (sounds.length) {
                        picker.el.innerHTML += `
                            <div style="display:flex; flex-direction:column; gap:4px; margin-right:12px; flex-shrink:0;">
                                <span style="font-size:10px; font-weight:700; color:var(--text-secondary); padding-left:4px; text-transform:uppercase;">🎫 Пасс</span>
                                <div style="display:flex; gap:6px;">
                                    ${sounds.map(url => `<button onclick="sendSoundSticker('${url}')" style="width:50px;height:50px;border:none;border-radius:10px;background:var(--input-bg);font-size:22px;cursor:pointer;">🔊</button>`).join('')}
                                </div>
                            </div>`;
                    }
                }
            });
        }

        window.sendSoundSticker = function(url) {
            if (!state.currentChatId || !state.db) return;
            push(ref(state.db, 'chats/' + state.currentChatId + '/messages'), {
                senderId: state.currentUser.id,
                senderName: state.currentUser.name,
                text: '',
                soundSticker: url,
                createdAt: Date.now()
            }).then(() => {
                update(ref(state.db, 'chats/' + state.currentChatId), {
                    lastMessage: '🔊 Звук-стикер',
                    lastMessageAt: Date.now()
                });
                document.getElementById('chat-sticker-picker').style.display = 'none';
            }).catch(err => tg.showAlert('Ошибка отправки: ' + friendlyDbError(err)));
        };

        window.sendSticker = function(url) {
            if (!state.currentChatId || !state.db) return;
            
            push(ref(state.db, 'chats/' + state.currentChatId + '/messages'), { 
                senderId: state.currentUser.id, 
                senderName: state.currentUser.name, 
                text: '', 
                sticker: url, 
                createdAt: Date.now() 
            }).then(() => { 
                update(ref(state.db, 'chats/' + state.currentChatId), { 
                    lastMessage: '🖼 Стикер', 
                    lastMessageAt: Date.now() 
                }); 
                document.getElementById('chat-sticker-picker').style.display = 'none'; 
            }).catch(err => tg.showAlert('Ошибка отправки: ' + friendlyDbError(err)));
        };



        // === ПРОФИЛЬ ===


        export function populateStickerPackSelect() {
            const sel = document.getElementById('sticker-pack-select'); 
            if (!sel) return;
            
            const prev = sel.value;
            sel.innerHTML = state.stickerPacksData.length 
                ? state.stickerPacksData.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('') 
                : '<option value="">Сначала создайте пак</option>';
                
            if (state.stickerPacksData.some(p => p.id === prev)) {
                sel.value = prev;
            }
        }


        
        document.getElementById('btn-add-sticker').onclick = function() {
            const packId = document.getElementById('sticker-pack-select').value;
            const url = document.getElementById('sticker-url-input').value.trim();
            if (!url) return tg.showAlert('Добавь ссылку на стикер');
            
            if (packId) { 
                push(ref(state.db, `sticker_packs/${packId}/stickers`), { 
                    url: url, 
                    createdAt: Date.now() 
                }).then(() => { 
                    document.getElementById('sticker-url-input').value = ''; 
                    tg.showPopup({ title: 'Готово', message: 'Стикер добавлен', buttons: [{ type: 'ok' }] }); 
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err))); 
            } else { 
                push(ref(state.db, 'stickers'), { 
                    url: url, 
                    createdAt: Date.now() 
                }).then(() => { 
                    document.getElementById('sticker-url-input').value = ''; 
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err))); 
            }
        };
