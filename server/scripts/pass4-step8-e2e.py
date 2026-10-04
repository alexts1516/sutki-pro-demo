# Только локальный сервер с одноразовой seed-базой: python3 scripts/pass4-step8-e2e.py http://localhost:3108
# Python Playwright + Chrome (CHROME_PATH). Никаких внешних платежей/Telegram.
import os, sys, time
from datetime import date, timedelta
from playwright.sync_api import sync_playwright, expect
B = (sys.argv[1] if len(sys.argv)>1 else 'http://localhost:3108').rstrip('/')
if not B.startswith(('http://localhost:', 'http://127.0.0.1:')): raise SystemExit('Только локальная тестовая база')
OUT = os.environ.get('SHOTS_DIR', '/tmp/sutki-step8-e2e'); os.makedirs(OUT, exist_ok=True)
checks = []; errors = []
def ok(name): checks.append(name); print('✓', name, flush=True)
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME_PATH', '/usr/bin/google-chrome'))
    ctx = br.new_context(viewport={'width':1280,'height':900}, locale='ru-RU', timezone_id='Asia/Almaty', permissions=['clipboard-read','clipboard-write'])
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d:d.accept())
    def login(page, email):
        page.goto(B+'/admin/'); page.locator('#lgLogin').fill(email); page.locator('#lgPass').fill('demo12345'); page.get_by_role('button',name='Войти',exact=True).click(); expect(page.get_by_role('button',name='Выйти',exact=True)).to_be_visible()
    def nav(page, name): page.get_by_role('navigation').get_by_role('button',name=name).click()
    def api(method,path,data=None):
        r=ctx.request.fetch(B+path, method=method, data=data); assert r.ok, (path,r.status,r.text()); return r.json()
    def close(page): page.get_by_role('button',name='Закрыть',exact=True).click()
    login(pg,'azamat@astanastay.example'); nav(pg,'📅 Брони'); expect(pg.locator('#specialNew')).to_be_visible(); ok('Owner: создание доступно')
    pg.locator('#specialNew').click(); expect(pg.locator('#customPrice')).to_be_visible(); ok('Owner: индивидуальная цена доступна')
    assert pg.locator('[name="expiresInHours"]').input_value()=='24'; ok('Срок по умолчанию 24 часа')
    apt=pg.locator('[name="apartmentId"] option').nth(1).get_attribute('value'); apts=api('GET','/api/admin/apartments'); a=next(a for a in apts if a['id']==apt)
    start=date.today()+timedelta(days=210+int(time.time())%300); end=start+timedelta(days=2)
    pg.locator('[name="apartmentId"]').select_option(apt); pg.locator('[name="checkIn"]').fill(str(start)); pg.locator('[name="checkOut"]').fill(str(end)); pg.locator('[name="guestName"]').fill('E2E шаг 8')
    expect(pg.locator('#standardPrice')).to_contain_text('Стандартная цена:'); pg.locator('#customPrice').click(); pg.locator('[name="totalKzt"]').fill('65000')
    pg.get_by_role('button',name='Создать особую бронь',exact=True).click(); expect(pg.locator('.special-block')).to_contain_text('создана'); expect(pg.locator('.special-block')).to_contain_text('удерживается'); ok('Форма создаёт бронь и показывает удержание')
    pg.get_by_role('button',name='Скопировать ссылку',exact=True).click(); url=pg.evaluate('navigator.clipboard.readText()'); assert '/link/' in url; ok('Copy: в буфере гостевая ссылка')
    records=api('GET','/api/admin/bookings?source=link'); b=next(b for b in records if b.get('guest',{}).get('name')=='E2E шаг 8' and b['checkIn']==str(start)); lid=b['link']['id']; bid=b['id']; assert b['source']=='link' and b['status']=='request'; ok('Одна Booking(request) + BookingLink')
    before=b['link']['holdUntil']; pg.locator('#linkExtend [name="hours"]').fill('2');
    with pg.expect_response(lambda r: r.url.endswith('/extend') and r.request.method=='POST'): pg.locator('#linkExtend button').click()
    expect(pg.locator('#linkExtend')).to_be_visible(); after=api('GET','/api/admin/bookings/'+bid)['link']['holdUntil']; assert after>before; ok('Продление из UI')
    pg.get_by_role('button',name='Новая ссылка',exact=True).click(); expect(pg.locator('.secret-url')).not_to_have_value(url); newurl=pg.locator('.secret-url').input_value(); assert newurl!=url; assert ctx.request.get(url.replace('/link/','/api/special-link/')).status==404; ok('Rotate: старый токен закрыт')
    gctx=br.new_context(locale='ru-RU', timezone_id='Asia/Almaty'); guest=gctx.new_page(); guest.on('pageerror',lambda e: errors.append(str(e))); guest.goto(newurl); guest.get_by_role('textbox',name='Телефон',exact=True).fill('+77015556677'); guest.get_by_role('checkbox').check(); guest.get_by_role('button',name='Подтвердить',exact=True).click(); expect(guest.locator('#view')).to_contain_text('подтверждена'); ok('Гость подтверждает по ссылке')
    pg.reload(); expect(pg.locator('#specialNew')).to_be_visible(); pg.get_by_text('Особые брони: подтверждённые и закрытые',exact=True).click(); pg.locator(f'[data-open="bk:{bid}"]').click(); expect(pg.locator('.special-block')).to_contain_text('Подтверждено'); assert api('GET','/api/admin/bookings/'+bid)['status']=='confirmed'; ok('Owner видит подтверждённую бронь'); pg.screenshot(path=OUT+'/confirmed.png')
    close(pg); nav(pg,'👥 Команда и Telegram'); members=api('GET','/api/admin/team'); adm=next(m for m in members if m['email']=='alina@astanastay.example'); toggle=pg.locator(f'[data-link-price="{adm["userId"]}"]'); expect(toggle).to_be_visible(); toggle.uncheck(); ok('Owner: переключатель права в Команде')
    ac=br.new_context(viewport={'width':390,'height':844},locale='ru-RU',timezone_id='Asia/Almaty'); admin=ac.new_page(); admin.on('dialog',lambda d:d.accept()); admin.on('pageerror',lambda e:errors.append(str(e))); login(admin,'alina@astanastay.example');
    # На телефоне сначала открыть существующее меню.
    admin.get_by_role('button',name='Меню',exact=True).click(); nav(admin,'📅 Брони'); expect(admin.locator('#specialNew')).to_be_visible(); admin.locator('#specialNew').click(); assert admin.locator('#customPrice').count()==0; ok('Admin без права: создание есть, поля цены нет')
    assert admin.locator('#specialForm').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'); admin.screenshot(path=OUT+'/mobile-form.png'); ok('Форма 390 px без горизонтальной прокрутки')
    toggle.check(); expect(toggle).to_be_checked(); close(admin); admin.locator('#specialNew').click(); expect(admin.locator('#customPrice')).to_be_visible(); ok('Выданное право появляется при повторном открытии')
    admin.locator('[name="apartmentId"]').select_option(apt); admin.locator('[name="checkIn"]').fill(str(end+timedelta(days=5))); admin.locator('[name="checkOut"]').fill(str(end+timedelta(days=7))); admin.locator('#customPrice').click(); admin.locator('[name="totalKzt"]').fill('61000'); admin.locator('[name="extraCheckRequired"]').check(); admin.locator('[name="extraCheckNote"]').fill('Позвоните владельцу'); admin.get_by_role('button',name='Создать особую бронь',exact=True).click(); expect(admin.locator('.secret-url')).to_be_visible(); extraurl=admin.locator('.secret-url').input_value(); ok('Admin с правом создаёт индивидуальную цену и extra-check')
    guest.goto(extraurl); guest.get_by_role('textbox',name='Имя и фамилия',exact=True).fill('E2E extra'); guest.get_by_role('textbox',name='Телефон',exact=True).fill('+77015556677'); guest.get_by_role('checkbox').check(); guest.get_by_role('button',name='Подтвердить',exact=True).click(); expect(guest.locator('#view')).to_contain_text('Позвоните владельцу'); ok('Extra-check: гость ожидает администратора')
    admin.get_by_role('button',name='Подтверждение получено',exact=True).click(); expect(admin.locator('.special-block')).to_contain_text('Подтверждено'); ok('Extra-check: отметка в карточке подтверждает')
    toggle.uncheck(); close(admin); admin.locator('#specialNew').click(); assert admin.locator('#customPrice').count()==0; ok('Отозванное право исчезает')
    admin.locator('[name="apartmentId"]').select_option(apt); admin.locator('[name="checkIn"]').fill(str(end+timedelta(days=10))); admin.locator('[name="checkOut"]').fill(str(end+timedelta(days=12))); admin.get_by_role('button',name='Создать особую бронь',exact=True).click(); expect(admin.locator('.secret-url')).to_be_visible(); revoked=admin.locator('.secret-url').input_value(); admin.get_by_role('button',name='Отозвать предложение',exact=True).click(); expect(admin.locator('.special-block')).to_contain_text('Отозвано'); assert ac.request.get(revoked.replace('/link/','/api/special-link/')).status==410; ok('Revoke из UI закрывает гостевую ссылку')
    dep=api('POST','/api/admin/booking-links',{'apartmentId':apt,'checkIn':str(end+timedelta(days=20)),'checkOut':str(end+timedelta(days=22)),'guestsCount':1,'terms':'deposit','depositKzt':5000})
    close(admin); admin.reload(); expect(admin.locator('#specialNew')).to_be_visible(); admin.locator(f'[data-open="bk:{dep["link"]["bookingId"]}"]').click(); expect(admin.locator('#drawer')).to_contain_text('ждём залог'); admin.get_by_role('button',name='Залог получен',exact=True).click(); expect(admin.locator('#drawer')).to_contain_text('залог внесён'); ok('Существующий deposit: честный статус и отметка из карточки')
    assert not errors, errors; ok('Нет JavaScript-ошибок'); br.close()
print(f'PASS: {len(checks)} browser checks')
