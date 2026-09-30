// Тексты сайта для гостей по умолчанию. Владелец может изменить любой из них в админке
// («Тексты сайта»); если поле очистить — вернётся текст отсюда.
// group — раздел в админке, hint — подсказка, где этот текст на сайте.
export const SITE_TEXT_KEYS = [
  { key: 'nav.apartments', group: 'Меню', hint: 'Пункт меню в шапке', ru: 'Квартиры', en: 'Apartments' },
  { key: 'nav.map', group: 'Меню', hint: 'Пункт меню в шапке', ru: 'Карта', en: 'Map' },
  { key: 'nav.transfer', group: 'Меню', hint: 'Пункт меню в шапке', ru: 'Трансфер', en: 'Transfer' },
  { key: 'nav.how', group: 'Меню', hint: 'Пункт меню в шапке', ru: 'Как забронировать', en: 'How to book' },
  { key: 'nav.contacts', group: 'Меню', hint: 'Пункт меню в шапке', ru: 'Контакты', en: 'Contacts' },
  { key: 'btn.book', group: 'Кнопки', hint: 'Главная кнопка в шапке и в карточке квартиры', ru: 'Забронировать', en: 'Book' },
  { key: 'btn.search', group: 'Кнопки', hint: 'Кнопка поиска квартир', ru: 'Найти', en: 'Search' },
  { key: 'btn.pay', group: 'Кнопки', hint: 'Кнопка оплаты картой в форме брони', ru: 'Перейти к оплате', en: 'Proceed to payment' },
  { key: 'btn.transfer', group: 'Кнопки', hint: 'Кнопка заказа трансфера', ru: 'Заказать трансфер', en: 'Book a transfer' },
  { key: 'btn.telegram', group: 'Кнопки', hint: 'Кнопка связи в Telegram', ru: 'Написать в Telegram', en: 'Message on Telegram' },
  { key: 'hero.title', group: 'Главный экран', hint: 'Большой заголовок вверху', ru: 'Апартаменты в самой высокой башне ЖК Хайвил', en: 'Apartments in the tallest tower of Highvill' },
  { key: 'hero.subtitle', group: 'Главный экран', hint: 'Текст под заголовком', ru: 'Самая высокая башня ЖК Highvill — большого нового жилого квартала. Стоит отдельно и ближе всех к посольству США. Заселение 24/7 через кодовый замок, можно с питомцами, трансфер из аэропорта с табличкой.', en: 'The tallest tower of Highvill, a large new-build neighbourhood. It stands on its own and is the closest to the US Embassy. 24/7 self check-in with a door code, pets welcome, airport pickup with a name sign.' },
  { key: 'catalog.title', group: 'Разделы', hint: 'Заголовок списка квартир', ru: 'Наши квартиры', en: 'Our apartments' },
  { key: 'map.title', group: 'Разделы', hint: 'Заголовок карты', ru: 'Квартиры на карте', en: 'Apartments on the map' },
  { key: 'map.subtitle', group: 'Разделы', hint: 'Подсказка под заголовком карты', ru: 'Нажмите на район, чтобы показать квартиры в нём', en: 'Tap a district to show its apartments' },
  { key: 'transfer.title', group: 'Разделы', hint: 'Заголовок раздела трансфера', ru: 'Трансфер из аэропорта и вокзала', en: 'Airport & train station transfer' },
  { key: 'transfer.subtitle', group: 'Разделы', hint: 'Текст под заголовком трансфера', ru: 'Встретим с табличкой с вашим именем и довезём до квартиры — или отвезём на рейс', en: "We'll meet you with a name sign and drive you to the apartment — or take you to your flight" },
  { key: 'how.title', group: 'Разделы', hint: 'Заголовок «Как забронировать»', ru: 'Как забронировать', en: 'How to book' },
  { key: 'how.subtitle', group: 'Разделы', hint: 'Подзаголовок «Как забронировать»', ru: 'Без регистрации и комиссий площадок', en: 'No sign-up, no platform fees' },
  { key: 'reviews.title', group: 'Разделы', hint: 'Заголовок отзывов', ru: 'Отзывы гостей', en: 'Guest reviews' },
  { key: 'footer.about', group: 'Подвал', hint: 'Строка в подвале сайта', ru: 'Самая высокая башня ЖК Хайвил — ближайшая к посольству США. Работаем 24/7.', en: 'The tallest tower of Highvill — the closest to the US Embassy. Open 24/7.' },
];
export const SITE_LANGS = ['ru', 'en'];
export const defaultTexts = (lang) => Object.fromEntries(SITE_TEXT_KEYS.map(k => [k.key, k[lang] ?? k.ru]));
export const DEFAULT_BRAND = {
  name: 'The Address', short: 'TA', taglineRu: 'Apart Hotel', taglineEn: 'Apart Hotel',
  colors: { brand: '#17191d', brand2: '#2c3038', accent: '#c9824f', accent2: '#b06a39' },
  // контакты — заглушки для демо (настоящие владелец вносит в админке)
  phone: '+7 700 000 00 00', telegram: 'theaddress_demo', whatsapp: '77000000000', email: 'hello@theaddress.example',
};
