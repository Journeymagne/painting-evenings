const SHIFT_TIMES = ["19:00–21:00", "21:00–00:00"];
const SHIFT_SHORT_TIMES = ["19–21", "21–00"];

const AUTH_TOKEN_KEY = "paintTrackerAuthToken";

const places = [
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `paint-${index + 1}`,
    title: "Покрасоместо",
    detail: `Место ${index + 1}`,
    capacity: 1,
  })),
  {
    id: "big-table-1",
    title: "Большой стол",
    detail: "Киллтим, Бладболл, Андер",
    capacity: 2,
  },
  {
    id: "big-table-2",
    title: "Большой стол",
    detail: "Киллтим, Бладболл, Андер",
    capacity: 2,
  },
  {
    id: "tea-table",
    title: "Чайный стол",
    detail: "Киллтим, Бладболл, Андер",
    capacity: 2,
  },
  {
    id: "kitchen-table",
    title: "Кухонный стол",
    detail: "Бладболл, Андер",
    capacity: 2,
  },
];

const totalCapacity = places.reduce((sum, place) => sum + place.capacity, 0);
let pendingBooking = null;
let selectedBooking = null;
let seatDrag = null;
let seatMoveBusy = false;
let suppressSeatClickUntil = 0;

const accountStatus = document.querySelector("#accountStatus");
const openAuthButton = document.querySelector("#openAuthButton");
const manageUsersButton = document.querySelector("#manageUsersButton");
const logoutButton = document.querySelector("#logoutButton");
const dayTabs = document.querySelector("#dayTabs");
const activeViewButton = document.querySelector("#activeViewButton");
const archiveViewButton = document.querySelector("#archiveViewButton");
const dayThemeForm = document.querySelector("#dayThemeForm");
const dayThemeInput = document.querySelector("#dayThemeInput");
const saveDayThemeButton = document.querySelector("#saveDayThemeButton");
const currentDayDate = document.querySelector("#currentDayDate");
const cardsGrid = document.querySelector("#cardsGrid");
const archiveIndex = document.querySelector("#archiveIndex");
const archiveList = document.querySelector("#archiveList");
const archiveBack = document.querySelector("#archiveBack");
const dayWorkspace = document.querySelector("#dayWorkspace");
const participantsBody = document.querySelector("#participantsBody");
const tableWrap = document.querySelector(".table-wrap");
const reservedCount = document.querySelector("#reservedCount");
const freeCount = document.querySelector("#freeCount");
const authDialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authForm");
const authEyebrow = document.querySelector("#authEyebrow");
const authTitle = document.querySelector("#authTitle");
const authNameLabel = document.querySelector("#authNameLabel");
const authPasswordLabel = document.querySelector("#authPasswordLabel");
const authNameInput = document.querySelector("#authNameInput");
const authPasswordInput = document.querySelector("#authPasswordInput");
const authTelegramInput = document.querySelector("#authTelegramInput");
const authTelegramField = document.querySelector("#authTelegramField");
const authStatus = document.querySelector("#authStatus");
const authMessage = document.querySelector("#authMessage");
const authTabs = document.querySelector(".auth-tabs");
const authLoginTab = document.querySelector("#authLoginTab");
const authRegisterTab = document.querySelector("#authRegisterTab");
const authSubmitButton = document.querySelector("#authSubmitButton");
const closeAuthButton = document.querySelector("#closeAuthButton");
const usersDialog = document.querySelector("#usersDialog");
const usersBody = document.querySelector("#usersBody");
const usersTableWrap = document.querySelector(".users-table-wrap");
const closeUsersButton = document.querySelector("#closeUsersButton");
const userProfileDialog = document.querySelector("#userProfileDialog");
const userProfileName = document.querySelector("#userProfileName");
const userProfileTelegram = document.querySelector("#userProfileTelegram");
const userProfileRole = document.querySelector("#userProfileRole");
const userProfileMessage = document.querySelector("#userProfileMessage");
const tempPasswordBox = document.querySelector("#tempPasswordBox");
const tempPasswordInput = document.querySelector("#tempPasswordInput");
const copyTempPasswordButton = document.querySelector("#copyTempPasswordButton");
const resetUserPasswordButton = document.querySelector("#resetUserPasswordButton");
const grantProfileAdminButton = document.querySelector("#grantProfileAdminButton");
const closeUserProfileButton = document.querySelector("#closeUserProfileButton");
const bookingDialog = document.querySelector("#bookingDialog");
const bookingForm = document.querySelector("#bookingForm");
const bookingSlots = document.querySelector("#bookingSlots");
const placeIdInput = document.querySelector("#placeId");
const dialogTitle = document.querySelector("#dialogTitle");
const formError = document.querySelector("#formError");
const releaseButton = document.querySelector("#releaseButton");
const closeDialogButton = document.querySelector("#closeDialogButton");
const clearAllButton = document.querySelector("#clearAllButton");
const archiveDayButton = document.querySelector("#archiveDayButton");
const openCreateDayButton = document.querySelector("#openCreateDayButton");
const createDayDialog = document.querySelector("#createDayDialog");
const createDayForm = document.querySelector("#createDayForm");
const dayDateInput = document.querySelector("#dayDateInput");
const dayThemeCreateInput = document.querySelector("#dayThemeCreateInput");
const dayFormError = document.querySelector("#dayFormError");
const closeCreateDayButton = document.querySelector("#closeCreateDayButton");
const cancelCreateDayButton = document.querySelector("#cancelCreateDayButton");

let appState = {
  activeDayId: null,
  viewMode: "active",
  selectedUserId: null,
  currentUser: null,
  days: [],
  users: [],
};
let authMode = "login";

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setToken(token) {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    return;
  }

  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function getRouteState() {
  const archiveMatch = window.location.pathname.match(/^\/archive(?:\/([^/]+))?\/?$/);
  if (archiveMatch) {
    return {
      viewMode: "archive",
      dayId: archiveMatch[1] ? decodeURIComponent(archiveMatch[1]) : null,
    };
  }

  const dayMatch = window.location.pathname.match(/^\/days\/([^/]+)\/?$/);
  return {
    viewMode: "active",
    dayId: dayMatch?.[1] ? decodeURIComponent(dayMatch[1]) : null,
  };
}

function getDayUrl(day, viewMode = day?.isArchived ? "archive" : "active") {
  if (!day) {
    return viewMode === "archive" ? "/archive" : "/";
  }

  const encodedId = encodeURIComponent(day.id);
  return viewMode === "archive" ? `/archive/${encodedId}` : `/days/${encodedId}`;
}

function updateUrlForActiveDay(replace = false) {
  const activeDay = getActiveDay();
  const url = getDayUrl(activeDay, appState.viewMode) + window.location.search;

  if (window.location.pathname + window.location.search === url) {
    return;
  }

  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", url);
}

async function apiFetch(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };
  const token = getToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const fetchOptions = {
    ...options,
    headers,
  };

  if (options.body && typeof options.body !== "string") {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, fetchOptions);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error || "Ошибка сервера");
  }

  return data;
}

async function loadApp(preferredDayId = appState.activeDayId) {
  try {
    const route = getRouteState();
    const data = await apiFetch("/api/state");
    appState.days = data.days || [];
    appState.users = data.users || [];
    appState.currentUser = data.currentUser || null;
    appState.viewMode = route.viewMode;

    const visibleDays = getVisibleDays();
    const requestedDayId = appState.viewMode === "archive" ? route.dayId : route.dayId || preferredDayId;
    appState.activeDayId = visibleDays.some((day) => day.id === requestedDayId)
      ? requestedDayId
      : appState.viewMode === "archive" ? null : visibleDays[0]?.id || null;
    updateUrlForActiveDay(true);
    render();
  } catch (error) {
    currentDayDate.textContent = "Сервер недоступен";
    cardsGrid.innerHTML = "";
    participantsBody.innerHTML = "";
    tableWrap.classList.remove("has-rows");
    setAuthMessage(error.message);
  }
}

function getPlace(placeId) {
  return places.find((place) => place.id === placeId);
}

function getActiveDay() {
  const visibleDays = getVisibleDays();
  return visibleDays.find((day) => day.id === appState.activeDayId) || null;
}

function getVisibleDays() {
  return appState.days.filter((day) => Boolean(day.isArchived) === (appState.viewMode === "archive"));
}

function getDayBookings(day, shiftIndex = 0) {
  return day?.shiftBookings?.[shiftIndex] || (shiftIndex === 0 ? day?.bookings : null) || {};
}

function getActiveBookings(shiftIndex = 0) {
  return getDayBookings(getActiveDay(), shiftIndex);
}

function getBookingSlots(placeId, shiftIndex = 0) {
  const players = getActiveBookings(shiftIndex)[placeId];
  return Array.isArray(players) ? players : [];
}

function getUserById(userId) {
  return appState.users.find((user) => user.id === userId);
}

function getSelectedUser() {
  return getUserById(appState.selectedUserId);
}

function isDateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function formatDate(value) {
  if (!isDateValue(value)) {
    return value || "";
  }

  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function todayLocal() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function placeLabel(place) {
  return place.detail ? `${place.title} (${place.detail})` : place.title;
}

function normalizeTelegram(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function formatTimeInput(value) {
  const digits = value.replace(/\D/g, "").slice(0, 4);

  if (digits.length < 2) {
    return digits;
  }

  if (digits.length === 2) {
    return `${digits}:`;
  }

  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function isValidTime(value) {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

function renderAuth() {
  const user = appState.currentUser;
  const activeDay = getActiveDay();
  const isArchived = Boolean(activeDay?.isArchived);
  const role = user?.isAdmin ? " · админ" : "";
  accountStatus.textContent = user ? `${user.name} · ${user.telegram}${role}` : "Не вошли";
  authStatus.textContent = user ? "Можно изменить имя, пароль и телеграм контакт." : "Войдите или зарегистрируйтесь";
  openAuthButton.textContent = user ? "Профиль" : "Войти";
  manageUsersButton.hidden = !user?.isAdmin;
  logoutButton.hidden = !user;
  closeAuthButton.hidden = false;
  openCreateDayButton.hidden = appState.viewMode === "archive";
  openCreateDayButton.disabled = !user?.isAdmin || appState.viewMode === "archive";
  openCreateDayButton.title = user?.isAdmin ? "Создать вечер покраса" : "Создавать вечера может только админ";
  clearAllButton.disabled = !activeDay || !user?.isAdmin || isArchived;
  clearAllButton.title = !activeDay
    ? "Сначала выберите вечер покраса"
    : isArchived
    ? "Архивные вечера доступны только для просмотра"
    : user?.isAdmin
      ? "Очистить все брони дня"
      : "Очищать все брони может только админ";
  archiveDayButton.hidden = !activeDay;
  archiveDayButton.disabled = !user?.isAdmin;
  archiveDayButton.textContent = isArchived ? "Вернуть" : "В архив";
  archiveDayButton.title = user?.isAdmin
    ? isArchived
      ? "Вернуть вечер из архива"
      : "Отправить вечер в архив"
    : "Архивировать вечера может только админ";
  document.body.classList.remove("is-auth-required");
}

function ensureAuthGate() {
  document.body.classList.remove("is-auth-required");
}

function renderUsersList() {
  usersBody.innerHTML = "";
  usersTableWrap.classList.toggle("has-rows", appState.users.length > 0);

  appState.users.forEach((user) => {
    const tr = document.createElement("tr");
    const isSelf = user.id === appState.currentUser?.id;
    const adminAction = user.isAdmin
      ? "Админ"
      : `<button class="primary-button compact-button grant-admin-button" type="button" data-user-id="${escapeAttribute(user.id)}">Сделать админом</button>`;
    const profileAction = `<button class="ghost-button compact-button open-user-profile-button" type="button" data-user-id="${escapeAttribute(user.id)}">Профиль</button>`;

    tr.innerHTML = `
      <td>${escapeHtml(user.name)}${isSelf ? " (вы)" : ""}</td>
      <td>${escapeHtml(user.telegram)}</td>
      <td>${user.isAdmin ? "Админ" : "Пользователь"}</td>
      <td><div class="user-actions">${profileAction}${adminAction}</div></td>
    `;
    usersBody.append(tr);
  });
}

function openUsersDialog() {
  if (!appState.currentUser?.isAdmin) {
    window.alert("Список пользователей доступен только админу.");
    return;
  }

  renderUsersList();
  usersDialog.showModal();
}

function closeUsersDialog() {
  usersDialog.close();
}

function setUserProfileMessage(message, type = "error") {
  userProfileMessage.textContent = message || "";
  userProfileMessage.classList.toggle("is-success", type === "success");
}

function renderUserProfile() {
  const user = getSelectedUser();
  if (!user) {
    closeUserProfile();
    return;
  }

  const isSelf = user.id === appState.currentUser?.id;
  userProfileName.textContent = user.name;
  userProfileTelegram.textContent = user.telegram;
  userProfileRole.textContent = user.isAdmin ? "Админ" : "Пользователь";
  grantProfileAdminButton.hidden = user.isAdmin;
  grantProfileAdminButton.disabled = user.isAdmin;
  resetUserPasswordButton.disabled = isSelf;
  resetUserPasswordButton.title = isSelf
    ? "Для своего аккаунта меняйте пароль через профиль"
    : "Сгенерировать новый временный пароль";
}

function openUserProfile(userId) {
  if (!appState.currentUser?.isAdmin) {
    window.alert("Профили пользователей доступны только админу.");
    return;
  }

  appState.selectedUserId = userId;
  if (!getSelectedUser()) {
    window.alert("Пользователь не найден.");
    return;
  }

  tempPasswordBox.hidden = true;
  tempPasswordInput.value = "";
  setUserProfileMessage("");
  renderUserProfile();
  userProfileDialog.showModal();
}

function closeUserProfile() {
  tempPasswordBox.hidden = true;
  tempPasswordInput.value = "";
  setUserProfileMessage("");
  userProfileDialog.close();
}

function setAuthMessage(message, type = "error") {
  authMessage.textContent = message || "";
  authMessage.classList.toggle("is-success", type === "success");
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  const isProfile = mode === "profile";

  authForm.classList.toggle("is-login", isLogin);
  authForm.classList.toggle("is-register", mode === "register");
  authForm.classList.toggle("is-profile", isProfile);
  authTabs.hidden = isProfile;
  authLoginTab.classList.toggle("is-active", isLogin);
  authRegisterTab.classList.toggle("is-active", mode === "register");
  authLoginTab.setAttribute("aria-selected", String(isLogin));
  authRegisterTab.setAttribute("aria-selected", String(mode === "register"));
  authTelegramField.classList.toggle("is-hidden", isLogin);
  authTelegramInput.required = !isLogin;
  authTelegramInput.tabIndex = isLogin ? -1 : 0;
  authPasswordInput.required = !isProfile;
  authPasswordInput.autocomplete = isProfile ? "new-password" : isLogin ? "current-password" : "new-password";
  authEyebrow.textContent = isProfile ? "Профиль" : "Аккаунт";
  authTitle.textContent = isProfile ? "Профиль" : "Авторизация";
  authNameLabel.textContent = isProfile ? "Имя" : "Имя";
  authPasswordLabel.textContent = isProfile ? "Новый пароль" : "Пароль";
  authSubmitButton.textContent = isProfile ? "Сохранить" : isLogin ? "Войти" : "Зарегистрироваться";
  authStatus.textContent = isProfile
    ? "Измените имя, пароль и телеграм контакт."
    : isLogin
      ? "Введите имя и пароль"
      : "Заполните имя, пароль и Telegram";
  setAuthMessage("");
}

function getAuthValues() {
  return {
    name: authNameInput.value.trim(),
    password: authPasswordInput.value,
    telegram: normalizeTelegram(authTelegramInput.value),
  };
}

function openAuthDialog() {
  const user = appState.currentUser;
  authNameInput.value = user?.name || "";
  authTelegramInput.value = user?.telegram || "";
  authPasswordInput.value = "";
  setAuthMode(user ? "profile" : "login");
  setAuthMessage("");
  authDialog.showModal();
  authNameInput.focus();
}

function closeAuthDialog() {
  pendingBooking = null;
  authForm.reset();
  authDialog.close();
}

async function finishAuthentication() {
  const booking = pendingBooking;
  closeAuthDialog();
  await loadApp(appState.activeDayId);
  if (booking && getActiveDay()?.id === booking.dayId && !getActiveDay().isArchived) {
    openBooking(booking.placeId, booking.slotIndex, booking.shiftIndex);
  }
}

async function registerUserFromForm() {
  const { name, password, telegram } = getAuthValues();

  if (!name || !password || !telegram) {
    setAuthMessage("Для регистрации заполни имя, пароль и телеграм.");
    return;
  }

  try {
    const data = await apiFetch("/api/auth/register", {
      method: "POST",
      body: { name, password, telegram },
    });
    setToken(data.token);
    appState.currentUser = data.user;
    setAuthMessage("Профиль создан.", "success");
    await finishAuthentication();
  } catch (error) {
    setAuthMessage(error.message);
  }
}

async function loginUserFromForm() {
  const { name, password } = getAuthValues();

  if (!name || !password) {
    setAuthMessage("Для входа нужны имя и пароль.");
    return;
  }

  try {
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      body: { name, password },
    });
    setToken(data.token);
    appState.currentUser = data.user;
    setAuthMessage("Вы вошли.", "success");
    await finishAuthentication();
  } catch (error) {
    setAuthMessage(error.message);
  }
}

async function updateProfileFromForm() {
  const { name, password, telegram } = getAuthValues();

  if (!name || !telegram) {
    setAuthMessage("Заполните имя и телеграм контакт.");
    return;
  }

  try {
    const data = await apiFetch("/api/auth/profile", {
      method: "PATCH",
      body: { name, password, telegram },
    });
    appState.currentUser = data.user;
    setAuthMessage("Профиль сохранён.", "success");
    closeAuthDialog();
    await loadApp(appState.activeDayId);
  } catch (error) {
    setAuthMessage(error.message);
  }
}

async function logoutUser() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Token may already be invalid; local logout still clears the UI.
  }

  setToken(null);
  appState.currentUser = null;
  await loadApp(appState.activeDayId);
}

async function grantAdminToUser(userId) {
  try {
    await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/admin`, {
      method: "PATCH",
      body: { isAdmin: true },
    });
    await loadApp(appState.activeDayId);
    renderUsersList();
    if (userProfileDialog.open) {
      renderUserProfile();
      setUserProfileMessage("Пользователь получил права админа.", "success");
    }
  } catch (error) {
    window.alert(error.message);
  }
}

async function resetTemporaryPasswordForSelectedUser() {
  const user = getSelectedUser();
  if (!user) {
    return;
  }

  const confirmed = window.confirm(`Сгенерить новый временный пароль для ${user.name}? Старый пароль перестанет работать.`);
  if (!confirmed) {
    return;
  }

  try {
    const data = await apiFetch(`/api/admin/users/${encodeURIComponent(user.id)}/temporary-password`, {
      method: "POST",
    });
    tempPasswordInput.value = data.temporaryPassword;
    tempPasswordBox.hidden = false;
    setUserProfileMessage("Временный пароль создан. Передайте его пользователю, чтобы он вошёл и сменил пароль.", "success");
  } catch (error) {
    setUserProfileMessage(error.message);
  }
}

async function copyTemporaryPassword() {
  const password = tempPasswordInput.value;
  if (!password) {
    return;
  }

  try {
    await navigator.clipboard.writeText(password);
    setUserProfileMessage("Временный пароль скопирован.", "success");
  } catch {
    tempPasswordInput.select();
    setUserProfileMessage("Не удалось скопировать автоматически. Пароль выделен в поле.", "error");
  }
}

function renderDayTabs() {
  dayTabs.innerHTML = "";
  const isAdmin = Boolean(appState.currentUser?.isAdmin);
  const visibleDays = getVisibleDays();

  activeViewButton.classList.toggle("is-active", appState.viewMode === "active");
  archiveViewButton.classList.toggle("is-active", appState.viewMode === "archive");
  dayTabs.hidden = appState.viewMode === "archive";
  if (appState.viewMode === "archive") return;

  visibleDays.forEach((day) => {
    const isActive = day.id === appState.activeDayId;
    const tabItem = document.createElement("div");
    const tab = document.createElement("a");
    const deleteButton = document.createElement("button");

    tabItem.className = `day-tab${isActive ? " is-active" : ""}`;
    tabItem.setAttribute("role", "presentation");

    tab.className = `tab${isActive ? " is-active" : ""}`;
    tab.href = getDayUrl(day, appState.viewMode);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(isActive));
    tab.textContent = `Вечер покраса ${formatDate(day.date)}`;
    tab.addEventListener("click", (event) => {
      event.preventDefault();
      appState.activeDayId = day.id;
      updateUrlForActiveDay();
      render();
    });

    deleteButton.type = "button";
    deleteButton.className = "delete-day-button";
    deleteButton.disabled = appState.days.length === 1 || !isAdmin;
    deleteButton.title = !isAdmin
      ? "Удалять вечера может только админ"
      : appState.days.length === 1
        ? "Нельзя удалить последний вечер"
        : "Удалить вечер";
    deleteButton.setAttribute("aria-label", `Удалить вечер покраса ${formatDate(day.date)}`);
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", () => deleteDay(day.id));

    tabItem.append(tab, deleteButton);
    dayTabs.append(tabItem);
  });

  if (!visibleDays.length) {
    const empty = document.createElement("span");
    empty.className = "tabs-empty";
    empty.textContent = appState.viewMode === "archive" ? "Архив пока пуст" : "Активных вечеров пока нет";
    dayTabs.append(empty);
  }
}

async function deleteDay(dayId) {
  if (appState.days.length === 1) {
    window.alert("Нельзя удалить последний вечер покраса.");
    return;
  }

  const day = appState.days.find((item) => item.id === dayId);
  const confirmed = window.confirm(`Удалить вечер покраса ${formatDate(day?.date)}? Все брони этого вечера тоже удалятся.`);
  if (!confirmed) {
    return;
  }

  try {
    await apiFetch(`/api/days/${encodeURIComponent(dayId)}`, { method: "DELETE" });
    await loadApp(appState.activeDayId === dayId ? null : appState.activeDayId);
  } catch (error) {
    window.alert(error.message);
  }
}

async function saveActiveDayTheme() {
  const activeDay = getActiveDay();
  if (!activeDay) {
    return;
  }

  if (activeDay.isArchived) {
    window.alert("Архивный вечер доступен только для просмотра.");
    return;
  }

  if (!appState.currentUser?.isAdmin) {
    window.alert("Менять тематику дня может только админ.");
    return;
  }

  try {
    const data = await apiFetch(`/api/days/${encodeURIComponent(activeDay.id)}/theme`, {
      method: "PATCH",
      body: { theme: dayThemeInput.value },
    });
    const day = appState.days.find((item) => item.id === activeDay.id);
    if (day) {
      day.theme = data.day.theme;
    }
    render();
  } catch (error) {
    window.alert(error.message);
  }
}

async function toggleActiveDayArchive() {
  const activeDay = getActiveDay();
  if (!activeDay) {
    return;
  }

  if (!appState.currentUser?.isAdmin) {
    window.alert("Архивировать вечера может только админ.");
    return;
  }

  const nextArchivedState = !activeDay.isArchived;
  const confirmed = window.confirm(
    nextArchivedState
      ? `Отправить вечер покраса ${formatDate(activeDay.date)} в архив?`
      : `Вернуть вечер покраса ${formatDate(activeDay.date)} из архива?`,
  );
  if (!confirmed) {
    return;
  }

  try {
    const data = await apiFetch(`/api/days/${encodeURIComponent(activeDay.id)}/archive`, {
      method: "PATCH",
      body: { isArchived: nextArchivedState },
    });
    const day = appState.days.find((item) => item.id === activeDay.id);
    if (day) {
      day.isArchived = data.day.isArchived;
    }
    appState.viewMode = nextArchivedState ? "archive" : "active";
    appState.activeDayId = data.day.id;
    updateUrlForActiveDay();
    await loadApp(data.day.id);
  } catch (error) {
    window.alert(error.message);
  }
}

function renderSeatingPlan() {
  cancelSeatDrag();
  const activeDay = getActiveDay();
  document.querySelector("#planHint").textContent = activeDay?.isArchived
    ? "Рассадка прошедшего вечера · только просмотр."
    : activeDay ? appState.currentUser
      ? "1-я смена — 19:00–21:00, 2-я — 21:00–00:00. Нажмите на строку для записи. Перетаскивание — между креслами одной смены. С клавиатуры: пробел, Tab, Enter."
      : "1-я смена — 19:00–21:00, 2-я — 21:00–00:00. Нажмите на свободную строку, чтобы записаться."
    : "Создайте вечер, чтобы открыть запись.";
  cardsGrid.innerHTML = `
    <section class="table-zone common-zone" aria-label="Общий стол, 8 мест">
      <div class="table-surface common-surface"><span class="table-mark">01</span><strong>Общий стол</strong><span>Покрас миниатюр</span><small>8 мест</small><span class="table-decoration" aria-hidden="true">✳</span></div>
    </section>
    <section class="table-zone tea-zone" aria-label="Чайный стол, 2 места">
      <div class="table-surface tea-surface"><span class="table-mark">02</span><strong>Чайный стол</strong><span>Киллтим · Бладболл · Андер</span></div>
    </section>
    <section class="table-zone big-zone" aria-label="Большой стол, две половины по 2 места">
      <div class="table-surface big-surface"><div><span class="table-mark">03 / A</span><strong>Большой стол</strong><span>Первая половина</span></div><div><span class="table-mark">03 / Б</span><strong>Большой стол</strong><span>Вторая половина</span></div></div>
    </section>
    <section class="table-zone kitchen-zone" aria-label="Кухонный стол, 2 места">
      <div class="table-surface kitchen-surface"><span class="table-mark">04</span><strong>Кухонный стол</strong><span>Бладболл · Андер</span></div>
    </section>`;

  const paintingPositions = [[50, 9], [12, 29], [88, 29], [12, 51], [88, 51], [12, 73], [88, 73], [50, 90]];
  paintingPositions.forEach(([x, y], index) => appendSeat(".common-zone", `paint-${index + 1}`, 0, x, y, String(index + 1)));
  appendSeat(".tea-zone", "tea-table", 0, 50, 12, "1");
  appendSeat(".tea-zone", "tea-table", 1, 50, 91, "2");
  appendSeat(".big-zone", "big-table-1", 0, 11, 28, "А1");
  appendSeat(".big-zone", "big-table-1", 1, 89, 28, "А2");
  appendSeat(".big-zone", "big-table-2", 0, 11, 75, "Б1");
  appendSeat(".big-zone", "big-table-2", 1, 89, 75, "Б2");
  appendSeat(".kitchen-zone", "kitchen-table", 0, 50, 12, "1");
  appendSeat(".kitchen-zone", "kitchen-table", 1, 50, 84, "2");
}

function appendSeat(zoneSelector, placeId, slotIndex, x, y, label) {
  const chair = document.createElement("div");
  chair.className = "chair";
  chair.style.left = `${x}%`;
  chair.style.top = `${y}%`;
  chair.innerHTML = `<span class="chair-label">Место ${escapeHtml(label)}</span>`;
  for (const shiftIndex of [0, 1]) {
  const player = getBookingSlots(placeId, shiftIndex)[slotIndex];
  const activeDay = getActiveDay();
  const place = getPlace(placeId);
  const isMine = player && appState.currentUser && player.userId === appState.currentUser.id;
  const status = player ? `${player.name}${player.time ? ` · ${player.time}` : ""}` : "Свободно";
  const seat = document.createElement("button");
  seat.type = "button";
  seat.className = `seat${player ? " is-booked" : ""}${isMine ? " is-mine" : ""}`;
  seat.dataset.placeId = placeId;
  seat.dataset.slotIndex = slotIndex;
  seat.dataset.shiftIndex = shiftIndex;
  seat.disabled = !activeDay || Boolean(activeDay.isArchived);
  const tableName = placeId.startsWith("big-table") ? `${place.title}, половина ${placeId.endsWith("1") ? "А" : "Б"}` : placeLabel(place);
  seat.setAttribute("aria-label", `${tableName}, место ${label}, ${shiftIndex + 1}-я смена (${SHIFT_TIMES[shiftIndex]}): ${status}`);
  seat.title = `${tableName} · ${shiftIndex + 1}-я смена (${SHIFT_TIMES[shiftIndex]}) · ${status}`;
  seat.innerHTML = `<b class="shift-number">${SHIFT_SHORT_TIMES[shiftIndex]}</b><span class="shift-person"><span class="seat-name">${escapeHtml(player?.name || "Свободно")}</span>${player?.time ? `<span class="seat-time">${escapeHtml(player.time)}</span>` : ""}</span>`;
  seat.classList.toggle("is-movable", canMovePaintSeat(placeId, shiftIndex));
  seat.addEventListener("click", () => {
    if (seatMoveBusy || Date.now() < suppressSeatClickUntil) return;
    if (seatDrag?.keyboard) {
      finishSeatDrag(placeId, shiftIndex);
      return;
    }
    openBooking(placeId, slotIndex, shiftIndex);
  });
  seat.addEventListener("pointerdown", event => startSeatDrag(event, seat, placeId));
  seat.addEventListener("keydown", event => {
    if (event.key !== " " && event.key !== "Enter") return;
    if (seatDrag?.keyboard) {
      event.preventDefault();
      finishSeatDrag(placeId, shiftIndex);
    } else if (event.key === " " && canMovePaintSeat(placeId, shiftIndex) && !seatMoveBusy) {
      event.preventDefault();
      beginSeatDrag(seat, placeId, { keyboard: true, active: true });
      document.querySelector("#seatMoveStatus").textContent = "Выберите кресло клавишей Tab и нажмите Enter. Escape — отмена.";
    }
  });
  chair.append(seat);
  }
  cardsGrid.querySelector(zoneSelector).append(chair);
}

function canMovePaintSeat(placeId, shiftIndex = 0) {
  const day = getActiveDay();
  const player = getBookingSlots(placeId, shiftIndex)[0];
  return /^paint-[1-8]$/.test(placeId) && Boolean(day && !day.isArchived && appState.currentUser && player &&
    (appState.currentUser.isAdmin || player.canDelete));
}

function canDropPaintSeat(placeId, shiftIndex) {
  if (!seatDrag || shiftIndex !== seatDrag.shiftIndex || seatDrag.dayId !== getActiveDay()?.id || placeId === seatDrag.fromPlaceId || !/^paint-[1-8]$/.test(placeId)) return false;
  return !getBookingSlots(placeId, shiftIndex)[0] || canMovePaintSeat(placeId, shiftIndex);
}

function beginSeatDrag(seat, placeId, details) {
  cancelSeatDrag();
  const shiftIndex = Number(seat.dataset.shiftIndex);
  seatDrag = { seat, fromPlaceId: placeId, shiftIndex, dayId: getActiveDay().id, bookingId: getBookingSlots(placeId, shiftIndex)[0].bookingId, ...details };
  if (seatDrag.active) highlightSeatTargets();
}

function highlightSeatTargets() {
  seatDrag.seat.classList.add("is-dragging");
  cardsGrid.querySelectorAll(".common-zone .seat").forEach(seat => seat.classList.toggle("is-drop-target", canDropPaintSeat(seat.dataset.placeId, Number(seat.dataset.shiftIndex))));
}

function startSeatDrag(event, seat, placeId) {
  if (event.button !== 0 || !event.isPrimary || seatMoveBusy || !canMovePaintSeat(placeId, Number(seat.dataset.shiftIndex)) || seatDrag?.keyboard) return;
  beginSeatDrag(seat, placeId, { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false });
  seat.setPointerCapture(event.pointerId);
}

function cancelSeatDrag() {
  if (seatDrag?.seat.hasPointerCapture(seatDrag.pointerId)) seatDrag.seat.releasePointerCapture(seatDrag.pointerId);
  seatDrag?.ghost?.remove();
  seatDrag = null;
  cardsGrid.querySelectorAll(".is-dragging, .is-drop-target, .is-drop-over").forEach(seat => seat.classList.remove("is-dragging", "is-drop-target", "is-drop-over"));
}

async function finishSeatDrag(toPlaceId, toShiftIndex) {
  if (!canDropPaintSeat(toPlaceId, toShiftIndex)) {
    cancelSeatDrag();
    document.querySelector("#seatMoveStatus").textContent = "Перенос отменён.";
    return;
  }
  const { dayId, fromPlaceId, bookingId, shiftIndex } = seatDrag;
  const targetBookingId = getBookingSlots(toPlaceId, shiftIndex)[0]?.bookingId || null;
  cancelSeatDrag();
  seatMoveBusy = true;
  cardsGrid.setAttribute("aria-busy", "true");
  const status = document.querySelector("#seatMoveStatus");
  status.textContent = "Сохраняем рассадку…";
  try {
    const result = await apiFetch(`/api/days/${encodeURIComponent(dayId)}/bookings/move`, {
      method: "POST", body: { fromPlaceId, toPlaceId, bookingId, targetBookingId, shiftIndex },
    });
    await loadApp(dayId);
    status.textContent = result.swapped ? "Участники поменялись местами." : "Участник перемещён.";
    cardsGrid.querySelector(`.seat[data-place-id="${toPlaceId}"][data-shift-index="${shiftIndex}"]`)?.focus();
  } catch (error) {
    await loadApp(dayId);
    status.textContent = error.message;
  } finally {
    seatMoveBusy = false;
    cardsGrid.removeAttribute("aria-busy");
  }
}

document.addEventListener("pointermove", event => {
  if (!seatDrag || seatDrag.keyboard || seatDrag.pointerId !== event.pointerId) return;
  if (!seatDrag.active) {
    if (Math.hypot(event.clientX - seatDrag.startX, event.clientY - seatDrag.startY) < 8) return;
    seatDrag.active = true;
    highlightSeatTargets();
    const ghost = document.createElement("div");
    ghost.className = "seat-drag-ghost";
    ghost.textContent = `${getBookingSlots(seatDrag.fromPlaceId, seatDrag.shiftIndex)[0].name} · ${seatDrag.shiftIndex + 1}-я смена (${SHIFT_TIMES[seatDrag.shiftIndex]})`;
    ghost.setAttribute("aria-hidden", "true");
    document.body.append(ghost);
    seatDrag.ghost = ghost;
  }
  seatDrag.ghost.style.left = `${event.clientX + 14}px`;
  seatDrag.ghost.style.top = `${event.clientY + 14}px`;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".seat");
  cardsGrid.querySelectorAll(".is-drop-over").forEach(seat => seat.classList.remove("is-drop-over"));
  if (canDropPaintSeat(target?.dataset.placeId, Number(target?.dataset.shiftIndex))) target.classList.add("is-drop-over");
});

document.addEventListener("pointerup", event => {
  if (!seatDrag || seatDrag.keyboard || seatDrag.pointerId !== event.pointerId) return;
  if (!seatDrag.active) { cancelSeatDrag(); return; }
  suppressSeatClickUntil = Date.now() + 400;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".seat");
  finishSeatDrag(target?.dataset.placeId, Number(target?.dataset.shiftIndex));
});
document.addEventListener("pointercancel", cancelSeatDrag);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && seatDrag) {
    suppressSeatClickUntil = Date.now() + 400;
    cancelSeatDrag();
    document.querySelector("#seatMoveStatus").textContent = "Перенос отменён.";
  }
});
window.addEventListener("blur", cancelSeatDrag);

function showArchiveIndex(event) {
  if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
  event?.preventDefault();
  appState.viewMode = "archive";
  appState.activeDayId = null;
  updateUrlForActiveDay();
  render();
}

function renderArchive() {
  const isArchive = appState.viewMode === "archive";
  const isIndex = isArchive && !getActiveDay();
  archiveIndex.hidden = !isIndex;
  archiveBack.hidden = !isArchive || isIndex;
  dayWorkspace.hidden = isIndex;
  document.querySelector(".stats").hidden = !getActiveDay();
  archiveList.innerHTML = "";
  if (!isIndex) return;
  const days = [...getVisibleDays()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  days.forEach((day) => {
    const count = [0, 1].reduce((sum, shift) => sum + Object.values(getDayBookings(day, shift)).reduce((n, slots) => n + (Array.isArray(slots) ? slots.filter(Boolean).length : 0), 0), 0);
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "archive-day-link";
    link.href = getDayUrl(day) + window.location.search;
    link.innerHTML = `<time datetime="${escapeAttribute(day.date)}">${escapeHtml(formatDate(day.date))}</time><span class="archive-day-theme">${escapeHtml(day.theme || "Вечер покраса")}</span><span class="archive-day-count">Записей: ${count}</span><span aria-hidden="true">↗</span>`;
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      appState.activeDayId = day.id;
      updateUrlForActiveDay();
      render();
      archiveBack.focus();
    });
    item.append(link);
    archiveList.append(item);
  });
  if (!days.length) archiveList.innerHTML = '<li class="empty-state">Архив пока пуст. Здесь появятся завершённые вечера.</li>';
}

function renderParticipants() {
  const rows = [0, 1].flatMap(shiftIndex => Object.entries(getActiveBookings(shiftIndex))
    .flatMap(([placeId, players]) =>
      (Array.isArray(players) ? players.filter(Boolean) : []).map((player) => ({
        place: getPlace(placeId),
        placeId,
        ...player,
        shiftIndex,
      })),
    ))
    .filter((row) => row.place)
    .sort((a, b) => a.shiftIndex - b.shiftIndex || (a.time || "99:99").localeCompare(b.time || "99:99") || placeLabel(a.place).localeCompare(placeLabel(b.place)));

  participantsBody.innerHTML = "";
  tableWrap.classList.toggle("has-rows", rows.length > 0);
  const canManagePayments = Boolean(appState.currentUser?.isAdmin && !getActiveDay()?.isArchived);

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const placeText = row.place.capacity > 1 ? `${placeLabel(row.place)} · Игрок ${row.slotIndex + 1}` : placeLabel(row.place);
    tr.className = row.paid ? "is-paid" : "";
    tr.innerHTML = `
      <td data-label="Имя">${escapeHtml(row.name)}</td>
      <td data-label="Телеграм">${escapeHtml(row.telegram)}</td>
      <td data-label="Время">${escapeHtml(row.time || "—")}</td>
      <td data-label="Стол">${escapeHtml(placeText)}<br><strong class="participant-shift">${row.shiftIndex + 1}-я смена · ${SHIFT_TIMES[row.shiftIndex]}</strong></td>
      <td data-label="Оплатил">
        <label class="paid-check${canManagePayments ? "" : " is-readonly"}" title="${canManagePayments ? "Отметить оплату" : "Оплату может отметить только админ"}">
          <input
            class="paid-checkbox"
            type="checkbox"
            data-place-id="${escapeHtml(row.placeId)}"
            data-slot-index="${row.slotIndex}"
            data-shift-index="${row.shiftIndex}"
            ${row.paid ? "checked" : ""}
            ${canManagePayments ? "" : "disabled"}
          />
          <span>${row.paid ? "Оплатил" : "Не оплатил"}</span>
        </label>
      </td>
    `;
    participantsBody.append(tr);
  });

  reservedCount.textContent = String(rows.length);
  freeCount.textContent = String(totalCapacity * 2 - rows.length);
  document.querySelector("#shiftSummary").textContent = [0, 1].map(shift => `${SHIFT_TIMES[shift]}: ${totalCapacity - rows.filter(row => row.shiftIndex === shift).length} свободно`).join(" · ");
}

function openBooking(placeId, selectedSlotIndex = 0, shiftIndex = 0) {
  const activeDay = getActiveDay();
  if (!activeDay || activeDay.isArchived) return;
  const place = getPlace(placeId);
  if (!place || selectedSlotIndex < 0 || selectedSlotIndex >= place.capacity || ![0, 1].includes(shiftIndex)) return;
  if (!appState.currentUser) {
    pendingBooking = { dayId: activeDay.id, placeId, slotIndex: selectedSlotIndex, shiftIndex };
    openAuthDialog();
    setAuthMode("register");
    authStatus.textContent = "Зарегистрируйтесь или войдите, чтобы записаться на выбранное место.";
    return;
  }

  const slots = getBookingSlots(placeId, shiftIndex);
  const player = slots[selectedSlotIndex];
  const canRelease = Boolean(player && (appState.currentUser?.isAdmin || player.canDelete));
  selectedBooking = { dayId: activeDay.id, slotIndex: selectedSlotIndex, shiftIndex, expectedBookingId: player?.bookingId || null };

  placeIdInput.value = placeId;
  const halfLabel = placeId.startsWith("big-table") ? ` · половина ${placeId.endsWith("1") ? "А" : "Б"}` : "";
  dialogTitle.textContent = `${place.title}${halfLabel} · место ${place.capacity === 1 ? place.detail.replace("Место ", "") : selectedSlotIndex + 1} · ${shiftIndex + 1}-я смена (${SHIFT_TIMES[shiftIndex]})`;
  bookingSlots.innerHTML = "";
  releaseButton.classList.toggle("is-hidden", !canRelease);
  releaseButton.textContent = "Освободить эту смену";
  formError.textContent = "";

  const fieldset = createPlayerSlot(place, player || {}, selectedSlotIndex);
  fieldset.classList.add("is-selected");
  bookingSlots.append(fieldset);

  bookingDialog.showModal();
  bookingSlots.querySelector(`.slot-name[data-slot-index="${selectedSlotIndex}"]:not(:disabled)`)?.focus();
}

function createPlayerSlot(place, player, slotIndex) {
  const slot = document.createElement("fieldset");
  const title = place.capacity === 1 ? "Игрок" : `Игрок ${slotIndex + 1}`;
  const hasActiveUser = Boolean(appState.currentUser);
  const canEditSlot = !player.bookingId || appState.currentUser?.isAdmin || player.canDelete;
  const disabled = canEditSlot ? "" : "disabled";
  slot.className = `player-slot${canEditSlot ? "" : " is-readonly"}`;
  slot.innerHTML = `
    <legend>${title}</legend>
    <input class="slot-user-id" data-slot-index="${slotIndex}" type="hidden" value="${escapeAttribute(player.userId || "")}" />
    <div class="slot-user-tools">
      <button
        class="ghost-button use-current-user-button"
        type="button"
        data-slot-index="${slotIndex}"
        ${hasActiveUser && canEditSlot ? "" : "disabled"}
      >
        Подставить себя
      </button>
      <label class="field compact-field">
        <span>Зарегистрированный юзер</span>
        <select class="slot-user-select" data-slot-index="${slotIndex}" ${appState.users.length && canEditSlot ? "" : "disabled"}>
          ${getUserOptionsHtml(player.userId || "")}
        </select>
      </label>
    </div>
    <div class="slot-grid">
      <label class="field">
        <span>Имя</span>
        <input
          class="slot-name"
          data-slot-index="${slotIndex}"
          type="text"
          autocomplete="name"
          value="${escapeAttribute(player.name || "")}"
          ${disabled}
        />
      </label>
      <label class="field">
        <span>Телеграм контакт</span>
        <input
          class="slot-telegram"
          data-slot-index="${slotIndex}"
          type="text"
          autocomplete="off"
          placeholder="@username"
          value="${escapeAttribute(player.telegram || "")}"
          ${disabled}
        />
      </label>
      <label class="field">
        <span>Время прихода</span>
        <input
          class="slot-time"
          data-slot-index="${slotIndex}"
          type="text"
          inputmode="numeric"
          maxlength="5"
          placeholder="чч:мм"
          value="${escapeAttribute(player.time || "")}"
          ${disabled}
        />
        <small class="field-hint">Необязательно. Если знаешь время, укажи в формате чч:мм.</small>
      </label>
    </div>
  `;
  return slot;
}

function getUserOptionsHtml(selectedUserId) {
  if (!appState.users.length) {
    return '<option value="">Нет зарегистрированных</option>';
  }

  return [
    '<option value="">Выбрать юзера</option>',
    ...appState.users.map((user) => {
      const selected = user.id === selectedUserId ? "selected" : "";
      return `<option value="${escapeAttribute(user.id)}" ${selected}>${escapeHtml(user.name)} · ${escapeHtml(user.telegram)}</option>`;
    }),
  ].join("");
}

function closeBooking() {
  selectedBooking = null;
  bookingForm.reset();
  bookingSlots.innerHTML = "";
  bookingDialog.close();
}

function openCreateDay() {
  if (!appState.currentUser?.isAdmin) {
    window.alert("Создавать новые вечера покраса может только админ.");
    return;
  }

  dayDateInput.value = todayLocal();
  dayThemeCreateInput.value = "";
  dayFormError.textContent = "";
  createDayDialog.showModal();
  dayDateInput.focus();
}

function closeCreateDay() {
  createDayForm.reset();
  createDayDialog.close();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function applyUserToSlot(slotIndex, user) {
  if (!user) {
    return;
  }

  const userIdInput = bookingSlots.querySelector(`.slot-user-id[data-slot-index="${slotIndex}"]`);
  const nameInput = bookingSlots.querySelector(`.slot-name[data-slot-index="${slotIndex}"]`);
  const telegramInput = bookingSlots.querySelector(`.slot-telegram[data-slot-index="${slotIndex}"]`);
  const timeInput = bookingSlots.querySelector(`.slot-time[data-slot-index="${slotIndex}"]`);
  const select = bookingSlots.querySelector(`.slot-user-select[data-slot-index="${slotIndex}"]`);

  if (userIdInput) {
    userIdInput.value = user.id;
  }

  if (nameInput) {
    nameInput.value = user.name;
  }

  if (telegramInput) {
    telegramInput.value = user.telegram;
  }

  if (select) {
    select.value = user.id;
  }

  if (timeInput && !timeInput.value) {
    timeInput.focus();
  }

  formError.textContent = "";
}

function collectPlayers(place) {
  const currentPlayers = getBookingSlots(place.id, selectedBooking.shiftIndex);
  const players = Array(place.capacity).fill(null);

  for (const slotIndex of [selectedBooking.slotIndex]) {
    const userId = bookingSlots.querySelector(`.slot-user-id[data-slot-index="${slotIndex}"]`)?.value || null;
    const name = bookingSlots.querySelector(`.slot-name[data-slot-index="${slotIndex}"]`)?.value.trim() || "";
    const telegramRaw =
      bookingSlots.querySelector(`.slot-telegram[data-slot-index="${slotIndex}"]`)?.value.trim() || "";
    const telegram = normalizeTelegram(telegramRaw);
    const time = bookingSlots.querySelector(`.slot-time[data-slot-index="${slotIndex}"]`)?.value.trim() || "";
    const hasAnyValue = Boolean(name || telegramRaw || time);

    if (!hasAnyValue) {
      continue;
    }

    if (!name || !telegram) {
      return {
        error: place.capacity === 1 ? "Заполни имя и телеграм." : `Заполни имя и телеграм у игрока ${slotIndex + 1}.`,
      };
    }

    if (time && !isValidTime(time)) {
      return {
        error:
          place.capacity === 1
            ? "Время должно быть в формате чч:мм."
            : `Время у игрока ${slotIndex + 1} должно быть в формате чч:мм.`,
        focusSlotIndex: slotIndex,
      };
    }

    players[slotIndex] = {
      userId,
      name,
      telegram,
      time,
      paid: Boolean(currentPlayers[slotIndex]?.paid),
    };
  }

  if (!players.some(Boolean)) {
    return {
      error: place.capacity === 1 ? "Заполни имя и телеграм." : "Добавь хотя бы одного игрока.",
    };
  }

  return {
    players,
    hasMissingTime: players.some((player) => player && !player.time),
  };
}

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!selectedBooking || selectedBooking.dayId !== getActiveDay()?.id) return;
  const activeDay = getActiveDay();
  const place = getPlace(placeIdInput.value);
  const result = collectPlayers(place);

  if (result.error) {
    formError.textContent = result.error;
    if (Number.isInteger(result.focusSlotIndex)) {
      bookingSlots.querySelector(`.slot-time[data-slot-index="${result.focusSlotIndex}"]`)?.focus();
    }
    return;
  }

  try {
    await apiFetch(`/api/days/${encodeURIComponent(activeDay.id)}/bookings/${encodeURIComponent(place.id)}`, {
      method: "PUT",
      body: { players: result.players, ...selectedBooking },
    });
    closeBooking();
    await loadApp(activeDay.id);
    if (result.hasMissingTime) {
      window.alert("Бронь сохранена. Время прихода не указано — напомни человеку добавить его позже.");
    }
  } catch (error) {
    formError.textContent = error.message;
  }
});

createDayForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const date = dayDateInput.value;
  const theme = dayThemeCreateInput.value.trim();
  if (!isDateValue(date)) {
    dayFormError.textContent = "Выбери дату.";
    return;
  }

  try {
    const data = await apiFetch("/api/days", {
      method: "POST",
      body: { date, theme },
    });
    closeCreateDay();
    appState.viewMode = "active";
    appState.activeDayId = data.day.id;
    window.history.pushState({}, "", getDayUrl(data.day, "active"));
    await loadApp(data.day.id);
  } catch (error) {
    dayFormError.textContent = error.message;
  }
});

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (authMode === "profile") {
    updateProfileFromForm();
    return;
  }

  if (authMode === "login") {
    loginUserFromForm();
    return;
  }

  registerUserFromForm();
});

authLoginTab.addEventListener("click", () => setAuthMode("login"));
authRegisterTab.addEventListener("click", () => setAuthMode("register"));
openAuthButton.addEventListener("click", openAuthDialog);
closeAuthButton.addEventListener("click", closeAuthDialog);
manageUsersButton.addEventListener("click", openUsersDialog);
closeUsersButton.addEventListener("click", closeUsersDialog);
closeUserProfileButton.addEventListener("click", closeUserProfile);
grantProfileAdminButton.addEventListener("click", () => {
  const user = getSelectedUser();
  if (user) {
    grantAdminToUser(user.id);
  }
});
resetUserPasswordButton.addEventListener("click", resetTemporaryPasswordForSelectedUser);
copyTempPasswordButton.addEventListener("click", copyTemporaryPassword);
logoutButton.addEventListener("click", logoutUser);

activeViewButton.addEventListener("click", (event) => {
  event.preventDefault();
  appState.viewMode = "active";
  appState.activeDayId = getVisibleDays()[0]?.id || null;
  updateUrlForActiveDay();
  render();
});

archiveViewButton.addEventListener("click", showArchiveIndex);
archiveBack.addEventListener("click", showArchiveIndex);

dayThemeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveActiveDayTheme();
});

archiveDayButton.addEventListener("click", toggleActiveDayArchive);

usersBody.addEventListener("click", (event) => {
  if (!(event.target instanceof HTMLButtonElement)) {
    return;
  }

  if (event.target.classList.contains("grant-admin-button")) {
    grantAdminToUser(event.target.dataset.userId);
    return;
  }

  if (event.target.classList.contains("open-user-profile-button")) {
    openUserProfile(event.target.dataset.userId);
  }
});

bookingSlots.addEventListener("click", (event) => {
  if (!(event.target instanceof HTMLButtonElement) || !event.target.classList.contains("use-current-user-button")) {
    return;
  }

  if (!appState.currentUser) {
    formError.textContent = "Сначала войдите в профиль.";
    return;
  }

  applyUserToSlot(Number(event.target.dataset.slotIndex), appState.currentUser);
});

bookingSlots.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLSelectElement) || !event.target.classList.contains("slot-user-select")) {
    return;
  }

  const user = getUserById(event.target.value);
  applyUserToSlot(Number(event.target.dataset.slotIndex), user);
});

bookingSlots.addEventListener("input", (event) => {
  if (!(event.target instanceof HTMLInputElement)) {
    return;
  }

  if (event.target.classList.contains("slot-time")) {
    event.target.value = formatTimeInput(event.target.value);
    event.target.setSelectionRange(event.target.value.length, event.target.value.length);
  }

  if (event.target.classList.contains("slot-name") || event.target.classList.contains("slot-telegram")) {
    const userIdInput = bookingSlots.querySelector(`.slot-user-id[data-slot-index="${event.target.dataset.slotIndex}"]`);
    if (userIdInput) {
      userIdInput.value = "";
    }
  }

  formError.textContent = "";
});

participantsBody.addEventListener("change", async (event) => {
  if (!(event.target instanceof HTMLInputElement) || !event.target.classList.contains("paid-checkbox")) {
    return;
  }

  const activeDay = getActiveDay();
  if (activeDay?.isArchived) {
    event.target.checked = !event.target.checked;
    window.alert("Архивный вечер доступен только для просмотра.");
    return;
  }

  if (!appState.currentUser?.isAdmin) {
    event.target.checked = !event.target.checked;
    window.alert("Отмечать оплату может только админ.");
    return;
  }

  const placeId = event.target.dataset.placeId;
  const slotIndex = event.target.dataset.slotIndex;

  try {
    await apiFetch(
      `/api/days/${encodeURIComponent(activeDay.id)}/bookings/${encodeURIComponent(placeId)}/${slotIndex}/paid`,
      {
        method: "PATCH",
        body: { paid: event.target.checked, shiftIndex: Number(event.target.dataset.shiftIndex) },
      },
    );
    await loadApp(activeDay.id);
  } catch (error) {
    window.alert(error.message);
    await loadApp(activeDay.id);
  }
});

releaseButton.addEventListener("click", async () => {
  if (!selectedBooking || selectedBooking.dayId !== getActiveDay()?.id) return;
  const activeDay = getActiveDay();
  const placeId = placeIdInput.value;
  if (activeDay?.isArchived) {
    formError.textContent = "Архивный вечер доступен только для просмотра.";
    return;
  }

  try {
    await apiFetch(`/api/days/${encodeURIComponent(activeDay.id)}/bookings/${encodeURIComponent(placeId)}`, {
      method: "DELETE",
      body: selectedBooking,
    });
    closeBooking();
    await loadApp(activeDay.id);
  } catch (error) {
    formError.textContent = error.message;
  }
});

closeDialogButton.addEventListener("click", closeBooking);
openCreateDayButton.addEventListener("click", openCreateDay);
closeCreateDayButton.addEventListener("click", closeCreateDay);
cancelCreateDayButton.addEventListener("click", closeCreateDay);

clearAllButton.addEventListener("click", async () => {
  const activeDay = getActiveDay();
  if (activeDay?.isArchived) {
    window.alert("Архивный вечер доступен только для просмотра.");
    return;
  }

  if (!appState.currentUser?.isAdmin) {
    window.alert("Очищать все брони может только админ.");
    return;
  }

  if (!activeDay || ![0, 1].some(shift => Object.keys(getDayBookings(activeDay, shift)).length)) {
    return;
  }

  const confirmed = window.confirm("Очистить все брони за этот вечер?");
  if (!confirmed) {
    return;
  }

  try {
    await apiFetch(`/api/days/${encodeURIComponent(activeDay.id)}/bookings`, { method: "DELETE" });
    await loadApp(activeDay.id);
  } catch (error) {
    window.alert(error.message);
  }
});

bookingDialog.addEventListener("click", (event) => {
  if (event.target === bookingDialog) {
    closeBooking();
  }
});

createDayDialog.addEventListener("click", (event) => {
  if (event.target === createDayDialog) {
    closeCreateDay();
  }
});

authDialog.addEventListener("click", (event) => {
  if (event.target === authDialog) {
    closeAuthDialog();
  }
});

authDialog.addEventListener("cancel", () => {
  pendingBooking = null;
  setAuthMessage("");
});

usersDialog.addEventListener("click", (event) => {
  if (event.target === usersDialog) {
    closeUsersDialog();
  }
});

userProfileDialog.addEventListener("click", (event) => {
  if (event.target === userProfileDialog) {
    closeUserProfile();
  }
});

window.addEventListener("popstate", () => {
  const route = getRouteState();
  appState.viewMode = route.viewMode;
  appState.activeDayId = getVisibleDays().some((day) => day.id === route.dayId)
    ? route.dayId
    : route.viewMode === "archive" ? null : getVisibleDays()[0]?.id || null;
  render();
});

function render() {
  const activeDay = getActiveDay();
  currentDayDate.textContent = activeDay
    ? `${activeDay.isArchived ? "Архив · " : ""}Дата: ${formatDate(activeDay.date)}`
    : appState.viewMode === "archive"
      ? "Архив пока пуст"
      : "Дней пока нет";
  dayThemeInput.value = activeDay?.theme || "";
  dayThemeInput.disabled = !activeDay || !appState.currentUser?.isAdmin || activeDay.isArchived;
  saveDayThemeButton.disabled = !activeDay || !appState.currentUser?.isAdmin || activeDay.isArchived;
  dayThemeInput.placeholder = appState.currentUser?.isAdmin
    ? "Например: вархаммер, киллтим, террейн"
    : "Тематика пока не задана";
  renderAuth();
  renderDayTabs();
  renderArchive();
  renderSeatingPlan();
  renderParticipants();
}

loadApp();
