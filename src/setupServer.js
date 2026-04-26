const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");
const {
  ROLE_NAMES,
  roleTemplates,
  managedCategories,
  managedTemplates,
  legacyCategoryNames,
  legacyChannelNames,
  buildOverwrites
} = require("./config/serverTemplate");
const { loadState, withState } = require("./storage");

const STAFF_ROLE_NAMES = [
  ROLE_NAMES.founder,
  ROLE_NAMES.admin,
  ROLE_NAMES.taskReviewer,
  ROLE_NAMES.adReviewer
];

function normalizeName(value) {
  return value.trim().toLowerCase();
}

function getArtifacts(state, guildId) {
  if (!state.managedArtifacts[guildId]) {
    state.managedArtifacts[guildId] = {
      categories: {},
      channels: {}
    };
  }

  return state.managedArtifacts[guildId];
}

function readArtifacts(guildId) {
  return loadState().managedArtifacts[guildId] || { categories: {}, channels: {} };
}

function saveCategoryArtifact(guildId, key, id) {
  withState((state) => {
    const artifacts = getArtifacts(state, guildId);
    artifacts.categories[key] = id;
  });
}

function saveChannelArtifact(guildId, key, id) {
  withState((state) => {
    const artifacts = getArtifacts(state, guildId);
    artifacts.channels[key] = id;
  });
}

function clearArtifacts(guildId) {
  withState((state) => {
    delete state.managedArtifacts[guildId];
  });
}

async function ensureRole(guild, template) {
  const existing = guild.roles.cache.find((role) => role.name === template.name);
  if (existing) {
    return existing;
  }

  return guild.roles.create({
    name: template.name,
    color: template.color,
    reason: "Ro Create clean setup"
  });
}

async function ensureRoleHierarchy(guild, roleMap) {
  const botMember = guild.members.me;
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return;
  }

  let position = Math.max(1, botMember.roles.highest.position - 1);
  const order = [
    ROLE_NAMES.verified,
    ROLE_NAMES.adReviewer,
    ROLE_NAMES.taskReviewer,
    ROLE_NAMES.admin,
    ROLE_NAMES.founder
  ];

  for (const roleName of order) {
    const role = roleMap[roleName];
    if (!role || role.position >= botMember.roles.highest.position) {
      continue;
    }

    await role.setPosition(position).catch(() => null);
    position -= 1;
  }
}

async function assignFounderRole(ownerMember, founderRole) {
  if (!founderRole || ownerMember.roles.cache.has(founderRole.id)) {
    return;
  }

  await ownerMember.roles.add(founderRole, "Ro Create clean setup").catch(() => null);
}

async function cleanupManagedArtifacts(guild) {
  await guild.channels.fetch();

  const removed = [];
  const artifacts = readArtifacts(guild.id);
  const trackedChannelIds = new Set(Object.values(artifacts.channels || {}));
  const trackedCategoryIds = new Set(Object.values(artifacts.categories || {}));

  const categoriesToDelete = guild.channels.cache.filter((channel) =>
    channel.type === ChannelType.GuildCategory
    && (
      trackedCategoryIds.has(channel.id)
      || legacyCategoryNames.map(normalizeName).includes(normalizeName(channel.name))
    )
  );

  const categoryIds = new Set(categoriesToDelete.map((channel) => channel.id));

  const channelsToDelete = guild.channels.cache.filter((channel) => {
    if (channel.type === ChannelType.GuildCategory) {
      return false;
    }

    if (trackedChannelIds.has(channel.id)) {
      return true;
    }

    if (channel.parentId && categoryIds.has(channel.parentId)) {
      return true;
    }

    return legacyChannelNames.map(normalizeName).includes(normalizeName(channel.name));
  });

  for (const channel of channelsToDelete.values()) {
    removed.push(`#${channel.name}`);
    await channel.delete("Remove old Ro Create bot channel").catch(() => null);
  }

  for (const category of categoriesToDelete.values()) {
    const children = guild.channels.cache.filter((channel) => channel.parentId === category.id);
    if (children.size === 0) {
      removed.push(category.name);
      await category.delete("Remove old Ro Create bot category").catch(() => null);
    }
  }

  clearArtifacts(guild.id);
  return removed;
}

async function ensureCategory(guild, template, overwriteOptions) {
  const channel = await guild.channels.create({
    name: template.name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: buildOverwrites({
      ...overwriteOptions,
      visibility: "staff",
      memberCanSend: false
    }),
    reason: "Ro Create clean setup"
  });

  saveCategoryArtifact(guild.id, template.key, channel.id);
  return channel;
}

async function ensureChannel(guild, template, categoryMap, overwriteOptions) {
  const channel = await guild.channels.create({
    name: template.name,
    type: template.type,
    parent: categoryMap[template.category].id,
    permissionOverwrites: buildOverwrites({
      ...overwriteOptions,
      visibility: template.visibility,
      memberCanSend: template.memberCanSend,
      allowThreadMessages: template.allowThreadMessages,
      allowPrivateThreads: template.allowPrivateThreads
    }),
    reason: "Ro Create clean setup"
  });

  saveChannelArtifact(guild.id, template.key, channel.id);
  return { channel, removedDuplicates: [] };
}

async function ensureVerificationMessage(channel, verifiedRole) {
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("Ro Create | Верификация")
    .setDescription(
      [
        "Добро пожаловать в Ro Create.",
        "",
        "Нажми кнопку ниже, чтобы получить доступ к основным разделам сервера.",
        verifiedRole ? `После подтверждения бот выдаст роль <@&${verifiedRole.id}>.` : ""
      ].filter(Boolean).join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify:grant")
      .setLabel("Пройти верификацию")
      .setStyle(ButtonStyle.Success)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function ensureTaskPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("Ro Create | Сдача задания")
    .setDescription(
      [
        "В этот канал писать нельзя.",
        "",
        "Нажми кнопку ниже.",
        "Бот попросит комментарий, потом откроет приватную ветку.",
        "В ветке нужно будет приложить фото и видео, а потом отправить работу на проверку."
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("task:start")
      .setLabel("Отправить задание")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function setupServer(guild, ownerMember) {
  await guild.channels.fetch();
  await guild.roles.fetch();

  const removedBeforeSetup = await cleanupManagedArtifacts(guild);

  const roleMap = {};
  for (const template of roleTemplates) {
    roleMap[template.name] = await ensureRole(guild, template);
  }

  await ensureRoleHierarchy(guild, roleMap);
  await assignFounderRole(ownerMember, roleMap[ROLE_NAMES.founder]);

  const overwriteOptions = {
    guild,
    ownerId: ownerMember.id,
    verifiedRoleId: roleMap[ROLE_NAMES.verified]?.id,
    staffRoleIds: Object.values(roleMap)
      .filter((role) => STAFF_ROLE_NAMES.includes(role.name))
      .map((role) => role.id)
  };

  const categoryMap = {};
  for (const template of managedCategories) {
    categoryMap[template.key] = await ensureCategory(guild, template, overwriteOptions);
  }

  const channelMap = {};
  for (const template of managedTemplates) {
    channelMap[template.key] = await ensureChannel(guild, template, categoryMap, overwriteOptions);
  }

  await ensureVerificationMessage(channelMap.verification.channel, roleMap[ROLE_NAMES.verified]);
  await ensureTaskPanel(channelMap.taskSubmit.channel);

  const instructions = [
    `Готово. Я полностью пересобрал структуру Ro Create в приватном стиле.`,
    `Стартовые каналы: <#${channelMap.news.channel.id}> и <#${channelMap.verification.channel.id}>.`,
    `Задания: <#${channelMap.tasks.channel.id}> и <#${channelMap.taskSubmit.channel.id}>.`,
    `Биржа: <#${channelMap.ads.channel.id}>.`,
    `Staff-проверка: <#${channelMap.taskReview.channel.id}> и <#${channelMap.adReview.channel.id}>.`
  ];

  if (removedBeforeSetup.length > 0) {
    instructions.push(`Перед пересборкой я удалил старые ботские объекты: ${removedBeforeSetup.join(", ")}.`);
  }

  return { roleMap, channelMap, instructions };
}

function hasTaskReviewerRole(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || member.roles.cache.some((role) =>
      [ROLE_NAMES.taskReviewer, ROLE_NAMES.admin, ROLE_NAMES.founder].includes(role.name)
    );
}

function hasAdReviewerRole(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || member.roles.cache.some((role) =>
      [ROLE_NAMES.adReviewer, ROLE_NAMES.admin, ROLE_NAMES.founder].includes(role.name)
    );
}

module.exports = {
  setupServer,
  cleanupManagedArtifacts,
  hasTaskReviewerRole,
  hasAdReviewerRole
};
