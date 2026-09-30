// Настройки подключения сайта к серверу (папка server/).
// Пока API_BASE_URL пустой, сайт работает как демо: данные генерируются в браузере и хранятся в localStorage.
// Когда сервер будет развернут, сюда впишут его адрес, например 'https://api.theaddress.kz',
// а ACCOUNT_SLUG укажет, чей аккаунт показывать (slug из таблицы Account).
// Сейчас скрипты сайта этот флаг ещё не читают — переключение на API будет отдельным шагом.
window.APP_CONFIG = Object.assign({
  API_BASE_URL: '',
  ACCOUNT_SLUG: 'astana-stay',
}, window.APP_CONFIG || {});
