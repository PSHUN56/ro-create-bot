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

function isLegacyManagedCategoryName(name) {
  return legacyManagedCategories.some((entry) => normalizeName(entry) === normalizeName(name));
}

function isObsoleteManagedChannel(channel) {
  return obsoleteManagedTemplates.some((template) => matchesAlias(channel.name, template.aliases));
}

function isManagedChannelTemplate(channel) {
  return managedTemplates.some((template) =>
    channel.type === template.type && matchesAlias(channel.name, [template.baseName, ...template.aliases])
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
      visibility: template.visibility === "staff" ? "staff" : "verified",
      memberCanSend: false,
      publicCanSend: false
    }
  );

  const channelData = {
    name: makeStyledName(template.baseName, style, template.icon),
    parent: category?.id || null,
    permissionOverwrites: buildOverwrites({
      ...overwriteOptions,
      visibility: template.visibility,
      memberCanSend: template.memberCanSend !== false,
      publicCanSend: template.publicCanSend === true
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

async function cleanupManagedArtifacts(guild) {
  await guild.channels.fetch();

  const removed = [];
  const managedCategoryIds = new Set(
    guild.channels.cache
      .filter((channel) => channel.type === ChannelType.GuildCategory && isLegacyManagedCategoryName(channel.name))
      .map((channel) => channel.id)
  );

  const channelsToDelete = guild.channels.cache.filter((channel) => {
    if ([ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildVoice].includes(channel.type) === false) {
      return false;
    }

    if (isObsoleteManagedChannel(channel)) {
      return true;
    }

    if (channel.parentId && managedCategoryIds.has(channel.parentId) && isManagedChannelTemplate(channel)) {
      return true;
    }

    return false;
  });

  for (const channel of channelsToDelete.values()) {
    removed.push(channel.type === ChannelType.GuildCategory ? channel.name : `#${channel.name}`);
    await channel.delete("Очистка старых каналов Ro Create").catch(() => null);
  }

  for (const categoryId of managedCategoryIds) {
    const category = guild.channels.cache.get(categoryId);
    if (!category) {
      continue;
    }

    const children = guild.channels.cache.filter((channel) => channel.parentId === category.id);
    if (children.size === 0) {
      removed.push(category.name);
      await category.delete("Очистка старой категории Ro Create").catch(() => null);
    }
  }

  return removed;
}

function isReviewChannel(channel) {
  const normalized = normalizeName(channel.name);
  return normalized.includes("проверка") || normalized.includes("moderator-only");
}

async function lockServerToVerified(guild, channelMap, overwriteOptions) {
  const publicIds = new Set([
    channelMap.news.channel.id,
    channelMap.verification.channel.id
  ]);
  const staffIds = new Set([
    channelMap.taskReview.channel.id,
    channelMap.adReview.channel.id
  ]);
  const readOnlyVerifiedIds = new Set([
    channelMap.ads.channel.id,
    channelMap.tasks.channel.id,
    channelMap.taskSubmit.channel.id
  ]);

  for (const channel of guild.channels.cache.values()) {
    const visibility =
      publicIds.has(channel.id)
        ? "public"
        : staffIds.has(channel.id) || isReviewChannel(channel)
          ? "staff"
          : "verified";

    await channel.edit({
      permissionOverwrites: buildOverwrites({
        ...overwriteOptions,
        visibility,
        memberCanSend: !readOnlyVerifiedIds.has(channel.id) && visibility !== "public",
        publicCanSend: false
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
    "\u0421\u044e\u0434\u0430 \u043d\u0435\u043b\u044c\u0437\u044f \u043f\u0438\u0441\u0430\u0442\u044c \u043d\u0430\u043f\u0440\u044f\u043c\u0443\u044e.",
    "",
    "\u041d\u0430\u0436\u043c\u0438 \u043a\u043d\u043e\u043f\u043a\u0443 \u043d\u0438\u0436\u0435, \u0447\u0442\u043e\u0431\u044b \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u043b\u0438\u0447\u043d\u0443\u044e \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0443 \u0437\u0430\u0434\u0430\u043d\u0438\u044f.",
    "",
    "\u0411\u043e\u0442 \u043f\u043e\u043f\u0440\u043e\u0441\u0438\u0442 \u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439, \u0430 \u043f\u043e\u0442\u043e\u043c \u0441\u043e\u0437\u0434\u0430\u0441\u0442 \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u0443\u044e \u043f\u0440\u0438\u0432\u0430\u0442\u043d\u0443\u044e \u0432\u0435\u0442\u043a\u0443, \u043a\u0443\u0434\u0430 \u043d\u0443\u0436\u043d\u043e \u0431\u0443\u0434\u0435\u0442 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0438 \u0444\u043e\u0442\u043e, \u0438 \u0432\u0438\u0434\u0435\u043e."
  ].join("\n");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("task:start")
      .setLabel("\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0437\u0430\u0434\u0430\u043d\u0438\u0435")
      .setStyle(ButtonStyle.Primary)
  );

  const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  const existing = recent?.find(
    (message) => message.author.id === channel.guild.members.me.id && message.content.includes("\u0421\u044e\u0434\u0430 \u043d\u0435\u043b\u044c\u0437\u044f \u043f\u0438\u0441\u0430\u0442\u044c \u043d\u0430\u043f\u0440\u044f\u043c\u0443\u044e")
  );

  if (existing) {
    await existing.edit({ content, components: [row] });
    return;
  }

  await channel.send({ content, components: [row] });
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
    channelMap,
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
  cleanupManagedArtifacts,
  hasTaskReviewerRole,
  hasAdReviewerRole
};
