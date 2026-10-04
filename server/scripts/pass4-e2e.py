# Финальная приёмка Pass 4 на одноразовом локальном сервере.
# Сначала существующие 21 UI-проверка, затем сквозные API+browser проверки обычной брони и позднего ремонта.
import os, sys, runpy
from datetime import date, timedelta
from playwright.sync_api import sync_playwright, expect
B = (sys.argv[1] if len(sys.argv)>1 else 'http://localhost:3108').rstrip('/')
if not B.startswith(('http://localhost:', 'http://127.0.0.1:')): raise SystemExit('Только локальная тестовая база')
runpy.run_path(os.path.join(os.path.dirname(__file__), 'pass4-step8-e2e.py'), run_name='__main__')
checks=[]; errors=[]
def ok(name): checks.append(name); print('✓',name,flush=True)
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=os.environ.get('CHROME_PATH','/usr/bin/google-chrome'))
    ctx=br.new_context(viewport={'width':1280,'height':900},locale='ru-RU',timezone_id='Asia/Almaty')
    page=ctx.new_page(); page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(B+'/admin/'); page.locator('#lgLogin').fill('azamat@astanastay.example'); page.locator('#lgPass').fill('demo12345'); page.get_by_role('button',name='Войти',exact=True).click(); expect(page.get_by_role('button',name='Выйти',exact=True)).to_be_visible()
    def api(method,path,data=None,status=200):
        r=ctx.request.fetch(B+path,method=method,data=data); assert r.status==status,(path,r.status,r.text()); return r.json()
    apt=api('GET','/api/admin/apartments')[0]; day=date.today()+timedelta(days=1100)
    body={'apartmentId':apt['id'],'checkIn':str(day),'checkOut':str(day+timedelta(days=2)),'guests':1,'name':'E2E карта','phone':'+77015557788'}
    api('POST','/api/public/astana-stay/bookings',{**body,'paymentMethod':'cash'},400); ok('Обычная бронь: наличные запрещены')
    public=api('POST','/api/public/astana-stay/bookings',body,201)
    b=next(b for b in api('GET','/api/admin/bookings?status=request') if b['number']==public['number'])
    assert b['paymentMethod']=='card' and public.get('holdUntil'); ok('Обычная бронь: карта и конечное удержание')
    api('POST','/api/public/astana-stay/bookings/'+public['token']+'/pay',{},201)
    paid=api('GET','/api/admin/bookings/'+b['id']); assert paid['status']=='confirmed' and paid['paymentStatus']=='paid' and len(paid['cleanings'])==1; ok('Оплата подтверждает и создаёт подготовку Pass 3')
    link=api('POST','/api/admin/booking-links',{'apartmentId':apt['id'],'checkIn':str(day+timedelta(days=5)),'checkOut':str(day+timedelta(days=7)),'guestsCount':1,'terms':'cash_on_arrival'},201)
    bid=link['link']['bookingId']; token=link['url'].split('/link/')[1]
    repair=api('POST','/api/admin/repairs',{'apartmentId':apt['id'],'title':'Поздний ремонт E2E','date':str(day+timedelta(days=5)),'blockDays':1},201)
    guest=br.new_context(locale='ru-RU',timezone_id='Asia/Almaty').new_page(); guest.on('pageerror',lambda e:errors.append(str(e)))
    guest.goto(link['url']); guest.locator('#spName').fill('Гость позднего ремонта'); guest.locator('#spPhone').fill('+77015558899'); guest.locator('#spTerms').check(); guest.locator('#spSubmit').click(); expect(guest.locator('#view')).to_contain_text('подтверждена'); ok('Поздний ремонт не мешает гостю подтвердить')
    api('POST','/api/special-link/'+token+'/submit',{}); after=api('GET','/api/admin/bookings/'+bid); assert after['status']=='confirmed' and len(after['cleanings'])==1; ok('Повтор submit: одна бронь и одна подготовка')
    assert any(i['kind']=='link_conflict' and i['ref']==bid for i in api('GET','/api/admin/today')['items']); ok('Поздний ремонт: конфликт виден менеджеру в Сегодня')
    page.reload(); page.get_by_role('navigation').get_by_role('button',name='📅 Брони').click(); page.get_by_text('Особые брони: подтверждённые и закрытые',exact=True).click(); page.locator('[data-open="bk:'+bid+'"]').click(); expect(page.locator('#drawer')).to_contain_text('Подтверждено'); ok('Владелец видит сохранённую особую бронь после ремонта')
    assert not errors,errors; ok('Нет JavaScript-ошибок в сквозных сценариях'); br.close()
print('PASS: 21 + '+str(len(checks))+' = '+str(21+len(checks))+' Pass 4 E2E checks')
