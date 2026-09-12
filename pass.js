import { ref, update, remove, increment } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { state, tg } from './state.js';
import { PASS_REWARD_TYPES, PASS_REASON_TO_QUEST_TYPE } from './constants.js';
import { escapeHtml, pad2v, showTerrariaToast } from './utils.js';
import { goToSubpage } from './profile.js';

export function passRewardTypeLabel(t) {
            const f = PASS_REWARD_TYPES.find(x => x.id === t);
            return f ? f.label : t;
        }

        export function currentSeasonId() {
            const d = new Date();
            return d.getFullYear() + '-' + pad2v(d.getMonth() + 1);
        }

        export function passSortedLevels() {
            if (!state.seasonPassData || !state.seasonPassData.levels) return [];
            return Object.entries(state.seasonPassData.levels)
                .map(([lvl, v]) => ({ level: parseInt(lvl, 10), ...v }))
                .sort((a, b) => a.level - b.level);
        }

        export function passLevelForXp(xp) {
            const levels = passSortedLevels();
            let lvl = 0;
            for (const l of levels) { if (xp >= (l.xpRequired || 0)) lvl = l.level; else break; }
            return lvl;
        }



        // Гарантирует, что прогресс пасса пользователя соответствует текущему сезону; при смене месяца — сброс


        export function ensurePassSeason() {
            if (!state.db || !state.currentUser) return;
            const me = state.usersData.find(u => u.id === state.currentUser.id);
            const season = currentSeasonId();
            const p = (me && me.pass) || null;
            if (!p || p.season !== season) {
                const fresh = { season, xp: 0, level: 0, premium: false, claimed: {}, weeklyProgress: {} };
                update(ref(state.db, 'users/' + state.currentUser.id), { pass: fresh }).catch(() => {});
                state.myPassState = fresh;
            } else {
                state.myPassState = p;
            }
        }



        // reason -> ключ в pass/weeklyProgress (для ивентовых заданий сезона)




        // Начисление XP пасса за действия в приложении


        export function awardPassXP(amount, reason) {
            if (!state.db || !state.currentUser || !amount) return;
            ensurePassSeason();
            const me = state.usersData.find(u => u.id === state.currentUser.id);
            const p = (me && me.pass) || state.myPassState || { season: currentSeasonId(), xp: 0, level: 0, premium: false, claimed: {} };
            const beforeLvl = passLevelForXp(p.xp || 0);
            const newXp = (p.xp || 0) + amount;
            const afterLvl = passLevelForXp(newXp);
            const payload = { 'pass/xp': increment(amount), 'pass/level': afterLvl };
            const questType = PASS_REASON_TO_QUEST_TYPE[reason];
            if (questType) payload['pass/weeklyProgress/' + questType] = increment(1);
            update(ref(state.db, 'users/' + state.currentUser.id), payload).catch(() => {});
            if (afterLvl > beforeLvl) {
                showTerrariaToast('🎫 Пасс: новый уровень!', 'Уровень ' + afterLvl + ' открыт', '🎫');
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            }
        }

        window.awardPassXP = awardPassXP;



        // Титул и VIP-статус рядом с именем (используется в профиле, чатах, постах)


        export function passTitleHtml(userId) {
            const u = state.usersData.find(x => x.id === userId);
            const t = u && u.equipped && u.equipped.passTitle;
            if (!t) return '';
            return `<span class="pass-title-text" style="display:inline-block;margin:0 0 0 4px;">${escapeHtml(t)}</span>`;
        }

        export function passVipBadge(userId) {
            const u = state.usersData.find(x => x.id === userId);
            const until = u && u.pass && u.pass.vipUntil;
            if (!until || until < Date.now()) return '';
            return `<span title="VIP" style="margin-left:2px;">✨</span>`;
        }

        export function renderPassButton() {
            const chip = document.getElementById('pass-lvl-chip');
            if (!chip || !state.currentUser) return;
            const me = state.usersData.find(u => u.id === state.currentUser.id);
            const lvl = (me && me.pass && me.pass.level) || 0;
            chip.textContent = 'Ур. ' + lvl;

            const btn = document.getElementById('btn-open-pass');
            const enabled = !state.seasonPassData || state.seasonPassData.enabled !== false;
            if (btn) btn.classList.toggle('hidden', !enabled && !state.isAdmin);

            const titleEl = document.getElementById('pass-title-display');
            const t = me && me.equipped && me.equipped.passTitle;
            if (titleEl) {
                if (t) { titleEl.textContent = t; titleEl.classList.remove('hidden'); }
                else { titleEl.classList.add('hidden'); }
            }

            const overlayImg = document.getElementById('pass-avatar-overlay-img');
            const overlayUrl = me && me.equipped && me.equipped.passOverlay;
            if (overlayImg) {
                if (overlayUrl) { overlayImg.src = overlayUrl; overlayImg.classList.remove('hidden'); }
                else { overlayImg.classList.add('hidden'); }
            }
        }

        export function renderPassPetWidget() {
            const el = document.getElementById('pass-pet-widget');
            if (!el || !state.currentUser) return;
            const me = state.usersData.find(u => u.id === state.currentUser.id);
            const pet = me && me.equipped && me.equipped.passPet;
            if (pet) { el.textContent = pet; el.classList.remove('hidden'); }
            else { el.classList.add('hidden'); }
        }



        document.getElementById('btn-open-pass').onclick = () => goToSubpage('pass.html');
        document.getElementById('pass-pet-widget').onclick = function() {
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
            this.style.transform = 'scale(1.3)';
            setTimeout(() => { this.style.transform = ''; }, 200);
        };

        // Загрузка звуковых файлов (используем ту же логику, что и для вложений — фото/видео/аудио)
