const { ChannelType, PermissionFlagsBits } = require("discord.js");

const ROLE_NAMES = {
  founder: "Основатель Ro Create",
  admin: "Администрация Ro Create",
  taskReviewer: "Проверка заданий",
  adReviewer: "Модерация объявлений",
  verified: "Верифицирован"
};

const roleTemplates = [
  { name: ROLE_NAMES.founder, color: 0xf59e0b },
  { name: ROLE_NAMES.admin, color: 0xef4444 },
  { name: ROLE_NAMES.taskReviewer, color: 0x22c55e },
  { name: ROLE_NAMES.adReviewer, color: 0x3b82f6 },
  { name: ROLE_NAMES.verified, color: 0xa855f7 }
];

const managedCategories = [
  {
    key: "info",
    name: "📌 │ информация",
    aliases: ["📌 │ информация", "информация", "ro create info"]
  },
  {
    key: "tasks",
    name: "🎯 │ задания",
    aliases: ["🎯 │ задания", "задания", "ro create tasks"]
  },
  {
    key: "market",
    name: "📢 │ объявления",
    aliases: ["📢 │ объявления", "объявления", "биржа ro create"]
  },
  {
    key: "staff",
    name: "🛡️ │ staff",
    aliases: ["🛡️ │ staff", "staff", "система", "ro create system"]
  }
];

const managedTemplates = [
  {
    key: "news",
    name: "📣 │ новости",
    aliases: ["📣 │ новости", "новости", "объявления"],
    category: "info",
    type: ChannelType.GuildText,
    visibility: "private",
    memberCanSend: false
  },
  {
    key: "verification",
    name: "✅ │ верификация",
    aliases: ["✅ │ верификация", "верификация"],
    category: "info",
    type: ChannelType.GuildText,
    visibility: "private",
    memberCanSend: false
  },
  {
    key: "tasks",
    name: "📋 │ задания",
    aliases: ["📋 │ задания", "ежедневные-задания", "задания"],
    category: "tasks",
    type: ChannelType.GuildText,
    visibility: "private",
    memberCanSend: false
  },
  {
    key: "taskSubmit",
    name: "📩 │ отправить-задание",
    aliases: ["📩 │ отправить-задание", "отправить-задание"],
    category: "tasks",
    type: ChannelType.GuildText,
    visibility: "private",
    memberCanSend: false,
    allowThreadMessages: true,
    allowPrivateThreads: true
  },
  {
    key: "ads",
    name: "📌 │ объявления",
    aliases: ["📌 │ объявления", "объявления"],
    category: "market",
    type: ChannelType.GuildText,
    visibility: "private",
    memberCanSend: false
  },
  {
    key: "taskReview",
    name: "🧪 │ проверка-заданий",
    aliases: ["🧪 │ проверка-заданий", "проверка-заданий"],
    category: "staff",
    type: ChannelType.GuildText,
    visibility: "staff",
    memberCanSend: true
  },
  {
    key: "adReview",
    name: "🧾 │ проверка-объявлений",
    aliases: ["🧾 │ проверка-объявлений", "проверка-объявлений"],
    category: "staff",
    type: ChannelType.GuildText,
    visibility: "staff",
    memberCanSend: true
  }
];

function buildOverwrites({
  guild,
  ownerId,
  verifiedRoleId,
  staffRoleIds,
  visibility,
  memberCanSend = true,
  allowThreadMessages = false,
  allowPrivateThreads = false
}) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
        PermissionFlagsBits.SendMessagesInThreads
      ]
    },
    {
      id: ownerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageThreads,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.CreatePrivateThreads,
        PermissionFlagsBits.SendMessagesInThreads
      ]
    }
  ];

  if (verifiedRoleId && visibility === "verified") {
    overwrites.push({
      id: verifiedRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
        .concat(memberCanSend ? [PermissionFlagsBits.SendMessages] : [])
        .concat(allowThreadMessages ? [PermissionFlagsBits.SendMessagesInThreads] : [])
        .concat(allowPrivateThreads ? [PermissionFlagsBits.CreatePrivateThreads] : []),
      deny: [
        ...(memberCanSend ? [] : [PermissionFlagsBits.SendMessages]),
        ...(allowThreadMessages ? [] : [PermissionFlagsBits.SendMessagesInThreads]),
        ...(allowPrivateThreads ? [] : [PermissionFlagsBits.CreatePrivateThreads])
      ]
    });
  }

  for (const roleId of staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.SendMessagesInThreads
      ]
    });
  }

  return overwrites;
}

module.exports = {
  ROLE_NAMES,
  roleTemplates,
  managedCategories,
  managedTemplates,
  buildOverwrites
};
