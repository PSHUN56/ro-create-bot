const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits
} = require("discord.js");
const {
  ROLE_NAMES,
  roleTemplates,
  managedTemplates,
  obsoleteManagedTemplates,
  legacyManagedCategories,
  managedCategoryTemplate,
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

function matchesAlias(channelName, aliases) {
  const normalized = normalizeName(channelName);
  return aliases.some((alias) => normalizeName(alias) === normalized);
}

function extractStyleSample(guild) {
  const names = guild.channels.cache
    .filter((channel) => [ChannelType.GuildText, ChannelType.GuildCategory].includes(channel.type))
    .map((channel) => channel.name);

  const source = names.find((name) => name.includes("│")) || names.find((name) => name.includes("・"));
  return {
    divider: source?.includes("・") ? "・" : "│",
    spacer: " "
  };
}

function makeStyledName(baseName, style, prefix = "") {
  return prefix
    ? `${prefix}${style.spacer}${style.divider}${style.spacer}${baseName}`
    : `${style.divider}${style.spacer}${baseName}`;
}

async function ensureRole(guild, template) {
  const existing = guild.roles.cache.find((role) => role.name === template.name);
  if (existing) {
    return existing;
  }

  return guild.roles.create({
    name: template.name,
    color: template.color,
    reason: "Автонастройка Ro Create"
  });
}

async function ensureRoleHierarchy(guild, roleMap) {
  const botMember = guild.members.me;
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return;
  }

  let position = botMember.roles.highest.position - 1;
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

function findChannelsByAliases(guild, aliases, type) {
  return guild.channels.cache.filter(
    (channel) => channel.type === type && matchesAlias(channel.name, aliases)
  );
}

function chooseBestChannel(channels, preferredParentId = null) {
  if (channels.size === 0) {
    return null;
  }

  return [...channels.values()].sort((a, b) => {
    const aPreferred = preferredParentId && a.parentId === preferredParentId ? 1 : 0;
    const bPreferred = preferredParentId && b.parentId === preferredParentId ? 1 : 0;
    if (aPreferred !== bPreferred) {
      return bPreferred - aPreferred;
    }
    return a.position - b.position;
  })[0];
}

function findCategoryByAliases(guild, aliases) {
  return guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && matchesAlias(channel.name, aliases)
  );
}

function pickPlacementCategories(guild, existingChannels) {
  return {
    publicHub:
      existingChannels.news?.parent || findCategoryByAliases(guild, managedCategoryTemplate.publicHub.aliases) || null,
    marketHub:
      existingChannels.ads?.parent || findCategoryByAliases(guild, managedCategoryTemplate.marketHub.aliases) || null,
    taskHub:
      existingChannels.tasks?.parent || findCategoryByAliases(guild, managedCategoryTemplate.taskHub.aliases) || null,
    staffHub:
      existingChannels.taskReview?.parent
      || existingChannels.adReview?.parent
      || findCategoryByAliases(guild, managedCategoryTemplate.staffHub.aliases)
      || null
  };
}

async function ensureCategoryForPlacement(guild, placementKey, style, categoryMap, overwriteOptions) {
  const existing = categoryMap[placementKey];
  const template = managedCategoryTemplate[placementKey];
  const overwrites = buildOverwrites(overwriteOptions);

  if (existing) {
    await existing.edit({
      name: makeStyledName(template.baseName, style, template.icon),
      permissionOverwrites: overwrites,
      reason: "Автонастройка Ro Create"
    }).catch(() => null);
    return existing;
  }

  const category = await guild.channels.create({
    name: makeStyledName(template.baseName, style, template.icon),
    type: ChannelType.GuildCategory,
    permissionOverwrites: overwrites,
    reason: "Автонастройка Ro Create"
  });

  categoryMap[placementKey] = category;
  return category;
}

async function ensureManagedChannel(guild, template, style, categoryMap, overwriteOptions) {
  const matches = findChannelsByAliases(guild, template.aliases, template.type);
  const preferredParentId = categoryMap[template.placement]?.id || null;
  const primary = chooseBestChannel(matches, preferredParentId);

  const category = await ensureCategoryForPlacement(
    guild,
    template.placement,
    style,
    categoryMap,
    {
      ...overwriteOptions,
      visibility: template.visibility === "staff" ? "staff" : "verified"
    }
  );

  const channelData = {
    name: makeStyledName(template.baseName, style, template.icon),
    parent: category?.id || null,
    permissionOverwrites: buildOverwrites({
      ...overwriteOptions,
      visibility: template.visibility
    }),
    reason: "Автонастройка Ro Create"
  };

  const channel = primary
    ? await primary.edit(channelData).then(() => primary)
    : await guild.channels.create({ ...channelData, type: template.type });

  const duplicates = [...matches.values()].filter((entry) => entry.id !== channel.id);
  for (const duplicate of duplicates) {
    await duplicate.delete("Удаление дубля системного канала Ro Create").catch(() => null);
  }

  return {
    channel,
    removedDuplicates: duplicates.map((entry) => `#${entry.name}`)
  };
}

async function cleanupObsolete(guild, preservedIds) {
  const removed = [];

  for (const template of obsoleteManagedTemplates) {
    const channel = guild.channels.cache.find(
      (entry) =>
        [ChannelType.GuildText, ChannelType.GuildCategory].includes(entry.type)
        && !preservedIds.has(entry.id)
        && matchesAlias(entry.name, template.aliases)
    );

    if (!channel) {
      continue;
    }

    removed.push(channel.type === ChannelType.GuildCategory ? channel.name : `#${channel.name}`);
    await channel.delete("Удаление лишнего канала Ro Create").catch(() => null);
  }

  for (const categoryName of legacyManagedCategories) {
    const category = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory
        && channel.name === categoryName
        && !preservedIds.has(channel.id)
    );

    if (!category) {
      continue;
    }

    const children = guild.channels.cache.filter((channel) => channel.parentId === category.id);
    if (children.size === 0) {
      removed.push(category.name);
      await category.delete("Удаление пустой старой категории Ro Create").catch(() => null);
    }
  }

  return removed;
}

function isReviewChannel(channel) {
  const normalized = normalizeName(channel.name);
  return normalized.includes("проверка") || normalized.includes("moderator-only");
}

async function lockServerToVerified(guild, newsChannelId, verificationChannelId, overwriteOptions) {
  for (const channel of guild.channels.cache.values()) {
    const visibility =
      channel.id === newsChannelId || channel.id === verificationChannelId
        ? "public"
        : isReviewChannel(channel)
          ? "staff"
          : "verified";

    await channel.edit({
      permissionOverwrites: buildOverwrites({
        ...overwriteOptions,
        visibility
      }),
      reason: "Ro Create: доступ через верификацию"
    }).catch(() => null);
  }
}

async function ensureVerificationMessage(channel, verifiedRole) {
  const content = [
    "Привет. До верификации на сервере открыты только новости и этот канал.",
    "",
    "Нажми кнопку ниже, и бот выдаст роль доступа к основным разделам Ro Create.",
    verifiedRole ? `После подтверждения ты получишь роль <@&${verifiedRole.id}>.` : ""
  ].filter(Boolean).join("\n");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify:grant")
      .setLabel("Пройти верификацию")
      .setStyle(ButtonStyle.Success)
  );

  const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  const existing = recent?.find((message) => message.author.id === channel.guild.members.me.id);

  if (existing) {
    await existing.edit({ content, components: [row] });
    return;
  }

  await channel.send({ content, components: [row] });
}

async function ensureTaskPanel(channel) {
  const content = [
    "Сюда отправляются выполненные ежедневные задания.",
    "",
    "Что можно приложить:",
    "— скриншот",
    "— видео",
    "— короткий комментарий о том, что именно было сделано",
    "",
    "Для отправки используй `/submit-task`."
  ].join("\n");

  const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  const existing = recent?.find(
    (message) => message.author.id === channel.guild.members.me.id && message.content.includes("Сюда отправляются")
  );

  if (existing) {
    await existing.edit(content);
    return;
  }

  await channel.send({ content });
}

async function setupServer(guild, ownerMember) {
  await guild.channels.fetch();
  await guild.roles.fetch();

  const style = extractStyleSample(guild);
  const botCanManageRoles = guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles);
  const roleMap = {};

  for (const template of roleTemplates) {
    roleMap[template.name] = await ensureRole(guild, template);
  }

  await ensureRoleHierarchy(guild, roleMap);

  const founderRole = roleMap[ROLE_NAMES.founder];
  if (founderRole && !ownerMember.roles.cache.has(founderRole.id)) {
    await ownerMember.roles.add(founderRole, "Назначение основателя при настройке").catch(() => null);
  }

  const verifiedRole = roleMap[ROLE_NAMES.verified];
  const staffRoleIds = Object.values(roleMap)
    .filter((role) => STAFF_ROLE_NAMES.includes(role.name))
    .map((role) => role.id);

  const existingChannels = {};
  for (const template of managedTemplates) {
    existingChannels[template.key] = chooseBestChannel(
      findChannelsByAliases(guild, template.aliases, template.type)
    );
  }

  const categoryMap = pickPlacementCategories(guild, existingChannels);
  const overwriteOptions = {
    guild,
    verifiedRoleId: verifiedRole?.id,
    staffRoleIds,
    ownerId: ownerMember.id,
    botCanManageRoles
  };

  const channelMap = {};
  const removedDuplicates = [];

  for (const template of managedTemplates) {
    channelMap[template.key] = await ensureManagedChannel(
      guild,
      template,
      style,
      categoryMap,
      overwriteOptions
    );
    removedDuplicates.push(...channelMap[template.key].removedDuplicates);
  }

  await ensureVerificationMessage(channelMap.verification.channel, verifiedRole);
  await ensureTaskPanel(channelMap.taskSubmit.channel);

  await lockServerToVerified(
    guild,
    channelMap.news.channel.id,
    channelMap.verification.channel.id,
    overwriteOptions
  );

  const preservedIds = new Set([
    ...Object.values(categoryMap).filter(Boolean).map((channel) => channel.id),
    ...Object.values(channelMap).map((entry) => entry.channel.id)
  ]);
  const removedObsolete = await cleanupObsolete(guild, preservedIds);

  const instructions = [
    `Открыты для новых участников только <#${channelMap.news.channel.id}> и <#${channelMap.verification.channel.id}>.`,
    `После кнопки верификации бот выдает роль <@&${verifiedRole.id}> и открывает основной сервер.`,
    `Заявки по ежедневным заданиям отправляются через <#${channelMap.taskSubmit.channel.id}>, а проверка идет в <#${channelMap.taskReview.channel.id}>.`,
    `Объявления публикуются в <#${channelMap.ads.channel.id}>, а модерация объявлений идет в <#${channelMap.adReview.channel.id}>.`
  ];

  const removed = [...removedDuplicates, ...removedObsolete];
  if (removed.length > 0) {
    instructions.push(`Убрано лишнее: ${removed.join(", ")}.`);
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
  hasTaskReviewerRole,
  hasAdReviewerRole
};
