require("dotenv").config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { withState, ensureUser, loadState } = require("./storage");
const {
  setupServer,
  cleanupManagedArtifacts,
  hasTaskReviewerRole,
  hasAdReviewerRole,
  ROLE_PICKER_CUSTOM_ID
} = require("./setupServer");
const { ROLE_NAMES, managedTemplates } = require("./config/serverTemplate");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const announcementCost = Number(process.env.ANNOUNCEMENT_COST || 2000);

if (!token || !clientId || !guildId) {
  throw new Error("Нужно заполнить DISCORD_TOKEN, CLIENT_ID и GUILD_ID в .env");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages]
});

const commands = [
  new SlashCommandBuilder()
    .setName("setup-server")
    .setDescription("Configure Ro Create roles, access, and service channels")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("cleanup-bot")
    .setDescription("Remove old channels and categories previously created by the bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Show coin balance"),
  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Show developer profile"),
  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim daily reward"),
  new SlashCommandBuilder()
    .setName("work")
    .setDescription("Work and earn coins"),
  new SlashCommandBuilder()
    .setName("tasks")
    .setDescription("Show the current task"),
  new SlashCommandBuilder()
    .setName("publish-task")
    .setDescription("Publish the current task in the tasks channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option.setName("title").setDescription("Short task title").setRequired(true).setMaxLength(90)
    )
    .addStringOption((option) =>
      option.setName("description").setDescription("What needs to be done").setRequired(true).setMaxLength(1200)
    )
    .addIntegerOption((option) =>
      option.setName("reward").setDescription("How many coins to award").setRequired(true).setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName("post-ad")
    .setDescription("Submit an ad for moderation")
    .addStringOption((option) =>
      option.setName("title").setDescription("Ad title").setRequired(true).setMaxLength(80)
    )
    .addStringOption((option) =>
      option
        .setName("category")
        .setDescription("Ad category")
        .setRequired(true)
        .addChoices(
          { name: "Scripter", value: "Scripter" },
          { name: "Builder", value: "Builder" },
          { name: "UI/UX", value: "UI/UX" },
          { name: "3D Modeler", value: "3D Modeler" },
          { name: "Animator", value: "Animator" },
          { name: "Team Search", value: "Team Search" }
        )
    )
    .addStringOption((option) =>
      option.setName("description").setDescription("Ad description").setRequired(true).setMaxLength(1000)
    )
    .addStringOption((option) =>
      option.setName("payment").setDescription("Example: 5 000 Robux / negotiable").setRequired(true)
    )
    .addAttachmentOption((option) =>
      option.setName("image").setDescription("Preview image").setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("add-coins")
    .setDescription("Add coins to a member manually")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option.setName("user").setDescription("Who receives the coins").setRequired(true))
    .addIntegerOption((option) => option.setName("amount").setDescription("How many coins").setRequired(true))
].map((command) => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
}

function isUnknownInteractionError(error) {
  return error?.code === 10062;
}

function describeError(error) {
  if (!error) {
    return "Неизвестная ошибка.";
  }

  if (error.code === 50013) {
    return "Боту не хватает прав Discord. Проверь права на роли, каналы и треды.";
  }

  if (error.code === 50001) {
    return "У бота нет доступа к нужному серверу или каналу.";
  }

  if (error.code === "ENOSPC" || error.errno === -28) {
    return "На хостинге закончилось место на диске.";
  }

  return error.message || "Неизвестная ошибка.";
}

function canSeeTechnicalErrors(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function buildUserErrorMessage(interaction, error) {
  const detailed = describeError(error);

  if (canSeeTechnicalErrors(interaction)) {
    return `Что-то пошло не так: ${detailed}`;
  }

  return "Сейчас не удалось завершить действие. Попробуй еще раз чуть позже или напиши администрации.";
}

async function safeDeferReply(interaction, options) {
  try {
    await interaction.deferReply(options);
    return true;
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      return false;
    }
    throw error;
  }
}

function normalizeName(value) {
  return value.trim().toLowerCase();
}

function matchesAlias(channelName, aliases) {
  const normalized = normalizeName(channelName);
  return aliases.some((alias) => normalizeName(alias) === normalized);
}

async function findManagedChannel(guild, key) {
  const template = managedTemplates.find((entry) => entry.key === key);
  if (!template) {
    return null;
  }

  if (guild.channels.cache.size === 0) {
    await guild.channels.fetch();
  }

  const trackedId = loadState().managedArtifacts?.[guild.id]?.channels?.[key];
  if (trackedId) {
    const trackedChannel = guild.channels.cache.get(trackedId);
    if (trackedChannel?.type === ChannelType.GuildText) {
      return trackedChannel;
    }
  }

  return guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText
      && matchesAlias(channel.name, [template.name, ...(template.aliases || [])])
  );
}

function formatCooldown(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours} ч. ${minutes} мин.`;
  }

  return `${minutes} мин.`;
}

function createTaskReviewRow(submissionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`task:approve:${submissionId}`)
      .setLabel("Принять задание")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`task:reject:${submissionId}`)
      .setLabel("Отклонить")
      .setStyle(ButtonStyle.Danger)
  );
}

function createAdReviewRow(submissionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ad:approve:${submissionId}`)
      .setLabel("Опубликовать")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ad:reject:${submissionId}`)
      .setLabel("Отклонить")
      .setStyle(ButtonStyle.Danger)
  );
}

function createTaskThreadRow(threadId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`task:submitthread:${threadId}`)
      .setLabel("Отправить на проверку")
      .setStyle(ButtonStyle.Success)
  );
}

function buildTaskEmbed(task, dateKey) {
  return new EmbedBuilder()
    .setTitle(`\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u043e\u0435 \u0437\u0430\u0434\u0430\u043d\u0438\u0435: ${task.title}`)
    .setColor(0x22c55e)
    .setDescription(task.description)
    .addFields({ name: "\u041d\u0430\u0433\u0440\u0430\u0434\u0430", value: `${task.reward} \u043c\u043e\u043d\u0435\u0442`, inline: true })
    .setFooter({ text: `Daily Task ${dateKey}` });
}

function buildPublishedTaskEmbed(task) {
  return new EmbedBuilder()
    .setTitle(`\u0417\u0430\u0434\u0430\u043d\u0438\u0435: ${task.title}`)
    .setColor(0x22c55e)
    .setDescription(task.description)
    .addFields({ name: "\u041d\u0430\u0433\u0440\u0430\u0434\u0430", value: `${task.reward} \u043c\u043e\u043d\u0435\u0442`, inline: true })
    .setFooter({ text: `Task ${task.id}` });
}

function detectAttachmentKind(attachment) {
  const contentType = (attachment.contentType || "").toLowerCase();
  const url = (attachment.url || "").toLowerCase();

  if (contentType.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(url)) {
    return "image";
  }

  if (contentType.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv)$/i.test(url)) {
    return "video";
  }

  return "other";
}

function submissionMediaFields(submission) {
  const fields = [];

  if (submission.mediaUrl) {
    fields.push(`[Фото](${submission.mediaUrl})`);
  }

  if (submission.mediaUrl2) {
    fields.push(`[Видео](${submission.mediaUrl2})`);
  }

  return fields.length > 0 ? fields.join("\n") : "Не прикреплено";
}

async function publishCurrentTask(guild, task) {
  const channel = await findManagedChannel(guild, "tasks");
  if (!channel) {
    return null;
  }

  const embed = buildPublishedTaskEmbed(task);
  const state = loadState();
  const existingChannelId = state.currentTask?.channelId;
  const existingMessageId = state.currentTask?.messageId;

  let message = null;
  if (existingChannelId === channel.id && existingMessageId) {
    message = await channel.messages.fetch(existingMessageId).catch(() => null);
  }

  if (message) {
    await message.edit({
      content: "\u0410\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u043e\u0435 \u0437\u0430\u0434\u0430\u043d\u0438\u0435 \u0434\u043b\u044f \u0441\u0435\u0440\u0432\u0435\u0440\u0430:",
      embeds: [embed]
    });
    return message;
  }

  return channel.send({
    content: "\u0410\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u043e\u0435 \u0437\u0430\u0434\u0430\u043d\u0438\u0435 \u0434\u043b\u044f \u0441\u0435\u0440\u0432\u0435\u0440\u0430:",
    embeds: [embed]
  });
}

async function updateStoredReviewMessage(guild, submission, embed) {
  if (!submission.reviewChannelId || !submission.reviewMessageId) {
    return;
  }

  const channel = await guild.channels.fetch(submission.reviewChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return;
  }

  const message = await channel.messages.fetch(submission.reviewMessageId).catch(() => null);
  if (!message) {
    return;
  }

  await message.edit({ embeds: [embed], components: [] }).catch(() => null);
}

client.once("clientReady", async () => {
  await registerCommands();
  console.log(`Ro Create bot online as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: "Эта команда работает только на сервере.", flags: 64 });
      }

      const guild = interaction.guild;
      const member = interaction.member;

      if (interaction.commandName === "setup-server") {
        if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: "Для этой команды нужно право `Управлять сервером`.",
            flags: 64
          });
        }

        const accepted = await safeDeferReply(interaction, { flags: 64 });
        if (!accepted) {
          return;
        }
        const result = await setupServer(guild, interaction.member);

        return interaction.editReply({
          content: `Ro Create настроен.\n${result.instructions.join("\n")}`
        });
      }

      if (interaction.commandName === "cleanup-bot") {
        if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: "Для этой команды нужно право `Управлять сервером`.",
            flags: 64
          });
        }

        const accepted = await safeDeferReply(interaction, { flags: 64 });
        if (!accepted) {
          return;
        }
        const removed = await cleanupManagedArtifacts(guild);

        return interaction.editReply({
          content: removed.length > 0
            ? `Я убрал старые ботские каналы и категории: ${removed.join(", ")}`
            : "Я не нашел старых ботских каналов, которые можно безопасно удалить."
        });
      }

      if (interaction.commandName === "balance") {
        const userState = withState((state) => ensureUser(state, guild.id, interaction.user));
        return interaction.reply({
          content: `У тебя сейчас \`${userState.coins}\` монет.`,
          flags: 64
        });
      }

      if (interaction.commandName === "profile") {
        const userState = withState((state) => ensureUser(state, guild.id, interaction.user));
        const embed = new EmbedBuilder()
          .setTitle(`Профиль ${interaction.user.username}`)
          .setColor(0x3b82f6)
          .addFields(
            { name: "Монеты", value: String(userState.coins), inline: true },
            { name: "Репутация", value: String(userState.reputation), inline: true },
            { name: "Принято заданий", value: String(userState.acceptedTasks), inline: true },
            { name: "Опубликовано объявлений", value: String(userState.acceptedAds), inline: true }
          );

        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (interaction.commandName === "daily") {
        const now = Date.now();
        const cooldown = 24 * 60 * 60 * 1000;
        const reward = 150;

        const result = withState((state) => {
          const userState = ensureUser(state, guild.id, interaction.user);
          const last = userState.lastDailyAt ? new Date(userState.lastDailyAt).getTime() : 0;

          if (now - last < cooldown) {
            return { ok: false, remaining: cooldown - (now - last) };
          }

          userState.lastDailyAt = new Date(now).toISOString();
          userState.coins += reward;
          return { ok: true, coins: userState.coins, reward };
        });

        if (!result.ok) {
          return interaction.reply({
            content: `Ежедневный бонус уже получен. Возвращайся через ${formatCooldown(result.remaining)}.`,
            flags: 64
          });
        }

        return interaction.reply({
          content: `Ежедневный бонус получен: \`+${reward}\` монет. Новый баланс: \`${result.coins}\`.`,
          flags: 64
        });
      }

      if (interaction.commandName === "work") {
        const now = Date.now();
        const cooldown = 3 * 60 * 60 * 1000;
        const reward = 120 + Math.floor(Math.random() * 141);

        const result = withState((state) => {
          const userState = ensureUser(state, guild.id, interaction.user);
          const last = userState.lastWorkAt ? new Date(userState.lastWorkAt).getTime() : 0;

          if (now - last < cooldown) {
            return { ok: false, remaining: cooldown - (now - last) };
          }

          userState.lastWorkAt = new Date(now).toISOString();
          userState.coins += reward;
          return { ok: true, reward, coins: userState.coins };
        });

        if (!result.ok) {
          return interaction.reply({
            content: `Подработка пока на кулдауне. Возвращайся через ${formatCooldown(result.remaining)}.`,
            flags: 64
          });
        }

        return interaction.reply({
          content: `Ты поработал и заработал \`+${result.reward}\` монет. Теперь у тебя \`${result.coins}\`.`,
          flags: 64
        });
      }

      if (interaction.commandName === "tasks") {
        const task = loadState().currentTask;
        if (!task) {
          return interaction.reply({
            content: "\u0421\u0435\u0439\u0447\u0430\u0441 \u043d\u0435\u0442 \u043e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u043d\u043d\u043e\u0433\u043e \u0437\u0430\u0434\u0430\u043d\u0438\u044f. \u041f\u0443\u0441\u0442\u044c \u0430\u0434\u043c\u0438\u043d \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442 \u0435\u0433\u043e \u0447\u0435\u0440\u0435\u0437 /publish-task.",
            flags: 64
          });
        }

        return interaction.reply({
          embeds: [buildPublishedTaskEmbed(task)],
          flags: 64
        });
      }

      if (interaction.commandName === "publish-task") {
        if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: "\u0414\u043b\u044f \u044d\u0442\u043e\u0439 \u043a\u043e\u043c\u0430\u043d\u0434\u044b \u043d\u0443\u0436\u043d\u043e \u043f\u0440\u0430\u0432\u043e `\u0423\u043f\u0440\u0430\u0432\u043b\u044f\u0442\u044c \u0441\u0435\u0440\u0432\u0435\u0440\u043e\u043c`.",
            flags: 64
          });
        }

        const task = {
          id: String(Date.now()),
          title: interaction.options.getString("title", true),
          description: interaction.options.getString("description", true),
          reward: interaction.options.getInteger("reward", true),
          publishedAt: new Date().toISOString(),
          publishedBy: interaction.user.id
        };

        const message = await publishCurrentTask(guild, task);
        if (!message) {
          return interaction.reply({
            content: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043d\u0430\u0439\u0442\u0438 \u043a\u0430\u043d\u0430\u043b \u0441 \u0437\u0430\u0434\u0430\u043d\u0438\u044f\u043c\u0438. \u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u044b\u043f\u043e\u043b\u043d\u0438 /setup-server.",
            flags: 64
          });
        }

        withState((state) => {
          state.currentTask = {
            ...task,
            channelId: message.channelId,
            messageId: message.id
          };
        });

        return interaction.reply({
          content: `\u0417\u0430\u0434\u0430\u043d\u0438\u0435 \u043e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u043d\u043e. \u041d\u0430\u0433\u0440\u0430\u0434\u0430: ${task.reward} \u043c\u043e\u043d\u0435\u0442.`,
          flags: 64
        });
      }

      if (interaction.commandName === "post-ad") {
        const title = interaction.options.getString("title", true);
        const category = interaction.options.getString("category", true);
        const description = interaction.options.getString("description", true);
        const payment = interaction.options.getString("payment", true);
        const image = interaction.options.getAttachment("image", false);
        const reviewChannel = await findManagedChannel(guild, "adReview");

        if (!reviewChannel) {
          return interaction.reply({
            content: "Канал проверки объявлений не найден. Сначала выполни `/setup-server`.",
            flags: 64
          });
        }

        const result = withState((state) => {
          const userState = ensureUser(state, guild.id, interaction.user);
          if (userState.coins < announcementCost) {
            return { ok: false, coins: userState.coins };
          }

          userState.coins -= announcementCost;
          const id = String(state.counters.adSubmission++);
          const record = {
            id,
            guildId: guild.id,
            userId: interaction.user.id,
            username: interaction.user.username,
            title,
            category,
            description,
            payment,
            imageUrl: image?.url || null,
            cost: announcementCost,
            status: "pending",
            createdAt: new Date().toISOString()
          };

          state.adSubmissions[id] = record;
          return { ok: true, record, remaining: userState.coins };
        });

        if (!result.ok) {
          return interaction.reply({
            content: `Для публикации нужно \`${announcementCost}\` монет. Сейчас у тебя \`${result.coins}\`.`,
            flags: 64
          });
        }

        const embed = new EmbedBuilder()
          .setTitle(`Объявление на модерацию #${result.record.id}`)
          .setColor(0x3b82f6)
          .setDescription(result.record.description)
          .addFields(
            { name: "Автор", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Категория", value: category, inline: true },
            { name: "Оплата", value: payment, inline: true },
            { name: "Списано", value: `${announcementCost} монет`, inline: true }
          )
          .setFooter({ text: title });

        if (result.record.imageUrl) {
          embed.setImage(result.record.imageUrl);
        }

        const reviewMessage = await reviewChannel.send({
          embeds: [embed],
          components: [createAdReviewRow(result.record.id)]
        });

        withState((state) => {
          if (state.adSubmissions[result.record.id]) {
            state.adSubmissions[result.record.id].reviewChannelId = reviewMessage.channelId;
            state.adSubmissions[result.record.id].reviewMessageId = reviewMessage.id;
          }
        });

        return interaction.reply({
          content: `Объявление отправлено на проверку. С баланса списано \`${announcementCost}\` монет, осталось \`${result.remaining}\`.`,
          flags: 64
        });
      }

      if (interaction.commandName === "add-coins") {
        if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: "Для этой команды нужно право `Управлять сервером`.",
            flags: 64
          });
        }

        const target = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);

        const userState = withState((state) => {
          const targetState = ensureUser(state, guild.id, target);
          targetState.coins += amount;
          return targetState;
        });

        return interaction.reply({
          content: `${target} получил \`${amount}\` монет. Новый баланс: \`${userState.coins}\`.`,
          flags: 64
        });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === ROLE_PICKER_CUSTOM_ID) {
        const member = interaction.member;
        const selectedRoleIds = new Set(interaction.values);
        const allRoleIds = new Set(
          (interaction.component.options || [])
            .map((option) => option.value)
            .filter(Boolean)
        );

        const rolesToRemove = member.roles.cache.filter((role) =>
          allRoleIds.has(role.id) && !selectedRoleIds.has(role.id)
        );

        const rolesToAdd = [...selectedRoleIds]
          .map((roleId) => interaction.guild.roles.cache.get(roleId))
          .filter((role) =>
            role
            && !role.managed
            && role.position < interaction.guild.members.me.roles.highest.position
            && !member.roles.cache.has(role.id)
          );

        if (rolesToAdd.length > 0) {
          await member.roles.add(rolesToAdd, "Ro Create role picker");
        }

        if (rolesToRemove.size > 0) {
          await member.roles.remove(rolesToRemove, "Ro Create role picker");
        }

        const selectedNames = [...selectedRoleIds]
          .map((roleId) => interaction.guild.roles.cache.get(roleId))
          .filter(Boolean)
          .map((role) => role.name);

        return interaction.reply({
          content: selectedNames.length > 0
            ? `Готово. Твои роли обновлены: ${selectedNames.join(", ")}.`
            : "Готово. Я убрал выбранные роли разработки.",
          flags: 64
        });
      }
    }

    if (interaction.isButton()) {
      const [kind, action, submissionId] = interaction.customId.split(":");

      if (kind === "task" && action === "start") {
        const modal = new ModalBuilder()
          .setCustomId("task-start-modal")
          .setTitle("Новое задание");

        const commentInput = new TextInputBuilder()
          .setCustomId("comment")
          .setLabel("Что ты сделал")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(600);

        modal.addComponents(new ActionRowBuilder().addComponents(commentInput));
        return interaction.showModal(modal);
      }

      if (kind === "verify" && action === "grant") {
        const verifiedRole = interaction.guild.roles.cache.find((role) => role.name === ROLE_NAMES.verified);
        if (!verifiedRole) {
          return interaction.reply({
            content: "Роль `Верифицирован` пока не найдена. Сначала выполни `/setup-server`.",
            flags: 64
          });
        }

        if (interaction.member.roles.cache.has(verifiedRole.id)) {
          return interaction.reply({
            content: "Ты уже прошел верификацию. Добро пожаловать в основной сервер.",
            flags: 64
          });
        }

        await interaction.member.roles.add(verifiedRole, "Верификация через кнопку Ro Create");
        return interaction.reply({
          content: `Готово. Тебе выдана роль <@&${verifiedRole.id}>, и основные каналы уже открыты.`,
          flags: 64
        });
      }

      if (kind === "task" && action === "submitthread") {
        const state = loadState();
        const draft = state.taskDrafts[submissionId];

        if (!draft) {
          return interaction.reply({
            content: "Черновик этой отправки уже закрыт или не найден.",
            flags: 64
          });
        }

        if (draft.userId !== interaction.user.id && !hasTaskReviewerRole(interaction.member)) {
          return interaction.reply({
            content: "Эта ветка не принадлежит тебе.",
            flags: 64
          });
        }

        const thread = interaction.channel;
        const messages = await thread.messages.fetch({ limit: 50 }).catch(() => null);
        const attachments = [];

        for (const message of messages?.values() || []) {
          if (message.author.id !== draft.userId) {
            continue;
          }

          for (const attachment of message.attachments.values()) {
            attachments.push({
              url: attachment.url,
              contentType: attachment.contentType || null
            });
          }
        }

        const imageAttachment = attachments.find((attachment) => detectAttachmentKind(attachment) === "image");
        const videoAttachment = attachments.find((attachment) => detectAttachmentKind(attachment) === "video");

        if (!imageAttachment && !videoAttachment) {
          return interaction.reply({
            content: "Для отправки нужно прикрепить хотя бы одно фото или одно видео. После этого нажми кнопку еще раз.",
            flags: 64
          });
        }

        const reviewChannel = await findManagedChannel(interaction.guild, "taskReview");
        if (!reviewChannel) {
          return interaction.reply({
            content: "Канал проверки заданий не найден. Сначала выполни `/setup-server`.",
            flags: 64
          });
        }

        const submission = withState((mutable) => {
          const currentDraft = mutable.taskDrafts[submissionId];
          if (!currentDraft) {
            return null;
          }

          const id = String(mutable.counters.taskSubmission++);
          const record = {
            id,
            guildId: interaction.guildId,
            userId: currentDraft.userId,
            username: currentDraft.username,
            taskId: currentDraft.taskId,
            taskTitle: currentDraft.taskTitle,
            reward: currentDraft.reward,
            comment: currentDraft.comment,
            mediaUrl: imageAttachment?.url || null,
            mediaUrl2: videoAttachment?.url || null,
            mediaContentType: imageAttachment?.contentType || videoAttachment?.contentType || null,
            threadId: submissionId,
            status: "pending",
            createdAt: new Date().toISOString()
          };

          mutable.taskSubmissions[id] = record;
          delete mutable.taskDrafts[submissionId];
          return record;
        });

        if (!submission) {
          return interaction.reply({
            content: "Черновик этой отправки уже закрыт.",
            flags: 64
          });
        }

        const embed = new EmbedBuilder()
          .setTitle(`Проверка задания #${submission.id}`)
          .setColor(0xf59e0b)
          .setDescription(submission.comment)
          .addFields(
            { name: "Участник", value: `<@${submission.userId}>`, inline: true },
            { name: "Задание", value: submission.taskTitle, inline: true },
            { name: "Награда", value: `${submission.reward} монет`, inline: true },
            { name: "Медиа", value: submissionMediaFields(submission) }
          )
          .setFooter({ text: `ID заявки: ${submission.id}` });

        if (submission.mediaContentType?.startsWith("image/")) {
          embed.setImage(submission.mediaUrl);
        }

        const reviewMessage = await reviewChannel.send({
          embeds: [embed],
          components: [createTaskReviewRow(submission.id)]
        });

        withState((mutable) => {
          if (mutable.taskSubmissions[submission.id]) {
            mutable.taskSubmissions[submission.id].reviewChannelId = reviewMessage.channelId;
            mutable.taskSubmissions[submission.id].reviewMessageId = reviewMessage.id;
          }
        });

        await thread.send(`Готово. Я отправил твою работу на проверку. Награда за это задание: ${submission.reward} монет.`).catch(() => null);
        await thread.setArchived(true).catch(() => null);

        return interaction.reply({
          content: "Заявка отправлена на проверку.",
          flags: 64
        });
      }

      const state = loadState();

      if (kind === "task") {
        if (!hasTaskReviewerRole(interaction.member)) {
          return interaction.reply({ content: "У тебя нет прав на проверку заданий.", flags: 64 });
        }

        const submission = state.taskSubmissions[submissionId];
        if (!submission || submission.status !== "pending") {
          return interaction.reply({ content: "Эта заявка уже обработана.", flags: 64 });
        }

        if (action === "approve") {
          const result = withState((mutable) => {
            const current = mutable.taskSubmissions[submissionId];
            if (!current || current.status !== "pending") {
              return null;
            }

            current.status = "approved";
            current.reviewedBy = interaction.user.id;
            current.reviewedAt = new Date().toISOString();

            const userState = ensureUser(mutable, interaction.guildId, { id: current.userId, username: current.username });
            userState.coins += current.reward;
            userState.acceptedTasks += 1;

            return { current, userState };
          });

          if (!result) {
            return interaction.reply({ content: "Эта заявка уже обработана.", flags: 64 });
          }

          const user = await client.users.fetch(result.current.userId).catch(() => null);
          await user?.send(
            `Твое ежедневное задание #${result.current.id} принято. Начислено ${result.current.reward} монет.`
          ).catch(() => null);

          const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x22c55e)
            .addFields({ name: "Статус", value: `Принято модератором <@${interaction.user.id}>` });

          return interaction.update({ embeds: [approvedEmbed], components: [] });
        }

        if (action === "reject") {
          const modal = new ModalBuilder()
            .setCustomId(`task-reject-modal:${submissionId}`)
            .setTitle("Причина отклонения");

          const reasonInput = new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Почему заявка отклонена")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(400);

          modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
          return interaction.showModal(modal);
        }
      }

      if (kind === "ad") {
        if (!hasAdReviewerRole(interaction.member)) {
          return interaction.reply({ content: "У тебя нет прав на проверку объявлений.", flags: 64 });
        }

        const submission = state.adSubmissions[submissionId];
        if (!submission || submission.status !== "pending") {
          return interaction.reply({ content: "Это объявление уже обработано.", flags: 64 });
        }

        if (action === "approve") {
          const adsChannel = await findManagedChannel(interaction.guild, "ads");
          if (!adsChannel) {
            return interaction.reply({
              content: "Канал объявлений не найден. Сначала выполни `/setup-server`.",
              flags: 64
            });
          }

          const result = withState((mutable) => {
            const current = mutable.adSubmissions[submissionId];
            if (!current || current.status !== "pending") {
              return null;
            }

            current.status = "approved";
            current.reviewedBy = interaction.user.id;
            current.reviewedAt = new Date().toISOString();

            const userState = ensureUser(mutable, interaction.guildId, { id: current.userId, username: current.username });
            userState.acceptedAds += 1;
            return { current, userState };
          });

          if (!result) {
            return interaction.reply({ content: "Это объявление уже обработано.", flags: 64 });
          }

          const publicEmbed = new EmbedBuilder()
            .setTitle(result.current.title)
            .setColor(0x3b82f6)
            .setDescription(result.current.description)
            .addFields(
              { name: "Категория", value: result.current.category, inline: true },
              { name: "Оплата", value: result.current.payment, inline: true },
              { name: "Автор", value: `<@${result.current.userId}>`, inline: true }
            )
            .setFooter({ text: "Объявление Ro Create" });

          if (result.current.imageUrl) {
            publicEmbed.setImage(result.current.imageUrl);
          }

          await adsChannel.send({ embeds: [publicEmbed] });

          const user = await client.users.fetch(result.current.userId).catch(() => null);
          await user?.send(`Твое объявление #${result.current.id} одобрено и опубликовано.`).catch(() => null);

          const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x22c55e)
            .addFields({ name: "Статус", value: `Опубликовано модератором <@${interaction.user.id}>` });

          return interaction.update({ embeds: [approvedEmbed], components: [] });
        }

        if (action === "reject") {
          const modal = new ModalBuilder()
            .setCustomId(`ad-reject-modal:${submissionId}`)
            .setTitle("Причина отклонения объявления");

          const reasonInput = new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Почему объявление отклонено")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(400);

          modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
          return interaction.showModal(modal);
        }
      }
    }

    if (interaction.isModalSubmit()) {
      const [kind, submissionId] = interaction.customId.split(":");
      const reason = interaction.fields.fields.has("reason")
        ? interaction.fields.getTextInputValue("reason")
        : null;

      if (interaction.customId === "task-start-modal") {
        const comment = interaction.fields.getTextInputValue("comment");
        const task = loadState().currentTask;
        const taskSubmitChannel = await findManagedChannel(interaction.guild, "taskSubmit");

        if (!task) {
          return interaction.reply({
            content: "\u0421\u0435\u0439\u0447\u0430\u0441 \u043d\u0435\u0442 \u0430\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u043e\u0433\u043e \u0437\u0430\u0434\u0430\u043d\u0438\u044f. \u041f\u0443\u0441\u0442\u044c \u0430\u0434\u043c\u0438\u043d \u0441\u043d\u0430\u0447\u0430\u043b\u0430 \u043e\u043f\u0443\u0431\u043b\u0438\u043a\u0443\u0435\u0442 \u0435\u0433\u043e \u0447\u0435\u0440\u0435\u0437 /publish-task.",
            flags: 64
          });
        }

        if (!taskSubmitChannel) {
          return interaction.reply({
            content: "Канал отправки заданий не найден. Сначала выполни `/setup-server`.",
            flags: 64
          });
        }

        const threadName = `task-${interaction.user.username}`
          .toLowerCase()
          .replace(/[^a-z0-9-_]/gi, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80) || `task-${interaction.user.id}`;
        let thread;

        try {
          thread = await taskSubmitChannel.threads.create({
            name: threadName,
            autoArchiveDuration: 1440,
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: "Ro Create task submission thread"
          });
        } catch (error) {
          console.error(error);
          return interaction.reply({
            content: canSeeTechnicalErrors(interaction)
              ? `Не удалось открыть приватную ветку для задания. ${describeError(error)}`
              : "Не удалось открыть приватную ветку для задания. Попробуй еще раз чуть позже или напиши администрации.",
            flags: 64
          }).catch(() => null);
        }

        await thread.members.add(interaction.user.id).catch(() => null);

        withState((mutable) => {
          mutable.taskDrafts[thread.id] = {
            threadId: thread.id,
            guildId: interaction.guildId,
            userId: interaction.user.id,
            username: interaction.user.username,
            taskId: task.id,
            taskTitle: task.title,
            reward: task.reward,
            comment,
            createdAt: new Date().toISOString()
          };
        });

        await thread.send({
          content: [
            `\u0417\u0430\u0434\u0430\u043d\u0438\u0435: **${task.title}**`,
            `\u041d\u0430\u0433\u0440\u0430\u0434\u0430: **${task.reward} \u043c\u043e\u043d\u0435\u0442**`,
            "",
            "Теперь прикрепи сюда фото, видео или оба варианта сразу одним или несколькими сообщениями. Комментарий я уже сохранил. Потом нажми кнопку ниже."
          ].join("\n"),
          components: [createTaskThreadRow(thread.id)]
        });

        return interaction.reply({
          content: `Я открыл тебе приватную ветку для загрузки задания: <#${thread.id}>`,
          flags: 64
        });
      }

      if (kind === "task-reject-modal") {
        if (!hasTaskReviewerRole(interaction.member)) {
          return interaction.reply({ content: "У тебя нет прав на проверку заданий.", flags: 64 });
        }

        const result = withState((mutable) => {
          const submission = mutable.taskSubmissions[submissionId];
          if (!submission || submission.status !== "pending") {
            return null;
          }

          submission.status = "rejected";
          submission.reviewedBy = interaction.user.id;
          submission.reviewedAt = new Date().toISOString();
          submission.rejectReason = reason;
          return submission;
        });

        if (!result) {
          return interaction.reply({ content: "Эта заявка уже обработана.", flags: 64 });
        }

        const user = await client.users.fetch(result.userId).catch(() => null);
        await user?.send(`Твое ежедневное задание #${result.id} отклонено. Причина: ${reason}`).catch(() => null);

        const embed = new EmbedBuilder()
          .setTitle(`Проверка задания #${result.id}`)
          .setColor(0xef4444)
          .setDescription(result.comment)
          .addFields(
            { name: "Участник", value: `<@${result.userId}>`, inline: true },
            { name: "Задание", value: result.taskTitle, inline: true },
            { name: "Награда", value: `${result.reward} монет`, inline: true },
            { name: "Медиа", value: submissionMediaFields(result) },
            { name: "Статус", value: `Отклонено модератором <@${interaction.user.id}>` },
            { name: "Причина", value: reason }
          )
          .setFooter({ text: `ID заявки: ${result.id}` });

        if (result.mediaContentType?.startsWith("image/")) {
          embed.setImage(result.mediaUrl);
        }

        await updateStoredReviewMessage(interaction.guild, result, embed);
        return interaction.reply({
          content: "Заявка отклонена, причина отправлена пользователю в ЛС.",
          flags: 64
        });
      }

      if (kind === "ad-reject-modal") {
        if (!hasAdReviewerRole(interaction.member)) {
          return interaction.reply({ content: "У тебя нет прав на проверку объявлений.", flags: 64 });
        }

        const result = withState((mutable) => {
          const submission = mutable.adSubmissions[submissionId];
          if (!submission || submission.status !== "pending") {
            return null;
          }

          submission.status = "rejected";
          submission.reviewedBy = interaction.user.id;
          submission.reviewedAt = new Date().toISOString();
          submission.rejectReason = reason;

          const userState = ensureUser(mutable, interaction.guildId, { id: submission.userId, username: submission.username });
          userState.coins += submission.cost;
          return submission;
        });

        if (!result) {
          return interaction.reply({ content: "Это объявление уже обработано.", flags: 64 });
        }

        const user = await client.users.fetch(result.userId).catch(() => null);
        await user?.send(
          `Твое объявление #${result.id} отклонено. Монеты возвращены. Причина: ${reason}`
        ).catch(() => null);

        const embed = new EmbedBuilder()
          .setTitle(`Объявление на модерацию #${result.id}`)
          .setColor(0xef4444)
          .setDescription(result.description)
          .addFields(
            { name: "Автор", value: `<@${result.userId}>`, inline: true },
            { name: "Категория", value: result.category, inline: true },
            { name: "Оплата", value: result.payment, inline: true },
            { name: "Статус", value: `Отклонено модератором <@${interaction.user.id}>` },
            { name: "Причина", value: reason }
          )
          .setFooter({ text: result.title });

        if (result.imageUrl) {
          embed.setImage(result.imageUrl);
        }

        await updateStoredReviewMessage(interaction.guild, result, embed);
        return interaction.reply({
          content: "Объявление отклонено, монеты возвращены, автор уведомлен в ЛС.",
          flags: 64
        });
      }
    }
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      return;
    }

    console.error(error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: buildUserErrorMessage(interaction, error),
        flags: 64
      }).catch(() => null);
      return;
    }

    await interaction.reply({
      content: buildUserErrorMessage(interaction, error),
      flags: 64
    }).catch(() => null);
  }
});

client.login(token);

