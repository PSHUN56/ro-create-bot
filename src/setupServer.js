const { ChannelType, PermissionFlagsBits } = require("discord.js");
const {
  roleTemplates,
  managedTemplates,
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

async function ensureManagedCategory(guild, visibleRoleIds, ownerId) {
  let category = findCategory(guild, managedCategoryTemplate.aliases);

  if (!category) {
    category = await guild.channels.create({
      name: managedCategoryTemplate.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: buildOverwrites(guild, true, visibleRoleIds, [ownerId]),
      reason: "Автонастройка Ro Create"
    });
  } else {
    await category.edit({
      permissionOverwrites: buildOverwrites(guild, true, visibleRoleIds, [ownerId]),
      reason: "Автонастройка Ro Create"
    });
  }

  return category;
}

function findExistingChannel(guild, template) {
  return guild.channels.cache.find(
    (channel) =>
      channel.type === template.type && matchesAlias(channel.name, template.aliases)
  );
}

async function ensureManagedChannel(guild, template, managedCategory, visibleRoleIds, ownerId) {
  const existing = findExistingChannel(guild, template);
  const options = {
    permissionOverwrites: buildOverwrites(guild, template.private, visibleRoleIds, [ownerId]),
    reason: "Автонастройка Ro Create"
  };

  if (template.section !== "public") {
    options.parent = managedCategory.id;
  }

  if (existing) {
    const patch = {
      permissionOverwrites: options.permissionOverwrites,
      reason: options.reason
    };

    if (template.section !== "public") {
      patch.parent = managedCategory.id;
    }

    if (existing.name !== template.name) {
      patch.name = template.name;
    }

    await existing.edit(patch);
    return { channel: existing, reused: true };
  }

  const created = await guild.channels.create({
    name: template.name,
    type: template.type,
    parent: template.section !== "public" ? managedCategory.id : undefined,
    permissionOverwrites: options.permissionOverwrites,
    reason: "Автонастройка Ro Create"
  });

  return { channel: created, reused: false };
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

  const managedCategory = await ensureManagedCategory(
    guild,
    visibleRoleIds,
    ownerMember.id
  );

  const channelMap = {};
  for (const template of managedTemplates) {
    channelMap[template.key] = await ensureManagedChannel(
      guild,
      template,
      managedCategory,
      visibleRoleIds,
      ownerMember.id
    );
  }

  const styleSummary = buildStyleSummary(channelMap);
  const instructions = [
    `Открыты для всех только <#${channelMap.news.channel.id}> и <#${channelMap.ads.channel.id}>.`,
    `Все остальные управляемые каналы приватны и собраны в категории <#${managedCategory.id}> для теста.`,
    `Бот переиспользовал существующие каналы, где это было возможно, и добавил только недостающие.`
  ];

  if (styleSummary.reused.length > 0) {
    instructions.push(`Переиспользовано: ${styleSummary.reused.join(", ")}.`);
  }

  if (styleSummary.created.length > 0) {
    instructions.push(`Добавлено: ${styleSummary.created.join(", ")}.`);
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
