// Test-only booking confirmation delivery. Credentials stay in local environment.
import crypto from 'node:crypto';
import { paidBookingUrl } from '../lib/publicDtos.js';
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createResendBookingDelivery({prisma,config,fetchImpl=fetch}){
  const settings=config.resend;
  if(!settings?.enabled)return null;
  if(!settings.apiKey||!settings.from||!settings.testTo)throw new Error('Resend test settings are incomplete');
  return async data=>{
    const b=await prisma.booking.findFirst({where:{id:data.bookingId,accountId:data.accountId,source:'site',status:'confirmed',paymentStatus:'paid'},include:{guest:true,apartment:true}});
    if(!b || b.guest?.email?.trim().toLowerCase()!==settings.testTo)return {status:'skipped'};
    const payment=await prisma.payment.findFirst({where:{bookingId:b.id,accountId:b.accountId,transferId:null,status:'succeeded'},select:{id:true}});
    const url=payment?paidBookingUrl(config,b):null;
    if(!url || url!==data.bookingUrl)return {status:'skipped'};
    // One permitted test email across all bookings in this database. Never redirect another guest's mail.
    const key='resend:single-test:'+crypto.createHash('sha256').update(settings.testTo).digest('hex');
    let record;
    try{record=await prisma.notificationLog.create({data:{accountId:b.accountId,event:'booking.confirmed',channel:'email',recipientType:'guest',recipientId:b.guest.id,lang:b.guest.locale||'ru',text:`Email confirmation for booking #${b.number}`,status:'sending',dedupeKey:key}});}
    catch(error){if(error.code==='P2002')return {status:'already_attempted'};throw error;}
    const ci=b.checkIn.toISOString().slice(0,10),co=b.checkOut.toISOString().slice(0,10),amount=new Intl.NumberFormat('ru-RU').format(b.totalKzt)+' ₸';
    const subject=`SUTKI PRO — бронирование №${b.number} подтверждено`;
    const text=`Тестовое подтверждение бронирования SUTKI PRO. Реального списания не было.\nБронь №${b.number}\nКвартира: ${b.apartment.title}\nЗаезд: ${ci}\nВыезд: ${co}\nСумма: ${amount}\nВаш заказ: ${url}\nСсылка личная — не передавайте её другим.`;
    const html=`<h1>Бронирование №${b.number} подтверждено</h1><p>Тест SUTKI PRO. Реального списания не было.</p><p>Квартира: ${escapeHtml(b.apartment.title)}<br>Заезд: ${ci}<br>Выезд: ${co}<br>Сумма: ${escapeHtml(amount)}</p><p><a href="${escapeHtml(url)}">Открыть ваш заказ</a></p><p>Ссылка личная — не передавайте её другим.</p>`;
    try{
      const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+settings.apiKey,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:settings.from,to:[settings.testTo],subject,text,html}),signal:AbortSignal.timeout(15000)});
      if(!response.ok){await prisma.notificationLog.update({where:{id:record.id},data:{status:'failed',error:'Resend HTTP '+response.status}});return {status:'failed',httpStatus:response.status};}
      const result=await response.json();if(!result.id)throw new Error('No provider receipt');
      await prisma.notificationLog.update({where:{id:record.id},data:{status:'sent',error:null}});
      return {status:'sent',providerId:result.id};
    }catch{
      await prisma.notificationLog.update({where:{id:record.id},data:{status:'failed',error:'Resend result uncertain; no automatic retry'}});
      throw new Error('Resend delivery result uncertain');
    }
  };
}
