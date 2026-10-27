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
        const { fromPlaceId, toPlaceId, bookingId, targetBookingId } = request.postDataJSON();
        const day = state.days.find(item => item.id === url.pathname.split("/")[3]);
        const source = day.bookings[fromPlaceId]?.[0];
        const target = day.bookings[toPlaceId]?.[0];
        assert.equal(source.bookingId, bookingId);
        assert.equal(target?.bookingId || null, targetBookingId);
        day.bookings[fromPlaceId] = target ? [target] : [];
        day.bookings[toPlaceId] = [source];
        return route.fulfill({ json: { ok: true, swapped: Boolean(target) } });
      }
      if (request.method() === "PUT" && url.pathname.includes("/bookings/")) {
        savedPlayers = request.postDataJSON().players;
        const parts = url.pathname.split("/");
        const day = state.days.find(item => item.id === parts[3]);
        day.bookings[parts[5]] = savedPlayers.map((player, slotIndex) => player ? { ...player, slotIndex, bookingId: "test-booking", canDelete: true } : null);
        return route.fulfill({ json: { ok: true } });
      }
      const filename = ["/app.js", "/styles.css", "/seating.css"].includes(url.pathname) ? url.pathname.slice(1) : "index.html";
      return route.fulfill({ body: await fs.readFile(path.join(root, filename)), contentType: filename.endsWith(".css") ? "text/css" : filename.endsWith(".js") ? "application/javascript" : "text/html" });
    });
    await page.goto("http://painting-preview.test/");
    await page.waitForSelector(".seat");
    assert.equal(await page.locator(".seat").count(), 16);
    assert.equal(await page.locator(".common-zone .seat").count(), 8);
    assert.equal(await page.locator(".big-zone .seat").count(), 4);
    assert.equal(await page.locator("#layoutPicker").count(), 0);
    assert.equal(await page.locator(".is-movable").count(), 0, "Guests cannot move bookings");
    const kitchenRatio = await page.locator(".kitchen-surface").evaluate(el => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
    assert.ok(Math.abs(kitchenRatio - 0.35) < 0.001, "Kitchen table must be half the former 70% width");
    await page.locator("#seatingPlan").screenshot({ path: path.join(output, "floor-plan.png") });
    // Guest selects the second seat, registers, and returns to that exact slot.
    await page.locator('.seat[data-place-id="kitchen-table"][data-slot-index="1"]').click();
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
    await page.waitForFunction(() => document.querySelector('.seat[data-place-id="kitchen-table"][data-slot-index="1"]').classList.contains("is-booked"));
    assert.equal(await page.locator('.seat[data-place-id="kitchen-table"][data-slot-index="0"]').getAttribute("class"), "seat");
    const chair = id => page.locator(`.seat[data-place-id="${id}"] .seat-circle`).first();
    async function drag(from, to) {
      const a = await chair(from).boundingBox();
      const b = await chair(to).boundingBox();
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
    rejectNextMove = true;
    await drag("paint-2", "paint-1");
    await page.waitForFunction(() => document.querySelector("#seatMoveStatus").textContent === "Рассадка уже изменилась.");
    assert.equal(active.bookings["paint-2"][0].name, "Алиса");
    assert.equal(await page.locator(".seat-drag-ghost, .is-dragging, .is-drop-over").count(), 0);
    // Keyboard users can move the same seats without a pointer.
    await page.locator('.seat[data-place-id="paint-2"]').focus();
    await page.keyboard.press("Space");
    await page.locator('.seat[data-place-id="paint-1"]').focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#seatMoveStatus").textContent === "Участник перемещён.");
    assert.equal(active.bookings["paint-1"][0].name, "Алиса");
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".is-drop-target").count(), 0);
    // Archive index, ordering, read-only detail, browser history and direct URLs.
    await page.locator("#archiveViewButton").click();
    assert.equal(new URL(page.url()).pathname, "/archive");
    assert.equal(await page.locator("#dayTabs").isVisible(), false);
    assert.equal(await page.locator("#dayWorkspace").isVisible(), false);
    assert.deepEqual(await page.locator(".archive-day-link time").allTextContents(), ["21.10.2026", "14.10.2026", "07.10.2026"]);
    await page.screenshot({ path: path.join(output, "archive.png"), fullPage: true });
    await page.locator(".archive-day-link").first().click();
    assert.equal(await page.locator(".seat:disabled").count(), 16);
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
      assert.equal(await page.locator(".seat-circle").evaluateAll(els => els.every(el => el.getBoundingClientRect().width >= 44)), true);
      assert.equal(await page.locator(".kitchen-surface").evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth), true, `${width}: kitchen label overflow`);
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
    console.log("PASS: registration, exact slot persistence, mouse/touch/keyboard move and swap, ownership, invalid drop, conflict recovery, archive/history, responsive layout, no JS errors.");
    console.log(`Previews: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
