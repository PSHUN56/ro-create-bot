const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

const defaultState = {
  users: {},
  currentTask: null,
  managedArtifacts: {},
  taskDrafts: {},
  taskSubmissions: {},
  adSubmissions: {},
  counters: {
    taskSubmission: 1,
    adSubmission: 1
  }
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState, null, 2), "utf8");
  }
}

function buildState(parsed = {}) {
  return {
    ...defaultState,
    ...parsed,
    counters: {
      ...defaultState.counters,
      ...(parsed.counters || {})
    },
    users: parsed.users || {},
    currentTask: parsed.currentTask || null,
    managedArtifacts: parsed.managedArtifacts || {},
    taskDrafts: parsed.taskDrafts || {},
    taskSubmissions: parsed.taskSubmissions || {},
    adSubmissions: parsed.adSubmissions || {}
  };
}

function loadState() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8").trim();

  if (!raw) {
    const state = buildState();
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
    return state;
  }

  try {
    const parsed = JSON.parse(raw);
    return buildState(parsed);
  } catch (error) {
    const brokenBackup = `${DATA_FILE}.broken-${Date.now()}.json`;
    fs.writeFileSync(brokenBackup, raw, "utf8");

    const state = buildState();
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
    console.error(`State file was corrupted and has been reset. Backup saved to ${brokenBackup}`);
    return state;
  };
}

function saveState(state) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

function withState(mutator) {
  const state = loadState();
  const result = mutator(state);
  saveState(state);
  return result;
}

function getUserKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function ensureUser(state, guildId, user) {
  const key = getUserKey(guildId, user.id);

  if (!state.users[key]) {
    state.users[key] = {
      guildId,
      userId: user.id,
      username: user.username,
      coins: 0,
      reputation: 0,
      acceptedTasks: 0,
      acceptedAds: 0,
      lastDailyAt: null,
      lastWorkAt: null
    };
  }

  state.users[key].username = user.username;
  return state.users[key];
}

module.exports = {
  loadState,
  saveState,
  withState,
  ensureUser
};
