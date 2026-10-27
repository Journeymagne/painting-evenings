// Run only against a dedicated, disposable PostgreSQL database.
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { movePaintBooking } = require("../move-booking");
const connectionString = process.env.MOVE_TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).pathname !== "/paint_move_test") {
  throw new Error("Set MOVE_TEST_DATABASE_URL to a disposable database named paint_move_test.");
}
const schema = `seat_test_${Date.now()}`;
const setup = new Pool({ connectionString });
const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
const admin = { id: "admin", isAdmin: true };
const owner = { id: "owner", isAdmin: false };
const move = (from, to, source, target = null, user = admin) => movePaintBooking(pool, "day", user, {
  fromPlaceId: `paint-${from}`, toPlaceId: `paint-${to}`, bookingId: source, targetBookingId: target,
});
async function reset() {
  await pool.query("TRUNCATE booking_slots");
  await pool.query("UPDATE paint_days SET is_archived = false");
  await pool.query(`INSERT INTO booking_slots (id, day_id, place_id, slot_index, created_by_user_id, user_id, guest_name, telegram, arrival_time, paid)
    VALUES ('alice', 'day', 'paint-1', 0, 'owner', 'alice-user', 'Alice', '@alice', '19:00', true),
           ('bob', 'day', 'paint-2', 0, 'other', 'bob-user', 'Bob', '@bob', '20:00', false)`);
}
const rows = () => pool.query("SELECT id, place_id, slot_index, created_by_user_id, user_id, guest_name, telegram, arrival_time, paid FROM booking_slots ORDER BY id").then(result => result.rows);
(async () => {
  await setup.query(`CREATE SCHEMA ${schema}`);
  try {
    await pool.query(`CREATE TABLE paint_days (id text PRIMARY KEY, is_archived boolean NOT NULL DEFAULT false);
      CREATE TABLE booking_slots (id text PRIMARY KEY, day_id text REFERENCES paint_days(id), place_id text NOT NULL,
        slot_index integer NOT NULL, created_by_user_id text, user_id text, guest_name text, telegram text,
        arrival_time time, paid boolean NOT NULL DEFAULT false, updated_at timestamptz DEFAULT now(),
        UNIQUE(day_id, place_id, slot_index));
      INSERT INTO paint_days VALUES ('day', false)`);
    await reset();
    const original = await rows();
    assert.equal((await move(1, 3, "alice", null, owner)).status, 200);
    assert.deepEqual(await rows(), original.map(row => row.id === "alice" ? { ...row, place_id: "paint-3" } : row));
    assert.equal((await move(3, 2, "alice", "bob")).swapped, true);
    assert.deepEqual(await rows(), original.map(row => ({ ...row, place_id: row.id === "alice" ? "paint-2" : "paint-3" })));
    await reset();
    assert.equal((await move(2, 3, "bob", null, owner)).status, 403);
    assert.equal((await move(1, 2, "alice", "bob", owner)).status, 403);
    assert.equal((await move(1, 2, "alice")).status, 409);
    assert.equal((await move(1, 3, "old-booking")).status, 409);
    assert.equal((await move(1, 1, "alice", "alice")).status, 400);
    assert.equal((await movePaintBooking(pool, "day", admin, { fromPlaceId: "tea-table", toPlaceId: "paint-3", bookingId: "alice", targetBookingId: null })).status, 400);
    assert.equal((await movePaintBooking(pool, "day", admin, null)).status, 400);
    assert.equal((await movePaintBooking(pool, "missing", admin, { fromPlaceId: "paint-1", toPlaceId: "paint-3", bookingId: "alice", targetBookingId: null })).status, 404);
    assert.deepEqual(await rows(), original);
    await pool.query("UPDATE paint_days SET is_archived = true");
    assert.equal((await move(1, 3, "alice")).status, 403);
    assert.deepEqual(await rows(), original);
    await reset();
    const concurrent = await Promise.all([move(1, 3, "alice"), move(1, 4, "alice")]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
    assert.equal((await rows()).length, 2);
    await reset();
    // Fail after moving the swap partner: PostgreSQL must restore both rows.
    const failingPool = { async connect() {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql, args) => {
        if (sql.includes("SET place_id = $1, slot_index = 0")) throw new Error("injected failure");
        return client.query(sql, args);
      } };
    } };
    await assert.rejects(movePaintBooking(failingPool, "day", admin, { fromPlaceId: "paint-1", toPlaceId: "paint-2", bookingId: "alice", targetBookingId: "bob" }), /injected failure/);
    assert.deepEqual(await rows(), original);
    console.log("PASS: PostgreSQL move/swap, preserved booking fields, ownership, archive, stale data, invalid targets, concurrent moves, rollback.");
  } finally {
    await pool.end();
    await setup.query(`DROP SCHEMA ${schema} CASCADE`);
    await setup.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
