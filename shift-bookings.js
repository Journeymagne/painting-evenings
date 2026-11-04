const { randomUUID } = require("node:crypto");

// Existing rows become shift 0; no booking is copied, removed or reassigned.
async function migrateShifts(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS shift_index INTEGER NOT NULL DEFAULT 0 CHECK (shift_index IN (0, 1))`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS booking_slots_seat_shift_unique ON booking_slots (day_id, place_id, slot_index, shift_index)`);
    await client.query(`ALTER TABLE booking_slots DROP CONSTRAINT IF EXISTS booking_slots_day_id_place_id_slot_index_key`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function shiftIndexOf(body) {
  const shift = body?.shiftIndex === undefined ? 0 : body.shiftIndex;
  return shift === 0 || shift === 1 ? shift : null;
}

// The new UI edits one seat. Old clients still edit only the first shift.
async function changeBookings(pool, dayId, place, user, body, remove = false) {
  const shift = shiftIndexOf(body);
  const selected = body?.slotIndex === undefined ? null : body.slotIndex;
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  if (!place) return { status: 404, error: "Место не найдено." };
  if (shift === null || (selected !== null && (!Number.isInteger(selected) || selected < 0 || selected >= place.capacity))) {
    return { status: 400, error: "Некорректное место или смена." };
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const day = await client.query('SELECT is_archived AS "isArchived" FROM paint_days WHERE id = $1 FOR UPDATE', [dayId]);
    if (!day.rowCount) fail(404, "Вечер не найден.");
    if (day.rows[0].isArchived) fail(403, "Архивный вечер доступен только для просмотра.");
    const result = await client.query(`SELECT * FROM booking_slots WHERE day_id = $1 AND place_id = $2 AND shift_index = $3
      AND ($4::integer IS NULL OR slot_index = $4) ORDER BY slot_index FOR UPDATE`, [dayId, place.id, shift, selected]);
    const existing = new Map(result.rows.map(row => [row.slot_index, row]));
    if (selected !== null && Object.hasOwn(body, "expectedBookingId") && (existing.get(selected)?.id || null) !== body.expectedBookingId) {
      fail(409, "Запись уже изменилась. Закройте окно, обновите страницу и выберите смену ещё раз.");
    }
    if (selected !== null && existing.has(selected) && !user.isAdmin && existing.get(selected).created_by_user_id !== user.id) {
      fail(403, "Можно менять только записи, которые вы добавили.");
    }
    if (remove) {
      const deleted = await client.query(`DELETE FROM booking_slots WHERE day_id = $1 AND place_id = $2 AND shift_index = $3
        AND ($4::integer IS NULL OR slot_index = $4) AND ($5::boolean OR created_by_user_id = $6)`, [dayId, place.id, shift, selected, user.isAdmin, user.id]);
      if (!deleted.rowCount && !user.isAdmin) fail(403, "Можно удалить только записи, которые вы добавили.");
    } else {
      const slots = selected === null ? Array.from({ length: place.capacity }, (_, i) => i) : [selected];
      const players = [];
      for (const slot of slots) {
        const old = existing.get(slot);
        if (old && !user.isAdmin && old.created_by_user_id !== user.id) { players.push({ slot, preserve: true }); continue; }
        const raw = body?.players?.[slot] || {};
        const name = String(raw.name || "").trim();
        const contact = String(raw.telegram || "").trim();
        const telegram = contact && !contact.startsWith("@") ? `@${contact}` : contact;
        const time = String(raw.time || "").trim();
        if (!name && !telegram && !time) { players.push({ slot, empty: true }); continue; }
        if (!name || !telegram || (time && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time))) fail(400, "Укажите имя и Telegram. Время — в формате чч:мм.");
        players.push({ slot, name, telegram, time, userId: raw.userId || null, paid: user.isAdmin ? Boolean(raw.paid) : Boolean(old?.paid) });
      }
      if (players.every(player => player.empty)) fail(400, "Добавьте хотя бы одного участника.");
      for (const player of players) {
        if (player.preserve) continue;
        if (player.empty) {
          await client.query("DELETE FROM booking_slots WHERE day_id = $1 AND place_id = $2 AND slot_index = $3 AND shift_index = $4", [dayId, place.id, player.slot, shift]);
          continue;
        }
        await client.query(`INSERT INTO booking_slots (id, day_id, place_id, slot_index, shift_index, user_id, created_by_user_id, guest_name, telegram, arrival_time, paid)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (day_id, place_id, slot_index, shift_index) DO UPDATE SET
            user_id = EXCLUDED.user_id, guest_name = EXCLUDED.guest_name, telegram = EXCLUDED.telegram,
            arrival_time = EXCLUDED.arrival_time, paid = EXCLUDED.paid, updated_at = now()`,
          [`booking-${randomUUID()}`, dayId, place.id, player.slot, shift, player.userId, user.id, player.name, player.telegram, player.time || null, player.paid]);
      }
    }
    await client.query("COMMIT");
    return { status: 200, ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.status) return { status: error.status, error: error.message };
    if (error.code === "23503") return { status: 400, error: "Выбранный пользователь больше не существует." };
    throw error;
  } finally { client.release(); }
}

module.exports = { migrateShifts, shiftIndexOf, changeBookings };
