import hashlib
import hmac
import json
import os
import re
import sys
import urllib.request
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000").rstrip("/")
secret = os.environ.get("TEST_PAYMENT_CALLBACK_SECRET", "pass5-step3-browser-secret")
shots = os.environ.get("SHOTS_DIR")
if shots:
    os.makedirs(shots, exist_ok=True)

def callback(payment_ref, amount, operation):
    raw = json.dumps({"paymentRef": payment_ref, "operationId": operation, "amount": amount, "currency": "KZT", "status": "succeeded"}, separators=(",", ":")).encode()
    signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    request = urllib.request.Request(base + "/api/payments/test/callback", data=raw, headers={"Content-Type": "application/json", "X-Test-Signature": signature})
    with urllib.request.urlopen(request) as response:
        assert response.status == 200

results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"))
    for name, width, height, offset in [("desktop", 1280, 900, 310), ("mobile", 390, 844, 320)]:
        page = browser.new_page(viewport={"width": width, "height": height})
        errors = []
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base + "/", wait_until="networkidle")
        check_in = date.today() + timedelta(days=offset)
        check_out = check_in + timedelta(days=3)
        page.locator("#checkIn").fill(check_in.isoformat())
        page.locator("#checkOut").fill(check_out.isoformat())
        page.locator("#search").click()
        page.wait_for_selector("[data-choose]:not([disabled])")
        page.locator("[data-choose]:not([disabled])").first.click()
        page.wait_for_selector("[data-testid=quote-total]")
        amount = int(re.sub(r"\D", "", page.locator("[data-testid=quote-total]").inner_text()))
        page.locator("#guestName").fill("Payment " + name)
        page.locator("#guestPhone").fill("+7 700 555 44 33")
        page.locator("#agreement").check()
        page.locator("#checkoutButton").click()
        page.wait_for_url(re.compile(r"[?&]payment=processing"))
        page.wait_for_selector("[data-testid=payment-state]")
        processing = page.locator("[data-testid=payment-state]").inner_text()
        assert "Проверяем оплату" in processing
        assert "Бронирование подтверждено" not in processing
        payment_ref = page.url.split("paymentRef=", 1)[1].split("&", 1)[0]
        callback(payment_ref, amount, "browser-" + name)
        page.wait_for_selector("[data-testid=payment-state]", state="visible")
        page.wait_for_function("document.querySelector('[data-testid=payment-state]')?.textContent.includes('Бронирование подтверждено')")
        page.reload(wait_until="networkidle")
        page.wait_for_function("document.querySelector('[data-testid=payment-state]')?.textContent.includes('Бронирование подтверждено')")
        assert page.locator("[data-testid=payment-state]").count() == 1
        if name == "mobile":
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        assert not errors, f"{name} console/page errors: {errors}"
        if shots:
            page.screenshot(path=os.path.join(shots, f"{name}-confirmed.png"), full_page=False)
        results.append(name + ": PASS")
        page.close()
    browser.close()

print("PASS 5 STEP 3 browser: " + ", ".join(results))
