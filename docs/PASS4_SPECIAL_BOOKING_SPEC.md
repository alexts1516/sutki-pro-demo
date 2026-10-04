# Проход 4 — «Личная ссылка для особой брони» (спецификация, финальная редакция)

Статус: **СПРОЕКТИРОВАНО, НЕ РЕАЛИЗОВАНО — СЛЕДУЮЩИЙ ПРОХОД К РЕАЛИЗАЦИИ.** Редакция 3 (готовность к реализации) — 4 октября 2026. Ни одна строка ниже не описывает существующий код, кроме раздела 1 («что уже есть»). Проход 3 заморожен; код прохода 3 меняется только в общих точках, перечисленных в разделе 15.

**Главный принцип: второй системы броней нет.** Личная ссылка — вход в существующий `Booking`. Пока гость заполняет ссылку, бронь — обычная `request` со сроком удержания. Когда условия выполнены, вызывается существующая `confirmBooking()`. Дальше всё делает проход 3: подготовка, «Сегодня», готовность, трансфер, недочёты, выплаты.

**Редакция 3.** Добавлено решение владельца об индивидуальной цене (раздел 3а). Раздел 18 стал единым последовательным планом. Добавлены разделы 21 (миграции), 22 (SQLite и PostgreSQL), 23 (матрица приёмки), 24 (передача разработчику). Открытых бизнес-вопросов нет.

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
| Минимальное время подготовки между гостями | 120 мин; станет настройкой `minPrepMinutes` отдельной задачей вне прохода 4 (раздел 12а) | сейчас константа `PREP_MIN` в `src/routes/admin/ops.js` |

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
   - по желанию — имя и телефон гостя, индивидуальную цену (только с правом — раздел 3а), комментарий;
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

## 3а. Индивидуальная цена (решение владельца, 4 октября 2026)

- **Индивидуальная цена** — сумма брони по ссылке, отличная от стандартного расчёта `quote()` (цена за ночь × ночи + животные).
- По умолчанию ставить и менять её может **только владелец**.
- Владелец может явно дать это право конкретному администратору и забрать его. Сама роль «администратор» права не даёт.
- Каждое изменение индивидуальной цены администратором записывается в журнал: кто, когда, старая цена, новая цена, бронь и ссылка. Изменения владельца пишутся туда же: одинаковое правило проще и не вредит.

**Где хранится право.** В существующей модели `Membership` уже есть флаги на человека (`canDrive`, `paidAsDriver`), а поля, которые меняет только владелец, уже обрабатываются в `src/routes/admin/team.js` (`payoutPercent`, `payoutFixedKzt`, `paidAsDriver` видны и меняются только при `req.role === 'owner'`). Поэтому — одно поле `Membership.canSetLinkPrice Boolean @default(false)`:
- меняет его только владелец через существующий `PATCH /api/admin/team/:userId`;
- имеет смысл только для роли `admin` (для других ролей — 400);
- у владельца право есть всегда, флаг не нужен.
Настройка аккаунта не подходит: право выдаётся конкретному человеку.

**Где журнал.** Общего журнала аудита в проекте нет: есть только журналы своих сущностей (`RepairEvent`, `TransferEvent`) и журнал уведомлений (`NotificationLog`); ни один не подходит для броней. JSON-поле в ссылке можно незаметно переписать, и по нему неудобно искать. Поэтому — минимальная таблица только для добавления записей `BookingPriceChange` (раздел 5).

**Правила.**

| Действие | Кто может | Запись в журнал |
|---|---|---|
| Создать ссылку по стандартной цене | владелец, любой админ | нет |
| Создать ссылку с индивидуальной ценой | владелец; админ с `canSetLinkPrice` | да (`reason:'link_created'`, старая цена = стандартная) |
| Изменить цену активной ссылки (`PATCH /booking-links/:id/price`) | владелец; админ с `canSetLinkPrice` | да (`reason:'manual'`) |
| Сменить даты брони с индивидуальной ценой (существующий PATCH дат) | владелец, админ (как сейчас) | да (`reason:'dates_changed'`), если сумма изменилась. Сумма пересчитывается существующим правилом: цена за ночь брони × ночи + животные. При создании с индивидуальной ценой `nightlyKzt = round(totalKzt / ночи)`, поэтому пересчёт пропорционален. |
| Админ без права передаёт индивидуальную цену | — | 403 «Индивидуальную цену ставит владелец или администратор с его разрешения»; ничего не создаётся |
| Владелец забрал право | — | уже созданные цены не меняются; новые изменения этим админом — 403 |

Изменение цены меняет `termsHash`, поэтому гость должен снова согласиться с условиями (раздел 4.2). После подтверждения брони цену по ссылке менять нельзя — 409: дальше это обычная бронь прохода 3.

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

**Уточнения по итогам реализации шага 3 (4 октября 2026):**
- Повторная `isAvailable` в транзакции подтверждения на шаге 3 **не** делается: пересечение броней исключает база (заявка уже держит даты), а ремонт по правилам прохода 3 бронь не блокирует (только предупреждение) — иначе оплаченная бронь могла бы не подтвердиться. Проверка с ремонтом и `link.conflict` — для ссылки на шаге 6.
- Подготовка — `upsert` по `autoKey` (а не «найти, потом создать»); ручные подготовки (без `autoKey`) не трогаются.
- Действия журнала с водителями (`transfers.dispatch`, `transfers.cancel`) выполняются **в очереди квартиры** (`withApartmentLock`: на PostgreSQL — блокировка строки квартиры на время действия, без общей транзакции; на SQLite — `withLock`). Тест на PostgreSQL показал гонку «подтвердили и сразу отменили»: заказ водителю создавался после отмены. Теперь заказ создаётся строго до или после отмены; `transfers.dispatch` для неподтверждённой брони ничего не делает.
- Аренда строки журнала — условная запись `nextAttemptAt` (5 мин); ошибка → `attempts+1`, повтор через 1, 2, 4, 8 мин; после 5 — `failed` и пункт «Критично» `outbox_failed` в «Сегодня». Сразу после коммита журнал прогоняется только по строкам этой брони; нет нужного сервиса (`events`/`dispatch`) — строка ждёт планировщик.
- Сверка: ключи починки — `transfers.dispatch:<bookingId>:transfer:<transferId>` (одна починка на трансфер) и дополнительно `transfers.cancel:<bookingId>:job:<jobId>` для отменённой брони с незакрытым заказом. Уведомление «бронь подтверждена» сверка заново не шлёт (старым броням это было бы повторное сообщение гостю).
- В демо-сиде ~260 подтверждённых броней без подготовки (подготовки есть только на сегодня и завтра). Сверка создаёт им обязательные подготовки (лимит 200 за прогон); «Сегодня» и состояния квартир от этого не меняются (проверено), в календаре появятся подготовки в дни выезда — так и должно быть по правилу прохода 3. На шаге 10 сид лучше сразу создавать с подготовками.
- `releaseExpiredHolds` пишет строку `event:booking.hold_expired:<bookingId>` (получателей у события пока нет — уведомления на шаге 9).
- Повторная отмена — как в проходе 3: 409 «Бронь уже отменена», без каких-либо действий.
- Остаточный риск прохода 3 (не меняется по спецификации): `createForTransfer` создаёт заказ, затем пишет журнал заказа и рассылает предложение отдельными записями; падение между ними оставит заказ без рассылки — его покажет «Сегодня» (`transfer_no_driver`) и эскалация `runDispatch`.

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

```prisma
model BookingPriceChange {
  id               String   @id @default(cuid())
  accountId        String
  bookingId        String
  linkId           String?
  oldTotalKzt      Int
  newTotalKzt      Int
  standardTotalKzt Int /// стандартный расчёт quote() на тот момент — для сравнения
  reason           String /// link_created | manual | dates_changed
  byUserId         String?
  byName           String?
  byRole           String? /// owner | admin
  createdAt        DateTime @default(now())
  @@index([accountId, bookingId])
}
```
Таблица только добавляется: в коде нет изменения и удаления её записей.

Изменения существующих моделей (минимум):
- `Booking.holdUntil DateTime?` — до какого момента неподтверждённая бронь держит даты. Индекс `@@index([apartmentId, status, holdUntil])`. Срок ссылки хранится **только здесь**, у `BookingLink` своего `expiresAt` нет — одна правда.
- `Membership.canSetLinkPrice Boolean @default(false)` — право админа ставить индивидуальную цену (раздел 3а).
- `CleaningTask.autoKey String? @unique` — ключ автоматической подготовки (`turnover:<bookingId>`). Уникальность допускает много `NULL` (и SQLite, и PostgreSQL), старые данные не мешают.
- Обратные связи: `Booking.link BookingLink?`, `Account.bookingLinks`.

**Миграции.**
Миграций две (раздел 21): **M1 `pass4_foundation`** (шаг 1: `holdUntil`, `autoKey`, `OutboxEvent`, ограничение PG — **сделано**, `20261004143000_pass4_foundation`) и **M2 `pass4_booking_links`** (шаг 5: `BookingLink`, `BookingPriceChange`, `canSetLinkPrice`). Порядок для каждой:
1. SQLite: миграция в `prisma/migrations/` (`prisma migrate diff` от базы с прежними миграциями к схеме — `migrate dev` в неинтерактивной среде не работает).
2. PostgreSQL: `npm run pg:schema` → папка `prisma/postgres/migrations/<метка>_<имя>/` с тем же содержимым **плюс ручной SQL** (раздел 10):

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
| `POST /booking-links` | `{apartmentId, checkIn:'YYYY-MM-DD', checkOut, guestsCount, terms:'cash_on_arrival'|'deposit', depositKzt? (обязателен для deposit; 1…totalKzt), totalKzt? (индивидуальная цена — только владелец или админ с `canSetLinkPrice`, иначе 403; раздел 3а), expiresInHours?=24 (1…72), extraCheckRequired?=false, extraCheckNote?, guestName?, guestPhone?, note?}` | `201 {link: LinkOut, url}` — `url` только здесь. Ошибки: 404, 400 (прошлое, >90 ночей, гостей > maxGuests), 409 занято. |
| `GET /booking-links?status=active|all` | — | `[LinkOut]` (после ленивого истечения). |
| `GET /booking-links/:id` | — | `LinkOut`. |
| `POST /booking-links/:id/extend` | `{hours: 1…72}` | `LinkOut`; 409 если не `active`, удержание уже истекло или итог больше 7 суток. |
| `POST /booking-links/:id/rotate` | — | `{link, url}`; 409 если не `active`. |
| `POST /booking-links/:id/revoke` | `{reason?}` | `LinkOut`; повтор — 200. |
| `POST /booking-links/:id/deposit` | — | `LinkOut` (может стать `completed`); 409 если условия не `deposit` или ссылка не `active`; повтор — 200. |
| `PATCH /booking-links/:id/price` | `{totalKzt: Int > 0}` | `LinkOut` + запись `BookingPriceChange`; 403 без права; 409 если ссылка не `active`. Совпадает с текущей суммой — 200 без записи. |
| `GET /booking-links/:id/price-history` | — | `[BookingPriceChange]` (владелец и админ). |
| `POST /booking-links/:id/extra-check` | — | `LinkOut` (может стать `completed`); 409 если подтверждение не запрашивалось; повтор — 200. |

`LinkOut = {id, bookingId, bookingNumber, status, stage, missing, guest:{name, phone}, apartment:{id, title, code}, checkIn, checkOut, totalKzt, standardTotalKzt, individualPrice: bool, terms, depositKzt, extraCheckRequired, extraCheckNote, holdUntil, openCount, lastOpenedAt, guestStartedAt, submittedAt, depositReceivedAt, extraCheckedAt, completedAt, createdByName}`.

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
| Индивидуальная цена (создать или изменить) | ✔ | только с `canSetLinkPrice` (выдаёт и забирает владелец) | — | — |
| Выдать или забрать право на индивидуальную цену | ✔ | — | — | — |
| История изменения цены | ✔ | ✔ | — | — |
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
    if (isPostgres) await tx.$queryRaw`SELECT id FROM "Apartment" WHERE id = ${apartmentId} FOR NO KEY UPDATE`;
    await releaseExpiredHolds(tx, { apartmentId, now: new Date() });   // иначе EXCLUDE «увидит» истёкшее удержание
    return fn(tx);
  }, isPostgres ? { isolationLevel: 'ReadCommitted', timeout: 10000 } : { timeout: 10000 });   // SQLite знает только Serializable
  return isPostgres ? run() : withLock(`apt:${apartmentId}`, run);   // SQLite (разработка/демо): один процесс — очередь в памяти
}
```

- `isAvailable(tx, …)` принимает `tx` (по умолчанию — общий клиент для чтений вне записи).
- Ошибку базы `23P01` (нарушение `EXCLUDE`; в Prisma — `P2010` или `PrismaClientUnknownRequestError` с этим кодом) превращать в `HttpError(409, 'Эти даты уже заняты')`.
- Проверено на шаге 1: при строго одновременной вставке двух пересекающихся броней PostgreSQL иногда отклоняет одну из них не кодом `23P01`, а `40P01` (deadlock detected — обе транзакции ждут незакоммиченную строку друг друга при проверке `EXCLUDE`). Двух броней всё равно не бывает. На шаге 2 `40P01` при записи брони тоже превращать в 409 (или один повтор транзакции); блокировка строки квартиры в `withApartmentTx` делает такой случай редким.
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

**Уточнения по итогам реализации шага 2 (4 октября 2026):**
- Блокировка — `FOR NO KEY UPDATE`, а не `FOR UPDATE`: транзакции квартиры так же упорядочены между собой, но не блокируют посторонние записи со ссылкой на квартиру (подготовки, трансферы, недочёты — внешний ключ берёт `FOR KEY SHARE`, с `FOR UPDATE` они ждали бы). Проверено тестом PG.
- `40P01` (взаимная блокировка) → один повтор всей транзакции, затем 409 «Эту квартиру сейчас меняют одновременно…». `P2028` (не дождались очереди) → тоже 409. Сырые ошибки базы клиенту не уходят: общий обработчик ошибок тоже превращает `23P01`/`40P01` в 409 (`src/lib/dbErrors.js`).
- Повтор при занятом номере брони (`P2002`) — повтором всей транзакции снаружи: внутри транзакции PostgreSQL после ошибки продолжать нельзя.
- На шаге 2 через `withApartmentTx` переведены: создание заявки (`createBookingRequest`, ею пользуется сайт; отдельного создания брони в админке в коде нет) и смена дат (`PATCH /bookings/:id`, вместе со сдвигом подготовки; водители — после коммита). Не переведены, сознательно:
  - `confirmBooking` — занятость не меняет (заявка уже держит даты в базе); в транзакцию переходит на шаге 3 вместе с подготовкой и журналом; иначе пришлось бы уже сейчас решать оплату после истечения (шаг 4);
  - отмена — только освобождает даты, `EXCLUDE` нарушить не может; `cancelBooking()` — шаг 3;
  - ранний заезд — меняет только время заезда, не даты (ограничение работает по датам);
  - ремонт с `blockDays` — бронь не проверяет и пересекаться с бронью может по правилам прохода 3 (предупреждение в «Сегодня»); блокировка квартиры здесь гарантий не добавляет. Ремонты по-прежнему учитываются в `isAvailable/busyRanges` (через `tx`).
- `releaseExpiredHolds` на шаге 2 только отменяет заявки с истёкшим сроком (в транзакции квартиры); строки журнала `event:booking.hold_expired` добавятся на шаге 3 (журнал), ссылки — на шаге 6.
- `withLock` вынесен в `src/lib/lock.js` для броней; копия в `services/defects.js` (проход 3) не тронута.

Других путей создания или изменения дат брони в коде нет: `prisma.booking.create` есть только в `createBookingRequest()`, а `seed.js` — не путь работы системы.

## 11. Удержание дат и истечение (общее для ссылки и сайта)

**Правило занятости:** бронь блокирует даты, если `status = 'confirmed'` или `status = 'request' AND (holdUntil IS NULL OR holdUntil > now)`. `holdUntil = null` — срок не задан (заявки до шага 4; миграция M1 выставила старым 24 ч): держит даты, как в проходе 3, и совпадает с базой (`EXCLUDE` считает любую `request`, а `releaseExpiredHolds` такие не снимает). С шага 4 все новые заявки получают срок. Функции `holdsDates()` / `blockingWhere()` в `services/bookings.js`. Меняется условие в `BLOCKING`-запросах `isAvailable()` / `busyRanges()` и в календаре. Запрос с `holdUntil` в прошлом даты **не держит**, даже если ещё не снят.

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

**Уточнения шага 4 (технические, сделано):**
- Неверный способ оплаты на публичном маршруте **отклоняется** (400 `CARD_ONLY`), а не заменяется молча: гость должен понять, что наличных на сайте нет. Без поля — карта. Способ оплаты, статус, `holdUntil`, `paymentStatus`, `source` ставит сервер; клиент их не задаёт. `GET /site` отдаёт `payments.offline: []`, `bookingMethod: 'card'`. Других публичных путей создания брони в коде нет (Telegram брони не создаёт).
- `POST /bookings/:token/pay` — в `withApartmentTx`: истёкшее удержание снимается, живое продлевается `extendHold()` (= `max(holdUntil, now + 20 мин)`; у подтверждённой и у заявки без срока — без изменений). Истёкшая или отменённая заявка — 409 («Время на оплату истекло — забронируйте заново» / «Бронь отменена»), платёж не создаётся; отказ возвращается из транзакции, чтобы снятие удержания закоммитилось.
- `applyPaymentResult` (успех с бронью) — одна `withApartmentTx`: условная запись платежа (проигравший повтор — no-op) → строка журнала `event:payment.succeeded:<paymentId>` (событие перенесено в журнал) → по состоянию брони:
  `request` → `paid` + общее ядро подтверждения `confirmRequestInTx` (то же, что в `confirmBooking`);
  `confirmed/completed` → `paid`;
  `cancelled` **по истечению** (признак — строка журнала `event:booking.hold_expired:<id>`) и `isAvailable(tx)` → назад в `request` → `confirmRequestInTx`;
  иначе (даты заняты **или** бронь отменил админ/гость) → бронь остаётся `cancelled`, `paymentStatus = 'paid'`, одна строка `event:payment.orphaned:<paymentId>`.
- Пункт «Сегодня» `payment_orphaned` (Критично): источник — строки журнала `event:payment.orphaned:*` аккаунта, `ref = paymentId` (один пункт на платёж). Пункт уходит, когда админ после ручного возврата ставит брони `paymentStatus = 'refunded'` (существующий PATCH). Рабочего процесса возврата нет.
- Пункт `awaiting_payment` не показывает заявки с истёкшим удержанием.

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
Проходу 4 не обязательно и в план прохода 4 не входит (отдельная маленькая задача). 120 мин — техническое значение по умолчанию, владелец сможет менять его в настройках.

## 13. Интерфейс владельца и админа (без нового раздела; детали — на усмотрение исполнителя)

- **«Брони»:** кнопка «＋ Личная ссылка» → форма в выдвижной панели (поля раздела 3) → после создания ссылка + «Скопировать» + готовый текст для мессенджера.
- **Секция «Ожидают гостя»** (на месте «Ждут оплаты гостем»): ссылки и неоплаченные заявки сайта — кому, квартира, даты, условия, «до …», этап, нужно ли действие.
- **Карточка брони** `source:'link'` — блок «Личная ссылка»:
  - что сделано: ✔ данные, ✔ согласие, — залог, — подтверждение;
  - срок;
  - действия: «Залог получен», «Подтверждение получено», «Продлить», «Новая ссылка», «Отозвать», «Скопировать напоминание».
- **Индивидуальная цена:** поле в форме и в карточке ссылки видно владельцу и админу с правом; рядом «стандартно: N ₸» и ссылка «История цены». В «Команде» у администратора переключатель «Может ставить индивидуальную цену» — виден и меняется только владельцем.
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
9. `routes/admin/team.js → PATCH /team/:userId`: поле `canSetLinkPrice` (только владелец, только для роли admin); в `GET /team` — поле видно владельцу.
10. `routes/admin/operations.js → PATCH /bookings/:id` (даты): если у брони есть ссылка и сумма изменилась — запись `BookingPriceChange(reason:'dates_changed')` в той же транзакции.

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
17. Индивидуальная цена:
    - админ без `canSetLinkPrice` → 403 при создании с ценой и при `PATCH /price`;
    - владелец выдал право → админ может, запись в `BookingPriceChange` (кто, когда, старая, новая, бронь, ссылка);
    - владелец забрал право → снова 403;
    - админ не может выдать право себе или другому (403);
    - смена дат брони с индивидуальной ценой → запись `dates_changed`;
    - после подтверждения `PATCH /price` → 409.

**P1:** этапы `stage/missing`; пункты «Сегодня» и их исчезновение после исправления; продление (граница 7 суток), новая ссылка (старый токен 404), отзыв; восстановление после обновления страницы; `outbox_failed` после 5 попыток; уведомления без повторов.

**E2E:**
- админ создаёт ссылку → гость подтверждает → бронь подтверждена → подготовка в календаре и «Сегодня»;
- негатив: истёкшая ссылка, двойной «Подтвердить», конфликт дат;
- ошибок в консоли нет.

## 18. План реализации — один последовательный порядок

Шаги идут строго друг за другом, параллельных веток нет. Каждый шаг — отдельный коммит; после каждого проект рабочий: `npm test` и `npm run test:memory` зелёные, `npm run test:pg` зелёный, начиная с шага 1. Интерфейс появляется только после шагов 1–4 (защита данных и транзакции). Номера тестов «P0 №…» — из раздела 17; коды «A…» — из матрицы раздела 23.

### Шаг 0. Исходная точка (без изменений)
- **Цель:** зафиксировать, что всё зелёное до начала.
- **Что меняется:** ничего.
- **Что НЕ меняется:** всё.
- **Готово, когда:** `npm test` 103/103, `npm run test:memory` 103/103, `npm run test:pg` 103/103 (локальный PostgreSQL 17), `scripts/demo-e2e.py` 58/58.
- **Тесты:** существующие.

### Шаг 1. Миграция фундамента (M1, раздел 21)
- **Цель:** поля и ограничения для удержания дат, уникальной подготовки, журнала отложенных действий и защиты от пересечений.
- **Что меняется:**
  - схема: `Booking.holdUntil`, `CleaningTask.autoKey @unique`, модель `OutboxEvent`;
  - миграции SQLite и PG; в PG — ручной SQL: `btree_gist` + `booking_no_overlap`;
  - чистка данных: старым `request` выставить `holdUntil`; при уже пересекающихся бронях — понятная ошибка миграции.
- **Что НЕ меняется:** поведение кода (новые поля пока не читаются), API, интерфейс, сид.
- **Готово, когда:** миграции применяются на пустой базе и на базе с сидом (SQLite и PG); все существующие тесты зелёные.
- **Тесты:** A-PG-1 (ограничение есть: прямая вставка пересекающейся брони через `$executeRaw` отклоняется кодом `23P01`), A-PG-2 (две брони встык, выезд = заезд, допустимы).

### Шаг 2. Транзакционная занятость — СДЕЛАН (уточнения — раздел 10)
- **Цель:** одна защита на всех путях, меняющих занятость.
- **Что меняется:**
  - `withApartmentTx`, `releaseExpiredHolds`, правило `holdUntil > now` в `isAvailable/busyRanges` и календаре;
  - перевод всех путей раздела 10 (кроме ссылки — её ещё нет) на `withApartmentTx`;
  - ошибка `23P01` → 409;
  - `withLock` переносится в `src/lib/lock.js`.
- **Что НЕ меняется:** статусы брони; `confirmBooking` по сути (только выполняется внутри транзакции); публичное API; «Сегодня»; интерфейс.
- **Готово, когда:** гонки на PG дают ровно одну бронь; старые тесты зелёные.
- **Тесты:** P0 №1–4, №12 (A-CON-1…4, A-EXP-3).

### Шаг 3. Надёжное подтверждение и отмена — СДЕЛАН (уточнения — раздел 4.5)
- **Цель:** бронь не остаётся подтверждённой без подготовки или без заказа водителям; нет дублей.
- **Что меняется:**
  - `services/outbox.js` (`enqueue`, `runOutbox` с арендой);
  - транзакционная `confirmBooking` (статус + `CleaningTask.autoKey` + строки журнала);
  - `cancelBooking()` (перенос из `operations.js`, в транзакции, отмена водителям — журналом);
  - `reconcileBookings()`;
  - запуск `runOutbox`, `reconcileBookings`, `releaseExpiredHolds` при старте и в `startScheduler`;
  - пункт «Сегодня» `outbox_failed`.
- **Что НЕ меняется:** `dispatch.createForTransfer` (только вызывается из журнала), шаблоны уведомлений, правила подготовки прохода 3.
- **Готово, когда:** имитация падения после коммита восстанавливается прогоном журнала; повторы ничего не дублируют.
- **Тесты:** P0 №7, №9–11 (A-CR-1…4, A-DUP-1…3).

### Шаг 4. Сайт — только с оплатой — СДЕЛАН (уточнения — конец раздела 11)
- **Цель:** неоплаченные заявки не держат даты вечно.
- **Что меняется:**
  - `public.js`: только `paymentMethod:'card'`, `holdUntil = +30 мин`, продление при `/pay`;
  - `applyPaymentResult`: оплата после истечения (восстановление или `payment.orphaned`);
  - пункт «Сегодня» `payment_orphaned`;
  - старые тесты и демо, создававшие заявки без `card`.
- **Что НЕ меняется:** провайдеры оплаты, суммы, процесс оплаты для гостя.
- **Готово, когда:** `cash` → 400; заявка после срока не блокирует; поздняя оплата обработана.
- **Тесты:** P0 №14 (A-LP-1…3, A-EXP-4).

### Шаг 5. Миграция ссылки и права цены (M2)
- **Цель:** данные ссылки, журнал цены, право админа.
- **Что меняется:**
  - схема: `BookingLink`, `BookingPriceChange`, `Membership.canSetLinkPrice`; миграции SQLite и PG;
  - `team.js`: поле `canSetLinkPrice` (меняет только владелец, только для роли admin; видно владельцу).
- **Что НЕ меняется:** остальное API команды, роли, вход.
- **Готово, когда:** миграции применяются; владелец выдаёт и забирает право; админ не может выдать его себе.
- **Тесты:** A-RT-3, A-RT-4.

### Шаг 6. Сервис ссылок и админ-API
- **Цель:** создание, состояние, продление, новая ссылка, отзыв, залог, подтверждение, индивидуальная цена с журналом; подтверждение через транзакционную `confirmBooking`.
- **Что меняется:**
  - `services/bookingLinks.js`, маршруты раздела 6.1;
  - `cancelBooking` закрывает ссылку;
  - запись `dates_changed` в PATCH дат.
- **Что НЕ меняется:** проход 3 после `confirmBooking`; гостевых маршрутов ещё нет.
- **Готово, когда:** все переходы раздела 4.3, кроме гостевых, работают через API; права цены соблюдаются.
- **Тесты:** P0 №5, №6, №12, №13, №15 (админская часть), №16, №17 (A-FN-1…6, A-EXP-1…3, A-RT-1…5, A-PR-1…6).

### Шаг 7. Гостевое API и страница гостя
- **Цель:** гость проходит ссылку без входа.
- **Что меняется:**
  - маршруты раздела 6.2 через `linkGuard`;
  - `linkKind` (`kind:'special'`, поиск по хэшу);
  - вид `special` в `public/link/link.js`.
- **Что НЕ меняется:** виды «задача» и «трансфер» на этой странице, лимиты `linkGuard`.
- **Готово, когда:** гость подтверждает бронь; повторы, таймаут и граница срока работают по разделу 4.3.
- **Тесты:** P0 №6–8, №15 (гостевая часть) (A-FN-7…9, A-CON-5, A-SEC-1…4).

### Шаг 8. Админка и «Сегодня»
- **Цель:** владелец и админ работают со ссылками в существующих экранах.
- **Что меняется:**
  - «Брони»: «＋ Личная ссылка», секция «Ожидают гостя», блок в карточке брони;
  - поле индивидуальной цены — только владельцу и админу с правом;
  - «Команда»: переключатель права (только владельцу);
  - пункты `link_*` в `todayView`.
- **Что НЕ меняется:** остальные экраны и правила «Сегодня» прохода 3.
- **Готово, когда:** весь путь проходится мышью; админ без права не видит поле цены, а API отвечает 403.
- **Тесты:** P1 из раздела 17 (A-UI-1…3).

### Шаг 9. Уведомления
- **Цель:** менеджеры узнают о событиях ссылки.
- **Что меняется:** шаблоны и обработчики `link.*`, `payment.orphaned` через журнал отложенных действий.
- **Что НЕ меняется:** существующие шаблоны, `deliver()`, `managerNotify`.
- **Готово, когда:** каждое событие уходит один раз (`dedupeKey`).
- **Тесты:** A-DUP-4.

### Шаг 10. Сид демо, E2E, сборка, документы
- **Цель:** приёмка прохода 4.
- **Что меняется:**
  - сид: одна ссылка «ждём гостя», одна «ждём залог»;
  - `scripts/demo-e2e.py`: счастливый путь и негативные сценарии;
  - `npm run demo:build`;
  - ПЛАН.md, README_SERVER.md, CURRENT_STATE.md.
- **Что НЕ меняется:** код из шагов 1–9 (только исправления найденных ошибок с тестом).
- **Готово, когда:** вся матрица раздела 23 зелёная; живой GitHub Pages обновлён.
- **Тесты:** вся матрица раздела 23.

После шага 10 — **стоп**. Напоминания в Telegram и настройка «Минимальное время подготовки между гостями» (раздел 12а) — не проход 4, а отдельные маленькие задачи.

## 19. Сознательно отложено

- Загрузка паспорта и билета в систему (`BookingDocument`, приватное хранение) — только по просьбе владельца (раздел 9).
- Миграционный учёт иностранцев, eQonaq — будущий этап, привязанный к заселению.
- Онлайн-залог через платёжную систему — после договора.
- Трансфер и ранний заезд со страницы ссылки — P1 (существующие эндпоинты по `Booking.token`).
- Английский язык страницы гостя — P1.
- Счётчики лимитов в Redis (`linkGuard` в памяти процесса) — перед запуском нескольких копий; на корректность брони не влияет.
- Telegram-напоминания об истекающей ссылке и настройка `minPrepMinutes` (раздел 12а) — отдельные маленькие задачи после прохода 4.
- Автоматический возврат денег — не делаем.
- Регистрация гостя, Airbnb/iCal, CRM, чат — не делаем.

## 20. Риски и вопросы

### Технические риски (с решением)
- **Prisma и `EXCLUDE`:** Prisma не описывает такие ограничения в схеме. Ограничение живёт только в ручной SQL-миграции PG. Для PostgreSQL нельзя использовать `prisma db push` (снёс бы ограничение); в проекте и так `migrate deploy`. Тест P0 №2 проверяет, что ограничение есть.
- **`linkGuard` в памяти процесса:** при нескольких копиях лимит считается на каждую отдельно. На двойную бронь не влияет; Redis — перед масштабированием.
- **Ленивое снятие удержаний:** благодаря правилу `holdUntil > now` в чтениях истёкшее удержание не мешает, даже если ещё не снято.
- **Оплата после истечения** — редкий ручной возврат; виден в «Сегодня».

### Вопросы к владельцу

Открытых бизнес-вопросов нет. Последний (индивидуальная цена) решён владельцем 4 октября 2026 — раздел 3а.

Остальное, что раньше было вопросами, решено так:
- паспорт и билет — решение владельца (необязательны, по выбору для каждой ссылки), срок хранения не нужен;
- срок ссылки, удержание сайта, пороги, 120 мин подготовки — технические значения по умолчанию;
- залог — сумму вводит админ в ссылке, способ получения вне системы, в системе только отметка «Залог получен»;
- подтверждение сразу или после проверки — выбирается для каждой ссылки флагом «Нужно дополнительное подтверждение»;
- кто создаёт ссылки — уже решено (владелец или администратор);
- индивидуальная цена — решено владельцем: только владелец или администратор с явным разрешением владельца, с журналом изменений (раздел 3а).

## 21. Минимальный набор изменений базы для прохода 4

Только это, без сущностей «на будущее» (`BookingDocument` и `minPrepMinutes` в проход 4 **не входят**).

| № | Миграция (шаг) | Изменение | Зачем |
|---|---|---|---|
| M1.1 | `pass4_foundation` (шаг 1) | `Booking.holdUntil DateTime?` + индекс `[apartmentId, status, holdUntil]` | срок удержания для заявок сайта и ссылок; одна правда о сроке |
| M1.2 | то же | `CleaningTask.autoKey String? @unique` | одна автоматическая подготовка на бронь |
| M1.3 | то же | модель `OutboxEvent` (`dedupeKey @unique`, индекс `[status, nextAttemptAt]`) | отложенные действия после коммита и восстановление |
| M1.4 | то же, **только PG**, ручной SQL | `CREATE EXTENSION IF NOT EXISTS btree_gist;` + `booking_no_overlap EXCLUDE …` (раздел 10) | гарантия базы против двойной брони |
| M1.5 | то же, данные | `UPDATE "Booking" SET "holdUntil" = now() + interval '24 hours' WHERE status='request' AND "holdUntil" IS NULL`; проверочный запрос на пересечения до создания ограничения | старые заявки не держат даты вечно; миграция не падает молча |
| M2.1 | `pass4_booking_links` (шаг 5) | модель `BookingLink` (`bookingId @unique`, `tokenHash @unique`) | ссылка |
| M2.2 | то же | модель `BookingPriceChange` | журнал индивидуальной цены |
| M2.3 | то же | `Membership.canSetLinkPrice Boolean @default(false)` | право админа на индивидуальную цену |

Порядок для PG: `npm run pg:schema` → папка в `prisma/postgres/migrations/` с той же меткой; M1.4 и M1.5 добавить в `migration.sql` руками. Для PG — только `migrate deploy` (никогда `db push`: он удалит `EXCLUDE`).

## 22. SQLite и PostgreSQL: что чем проверяется

SQLite — разработка, демо в браузере и быстрые тесты. PostgreSQL — продакшен.

| Можно проверить одинаково на обеих | Только PostgreSQL |
|---|---|
| вся бизнес-логика ссылки (переходы, `missing`, права, индивидуальная цена и журнал) | ограничение `EXCLUDE` и расширение `btree_gist` |
| правило `holdUntil` в занятости, ленивое истечение, граница `now < holdUntil` | `SELECT … FOR NO KEY UPDATE` строки квартиры (в SQLite не нужен и не выполняется) |
| транзакционное подтверждение (откат при ошибке внутри транзакции) | гонки из **разных процессов и копий** приложения на одной базе |
| уникальные ключи (`autoKey`, `transferId`, `dedupeKey`, `tokenHash`) | захват строк журнала несколькими копиями одновременно (аренда условной записью; `FOR UPDATE SKIP LOCKED` не используется и не нужен) |
| восстановление журнала после «падения» внутри одного теста | уровень изоляции `ReadCommitted` и ошибка `23P01` → 409 |
| гонки внутри **одного** процесса (очередь `withLock`) | применение ручной SQL-миграции (M1.4, M1.5) |

**Не считаются проверенными одними тестами SQLite** (обязателен `npm run test:pg`, файл `tests/pass4.pg.test.js`):
1. невозможность двойной брони при нескольких процессах (P0 №2);
2. наличие и работа `booking_no_overlap` (A-PG-1);
3. гонка смены дат и новой брони между процессами (P0 №4 на PG);
4. захват журнала двумя копиями без двойного выполнения (A-CR-5);
5. применимость миграции на непустой базе (A-PG-3).

## 23. Матрица приёмки прохода 4 (обязательная)

Проход 4 принят, только когда все строки зелёные. «SQ» — SQLite (`npm test`, `npm run test:memory`), «PG» — `npm run test:pg`, «E2E» — `scripts/demo-e2e.py` локально и на живом сайте.

| Группа | Код | Проверка | Где |
|---|---|---|---|
| Функции | A-FN-1 | создать ссылку (A — наличные, B — залог), состояние «ждём гостя» | SQ, PG |
| | A-FN-2 | гость: данные + согласие + «Подтвердить» → бронь `confirmed`, подготовка создана | SQ, PG |
| | A-FN-3 | B: без отметки «Залог получен» не подтверждается; после отметки — подтверждается | SQ, PG |
| | A-FN-4 | паспорт и билет не нужны; при `extraCheckRequired` — только после «Подтверждение получено» | SQ, PG |
| | A-FN-5 | смена дат админом сбрасывает согласие | SQ, PG |
| | A-FN-6 | отзыв, новая ссылка (старая 404), продление (граница 7 суток) | SQ, PG |
| | A-FN-7…9 | гостевая страница: GET, повторный вход, экран «подтверждено» с адресом и Telegram | SQ, E2E |
| Одновременность | A-CON-1 | две брони одной квартиры, пересекающиеся даты → одна | SQ, PG |
| | A-CON-2 | то же из разных процессов (`PrismaClient` ×2 или 2 процесса `node`) | **PG** |
| | A-CON-3 | публичная бронь против ссылки → одна | SQ, PG |
| | A-CON-4 | смена дат против новой брони → без пересечения | SQ, **PG** |
| | A-CON-5 | три одновременных «Подтвердить» → одна бронь, одна подготовка, один заказ | SQ, PG |
| Сбой и восстановление | A-CR-1 | падение после коммита: `confirmed` + подготовка + журнал `pending`, заказа нет | SQ, PG |
| | A-CR-2 | новый экземпляр приложения → `runOutbox` → заказ и уведомление | SQ, PG |
| | A-CR-3 | `reconcileBookings` достраивает подтверждённую бронь без подготовки | SQ, PG |
| | A-CR-4 | 5 неудач → `failed` → «Критично» в «Сегодня» | SQ |
| | A-CR-5 | две копии одновременно прогоняют журнал → каждая строка выполнена один раз | **PG** |
| PostgreSQL | A-PG-1 | `booking_no_overlap` отклоняет прямую вставку (`23P01`) | **PG** |
| | A-PG-2 | брони встык (выезд = заезд) допустимы | **PG** |
| | A-PG-3 | миграции применяются на пустой базе и на базе с сидом | **PG** |
| Регрессия прохода 3 | A-R3-1 | все прежние тесты (103) зелёные на SQ, memory и PG | SQ, PG |
| | A-R3-2 | прежние 58 проверок E2E зелёные | E2E |
| E2E | A-E2E-1 | счастливый путь ссылки до подготовки в календаре и «Сегодня» | E2E |
| | A-E2E-2 | истёкшая ссылка, двойной «Подтвердить», конфликт дат | E2E |
| | A-E2E-3 | ошибок в консоли нет | E2E |
| Права | A-RT-1 | исполнители → 403 на `/api/admin/booking-links/*` | SQ |
| | A-RT-2 | гостевые ответы без внутренних id и без адреса до подтверждения | SQ |
| | A-RT-3 | только владелец выдаёт и забирает `canSetLinkPrice`; админ себе — 403 | SQ |
| | A-RT-4 | флаг только для роли admin (другим — 400) | SQ |
| | A-RT-5 | токен: в базе только хэш; перебор → 404, затем 429 | SQ |
| Индивидуальная цена | A-PR-1 | админ без права: цена при создании → 403, ничего не создано | SQ |
| | A-PR-2 | админ без права: `PATCH /price` → 403 | SQ |
| | A-PR-3 | админ с правом: изменение + запись (кто, когда, старая, новая, бронь, ссылка) | SQ, PG |
| | A-PR-4 | право забрали → снова 403; старые цены не изменились | SQ |
| | A-PR-5 | смена дат брони с индивидуальной ценой → запись `dates_changed` | SQ |
| | A-PR-6 | после подтверждения `PATCH /price` → 409 | SQ |
| Истечение ссылки | A-EXP-1 | после `holdUntil` → 410, бронь `cancelled` | SQ, PG |
| | A-EXP-2 | ровно в `holdUntil` — истекла; за 1 мс до — подтверждается | SQ |
| | A-EXP-3 | отмена и истечение освобождают даты | SQ, PG |
| | A-EXP-4 | истёкшее, но не снятое удержание не блокирует занятость | SQ, PG |
| Поздняя оплата | A-LP-1 | `paymentMethod ≠ card` → 400 | SQ |
| | A-LP-2 | оплата после истечения, даты свободны → бронь восстановлена и подтверждена | SQ, PG |
| | A-LP-3 | оплата после истечения, даты заняты → `payment_orphaned`, «Критично» | SQ |
| Без дублей | A-DUP-1 | повтор «Подтвердить» и повтор после таймаута → одна бронь | SQ, PG |
| | A-DUP-2 | одна `CleaningTask` на бронь после повторов и сверки | SQ, PG |
| | A-DUP-3 | один `TransferJob` на трансфер после двух прогонов журнала | SQ, PG |
| | A-DUP-4 | каждое уведомление — один раз | SQ |
| Интерфейс | A-UI-1…3 | форма ссылки, «Ожидают гостя», переключатель права только у владельца | E2E |

## 24. Передача следующему разработчику

1. **Прочитать:**
   - `docs/CURRENT_STATE.md` (1 минута);
   - эту спецификацию целиком;
   - `docs/ПЛАН.md`, раздел «Проход 3» и «Приёмка Прохода 3» (что заморожено);
   - `server/README_SERVER.md` (запуск, тесты, PostgreSQL).
2. **Подготовить:** `cd server && npm install && npm test`; PostgreSQL 17 локально (`sudo pg_ctlcluster 17 main start`, пользователь `sutki/sutki`), `TEST_DATABASE_URL=postgresql://sutki:sutki@127.0.0.1:5432/sutki_test npm run test:pg`.
3. **Первый шаг:** шаг 0 (зафиксировать зелёное), затем шаг 1 — миграция фундамента.
4. **Порядок:** строго шаги 1 → 10 раздела 18, по одному коммиту на шаг, с тестами из колонки «Тесты».
5. **Остановиться и доложить архитектору:**
   - после каждого шага: зелёные тесты (SQ, memory, PG), хэш коммита, что сделано;
   - сразу, если найдено противоречие в спецификации или код не совпадает с её разделом 1;
   - сразу, если шаг требует менять проход 3 за пределами списка раздела 15;
   - сразу, если миграция M1 падает на существующих данных (пересекающиеся брони);
   - если нужен новый бизнес-ответ от владельца.
6. **Не делать:** загрузку документов, напоминания в Telegram, настройку `minPrepMinutes`, Airbnb/iCal, регистрацию гостя, изменения прохода 3 сверх раздела 15.
