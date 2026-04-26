const { ChannelType, PermissionFlagsBits } = require("discord.js");

const ROLE_NAMES = {
  founder: "Основатель",
  admin: "Администрация",
  taskReviewer: "Проверяющий задания",
  adReviewer: "Модератор объявлений",
  verified: "Верифицирован"
};

const roleTemplates = [
  { name: ROLE_NAMES.founder, color: 0xf59e0b },
  { name: ROLE_NAMES.admin, color: 0xef4444 },
  { name: ROLE_NAMES.taskReviewer, color: 0x22c55e },
  { name: ROLE_NAMES.adReviewer, color: 0x3b82f6 },
  { name: ROLE_NAMES.verified, color: 0x38bdf8 }
];

const managedTemplates = [
  {
    key: "news",
    baseName: "новости",
    aliases: ["новости", "news"],
    type: ChannelType.GuildText,
    visibility: "public",
    placement: "publicHub",
    icon: "📢",
    memberCanSend: false,
    publicCanSend: false
  },
  {
    key: "verification",
    baseName: "верификация",
    aliases: ["верификация", "verification", "verify"],
    type: ChannelType.GuildText,
    visibility: "public",
    placement: "publicHub",
    icon: "✅",
    memberCanSend: false,
    publicCanSend: false
  },
  {
    key: "ads",
    baseName: "объявления",
    aliases: ["объявления", "ads", "announcements"],
    type: ChannelType.GuildText,
    visibility: "verified",
    placement: "marketHub",
    icon: "📢",
    memberCanSend: false
  },
  {
    key: "tasks",
    baseName: "ежедневные-задания",
    aliases: ["ежедневные-задания", "задания", "tasks"],
    type: ChannelType.GuildText,
    visibility: "verified",
    placement: "taskHub",
    icon: "🎯",
    memberCanSend: false
  },
  {
    key: "taskSubmit",
    baseName: "отправить-задание",
    aliases: ["отправить-задание", "сдать-задание", "task-submit"],
    type: ChannelType.GuildText,
    visibility: "verified",
    placement: "taskHub",
    icon: "📩",
    memberCanSend: false
  },
  {
    key: "taskReview",
    baseName: "проверка-заданий",
    aliases: ["проверка-заданий", "task-review"],
    type: ChannelType.GuildText,
    visibility: "staff",
    placement: "staffHub",
    icon: "🛡️",
    memberCanSend: true
  },
  {
    key: "adReview",
    baseName: "проверка-объявлений",
    aliases: ["проверка-объявлений", "ad-review"],
    type: ChannelType.GuildText,
    visibility: "staff",
    placement: "staffHub",
    icon: "🛡️",
    memberCanSend: true
  }
];

const obsoleteManagedTemplates = [
  { aliases: ["обновления-бота"] },
  { aliases: ["портфолио", "portfolio"] },
  { aliases: ["devlog", "девлог"] },
  { aliases: ["работа-и-монеты", "монеты", "экономика"] },
  { aliases: ["инструкция-бота", "инструкция", "bot-guide"] },
  { aliases: ["ro-create-система", "система-ro-create"] }
];

const legacyManagedCategories = [
  "Ro Create | Система",
  "🤖 │ система",
  "Информация",
  "Экономика",
  "Штаб модерации"
];

const managedCategoryTemplate = {
  publicHub: {
    baseName: "основное",
    aliases: ["основное", "информация", "information"],
    icon: "📌"
  },
  marketHub: {
    baseName: "биржа",
    aliases: ["биржа", "биржа ro create", "market", "поиски"],
    icon: "📢"
  },
  taskHub: {
    baseName: "задания",
    aliases: ["задания", "обучение", "tasks"],
    icon: "🎯"
  },
  staffHub: {
    baseName: "модерация",
    aliases: ["модерация", "moderator-only", "staff", "штаб"],
    icon: "🛡️"
  }
};

function buildOverwrites({
  guild,
  visibility,
  verifiedRoleId,
  staffRoleIds = [],
  ownerId,
  botCanManageRoles = false,
  memberCanSend = true,
  publicCanSend = false
}) {
  const overwrites = [];

  if (visibility === "public") {
    overwrites.push({
      id: guild.roles.everyone.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        ...(publicCanSend ? [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] : [])
      ]
    });
  } else {
    overwrites.push({
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    });
  }

  if (visibility === "verified" && verifiedRoleId) {
    overwrites.push({
      id: verifiedRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        ...(memberCanSend
          ? [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
          : [])
      ]
    });
  }

  for (const roleId of staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }

  if (ownerId) {
    overwrites.push({
      id: ownerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels
      ]
    });
  }

  overwrites.push({
    id: guild.members.me.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ManageChannels,
      ...(botCanManageRoles ? [PermissionFlagsBits.ManageRoles] : [])
    ]
  });

  return overwrites;
}

module.exports = {
  ROLE_NAMES,
  roleTemplates,
  managedTemplates,
  obsoleteManagedTemplates,
  legacyManagedCategories,
  managedCategoryTemplate,
  buildOverwrites
};
