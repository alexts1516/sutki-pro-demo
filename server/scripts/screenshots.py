# Скриншоты админки, приложения команды и страницы по ссылке → docs/screenshots/.
# Нужны Python 3 + Playwright (pip install playwright) и Chrome/Chromium. Порядок:
#   npm run db:seed && PORT=3100 npm start     (в другом окне)
#   python3 scripts/screenshots.py [номера, например 16 25]
# Скрипт меняет демо-данные (включает комиссию 20%, водитель берёт заказ) — после него снова npm run db:seed.
import json, os, sys, time, urllib.request, http.cookiejar
from playwright.sync_api import sync_playwright
B = os.environ.get('SHOTS_URL', 'http://localhost:3100')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'screenshots') + os.sep
CHROME = os.environ.get('CHROME_PATH', '/usr/bin/google-chrome')
only = set(sys.argv[1:])

def api_session(login):
    cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    req = urllib.request.Request(B + '/api/auth/login', data=json.dumps({'login': login, 'password': 'demo12345'}).encode(), headers={'content-type': 'application/json'})
    op.open(req).read()
    def call(path, method='GET', body=None):
        r = urllib.request.Request(B + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
        return json.loads(op.open(r).read() or b'null')
    return call

own = api_session('azamat@astanastay.example')
jobs = own('/api/admin/transfer-jobs?from=2026-09-01')['items']
first = lambda st: next(j for j in jobs if j['status'] == st)
J = {s: first(s)['id'] for s in ['EN_ROUTE', 'UNASSIGNED', 'OFFERED', 'PICKED_UP']}
ext = next(j for j in jobs if 'внешний' in (j.get('driverName') or ''))
reps = own('/api/admin/repairs'); reps = reps.get('items', reps) if isinstance(reps, dict) else reps
R_AW = next(r['id'] for r in reps if r['status'] == 'AWAITING_OWNER_APPROVAL')
R_EX = next(r['id'] for r in reps if r['status'] == 'IN_PROGRESS' and any(e['status'] == 'PENDING' for e in own('/api/admin/repairs/' + r['id']).get('extras', [])))
task_link = own('/api/admin/repairs/' + R_EX)['link']['url']
tr_link = own('/api/admin/transfer-jobs/' + ext['id'])['link']['url']

def shot(page, name, full=False):
    if only and name.split('-')[0] not in only: return
    time.sleep(0.7)
    if full:   # высокий экран вместо full_page — чтобы боковое меню не «съезжало»
        vp = page.viewport_size; h = page.evaluate('document.documentElement.scrollHeight')
        page.set_viewport_size({'width': vp['width'], 'height': min(max(h, vp['height']), 2400)}); time.sleep(0.5)
        page.screenshot(path=OUT + name + '.png'); page.set_viewport_size(vp)
    else: page.screenshot(path=OUT + name + '.png')
    print('✓', name)

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None, args=['--no-sandbox'])
    def ctx(mobile=False):
        return br.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, device_scale_factor=2 if mobile else 1, locale='ru-RU', timezone_id='Asia/Almaty', is_mobile=mobile, has_touch=mobile)
    def login(page, email, path='/admin/'):
        page.goto(B + path); page.wait_for_selector('#lgLogin')
        page.fill('#lgLogin', email); page.fill('#lgPass', 'demo12345'); page.click('#lgBtn'); time.sleep(1.2)
    def hash(page, h):
        page.evaluate(f"location.hash = '{h}'"); page.wait_for_load_state('networkidle'); time.sleep(0.8)

    # ---------- админка, компьютер ----------
    c = ctx(); pg = c.new_page()
    pg.goto(B + '/admin/'); pg.wait_for_selector('#lgLogin'); shot(pg, '00-login')
    login(pg, 'azamat@astanastay.example')
    hash(pg, 'apartments'); shot(pg, '01-apartments')
    pg.click('.apt, [data-apt], .card.click', timeout=5000) if pg.query_selector('.apt, [data-apt], .card.click') else None
    time.sleep(1); shot(pg, '02-apartment-photos')
    ph = pg.query_selector('#photos'); 
    if ph: ph.scroll_into_view_if_needed()
    shot(pg, '03-photos-card')
    hash(pg, 'texts'); shot(pg, '04-site-texts')
    hash(pg, 'brand'); shot(pg, '05-brand-logo')
    hash(pg, 'bookings'); shot(pg, '06-bookings')
    hash(pg, 'team'); shot(pg, '07-team-telegram')
    hash(pg, 'notifications'); shot(pg, '08-notifications')
    hash(pg, 'repairs'); shot(pg, '10-work-requests')
    hash(pg, 'repairs/' + R_AW); shot(pg, '11-work-request-estimate')
    hash(pg, 'repairs/' + R_EX); shot(pg, '12-work-request-extras')
    hash(pg, 'repairs/new'); shot(pg, '13-work-request-new')
    hash(pg, 'calendar'); shot(pg, '15-calendar')
    hash(pg, 'transfers/' + J['EN_ROUTE']); shot(pg, '16-transfer-card')
    pg.keyboard.press('Escape'); hash(pg, 'calendar')
    hash(pg, 'transfers/' + J['UNASSIGNED']); shot(pg, '17-transfer-unassigned')
    pg.keyboard.press('Escape'); hash(pg, 'bookings')
    row = pg.query_selector('tr[data-open^="bk:"]'); row and row.click(); time.sleep(1); shot(pg, '18-booking-card')
    pg.keyboard.press('Escape'); hash(pg, 'calendar'); hash(pg, 'transfers'); shot(pg, '19-transfers')
    hash(pg, 'team'); pg.evaluate("document.querySelector('[data-rate]')?.scrollIntoView({block:'center'})"); shot(pg, '20-team-drivers')
    # настройки: сначала «не настроено», затем владелец ставит 20%
    hash(pg, 'settings'); shot(pg, '24-settings-unconfigured')
    pg.check('input[name=transferPayoutMode][value=PERCENT]'); pg.fill('input[name=ownerCommissionPercent]', '20'); pg.dispatch_event('#stForm', 'input')
    pg.click('#stForm button.primary'); time.sleep(1.2); shot(pg, '25-settings', full=True)
    own('/api/admin/transfer-jobs/' + J['OFFERED'], 'PATCH', {'payoutAuto': True})
    hash(pg, 'calendar'); hash(pg, 'transfers/' + J['OFFERED']); time.sleep(0.8)
    pg.evaluate("[...document.querySelectorAll('h3')].find(h => h.textContent.includes('Деньги'))?.scrollIntoView({block:'start'})"); shot(pg, '26-transfer-money')
    pg.keyboard.press('Escape'); hash(pg, 'finance'); shot(pg, '27-finance', full=True)
    c.close()
    # админ: настройки только для просмотра, без «Финансов»
    c = ctx(); pg = c.new_page(); login(pg, 'alina@astanastay.example'); hash(pg, 'settings'); shot(pg, '28-settings-admin-readonly'); c.close()

    # ---------- телефон: админка ----------
    m = ctx(True); pg = m.new_page(); login(pg, 'azamat@astanastay.example')
    hash(pg, 'apartments'); el = pg.query_selector('.apt, [data-apt], .card.click'); el and el.click(); time.sleep(1); shot(pg, '09-mobile-photos')
    hash(pg, 'repairs/' + R_AW); shot(pg, '14-work-request-mobile')
    hash(pg, 'calendar'); shot(pg, '21-mobile-calendar')
    hash(pg, 'transfers/' + J['EN_ROUTE']); shot(pg, '22-mobile-transfer-card')
    pg.keyboard.press('Escape'); hash(pg, 'calendar')
    b = pg.query_selector('[data-mode="grid"]'); b and b.click(); time.sleep(1); shot(pg, '23-mobile-grid')
    m.close()

    # ---------- приложение команды ----------
    m = ctx(True); pg = m.new_page(); pg.goto(B + '/app/'); pg.wait_for_selector('#lgLogin'); shot(pg, '29-app-login')
    login(pg, 'ruslan@astanastay.example', '/app/'); shot(pg, '30-app-driver-offers')
    off = pg.query_selector('[data-tr]:has([data-accept])')
    if off:
        off.click(); time.sleep(1); shot(pg, '31-app-offer-detail')   # до «Беру»: без номера квартиры и телефона
        pg.click('#sheet [data-accept], #sheet button:has-text("Беру")') if pg.query_selector('#sheet [data-accept], #sheet button:has-text("Беру")') else None
        time.sleep(1.5); shot(pg, '32-app-transfer-accepted')
    m.close()
    m = ctx(True); pg = m.new_page(); login(pg, 'marat@astanastay.example', '/app/'); shot(pg, '33-app-master-repairs')
    card = pg.query_selector('[data-wr]'); card and card.click(); time.sleep(1); shot(pg, '34-app-repair-steps'); m.close()
    m = ctx(True); pg = m.new_page(); login(pg, 'gulnara@astanastay.example', '/app/'); shot(pg, '35-app-cleaning'); m.close()

    # ---------- страница по ссылке без входа ----------
    m = ctx(True); pg = m.new_page(); pg.goto(tr_link); time.sleep(1.5); shot(pg, '36-link-transfer')
    pg.goto(task_link); time.sleep(1.5); shot(pg, '37-link-repair'); m.close()
    br.close()
