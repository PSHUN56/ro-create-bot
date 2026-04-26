const { ChannelType, PermissionFlagsBits } = require("discord.js");

const ROLE_NAMES = {
  founder: "Создатель",
  admin: "Администрация Ro Create",
  taskReviewer: "Проверка заданий",
  adReviewer: "Модерация объявлений",
  verified: "Верифицирован"
};

const roleTemplates = [
  { key: "founder", name: ROLE_NAMES.founder, color: 0xf59e0b },
  { key: "admin", name: ROLE_NAMES.admin, color: 0xef4444 },
  { key: "taskReviewer", name: ROLE_NAMES.taskReviewer, color: 0x22c55e },
  { key: "adReviewer", name: ROLE_NAMES.adReviewer, color: 0x3b82f6 },
  { key: "verified", name: ROLE_NAMES.verified, color: 0xa855f7 }
];

const managedCategories = [
  {
    key: "welcome",
    name: "✨・rocreate старт",
    aliases: ["rocreate старт", "старт", "основное", "информация"]
  },
  {
    key: "tasks",
    name: "🎯・rocreate задания",
    aliases: ["rocreate задания", "задания"]
  },
  {
    key: "market",
    name: "💼・rocreate биржа",
    aliases: ["rocreate биржа", "биржа", "объявления"]
  },
  {
    key: "staff",
    name: "🛡️・rocreate staff",
    aliases: ["rocreate staff", "staff"]
  }
];

const managedTemplates = [
  {
    key: "news",
    name: "📣・новости",
    aliases: ["новости", "📣│новости", "📣 | новости", "объявления"],
    category: "welcome",
    type: ChannelType.GuildText,
    visibility: "public",
    memberCanSend: false
  },
  {
    key: "verification",
    name: "✅・верификация",
    aliases: ["верификация", "✅│верификация", "✅ | верификация"],
    category: "welcome",
    type: ChannelType.GuildText,
    visibility: "public",
    memberCanSend: false
  },
  {
    key: "tasks",
    name: "📋・активное-задание",
    aliases: ["активное-задание", "задачи", "📋│активное-задание"],
    category: "tasks",
    type: ChannelType.GuildText,
    visibility: "verified",
    memberCanSend: false
  },
  {
    key: "taskSubmit",
    name: "📩・сдать-задание",
    aliases: ["сдать-задание", "отправить-задание", "📩│сдать-задание", "📩│отправить-задание"],
    category: "tasks",
    type: ChannelType.GuildText,
    visibility: "verified",
    memberCanSend: false,
    allowPrivateThreads: true,
    allowThreadMessages: true
  },
  {
    key: "ads",
    name: "📌・объявления",
    aliases: ["объявления", "📌│объявления"],
    category: "market",
    type: ChannelType.GuildText,
    visibility: "verified",
    memberCanSend: false
  },
  {
    key: "taskReview",
    name: "🧪・проверка-заданий",
    aliases: ["проверка-заданий", "🧪│проверка-заданий"],
    category: "staff",
    type: ChannelType.GuildText,
    visibility: "staff",
    memberCanSend: true
  },
  {
    key: "adReview",
    name: "🧾・проверка-объявлений",
    aliases: ["проверка-объявлений", "🧾│проверка-объявлений"],
    category: "staff",
    type: ChannelType.GuildText,
    visibility: "staff",
    memberCanSend: true
  }
];

const legacyCategoryNames = [
  "📌 │ информация",
  "🎯 │ задания",
  "📣 │ объявления",
  "🛡️ │ staff",
  "информация",
  "биржа",
  "задания",
  "staff",
  "ro create | система",
  "🤖 │ система"
];

const legacyChannelNames = [
  "📣 │ новости",
  "✅ │ верификация",
  "📋 │ задания",
  "📩 │ отправить-задание",
  "📌 │ объявления",
  "🧪 │ проверка-заданий",
  "🧾 │ проверка-объявлений"
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
  const everyoneAllow = [];
  const everyoneDeny = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.SendMessagesInThreads
  ];

  if (visibility === "public") {
    everyoneAllow.push(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory);
  } else {
    everyoneDeny.push(PermissionFlagsBits.ViewChannel);
  }

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      allow: everyoneAllow,
      deny: everyoneDeny
    },
    {
      id: ownerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
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
        PermissionFlagsBits.EmbedLinks,
        ...(memberCanSend ? [PermissionFlagsBits.SendMessages] : []),
        ...(allowThreadMessages ? [PermissionFlagsBits.SendMessagesInThreads] : []),
        ...(allowPrivateThreads ? [PermissionFlagsBits.CreatePrivateThreads] : [])
      ],
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
        PermissionFlagsBits.ManageThreads,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePrivateThreads
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
  legacyCategoryNames,
  legacyChannelNames,
  buildOverwrites
};
