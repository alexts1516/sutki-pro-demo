#!/usr/bin/env python3
import os, sys
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

url = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000/").rstrip("/") + "/"
viewports = [("desktop", 1280, 900, 220), ("mobile", 390, 844, 230)]
results = []

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
        page.eval_on_selector("#checkoutButton", "button => { button.click(); button.click(); }")
        page.wait_for_selector("[data-testid=booking-created]")
        created = page.locator("[data-testid=booking-created]").inner_text()
        assert "ожидает оплату" in created
        assert server_total in created
        assert page.locator("text=Оплатить").count() == 0
        if name == "mobile":
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        assert not errors, f"{name} console errors: {errors}"
        results.append(f"{name}: PASS")
        page.close()
    browser.close()

print("PASS 5 STEP 2 browser: " + ", ".join(results))
