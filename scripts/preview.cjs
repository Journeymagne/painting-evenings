// Read-only visual review with fictional data. Does not connect to PostgreSQL.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const person = (name, slotIndex = 0) => ({
  bookingId: `demo-${name}`, name, telegram: `@demo`, time: "19:00", slotIndex,
  userId: null, canDelete: false, paid: false,
});
const bookings = {
  "paint-1": [person("Алиса")], "paint-2": [person("Николай")],
  "paint-3": [person("Давид")], "paint-4": [person("Journey")],
  "paint-7": [person("Иван")], "paint-8": [person("Дашуля")],
  "big-table-1": [person("Димас"), person("Вадим", 1)],
  "big-table-2": [person("Journey"), person("Raiden", 1)],
  "tea-table": [person("Ваня"), person("Максим", 1)],
};
const state = { currentUser: null, users: [], days: [
  { id: "demo-28", date: "2026-10-28", theme: "Миниатюры, чай и хорошие компании", isArchived: false, bookings: structuredClone(bookings) },
  { id: "demo-04", date: "2026-11-04", theme: "Свободный покрас", isArchived: false, bookings: {} },
  { id: "demo-14", date: "2026-10-14", theme: "Покрас отрядов", isArchived: true, bookings: structuredClone(bookings) },
  { id: "demo-21", date: "2026-10-21", theme: "Террейн и Киллтим", isArchived: true, bookings: structuredClone(bookings) },
  { id: "demo-07", date: "2026-10-07", theme: "Вечер Бладболла", isArchived: true, bookings: {} },
] };
const files = new Map([["/app.js", "app.js"], ["/styles.css", "styles.css"], ["/seating.css", "seating.css"]]);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Это предпросмотр на примере данных. Записи здесь не сохраняются." }));
      return;
    }
    if (url.pathname === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(state));
      return;
    }
    if (url.pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    const filename = files.get(url.pathname) || "index.html";
    let content = await fs.readFile(path.join(root, filename), "utf8");
    if (filename === "index.html") content = content.replace('<main class="app-shell">', '<main class="app-shell"><p style="margin:0 0 8px;color:#b9ad9d;font-size:12px">ПРЕДПРОСМОТР · пример рассадки · записи не сохраняются</p>');
    res.writeHead(200, { "Content-Type": filename.endsWith(".css") ? "text/css; charset=utf-8" : filename.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8" });
    res.end(content);
  } catch (error) { res.writeHead(500); res.end("Preview error"); }
});
module.exports = { state };
if (require.main === module) server.listen(4318, "127.0.0.1", () => console.log("Preview: http://127.0.0.1:4318/"));
