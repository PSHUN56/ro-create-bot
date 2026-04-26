const { ChannelType, PermissionFlagsBits } = require("discord.js");

const roleTemplates = [
  { name: "Основатель", color: 0xf59e0b },
  { name: "Администрация", color: 0xef4444 },
  { name: "Проверяющий задания", color: 0x22c55e },
  { name: "Модератор объявлений", color: 0x3b82f6 },
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
    name: "новости",
    aliases: ["новости", "news"],
    type: ChannelType.GuildText,
    private: false,
    section: "public"
  },
  {
    key: "ads",
    name: "объявления",
    aliases: ["объявления", "announcements", "ads"],
    type: ChannelType.GuildText,
    private: false,
    section: "public"
  },
  {
    key: "economy",
    name: "работа-и-монеты",
    aliases: ["работа-и-монеты", "монеты", "экономика"],
    type: ChannelType.GuildText,
    private: true,
    section: "system"
  },
  {
    key: "dailyTasks",
    name: "ежедневные-задания",
    aliases: ["ежедневные-задания", "задания", "daily-tasks"],
    type: ChannelType.GuildText,
    private: true,
    section: "system"
  },
  {
    key: "taskSubmit",
    name: "отправка-заданий",
    aliases: ["отправка-заданий", "сдать-задание", "task-submit"],
    type: ChannelType.GuildText,
    private: true,
    section: "system"
  },
  {
    key: "portfolio",
    name: "портфолио",
    aliases: ["портфолио", "portfolio"],
    type: ChannelType.GuildText,
    private: true,
    section: "system"
  },
  {
    key: "devlog",
    name: "devlog",
    aliases: ["devlog", "девлог"],
    type: ChannelType.GuildText,
    private: true,
    section: "system"
  },
  {
    key: "taskReview",
    name: "проверка-заданий",
    aliases: ["проверка-заданий", "task-review"],
    type: ChannelType.GuildText,
    private: true,
    section: "staff"
  },
  {
    key: "adReview",
    name: "проверка-объявлений",
    aliases: ["проверка-объявлений", "ad-review"],
    type: ChannelType.GuildText,
    private: true,
    section: "staff"
  }
];

const managedCategoryTemplate = {
  key: "system",
  name: "Ro Create | Система",
  aliases: ["Ro Create | Система", "RoCreate | Система", "Система Ro Create"]
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
  managedCategoryTemplate,
  buildOverwrites
};
