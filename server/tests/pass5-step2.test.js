import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, prisma, request, freeDates } from './helpers.js';

const { app } = makeApp();
const api = () => request(app);
const slug = 'astana-stay';
let account, apartment, dates, publicApartment, firstBooking;

before(async () => {
  account = await prisma.account.findUnique({ where: { slug } });
  apartment = await prisma.apartment.create({ data: { accountId:account.id,title:'Step 2 private unit, кв. 909',address:'Step 2 private address, кв. 909',district:'Highvill',complex:'Highvill',rooms:'2-комн.',maxGuests:4,areaM2:74,basePriceKzt:32000,description:'Светлая тестовая квартира для серверного каталога',petsAllowed:true,petFeeKzt:5000,active:true,sortOrder:-100 } });
  dates = await freeDates(account.id,apartment.id,3,2100);
});
after(() => prisma.$disconnect());

async function operationKey() {
  const response = await api().post(`/api/public/${slug}/operation-key`);
  assert.equal(response.status,201); return response.body.operationKey;
}

test('production guest shell is server-served and has no demo/localStorage/payment shortcut', async () => {
  const page = await api().get('/'); assert.equal(page.status,200); assert.match(page.text,/data-production-guest/);
  const js = await api().get('/guest-assets/guest.js'); assert.equal(js.status,200);
  assert.ok(!js.text.includes('localStorage')); assert.ok(!js.text.includes('Store.')); assert.ok(!js.text.includes('/pay'));
});

test('catalogue and server quote expose only public references and server price', async () => {
  const list = await api().get(`/api/public/${slug}/apartments`).query({ ...dates, guests:2, pets:1 });
  assert.equal(list.status,200); publicApartment=list.body.find(item=>item.description==='Светлая тестовая квартира для серверного каталога');
  assert.ok(publicApartment?.ref); assert.ok(!('id' in publicApartment)); assert.ok(!JSON.stringify(publicApartment).includes(apartment.id)); assert.ok(!JSON.stringify(publicApartment).includes('909'));
  assert.deepEqual(publicApartment.quote,{nights:3,nightlyKzt:32000,petFeeKzt:5000,totalKzt:101000}); assert.equal(publicApartment.available,true);
  const quote = await api().get(`/api/public/${slug}/apartments/${publicApartment.ref}/quote`).query({ ...dates, guests:2, pets:1 });
  assert.equal(quote.status,200); assert.deepEqual(quote.body,{ref:publicApartment.ref,...dates,guests:2,pets:true,available:true,nights:3,nightlyKzt:32000,petFeeKzt:5000,totalKzt:101000});
});

test('checkout ignores browser price, snapshots server amount and retries as one Booking', async () => {
  const key=await operationKey(); const body={apartmentId:publicApartment.ref,...dates,guests:2,pets:true,name:'Гость Step 2',phone:'+7 700 222 22 22',paymentMethod:'card',totalKzt:1,nightlyKzt:1};
  const first=await api().post(`/api/public/${slug}/bookings`).set('Idempotency-Key',key).send(body);
  const retry=await api().post(`/api/public/${slug}/bookings`).set('Idempotency-Key',key).send(body);
  assert.equal(first.status,201);assert.equal(retry.status,201);assert.equal(retry.body.number,first.body.number);assert.equal(retry.body.token,first.body.token);
  assert.equal(first.body.status,'request');assert.equal(first.body.paymentStatus,'unpaid');assert.equal(first.body.totalKzt,101000);assert.ok(first.body.holdUntil);
  firstBooking=await prisma.booking.findFirst({where:{accountId:account.id,number:first.body.number}});
  assert.equal(firstBooking.totalKzt,101000);assert.equal(firstBooking.nightlyKzt,32000);assert.equal(await prisma.booking.count({where:{accountId:account.id,number:first.body.number}}),1);
});

test('active hold is authoritative for catalogue, availability, quote and checkout conflict', async () => {
  const list=await api().get(`/api/public/${slug}/apartments`).query({...dates,guests:2});const item=list.body.find(a=>a.ref===publicApartment.ref);assert.equal(item.available,false);
  const availability=await api().get(`/api/public/${slug}/apartments/${publicApartment.ref}/availability`).query({from:dates.checkIn,to:dates.checkOut});
  assert.equal(availability.status,200);assert.equal(availability.body.ref,publicApartment.ref);assert.ok(!('apartmentId' in availability.body));assert.ok(availability.body.busy.length>0);
  const quote=await api().get(`/api/public/${slug}/apartments/${publicApartment.ref}/quote`).query({...dates,guests:2});assert.equal(quote.body.available,false);
  const blocked=await api().post(`/api/public/${slug}/bookings`).set('Idempotency-Key',await operationKey()).send({apartmentId:publicApartment.ref,...dates,guests:2,name:'Второй гость',phone:'+7 700 333 33 33'});
  assert.equal(blocked.status,409);assert.equal(await prisma.booking.count({where:{apartmentId:apartment.id,checkIn:firstBooking.checkIn,checkOut:firstBooking.checkOut}}),1);
});
