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
const { setupServer, cleanupManagedArtifacts, hasTaskReviewerRole, hasAdReviewerRole } = require("./setupServer");
const { ROLE_NAMES, managedTemplates } = require("./config/serverTemplate");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const announcementCost = Number(process.env.ANNOUNCEMENT_COST || 2000);

if (!token || !clientId || !guildId) {
  throw new Error("РќСѓР¶РЅРѕ Р·Р°РїРѕР»РЅРёС‚СЊ DISCORD_TOKEN, CLIENT_ID Рё GUILD_ID РІ .env");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages]
});

const commands = [
  new SlashCommandBuilder()
    .setName("setup-server")
    .setDescription("Configure Ro Create roles, access, and service channels"),
  new SlashCommandBuilder()
    .setName("cleanup-bot")
    .setDescription("Remove old channels and categories previously created by the bot"),
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
    return `${hours} С‡. ${minutes} РјРёРЅ.`;
  }

  return `${minutes} РјРёРЅ.`;
}

function createTaskReviewRow(submissionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`task:approve:${submissionId}`)
      .setLabel("РџСЂРёРЅСЏС‚СЊ Р·Р°РґР°РЅРёРµ")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`task:reject:${submissionId}`)
      .setLabel("РћС‚РєР»РѕРЅРёС‚СЊ")
      .setStyle(ButtonStyle.Danger)
  );
}

function createAdReviewRow(submissionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ad:approve:${submissionId}`)
      .setLabel("РћРїСѓР±Р»РёРєРѕРІР°С‚СЊ")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ad:reject:${submissionId}`)
      .setLabel("РћС‚РєР»РѕРЅРёС‚СЊ")
      .setStyle(ButtonStyle.Danger)
  );
}

function createTaskThreadRow(threadId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`task:submitthread:${threadId}`)
      .setLabel("РћС‚РїСЂР°РІРёС‚СЊ РЅР° РїСЂРѕРІРµСЂРєСѓ")
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
        return interaction.reply({ content: "Р­С‚Р° РєРѕРјР°РЅРґР° СЂР°Р±РѕС‚Р°РµС‚ С‚РѕР»СЊРєРѕ РЅР° СЃРµСЂРІРµСЂРµ.", flags: 64 });
      }

      const guild = interaction.guild;
      const member = interaction.member;

      if (interaction.commandName === "setup-server") {
        if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: "Р”Р»СЏ СЌС‚РѕР№ РєРѕРјР°РЅРґС‹ РЅСѓР¶РЅРѕ РїСЂР°РІРѕ `РЈРїСЂР°РІР»СЏС‚СЊ СЃРµСЂРІРµСЂРѕРј`.",
            flags: 64
          });
        }

        const accepted = await safeDeferReply(interaction, { flags: 64 });
        if (!accepted) {
          return;
        }
        const result = await setupServer(guild, interaction.member);

        return interaction.editReply({
          content: `Ro Create РЅР°СЃС‚СЂРѕРµРЅ.\n${result.instructions.join("\n")}`
        });
      }

      if (interaction.commandName === "cleanup-bot") {
        if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: "Р”Р»СЏ СЌС‚РѕР№ РєРѕРјР°РЅРґС‹ РЅСѓР¶РЅРѕ РїСЂР°РІРѕ `РЈРїСЂР°РІР»СЏС‚СЊ СЃРµСЂРІРµСЂРѕРј`.",
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
            ? `РЇ СѓР±СЂР°Р» СЃС‚Р°СЂС‹Рµ Р±РѕС‚СЃРєРёРµ РєР°РЅР°Р»С‹ Рё РєР°С‚РµРіРѕСЂРёРё: ${removed.join(", ")}`
            : "РЇ РЅРµ РЅР°С€РµР» СЃС‚Р°СЂС‹С… Р±РѕС‚СЃРєРёС… РєР°РЅР°Р»РѕРІ, РєРѕС‚РѕСЂС‹Рµ РјРѕР¶РЅРѕ Р±РµР·РѕРїР°СЃРЅРѕ СѓРґР°Р»РёС‚СЊ."
        });
      }

      if (interaction.commandName === "balance") {
        const userState = withState((state) => ensureUser(state, guild.id, interaction.user));
        return interaction.reply({
          content: `РЈ С‚РµР±СЏ СЃРµР№С‡Р°СЃ \`${userState.coins}\` РјРѕРЅРµС‚.`,
          flags: 64
        });
      }

      if (interaction.commandName === "profile") {
        const userState = withState((state) => ensureUser(state, guild.id, interaction.user));
        const embed = new EmbedBuilder()
          .setTitle(`РџСЂРѕС„РёР»СЊ ${interaction.user.username}`)
          .setColor(0x3b82f6)
          .addFields(
            { name: "РњРѕРЅРµС‚С‹", value: String(userState.coins), inline: true },
            { name: "Р РµРїСѓС‚Р°С†РёСЏ", value: String(userState.reputation), inline: true },
            { name: "РџСЂРёРЅСЏС‚Рѕ Р·Р°РґР°РЅРёР№", value: String(userState.acceptedTasks), inline: true },
            { name: "РћРїСѓР±Р»РёРєРѕРІР°РЅРѕ РѕР±СЉСЏРІР»РµРЅРёР№", value: String(userState.acceptedAds), inline: true }
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
            content: `Р•Р¶РµРґРЅРµРІРЅС‹Р№ Р±РѕРЅСѓСЃ СѓР¶Рµ РїРѕР»СѓС‡РµРЅ. Р’РѕР·РІСЂР°С‰Р°Р№СЃСЏ С‡РµСЂРµР· ${formatCooldown(result.remaining)}.`,
            flags: 64
          });
        }

        return interaction.reply({
          content: `Р•Р¶РµРґРЅРµРІРЅС‹Р№ Р±РѕРЅСѓСЃ РїРѕР»СѓС‡РµРЅ: \`+${reward}\` РјРѕРЅРµС‚. РќРѕРІС‹Р№ Р±Р°Р»Р°РЅСЃ: \`${result.coins}\`.`,
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
            content: `РџРѕРґСЂР°Р±РѕС‚РєР° РїРѕРєР° РЅР° РєСѓР»РґР°СѓРЅРµ. Р’РѕР·РІСЂР°С‰Р°Р№СЃСЏ С‡РµСЂРµР· ${formatCooldown(result.remaining)}.`,
            flags: 64
          });
        }

        return interaction.reply({
          content: `РўС‹ РїРѕСЂР°Р±РѕС‚Р°Р» Рё Р·Р°СЂР°Р±РѕС‚Р°Р» \`+${result.reward}\` РјРѕРЅРµС‚. РўРµРїРµСЂСЊ Сѓ С‚РµР±СЏ \`${result.coins}\`.`,
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
            content: "РљР°РЅР°Р» РїСЂРѕРІРµСЂРєРё РѕР±СЉСЏРІР»РµРЅРёР№ РЅРµ РЅР°Р№РґРµРЅ. РЎРЅР°С‡Р°Р»Р° РІС‹РїРѕР»РЅРё `/setup-server`.",
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
            content: `Р”Р»СЏ РїСѓР±Р»РёРєР°С†РёРё РЅСѓР¶РЅРѕ \`${announcementCost}\` РјРѕРЅРµС‚. РЎРµР№С‡Р°СЃ Сѓ С‚РµР±СЏ \`${result.coins}\`.`,
            flags: 64
          });
        }

        const embed = new EmbedBuilder()
          .setTitle(`РћР±СЉСЏРІР»РµРЅРёРµ РЅР° РјРѕРґРµСЂР°С†РёСЋ #${result.record.id}`)
          .setColor(0x3b82f6)
          .setDescription(result.record.description)
          .addFields(
            { name: "РђРІС‚РѕСЂ", value: `<@${interaction.user.id}>`, inline: true },
            { name: "РљР°С‚РµРіРѕСЂРёСЏ", value: category, inline: true },
            { name: "РћРїР»Р°С‚Р°", value: payment, inline: true },
            { name: "РЎРїРёСЃР°РЅРѕ", value: `${announcementCost} РјРѕРЅРµС‚`, inline: true }
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
          content: `РћР±СЉСЏРІР»РµРЅРёРµ РѕС‚РїСЂР°РІР»РµРЅРѕ РЅР° РїСЂРѕРІРµСЂРєСѓ. РЎ Р±Р°Р»Р°РЅСЃР° СЃРїРёСЃР°РЅРѕ \`${announcementCost}\` РјРѕРЅРµС‚, РѕСЃС‚Р°Р»РѕСЃСЊ \`${result.remaining}\`.`,
          flags: 64
        });
      }

      if (interaction.commandName === "add-coins") {
        const target = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);

        const userState = withState((state) => {
          const targetState = ensureUser(state, guild.id, target);
          targetState.coins += amount;
          return targetState;
        });

        return interaction.reply({
          content: `${target} РїРѕР»СѓС‡РёР» \`${amount}\` РјРѕРЅРµС‚. РќРѕРІС‹Р№ Р±Р°Р»Р°РЅСЃ: \`${userState.coins}\`.`,
          flags: 64
        });
      }
    }

    if (interaction.isButton()) {
      const [kind, action, submissionId] = interaction.customId.split(":");

      if (kind === "task" && action === "start") {
        const modal = new ModalBuilder()
          .setCustomId("task-start-modal")
          .setTitle("РќРѕРІРѕРµ Р·Р°РґР°РЅРёРµ");

        const commentInput = new TextInputBuilder()
          .setCustomId("comment")
          .setLabel("Р§С‚Рѕ С‚С‹ СЃРґРµР»Р°Р»")
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
            content: "Р РѕР»СЊ `Р’РµСЂРёС„РёС†РёСЂРѕРІР°РЅ` РїРѕРєР° РЅРµ РЅР°Р№РґРµРЅР°. РЎРЅР°С‡Р°Р»Р° РІС‹РїРѕР»РЅРё `/setup-server`.",
            flags: 64
          });
        }

        if (interaction.member.roles.cache.has(verifiedRole.id)) {
          return interaction.reply({
            content: "РўС‹ СѓР¶Рµ РїСЂРѕС€РµР» РІРµСЂРёС„РёРєР°С†РёСЋ. Р”РѕР±СЂРѕ РїРѕР¶Р°Р»РѕРІР°С‚СЊ РІ РѕСЃРЅРѕРІРЅРѕР№ СЃРµСЂРІРµСЂ.",
            flags: 64
          });
        }

        await interaction.member.roles.add(verifiedRole, "Р’РµСЂРёС„РёРєР°С†РёСЏ С‡РµСЂРµР· РєРЅРѕРїРєСѓ Ro Create");
        return interaction.reply({
          content: `Р“РѕС‚РѕРІРѕ. РўРµР±Рµ РІС‹РґР°РЅР° СЂРѕР»СЊ <@&${verifiedRole.id}>, Рё РѕСЃРЅРѕРІРЅС‹Рµ РєР°РЅР°Р»С‹ СѓР¶Рµ РѕС‚РєСЂС‹С‚С‹.`,
          flags: 64
        });
      }

      if (kind === "task" && action === "submitthread") {
        const state = loadState();
        const draft = state.taskDrafts[submissionId];

        if (!draft) {
          return interaction.reply({
            content: "Р§РµСЂРЅРѕРІРёРє СЌС‚РѕР№ РѕС‚РїСЂР°РІРєРё СѓР¶Рµ Р·Р°РєСЂС‹С‚ РёР»Рё РЅРµ РЅР°Р№РґРµРЅ.",
            flags: 64
          });
        }

        if (draft.userId !== interaction.user.id && !hasTaskReviewerRole(interaction.member)) {
          return interaction.reply({
            content: "Р­С‚Р° РІРµС‚РєР° РЅРµ РїСЂРёРЅР°РґР»РµР¶РёС‚ С‚РµР±Рµ.",
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

        if (!imageAttachment || !videoAttachment) {
          return interaction.reply({
            content: "\u0414\u043b\u044f \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438 \u043d\u0443\u0436\u043d\u043e \u043f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u044c \u0438 \u0444\u043e\u0442\u043e, \u0438 \u0432\u0438\u0434\u0435\u043e. \u041f\u043e\u0441\u043b\u0435 \u044d\u0442\u043e\u0433\u043e \u043d\u0430\u0436\u043c\u0438 \u043a\u043d\u043e\u043f\u043a\u0443 \u0435\u0449\u0435 \u0440\u0430\u0437.",
            flags: 64
          });
        }

        const reviewChannel = await findManagedChannel(interaction.guild, "taskReview");
        if (!reviewChannel) {
          return interaction.reply({
            content: "РљР°РЅР°Р» РїСЂРѕРІРµСЂРєРё Р·Р°РґР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅ. РЎРЅР°С‡Р°Р»Р° РІС‹РїРѕР»РЅРё `/setup-server`.",
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
            mediaUrl: imageAttachment.url,
            mediaUrl2: videoAttachment.url,
            mediaContentType: imageAttachment.contentType || null,
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
            content: "Р§РµСЂРЅРѕРІРёРє СЌС‚РѕР№ РѕС‚РїСЂР°РІРєРё СѓР¶Рµ Р·Р°РєСЂС‹С‚.",
            flags: 64
          });
        }

        const embed = new EmbedBuilder()
          .setTitle(`РџСЂРѕРІРµСЂРєР° Р·Р°РґР°РЅРёСЏ #${submission.id}`)
          .setColor(0xf59e0b)
          .setDescription(submission.comment)
          .addFields(
            { name: "РЈС‡Р°СЃС‚РЅРёРє", value: `<@${submission.userId}>`, inline: true },
            { name: "Р—Р°РґР°РЅРёРµ", value: submission.taskTitle, inline: true },
            { name: "РќР°РіСЂР°РґР°", value: `${submission.reward} РјРѕРЅРµС‚`, inline: true },
            { name: "РњРµРґРёР°", value: submissionMediaFields(submission) }
          )
          .setFooter({ text: `ID Р·Р°СЏРІРєРё: ${submission.id}` });

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

        await thread.send(`Р“РѕС‚РѕРІРѕ. РЇ РѕС‚РїСЂР°РІРёР» С‚РІРѕСЋ СЂР°Р±РѕС‚Сѓ РЅР° РїСЂРѕРІРµСЂРєСѓ. РќР°РіСЂР°РґР° Р·Р° СЌС‚Рѕ Р·Р°РґР°РЅРёРµ: ${submission.reward} РјРѕРЅРµС‚.`).catch(() => null);
        await thread.setArchived(true).catch(() => null);

        return interaction.reply({
          content: "Р—Р°СЏРІРєР° РѕС‚РїСЂР°РІР»РµРЅР° РЅР° РїСЂРѕРІРµСЂРєСѓ.",
          flags: 64
        });
      }

      const state = loadState();

      if (kind === "task") {
        if (!hasTaskReviewerRole(interaction.member)) {
          return interaction.reply({ content: "РЈ С‚РµР±СЏ РЅРµС‚ РїСЂР°РІ РЅР° РїСЂРѕРІРµСЂРєСѓ Р·Р°РґР°РЅРёР№.", flags: 64 });
        }

        const submission = state.taskSubmissions[submissionId];
        if (!submission || submission.status !== "pending") {
          return interaction.reply({ content: "Р­С‚Р° Р·Р°СЏРІРєР° СѓР¶Рµ РѕР±СЂР°Р±РѕС‚Р°РЅР°.", flags: 64 });
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
            return interaction.reply({ content: "Р­С‚Р° Р·Р°СЏРІРєР° СѓР¶Рµ РѕР±СЂР°Р±РѕС‚Р°РЅР°.", flags: 64 });
          }

          const user = await client.users.fetch(result.current.userId).catch(() => null);
          await user?.send(
            `РўРІРѕРµ РµР¶РµРґРЅРµРІРЅРѕРµ Р·Р°РґР°РЅРёРµ #${result.current.id} РїСЂРёРЅСЏС‚Рѕ. РќР°С‡РёСЃР»РµРЅРѕ ${result.current.reward} РјРѕРЅРµС‚.`
          ).catch(() => null);

          const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x22c55e)
            .addFields({ name: "РЎС‚Р°С‚СѓСЃ", value: `РџСЂРёРЅСЏС‚Рѕ РјРѕРґРµСЂР°С‚РѕСЂРѕРј <@${interaction.user.id}>` });

          return interaction.update({ embeds: [approvedEmbed], components: [] });
        }

        if (action === "reject") {
          const modal = new ModalBuilder()
            .setCustomId(`task-reject-modal:${submissionId}`)
            .setTitle("РџСЂРёС‡РёРЅР° РѕС‚РєР»РѕРЅРµРЅРёСЏ");

          const reasonInput = new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("РџРѕС‡РµРјСѓ Р·Р°СЏРІРєР° РѕС‚РєР»РѕРЅРµРЅР°")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(400);

          modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
          return interaction.showModal(modal);
        }
      }

      if (kind === "ad") {
        if (!hasAdReviewerRole(interaction.member)) {
          return interaction.reply({ content: "РЈ С‚РµР±СЏ РЅРµС‚ РїСЂР°РІ РЅР° РїСЂРѕРІРµСЂРєСѓ РѕР±СЉСЏРІР»РµРЅРёР№.", flags: 64 });
        }

        const submission = state.adSubmissions[submissionId];
        if (!submission || submission.status !== "pending") {
          return interaction.reply({ content: "Р­С‚Рѕ РѕР±СЉСЏРІР»РµРЅРёРµ СѓР¶Рµ РѕР±СЂР°Р±РѕС‚Р°РЅРѕ.", flags: 64 });
        }

        if (action === "approve") {
          const adsChannel = await findManagedChannel(interaction.guild, "ads");
          if (!adsChannel) {
            return interaction.reply({
              content: "РљР°РЅР°Р» РѕР±СЉСЏРІР»РµРЅРёР№ РЅРµ РЅР°Р№РґРµРЅ. РЎРЅР°С‡Р°Р»Р° РІС‹РїРѕР»РЅРё `/setup-server`.",
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
            return interaction.reply({ content: "Р­С‚Рѕ РѕР±СЉСЏРІР»РµРЅРёРµ СѓР¶Рµ РѕР±СЂР°Р±РѕС‚Р°РЅРѕ.", flags: 64 });
          }

          const publicEmbed = new EmbedBuilder()
            .setTitle(result.current.title)
            .setColor(0x3b82f6)
            .setDescription(result.current.description)
            .addFields(
              { name: "РљР°С‚РµРіРѕСЂРёСЏ", value: result.current.category, inline: true },
              { name: "РћРїР»Р°С‚Р°", value: result.current.payment, inline: true },
              { name: "РђРІС‚РѕСЂ", value: `<@${result.current.userId}>`, inline: true }
            )
            .setFooter({ text: "РћР±СЉСЏРІР»РµРЅРёРµ Ro Create" });

          if (result.current.imageUrl) {
            publicEmbed.setImage(result.current.imageUrl);
          }

          await adsChannel.send({ embeds: [publicEmbed] });

          const user = await client.users.fetch(result.current.userId).catch(() => null);
          await user?.send(`РўРІРѕРµ РѕР±СЉСЏРІР»РµРЅРёРµ #${result.current.id} РѕРґРѕР±СЂРµРЅРѕ Рё РѕРїСѓР±Р»РёРєРѕРІР°РЅРѕ.`).catch(() => null);

          const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x22c55e)
            .addFields({ name: "РЎС‚Р°С‚СѓСЃ", value: `РћРїСѓР±Р»РёРєРѕРІР°РЅРѕ РјРѕРґРµСЂР°С‚РѕСЂРѕРј <@${interaction.user.id}>` });

          return interaction.update({ embeds: [approvedEmbed], components: [] });
        }

        if (action === "reject") {
          const modal = new ModalBuilder()
            .setCustomId(`ad-reject-modal:${submissionId}`)
            .setTitle("РџСЂРёС‡РёРЅР° РѕС‚РєР»РѕРЅРµРЅРёСЏ РѕР±СЉСЏРІР»РµРЅРёСЏ");

          const reasonInput = new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("РџРѕС‡РµРјСѓ РѕР±СЉСЏРІР»РµРЅРёРµ РѕС‚РєР»РѕРЅРµРЅРѕ")
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
            content: "РљР°РЅР°Р» РѕС‚РїСЂР°РІРєРё Р·Р°РґР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅ. РЎРЅР°С‡Р°Р»Р° РІС‹РїРѕР»РЅРё `/setup-server`.",
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
            content: "Не удалось открыть приватную ветку для задания. Снова выполни `/setup-server`, чтобы бот обновил права канала, и проверь право бота на управление тредами.",
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
            "\u0422\u0435\u043f\u0435\u0440\u044c \u043f\u0440\u0438\u043a\u0440\u0435\u043f\u0438 \u0441\u044e\u0434\u0430 \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e \u043e\u0434\u043d\u043e \u0444\u043e\u0442\u043e \u0438 \u043e\u0434\u043d\u043e \u0432\u0438\u0434\u0435\u043e \u043e\u0434\u043d\u0438\u043c \u0438\u043b\u0438 \u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a\u0438\u043c\u0438 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f\u043c\u0438. \u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439 \u044f \u0443\u0436\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u043b. \u041f\u043e\u0442\u043e\u043c \u043d\u0430\u0436\u043c\u0438 \u043a\u043d\u043e\u043f\u043a\u0443 \u043d\u0438\u0436\u0435."
          ].join("\n"),
          components: [createTaskThreadRow(thread.id)]
        });

        return interaction.reply({
          content: `РЇ РѕС‚РєСЂС‹Р» С‚РµР±Рµ РїСЂРёРІР°С‚РЅСѓСЋ РІРµС‚РєСѓ РґР»СЏ Р·Р°РіСЂСѓР·РєРё Р·Р°РґР°РЅРёСЏ: <#${thread.id}>`,
          flags: 64
        });
      }

      if (kind === "task-reject-modal") {
        if (!hasTaskReviewerRole(interaction.member)) {
          return interaction.reply({ content: "РЈ С‚РµР±СЏ РЅРµС‚ РїСЂР°РІ РЅР° РїСЂРѕРІРµСЂРєСѓ Р·Р°РґР°РЅРёР№.", flags: 64 });
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
          return interaction.reply({ content: "Р­С‚Р° Р·Р°СЏРІРєР° СѓР¶Рµ РѕР±СЂР°Р±РѕС‚Р°РЅР°.", flags: 64 });
        }

        const user = await client.users.fetch(result.userId).catch(() => null);
        await user?.send(`РўРІРѕРµ РµР¶РµРґРЅРµРІРЅРѕРµ Р·Р°РґР°РЅРёРµ #${result.id} РѕС‚РєР»РѕРЅРµРЅРѕ. РџСЂРёС‡РёРЅР°: ${reason}`).catch(() => null);

        const embed = new EmbedBuilder()
          .setTitle(`РџСЂРѕРІРµСЂРєР° Р·Р°РґР°РЅРёСЏ #${result.id}`)
          .setColor(0xef4444)
          .setDescription(result.comment)
          .addFields(
            { name: "РЈС‡Р°СЃС‚РЅРёРє", value: `<@${result.userId}>`, inline: true },
            { name: "Р—Р°РґР°РЅРёРµ", value: result.taskTitle, inline: true },
            { name: "РќР°РіСЂР°РґР°", value: `${result.reward} РјРѕРЅРµС‚`, inline: true },
            { name: "РњРµРґРёР°", value: submissionMediaFields(result) },
            { name: "РЎС‚Р°С‚СѓСЃ", value: `РћС‚РєР»РѕРЅРµРЅРѕ РјРѕРґРµСЂР°С‚РѕСЂРѕРј <@${interaction.user.id}>` },
            { name: "РџСЂРёС‡РёРЅР°", value: reason }
          )
          .setFooter({ text: `ID Р·Р°СЏРІРєРё: ${result.id}` });

        if (result.mediaContentType?.startsWith("image/")) {
          embed.setImage(result.mediaUrl);
        }

        await updateStoredReviewMessage(interaction.guild, result, embed);
        return interaction.reply({
          content: "Р—Р°СЏРІРєР° РѕС‚РєР»РѕРЅРµРЅР°, РїСЂРёС‡РёРЅР° РѕС‚РїСЂР°РІР»РµРЅР° РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ РІ Р›РЎ.",
          flags: 64
        });
      }

      if (kind === "ad-reject-modal") {
        if (!hasAdReviewerRole(interaction.member)) {
          return interaction.reply({ content: "РЈ С‚РµР±СЏ РЅРµС‚ РїСЂР°РІ РЅР° РїСЂРѕРІРµСЂРєСѓ РѕР±СЉСЏРІР»РµРЅРёР№.", flags: 64 });
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
          return interaction.reply({ content: "Р­С‚Рѕ РѕР±СЉСЏРІР»РµРЅРёРµ СѓР¶Рµ РѕР±СЂР°Р±РѕС‚Р°РЅРѕ.", flags: 64 });
        }

        const user = await client.users.fetch(result.userId).catch(() => null);
        await user?.send(
          `РўРІРѕРµ РѕР±СЉСЏРІР»РµРЅРёРµ #${result.id} РѕС‚РєР»РѕРЅРµРЅРѕ. РњРѕРЅРµС‚С‹ РІРѕР·РІСЂР°С‰РµРЅС‹. РџСЂРёС‡РёРЅР°: ${reason}`
        ).catch(() => null);

        const embed = new EmbedBuilder()
          .setTitle(`РћР±СЉСЏРІР»РµРЅРёРµ РЅР° РјРѕРґРµСЂР°С†РёСЋ #${result.id}`)
          .setColor(0xef4444)
          .setDescription(result.description)
          .addFields(
            { name: "РђРІС‚РѕСЂ", value: `<@${result.userId}>`, inline: true },
            { name: "РљР°С‚РµРіРѕСЂРёСЏ", value: result.category, inline: true },
            { name: "РћРїР»Р°С‚Р°", value: result.payment, inline: true },
            { name: "РЎС‚Р°С‚СѓСЃ", value: `РћС‚РєР»РѕРЅРµРЅРѕ РјРѕРґРµСЂР°С‚РѕСЂРѕРј <@${interaction.user.id}>` },
            { name: "РџСЂРёС‡РёРЅР°", value: reason }
          )
          .setFooter({ text: result.title });

        if (result.imageUrl) {
          embed.setImage(result.imageUrl);
        }

        await updateStoredReviewMessage(interaction.guild, result, embed);
        return interaction.reply({
          content: "РћР±СЉСЏРІР»РµРЅРёРµ РѕС‚РєР»РѕРЅРµРЅРѕ, РјРѕРЅРµС‚С‹ РІРѕР·РІСЂР°С‰РµРЅС‹, Р°РІС‚РѕСЂ СѓРІРµРґРѕРјР»РµРЅ РІ Р›РЎ.",
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
        content: "Р§С‚Рѕ-С‚Рѕ РїРѕС€Р»Рѕ РЅРµ С‚Р°Рє. РџСЂРѕРІРµСЂСЊ РїСЂР°РІР° Р±РѕС‚Р° Рё РЅР°СЃС‚СЂРѕР№РєРё `.env`.",
        flags: 64
      }).catch(() => null);
      return;
    }

    await interaction.reply({
      content: "Р§С‚Рѕ-С‚Рѕ РїРѕС€Р»Рѕ РЅРµ С‚Р°Рє. РџСЂРѕРІРµСЂСЊ РїСЂР°РІР° Р±РѕС‚Р° Рё РЅР°СЃС‚СЂРѕР№РєРё `.env`.",
      flags: 64
    }).catch(() => null);
  }
});

client.login(token);

