import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, prisma, request, freeDates } from './helpers.js';

const { app, events } = makeApp();
const api = () => request(app);
const slug = 'astana-stay';
let account, apartment, dates, ref;

before(async () => {
  account = await prisma.account.findUnique({ where: { slug } });
  apartment = await prisma.apartment.create({ data: { accountId:account.id,title:'Semantics private unit',address:'Semantics address, кв. 707',district:'Highvill',complex:'Highvill',rooms:'1-комн.',maxGuests:3,basePriceKzt:27000,description:'Step 2 semantics fixture',active:true,sortOrder:-101 } });
  dates = await freeDates(account.id,apartment.id,2,2400);
  const catalogue = await api().get(`/api/public/${slug}/apartments`).query({...dates,guests:2});
  ref = catalogue.body.find(item=>item.description==='Step 2 semantics fixture').ref;
});
after(() => prisma.$disconnect());

test('guest UI describes a finite hold and never claims a booking before payment', async () => {
  const page=await api().get('/'),js=await api().get('/guest-assets/guest.js');
  assert.equal(page.status,200);assert.equal(js.status,200);
  const visible=page.text+js.text;
  for(const forbidden of ['Создать бронь','Создаём бронь','Бронь №','Бронь создана'])assert.ok(!visible.includes(forbidden),forbidden);
  for(const required of ['Перейти к оплате','Удерживаем даты','Даты временно удерживаются','Завершите оплату, чтобы подтвердить бронирование','Платёжный шаг пока не подключён'])assert.ok(visible.includes(required),required);
});

test('ordinary checkout creates one technical hold without personnel downstream', async () => {
  const notificationsBefore=await prisma.notificationLog.count({where:{accountId:account.id,event:'booking.requested'}});
  const issued=await api().post(`/api/public/${slug}/operation-key`);const body={apartmentId:ref,...dates,guests:2,name:'Pending checkout',phone:'+7 700 777 77 77',totalKzt:1};
  const first=await api().post(`/api/public/${slug}/bookings`).set('Idempotency-Key',issued.body.operationKey).send(body);
  const retry=await api().post(`/api/public/${slug}/bookings`).set('Idempotency-Key',issued.body.operationKey).send(body);
  assert.equal(first.status,201);assert.equal(retry.status,201);assert.equal(first.body.status,'request');assert.ok(first.body.holdUntil);assert.equal(first.body.totalKzt,54000);assert.equal(retry.body.token,first.body.token);
  const booking=await prisma.booking.findFirst({where:{accountId:account.id,number:first.body.number}});assert.ok(booking);assert.equal(booking.status,'request');assert.equal(await prisma.booking.count({where:{checkoutKeyHash:booking.checkoutKeyHash}}),1);
  await events.idle();
  assert.equal(await prisma.cleaningTask.count({where:{bookingId:booking.id}}),0);
  assert.equal(await prisma.transferJob.count({where:{bookingId:booking.id}}),0);
  assert.equal(await prisma.payment.count({where:{bookingId:booking.id}}),0);
  assert.equal(await prisma.notificationLog.count({where:{accountId:account.id,event:'booking.requested'}}),notificationsBefore);
});
