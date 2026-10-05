# Pass 4 — фактическая приёмка шага 10

Дата: 5 октября 2026. Исходная точка: `main`, `d787ef6aafa39e0c3a7a9fa80cfd1c979d57e35a`, рабочее дерево чистое. Итоговый commit содержит этот отчёт; собственный хэш не вписывается, проверить `git log -1`.

**PASS 4 ЗАВЕРШЁН И ПРИНЯТ — LIVE DEMO ДОСТУПНО.** Публичное demo: [https://sutki-pro-demo.vercel.app/](https://sutki-pro-demo.vercel.app/). Live smoke выполнен **5 октября 2026**: desktop 1280×900 и 390×844, demo E2E 78/78, дополнительный smoke 26/26, ошибок консоли нет. GitHub repo остаётся **PRIVATE**, GitHub Pages не используется, тариф/visibility не менялись. Предыдущий Pages API 422 и HTTP 404 — историческая неудачная попытка публикации, текущую приёмку не блокируют.

## Объём и изменения

- Код продукта `server/src/`, схемы/миграции и правила Pass 3 не менялись; новые функции не добавлялись. Сгенерированный `v2/` включает уже реализованный интерфейс шагов 7–9, включая `link/special.js`.
- Seed: 3 cash_on_arrival-ссылки — «Ждём гостя», «Ждём дополнительное подтверждение», completed/confirmed. Поздний блокирующий ремонт у третьей брони оставляет бронь в силе и создаёт управленческое исключение в «Сегодня». Условия cash, без реквизитов, основной deposit-flow не вводился. Deposit compatibility проверен в прежних тестах.
- Даты относительно дня установки +45/+49/+53 суток, active hold 72 ч. Они переживают следующий день, затем истекают по существующему правилу. Бессрочных специальных удержаний нет. URL seed не хранится открытым; активному предложению можно выпустить новую ссылку существующим UI.
- Все confirmed обеих компаний имеют обязательную CleaningTask сразу, существующие подготовки сохранены, autoKey `turnover:<bookingId>`. После свежего seed `reconcileBookings().preps === 0`. Нет искусственного массового достраивания ~260 задач.
- Закрыт пробел доказательств A-CON-4: реальный PATCH дат против новой заявки в двух node-процессах, две гонки, разные PID, один победитель, другой 409, одно блокирующее бронирование. Это новый тест, не изменение продукта.
- Устранена нестабильность тестовой инфраструктуры: общий HTTP-хелпер использует один listener на Express-приложение. Дополнительный тест проверяет один порт на 1 последовательном + 20 параллельных запросах и ровно 21 вызов обработчика. Нет повторов запросов, ослабленных ожиданий или новых маскирующих skip. Изначальный пустой HTTP 404 воспроизвёлся и при последовательном запуске; первопричина окончательно не доказана. После изменения два полных последовательных набора SQLite/memory зелёные, PG зелёный. Диагностическая временная правка старого Pass 3 теста удалена; прежние ожидания сохранены.

## Прогоны

Node **24.19.0**, PostgreSQL **17.11**, Python Playwright + установленный Chrome. HTTP-наборы запускались последовательно.

| Проверка | Результат |
|---|---|
| SQLite `npm test` | 227 всего: **208 pass, 19 skip, 0 fail**; пропущены только PG-тесты |
| Memory `npm run test:memory` | **203 pass, 24 skip, 0 fail**; PG, SQL-миграции, проверки rollback не поддерживаются памятью |
| PostgreSQL `npm run test:pg` | **227/227, 0 skip, 0 fail**; настоящие отдельные процессы/соединения |
| Повтор SQLite → memory | Полные наборы вновь **208/19** и **203/24**, 0 fail |
| Реальный Pass 4 E2E | **29/29**: существующие 21 UI + 8 сквозных проверок карты/hold/подготовки/позднего ремонта/повтора/Today; JS errors 0 |
| Demo E2E | **78/78**, сохранены прежние 58 + 10 гостевых + 10 seed/extra-check/календарь/конфликт дат; console errors 0 |
| Прежние task/transfer links | **4/4** на настоящем одноразовом сервере, без входа, 1280/390 px, JS errors 0 |
| Ручная UI-проверка | Финальный `v2/` по пути `/sutki-pro-demo/v2/`: «Сегодня», «Брони», форма/карточка/drawer, копирование, право цены, guest submit/адрес, обычная оплата, задача/трансфер |
| Demo build | `npm run demo:build`, **f3216592962e**, `demo.js` 640 КБ; 78 E2E на фактической сборке |
| Live Vercel | **78/78 demo E2E + 26/26 smoke**, desktop/390 px, console errors 0; 15/15 файлов HTTP 200 и побайтно равны `v2/` |

У старых страниц реального сервера обнаружен **P2 `/favicon.ico` 404**. Regression-скрипт явно печатает URL и сообщение; любой иной console error или JS error проваливает тест. Это не скрытый skip и не утверждение о чистой консоли реального сервера. В статическом демо консоль чиста. Внешние водители в основном демо выключены по прежнему решению: их старая ссылка проверена отдельной fixture одноразовой серверной базы, восстановленной после теста; feature flag продукта не менялся.

## Все строки матрицы раздела 23

Локальные проверки серверных гарантий сохранены из приёмки `1cef730`; при публикации они не повторялись. Живая статическая сборка отдельно прошла demo E2E и smoke на Vercel. Это не приёмка боевой базы, банка или Telegram. Пути тестов ниже относительно `server/tests/`, скриптов — `server/scripts/`.

| Код | Проверка | Доказательства | Статус |
|---|---|---|---|
| A-FN-1 | создать ссылку (A — наличные, B — залог), состояние «ждём гостя» | pass4-step6.test.js, pass4-step7.test.js; pass4-e2e.py / demo-e2e.py для гостевой страницы | OK на обязательных поддерживаемых движках |
| A-FN-2 | гость: данные + согласие + «Подтвердить» → бронь `confirmed`, подготовка создана | pass4-step6.test.js, pass4-step7.test.js; pass4-e2e.py / demo-e2e.py для гостевой страницы | OK на обязательных поддерживаемых движках |
| A-FN-3 | B: без отметки «Залог получен» не подтверждается; после отметки — подтверждается | pass4-step6.test.js, pass4-step7.test.js; pass4-e2e.py / demo-e2e.py для гостевой страницы | OK на обязательных поддерживаемых движках |
| A-FN-4 | паспорт и билет не нужны; при `extraCheckRequired` — только после «Подтверждение получено» | pass4-step6.test.js, pass4-step7.test.js; pass4-e2e.py / demo-e2e.py для гостевой страницы | OK на обязательных поддерживаемых движках |
| A-FN-5 | смена дат админом сбрасывает согласие | pass4-step6.test.js, pass4-step7.test.js; pass4-e2e.py / demo-e2e.py для гостевой страницы | OK на обязательных поддерживаемых движках |
| A-FN-6 | отзыв, новая ссылка (старая 404), продление (граница 7 суток) | pass4-step6.test.js, pass4-step7.test.js; pass4-e2e.py / demo-e2e.py для гостевой страницы | OK на обязательных поддерживаемых движках |
| A-FN-7…9 | гостевая страница: GET, повторный вход, экран «подтверждено» с адресом и Telegram | pass4-step6.test.js, pass4-step7.test.js; pass4-e2e.py / demo-e2e.py для гостевой страницы | OK локально; live demo Vercel OK |
| A-CON-1 | две брони одной квартиры, пересекающиеся даты → одна | pass4-step2.test.js, pass4-step6.test.js, pass4-step7.test.js, pass4.pg.test.js (отдельные node-процессы) | OK на обязательных поддерживаемых движках |
| A-CON-2 | то же из разных процессов (`PrismaClient` ×2 или 2 процесса `node`) | pass4-step2.test.js, pass4-step6.test.js, pass4-step7.test.js, pass4.pg.test.js (отдельные node-процессы) | OK на обязательных поддерживаемых движках |
| A-CON-3 | публичная бронь против ссылки → одна | pass4-step2.test.js, pass4-step6.test.js, pass4-step7.test.js, pass4.pg.test.js (отдельные node-процессы) | OK на обязательных поддерживаемых движках |
| A-CON-4 | смена дат против новой брони → без пересечения | pass4-step2.test.js; новый PG A-CON-4 в pass4.pg.test.js: PATCH дат vs новая бронь, 2 процесса × 2 гонки | OK на обязательных поддерживаемых движках |
| A-CON-5 | три одновременных «Подтвердить» → одна бронь, одна подготовка, один заказ | pass4-step2.test.js, pass4-step6.test.js, pass4-step7.test.js, pass4.pg.test.js (отдельные node-процессы) | OK на обязательных поддерживаемых движках |
| A-CR-1 | падение после коммита: `confirmed` + подготовка + журнал `pending`, заказа нет | pass4-step3.test.js, pass4-step9.test.js, pass4.pg.test.js; 00-pass4-seed.test.js | OK на обязательных поддерживаемых движках |
| A-CR-2 | новый экземпляр приложения → `runOutbox` → заказ и уведомление | pass4-step3.test.js, pass4-step9.test.js, pass4.pg.test.js; 00-pass4-seed.test.js | OK на обязательных поддерживаемых движках |
| A-CR-3 | `reconcileBookings` достраивает подтверждённую бронь без подготовки | pass4-step3.test.js, pass4-step9.test.js, pass4.pg.test.js; 00-pass4-seed.test.js | OK на обязательных поддерживаемых движках |
| A-CR-4 | 5 неудач → `failed` → «Критично» в «Сегодня» | pass4-step3.test.js, pass4-step9.test.js, pass4.pg.test.js; 00-pass4-seed.test.js | OK на обязательных поддерживаемых движках |
| A-CR-5 | две копии одновременно прогоняют журнал → каждая строка выполнена один раз | pass4-step3.test.js, pass4-step9.test.js, pass4.pg.test.js; 00-pass4-seed.test.js | OK на обязательных поддерживаемых движках |
| A-PG-1 | `booking_no_overlap` отклоняет прямую вставку (`23P01`) | pass4.pg.test.js, pass4.test.js, pass4-m2.test.js (SQL EXCLUDE, встык, M1/M2 пустая/seed база) | OK на обязательных поддерживаемых движках |
| A-PG-2 | брони встык (выезд = заезд) допустимы | pass4.pg.test.js, pass4.test.js, pass4-m2.test.js (SQL EXCLUDE, встык, M1/M2 пустая/seed база) | OK на обязательных поддерживаемых движках |
| A-PG-3 | миграции применяются на пустой базе и на базе с сидом | pass4.pg.test.js, pass4.test.js, pass4-m2.test.js (SQL EXCLUDE, встык, M1/M2 пустая/seed база) | OK на обязательных поддерживаемых движках |
| A-R3-1 | все прежние тесты (103) зелёные на SQ, memory и PG | все прежние suites в полном наборе 227; прежние 58 проверок внутри demo-e2e.py | OK на обязательных поддерживаемых движках |
| A-R3-2 | прежние 58 проверок E2E зелёные | все прежние suites в полном наборе 227; прежние 58 проверок внутри demo-e2e.py | OK локально; live demo Vercel OK |
| A-E2E-1 | счастливый путь ссылки до подготовки в календаре и «Сегодня» | demo-e2e.py, pass4-e2e.py; локальная финальная сборка и одноразовый сервер | OK локально; live demo Vercel OK |
| A-E2E-2 | истёкшая ссылка, двойной «Подтвердить», конфликт дат | demo-e2e.py, pass4-e2e.py; локальная финальная сборка и одноразовый сервер | OK локально; live demo Vercel OK |
| A-E2E-3 | ошибок в консоли нет | demo-e2e.py, pass4-e2e.py; локальная финальная сборка и одноразовый сервер | OK локально; live demo Vercel OK |
| A-RT-1 | исполнители → 403 на `/api/admin/booking-links/*` | pass4-step5.test.js, pass4-step6.test.js, pass4-step7.test.js, security-adapters.test.js | OK на обязательных поддерживаемых движках |
| A-RT-2 | гостевые ответы без внутренних id и без адреса до подтверждения | pass4-step5.test.js, pass4-step6.test.js, pass4-step7.test.js, security-adapters.test.js | OK на обязательных поддерживаемых движках |
| A-RT-3 | только владелец выдаёт и забирает `canSetLinkPrice`; админ себе — 403 | pass4-step5.test.js, pass4-step6.test.js, pass4-step7.test.js, security-adapters.test.js | OK на обязательных поддерживаемых движках |
| A-RT-4 | флаг только для роли admin (другим — 400) | pass4-step5.test.js, pass4-step6.test.js, pass4-step7.test.js, security-adapters.test.js | OK на обязательных поддерживаемых движках |
| A-RT-5 | токен: в базе только хэш; перебор → 404, затем 429 | pass4-step5.test.js, pass4-step6.test.js, pass4-step7.test.js, security-adapters.test.js | OK на обязательных поддерживаемых движках |
| A-PR-1 | админ без права: цена при создании → 403, ничего не создано | pass4-step5.test.js, pass4-step6.test.js, pass4-step8.test.js; pass4-e2e.py | OK на обязательных поддерживаемых движках |
| A-PR-2 | админ без права: `PATCH /price` → 403 | pass4-step5.test.js, pass4-step6.test.js, pass4-step8.test.js; pass4-e2e.py | OK на обязательных поддерживаемых движках |
| A-PR-3 | админ с правом: изменение + запись (кто, когда, старая, новая, бронь, ссылка) | pass4-step5.test.js, pass4-step6.test.js, pass4-step8.test.js; pass4-e2e.py | OK на обязательных поддерживаемых движках |
| A-PR-4 | право забрали → снова 403; старые цены не изменились | pass4-step5.test.js, pass4-step6.test.js, pass4-step8.test.js; pass4-e2e.py | OK на обязательных поддерживаемых движках |
| A-PR-5 | смена дат брони с индивидуальной ценой → запись `dates_changed` | pass4-step5.test.js, pass4-step6.test.js, pass4-step8.test.js; pass4-e2e.py | OK на обязательных поддерживаемых движках |
| A-PR-6 | после подтверждения `PATCH /price` → 409 | pass4-step5.test.js, pass4-step6.test.js, pass4-step8.test.js; pass4-e2e.py | OK на обязательных поддерживаемых движках |
| A-EXP-1 | после `holdUntil` → 410, бронь `cancelled` | pass4-step6.test.js, pass4-step7.test.js, pass4.pg.test.js; demo-e2e.py | OK на обязательных поддерживаемых движках |
| A-EXP-2 | ровно в `holdUntil` — истекла; за 1 мс до — подтверждается | pass4-step6.test.js, pass4-step7.test.js, pass4.pg.test.js; demo-e2e.py | OK на обязательных поддерживаемых движках |
| A-EXP-3 | отмена и истечение освобождают даты | pass4-step6.test.js, pass4-step7.test.js, pass4.pg.test.js; demo-e2e.py | OK на обязательных поддерживаемых движках |
| A-EXP-4 | истёкшее, но не снятое удержание не блокирует занятость | pass4-step6.test.js, pass4-step7.test.js, pass4.pg.test.js; demo-e2e.py | OK на обязательных поддерживаемых движках |
| A-LP-1 | `paymentMethod ≠ card` → 400 | pass4-step4.test.js, pass4-step9.test.js, pass4.pg.test.js; pass4-e2e.py | OK на обязательных поддерживаемых движках |
| A-LP-2 | оплата после истечения, даты свободны → бронь восстановлена и подтверждена | pass4-step4.test.js, pass4-step9.test.js, pass4.pg.test.js; pass4-e2e.py | OK на обязательных поддерживаемых движках |
| A-LP-3 | оплата после истечения, даты заняты → `payment_orphaned`, «Критично» | pass4-step4.test.js, pass4-step9.test.js, pass4.pg.test.js; pass4-e2e.py | OK на обязательных поддерживаемых движках |
| A-DUP-1 | повтор «Подтвердить» и повтор после таймаута → одна бронь | pass4-step3.test.js, pass4-step7.test.js, pass4-step9.test.js, pass4.pg.test.js | OK на обязательных поддерживаемых движках |
| A-DUP-2 | одна `CleaningTask` на бронь после повторов и сверки | pass4-step3.test.js, pass4-step7.test.js, pass4-step9.test.js, pass4.pg.test.js | OK на обязательных поддерживаемых движках |
| A-DUP-3 | один `TransferJob` на трансфер после двух прогонов журнала | pass4-step3.test.js, pass4-step7.test.js, pass4-step9.test.js, pass4.pg.test.js | OK на обязательных поддерживаемых движках |
| A-DUP-4 | каждое уведомление — один раз | pass4-step3.test.js, pass4-step7.test.js, pass4-step9.test.js, pass4.pg.test.js | OK на обязательных поддерживаемых движках |
| A-UI-1…3 | форма ссылки, «Ожидают гостя», переключатель права только у владельца | pass4-e2e.py; ручные desktop 1280/390 px на финальном v2 | OK локально; live demo Vercel OK |

Дополнительно к кодам матрицы проверены поздний/ранний ремонт (step6/7/8), `link.started/completed/expired/conflict`, `payment.orphaned`, OWNER/ADMIN/BOTH, RU/EN, dedupe, retry одного неуспешного адресата и outbox_failed после пяти ошибок (`pass4-step9.test.js`, включён в каждый полный набор). Реальные сообщения/оплаты/файлы гостей не отправлялись.

## Ручная проверка и локальные свидетельства

- Desktop 1280×900: создание особой брони на стандартной цене → карточка → копирование URL → оформление гостем без входа → confirmed с адресом. «Сегодня» показывает поздний ремонт и ожидание доп. подтверждения; право цены сохранено через «Команду». Публичная demo-бронь оплачена и подтверждена, заказ водителям отправлен в демо-журнал.
- 390×844: форма помещается по ширине, вертикальная прокрутка drawer штатная; подтверждённая гостевая страница читается. Кнопка копирования проверена вручную desktop и E2E; waiting/expired — автоматизированные UI-проверки. Прежняя ссылка мастера открыта вручную; старая ссылка водителя — browser regression на обоих размерах. Горизонтального развала формы нет. Новый дизайн не делался.
- Временные логи текущей машины: `/private/tmp/sutki-pass4-repeat-sqlite.log`, `sutki-pass4-repeat-memory.log`, `sutki-pass4-final-pg.log`, `sutki-pass4-e2e.log`, `sutki-pass4-final-demo-e2e.log`, `sutki-pass4-link-regression.log`, `sutki-pass4-build.log`, `sutki-pass4-pages-enable.log`.
- Скриншоты: `/private/tmp/sutki-pass4-manual/form-390.png`, `guest-confirmed-390.png`; автоматические — `/private/tmp/sutki-pass4-final-demo-screenshots/`. Это локальные временные свидетельства, не опубликованные артефакты. Воспроизводимые команды — [README_SERVER.md](../server/README_SERVER.md).

## Публикация и live smoke — 5 октября 2026

- Vercel CLI 62.2.0, проект `sutki-pro-demo`, production deployment `dpl_2kStvjKND8Pb315Q3KYZmNu8jrTR`, состояние READY. Канонический URL выше публичен без авторизации. Не подключалась GitHub-интеграция.
- Временный deployment-каталог вне checkout: точная копия `v2/` из `1cef730` + только настройки static deployment (`framework: null`, пустые build/install commands, `outputDirectory: "."`, `trailingSlash: true`). Продуктовый код и `v2/` не менялись, пересборки не было. Сервер, база и клиентские секреты не добавлялись.
- 15/15 опубликованных файлов проверены HTTP 200 и побайтным сравнением: версия `f3216592962e`, SHA-256 `demo/demo.js`: `d1aa5ef80039fb7ba20f761469c137bbdf53d06c79361d774803aa20f94bb624`.
- `demo-e2e.py https://sutki-pro-demo.vercel.app/` — 78/78, console errors 0. Дополнительный smoke — 26/26 (13 на каждой ширине): главная без входа, «Сегодня», «Брони», форма без горизонтального переполнения, создание/карточка, copy URL, гостевая страница, confirmed/адрес, «Команда»/право цены, task link, transfer link, смена роли, console/HTTP errors 0. Основные `/`, `/admin/`, `/app/`, `/link/` и ассеты доступны.
- Внешние водители остаются выключены по прежнему решению. Старая transfer link проверена в изолированных браузерных данных на обеих ширинах, без изменения feature flag. Первоначальная подготовка fixture напрямую в памяти не сохраняла её перед переходом; после явного сохранения существующим механизмом тест прошёл. Это ошибка тестовой подготовки, продукт не исправлялся.
- Дополнительно вручную в браузере: desktop — создание/карточка/copy → гость → confirmed/адрес; 390 px — confirmed, администратор/«Сегодня», «Команда», внешняя task link. Данные demo у каждого посетителя свои; созданная ссылка из одного браузера не означает общую серверную бронь в другом.
- Временные свидетельства: `/private/tmp/sutki-vercel-deploy.log`, `/private/tmp/sutki-vercel-asset-check.json`, `/private/tmp/sutki-vercel-live-e2e.log`, `/private/tmp/sutki-vercel-live-smoke/results.json`; снимки `/private/tmp/sutki-vercel-live-smoke/confirmed-desktop.png`, `confirmed-390.png`, `form-390.png`, `transfer-link-390.png`. Это локальные временные файлы.

## Остаточные ограничения и остановка

- GitHub Pages на текущем тарифе приватного репозитория недоступен; публикация выполнена через разрешённый Vercel, блокер снят. Репозиторий остаётся PRIVATE.
- Функциональных P0/P1 по локальной и живой приёмке не найдено. P2 favicon реального сервера не исправлялся; в опубликованном статическом demo console errors 0.
- Telegram exactly-once невозможен при сбое после принятия сообщения Telegram до записи NotificationLog; сохранённый dedupe и retry проверены. Это задокументированное ограничение транспорта, не провал теста. Реальный Telegram проверялся заглушкой, боевой транспорт/банк не принимались.
- `linkGuard` локален процессу; DB EXCLUDE для PG живёт в ручной SQL-миграции (`db push` не применять); редкий orphaned payment требует ручного возврата; поздний ремонт решает менеджер. Ограничения Pass 3 сохраняются.

**PASS 4 ЗАВЕРШЁН И ПРИНЯТ — LIVE DEMO ДОСТУПНО. Следующий Pass не начат.**
