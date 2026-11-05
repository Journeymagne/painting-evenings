const { shiftIndexOf } = require("./shift-bookings");
// Move the existing booking rows between seats and shifts; preserve ownership/payment.
async function movePaintBooking(pool, dayId, user, body) {
  const { fromPlaceId, toPlaceId, bookingId, targetBookingId } = body || {};
  const shiftIndex = shiftIndexOf(body);
  const toShiftIndex = body?.toShiftIndex === undefined ? shiftIndex : shiftIndexOf({ shiftIndex: body.toShiftIndex });
  if (!/^paint-[1-8]$/.test(fromPlaceId) || !/^paint-[1-8]$/.test(toPlaceId) ||
      shiftIndex === null || toShiftIndex === null || (fromPlaceId === toPlaceId && shiftIndex === toShiftIndex) || typeof bookingId !== "string" || !bookingId ||
      !(targetBookingId === null || typeof targetBookingId === "string")) {
    return { status: 400, error: "Выберите разные места или смены за покрасочным столом." };
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize moves within a day and exclude concurrent archiving/deletion.
    const day = await client.query('SELECT is_archived AS "isArchived" FROM paint_days WHERE id = $1 FOR UPDATE', [dayId]);
    let error;
    if (!day.rowCount) error = { status: 404, error: "Вечер не найден." };
    else if (day.rows[0].isArchived) error = { status: 403, error: "Архивный вечер доступен только для просмотра." };
    if (error) {
      await client.query("ROLLBACK");
      return error;
    }
    const result = await client.query(
      `SELECT id, place_id AS "placeId", shift_index AS "shiftIndex", created_by_user_id AS "createdByUserId"
       FROM booking_slots WHERE day_id = $1 AND slot_index = 0
         AND ((place_id = $2 AND shift_index = $3) OR (place_id = $4 AND shift_index = $5))
       ORDER BY place_id, shift_index FOR UPDATE`, [dayId, fromPlaceId, shiftIndex, toPlaceId, toShiftIndex],
    );
    const source = result.rows.find(row => row.placeId === fromPlaceId && row.shiftIndex === shiftIndex);
    const target = result.rows.find(row => row.placeId === toPlaceId && row.shiftIndex === toShiftIndex);
    if (source?.id !== bookingId || (target?.id || null) !== targetBookingId) {
      error = { status: 409, error: "Рассадка уже изменилась. Обновили места — попробуйте ещё раз." };
    } else if (!user.isAdmin && [source, target].filter(Boolean).some(row => row.createdByUserId !== user.id)) {
      error = { status: 403, error: "Можно перемещать только записи, которые вы добавили. Для обмена нужны права на обе записи." };
    }
    if (error) {
      await client.query("ROLLBACK");
      return error;
    }
    if (target) {
      // A temporary slot avoids the immediate unique constraint during a swap.
      // It is never visible outside this transaction.
      await client.query("UPDATE booking_slots SET slot_index = -1 WHERE id = $1", [source.id]);
      await client.query("UPDATE booking_slots SET place_id = $1, shift_index = $2, updated_at = now() WHERE id = $3", [fromPlaceId, shiftIndex, target.id]);
    }
    await client.query("UPDATE booking_slots SET place_id = $1, slot_index = 0, shift_index = $2, updated_at = now() WHERE id = $3", [toPlaceId, toShiftIndex, source.id]);
    await client.query("COMMIT");
    return { status: 200, swapped: Boolean(target) };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return { status: 409, error: "Кресло уже занято. Обновили места — попробуйте ещё раз." };
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { movePaintBooking };
