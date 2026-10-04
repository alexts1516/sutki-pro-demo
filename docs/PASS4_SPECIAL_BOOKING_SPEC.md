# Проход 4 — «Личная ссылка для особой брони» (спецификация, финальная редакция)

Статус: **СПРОЕКТИРОВАНО, НЕ РЕАЛИЗОВАНО.** Редакция 2 — 4 октября 2026. Ни одна строка ниже не описывает существующий код, кроме раздела 1 («что уже есть»). Проход 3 заморожен; код прохода 3 меняется только в общих точках, перечисленных в разделе 15.

**Главный принцип: второй системы броней нет.** Личная ссылка — вход в существующий `Booking`. Пока гость заполняет ссылку, бронь — обычная `request` со сроком удержания. Когда условия выполнены, вызывается существующая `confirmBooking()`. Дальше всё делает проход 3: подготовка, «Сегодня», готовность, трансфер, недочёты, выплаты.

**Что изменилось в редакции 2.**
- Паспорт и билет больше не обязательны и в систему не загружаются (раздел 9).
- Защита от двойной брони теперь работает на уровне базы PostgreSQL, а не замка внутри процесса (раздел 10).
- Подтверждение брони стало одной транзакцией, а последующие действия идут через журнал «отложенных действий» с восстановлением (раздел 4.5).
- Неоплаченные заявки с сайта теперь живут ограниченное время — тот же механизм, что у ссылки (раздел 11).
- Предложенные значения больше не выдаются за решения владельца (раздел 20).

### Значения по умолчанию

Технические значения выбраны архитектором и **не являются решениями владельца**. Каждое меняется в одном месте кода или настройках.

| Параметр | Значение | Где |
|---|---|---|
| Срок ссылки по умолчанию | 24 ч; админ выбирает 1–72 ч; продление — максимум до 7 суток от создания | константы `LINK_DEFAULT_H / LINK_MAX_H / LINK_MAX_TOTAL_D` в `services/bookingLinks.js` |
| Удержание неоплаченной заявки с сайта | 30 мин; продлевается до «сейчас + 20 мин» при открытии оплаты | `PUBLIC_HOLD_MIN`, `PAY_EXTEND_MIN` в `services/bookings.js` |
| Токен ссылки | 256 бит; в базе — только SHA-256 | раздел 8 |
| Пороги «Сегодня» для ссылки | ≤ 3 ч — «Требует действия», ≤ 1 ч — «Критично» | `LINK_WARN = [3h, 1h]` |
| Повторы отложенных действий | 5 попыток; аренда (lease) 5 мин; прогон раз в 1 мин | `OUTBOX_*` в `services/outbox.js` |
| Минимальное время подготовки между гостями | 120 мин, станет настройкой `minPrepMinutes` (раздел 12а) | сейчас константа `PREP_MIN` в `src/routes/admin/ops.js` |

---

## 1. Что переиспользуем (проверено по коду)

| Что | Где | Как используем |
|---|---|---|
| Бронь и статусы `request → confirmed → completed / cancelled` | `server/prisma/schema.prisma → model Booking`; `src/services/bookings.js` | Ссылка создаёт `Booking{status:'request', source:'link'}`. Новых статусов брони нет. |
| Занятость | `bookings.js → BLOCKING`, `isAvailable()`, `busyRanges()` (брони `request/confirmed` + ремонты с `blockDays`) | Остаётся единственной логикой занятости. Меняется только правило для истёкшего удержания (раздел 11) и выполнение внутри транзакции (раздел 10). |
| Цена, номер брони | `quote()`, `nextBookingNumber()` (+ повтор при `P2002` в `createBookingRequest()`) | Без изменений. |
| Подтверждение (идемпотентно после приёмки прохода 3) | `bookings.js → confirmBooking({accountId, bookingId, events, dispatch, actor})`: условная запись `updateMany where status='request'`, `CleaningTask` в день выезда, событие `booking.confirmed`, `dispatch.createForBooking()` | Единственная точка передачи в проход 3. В проходе 4 становится транзакционной (раздел 4.5). |
| Отмена брони | `src/routes/admin/operations.js → POST /bookings/:id/cancel` | Выносится в `cancelBooking()` (раздел 15). |
| Условия оплаты особой брони | `Booking.paymentMethod = 'cash_on_arrival' | 'deposit'`, `paymentStatus = 'unpaid' | 'prepaid' | 'paid'` (уже в `prisma/seed.js → payTerms`, `public/admin/admin.js → payChip()`); `SRC.link = 'Личная ссылка'` | Без новых полей. |
| Оплата на сайте | `src/payments/index.js → applyPaymentResult()` (успех → `paymentStatus:'paid'` → `confirmBooking`), `src/routes/public.js → POST /bookings/:token/pay` | Без изменений, плюс обработка оплаты после истечения удержания (раздел 11). |
| Гость | `model Guest` | Создаётся при создании ссылки, обновляется данными гостя. Профиля с документами нет. |
| Страница по ссылке без входа | `app.js: GET /link/:token` → `public/link/index.html`, `public/link/link.js`; `src/routes/linkKind.js` | Новый `kind:'special'` на той же странице. |
| Защита ссылок от перебора | `src/lib/rateLimit.js → linkGuard()`, подключение в `app.js` (`config.rateLimit.link*`, по умолчанию 120 запросов / 20 неверных за 15 мин) | Тот же guard на `/api/special-link`. |
| Токены | `src/lib/tokens.js → randomToken()` | `randomToken(32)` + SHA-256. |
| Уведомления | `src/notifications/events.js`, `service.js → deliver()` с уникальным `dedupeKey`, `toManagers()` (по `AccountSettings.managerNotify`), `templates.js` | Новые шаблоны. Отправка идёт через журнал отложенных действий (раздел 4.5). |
| Планировщик | `src/notifications/scheduler.js → startScheduler()` (уже запускает напоминания о заезде, диспетчер трансферов, напоминания о выплатах) | Сюда добавляются прогон журнала отложенных действий, сверка и снятие истёкших удержаний. Отдельного cron или очереди нет. |
| Роли | `src/auth/roles.js` (`MANAGERS`), `app.js: admin.use(authenticate, requireRole(...MANAGERS))` | Управление ссылками — `/api/admin` (владелец и админ). |
| «Сегодня» | `src/services/ops.js → todayView()` (сейчас неоплаченные `request` → пункт `awaiting_payment`) | Пункты `link_*`, `outbox_failed`, `payment_orphaned` (раздел 13). |

**Поправка к прежним документам.** Telegram-бот брони не создаёт: в `src/telegram/*` нет создания `Booking`. Бессрочные неоплаченные `request` создаёт только `POST /api/public/:slug/bookings` (`src/routes/public.js`): `paymentMethod` по умолчанию `'cash'`. Закрывается в разделе 11.

## 2. Цель

Владелец или админ за 30 секунд создаёт для особого гостя личную ссылку: квартира, даты, цена, условия (наличные при заезде или залог), срок. При желании он отмечает «Нужно дополнительное подтверждение» (например, гость пришлёт паспорт или билет в мессенджер).

Гость по ссылке видит предложение, вводит имя и телефон, соглашается с условиями и нажимает «Подтвердить бронь». После этого бронь становится обычной подтверждённой бронью прохода 3.

Регистрации гостя нет. Паспортов в системе нет. Вечных заявок в календаре нет. Двойная бронь невозможна даже при нескольких копиях сервера.

## 3. Бизнес-поток

1. Гость пишет владельцу или админу в мессенджер, они договариваются.
2. Админ открывает «Брони» → «＋ Личная ссылка» и заполняет:
   - квартиру, даты, число гостей;
   - условия: A — наличные при заезде, B — залог N ₸;
   - срок ссылки;
   - по желанию — имя и телефон гостя, свою цену (раздел 20), комментарий;
   - по желанию — галочку «Нужно дополнительное подтверждение» и текст, что нужно (например, «паспорт и билет — пришлите в WhatsApp»).
   Система в одной транзакции проверяет занятость и создаёт `Booking(request, source:'link', holdUntil = срок ссылки)` и `BookingLink`. Ссылка показывается один раз, админ копирует её в мессенджер.
3. Гость открывает ссылку и видит: квартиру, даты, ночи, сумму, условия, «действует до …», что сделать. Если подтверждение требуется, он видит и текст, что прислать и куда (вне системы).
4. Гость вводит имя, телефон (e-mail по желанию), ставит «Согласен с условиями» и нажимает «Подтвердить бронь».
5. Бронь подтверждается, если выполнены все условия:
   - данные гостя и согласие с текущим предложением;
   - для B — админ отметил «Залог получен»;
   - если галочка подтверждения стояла — админ отметил «Подтверждение получено».
   Тогда в одной транзакции ссылка становится `completed`, бронь `confirmed` и создаётся подготовка. Заказ водителям и уведомления идут через журнал отложенных действий. Дальше работает проход 3.
6. Если гость не успел, удержание истекает: бронь `cancelled`, ссылка `expired`, даты свободны. Админ может продлить ссылку до истечения или создать новую.

Других условий, кроме A и B, нет: в системе нет подтверждённой потребности.

## 4. Машина состояний

У брони остаются только существующие статусы `request / confirmed / cancelled / completed` и одно новое поле `holdUntil`. У ссылки — хранимый `status` и производные подсостояния.

### 4.1 Хранимые статусы `BookingLink.status`

`active` · `completed` · `expired` · `revoked` · `cancelled` (бронь отменили после подтверждения; ссылка только для чтения).

### 4.2 Производные подсостояния (для `active`, не хранятся)

| Подсостояние | Условие |
|---|---|
| ждём гостя | `guestStartedAt = null` |
| гость начал | `guestStartedAt ≠ null`, `missing()` не пуст |
| ждём админа | данные и согласие есть, нет отметки залога или подтверждения |
| условия выполнены | `missing()` пуст — в той же транзакции переходит в `completed` |

`missing(link, booking)` — список того, что ещё не выполнено:
- `guest` — нет имени или телефона;
- `terms` — нет `termsAcceptedAt`, или `termsHash` не совпадает с текущим `sha256(checkIn|checkOut|totalKzt|terms|depositKzt)`;
- `deposit` — если `terms='deposit'` и нет `depositReceivedAt`;
- `extra_check` — **только** если `extraCheckRequired = true` и нет `extraCheckedAt`.

Паспорт и билет в `missing()` **не входят никогда**.

Начало заполнения считается по первому POST гостя, а не по открытию: превью ссылок в мессенджерах сами запрашивают адрес. Открытия только считаются (`openCount`, `lastOpenedAt`).

### 4.3 Переходы

Обозначение `TX(apt)` — транзакция с блокировкой квартиры (раздел 10).

| Текущее | Событие | Новое | Побочные эффекты |
|---|---|---|---|
| — | Админ «Создать» | link `active`, booking `request` | `TX(apt)`: снять истёкшие удержания квартиры → `isAvailable` → `Guest` → `Booking(holdUntil)` → `BookingLink(tokenHash)`. Токен — в ответе один раз. |
| — | «Создать», даты заняты | — | 409 «Эти даты уже заняты». Конфликт в базе (`23P01`) тоже даёт 409. |
| `active` | Гость GET | `active` | Сначала ленивое истечение (раздел 11); затем `openCount+1`. |
| `active` | Гость POST данных и согласия | `active` | `guestStartedAt ??= now`, обновить `Guest`, `termsAcceptedAt`, `termsHash`. Первый раз — событие `link.started` в журнал (dedupe). Если `submittedAt` уже есть и `missing()` стал пуст — подтверждение (ниже). |
| `active` | Админ «Залог получен» / «Подтверждение получено» | `active` или `completed` | Условная запись `where depositReceivedAt IS NULL` (или `extraCheckedAt IS NULL`); залог → `Booking.paymentStatus='prepaid'`. Если `submittedAt` есть и `missing()` пуст — подтверждение. |
| `active` | Гость «Подтвердить», `missing()` не пуст | `active` | `submittedAt ??= now`; 200 `{status:'active', missing}` — гость видит, чего ждём. |
| `active` | Подтверждение: `missing()` пуст, `now < holdUntil` | link `completed`, booking `confirmed` | Одна `TX(apt)` (раздел 4.5): условные записи ссылки и брони, `isAvailable(excludeBookingId)`, `CleaningTask(autoKey)`, строки журнала отложенных действий. После коммита — прогон журнала. |
| `active` | Подтверждение при `now ≥ holdUntil` | link `expired`, booking `cancelled` | Граница строгая: ровно в `holdUntil` уже истекло. В той же транзакции — истечение; гостю 410. |
| `active` | Подтверждение, даты закрыты ремонтом | `active` | Откат транзакции; 409 «Даты стали недоступны — владелец свяжется с вами»; событие `link.conflict` и «Критично» в «Сегодня». |
| `active` | `holdUntil ≤ now`: ленивая проверка при любом чтении занятости или ссылки, плюс планировщик | link `expired`, booking `cancelled` | `releaseExpiredHolds()` (раздел 11); событие `link.expired` в журнал (dedupe). |
| `active` | Админ «Продлить» | `active` | `TX(apt)`: `Booking.holdUntil` += N ч, только если `now < holdUntil` и итог ≤ 7 суток от создания. |
| `active` | Админ «Новая ссылка» | `active` | Новый токен, хэш заменён; старая ссылка сразу 404. |
| `active` | Админ «Отозвать» | link `revoked`, booking `cancelled` | `cancelBooking()` (сама закрывает ссылку). |
| `active` | Админ меняет даты или сумму брони (существующий PATCH, теперь в `TX(apt)`) | `active` | `termsHash` перестаёт совпадать — нужна новая галочка гостя. |
| `active` | Админ отменяет бронь | link `revoked` | `cancelBooking()`. |
| `completed` | Гость GET / повторный «Подтвердить» / повтор после таймаута клиента | `completed` | 200 «Бронь №… подтверждена», без эффектов. |
| `completed` | Бронь отменили | `cancelled` | В `cancelBooking()`. |
| `expired` / `revoked` / `cancelled` | Любой запрос гостя | — | 410 «Ссылка больше не действует — напишите владельцу». |
| `expired` | Админ «Продлить» | — | 409 «Ссылка истекла — создайте новую» (даты могли занять); кнопка «Создать заново» с теми же полями. |

### 4.4 Идемпотентность

- Каждый переход — условная запись `updateMany({where:{id, status:<ожидаемый>, ...}})`. Если изменено 0 строк — прочитать и вернуть текущее состояние без эффектов.
- Двойная бронь исключена базой (раздел 10), а не кодом.
- Одна подготовка на бронь — уникальный `CleaningTask.autoKey = 'turnover:<bookingId>'`.
- Один заказ водителям на трансфер — уже есть уникальный `TransferJob.transferId`; `createForBooking` берёт только трансферы `job: null`.
- Уведомления — уникальный `NotificationLog.dedupeKey` (уже есть) и уникальный `OutboxEvent.dedupeKey`.
- Повтор «Подтвердить» после таймаута клиента возвращает тот же результат.

### 4.5 Подтверждение и восстановление после сбоя

Проблема: сейчас `confirmBooking()` делает несколько отдельных записей подряд — статус, подготовку, событие, `dispatch.createForBooking`. Падение процесса между ними оставляет бронь `confirmed` без подготовки или без заказа водителям навсегда.

**В одной транзакции базы** (`prisma.$transaction(async tx => …)`, внутри `TX(apt)`):
1. `BookingLink active → completed` (для ссылки);
2. `Booking request → confirmed` (условная запись, `holdUntil = null`, платёжные поля по условиям);
3. повторная `isAvailable(tx, …, excludeBookingId)`;
4. `CleaningTask` в день выезда с `autoKey='turnover:<bookingId>'` (уникальный; если уже есть — пропустить);
5. строки журнала `OutboxEvent`:
   - `transfers.dispatch:<bookingId>` → `dispatch.createForBooking`;
   - `event:booking.confirmed:<bookingId>` → `events.emit('booking.confirmed')`;
   - для ссылки — `event:link.completed:<linkId>`.

**После коммита** — только то, что можно повторять: прогон этих строк журнала (Telegram, предложения водителям, расчёт выплаты водителю). `TransferJob` создаётся здесь, а не в транзакции: `createForTransfer()` рассылает предложения и уже идемпотентна по `transferId`, а переписывать её под транзакцию — лишнее изменение прохода 3.

**Журнал `OutboxEvent`** (одна маленькая таблица; внешних очередей нет):
- `runOutbox({limit})` захватывает строки условной записью `updateMany where status='pending' and nextAttemptAt<=now → nextAttemptAt = now + 5 мин` (аренда — безопасно при нескольких копиях сервера), выполняет и ставит `done`.
- При ошибке — `attempts+1`, `lastError`, следующая попытка позже. После 5 попыток — `failed` и «Критично» в «Сегодня»: «Не завершена цепочка брони №…».
- Запуск: сразу после коммита (лучшее усилие, в том же процессе), при старте сервера и каждую минуту из `startScheduler`.

**Сверка (reconciler) `reconcileBookings()`** в том же тике планировщика — для старых данных и на всякий случай:
- подтверждённые брони с выездом ≥ сегодня без какой-либо `CleaningTask` с этим `bookingId` → создать с `autoKey`;
- подтверждённые брони с активным `Transfer` без `TransferJob` и без ожидающей строки журнала → добавить `transfers.dispatch`.
Всё идемпотентно благодаря уникальным ключам.

Отмена брони устроена так же: `cancelBooking()` в транзакции меняет статус, удаляет неначатую подготовку и закрывает ссылку; отмена заказов водителям и их уведомление (`dispatch.cancelForBooking`) — строкой журнала `transfers.cancel:<bookingId>`.

## 5. Изменения данных

```prisma
model BookingLink {
  id                 String    @id @default(cuid())
  accountId          String
  bookingId          String    @unique
  tokenHash          String    @unique /// sha256(token), hex; сам токен не хранится
  status             String    @default("active") /// active | completed | expired | revoked | cancelled
  terms              String /// cash_on_arrival | deposit
  depositKzt         Int?
  extraCheckRequired Boolean   @default(false) /// владелец/админ попросил доп. подтверждение (паспорт/билет — вне системы)
  extraCheckNote     String? /// что и куда прислать, для гостя
  extraCheckedAt     DateTime?
  extraCheckedBy     String?
  note               String?
  termsHash          String?
  termsAcceptedAt    DateTime?
  guestStartedAt     DateTime?
  submittedAt        DateTime?
  depositReceivedAt  DateTime?
  depositMarkedBy    String?
  completedAt        DateTime?
  closedAt           DateTime?
  closedByName       String?
  openCount          Int       @default(0)
  lastOpenedAt       DateTime?
  createdById        String?
  createdByName      String?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)
  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  @@index([accountId, status])
}

model OutboxEvent {
  id            String    @id @default(cuid())
  accountId     String
  kind          String /// transfers.dispatch | transfers.cancel | event
  payload       Json /// { bookingId } | { name, data }
  dedupeKey     String    @unique
  status        String    @default("pending") /// pending | done | failed
  attempts      Int       @default(0)
  nextAttemptAt DateTime  @default(now())
  lastError     String?
  createdAt     DateTime  @default(now())
  doneAt        DateTime?
  @@index([status, nextAttemptAt])
}
```

Изменения существующих моделей (минимум):
- `Booking.holdUntil DateTime?` — до какого момента неподтверждённая бронь держит даты. Индекс `@@index([apartmentId, status, holdUntil])`. Срок ссылки хранится **только здесь**, у `BookingLink` своего `expiresAt` нет — одна правда.
- `CleaningTask.autoKey String? @unique` — ключ автоматической подготовки (`turnover:<bookingId>`). Уникальность допускает много `NULL` (и SQLite, и PostgreSQL), старые данные не мешают.
- Обратные связи: `Booking.link BookingLink?`, `Account.bookingLinks`.
- (Шаг 8, отдельно) `AccountSettings.minPrepMinutes Int @default(120)`.

**Миграции.**
1. SQLite: `npx prisma migrate dev --name pass4_links_outbox_holds`.
2. PostgreSQL: `npm run pg:schema` → папка `prisma/postgres/migrations/<метка>_pass4_links_outbox_holds/` с тем же содержимым **плюс ручной SQL** (раздел 10):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Booking" ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist ("apartmentId" WITH =, tsrange("checkIn", "checkOut", '[)') WITH &&)
  WHERE (status IN ('request', 'confirmed'));
```

3. Перед ограничением — в той же миграции сделать данные чистыми:
   - старым `request` без `holdUntil` выставить `holdUntil = now() + interval '24 hours'`;
   - проверочный запрос на уже пересекающиеся брони — миграция должна упасть с понятным сообщением, а не молча.
4. Проверка — `npm run test:pg` (на рабочей машине уже ставился PostgreSQL 17: `sudo pg_ctlcluster 17 main start`, пользователь `sutki/sutki`).

## 6. API

Общие ошибки:
- `400` — неверные поля;
- `401` / `403` — нет входа или нет прав;
- `404` — не найдено (для гостя считается в лимит перебора);
- `409` — конфликт состояния или дат (`{error, missing?}`);
- `410` — ссылка больше не действует;
- `429` — лимит запросов.

### 6.1 Владелец и админ (`/api/admin`, `requireRole(...MANAGERS)`)

| Метод и путь | Тело | Ответ |
|---|---|---|
| `POST /booking-links` | `{apartmentId, checkIn:'YYYY-MM-DD', checkOut, guestsCount, terms:'cash_on_arrival'|'deposit', depositKzt? (обязателен для deposit; 1…totalKzt), totalKzt? (своя цена — раздел 20), expiresInHours?=24 (1…72), extraCheckRequired?=false, extraCheckNote?, guestName?, guestPhone?, note?}` | `201 {link: LinkOut, url}` — `url` только здесь. Ошибки: 404, 400 (прошлое, >90 ночей, гостей > maxGuests), 409 занято. |
| `GET /booking-links?status=active|all` | — | `[LinkOut]` (после ленивого истечения). |
| `GET /booking-links/:id` | — | `LinkOut`. |
| `POST /booking-links/:id/extend` | `{hours: 1…72}` | `LinkOut`; 409 если не `active`, удержание уже истекло или итог больше 7 суток. |
| `POST /booking-links/:id/rotate` | — | `{link, url}`; 409 если не `active`. |
| `POST /booking-links/:id/revoke` | `{reason?}` | `LinkOut`; повтор — 200. |
| `POST /booking-links/:id/deposit` | — | `LinkOut` (может стать `completed`); 409 если условия не `deposit` или ссылка не `active`; повтор — 200. |
| `POST /booking-links/:id/extra-check` | — | `LinkOut` (может стать `completed`); 409 если подтверждение не запрашивалось; повтор — 200. |

`LinkOut = {id, bookingId, bookingNumber, status, stage, missing, guest:{name, phone}, apartment:{id, title, code}, checkIn, checkOut, totalKzt, terms, depositKzt, extraCheckRequired, extraCheckNote, holdUntil, openCount, lastOpenedAt, guestStartedAt, submittedAt, depositReceivedAt, extraCheckedAt, completedAt, createdByName}`.

В ответах `GET /api/admin/bookings*` у брони `source:'link'` — поле `link: LinkOut|null`.

### 6.2 Гость (без входа; `/api/special-link`, через `linkGuard`)

Длина токена 40–64 символа, иначе 404 без запроса к базе; поиск по `sha256(token)`.

| Метод и путь | Тело | Ответ |
|---|---|---|
| `GET /:token` | — | `200 {status, stage, missing, holdUntil, apartment:{title, rooms, maxGuests, photo, address (только после подтверждения)}, checkIn, checkOut, checkInTime, checkOutTime, nights, guestsCount, totalKzt, terms, depositKzt, note, extraCheckRequired, extraCheckNote, guest:{name, phone}, booking:{number, status}, telegramLink (после подтверждения: b_<Booking.token>)}`; 410 для закрытых. |
| `POST /:token/guest` | `{name, phone, email?, acceptTerms: true}` | 200 как GET; 409 если не `active`; 410. |
| `POST /:token/submit` | — | `200 {status:'completed', booking:{number, status:'confirmed'}}` или `200 {status:'active', missing}`; повтор — тот же ответ; 409 «Даты стали недоступны»; 410. |

Гостевых ответов без `bookingId`, `guestId`, внутренних id. Заголовки `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.

## 7. Права

| Действие | Владелец | Админ | Подготовка / мастер / водитель | Гость |
|---|---|---|---|---|
| Создать, продлить, новая ссылка, отозвать | ✔ | ✔ | — | — |
| Своя цена в ссылке | ✔ | по решению владельца (раздел 20); до решения — нет | — | — |
| «Залог получен», «Подтверждение получено» | ✔ | ✔ | — | — |
| Видеть состояние ссылки | ✔ | ✔ | — | только свою |
| После подтверждения | как любая бронь | как любая бронь | как в проходе 3 | статус, адрес, Telegram |

## 8. Безопасность токена

- `Booking.token` (96 бит) и `linkToken` заданий (144 бита) хранятся открытым текстом, поэтому для ссылки, создающей бронь, — новый токен. Переиспользуются `randomToken`, страница `/link/:token` и `linkGuard`.
- Генерация: `randomToken(32)` — 256 бит, base64url, 43 символа.
- Хранение: только `sha256(token)` в `BookingLink.tokenHash @unique`. Показ — один раз; «Скопировать ещё раз» = «Новая ссылка» (старая сразу умирает).
- Ссылка многоразовая до завершения: гость возвращается по той же ссылке, данные на сервере. После `completed` — только просмотр «подтверждено» до дня выезда + 1, потом 410. Закрытые — 410.
- Перебор: `linkGuard` (лимит с IP + лимит на 404), длина проверяется до базы. При 256 битах перебор бессмыслен.
- Токен не пишется в журналы, там только `linkId`.
- Украденный токен — «Новая ссылка» или «Отозвать». Злоумышленник может самое большее заполнить данные; документов в системе нет.

## 9. Документы (паспорт, билет) — в проходе 4 в систему НЕ загружаются

**Решение владельца (новое).** Обычные брони и брони по личной ссылке по умолчанию паспорта **не требуют**. Паспорт и билет — только **дополнительное подтверждение** для исключительной брони «на доверии». Нужно ли оно, решает владелец или админ для каждой ссылки. Полного профиля паспорта гостя нет. Миграционный учёт иностранцев, eQonaq и прочие требования — **не проход 4**: это будущий этап, привязанный к фактическому заселению.

**Почему `BookingDocument` убран из прохода 4.**
- Ядро ссылки (предложение → согласие → подтверждение → проход 3) работает без файлов.
- Дополнительное подтверждение закрывается флагом `extraCheckRequired` и отметкой админа «Подтверждение получено». Гость присылает фото в мессенджер, в котором уже идёт переписка.
- Хранение паспортов на сервере — самая рискованная часть прежней редакции: закрытая папка, сроки удаления, резервные копии, права, форматы. Без доказанной потребности это архитектура «на будущее».
- Вопрос о сроке хранения паспорта отпадает.

**Следующий маленький шаг — только если владелец попросит загрузку в систему.** Модель `BookingDocument` (вид, приватный ключ, тип по сигнатуре, sha256, удалить после). Приватное хранение вне `/uploads` (`savePrivate/readPrivate` в `storage/local.js` и `s3.js`), просмотр только владельцем и админом через авторизованный адрес, JPG/PNG/HEIC/PDF до 10 МБ, удаление по сроку из `startScheduler`. Условие `extra_check` тогда выполняется отметкой админа после просмотра. Проход 4 к этому готов: условие уже отделено.

## 10. Двойная бронь: гарантия на уровне базы

**Выбор: ограничение `EXCLUDE` в PostgreSQL + блокировка строки квартиры в транзакции.**

| Вариант | Оценка |
|---|---|
| `withLock('apt:'+id)` в Node | Только один процесс — **недостаточно** для продакшена. Остаётся как удобство для SQLite (разработка и демо). |
| `pg_advisory_xact_lock(hash)` | Работает, но это та же «дисциплина кода», что и блокировка строки, только менее наглядная. Не выбран. |
| `SELECT … FROM "Apartment" WHERE id=$1 FOR UPDATE` в транзакции | Упорядочивает все изменения занятости одной квартиры между процессами, в том числе проверки с ремонтами (`blockDays` — другая таблица). Но держится на том, что каждый путь её берёт. |
| `EXCLUDE USING gist ("apartmentId" WITH =, tsrange("checkIn","checkOut",'[)') WITH &&) WHERE status IN ('request','confirmed')` | **Гарантия базы**: две пересекающиеся блокирующие брони одной квартиры не могут существовать, даже если путь в коде забыт или запросы из разных копий сервера. |

**Итог.** Обязательная гарантия — `EXCLUDE` (ловит любые пути). Блокировка строки квартиры — для правильных сообщений и правил с ремонтами и истёкшими удержаниями. Обе — в одном общем помощнике:

```js
// services/bookings.js
const isPostgres = /^postgres/.test(process.env.DATABASE_URL || '');
export async function withApartmentTx(apartmentId, fn) {
  const run = () => prisma.$transaction(async (tx) => {
    if (isPostgres) await tx.$queryRaw`SELECT id FROM "Apartment" WHERE id = ${apartmentId} FOR UPDATE`;
    await releaseExpiredHolds(tx, { apartmentId, now: new Date() });   // иначе EXCLUDE «увидит» истёкшее удержание
    return fn(tx);
  }, isPostgres ? { isolationLevel: 'ReadCommitted', timeout: 10000 } : { timeout: 10000 });   // SQLite знает только Serializable
  return isPostgres ? run() : withLock(`apt:${apartmentId}`, run);   // SQLite (разработка/демо): один процесс — очередь в памяти
}
```

- `isAvailable(tx, …)` принимает `tx` (по умолчанию — общий клиент для чтений вне записи).
- Ошибку базы `23P01` (нарушение `EXCLUDE`; в Prisma — `P2010` или `PrismaClientUnknownRequestError` с этим кодом) превращать в `HttpError(409, 'Эти даты уже заняты')`.
- **SQLite** — только разработка и демо: один процесс, один пишущий, транзакции идут по очереди; `EXCLUDE` там нет, вместо него внутри `withApartmentTx` остаётся `withLock('apt:'+id)`.
- **Гарантия продакшена:** «на одной PostgreSQL при любом числе процессов и контейнеров две пересекающиеся брони `request/confirmed` одной квартиры невозможны — это запрещает база».
- Расширение `btree_gist` доверенное (PostgreSQL 13+), владелец базы может его включить; у управляемых PostgreSQL (Render, Neon, Supabase) оно есть.
- Ограничение не видит `holdUntil` (в условии ограничения нельзя `now()`), поэтому истёкшие удержания снимаются в той же транзакции до записи (`releaseExpiredHolds` выше), а чтения занятости их не считают (раздел 11).

**Все пути, меняющие занятость, — через `withApartmentTx`:**

| Путь | Файл / функция |
|---|---|
| Публичная бронь с сайта | `src/routes/public.js → POST /bookings` → `services/bookings.js → createBookingRequest()` |
| Создание личной ссылки | новое `services/bookingLinks.js → create()` |
| Подтверждение (оплатой, админом, ссылкой) | `services/bookings.js → confirmBooking()`; вызывается из `payments/index.js → applyPaymentResult()`, `routes/admin/operations.js → POST /bookings/:id/confirm`, `bookingLinks.submit/markDeposit/markExtraCheck` |
| Смена дат брони | `routes/admin/operations.js → PATCH /bookings/:id` (ветка `checkIn/checkOut`) |
| Продление удержания | `bookingLinks.extend()`; продление при открытии оплаты в `public.js → POST /bookings/:token/pay` |
| Восстановление брони при оплате после истечения | `applyPaymentResult()` (раздел 11) |
| Закрытие дат ремонтом | `routes/admin/workRequests.js → POST /repairs` (`blockDays > 0`) → `workRequests.create()` — только блокировка строки квартиры (ремонт — не бронь; при пересечении с бронью — существующее поведение, предупреждение в «Сегодня») |
| Отмена брони | `cancelBooking()` — в транзакции; освобождает даты, `EXCLUDE` не нарушает |

Других путей создания или изменения дат брони в коде нет: `prisma.booking.create` есть только в `createBookingRequest()`, а `seed.js` — не путь работы системы.

## 11. Удержание дат и истечение (общее для ссылки и сайта)

**Правило занятости:** бронь блокирует даты, если `status = 'confirmed'` или `status = 'request' AND holdUntil > now`. Меняется условие в `BLOCKING`-запросах `isAvailable()` / `busyRanges()` и в календаре. Запрос с `holdUntil` в прошлом даты **не держит**, даже если ещё не снят.

**Снятие:** `releaseExpiredHolds(tx|prisma, {accountId?, apartmentId?, now})`:
- брони `status:'request' AND holdUntil <= now` → `cancelled`;
- связанные ссылки `active` → `expired` (`closedAt`);
- строки журнала `event:link.expired:<linkId>` / `event:booking.hold_expired:<bookingId>` (dedupe).
Условные записи, безопасно при повторе и при нескольких процессах.

Вызывается:
- в `withApartmentTx` (для своей квартиры);
- лениво в начале чтений: гостевые `/api/special-link/*`, `GET/POST /api/admin/booking-links*`, `todayView()`, `GET /api/admin/calendar`, `GET /api/admin/bookings`, публичные `GET /apartments/:id/availability`;
- из `startScheduler` раз в минуту (вместе с `runOutbox`).
Отдельного cron нет.

**Публичная бронь с сайта (закрывает «вечные заявки»):**
- `POST /api/public/:slug/bookings` принимает **только** `paymentMethod: 'card'` (это и значение по умолчанию). Другие значения — 400 «Бронирование на сайте — только с оплатой картой; для особых условий напишите нам». Модель уже решена владельцем: обычный гость бронирует только с оплатой.
- Бронь создаётся `request` с `holdUntil = now + 30 мин` (технически). `POST /bookings/:token/pay` продлевает удержание до `max(holdUntil, now + 20 мин)`.
- Если онлайн-оплата не подключена (`payments = null`), заявка честно истечёт; в продакшене оплата обязательна (ПЛАН.md, раздел 6 «Что нужно от владельца для запуска» — договор с платёжной системой).
- **Оплата после истечения** (`applyPaymentResult`, бронь уже `cancelled` по истечению): в `withApartmentTx`, если даты свободны — вернуть бронь в `request` и подтвердить (`confirmBooking`); если заняты — бронь остаётся отменённой, платёж `succeeded`, строка журнала `event:payment.orphaned` → менеджерам и «Критично» в «Сегодня»: «Оплата без брони — верните деньги». Возврат денег — вручную, автоматического возврата нет.

**Ссылка:** срок ссылки = `Booking.holdUntil`. Продлить — только пока не истёк. Истёкла — «Создать заново».

## 12. Уведомления

Все события идут строками журнала `OutboxEvent kind:'event'` → `events.emit` → существующие `deliver()` с `dedupeKey`. Получатели — `toManagers()` по `managerNotify`. Гостю до подтверждения в Telegram писать нельзя (его чат появится только после привязки `b_<token>`), поэтому напоминание гостю — вручную: «Скопировать напоминание» в карточке.

| Момент | Первая версия | Следующий маленький шаг |
|---|---|---|
| Гость начал | `link.started` менеджерам | — |
| Ждём админа (залог или подтверждение) | `link.needs_admin` | — |
| Бронь подтверждена | `link.completed` + существующий `booking.confirmed` гостю | — |
| До конца удержания ≤ 3 ч / ≤ 1 ч | пункты «Сегодня» (вычисляются при чтении) | Telegram-напоминание ответственному из `startScheduler` (`link.reminder:<id>:1/2`) |
| Истекла | `link.expired` | — |
| Конфликт дат | `link.conflict` + «Критично» | — |
| Оплата без брони | `payment.orphaned` + «Критично» | — |

Прежние цифры из ПЛАН.md (1 ч / 6 ч / передача владельцу до 24 ч) — не окончательные; пороги выше — технические.

### 12а. Минимальное время подготовки между гостями → настройка

Сейчас (приёмка прохода 3) это константа `PREP_MIN = 120` в `src/routes/admin/ops.js` (проверка `POST /bookings/:id/early-checkin`). Должна стать настройкой «Минимальное время подготовки между гостями»:
- поле `AccountSettings.minPrepMinutes Int @default(120)`;
- значение по умолчанию в `src/services/settings.js → DEFAULT_SETTINGS`;
- чтение и запись в `src/routes/admin/settings.js` (zod 30…720, шаг 15);
- поле в форме «Настройки» в `public/admin/admin.js` рядом с `driverStartWindowMin`;
- чтение в `routes/admin/ops.js` вместо `PREP_MIN`.
Проходу 4 не обязательно; шаг 8 плана. 120 мин — техническое значение по умолчанию, владелец меняет в настройках.

## 13. Интерфейс владельца и админа (без нового раздела; детали — на усмотрение исполнителя)

- **«Брони»:** кнопка «＋ Личная ссылка» → форма в выдвижной панели (поля раздела 3) → после создания ссылка + «Скопировать» + готовый текст для мессенджера.
- **Секция «Ожидают гостя»** (на месте «Ждут оплаты гостем»): ссылки и неоплаченные заявки сайта — кому, квартира, даты, условия, «до …», этап, нужно ли действие.
- **Карточка брони** `source:'link'` — блок «Личная ссылка»:
  - что сделано: ✔ данные, ✔ согласие, — залог, — подтверждение;
  - срок;
  - действия: «Залог получен», «Подтверждение получено», «Продлить», «Новая ссылка», «Отозвать», «Скопировать напоминание».
- **«Сегодня»** (`todayView`):
  - «Критично»: `link_conflict`, `payment_orphaned`, `outbox_failed`;
  - `link_expiring`: ≤ 1 ч — «Критично», ≤ 3 ч — «Требует действия»;
  - «Требует действия»: `link_needs_admin` («Гость всё заполнил — отметьте залог / подтверждение»);
  - остальные активные ссылки — «Информация»;
  - для брони по ссылке пункт `awaiting_payment` не показывается.

## 14. Интерфейс гостя

Страница `/link/<token>`, вид `special`, один экран, без входа:
1. Что предлагают: фото и название, даты и время, ночи, гостей, сумма.
2. Условия: наличные при заезде, или залог N ₸ (остаток при заезде), плюс комментарий владельца.
3. До когда: «Предложение действует до 5 окт, 19:00».
4. Что сделать: имя, телефон, «Согласен с условиями» → «Подтвердить бронь». Если запрошено дополнительное подтверждение — текст владельца, что и куда прислать.
5. Когда подтверждена: «Бронь подтверждена, когда отмечены все пункты» (+ «и владелец отметит залог / подтверждение»). Затем экран «✅ Бронь №… подтверждена», адрес, время заезда, «Получать сообщения в Telegram».

Обновление страницы — состояние с сервера. Ошибки простыми словами. Английский — P1.

## 15. Передача в проход 3 и минимальные общие изменения

**Точка передачи — одна:** `confirmBooking()` в транзакционном виде (раздел 4.5), вызываемая из `bookingLinks.submit / markDeposit / markExtraCheck`. После неё проход 4 ничего своего не делает:
- подготовка — `CleaningTask` из `confirmBooking`;
- водители — `dispatch.createForBooking` через журнал;
- «Сегодня», готовность, недочёты — `ops.js`;
- напоминания о заезде — `runReminders`;
- выплаты — `performerPayouts`;
- отмена — `cancelBooking()`.

**Изменения кода прохода 3 (только общие точки):**
1. `services/bookings.js`:
   - `withApartmentTx`, `releaseExpiredHolds`;
   - `isAvailable(tx?)` с правилом `holdUntil`;
   - `createBookingRequest` в транзакции с `holdUntil`;
   - `confirmBooking` — транзакция + `CleaningTask.autoKey` + журнал;
   - новая `cancelBooking()` (перенос из `operations.js`).
2. `routes/admin/operations.js`: PATCH дат — через `withApartmentTx`; отмена — через `cancelBooking()`.
3. `routes/public.js`: только `card`, `holdUntil`, продление при `/pay`.
4. `payments/index.js → applyPaymentResult`: оплата после истечения.
5. `routes/admin/workRequests.js → POST /repairs` с `blockDays`: через `withApartmentTx`.
6. `notifications/scheduler.js`: `runOutbox`, `reconcileBookings`, `releaseExpiredHolds` в тике.
7. `services/ops.js → todayView`: новые пункты (раздел 13).
8. `services/outbox.js` (новый): `enqueue(tx, …)`, `runOutbox()`.

## 16. Сценарии сбоев

| Сценарий | Безопасное поведение |
|---|---|
| Ссылка открыта дважды / в двух вкладках | Одно состояние с сервера; действия идемпотентны. |
| Форма отправлена дважды | Те же данные; `link.started` один раз. |
| Истекла или отозвана во время заполнения | Следующий запрос — 410, понятный экран. |
| «Подтвердить» ровно в `holdUntil` | Уже истекло (строгая граница `now < holdUntil`), 410; бронь отменена, даты свободны. |
| Двойной «Подтвердить» / повтор после таймаута клиента | Одна условная запись побеждает; второй получает «подтверждена». Одна бронь, одна подготовка, один заказ. |
| Процесс упал после коммита подтверждения | Бронь, подготовка и строки журнала уже в базе (одна транзакция). После перезапуска `runOutbox` при старте или по планировщику создаёт заказы водителям и шлёт уведомления; повторы гасят уникальные ключи. |
| Процесс упал до коммита | Транзакция откатилась: бронь осталась `request`, гость повторяет «Подтвердить». |
| Две копии сервера одновременно бронируют одни даты | Блокировка строки квартиры выстраивает их по очереди; если путь её не взял — `EXCLUDE` отклоняет вторую запись → 409. |
| Публичная бронь против создания ссылки на те же даты | То же: одна побеждает, вторая 409. |
| Смена дат против новой брони | Обе в `withApartmentTx`; база не допустит пересечения. |
| Квартиру закрыли ремонтом | Проверка в транзакции подтверждения → 409, `link.conflict`, «Критично». |
| Админ изменил даты | Гость видит новые; нужна новая галочка. |
| Гость вернулся позже | Видит сохранённое, продолжает, пока не истекло. |
| Неоплаченная заявка с сайта | Через 30 мин (или 20 мин после открытия оплаты) не держит даты; снимается лениво или планировщиком. |
| Оплата пришла после истечения | Даты свободны — бронь восстанавливается и подтверждается; заняты — «Оплата без брони — верните деньги». |
| Украден токен | «Новая ссылка» или «Отозвать»; документов в системе нет. |
| Перебор токенов | 256 бит + `linkGuard`. |
| Владелец или админ отменяет | `cancelBooking()`: даты свободны, ссылка закрыта, водителям отмена через журнал. |
| Строка журнала падает 5 раз | `failed` → «Критично» в «Сегодня», разбор вручную; бронь при этом уже подтверждена и с подготовкой. |

## 17. Тесты (обязательные)

Файл `server/tests/pass4.test.js`. Тесты гонок на PostgreSQL — `server/tests/pass4.pg.test.js` (запуск в `npm run test:pg`; на SQLite пропускаются с пометкой). Плюс проверки в `scripts/demo-e2e.py`.

**P0 — без них проход не принимается:**
1. Две одновременные брони одной квартиры на пересекающиеся даты → ровно одна, вторая 409.
2. Гонка из **разных копий приложения** на одной PostgreSQL: два отдельных `PrismaClient` (или два дочерних процесса `node`) одновременно создают пересекающиеся брони → одна; плюс прямая вставка в обход кода (`$executeRaw`) отклоняется ограничением `booking_no_overlap`.
3. Обычная публичная бронь против личной ссылки на те же даты → одна.
4. Смена дат брони против одновременной новой брони → пересечения нет.
5. Истечение ссылки: после `holdUntil` гость получает 410, бронь `cancelled`, `isAvailable` = true.
6. Подтверждение ровно в момент `holdUntil` → истекло (410), до него на 1 мс — подтверждено.
7. Повторный POST подтверждения → тот же ответ, одна бронь.
8. Повтор после таймаута клиента (первый запрос завершился на сервере, клиент не получил ответ) → «подтверждена», без вторых эффектов.
9. Падение процесса после подтверждения, до последующего действия: подменить `runOutbox` на падающий → бронь `confirmed`, `CleaningTask` есть, `TransferJob` нет, строка журнала `pending`.
10. Восстановление после перезапуска: новый экземпляр приложения → `runOutbox()` → `TransferJob` создан, уведомление отправлено; повторный прогон ничего не дублирует.
11. Нет дублей: после повторов, сверки (`reconcileBookings`) и двух прогонов журнала — ровно одна `CleaningTask` на бронь и один `TransferJob` на трансфер.
12. Отмена и истечение освобождают даты: новая бронь на те же даты проходит.
13. Паспорт и билет не блокируют: ссылка без `extraCheckRequired` подтверждается без каких-либо документов и отметок; с `extraCheckRequired` — только после «Подтверждение получено».
14. Публичная неоплаченная заявка не держит даты вечно: `paymentMethod ≠ card` → 400; заявка `card` после `holdUntil` не блокирует; оплата после истечения — восстановление или «оплата без брони».
15. Безопасность: в базе только хэш токена; неверный или короткий токен → 404 и счётчик `linkGuard`, после лимита — 429; исполнители → 403 на `/api/admin/booking-links/*`; гостевые ответы без внутренних id и без адреса до подтверждения.
16. Условия: без согласия, после смены дат (старый `termsHash`), без залога (B) → `missing`, бронь не подтверждена.

**P1:** этапы `stage/missing`; пункты «Сегодня» и их исчезновение после исправления; продление (граница 7 суток), новая ссылка (старый токен 404), отзыв; восстановление после обновления страницы; `outbox_failed` после 5 попыток; уведомления без повторов.

**E2E:**
- админ создаёт ссылку → гость подтверждает → бронь подтверждена → подготовка в календаре и «Сегодня»;
- негатив: истёкшая ссылка, двойной «Подтвердить», конфликт дат;
- ошибок в консоли нет.

## 18. План реализации (каждый шаг — коммит с тестами, проект рабочий после каждого)

0. **Фундамент занятости (общий с проходом 3).**
   - Миграция: `Booking.holdUntil`, `CleaningTask.autoKey`, `OutboxEvent`; для PG — `btree_gist` + `booking_no_overlap` и чистка данных.
   - Код: `withApartmentTx`, `releaseExpiredHolds`, правило `holdUntil` в `isAvailable/busyRanges`/календаре; все пути раздела 10.
   - Тесты P0 №1–4, 12 на SQLite и PG (`test:pg`). Регрессия 103/103.
1. **Надёжное подтверждение.** `services/outbox.js`, транзакционная `confirmBooking`, `cancelBooking`, `reconcileBookings`, запуск в `startScheduler` и при старте. Тесты P0 №9–11.
2. **Сайт: только оплата.** Только `card`, `holdUntil` 30 мин, продление при `/pay`, оплата после истечения, `payment_orphaned`. Тест P0 №14; поправить старые тесты и демо, которые создают заявки без `card`.
3. **Ссылка: модель и сервис.** `BookingLink`, `services/bookingLinks.js`, админ-API 6.1. Тесты P0 №5–8, 13, 15, 16.
4. **Гостевое API 6.2** + `linkKind` (`kind:'special'`) + вид на `/link/<token>`.
5. **Админка и «Сегодня»** (раздел 13).
6. **Уведомления** (раздел 12, первая версия).
7. **E2E, сид демо** (одна ссылка «ждём гостя», одна «ждём залог»), пересборка v2, ПЛАН.md, README_SERVER.md.
8. (Отдельно) настройка `minPrepMinutes`.
9. (Следующий маленький шаг) напоминания ответственному в Telegram.

## 19. Сознательно отложено

- Загрузка паспорта и билета в систему (`BookingDocument`, приватное хранение) — только по просьбе владельца (раздел 9).
- Миграционный учёт иностранцев, eQonaq — будущий этап, привязанный к заселению.
- Онлайн-залог через платёжную систему — после договора.
- Трансфер и ранний заезд со страницы ссылки — P1 (существующие эндпоинты по `Booking.token`).
- Английский язык страницы гостя — P1.
- Счётчики лимитов в Redis (`linkGuard` в памяти процесса) — перед запуском нескольких копий; на корректность брони не влияет.
- Автоматический возврат денег — не делаем.
- Регистрация гостя, Airbnb/iCal, CRM, чат — не делаем.

## 20. Риски и вопросы

### Технические риски (с решением)
- **Prisma и `EXCLUDE`:** Prisma не описывает такие ограничения в схеме. Ограничение живёт только в ручной SQL-миграции PG. Для PostgreSQL нельзя использовать `prisma db push` (снёс бы ограничение); в проекте и так `migrate deploy`. Тест P0 №2 проверяет, что ограничение есть.
- **`linkGuard` в памяти процесса:** при нескольких копиях лимит считается на каждую отдельно. На двойную бронь не влияет; Redis — перед масштабированием.
- **Ленивое снятие удержаний:** благодаря правилу `holdUntil > now` в чтениях истёкшее удержание не мешает, даже если ещё не снято.
- **Оплата после истечения** — редкий ручной возврат; виден в «Сегодня».

### Вопросы, которые действительно нужны владельцу
1. **Может ли администратор (не только владелец) ставить в личной ссылке свою цену, отличную от обычной?** Пока владелец не ответил, своя цена доступна только владельцу; администратор создаёт ссылку по обычной цене. На реализацию это не влияет: проверка роли в одном месте.

Остальное, что раньше было вопросами, решено так:
- паспорт и билет — решение владельца (необязательны, по выбору для каждой ссылки), срок хранения не нужен;
- срок ссылки, удержание сайта, пороги, 120 мин подготовки — технические значения по умолчанию;
- залог — сумму вводит админ в ссылке, способ получения вне системы, в системе только отметка «Залог получен»;
- подтверждение сразу или после проверки — выбирается для каждой ссылки флагом «Нужно дополнительное подтверждение»;
- кто создаёт ссылки — уже решено (владелец или администратор).
