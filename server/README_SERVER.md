# Сутки·Pro — сервер (backend)

Сервер для сайта **The Address · Apart Hotel** (ЖК Хайвил, Астана) и приложения команды:
база данных, вход по ролям, админка для квартир и фото, тексты сайта, бренд и логотип,
уведомления в Telegram и заготовка онлайн-оплаты.

Сейчас это **основа (MVP)**. Демо-сайт на GitHub Pages пока работает сам по себе (данные в браузере)
и к серверу не подключён — переключение описано в разделе «Подключение сайта».

- Node.js 20+, Express 5, Prisma 6 (SQLite для разработки, PostgreSQL для продакшена)
- Telegram-бот на grammY — **выключен, пока нет токена** (уведомления печатаются в консоль и пишутся в журнал)
- Оплата: CloudPayments и PayLink — **заготовка, по умолчанию выключена**, реальных запросов к платёжкам нет
- Мультиаккаунты: у каждого клиента (апарт-отеля) свои квартиры, брони, команда, тексты и логотип

![Админка: фото квартиры](docs/screenshots/02-apartment-photos.png)

---

## Быстрый старт

```bash
cd server
npm install
npm run setup     # создаст .env (со случайным JWT_SECRET), базу SQLite и демо-данные
npm run dev       # http://localhost:3000/admin/
```

Проверка: `http://localhost:3000/api/health` → `{"ok":true,...}`.

### Демо-входы (пароль у всех `demo12345`)

| Кто | Логин | Роль |
|---|---|---|
| Азамат Нургалиев | `azamat@astanastay.example` | владелец |
| Алина Бекова | `alina@astanastay.example` | администратор |
| Гульнара / Айгерим / Динара / Светлана | `gulnara@…`, `aigerim@…`, `dinara@…`, `svetlana@…` | клининг |
| Марат / Ерлан | `marat@…`, `erlan@…` | мастер (команда) |
| Master Electric | `electric@astanastay.example` | мастер — внешний подрядчик-электрик (демо: по заявке в каждом статусе) |
| Второй аккаунт (для проверки изоляции) | `owner@demo-b.example` | владелец другого клиента |

Пароль демо-пользователей можно задать при заполнении: `SEED_PASSWORD=... npm run db:seed`.
`npm run db:seed` пересоздаёт только демо-аккаунты, остальные данные не трогает.

### Команды

| Команда | Что делает |
|---|---|
| `npm run setup` | первый запуск: .env + база + демо-данные |
| `npm run dev` | сервер с автоперезапуском при правке кода |
| `npm start` | сервер для продакшена |
| `npm run db:seed` | заново залить демо-данные |
| `npm run db:migrate` | создать миграцию после правки `prisma/schema.prisma` (разработка) |
| `npm run db:deploy` | применить миграции (продакшен) |
| `npm run db:studio` | посмотреть базу в браузере (Prisma Studio) |
| `npm test` | тесты (отдельная тестовая база, реальную не трогают) |

---

## Настройки (.env)

Шаблон — `.env.example`. Файл `.env` в git не попадает.

| Переменная | Обязательно | Описание |
|---|---|---|
| `PORT` | нет | порт, по умолчанию 3000 |
| `PUBLIC_URL` | на хостинге — да | внешний адрес сервера (для ссылок, вебхуков оплаты и Telegram) |
| `DATABASE_URL` | да | `file:./dev.db` (SQLite) или `postgresql://…` |
| `JWT_SECRET` | да | секрет для подписи входа, 32+ символа (`setup` генерирует сам) |
| `DEFAULT_ACCOUNT_SLUG` | нет | чей сайт отдавать по умолчанию (`astana-stay`) |
| `CORS_ORIGINS` | для сайта — да | с каких сайтов можно ходить в API, через запятую |
| `STORAGE_DRIVER` | нет | `local` (папка `uploads/`) или `s3` (заготовка) |
| `UPLOAD_DIR` | нет | папка для фото, по умолчанию `./uploads` |
| `MAX_UPLOAD_MB` | нет | максимальный размер одного фото, по умолчанию 15 |
| `TELEGRAM_BOT_TOKEN` | нет | токен бота от @BotFather; пусто — бот выключен |
| `TELEGRAM_BOT_USERNAME` | нет | имя бота без @, для ссылок `t.me/<имя>?start=…` |
| `TELEGRAM_MODE` | нет | `polling` (проще) или `webhook` (для хостинга) |
| `PAYMENTS_PROVIDER` | нет | пусто — оплата выключена; `cloudpayments` или `paylink` |
| `CLOUDPAYMENTS_PUBLIC_ID`, `CLOUDPAYMENTS_API_SECRET` | для CloudPayments | из личного кабинета CloudPayments |
| `PAYLINK_SHOP_ID`, `PAYLINK_SECRET_KEY`, `PAYLINK_PUBLIC_KEY`, `PAYLINK_TEST_MODE` | для PayLink | из кабинета PayLink |

---

## Telegram-бот

Пока токена нет, всё работает: каждое уведомление печатается в консоль сервера
(`[уведомление для Азамат Нургалиев, owner → журнал] …`) и сохраняется в журнал — он виден в админке,
раздел «Уведомления».

### Как подключить

1. В Telegram откройте **@BotFather** → `/newbot` → придумайте имя и username (должен заканчиваться на `bot`,
   например `theaddress_astana_bot`).
2. BotFather пришлёт токен вида `123456789:AA…`. Впишите в `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456789:AA...
   TELEGRAM_BOT_USERNAME=theaddress_astana_bot
   TELEGRAM_MODE=polling
   ```
3. Перезапустите сервер — в консоли появится `[telegram] бот @… запущен (polling)`.
4. Необязательно: в BotFather `/setdescription`, `/setuserpic` (логотип), `/setcommands`:
   `start - подключить уведомления`, `stop - отключить`, `help - помощь`.

**polling или webhook.** `polling` — сервер сам спрашивает Telegram о новых сообщениях; подходит для компьютера
и любого хостинга, ничего настраивать не нужно. `webhook` — Telegram сам присылает сообщения на
`PUBLIC_URL/api/telegram/webhook` (нужен HTTPS). Сервер регистрирует webhook при старте сам и проверяет
секретный заголовок. Одновременно работает только один режим; при нескольких копиях сервера нужен `webhook`.

### Кто и как привязывается (deep links)

| Ссылка | Кто | Откуда берётся |
|---|---|---|
| `t.me/<бот>?start=i_<код>` | владелец, админ, клининг, мастер | админка → «Команда и Telegram» → «Подключить Telegram» (одноразовый код) |
| `t.me/<бот>?start=b_<токен брони>` | гость | ссылка в подтверждении брони |

После `/start` бот запоминает chat id и начинает присылать сообщения на языке пользователя (RU/EN).
`/stop` — отключить.

### Какие уведомления уходят

Новая заявка на бронь, бронь подтверждена, заезд сегодня/завтра (проверка каждые 30 минут, без повторов),
инструкция по заселению гостю, заявка на трансфер и назначение водителя, уборка отмечена, оплата прошла.
Заявки мастерам: новая заявка (исполнителю), мастер просит выезд, смета ждёт одобрения, доп. расход ждёт решения,
работа выполнена (владельцу и админу); смета одобрена/отклонена, доп. расход одобрен/отклонён, заявка отменена,
изменилось «кто будет в квартире» (исполнителю). Подрядчик без входа в приложение — уведомление только в журнал.

---

## Онлайн-оплата (заготовка)

По умолчанию `PAYMENTS_PROVIDER` пустой: гостю предлагаются оффлайн-способы (наличные при заселении, договориться в Telegram или WhatsApp),
сервер никуда не ходит. Код для обоих провайдеров написан по их публичной документации и покрыт тестами
на подпись, но **с реальными терминалами не проверялся** — перед запуском нужен тестовый платёж.

Для подключения нужен договор с провайдером (ИП/ТОО), после модерации выдают ключи.

### CloudPayments (cloudpayments.kz)

1. В `.env`: `PAYMENTS_PROVIDER=cloudpayments`, `CLOUDPAYMENTS_PUBLIC_ID`, `CLOUDPAYMENTS_API_SECRET`.
2. В личном кабинете → сайт → «Уведомления» включите и укажите адреса (формат — JSON или form, метод POST):

| Уведомление | Адрес |
|---|---|
| Check | `https://<ваш-сервер>/api/payments/cloudpayments/check` |
| Pay | `https://<ваш-сервер>/api/payments/cloudpayments/pay` |
| Fail | `https://<ваш-сервер>/api/payments/cloudpayments/fail` |

Подпись `Content-HMAC` проверяется API Secret'ом; сумма и валюта сверяются с платежом в базе.
Сайт открывает виджет CloudPayments с параметрами, которые отдаёт `POST /api/public/:slug/bookings/:token/pay`.

### PayLink (paylink.kz)

1. В `.env`: `PAYMENTS_PROVIDER=paylink`, `PAYLINK_SHOP_ID`, `PAYLINK_SECRET_KEY`, `PAYLINK_PUBLIC_KEY`,
   `PAYLINK_TEST_MODE=true` (пока тестируете).
2. Адрес уведомлений: `https://<ваш-сервер>/api/payments/paylink/notify` (сервер передаёт его сам при создании платежа).

Сервер создаёт платёж и перенаправляет гостя на страницу оплаты PayLink; уведомление проверяется
по подписи. После успешной оплаты бронь помечается оплаченной, владельцу уходит уведомление.

---

## Заявки мастерам и подрядчикам

Одни правила для всех исполнителей: сантехники, электрики, строители, маляры, мебельщики, внешние подрядчики.
Исполнитель — мастер из команды (`assigneeId`) или подрядчик (`contractorId`). Чтобы подрядчик входил в приложение
команды, у него есть пользователь с ролью «Мастер», привязанный к карточке подрядчика (`Contractor.userId`).
Без входа подрядчик работает по ссылке на одну задачу. Вся логика — в `src/services/workRequests.js`.

### Статусы

| Статус | По-русски | Что дальше |
|---|---|---|
| `NEW` | Новая | мастер выбирает: смета без выезда / по фото → `AWAITING_OWNER_APPROVAL`, или «нужен выезд» / «приехал» → `VISIT_INSPECTION` |
| `VISIT_INSPECTION` | Выезд / осмотр | приезд (время, заметка, фото) → осмотр → смета после осмотра → `AWAITING_OWNER_APPROVAL`; для quickJob — сразу `IN_PROGRESS` |
| `AWAITING_OWNER_APPROVAL` | Ожидает подтверждения хозяина | владелец/админ: одобрить → `APPROVED`, отклонить (с причиной) → `REJECTED` |
| `REJECTED` | Смета отклонена | мастер присылает новую смету → `AWAITING_OWNER_APPROVAL` или просит выезд → `VISIT_INSPECTION` |
| `APPROVED` | Смета одобрена | мастер начинает работу → `IN_PROGRESS` (если приезд не отмечен — отмечается автоматически) |
| `IN_PROGRESS` | В работе | доп. расходы; завершение (итоговая цена и отчёт обязательны, фото «после» — по желанию) → `DONE` |
| `DONE` | Выполнена | владелец решает оставшиеся доп. расходы и отмечает «оплачено мастеру» |
| `CANCELLED` | Отменена | из любого незавершённого статуса, только владелец/админ |

**Главное правило (проверяется на сервере):** перейти в `IN_PROGRESS` можно только из `APPROVED` с одобренной сметой.
Ни админка, ни приложение мастера, ни ссылка это не обходят — ответ `409 «Нельзя начать работу без одобренной хозяином сметы»`.

**Исключение — простая работа (`quickJob`)**, например заменить лампочку. Флаг ставит владелец/админ при создании.
Мастер всё равно отмечает приезд (без этого — 409), может начать сразу без сметы, а при завершении обязан указать итоговую цену.

### Смета

Три способа (`method`): `REMOTE` — без выезда, по описанию; `PHOTOS` — по фото проблемы, которые приложил владелец/админ
(без фото этот способ недоступен); `VISIT` — после осмотра на месте (только после отметки приезда).
Если по описанию/фото оценить нельзя — мастер нажимает «нужен выезд» (`request-visit`), это пишется в журнал и уходит владельцу.

Поля: `labourKzt` — работа; `materialsIncluded` + `materialsKzt` — материалы по желанию (если не входят — покупаются отдельно);
`maxKzt` — верхняя граница, если цена диапазоном; `items`, `comment`. Смета всегда помечена как предварительная (`preliminary`),
окончательная цена — при завершении.

### Доп. расходы

Во время работ (`IN_PROGRESS`) мастер может добавить расход, возникший не по его вине: сумма, что именно, почему, чек/фото.
Статусы `PENDING → APPROVED | REJECTED`, решает владелец или админ (при отказе — причина обязательна), стороны получают уведомления.
Одобренные расходы прибавляются к сумме к оплате и в «Финансы». **Нерешённые расходы не мешают завершить работу,
но отметить «оплачено мастеру» нельзя, пока все не решены** (409).

### Сумма и финансы

`costKzt` = итоговая цена мастера (до завершения — одобренная смета) + одобренные доп. расходы. Это поле уже учитывается
в отчёте «Финансы» так же, как раньше ремонты. У отменённой заявки сумма обнуляется.

### Кто будет в квартире и «Как попасть»

Поле заявки `occupancy`: `OWNER_PRESENT` (владелец будет), `EMPTY` (квартира пустая), `UNKNOWN` (пока неизвестно, по умолчанию).
Задаётся при создании и меняется потом: админ — в любое время, владелец — при создании и позже в своём кабинете
(`PATCH /api/admin/repairs/:id/occupancy`). Поле одно на заявку, побеждает последнее изменение; хранится, кто и когда изменил
(`occupancyUpdatedById`, `occupancyUpdatedAt`), каждое изменение пишется в журнал и отправляется исполнителю.
При `EMPTY` заполняется свободный текст `accessInstructions` («Как попасть»). При других статусах он скрыт в интерфейсе, но не стирается.

### Что видит мастер

Только по **своим** заявкам и только пока заявка активна (не «Выполнена» и не «Отменена»):
адрес и номер квартиры (`Apartment.address`, `Apartment.code`), статус «кто будет в квартире», кто и когда его изменил,
а «Как попасть» — только при `EMPTY`. Коды замка, ключница, домофон, Wi‑Fi мастеру **не отдаются** (эти поля квартиры
остаются для гостей и клининга). Мастер не видит денег владельца (`costKzt`, `paid`) и не может менять «кто будет в квартире».
Чужие заявки — 403, другой аккаунт — 404.

### Журнал шагов

Каждый шаг — запись `RepairEvent` (кто, роль, когда, заметка, данные): `created`, `occupancy_changed`, `visit_requested`,
`arrived`, `inspected`, `estimate_submitted`, `approved`, `rejected`, `started`, `extra_submitted`, `extra_approved`,
`extra_rejected`, `completed`, `cancelled`, `paid`.

### Адреса API

| Метод и адрес | Кто |
|---|---|
| `GET /api/admin/repairs?status=&apartmentId=` | владелец, админ |
| `POST /api/admin/repairs` — `{ apartmentId, title, description, type, priority, assigneeId \| contractorId, date, quickJob, occupancy, accessInstructions }` | владелец, админ |
| `GET /api/admin/repairs/:id` — карточка: сметы, доп. расходы, фото, журнал, суммы, ссылка | владелец, админ |
| `PATCH /api/admin/repairs/:id/occupancy` — `{ occupancy, accessInstructions }` | владелец, админ |
| `POST /api/admin/repairs/:id/photos` — фото проблемы (multipart `photos[]`, `captions[]`) | владелец, админ |
| `POST /api/admin/estimates/:id/approve` · `/reject` `{ reason }` | владелец, админ |
| `POST /api/admin/extras/:id/approve` · `/reject` `{ note }` | владелец, админ |
| `POST /api/admin/repairs/:id/cancel` `{ reason }` · `/paid` · `/link` (новая ссылка) | владелец, админ |
| `GET/POST /api/admin/contractors`, `PATCH /api/admin/contractors/:id` (`userId` — вход подрядчика) | владелец, админ |
| `GET /api/staff/tasks` — мои активные заявки (без денег владельца) | мастер / подрядчик |
| `GET /api/staff/repairs/:id` — карточка заявки | исполнитель (владелец/админ — только чтение) |
| `POST /api/staff/repairs/:id/request-visit` `{ note }` | исполнитель |
| `POST /api/staff/repairs/:id/arrive` `{ note, photoIds }` | исполнитель |
| `POST /api/staff/repairs/:id/inspect` `{ notes, photoIds }` | исполнитель |
| `POST /api/staff/repairs/:id/estimate` `{ method, labourKzt, materialsIncluded, materialsKzt, maxKzt, items, comment }` | исполнитель |
| `POST /api/staff/repairs/:id/start` | исполнитель |
| `POST /api/staff/repairs/:id/extras` `{ amountKzt, description, reason, photoIds }` | исполнитель |
| `POST /api/staff/repairs/:id/complete` `{ finalCostKzt, report, photoIds }` | исполнитель |
| `POST /api/staff/repairs/:id/photos` — multipart `photos[]`, `kind` = arrival \| inspection \| after \| receipt | исполнитель |
| `GET /api/task-link/:token` и `POST /api/task-link/:token/<шаг>` — те же шаги по ссылке | у кого есть ссылка (пока заявка активна, потом 410) |

Ответы на шаги мастера возвращают обновлённую карточку и список `actions` — какие кнопки сейчас показать.

---

## Фото и хранилище

По умолчанию фото сохраняются в папку `server/uploads/` и отдаются по адресу `/uploads/...`.
Форматы JPG, PNG, WebP, до `MAX_UPLOAD_MB`. В админке: загрузка сразу нескольких, перетаскивание
для порядка, ★ — обложка, подписи RU/EN.

На хостинге без постоянного диска файлы пропадут при перезапуске — нужен **постоянный диск** или **S3**
(Amazon S3, Cloudflare R2, Yandex Object Storage и т.п.). S3 пока заготовка: шаги в `src/storage/s3.js`
(`npm install @aws-sdk/client-s3`, переменные `S3_*`, раскомментировать код).

---

## Переход на PostgreSQL

1. В `prisma/schema.prisma`: `provider = "postgresql"` в блоке `datasource db`.
2. В `.env`: `DATABASE_URL="postgresql://user:password@host:5432/theaddress?schema=public"`.
3. Миграции SQLite и PostgreSQL несовместимы: удалите папку `prisma/migrations` и создайте заново
   `npx prisma migrate dev --name init` (на пустой базе), затем `npm run db:seed` при желании.
4. На сервере дальше только `npm run db:deploy`.

---

## Развёртывание

Общее для любого хостинга:

- Node 20+, команда сборки `npm ci && npx prisma generate && npx prisma migrate deploy`, запуск `npm start`;
- переменные: `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_URL=https://api.ваш-домен`,
  `CORS_ORIGINS=https://ваш-сайт` (и `https://alexts1516.github.io`, пока сайт на Pages);
- фото — постоянный диск, смонтированный в `UPLOAD_DIR`, или S3;
- HTTPS обязателен для webhook Telegram и платёжных уведомлений.

**Render.** New → Web Service из репозитория, Root Directory `server`. Build: `npm ci && npx prisma migrate deploy`,
Start: `npm start`. База — Render PostgreSQL (см. «Переход на PostgreSQL») или SQLite на Disk
(`DATABASE_URL=file:/data/app.db`, `UPLOAD_DIR=/data/uploads`). На бесплатном тарифе сервис засыпает —
для бота используйте `TELEGRAM_MODE=webhook`.

**Railway.** New Project → из GitHub, Root Directory `server`, добавьте плагин PostgreSQL
(`DATABASE_URL` подставится сам) и Volume для `/data/uploads`. Команды те же.

**VPS (Ubuntu).** Node 20 через nodesource, `git clone`, `cd server && npm ci && npm run db:deploy`,
процесс через `pm2 start src/index.js --name theaddress` (или systemd), nginx как прокси с HTTPS
(certbot) на порт 3000. Бэкап — копия файла SQLite/`pg_dump` и папки `uploads/`.

---

## Подключение сайта (следующий шаг)

В `assets/config.js` сайта есть флаг:

```js
window.APP_CONFIG = { API_BASE_URL: '', ACCOUNT_SLUG: 'astana-stay' };
```

Пока `API_BASE_URL` пустой, сайт работает как демо (данные в браузере). Скрипты сайта этот флаг ещё
не читают — переключение каталога, календаря и заявок на API будет отдельной задачей.
Нужные адреса API уже есть (см. ниже).

---

## API (кратко)

Все ответы — JSON. Вход — cookie `sp_token` (httpOnly) или заголовок `Authorization: Bearer <токен>`.
Данные всегда ограничены аккаунтом пользователя; права проверяются по роли.

**Вход** `/api/auth`: `POST /login`, `POST /logout`, `GET /me`, `GET /session` (без ошибки, если не вошли),
`POST /switch-account`.

**Сайт гостей** `/api/public/:slug` (без входа): `GET /site` (тексты, бренд, логотип), `GET /apartments`,
`GET /apartments/:id`, `GET /apartments/:id/availability`, `POST /bookings` (заявка), `GET /bookings/:token`,
`POST /bookings/:token/pay`, `POST /transfers`.

**Админка** `/api/admin` (владелец/админ): квартиры `apartments` (CRUD), фото
(`POST /apartments/:id/photos`, `PUT /apartments/:id/photos/order`, `PATCH|DELETE /photos/:id`,
`POST /photos/:id/cover`), `site-texts`, `brand`, `brand/logo`, `team` (+ `telegram-invite`),
`bookings` (+ confirm/cancel), `day/:date`, `transfers`, `cleaning-tasks`, заявки мастерам `repairs` (см. раздел ниже),
`estimates/:id/approve|reject`, `extras/:id/approve|reject`, `contractors`, `notifications`, `finance`, `payments`, `currency`, `account`.

**Сотрудники** `/api/staff` (клининг/мастер): `GET /tasks`, уборки `cleaning/:id` (+ status),
заявки мастеру `repairs/:id` (+ request-visit, arrive, inspect, estimate, start, extras, complete, photos).

**Задача по ссылке** `/api/task-link/:token` (без входа): те же шаги мастера по одной заявке.

**Вебхуки**: `/api/payments/cloudpayments/{check,pay,fail}`, `/api/payments/paylink/notify`,
`/api/telegram/webhook`.

---

## Тесты

`npm test` — создаёт отдельную SQLite-базу `prisma/test.db`, прогоняет 48 проверок:
вход и изоляция аккаунтов, роли, загрузка/порядок/обложка/удаление фото, тексты сайта и логотип,
уведомления (без Telegram — в журнал, без повторов), привязка Telegram по ссылкам, подписи CloudPayments и PayLink,
заявки мастерам (`tests/work-requests.test.js`): смета без выезда с материалами, путь с выездом, смета по фото и «по фото → нужен выезд»,
запрет начала работ без одобрения, исключение quickJob, доп. расходы (одобрение/отказ, суммы, блокировка оплаты),
«кто будет в квартире» (владелец и админ правят, побеждает последнее изменение, мастер только читает, «Как попасть» — только при EMPTY),
изоляция исполнителей и аккаунтов, мастер видит только адрес и номер квартиры, ссылка на задачу.

## Структура

```
server/
  prisma/          schema.prisma, миграции, seed.js (демо-данные из прототипа)
  src/
    index.js       запуск: сервер, бот, планировщик напоминаний
    app.js         Express: маршруты, CORS, ошибки
    config.js      чтение .env
    auth/          пароли (bcrypt), токены входа, роли
    routes/        auth, public (сайт), admin/* (в т.ч. workRequests), staff, workActions (шаги мастера), taskLink, payments
    services/      брони, трансферы, заявки мастерам (workRequests.js — статусы и правила переходов)
    notifications/ события, шаблоны RU/EN, отправка, планировщик
    telegram/      бот (grammY), привязка по ссылкам
    payments/      CloudPayments, PayLink
    storage/       local (папка uploads), s3 (заготовка)
    site/          тексты и бренд по умолчанию
  public/admin/    админка (без сборки: HTML + JS + CSS)
  scripts/         setup.js, test-db.js
  tests/           node:test
  docs/screenshots/
```

## Скриншоты админки

| | |
|---|---|
| ![Вход](docs/screenshots/00-login.png) | ![Квартиры](docs/screenshots/01-apartments.png) |
| ![Фото](docs/screenshots/02-apartment-photos.png) | ![Карточка фото](docs/screenshots/03-photos-card.png) |
| ![Тексты сайта](docs/screenshots/04-site-texts.png) | ![Бренд и логотип](docs/screenshots/05-brand-logo.png) |
| ![Брони](docs/screenshots/06-bookings.png) | ![Команда и Telegram](docs/screenshots/07-team-telegram.png) |
| ![Уведомления](docs/screenshots/08-notifications.png) | ![Телефон](docs/screenshots/09-mobile-photos.png) |
| ![Заявки мастерам](docs/screenshots/10-work-requests.png) | ![Смета ждёт решения](docs/screenshots/11-work-request-estimate.png) |
| ![Доп. расходы](docs/screenshots/12-work-request-extras.png) | ![Новая заявка](docs/screenshots/13-work-request-new.png) |

## Что пока заглушка

- онлайн-оплата не активирована (нет ключей и договора), реальных платежей не было;
- S3 не подключён — фото на локальном диске;
- фото квартир в демо — рисованные заглушки, кроме фото дома в ЖК Хайвил;
- технический slug аккаунта `astana-stay` и демо-почты `@astanastay.example` оставлены от прототипа;
- нет ограничения частоты попыток входа (сделать перед публичным запуском);
- приложения мастера на сервере пока нет (только API): шаги мастера делаются через `/api/staff/...` или `/api/task-link/...`;
  страница для «задачи по ссылке» — следующий шаг (в статическом демо это `task.html`, он к серверу не подключён);
- фото проблем в демо-заявках Master Electric — рисованные заглушки;
- `npm audit`: 3 предупреждения high в `deepmerge-ts` внутри CLI Prisma (`@prisma/config`, читает конфиг при миграциях) — в запросы к серверу не попадает; исправится обновлением Prisma, `audit fix --force` откатывает Prisma и не нужен.
