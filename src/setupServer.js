const { ChannelType, PermissionFlagsBits } = require("discord.js");
const {
  roleTemplates,
  managedTemplates,
  obsoleteManagedTemplates,
  legacyManagedCategories,
  managedCategoryTemplate,
  buildOverwrites
} = require("./config/serverTemplate");

const STAFF_ROLE_NAMES = [
  "Основатель",
  "Администрация",
  "Проверяющий задания",
  "Модератор объявлений"
];

function normalizeName(value) {
  return value.trim().toLowerCase();
}

function matchesAlias(channelName, aliases) {
  const normalized = normalizeName(channelName);
  return aliases.some((alias) => normalizeName(alias) === normalized);
}

function extractPrefix(name) {
  const match = name.match(/^([^\p{Letter}\p{Number}]+)\s*/u);
  return match ? match[1].trim() : "";
}

function detectServerStyle(guild) {
  const sampleNames = guild.channels.cache
    .filter((channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildCategory)
    .map((channel) => channel.name)
    .filter((name) => !!name);

  const prefixCounts = new Map();
  for (const name of sampleNames) {
    const prefix = extractPrefix(name);
    if (!prefix) {
      continue;
    }

    prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
  }

  const sortedPrefixes = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1]);
  const prefix = sortedPrefixes.length > 0 ? sortedPrefixes[0][0] : "・";

  return { prefix };
}

function applyChannelStyle(baseName, style) {
  if (!style.prefix) {
    return baseName;
  }

  return `${style.prefix}-${baseName}`;
}

function applyCategoryStyle(baseName, style) {
  if (!style.prefix) {
    return baseName;
  }

  return `${style.prefix} ${baseName}`;
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

function findCategory(guild, aliases) {
  return guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildCategory && matchesAlias(channel.name, aliases)
  );
}

async function ensureManagedCategory(guild, visibleRoleIds, ownerId, style) {
  const styledName = applyCategoryStyle(managedCategoryTemplate.baseName, style);
  const aliases = [...managedCategoryTemplate.aliases, styledName];

  let category = findCategory(guild, aliases);

  if (!category) {
    category = await guild.channels.create({
      name: styledName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: buildOverwrites(guild, true, visibleRoleIds, [ownerId]),
      reason: "Автонастройка Ro Create"
    });
  } else {
    await category.edit({
      name: styledName,
      permissionOverwrites: buildOverwrites(guild, true, visibleRoleIds, [ownerId]),
      reason: "Автонастройка Ro Create"
    });
  }

  return category;
}

function findExistingChannel(guild, template, style) {
  const styledName = applyChannelStyle(template.baseName, style);
  const aliases = [...template.aliases, styledName];

  return guild.channels.cache.find(
    (channel) =>
      channel.type === template.type && matchesAlias(channel.name, aliases)
  );
}

async function ensureManagedChannel(guild, template, managedCategory, visibleRoleIds, ownerId, style) {
  const existing = findExistingChannel(guild, template, style);
  const styledName = applyChannelStyle(template.baseName, style);
  const options = {
    permissionOverwrites: buildOverwrites(guild, template.private, visibleRoleIds, [ownerId]),
    reason: "Автонастройка Ro Create"
  };

  if (template.section !== "public") {
    options.parent = managedCategory.id;
  }

  if (existing) {
    const patch = {
      name: styledName,
      permissionOverwrites: options.permissionOverwrites,
      reason: options.reason
    };

    if (template.section !== "public") {
      patch.parent = managedCategory.id;
    }

    await existing.edit(patch);
    return { channel: existing, reused: true };
  }

  const created = await guild.channels.create({
    name: styledName,
    type: template.type,
    parent: template.section !== "public" ? managedCategory.id : undefined,
    permissionOverwrites: options.permissionOverwrites,
    reason: "Автонастройка Ro Create"
  });

  return { channel: created, reused: false };
}

async function cleanupObsoleteChannels(guild) {
  const deleted = [];
  const legacyCategoryIds = guild.channels.cache
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .filter((channel) => legacyManagedCategories.includes(channel.name))
    .map((channel) => channel.id);

  for (const template of obsoleteManagedTemplates) {
    const channel = guild.channels.cache.find(
      (entry) =>
        entry.type === ChannelType.GuildText
        && matchesAlias(entry.name, template.aliases)
        && (!entry.parentId || legacyCategoryIds.includes(entry.parentId))
    );

    if (channel) {
      deleted.push(`#${channel.name}`);
      await channel.delete("Удаление устаревшего системного канала Ro Create");
    }
  }

  for (const categoryName of legacyManagedCategories) {
    const category = guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildCategory && channel.name === categoryName
    );

    if (category) {
      const children = guild.channels.cache.filter((channel) => channel.parentId === category.id);
      if (children.size === 0) {
        await category.delete("Удаление пустой устаревшей категории Ro Create");
      }
    }
  }

  return deleted;
}

async function ensureInstructionMessage(channel, guild, roleMap) {
  const verifiedRole = roleMap["Верифицирован"];
  const content = [
    "Привет. Я аккуратно подстроил служебную часть Ro Create под текущую структуру сервера, не ломая существующую атмосферу.",
    "",
    "Что уже сделал:",
    "— оставил открытыми только новости и объявления;",
    "— собрал служебные и тестовые каналы в одну системную категорию;",
    "— подготовил приватные каналы для ежедневок, проверки и верификации;",
    `— создал роль ${verifiedRole ? `<@&${verifiedRole.id}>` : "`Верифицирован`"} для дальнейшей настройки допуска.`,
    "",
    "Что советую дальше:",
    "— сначала спокойно проверить команды и права на тестовом доступе;",
    "— потом открыть нужные каналы для участников;",
    "— отдельно решить, будет ли верификация через кнопку, реакцию или ручную модерацию."
  ].join("\n");

  const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  const existing = recent?.find((message) =>
    message.author.id === guild.members.me.id && message.content.includes("Я аккуратно подстроил")
  );

  if (existing) {
    await existing.edit(content);
    return;
  }

  await channel.send({ content });
}

function buildStyleSummary(resultMap) {
  const reused = Object.values(resultMap)
    .filter((entry) => entry.reused)
    .map((entry) => `#${entry.channel.name}`);
  const created = Object.values(resultMap)
    .filter((entry) => !entry.reused)
    .map((entry) => `#${entry.channel.name}`);

  return { reused, created };
}

async function setupServer(guild, ownerMember) {
  await guild.channels.fetch();
  await guild.roles.fetch();

  const style = detectServerStyle(guild);
  const roleMap = {};

  for (const template of roleTemplates) {
    roleMap[template.name] = await ensureRole(guild, template);
  }

  const founderRole = roleMap["Основатель"];
  if (founderRole && ownerMember.manageable && !ownerMember.roles.cache.has(founderRole.id)) {
    await ownerMember.roles.add(founderRole, "Назначение основателя при первой настройке");
  }

  const visibleRoleIds = Object.values(roleMap)
    .filter((role) => STAFF_ROLE_NAMES.includes(role.name))
    .map((role) => role.id);

  const managedCategory = await ensureManagedCategory(guild, visibleRoleIds, ownerMember.id, style);
  const deletedChannels = await cleanupObsoleteChannels(guild);

  const channelMap = {};
  for (const template of managedTemplates) {
    channelMap[template.key] = await ensureManagedChannel(
      guild,
      template,
      managedCategory,
      visibleRoleIds,
      ownerMember.id,
      style
    );
  }

  await ensureInstructionMessage(channelMap.instructions.channel, guild, roleMap);

  const styleSummary = buildStyleSummary(channelMap);
  const instructions = [
    `Открыты для всех только <#${channelMap.news.channel.id}> и <#${channelMap.ads.channel.id}>.`,
    `Все остальные каналы, которыми управляет бот, сейчас приватны и собраны в <#${managedCategory.id}>.`,
    `Бот попытался сохранить визуальный стиль сервера и переиспользовал подходящие каналы вместо грубого пересоздания.`
  ];

  if (styleSummary.reused.length > 0) {
    instructions.push(`Переиспользовано: ${styleSummary.reused.join(", ")}.`);
  }

  if (styleSummary.created.length > 0) {
    instructions.push(`Добавлено: ${styleSummary.created.join(", ")}.`);
  }

  if (deletedChannels.length > 0) {
    instructions.push(`Убрано лишнее: ${deletedChannels.join(", ")}.`);
  }

  return {
    roleMap,
    managedCategory,
    channelMap,
    instructions
  };
}

function hasTaskReviewerRole(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || member.roles.cache.some((role) =>
      ["Проверяющий задания", "Администрация", "Основатель"].includes(role.name)
    );
}

function hasAdReviewerRole(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || member.roles.cache.some((role) =>
      ["Модератор объявлений", "Администрация", "Основатель"].includes(role.name)
    );
}

module.exports = {
  setupServer,
  hasTaskReviewerRole,
  hasAdReviewerRole
};
