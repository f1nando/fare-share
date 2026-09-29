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

- [x] Обязательная совместимость `$FARE`: direct creator `2NUN…` либо canonical immutable active Pump fee-sharing v2 с единственной долей `2NUN… = 100%`; backend обязан использовать V2 distribution, а остальные sharing configs отклонять.

- [x] Удалить on-chain `credit_devnet_rewards` и соответствующий backend/admin tooling из production-кода.
- [x] Собрать baseline SBF после удаления: `641720` байт, SHA-256 `35b3a37dfbb2b130cd88440bad105b3cb88d536732bd12a9c02d55761cdd635c`.
- [x] Проверить бинарник: имя и discriminator `credit_devnet_rewards` отсутствуют; других test/devnet handlers в исходниках нет.
- [x] После назначения disposable Program ID был собран первый SBF: `641720` байт, SHA-256 `d67d068c5840671d2c12da71c387c5aee85cb0329a2632b3171b4994996bc54c`.
- [x] Пересобрать disposable SBF после on-chain проверки Pump creator: `654680` байт, SHA-256 `b835518cd615d1da93969aa42a7b967a0f25436d5185891df3987a7679e8a4f9`.
- [x] Добавить on-chain запрет Mayhem Mode, Cashback, Holder Rewards, custom/editable creator fee и non-SOL quote по актуальному 125-byte Pump layout.
- [x] Предыдущий disposable SBF после полной Pump reward/share проверки: `657208` байт, SHA-256 `a568bd91fe844895dc3d1f2437590ac105ac0b838754b19a499e818e9af9f37f`. Этот artifact superseded после добавления pre-sale CA replacement и emergency rescue; деплоить его нельзя.
- [x] Новый frozen SBF из contract source commit `1257483`: `657304` байт, SHA-256 `6d1ca95da95e8ff5a1ceb35117480420c1d68bde5c7e4a043da87e8a0e401e3b`; artifact `.qa/mainnet-test-rc/taxi_park.so` и `/home/ivand/taxi-sbf-rc-1257483/taxi_park.so`.
- [x] Upgrade RC с безопасной поддержкой immutable Pump fee sharing из commit `f9511a7`: `660656` байт, SHA-256 `55dc1e29b70bd3f3b46a45a59ec819dc18b02e591fad6c4931a2c849f9a6631a`; artifact `.qa/mainnet-test-rc/taxi_park-f9511a7.so` и `/home/ivand/taxi-sbf-rc-f9511a7/taxi_park.so`.

### Gate 2 — изолированная идентичность теста

- [x] Создать disposable mainnet program keypair вне репозитория: `3EAw6VA99tH6y5nEYuGNDWpBVkXXtKnSxpBtmk95JHMv`.
- [x] Независимо вывести ожидаемый loader-v3 ProgramData PDA: `5zDM1WKLHKwrm6DGiTSW54HoDfFDcJCyvzp1zqDDSE8V`.
- [x] Создать постоянный recoverable upload-buffer keypair вне репозитория: `7ZZcZWkq2JRJPvYYPUBkyGQoQ6oTNw284Byuew29MCKE`.
- [x] Создать отдельные test-mainnet backend `GkAaxN3mF6ko5qUPfBgstujzmE9kFCYAThDfkGkP74Lz` и worker `9GHXjBfG6qwV7Bwm53EBXh2Z19g6L2wUG6zVTY7hvAtA`.
- [x] Выбрать authority/payer теста: ранее проверенный recovery-циклом `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF`; production authority `2uGK…` тестом не используется.
- [x] Владелец подтвердил независимую резервную копию keypair authority и четырёх новых test-mainnet keypair.
- [x] Синхронизировать disposable Program ID `3EAw6VA99tH6y5nEYuGNDWpBVkXXtKnSxpBtmk95JHMv` в `declare_id!`, `Anchor.toml`, `TAXI_PROGRAM_ID` и `VITE_TAXI_PROGRAM_ID` только в branch/worktree `mainnet-test-rc`.
- [x] Подтвердить, что постоянный `9ZLA…6eVv` не существует onchain и его keypair не используется тестом.
- [x] Authority пополнен: finalized баланс до metadata upload — `7.050481114 SOL`, после upload и частичного возврата Irys — `7.050176114 SOL`.

### Gate 3 — конфигурация и preflight

- [x] Создать отдельный некоммитимый target `.env` для `mainnet-test-rc` и завершить `protocol:preflight`: PASS с ожидаемыми warnings о позднем FARE CA и общем Helius RPC/DAS endpoint; `getGenesisHash` и `getAssetsByOwner` проверены.
- [x] Подтвердить mainnet genesis отдельно для server RPC, browser RPC и DAS; test-конфигурация использует один Helius mainnet endpoint.
- [x] Использовать отдельный test-mainnet MongoDB database name `taxi_park_mainnet_test`, локальный backend URL и allowed origin.
- [x] Проверить official xStocks mint: все четыре существуют в mainnet и принадлежат Token-2022.
- [ ] Создать финальный `$FARE` в последний момент и только после этого привязать его CA; ранее созданный offline test-mint keypair не использовать как обязательную часть запуска.
- [x] Сверить Pump/PumpSwap/Pump Fees layouts с official IDL commit `e0687ae9…` и finalized accounts реальной migrated пары; финальный `$FARE` проверить повторно отдельно.

### Gate 4 — assets и микроцены

- [x] Опубликовать отдельные test-mainnet изображения: `https://gateway.irys.xyz/escoWKMmuYk52L5NRJrwnNCDdSpKBshWcHpjgfnknT3/`.
- [x] Опубликовать отдельные test-mainnet metadata (`FARETEST`, явно не production): `https://gateway.irys.xyz/HyYxfPSvwEefbjBCJTQ41SZuzVg6MYPucBogTPpWLTwT/`.
- [x] Зафиксировать микроцены `1000000,3000000,10000000,30000000` lamports (`0.001/0.003/0.01/0.03 SOL`) в порядке Economy/Comfort/Business/Legend.
- [ ] Подтвердить ожидаемый максимальный расход на mint, rent и комиссии.
- [ ] До `start-sale` проверить collection, team recipient, mint prices и все caps непосредственно из Configuration PDA.
- [x] Разделить запуск на два этапа: `initialize` сохраняет пустой `$FARE`, а `set-fare-mint <CA>` после создания токена атомарно создаёт/проверяет canonical vault; protocol admin может исправить CA до `start-sale`.
- [ ] После создания финального токена через `/admin/` выполнить `set_fare_mint`, сохранить CA+ticker в MongoDB runtime-конфигурации и проверить Configuration PDA и `/api/token`; до этого `start-sale` обязан отклоняться, после старта прямая замена CA обязана отклоняться.

### Gate 5 — regression и release artifact

- [x] Исправить общий `npm test`: он запускает только `tests/*.test.js|ts` через `tsx` и больше не подхватывает mainnet lifecycle shell script.
- [ ] Разобрать пять воспроизводимых city-тестов; текущий явный baseline — `313/318 PASS`, пять прежних failures в `road-layout` (2), `scenery-cache`, `shoulder`, `simulation-clock`. Эти несвязанные city-файлы в данной задаче не изменялись.
- [x] Получить зелёные Rust `25/25`, backend `60/60`, server typecheck, frontend build и browser smoke.
- [x] Реализовать durable operation ID, MongoDB single-operation lock и RPC reconciliation для admin claim/deposit; локальный MongoDB index/lock smoke пройден.
- [x] Собрать один финальный SBF после freeze; больше его не пересобирать перед deploy.
- [x] Сохранить SHA-256, размер, contract source commit и список включённых задач в release manifest выше.

### Gate 6 — rent и recovery до deploy

- [x] Исторический rent для superseded RC `657208` байт: buffer (`+37`) — `3.33945484 SOL`, ProgramData (`+45`) — `3.33949548 SOL`, Program tombstone — `0.00083312 SOL`; использовать эти числа для нового deploy запрещено.
- [x] Для frozen SBF `657304` байт mainnet RPC вернул: buffer (`+37`) `3.339942520 SOL`, ProgramData (`+45`) `3.339983160 SOL`, tombstone `0.000833120 SOL`; peak lock `6.680758800 SOL` без небольших transaction fees.
- [x] Проверить disposable mainnet admin/deployer `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF`, его keypair и подтверждённую владельцем резервную копию; постоянный `2uGK…` в тесте не используется.
- [x] Подготовить read-only `protocol:audit-mainnet-recovery` без default signer и адресных defaults; script проверяет keypair/address, genesis, Program/ProgramData/authority/buffer, pause и vault balances.
- [x] Recovery dry-run после initialize проверил mainnet genesis, Program ID, ProgramData, authority, recipient, закрытый buffer и нулевые SOL/token vault: `MAINNET_RECOVERY_DRY_RUN=PASS`.
- [x] До freeze finalized authority balance составлял `7.050176114 SOL`; запас над peak lock около `0.3694 SOL`. Точный баланс повторно проверяется непосредственно перед транзакцией.

## Что требуется от владельца до release freeze

1. Подтвердить резервные копии authority `2NUN…`, disposable program `3EAw…`, buffer `7ZZc…`, backend `GkAa…` и worker `9GHX…`. Секреты в чат и репозиторий не отправлять; нужен только ответ, что каждая копия независимо восстановима.
2. Передать четыре точные микроцены в raw lamports в порядке `Economy, Comfort, Business, Legend`.
3. Передать отдельные test-mainnet Collection name/URI и четыре immutable machine metadata URI; изображения и metadata не должны использовать production Collection.
4. Утвердить максимальный бюджет теста. Текущий ориентир до новой freeze-сборки — пополнение `2NUN…` минимум до `7 SOL`; точная сумма будет пересчитана по финальному SBF.
5. Создать `$FARE` на pump.fun только в согласованное окно: SOL pair, direct creator `2NUN…` либо immutable active sharing config с единственной долей `2NUN… = 100%`; без Mayhem/Cashback/Holder Rewards/custom fee. После создания передать только CA и желаемый ticker.
6. Подтвердить точный recovery recipient и fee payer для disposable теста. Планируемое значение для обоих — `2NUN…`, но audit/deploy не используют это как default.
7. Передать параметры целевого окружения: private mainnet RPC/DAS endpoints, разрешённый frontend origin, имя admin-пользователя и пароль через безопасный канал. API keys, пароль и keypair в Git или чат не отправлять; на сервере сохраняются только password hash и secret-storage values.
8. Дать отдельное явное разрешение на расход mainnet SOL и disposable deploy. Создание токена, deploy и любые внешние mainnet-транзакции до этого не выполняются.

### Gate 7 — явно разрешённый test-mainnet deploy

- [x] Получено отдельное разрешение владельца на расход real mainnet SOL и публикацию disposable Program ID.
- [x] Получено условное разрешение с жёстким совокупным лимитом невозвратного расхода `0.5 SOL`; metadata upload уже использовал `0.000305 SOL`, доступный остаток лимита — `0.499695 SOL`.
- [x] Владелец разрешил временный recoverable lock до рассчитанного peak; лимит `0.5 SOL` относится к совокупному невозвратному расходу. Новый точный peak `6.680758800 SOL` плюс transaction fees.
- [x] Disposable deploy выполнен с явными `--program-id`, `--upgrade-authority`, `--fee-payer`, private RPC и постоянным buffer keypair; signature `54UpuA6SXUqT7F6jXyDewD8EZYPZ7CeFkPUZgjiBiQBXEvVZkYn7ZRuTzDnFjrQyxhhZpchgqFJ21ZByr3nXo6rA`, finalized slot `451695060`.
- [x] После deploy проверены ProgramData `5zDM1W…DE8V`, authority `2NUN…EGVnF`, data length `657304`, выгруженный on-chain ELF SHA-256 `6d1ca95d…401e3b`; buffer `7ZZc…9MCKE` закрыт и его rent возвращён.
- [x] Finalized balance после deploy `3.706089834 SOL`; в ProgramData recoverable `3.339983160 SOL`. Фактический невозвратный deploy outflow, включая tombstone и upload/deploy fees, `0.004103120 SOL`; вместе с metadata использовано `0.004408120 SOL` из лимита `0.5 SOL`.
- [x] Fee-sharing upgrade finalized: signature `uRXPFLtrVpGN55AJG3LgY5pVsnFuAsz3XiajM2UUAw6Ptsw5fReoF1qzBsdQHG2971YAVVteAoh4YXgECMPawvm`, slot `451700854`. Loader-v3 потребовал минимальное расширение ProgramData на `10240` байт: `0.052019200 SOL` добавлено к recoverable rent; buffer `3.356970680 SOL` закрыт и полностью возвращён. On-chain первые `660656` байт имеют SHA-256 `55dc1e29…6631a`, оставшиеся `6888` байт проверены как нулевой резерв. Upgrade/upload fees составили `0.003285000 SOL`; общий невозвратный расход с deploy и metadata теперь `0.007693120 / 0.5 SOL`. Finalized liquid balance `3.650785634 SOL`.
- [x] Initialize ALT `9kmvr4hxEjRhDUm56yzFxnzEVzeDGxgLTD8HfT4BgkaB` создан и расширен девятью статическими адресами; signatures `4tPf5m…3aQd` и `4RYkTB…JWx9h`, rent `0.002397760 SOL` recoverable после deactivate/close.
- [x] Disposable PDA и Collection `7uxqwuxEfVv1DsawZiS5EmiDuyYMw8qJnrfGktbE4TiF` инициализированы: signature `2iDB2h…M5Sx`; пять WSOL/xStock vault ATA созданы signature `ueaKnN…bVzR`. `fare_mint` остаётся пустым, sale не запущен, vault balances нулевые.
- [x] PDA/Collection/vault rent составляет `0.038237160 SOL`, transaction fees ALT+initialize `0.000025000 SOL`; общий невозвратный либо пока не закрываемый расход `0.045955280 / 0.5 SOL`. ProgramData `3.392002360 SOL` и ALT rent остаются recoverable; finalized liquid balance `3.610125714 SOL`.
- [x] Initialize dry-run без ALT безопасно отклонён до отправки: raw transaction `1296 > 1232` байт. Добавлен отдельный recoverable initialize ALT flow; metadata не сокращаются и не подменяются.

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
- Disposable Program ID `3EAw…5JHMv` опубликован и верифицирован; initialize, Collection, ALT и sale ещё не выполнялись.
- Никакая запись в этом документе не является разрешением на mainnet deploy или расход SOL.
- Metadata funding: `2aTrVgnedaStnRHW7dYvdTD3cFdeE6r4je4BVyXbneW6F5fvAgMVVVk2Dw5DpsPgrkRigkUa9ok9JwUQGT8jA3LC`; возврат `0.0001 SOL`: `3bEjy7SE5rk5BPNN6tYsUWkwfYkQUzCT1ZFRZKs8VA8CkAmJc6cu8eRKfNxYgT3LMNQ6rFmjYJXFfHaAxbUM93V2`.
