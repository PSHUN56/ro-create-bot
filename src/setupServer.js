const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits
} = require("discord.js");
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

const EXEMPT_CATEGORY_KEYWORDS = [
  "голосовые",
  "основное",
  "сообщество",
  "поиски",
  "девелопмент",
  "обучение",
  "сотрудничество",
  "big fire"
];

function normalizeName(value) {
  return value.trim().toLowerCase();
}

function matchesAlias(channelName, aliases) {
  const normalized = normalizeName(channelName);
  return aliases.some((alias) => normalizeName(alias) === normalized);
}

function extractStyleSample(guild) {
  const namedChannels = guild.channels.cache
    .filter((channel) => channel.type === ChannelType.GuildText)
    .map((channel) => channel.name);

  const styleSource = namedChannels.find((name) => name.includes("│")) || namedChannels.find((name) => name.includes("・"));
  if (!styleSource) {
    return { divider: "│", prefix: "📢" };
  }

  const divider = styleSource.includes("│") ? "│" : "・";
  const firstPart = styleSource.split(divider)[0].trim();
  return {
    divider,
    prefix: firstPart || "📢"
  };
}

function makeStyledName(baseName, style, fallbackPrefix) {
  return `${fallbackPrefix || style.prefix} ${style.divider} ${baseName}`;
}

function shouldKeepCategoryOpen(category) {
  return EXEMPT_CATEGORY_KEYWORDS.some((keyword) =>
    normalizeName(category.name).includes(keyword)
  );
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

function findChannel(guild, aliases, type = ChannelType.GuildText) {
  return guild.channels.cache.find(
    (channel) => channel.type === type && matchesAlias(channel.name, aliases)
  );
}

async function ensureManagedCategory(guild, style, staffRoleIds, ownerId, verifiedRoleId, botCanManageRoles) {
  const styledName = makeStyledName("система", style, "🤖");
  const aliases = [...managedCategoryTemplate.aliases, styledName];
  let category = findChannel(guild, aliases, ChannelType.GuildCategory);

  const overwrites = buildOverwrites({
    guild,
    visibility: "staff",
    verifiedRoleId,
    staffRoleIds,
    ownerId,
    botCanManageRoles
  });

  if (!category) {
    category = await guild.channels.create({
      name: styledName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites,
      reason: "Автонастройка Ro Create"
    });
  } else {
    await category.edit({
      name: styledName,
      permissionOverwrites: overwrites,
      reason: "Автонастройка Ro Create"
    });
  }

  return category;
}

async function ensureManagedChannel(
  guild,
  template,
  style,
  managedCategory,
  staffRoleIds,
  ownerId,
  verifiedRoleId,
  botCanManageRoles
) {
  const fallbackPrefix =
    template.key === "verification" ? "✅"
      : template.key.includes("Review") ? "🛡️"
        : template.key === "ads" ? "📢"
          : template.key === "taskSubmit" ? "📩"
            : "📌";

  const styledName = makeStyledName(template.baseName, style, fallbackPrefix);
  const aliases = [...template.aliases, styledName];
  const existing = findChannel(guild, aliases, template.type);

  const permissionOverwrites = buildOverwrites({
    guild,
    visibility: template.visibility,
    verifiedRoleId,
    staffRoleIds,
    ownerId,
    botCanManageRoles
  });

  const parent = template.visibility === "public" ? null : managedCategory.id;

  if (existing) {
    await existing.edit({
      name: styledName,
      parent,
      permissionOverwrites,
      reason: "Автонастройка Ro Create"
    });

    return { channel: existing, reused: true };
  }

  const created = await guild.channels.create({
    name: styledName,
    type: template.type,
    parent,
    permissionOverwrites,
    reason: "Автонастройка Ro Create"
  });

  return { channel: created, reused: false };
}

async function cleanupObsolete(guild, managedCategoryId) {
  const removedChannels = [];

  for (const template of obsoleteManagedTemplates) {
    const channel = guild.channels.cache.find(
      (entry) =>
        entry.type === ChannelType.GuildText
        && matchesAlias(entry.name, template.aliases)
        && (!entry.parentId || entry.parentId === managedCategoryId)
    );

    if (channel) {
      removedChannels.push(`#${channel.name}`);
      await channel.delete("Удаление лишнего системного канала Ro Create");
    }
  }

  for (const categoryName of legacyManagedCategories) {
    const category = guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildCategory && channel.name === categoryName
    );

    if (category) {
      const children = guild.channels.cache.filter((channel) => channel.parentId === category.id);
      if (children.size === 0) {
        await category.delete("Удаление устаревшей пустой категории Ro Create");
      }
    }
  }

  return removedChannels;
}

async function lockServerToVerified(
  guild,
  verificationChannelId,
  newsChannelId,
  staffRoleIds,
  ownerId,
  verifiedRoleId,
  botCanManageRoles
) {
  const touched = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.id === newsChannelId || channel.id === verificationChannelId) {
      continue;
    }

    if (channel.parentId) {
      const parent = guild.channels.cache.get(channel.parentId);
      if (parent && shouldKeepCategoryOpen(parent) && channel.type !== ChannelType.GuildVoice) {
        // existing themed categories still become verified-only
      }
    }

    const visibility = STAFF_ROLE_NAMES.some((roleName) =>
      normalizeName(channel.name).includes("moderator") || normalizeName(channel.name).includes("staff")
    )
      ? "staff"
      : "verified";

    const permissionOverwrites = buildOverwrites({
      guild,
      visibility,
      verifiedRoleId,
      staffRoleIds,
      ownerId,
      botCanManageRoles
    });

    await channel.edit({
      permissionOverwrites,
      reason: "Ограничение доступа до прохождения верификации"
    }).catch(() => null);

    touched.push(channel.id);
  }

  return touched;
}

async function ensureVerificationMessage(channel, verifiedRole) {
  const content = [
    "Добро пожаловать в Ro Create.",
    "",
    "Сейчас сервер работает в режиме закрытого доступа: пока участник не пройдет верификацию, ему видны только новости и этот канал.",
    "",
    "Нажми кнопку ниже, чтобы получить доступ к остальным разделам сервера.",
    verifiedRole ? `После нажатия бот выдаст роль <@&${verifiedRole.id}> и откроет основные каналы.` : ""
  ].filter(Boolean).join("\n");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify:grant")
      .setLabel("Пройти верификацию")
      .setStyle(ButtonStyle.Success)
  );

  const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  const existing = recent?.find((message) =>
    message.author.id === channel.guild.members.me.id && message.components.length > 0
  );

  if (existing) {
    await existing.edit({ content, components: [row] });
    return;
  }

  await channel.send({ content, components: [row] });
}

async function ensureBotInstruction(channel) {
  const content = [
    "Я подстроил системную часть под уже готовый сервер, а не строил новый поверх него.",
    "",
    "Что сейчас включено:",
    "— до верификации видны только новости и канал верификации;",
    "— после кнопки участник получает роль `Верифицирован` и открывает остальную структуру;",
    "— служебные каналы для проверки заданий и объявлений спрятаны отдельно;",
    "— лишние старые системные заготовки удалены."
  ].join("\n");

  const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  const existing = recent?.find((message) =>
    message.author.id === channel.guild.members.me.id && message.content.includes("Я подстроил системную часть")
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

  const founderRole = roleMap["Основатель"];
  if (founderRole && ownerMember.manageable && !ownerMember.roles.cache.has(founderRole.id)) {
    await ownerMember.roles.add(founderRole, "Назначение основателя при первой настройке");
  }

  const verifiedRole = roleMap["Верифицирован"];
  const staffRoleIds = Object.values(roleMap)
    .filter((role) => STAFF_ROLE_NAMES.includes(role.name))
    .map((role) => role.id);

  const managedCategory = await ensureManagedCategory(
    guild,
    style,
    staffRoleIds,
    ownerMember.id,
    verifiedRole?.id,
    botCanManageRoles
  );

  const channelMap = {};
  for (const template of managedTemplates) {
    channelMap[template.key] = await ensureManagedChannel(
      guild,
      template,
      style,
      managedCategory,
      staffRoleIds,
      ownerMember.id,
      verifiedRole?.id,
      botCanManageRoles
    );
  }

  await ensureVerificationMessage(channelMap.verification.channel, verifiedRole);
  await ensureBotInstruction(channelMap.taskReview.channel);

  const removedChannels = await cleanupObsolete(guild, managedCategory.id);
  await lockServerToVerified(
    guild,
    channelMap.verification.channel.id,
    channelMap.news.channel.id,
    staffRoleIds,
    ownerMember.id,
    verifiedRole?.id,
    botCanManageRoles
  );

  const instructions = [
    `Открыты для всех только <#${channelMap.news.channel.id}> и <#${channelMap.verification.channel.id}>.`,
    `После нажатия кнопки верификации участник получает роль <@&${verifiedRole.id}> и видит остальной сервер.`,
    `Служебные каналы бота убраны в <#${managedCategory.id}> и скрыты от обычных участников.`
  ];

  if (removedChannels.length > 0) {
    instructions.push(`Удалено лишнее: ${removedChannels.join(", ")}.`);
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
