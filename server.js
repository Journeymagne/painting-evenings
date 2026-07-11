const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || "postgres://paint:paint@localhost:5432/paint_tracker";

const places = [
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `paint-${index + 1}`,
    title: "Покрасоместо",
    detail: `Место ${index + 1}`,
    capacity: 1,
  })),
  { id: "big-table-1", title: "Большой стол", detail: "Киллтим, Бладболл, Андер", capacity: 2 },
  { id: "big-table-2", title: "Большой стол", detail: "Киллтим, Бладболл, Андер", capacity: 2 },
  { id: "tea-table", title: "Чайный стол", detail: "Киллтим, Бладболл, Андер", capacity: 2 },
  { id: "kitchen-table", title: "Кухонный стол", detail: "Бладболл, Андер", capacity: 2 },
];

const placeById = new Map(places.map((place) => [place.id, place]));
const pool = new Pool({ connectionString: DATABASE_URL });

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeTelegram(value = "") {
  const trimmed = String(value).trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function isDateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function isValidTime(value) {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(value));
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
}

function publicUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    telegram: row.telegram,
    isAdmin: Boolean(row.isAdmin ?? row.is_admin),
  };
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      telegram TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS users_lower_name_unique ON users (lower(name));

    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS paint_days (
      id TEXT PRIMARY KEY,
      paint_date DATE NOT NULL UNIQUE,
      theme TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS booking_slots (
      id TEXT PRIMARY KEY,
      day_id TEXT NOT NULL REFERENCES paint_days(id) ON DELETE CASCADE,
      place_id TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      guest_name TEXT NOT NULL,
      telegram TEXT NOT NULL,
      arrival_time TIME NOT NULL,
      paid BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(day_id, place_id, slot_index)
    );
  `);

  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE paint_days ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT ''");
  await pool.query(`
    UPDATE users
    SET is_admin = true
    WHERE id = (
      SELECT id FROM users ORDER BY created_at, id LIMIT 1
    )
    AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = true)
  `);

  await pool.query(
    `
      INSERT INTO paint_days (id, paint_date, theme)
      SELECT $1, $2, $3
      WHERE NOT EXISTS (SELECT 1 FROM paint_days)
    `,
    [createId("day"), todayIsoDate(), ""],
  );
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function getCurrentUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT users.id, users.name, users.telegram
      , users.is_admin AS "isAdmin"
      FROM user_sessions
      JOIN users ON users.id = user_sessions.user_id
      WHERE user_sessions.token = $1
    `,
    [token],
  );
  return publicUser(result.rows[0]);
}

async function requireUser(req, res) {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) {
    sendError(res, 401, "Нужно войти в профиль.");
    return null;
  }
  return currentUser;
}

async function requireAdmin(req, res) {
  const currentUser = await requireUser(req, res);
  if (!currentUser) {
    return null;
  }

  if (!currentUser.isAdmin) {
    sendError(res, 403, "Это действие доступно только админу.");
    return null;
  }

  return currentUser;
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("INSERT INTO user_sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
  return token;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new Error("Слишком большой запрос.");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

async function getState(req, res) {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) {
    sendJson(res, 200, {
      currentUser: null,
      days: [],
      users: [],
    });
    return;
  }

  const [daysResult, bookingsResult, usersResult] = await Promise.all([
    pool.query("SELECT id, paint_date::text AS date, theme FROM paint_days ORDER BY paint_date, id"),
    pool.query(`
      SELECT
        id,
        day_id AS "dayId",
        place_id AS "placeId",
        slot_index AS "slotIndex",
        user_id AS "userId",
        guest_name AS name,
        telegram,
        to_char(arrival_time, 'HH24:MI') AS time,
        paid
      FROM booking_slots
      ORDER BY day_id, place_id, slot_index
    `),
    pool.query('SELECT id, name, telegram, is_admin AS "isAdmin" FROM users ORDER BY lower(name), name'),
  ]);

  const dayMap = new Map();
  const days = daysResult.rows.map((row) => {
    const day = {
      id: row.id,
      date: row.date,
      theme: row.theme || "",
      bookings: {},
    };
    dayMap.set(day.id, day);
    return day;
  });

  bookingsResult.rows.forEach((row) => {
    const day = dayMap.get(row.dayId);
    if (!day) {
      return;
    }

    if (!day.bookings[row.placeId]) {
      day.bookings[row.placeId] = [];
    }

    day.bookings[row.placeId].push({
      bookingId: row.id,
      slotIndex: row.slotIndex,
      userId: row.userId,
      name: row.name,
      telegram: row.telegram,
      time: row.time,
      paid: row.paid,
    });
  });

  sendJson(res, 200, {
    currentUser,
    days,
    users: usersResult.rows.map(publicUser),
  });
}

async function register(req, res) {
  const body = await readBody(req);
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  const telegram = normalizeTelegram(body.telegram || "");

  if (!name || !password || !telegram) {
    sendError(res, 400, "Для регистрации нужны имя, пароль и Telegram.");
    return;
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const usersCountResult = await pool.query("SELECT count(*)::int AS count FROM users");
  const user = {
    id: createId("user"),
    name,
    telegram,
    salt,
    passwordHash: hashPassword(password, salt),
    isAdmin: usersCountResult.rows[0].count === 0,
  };

  try {
    await pool.query(
      `
        INSERT INTO users (id, name, telegram, password_salt, password_hash, is_admin)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [user.id, user.name, user.telegram, user.salt, user.passwordHash, user.isAdmin],
    );
  } catch (error) {
    if (error.code === "23505") {
      sendError(res, 409, "Пользователь с таким именем уже существует.");
      return;
    }
    throw error;
  }

  const token = await createSession(user.id);
  sendJson(res, 201, {
    token,
    user: publicUser(user),
  });
}

async function login(req, res) {
  const body = await readBody(req);
  const name = String(body.name || "").trim();
  const password = String(body.password || "");

  if (!name || !password) {
    sendError(res, 400, "Для входа нужны имя и пароль.");
    return;
  }

  const result = await pool.query(
    `
      SELECT id, name, telegram, password_salt, password_hash
      , is_admin AS "isAdmin"
      FROM users
      WHERE lower(name) = lower($1)
    `,
    [name],
  );
  const user = result.rows[0];

  if (!user || user.password_hash !== hashPassword(password, user.password_salt)) {
    sendError(res, 401, "Неверное имя или пароль.");
    return;
  }

  const token = await createSession(user.id);
  sendJson(res, 200, {
    token,
    user: publicUser(user),
  });
}

async function logout(req, res) {
  const token = getBearerToken(req);
  if (token) {
    await pool.query("DELETE FROM user_sessions WHERE token = $1", [token]);
  }
  sendJson(res, 200, { ok: true });
}

async function updateProfile(req, res, currentUser) {
  const body = await readBody(req);
  const name = String(body.name || "").trim();
  const telegram = normalizeTelegram(body.telegram || "");
  const password = String(body.password || "");

  if (!name || !telegram) {
    sendError(res, 400, "Заполните имя и Telegram.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let result;
    if (password) {
      const salt = crypto.randomBytes(16).toString("hex");
      const passwordHash = hashPassword(password, salt);
      result = await client.query(
        `
          UPDATE users
          SET name = $1, telegram = $2, password_salt = $3, password_hash = $4
          WHERE id = $5
          RETURNING id, name, telegram, is_admin AS "isAdmin"
        `,
        [name, telegram, salt, passwordHash, currentUser.id],
      );
    } else {
      result = await client.query(
        `
          UPDATE users
          SET name = $1, telegram = $2
          WHERE id = $3
          RETURNING id, name, telegram, is_admin AS "isAdmin"
        `,
        [name, telegram, currentUser.id],
      );
    }

    await client.query(
      `
        UPDATE booking_slots
        SET guest_name = $1, telegram = $2, updated_at = now()
        WHERE user_id = $3
      `,
      [name, telegram, currentUser.id],
    );

    await client.query("COMMIT");
    sendJson(res, 200, { user: publicUser(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      sendError(res, 409, "Пользователь с таким именем уже существует.");
      return;
    }
    throw error;
  } finally {
    client.release();
  }
}

async function createDay(req, res) {
  const body = await readBody(req);
  const date = String(body.date || "");
  const theme = String(body.theme || "").trim().slice(0, 120);

  if (!isDateValue(date)) {
    sendError(res, 400, "Некорректная дата.");
    return;
  }

  const day = {
    id: createId("day"),
    date,
    theme,
  };

  try {
    await pool.query("INSERT INTO paint_days (id, paint_date, theme) VALUES ($1, $2, $3)", [day.id, day.date, day.theme]);
  } catch (error) {
    if (error.code === "23505") {
      sendError(res, 409, "Вечер с такой датой уже есть.");
      return;
    }
    throw error;
  }

  sendJson(res, 201, { day });
}

async function deleteDay(req, res, dayId) {
  const countResult = await pool.query("SELECT count(*)::int AS count FROM paint_days");
  if (countResult.rows[0].count <= 1) {
    sendError(res, 400, "Нельзя удалить последний вечер покраса.");
    return;
  }

  const result = await pool.query("DELETE FROM paint_days WHERE id = $1", [dayId]);
  if (!result.rowCount) {
    sendError(res, 404, "Вечер не найден.");
    return;
  }

  sendJson(res, 200, { ok: true });
}

async function updateDayTheme(req, res, dayId) {
  const body = await readBody(req);
  const theme = String(body.theme || "").trim().slice(0, 120);
  const result = await pool.query(
    `
      UPDATE paint_days
      SET theme = $1
      WHERE id = $2
      RETURNING id, paint_date::text AS date, theme
    `,
    [theme, dayId],
  );

  if (!result.rowCount) {
    sendError(res, 404, "Вечер не найден.");
    return;
  }

  sendJson(res, 200, {
    day: {
      id: result.rows[0].id,
      date: result.rows[0].date,
      theme: result.rows[0].theme || "",
    },
  });
}

async function replacePlaceBookings(req, res, dayId, placeId, currentUser) {
  const place = placeById.get(placeId);
  if (!place) {
    sendError(res, 404, "Место не найдено.");
    return;
  }

  const dayResult = await pool.query("SELECT id FROM paint_days WHERE id = $1", [dayId]);
  if (!dayResult.rowCount) {
    sendError(res, 404, "Вечер не найден.");
    return;
  }

  const body = await readBody(req);
  const existingResult = await pool.query(
    `
      SELECT slot_index AS "slotIndex", paid
      FROM booking_slots
      WHERE day_id = $1 AND place_id = $2
    `,
    [dayId, placeId],
  );
  const existingPaidBySlot = new Map(existingResult.rows.map((row) => [row.slotIndex, Boolean(row.paid)]));
  const rawPlayers = Array.isArray(body.players) ? body.players : [];
  const players = rawPlayers
    .filter((player) => player && (player.name || player.telegram || player.time))
    .slice(0, place.capacity)
    .map((player, slotIndex) => ({
      userId: player.userId || null,
      name: String(player.name || "").trim(),
      telegram: normalizeTelegram(player.telegram || ""),
      time: String(player.time || "").trim(),
      paid: currentUser.isAdmin ? Boolean(player.paid) : Boolean(existingPaidBySlot.get(slotIndex)),
    }));

  if (!players.length) {
    sendError(res, 400, "Добавьте хотя бы одного игрока.");
    return;
  }

  for (const player of players) {
    if (!player.name || !player.telegram || !isValidTime(player.time)) {
      sendError(res, 400, "У каждого игрока должны быть имя, Telegram и время в формате чч:мм.");
      return;
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM booking_slots WHERE day_id = $1 AND place_id = $2", [dayId, placeId]);

    for (const [slotIndex, player] of players.entries()) {
      await client.query(
        `
          INSERT INTO booking_slots (
            id,
            day_id,
            place_id,
            slot_index,
            user_id,
            guest_name,
            telegram,
            arrival_time,
            paid
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          createId("booking"),
          dayId,
          placeId,
          slotIndex,
          player.userId,
          player.name,
          player.telegram,
          player.time,
          player.paid,
        ],
      );
    }

    await client.query("COMMIT");
    sendJson(res, 200, { ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deletePlaceBookings(req, res, dayId, placeId) {
  await pool.query("DELETE FROM booking_slots WHERE day_id = $1 AND place_id = $2", [dayId, placeId]);
  sendJson(res, 200, { ok: true });
}

async function deleteDayBookings(req, res, dayId) {
  await pool.query("DELETE FROM booking_slots WHERE day_id = $1", [dayId]);
  sendJson(res, 200, { ok: true });
}

async function updatePaid(req, res, dayId, placeId, slotIndex) {
  const body = await readBody(req);
  const paid = Boolean(body.paid);
  const numericSlotIndex = Number(slotIndex);

  if (!Number.isInteger(numericSlotIndex) || numericSlotIndex < 0) {
    sendError(res, 400, "Некорректный слот.");
    return;
  }

  const result = await pool.query(
    `
      UPDATE booking_slots
      SET paid = $1, updated_at = now()
      WHERE day_id = $2 AND place_id = $3 AND slot_index = $4
    `,
    [paid, dayId, placeId, numericSlotIndex],
  );

  if (!result.rowCount) {
    sendError(res, 404, "Бронь не найдена.");
    return;
  }

  sendJson(res, 200, { ok: true });
}

async function grantAdmin(req, res, userId) {
  const result = await pool.query(
    `
      UPDATE users
      SET is_admin = true
      WHERE id = $1
      RETURNING id, name, telegram, is_admin AS "isAdmin"
    `,
    [userId],
  );

  if (!result.rowCount) {
    sendError(res, 404, "Пользователь не найден.");
    return;
  }

  sendJson(res, 200, {
    user: publicUser(result.rows[0]),
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/api/state") {
    await getState(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    await register(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    await login(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    await logout(req, res);
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/auth/profile") {
    const currentUser = await requireUser(req, res);
    if (!currentUser) {
      return;
    }
    await updateProfile(req, res, currentUser);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/days") {
    const admin = await requireAdmin(req, res);
    if (!admin) {
      return;
    }
    await createDay(req, res);
    return;
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "users" && parts[3] && parts[4] === "admin") {
    const admin = await requireAdmin(req, res);
    if (!admin) {
      return;
    }
    await grantAdmin(req, res, decodeURIComponent(parts[3]));
    return;
  }

  if (parts[0] === "api" && parts[1] === "days" && parts[2]) {
    const dayId = decodeURIComponent(parts[2]);

    if (req.method === "DELETE" && parts.length === 3) {
      const admin = await requireAdmin(req, res);
      if (!admin) {
        return;
      }
      await deleteDay(req, res, dayId);
      return;
    }

    if (req.method === "PATCH" && parts.length === 4 && parts[3] === "theme") {
      const admin = await requireAdmin(req, res);
      if (!admin) {
        return;
      }
      await updateDayTheme(req, res, dayId);
      return;
    }

    if (parts[3] === "bookings") {
      const currentUser = await requireUser(req, res);
      if (!currentUser) {
        return;
      }

      if (req.method === "DELETE" && parts.length === 4) {
        await deleteDayBookings(req, res, dayId);
        return;
      }

      const placeId = parts[4] ? decodeURIComponent(parts[4]) : "";

      if (req.method === "PUT" && parts.length === 5) {
        await replacePlaceBookings(req, res, dayId, placeId, currentUser);
        return;
      }

      if (req.method === "DELETE" && parts.length === 5) {
        await deletePlaceBookings(req, res, dayId, placeId);
        return;
      }

      if (req.method === "PATCH" && parts.length === 7 && parts[6] === "paid") {
        const admin = await requireAdmin(req, res);
        if (!admin) {
          return;
        }
        await updatePaid(req, res, dayId, placeId, parts[5]);
        return;
      }
    }
  }

  sendError(res, 404, "API route not found.");
}

async function serveStatic(req, res, url) {
  const staticFiles = new Map([
    ["/", "index.html"],
    ["/index.html", "index.html"],
    ["/app.js", "app.js"],
    ["/styles.css", "styles.css"],
  ]);
  const filename = staticFiles.get(url.pathname);

  if (!filename) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const filePath = path.join(__dirname, filename);
  const content = await fs.readFile(filePath);
  const ext = path.extname(filename);
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : "application/javascript; charset=utf-8";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": content.length,
  });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      sendError(res, 500, error.message || "Internal server error");
    } else {
      res.end();
    }
  }
});

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Сайт запущен: http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Не удалось запустить сервис:", error);
    process.exit(1);
  });
