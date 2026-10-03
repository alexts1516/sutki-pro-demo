# Проверка статического демо (/v2/) в настоящем браузере: три сценария с главной страницы демо, роли, ссылки, сброс.
# Телефон 390 px (как iPhone), без ошибок в консоли. Скриншоты — docs/screenshots/v2/.
#   python3 scripts/demo-e2e.py [адрес демо]   (по умолчанию https://alexts1516.github.io/sutki-pro-demo/v2/)
# Нужны Python 3 + Playwright и Chrome (CHROME_PATH, по умолчанию /usr/bin/google-chrome).
import os, sys, re, json, struct, zlib
from playwright.sync_api import sync_playwright

B = (sys.argv[1] if len(sys.argv) > 1 else 'https://alexts1516.github.io/sutki-pro-demo/v2/').rstrip('/') + '/'
OUT = os.environ.get('SHOTS_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'screenshots', 'v2')
os.makedirs(OUT, exist_ok=True)
CHROME = os.environ.get('CHROME_PATH', '/usr/bin/google-chrome')
errors, passed = [], []

def png_bytes(w=64, h=48, rgb=(200, 80, 40)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

def ok(name):
    passed.append(name); print('  ✓', name)

def check(cond, name):
    if not cond: raise AssertionError(name)
    ok(name)

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=CHROME)
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='ru-RU', timezone_id='Asia/Almaty',
                         user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')
    pg = ctx.new_page()
    pg.on('console', lambda m: errors.append(f'[console.{m.type}] {m.text} @ {pg.url}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'[pageerror] {e} @ {pg.url}'))
    pg.on('dialog', lambda d: d.accept())
    shot = lambda name, full=False: pg.screenshot(path=os.path.join(OUT, name), full_page=full)
    ev = lambda js, arg=None: pg.evaluate(js, arg)
    db = lambda js: pg.evaluate('async () => { const p = SutkiDemo.prisma; ' + js + ' }')

    def overlay_role(title, url_part):
        if pg.locator('#sutki-demo-overlay >> #sheet.on').count(): pg.click('#sutki-demo-overlay >> #close')
        pg.click('#sutki-demo-overlay >> text=Сменить роль')
        pg.click(f'#sutki-demo-overlay >> .role:has-text("{title}")')
        pg.wait_for_url(f'**{url_part}**', timeout=20000)
        pg.wait_for_load_state('networkidle')

    def toast_text(sel='#toasts, #toast'):
        pg.wait_for_timeout(400)
        return ' '.join(pg.locator(sel).all_inner_texts())

    def feed_press(name):
        if pg.locator('#sutki-demo-overlay >> #sheet.on').count(): pg.click('#sutki-demo-overlay >> #close')
        pg.click('#sutki-demo-overlay >> button.tg')
        pg.wait_for_selector('#sutki-demo-overlay >> .msg')
        card = pg.locator('#sutki-demo-overlay >> .msg', has=pg.locator('.kb')).filter(has_text=name).first
        card.locator('.kb button').first.click()
        pg.wait_for_selector('#sutki-demo-overlay >> .toast.on', timeout=10000)
        t = pg.locator('#sutki-demo-overlay >> .toast').inner_text()
        return t

    # ---------- главная демо ----------
    print('Главная демо:', B)
    pg.goto(B)
    pg.wait_for_function("document.querySelector('#statusText').textContent.includes('Демо готово')", timeout=60000)
    pg.wait_for_function("document.querySelectorAll('#gApt option').length > 5", timeout=20000)
    ok('демо запустилось, данные заполнены сидом (квартир в форме гостя: %d)' % pg.locator('#gApt option').count())
    check(pg.locator('#roles .role').count() == 7, '7 ролей на главной')
    shot('01-landing.png')
    shot('01-landing-full.png', True)

    # ---------- сценарий 1: бронь с трансфером → водитель ----------
    print('Сценарий 1: бронь с трансфером → «Беру» → шаги → деньги')
    bk = db("const b = await p.booking.findFirst({ where: { status: 'request', transfers: { some: {} } } }); return { id: b.id, number: b.number };")
    pg.click('text=Начать: владелец → брони'); pg.wait_for_url('**/admin/**'); pg.wait_for_selector('h1:has-text("Брони и заявки")')
    shot('02-owner-bookings.png')
    pg.click(f'button[data-confirm="{bk["id"]}"]')
    pg.wait_for_function("document.querySelector('#toasts').innerText.includes('подтверждена')")
    job = db(f"const j = await p.transferJob.findFirst({{ where: {{ bookingId: '{bk['id']}' }} }}); return {{ id: j.id, status: j.status }};")
    check(job['status'] == 'OFFERED', f'бронь №{bk["number"]} подтверждена → заказ водителям OFFERED')
    pg.click('#sutki-demo-overlay >> button.tg'); pg.wait_for_selector('#sutki-demo-overlay >> .msg')
    n_offers = pg.locator('#sutki-demo-overlay >> .kb button').count()
    check(n_offers >= 3, f'в «Telegram (демо)» у водителей предложения с кнопкой «Беру» ({n_offers})')
    shot('03-telegram-offers.png')
    pg.click('#sutki-demo-overlay >> #close')
    t = feed_press('Руслан')
    check('Заказ ваш' in t, 'Руслан нажал «Беру» в Telegram (демо) → «Заказ ваш ✅»')
    pg.wait_for_timeout(1800)  # панель перезагружает страницу
    t2 = feed_press('Бауыржан')
    check('Уже взял другой' in t2, 'второй водитель → «Уже взял другой водитель» (первый получает заказ)')
    shot('04-telegram-taken.png')
    pg.wait_for_timeout(1800)
    j = db(f"const j = await p.transferJob.findUnique({{ where: {{ id: '{job['id']}' }}, include: {{ driverUser: true }} }}); return {{ status: j.status, driver: j.driverUser?.name }};")
    check(j['status'] == 'ACCEPTED' and j['driver'].startswith('Руслан'), 'заказ ACCEPTED у Руслана')
    # чужой водитель не видит квартиру и телефон, а оплату гостя — никто из водителей
    other = ev("""async (id) => { await SutkiDemo.login('bauyrzhan@astanastay.example'); const r = await fetch('/api/staff/transfers/' + id); const j = await r.json();
      const acc = await fetch('/api/staff/transfers/' + id + '/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); return { j, acc: acc.status }; }""", job['id'])
    check(not other['j'].get('guestPhone') and not (other['j'].get('apartment') or {}).get('apartmentNumber') and other['acc'] == 409, 'другой водитель: без телефона и номера квартиры, «Беру» → 409')
    overlay_role('Водитель Руслан', '/app/')
    pg.wait_for_selector('text=Мои поездки')
    pg.click(f'[data-tr="{job["id"]}"]'); pg.wait_for_selector('[data-act="en-route"]')
    body = pg.inner_text('body')
    check('Квартира' in body and '№' in body and 'Телефон' in body, 'после «Беру» Руслан видит номер квартиры и телефон гостя')
    shot('05-driver-trip.png')
    pg.click('[data-act="en-route"]'); pg.click('[data-eta="20"]'); pg.wait_for_selector('[data-act="arrived"]')
    pg.click('[data-act="arrived"]'); pg.wait_for_selector('[data-act="picked-up"]')
    pg.click('[data-act="picked-up"]'); pg.wait_for_selector('[data-act="done"]')
    shot('06-driver-steps.png')
    pg.click('[data-act="done"]'); pg.wait_for_timeout(800)
    st = db(f"return (await p.transferJob.findUnique({{ where: {{ id: '{job['id']}' }}, include: {{ payoutRecord: true }} }}));")
    check(st['status'] == 'DONE' and st['payoutRecord'] and st['payoutRecord']['status'] == 'PENDING', 'шаги «Выехал → На месте → Гость в машине → Завершить» → DONE, долг водителю PENDING')
    drv = ev("async (id) => (await (await fetch('/api/staff/transfers/' + id)).json())", job['id'])
    check('guestPayment' not in json.dumps(drv) and 'priceKzt' not in drv, 'водитель не видит оплату гостя и цену для гостя')
    overlay_role('Владелец Азамат', '/admin/')
    pg.goto(B + f'admin/#transfers/{job["id"]}'); pg.wait_for_selector('text=Оплата гостя → бизнес')
    pg.click('[data-act="gpaid"][data-m="cash"]'); pg.wait_for_function("document.querySelector('#toasts').innerText.includes('доход бизнеса')")
    pg.click('[data-act="paid"]'); pg.wait_for_function("document.querySelector('#toasts').innerText.includes('выплачено водителю')")
    pg.wait_for_timeout(400)
    pg.locator('text=Оплата гостя → бизнес').scroll_into_view_if_needed()
    shot('07-owner-transfer-money.png')
    money = db(f"const j = await p.transferJob.findUnique({{ where: {{ id: '{job['id']}' }}, include: {{ transfer: true, payoutRecord: true }} }}); return {{ g: j.transfer.guestPaymentStatus, m: j.transfer.guestPaymentMethod, pr: j.payoutRecord.status, by: j.payoutRecord.paidByName }};")
    check(money == {'g': 'PAID', 'm': 'cash', 'pr': 'PAID', 'by': money['by']} and money['by'], 'оплата гостя → бизнес (наличные) записана, выплата водителю PAID с тем, кто отметил')

    # ---------- сценарий 2: заявка мастеру ----------
    print('Сценарий 2: заявка мастеру → смета по фото → одобрить → доп. расход → выполнено')
    pg.goto(B); pg.wait_for_function("document.querySelector('#statusText').textContent.includes('Демо готово')")
    pg.click('text=Начать: новая заявка'); pg.wait_for_url('**/admin/**'); pg.wait_for_selector('#wrForm')
    pg.fill('#wrForm [name=title]', 'Не работает розетка у кровати')
    pg.fill('#wrForm [name=description]', 'Искрит и не держит вилку, фото приложу')
    opt = pg.locator('#wrForm [name=executor] option', has_text='Master Electric').first.get_attribute('value')
    pg.select_option('#wrForm [name=executor]', opt)
    pg.select_option('#wrForm [name=type]', 'elec')
    shot('08-owner-new-repair.png')
    pg.click('#wrCreate'); pg.wait_for_function("location.hash.startsWith('#repairs/') && location.hash !== '#repairs/new'")
    rid = pg.evaluate("location.hash.split('/')[1]")
    pg.set_input_files('#wrPh', files=[{'name': 'rozetka.png', 'mimeType': 'image/png', 'buffer': png_bytes()}])
    pg.wait_for_function("document.querySelector('#toasts').innerText.includes('Фото добавлены')")
    r = db(f"return await p.repairTask.findUnique({{ where: {{ id: '{rid}' }}, include: {{ photos: true }} }});")
    check(r['status'] == 'NEW' and len(r['photos']) == 1, 'заявка создана, фото проблемы загружено (хранится в браузере)')
    overlay_role('Мастер Master Electric', '/app/')
    pg.click('[data-tab="repairs"]') if pg.locator('[data-tab="repairs"]').count() else None
    pg.click(f'[data-wr="{rid}"]'); pg.wait_for_selector('[data-wact="estimate:PHOTOS"]')
    pg.click('[data-wact="estimate:PHOTOS"]')
    pg.fill('#wrForm [name=labourKzt]', '8000'); pg.fill('#wrForm [name=items]', 'Замена розетки, проверка линии')
    shot('09-master-estimate.png')
    pg.click('#wrForm button.primary'); pg.wait_for_timeout(800)
    check(db(f"return (await p.repairTask.findUnique({{ where: {{ id: '{rid}' }} }})).status;") == 'AWAITING_OWNER_APPROVAL', 'мастер отправил смету по фото → «Ждёт одобрения сметы»')
    st = ev("async (id) => { const r = await fetch('/api/staff/repairs/' + id + '/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); return r.status; }", rid)
    check(st == 409 or st == 400 or st == 403, f'начать работу без одобрения нельзя ({st})')
    overlay_role('Владелец Азамат', '/admin/')
    pg.goto(B + f'admin/#repairs/{rid}'); pg.wait_for_selector('[data-est-ok]')
    pg.click('[data-est-ok]'); pg.wait_for_function("document.querySelector('#toasts').innerText.includes('Смета одобрена')")
    ok('владелец одобрил смету')
    overlay_role('Мастер Master Electric', '/app/')
    pg.click('[data-tab="repairs"]') if pg.locator('[data-tab="repairs"]').count() else None
    pg.click(f'[data-wr="{rid}"]'); pg.wait_for_selector('[data-wact="start"]')
    pg.click('[data-wact="start"]'); pg.wait_for_selector('[data-wact="extra"]')
    pg.click('[data-wact="extra"]')
    pg.fill('#wrForm [name=amountKzt]', '3000'); pg.fill('#wrForm [name=description]', 'Заменить подрозетник'); pg.fill('#wrForm [name=reason]', 'Старый подрозетник оплавлен')
    pg.click('#wrForm button.primary'); pg.wait_for_timeout(800)
    check(db(f"return (await p.extraExpense.findFirst({{ where: {{ repairTaskId: '{rid}' }} }})).status;") == 'PENDING', 'мастер начал работу и добавил доп. расход 3 000 ₸ → ждёт решения')
    shot('10-master-extra.png')
    overlay_role('Владелец Азамат', '/admin/')
    pg.goto(B + f'admin/#repairs/{rid}'); pg.wait_for_selector('[data-x-ok]')
    pg.click('[data-x-ok]'); pg.wait_for_function("document.querySelector('#toasts').innerText.includes('Доп. расход одобрен')")
    ok('владелец одобрил доп. расход')
    overlay_role('Мастер Master Electric', '/app/')
    pg.click('[data-tab="repairs"]') if pg.locator('[data-tab="repairs"]').count() else None
    pg.click(f'[data-wr="{rid}"]'); pg.wait_for_selector('[data-wact="complete"]')
    pg.click('[data-wact="complete"]'); pg.fill('#wrForm [name=report]', 'Заменил розетку и подрозетник, проверил — работает')
    pg.click('#wrForm button.primary'); pg.wait_for_timeout(900)
    r = db(f"return await p.repairTask.findUnique({{ where: {{ id: '{rid}' }} }});")
    check(r['status'] == 'DONE' and r['costKzt'] == 11000, f'«Выполнено» → DONE, сумма для финансов {r["costKzt"]} ₸ (смета 8 000 + доп. 3 000)')
    shot('11-master-done.png')

    # ---------- сценарий 3: комиссия → финансы ----------
    print('Сценарий 3: настройки комиссии → финансы')
    overlay_role('Владелец Азамат', '/admin/')
    pg.goto(B + 'admin/#settings'); pg.wait_for_selector('#stForm')
    pg.check('#stForm [name=transferPayoutMode][value=PERCENT]')
    pg.fill('#stForm [name=ownerCommissionPercent]', '20')
    check(pg.is_checked('#stForm [name=ownerDrivesKeepsAll]'), 'настройка «Везёт сам владелец — вся сумма бизнесу» включена по умолчанию')
    pg.click('#stForm button.primary'); pg.wait_for_timeout(700)
    s = db("return await p.accountSettings.findFirst({ where: { account: { slug: 'astana-stay' } } });")
    check(s['transferPayoutMode'] == 'PERCENT' and s['ownerCommissionPercent'] == 20, 'комиссия 20% сохранена')
    pg.locator('#stForm').scroll_into_view_if_needed(); shot('12-owner-settings.png')
    # новая поездка после настройки: водителю 80%
    pv = ev("""async () => { const r = await fetch('/api/public/astana-stay/transfers', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'in', place: 'airport', date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), time: '11:00', name: 'Тест Гость', phone: '+77015550000' }) });
      const t = await r.json(); const d = await fetch('/api/admin/transfers/' + t.id + '/dispatch', { method: 'POST' }); const j = await d.json(); return { price: t.priceKzt, payout: j.payoutKzt, commission: j.commissionKzt }; }""")
    check(pv['payout'] == round(pv['price'] * 0.8 / 100) * 100 and pv['commission'] == pv['price'] - pv['payout'], f'новый заказ: водителю {pv["payout"]} из {pv["price"]} ₸ (комиссия 20%)')
    pg.goto(B + 'admin/#finance'); pg.wait_for_selector('h1:has-text("Финансы")'); pg.wait_for_timeout(500)
    fin = pg.inner_text('#view')
    check('Трансферы' in fin and 'Выручка' in fin, 'финансы: выручка трансферов, выплаты водителям, маржа')
    shot('13-owner-finance.png'); shot('13-owner-finance-full.png', True)
    # администратор не видит финансы
    overlay_role('Администратор Алина', '/admin/')
    pg.wait_for_selector('#nav button')
    check(pg.locator('#nav [data-nav="finance"]').count() == 0, 'администратор: раздела «Финансы» нет')

    # ---------- остальные роли и ссылки ----------
    print('Роли и ссылки без входа')
    overlay_role('Уборщица Гульнара', '/app/'); pg.wait_for_selector('#view'); pg.wait_for_timeout(500)
    check('Гульнара' in pg.inner_text('#who'), 'уборщица входит в приложение команды'); shot('14-cleaner.png')
    overlay_role('Внешний водитель по ссылке', '/link/'); pg.wait_for_selector('.when, .card'); pg.wait_for_timeout(700)
    check('Ссылка недействительна' not in pg.inner_text('#view'), 'внешний водитель открывает поездку по ссылке без входа'); shot('15-external-driver-link.png')
    overlay_role('Внешний мастер по ссылке', '/link/'); pg.wait_for_timeout(900)
    check('Ссылка недействительна' not in pg.inner_text('#view'), 'внешний мастер открывает заявку по ссылке без входа'); shot('16-external-master-link.png')

    # ---------- гость с главной и сброс ----------
    print('Заявка гостя с главной и «Сбросить демо»')
    pg.goto(B); pg.wait_for_function("document.querySelector('#statusText').textContent.includes('Демо готово')")
    pg.wait_for_function("document.querySelectorAll('#gApt option').length > 5")
    pg.click('#gBtn'); pg.wait_for_selector('#gRes .ok, #gRes .err')
    check(pg.locator('#gRes .ok').count() == 1, 'гость отправил заявку с трансфером с главной демо: ' + pg.inner_text('#gRes').split('\n')[0])
    shot('17-guest-request.png')
    with pg.expect_navigation(timeout=30000): pg.click('#reset')
    pg.wait_for_function("document.querySelector('#statusText').textContent.includes('Демо готово')")
    n = db("return await p.repairTask.count({ where: { title: 'Не работает розетка у кровати' } });")
    check(n == 0, '«Сбросить демо» — данные заполнены заново')
    br.close()

print()
print(f'Пройдено проверок: {len(passed)}')
if errors:
    print('Ошибки в консоли браузера:'); print('\n'.join(errors)); sys.exit(1)
print('Ошибок в консоли нет. Скриншоты:', os.path.abspath(OUT))
