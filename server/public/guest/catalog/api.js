import { AMENITY_GROUPS } from '/shared/apartment-features.js';
window.AMENITY_GROUPS=AMENITY_GROUPS;
const incoming=new URLSearchParams(location.search);
if(incoming.get('payment')==='processing'){location.replace('/guest-assets/checkout.html'+location.search+'#checkout');}
else try{
const root='/api/public/astana-stay';
const api=async path=>{const r=await fetch(root+path);const d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось загрузить данные');return d;};
const [site,items]=await Promise.all([api('/site'),api('/apartments?lang='+(I18N.lang==='en'?'en':'ru'))]);
Object.assign(I18N.en,{'Повторить проверку':'Retry availability check','Не удалось проверить доступность. Повторите проверку.':'Availability could not be checked. Please try again.','Фото':'Photo','Отзывы пока не представлены':'Reviews are not available yet','Удобства уточняются':'Amenities are not specified yet','Описание уточняется':'Description is not available yet','Проверяем цену и доступность…':'Checking price and availability…','Оплата картой':'Card payment','На эти даты свободных квартир нет, попробуйте другие даты':'No apartments are available for these dates. Try other dates.'});
window.SERVER_HOME={api,fx:{rates:site.currency.rates,show:Object.fromEntries(['KZT','RUB','USD','EUR'].map(c=>[c,site.currency.shown.includes(c)])),round:{mode:'nearest',step:site.currency.roundStep},over:{}},apartments:items.map((a,i)=>({...a,id:i+1,price:a.basePriceKzt,complex:a.title.split(' · ').slice(1).join(' · '),address:'',embassy:/хайвил|highvill/i.test(a.title),pets:{...a.pets,fee:a.pets.feeKzt,count:1,weight:''}}))};
for(const file of ['helpers','catalog'])await new Promise((ok,fail)=>{const s=document.createElement('script');s.src='/guest-assets/catalog/'+file+'.js?v=date-quote-20261012';s.onload=ok;s.onerror=fail;document.body.appendChild(s);});
}catch(e){document.getElementById('resInfo').textContent=e.message;}
