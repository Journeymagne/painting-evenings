// Real PostgreSQL + HTTP API; uses only a temporary schema in paint_move_test.
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const connectionString = process.env.MOVE_TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).pathname !== "/paint_move_test") throw Error("Use a disposable paint_move_test database.");
const pool = new Pool({ connectionString });
const schema = `shifts_${Date.now()}`;
let child, exit;
async function start() {
  const db = new URL(connectionString);
  db.searchParams.set("options", `-c search_path=${schema}`);
  child = spawn(process.execPath, ["server.js"], { cwd: require("node:path").resolve(__dirname, ".."), env: { ...process.env, DATABASE_URL: db.href, PORT: "4329" }, stdio: ["ignore", "pipe", "pipe"] });
  exit = once(child, "exit");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Server start timeout")), 15000);
    child.stdout.once("data", () => { clearTimeout(timer); resolve(); });
    child.stderr.on("data", data => process.stderr.write(data));
    child.once("exit", code => { clearTimeout(timer); reject(Error(`Server exited: ${code}`)); });
  });
}
async function stop() { if (child && child.exitCode === null) child.kill(); if (exit) await exit; }
async function api(route, method = "GET", body, token) {
  const response = await fetch(`http://127.0.0.1:4329${route}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
const player = name => ({ name, telegram: `@${name}`, time: "19:00" });
(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  try {
    // This is the pre-shifts schema. The application migrates it on startup.
    await pool.query(`CREATE TABLE ${schema}.paint_days (id text PRIMARY KEY, paint_date date UNIQUE NOT NULL, theme text NOT NULL DEFAULT '', is_archived boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now());
      CREATE TABLE ${schema}.booking_slots (id text PRIMARY KEY, day_id text REFERENCES ${schema}.paint_days(id), place_id text NOT NULL, slot_index integer NOT NULL,
        user_id text, created_by_user_id text, guest_name text, telegram text, arrival_time time, paid boolean DEFAULT false,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE(day_id,place_id,slot_index));
      INSERT INTO ${schema}.paint_days (id,paint_date) VALUES ('legacy-day','2026-11-04');
      INSERT INTO ${schema}.booking_slots (id,day_id,place_id,slot_index,guest_name,telegram,arrival_time,paid) VALUES ('legacy-booking','legacy-day','paint-1',0,'Alice','@alice','19:00',true)`);
    await start();
    const getDay = async () => (await api("/api/state")).data.days[0];
    const before = await getDay();
    assert.equal(before.shiftBookings[0]["paint-1"][0].bookingId, "legacy-booking");
    assert.equal(before.shiftBookings[0]["paint-1"][0].paid, true);
    assert.deepEqual(before.shiftBookings[1], {});
    const admin = (await api("/api/auth/register", "POST", { name: "Admin", password: "test-only", telegram: "@admin" })).data;
    const member = (await api("/api/auth/register", "POST", { name: "Member", password: "test-only", telegram: "@member" })).data;
    const base = "/api/days/legacy-day/bookings";
    const save = (place, slot, shift, name, token = admin.token, expectedBookingId) => api(`${base}/${place}`, "PUT", { slotIndex: slot, shiftIndex: shift, players: Array.from({ length: slot + 1 }, (_, i) => i === slot ? player(name) : null), ...(expectedBookingId === undefined ? {} : { expectedBookingId }) }, token);
    assert.equal((await save("paint-1", 0, 1, "Bob")).status, 200);
    let day = await getDay();
    const bobId = day.shiftBookings[1]["paint-1"][0].bookingId;
    assert.deepEqual(day.shiftBookings[0], before.shiftBookings[0]);
    assert.equal((await save("paint-1", 0, 1, "Bad", member.token)).status, 403);
    assert.equal((await save("paint-1", 0, 1, "Stale", admin.token, null)).status, 409);
    assert.equal((await save("paint-1", 0, 1, "Bob2", admin.token, bobId)).status, 200);
    assert.equal((await getDay()).shiftBookings[1]["paint-1"][0].bookingId, bobId);
    // Legacy clients target shift 0 only.
    assert.equal((await api(`${base}/paint-1`, "PUT", { players: [player("Alice2")] }, admin.token)).status, 200);
    assert.equal((await getDay()).shiftBookings[1]["paint-1"][0].name, "Bob2");
    assert.equal((await api(`${base}/paint-1/0/paid`, "PATCH", { paid: true, shiftIndex: 1 }, admin.token)).status, 200);
    day = await getDay();
    assert.equal(day.shiftBookings[0]["paint-1"][0].paid, false);
    assert.equal(day.shiftBookings[1]["paint-1"][0].paid, true);
    // Both chairs and both shifts at a game table must remain independent.
    for (const shift of [0, 1]) for (const slot of [0, 1]) assert.equal((await save("tea-table", slot, shift, `Tea${shift}${slot}`)).status, 200);
    assert.equal((await api(`${base}/tea-table`, "DELETE", { shiftIndex: 1, slotIndex: 1 }, admin.token)).status, 200);
    day = await getDay();
    assert.equal(day.shiftBookings[0]["tea-table"].filter(Boolean).length, 2);
    assert.equal(day.shiftBookings[1]["tea-table"].filter(Boolean).length, 1);
    // Move and swap only within shift 1, leaving shift 0 untouched.
    await save("paint-2", 0, 1, "Carol");
    day = await getDay();
    const firstShift = structuredClone(day.shiftBookings[0]);
    const moveBody = { fromPlaceId: "paint-1", toPlaceId: "paint-2", shiftIndex: 1, bookingId: bobId, targetBookingId: day.shiftBookings[1]["paint-2"][0].bookingId };
    assert.equal((await api(`${base}/move`, "POST", moveBody)).status, 401);
    assert.equal((await api(`${base}/move`, "POST", moveBody, member.token)).status, 403);
    assert.equal((await api(`${base}/move`, "POST", moveBody, admin.token)).status, 200);
    day = await getDay();
    assert.deepEqual(day.shiftBookings[0], firstShift);
    assert.equal(day.shiftBookings[1]["paint-2"][0].name, "Bob2");
    assert.equal(day.shiftBookings[1]["paint-2"][0].paid, true);
    // HTTP requests move across shifts, including the same physical chair.
    const sameChair = { fromPlaceId: "paint-2", toPlaceId: "paint-2", shiftIndex: 1, toShiftIndex: 0, bookingId: bobId, targetBookingId: null };
    assert.equal((await api(`${base}/move`, "POST", sameChair, admin.token)).status, 200);
    day = await getDay();
    assert.equal(day.shiftBookings[0]["paint-2"][0].bookingId, bobId);
    assert.equal(day.shiftBookings[0]["paint-2"][0].paid, true);
    assert.equal(day.shiftBookings[1]["paint-2"]?.filter(Boolean).length || 0, 0);
    assert.equal((await api(`${base}/move`, "POST", { ...sameChair, shiftIndex: 0, toShiftIndex: 1 }, admin.token)).status, 200);
    const crossSwap = { ...sameChair, toPlaceId: "paint-1", targetBookingId: firstShift["paint-1"][0].bookingId };
    assert.equal((await api(`${base}/move`, "POST", crossSwap, admin.token)).status, 200);
    day = await getDay();
    assert.equal(day.shiftBookings[0]["paint-1"][0].bookingId, bobId);
    assert.equal(day.shiftBookings[1]["paint-2"][0].bookingId, crossSwap.targetBookingId);
    assert.equal((await api(`${base}/move`, "POST", { ...crossSwap, fromPlaceId: "paint-1", toPlaceId: "paint-2", shiftIndex: 0, toShiftIndex: 1 }, admin.token)).status, 200);
    day = await getDay();
    assert.deepEqual(day.shiftBookings[0], firstShift);
    const secondShift = structuredClone(day.shiftBookings[1]);
    // Missing shift on old delete requests cannot erase shift 1.
    assert.equal((await api(`${base}/paint-1`, "DELETE", {}, admin.token)).status, 200);
    assert.deepEqual((await getDay()).shiftBookings[1], secondShift);
    for (const invalid of [-1, 2, "1", null]) {
      assert.equal((await save("paint-4", 0, invalid, "Invalid")).status, 400);
      assert.equal((await api(`${base}/paint-2`, "DELETE", { shiftIndex: invalid }, admin.token)).status, 400);
      assert.equal((await api(`${base}/paint-2/0/paid`, "PATCH", { paid: false, shiftIndex: invalid }, admin.token)).status, 400);
    }
    const snapshot = await getDay();
    await stop(); await start();
    assert.deepEqual((await getDay()).shiftBookings, snapshot.shiftBookings, "Migration is idempotent and survives restart");
    assert.equal((await api("/api/days/legacy-day/archive", "PATCH", { isArchived: true }, admin.token)).status, 200);
    for (const shift of [0, 1]) assert.equal((await save("paint-4", 0, shift, "Archived")).status, 403);
    assert.equal((await api(`${base}/paint-2`, "DELETE", { shiftIndex: 1 }, admin.token)).status, 403);
    assert.equal((await api(`${base}/paint-2/0/paid`, "PATCH", { paid: false, shiftIndex: 1 }, admin.token)).status, 403);
    assert.deepEqual((await getDay()).shiftBookings, snapshot.shiftBookings);
    console.log("PASS: legacy migration, restart, two shifts × all chair types, exact edit/delete/payment, legacy clients, stale data, permissions, shift-specific move/swap, archive protection.");
  } finally {
    await stop();
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
