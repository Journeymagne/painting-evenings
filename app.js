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

const accountStatus = document.querySelector("#accountStatus");
const openAuthButton = document.querySelector("#openAuthButton");
const manageUsersButton = document.querySelector("#manageUsersButton");
const logoutButton = document.querySelector("#logoutButton");
const dayTabs = document.querySelector("#dayTabs");
const dayThemeForm = document.querySelector("#dayThemeForm");
const dayThemeInput = document.querySelector("#dayThemeInput");
const saveDayThemeButton = document.querySelector("#saveDayThemeButton");
const currentDayDate = document.querySelector("#currentDayDate");
const cardsGrid = document.querySelector("#cardsGrid");
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
const bookingDialog = document.querySelector("#bookingDialog");
const bookingForm = document.querySelector("#bookingForm");
const bookingSlots = document.querySelector("#bookingSlots");
const placeIdInput = document.querySelector("#placeId");
const dialogTitle = document.querySelector("#dialogTitle");
const formError = document.querySelector("#formError");
const releaseButton = document.querySelector("#releaseButton");
const closeDialogButton = document.querySelector("#closeDialogButton");
const clearAllButton = document.querySelector("#clearAllButton");
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
    const data = await apiFetch("/api/state");
    appState.days = data.days || [];
    appState.users = data.users || [];
    appState.currentUser = data.currentUser || null;
    appState.activeDayId = appState.days.some((day) => day.id === preferredDayId)
      ? preferredDayId
      : appState.days[0]?.id || null;
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
  return appState.days.find((day) => day.id === appState.activeDayId) || appState.days[0] || null;
}

function getActiveBookings() {
  return getActiveDay()?.bookings || {};
}

function getBookingSlots(placeId) {
  const players = getActiveBookings()[placeId];
  return Array.isArray(players) ? players : [];
}

function getBookingPlayers(placeId) {
  return getBookingSlots(placeId).filter(Boolean);
}

function getUserById(userId) {
  return appState.users.find((user) => user.id === userId);
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
  const role = user?.isAdmin ? " · админ" : "";
  accountStatus.textContent = user ? `${user.name} · ${user.telegram}${role}` : "Не вошли";
  authStatus.textContent = user ? "Можно изменить имя, пароль и телеграм контакт." : "Войдите или зарегистрируйтесь";
  openAuthButton.textContent = user ? "Профиль" : "Войти";
  manageUsersButton.hidden = !user?.isAdmin;
  logoutButton.hidden = !user;
  closeAuthButton.hidden = !user;
  openCreateDayButton.disabled = !user?.isAdmin;
  openCreateDayButton.title = user?.isAdmin ? "Создать вечер покраса" : "Создавать вечера может только админ";
  clearAllButton.disabled = !user?.isAdmin;
  clearAllButton.title = user?.isAdmin ? "Очистить все брони дня" : "Очищать все брони может только админ";
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
    const action = user.isAdmin
      ? "Админ"
      : `<button class="primary-button compact-button grant-admin-button" type="button" data-user-id="${escapeAttribute(user.id)}">Сделать админом</button>`;

    tr.innerHTML = `
      <td>${escapeHtml(user.name)}${isSelf ? " (вы)" : ""}</td>
      <td>${escapeHtml(user.telegram)}</td>
      <td>${user.isAdmin ? "Админ" : "Пользователь"}</td>
      <td>${action}</td>
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
  authForm.reset();
  authDialog.close();
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
    closeAuthDialog();
    await loadApp(appState.activeDayId);
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
    closeAuthDialog();
    await loadApp(appState.activeDayId);
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
  } catch (error) {
    window.alert(error.message);
  }
}

function renderDayTabs() {
  dayTabs.innerHTML = "";
  const isAdmin = Boolean(appState.currentUser?.isAdmin);

  appState.days.forEach((day) => {
    const isActive = day.id === appState.activeDayId;
    const tabItem = document.createElement("div");
    const tab = document.createElement("button");
    const deleteButton = document.createElement("button");

    tabItem.className = `day-tab${isActive ? " is-active" : ""}`;
    tabItem.setAttribute("role", "presentation");

    tab.type = "button";
    tab.className = `tab${isActive ? " is-active" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(isActive));
    tab.textContent = `Вечер покраса ${formatDate(day.date)}`;
    tab.addEventListener("click", () => {
      appState.activeDayId = day.id;
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

function renderCards() {
  cardsGrid.innerHTML = "";
  const isViewOnly = !appState.currentUser;

  places.forEach((place) => {
    const players = getBookingPlayers(place.id);
    const playerCount = players.length;
    const isFull = playerCount >= place.capacity;
    const isPartial = playerCount > 0 && !isFull;
    const stateClass = isFull ? " is-booked" : isPartial ? " is-partial" : "";
    const card = document.createElement("button");
    card.type = "button";
    card.className = `place-card${stateClass}${isViewOnly ? " is-view-only" : ""}`;
    card.setAttribute("aria-label", `${placeLabel(place)} ${getCardStatusText(place, playerCount)}`);
    card.setAttribute("aria-disabled", String(isViewOnly));
    card.disabled = isViewOnly;
    card.title = isViewOnly ? "Войдите, чтобы добавлять или менять записи" : "";
    card.dataset.placeId = place.id;

    card.innerHTML = `
      <span class="place-main">
        <span class="place-title">${escapeHtml(place.title)}</span>
        <span class="place-detail">${escapeHtml(place.detail)}</span>
      </span>
      <span class="place-footer">
        <span>${escapeHtml(getCardSummary(place, players))}</span>
        <span class="status-pill">${escapeHtml(getCardStatusText(place, playerCount))}</span>
      </span>
    `;

    if (!isViewOnly) {
      card.addEventListener("click", () => openBooking(place.id));
    }
    cardsGrid.append(card);
  });
}

function getCardSummary(place, players) {
  if (!players.length) {
    return "Свободно";
  }

  if (place.capacity === 1) {
    return `${players[0].name}, ${players[0].time}`;
  }

  const names = players.map((player) => player.name).join(", ");
  return `${players.length} из ${place.capacity}: ${names}`;
}

function getCardStatusText(place, playerCount) {
  if (!playerCount) {
    return "Открыто";
  }

  if (playerCount < place.capacity) {
    return `${playerCount}/${place.capacity}`;
  }

  return "Занято";
}

function renderParticipants() {
  const rows = Object.entries(getActiveBookings())
    .flatMap(([placeId, players]) =>
      (Array.isArray(players) ? players.filter(Boolean) : []).map((player) => ({
        place: getPlace(placeId),
        placeId,
        ...player,
      })),
    )
    .filter((row) => row.place)
    .sort((a, b) => a.time.localeCompare(b.time) || placeLabel(a.place).localeCompare(placeLabel(b.place)));

  participantsBody.innerHTML = "";
  tableWrap.classList.toggle("has-rows", rows.length > 0);
  const canManagePayments = Boolean(appState.currentUser?.isAdmin);

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const placeText = row.place.capacity > 1 ? `${placeLabel(row.place)} · Игрок ${row.slotIndex + 1}` : placeLabel(row.place);
    tr.className = row.paid ? "is-paid" : "";
    tr.innerHTML = `
      <td data-label="Имя">${escapeHtml(row.name)}</td>
      <td data-label="Телеграм">${escapeHtml(row.telegram)}</td>
      <td data-label="Время">${escapeHtml(row.time)}</td>
      <td data-label="Стол">${escapeHtml(placeText)}</td>
      <td data-label="Оплатил">
        <label class="paid-check${canManagePayments ? "" : " is-readonly"}" title="${canManagePayments ? "Отметить оплату" : "Оплату может отметить только админ"}">
          <input
            class="paid-checkbox"
            type="checkbox"
            data-place-id="${escapeHtml(row.placeId)}"
            data-slot-index="${row.slotIndex}"
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
  freeCount.textContent = String(totalCapacity - rows.length);
}

function openBooking(placeId) {
  if (!appState.currentUser) {
    openAuthDialog();
    return;
  }

  const activeDay = getActiveDay();
  if (!activeDay) {
    window.alert("Сначала создайте вечер покраса.");
    return;
  }

  const place = getPlace(placeId);
  const slots = getBookingSlots(placeId);
  const players = getBookingPlayers(placeId);
  const canRelease = Boolean(players.length && (appState.currentUser?.isAdmin || players.some((player) => player.canDelete)));

  placeIdInput.value = placeId;
  dialogTitle.textContent = placeLabel(place);
  bookingSlots.innerHTML = "";
  releaseButton.classList.toggle("is-hidden", !canRelease);
  releaseButton.textContent = appState.currentUser?.isAdmin ? "Освободить" : "Удалить мои записи";
  formError.textContent = "";

  Array.from({ length: place.capacity }, (_, slotIndex) => {
    const player = slots[slotIndex] || {};
    bookingSlots.append(createPlayerSlot(place, player, slotIndex));
  });

  bookingDialog.showModal();
  bookingSlots.querySelector("input:not([type='hidden'])")?.focus();
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
  const currentPlayers = getBookingSlots(place.id);
  const players = [];

  for (let slotIndex = 0; slotIndex < place.capacity; slotIndex += 1) {
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

    if (!name || !telegram || !time) {
      return {
        error: place.capacity === 1 ? "Заполни имя, телеграм и время." : `Заполни все поля у игрока ${slotIndex + 1}.`,
      };
    }

    if (!isValidTime(time)) {
      return {
        error:
          place.capacity === 1
            ? "Время должно быть в формате чч:мм."
            : `Время у игрока ${slotIndex + 1} должно быть в формате чч:мм.`,
        focusSlotIndex: slotIndex,
      };
    }

    players.push({
      userId,
      name,
      telegram,
      time,
      paid: Boolean(currentPlayers[slotIndex]?.paid),
    });
  }

  if (!players.length) {
    return {
      error: place.capacity === 1 ? "Заполни имя, телеграм и время." : "Добавь хотя бы одного игрока.",
    };
  }

  return { players };
}

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

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
      body: { players: result.players },
    });
    closeBooking();
    await loadApp(activeDay.id);
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
logoutButton.addEventListener("click", logoutUser);

dayThemeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveActiveDayTheme();
});

usersBody.addEventListener("click", (event) => {
  if (!(event.target instanceof HTMLButtonElement) || !event.target.classList.contains("grant-admin-button")) {
    return;
  }

  grantAdminToUser(event.target.dataset.userId);
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
        body: { paid: event.target.checked },
      },
    );
    await loadApp(activeDay.id);
  } catch (error) {
    window.alert(error.message);
    await loadApp(activeDay.id);
  }
});

releaseButton.addEventListener("click", async () => {
  const activeDay = getActiveDay();
  const placeId = placeIdInput.value;

  try {
    await apiFetch(`/api/days/${encodeURIComponent(activeDay.id)}/bookings/${encodeURIComponent(placeId)}`, {
      method: "DELETE",
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
  if (!appState.currentUser?.isAdmin) {
    window.alert("Очищать все брони может только админ.");
    return;
  }

  if (!activeDay || !Object.keys(activeDay.bookings || {}).length) {
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
  setAuthMessage("");
});

usersDialog.addEventListener("click", (event) => {
  if (event.target === usersDialog) {
    closeUsersDialog();
  }
});

function render() {
  const activeDay = getActiveDay();
  currentDayDate.textContent = activeDay ? `Дата: ${formatDate(activeDay.date)}` : "Дней пока нет";
  dayThemeInput.value = activeDay?.theme || "";
  dayThemeInput.disabled = !activeDay || !appState.currentUser?.isAdmin;
  saveDayThemeButton.disabled = !activeDay || !appState.currentUser?.isAdmin;
  dayThemeInput.placeholder = appState.currentUser?.isAdmin
    ? "Например: вархаммер, киллтим, террейн"
    : "Тематика пока не задана";
  renderAuth();
  renderDayTabs();
  renderCards();
  renderParticipants();
}

loadApp();
