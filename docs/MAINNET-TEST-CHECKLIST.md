# Checklist тестового Mainnet-развёртывания

Цель — проверить production-бинарник в `mainnet-beta` с микроценами NFT, не загрязняя состояние постоянной программы и не рискуя её тиражом.

## Зафиксированная стратегия

- [x] Использовать отдельный disposable Program ID и отдельную Core Collection.
- [x] Не использовать постоянный Program ID `9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv` для тестовой продажи.
- [x] Не вызывать `start-sale` постоянной программы с микроценами: старт продажи и счётчики выпущенных NFT необратимы.
- [x] Сохранить upgrade authority; никогда не передавать `--final`.
- [x] После теста выполнить `pause → empty vaults → recovery audit → close`, понимая, что disposable Program ID станет непригоден навсегда.
- [x] Сценарий позднего CA, закрытой админки и ручного claim/deposit зафиксирован в [`ADMIN-FEE-FLOW.md`](ADMIN-FEE-FLOW.md).

## Gates — решаем строго по порядку

### Gate 1 — production-only контракт

- [x] Удалить on-chain `credit_devnet_rewards` и соответствующий backend/admin tooling из production-кода.
- [x] Собрать baseline SBF после удаления: `641720` байт, SHA-256 `35b3a37dfbb2b130cd88440bad105b3cb88d536732bd12a9c02d55761cdd635c`.
- [x] Проверить бинарник: имя и discriminator `credit_devnet_rewards` отсутствуют; других test/devnet handlers в исходниках нет.
- [x] После назначения disposable Program ID был собран первый SBF: `641720` байт, SHA-256 `d67d068c5840671d2c12da71c387c5aee85cb0329a2632b3171b4994996bc54c`.
- [x] Пересобрать disposable SBF после on-chain проверки Pump creator: `654680` байт, SHA-256 `b835518cd615d1da93969aa42a7b967a0f25436d5185891df3987a7679e8a4f9`.
- [x] Добавить on-chain запрет Mayhem Mode, Cashback, Holder Rewards, custom/editable creator fee и non-SOL quote по актуальному 125-byte Pump layout.
- [x] Пересобрать disposable SBF после полной Pump reward/share проверки: `657208` байт, SHA-256 `a568bd91fe844895dc3d1f2437590ac105ac0b838754b19a499e818e9af9f37f`.
- [ ] Повторно зафиксировать hash после полного release freeze.

### Gate 2 — изолированная идентичность теста

- [x] Создать disposable mainnet program keypair вне репозитория: `3EAw6VA99tH6y5nEYuGNDWpBVkXXtKnSxpBtmk95JHMv`.
- [x] Создать постоянный recoverable upload-buffer keypair вне репозитория: `7ZZcZWkq2JRJPvYYPUBkyGQoQ6oTNw284Byuew29MCKE`.
- [x] Создать отдельные test-mainnet backend `GkAaxN3mF6ko5qUPfBgstujzmE9kFCYAThDfkGkP74Lz` и worker `9GHXjBfG6qwV7Bwm53EBXh2Z19g6L2wUG6zVTY7hvAtA`.
- [x] Выбрать authority/payer теста: ранее проверенный recovery-циклом `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF`; production authority `2uGK…` тестом не используется.
- [ ] Подтвердить независимую резервную копию keypair authority и четырёх новых test-mainnet keypair.
- [x] Синхронизировать disposable Program ID `3EAw6VA99tH6y5nEYuGNDWpBVkXXtKnSxpBtmk95JHMv` в `declare_id!`, `Anchor.toml`, `TAXI_PROGRAM_ID` и `VITE_TAXI_PROGRAM_ID` только в branch/worktree `mainnet-test-rc`.
- [x] Подтвердить, что постоянный `9ZLA…6eVv` не существует onchain и его keypair не используется тестом.
- [ ] Пополнить authority перед deploy: finalized mainnet-баланс на 2026-09-29 — `0.550481114 SOL`, что заведомо меньше необходимого пикового rent.

### Gate 3 — конфигурация и preflight

- [ ] Завершить `protocol:preflight`: семь rate-limit значений, официальный порядок `STOCK_MINTS` и Program ID уже исправлены; остаются только неутверждённые `MINT_PRICES_LAMPORTS`.
- [x] Подтвердить mainnet genesis отдельно для server RPC, browser RPC и DAS; test-конфигурация использует один Helius mainnet endpoint.
- [x] Использовать отдельный test-mainnet MongoDB database name `taxi_park_mainnet_test`, локальный backend URL и allowed origin.
- [x] Проверить official xStocks mint: все четыре существуют в mainnet и принадлежат Token-2022.
- [ ] Создать финальный `$FARE` в последний момент и только после этого привязать его CA; ранее созданный offline test-mint keypair не использовать как обязательную часть запуска.
- [x] Сверить Pump/PumpSwap/Pump Fees layouts с official IDL commit `e0687ae9…` и finalized accounts реальной migrated пары; финальный `$FARE` проверить повторно отдельно.

### Gate 4 — assets и микроцены

- [ ] Использовать отдельные тестовые metadata URI и изображения; не смешивать их с будущей production Collection.
- [ ] Зафиксировать точные микроцены в lamports для четырёх классов.
- [ ] Подтвердить ожидаемый максимальный расход на mint, rent и комиссии.
- [ ] До `start-sale` проверить collection, team recipient, mint prices и все caps непосредственно из Configuration PDA.
- [x] Разделить запуск на два этапа: `initialize` сохраняет пустой `$FARE`, а одноразовый `set-fare-mint <CA>` после создания токена атомарно создаёт/проверяет canonical vault и фиксирует CA навсегда.
- [ ] После создания финального токена через `/admin/` выполнить одноразовый `set_fare_mint`, сохранить CA+ticker в MongoDB runtime-конфигурации и проверить Configuration PDA и `/api/token`; до этого `start-sale` обязан отклоняться.

### Gate 5 — regression и release artifact

- [x] Исправить общий `npm test`: он запускает только `tests/*.test.js|ts` через `tsx` и больше не подхватывает mainnet lifecycle shell script.
- [ ] Разобрать пять воспроизводимых city-тестов; текущий явный baseline — `313/318 PASS`, пять прежних failures в `road-layout` (2), `scenery-cache`, `shoulder`, `simulation-clock`. Эти несвязанные city-файлы в данной задаче не изменялись.
- [ ] Получить зелёные Rust, backend, protocol-client, typecheck, frontend build и browser smoke.
- [x] Реализовать durable operation ID, MongoDB single-operation lock и RPC reconciliation для admin claim/deposit; локальный MongoDB index/lock smoke пройден.
- [ ] Собрать один финальный SBF после freeze; больше его не пересобирать перед deploy.
- [ ] Сохранить SHA-256, размер, git commit и список включённых задач в release manifest.

### Gate 6 — rent и recovery до deploy

- [x] Предварительно пересчитать rent для RC `657208` байт: buffer (`+37`) — `3.33945484 SOL`, ProgramData (`+45`) — `3.33949548 SOL`, Program tombstone — `0.00083312 SOL`; пик без комиссионного запаса около `6.67978344 SOL`.
- [ ] Проверить mainnet admin/deployer `2uGKLnabWRSpDJaQSBy2fcbYzd8p8BYVzXNMgqzNNtAr`, его keypair и резервную копию.
- [x] Подготовить read-only `protocol:audit-mainnet-recovery` без default signer и адресных defaults; script проверяет keypair/address, genesis, Program/ProgramData/authority/buffer, pause и vault balances.
- [ ] Dry-run обязан проверить mainnet genesis, Program ID, ProgramData, authority, recipient, buffer и все SOL/token vault.
- [ ] Подтвердить достаточный баланс для пикового deploy и отдельно известный невозвратный tombstone/fees.

## Что требуется от владельца до release freeze

1. Подтвердить резервные копии authority `2NUN…`, disposable program `3EAw…`, buffer `7ZZc…`, backend `GkAa…` и worker `9GHX…`. Секреты в чат и репозиторий не отправлять; нужен только ответ, что каждая копия независимо восстановима.
2. Передать четыре точные микроцены в raw lamports в порядке `Economy, Comfort, Business, Legend`.
3. Передать отдельные test-mainnet Collection name/URI и четыре immutable machine metadata URI; изображения и metadata не должны использовать production Collection.
4. Утвердить максимальный бюджет теста. Текущий ориентир до новой freeze-сборки — пополнение `2NUN…` минимум до `7 SOL`; точная сумма будет пересчитана по финальному SBF.
5. Создать `$FARE` на pump.fun только в согласованное окно: SOL pair, direct creator строго `2NUN…`, без Mayhem/Cashback/Holder Rewards/custom fee/fee sharing. После создания передать только CA и желаемый ticker.
6. Дать отдельное явное разрешение на расход mainnet SOL и disposable deploy. Создание токена, deploy и любые внешние mainnet-транзакции до этого не выполняются.

### Gate 7 — явно разрешённый test-mainnet deploy

- [ ] Получить отдельное разрешение владельца на расход real mainnet SOL и публикацию disposable Program ID.
- [ ] Deploy выполнять только с явными `--program-id`, `--upgrade-authority`, `--fee-payer`, RPC и постоянным buffer keypair.
- [ ] После deploy проверить ProgramData, authority, ELF SHA-256 и вернуть rent upload buffer.
- [ ] Инициализировать отдельные PDA/Collection/vault и создать ALT.

### Gate 8 — тест микроцен и экономики

- [ ] Непосредственно перед `start-sale` повторить freeze и проверить микроцены.
- [ ] Выпустить минимальный набор NFT каждого класса и сразу поставить протокол на паузу после тестового mint-окна.
- [ ] Проверить ownership, transfer, reward calculation через реальные разрешённые flows, Claim 10 с ALT и Repair `8 + остаток`.
- [ ] Проверить намеренно ошибочный batch: транзакция отклонена, Machine PDA и token balances неизменны.
- [ ] Проверить frontend Garage с Phantom на mainnet-beta и отсутствие console/RPC ошибок.

### Gate 9 — закрытие disposable deployment

- [ ] Остановить backend/worker и подтвердить pause onchain.
- [ ] Вывести разрешённые SOL/token остатки; обязательный аудит должен показать нулевые vault balances.
- [ ] Получить отдельную точную команду владельца на необратимый close.
- [ ] Вернуть worker/buffer/ProgramData SOL явно указанному recipient.
- [ ] Сохранить deploy/test/close signatures, фактически возвращённую сумму и невозвратный расход.

## Текущее состояние

- Devnet E2E `Claim 10`, atomic rejection и `Repair 8 + 2` пройдены; тестовый Devnet ProgramData закрыт, rent возвращён.
- Mainnet permanent Program ID `9ZLA…6eVv` на момент проверки не опубликован.
- Текущий production preflight не проходит; deploy запрещён до закрытия Gates 1–6.
- Никакая запись в этом документе не является разрешением на mainnet deploy или расход SOL.
