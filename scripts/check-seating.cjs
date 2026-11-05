// Browser regression checks for the floor plan. Requires Playwright and Chrome.
// API responses are simulated in memory; no live bookings or database are used.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { state: fixture } = require("./preview.cjs");
const root = path.resolve(__dirname, "..");
const output = path.resolve(process.env.PREVIEW_OUTPUT || path.join(root, ".superpowers", "previews"));

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1480, height: 1250 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let state = structuredClone(fixture);
    state.days.forEach(day => { day.shiftBookings = [day.bookings, {}]; });
    let savedPlayers;
    let moveRequests = 0;
    let rejectNextMove = false;
    const user = { id: "test-user", name: "Тест", telegram: "@test", isAdmin: false };
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/state") return route.fulfill({ json: state });
      if (["/api/auth/register", "/api/auth/login"].includes(url.pathname)) {
        state.currentUser = user;
        state.users = [user];
        return route.fulfill({ json: { token: "test-only", user } });
      }
      if (request.method() === "POST" && url.pathname.endsWith("/bookings/move")) {
        moveRequests += 1;
        if (rejectNextMove) {
          rejectNextMove = false;
          return route.fulfill({ status: 409, json: { error: "Рассадка уже изменилась." } });
        }
        const { fromPlaceId, toPlaceId, bookingId, targetBookingId, shiftIndex } = request.postDataJSON();
        const day = state.days.find(item => item.id === url.pathname.split("/")[3]);
        const bookings = day.shiftBookings[shiftIndex];
        const source = bookings[fromPlaceId]?.[0];
        const target = bookings[toPlaceId]?.[0];
        assert.equal(source.bookingId, bookingId);
        assert.equal(target?.bookingId || null, targetBookingId);
        bookings[fromPlaceId] = target ? [target] : [];
        bookings[toPlaceId] = [source];
        return route.fulfill({ json: { ok: true, swapped: Boolean(target) } });
      }
      if (request.method() === "PUT" && url.pathname.includes("/bookings/")) {
        savedPlayers = request.postDataJSON().players;
        const parts = url.pathname.split("/");
        const day = state.days.find(item => item.id === parts[3]);
        const { shiftIndex, slotIndex } = request.postDataJSON();
        const bookings = day.shiftBookings[shiftIndex];
        bookings[parts[5]] ||= [];
        bookings[parts[5]][slotIndex] = { ...savedPlayers[slotIndex], slotIndex, shiftIndex, bookingId: "test-booking", canDelete: true };
        return route.fulfill({ json: { ok: true } });
      }
      if (request.method() === "PATCH" && url.pathname.endsWith("/paid")) {
        const { shiftIndex, paid } = request.postDataJSON();
        const parts = url.pathname.split("/");
        state.days.find(day => day.id === parts[3]).shiftBookings[shiftIndex][parts[5]][Number(parts[6])].paid = paid;
        return route.fulfill({ json: { ok: true } });
      }
      if (request.method() === "DELETE" && url.pathname.includes("/bookings/")) {
        const { shiftIndex, slotIndex, expectedBookingId } = request.postDataJSON();
        const parts = url.pathname.split("/");
        const bookings = state.days.find(day => day.id === parts[3]).shiftBookings[shiftIndex];
        assert.equal(bookings[parts[5]][slotIndex].bookingId, expectedBookingId);
        bookings[parts[5]][slotIndex] = null;
        return route.fulfill({ json: { ok: true } });
      }
      const filename = ["/app.js", "/styles.css", "/seating.css"].includes(url.pathname) ? url.pathname.slice(1) : "index.html";
      return route.fulfill({ body: await fs.readFile(path.join(root, filename)), contentType: filename.endsWith(".css") ? "text/css" : filename.endsWith(".js") ? "application/javascript" : "text/html" });
    });
    await page.goto("http://painting-preview.test/");
    await page.waitForSelector(".seat");
    assert.equal(await page.locator(".seat").count(), 32);
    assert.equal(await page.locator(".common-zone .seat").count(), 16);
    assert.equal(await page.locator(".big-zone .seat").count(), 8);
    assert.equal(await page.locator("#layoutPicker").count(), 0);
    assert.equal(await page.locator(".is-movable").count(), 0, "Guests cannot move bookings");
    assert.equal(await page.locator("#tablesPanel").isVisible(), true);
    assert.equal(await page.locator("#participantsPanel").isVisible(), false);
    await page.locator("#participantsTab").click();
    assert.equal(await page.locator("#participantsPanel").isVisible(), true);
    assert.equal(await page.locator("#tablesPanel").isVisible(), false);
    assert.equal(await page.locator("#currentDayDate").isVisible(), true);
    await page.locator("#participantsTab").press("ArrowLeft");
    assert.equal(await page.locator("#tablesTab").getAttribute("aria-selected"), "true");
    const kitchenRatio = await page.locator(".kitchen-surface").evaluate(el => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
    assert.ok(Math.abs(kitchenRatio - 0.35) < 0.001, "Kitchen table must be half the former 70% width");
    await page.locator("#seatingPlan").screenshot({ path: path.join(output, "floor-plan.png") });
    // Guest selects the second seat, registers, and returns to that exact slot.
    await page.locator('.seat[data-place-id="kitchen-table"][data-slot-index="1"][data-shift-index="1"]').click();
    assert.equal(await page.locator("#authDialog").evaluate(el => el.open), true);
    assert.equal(await page.locator("#authRegisterTab").getAttribute("aria-selected"), "true");
    await page.locator("#authNameInput").fill("Тест");
    await page.locator("#authPasswordInput").fill("preview-password");
    await page.locator("#authTelegramInput").fill("@test");
    await page.locator("#authSubmitButton").click();
    await page.waitForSelector("#bookingDialog[open]");
    assert.equal(await page.locator(".slot-name:focus").getAttribute("data-slot-index"), "1");
    await page.locator('.slot-name[data-slot-index="1"]').fill("Тест");
    await page.locator('.slot-telegram[data-slot-index="1"]').fill("@test");
    await page.locator('.slot-time[data-slot-index="1"]').fill("19:30");
    await page.locator("#bookingDialog").screenshot({ path: path.join(output, "registration.png") });
    await page.locator('#bookingForm button[type="submit"]').click();
    await page.waitForSelector("#bookingDialog", { state: "hidden" });
    assert.equal(savedPlayers[0], null, "First seat must stay empty");
    assert.equal(savedPlayers[1].name, "Тест");
    assert.equal(await page.locator("#participantsBody").textContent().then(text => text.includes("2-я смена")), true);
    assert.equal(state.days[0].bookings["kitchen-table"], undefined);
    assert.equal(state.days[0].shiftBookings[1]["kitchen-table"][1].name, "Тест");
    await page.waitForFunction(() => document.querySelector('.seat[data-place-id="kitchen-table"][data-slot-index="1"][data-shift-index="1"]').classList.contains("is-booked"));
    assert.equal(await page.locator('.seat[data-place-id="kitchen-table"][data-slot-index="0"][data-shift-index="0"]').getAttribute("class"), "seat");
    const chair = (id, shift = 0) => page.locator(`.seat[data-place-id="${id}"][data-shift-index="${shift}"]`).first();
    async function drag(from, to, shift = 0) {
      const a = await chair(from, shift).boundingBox();
      const b = await chair(to, shift).boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
      await page.mouse.up();
    }
    // Owner can drag their own booking, but cannot swap another person's seat.
    const active = state.days.find(day => day.id === "demo-28");
    active.bookings["paint-1"][0].canDelete = true;
    await page.reload();
    await page.waitForSelector(".is-movable");
    assert.equal(await page.locator(".is-movable").count(), 1);
    await drag("paint-1", "paint-2");
    assert.equal(moveRequests, 0);
    // Admin moves to an empty chair, then swaps occupied chairs.
    state.currentUser = { ...user, isAdmin: true };
    await page.reload();
    await page.waitForSelector(".is-movable");
    await drag("paint-1", "paint-5");
    await page.waitForFunction(() => document.querySelector("#seatMoveStatus").textContent === "Участник перемещён.");
    assert.equal(await page.locator('#bookingDialog').evaluate(el => el.open), false, "Drag must not open registration");
    assert.equal(active.bookings["paint-5"][0].name, "Алиса");
    assert.equal(active.bookings["paint-1"].length, 0);
    await drag("paint-5", "paint-2");
    await page.waitForFunction(() => document.querySelector("#seatMoveStatus").textContent === "Участники поменялись местами.");
    assert.equal(active.bookings["paint-2"][0].name, "Алиса");
    assert.equal(active.bookings["paint-5"][0].name, "Николай");
    await drag("paint-2", "tea-table");
    assert.equal(moveRequests, 2, "Other tables are not drop targets");
    await page.locator('.seat[data-place-id="paint-2"][data-shift-index="0"]').focus();
    await page.keyboard.press("Space");
    await page.locator('.seat[data-place-id="paint-1"][data-shift-index="1"]').focus();
    await page.keyboard.press("Enter");
    assert.equal(moveRequests, 2, "Cannot move across shifts");
    rejectNextMove = true;
    await drag("paint-2", "paint-1");
    await page.waitForFunction(() => document.querySelector("#seatMoveStatus").textContent === "Рассадка уже изменилась.");
    assert.equal(active.bookings["paint-2"][0].name, "Алиса");
    assert.equal(await page.locator(".seat-drag-ghost, .is-dragging, .is-drop-over").count(), 0);
    // Keyboard users can move the same seats without a pointer.
    await page.locator('.seat[data-place-id="paint-2"][data-shift-index="0"]').focus();
    await page.keyboard.press("Space");
    await page.locator('.seat[data-place-id="paint-1"][data-shift-index="0"]').focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#seatMoveStatus").textContent === "Участник перемещён.");
    assert.equal(active.bookings["paint-1"][0].name, "Алиса");
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".is-drop-target").count(), 0);
    // Second-shift rows retain their identity through move, payment and release.
    active.shiftBookings[1]["paint-3"] = [{ ...active.bookings["paint-3"][0], bookingId: "second-shift", shiftIndex: 1 }];
    active.bookings["kitchen-table"] = [null, { bookingId: "first-kitchen", slotIndex: 1, name: "Первая", telegram: "@first", time: "18:00", paid: false }];
    await page.reload(); await page.waitForSelector(".is-movable");
    await drag("paint-3", "paint-6", 1);
    await page.waitForFunction(() => document.querySelector("#seatMoveStatus").textContent === "Участник перемещён.");
    assert.equal(active.shiftBookings[1]["paint-6"][0].bookingId, "second-shift");
    assert.equal(active.bookings["paint-3"][0].name, "Давид");
    await page.locator("#participantsTab").click();
    await page.locator('.paid-checkbox[data-place-id="kitchen-table"][data-slot-index="1"][data-shift-index="1"]').check();
    await page.waitForFunction(() => document.querySelector('.paid-checkbox[data-place-id="kitchen-table"][data-slot-index="1"][data-shift-index="1"]').checked);
    assert.equal(active.shiftBookings[1]["kitchen-table"][1].paid, true);
    assert.equal(active.bookings["kitchen-table"][1].paid, false);
    assert.equal(await page.locator("#participantsPanel").isVisible(), true, "Payment refresh retains selected tab");
    await page.locator("#tablesTab").click();
    await page.waitForTimeout(450); // Allow the intentional post-drag click guard to expire.
    await page.locator('.seat[data-place-id="kitchen-table"][data-slot-index="1"][data-shift-index="1"]').click();
    assert.ok((await page.locator("#dialogTitle").textContent()).includes("2-я смена"));
    assert.equal(await page.locator(".player-slot").count(), 1);
    await page.locator("#releaseButton").click();
    await page.waitForSelector("#bookingDialog", { state: "hidden" });
    assert.equal(active.shiftBookings[1]["kitchen-table"][1], null);
    assert.equal(active.bookings["kitchen-table"][1].name, "Первая");
    // Archive index, ordering, read-only detail, browser history and direct URLs.
    await page.locator("#archiveViewButton").click();
    assert.equal(new URL(page.url()).pathname, "/archive");
    assert.equal(await page.locator("#dayTabs").isVisible(), false);
    assert.equal(await page.locator("#dayWorkspace").isVisible(), false);
    assert.deepEqual(await page.locator(".archive-day-link time").allTextContents(), ["21.10.2026", "14.10.2026", "07.10.2026"]);
    await page.screenshot({ path: path.join(output, "archive.png"), fullPage: true });
    await page.locator(".archive-day-link").first().click();
    assert.equal(await page.locator(".seat:disabled").count(), 32);
    assert.equal(await page.locator(".is-movable").count(), 0);
    assert.equal(await page.locator("#dayTabs").isVisible(), false);
    await page.reload();
    await page.waitForSelector("#archiveBack", { state: "visible" });
    await page.locator("#archiveBack").click();
    assert.equal(await page.locator("#archiveIndex").isVisible(), true);
    await page.goBack();
    await page.waitForSelector("#archiveBack", { state: "visible" });
    await page.goForward();
    await page.waitForSelector("#archiveIndex", { state: "visible" });
    await page.goto("http://painting-preview.test/archive");
    await page.waitForSelector("#archiveIndex", { state: "visible" });
    assert.equal(new URL(page.url()).pathname, "/archive");
    // Narrow mobile through desktop: no overflow, legible labels, 44px targets.
    for (const width of [320, 390, 680, 1024, 1480]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("http://painting-preview.test/");
      await page.waitForSelector(".seat");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${width}: horizontal overflow`);
      assert.equal(await page.locator(".seat").evaluateAll(els => els.every(el => el.getBoundingClientRect().height >= 44)), true);
      assert.equal(await page.locator(".kitchen-surface").evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth), true, `${width}: kitchen label overflow`);
      await page.locator("#participantsTab").click();
      assert.equal(await page.locator("#participantsPanel").isVisible(), true);
      assert.equal(await page.locator("#seatingPlan").isVisible(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${width}: participant overflow`);
      if (width === 390) await page.locator("#dayWorkspace").screenshot({ path: path.join(output, "participants-mobile.png") });
      await page.locator("#tablesTab").click();
      if (width === 390) await page.locator("#seatingPlan").screenshot({ path: path.join(output, "mobile.png") });
    }
    // Real touch events, as on a phone, use the same drag/drop operation.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".common-zone").scrollIntoViewIfNeeded();
    const a = await chair("paint-1").boundingBox();
    const b = await chair("paint-2").boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x + 22, y: a.y + 22 }] });
    for (let step = 1; step <= 8; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + 22 + (b.x - a.x) * step / 8, y: a.y + 22 + (b.y - a.y) * step / 8 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(() => document.querySelector("#seatMoveStatus").textContent === "Участник перемещён.");
    assert.equal(active.bookings["paint-2"][0].name, "Алиса");
    await cdp.detach();
    // Empty archive has no phantom day, stats or editable controls.
    state.days = state.days.filter(day => !day.isArchived);
    await page.goto("http://painting-preview.test/archive");
    await page.waitForSelector("#archiveIndex", { state: "visible" });
    assert.equal(await page.locator(".archive-day-link").count(), 0);
    assert.equal(await page.locator(".stats").isVisible(), false);
    assert.deepEqual(errors, []);
    console.log("PASS: two-shift registration, exact seat/shift persistence, separate payment/release, shift-specific mouse/touch/keyboard moves, cross-shift rejection, archive/history, responsive layout, no JS errors.");
    console.log(`Previews: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
