/* Язык сайта для гостей: RU (по умолчанию) / EN.
   Выбор хранится в localStorage; при первом визите — по языку браузера (ru/kk → RU, иначе EN).
   ?lang=en или ?lang=ru в адресе — принудительно. Словарь EN — assets/i18n-en.js.
   Панели команды и владельца остаются на русском. */
(function(){
  const LS = 'astanastay.lang';
  let q = null; try { q = new URLSearchParams(location.search).get('lang'); } catch(e){}
  let lang = null;
  try { if(q==='en'||q==='ru') localStorage.setItem(LS, q); lang = localStorage.getItem(LS); } catch(e){}
  if(q==='en'||q==='ru') lang = q;
  if(lang!=='en' && lang!=='ru'){
    const n = String((navigator.languages && navigator.languages[0]) || navigator.language || 'ru').toLowerCase();
    lang = /^(ru|kk)\b/.test(n) ? 'ru' : 'en';
  }
  const I18N = window.I18N = {
    lang, en: {}, missing: new Set(),
    set(l){
      try { localStorage.setItem(LS, l); } catch(e){}
      const u = new URL(location.href); u.searchParams.delete('lang');
      if(u.href !== location.href) location.replace(u.href); else location.reload();
    },
    // перевод строки; пробелы по краям сохраняются, неизвестные строки остаются как есть
    t(s){
      if(lang!=='en' || s==null) return s;
      s = String(s);
      let r = I18N.en[s];
      if(r===undefined){
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
        if(m[2] && I18N.en[m[2]]!==undefined) r = m[1] + I18N.en[m[2]] + m[3];
        else { if(/[А-Яа-яЁё]/.test(s)) I18N.missing.add(s); return s; }
      }
      return r;
    },
    // статичный текст index.html: текстовые узлы, placeholder/aria-label/title/alt и заголовок вкладки
    applyStatic(root){
      document.documentElement.lang = lang;
      if(lang!=='en') return;
      root = root || document.body;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode: n => /SCRIPT|STYLE/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
      const nodes = []; while(w.nextNode()) nodes.push(w.currentNode);
      nodes.forEach(n => { if(/[А-Яа-яЁё]/.test(n.nodeValue)) n.nodeValue = I18N.t(n.nodeValue); });
      root.querySelectorAll('[placeholder],[aria-label],[title],[alt]').forEach(el => ['placeholder','aria-label','title','alt'].forEach(a => { const v = el.getAttribute(a); if(v && /[А-Яа-яЁё]/.test(v)) el.setAttribute(a, I18N.t(v)); }));
      document.title = I18N.t(document.title);
    }
  };
  window.tx = s => I18N.t(s);
})();
