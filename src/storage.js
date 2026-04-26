const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const DATA_BACKUP_FILE = path.join(DATA_DIR, "store.backup.json");

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

  if (!fs.existsSync(DATA_BACKUP_FILE)) {
    fs.writeFileSync(DATA_BACKUP_FILE, JSON.stringify(defaultState, null, 2), "utf8");
  }
}

function writeStateFile(filePath, state) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function tryLoadBackupState() {
  if (!fs.existsSync(DATA_BACKUP_FILE)) {
    return null;
  }

  try {
    const backupRaw = fs.readFileSync(DATA_BACKUP_FILE, "utf8").trim();
    if (!backupRaw) {
      return null;
    }

    return buildState(JSON.parse(backupRaw));
  } catch (error) {
    return null;
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
    const backupState = tryLoadBackupState();
    if (backupState) {
      writeStateFile(DATA_FILE, backupState);
      return backupState;
    }

    const state = buildState();
    writeStateFile(DATA_FILE, state);
    writeStateFile(DATA_BACKUP_FILE, state);
    return state;
  }

  try {
    const parsed = JSON.parse(raw);
    return buildState(parsed);
  } catch (error) {
    const brokenBackup = `${DATA_FILE}.broken-${Date.now()}.json`;
    fs.writeFileSync(brokenBackup, raw, "utf8");

    const backupState = tryLoadBackupState();
    if (backupState) {
      writeStateFile(DATA_FILE, backupState);
      console.error(`State file was corrupted and restored from backup. Broken copy saved to ${brokenBackup}`);
      return backupState;
    }

    const state = buildState();
    writeStateFile(DATA_FILE, state);
    writeStateFile(DATA_BACKUP_FILE, state);
    console.error(`State file was corrupted and has been reset. Backup saved to ${brokenBackup}`);
    return state;
  }
}

function saveState(state) {
  ensureDataFile();
  writeStateFile(DATA_FILE, state);
  writeStateFile(DATA_BACKUP_FILE, state);
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
