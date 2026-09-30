/* ============================================================
   БРЕНД САЙТА ДЛЯ ГОСТЕЙ — всё в одном месте.
   Чтобы поменять название, логотип, цвета и контакты — правьте только этот файл.
   (Название продукта для команды «Сутки·Pro» — в team.html, login.html, app.html, cleaning.html.)
   ============================================================ */
window.BRAND = {
  name: 'The Address',                                    // название в шапке, подвале, чате, заголовке вкладки
  fullName: 'The Address · Apart Hotel',                  // полное название (заголовок вкладки, подвал)
  short: 'TA',                                            // инициалы — аватар в демо-чате
  tagline: { ru: 'Apart Hotel', en: 'Apart Hotel' },
  // Логотип клиента: метка-«пин» с силуэтом башни (из присланного логотипа), серебро для тёмного фона.
  // Полный логотип с надписью: assets/brand/logo-lockup-silver-480.png (для тёмного фона) и logo-lockup-dark-480.png (для светлого).
  logoSVG: (s=20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>`,
  logoImg: 'assets/brand/pin-silver-128.png',             // если задан — используется вместо logoSVG
  logoImgDark: 'assets/brand/pin-dark-128.png',           // тёмная версия метки для светлого фона
  lockupImg: 'assets/brand/logo-lockup-silver-480.png',   // полный логотип «THE ADDRESS · APART HOTEL» (подвал)
  favicon: 'assets/brand/favicon-32.png',
  heroImg: 'assets/photos/highvill-g1-1200.jpg',                  // фото дома на главном экране (ЖК Хайвил, блок G-1)
  heroImgMobile: 'assets/photos/highvill-g1-800.jpg',
  address: { ru: 'пр. Кошкарбаева, 10/1, блок G-1 · Астана, р-н Сарайшык', en: '10/1 Rakhymzhan Koshkarbayev Ave, block G-1 · Astana' },
  colors: {                                               // CSS-переменные сайта: графит, серебро и тёплый «кирпич» с фасада
    brand:   '#17191d',   // основной (шапка, кнопки) — графит
    brand2:  '#2c3038',   // основной, светлее
    accent:  '#c9824f',   // акцент — тёплый кирпичный (кнопки, звёзды)
    accent2: '#b06a39',   // акцент, темнее
    silver:  '#c9ccd1'    // серебро (как в логотипе)
  },
  fontDisplay: '"Cormorant Garamond","Playfair Display",Didot,"Bodoni 72","Bodoni MT","Libre Baskerville",Georgia,"Times New Roman",serif',
  contacts: {                                             // демо-контакты (заглушки, настоящие не публикуем)
    phone: '+7 700 000 00 00',
    telegram: 'theaddress_demo',
    whatsapp: '77000000000',
    email: 'hello@theaddress.example'
  },
  apply(){
    const B = this, r = document.documentElement.style;
    Object.entries(B.colors).forEach(([k,v])=>r.setProperty('--'+k, v));
    if(B.fontDisplay) r.setProperty('--font-display', B.fontDisplay);
    const abs = u => new URL(u, document.baseURI).href;
    if(B.heroImg) r.setProperty('--hero-img', `url("${abs(B.heroImg)}")`);
    if(B.heroImgMobile || B.heroImg) r.setProperty('--hero-img-m', `url("${abs(B.heroImgMobile || B.heroImg)}")`);
    const lang = (window.I18N && I18N.lang) || 'ru';
    const logo = B.logoImg ? `<img src="${B.logoImg}" alt="" class="logo-img" style="width:100%;height:100%;object-fit:contain">` : B.logoSVG(20);
    document.querySelectorAll('[data-brand]').forEach(el=>{
      const k = el.dataset.brand;
      if(k==='name') el.textContent = B.name;
      else if(k==='tagline') el.textContent = B.tagline[lang] || B.tagline.ru;
      else if(k==='logo') el.innerHTML = logo;
      else if(k==='phone') el.textContent = B.contacts.phone;
      else if(k==='telegram') el.textContent = '@' + B.contacts.telegram;
      else if(k==='email') el.textContent = B.contacts.email;
      else if(k==='address') el.textContent = (B.address && (B.address[lang] || B.address.ru)) || '';
      else if(k==='fullName') el.textContent = B.fullName || B.name;
      else if(k==='lockup' && B.lockupImg) el.innerHTML = `<img src="${B.lockupImg}" alt="${B.fullName || B.name}" style="display:block;width:100%;height:auto">`;
    });
    const fav = document.querySelector('link[rel="icon"]');
    if(fav && B.favicon) { fav.href = B.favicon; fav.type = 'image/png'; }
    else if(fav) fav.href = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${B.colors.brand}"/><text x="16" y="22.5" font-size="18" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="700">${B.name[0]}</text></svg>`);
    const tc = document.querySelector('meta[name="theme-color"]'); if(tc) tc.content = B.colors.brand;
  }
};
