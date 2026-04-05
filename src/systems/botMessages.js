const { EmbedBuilder } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const db = require('../utils/database');
const { channelName: getLocaleName, getLocale } = require('../utils/locale');

// ── Templates ────────────────────────────────────────────────────────────

const TEMPLATE_I18N = {
  en: {
    rules: { name: 'Server Rules', desc: 'A rules embed with numbered fields', title: 'Server Rules',
      body: 'Please read and follow these rules to keep our community safe and welcoming.',
      fields: [
        { name: '1. Be Respectful', value: 'Treat everyone with respect. No harassment, hate speech, or discrimination.' },
        { name: '2. No Spam', value: 'Do not spam messages, images, or links.' },
        { name: '3. No NSFW', value: 'Keep all content appropriate and safe for work.' },
      ],
      footer: 'Breaking rules may result in warnings, mutes, or bans.' },
    welcome: { name: 'Welcome Info', desc: 'An informational embed for new members', title: 'Welcome to the Server!',
      body: 'Here is everything you need to get started.',
      fields: [
        { name: 'Verify', value: 'Head to the verification channel to get access.' },
        { name: 'Roles', value: 'Pick your roles in the roles channel.' },
        { name: 'Have Fun', value: 'Explore the channels and enjoy your stay!' },
      ] },
    announcement: { name: 'Announcement', desc: 'A general announcement template', title: 'Announcement',
      body: 'Your announcement text here.', footer: 'Posted by the admin team' },
    streamLive: { name: 'Stream Announcement (Live)', desc: 'Template for live stream announcements',
      title: '🔴 {user} is LIVE!', body: '**{user}** is now live! Come watch and show your support!',
      fields: [
        { name: 'Platform Status', value: '🟢 **{platform}** — LIVE' },
      ],
      footer: 'Click Watch Now to join!' },
    streamEnded: { name: 'Stream Ended', desc: 'Template for when a stream ends',
      title: '⚫ {user}', body: 'Stream has ended. Thanks for watching!' },
    blank: { name: 'Blank Embed', desc: 'Start from scratch' },
  },
  tr: {
    rules: { name: 'Sunucu Kuralları', desc: 'Numaralı alanlarla kural mesajı', title: 'Sunucu Kuralları',
      body: 'Topluluğumuzu güvenli ve hoş tutmak için lütfen bu kuralları okuyun ve uyun.',
      fields: [
        { name: '1. Saygılı Olun', value: 'Herkese saygılı davranın. Taciz, nefret söylemi veya ayrımcılık yasaktır.' },
        { name: '2. Spam Yapmayın', value: 'Tekrarlayan mesaj, görsel veya link spam yapmayın.' },
        { name: '3. Uygunsuz İçerik Yok', value: 'Tüm içerik uygun ve güvenli olmalıdır.' },
      ],
      footer: 'Kural ihlali uyarı, susturma veya yasaklanma ile sonuçlanabilir.' },
    welcome: { name: 'Hoş Geldin Bilgisi', desc: 'Yeni üyeler için bilgi mesajı', title: 'Sunucuya Hoş Geldiniz!',
      body: 'Başlamanız için bilmeniz gereken her şey burada.',
      fields: [
        { name: 'Doğrulama', value: 'Erişim için doğrulama kanalına gidin.' },
        { name: 'Roller', value: 'Rol kanalından rollerinizi seçin.' },
        { name: 'İyi Eğlenceler', value: 'Kanalları keşfedin ve iyi vakit geçirin!' },
      ] },
    announcement: { name: 'Duyuru', desc: 'Genel duyuru şablonu', title: 'Duyuru',
      body: 'Duyuru metninizi buraya yazın.', footer: 'Yönetim ekibi tarafından yayınlandı' },
    streamLive: { name: 'Yayın Duyurusu (Canlı)', desc: 'Canlı yayın duyuru şablonu',
      title: '🔴 {user} YAYINDA!', body: '**{user}** şu anda yayında! Gel izle ve destek ol!',
      fields: [
        { name: 'Platform Durumu', value: '🟢 **{platform}** — LIVE' },
      ],
      footer: 'İzlemek için Watch Now\'a tıkla!' },
    streamEnded: { name: 'Yayın Sona Erdi', desc: 'Yayın bittiğinde kullanılan şablon',
      title: '⚫ {user}', body: 'Yayın sona erdi. İzlediğiniz için teşekkürler!' },
    blank: { name: 'Boş Embed', desc: 'Sıfırdan başla' },
  },
  de: {
    rules: { name: 'Serverregeln', desc: 'Regeln-Embed mit nummerierten Feldern', title: 'Serverregeln',
      body: 'Bitte lesen und befolgen Sie diese Regeln, um unsere Community sicher zu halten.',
      fields: [
        { name: '1. Respektvoll sein', value: 'Behandeln Sie alle mit Respekt. Keine Belästigung oder Diskriminierung.' },
        { name: '2. Kein Spam', value: 'Keine wiederholten Nachrichten, Bilder oder Links.' },
        { name: '3. Kein NSFW', value: 'Alle Inhalte müssen angemessen sein.' },
      ],
      footer: 'Regelverstöße können zu Verwarnungen, Stummschaltung oder Bann führen.' },
    welcome: { name: 'Willkommensinfo', desc: 'Informationen für neue Mitglieder', title: 'Willkommen auf dem Server!',
      body: 'Hier ist alles, was du zum Starten brauchst.',
      fields: [
        { name: 'Verifizierung', value: 'Gehe zum Verifizierungskanal.' },
        { name: 'Rollen', value: 'Wähle deine Rollen im Rollenkanal.' },
        { name: 'Viel Spaß', value: 'Erkunde die Kanäle und genieße deinen Aufenthalt!' },
      ] },
    announcement: { name: 'Ankündigung', desc: 'Allgemeine Ankündigungsvorlage', title: 'Ankündigung',
      body: 'Dein Ankündigungstext hier.', footer: 'Vom Admin-Team veröffentlicht' },
    streamLive: { name: 'Stream-Ankündigung (Live)', desc: 'Vorlage für Live-Stream-Ankündigungen',
      title: '🔴 {user} ist LIVE!', body: '**{user}** ist jetzt live! Komm vorbei und unterstütze!',
      fields: [{ name: 'Plattform-Status', value: '🟢 **{platform}** — LIVE' }],
      footer: 'Klicke auf Watch Now!' },
    streamEnded: { name: 'Stream Beendet', desc: 'Vorlage für beendete Streams',
      title: '⚫ {user}', body: 'Der Stream ist beendet. Danke fürs Zuschauen!' },
    blank: { name: 'Leeres Embed', desc: 'Von Grund auf neu' },
  },
  es: {
    rules: { name: 'Reglas del Servidor', desc: 'Mensaje de reglas con campos numerados', title: 'Reglas del Servidor',
      body: 'Por favor lee y sigue estas reglas para mantener nuestra comunidad segura.',
      fields: [
        { name: '1. Sé Respetuoso', value: 'Trata a todos con respeto. Sin acoso, discurso de odio o discriminación.' },
        { name: '2. Sin Spam', value: 'No envíes mensajes, imágenes o enlaces repetitivos.' },
        { name: '3. Sin NSFW', value: 'Todo el contenido debe ser apropiado y seguro.' },
      ],
      footer: 'Romper las reglas puede resultar en advertencias, silencios o baneos.' },
    welcome: { name: 'Info de Bienvenida', desc: 'Información para nuevos miembros', title: '¡Bienvenido al Servidor!',
      body: 'Aquí tienes todo lo que necesitas para empezar.',
      fields: [
        { name: 'Verificar', value: 'Ve al canal de verificación para obtener acceso.' },
        { name: 'Roles', value: 'Elige tus roles en el canal de roles.' },
        { name: 'Diviértete', value: '¡Explora los canales y disfruta tu estancia!' },
      ] },
    announcement: { name: 'Anuncio', desc: 'Plantilla de anuncio general', title: 'Anuncio',
      body: 'Tu texto de anuncio aquí.', footer: 'Publicado por el equipo de administración' },
    streamLive: { name: 'Anuncio de Stream (En Vivo)', desc: 'Plantilla para streams en vivo',
      title: '🔴 ¡{user} está EN VIVO!', body: '¡**{user}** está en vivo ahora! Ven a ver y apoyar!',
      fields: [{ name: 'Estado de Plataforma', value: '🟢 **{platform}** — EN VIVO' }],
      footer: '¡Haz clic en Watch Now para unirte!' },
    streamEnded: { name: 'Stream Terminado', desc: 'Plantilla para cuando termina un stream',
      title: '⚫ {user}', body: 'El stream ha terminado. ¡Gracias por ver!' },
    blank: { name: 'Embed Vacío', desc: 'Empezar desde cero' },
  },
  fr: {
    rules: { name: 'Règles du Serveur', desc: 'Message de règles avec champs numérotés', title: 'Règles du Serveur',
      body: 'Veuillez lire et suivre ces règles pour garder notre communauté sûre.',
      fields: [
        { name: '1. Soyez Respectueux', value: 'Traitez tout le monde avec respect. Pas de harcèlement ni discrimination.' },
        { name: '2. Pas de Spam', value: 'Ne spammez pas de messages, images ou liens.' },
        { name: '3. Pas de NSFW', value: 'Tout le contenu doit être approprié.' },
      ],
      footer: 'Enfreindre les règles peut entraîner des avertissements, des mutes ou des bans.' },
    welcome: { name: 'Info Bienvenue', desc: 'Informations pour les nouveaux membres', title: 'Bienvenue sur le Serveur !',
      body: 'Voici tout ce dont vous avez besoin pour commencer.',
      fields: [
        { name: 'Vérification', value: 'Rendez-vous dans le canal de vérification.' },
        { name: 'Rôles', value: 'Choisissez vos rôles dans le canal des rôles.' },
        { name: 'Amusez-vous', value: 'Explorez les canaux et profitez de votre séjour !' },
      ] },
    announcement: { name: 'Annonce', desc: 'Modèle d\'annonce générale', title: 'Annonce',
      body: 'Votre texte d\'annonce ici.', footer: 'Publié par l\'équipe d\'administration' },
    streamLive: { name: 'Annonce de Stream (En Direct)', desc: 'Modèle pour les streams en direct',
      title: '🔴 {user} est EN DIRECT !', body: '**{user}** est en direct maintenant ! Venez regarder et soutenir !',
      fields: [{ name: 'Statut Plateforme', value: '🟢 **{platform}** — EN DIRECT' }],
      footer: 'Cliquez sur Watch Now pour rejoindre !' },
    streamEnded: { name: 'Stream Terminé', desc: 'Modèle pour la fin d\'un stream',
      title: '⚫ {user}', body: 'Le stream est terminé. Merci d\'avoir regardé !' },
    blank: { name: 'Embed Vide', desc: 'Commencer de zéro' },
  },
  pt: {
    rules: { name: 'Regras do Servidor', desc: 'Mensagem de regras com campos numerados', title: 'Regras do Servidor',
      body: 'Por favor leia e siga estas regras para manter nossa comunidade segura.',
      fields: [
        { name: '1. Seja Respeitoso', value: 'Trate todos com respeito. Sem assédio ou discriminação.' },
        { name: '2. Sem Spam', value: 'Não envie mensagens, imagens ou links repetitivos.' },
        { name: '3. Sem NSFW', value: 'Todo conteúdo deve ser apropriado.' },
      ],
      footer: 'Quebrar regras pode resultar em avisos, silenciamentos ou banimentos.' },
    welcome: { name: 'Info de Boas-Vindas', desc: 'Informações para novos membros', title: 'Bem-vindo ao Servidor!',
      body: 'Aqui está tudo o que você precisa para começar.',
      fields: [
        { name: 'Verificar', value: 'Vá ao canal de verificação para obter acesso.' },
        { name: 'Funções', value: 'Escolha suas funções no canal de funções.' },
        { name: 'Divirta-se', value: 'Explore os canais e aproveite!' },
      ] },
    announcement: { name: 'Anúncio', desc: 'Modelo de anúncio geral', title: 'Anúncio',
      body: 'Seu texto de anúncio aqui.', footer: 'Publicado pela equipe de administração' },
    streamLive: { name: 'Anúncio de Stream (Ao Vivo)', desc: 'Modelo para streams ao vivo',
      title: '🔴 {user} está AO VIVO!', body: '**{user}** está ao vivo agora! Venha assistir e apoiar!',
      fields: [{ name: 'Status da Plataforma', value: '🟢 **{platform}** — AO VIVO' }],
      footer: 'Clique em Watch Now para participar!' },
    streamEnded: { name: 'Stream Encerrado', desc: 'Modelo para quando o stream termina',
      title: '⚫ {user}', body: 'O stream terminou. Obrigado por assistir!' },
    blank: { name: 'Embed Vazio', desc: 'Começar do zero' },
  },
  ru: {
    rules: { name: 'Правила Сервера', desc: 'Сообщение с правилами', title: 'Правила Сервера',
      body: 'Пожалуйста, прочитайте и соблюдайте эти правила.',
      fields: [
        { name: '1. Уважение', value: 'Относитесь ко всем с уважением. Без оскорблений и дискриминации.' },
        { name: '2. Без спама', value: 'Не отправляйте повторяющиеся сообщения или ссылки.' },
        { name: '3. Без NSFW', value: 'Весь контент должен быть уместным.' },
      ],
      footer: 'Нарушение правил может привести к предупреждению, муту или бану.' },
    welcome: { name: 'Приветствие', desc: 'Информация для новых участников', title: 'Добро пожаловать на сервер!',
      body: 'Вот всё, что нужно для начала.',
      fields: [
        { name: 'Верификация', value: 'Перейдите в канал верификации для получения доступа.' },
        { name: 'Роли', value: 'Выберите свои роли в канале ролей.' },
        { name: 'Приятного времени', value: 'Исследуйте каналы и наслаждайтесь!' },
      ] },
    announcement: { name: 'Объявление', desc: 'Шаблон общего объявления', title: 'Объявление',
      body: 'Текст вашего объявления здесь.', footer: 'Опубликовано командой администрации' },
    streamLive: { name: 'Анонс Стрима (Прямой Эфир)', desc: 'Шаблон для прямых трансляций',
      title: '🔴 {user} В ЭФИРЕ!', body: '**{user}** сейчас в прямом эфире! Приходите смотреть!',
      fields: [{ name: 'Статус Платформы', value: '🟢 **{platform}** — LIVE' }],
      footer: 'Нажмите Watch Now!' },
    streamEnded: { name: 'Стрим Окончен', desc: 'Шаблон для окончания стрима',
      title: '⚫ {user}', body: 'Стрим окончен. Спасибо за просмотр!' },
    blank: { name: 'Пустой Embed', desc: 'Начать с нуля' },
  },
  ar: {
    rules: { name: 'قوانين السيرفر', desc: 'رسالة القوانين', title: 'قوانين السيرفر',
      body: 'يرجى قراءة واتباع هذه القوانين للحفاظ على مجتمعنا آمنًا.',
      fields: [
        { name: '1. كن محترمًا', value: 'عامل الجميع باحترام. لا تحرش أو تمييز.' },
        { name: '2. بدون سبام', value: 'لا ترسل رسائل أو صور أو روابط متكررة.' },
        { name: '3. بدون محتوى غير لائق', value: 'يجب أن يكون كل المحتوى مناسبًا.' },
      ],
      footer: 'مخالفة القوانين قد تؤدي إلى تحذيرات أو كتم أو حظر.' },
    welcome: { name: 'معلومات الترحيب', desc: 'معلومات للأعضاء الجدد', title: 'مرحبًا بك في السيرفر!',
      body: 'إليك كل ما تحتاج لمعرفته للبدء.',
      fields: [
        { name: 'التحقق', value: 'توجه إلى قناة التحقق للحصول على الوصول.' },
        { name: 'الأدوار', value: 'اختر أدوارك في قناة الأدوار.' },
        { name: 'استمتع', value: 'استكشف القنوات واستمتع بوقتك!' },
      ] },
    announcement: { name: 'إعلان', desc: 'قالب إعلان عام', title: 'إعلان',
      body: 'نص إعلانك هنا.', footer: 'نشر بواسطة فريق الإدارة' },
    streamLive: { name: 'إعلان بث (مباشر)', desc: 'قالب للبث المباشر',
      title: '🔴 {user} مباشر الآن!', body: '**{user}** يبث مباشرة الآن! تعال شاهد وادعم!',
      fields: [{ name: 'حالة المنصة', value: '🟢 **{platform}** — مباشر' }],
      footer: 'انقر Watch Now للانضمام!' },
    streamEnded: { name: 'انتهى البث', desc: 'قالب لانتهاء البث',
      title: '⚫ {user}', body: 'انتهى البث. شكرًا للمشاهدة!' },
    blank: { name: 'Embed فارغ', desc: 'ابدأ من الصفر' },
  },
};

function getTemplates(guildId) {
  const locale = guildId ? getLocale(guildId) : (process.env.LOCALE || 'en');
  const strings = TEMPLATE_I18N[locale] || TEMPLATE_I18N.en;
  const en = TEMPLATE_I18N.en; // fallback

  const s = (key) => strings[key] || en[key];

  return [
    { id: 'rules', name: s('rules').name, description: s('rules').desc, messageType: 'rules',
      content: { title: s('rules').title, description: s('rules').body, color: '#5865f2',
        fields: (s('rules').fields || []).map(f => ({ ...f, inline: false })),
        footer: s('rules').footer || '' } },
    { id: 'welcome-info', name: s('welcome').name, description: s('welcome').desc, messageType: 'info',
      content: { title: s('welcome').title, description: s('welcome').body, color: '#22c55e',
        fields: (s('welcome').fields || []).map(f => ({ ...f, inline: false })) } },
    { id: 'announcement', name: s('announcement').name, description: s('announcement').desc, messageType: 'announcement',
      content: { title: s('announcement').title, description: s('announcement').body, color: '#f59e0b',
        footer: s('announcement').footer || '' } },
    { id: 'stream-live', name: s('streamLive').name, description: s('streamLive').desc, messageType: 'stream-announcement',
      content: { title: s('streamLive').title, description: s('streamLive').body, color: '#ff0000',
        footer: s('streamLive').footer || '' } },
    { id: 'stream-ended', name: s('streamEnded').name, description: s('streamEnded').desc, messageType: 'stream-announcement',
      content: { title: s('streamEnded').title, description: s('streamEnded').body, color: '#808080' } },
    { id: 'blank', name: s('blank').name, description: s('blank').desc, messageType: 'custom',
      content: { title: '', description: '', color: '#5865f2', fields: [] } },
  ];
}

// ── CRUD ─────────────────────────────────────────────────────────────────

function getMessagesForGuild(guildId, { type, channelId } = {}) {
  let sql = 'SELECT * FROM bot_messages WHERE guild_id = ?';
  const params = [guildId];

  if (type) {
    if (type === 'system') {
      sql += ' AND is_system = 1 AND message_type != ?';
      params.push('bot-action');
    } else if (type === 'bot-action') {
      sql += ' AND message_type = ?';
      params.push('bot-action');
    } else {
      sql += ' AND message_type = ? AND is_system = 0';
      params.push(type);
    }
  }

  if (channelId) {
    sql += ' AND channel_id = ?';
    params.push(channelId);
  }

  sql += ' ORDER BY updated_at DESC';
  return db.all(sql, params);
}

function getMessage(id) {
  return db.get('SELECT * FROM bot_messages WHERE id = ?', [id]);
}

function createMessage(guildId, { name, messageType, content, channelId, createdBy }) {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content || {});

  db.run(`
    INSERT INTO bot_messages (guild_id, channel_id, message_type, name, content, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, channelId || null, messageType || 'custom', name, contentStr, createdBy || null]);

  const row = db.get('SELECT last_insert_rowid() as id');
  return row.id;
}

function updateMessage(id, { name, messageType, content }) {
  const sets = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (name != null) { sets.push('name = ?'); params.push(name); }
  if (messageType != null) { sets.push('message_type = ?'); params.push(messageType); }
  if (content != null) {
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
    sets.push('content = ?');
    params.push(contentStr);
  }

  params.push(id);
  db.run(`UPDATE bot_messages SET ${sets.join(', ')} WHERE id = ?`, params);
}

function deleteMessageRecord(id) {
  db.run('DELETE FROM bot_messages WHERE id = ?', [id]);
}

// ── Build embed payload ──────────────────────────────────────────────────

function buildMessagePayload(record) {
  const content = typeof record.content === 'string' ? JSON.parse(record.content) : record.content;

  const embed = new EmbedBuilder();

  // Color: accept hex string or named color
  if (content.color && content.color.startsWith('#')) {
    embed.setColor(parseInt(content.color.replace('#', ''), 16));
  } else {
    embed.setColor(0x5865f2); // default blurple
  }

  if (content.title) embed.setTitle(content.title);
  if (content.description) embed.setDescription(content.description);
  if (content.footer) embed.setFooter({ text: content.footer });
  if (content.thumbnail) embed.setThumbnail(content.thumbnail);
  if (content.image) embed.setImage(content.image);
  if (content.timestamp) embed.setTimestamp();

  if (Array.isArray(content.fields)) {
    for (const field of content.fields) {
      if (field.name && field.value) {
        embed.addFields({ name: field.name, value: String(field.value), inline: !!field.inline });
      }
    }
  }

  return { embeds: [embed], components: [] };
}

// ── Discord operations ───────────────────────────────────────────────────

/**
 * Publish a message to a Discord channel.
 * If the message is already published in the same channel, edits it.
 */
async function publishMessage(client, id, channelId) {
  const record = getMessage(id);
  if (!record) throw new Error('Message not found');

  const guild = client.guilds.cache.get(record.guild_id);
  if (!guild) throw new Error('Guild not found');

  const channel = await guild.channels.fetch(channelId);
  if (!channel) throw new Error('Channel not found');

  const payload = buildMessagePayload(record);

  // If already published in this channel, edit it
  if (record.message_id && record.channel_id === channelId) {
    try {
      const msg = await channel.messages.fetch(record.message_id);
      await msg.edit(payload);
      return msg;
    } catch {
      // Message was deleted — send new
    }
  }

  // If published in a different channel, delete old first
  if (record.message_id && record.channel_id && record.channel_id !== channelId) {
    try {
      const oldChannel = await guild.channels.fetch(record.channel_id);
      const oldMsg = await oldChannel.messages.fetch(record.message_id);
      await oldMsg.delete();
    } catch {
      // Old message already gone
    }
  }

  const msg = await channel.send(payload);

  db.run(
    'UPDATE bot_messages SET message_id = ?, channel_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [msg.id, channelId, id]
  );

  return msg;
}

/**
 * Update the published Discord message with current DB content.
 */
async function updatePublishedMessage(client, id) {
  const record = getMessage(id);
  if (!record || !record.message_id || !record.channel_id) return;

  const guild = client.guilds.cache.get(record.guild_id);
  if (!guild) return;

  try {
    const channel = await guild.channels.fetch(record.channel_id);
    const msg = await channel.messages.fetch(record.message_id);
    const payload = buildMessagePayload(record);
    await msg.edit(payload);
  } catch (err) {
    console.warn(`Could not update bot message ${record.message_id}: ${err.message}`);
    // Clear stale reference
    db.run('UPDATE bot_messages SET message_id = NULL WHERE id = ?', [id]);
  }
}

/**
 * Delete the Discord message but keep the DB record as a draft.
 */
async function unpublishMessage(client, id) {
  const record = getMessage(id);
  if (!record || !record.message_id) return;

  const guild = client.guilds.cache.get(record.guild_id);
  if (guild) {
    try {
      const channel = await guild.channels.fetch(record.channel_id);
      const msg = await channel.messages.fetch(record.message_id);
      await msg.delete();
    } catch {
      // Already gone
    }
  }

  db.run('UPDATE bot_messages SET message_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

/**
 * Delete the DB record and optionally the Discord message.
 */
async function deleteMessage(client, id) {
  const record = getMessage(id);
  if (!record) return;

  // Delete Discord message if published
  if (record.message_id && client) {
    const guild = client.guilds.cache.get(record.guild_id);
    if (guild) {
      try {
        const channel = await guild.channels.fetch(record.channel_id);
        const msg = await channel.messages.fetch(record.message_id);
        await msg.delete();
      } catch {
        // Already gone
      }
    }
  }

  deleteMessageRecord(id);
}

// ── Detection helpers ────────────────────────────────────────────────────

// Channel name patterns that indicate log/action channels (skip entirely)
const LOG_CHANNEL_PATTERNS = [
  /log$/i, /-log$/i, /logs$/i, /kayit/i, /kayıt/i,
  /punishment/i, /ceza/i, /mod-/i, /admin-/i,
  /bot-komut/i, /bot-command/i,
];

// Embed field names that indicate bot action/log messages
const ACTION_FIELD_NAMES = [
  'user', 'kullanıcı', 'moderator', 'action', 'eylem', 'işlem',
  'reason', 'sebep', 'neden', 'duration', 'süre',
  'channel', 'kanal', 'role', 'rol',
  'old role', 'new role', 'removed role', 'added role',
  'eski rol', 'yeni rol',
];

// Embed titles that are transient agent/system messages (skip)
const SKIP_TITLE_PATTERNS = [
  // Agent action results (all locales)
  /İşlem Tamamlandı/i, /İşlem Başarısız/i, /Onay Gerekli/i,
  /Action Completed/i, /Action Failed/i, /Confirmation Required/i,
  // Automod warnings
  /Auto.?mod/i, /Uyarı/i,
];


/**
 * Detect if a message is a bot action/log message (not user-managed content).
 */
function isBotActionMessage(channel, embed) {
  // Check channel name
  if (LOG_CHANNEL_PATTERNS.some(p => p.test(channel.name))) return true;

  // Check embed fields — if it has typical log fields, it's an action message
  const fieldNames = (embed.fields || []).map(f => f.name.toLowerCase());
  const matchCount = fieldNames.filter(fn =>
    ACTION_FIELD_NAMES.some(pattern => fn.includes(pattern))
  ).length;

  // If 2+ fields match action patterns, it's likely a log message
  if (matchCount >= 2) return true;

  // Check if embed has timestamp (common in log messages) + action-like fields
  if (embed.timestamp && matchCount >= 1) return true;

  return false;
}

// ── Scan ─────────────────────────────────────────────────────────────────

const MAX_MESSAGES_PER_CHANNEL = 30;
const MAX_TOTAL_REGISTERED = 100;
const CHANNEL_SCAN_DELAY_MS = 200;

/**
 * Collect all button custom IDs from a Discord message.
 */
function getButtonIds(msg) {
  const ids = [];
  for (const row of (msg.components || [])) {
    for (const comp of (row.components || [])) {
      if (comp.customId) ids.push(comp.customId);
    }
  }
  return ids;
}

/**
 * Scan a channel for untracked bot messages and register them.
 * Skips: log channels, bot-action messages, AI chat replies, agent confirmations.
 * Keeps: polls, giveaways, verification, custom embeds.
 */
async function scanChannel(client, guildId, channelId, remainingBudget, featureMap = {}) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return 0;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== 0) return 0;
  if (!channel.permissionsFor(guild.members.me)?.has('ViewChannel')) return 0;

  // Skip log channels entirely — they only contain transient action messages
  if (LOG_CHANNEL_PATTERNS.some(p => p.test(channel.name))) return 0;

  const botId = client.user.id;
  let registered = 0;

  try {
    const messages = await channel.messages.fetch({ limit: MAX_MESSAGES_PER_CHANNEL });

    for (const [, msg] of messages) {
      if (registered >= remainingBudget) break;

      if (msg.author.id !== botId) continue;
      if (!msg.embeds?.length) continue;

      // Skip if it's a reply to a user message (AI chat responses)
      if (msg.reference?.messageId) continue;

      // Skip slash command responses (leaderboard, rank, help, etc.)
      if (msg.interaction) continue;

      // Skip if already tracked in bot_messages
      const existing = db.get(
        'SELECT id FROM bot_messages WHERE guild_id = ? AND message_id = ?',
        [guildId, msg.id]
      );
      if (existing) continue;

      // Skip role menu messages (managed in Role Menus tab)
      const isRoleMenu = db.get(
        'SELECT id FROM role_menu_messages WHERE guild_id = ? AND message_id = ?',
        [guildId, msg.id]
      );
      if (isRoleMenu) continue;

      const buttonIds = getButtonIds(msg);

      // Skip role menus by button ID
      if (buttonIds.some(id => id.startsWith('role_'))) continue;

      // Skip agent confirmation messages
      if (buttonIds.some(id => id.startsWith('agent_confirm_') || id.startsWith('agent_cancel_'))) continue;

      // Detect type by button IDs
      const isPoll = buttonIds.some(id => id.startsWith('poll_vote_'));
      const isGiveaway = buttonIds.includes('giveaway_enter');
      const isVerification = buttonIds.includes('verify_button');

      const embed = msg.embeds[0];

      // Skip bot-action log messages (even if not in a log channel)
      if (!isPoll && !isGiveaway && !isVerification && isBotActionMessage(channel, embed)) continue;

      // Skip transient agent/system messages by embed title
      const embedTitle = embed.title || '';
      if (SKIP_TITLE_PATTERNS.some(p => p.test(embedTitle))) continue;

      // Skip embeds with no title and no description (empty/minimal bot messages)
      if (!embed.title && !embed.description) continue;

      // Extract embed data
      const content = {
        title: embed.title || '',
        description: embed.description || '',
        color: embed.hexColor || '#5865f2',
        footer: embed.footer?.text || '',
        fields: (embed.fields || []).map(f => ({ name: f.name, value: f.value, inline: f.inline })),
      };
      if (embed.thumbnail?.url) content.thumbnail = embed.thumbnail.url;
      if (embed.image?.url) content.image = embed.image.url;

      // Determine type and system status
      const name = embed.title || `Untitled (#${channel.name})`;
      let messageType = 'custom';
      let isSystem = 0;

      if (isVerification) {
        messageType = 'verification';
        isSystem = 1;
      } else if (isPoll) {
        messageType = 'poll';
        isSystem = 1;
      } else if (isGiveaway) {
        messageType = 'giveaway';
        isSystem = 1;
      } else {
        // Use feature map for channel-based categorization
        const feature = featureMap[channelId];
        if (feature) {
          const featureToType = {
            'stream-announcements': 'stream-announcement',
            'welcome': 'info',
          };
          if (featureToType[feature]) {
            messageType = featureToType[feature];
          }
        }
      }

      db.run(`
        INSERT INTO bot_messages (guild_id, channel_id, message_id, message_type, name, content, is_system)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [guildId, channelId, msg.id, messageType, name, JSON.stringify(content), isSystem]);

      registered++;
    }
  } catch {
    // Can't read channel — skip
  }

  return registered;
}

/**
 * Build a reverse map: channelId → featureId for a guild.
 * Uses DB mappings first, then falls back to locale-aware channel name matching.
 */
function buildChannelFeatureMap(guild) {
  const guildId = guild.id;
  const featureIds = ['stream-announcements', 'welcome', 'verify', 'punishment-log', 'join-leave-log', 'level-up', 'ai-chat', 'starboard', 'admin-agent'];
  const map = {};

  for (const featureId of featureIds) {
    // 1. Check DB mapping
    const mapping = db.get(
      'SELECT channel_id FROM channel_mappings WHERE guild_id = ? AND feature_id = ?',
      [guildId, featureId]
    );
    if (mapping) {
      map[mapping.channel_id] = featureId;
      continue;
    }

    // 2. Try locale name and raw name
    const locName = getLocaleName(featureId, guildId);
    const ch = guild.channels.cache.find(c =>
      c.isTextBased() && (c.name === locName || c.name === featureId)
    );
    if (ch) {
      map[ch.id] = featureId;
    }
  }

  return map;
}

/**
 * Scan all text channels in a guild for untracked bot messages.
 * Throttled: delays between channels, caps total registered messages.
 */
async function scanAllChannels(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return 0;

  // Build channel→feature map once for the whole scan
  const featureMap = buildChannelFeatureMap(guild);

  let total = 0;
  const channels = guild.channels.cache.filter(c => c.type === 0);

  for (const [, channel] of channels) {
    if (total >= MAX_TOTAL_REGISTERED) break;

    const count = await scanChannel(client, guildId, channel.id, MAX_TOTAL_REGISTERED - total, featureMap);
    total += count;

    // Throttle: small delay between channels to avoid rate limits
    if (CHANNEL_SCAN_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, CHANNEL_SCAN_DELAY_MS));
    }
  }

  if (total > 0) {
    console.log(`Scanned and registered ${total} bot message(s) for guild ${guild.name}`);
  }

  return total;
}

module.exports = {
  getTemplates,
  getMessagesForGuild,
  getMessage,
  createMessage,
  updateMessage,
  deleteMessage,
  buildMessagePayload,
  publishMessage,
  updatePublishedMessage,
  unpublishMessage,
  scanChannel,
  scanAllChannels,
};
