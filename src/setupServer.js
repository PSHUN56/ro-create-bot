const {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} = require("discord.js");
const { ROLE_NAMES, legacyCategoryNames, legacyChannelNames } = require("./config/serverTemplate");
const { loadState, withState } = require("./storage");

const ROLE_PICKER_CUSTOM_ID = "roles:select";

const STAFF_ROLE_NAMES = [
  ROLE_NAMES.founder,
  ROLE_NAMES.admin,
  ROLE_NAMES.taskReviewer,
  ROLE_NAMES.adReviewer
];

const ROLE_PICKER_CHANNEL_ALIASES = [
  "выбор-роли",
  "выбор роли",
  "выбор_роли",
  "роли",
  "role-select",
  "role selection",
  "roles"
];

const ROLE_PICKER_GROUPS = [
  { label: "Скриптер", emoji: "🧑‍💻", aliases: ["🧑‍💻 Скриптер", "Скриптер"] },
  { label: "Билдер", emoji: "👷", aliases: ["👷 Билдер", "Билдер"] },
  { label: "Аниматор", emoji: "🧑‍🎨", aliases: ["🧑‍🎨 Аниматор", "Аниматор"] },
  { label: "Гфх мейкер", emoji: "🧑‍🎨", aliases: ["🧑‍🎨 Гфх мейкер", "Гфх мейкер", "ГФХ мейкер"] },
  { label: "Вфх мейкер", emoji: "🪄", aliases: ["🪄 Вфх мейкер", "Вфх мейкер", "ВФХ мейкер"] },
  { label: "Модельер", emoji: "🧑‍🎨", aliases: ["🧑‍🎨 Модельер", "Модельер"] },
  { label: "Sound Мейкер", emoji: "🎵", aliases: ["🎵 Sound Мейкер", "Sound Мейкер"] }
];

function normalizeName(value) {
  return value.trim().toLowerCase();
}

function readArtifacts(guildId) {
  return loadState().managedArtifacts[guildId] || { categories: {}, channels: {} };
}

function clearArtifacts(guildId) {
  withState((state) => {
    delete state.managedArtifacts[guildId];
  });
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

function findRoleSelectionChannel(guild) {
  const aliases = ROLE_PICKER_CHANNEL_ALIASES.map(normalizeName);

  return guild.channels.cache.find((channel) => {
    if (channel.type !== ChannelType.GuildText) {
      return false;
    }

    const normalizedName = normalizeName(channel.name);
    return aliases.some((alias) => normalizedName === alias || normalizedName.includes(alias));
  }) || null;
}

function isAssignableRole(guild, role) {
  if (!role || role.managed || role.id === guild.roles.everyone.id) {
    return false;
  }

  const highestBotRole = guild.members.me?.roles?.highest;
  if (!highestBotRole) {
    return false;
  }

  return role.position < highestBotRole.position;
}

function findBestRoleMatch(guild, aliases) {
  const normalizedAliases = aliases.map(normalizeName);
  return guild.roles.cache
    .filter((role) => isAssignableRole(guild, role))
    .sort((left, right) => right.position - left.position)
    .find((role) => {
      const normalizedRoleName = normalizeName(role.name);
      return normalizedAliases.includes(normalizedRoleName);
    }) || null;
}

function collectRolePickerOptions(guild) {
  return ROLE_PICKER_GROUPS
    .map((group) => {
      const role = findBestRoleMatch(guild, group.aliases);
      if (!role) {
        return null;
      }

      return {
        label: group.label,
        value: role.id,
        description: `Выдаёт роль ${role.name}`.slice(0, 100),
        emoji: group.emoji
      };
    })
    .filter(Boolean)
    .slice(0, 25);
}

async function ensureRolePickerMessage(channel, options) {
  const messages = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  if (messages) {
    for (const message of messages.values()) {
      if (message.author.id !== channel.client.user.id) {
        continue;
      }

      await message.delete().catch(() => null);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0xa855f7)
    .setTitle("Ro Create | Выбор ролей")
    .setDescription(
      [
        "Выбери направления, в которых ты работаешь.",
        "",
        "Можно выбрать несколько ролей сразу. Если снять выбор, бот уберёт эту роль."
      ].join("\n")
    );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(ROLE_PICKER_CUSTOM_ID)
    .setPlaceholder("Выбери роли разработки")
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);
  return channel.send({ embeds: [embed], components: [row] });
}

async function setupServer(guild) {
  await guild.channels.fetch();
  await guild.roles.fetch();

  const instructions = [
    "Готово. Я ничего не менял в структуре сервера, а только обновил выбор ролей."
  ];

  const roleSelectionChannel = findRoleSelectionChannel(guild);
  if (!roleSelectionChannel) {
    instructions.push("Не нашёл канал выбора ролей. Назови его, например, `выбор-роли` или `роли`.");
    return { instructions };
  }

  const options = collectRolePickerOptions(guild);
  if (options.length === 0) {
    instructions.push("Не нашёл подходящих ролей разработчиков. Проверь названия ролей на сервере.");
    return { instructions };
  }

  await ensureRolePickerMessage(roleSelectionChannel, options);
  instructions.push(`Обновил сообщение в канале <#${roleSelectionChannel.id}>.`);
  instructions.push(`Нашёл роли: ${options.map((option) => option.label).join(", ")}.`);
  return { instructions };
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
  hasAdReviewerRole,
  ROLE_PICKER_CUSTOM_ID
};
