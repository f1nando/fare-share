# Сценарий назначения `$FARE` и работы с pump.fun fees

Статус: backend, on-chain проверка direct creator и страница `/admin/` реализованы локально; mainnet smoke ещё не выполнен.

## Зафиксированные адреса и ограничения

- Получатель pump.fun Creator Fees: `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF`.
- Заказчик самостоятельно создаёт SOL-paired токен на pump.fun и указывает этот адрес direct creator.
- Кошелёк `2NUN…` должен использоваться только для одного `$FARE`: pump.fun vault агрегирует fees по creator, а не разделяет их по CA.
- Mayhem Mode, Cashback, Holder Rewards, изменяемая custom creator fee и Pump Fees sharing config для `$FARE` запрещены: такой токен не соответствует выбранному direct-creator flow.
- Приватный ключ `2NUN…` хранится только в server secret storage как `PUMP_FEE_RECIPIENT_SECRET_KEY`. Backend при запуске обязан получить из него public key и строго сравнить с зафиксированным адресом.

## 1. Подготовка до получения CA

1. Собрать и проверить SBF.
2. Deploy программы с сохранённой upgrade authority.
3. Выполнить `initialize` без `$FARE`; `Configuration.fare_mint` остаётся пустым.
4. Поднять закрытую админку, backend и MongoDB.
5. Не запускать NFT sale и FARE-зависимые worker jobs.

## 2. Проверка и безопасная настройка CA

Администратор вставляет CA и тикер в админке и сначала нажимает «Проверить».

Backend проверяет finalized on-chain состояние:

1. Mint существует и принадлежит поддерживаемому SPL Token Program.
2. Pump bonding-curve PDA действительно выведен из этого mint и принадлежит официальной Pump Program.
3. Токен имеет SOL quote.
4. `BondingCurve.creator` равен `2NUN…`.
5. Токен не использует Mayhem Mode, Cashback или Holder Rewards.
6. Custom creator fee равна нулю и не может редактироваться.
7. Активного fee sharing config нет.
8. Токен ещё не graduated. CA фиксируется до graduation, чтобы PumpSwap не успел получить несогласованного `coin_creator`.
9. On-chain `Configuration.fare_mint` ещё пуст.

Offsets, discriminators, account order и PDA seeds сверены с официальными Pump/PumpSwap/Pump Fees IDL в commit `e0687ae9b7e064a0f54efc7297c65eecfbba3a8f` от 2026-09-12. Дополнительно на finalized mainnet проверена реальная migrated пара `5xF68…pump`: 125-byte `BondingCurve`, 301-byte PumpSwap `Pool`, одинаковые `creator/coin_creator`, SOL quote и новые reward-флаги декодируются по этим layouts. Финальный `$FARE` всё равно проходит такую же проверку отдельно до фиксации.

Баланс fees не является доказательством права на fees: сразу после создания он может быть нулевым. Источником истины служат Pump/PumpSwap accounts.

После успешной проверки отдельное подтверждение вызывает `set_fare_mint`. Контракт повторно валидирует критичные Pump accounts и создаёт/проверяет canonical FARE vault. До `start_sale` protocol admin может повторить процедуру и заменить CA; после старта обычная замена блокируется, чтобы существующие начисления не указывали на другой mint. Смена после старта возможна только отдельной paused migration с переносом активов и обязательств.

До подтверждения вводятся CA и тикер. После finalized-транзакции эта пара сохраняется в MongoDB как единая runtime-конфигурация. Публичный endpoint отдаёт её только когда CA совпадает с on-chain `Configuration.fare_mint`; hero, trade и остальные страницы используют этот endpoint без пересборки frontend и без `TRADE_MINT`.

## 3. Закрытая админка

Админка доступна на отдельной странице `/admin/` и целиком закрыта логином и паролем.

Минимальная защита:

- пароль хранится только как `scrypt`/Argon2 hash, не в открытом виде;
- сессия — короткоживущая HttpOnly + Secure + SameSite=Strict cookie;
- login rate limit хранится в MongoDB;
- все изменяющие запросы проверяют Origin и CSRF token;
- ответы и логи никогда не содержат private key, пароль или session secret;
- после нескольких ошибок вход временно блокируется.

Админка показывает:

- зафиксированный CA и результат on-chain проверки;
- bonding-curve fees;
- PumpSwap fees;
- общую сумму, доступную к claim;
- SOL-баланс `2NUN…`;
- сумму последнего finalized claim;
- историю последних операций и ссылки на Solscan.

Состояние автоматически обновляется раз в 15 секунд и вручную кнопкой «Обновить».

## 4. Кнопка «Забрать fees»

1. Backend повторно проверяет, что on-chain CA и creator не изменились.
2. Читает обе независимые суммы: Pump bonding creator vault и PumpSwap creator vault.
3. Если обе суммы нулевые, транзакция не отправляется.
4. Серверный hot key `2NUN…` подписывает официальный claim flow.
5. До отправки backend требует нулевой исходный баланс creator WSOL ATA. ATA создаётся idempotently, обе fee-суммы поступают туда и разворачиваются в SOL закрытием ATA в той же атомарной транзакции. При постороннем WSOL claim блокируется.
6. После finalized определяется фактически полученная сумма по разнице баланса с учётом network fee.
7. В MongoDB записываются сумма, signature, slot, время и раздельные источники Pump/PumpSwap.
8. Поле «Направить в контракт» автоматически получает сумму этого finalized claim.

Каждый claim/deposit получает сохраняемый браузером operation ID. До отправки подписанной транзакции MongoDB атомарно сохраняет operation ID, ожидаемую signature и `lastValidBlockHeight`; одновременно разрешена только одна денежная операция. После неоднозначного RPC-ответа polling проверяет исходную signature до `finalized`, явной ошибки или истечения blockhash. Перезапуск backend и повтор с тем же ID не создают новую транзакцию, пока результат исходной неизвестен.

## 5. Кнопка «Направить в контракт»

Администратор может изменить автоматически подставленную сумму, но она должна быть положительной и не превышать доступный SOL за вычетом безопасного остатка на network fees.

Одна атомарная транзакция содержит:

1. перевод выбранной суммы с `2NUN…` в `FeeVault`;
2. немедленный вызов Taxi `collect_fees`.

Если распределение не проходит, перевод также откатывается. После finalized история сохраняет введённую сумму и signature.

`collect_fees` распределяет поступление по действующей схеме:

- 70% — FARE swap reserve;
- по 5% — четыре xStocks reserve;
- 10% — team account;
- остаток округления — FARE reserve.

В блоке `Protocol settings` администратор видит тот же настроенный
`$FARE` CA, который используется одновременно для наград и 20% burn-направления.
Там же можно on-chain инструкцией `set_team_account` заменить team wallet для
будущих 10% распределений и будущих NFT mint proceeds. Изменение не перемещает
ранее отправленные средства, требует CSRF-защищённую admin session и блокируется,
пока claim/deposit ожидает on-chain reconciliation.

В `Emergency control` protocol admin может поставить весь протокол на паузу.
Только после finalized pause доступен атомарный rescue всего доступного SOL из
`FeeVault` и полных балансов `$FARE`/четырёх xStock vault на явно введённый
recipient. UI требует текстовое подтверждение `RESCUE`; backend запрещает rescue
до pause и во время незавершённого claim/deposit. После rescue обычный unpause
через админку блокируется до завершения миграции пользовательских обязательств;
после проверки новой системы администратор должен явно ввести `MIGRATED`.

## 6. Автоматическая обработка

Solana-программа не может самостоятельно проснуться от обычного перевода SOL. Поэтому гарантированное немедленное распределение обеспечивается атомарной транзакцией «transfer + collect_fees».

Worker дополнительно проверяет `FeeVault` по расписанию и вызывает permissionless `collect_fees`, если кто-то перевёл SOL напрямую без второй инструкции. Затем worker выполняет FARE/xStocks swaps и расчёт rewards по существующим правилам.

Worker больше не должен автоматически claim-ить pump.fun fees: claim управляется кнопкой админки. Автоматизация начинается после поступления SOL в `FeeVault`.

## 7. История MongoDB

Каждая finalized операция хранит:

- `kind`: `claim` или `deposit`;
- CA на момент операции;
- raw lamports и отображаемую сумму SOL;
- signature и cluster;
- Pump/PumpSwap breakdown для claim;
- wallet balance before/after;
- `createdAt` и finalized slot.

Private keys, пароль, cookie и полные RPC payload в MongoDB не сохраняются.

Незавершённые операции отдельно хранятся в `admin_fee_operations` со статусами `executing/submitted/finalized/failed`. Уникальный sparse lock не допускает параллельные claim/deposit; finalized-история по-прежнему хранится в `admin_fee_actions` и защищена уникальной signature.

## 8. Блокирующие release gates

- подтверждён backup hot key `2NUN…`;
- `2NUN…` не используется creator-адресом других токенов;
- admin password hash/session secret установлены через secret storage;
- проверены direct creator, отсутствие cashback/sharing и SOL quote;
- CA зафиксирован on-chain ровно один раз;
- выполнен mainnet smoke: небольшая торговля → появление fee → claim → атомарный deposit/distribution → запись истории;
- `start-sale` выполняется только после этого smoke.
