export const EMOJIS = ['👍', '❤️', '🔥', '😂', '👏'];

export const COVER_COLORS = ['#ff9f0a', '#30d158', '#0a84ff', '#ff453a', '#bf5af2', '#64d2ff'];

export const PASS_REWARD_TYPES = [
            { id: 'coins',      label: '🪙 Монеты — value: число' },
            { id: 'frame',      label: '🖼 Рамка аватара (как в магазине) — value: URL картинки' },
            { id: 'decoration', label: '🎀 Декор профиля (как в магазине) — value: URL картинки' },
            { id: 'badge',      label: '🏅 Значок у ника (как в магазине) — value: URL картинки' },
            { id: 'nickcolor',  label: '🎨 Цвет ника (как в магазине) — value: HEX-цвет, напр. #ff9f0a' },
            { id: 'buff',       label: '⚡ Буст монет (как в магазине) — value: "множитель,часы" напр. 2,24' },
            { id: 'gems',       label: '💎 Кристаллы (новая премиум-валюта) — value: число' },
            { id: 'title',      label: '🏷 Титул под именем — value: текст титула' },
            { id: 'vip',        label: '✨ VIP-статус — value: число дней' },
            { id: 'overlay',    label: '👑 Оверлей на аватар — value: URL картинки' },
            { id: 'pet',        label: '🐾 Питомец — value: эмодзи' },
            { id: 'chatbg',     label: '🖼 Фон чата — value: URL картинки' },
            { id: 'reaction',   label: '😄 Кастомная реакция — value: эмодзи или URL' },
            { id: 'sound',      label: '🔊 Звуковой стикер — value: URL аудио' },
            { id: 'chest',      label: '🎁 Сундук — value: варианты монет через запятую, напр. 50,100,200' },
            { id: 'exclusive',  label: '🔒 Эксклюзивный контент — value: текст/описание' },
            { id: 'cardpack',   label: '🃏 Набор карточек (карточная игра) — value: ID набора из админки «Карточки»' },
        ];

export const PASS_REASON_TO_QUEST_TYPE = { chapter: 'chapters', book: 'books', comment: 'comments', message: 'messages', reaction: 'reactions', boss: 'boss' };

export const IMGBB_API_KEY = 'ac1c48b003ee1441183cef03cce5a0a4';

export const CLOUDINARY_CLOUD_NAME = 'fwwhxxrl';

export const CLOUDINARY_UPLOAD_PRESET = 'ml_default';

export const sessionStartTime = Date.now();

export const notifiedIds = new Set();

export const TERRARIA_PIXEL_BITMAPS = [
            ['00100', '01110', '11111', '10101', '11111'], // 🏠 Лента
            ['11011', '10001', '10001', '10001', '11111'], // 📚 Книги
            ['11111', '10001', '10001', '11101', '00100'], // 💬 Чаты
            ['01110', '01110', '00000', '11111', '11111']  // 👤 Профиль
        ];
