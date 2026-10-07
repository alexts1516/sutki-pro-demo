import hashlib
import hmac
import json
import os
import secrets
import sys
import urllib.parse
import urllib.request
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

base=(sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:3000").rstrip("/")
slug="astana-stay"
secret=os.environ.get("TEST_PAYMENT_CALLBACK_SECRET","pass5-step4-browser-secret")
shots=os.environ.get("SHOTS_DIR")
if shots: os.makedirs(shots,exist_ok=True)

def http(path,method="GET",body=None,headers=None):
    data=None if body is None else json.dumps(body,separators=(",",":")).encode()
    request=urllib.request.Request(base+path,data=data,method=method,headers={"Content-Type":"application/json",**(headers or {})})
    with urllib.request.urlopen(request) as response:return response.status,json.loads(response.read() or b"{}")

def operation_key(): return http(f"/api/public/{slug}/operation-key","POST",{})[1]["operationKey"]

def create_booking(offset):
    check_in=(date.today()+timedelta(days=offset)).isoformat();check_out=(date.today()+timedelta(days=offset+2)).isoformat()
    query=urllib.parse.urlencode({"checkIn":check_in,"checkOut":check_out,"guests":2})
    apartments=http(f"/api/public/{slug}/apartments?{query}")[1]
    apartment=next(item for item in apartments if item.get("description")=="Step 4 browser fixture")
    body={"apartmentId":apartment["ref"],"checkIn":check_in,"checkOut":check_out,"guests":2,"name":"Browser protected guest","phone":"+7 700 555 44 33"}
    return http(f"/api/public/{slug}/bookings","POST",body,{"Idempotency-Key":operation_key()})[1]

confirmed=create_booking(410)
pending=create_booking(414)
payment=http(f"/api/public/{slug}/bookings/{confirmed['token']}/pay","POST",{}, {"Idempotency-Key":operation_key()})[1]
raw=json.dumps({"paymentRef":payment["paymentRef"],"operationId":"step4-browser-confirmed","amount":confirmed["totalKzt"],"currency":"KZT","status":"succeeded"},separators=(",",":")).encode()
signature=hmac.new(secret.encode(),raw,hashlib.sha256).hexdigest()
request=urllib.request.Request(base+"/api/payments/test/callback",data=raw,headers={"Content-Type":"application/json","X-Test-Signature":signature})
with urllib.request.urlopen(request) as response: assert response.status==200

def open_page(browser,name,width,height,path,selector):
    page=browser.new_page(viewport={"width":width,"height":height});errors=[]
    page.on("console",lambda message:errors.append(message.text) if message.type=="error" else None)
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.goto(base+path,wait_until="networkidle");page.wait_for_selector(selector)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    assert not errors,f"{name} console/page errors: {errors}"
    return page,errors

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get("CHROME_PATH","/usr/bin/google-chrome"))
    page,errors=open_page(browser,"desktop confirmed",1280,900,f"/booking/{confirmed['token']}","[data-testid=booking-state]")
    assert "Бронь подтверждена" in page.locator("#bookingContent").inner_text();assert "Астана, ул. Защищённая, 44" in page.locator("#bookingContent").inner_text();assert "9081" in page.locator("[data-testid=private-instructions]").inner_text();assert "Следующий шаг" in page.locator("#bookingContent").inner_text()
    page.reload(wait_until="networkidle");page.wait_for_selector("[data-testid=private-instructions]");assert "Бронь подтверждена" in page.locator("#bookingContent").inner_text()
    if shots:page.screenshot(path=os.path.join(shots,"desktop-confirmed.png"),full_page=False)
    page.close()

    page,_=open_page(browser,"desktop pending",1280,900,f"/booking/{pending['token']}","[data-testid=booking-state]")
    text=page.locator("#bookingContent").inner_text();assert "Проверяем оплату" in text;assert "Бронь подтверждена" not in text;assert "9081" not in text;assert page.locator("[data-testid=private-instructions]").count()==0;page.close()
    invalid=secrets.token_urlsafe(32)
    page,_=open_page(browser,"desktop invalid",1280,900,f"/booking/{invalid}","[data-testid=invalid-access]");assert "Данные бронирования не раскрыты" in page.locator("#bookingContent").inner_text();page.close()

    page,_=open_page(browser,"mobile confirmed",390,844,f"/booking/{confirmed['token']}","[data-testid=private-instructions]");assert "Бронь подтверждена" in page.locator("#bookingContent").inner_text()
    if shots:page.screenshot(path=os.path.join(shots,"mobile-confirmed.png"),full_page=False)
    page.close()
    page,_=open_page(browser,"mobile invalid",390,844,f"/booking/{invalid}","[data-testid=invalid-access]");page.close()
    browser.close()

print("PASS 5 STEP 4 browser: desktop confirmed/pending/invalid PASS, mobile confirmed/invalid PASS")
