// Move the existing booking rows so ownership, payment and arrival time survive.
async function movePaintBooking(pool, dayId, user, body) {
  const { fromPlaceId, toPlaceId, bookingId, targetBookingId } = body || {};
  if (!/^paint-[1-8]$/.test(fromPlaceId) || !/^paint-[1-8]$/.test(toPlaceId) ||
      fromPlaceId === toPlaceId || typeof bookingId !== "string" || !bookingId ||
      !(targetBookingId === null || typeof targetBookingId === "string")) {
    return { status: 400, error: "Выберите разные кресла за покрасочным столом." };
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
      `SELECT id, place_id AS "placeId", created_by_user_id AS "createdByUserId"
       FROM booking_slots WHERE day_id = $1 AND place_id = ANY($2::text[]) AND slot_index = 0
       ORDER BY place_id FOR UPDATE`, [dayId, [fromPlaceId, toPlaceId]],
    );
    const source = result.rows.find(row => row.placeId === fromPlaceId);
    const target = result.rows.find(row => row.placeId === toPlaceId);
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
      await client.query("UPDATE booking_slots SET place_id = $1, updated_at = now() WHERE id = $2", [fromPlaceId, target.id]);
    }
    await client.query("UPDATE booking_slots SET place_id = $1, slot_index = 0, updated_at = now() WHERE id = $2", [toPlaceId, source.id]);
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
