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
  legacyChannelNames
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

function aliasesFor(template) {
  return [template.name, ...(template.aliases || [])].map(normalizeName);
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
    reason: "Ro Create setup"
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

  await ownerMember.roles.add(founderRole, "Ro Create setup").catch(() => null);
}

async function cleanupManagedArtifacts(guild) {
  await guild.channels.fetch();

  const removed = [];
  const artifacts = readArtifacts(guild.id);
  const trackedChannelIds = new Set(Object.values(artifacts.channels || {}));
  const trackedCategoryIds = new Set(Object.values(artifacts.categories || {}));
  const legacyCategories = new Set(legacyCategoryNames.map(normalizeName));
  const legacyChannels = new Set(legacyChannelNames.map(normalizeName));

  const categoriesToDelete = guild.channels.cache.filter((channel) =>
    channel.type === ChannelType.GuildCategory
    && (trackedCategoryIds.has(channel.id) || legacyCategories.has(normalizeName(channel.name)))
  );

  const categoryIds = new Set(categoriesToDelete.map((channel) => channel.id));

  const channelsToDelete = guild.channels.cache.filter((channel) => {
    if (channel.type === ChannelType.GuildCategory) {
      return false;
    }

    return trackedChannelIds.has(channel.id)
      || (channel.parentId && categoryIds.has(channel.parentId))
      || legacyChannels.has(normalizeName(channel.name));
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

function findTrackedChannel(guild, id, expectedType = null) {
  if (!id) {
    return null;
  }

  const channel = guild.channels.cache.get(id) || null;
  if (!channel) {
    return null;
  }

  if (expectedType && channel.type !== expectedType) {
    return null;
  }

  return channel;
}

function findExistingCategory(guild, template, artifacts) {
  const tracked = findTrackedChannel(guild, artifacts.categories?.[template.key], ChannelType.GuildCategory);
  if (tracked) {
    return tracked;
  }

  const aliases = new Set(aliasesFor(template));
  return guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && aliases.has(normalizeName(channel.name))
  ) || null;
}

function findExistingChannel(guild, template, artifacts) {
  const tracked = findTrackedChannel(guild, artifacts.channels?.[template.key], template.type);
  if (tracked) {
    return tracked;
  }

  const aliases = new Set(aliasesFor(template));
  return guild.channels.cache.find((channel) =>
    channel.type === template.type && aliases.has(normalizeName(channel.name))
  ) || null;
}

async function findExistingPanelMessage(channel, customId) {
  const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
  if (!messages) {
    return null;
  }

  return messages.find((message) =>
    message.author.id === channel.client.user.id
    && message.components.some((row) =>
      row.components.some((component) => component.customId === customId)
    )
  ) || null;
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

  const existing = await findExistingPanelMessage(channel, "verify:grant");
  if (existing) {
    await existing.edit({ embeds: [embed], components: [row] });
    return existing;
  }

  return channel.send({ embeds: [embed], components: [row] });
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

  const existing = await findExistingPanelMessage(channel, "task:start");
  if (existing) {
    await existing.edit({ embeds: [embed], components: [row] });
    return existing;
  }

  return channel.send({ embeds: [embed], components: [row] });
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

  const artifacts = readArtifacts(guild.id);
  const categoryMap = {};
  const channelMap = {};
  const missing = [];

  for (const template of managedCategories) {
    const category = findExistingCategory(guild, template, artifacts);
    if (category) {
      categoryMap[template.key] = category;
      saveCategoryArtifact(guild.id, template.key, category.id);
    } else {
      missing.push(`категория ${template.name}`);
    }
  }

  for (const template of managedTemplates) {
    const channel = findExistingChannel(guild, template, artifacts);
    if (channel) {
      channelMap[template.key] = { channel, removedDuplicates: [] };
      saveChannelArtifact(guild.id, template.key, channel.id);
    } else {
      missing.push(`канал ${template.name}`);
    }
  }

  if (channelMap.verification?.channel) {
    await ensureVerificationMessage(channelMap.verification.channel, roleMap[ROLE_NAMES.verified]);
  }

  if (channelMap.taskSubmit?.channel) {
    await ensureTaskPanel(channelMap.taskSubmit.channel);
  }

  const instructions = [
    "Готово. Я подключил бота к уже настроенной структуре сервера и не трогал расположение каналов."
  ];

  if (channelMap.news?.channel && channelMap.verification?.channel) {
    instructions.push(`Стартовые каналы: <#${channelMap.news.channel.id}> и <#${channelMap.verification.channel.id}>.`);
  }

  if (channelMap.tasks?.channel && channelMap.taskSubmit?.channel) {
    instructions.push(`Задания: <#${channelMap.tasks.channel.id}> и <#${channelMap.taskSubmit.channel.id}>.`);
  }

  if (channelMap.ads?.channel) {
    instructions.push(`Объявления: <#${channelMap.ads.channel.id}>.`);
  }

  if (channelMap.taskReview?.channel || channelMap.adReview?.channel) {
    instructions.push(
      `Staff-каналы: ${[channelMap.taskReview?.channel, channelMap.adReview?.channel]
        .filter(Boolean)
        .map((channel) => `<#${channel.id}>`)
        .join(" и ")}.`
    );
  }

  if (missing.length > 0) {
    instructions.push(`Не нашёл и не стал создавать: ${missing.join(", ")}.`);
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
