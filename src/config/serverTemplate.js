const { ChannelType, PermissionFlagsBits } = require("discord.js");

const roleTemplates = [
  { name: "Основатель", color: 0xf59e0b },
  { name: "Администрация", color: 0xef4444 },
  { name: "Проверяющий задания", color: 0x22c55e },
  { name: "Модератор объявлений", color: 0x3b82f6 },
  { name: "Верифицирован", color: 0x38bdf8 },
  { name: "Разработчик", color: 0x8b5cf6 },
  { name: "Скриптер", color: 0x14b8a6 },
  { name: "Билдер", color: 0xf97316 },
  { name: "UI-дизайнер", color: 0xec4899 },
  { name: "3D-моделлер", color: 0x10b981 },
  { name: "Аниматор", color: 0x6366f1 }
];

const managedTemplates = [
  {
    key: "news",
    baseName: "новости",
    aliases: ["новости", "news"],
    type: ChannelType.GuildText,
    private: false,
    section: "public"
  },
  {
    key: "ads",
    baseName: "объявления",
    aliases: ["объявления", "ads", "announcements"],
    type: ChannelType.GuildText,
    private: false,
    section: "public"
  },
  {
    key: "economy",
    baseName: "работа-и-монеты",
    aliases: ["работа-и-монеты", "монеты", "экономика"],
    type: ChannelType.GuildText,
    private: true,
    section: "system"
  },
  {
    key: "dailyTasks",
    baseName: "ежедневные-задания",
    aliases: ["ежедневные-задания", "задания", "daily-tasks"],
    type: ChannelType.GuildText,
    private: true,
    section: "system"
  },
  {
    key: "taskSubmit",
    baseName: "отправка-заданий",
    aliases: ["отправка-заданий", "сдать-задание", "task-submit"],
    type: ChannelType.GuildText,
    private: true,
    section: "system"
  },
  {
    key: "verification",
    baseName: "верификация",
    aliases: ["верификация", "verification"],
    type: ChannelType.GuildText,
    private: true,
    section: "system"
  },
  {
    key: "instructions",
    baseName: "инструкция-бота",
    aliases: ["инструкция-бота", "инструкция", "bot-guide"],
    type: ChannelType.GuildText,
    private: true,
    section: "system"
  },
  {
    key: "taskReview",
    baseName: "проверка-заданий",
    aliases: ["проверка-заданий", "task-review"],
    type: ChannelType.GuildText,
    private: true,
    section: "staff"
  },
  {
    key: "adReview",
    baseName: "проверка-объявлений",
    aliases: ["проверка-объявлений", "ad-review"],
    type: ChannelType.GuildText,
    private: true,
    section: "staff"
  }
];

const obsoleteManagedTemplates = [
  { baseName: "обновления-бота", aliases: ["обновления-бота"] },
  { baseName: "портфолио", aliases: ["портфолио", "portfolio"] },
  { baseName: "devlog", aliases: ["devlog", "девлог"] }
];

const legacyManagedCategories = [
  "Информация",
  "Экономика",
  "Биржа Ro Create",
  "Штаб модерации"
];

const managedCategoryTemplate = {
  key: "system",
  baseName: "ro-create-система",
  aliases: ["ro-create-система", "ro create система", "система-ro-create", "rocreate-system"]
};

function buildOverwrites(guild, isPrivate, visibleRoleIds = [], extraMemberIds = []) {
  const overwrites = [];

  if (isPrivate) {
    overwrites.push({
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    });
  } else {
    overwrites.push({
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel]
    });
  }

  for (const roleId of visibleRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  for (const memberId of extraMemberIds) {
    overwrites.push({
      id: memberId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  overwrites.push({
    id: guild.members.me.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ReadMessageHistory
    ]
  });

  return overwrites;
}

module.exports = {
  roleTemplates,
  managedTemplates,
  obsoleteManagedTemplates,
  legacyManagedCategories,
  managedCategoryTemplate,
  buildOverwrites
};
