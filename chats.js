import { ref, push, update, remove, set } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { attachmentHtml, avatarHtml, colorFor, compressImage, escapeHtml, formatDate, friendlyDbError, friendlyUploadError, initialOf, lastSeenText, nickColorStyle, renderMarkdown, renderMarkdownInline, sanitizeAndScopeWikiCss, saveLocal, setupAttachmentPicker, shopBadgeHtml, uploadToCloudinary, uploadToImgbb, verifiedBadge } from './utils.js';
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

// === Меню действий чата: одна кнопка "⋯" показывает/скрывает 🎭 📦 ⚙️ ===
document.getElementById('chat-actions-toggle').onclick = function(e) {
    e.stopPropagation();
    document.getElementById('chat-actions-menu').classList.toggle('open');
    this.classList.toggle('active');
};
document.getElementById('chat-actions-menu').addEventListener('click', () => {
    document.getElementById('chat-actions-menu').classList.remove('open');
    document.getElementById('chat-actions-toggle').classList.remove('active');
});
document.addEventListener('click', (e) => {
    const menu = document.getElementById('chat-actions-menu');
    const wrap = document.getElementById('chat-actions-wrap');
    if (menu.classList.contains('open') && wrap && !wrap.contains(e.target)) {
        menu.classList.remove('open');
        document.getElementById('chat-actions-toggle').classList.remove('active');
    }
});

// === Меню инструментов строки ввода: одна кнопка "⋯" показывает/скрывает 🎬 🤩 📎 ===
document.getElementById('chat-input-tools-toggle').onclick = function(e) {
    e.stopPropagation();
    document.getElementById('chat-input-tools-menu').classList.toggle('open');
    this.classList.toggle('active');
};
document.addEventListener('click', (e) => {
    const toolsMenu = document.getElementById('chat-input-tools-menu');
    const toolsWrap = document.getElementById('chat-input-tools-wrap');
    if (toolsMenu.classList.contains('open') && toolsWrap && !toolsWrap.contains(e.target)) {
        toolsMenu.classList.remove('open');
        document.getElementById('chat-input-tools-toggle').classList.remove('active');
    }
});

// === Ролевые группы: вспомогательные функции ===

export function isGroupGM(chat) {
    return !!(chat && chat.type === 'group' && chat.adminId === state.currentUser.id);
}

// Модератор вики: сам создатель чата, либо тот, кого он назначил в настройках вики
export function isWikiModerator(chat) {
    if (isGroupGM(chat)) return true;
    return !!(chat && chat.wiki && chat.wiki.moderators && chat.wiki.moderators[state.currentUser.id]);
}

export function isRoleplayGroup(chat) {
    return !!(chat && chat.type === 'group' && chat.groupMode === 'roleplay');
}

// Открытое сообщество: любой вступивший участник может опубликовать пост на стене
// (без премодерации). ГМ и назначенные модераторы могут писать всегда.
export function canPostToWall(chat) {
    if (!chat) return false;
    if (isWikiModerator(chat)) return true;
    const openPosting = !!(chat.wiki && chat.wiki.openPosting);
    const joined = !!(chat.participants && chat.participants[state.currentUser.id]);
    return openPosting && joined;
}

// Модерация: ГМ/модераторы могут управлять (редактировать/удалять) любой пост,
// автор поста — только своим собственным.
export function canManagePost(chat, post) {
    if (!chat || !post) return false;
    if (isWikiModerator(chat)) return true;
    return post.authorId === state.currentUser.id;
}
export function canManageComment(chat, comment) {
    if (!chat || !comment) return false;
    if (isWikiModerator(chat)) return true;
    return comment.userId === state.currentUser.id;
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
    const curMode = state.actionModeByChat[chat.id];
    actionBtn.classList.toggle('active', !!curMode);
    actionBtn.textContent = curMode === 'thought' ? '💭' : '🎬';

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
        const chatId = item.getAttribute('data-chat-id');
        const chat = state.chatsData.find(c => c.id === chatId);
        // Клик по главному чату сообщества открывает его вики-«домашнюю страницу»,
        // а не сразу переписку. Личные диалоги и доп. чаты (parentChatId) — как раньше, сразу в чат.
        const goesToWiki = chat && chat.type === 'group' && !chat.parentChatId;
        item.onclick = () => goesToWiki ? openGroupWiki(chatId) : openChat(chatId);
    });
    document.getElementById('chats-nav-badge').classList.toggle('hidden', !anyUnread);
}

// ===================== СООБЩЕСТВО: ПОДВКЛАДКИ И ОТКРЫТЫЕ ГРУППЫ =====================

document.getElementById('community-tab-mine').onclick = function() { switchCommunityTab('mine'); };
document.getElementById('community-tab-discover').onclick = function() { switchCommunityTab('discover'); };

export function switchCommunityTab(tab) {
    state.communityTab = tab;
    document.getElementById('community-tab-mine').classList.toggle('active', tab === 'mine');
    document.getElementById('community-tab-discover').classList.toggle('active', tab === 'discover');
    document.getElementById('community-mine-view').classList.toggle('hidden', tab !== 'mine');
    document.getElementById('community-discover-view').classList.toggle('hidden', tab !== 'discover');
    if (tab === 'discover') renderCommunityDiscover();
}
window.switchCommunityTab = switchCommunityTab;

function groupCoverHtml(name, avatarUrl, imgCls, fallbackCls) {
    if (avatarUrl) {
        return `<img src="${avatarUrl}" class="${imgCls}" onerror="this.outerHTML='<div class=&quot;${fallbackCls}&quot; style=&quot;background:${colorFor(name || '')}&quot;>${(name || '?').trim().charAt(0).toUpperCase()}</div>'">`;
    }
    return `<div class="${fallbackCls}" style="background:${colorFor(name || '')};">${escapeHtml((name || '?').trim().charAt(0).toUpperCase())}</div>`;
}

export function renderCommunityDiscover() {
    const grid = document.getElementById('community-groups-grid');
    const rail = document.getElementById('community-popular-rail');
    const railWrap = document.getElementById('community-popular-wrap');
    if (!grid) return;

    const publicGroups = state.chatsData
        .filter(c => c.type === 'group' && c.isPublic)
        .map(c => ({ ...c, memberCount: Object.keys(c.participants || {}).length }))
        .sort((a, b) => b.memberCount - a.memberCount);

    if (!publicGroups.length) {
        railWrap.classList.add('hidden');
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><span class="icon">🌐</span><div class="title">Пока нет открытых групп</div><div class="sub">Сделайте свою группу открытой в её настройках — и она появится здесь</div></div>`;
        return;
    }

    const popular = publicGroups.slice(0, 8);
    if (popular.length >= 3) {
        railWrap.classList.remove('hidden');
        rail.innerHTML = popular.map(chat => `
            <div class="community-rail-card" data-chat-id="${chat.id}">
                ${groupCoverHtml(chat.name, chat.avatar, 'community-rail-cover', 'community-rail-cover-fallback')}
                <div class="community-rail-info">
                    <div class="community-rail-name">${escapeHtml(chat.name || '')}</div>
                    <div class="community-rail-count">👥 ${chat.memberCount}</div>
                </div>
            </div>`).join('');
        rail.querySelectorAll('[data-chat-id]').forEach(el => {
            el.onclick = () => openGroupOrPreview(el.getAttribute('data-chat-id'));
        });
    } else {
        railWrap.classList.add('hidden');
    }

    grid.innerHTML = publicGroups.map(chat => {
        const joined = !!(chat.participants && chat.participants[state.currentUser.id]);
        return `
        <div class="community-group-card" data-chat-id="${chat.id}">
            ${groupCoverHtml(chat.name, chat.avatar, 'community-group-cover', 'community-group-cover-fallback')}
            ${isRoleplayGroup(chat) ? `<div class="community-group-rp-badge">🎭 РП</div>` : ''}
            ${joined ? `<div class="community-joined-badge">✓ Вы внутри</div>` : ''}
            <div class="community-group-body">
                <div class="community-group-name">${escapeHtml(chat.name || '')}</div>
                <div class="community-group-count">👥 ${chat.memberCount} участников</div>
            </div>
        </div>`;
    }).join('');
    grid.querySelectorAll('[data-chat-id]').forEach(el => {
        el.onclick = () => openGroupOrPreview(el.getAttribute('data-chat-id'));
    });
}

function openGroupOrPreview(chatId) {
    const chat = state.chatsData.find(c => c.id === chatId);
    if (!chat) return;
    const joined = !!(chat.participants && chat.participants[state.currentUser.id]);
    if (joined) {
        switchTab('chats');
        switchCommunityTab('mine');
        openGroupWiki(chatId); // клик по сообществу теперь ведёт на его вики-«домашнюю страницу», а не сразу в чат
    } else {
        openGroupPreview(chatId);
    }
}

export function openGroupPreview(chatId) {
    const chat = state.chatsData.find(c => c.id === chatId);
    if (!chat) return;
    state.previewGroupId = chatId;

    document.getElementById('group-preview-avatar-wrap').innerHTML = groupCoverHtml(chat.name, chat.avatar, 'group-preview-avatar', 'group-preview-avatar-fallback');
    document.getElementById('group-preview-name').textContent = chat.name || '';
    const memberCount = Object.keys(chat.participants || {}).length;
    document.getElementById('group-preview-meta').textContent = `👥 ${memberCount} участников` + (isRoleplayGroup(chat) ? ' · 🎭 ролевая группа' : '');
    
    // Поддержка Markdown в описании группы
    const descEl = document.getElementById('group-preview-desc');
    if (descEl) {
        descEl.innerHTML = chat.desc ? renderMarkdown(chat.desc) : 'Автор группы пока не добавил описание.';
        descEl.classList.add('md-body');
    }

    const joined = !!(chat.participants && chat.participants[state.currentUser.id]);
    document.getElementById('btn-join-group-preview').textContent = joined ? 'Открыть чат' : 'Вступить';

    document.getElementById('group-preview-overlay').classList.add('active');
    state.activeOverlay = 'grouppreview';
    tg.BackButton.show();
}

document.getElementById('close-group-preview-btn').onclick = function() {
    document.getElementById('group-preview-overlay').classList.remove('active');
    state.activeOverlay = null;
    state.previewGroupId = null;
    tg.BackButton.hide();
};

document.getElementById('btn-join-group-preview').onclick = function() {
    const chatId = state.previewGroupId;
    const chat = state.chatsData.find(c => c.id === chatId);
    if (!chat || !chatId) return;
    const joined = !!(chat.participants && chat.participants[state.currentUser.id]);

    document.getElementById('group-preview-overlay').classList.remove('active');

    if (joined) {
        switchTab('chats');
        switchCommunityTab('mine');
        openGroupWiki(chatId);
        return;
    }

    update(ref(state.db, 'chats/' + chatId), {
        ['participants/' + state.currentUser.id]: true,
        ['participantNames/' + state.currentUser.id]: state.currentUser.name
    }).then(() => {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        switchTab('chats');
        switchCommunityTab('mine');
        openChat(chatId);
    }).catch(err => tg.showAlert('Ошибка вступления: ' + friendlyDbError(err)));
};

export function openChat(chatId) {
    state.currentChatId = chatId; 
    state.activeOverlay = 'chat';
    document.getElementById('chat-overlay').classList.add('active'); 
    tg.BackButton.show();
    document.getElementById('chat-sticker-picker').style.display = 'none';
    state.renderedChatState = { chatId: null, signature: null };
    
    const chat = state.chatsData.find(c => c.id === chatId);
    if (chat) renderChatOverlay(chat);
}

window.openChat = openChat;

export function renderChatOverlay(chat) {
    // Доп.чат вики ("чат-рум") — своя тема/CSS ГМа вики применяется и здесь, а не только
    // в самих оверлеях вики. У обычных чатов и у главного группового чата тема не трогается.
    const wikiRoot = chat.parentChatId ? getWikiRootChat(chat) : null;
    const isWikiSubchat = !!(wikiRoot && wikiRoot.wiki);
    document.getElementById('chat-overlay').classList.toggle('wiki-theme', isWikiSubchat);
    if (isWikiSubchat) applyWikiCustomCss(wikiRoot);

    const me = state.usersData.find(u => u.id === state.currentUser.id);
    const chatBg = (me && me.equipped && me.equipped.passChatBg) || chat.wallpaper;
    const chatBodyEl = document.getElementById('chat-body');
    if (chatBodyEl) {
        if (chatBg) {
            chatBodyEl.style.setProperty('background-image', `url('${chatBg}')`, 'important');
            chatBodyEl.style.setProperty('background-size', 'cover', 'important');
            chatBodyEl.style.setProperty('background-position', 'center', 'important');
        } else {
            chatBodyEl.style.removeProperty('background-image');
            chatBodyEl.style.removeProperty('background-size');
            chatBodyEl.style.removeProperty('background-position');
        }
    }

    const iAmModerator = isWikiModerator(chat);
    const isReadonlyChannel = chat.type === 'group' && chat.channelMode === 'readonly';
    const canWriteHere = !isReadonlyChannel || iAmModerator;
    document.getElementById('chat-input-row').classList.toggle('hidden', !canWriteHere);
    document.getElementById('chat-readonly-bar').classList.toggle('hidden', !(isReadonlyChannel && !iAmModerator));

    if (chat.type === 'group') {
        document.getElementById('chat-partner-name').textContent = chat.name;
        document.getElementById('chat-partner-avatar-wrap').innerHTML = avatarHtml(chat.name, chat.avatar, 'avatar-sm');
        document.getElementById('chat-partner-status').textContent = Object.keys(chat.participants || {}).length + ' участников' + (isRoleplayGroup(chat) ? ' · 🎭 ролевая' : '') + (isReadonlyChannel ? ' · 📢 только чтение' : '');
        document.getElementById('chat-actions-wrap').classList.remove('hidden');
        document.getElementById('chat-edit-group-btn').classList.toggle('hidden', chat.adminId !== state.currentUser.id);
        document.getElementById('chat-leave-group-btn').classList.remove('hidden');
        document.getElementById('chat-rp-btn').classList.toggle('hidden', !isRoleplayGroup(chat));
        document.getElementById('chat-economy-btn').classList.toggle('hidden', !iAmModerator);
        document.getElementById('chat-wiki-btn').classList.remove('hidden');
        updateWikiBtnBadge(chat);
    } else {
        const other = otherParticipant(chat);
        document.getElementById('chat-partner-name').textContent = other.name;
        document.getElementById('chat-partner-avatar-wrap').innerHTML = avatarHtml(other.name, other.avatar, 'avatar-sm');
        document.getElementById('chat-partner-status').textContent = lastSeenText(other.lastSeen) + (other.mood ? ' · настроение ' + other.mood : '');
        document.getElementById('chat-actions-wrap').classList.add('hidden');
        document.getElementById('chat-actions-menu').classList.remove('open');
        document.getElementById('chat-actions-toggle').classList.remove('active');
        document.getElementById('chat-edit-group-btn').classList.add('hidden');
        document.getElementById('chat-leave-group-btn').classList.add('hidden');
        document.getElementById('chat-rp-btn').classList.add('hidden');
        document.getElementById('chat-economy-btn').classList.add('hidden');
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

        if (m.isSystem) {
            return `<div class="msg-system-row">⚙️ ${escapeHtml(m.text)}</div>`;
        }

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
                    <span>🎬 <b>${escapeHtml(displayName)}</b> ${escapeHtml(m.text)}<span class="msg-time" style="display:inline;margin-left:6px;">${timeStr}${m.edited ? ' (изменено)' : ''}</span></span>
                </div>
            </div>`;
        }

        const isThought = m.messageStyle === 'thought';
        if (isThought) {
            const replyPreviewT = m.replyTo ? `<div class="msg-reply-quote"><b>${escapeHtml(m.replyTo.author)}</b>: ${escapeHtml(m.replyTo.text)}</div>` : '';
            return `
            <div class="msg-row msg-row-action">
                <div class="msg-thought-line">
                    ${replyPreviewT}
                    <span>💭 <b>${escapeHtml(displayName)}</b> думает: «${escapeHtml(m.text)}»<span class="msg-time" style="display:inline;margin-left:6px;">${timeStr}${m.edited ? ' (изменено)' : ''}</span></span>
                </div>
            </div>`;
        }

        const senderName = (chat.type === 'group' && (!isMine || charOverride))
            ? `<div class="msg-sender-name" data-uid="${m.senderId}" style="font-size:11px; font-weight:700; ${isMine ? 'color:rgba(255,255,255,0.92);' : (nickColorStyle(m.senderId) || 'color:#ff9f0a;')} margin-bottom:4px; cursor:pointer;">${escapeHtml(displayName)}${charOverride ? '' : verifiedBadge(m.senderId) + shopBadgeHtml(m.senderId) + passVipBadge(m.senderId)}</div>` 
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

        // Баблы сообщений собраны слитно без переносов строк \n, чтобы pre-wrap не создавал паразитных отступов
        if (m.attachment) {
            return `
            <div class="msg-row ${isMine ? 'mine' : ''}">
                ${avatarBlock}
                <div class="msg-bubble">${senderName}${replyPreview}${attachmentHtml(m.attachment)}${m.text ? `<div class="md-body">${renderMarkdown(m.text)}</div>` : ''}<span class="msg-time">${timeStr}${editedMark}</span></div>
            </div>`;
        }
        
        return `
        <div class="msg-row ${isMine ? 'mine' : ''}">
            ${avatarBlock}
            <div class="msg-bubble">${senderName}${replyPreview}<div class="md-body">${renderMarkdown(m.text)}</div><span class="msg-time">${timeStr}${editedMark}</span></div>
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

// === Жесты сообщений: свайп влево = ответить, долгое нажатие = меню ===

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
    cancelEditMessage();
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
    document.getElementById('chat-reply-bar').classList.add('hidden');

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

    const chat = state.chatsData.find(c => c.id === state.currentChatId);

    if (chat && chat.type === 'group') {
        const iAmModerator = isWikiModerator(chat);
        if (chat.channelMode === 'readonly' && !iAmModerator) {
            return tg.showAlert('В этом канале писать могут только ГМ и модераторы');
        }
        if (chat.mutedUsers && chat.mutedUsers[state.currentUser.id]) {
            return tg.showAlert('Вы в муте в этом чате и не можете отправлять сообщения');
        }
        if (tryHandleEconomyCommand(chat, text)) {
            input.value = '';
            autoResizeChatInput();
            return;
        }
    }

    if (state.editingMessageId) {
        update(ref(state.db, 'chats/' + state.currentChatId + '/messages/' + state.editingMessageId), { text, edited: true }).then(() => {
            input.value = '';
            autoResizeChatInput();
            state.editingMessageId = null;
            document.getElementById('chat-edit-bar').classList.add('hidden');
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        return;
    }
    
    const activeChar = chat ? getActiveCharacter(chat) : null;
    const rpMode = state.actionModeByChat[state.currentChatId]; // 'action' | 'thought' | false

    const payload = { 
        senderId: state.currentUser.id, 
        senderName: state.currentUser.name, 
        text, 
        createdAt: Date.now() 
    };
    if (activeChar) payload.asCharacterId = activeChar.id;
    if (rpMode === 'action' || rpMode === 'thought') payload.messageStyle = rpMode;
    if (state.replyingTo) payload.replyTo = { id: state.replyingTo.id, author: state.replyingTo.author, text: state.replyingTo.text };

    const previewText = rpMode === 'action' ? `🎬 ${(activeChar ? activeChar.name : state.currentUser.name)} ${text}`
        : rpMode === 'thought' ? `💭 ${(activeChar ? activeChar.name : state.currentUser.name)} думает: «${text}»`
        : text;

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

document.getElementById('chat-leave-group-btn').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.currentChatId);
    if (!chat || chat.type !== 'group') return;
    const isCreator = chat.adminId === state.currentUser.id;
    const isSubchat = !!chat.parentChatId;
    const msg = isCreator
        ? 'Вы создатель этого чата. Если вы выйдете, чат останется без ГМ, но не удалится. Всё равно выйти?'
        : (isSubchat ? 'Выйти из этого доп. чата?' : 'Выйти из этого чата? Вернуться можно будет только по новому приглашению или через раздел «Сообщество», если чат открытый.');
    tg.showConfirm(msg, (ok) => {
        if (!ok) return;
        const chatId = chat.id;
        update(ref(state.db, 'chats/' + chatId), {
            ['participants/' + state.currentUser.id]: null,
            ['participantNames/' + state.currentUser.id]: null,
            ['mutedUsers/' + state.currentUser.id]: null
        }).then(() => {
            clearTypingStatus();
            document.getElementById('chat-overlay').classList.remove('active');
            state.activeOverlay = null;
            state.currentChatId = null;
            tg.BackButton.hide();
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            renderChatsList();
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
    });
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

function wireVisibilityChipPicker(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.chip').forEach(chip => {
        chip.onclick = () => {
            container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        };
    });
}
function setVisibilityChipPicker(containerId, vis) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.getAttribute('data-visibility') === vis));
}
function getVisibilityChipPicker(containerId) {
    const container = document.getElementById(containerId);
    const active = container && container.querySelector('.chip.active');
    return active ? active.getAttribute('data-visibility') : 'private';
}
wireVisibilityChipPicker('group-visibility-picker');
wireVisibilityChipPicker('edit-group-visibility-picker');

function wireGenericChipPicker(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.chip').forEach(chip => {
        chip.onclick = () => {
            container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        };
    });
}
function setGenericChipPicker(containerId, attr, value) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.getAttribute(attr) === value));
}
function getGenericChipPicker(containerId, attr, fallback) {
    const container = document.getElementById(containerId);
    const active = container && container.querySelector('.chip.active');
    return active ? active.getAttribute(attr) : fallback;
}
wireGenericChipPicker('group-channel-mode-picker');
wireGenericChipPicker('edit-group-channel-mode-picker');
wireGenericChipPicker('edit-group-wall-mode-picker');

document.getElementById('btn-open-create-group').onclick = function() {
    document.getElementById('new-chat-overlay').classList.remove('active');
    document.getElementById('create-group-overlay').classList.add('active');
    state.activeOverlay = 'creategroup';
    
    document.getElementById('group-name').value = ''; 
    document.getElementById('group-desc').value = ''; 
    document.getElementById('group-avatar').value = '';
    setTypeChipPicker('group-type-picker', 'normal');
    setVisibilityChipPicker('group-visibility-picker', 'private');
    
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
    const participantNames = { [state.currentUser.id]: state.currentUser.name };
    document.querySelectorAll('.group-user-cb:checked').forEach(cb => {
        participants[cb.value] = true;
        const u = state.usersData.find(x => x.id === cb.value);
        if (u) participantNames[cb.value] = u.name;
    });
    
    const chatId = 'group_' + Date.now();
    const groupMode = getTypeChipPicker('group-type-picker');
    const isPublic = getVisibilityChipPicker('group-visibility-picker') === 'public';
    const channelMode = getGenericChipPicker('group-channel-mode-picker', 'data-channelmode', 'normal');
    set(ref(state.db, 'chats/' + chatId), {
        type: 'group', 
        name: name, 
        desc: document.getElementById('group-desc').value.trim(), 
        avatar: document.getElementById('group-avatar').value.trim(),
        adminId: state.currentUser.id, 
        participants: participants, 
        participantNames: participantNames,
        createdAt: Date.now(), 
        lastMessage: 'Группа создана', 
        lastMessageAt: Date.now(),
        isPublic: isPublic,
        channelMode: channelMode,
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
    document.getElementById('edit-group-wallpaper').value = chat.wallpaper || '';
    setTypeChipPicker('edit-group-type-picker', chat.groupMode === 'roleplay' ? 'roleplay' : 'normal');
    setVisibilityChipPicker('edit-group-visibility-picker', chat.isPublic ? 'public' : 'private');
    setGenericChipPicker('edit-group-channel-mode-picker', 'data-channelmode', chat.channelMode === 'readonly' ? 'readonly' : 'normal');
    setGenericChipPicker('edit-group-wall-mode-picker', 'data-wallmode', (chat.wiki && chat.wiki.openPosting) ? 'open' : 'moderated');
    
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
    const isPublic = getVisibilityChipPicker('edit-group-visibility-picker') === 'public';
    const channelMode = getGenericChipPicker('edit-group-channel-mode-picker', 'data-channelmode', 'normal');
    const wallMode = getGenericChipPicker('edit-group-wall-mode-picker', 'data-wallmode', 'moderated');
    update(ref(state.db, 'chats/' + state.currentChatId), { 
        name: name, 
        desc: document.getElementById('edit-group-desc').value.trim(), 
        avatar: document.getElementById('edit-group-avatar').value.trim(),
        wallpaper: document.getElementById('edit-group-wallpaper').value.trim() || null,
        groupMode: groupMode === 'roleplay' ? 'roleplay' : null,
        isPublic: isPublic,
        channelMode: channelMode,
        ['wiki/openPosting']: wallMode === 'open'
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
    const cur = state.actionModeByChat[state.currentChatId];
    const next = cur === 'action' ? 'thought' : (cur === 'thought' ? false : 'action');
    state.actionModeByChat[state.currentChatId] = next;
    const chat = state.chatsData.find(c => c.id === state.currentChatId);
    updateChatRpStatusBar(chat);
    const input = document.getElementById('chat-message-input');
    const btn = document.getElementById('btn-toggle-action-mode');
    if (next === 'action') { input.placeholder = 'Опишите действие персонажа...'; btn.textContent = '🎬'; }
    else if (next === 'thought') { input.placeholder = 'Что думает персонаж...'; btn.textContent = '💭'; }
    else { input.placeholder = 'Сообщение...'; btn.textContent = '🎬'; }
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
    if (charId && !isGroupGM(chat) && c.ownerId !== state.currentUser.id) return;

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
        payload.createdAt = Date.now() ;
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

// === Инвентарь персонажа ===

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

function useInventoryItem(chat, character, itemId) {
    const item = (character.inventory || {})[itemId];
    if (!item || !item.usable) return;
    if (character.ownerId !== state.currentUser.id) return;

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

const WIKI_CAT_GRADIENTS = [
    'linear-gradient(135deg,#ff9a8b,#ff6a88)',
    'linear-gradient(135deg,#667eea,#764ba2)',
    'linear-gradient(135deg,#43cea2,#185a9d)',
    'linear-gradient(135deg,#f7971e,#ffd200)',
    'linear-gradient(135deg,#ee0979,#ff6a00)',
    'linear-gradient(135deg,#4facfe,#00f2fe)',
    'linear-gradient(135deg,#a18cd1,#fbc2eb)',
    'linear-gradient(135deg,#0ba360,#3cba92)',
    'linear-gradient(135deg,#f857a6,#ff5858)',
    'linear-gradient(135deg,#5f72bd,#9b23ea)',
];
function wikiGradientFor(str) {
    let hash = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
    return WIKI_CAT_GRADIENTS[Math.abs(hash) % WIKI_CAT_GRADIENTS.length];
}

const WIKI_CAT_ICONS = ['📁', '🎨', '📝', '🐱', '⭐', '🗺️', '📸', '💬', '🎭', '🔖'];
function wikiIconFor(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('арт')) return '🎨';
    if (n.includes('кот') || n.includes('cat')) return '🐱';
    if (n.includes('пост')) return '📝';
    if (n.includes('карт')) return '🗺️';
    if (n.includes('фото')) return '📸';
    let hash = 0;
    for (let i = 0; i < n.length; i++) hash = n.charCodeAt(i) + ((hash << 5) - hash);
    return WIKI_CAT_ICONS[Math.abs(hash) % WIKI_CAT_ICONS.length];
}

// ============================================================
// === ВИКИ: СВОЙ CSS ГМА + ПЕСОЧНИЦА ДЛЯ ВИДЖЕТОВ ===
// ГМ может писать свой CSS для вики (применяется санитайзером/скоупером из utils.js —
// см. sanitizeAndScopeWikiCss) и добавлять свои виджеты (HTML+CSS+JS), которые выполняются
// у ВСЕХ участников группы. Виджет — не доверенный код, поэтому он живёт в изолированном
// <iframe sandbox="allow-scripts"> БЕЗ allow-same-origin: у него уникальное opaque-происхождение,
// нет доступа к куки/localStorage приложения, нет сети (connect-src 'none' в CSP), нет доступа
// к остальному DOM/JS приложения и к Firebase-сессии. Внутри — можно рисовать что угодно,
// анимировать, считать, использовать canvas/таймеры — просто без пути наружу.
const WIKI_WIDGET_LIMITS = { maxCount: 10, maxHtml: 20000, maxCss: 20000, maxJs: 20000 };

function applyWikiCustomCss(chat) {
    const raw = (chat && chat.wiki && chat.wiki.customCss) || '';
    let styleEl = document.getElementById('wiki-custom-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'wiki-custom-style';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = raw ? sanitizeAndScopeWikiCss(raw) : '';
}

function buildWikiWidgetSrcdoc(html, css, js) {
    // Внутренний скрипт репорта высоты — это НАШ код, не код ГМа; код ГМа исполняется отдельным
    // блоком в try/catch, чтобы ошибка в нём не ломала автоподгонку размера рамки.
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; media-src data: https:; font-src data: https:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none';">
<style>*{box-sizing:border-box;}html,body{margin:0;padding:0;background:transparent;color:#f2ecff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden;}
${css || ''}
</style></head><body>
${html || ''}
<script>
(function(){
  function reportSize(){ try { parent.postMessage({ type:'sr-wiki-widget-resize', height: document.documentElement.scrollHeight }, '*'); } catch(e){} }
  try { new ResizeObserver(reportSize).observe(document.documentElement); } catch(e){}
  window.addEventListener('load', reportSize);
  setTimeout(reportSize, 60);
  setTimeout(reportSize, 400);
  try {
    ${js || ''}
  } catch(e) { console.error('Ошибка виджета вики:', e); }
  reportSize();
})();
</script>
</body></html>`;
}

// Слушатель один на всё приложение — подгоняет высоту рамки под контент конкретного виджета,
// сверяя event.source с contentWindow (так сообщение от одного виджета не попадёт в другой).
window.addEventListener('message', function(event) {
    const data = event.data;
    if (!data || data.type !== 'sr-wiki-widget-resize' || typeof data.height !== 'number') return;
    document.querySelectorAll('iframe.wiki-widget-frame').forEach(frame => {
        if (frame.contentWindow === event.source) {
            frame.style.height = Math.min(Math.max(Math.round(data.height), 40), 900) + 'px';
        }
    });
});

function renderWikiWidgetFrame(widget) {
    const wrap = document.createElement('div');
    wrap.className = 'wiki-widget-card';
    const iframe = document.createElement('iframe');
    iframe.className = 'wiki-widget-frame';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('loading', 'lazy');
    iframe.style.cssText = 'width:100%;border:0;display:block;height:50px;';
    iframe.srcdoc = buildWikiWidgetSrcdoc(widget.html, widget.css, widget.js);
    wrap.appendChild(iframe);
    return wrap;
}

function renderWikiHomeWidgets(chat) {
    const container = document.getElementById('wiki-home-widgets');
    if (!container) return;
    const widgets = Object.entries((chat.wiki && chat.wiki.widgets) || {})
        .map(([id, w]) => ({ id, ...w }))
        .filter(w => w.placement !== 'post');
    container.innerHTML = '';
    container.classList.toggle('hidden', !widgets.length);
    widgets.forEach(w => container.appendChild(renderWikiWidgetFrame(w)));
}

function renderWikiPostWidget(chat, post) {
    const wrap = document.getElementById('wiki-post-widget-wrap');
    if (!wrap) return;
    const widgets = (chat.wiki && chat.wiki.widgets) || {};
    const w = post.widgetId && widgets[post.widgetId] && widgets[post.widgetId].placement === 'post'
        ? { id: post.widgetId, ...widgets[post.widgetId] } : null;
    wrap.innerHTML = '';
    wrap.classList.toggle('hidden', !w);
    if (w) wrap.appendChild(renderWikiWidgetFrame(w));
}

function renderWikiWidgetsSettingsList(chat) {
    const listEl = document.getElementById('wiki-widgets-settings-list');
    if (!listEl) return;
    const widgets = Object.entries((chat.wiki && chat.wiki.widgets) || {}).map(([id, w]) => ({ id, ...w }));
    if (!widgets.length) {
        listEl.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:8px;">Виджетов пока нет.</div>`;
        return;
    }
    listEl.innerHTML = widgets.map(w => `
        <div class="wiki-widget-row">
            <div class="wwr-info">
                <div class="wwr-title">${escapeHtml(w.title || 'Без названия')}</div>
                <div class="wwr-place">${w.placement === 'post' ? '📄 внутри постов' : '🏠 на главной вики'}</div>
            </div>
            <button class="btn-secondary" data-edit-widget="${w.id}" style="width:auto;padding:6px 12px;border-radius:10px;margin:0;" title="Редактировать">✏️</button>
        </div>`).join('');
    listEl.querySelectorAll('[data-edit-widget]').forEach(btn => {
        btn.onclick = () => openWikiWidgetEditor(btn.getAttribute('data-edit-widget'));
    });
}

let wikiWidgetPreviewTimer = null;
function scheduleWikiWidgetPreview() {
    clearTimeout(wikiWidgetPreviewTimer);
    wikiWidgetPreviewTimer = setTimeout(() => {
        const frame = document.getElementById('wiki-widget-preview-frame');
        if (!frame) return;
        frame.srcdoc = buildWikiWidgetSrcdoc(
            document.getElementById('wiki-widget-html').value,
            document.getElementById('wiki-widget-css').value,
            document.getElementById('wiki-widget-js').value
        );
    }, 400);
}
['wiki-widget-html', 'wiki-widget-css', 'wiki-widget-js'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', scheduleWikiWidgetPreview);
});

function openWikiWidgetEditor(widgetId) {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !isWikiModerator(chat)) return;
    const widget = widgetId ? ((chat.wiki && chat.wiki.widgets) || {})[widgetId] : null;
    state.wikiEditingWidgetId = widgetId || null;

    document.getElementById('wiki-widget-editor-title').textContent = widgetId ? '✏️ Виджет вики' : '✨ Новый виджет';
    document.getElementById('wiki-widget-name').value = widget ? (widget.title || '') : '';
    document.getElementById('wiki-widget-placement').value = widget ? (widget.placement || 'home') : 'home';
    document.getElementById('wiki-widget-html').value = widget ? (widget.html || '') : '';
    document.getElementById('wiki-widget-css').value = widget ? (widget.css || '') : '';
    document.getElementById('wiki-widget-js').value = widget ? (widget.js || '') : '';
    document.getElementById('btn-delete-wiki-widget').classList.toggle('hidden', !widgetId);
    scheduleWikiWidgetPreview();

    document.getElementById('wiki-settings-overlay').classList.remove('active');
    document.getElementById('wiki-widget-editor-overlay').classList.add('active');
    state.activeOverlay = 'wikiwidgeteditor';
}

document.getElementById('close-wiki-widget-editor-btn').onclick = function() {
    document.getElementById('wiki-widget-editor-overlay').classList.remove('active');
    document.getElementById('wiki-settings-overlay').classList.add('active');
    state.activeOverlay = 'wikisettings';
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (chat) renderWikiWidgetsSettingsList(chat);
};

document.getElementById('btn-add-wiki-widget').onclick = function() {
    openWikiWidgetEditor(null);
};

document.getElementById('btn-save-wiki-widget').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !isWikiModerator(chat)) return;

    const title = document.getElementById('wiki-widget-name').value.trim();
    if (!title) return tg.showAlert('Введите название виджета');
    const placement = document.getElementById('wiki-widget-placement').value === 'post' ? 'post' : 'home';
    const html = document.getElementById('wiki-widget-html').value;
    const css = document.getElementById('wiki-widget-css').value;
    const js = document.getElementById('wiki-widget-js').value;

    if (html.length > WIKI_WIDGET_LIMITS.maxHtml || css.length > WIKI_WIDGET_LIMITS.maxCss || js.length > WIKI_WIDGET_LIMITS.maxJs) {
        return tg.showAlert('Слишком длинный код виджета — сократите HTML/CSS/JS.');
    }
    const existingWidgets = (chat.wiki && chat.wiki.widgets) || {};
    if (!state.wikiEditingWidgetId && Object.keys(existingWidgets).length >= WIKI_WIDGET_LIMITS.maxCount) {
        return tg.showAlert(`Максимум ${WIKI_WIDGET_LIMITS.maxCount} виджетов на одну вики.`);
    }

    const payload = { title, placement, html, css, js };
    const savePromise = state.wikiEditingWidgetId
        ? update(ref(state.db, 'chats/' + chat.id + '/wiki/widgets/' + state.wikiEditingWidgetId), payload)
        : push(ref(state.db, 'chats/' + chat.id + '/wiki/widgets'), { ...payload, createdAt: Date.now() });

    savePromise.then(() => {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        document.getElementById('close-wiki-widget-editor-btn').click();
    }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

document.getElementById('btn-delete-wiki-widget').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !state.wikiEditingWidgetId || !isWikiModerator(chat)) return;
    tg.showConfirm('Удалить этот виджет?', (ok) => {
        if (!ok) return;
        remove(ref(state.db, 'chats/' + chat.id + '/wiki/widgets/' + state.wikiEditingWidgetId)).then(() => {
            document.getElementById('close-wiki-widget-editor-btn').click();
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
    });
};

// Разрешаем "корневой" чат вики: у доп. чатов (parentChatId) нет собственной вики —
// они всегда используют общую вики главного группового чата, чтобы не плодить
// отдельные пустые "Дропы" на каждый доп. чат.
export function getWikiRootChat(chat) {
    let current = chat;
    let guard = 0;
    while (current && current.parentChatId && guard < 10) {
        const parent = state.chatsData.find(c => c.id === current.parentChatId);
        if (!parent) break;
        current = parent;
        guard++;
    }
    return current;
}

document.getElementById('chat-wiki-btn').onclick = function() {
    openGroupWiki();
};

// chatId необязателен: если не передан — берём текущий открытый чат (кнопка 📦 внутри чата).
// Если передан явно — вики можно открыть прямо из списка чатов/сообществ, минуя сам чат.
export function openGroupWiki(chatId) {
    const openedFrom = state.chatsData.find(c => c.id === (chatId || state.currentChatId));
    const chat = getWikiRootChat(openedFrom);
    if (!chat || chat.type !== 'group') return;
    state.wikiChatId = chat.id;
    // Куда вернуться при закрытии: если вики открыли из самого чата — вернёмся в этот чат
    // (может быть доп. чатом, не корневым). Если открыли прямо из списка чатов/сообществ —
    // вернёмся туда же, а не будем силой открывать чат, которого человек не запрашивал.
    state.wikiReturnChatId = chatId ? null : state.currentChatId;
    document.getElementById('chat-overlay').classList.remove('active');
    document.getElementById('group-wiki-overlay').classList.add('active');
    state.activeOverlay = 'groupwiki';
    document.getElementById('group-wiki-title').textContent = '📦 Дроп · ' + (chat.name || '');
    document.getElementById('wiki-category-name').value = '';
    document.getElementById('btn-wiki-settings').classList.toggle('hidden', !isWikiModerator(chat));

    state.wikiLastRead[chat.id] = Date.now() ;
    saveLocal('sr_wiki_last_read', state.wikiLastRead);
    updateWikiBtnBadge(chat);

    renderGroupWiki();
}

function updateWikiBtnBadge(chat) {
    const btn = document.getElementById('chat-wiki-btn');
    const rootChat = getWikiRootChat(chat);
    if (!btn || !rootChat) return;
    const lastRead = state.wikiLastRead[rootChat.id] || 0;
    const posts = rootChat.wiki && rootChat.wiki.posts ? Object.values(rootChat.wiki.posts) : [];
    const hasNew = posts.some(p => (p.createdAt || 0) > lastRead);
    btn.classList.toggle('has-new-dot', hasNew);
}

document.getElementById('close-group-wiki-btn').onclick = function() {
    document.getElementById('group-wiki-overlay').classList.remove('active');
    const chatId = state.wikiReturnChatId;
    state.wikiChatId = null;
    state.wikiReturnChatId = null;
    if (chatId) {
        openChat(chatId);
    } else {
        state.activeOverlay = null;
        switchTab('chats');
        renderChatsList();
    }
};

export function renderGroupWiki() {
    if (state.activeOverlay !== 'groupwiki' || !state.wikiChatId) return;
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    const list = document.getElementById('group-wiki-categories-list');
    if (!list) return;
    if (!chat) { list.innerHTML = ''; return; }

    applyWikiCustomCss(chat);
    renderWikiHomeWidgets(chat);

    const owner = isWikiModerator(chat);
    document.getElementById('wiki-add-category-row').classList.toggle('hidden', !owner);

    const banner = document.getElementById('wiki-hero-banner');
    const accent = (chat.wiki && chat.wiki.accentColor) || '';
    banner.style.background = accent ? `linear-gradient(135deg, ${accent}, ${accent}cc)` : '';
    if (chat.wiki && chat.wiki.bannerUrl) {
        banner.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.35),rgba(0,0,0,0.35)), url('${chat.wiki.bannerUrl}')`;
        banner.style.backgroundSize = 'cover';
        banner.style.backgroundPosition = 'center';
    } else {
        banner.style.backgroundImage = '';
    }

    const avatarEl = document.getElementById('wiki-hero-avatar');
    avatarEl.innerHTML = chat.avatar
        ? `<img src="${chat.avatar}" onerror="this.parentElement.innerHTML='📦'">`
        : '📦';
    document.getElementById('wiki-hero-title-text').textContent = chat.name || 'Дроп этого чата';

    renderWikiSubchats(chat);
    renderWikiPlaylist(chat);

    const categories = chat.wiki && chat.wiki.categories
        ? Object.entries(chat.wiki.categories).map(([id, v]) => ({ id, ...v }))
            .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.createdAt || 0) - (b.createdAt || 0))
        : [];

    const allPostsCount = chat.wiki && chat.wiki.posts ? Object.keys(chat.wiki.posts).length : 0;
    document.getElementById('wiki-hero-stats').textContent =
        `${categories.length} категор${categories.length === 1 ? 'ия' : categories.length >= 2 && categories.length <= 4 ? 'ии' : 'ий'} · ${allPostsCount} пост${allPostsCount === 1 ? '' : allPostsCount >= 2 && allPostsCount <= 4 ? 'а' : 'ов'}`;

    const announcementEl = document.getElementById('wiki-hero-announcement');
    const announcementText = chat.wiki && chat.wiki.announcement;
    if (announcementEl) {
        announcementEl.classList.toggle('hidden', !announcementText);
        if (announcementText) announcementEl.innerHTML = '📌 ' + renderMarkdownInline(announcementText);
    }

    if (!categories.length) {
        list.className = '';
        list.innerHTML = `<div class="wiki-empty">
            <div class="we-emoji">📦</div>
            <div class="we-text">${owner ? 'Пока нет категорий —<br>добавьте первую выше' : 'В этом чате пока нет вики'}</div>
        </div>`;
    } else {
        list.className = 'wiki-cat-grid';
        const posts = chat.wiki && chat.wiki.posts ? Object.values(chat.wiki.posts) : [];
        list.innerHTML = categories.map((cat, idx) => {
            const count = posts.filter(p => p.categoryId === cat.id).length;
            return `
            <div class="wiki-cat-card card-anim" style="animation-delay:${Math.min(idx, 10) * 45}ms;background:${wikiGradientFor(cat.name || cat.id)};" data-cat-id="${cat.id}">
                <div class="wcc-icon">${wikiIconFor(cat.name)}</div>
                ${owner ? `<button class="wcc-pin ${cat.pinned ? 'active' : ''}" data-pin-cat="${cat.id}" title="Закрепить">📌</button>` : ''}
                ${owner ? `<button class="wcc-del" data-del-cat="${cat.id}" title="Удалить категорию">🗑</button>` : ''}
                <div class="wcc-name">${cat.pinned ? '<span class="wiki-pin-badge">📌</span>' : ''}${escapeHtml(cat.name || '(без имени)')}</div>
                <div class="wcc-count">${count ? count + ' пост' + (count === 1 ? '' : count < 5 ? 'а' : 'ов') : 'пока пусто'}</div>
            </div>`;
        }).join('');
    }

    list.querySelectorAll('[data-cat-id]').forEach(el => {
        el.onclick = (e) => {
            if (e.target.closest('[data-del-cat],[data-pin-cat]')) return;
            openWikiCategory(el.getAttribute('data-cat-id'));
        };
    });
    list.querySelectorAll('[data-pin-cat]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const catId = btn.getAttribute('data-pin-cat');
            const cat = (chat.wiki.categories || {})[catId];
            update(ref(state.db, 'chats/' + chat.id + '/wiki/categories/' + catId), { pinned: !(cat && cat.pinned) })
                .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
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
    if (!chat || !isWikiModerator(chat)) return;
    const input = document.getElementById('wiki-category-name');
    const name = input.value.trim();
    if (!name) return tg.showAlert('Введите название категории');
    push(ref(state.db, 'chats/' + chat.id + '/wiki/categories'), { name, createdAt: Date.now()  })
        .then(() => {
            input.value = '';
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};
document.getElementById('wiki-category-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-add-wiki-category').click();
});

function renderWikiSubchats(chat) {
    const rail = document.getElementById('wiki-subchats-rail');
    const owner = isWikiModerator(chat);
    document.getElementById('btn-add-subchat').classList.toggle('hidden', !owner);

    const subChats = state.chatsData.filter(c => c.parentChatId === chat.id);

    // Главный чат сообщества теперь тоже просто карточка в этой рельсе — раз клик по
    // сообществу открывает вики, а не сам чат, нужен явный путь обратно в переписку.
    const mainCard = `
        <div class="community-rail-card community-rail-card-main" data-subchat-id="${chat.id}">
            ${groupCoverHtml(chat.name, chat.avatar, 'community-rail-cover', 'community-rail-cover-fallback')}
            <div class="community-rail-home-badge">🏠</div>
            <div class="community-rail-info">
                <div class="community-rail-name">${escapeHtml(chat.name || '')}</div>
                <div class="community-rail-count">💬 главный чат</div>
            </div>
        </div>`;

    const subCards = subChats.map(sc => `
        <div class="community-rail-card" data-subchat-id="${sc.id}">
            ${groupCoverHtml(sc.name, sc.avatar, 'community-rail-cover', 'community-rail-cover-fallback')}
            ${owner ? `<button class="community-rail-del" data-del-subchat="${sc.id}" title="Удалить доп. чат">🗑</button>` : ''}
            <div class="community-rail-info">
                <div class="community-rail-name">${escapeHtml(sc.name || '')}</div>
                <div class="community-rail-count">👥 ${Object.keys(sc.participants || {}).length}</div>
            </div>
        </div>`).join('');

    rail.innerHTML = mainCard + subCards;
    rail.querySelectorAll('[data-subchat-id]').forEach(el => {
        el.onclick = () => openSubChat(el.getAttribute('data-subchat-id'));
    });
    rail.querySelectorAll('[data-del-subchat]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            deleteSubChat(chat.id, btn.getAttribute('data-del-subchat'));
        };
    });
}

function deleteSubChat(rootChatId, subChatId) {
    const sub = state.chatsData.find(c => c.id === subChatId);
    const name = (sub && sub.name) || 'этот доп. чат';
    tg.showConfirm(`Удалить «${name}»? Вся история сообщений в нём будет потеряна безвозвратно.`, (ok) => {
        if (!ok) return;
        remove(ref(state.db, 'chats/' + subChatId)).then(() => {
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            const rootChat = state.chatsData.find(c => c.id === rootChatId);
            if (rootChat) renderWikiSubchats(rootChat);
            if (state.currentChatId === subChatId) {
                document.getElementById('close-chat-btn').click();
            }
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
    });
}

// ============================================================
// === ПЛЕЙЛИСТ ЧАТА: ГМ загружает треки, все участники слушают
// ============================================================
// Модель: chats/{id}/wiki/playlist/{trackId} = { title, url, addedBy, addedAt }

function renderWikiPlaylist(chat) {
    const listEl = document.getElementById('wiki-playlist-list');
    const addBtn = document.getElementById('btn-add-playlist-track');
    if (!listEl || !addBtn) return;
    const owner = isWikiModerator(chat);
    addBtn.classList.toggle('hidden', !owner);

    const tracks = chat.wiki && chat.wiki.playlist
        ? Object.entries(chat.wiki.playlist).map(([id, v]) => ({ id, ...v })).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))
        : [];

    listEl.innerHTML = tracks.map(t => {
        const adderName = (state.usersData.find(u => u.id === t.addedBy) || {}).name || 'ГМ';
        return `
        <div class="wiki-playlist-track" data-track-id="${t.id}">
            <div class="wpt-row-top">
                <div class="wpt-icon">🎵</div>
                <div class="wpt-info">
                    <div class="wpt-title">${escapeHtml(t.title || 'Без названия')}</div>
                    <div class="wpt-added-by">добавил(а) ${escapeHtml(adderName)}</div>
                </div>
                ${owner ? `<button class="wpt-del" data-del-track="${t.id}" title="Удалить трек">🗑</button>` : ''}
            </div>
            <audio class="wpt-audio" controls preload="none" src="${t.url}"></audio>
        </div>`;
    }).join('');

    listEl.querySelectorAll('[data-del-track]').forEach(btn => {
        btn.onclick = () => {
            const trackId = btn.getAttribute('data-del-track');
            tg.showConfirm('Удалить этот трек из плейлиста?', (ok) => {
                if (!ok) return;
                remove(ref(state.db, `chats/${chat.id}/wiki/playlist/${trackId}`)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
            });
        };
    });
}

document.getElementById('btn-add-playlist-track').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !isWikiModerator(chat)) return;
    document.getElementById('wiki-playlist-file-input').click();
};

document.getElementById('wiki-playlist-file-input').addEventListener('change', function(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !isWikiModerator(chat)) return;
    if (!file.type.startsWith('audio/')) return tg.showAlert('Нужен именно аудиофайл (mp3, ogg, m4a...)');
    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) return tg.showAlert('Файл слишком большой (максимум 25 МБ)');

    const defaultTitle = file.name.replace(/\.[^.]+$/, '');
    const title = prompt('Название трека:', defaultTitle) || defaultTitle;

    tg.showAlert('Загружаем трек, это может занять немного времени...');
    uploadToCloudinary(file, null).then(url => {
        return push(ref(state.db, `chats/${chat.id}/wiki/playlist`), {
            title: title.trim() || defaultTitle,
            url,
            addedBy: state.currentUser.id,
            addedAt: Date.now()
        });
    }).then(() => {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    }).catch(err => tg.showAlert('Ошибка загрузки: ' + friendlyUploadError(err)));
});

function openSubChat(chatId) {
    const sub = state.chatsData.find(c => c.id === chatId);
    if (!sub) return;
    const joined = !!(sub.participants && sub.participants[state.currentUser.id]);
    const goOpen = () => { document.getElementById('group-wiki-overlay').classList.remove('active'); openChat(chatId); };
    if (joined) { goOpen(); return; }
    update(ref(state.db, 'chats/' + chatId), {
        ['participants/' + state.currentUser.id]: true,
        ['participantNames/' + state.currentUser.id]: state.currentUser.name
    }).then(goOpen).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
}

document.getElementById('btn-add-subchat').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !isWikiModerator(chat)) return;
    document.getElementById('subchat-name').value = '';
    document.getElementById('subchat-avatar').value = '';
    document.getElementById('group-wiki-overlay').classList.remove('active');
    document.getElementById('subchat-create-overlay').classList.add('active');
    state.activeOverlay = 'subchatcreate';
};

document.getElementById('close-subchat-create-btn').onclick = function() {
    document.getElementById('subchat-create-overlay').classList.remove('active');
    document.getElementById('group-wiki-overlay').classList.add('active');
    state.activeOverlay = 'groupwiki';
};

document.getElementById('btn-submit-subchat').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !isWikiModerator(chat)) return;
    const name = document.getElementById('subchat-name').value.trim();
    if (!name) return tg.showAlert('Введите название чата');

    const participants = {};
    Object.keys(chat.participants || {}).forEach(uid => { participants[uid] = true; });
    participants[state.currentUser.id] = true;

    const newId = 'group_' + Date.now() ;
    set(ref(state.db, 'chats/' + newId), {
        type: 'group',
        name: name,
        desc: 'Доп. чат группы «' + (chat.name || '') + '»',
        avatar: document.getElementById('subchat-avatar').value.trim(),
        adminId: state.currentUser.id,
        parentChatId: chat.id,
        participants: participants,
        createdAt: Date.now() ,
        lastMessage: 'Чат создан',
        lastMessageAt: Date.now() 
    }).then(() => {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        document.getElementById('close-subchat-create-btn').click();
    }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

// ===================== НАСТРОЙКИ ВИКИ =====================

document.getElementById('btn-wiki-settings').onclick = function() {
    openWikiSettings();
};

function openWikiSettings() {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !isWikiModerator(chat)) return;

    document.getElementById('wiki-settings-banner').value = (chat.wiki && chat.wiki.bannerUrl) || '';
    document.getElementById('wiki-settings-announcement').value = (chat.wiki && chat.wiki.announcement) || '';
    document.getElementById('wiki-settings-css').value = (chat.wiki && chat.wiki.customCss) || '';
    renderWikiWidgetsSettingsList(chat);
    const accent = (chat.wiki && chat.wiki.accentColor) || '';
    document.querySelectorAll('#wiki-accent-picker .wiki-accent-chip').forEach(chip => {
        chip.classList.toggle('active', chip.getAttribute('data-accent') === accent);
    });

    const moderators = (chat.wiki && chat.wiki.moderators) || {};
    const modList = document.getElementById('wiki-moderators-list');
    const participantIds = Object.keys(chat.participants || {}).filter(uid => uid !== chat.adminId);
    if (!participantIds.length) {
        modList.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:8px;">В группе больше никого нет — назначать некого.</div>`;
    } else {
        modList.innerHTML = participantIds.map(uid => {
            const userRec = state.usersData.find(u => u.id === uid);
            const nm = (userRec && userRec.name) || (chat.participantNames && chat.participantNames[uid]) || 'Участник';
            const checked = !!moderators[uid];
            return `
            <label class="wiki-mod-item">
                <input type="checkbox" data-mod-uid="${uid}" ${checked ? 'checked' : ''}>
                ${avatarHtml(nm, userRec ? userRec.avatar : null, 'avatar-sm')}
                <span class="wiki-mod-name">${escapeHtml(nm)}</span>
            </label>`;
        }).join('');
    }

    document.getElementById('group-wiki-overlay').classList.remove('active');
    document.getElementById('wiki-settings-overlay').classList.add('active');
    state.activeOverlay = 'wikisettings';
}

document.getElementById('close-wiki-settings-btn').onclick = function() {
    document.getElementById('wiki-settings-overlay').classList.remove('active');
    document.getElementById('group-wiki-overlay').classList.add('active');
    state.activeOverlay = 'groupwiki';
    renderGroupWiki();
};

document.querySelectorAll('#wiki-accent-picker .wiki-accent-chip').forEach(chip => {
    chip.onclick = () => {
        document.querySelectorAll('#wiki-accent-picker .wiki-accent-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
    };
});

document.getElementById('btn-save-wiki-settings').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !isWikiModerator(chat)) return;

    const bannerUrl = document.getElementById('wiki-settings-banner').value.trim();
    const activeChip = document.querySelector('#wiki-accent-picker .wiki-accent-chip.active');
    const accentColor = activeChip ? activeChip.getAttribute('data-accent') : '';

    const moderators = {};
    document.querySelectorAll('#wiki-moderators-list [data-mod-uid]').forEach(cb => {
        if (cb.checked) moderators[cb.getAttribute('data-mod-uid')] = true;
    });

    const rawCss = document.getElementById('wiki-settings-css').value;

    update(ref(state.db, 'chats/' + chat.id + '/wiki'), {
        bannerUrl: bannerUrl,
        announcement: document.getElementById('wiki-settings-announcement').value.trim() || null,
        accentColor: accentColor,
        moderators: moderators,
        // Храним уже очищенный/заскоуленный CSS — если правила санитайзера когда-то ужесточатся,
        // старые сохранённые темы всё равно проходят через него ещё раз при каждом применении (applyWikiCustomCss).
        customCss: rawCss ? sanitizeAndScopeWikiCss(rawCss).slice(0, 20000) : null
    }).then(() => {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        document.getElementById('close-wiki-settings-btn').click();
    }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

// ---- Посты внутри категории ----

export function openWikiCategory(categoryId) {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat) return;
    state.wikiCategoryId = categoryId;
    const cat = (chat.wiki && chat.wiki.categories || {})[categoryId];
    document.getElementById('wiki-category-title').textContent = (cat ? wikiIconFor(cat.name) + ' ' + cat.name : 'Категория');
    document.getElementById('btn-wiki-add-post').classList.toggle('hidden', !canPostToWall(chat));
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

    const owner = isWikiModerator(chat);
    const posts = chat.wiki && chat.wiki.posts
        ? Object.entries(chat.wiki.posts).map(([id, v]) => ({ id, ...v })).filter(p => p.categoryId === state.wikiCategoryId)
            .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.createdAt || 0) - (b.createdAt || 0))
        : [];

    if (!posts.length) {
        list.innerHTML = `<div class="wiki-empty">
            <div class="we-emoji">📝</div>
            <div class="we-text">${canPostToWall(chat) ? 'Постов пока нет —<br>добавьте первый кнопкой «+ Пост»' : 'В этой категории пока пусто'}</div>
        </div>`;
    } else {
        list.innerHTML = posts.map((p, idx) => {
            const thumb = (p.images && p.images[0])
                ? `<img src="${p.images[0]}" class="wiki-post-cover" onerror="this.outerHTML='<div class=&quot;wiki-post-cover-fallback&quot; style=&quot;background:${wikiGradientFor(p.title||'')}&quot;>📝</div>'">`
                : `<div class="wiki-post-cover-fallback" style="background:${wikiGradientFor(p.title || '')};">📝</div>`;
            const likeCount = p.likedBy ? Object.keys(p.likedBy).length : 0;
            return `
            <div class="wiki-post-card card-anim" style="animation-delay:${Math.min(idx, 10) * 45}ms;" data-post-id="${p.id}">
                ${thumb}
                <div class="wiki-post-info">
                    <div class="wiki-post-title">${p.pinned ? '<span class="wiki-pin-badge">📌</span>' : ''}${escapeHtml(p.title || '(без названия)')}</div>
                    <div class="wiki-post-meta">${p.images && p.images.length ? '🖼 ' + p.images.length + ' · ' : ''}${likeCount ? '❤️ ' + likeCount : (p.images && p.images.length ? '' : 'только текст')}</div>
                </div>
                ${canManagePost(chat, p) ? `<button class="wiki-post-del" data-del-post="${p.id}" title="Удалить">🗑</button>` : ''}
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
    const owner = isWikiModerator(chat);
    const post = (chat.wiki && chat.wiki.posts || {})[postId];
    const canManage = canManagePost(chat, post);
    document.getElementById('btn-wiki-pin-post').classList.toggle('hidden', !owner);
    document.getElementById('btn-wiki-edit-post').classList.toggle('hidden', !canManage);
    document.getElementById('btn-wiki-delete-post').classList.toggle('hidden', !canManage);
    renderWikiPost();
}

document.getElementById('close-wiki-post-btn').onclick = function() {
    document.getElementById('wiki-post-overlay').classList.remove('active');
    document.getElementById('wiki-category-overlay').classList.add('active');
    state.activeOverlay = 'wikicategory';
    renderWikiCategory();
};

document.getElementById('btn-wiki-pin-post').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !isWikiModerator(chat) || !state.wikiPostId) return;
    const post = (chat.wiki.posts || {})[state.wikiPostId];
    update(ref(state.db, 'chats/' + chat.id + '/wiki/posts/' + state.wikiPostId), { pinned: !(post && post.pinned) })
        .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

document.getElementById('btn-wiki-like-post').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !state.wikiPostId) return;
    const post = (chat.wiki.posts || {})[state.wikiPostId];
    const liked = !!(post && post.likedBy && post.likedBy[state.currentUser.id]);
    update(ref(state.db, 'chats/' + chat.id + '/wiki/posts/' + state.wikiPostId + '/likedBy'), {
        [state.currentUser.id]: liked ? null : true
    }).then(() => { if (!liked && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light'); })
      .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

document.getElementById('btn-wiki-edit-post').onclick = function() {
    openWikiPostEditor(state.wikiPostId);
};

document.getElementById('btn-wiki-delete-post').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !state.wikiPostId) return;
    const post = (chat.wiki && chat.wiki.posts || {})[state.wikiPostId];
    if (!canManagePost(chat, post)) return;
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
    document.getElementById('wiki-post-body-title').textContent = post.title || '(без названия)';

    // Строка автора поста, в стиле Amino: аватар + имя + дата публикации
    const authorRowEl = document.getElementById('wiki-post-author-row');
    if (authorRowEl) {
        const authorInfo = state.usersData.find(u => u.id === post.authorId);
        const authorName = (authorInfo && authorInfo.name) || (chat.participantNames && chat.participantNames[post.authorId]) || 'Участник';
        authorRowEl.innerHTML = `
            ${avatarHtml(authorName, authorInfo ? authorInfo.avatar : null, 'avatar-sm')}
            <div>
                <div class="wpar-name">${escapeHtml(authorName)}</div>
                <div class="wpar-date">${formatDate(post.createdAt)}</div>
            </div>`;
    }
    
    // Поддержка Markdown в теле поста дропа/вики
    const wikiTextEl = document.getElementById('wiki-post-text');
    if (wikiTextEl) {
        wikiTextEl.innerHTML = renderMarkdown(post.text || '');
        wikiTextEl.classList.add('md-body');
    }

    document.getElementById('btn-wiki-pin-post').classList.toggle('active', !!post.pinned);
    document.getElementById('btn-wiki-pin-post').style.background = post.pinned ? '#ff9f0a' : '';
    document.getElementById('btn-wiki-pin-post').style.color = post.pinned ? '#fff' : '';

    const likedBy = post.likedBy || {};
    const likeCount = Object.keys(likedBy).length;
    const liked = !!likedBy[state.currentUser.id];
    document.getElementById('wiki-like-icon').textContent = liked ? '❤️' : '🤍';
    document.getElementById('wiki-like-count').textContent = likeCount;
    document.getElementById('btn-wiki-like-post').classList.toggle('liked', liked);

    const wrap = document.getElementById('wiki-post-gallery-wrap');
    const gallery = document.getElementById('wiki-post-gallery');
    const dots = document.getElementById('wiki-post-gallery-dots');
    const images = post.images || [];

    if (!images.length) {
        wrap.classList.add('hidden');
        gallery.innerHTML = '';
        dots.innerHTML = '';
    } else {
        wrap.classList.remove('hidden');
        gallery.innerHTML = images.map((url, i) => `<img src="${url}" data-idx="${i}">`).join('');
        dots.innerHTML = images.length > 1
            ? images.map((_, i) => `<span class="${i === 0 ? 'active' : ''}"></span>`).join('')
            : '';
        gallery.querySelectorAll('img').forEach(img => {
            img.onclick = () => openWikiImageViewer(images, parseInt(img.getAttribute('data-idx'), 10));
        });
        gallery.onscroll = () => {
            const idx = Math.round(gallery.scrollLeft / gallery.clientWidth);
            dots.querySelectorAll('span').forEach((d, i) => d.classList.toggle('active', i === idx));
        };
    }

    renderWikiPostWidget(chat, post);
    renderWikiComments(chat, post);
}

// ---- Комментарии под постом вики ----

function renderWikiComments(chat, post) {
    const comments = post.comments
        ? Object.entries(post.comments).map(([id, c]) => ({ id, ...c })).sort((a, b) => a.createdAt - b.createdAt)
        : [];
    document.getElementById('wiki-comments-title').textContent = `Комментарии (${comments.length})`;

    const owner = isWikiModerator(chat);
    const list = document.getElementById('wiki-post-comments-list');
    list.innerHTML = comments.length ? comments.map(c => `
        <div class="comment-item">
            <div>
                <span class="comment-author" data-uid="${c.userId || ''}" style="cursor:pointer;${nickColorStyle(c.userId)}">${escapeHtml(c.author || 'Читатель')}${verifiedBadge(c.userId)}${shopBadgeHtml(c.userId)}${passVipBadge(c.userId)}</span>
                <span class="comment-meta">${formatDate(c.createdAt)}</span>
            </div>
            <div class="comment-text md-body">${renderMarkdown(c.text || '')}</div>
            ${(c.userId === state.currentUser.id || owner) ? `<button class="comment-delete" data-cid="${c.id}">Удалить</button>` : ''}
        </div>
    `).join('') : '<div style="color:var(--text-secondary);font-size:13px;">Пока нет комментариев. Будьте первым!</div>';

    list.querySelectorAll('.comment-author').forEach(el => {
        el.onclick = () => { const uid = el.getAttribute('data-uid'); if (uid) openUserProfile(uid); };
    });
    list.querySelectorAll('.comment-delete').forEach(btn => {
        btn.onclick = () => deleteWikiComment(chat.id, post.id, btn.getAttribute('data-cid'));
    });
}

document.getElementById('btn-send-wiki-comment').onclick = function() {
    const input = document.getElementById('wiki-comment-input');
    const text = input.value.trim();
    if (!text || !state.wikiChatId || !state.wikiPostId) return;

    push(ref(state.db, 'chats/' + state.wikiChatId + '/wiki/posts/' + state.wikiPostId + '/comments'), {
        author: state.currentUser.name,
        userId: state.currentUser.id,
        text: text,
        createdAt: Date.now() 
    }).then(() => {
        input.value = '';
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

function deleteWikiComment(chatId, postId, commentId) {
    tg.showConfirm('Удалить комментарий?', (ok) => {
        if (!ok) return;
        remove(ref(state.db, 'chats/' + chatId + '/wiki/posts/' + postId + '/comments/' + commentId))
            .catch(err => tg.showAlert('Ошибка удаления: ' + friendlyDbError(err)));
    });
}

// ---- Полноэкранный просмотр картинки ----

export function openWikiImageViewer(images, index) {
    state.wikiImageViewer = { images, index };
    document.getElementById('wiki-image-viewer-img').src = images[index];
    document.getElementById('wiki-viewer-hint').textContent = images.length > 1 ? `Тап по фото — следующее (${index + 1}/${images.length})` : '';
    document.getElementById('wiki-image-viewer-overlay').classList.add('active');
}

document.getElementById('close-wiki-image-viewer-btn').onclick = function() {
    document.getElementById('wiki-image-viewer-overlay').classList.remove('active');
};

document.getElementById('wiki-image-viewer-img').onclick = function() {
    const { images, index } = state.wikiImageViewer;
    if (!images || images.length < 2) return;
    const next = (index + 1) % images.length;
    state.wikiImageViewer.index = next;
    document.getElementById('wiki-image-viewer-img').src = images[next];
    document.getElementById('wiki-viewer-hint').textContent = `Тап по фото — следующее (${next + 1}/${images.length})`;
};

// ---- Редактор поста ----

export function openWikiPostEditor(postId) {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !state.wikiCategoryId) return;
    const post = postId ? (chat.wiki && chat.wiki.posts || {})[postId] : null;
    if (postId && !canManagePost(chat, post)) return;
    if (!postId && !canPostToWall(chat)) return;
    state.wikiEditingPostId = postId;

    document.getElementById('wiki-post-editor-title').textContent = postId ? '✏️ Редактировать пост' : '✨ Новый пост';
    document.getElementById('wiki-editor-post-title').value = post ? (post.title || '') : '';
    document.getElementById('wiki-editor-post-text').value = post ? (post.text || '') : '';
    state.wikiEditorImages = post && post.images ? post.images.slice() : [];
    renderWikiEditorImages();

    const widgetSelect = document.getElementById('wiki-editor-post-widget');
    if (widgetSelect) {
        const postWidgets = Object.entries((chat.wiki && chat.wiki.widgets) || {})
            .map(([id, w]) => ({ id, ...w }))
            .filter(w => w.placement === 'post');
        widgetSelect.innerHTML = '<option value="">Без виджета</option>' +
            postWidgets.map(w => `<option value="${w.id}">${escapeHtml(w.title || 'Без названия')}</option>`).join('');
        widgetSelect.value = (post && post.widgetId && postWidgets.some(w => w.id === post.widgetId)) ? post.widgetId : '';
        widgetSelect.closest('.wiki-editor-widget-row')?.classList.toggle('hidden', !postWidgets.length);
    }

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
        <div class="wiki-editor-img-tile">
            <img src="${url}">
            <button class="wet-rm" data-rm-img="${i}">×</button>
        </div>`).join('');
    row.querySelectorAll('[data-rm-img]').forEach(btn => {
        btn.onclick = () => {
            state.wikiEditorImages.splice(parseInt(btn.getAttribute('data-rm-img'), 10), 1);
            renderWikiEditorImages();
        };
    });
}

document.getElementById('wiki-editor-image-file').addEventListener('change', async function() {
    const files = Array.from(this.files || []);
    this.value = '';
    if (!files.length) return;
    const tile = document.getElementById('wiki-editor-image-upload-btn');
    const labelSpan = tile.querySelector('.wet-label');
    const origLabel = labelSpan.textContent;
    tile.classList.add('uploading');
    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 30 * 1024 * 1024) { tg.showAlert('Файл слишком большой (максимум 30 МБ)'); continue; }
        try {
            const compressed = await compressImage(file);
            const url = await uploadToImgbb(compressed, (pct) => {
                labelSpan.textContent = pct < 100 ? pct + '%' : '…';
            });
            state.wikiEditorImages.push(url);
            renderWikiEditorImages();
        } catch (err) {
            tg.showAlert(friendlyUploadError(err));
        }
    }
    tile.classList.remove('uploading');
    labelSpan.textContent = origLabel;
    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
});

document.getElementById('btn-save-wiki-post').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.wikiChatId);
    if (!chat || !state.wikiCategoryId) return;
    const existingPost = state.wikiEditingPostId ? (chat.wiki && chat.wiki.posts || {})[state.wikiEditingPostId] : null;
    if (state.wikiEditingPostId ? !canManagePost(chat, existingPost) : !canPostToWall(chat)) return;

    const title = document.getElementById('wiki-editor-post-title').value.trim();
    if (!title) return tg.showAlert('Введите заголовок поста');
    const text = document.getElementById('wiki-editor-post-text').value.trim();
    const images = state.wikiEditorImages.slice();
    const widgetSelectEl = document.getElementById('wiki-editor-post-widget');
    const widgetId = widgetSelectEl && widgetSelectEl.value ? widgetSelectEl.value : null;
    const payload = { categoryId: state.wikiCategoryId, title, text, images, widgetId, authorId: state.currentUser.id };

    const savePromise = state.wikiEditingPostId
        ? update(ref(state.db, 'chats/' + chat.id + '/wiki/posts/' + state.wikiEditingPostId), payload)
        : push(ref(state.db, 'chats/' + chat.id + '/wiki/posts'), { ...payload, createdAt: Date.now()  });

    savePromise.then(() => {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        document.getElementById('close-wiki-post-editor-btn').click();
    }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

// ============================================================
// === ЭКОНОМИКА ГМ: переменные (валюты), инвентарь, команды ===
// ============================================================

export function economyCurrencies(chat) {
    return chat && chat.economy && chat.economy.currencies
        ? Object.entries(chat.economy.currencies).map(([id, v]) => ({ id, ...v }))
        : [];
}
export function economyItems(chat) {
    return chat && chat.economy && chat.economy.items
        ? Object.entries(chat.economy.items).map(([id, v]) => ({ id, ...v }))
        : [];
}
export function getBalance(chat, uid, currencyId) {
    return (chat && chat.economy && chat.economy.balances && chat.economy.balances[uid] && chat.economy.balances[uid][currencyId]) || 0;
}
export function getInventoryCount(chat, uid, itemId) {
    return (chat && chat.economy && chat.economy.inventory && chat.economy.inventory[uid] && chat.economy.inventory[uid][itemId]) || 0;
}

function slugifyEconomyId(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9а-яё_]/gi, '') || ('id' + Date.now() );
}
function findCurrencyByNameOrId(chat, key) {
    const k = String(key || '').toLowerCase();
    return economyCurrencies(chat).find(c => c.id.toLowerCase() === k || (c.name || '').toLowerCase() === k);
}
function findItemByNameOrId(chat, key) {
    const k = String(key || '').toLowerCase();
    return economyItems(chat).find(i => i.id.toLowerCase() === k || (i.name || '').toLowerCase() === k);
}
function resolveMentionedUser(chat, mention) {
    if (!mention) return null;
    const clean = mention.replace(/^@/, '').toLowerCase();
    const ids = Object.keys(chat.participants || {});
    for (const uid of ids) {
        const u = state.usersData.find(x => x.id === uid);
        const nm = (u && u.name) || (chat.participantNames && chat.participantNames[uid]) || '';
        if (nm.toLowerCase() === clean) return { id: uid, name: nm };
    }
    return null;
}
function postEconomySystemMessage(chatId, text) {
    push(ref(state.db, 'chats/' + chatId + '/messages'), {
        senderId: 'system',
        senderName: 'Система',
        text,
        isSystem: true,
        createdAt: Date.now() 
    });
    update(ref(state.db, 'chats/' + chatId), { lastMessage: text, lastMessageAt: Date.now()  });
}

export function tryHandleEconomyCommand(chat, rawText) {
    const text = rawText.trim();
    if (!text.startsWith('/')) return false;

    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const isMod = isWikiModerator(chat);

    if (cmd === '/give' || cmd === '/take') {
        if (!isMod) { tg.showAlert('Только ГМ и модераторы могут начислять/списывать переменные'); return true; }
        const [, mention, currencyKey, amountStr] = parts;
        if (!mention || !currencyKey || !amountStr) { tg.showAlert('Формат: /give @игрок переменная количество'); return true; }
        const target = resolveMentionedUser(chat, mention);
        const currency = findCurrencyByNameOrId(chat, currencyKey);
        const amount = parseInt(amountStr, 10);
        if (!target) { tg.showAlert('Игрок с таким именем не найден в этом чате'); return true; }
        if (!currency) { tg.showAlert('Такой переменной нет. Создайте её в панели «Экономика и инвентарь».'); return true; }
        if (isNaN(amount) || amount <= 0) { tg.showAlert('Количество должно быть положительным числом'); return true; }

        const current = getBalance(chat, target.id, currency.id);
        const delta = cmd === '/give' ? amount : -amount;
        const next = Math.max(0, current + delta);
        update(ref(state.db, `chats/${chat.id}/economy/balances/${target.id}`), { [currency.id]: next }).then(() => {
            postEconomySystemMessage(chat.id, `${cmd === '/give' ? '➕' : '➖'} ${currency.icon || ''} ${target.name}: ${cmd === '/give' ? '+' : '-'}${amount} ${currency.name} (баланс: ${next})`);
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        return true;
    }

    if (cmd === '/item') {
        if (!isMod) { tg.showAlert('Только ГМ и модераторы могут выдавать предметы'); return true; }
        const sub = (parts[1] || '').toLowerCase();
        if (sub !== 'give' && sub !== 'take') { tg.showAlert('Формат: /item give @игрок предмет [количество]'); return true; }
        const mention = parts[2];
        const itemKey = parts[3];
        const amount = parseInt(parts[4], 10) || 1;
        const target = resolveMentionedUser(chat, mention);
        const item = findItemByNameOrId(chat, itemKey || '');
        if (!target) { tg.showAlert('Игрок с таким именем не найден в этом чате'); return true; }
        if (!item) { tg.showAlert('Такого предмета нет. Создайте его в панели «Экономика и инвентарь».'); return true; }

        const current = getInventoryCount(chat, target.id, item.id);
        const next = Math.max(0, current + (sub === 'give' ? amount : -amount));
        update(ref(state.db, `chats/${chat.id}/economy/inventory/${target.id}`), { [item.id]: next }).then(() => {
            postEconomySystemMessage(chat.id, `${sub === 'give' ? '🎁' : '🗑'} ${item.icon || '📦'} ${target.name}: ${sub === 'give' ? '+' : '-'}${amount} «${item.name}» (в инвентаре: ${next})`);
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        return true;
    }

    if (cmd === '/use') {
        const itemKey = parts.slice(1).join(' ');
        const item = findItemByNameOrId(chat, itemKey);
        if (!item) { tg.showAlert('Формат: /use название_предмета'); return true; }
        const current = getInventoryCount(chat, state.currentUser.id, item.id);
        if (current <= 0) { tg.showAlert('У вас нет этого предмета в инвентаре'); return true; }
        update(ref(state.db, `chats/${chat.id}/economy/inventory/${state.currentUser.id}`), { [item.id]: current - 1 }).then(() => {
            postEconomySystemMessage(chat.id, `✨ ${state.currentUser.name} использует «${item.name}» ${item.icon || ''}${item.desc ? ' — ' + item.desc : ''}`);
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        return true;
    }

    if (cmd === '/balance' || cmd === '/inv' || cmd === '/inventory') {
        const currencies = economyCurrencies(chat);
        const items = economyItems(chat).filter(i => getInventoryCount(chat, state.currentUser.id, i.id) > 0);
        const balLine = currencies.length
            ? currencies.map(c => `${c.icon || ''} ${c.name}: ${getBalance(chat, state.currentUser.id, c.id)}`).join('\n')
            : 'В этом чате пока нет переменных';
        const invLine = items.length
            ? items.map(i => `${i.icon || '📦'} ${i.name} ×${getInventoryCount(chat, state.currentUser.id, i.id)}`).join('\n')
            : 'Инвентарь пуст';
        tg.showAlert(`💰 Баланс:\n${balLine}\n\n🎒 Инвентарь:\n${invLine}`);
        return true;
    }

    // /roll — бросок кубика, доступен всем участникам без прав ГМ. Форматы:
    // /roll d20, /roll 2d6, /roll 1d20+5, /roll 3d8-2
    if (cmd === '/roll' || cmd === '/r') {
        const rollMatch = (parts[1] || 'd20').toLowerCase().match(/^(\d*)d(\d+)([+-]\d+)?$/);
        if (!rollMatch) { tg.showAlert('Формат: /roll 2d6+3 (кол-во костейDграни±модификатор)'); return true; }
        const count = Math.min(parseInt(rollMatch[1] || '1', 10) || 1, 20);
        const sides = Math.min(Math.max(parseInt(rollMatch[2], 10) || 20, 2), 1000);
        const modifier = rollMatch[3] ? parseInt(rollMatch[3], 10) : 0;
        const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
        const total = rolls.reduce((a, b) => a + b, 0) + modifier;
        const rollsStr = rolls.join(' + ') + (modifier ? ` ${modifier > 0 ? '+' : '-'} ${Math.abs(modifier)}` : '');
        postEconomySystemMessage(chat.id, `🎲 ${state.currentUser.name} бросает ${count}d${sides}${modifier ? (modifier > 0 ? '+' : '') + modifier : ''}: ${rollsStr} = ${total}`);
        return true;
    }

    return false;
}

// === Панель ГМ «Экономика и инвентарь» ===

document.getElementById('chat-economy-btn').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.currentChatId);
    if (!chat || !isWikiModerator(chat)) return;
    state.economyChatId = chat.id;
    renderEconomyPanel();
    document.getElementById('chat-overlay').classList.remove('active');
    document.getElementById('economy-panel-overlay').classList.add('active');
    state.activeOverlay = 'economypanel';
};
document.getElementById('close-economy-panel-btn').onclick = function() {
    document.getElementById('economy-panel-overlay').classList.remove('active');
    document.getElementById('chat-overlay').classList.add('active');
    state.activeOverlay = 'chat';
};

export function renderEconomyPanel() {
    const chat = state.chatsData.find(c => c.id === state.economyChatId);
    if (!chat) return;
    const currencies = economyCurrencies(chat);
    const items = economyItems(chat);
    const participantIds = Object.keys(chat.participants || {});

    const currenciesEl = document.getElementById('economy-currencies-list');
    currenciesEl.innerHTML = currencies.length ? currencies.map(c => `
        <div class="admin-item" style="align-items:center;">
            <div class="admin-item-info">
                <div class="admin-item-title">${c.icon || '🪙'} ${escapeHtml(c.name)}</div>
                <div class="admin-item-sub">ID: ${escapeHtml(c.id)}</div>
            </div>
            <div class="admin-item-actions">
                <button class="icon-btn danger" title="Удалить переменную" data-remove-currency="${c.id}">🗑</button>
            </div>
        </div>`).join('') : '<div style="color:var(--text-secondary);font-size:13px;">Переменных пока нет — добавьте, например, «Золото» или «Мана».</div>';

    const itemsEl = document.getElementById('economy-items-list');
    itemsEl.innerHTML = items.length ? items.map(i => `
        <div class="admin-item" style="align-items:center;">
            <div class="admin-item-info">
                <div class="admin-item-title">${i.icon || '📦'} ${escapeHtml(i.name)}</div>
                <div class="admin-item-sub">${escapeHtml(i.desc || '')}</div>
            </div>
            <div class="admin-item-actions">
                <button class="icon-btn danger" title="Удалить предмет" data-remove-item="${i.id}">🗑</button>
            </div>
        </div>`).join('') : '<div style="color:var(--text-secondary);font-size:13px;">Предметов пока нет — добавьте, например, «Зелье лечения».</div>';

    const playersEl = document.getElementById('economy-players-list');
    playersEl.innerHTML = participantIds.map(uid => {
        const u = state.usersData.find(x => x.id === uid);
        const nm = (u && u.name) || (chat.participantNames && chat.participantNames[uid]) || 'Участник';
        const isMuted = !!(chat.mutedUsers && chat.mutedUsers[uid]);
        const isMe = uid === state.currentUser.id;
        const balancesStr = currencies.map(c => `${c.icon || ''} ${getBalance(chat, uid, c.id)}`).join('  ') || '—';
        const invStr = items.map(i => `${i.icon || '📦'}×${getInventoryCount(chat, uid, i.id)}`).filter((s, idx) => getInventoryCount(chat, uid, items[idx].id) > 0).join('  ') || '—';
        return `
        <div class="admin-item" style="align-items:center;flex-wrap:wrap;">
            ${avatarHtml(nm, u ? u.avatar : null, 'avatar-sm')}
            <div class="admin-item-info">
                <div class="admin-item-title">${escapeHtml(nm)}${isMuted ? ' <span style="color:#e74c3c;font-size:11px;font-weight:700;">МУТ</span>' : ''}</div>
                <div class="admin-item-sub">💰 ${balancesStr} · 🎒 ${invStr}</div>
            </div>
            <div class="admin-item-actions" style="flex-wrap:wrap;">
                ${currencies.length ? `<button class="icon-btn" title="Начислить/списать переменную" data-adjust-currency="${uid}">🪙</button>` : ''}
                ${items.length ? `<button class="icon-btn" title="Выдать/забрать предмет" data-adjust-item="${uid}">🎁</button>` : ''}
                ${!isMe ? `<button class="icon-btn ${isMuted ? '' : 'danger'}" title="${isMuted ? 'Снять мут' : 'Замьютить'}" data-toggle-mute="${uid}">${isMuted ? '🔊' : '🔇'}</button>` : ''}
                ${!isMe ? `<button class="icon-btn danger" title="Исключить из чата" data-kick-user="${uid}">🚪</button>` : ''}
            </div>
        </div>`;
    }).join('');

    playersEl.querySelectorAll('[data-adjust-currency]').forEach(btn => {
        btn.onclick = () => economyAdjustCurrencyPrompt(chat, btn.getAttribute('data-adjust-currency'));
    });
    playersEl.querySelectorAll('[data-adjust-item]').forEach(btn => {
        btn.onclick = () => economyAdjustItemPrompt(chat, btn.getAttribute('data-adjust-item'));
    });
    playersEl.querySelectorAll('[data-toggle-mute]').forEach(btn => {
        btn.onclick = () => economyToggleMute(chat, btn.getAttribute('data-toggle-mute'));
    });
    playersEl.querySelectorAll('[data-kick-user]').forEach(btn => {
        btn.onclick = () => economyKickUser(chat, btn.getAttribute('data-kick-user'));
    });
    currenciesEl.querySelectorAll('[data-remove-currency]').forEach(btn => {
        btn.onclick = () => {
            remove(ref(state.db, `chats/${chat.id}/economy/currencies/${btn.getAttribute('data-remove-currency')}`)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };
    });
    itemsEl.querySelectorAll('[data-remove-item]').forEach(btn => {
        btn.onclick = () => {
            remove(ref(state.db, `chats/${chat.id}/economy/items/${btn.getAttribute('data-remove-item')}`)).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
        };
    });
}

document.getElementById('btn-economy-add-currency').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.economyChatId);
    if (!chat) return;
    const name = prompt('Название переменной (например, «Золото», «Мана», «Здоровье»):');
    if (!name || !name.trim()) return;
    const icon = prompt('Иконка-эмодзи (необязательно, например 🪙):', '🪙') || '';
    const id = slugifyEconomyId(name);
    update(ref(state.db, `chats/${chat.id}/economy/currencies/${id}`), { name: name.trim(), icon: icon.trim() })
        .then(renderEconomyPanel)
        .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

document.getElementById('btn-economy-add-item').onclick = function() {
    const chat = state.chatsData.find(c => c.id === state.economyChatId);
    if (!chat) return;
    const name = prompt('Название предмета (например, «Зелье лечения»):');
    if (!name || !name.trim()) return;
    const icon = prompt('Иконка-эмодзи (необязательно, например 🧪):', '🧪') || '';
    const desc = prompt('Описание/эффект предмета (необязательно):', '') || '';
    const id = slugifyEconomyId(name);
    update(ref(state.db, `chats/${chat.id}/economy/items/${id}`), { name: name.trim(), icon: icon.trim(), desc: desc.trim() })
        .then(renderEconomyPanel)
        .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
};

function economyAdjustCurrencyPrompt(chat, uid) {
    const currencies = economyCurrencies(chat);
    const u = state.usersData.find(x => x.id === uid);
    const nm = (u && u.name) || (chat.participantNames && chat.participantNames[uid]) || 'Участник';
    const list = currencies.map((c, i) => `${i + 1}. ${c.icon || ''} ${c.name}`).join('\n');
    const choice = prompt(`Какую переменную изменить у «${nm}»?\n${list}\n\nВведите номер:`);
    const idx = parseInt(choice, 10) - 1;
    const currency = currencies[idx];
    if (!currency) return;
    const current = getBalance(chat, uid, currency.id);
    const raw = prompt(`Новый баланс «${currency.name}» для «${nm}» (сейчас ${current}):`, current);
    if (raw === null) return;
    const next = Math.max(0, parseInt(raw, 10) || 0);
    update(ref(state.db, `chats/${chat.id}/economy/balances/${uid}`), { [currency.id]: next })
        .then(() => {
            postEconomySystemMessage(chat.id, `🪙 ${currency.icon || ''} ${nm}: баланс «${currency.name}» изменён на ${next}`);
            renderEconomyPanel();
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
}

function economyAdjustItemPrompt(chat, uid) {
    const items = economyItems(chat);
    const u = state.usersData.find(x => x.id === uid);
    const nm = (u && u.name) || (chat.participantNames && chat.participantNames[uid]) || 'Участник';
    const list = items.map((it, i) => `${i + 1}. ${it.icon || '📦'} ${it.name}`).join('\n');
    const choice = prompt(`Какой предмет изменить у «${nm}»?\n${list}\n\nВведите номер:`);
    const idx = parseInt(choice, 10) - 1;
    const item = items[idx];
    if (!item) return;
    const current = getInventoryCount(chat, uid, item.id);
    const raw = prompt(`Новое количество «${item.name}» у «${nm}» (сейчас ${current}):`, current);
    if (raw === null) return;
    const next = Math.max(0, parseInt(raw, 10) || 0);
    update(ref(state.db, `chats/${chat.id}/economy/inventory/${uid}`), { [item.id]: next })
        .then(() => {
            postEconomySystemMessage(chat.id, `🎁 ${item.icon || ''} ${nm}: количество «${item.name}» изменено на ${next}`);
            renderEconomyPanel();
        }).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
}

function economyToggleMute(chat, uid) {
    const next = !(chat.mutedUsers && chat.mutedUsers[uid]);
    update(ref(state.db, `chats/${chat.id}/mutedUsers`), { [uid]: next ? true : null })
        .then(renderEconomyPanel)
        .catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
}

function economyKickUser(chat, uid) {
    const u = state.usersData.find(x => x.id === uid);
    const nm = (u && u.name) || (chat.participantNames && chat.participantNames[uid]) || 'участника';
    tg.showConfirm(`Исключить «${nm}» из чата?`, (ok) => {
        if (!ok) return;
        update(ref(state.db, `chats/${chat.id}`), {
            [`participants/${uid}`]: null,
            [`mutedUsers/${uid}`]: null
        }).then(renderEconomyPanel).catch(err => tg.showAlert('Ошибка: ' + friendlyDbError(err)));
    });
}
