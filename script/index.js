const { ipcRenderer } = require("electron");

const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const openSidebarBtn = document.getElementById("openSidebar");
const closeSidebarBtn = document.getElementById("closeSidebar");

function openSidebar() {
  sidebar.classList.add("open");
  overlay.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("active");
  document.body.style.overflow = "";
}

openSidebarBtn.addEventListener("click", openSidebar);
closeSidebarBtn.addEventListener("click", closeSidebar);
overlay.addEventListener("click", closeSidebar);

const jiraBaseUrl = document.getElementById("jiraBaseUrl");
const email = document.getElementById("email");
const apiToken = document.getElementById("apiToken");
const projectKey = document.getElementById("projectKey");
const taskStatus = document.getElementById("taskStatus");
const excludedEmails = document.getElementById("excludedEmails");

jiraBaseUrl.value = localStorage.getItem("JIRA_BASE_URL") || "";
email.value = localStorage.getItem("EMAIL") || "";
apiToken.value = localStorage.getItem("API_TOKEN") || "";
projectKey.value = localStorage.getItem("PROJECT_KEY") || "S1";
taskStatus.value =
  localStorage.getItem("TASK_STATUS") || "Selected for Development";
excludedEmails.value = localStorage.getItem("EXCLUDED_EMAILS") || "";

const configInputs = [
  jiraBaseUrl,
  email,
  apiToken,
  projectKey,
  taskStatus,
  excludedEmails,
];
configInputs.forEach((input) => {
  input.addEventListener("change", () => {
    localStorage.setItem("JIRA_BASE_URL", jiraBaseUrl.value);
    localStorage.setItem("EMAIL", email.value);
    localStorage.setItem("API_TOKEN", apiToken.value);
    localStorage.setItem("PROJECT_KEY", projectKey.value);
    localStorage.setItem("TASK_STATUS", taskStatus.value);
    localStorage.setItem("EXCLUDED_EMAILS", excludedEmails.value);

    ipcRenderer.send("update-config", {
      JIRA_BASE_URL: jiraBaseUrl.value,
      EMAIL: email.value,
      API_TOKEN: apiToken.value,
      PROJECT_KEY: projectKey.value,
      TASK_STATUS: taskStatus.value,
      EXCLUDED_EMAILS: excludedEmails.value,
    });
  });
});

window.addEventListener("load", () => {
  ipcRenderer.send("update-config", {
    JIRA_BASE_URL: jiraBaseUrl.value,
    EMAIL: email.value,
    API_TOKEN: apiToken.value,
    PROJECT_KEY: projectKey.value,
    TASK_STATUS: taskStatus.value,
    EXCLUDED_EMAILS: excludedEmails.value,
  });
});

const logs = document.getElementById("logs");

ipcRenderer.on("log-message", (event, message) => {
  const formattedMessage = message.trim() + "\n";
  logs.textContent += formattedMessage;
  logs.scrollTop = logs.scrollHeight;
});

// Task assignment elements
const assigneeUser = document.getElementById("assigneeUser");
const taskToAssign = document.getElementById("taskToAssign");
const assignmentType = document.getElementById("assignmentType");
const assignTask = document.getElementById("assignTask");
const refreshTaskAssignment = document.getElementById("refreshTaskAssignment");
const userSelectContainer = document.getElementById("userSelectContainer");
const taskComment = document.getElementById("taskComment");

// Global değişkenler
let cachedUsers = [];
let cachedTasks = [];
let isUsersLoaded = false;
let isTasksLoaded = false;

// Buton durumunu kontrol et
function checkButtonState() {
  assignTask.disabled = !(isUsersLoaded && isTasksLoaded);
  assignTask.classList.toggle("opacity-50", !isUsersLoaded || !isTasksLoaded);
  assignTask.classList.toggle("cursor-not-allowed", !isUsersLoaded || !isTasksLoaded);
}

// Update user list
async function updateUserList() {
  isUsersLoaded = false;
  checkButtonState();
  ipcRenderer.send("get-project-users");
}

// Update task list
async function updateTaskList() {
  isTasksLoaded = false;
  checkButtonState();
  ipcRenderer.send("get-unassigned-tasks");
}

// Refresh task assignment area
function refreshTaskAssignmentArea() {
  // Add animation to refresh button
  refreshTaskAssignment.classList.add("animate-spin");

  // Update lists
  updateUserList();
  updateTaskList();

  // Remove animation after 1 second
  setTimeout(() => {
    refreshTaskAssignment.classList.remove("animate-spin");
  }, 1000);
}

// Add click event to refresh button
refreshTaskAssignment.addEventListener("click", refreshTaskAssignmentArea);

// IPC Event Listeners
ipcRenderer.on("project-users-data", (event, users) => {
  try {
    // Cache users
    cachedUsers = users;
    
    assigneeUser.innerHTML = '<option value="">Select a user (optional)</option>';
    users.forEach((user) => {
      const option = document.createElement("option");
      option.value = user.accountId;
      option.textContent = `${user.displayName} ${
        user.hasInProgressTasks ? "(🔄 In Progress)" : "(✅ Available)"
      }`;
      assigneeUser.appendChild(option);
    });
    isUsersLoaded = true;
    checkButtonState();
  } catch (error) {
    console.error("Error updating user list:", error);
  }
});

ipcRenderer.on("unassigned-tasks-data", (event, tasks) => {
  try {
    // Cache tasks
    cachedTasks = tasks;
    
    taskToAssign.innerHTML = '<option value="">Select a task</option>';
    tasks.forEach((task) => {
      const option = document.createElement("option");
      option.value = task.key;
      option.textContent = `${task.key}: ${task.fields.summary}`;
      taskToAssign.appendChild(option);
    });
    isTasksLoaded = true;
    checkButtonState();
  } catch (error) {
    console.error("Error updating task list:", error);
  }
});

// Update user selection when assignment type changes
assignmentType.addEventListener("change", () => {
  if (assignmentType.value === "specific") {
    userSelectContainer.classList.remove("hidden");
    assigneeUser.disabled = false;
    assigneeUser.required = true;
  } else {
    userSelectContainer.classList.add("hidden");
    assigneeUser.disabled = true;
    assigneeUser.required = false;
    assigneeUser.value = "";
  }
});

// Task assignment process
assignTask.addEventListener("click", () => {
  // Stop if button is already disabled
  if (assignTask.disabled) {
    return;
  }

  if (!taskToAssign.value) {
    alert("Please select a task!");
    return;
  }

  if (assignmentType.value === "specific" && !assigneeUser.value) {
    alert("Please select a user!");
    return;
  }

  // Disable button and add visual feedback
  assignTask.disabled = true;
  assignTask.classList.add("opacity-50", "cursor-not-allowed");
  assignTask.textContent = "Processing...";

  // Assign task using cached data
  ipcRenderer.send("assign-task", {
    taskKey: taskToAssign.value,
    assignmentType: assignmentType.value,
    selectedUserId: assigneeUser.value,
    cachedUsers: cachedUsers,
    cachedTasks: cachedTasks,
    comment: taskComment.value.trim()
  });
});

// Task assignment result listener
ipcRenderer.on("task-assigned", (event, result) => {
  // Re-enable button and remove visual feedback
  assignTask.disabled = false;
  assignTask.classList.remove("opacity-50", "cursor-not-allowed");
  assignTask.textContent = "Start Process";

  if (result.success) {
    alert(`Task başarıyla atandı!`);
    taskComment.value = "";
    updateTaskList();
  } else {
    if (result.activeTasks && result.activeTasks.length > 0) {
      const taskList = result.activeTasks.join("\n");
      alert(
        `Kullanıcının üzerinde aktif task'lar olduğu için atama yapılamadı.\n\nAktif Task'lar:\n${taskList}`
      );
    } else {
      alert(result.error || "Task atama işlemi başarısız oldu!");
    }
  }
});

// Update lists on page load
window.addEventListener("load", () => {
  updateUserList();
  updateTaskList();
});
