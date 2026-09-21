# Backend Taxi Park

Backend не является источником истины для денег и начислений. Финансовое состояние находится в Solana PDA; MongoDB хранит только стажёрские кампании, журнал выданных ваучеров, rate limit и служебные настройки.

## Локальный запуск

1. Скопировать `.env.example` в `.env`.
2. Указать `MONGODB_URI`, 64-байтовые `BACKEND_SIGNER_SECRET_KEY` и `WORKER_KEYPAIR_SECRET_KEY`, случайный `TRAINEE_WORD_PEPPER` и production `JUPITER_API_KEY`.
3. Явно указать frontend-сеть через `VITE_SOLANA_CHAIN=solana:devnet` или `solana:mainnet`; она не угадывается по приватному RPC URL.
4. Убедиться, что публичный ключ backend signer совпадает с `Configuration.backend_signer` в Solana.
5. Запустить `npm run dev:server`.

Все backend/CLI-команды автоматически читают существующий `.env` из корня проекта. Перед инициализацией или запуском production выполните локальную проверку, которая не обращается к сети и не выводит значения секретов:

```sh
npm run protocol:preflight
```

Она проверяет обязательные адреса, разные server keypair, официальный порядок четырёх xStocks mint, ненулевые цены, постоянные metadata URI и совпадение frontend/program configuration. Ошибки нужно исправить до `protocol:initialize`.

Проверка доступности: `GET /api/health`.

## Первичная инициализация протокола

После публикации программы заполнить admin/setup-поля в `.env` и один раз выполнить:

```sh
npm run protocol:initialize
```

Команда атомарно создаёт основные PDA и официальную Metaplex Core Collection с `ImmutableMetadata`, затем идемпотентно создаёт шесть token accounts конфигурации: WSOL, `$FARE` и четыре xStocks. Для каждого mint автоматически используется его фактическая Token Program. Если первая транзакция уже прошла, а создание token accounts прервалось, повторный запуск безопасно завершает только отсутствующий этап.

До выполнения нужны реальные `FARE_MINT`, четыре `STOCK_MINTS`, постоянные `COLLECTION_URI`/`MACHINE_METADATA_URIS`, точные `MINT_PRICES_LAMPORTS` и случайный 32-байтовый `DEPLOYMENT_ID_HEX`. Заглушки из `.env.example` использовать нельзя.

## Ручное управление через SSH

Административных HTTP endpoints и web-панели нет. Оператор запускает отдельную CLI с ключом из `ADMIN_KEYPAIR_SECRET_KEY`:

```sh
npm run protocol:admin -- set-mint-prices 1000000000,2000000000,3000000000,4000000000
npm run protocol:admin -- start-sale
npm run protocol:admin -- pause
npm run protocol:admin -- unpause
npm run protocol:admin -- set-team <pubkey>
npm run protocol:admin -- set-backend-signer <pubkey>
npm run protocol:admin -- set-jupiter <program-id>
npm run protocol:admin -- propose-admin <new-admin-pubkey>
```

Новый admin завершает двухшаговую передачу своей копией `.env` через `npm run protocol:admin -- accept-admin`. Аварийные команды `rescue-sol <recipient> <lamports>` и `rescue-token <mint> <recipient-wallet> <raw-amount>` работают только после отдельной транзакции `pause`. Token rescue сам идемпотентно создаёт ATA получателя, если его ещё нет.

## Кампания стажёра

```sh
npm run campaign:create -- 1 360 кодовое-слово "Первая кампания"
```

Продолжительность указывается в минутах от 60 до 10080 (7 дней). Слово сохраняется только в виде HMAC-SHA256 с серверным pepper. Оно не попадает в Solana, frontend bundle или ответ API.

Frontend отправляет `wallet`, `campaignId`, найденное слово и свободную страницу очереди в `POST /api/trainee/voucher`. Backend читает finalized Configuration PDA, рассчитывает ближайшую полную минуту protocol time и подписывает каноническое сообщение `TAXI_TRAINEE_V1`. Пользователь сам отправляет Ed25519 verify + `activate_trainee` одной Solana-транзакцией и оплачивает network fee/rent.

Для списка Metaplex Core NFT frontend использует DAS-метод `getAssetsByOwner`. В production `VITE_SOLANA_DAS_URL` обязан указывать на DAS-совместимый RPC (например, Helius или QuickNode). Если метод недоступен, интерфейс показывает ошибку настройки, а не пустой гараж.

Повторно запросить ваучер разрешено: предыдущая транзакция могла истечь или не попасть в сеть. Ограничение «один кошелёк — одна активация каждой кампании» обеспечивает уникальный Trainee PDA в программе. API дополнительно ограничен десятью попытками за десять минут на пару IP+wallet.

## Проверки

```sh
npm run server:typecheck
node --import tsx --test tests/backend-voucher.test.ts tests/backend-worker.test.ts tests/backend-setup.test.ts tests/backend-jupiter.test.ts tests/backend-admin.test.ts tests/backend-preflight.test.ts
```

## Permissionless worker

```sh
npm run worker
npm run worker -- --once
```

Раз в `WORKER_INTERVAL_MS` worker проверяет finalized on-chain состояние. Сначала он permissionless забирает Creator Fee из официальных pump.fun/PumpSwap vault: bonding-curve SOL поступает непосредственно в `FeeVault`, а PumpSwap WSOL собирается и разворачивается через `absorb_pump_wsol_fees` атомарно, без промежуточного кошелька. Rent временного WSOL ATA возвращается вызвавшему worker, поэтому в экономический split входит только комиссия. Затем worker вызывает `collect_fees` при наличии нового свободного SOL, обрабатывает накопленные swap-резервы и последовательно догоняет основную и стажёрскую очереди. Для каждой reward-транзакции он читает heap-страницы, выбирает события строго по `timestamp + eventNumber`, добавляет только нужные writable Machine/Bucket PDA и не превышает лимит 20 событий. При большом числе разных аккаунтов batch автоматически уменьшается, чтобы не собирать заведомо слишком крупную транзакцию.

После расчёта основной очереди worker проверяет наиболее заполненные страницы и permissionless-инструкцией `prune_stale_events` удаляет пакетами до 20 старых будущих `EXPIRE`, которые уже отменены ремонтом или обработанным burn. Контракт заново проверяет каждое событие и не позволяет удалить границу, которая ещё нужна для расчёта прошлого периода. За один цикл worker очищает не более 10 страниц; конфликт с другим caller безопасно повторяется в следующем цикле.

Лимит 20 подтверждён воспроизводимым локальным тестом актуального SBF-файла: `npm run protocol:benchmark -- prepare <dir> <mint|repair|expire|stale> 20` создаёт genesis fixtures, а `npm run protocol:benchmark -- simulate <dir>/manifest.json` после запуска `solana-test-validator` выводит размер транзакции и compute units. Худший измеренный `calculate_rewards` — `REPAIR` с 307 482 CU и 1013 байт; удаление 20 stale-событий использует 124 547 CU и 1145 байт.

Swaps используют актуальный Jupiter Swap API V2 `/build`. Worker запрашивает маршрут `WSOL → нужный mint` от имени Configuration PDA, передаёт заранее созданный reward ATA, запрещает дополнительные setup/cleanup/auxiliary-инструкции и допускает только сам Configuration PDA как signer маршрута. Затем backend подписывает `amountIn`, `minOut`, deadline, nonce и hash всех route accounts, а программа повторно проверяет их перед CPI. `$FARE` и каждая stock-позиция обрабатываются независимо; ошибка одного направления не блокирует остальные. По умолчанию запускается swap всего резерва от `1_000_000` lamports с 5% slippage и десятиминутным планом; параметры задаются `SWAP_*` переменными.

Без `JUPITER_API_KEY` worker продолжает собирать комиссии и считать уже купленные награды, но оставляет новые SOL-резервы нетронутыми. Ключ не хранится on-chain и не передаётся frontend.

Перед devnet/mainnet запуском выполняется `npm run protocol:check-xstocks`. Команда проверяет публичной котировкой Jupiter наличие маршрута `0.1 SOL → xStock` для каждого из четырёх официальных mint. Размер можно переопределить через `XSTOCKS_CHECK_LAMPORTS`. Эта проверка подтверждает наличие маршрута, но не заменяет production-проверку Jupiter V2 `/build` с реальным `JUPITER_API_KEY` и program-controlled destination account.

До создания тестового или основного `$FARE` выполните `npm run protocol:addresses` с целевым `TAXI_PROGRAM_ID`. Значение `pumpCreator` — это точный `FeeVault` PDA, который нужно передать как creator при создании обычного SOL-paired токена через официальный pump.fun program. Не включайте holder rewards и не мигрируйте creator vault в Pump Fees sharing config: в этих режимах стандартные permissionless-инструкции сбора на `FeeVault` не работают.

`BACKEND_SIGNER_SECRET_KEY` только подписывает ваучеры и swap-планы и не нуждается в SOL. Отдельный `WORKER_KEYPAIR_SECRET_KEY` является обычным permissionless caller/fee payer: на нём должен быть небольшой запас SOL для служебных транзакций, но он не получает административных прав и не контролирует vault.

Worker не делит HTTP endpoint с admin-командами; admin-инструкции остаются только в ручной CLI на сервере.
