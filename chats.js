import { ref, push, update, remove, set } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { attachmentHtml, avatarHtml, colorFor, compressImage, escapeHtml, formatDate, friendlyDbError, friendlyUploadError, initialOf, lastSeenText, nickColorStyle, saveLocal, setupAttachmentPicker, shopBadgeHtml, uploadToImgbb, verifiedBadge } from './utils.js';
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

        // === Ролевые группы: вспомогательные функции ===

        export function isGroupGM(chat) {
            return !!(chat && chat.type === 'group' && chat.adminId === state.currentUser.id);
        }

        export function isRoleplayGroup(chat) {
            return !!(chat && chat.type === 'group' && chat.groupMode === 'roleplay');
        }

        export function charactersOf(chat) {
            return chat && chat.characters ? Object.entries(chat.characters).map(([id, v]) => ({ id, ...v })) : [];
        }

        export function myCharactersIn(chat) {
            return charactersOf(chat).filter(c => c.ownerId === state.currentUser.id);
        }

        export function getActiveCharacter(chat) {
            if (!chat) return null;
            const charId = state.activeCharacterByChat[chat.id];
            if (!charId) return null;
            const c = (chat.characters || {})[charId];
            return c ? { id: charId, ...c } : null;
        }

        export function updateChatRpStatusBar(chat) {
            const bar = document.getElementById('chat-rp-status-bar');
            const actionBtn = document.getElementById('btn-toggle-action-mode');
            if (!bar || !actionBtn) return;

            if (!isRoleplayGroup(chat)) {
                bar.classList.add('hidden');
                actionBtn.classList.add('hidden');
                return;
            }
            actionBtn.classList.remove('hidden');
            actionBtn.classList.toggle('active', !!state.actionModeByChat[chat.id]);

            const activeChar = getActiveCharacter(chat);
            bar.classList.remove('hidden');
            document.getElementById('chat-rp-status-text').textContent = activeChar
                ? `🎭 Говорите как: ${activeChar.name}`
                : '🎭 Говорите от своего имени';
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
                document.getElementById('chat-partner-status').textContent = Object.keys(chat.participants || {}).length + ' участников' + (isRoleplayGroup(chat) ? ' · 🎭 ролевая' : '');
                document.getElementById('chat-edit-group-btn').classList.toggle('hidden', chat.adminId !== state.currentUser.id);
                document.getElementById('chat-rp-btn').classList.toggle('hidden', !isRoleplayGroup(chat));
                document.getElementById('chat-wiki-btn').classList.remove('hidden');
            } else {
                const other = otherParticipant(chat);
                document.getElementById('chat-partner-name').textContent = other.name;
                document.getElementById('chat-partner-avatar-wrap').innerHTML = avatarHtml(other.name, other.avatar, 'avatar-sm');
                document.getElementById('chat-partner-status').textContent = lastSeenText(other.lastSeen) + (other.mood ? ' · настроение ' + other.mood : '');
                document.getElementById('chat-edit-group-btn').classList.add('hidden');
                document.getElementById('chat-rp-btn').classList.add('hidden');
                document.getElementById('chat-wiki-btn').classList.add('hidden');
            }
            updateChatRpStatusBar(chat);

            const pinned = chat.pinnedQuote;
            document.getElementById('chat-pinned-bar').classList.toggle('hidden', !pinned);
            if (pinned) {
                document.getElementById('chat-pinned-text').textContent = '"' + pinned.text + '" — ' + pinned.author;
            }
            document.getElementById('chat-quote-watermark').textContent = pinned ? '"' + pinned.text + '"' : '';
            updateTypingIndicator(chat);

            const messages = chat.messages ? Object.entries(chat.messages).map(([id, m]) => ({ id, ...m })).sort((a, b) => a.createdAt - b.createdAt) : [];
            const listEl = document.getElementById('chat-messages-list');
            const signature = messages.map(m => m.id + (m.edited ? ':e' : '') + (m.text ? m.text.length : 0) + (m.asCharacterId || '') + (m.messageStyle || '')).join(',') + '|' + (pinned ? pinned.pinnedAt : '') + '|' + JSON.stringify(chat.characters || {}).length;

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
                const charOverride = m.asCharacterId && chat.characters && chat.characters[m.asCharacterId];
                const displayName = charOverride ? charOverride.name : m.senderName;
                const senderInfo = state.usersData.find(u => u.id === m.senderId);
                const displayAvatarUrl = charOverride ? charOverride.avatar : (senderInfo ? senderInfo.avatar : null);

                const isAction = m.messageStyle === 'action';
                if (isAction) {
                    const replyPreviewA = m.replyTo ? `<div class="msg-reply-quote"><b>${escapeHtml(m.replyTo.author)}</b>: ${escapeHtml(m.replyTo.text)}</div>` : '';
                    return `
                    <div class="msg-row msg-row-action">
                        <div class="msg-action-line">
                            ${replyPreviewA}
                            <span>🎬 <b>${escapeHtml(displayName)}</b> ${escapeHtml(m.text)}</span>
                            <span class="msg-time" style="margin-left:6px;">${timeStr}${m.edited ? ' (изменено)' : ''}</span>
                        </div>
                    </div>`;
                }

                const senderName = (chat.type === 'group' && (!isMine || charOverride))
                    ? `<div class="msg-sender-name" data-uid="${m.senderId}" style="font-size:11px; font-weight:700; ${nickColorStyle(m.senderId) || 'color:#ff9f0a;'} margin-bottom:2px; cursor:pointer;">${escapeHtml(displayName)}${charOverride ? '' : verifiedBadge(m.senderId) + shopBadgeHtml(m.senderId) + passVipBadge(m.senderId)}</div>` 
                    : '';

                const avatarBlock = !isMine ? `<div class="msg-avatar-click" data-uid="${m.senderId}">${avatarHtml(charOverride ? displayName : (senderInfo ? senderInfo.name : m.senderName), displayAvatarUrl, 'msg-avatar')}</div>` : '';

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
            
            const chat = state.chatsData.find(c => c.id === state.currentChatId);
            const activeChar = chat ? getActiveCharacter(chat) : null;
            const isActionMode = !!state.actionModeByChat[state.currentChatId];

            const payload = { 
                senderId: state.currentUser.id, 
                senderName: state.currentUser.name, 
                text, 
                createdAt: Date.now() 
            };
            if (activeChar) payload.asCharacterId = activeChar.id;
            if (isActionMode) payload.messageStyle = 'action';
            if (state.replyingTo) payload.replyTo = { id: state.replyingTo.id, author: state.replyingTo.author, text: state.replyingTo.text };

            const previewText = isActionMode ? `🎬 ${(activeChar ? activeChar.name : state.currentUser.name)} ${text}` : text;

            push(ref(state.db, 'chats/' + state.currentChatId + '/messages'), payload).then(() => {
                update(ref(state.db, 'chats/' + state.currentChatId), { 
                    lastMessage: previewText, 
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
        
        // === Переключатель типа группы (обычная / ролевая) ===
        function wireTypeChipPicker(containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.querySelectorAll('.chip').forEach(chip => {
                chip.onclick = () => {
                    container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                };
            });
        }
        function setTypeChipPicker(containerId, type) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.getAttribute('data-type') === type));
        }
        function getTypeChipPicker(containerId) {
            const container = document.getElementById(containerId);
            const active = container && container.querySelector('.chip.active');
            return active ? active.getAttribute('data-type') : 'normal';
        }
        wireTypeChipPicker('group-type-picker');
        wireTypeChipPicker('edit-group-type-picker');

        document.getElementById('btn-open-create-group').onclick = function() {
            document.getElementById('new-chat-overlay').classList.remove('active');
            document.getElementById('create-group-overlay').classList.add('active');
            state.activeOverlay = 'creategroup';
            
            document.getElementById('group-name').value = ''; 
            document.getElementById('group-desc').value = ''; 
            document.getElementById('group-avatar').value = '';
            setTypeChipPicker('group-type-picker', 'normal');
            
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
            const groupMode = getTypeChipPicker('group-type-picker');
            set(ref(state.db, 'chats/' + chatId), {
                type: 'group', 
                name: name, 
                desc: document.getElementById('group-desc').value.trim(), 
                avatar: document.getElementById('group-avatar').value.trim(),
                adminId: state.currentUser.id, 
                participants: participants, 
                createdAt: Date.now(), 
                lastMessage: 'Группа создана', 
                lastMessageAt: Date.now(),
                ...(groupMode === 'roleplay' ? { groupMode: 'roleplay' } : {})
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
            setTypeChipPicker('edit-group-type-picker', chat.groupMode === 'roleplay' ? 'roleplay' : 'normal');
            
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
            
            const groupMode = getTypeChipPicker('edit-group-type-picker');
            update(ref(state.db, 'chats/' + state.currentChatId), { 
                name: name, 
                desc: document.getElementById('edit-group-desc').value.trim(), 
                avatar: document.getElementById('edit-group-avatar').value.trim(),
                groupMode: groupMode === 'roleplay' ? 'roleplay' : null
            }).then(() => {
                document.getElementById('close-edit-group-btn').click();
            }).catch(err => tg.showAlert('Ошибка сохранения: ' + friendlyDbError(err)));
        };

        document.getElementById('btn-delete-group').onclick = function() {
            const chat = state.chatsData.find(c => c.id === state.currentChatId);
            if (!chat) return;
            tg.showConfirm(`Удалить группу «${chat.name || ''}»? Все сообщения, персонажи и инвентари будут удалены безвозвратно.`, (ok) => {
                if (!ok) return;
                remove(ref(state.db, 'chats/' + state.currentChatId)).then(() => {
                    document.getElementById('edit-group-overlay').classList.remove('active');
                    document.getElementById('chat-overlay').classList.remove('active');
                    state.activeOverlay = null;
                    state.currentChatId = null;
                    tg.BackButton.hide();
                    renderChatsList();
                }).catch(err => tg.showAlert('Ошибка удаления: ' + friendlyDbError(err)));
            });
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


        // ===================== РОЛЕВЫЕ ГРУППЫ: ПАНЕЛЬ, ПЕРСОНАЖИ, ИНВЕНТАРЬ =====================

        // Аватар в стиле карточек админ-списка (не через avatarHtml — там другие CSS-классы)
        function adminThumbHtml(name, url) {
            return url
                ? `<img src="${url}" class="admin-item-thumb" onerror="this.style.display='none'">`
                : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(name || '')}">${initialOf(name)}</div>`;
        }

        document.getElementById('chat-rp-btn').onclick = function() {
            openRpPanel();
        };

        document.getElementById('btn-chat-rp-status-change').onclick = function() {
            openRpPanel();
        };

        document.getElementById('btn-toggle-action-mode').onclick = function() {
            if (!state.currentChatId) return;
            state.actionModeByChat[state.currentChatId] = !state.actionModeByChat[state.currentChatId];
            const chat = state.chatsData.find(c => c.id === state.currentChatId);
            updateChatRpStatusBar(chat);
            const input = document.getElementById('chat-message-input');
            input.placeholder = state.actionModeByChat[state.currentChatId] ? 'Опишите действие персонажа...' : 'Сообщение...';
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
        };

        export function setActiveCharacter(charId) {
            const chatId = state.rpPanelChatId || state.currentChatId;
            if (!chatId) return;
            if (charId) state.activeCharacterByChat[chatId] = charId;
            else delete state.activeCharacterByChat[chatId];
            saveLocal('sr_active_character', state.activeCharacterByChat);
            const chat = state.chatsData.find(c => c.id === chatId);
            if (chat) updateChatRpStatusBar(chat);
        }

        export function openRpPanel() {
            const chat = state.chatsData.find(c => c.id === state.currentChatId);
            if (!chat || !isRoleplayGroup(chat)) return;
            state.rpPanelChatId = chat.id;
            document.getElementById('chat-overlay').classList.remove('active');
            document.getElementById('rp-panel-overlay').classList.add('active');
            state.activeOverlay = 'rppanel';
            document.getElementById('rp-panel-title').textContent = isGroupGM(chat) ? '🎭 Ролевая панель · ГМ' : '🎭 Мои персонажи';
            renderRpPanel();
        }

        document.getElementById('close-rp-panel-btn').onclick = function() {
            document.getElementById('rp-panel-overlay').classList.remove('active');
            const chatId = state.rpPanelChatId;
            state.rpPanelChatId = null;
            if (chatId) openChat(chatId);
        };

        export function renderRpPanel() {
            if (state.activeOverlay !== 'rppanel' || !state.rpPanelChatId) return;
            const chat = state.chatsData.find(c => c.id === state.rpPanelChatId);
            const body = document.getElementById('rp-panel-body');
            if (!body) return;
            if (!chat) { body.innerHTML = ''; return; }

            const gm = isGroupGM(chat);
            const list = gm ? charactersOf(chat) : myCharactersIn(chat);
            const activeChar = getActiveCharacter(chat);
            const me = state.usersData.find(u => u.id === state.currentUser.id);

            let html = `
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
                    ${gm ? 'Здесь можно создавать NPC, смотреть персонажей игроков и управлять их инвентарём.' : 'Создайте своего персонажа, чтобы отыгрывать его в этой группе. Инвентарём персонажа управляет ГМ.'}
                </div>
                <button class="btn" id="btn-rp-create-character" style="margin-bottom:14px;">+ Создать персонажа</button>
                <div class="admin-item" id="btn-rp-speak-as-self" style="cursor:pointer;${!activeChar ? 'border:2px solid #ff9f0a;' : ''}">
                    ${adminThumbHtml(me ? me.name : state.currentUser.name, me ? me.avatar : null)}
                    <div class="admin-item-info">
                        <div class="admin-item-title">Говорить от своего имени</div>
                        <div class="admin-item-sub">${!activeChar ? 'Сейчас активно' : 'Нажмите, чтобы вернуться к себе'}</div>
                    </div>
                </div>
                <h4 style="margin:16px 0 8px;color:var(--text-primary);font-size:14px;">${gm ? 'Все персонажи группы' : 'Мои персонажи'}</h4>
            `;

            if (!list.length) {
                html += `<div style="color:var(--text-secondary);font-size:13px;text-align:center;margin-top:10px;">${gm ? 'Персонажей пока нет.' : 'У вас пока нет персонажа в этой группе.'}</div>`;
            } else {
                html += list.map(c => {
                    const owner = state.usersData.find(u => u.id === c.ownerId);
                    const invCount = c.inventory ? Object.keys(c.inventory).length : 0;
                    const isActive = activeChar && activeChar.id === c.id;
                    return `
                    <div class="admin-item" style="${isActive ? 'border:2px solid #ff9f0a;' : ''}">
                        ${avatarHtml(c.name, c.avatar, 'admin-item-thumb')}
                        <div class="admin-item-info">
                            <div class="admin-item-title">${escapeHtml(c.name || '(без имени)')}</div>
                            <div class="admin-item-sub">${gm ? 'Игрок: ' + escapeHtml(owner ? owner.name : 'неизвестно') + ' · ' : ''}🎒 ${invCount ? invCount + ' предм.' : 'пусто'}</div>
                        </div>
                        <div class="admin-item-actions">
                            <button class="icon-btn ${isActive ? 'active' : ''}" data-act="speak" data-id="${c.id}" title="Говорить за персонажа">🎭</button>
                            <button class="icon-btn" data-act="inventory" data-id="${c.id}" title="Инвентарь">🎒</button>
                            <button class="icon-btn" data-act="edit" data-id="${c.id}" title="Редактировать">✏️</button>
                            <button class="icon-btn danger" data-act="delete" data-id="${c.id}" title="Удалить">🗑</button>
                        </div>
                    </div>`;
                }).join('');
            }

            body.innerHTML = html;

            document.getElementById('btn-rp-create-character').onclick = () => openCharacterEditor(null);
            document.getElementById('btn-rp-speak-as-self').onclick = () => { setActiveCharacter(null); renderRpPanel(); };

            body.querySelectorAll('[data-act]').forEach(btn => {
                const id = btn.getAttribute('data-id');
                const act = btn.getAttribute('data-act');
                btn.onclick = () => {
                    if (act === 'speak') { setActiveCharacter(id); renderRpPanel(); }
                    else if (act === 'inventory') openCharacterInventory(id);
                    else if (act === 'edit') openCharacterEditor(id);
                    else if (act === 'delete') deleteCharacterWithConfirm(id);
                };
            });
        }

        // === Создание / редактирование персонажа ===

        export function openCharacterEditor(charId) {
            const chat = state.chatsData.find(c => c.id === state.rpPanelChatId);
            if (!chat) return;
            const c = charId ? (chat.characters || {})[charId] : null;
            if (charId && !c) return;
            if (charId && !isGroupGM(chat) && c.ownerId !== state.currentUser.id) return; // чужого персонажа редактировать нельзя

            state.editingCharacterId = charId;
            document.getElementById('character-edit-title').textContent = charId ? 'Редактирование персонажа' : 'Новый персонаж';
            document.getElementById('character-name').value = c ? (c.name || '') : '';
            document.getElementById('character-desc').value = c ? (c.desc || '') : '';
            document.getElementById('character-avatar').value = c ? (c.avatar || '') : '';
            document.getElementById('btn-delete-character').classList.toggle('hidden', !charId);

            document.getElementById('rp-panel-overlay').classList.remove('active');
            document.getElementById('character-edit-overlay').classList.add('active');
            state.activeOverlay = 'charactereditor';
        }

        document.getElementById('close-character-edit-btn').onclick = function() {
            document.getElementById('character-edit-overlay').classList.remove('active');
            document.getElementById('rp-panel-overlay').classList.add('active');
            state.activeOverlay = 'rppanel';
            renderRpPanel();
        };

        document.getElementById('btn-save-character').onclick = function() {
            const chat = state.chatsData.find(c => c.id === state.rpPanelChatId);
            if (!chat) return;
            const name = document.getElementById('character-name').value.trim();
            if (!name) return tg.showAlert('Введите имя персонажа');

            const payload = {
                name,
                desc: document.getElementById('character-desc').value.trim(),
                avatar: document.getElementById('character-avatar').value.trim()
            };
            const basePath = 'chats/' + chat.id + '/characters/';

            if (state.editingCharacterId) {
                update(ref(state.db, basePath + state.editingCharacterId), payload).then(() => {
                    document.getElementById('close-character-edit-btn').click();
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
            } else {
                payload.ownerId = state.currentUser.id;
                payload.createdAt = Date.now();
                push(ref(state.db, basePath), payload).then(() => {
                    document.getElementById('close-character-edit-btn').click();
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
            }
        };

        document.getElementById('btn-delete-character').onclick = function() {
            if (!state.editingCharacterId) return;
            deleteCharacterWithConfirm(state.editingCharacterId, () => document.getElementById('close-character-edit-btn').click());
        };

        export function deleteCharacterWithConfirm(charId, afterDelete) {
            const chat = state.chatsData.find(c => c.id === state.rpPanelChatId);
            if (!chat) return;
            const c = (chat.characters || {})[charId];
            if (c && !isGroupGM(chat) && c.ownerId !== state.currentUser.id) return;

            tg.showConfirm('Удалить этого персонажа вместе с его инвентарём?', (ok) => {
                if (!ok) return;
                remove(ref(state.db, 'chats/' + chat.id + '/characters/' + charId)).then(() => {
                    if (state.activeCharacterByChat[chat.id] === charId) {
                        delete state.activeCharacterByChat[chat.id];
                        saveLocal('sr_active_character', state.activeCharacterByChat);
                    }
                    if (afterDelete) afterDelete(); else renderRpPanel();
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
            });
        }

        // === Инвентарь персонажа (полностью управляется ГМ, игрок видит его в режиме чтения) ===

        export function openCharacterInventory(charId) {
            const chat = state.chatsData.find(c => c.id === state.rpPanelChatId);
            if (!chat) return;
            state.rpPanelCharacterId = charId;
            const c = (chat.characters || {})[charId];

            document.getElementById('character-inventory-title').textContent = '🎒 ' + (c ? c.name : 'Инвентарь');
            document.getElementById('character-inventory-add-row').classList.toggle('hidden', !isGroupGM(chat));
            document.getElementById('inv-item-name').value = '';
            document.getElementById('inv-item-qty').value = '1';
            document.getElementById('inv-item-note').value = '';
            document.getElementById('inv-item-usable').checked = false;

            document.getElementById('rp-panel-overlay').classList.remove('active');
            document.getElementById('character-inventory-overlay').classList.add('active');
            state.activeOverlay = 'characterinventory';
            renderCharacterInventory();
        }

        document.getElementById('close-character-inventory-btn').onclick = function() {
            document.getElementById('character-inventory-overlay').classList.remove('active');
            document.getElementById('rp-panel-overlay').classList.add('active');
            state.activeOverlay = 'rppanel';
            renderRpPanel();
        };

        export function renderCharacterInventory() {
            if (state.activeOverlay !== 'characterinventory' || !state.rpPanelChatId || !state.rpPanelCharacterId) return;
            const chat = state.chatsData.find(c => c.id === state.rpPanelChatId);
            const list = document.getElementById('character-inventory-list');
            if (!list) return;
            if (!chat) { list.innerHTML = ''; return; }

            const c = (chat.characters || {})[state.rpPanelCharacterId];
            if (!c) { list.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Персонаж не найден</div>'; return; }

            const gm = isGroupGM(chat);
            const items = c.inventory ? Object.entries(c.inventory).map(([id, v]) => ({ id, ...v })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) : [];

            if (!items.length) {
                list.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;text-align:center;margin-top:10px;">Инвентарь пуст</div>';
            } else {
                list.innerHTML = items.map(it => `
                    <div class="admin-item">
                        <div class="admin-item-thumb cover-fallback small" style="background:${colorFor(it.name || '')};">🎒</div>
                        <div class="admin-item-info">
                            <div class="admin-item-title">${escapeHtml(it.name)} ×${it.qty || 1}</div>
                            ${it.note ? `<div class="admin-item-sub">${escapeHtml(it.note)}</div>` : ''}
                            ${(!gm && it.usable) ? `<div class="admin-item-sub" style="color:#ff9f0a;">Можно использовать</div>` : ''}
                        </div>
                        <div class="admin-item-actions">
                            ${gm ? `
                                <button class="icon-btn" data-inv-act="dec" data-id="${it.id}">−</button>
                                <button class="icon-btn" data-inv-act="inc" data-id="${it.id}">+</button>
                                <button class="icon-btn danger" data-inv-act="remove" data-id="${it.id}">🗑</button>
                            ` : (it.usable ? `
                                <button class="btn" style="margin:0;width:auto;padding:8px 14px;" data-inv-act="use" data-id="${it.id}">Использовать</button>
                            ` : '')}
                        </div>
                    </div>`).join('');
            }

            list.querySelectorAll('[data-inv-act]').forEach(btn => {
                const id = btn.getAttribute('data-id');
                const act = btn.getAttribute('data-inv-act');
                btn.onclick = () => {
                    const path = 'chats/' + chat.id + '/characters/' + state.rpPanelCharacterId + '/inventory/' + id;
                    if (gm && act === 'remove') {
                        remove(ref(state.db, path)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
                    } else if (gm) {
                        const current = (c.inventory || {})[id] || {};
                        const newQty = Math.max(1, (current.qty || 1) + (act === 'inc' ? 1 : -1));
                        update(ref(state.db, path), { qty: newQty }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
                    } else if (act === 'use') {
                        useInventoryItem(chat, c, id);
                    }
                };
            });
        }

        // Игрок использует расходуемый предмет из своего инвентаря: списывает его
        // и отправляет в чат экшн-сообщение о том, что персонаж его использовал.
        function useInventoryItem(chat, character, itemId) {
            const item = (character.inventory || {})[itemId];
            if (!item || !item.usable) return;
            if (character.ownerId !== state.currentUser.id) return; // можно использовать только предметы своего персонажа

            const path = 'chats/' + chat.id + '/characters/' + character.id + '/inventory/' + itemId;
            const newQty = (item.qty || 1) - 1;
            const dbAction = newQty > 0
                ? update(ref(state.db, path), { qty: newQty })
                : remove(ref(state.db, path));

            dbAction.then(() => {
                const actionText = `использует «${item.name}»${item.note ? ' — ' + item.note : ''}`;
                const payload = {
                    senderId: state.currentUser.id,
                    senderName: state.currentUser.name,
                    text: actionText,
                    messageStyle: 'action',
                    asCharacterId: character.id,
                    createdAt: Date.now()
                };
                push(ref(state.db, 'chats/' + chat.id + '/messages'), payload).then(() => {
                    update(ref(state.db, 'chats/' + chat.id), {
                        lastMessage: `🎬 ${character.name} ${actionText}`,
                        lastMessageAt: Date.now()
                    });
                });
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                renderCharacterInventory();
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        }

        document.getElementById('btn-add-inventory-item').onclick = function() {
            const chat = state.chatsData.find(c => c.id === state.rpPanelChatId);
            if (!chat || !isGroupGM(chat) || !state.rpPanelCharacterId) return;

            const name = document.getElementById('inv-item-name').value.trim();
            if (!name) return tg.showAlert('Введите название предмета');
            const qty = Math.max(1, parseInt(document.getElementById('inv-item-qty').value, 10) || 1);
            const note = document.getElementById('inv-item-note').value.trim();
            const usable = document.getElementById('inv-item-usable').checked;

            push(ref(state.db, 'chats/' + chat.id + '/characters/' + state.rpPanelCharacterId + '/inventory'), {
                name, qty, note, usable, createdAt: Date.now()
            }).then(() => {
                document.getElementById('inv-item-name').value = '';
                document.getElementById('inv-item-qty').value = '1';
                document.getElementById('inv-item-note').value = '';
                document.getElementById('inv-item-usable').checked = false;
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        // ===================== ВИКИ ГРУППЫ ("ДРОП"): КАТЕГОРИИ И ПОСТЫ =====================
        // Смотреть вики может любой участник группы. Добавлять категории и посты — только
        // создатель группы (isGroupGM). Структура в БД:
        //   chats/{chatId}/wiki/categories/{catId} = { name, createdAt }
        //   chats/{chatId}/wiki/posts/{postId}     = { categoryId, title, text, images:[...], authorId, createdAt }

        document.getElementById('chat-wiki-btn').onclick = function() {
            openGroupWiki();
        };

        export function openGroupWiki() {
            const chat = state.chatsData.find(c => c.id === state.currentChatId);
            if (!chat || chat.type !== 'group') return;
            state.wikiChatId = chat.id;
            document.getElementById('chat-overlay').classList.remove('active');
            document.getElementById('group-wiki-overlay').classList.add('active');
            state.activeOverlay = 'groupwiki';
            document.getElementById('group-wiki-title').textContent = '📦 Дроп · ' + (chat.name || '');
            document.getElementById('wiki-category-name').value = '';
            renderGroupWiki();
        }

        document.getElementById('close-group-wiki-btn').onclick = function() {
            document.getElementById('group-wiki-overlay').classList.remove('active');
            const chatId = state.wikiChatId;
            state.wikiChatId = null;
            if (chatId) openChat(chatId);
        };

        export function renderGroupWiki() {
            if (state.activeOverlay !== 'groupwiki' || !state.wikiChatId) return;
            const chat = state.chatsData.find(c => c.id === state.wikiChatId);
            const list = document.getElementById('group-wiki-categories-list');
            if (!list) return;
            if (!chat) { list.innerHTML = ''; return; }

            const owner = isGroupGM(chat);
            document.getElementById('wiki-add-category-row').classList.toggle('hidden', !owner);

            const categories = chat.wiki && chat.wiki.categories
                ? Object.entries(chat.wiki.categories).map(([id, v]) => ({ id, ...v })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
                : [];

            if (!categories.length) {
                list.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;text-align:center;margin-top:10px;">${owner ? 'Пока нет категорий — добавьте первую выше.' : 'В этом чате пока нет вики.'}</div>`;
            } else {
                const posts = chat.wiki && chat.wiki.posts ? Object.values(chat.wiki.posts) : [];
                list.innerHTML = categories.map(cat => {
                    const count = posts.filter(p => p.categoryId === cat.id).length;
                    return `
                    <div class="admin-item" data-cat-id="${cat.id}" style="cursor:pointer;">
                        <div class="admin-item-thumb cover-fallback small" style="background:${colorFor(cat.name || '')};">📁</div>
                        <div class="admin-item-info">
                            <div class="admin-item-title">${escapeHtml(cat.name || '(без имени)')}</div>
                            <div class="admin-item-sub">${count ? count + ' пост.' : 'пусто'}</div>
                        </div>
                        ${owner ? `<div class="admin-item-actions"><button class="icon-btn danger" data-del-cat="${cat.id}" title="Удалить категорию">🗑</button></div>` : ''}
                    </div>`;
                }).join('');
            }

            list.querySelectorAll('[data-cat-id]').forEach(el => {
                el.onclick = (e) => {
                    if (e.target.closest('[data-del-cat]')) return;
                    openWikiCategory(el.getAttribute('data-cat-id'));
                };
            });
            list.querySelectorAll('[data-del-cat]').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const catId = btn.getAttribute('data-del-cat');
                    tg.showConfirm('Удалить категорию вместе со всеми постами в ней?', (ok) => {
                        if (!ok) return;
                        const updates = {};
                        updates['chats/' + chat.id + '/wiki/categories/' + catId] = null;
                        const postsEntries = chat.wiki && chat.wiki.posts ? Object.entries(chat.wiki.posts) : [];
                        postsEntries.forEach(([pid, p]) => { if (p.categoryId === catId) updates['chats/' + chat.id + '/wiki/posts/' + pid] = null; });
                        update(ref(state.db), updates).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
                    });
                };
            });
        }

        document.getElementById('btn-add-wiki-category').onclick = function() {
            const chat = state.chatsData.find(c => c.id === state.wikiChatId);
            if (!chat || !isGroupGM(chat)) return;
            const input = document.getElementById('wiki-category-name');
            const name = input.value.trim();
            if (!name) return tg.showAlert('Введите название категории');
            push(ref(state.db, 'chats/' + chat.id + '/wiki/categories'), { name, createdAt: Date.now() })
                .then(() => {
                    input.value = '';
                    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };

        // ---- Посты внутри категории ----

        export function openWikiCategory(categoryId) {
            const chat = state.chatsData.find(c => c.id === state.wikiChatId);
            if (!chat) return;
            state.wikiCategoryId = categoryId;
            const cat = (chat.wiki && chat.wiki.categories || {})[categoryId];
            document.getElementById('wiki-category-title').textContent = cat ? cat.name : 'Категория';
            document.getElementById('btn-wiki-add-post').classList.toggle('hidden', !isGroupGM(chat));
            document.getElementById('group-wiki-overlay').classList.remove('active');
            document.getElementById('wiki-category-overlay').classList.add('active');
            state.activeOverlay = 'wikicategory';
            renderWikiCategory();
        }

        document.getElementById('close-wiki-category-btn').onclick = function() {
            document.getElementById('wiki-category-overlay').classList.remove('active');
            document.getElementById('group-wiki-overlay').classList.add('active');
            state.activeOverlay = 'groupwiki';
            renderGroupWiki();
        };

        document.getElementById('btn-wiki-add-post').onclick = function() {
            openWikiPostEditor(null);
        };

        export function renderWikiCategory() {
            if (state.activeOverlay !== 'wikicategory' || !state.wikiChatId || !state.wikiCategoryId) return;
            const chat = state.chatsData.find(c => c.id === state.wikiChatId);
            const list = document.getElementById('wiki-category-posts-list');
            if (!list) return;
            if (!chat) { list.innerHTML = ''; return; }

            const owner = isGroupGM(chat);
            const posts = chat.wiki && chat.wiki.posts
                ? Object.entries(chat.wiki.posts).map(([id, v]) => ({ id, ...v })).filter(p => p.categoryId === state.wikiCategoryId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                : [];

            if (!posts.length) {
                list.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;text-align:center;margin-top:10px;">${owner ? 'Постов пока нет — добавьте первый кнопкой «+».' : 'В этой категории пока пусто.'}</div>`;
            } else {
                list.innerHTML = posts.map(p => {
                    const thumb = (p.images && p.images[0])
                        ? `<img src="${p.images[0]}" class="admin-item-thumb" onerror="this.style.display='none'">`
                        : `<div class="admin-item-thumb cover-fallback small" style="background:${colorFor(p.title || '')};">📝</div>`;
                    return `
                    <div class="admin-item" data-post-id="${p.id}" style="cursor:pointer;">
                        ${thumb}
                        <div class="admin-item-info">
                            <div class="admin-item-title">${escapeHtml(p.title || '(без названия)')}</div>
                            <div class="admin-item-sub">${p.images && p.images.length ? '🖼 ' + p.images.length : ''}</div>
                        </div>
                        ${owner ? `<div class="admin-item-actions"><button class="icon-btn danger" data-del-post="${p.id}" title="Удалить">🗑</button></div>` : ''}
                    </div>`;
                }).join('');
            }

            list.querySelectorAll('[data-post-id]').forEach(el => {
                el.onclick = (e) => {
                    if (e.target.closest('[data-del-post]')) return;
                    openWikiPost(el.getAttribute('data-post-id'));
                };
            });
            list.querySelectorAll('[data-del-post]').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const postId = btn.getAttribute('data-del-post');
                    tg.showConfirm('Удалить этот пост?', (ok) => {
                        if (!ok) return;
                        remove(ref(state.db, 'chats/' + chat.id + '/wiki/posts/' + postId)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
                    });
                };
            });
        }

        // ---- Просмотр поста ----

        export function openWikiPost(postId) {
            const chat = state.chatsData.find(c => c.id === state.wikiChatId);
            if (!chat) return;
            state.wikiPostId = postId;
            document.getElementById('wiki-category-overlay').classList.remove('active');
            document.getElementById('wiki-post-overlay').classList.add('active');
            state.activeOverlay = 'wikipost';
            const owner = isGroupGM(chat);
            document.getElementById('btn-wiki-edit-post').classList.toggle('hidden', !owner);
            document.getElementById('btn-wiki-delete-post').classList.toggle('hidden', !owner);
            renderWikiPost();
        }

        document.getElementById('close-wiki-post-btn').onclick = function() {
            document.getElementById('wiki-post-overlay').classList.remove('active');
            document.getElementById('wiki-category-overlay').classList.add('active');
            state.activeOverlay = 'wikicategory';
            renderWikiCategory();
        };

        document.getElementById('btn-wiki-edit-post').onclick = function() {
            openWikiPostEditor(state.wikiPostId);
        };

        document.getElementById('btn-wiki-delete-post').onclick = function() {
            const chat = state.chatsData.find(c => c.id === state.wikiChatId);
            if (!chat || !isGroupGM(chat) || !state.wikiPostId) return;
            tg.showConfirm('Удалить этот пост?', (ok) => {
                if (!ok) return;
                remove(ref(state.db, 'chats/' + chat.id + '/wiki/posts/' + state.wikiPostId)).then(() => {
                    document.getElementById('close-wiki-post-btn').click();
                }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
            });
        };

        export function renderWikiPost() {
            if (state.activeOverlay !== 'wikipost' || !state.wikiChatId || !state.wikiPostId) return;
            const chat = state.chatsData.find(c => c.id === state.wikiChatId);
            if (!chat) return;
            const post = (chat.wiki && chat.wiki.posts || {})[state.wikiPostId];
            if (!post) { document.getElementById('close-wiki-post-btn').click(); return; }

            document.getElementById('wiki-post-title').textContent = post.title || '(без названия)';
            document.getElementById('wiki-post-text').textContent = post.text || '';

            const gallery = document.getElementById('wiki-post-gallery');
            const images = post.images || [];
            if (!images.length) {
                gallery.innerHTML = '';
            } else {
                gallery.innerHTML = images.map((url, i) => `<img src="${url}" data-idx="${i}" style="width:140px;height:140px;object-fit:cover;border-radius:14px;flex-shrink:0;cursor:pointer;">`).join('');
                gallery.querySelectorAll('img').forEach(img => {
                    img.onclick = () => openWikiImageViewer(images, parseInt(img.getAttribute('data-idx'), 10));
                });
            }
        }

        // ---- Полноэкранный просмотр картинки (галерея поста) ----

        export function openWikiImageViewer(images, index) {
            state.wikiImageViewer = { images, index };
            document.getElementById('wiki-image-viewer-img').src = images[index];
            document.getElementById('wiki-image-viewer-overlay').classList.add('active');
        }

        document.getElementById('close-wiki-image-viewer-btn').onclick = function() {
            document.getElementById('wiki-image-viewer-overlay').classList.remove('active');
        };

        // Тап по картинке — листаем к следующей, если их несколько
        document.getElementById('wiki-image-viewer-img').onclick = function() {
            const { images, index } = state.wikiImageViewer;
            if (!images || images.length < 2) return;
            const next = (index + 1) % images.length;
            state.wikiImageViewer.index = next;
            document.getElementById('wiki-image-viewer-img').src = images[next];
        };

        // ---- Редактор поста: создание/редактирование (только создатель группы) ----

        export function openWikiPostEditor(postId) {
            const chat = state.chatsData.find(c => c.id === state.wikiChatId);
            if (!chat || !isGroupGM(chat) || !state.wikiCategoryId) return;
            state.wikiEditingPostId = postId;
            const post = postId ? (chat.wiki && chat.wiki.posts || {})[postId] : null;

            document.getElementById('wiki-post-editor-title').textContent = postId ? 'Редактировать пост' : 'Новый пост';
            document.getElementById('wiki-editor-post-title').value = post ? (post.title || '') : '';
            document.getElementById('wiki-editor-post-text').value = post ? (post.text || '') : '';
            state.wikiEditorImages = post && post.images ? post.images.slice() : [];
            renderWikiEditorImages();

            document.getElementById('wiki-post-overlay').classList.remove('active');
            document.getElementById('wiki-category-overlay').classList.remove('active');
            document.getElementById('wiki-post-editor-overlay').classList.add('active');
            state.activeOverlay = 'wikieditor';
        }

        document.getElementById('close-wiki-post-editor-btn').onclick = function() {
            document.getElementById('wiki-post-editor-overlay').classList.remove('active');
            if (state.wikiEditingPostId) {
                state.wikiPostId = state.wikiEditingPostId;
                document.getElementById('wiki-post-overlay').classList.add('active');
                state.activeOverlay = 'wikipost';
                renderWikiPost();
            } else {
                document.getElementById('wiki-category-overlay').classList.add('active');
                state.activeOverlay = 'wikicategory';
                renderWikiCategory();
            }
        };

        function renderWikiEditorImages() {
            const row = document.getElementById('wiki-editor-images-row');
            row.innerHTML = state.wikiEditorImages.map((url, i) => `
                <div style="position:relative;width:72px;height:72px;">
                    <img src="${url}" style="width:72px;height:72px;object-fit:cover;border-radius:12px;">
                    <button data-rm-img="${i}" style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;border:none;background:#c62828;color:#fff;font-size:12px;line-height:1;cursor:pointer;">×</button>
                </div>`).join('');
            row.querySelectorAll('[data-rm-img]').forEach(btn => {
                btn.onclick = () => {
                    state.wikiEditorImages.splice(parseInt(btn.getAttribute('data-rm-img'), 10), 1);
                    renderWikiEditorImages();
                };
            });
        }

        // Загрузка сразу нескольких картинок в галерею поста — по очереди, со сжатием на устройстве
        document.getElementById('wiki-editor-image-file').addEventListener('change', async function() {
            const files = Array.from(this.files || []);
            this.value = '';
            if (!files.length) return;
            const btn = document.getElementById('wiki-editor-image-upload-btn');
            const origText = btn.textContent;
            btn.classList.add('uploading');
            for (const file of files) {
                if (!file.type.startsWith('image/')) continue;
                if (file.size > 30 * 1024 * 1024) { tg.showAlert('Файл слишком большой (максимум 30 МБ)'); continue; }
                try {
                    const compressed = await compressImage(file);
                    const url = await uploadToImgbb(compressed, (pct) => {
                        btn.textContent = pct < 100 ? '⏳ ' + pct + '%' : '⏳';
                    });
                    state.wikiEditorImages.push(url);
                    renderWikiEditorImages();
                } catch (err) {
                    tg.showAlert(friendlyUploadError(err));
                }
            }
            btn.classList.remove('uploading');
            btn.textContent = origText;
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        });

        document.getElementById('btn-save-wiki-post').onclick = function() {
            const chat = state.chatsData.find(c => c.id === state.wikiChatId);
            if (!chat || !isGroupGM(chat) || !state.wikiCategoryId) return;

            const title = document.getElementById('wiki-editor-post-title').value.trim();
            if (!title) return tg.showAlert('Введите заголовок поста');
            const text = document.getElementById('wiki-editor-post-text').value.trim();
            const images = state.wikiEditorImages.slice();
            const payload = { categoryId: state.wikiCategoryId, title, text, images, authorId: state.currentUser.id };

            const savePromise = state.wikiEditingPostId
                ? update(ref(state.db, 'chats/' + chat.id + '/wiki/posts/' + state.wikiEditingPostId), payload)
                : push(ref(state.db, 'chats/' + chat.id + '/wiki/posts'), { ...payload, createdAt: Date.now() });

            savePromise.then(() => {
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                document.getElementById('close-wiki-post-editor-btn').click();
            }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };
