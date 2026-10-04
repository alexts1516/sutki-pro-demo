# Browser regression прежних task/transfer links на одноразовой локальной базе.
# DATABASE_URL=file:./pass4-e2e.db CHROME_PATH=... python scripts/pass4-link-regression.py http://127.0.0.1:3108
import json, os, subprocess, sys
from playwright.sync_api import sync_playwright, expect

B = sys.argv[1].rstrip('/')
assert B.startswith(('http://127.0.0.1:', 'http://localhost:'))
assert os.environ.get('DATABASE_URL') == 'file:./pass4-e2e.db', 'Только одноразовая E2E-база'
fixture = '''
import { prisma } from './src/db.js';
import { randomBytes } from 'node:crypto';
const task = await prisma.repairTask.findFirst({where:{linkToken:{not:null},status:{notIn:['DONE','CANCELLED']}}});
const job = await prisma.transferJob.findFirst({where:{status:{notIn:['DONE','CANCELLED']}}});
const driver = await prisma.contractor.create({data:{accountId:job.accountId,name:'Browser regression driver',type:'other',canDrive:true}});
const token=randomBytes(24).toString('base64url');
await prisma.transferJob.update({where:{id:job.id},data:{driverContractorId:driver.id,driverName:driver.name,linkToken:token}});
console.log(JSON.stringify({task:task.linkToken,taskTitle:task.title,transfer:token,job:job.id,driver:driver.id,old:{driverContractorId:job.driverContractorId,driverName:job.driverName,linkToken:job.linkToken}}));
await prisma.$disconnect();
'''
data = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', fixture], text=True))
errors, resource_errors, checks = [], [], []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=os.environ['CHROME_PATH'])
        for width in (1280, 390):
            ctx = br.new_context(viewport={'width':width,'height':844},locale='ru-RU')
            page = ctx.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: resource_errors.append({'text':m.text,'url':m.location.get('url')}) if m.type=='error' else None)
            for kind in ('task', 'transfer'):
                page.goto(B+'/link/'+data[kind])
                expect(page.locator('#view')).not_to_be_empty()
                expect(page.locator('#title')).to_contain_text('Трансфер' if kind=='transfer' else data['taskTitle'])
                text=page.locator('#view').inner_text()
                assert 'Ссылка недействительна' not in text and ('Адрес' in text if kind=='task' else 'Вам за поездку' in text), text
                checks.append(f'{kind} без входа, {width}px')
                print('✓',checks[-1],flush=True)
            ctx.close()
        br.close()
    assert not errors, errors
    # Не скрывать известный отсутствующий favicon сервера; любой другой console error проваливает проверку.
    assert all(e['url']==B+'/favicon.ico' and '404' in e['text'] for e in resource_errors), resource_errors
    print('Resource diagnostics:',json.dumps(resource_errors,ensure_ascii=False))
    print('PASS: 4/4, JavaScript errors: 0; favicon 404 recorded separately')
finally:
    restore = '''import {prisma} from './src/db.js'; const d=JSON.parse(process.argv[1]); await prisma.transferJob.update({where:{id:d.job},data:d.old}); await prisma.contractor.delete({where:{id:d.driver}}); await prisma.$disconnect();'''
    subprocess.run(['node','--input-type=module','-e',restore,json.dumps(data)],check=True)
