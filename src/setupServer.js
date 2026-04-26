const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { roleTemplates, categoryTemplates, buildOverwrites } = require("./config/serverTemplate");

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

async function ensureChannel(guild, parent, template, visibleRoleIds, ownerId) {
  const existing = guild.channels.cache.find(
    (channel) => channel.parentId === parent.id && channel.name === template.name
  );

  if (existing) {
    return existing;
  }

  return guild.channels.create({
    name: template.name,
    type: template.type,
    parent: parent.id,
    permissionOverwrites: buildOverwrites(guild, template.private, visibleRoleIds, [ownerId]),
    reason: "Автонастройка Ro Create"
  });
}

async function ensureCategory(guild, template, visibleRoleIds, ownerId) {
  let category = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === template.name
  );

  if (!category) {
    category = await guild.channels.create({
      name: template.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: buildOverwrites(guild, template.private, visibleRoleIds, [ownerId]),
      reason: "Автонастройка Ro Create"
    });
  }

  const channelMap = {};

  for (const channelTemplate of template.channels) {
    channelMap[channelTemplate.key] = await ensureChannel(
      guild,
      category,
      channelTemplate,
      visibleRoleIds,
      ownerId
    );
  }

  return { category, channels: channelMap };
}

function isStaffRole(name) {
  return ["Основатель", "Администрация", "Проверяющий задания", "Модератор объявлений"].includes(name);
}

async function setupServer(guild, ownerMember) {
  const roleMap = {};

  for (const template of roleTemplates) {
    roleMap[template.name] = await ensureRole(guild, template);
  }

  const founderRole = roleMap["Основатель"];
  if (founderRole && ownerMember.manageable && !ownerMember.roles.cache.has(founderRole.id)) {
    await ownerMember.roles.add(founderRole, "Назначение основателя при первой настройке");
  }

  const visibleRoleIds = Object.values(roleMap)
    .filter((role) => isStaffRole(role.name))
    .map((role) => role.id);

  const created = {};

  for (const categoryTemplate of categoryTemplates) {
    created[categoryTemplate.key] = await ensureCategory(
      guild,
      categoryTemplate,
      visibleRoleIds,
      ownerMember.id
    );
  }

  const instructions = [
    `Канал <#${created.publicInfo.channels.news.id}> открыт для всех участников.`,
    `Остальные каналы созданы приватными для теста и сейчас видны только staff-ролям и тебе.`,
    `Проверка заданий идет через <#${created.staff.channels.taskReview.id}>.`,
    `Проверка объявлений идет через <#${created.staff.channels.adReview.id}>.`
  ];

  return { roleMap, created, instructions };
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
