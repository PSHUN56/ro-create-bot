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

const categoryTemplates = [
  {
    key: "publicInfo",
    name: "Информация",
    private: false,
    channels: [
      { key: "news", name: "новости", type: ChannelType.GuildText, private: false },
      { key: "updates", name: "обновления-бота", type: ChannelType.GuildText, private: true }
    ]
  },
  {
    key: "economy",
    name: "Экономика",
    private: true,
    channels: [
      { key: "economy", name: "работа-и-монеты", type: ChannelType.GuildText, private: true },
      { key: "dailyTasks", name: "ежедневные-задания", type: ChannelType.GuildText, private: true },
      { key: "taskSubmit", name: "отправка-заданий", type: ChannelType.GuildText, private: true }
    ]
  },
  {
    key: "market",
    name: "Биржа Ro Create",
    private: true,
    channels: [
      { key: "ads", name: "объявления", type: ChannelType.GuildText, private: true },
      { key: "portfolio", name: "портфолио", type: ChannelType.GuildText, private: true },
      { key: "devlog", name: "devlog", type: ChannelType.GuildText, private: true }
    ]
  },
  {
    key: "staff",
    name: "Штаб модерации",
    private: true,
    channels: [
      { key: "taskReview", name: "проверка-заданий", type: ChannelType.GuildText, private: true },
      { key: "adReview", name: "проверка-объявлений", type: ChannelType.GuildText, private: true }
    ]
  }
];

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
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory]
  });

  return overwrites;
}

module.exports = {
  roleTemplates,
  categoryTemplates,
  buildOverwrites
};
