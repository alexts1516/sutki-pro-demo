/* ============================================================
   БРЕНД САЙТА ДЛЯ ГОСТЕЙ — всё в одном месте.
   Чтобы поменять название, логотип, цвета и контакты — правьте только этот файл.
   (Название продукта для команды «Сутки·Pro» — в team.html, login.html, app.html, cleaning.html.)
   ============================================================ */
window.BRAND = {
  name: 'Astana Stay',                                   // название в шапке, подвале, чате, заголовке вкладки
  short: 'AS',                                            // инициалы — аватар в демо-чате и значок вкладки
  tagline: { ru: 'квартиры посуточно', en: 'short-term apartments' },
  // Логотип: вставьте свой SVG (строка) — или путь к картинке в logoImg, например 'assets/logo.svg'.
  // Сейчас — временная заглушка (домик).
  logoSVG: (s=20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>`,
  logoImg: '',                                            // если задан — используется вместо logoSVG
  colors: {                                               // CSS-переменные сайта
    brand:   '#0b3b4a',   // основной (шапка, кнопки)
    brand2:  '#0f5566',   // основной, светлее
    accent:  '#e0a526',   // акцент (золотые кнопки, звёзды)
    accent2: '#c98a0c'    // акцент, темнее
  },
  contacts: {                                             // демо-контакты
    phone: '+7 700 000 00 00',
    telegram: 'astanastay_demo',
    whatsapp: '77000000000',
    email: 'hello@astanastay.example'
  },
  apply(){
    const B = this, r = document.documentElement.style;
    Object.entries(B.colors).forEach(([k,v])=>r.setProperty('--'+k, v));
    const lang = (window.I18N && I18N.lang) || 'ru';
    const logo = B.logoImg ? `<img src="${B.logoImg}" alt="" style="width:100%;height:100%;object-fit:contain">` : B.logoSVG(20);
    document.querySelectorAll('[data-brand]').forEach(el=>{
      const k = el.dataset.brand;
      if(k==='name') el.textContent = B.name;
      else if(k==='tagline') el.textContent = B.tagline[lang] || B.tagline.ru;
      else if(k==='logo') el.innerHTML = logo;
      else if(k==='phone') el.textContent = B.contacts.phone;
      else if(k==='telegram') el.textContent = '@' + B.contacts.telegram;
      else if(k==='email') el.textContent = B.contacts.email;
    });
    document.title = document.title.replace(/Astana Stay/g, B.name);
    const fav = document.querySelector('link[rel="icon"]');
    if(fav) fav.href = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${B.colors.brand}"/><text x="16" y="22.5" font-size="18" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="700">${B.name[0]}</text></svg>`);
    const tc = document.querySelector('meta[name="theme-color"]'); if(tc) tc.content = B.colors.brand;
  }
};
