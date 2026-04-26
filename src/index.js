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
const { getTaskForDate } = require("./tasks");
const { setupServer, hasTaskReviewerRole, hasAdReviewerRole } = require("./setupServer");

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
    .setDescription("Создать роли и приватные тестовые каналы Ro Create"),
  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Показать баланс монет"),
  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Показать профиль разработчика"),
  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Получить ежедневный бонус"),
  new SlashCommandBuilder()
    .setName("work")
    .setDescription("Подработать и заработать монеты"),
  new SlashCommandBuilder()
    .setName("tasks")
    .setDescription("Посмотреть сегодняшнее ежедневное задание"),
  new SlashCommandBuilder()
    .setName("submit-task")
    .setDescription("Отправить ежедневное задание на проверку")
    .addAttachmentOption((option) =>
      option.setName("скриншот").setDescription("Скриншот выполненного задания").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("описание").setDescription("Что ты сделал и что проверить").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("post-ad")
    .setDescription("Отправить объявление на публикацию за монеты")
    .addStringOption((option) =>
      option.setName("название").setDescription("Название объявления").setRequired(true).setMaxLength(80)
    )
    .addStringOption((option) =>
      option
        .setName("категория")
        .setDescription("Категория объявления")
        .setRequired(true)
        .addChoices(
          { name: "Скриптер", value: "Скриптер" },
          { name: "Билдер", value: "Билдер" },
          { name: "UI/UX", value: "UI/UX" },
          { name: "3D-моделлер", value: "3D-моделлер" },
          { name: "Аниматор", value: "Аниматор" },
          { name: "Поиск команды", value: "Поиск команды" }
        )
    )
    .addStringOption((option) =>
      option.setName("описание").setDescription("Описание объявления").setRequired(true).setMaxLength(1000)
    )
    .addStringOption((option) =>
      option.setName("оплата").setDescription("Например: 5 000 Robux / договорная").setRequired(true)
    )
    .addAttachmentOption((option) =>
      option.setName("фото").setDescription("Превью или картинка к объявлению").setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("add-coins")
    .setDescription("Выдать монеты участнику вручную")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option.setName("пользователь").setDescription("Кому выдать").setRequired(true))
    .addIntegerOption((option) => option.setName("монеты").setDescription("Количество").setRequired(true))
].map((command) => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
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
      .setLabel("Принять")
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

async function findChannelByName(guild, name) {
  if (guild.channels.cache.size === 0) {
    await guild.channels.fetch();
  }

  return guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name === name
  );
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
        return interaction.reply({ content: "Эта команда работает только на сервере.", ephemeral: true });
      }

      const guild = interaction.guild;
      const member = interaction.member;

      if (interaction.commandName === "setup-server") {
        if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: "Для этой команды нужно право `Управлять сервером`.",
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });
        const result = await setupServer(guild, interaction.member);

        return interaction.editReply({
          content: `Ro Create настроен.\n${result.instructions.join("\n")}`
        });
      }

      if (interaction.commandName === "balance") {
        const userState = withState((state) => ensureUser(state, guild.id, interaction.user));
        return interaction.reply({
          content: `У тебя сейчас \`${userState.coins}\` монет.`,
          ephemeral: true
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

        return interaction.reply({ embeds: [embed], ephemeral: true });
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
            ephemeral: true
          });
        }

        return interaction.reply({
          content: `Ежедневный бонус получен: \`+${reward}\` монет. Новый баланс: \`${result.coins}\`.`,
          ephemeral: true
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
            ephemeral: true
          });
        }

        return interaction.reply({
          content: `Ты поработал и заработал \`+${result.reward}\` монет. Теперь у тебя \`${result.coins}\`.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "tasks") {
        const task = getTaskForDate();
        const embed = new EmbedBuilder()
          .setTitle(`Ежедневное задание: ${task.title}`)
          .setColor(0x22c55e)
          .setDescription(task.description)
          .addFields({ name: "Награда", value: `${task.reward} монет`, inline: true })
          .setFooter({ text: "Отправка идет через /submit-task" });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.commandName === "submit-task") {
        const task = getTaskForDate();
        const screenshot = interaction.options.getAttachment("скриншот", true);
        const description = interaction.options.getString("описание", true);
        const reviewChannel = await findChannelByName(guild, "проверка-заданий");

        if (!reviewChannel) {
          return interaction.reply({
            content: "Канал `проверка-заданий` не найден. Сначала выполни `/setup-server`.",
            ephemeral: true
          });
        }

        const submission = withState((state) => {
          ensureUser(state, guild.id, interaction.user);
          const id = String(state.counters.taskSubmission++);
          const record = {
            id,
            guildId: guild.id,
            userId: interaction.user.id,
            username: interaction.user.username,
            taskId: task.id,
            taskTitle: task.title,
            reward: task.reward,
            description,
            screenshotUrl: screenshot.url,
            status: "pending",
            createdAt: new Date().toISOString()
          };

          state.taskSubmissions[id] = record;
          return record;
        });

        const embed = new EmbedBuilder()
          .setTitle(`Проверка задания #${submission.id}`)
          .setColor(0xf59e0b)
          .setDescription(description)
          .addFields(
            { name: "Участник", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Задание", value: submission.taskTitle, inline: true },
            { name: "Награда", value: `${submission.reward} монет`, inline: true }
          )
          .setImage(screenshot.url)
          .setFooter({ text: `ID заявки: ${submission.id}` });

        const reviewMessage = await reviewChannel.send({
          embeds: [embed],
          components: [createTaskReviewRow(submission.id)]
        });

        withState((state) => {
          if (state.taskSubmissions[submission.id]) {
            state.taskSubmissions[submission.id].reviewChannelId = reviewMessage.channelId;
            state.taskSubmissions[submission.id].reviewMessageId = reviewMessage.id;
          }
        });

        return interaction.reply({
          content: "Заявка отправлена на проверку. После решения проверяющего бот напишет тебе в ЛС.",
          ephemeral: true
        });
      }

      if (interaction.commandName === "post-ad") {
        const title = interaction.options.getString("название", true);
        const category = interaction.options.getString("категория", true);
        const description = interaction.options.getString("описание", true);
        const payment = interaction.options.getString("оплата", true);
        const image = interaction.options.getAttachment("фото");
        const reviewChannel = await findChannelByName(guild, "проверка-объявлений");

        if (!reviewChannel) {
          return interaction.reply({
            content: "Канал `проверка-объявлений` не найден. Сначала выполни `/setup-server`.",
            ephemeral: true
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
            imageUrl: image ? image.url : null,
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
            ephemeral: true
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
          ephemeral: true
        });
      }

      if (interaction.commandName === "add-coins") {
        const target = interaction.options.getUser("пользователь", true);
        const amount = interaction.options.getInteger("монеты", true);

        const userState = withState((state) => {
          const targetState = ensureUser(state, guild.id, target);
          targetState.coins += amount;
          return targetState;
        });

        return interaction.reply({
          content: `${target} получил \`${amount}\` монет. Новый баланс: \`${userState.coins}\`.`,
          ephemeral: true
        });
      }
    }

    if (interaction.isButton()) {
      const [kind, action, submissionId] = interaction.customId.split(":");
      const state = loadState();

      if (kind === "task") {
        if (!hasTaskReviewerRole(interaction.member)) {
          return interaction.reply({ content: "У тебя нет прав на проверку заданий.", ephemeral: true });
        }

        const submission = state.taskSubmissions[submissionId];
        if (!submission || submission.status !== "pending") {
          return interaction.reply({ content: "Эта заявка уже обработана.", ephemeral: true });
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
            return interaction.reply({ content: "Эта заявка уже обработана.", ephemeral: true });
          }

          const user = await client.users.fetch(result.current.userId);
          await user.send(
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
          return interaction.reply({ content: "У тебя нет прав на проверку объявлений.", ephemeral: true });
        }

        const submission = state.adSubmissions[submissionId];
        if (!submission || submission.status !== "pending") {
          return interaction.reply({ content: "Это объявление уже обработано.", ephemeral: true });
        }

        if (action === "approve") {
          const adsChannel = await findChannelByName(interaction.guild, "объявления");
          if (!adsChannel) {
            return interaction.reply({
              content: "Канал `объявления` не найден. Сначала выполни `/setup-server`.",
              ephemeral: true
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

            return { current };
          });

          if (!result) {
            return interaction.reply({ content: "Это объявление уже обработано.", ephemeral: true });
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

          const user = await client.users.fetch(result.current.userId);
          await user.send(`Твое объявление #${result.current.id} одобрено и опубликовано.`).catch(() => null);

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
      const reason = interaction.fields.getTextInputValue("reason");

      if (kind === "task-reject-modal") {
        if (!hasTaskReviewerRole(interaction.member)) {
          return interaction.reply({ content: "У тебя нет прав на проверку заданий.", ephemeral: true });
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
          return interaction.reply({ content: "Эта заявка уже обработана.", ephemeral: true });
        }

        const user = await client.users.fetch(result.userId);
        await user.send(
          `Твое ежедневное задание #${result.id} отклонено. Причина: ${reason}`
        ).catch(() => null);

        const baseEmbed = new EmbedBuilder()
          .setTitle(`Проверка задания #${result.id}`)
          .setColor(0xef4444)
          .setDescription(result.description)
          .addFields(
            { name: "Участник", value: `<@${result.userId}>`, inline: true },
            { name: "Задание", value: result.taskTitle, inline: true },
            { name: "Награда", value: `${result.reward} монет`, inline: true },
            { name: "Статус", value: `Отклонено модератором <@${interaction.user.id}>` },
            { name: "Причина", value: reason }
          )
          .setFooter({ text: `ID заявки: ${result.id}` })
          .setImage(result.screenshotUrl);

        await updateStoredReviewMessage(interaction.guild, result, baseEmbed);

        return interaction.reply({
          content: "Заявка отклонена, причина отправлена пользователю в ЛС.",
          ephemeral: true
        });
      }

      if (kind === "ad-reject-modal") {
        if (!hasAdReviewerRole(interaction.member)) {
          return interaction.reply({ content: "У тебя нет прав на проверку объявлений.", ephemeral: true });
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
          return interaction.reply({ content: "Это объявление уже обработано.", ephemeral: true });
        }

        const user = await client.users.fetch(result.userId);
        await user.send(
          `Твое объявление #${result.id} отклонено. Монеты возвращены. Причина: ${reason}`
        ).catch(() => null);

        const baseEmbed = new EmbedBuilder()
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
          baseEmbed.setImage(result.imageUrl);
        }

        await updateStoredReviewMessage(interaction.guild, result, baseEmbed);

        return interaction.reply({
          content: "Объявление отклонено, монеты возвращены, автор уведомлен в ЛС.",
          ephemeral: true
        });
      }
    }
  } catch (error) {
    console.error(error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: "Что-то пошло не так. Проверь права бота и настройки `.env`.",
        ephemeral: true
      }).catch(() => null);
      return;
    }

    await interaction.reply({
      content: "Что-то пошло не так. Проверь права бота и настройки `.env`.",
      ephemeral: true
    }).catch(() => null);
  }
});

client.login(token);
