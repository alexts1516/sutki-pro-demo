#!/usr/bin/env python3
import os, sys
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

url = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000/").rstrip("/") + "/"
viewports = [("desktop", 1280, 900, 220), ("mobile", 390, 844, 230)]
results = []
shots = os.environ.get("SHOTS_DIR")
if shots: os.makedirs(shots, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"))
    for name, width, height, offset in viewports:
        page = browser.new_page(viewport={"width": width, "height": height})
        errors = []
        page.on("console", lambda message, errors=errors: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error, errors=errors: errors.append(str(error)))
        page.goto(url, wait_until="networkidle")
        assert page.locator("body[data-production-guest]").count() == 1
        assert page.locator("[data-testid=catalog] .apartment").count() > 0
        assert "gradient" in page.locator(".hero").evaluate("el => getComputedStyle(el).backgroundImage")
        assert page.locator(".search-panel").evaluate("el => getComputedStyle(el).display") == "grid"

        check_in = (date.today() + timedelta(days=offset)).isoformat()
        check_out = (date.today() + timedelta(days=offset + 3)).isoformat()
        page.locator("#checkIn").fill(check_in)
        page.locator("#checkOut").fill(check_out)
        page.locator("#search").click()
        page.wait_for_function("document.querySelector('#catalogStatus').textContent.includes('свободно')")
        page.locator("[data-choose]:not([disabled])").first.click()
        page.wait_for_selector("[data-testid=quote-total]")
        server_total = page.locator("[data-testid=quote-total]").inner_text()
        assert "₸" in server_total

        page.locator("#guestName").fill(f"Browser {name}")
        page.locator("#guestPhone").fill("+7 700 555 44 33")
        page.locator("#agreement").check()
        assert page.locator("#checkoutButton").inner_text() == "Перейти к оплате"
        page.eval_on_selector("#checkoutButton", "button => { button.click(); button.click(); }")
        page.wait_for_selector("[data-testid=hold-created]")
        created = page.locator("[data-testid=hold-created]").inner_text()
        assert "Даты временно удерживаются" in created
        assert "Завершите оплату, чтобы подтвердить бронирование" in created
        assert "Платёжный шаг пока не подключён" in created
        assert "Бронь №" not in created and "создана" not in created and "подтверждена" not in created
        assert server_total in created
        assert page.locator("text=Оплатить").count() == 0
        if name == "mobile":
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        assert not errors, f"{name} console errors: {errors}"
        if shots: page.screenshot(path=os.path.join(shots, f"{name}-hold.png"), full_page=False)
        results.append(f"{name}: PASS")
        page.close()
    browser.close()

print("PASS 5 STEP 2 browser: " + ", ".join(results))
