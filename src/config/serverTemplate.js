const { ChannelType, PermissionFlagsBits } = require("discord.js");

const roleTemplates = [
  { name: "Основатель", color: 0xf59e0b },
  { name: "Администрация", color: 0xef4444 },
  { name: "Проверяющий задания", color: 0x22c55e },
  { name: "Модератор объявлений", color: 0x3b82f6 },
  { name: "Верифицирован", color: 0x38bdf8 }
];

const managedTemplates = [
  {
    key: "news",
    baseName: "новости",
    aliases: ["новости", "news"],
    type: ChannelType.GuildText,
    visibility: "public"
  },
  {
    key: "verification",
    baseName: "верификация",
    aliases: ["верификация", "verification", "verify"],
    type: ChannelType.GuildText,
    visibility: "public"
  },
  {
    key: "ads",
    baseName: "объявления",
    aliases: ["объявления", "ads", "announcements"],
    type: ChannelType.GuildText,
    visibility: "verified"
  },
  {
    key: "tasks",
    baseName: "задания",
    aliases: ["задания", "ежедневные-задания", "tasks"],
    type: ChannelType.GuildText,
    visibility: "verified"
  },
  {
    key: "taskSubmit",
    baseName: "отправка-заданий",
    aliases: ["отправка-заданий", "сдать-задание", "task-submit"],
    type: ChannelType.GuildText,
    visibility: "verified"
  },
  {
    key: "taskReview",
    baseName: "проверка-заданий",
    aliases: ["проверка-заданий", "task-review"],
    type: ChannelType.GuildText,
    visibility: "staff"
  },
  {
    key: "adReview",
    baseName: "проверка-объявлений",
    aliases: ["проверка-объявлений", "ad-review"],
    type: ChannelType.GuildText,
    visibility: "staff"
  }
];

const obsoleteManagedTemplates = [
  { aliases: ["обновления-бота"] },
  { aliases: ["портфолио", "portfolio"] },
  { aliases: ["devlog", "девлог"] },
  { aliases: ["работа-и-монеты", "монеты", "экономика"] },
  { aliases: ["инструкция-бота", "инструкция", "bot-guide"] }
];

const legacyManagedCategories = [
  "Информация",
  "Экономика",
  "Биржа Ro Create",
  "Штаб модерации",
  "Ro Create | Система"
];

const managedCategoryTemplate = {
  baseName: "ro-create │ система",
  aliases: ["ro-create │ система", "ro-create-система", "ro create система", "система-ro-create"]
};

function buildOverwrites({
  guild,
  visibility,
  verifiedRoleId,
  staffRoleIds = [],
  ownerId,
  botCanManageRoles = false
}) {
  const overwrites = [];

  if (visibility === "public") {
    overwrites.push({
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
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
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  for (const roleId of staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
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
      PermissionFlagsBits.ManageChannels,
      ...(botCanManageRoles ? [PermissionFlagsBits.ManageRoles] : [])
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
