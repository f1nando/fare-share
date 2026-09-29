# Сценарий назначения `$FARE` и работы с pump.fun fees

Статус: backend, on-chain проверка direct creator и страница `/admin/` реализованы локально; mainnet smoke ещё не выполнен.

## Зафиксированные адреса и ограничения

- Получатель pump.fun Creator Fees: `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF`.
- Заказчик самостоятельно создаёт SOL-paired токен на pump.fun и указывает этот адрес direct creator.
- Кошелёк `2NUN…` должен использоваться только для одного `$FARE`: pump.fun vault агрегирует fees по creator, а не разделяет их по CA.
- Cashback, holder rewards и Pump Fees sharing config для `$FARE` запрещены: такой токен не соответствует выбранному direct-creator flow.
- Приватный ключ `2NUN…` хранится только в server secret storage как `PUMP_FEE_RECIPIENT_SECRET_KEY`. Backend при запуске обязан получить из него public key и строго сравнить с зафиксированным адресом.

## 1. Подготовка до получения CA

1. Собрать и проверить SBF.
2. Deploy программы с сохранённой upgrade authority.
3. Выполнить `initialize` без `$FARE`; `Configuration.fare_mint` остаётся пустым.
4. Поднять закрытую админку, backend и MongoDB.
5. Не запускать NFT sale и FARE-зависимые worker jobs.

## 2. Проверка и одноразовая фиксация CA

Администратор вставляет CA в админке и сначала нажимает «Проверить».

Backend проверяет finalized on-chain состояние:

1. Mint существует и принадлежит поддерживаемому SPL Token Program.
2. Pump bonding-curve PDA действительно выведен из этого mint и принадлежит официальной Pump Program.
3. Токен имеет SOL quote.
4. `BondingCurve.creator` равен `2NUN…`.
5. Токен не является cashback/holder-reward coin.
6. Активного fee sharing config нет.
7. Токен ещё не graduated. CA фиксируется до graduation, чтобы PumpSwap не успел получить несогласованного `coin_creator`.
8. On-chain `Configuration.fare_mint` ещё пуст.

Баланс fees не является доказательством права на fees: сразу после создания он может быть нулевым. Источником истины служат Pump/PumpSwap accounts.

После успешной проверки отдельное подтверждение «Зафиксировать CA» вызывает одноразовый `set_fare_mint`. Контракт повторно валидирует критичные Pump accounts, создаёт/проверяет canonical FARE vault и навсегда сохраняет mint. Повторная замена CA запрещена.

После finalized-транзакции тот же CA записывается в production `FARE_MINT`/frontend configuration. Если environment и on-chain CA различаются, backend и worker не запускаются.

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
5. PumpSwap WSOL безопасно разворачивается в SOL; нельзя закрывать ATA с посторонним WSOL-балансом.
6. После finalized определяется фактически полученная сумма по разнице баланса с учётом network fee.
7. В MongoDB записываются сумма, signature, slot, время и раздельные источники Pump/PumpSwap.
8. Поле «Направить в контракт» автоматически получает сумму этого finalized claim.

Повтор после неоднозначного RPC-ответа выполняется только после reconciliation исходной signature, чтобы не создать ошибочную запись или повторное действие.

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

## 8. Блокирующие release gates

- подтверждён backup hot key `2NUN…`;
- `2NUN…` не используется creator-адресом других токенов;
- admin password hash/session secret установлены через secret storage;
- проверены direct creator, отсутствие cashback/sharing и SOL quote;
- CA зафиксирован on-chain ровно один раз;
- выполнен mainnet smoke: небольшая торговля → появление fee → claim → атомарный deposit/distribution → запись истории;
- `start-sale` выполняется только после этого smoke.
