const axios = require("axios");
const { createLogger, transports, format } = require("winston");
const { app, BrowserWindow, ipcMain } = require("electron");
const Transport = require("winston-transport");

class ElectronTransport extends Transport {
  constructor(opts) {
    super(opts);
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit("logged", info);
    });

    const message = `[${info.timestamp}] ${info.level}: ${info.message}\n`;
    if (global.mainWindow) {
      global.mainWindow.webContents.send("log-message", message);
    }

    callback();
  }
}

const logger = createLogger({
  level: "debug",
  format: format.combine(
    format.colorize(),
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.printf(
      ({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`
    )
  ),
  transports: [new transports.Console(), new ElectronTransport()],
});

let JIRA_BASE_URL;
let EMAIL;
let API_TOKEN;
let YOUR_ACCOUNT_ID;
let PROJECT_KEY = "S1";
let TASK_STATUS = "Selected for Development";
let TEST_MODE = false;

ipcMain.on("update-config", (event, config) => {
  JIRA_BASE_URL = config.JIRA_BASE_URL;
  EMAIL = config.EMAIL;
  API_TOKEN = config.API_TOKEN;
  YOUR_ACCOUNT_ID = config.YOUR_ACCOUNT_ID;
  PROJECT_KEY = config.PROJECT_KEY || "S1";
  TASK_STATUS = config.TASK_STATUS || "Selected for Development";
  TEST_MODE = config.TEST_MODE;
  logger.info("---- Konfigürasyon güncellendi ----");
  logger.info(`JIRA_BASE_URL: ${JIRA_BASE_URL}`);
  logger.info(`EMAIL: ${EMAIL}`);
  logger.info(`API_TOKEN: ********`);
  logger.info(`ACCOUNT_ID: ${YOUR_ACCOUNT_ID}`);
  logger.info(`PROJECT_KEY: ${PROJECT_KEY}`);
  logger.info(`TASK_STATUS: ${TASK_STATUS}`);
  logger.info(`TEST_MODE: ${TEST_MODE}`);
  logger.info("---- Konfigürasyon güncellendi ----");
});

let excludedTasks = ["S1-30899"];

ipcMain.on("update-excluded-tasks", (event, tasks) => {
  excludedTasks = tasks
    .split("\n")
    .map((task) => task.trim())
    .filter((task) => task.length > 0);
  logger.info(`Hariç tutulan tasklar güncellendi: ${excludedTasks.join(", ")}`);
});

async function getProjectUsers() {
  try {
    logger.info("Proje kullanıcıları çekiliyor...");

    // Son 3 ayda projede aktif olan kullanıcıları bulmak için JQL sorgusu
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const jqlQuery = `project = "${PROJECT_KEY}" AND assignee IS NOT EMPTY AND updated >= "${
      threeMonthsAgo.toISOString().split("T")[0]
    }"`;

    // Önce son 3 ayda aktif olan taskları çek
    const tasksResponse = await axios.get(
      `${JIRA_BASE_URL}/rest/api/3/search?jql=${encodeURIComponent(
        jqlQuery
      )}&maxResults=100`,
      {
        auth: { username: EMAIL, password: API_TOKEN },
      }
    );

    // Task'lardan benzersiz kullanıcı ID'lerini çıkar
    const activeUserIds = new Set();
    tasksResponse.data.issues.forEach((issue) => {
      if (issue.fields.assignee && issue.fields.assignee.accountId) {
        activeUserIds.add(issue.fields.assignee.accountId);
      }
    });

    // Aktif kullanıcıların detaylarını çek
    const activeUsers = [];
    for (const accountId of activeUserIds) {
      try {
        const userResponse = await axios.get(
          `${JIRA_BASE_URL}/rest/api/3/user?accountId=${accountId}`,
          {
            auth: { username: EMAIL, password: API_TOKEN },
          }
        );

        const user = userResponse.data;
        if (
          user.active &&
          !user.displayName.includes("addon") &&
          !user.displayName.toLowerCase().includes("bot") &&
          !user.displayName.toLowerCase().includes("system")
        ) {
          activeUsers.push(user);
        }
      } catch (error) {
        logger.error(
          `Kullanıcı detayları çekilemedi (${accountId}): ${error.message}`
        );
      }
    }

    logger.info(`Toplam ${activeUsers.length} aktif kullanıcı bulundu`);
    logger.info('Leaderboard hesaplanıyor...')
    return activeUsers;
  } catch (error) {
    logger.error(
      `Hata oluştu (kullanıcı çekme): ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    return [];
  }
}

async function getUserAllTasks(accountId) {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 2);
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const jqlQuery = `project = "${PROJECT_KEY}" 
    AND assignee = ${accountId}
    AND updated >= "${firstDayOfMonth.toISOString().split("T")[0]}" 
    AND updated <= "${lastDayOfMonth.toISOString().split("T")[0]}" 
    ORDER BY updated DESC`;

  try {
    const response = await axios.get(
      `${JIRA_BASE_URL}/rest/api/3/search?jql=${encodeURIComponent(
        jqlQuery
      )}&maxResults=100`,
      {
        auth: { username: EMAIL, password: API_TOKEN },
      }
    );
    return response.data.issues;
  } catch (error) {
    logger.error(
      `Hata oluştu (kullanıcı tüm taskları çekme): ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    return [];
  }
}

async function calculateLeaderboard() {
  logger.info("Leaderboard hesaplanıyor...");

  const users = await getProjectUsers();
  const leaderboardData = [];

  for (const user of users) {
    const allTasks = await getUserAllTasks(user.accountId);
    let totalPoints = 0;
    let allTaskTotalPoint = 0;
    let completedTaskCount = 0;

    for (const task of allTasks) {
      const storyPoints = task.fields.customfield_10028;
      if (storyPoints && task.fields.status.name === "Done") {
        totalPoints += storyPoints;
        completedTaskCount++;
      }
    }

    for (const task of allTasks) {
      const storyPoints = task.fields.customfield_10028;
      if (storyPoints) {
        allTaskTotalPoint += storyPoints;
      }
    }

    leaderboardData.push({
      displayName: user.displayName,
      email: user.emailAddress,
      accountId: user.accountId,
      avatarUrl: user.avatarUrls["48x48"],
      totalPoints,
      completedTaskCount,
      totalTaskCount: allTasks.length,
      allTaskTotalPoint,
      tasks: allTasks.map((t) => ({
        key: t.key,
        summary: t.fields.summary,
        points: t.fields.customfield_10028 || 0,
      })),
      allTasks: allTasks.map((t) => ({
        key: t.key,
        summary: t.fields.summary,
        points: t.fields.customfield_10028 || 0,
        status: t.fields.status.name,
      })),
    });
  }

  // Puanlara göre sırala
  leaderboardData.sort((a, b) => b.totalPoints - a.totalPoints);

  logger.info("Leaderboard hesaplandı");
  return leaderboardData;
}

async function getLeaderboard() {
  try {
    const leaderboard = await calculateLeaderboard();
    logger.info(
      `Leaderboard oluşturuldu. Toplam ${leaderboard.length} kullanıcı listelendi.`
    );

    // Detaylı log
    leaderboard.forEach((user, index) => {
      logger.info(
        `${index + 1}. ${user.displayName}: ${user.totalPoints} puan (${
          user.completedTaskCount
        } task)`
      );
    });

    return leaderboard;
  } catch (error) {
    logger.error(
      `Leaderboard oluşturulurken hata oluştu: ${
        error.response ? JSON.stringify(error.response.data) : error.message
      }`
    );
    return [];
  }
}

module.exports = {
  getLeaderboard,
  getUserAllTasks,
};
