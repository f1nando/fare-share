# Fare Share — готовность приложения и план проверок

Снимок состояния: **30 сентября 2026**.

Текущий публичный контур `https://ownataxi.com/` является **mainnet test-only**, а не production launch:

- Program ID: `GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4`;
- Collection: `5DwDHVk2ciBi4J9rLAxEpoqea26WJpwd9Xbu31N5nroP`;
- test token: `4fg5Nh2wjVddSfDPW1AATQ9Tvmdc1Np1pBQQGL4Mpump` (`TAXI`);
- mint prices: `1 / 3 / 10 / 30` lamports;
- эти Program ID, Collection и token нельзя переносить в production.
- следующая версия хранит USD targets и принимает динамически рассчитанный `$FARE` raw amount по короткой backend-signed quote; текущий публичный test deployment остаётся историческим SOL-вариантом до отдельного релиза.

## Обозначения

- ✅ **Готово** — реализовано и подтверждено focused-тестом или реальной mainnet-транзакцией.
- 🟡 **Частично** — реализовано, но не завершён пользовательский или эксплуатационный smoke.
- ⬜ **Не проверено** — нужен тест, а не обязательно новая разработка.
- ❌ **Не готово** — функция отсутствует или является намеренным прототипом.
- 🛑 **Production blocker** — до настоящего запуска обязательно закрыть.

## 1. Краткий итог

### Уже доказано

- ✅ Solana-программа опубликована, работает с Metaplex Core NFT и сохраняет upgrade authority.
- ✅ Mint, автоматический выбор варианта, transfer, reward calculation, Claim 10, Repair 8 и cleanup сожжённых NFT проходили в mainnet.
- ✅ Реальная цепочка creator fees → FeeVault → split → swaps → покупка `$TAXI` → burn → распределение наград работает.
- ✅ 10% SOL поступают на Team wallet; основной парк, trainee pool, burn и четыре xStock-резерва разделяются контрактом.
- ✅ MongoDB используется как восстанавливаемый публичный read-model; деньги и начисления остаются в Solana.
- ✅ Публичные страницы и основные API сейчас отвечают HTTP 200.
- ✅ Два разных владельца и веса `1` и `10` отображаются в публичном fleet/leaderboard.

### Основные незакрытые пункты

- 🛑 Текущий контур test-only, sale открыта с почти бесплатным mint и должна быть поставлена на pause после ручных тестов.
- 🛑 Worker выключен и имеет `0 SOL`; автоматическое постоянное распределение сейчас не работает.
- 🛑 Требуется ротация или жёсткое ограничение ранее раскрытого Helius API key.
- 🛑 Для production нужны новые Program ID, Collection, token, цены, конфигурация и отдельный release gate.
- 🟡 Claim новой двухмашинной конфигурации после rounding fix успешно симулируется, но пользовательская Phantom-транзакция ещё не подтверждена.
- 🟡 Малые Jupiter-маршруты для xStocks нестабильны: в последнем цикле GOOGLx и AMZNx не купились, SOL безопасно остался в отдельных резервах.
- 🟡 Branded Mint frontend теперь содержит activation/claim trainee, но изменение ещё нужно опубликовать и проверить с реальной кампанией.
- 🟡 Красное предупреждение о пустом Team wallet реализовано в commit `2cbbfd0`, но ещё не опубликовано.
- ❌ Встроенный Market — только явно обозначенный UI prototype без listing и checkout.

## 2. Публичные страницы

| Область | Статус | Что подтверждено | Что ещё проверить |
|---|---|---|---|
| Landing `/` | 🟡 | Страница опубликована, live treasury/fleet данные подключены | Desktop/mobile visual smoke, все CTA и якоря, console errors |
| Mint `/mint/` | 🟡 | Реальный mint через Phantom прошёл; class выбирает пользователь, variant выбирает serial | Повторный свежий mint после исправления Team wallet; quantity `2+`; reject/cancel; sold-out/paused states |
| Garage `/garage/` | 🟡 | Точные metadata/image, serial, class, durability и rewards отображаются; анимация без runtime headlights | Claim после последнего распределения; single/batch repair; ошибка недостатка SOL; обновление после transfer/burn |
| Leaderboard `/leaderboard/` | ✅ | Два владельца ранжируются по active weight из finalized read-model | Mobile table и connected-wallet `YOU` dock |
| Trade `/trade/` | 🟡 | Два реальных buy→sell цикла прошли; live token/stage/API доступны | Phantom reject, недостаток SOL/token, slippage/expired quote, HALF/MAX, SSE reconnect, mobile chart |
| Market `/market/` | ❌ | Честно обозначен как non-functional prototype | Для production: либо Magic Eden URL, либо скрыть Buy-like элементы; внутренний checkout не реализован |
| Docs `/docs/` | 🟡 | Механика наград и риски описаны | Финальная сверка со production-адресами, token ticker и фактическим trainee UX |
| FAQ `/faq/` | 🟡 | Основные пользовательские объяснения опубликованы | Финальная copy/legal сверка |
| Terms / Privacy / Disclaimer | 🟡 | Страницы существуют и доступны | Юридическая проверка перед production launch |
| Header wallet | ✅ | Connect и настоящий Wallet Standard disconnect реализованы | Mobile connect/disconnect и переход между страницами после подключения |
| Admin `/admin/` | 🟡 | Auth, status, fee claim/deposit, Team wallet, pause/rescue и live balances реализованы | Опубликовать `2cbbfd0`; проверить warning на тестовом недостаточно funded адресе без смены on-chain Team wallet |

## 3. Wallet и mint

- ✅ Wallet Standard connect используется без передачи private key backend.
- ✅ Disconnect вызывает wallet feature, а не только очищает UI state.
- ✅ Phantom-safe порядок multi-signer mint исправлен: wallet подписывает до asset signer.
- ✅ Mint создаёт Core Asset и Machine PDA, записывает serial/class/variant.
- ✅ Вариант выбирается как `(serial - 1) mod 4`; пользователь выбирает только класс.
- ✅ Caps и weights зафиксированы: `[1000,300,100,25]` и `[1,3,10,30]`.
- ✅ Mint receipt сохраняется в MongoDB после finalized транзакции.
- ✅ Если MongoDB-запись не прошла после успешного mint, UI сообщает о частичном успехе.
- ⬜ Повторить fresh mint из Phantom после закрытия старого красного запроса.
- ⬜ Проверить последовательный mint quantity `2` или `3`, включая второе подтверждение Phantom.
- ⬜ Проверить отмену пользователем до первой транзакции и между транзакциями quantity mint.
- ⬜ Проверить недостаток SOL с понятной ошибкой и без ложной MongoDB-записи.
- ⬜ Проверить paused state: кнопка отключена, транзакция не строится.
- ⬜ Проверить class sold-out state на изолированном тесте; текущие caps вручную не исчерпывать.

## 4. Garage, ownership, Claim и Repair

- ✅ Fleet загружается по подключённому wallet и сверяется с finalized Solana/DAS.
- ✅ Canonical NFT image и metadata используются без подмены похожими assets.
- ✅ Claim одной и до 10 машин реализован.
- ✅ Repair одной и до 8 машин реализован; repair сжигает `$TAXI`.
- ✅ Durability определяет working/idle состояние.
- ✅ Накопленные награды принадлежат NFT и следуют за asset при transfer.
- ✅ Burn Core NFT обнаруживается worker; Machine закрывается, вес и unclaimed rewards возвращаются в pool.
- ✅ Реальный burn cleanup 16 старых NFT выполнен; активный вес уменьшился корректно.
- ⬜ **Следующий обязательный пользовательский smoke:** подтвердить уже успешно симулированный Claim одной из двух текущих машин через `/garage/`.
- ⬜ После Claim сверить пять destination ATA, Machine claimable и MongoDB history.
- ⬜ Проверить Claim при отсутствии одного или нескольких destination ATA.
- ⬜ Проверить single Repair через текущий Garage и точное изменение durability/burn.
- ⬜ Проверить batch-кнопки на кошельке с числом машин выше лимита и повтор для остатка.
- ⬜ Проверить Garage сразу после внешнего transfer NFT без ручного изменения MongoDB.
- ⬜ Проверить понятное состояние при временной недоступности DAS/RPC/MongoDB.

## 5. Экономика и распределение

- ✅ `collect_fees` делит SOL по утверждённой модели:
  - 45% — покупка `$TAXI` для NFT fleet;
  - 5% — покупка `$TAXI` для trainee pool;
  - 20% — покупка и burn `$TAXI`;
  - 20% — четыре xStocks по 5%;
  - 10% — Team wallet.
- ✅ Последний тестовый депозит: `0.084288938 SOL`, эквивалент примерно `$10` по зафиксированному курсу.
- ✅ Покупка `$TAXI` и `BurnChecked` подтверждены finalized-транзакцией.
- ✅ В последнем цикле куплены и распределены `$TAXI`, UBERx и TSLAx.
- ✅ При отсутствии маршрута резерв не теряется и не смешивается с другими assets.
- ✅ Веса двух активных машин составляют `1 + 10 = 11`.
- ✅ Машина, активированная в середине периода, получает только долю за время после activation event.
- ✅ Исправлено двойное использование accumulator rounding dust; test-only program upgraded, недостающие `6 raw TSLAx + 2 raw GOOGLx` восстановлены, fresh Claim simulation — PASS.
- 🟡 GOOGLx reserve: `0.009495368 SOL`; AMZNx reserve: `0.010495368 SOL` после последнего цикла.
- ⬜ Повторить worker cycle, когда безопасные Jupiter routes для GOOGLx/AMZNx доступны.
- ⬜ Проверить следующий полный период при неизменных двух машинах: относительное распределение должно соответствовать весам `1:10` с учётом округления.
- ⬜ После распределения выполнить Claim и сверить сохранение обязательств `vault balance >= obligations` для каждого asset.

## 6. Creator fees и Trade

- ✅ Pump fee-sharing проверен: `2NUN… = 100%`.
- ✅ Два реальных buy→sell цикла создали creator fees.
- ✅ Creator fee claim на admin wallet выполнен.
- ✅ Admin deposit в контракт идемпотентен через operation ID и MongoDB lock/reconciliation.
- ✅ Trade строит транзакцию backend, но подписывает и отправляет её wallet пользователя.
- ✅ Live trades, holders, candles, balance и SSE endpoints реализованы.
- ⬜ Проверить повторный fee claim при нулевой доступной сумме.
- ⬜ Проверить восстановление admin operation после browser refresh/network timeout.
- ⬜ Проверить trade quote expiration и невозможность повторно использовать устаревший quote ID.
- ⬜ Проверить buy/sell после Pump graduation; сейчас token находится на стадии `bonding_curve`.
- ⬜ Проверить индексатор после backend restart и отсутствие дублей по signature.

## 7. Trainee campaigns

- ✅ On-chain activate/claim, backend voucher, подпись Ed25519, expiry и защита от повторной кампании реализованы.
- ✅ Campaign/rate-limit/backend tests существуют.
- 🟡 Docs и landing рассказывают о trainee campaign.
- ✅ В branded `/mint/` добавлены code word, активация временного непередаваемого trainee NFT, список активаций и отдельный Claim; внутренний campaign ID пользователю не показывается.
- ⬜ Опубликовать новый trainee UI и проверить его с реальной тестовой кампанией.
- ⬜ Выполнить end-to-end smoke: создать campaign → получить voucher → activate → дождаться reward → claim.
- ⬜ Проверить wrong keyword, expired campaign, повторную активацию и rate limit.

## 8. Backend и MongoDB

- ✅ `/api/health`, `/api/token`, `/api/public/overview` доступны.
- ✅ Fleet, mint receipts, earning history, leaderboard и Market read-model реализованы.
- ✅ Solana является источником истины; MongoDB не может назначить или изменить награды.
- ✅ Admin auth использует session cookie, CSRF и origin check.
- ✅ Ограничения request body и rate limits покрыты focused backend tests.
- 🟡 Production backup заявлен в архитектуре, но фактический restore drill в текущем контуре не зафиксирован.
- ⬜ Проверить restart backend и восстановление trade/public indexer cursor.
- ⬜ Выполнить MongoDB restore drill в отдельную database name без касания текущей базы.
- ⬜ Проверить TTL/indexes и рост history/operations коллекций на реальных данных.
- ⬜ Добавить внешний uptime check для `/api/health` и alert на worker failures/долго не обработанные reserves.

## 9. Admin и аварийное управление

- ✅ Login/logout/session expiration реализованы.
- ✅ CA inspect/bind проверяет Pump creator, SOL quote и запрещённые fee modes.
- ✅ Team wallet можно менять on-chain с подтверждением.
- ✅ Pause/unpause и emergency rescue реализованы и проходили controlled smoke.
- ✅ Dashboard показывает protocol, queues, vaults, obligations и balances по машинам.
- ✅ Локально реализовано красное предупреждение, если Team wallet ниже rent-exempt minimum.
- ⬜ Опубликовать commit `2cbbfd0` отдельным разрешённым deployment.
- ⬜ После публикации проверить отсутствие warning на текущем funded Team wallet.
- ⬜ Проверить warning через unit/API fixture; не менять действующий Team wallet ради визуального теста.
- ⬜ Проверить неверный пароль, CSRF, чужой Origin, session expiry и logout в production browser.
- ⬜ Настроить alert, если worker неуспешен несколько циклов или reserve остаётся необработанным.
- ⚠️ Emergency rescue не запускать в обычном smoke: он требует pause, точной сверки obligations и плана migration.

## 10. Автоматизация и worker

- ✅ Permissionless worker умеет собирать Pump fees, выполнять независимые swaps, считать rewards, чистить burn и stale events.
- ✅ Ошибка одного xStock route не блокирует остальные assets.
- ✅ Неиспользованный временный worker SOL возвращался admin; worker снова `0 SOL`.
- 🛑 Постоянный production worker сейчас не запущен и не профинансирован.
- ⬜ Определить минимальный operational balance и alert threshold worker.
- ⬜ Запустить worker как supervised service с restart policy только после решения по тестовому контуру.
- ⬜ Проверить, что одновременно работает ровно один плановый worker либо что параллельные permissionless cycles безопасно конфликтуют.
- ⬜ Проверить recovery после RPC timeout без двойного списания reserve.
- ⬜ Зафиксировать runbook для недоступных Jupiter routes: ждать, исключить проблемный DEX или вручную расследовать; не rescue обязательства.

## 11. Тесты и качество

- ✅ Есть Rust unit tests для reward math, event queues, token programs, vouchers, Core и swaps.
- ✅ Есть backend tests для worker, Jupiter, Pump, admin/auth, fees, metadata, setup, trade и limits.
- ✅ Есть protocol-client tests для account decoding, instruction building и wallet disconnect.
- ✅ Последние затронутые проверки: protocol dashboard tests, server typecheck и frontend build — PASS.
- 🟡 React-страницы почти не имеют component tests; главный риск проверяется вручную в browser.
- 🟡 Исторически зафиксированы пять несвязанных failures city simulation suite; они не относятся к Fare Share UI, но baseline нужно либо исправить, либо явно исключить из release suite.
- ⬜ Добавить минимальные component tests для Mint, Garage, Trade и Team wallet warning.
- ⬜ Добавить один browser smoke: connect → mint → Garage → claim.
- ⬜ Добавить browser smoke для paused/error states без реальных mainnet расходов.
- ⬜ Выполнить responsive smoke минимум на `390px`, `768px`, `1440px`.
- ⬜ Проверить Chromium + Safari/WebKit; Phantom mobile/deep-link — отдельно, если поддерживается launch scope.
- ⬜ Проверить keyboard navigation, focus, dialogs, status/error announcements и contrast.

## 12. Security и operations

- ✅ Secrets не должны попадать в frontend `VITE_*`, логи или Git.
- ✅ Authority сохранена; `--final` и отзыв upgrade authority запрещены.
- ✅ ProgramData rent остаётся recoverable; close возможен только по строгой процедуре из `DEPLOY.md`.
- ✅ Buyer и временный worker после тестов возвращались к `0 SOL`.
- 🛑 Ротировать/ограничить раскрытый Helius key и обновить server/local ignored environment.
- 🛑 Перед production создать и проверить отдельные production keypairs, backups и recovery recipient.
- ⬜ Проверить firewall, TLS renewal, server updates и доступ к `/etc/ownataxi/ownataxi.env`.
- ⬜ Подтвердить фактический MongoDB backup retention и тест восстановления.
- ⬜ Проверить, что admin endpoint недоступен с чужого Origin и cookie имеет production security flags.
- ⬜ Добавить наблюдение за SOL/token vault invariants, worker heartbeat, RPC/DAS/Jupiter errors и disk usage.
- ⬜ Провести focused независимое ревью денежного контура перед production, даже если полноценный аудит не планируется.

## 13. Production blockers

До настоящего production launch должны быть закрыты все пункты:

- [ ] Создать новый production Program ID и сохранить recoverable upgrade-authority/buffer procedure.
- [ ] Создать новую production Core Collection и подтвердить 16 canonical immutable metadata.
- [ ] Создать production token с утверждёнными Pump settings и `2NUN… = 100%` fee sharing.
- [ ] Установить `MINT_PRICES_USD_CENTS` (Economy `5000`) и финальный `$FARE` CA до `start_sale`; после старта изменить их нельзя.
- [ ] Проверить отказ mint quote при stale/no-liquidity/high-impact/divergent market data и мониторинг доступности Jupiter.
- [ ] Проверить атомарный mint: 100% `$FARE` приходит только в canonical ATA team wallet, неправильные mint/source/destination отклоняются, burn и reward-pool пополнение отсутствуют.
- [ ] Повторить preflight, ProgramData/authority/recovery dry-run и release manifest.
- [ ] Выполнить минимальный production smoke до открытия публичной продажи.
- [ ] Запустить профинансированный supervised worker и alerts.
- [ ] Ротировать Helius key и проверить production secrets.
- [ ] Подтвердить MongoDB backup + restore.
- [ ] Решить trainee UX и Market/Magic Eden scope.
- [ ] Провести юридическую проверку Terms/Privacy/Disclaimer и stock-related copy.
- [ ] Устранить устаревшие metadata/copy, включая формулировки про гарантированный доход или `stock returns`.
- [ ] Синхронизировать Git remote/release source только после отдельного разрешения на push.

## 14. Рекомендуемый порядок ближайшей проверки test-only контура

### Этап A — без транзакций

1. Открыть все публичные страницы на desktop и mobile; проверить navigation, console и network errors.
2. Проверить `/api/health`, token, overview, fleet, history, leaderboard, trade data и SSE.
3. Войти в admin; сверить Program ID, Team wallet, weights, obligations, reserves и worker state.
4. Проверить warning Team wallet через fixture/test после публикации `2cbbfd0`, не меняя on-chain recipient.

### Этап B — пользовательский flow с минимальным расходом

5. Подключить новый тестовый Phantom wallet.
6. Выполнить один Economy mint и дождаться появления точного NFT в Garage.
7. Проверить, что variant соответствует serial, а supply/read-model обновились.
8. Выполнить один Claim текущих наград и сверить token ATA + Machine state + history.
9. При наличии missing durability выполнить один Repair и сверить burn.
10. Перевести NFT между двумя тестовыми wallet и проверить ownership/rewards в Garage.

### Этап C — operator flow

11. Получить небольшие creator fees через один buy→sell cycle.
12. Admin claim с operation ID; обновить страницу во время/после операции и убедиться, что дубля нет.
13. Deposit в FeeVault и сверить 10% Team + пять reserves.
14. Временно профинансировать worker, выполнить один cycle и вернуть остаток SOL.
15. Если часть xStock route недоступна, подтвердить сохранность соответствующего reserve; не форсировать плохой route.
16. Выполнить второй Claim после нового распределения.

### Этап D — завершение теста

17. Поставить test-only protocol на pause.
18. Остановить worker и подтвердить его `0 SOL` либо утверждённый operational balance.
19. Снять finalized snapshot Program/ProgramData/authority/FeeVault/token obligations.
20. Не выполнять rescue или close без отдельного решения и строгой процедуры `DEPLOY.md`.

## 15. Критерий готовности текущего test-only приложения

Текущий этап можно считать полностью проверенным, когда:

- [ ] fresh mint проходит без Phantom red warning;
- [ ] NFT появляется в Garage с точной картинкой, serial и class;
- [ ] Claim после последнего распределения проходит и balances совпадают;
- [ ] один актуальный Repair проходит либо явно не нужен из-за полной durability;
- [ ] trade buy/sell и admin claim/deposit не создают дублей;
- [ ] недоступные xStock routes сохраняют SOL в правильных reserves;
- [ ] все ключевые desktop/mobile страницы не имеют blocking UI/console errors;
- [ ] admin Team wallet warning опубликован и проверен безопасным способом;
- [ ] после smoke test deployment снова поставлен на pause;
- [ ] test wallets/worker не хранят лишний SOL.

Это завершает проверку test-only версии, но **не заменяет отдельный production release checklist**.
