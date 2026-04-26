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
  buildOverwrites
} = require("./config/serverTemplate");

const STAFF_ROLE_NAMES = [
  ROLE_NAMES.founder,
  ROLE_NAMES.admin,
  ROLE_NAMES.taskReviewer,
  ROLE_NAMES.adReviewer
];

function normalizeName(value) {
  return value.trim().toLowerCase();
}

function matchesAnyName(name, aliases) {
  const normalized = normalizeName(name);
  return aliases.some((alias) => normalizeName(alias) === normalized);
}

async function ensureRole(guild, template) {
  const existing = guild.roles.cache.find((role) => role.name === template.name);
  if (existing) {
    return existing;
  }

  return guild.roles.create({
    name: template.name,
    color: template.color,
    reason: "Ro Create bot setup"
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

function findManagedCategory(guild, template) {
  return guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildCategory
      && matchesAnyName(channel.name, [template.name, ...template.aliases])
  );
}

function findManagedChannel(guild, template) {
  return guild.channels.cache.find(
    (channel) =>
      channel.type === template.type
      && matchesAnyName(channel.name, [template.name, ...template.aliases])
  );
}

async function ensureCategory(guild, template, overwriteOptions) {
  const existing = findManagedCategory(guild, template);
  const permissionOverwrites = buildOverwrites({
    ...overwriteOptions,
    visibility: "staff",
    memberCanSend: false
  });

  if (existing) {
    await existing.edit({
      name: template.name,
      permissionOverwrites,
      reason: "Ro Create bot setup"
    }).catch(() => null);
    return existing;
  }

  return guild.channels.create({
    name: template.name,
    type: ChannelType.GuildCategory,
    permissionOverwrites,
    reason: "Ro Create bot setup"
  });
}

async function deleteDuplicateManagedChannels(guild, template, keeperId) {
  const duplicates = guild.channels.cache.filter(
    (channel) =>
      channel.id !== keeperId
      && channel.type === template.type
      && matchesAnyName(channel.name, [template.name, ...template.aliases])
  );

  const removed = [];
  for (const duplicate of duplicates.values()) {
    removed.push(`#${duplicate.name}`);
    await duplicate.delete("Remove duplicate Ro Create bot channel").catch(() => null);
  }

  return removed;
}

async function ensureChannel(guild, template, categoryMap, overwriteOptions) {
  const existing = findManagedChannel(guild, template);
  const parent = categoryMap[template.category];
  const permissionOverwrites = buildOverwrites({
    ...overwriteOptions,
    visibility: template.visibility,
    memberCanSend: template.memberCanSend,
    allowThreadMessages: template.allowThreadMessages,
    allowPrivateThreads: template.allowPrivateThreads
  });

  if (existing) {
    await existing.edit({
      name: template.name,
      parent: parent.id,
      permissionOverwrites,
      reason: "Ro Create bot setup"
    }).catch(() => null);

    const removedDuplicates = await deleteDuplicateManagedChannels(guild, template, existing.id);
    return { channel: existing, removedDuplicates };
  }

  const channel = await guild.channels.create({
    name: template.name,
    type: template.type,
    parent: parent.id,
    permissionOverwrites,
    reason: "Ro Create bot setup"
  });

  return { channel, removedDuplicates: [] };
}

function isManagedCategory(channel) {
  return channel.type === ChannelType.GuildCategory
    && managedCategories.some((template) => matchesAnyName(channel.name, [template.name, ...template.aliases]));
}

function isManagedChannel(channel) {
  return managedTemplates.some((template) =>
    channel.type === template.type
    && matchesAnyName(channel.name, [template.name, ...template.aliases])
  );
}

async function cleanupManagedArtifacts(guild) {
  await guild.channels.fetch();

  const removed = [];
  const managedCategoryIds = new Set(
    guild.channels.cache.filter((channel) => isManagedCategory(channel)).map((channel) => channel.id)
  );

  const channelsToDelete = guild.channels.cache.filter((channel) => {
    if (channel.type === ChannelType.GuildCategory) {
      return false;
    }

    if (isManagedChannel(channel)) {
      return true;
    }

    return channel.parentId && managedCategoryIds.has(channel.parentId);
  });

  for (const channel of channelsToDelete.values()) {
    removed.push(`#${channel.name}`);
    await channel.delete("Cleanup Ro Create bot channels").catch(() => null);
  }

  const categories = guild.channels.cache.filter((channel) => isManagedCategory(channel));
  for (const category of categories.values()) {
    const children = guild.channels.cache.filter((channel) => channel.parentId === category.id);
    if (children.size === 0) {
      removed.push(category.name);
      await category.delete("Cleanup Ro Create bot categories").catch(() => null);
    }
  }

  return removed;
}

async function ensureVerificationMessage(channel, verifiedRole) {
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("Верификация Ro Create")
    .setDescription(
      [
        "Добро пожаловать в Ro Create.",
        "",
        "Нажми кнопку ниже, чтобы получить доступ к серверу и рабочим разделам.",
        verifiedRole ? `После подтверждения бот выдаст роль <@&${verifiedRole.id}>.` : ""
      ].filter(Boolean).join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify:grant")
      .setLabel("Пройти верификацию")
      .setStyle(ButtonStyle.Success)
  );

  const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  const existing = recent?.find((message) => message.author.id === channel.guild.members.me.id);

  if (existing) {
    await existing.edit({ content: "", embeds: [embed], components: [row] });
    return;
  }

  await channel.send({ embeds: [embed], components: [row] });
}

async function ensureTaskPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("Отправка задания")
    .setDescription(
      [
        "В этот канал писать нельзя.",
        "",
        "Нажми кнопку ниже.",
        "Бот попросит комментарий, потом откроет приватную ветку.",
        "В этой ветке нужно будет приложить фото и видео, а потом отправить работу на проверку."
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("task:start")
      .setLabel("Отправить задание")
      .setStyle(ButtonStyle.Primary)
  );

  const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  const existing = recent?.find((message) => message.author.id === channel.guild.members.me.id);

  if (existing) {
    await existing.edit({ content: "", embeds: [embed], components: [row] });
    return;
  }

  await channel.send({ embeds: [embed], components: [row] });
}

async function assignFounderRole(ownerMember, founderRole) {
  if (!founderRole || ownerMember.roles.cache.has(founderRole.id)) {
    return;
  }

  await ownerMember.roles.add(founderRole, "Ro Create bot setup").catch(() => null);
}

async function setupServer(guild, ownerMember) {
  await guild.channels.fetch();
  await guild.roles.fetch();

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
  const removedDuplicates = [];
  for (const template of managedTemplates) {
    const result = await ensureChannel(guild, template, categoryMap, overwriteOptions);
    channelMap[template.key] = result;
    removedDuplicates.push(...result.removedDuplicates);
  }

  await ensureVerificationMessage(channelMap.verification.channel, roleMap[ROLE_NAMES.verified]);
  await ensureTaskPanel(channelMap.taskSubmit.channel);

  const instructions = [
    `Созданы приватные каналы Ro Create в категориях ${managedCategories.map((entry) => `**${entry.name}**`).join(", ")}.`,
    `Верификация находится в <#${channelMap.verification.channel.id}>.`,
    `Задания публикуются в <#${channelMap.tasks.channel.id}>, а отправка идёт через кнопку в <#${channelMap.taskSubmit.channel.id}>.`,
    `Проверка заданий идёт в <#${channelMap.taskReview.channel.id}>, проверка объявлений — в <#${channelMap.adReview.channel.id}>.`,
    `Канал объявлений для публикаций: <#${channelMap.ads.channel.id}>.`
  ];

  if (removedDuplicates.length > 0) {
    instructions.push(`Удалены дубли ботских каналов: ${removedDuplicates.join(", ")}.`);
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
