# Checklist тестового Mainnet-развёртывания

Цель — проверить production-бинарник в `mainnet-beta` с микроценами NFT, не загрязняя состояние постоянной программы и не рискуя её тиражом.

## Зафиксированная стратегия

- [x] Использовать отдельный disposable Program ID и отдельную Core Collection.
- [x] Не использовать постоянный Program ID `GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4` для тестовой продажи.
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
- [x] Disposable PDA и Collection `7uxqwuxEfVv1DsawZiS5EmiDuyYMw8qJnrfGktbE4TiF` инициализированы: signature `2iDB2h…M5Sx`; пять WSOL/xStock vault ATA созданы signature `ueaKnN…bVzR`. На момент initialize `fare_mint` был пустым; sale не запущен, vault balances нулевые.
- [x] PDA/Collection/vault rent составляет `0.038237160 SOL`, transaction fees ALT+initialize `0.000025000 SOL`; общий невозвратный либо пока не закрываемый расход `0.045955280 / 0.5 SOL`. ProgramData `3.392002360 SOL` и ALT rent остаются recoverable; finalized liquid balance `3.610125714 SOL`.
- [x] Initialize dry-run без ALT безопасно отклонён до отправки: raw transaction `1296 > 1232` байт. Добавлен отдельный recoverable initialize ALT flow; metadata не сокращаются и не подменяются.
- [x] Тестовый `$TAXI` CA `4fg5Nh…Mpump` прошёл повторную finalized проверку immutable active sharing `100% → 2NUN…` и привязан до старта sale: signature `3Si92p…2nY9`, slot `451702950`. FARE vault создан; CA по-прежнему заменяем до `start-sale`.
- [x] MongoDB runtime config сохранён только после finalized bind; локальный backend smoke вернул `/api/token` → `{ configured: true, mint: "4fg5Nh…Mpump", ticker: "TAXI" }`.
- [x] Тот же ALT расширен 12 claim-адресами без создания второго ALT: signature `5dFo1C…Fxrm`; полный ALT rent `0.004348480 SOL` recoverable.
- [x] Реальный V2 fee-sharing claim распределил `0.002097787 SOL` из Pump vault на `2NUN…`: signature `4kUfhW…D2AEF`, slot `451703275`. Повтор с тем же operation ID вернул сохранённый результат без второй транзакции; Pump vault теперь пуст.
- [x] Исправлен immediate-finalization edge: backend при отсутствии slot в локальном объекте читает finalized slot по signature и не требует повторного запроса. Backend `62/62`, typecheck PASS.
- [x] Atomic deposit smoke внёс те же `0.002097787 SOL`: signature `vNZSnp…VSLRi`; повтор с тем же operation ID не создал вторую транзакцию. On-chain split: FARE reserve `0.001468453 SOL`, каждый из четырёх stock reserves `0.000104889 SOL`, team `0.000209778 SOL`; всего в FeeVault recoverable `0.001888009 SOL`.
- [x] Emergency recovery smoke завершён: pause `SnF8kF…VMk8`, точный rescue всех `0.001888009 SOL` из FeeVault на `2NUN…` — `2C9Yti…4K5s`, затем unpause `5rxnNt…PjeN8`. Резервы и все шесть token vault снова нулевые; `--require-empty-vaults` audit PASS.
- [x] После CA/ALT/claim/deposit/recovery общий невозвратный либо пока не закрываемый расход `0.047504120 / 0.5 SOL`; ProgramData `3.392002360 SOL` и ALT `0.004348480 SOL` recoverable, buffer закрыт, finalized authority balance `3.608514163 SOL`. Sale, token swaps и NFT mint не запускались.

### Gate 8 — тест микроцен и экономики

- [x] Непосредственно перед `start-sale` повторён freeze: disposable Program ID `3EAw…5JHMv`, permanent `9ZLA…6eVv` отсутствует, CA/Collection/metadata совпадают, supply `[0,0,0,0]`, микроцены `0.001 / 0.003 / 0.01 / 0.03 SOL`.
- [x] Sale запущена signature `P7puFT…N6JCH`. Выпущено по одной машине каждого класса: Economy `EhiDiw…cRND`, Comfort `61kM48…EjmM`, Business `BWnQiG…fB2y`, Legend `3bgwY5…5Rwq`; mint signatures `2gRv55…VsjVu`, `whjJRA…xq7nm`, `L17p9t…n2e3n`, `XeoRsn…oGai`.
- [x] DAS подтвердил владельца всех четырёх assets `2NUN…EGVnF`, Collection `7uxq…4TiF` и имена `FARE <class> #0001`; все machine PDA ссылаются на правильные Core assets, веса `1/3/10/30`, supply `[1,1,1,1]`.
- [x] Сразу после mint-окна протокол поставлен на паузу: signature `3bouTf…YDcPL`. Recovery audit с `--require-paused --require-empty-vaults` PASS; buffer и все шесть vault закрыты/пусты.
- [x] Консервативный outflow всего disposable теста после sale/mint/pause `0.145336600 / 0.5 SOL`; сюда включены `0.044 SOL` цены машин, account rents и fees. Finalized liquid balance `3.510681683 SOL`, запас лимита `0.354663400 SOL`; ProgramData `3.392002360 SOL` и ALT `0.004348480 SOL` остаются recoverable.
- [x] Fleet расширен до 10 машин для Claim 10: ещё шесть Economy, итоговый supply `[7,1,1,1]`; unpause signature `41iPrE…7b9n3`. Все шесть mint-транзакций finalized, state сохранён вне Git в `.qa/mainnet-ten-machine-state.json`.
- [x] В FeeVault внесено `0.02 SOL` для reward smoke: signature `3Dp1SF…W2h8Q`; reserves `0.014 SOL` FARE и по `0.001 SOL` на каждый xStock, team получил `0.002 SOL`.
- [ ] Mainnet worker smoke безопасно остановил все swaps до списания reserves и выявил upgrade-blocker: Jupiter route требует worker payer signer, а прямое пополнение WSOL vault перед `sync_native` нарушает CPI lamport checkpoint. Дополнительно маршрутам xStock 0–2 нужны временные intermediate ATA с обязательным возвратом rent. Продолжение требует новой frozen SBF-сборки и отдельного разрешения на upgrade disposable Program ID.
- [x] Upgrade fix из commit `0c54e82` сохраняет worker signer в Jupiter CPI, включает обе стороны direct-lamport transfer в `sync_native` checkpoint, принимает только canonical idempotent ATA setup и атомарно закрывает пустые intermediate ATA обратно в FeeVault. Rust `26/26`, backend `63/63`, server typecheck PASS.
- [x] Frozen SBF `665240` байт, SHA-256 `9207cf0b2864f8935099f86b6404fb8d82c5da11c50e65db9c3ad762ca212bf0`; source полностью совпадает с `programs/taxi_park` commit `0c54e82`. Artifact `.qa/mainnet-test-rc/taxi_park-0c54e82.so` и `/home/ivand/taxi-sbf-rc-0c54e82/taxi_park.so`. Текущий ProgramData `667544` байт достаточен, extension не нужен; временный recoverable buffer rent `3.380257400 SOL` плюс fees.
- [x] Upgrade `9207cf…12bf0` finalized signature `3vk6dV…SrRRqW`, slot `451715720`; authority сохранена, buffer закрыт, ProgramData не расширялся, fee `0.003305 SOL`.
- [x] Post-upgrade smoke подтвердил ещё два transport-level ограничения без списания reserves: setup+swap превышает transaction limit, а `sync_native` CPI checkpoint требует source именно в instruction metas. Protocol снова paused `5KLMG2…MLwUv`, worker funding возвращён `59wcHL…Cuy2U`, worker balance `0`.
- [x] Fix-forward commit `a12f7c0`: setup отправляется отдельной idempotent транзакцией; FeeVault добавлен trailing writable meta в `sync_native`, временные intermediate ATA по-прежнему атомарно закрываются в swap. Rust `26/26`, Jupiter/worker `14/14`, typecheck PASS.
- [x] Новый frozen SBF `665400` байт, SHA-256 `d2d87a92258f5189eb348a71c4e4999451d5d6cc5b806289e0c2275856d75486`; artifact `.qa/mainnet-test-rc/taxi_park-a12f7c0.so` и `/home/ivand/taxi-sbf-rc-a12f7c0/taxi_park.so`. ProgramData extension не нужен; recoverable buffer rent `3.381070200 SOL` плюс fees.
- [x] Fix-forward `d2d87a…75486` finalized signature `24UeDL…1UKYg`, slot `451718068`; authority сохранена, buffer закрыт, extension не выполнялся.
- [x] Реальный route smoke подтвердил: protocol ALT устраняет transaction-size blocker, но SPL Token не допускает balance-source extra meta в `SyncNative`. Reserves не списаны; созданные canonical intermediate ATA принадлежат config PDA и их rent будет возвращён FeeVault после успешного swap. Protocol paused `58bQvh…pit72`, worker balance возвращён в `0`.
- [x] Финальный atomic funding fix переиспользует существующий `absorb_pump_wsol_fees`: funding и process связаны через instructions sysvar и находятся в одной транзакции; `SyncNative` выполняется уже в следующей Taxi-инструкции без balance mismatch. Пустые intermediate ATA закрываются отдельной retryable worker-транзакцией в FeeVault. Rust `26/26`, backend `63/63`, typecheck PASS.
- [x] Frozen SBF из commits `11453d4` + `9875860`: `665448` байт, SHA-256 `6b77cc7d72a92133b95ba468e318541ce1432eeba7aed822c9fd1bc0e3234773`; artifact `.qa/mainnet-test-rc/taxi_park-9875860.so` и `/home/ivand/taxi-sbf-rc-9875860/taxi_park.so`. Размер меньше текущего ProgramData `667544`, extension не нужен; recoverable buffer rent `3.381314040 SOL` плюс fees.
- [x] Atomic-funding upgrade `6b77cc…34773` finalized signature `3seDcH…b16C6H`, slot `451724378`; authority сохранена, buffer закрыт, ProgramData не расширялся.
- [x] Реальный reward cycle успешно выполнил stock swaps 1–3: `7yMmNX…sUEK9`, `4PaKhu…FAs5cd`, `4UMULY…B8L6Yd`. FARE reserve `0.014 SOL` и stock0 reserve `0.001 SOL` не списаны. Pump bonding-curve route подтвердил, что unwrap требует system-owned taker; cleanup также должен принимать не-WSOL canonical ATA.
- [x] Protocol снова paused `2MV67q…K6i8h`; worker funding возвращён `4oBep9…8wjyyc`, worker balance `0`. Три успешных stock rewards сохранены в protocol vault/pool; неуспешные FARE/stock0 транзакции откатились атомарно.
- [x] Pump-worker fix commit `f68b830`: только FARE использует system-owned worker WSOL/taker, destination остаётся protocol reward vault; закрытый source принимается как zero balance; cleanup canonical empty ATA поддерживает оба token programs. Rust `26/26`, backend `63/63`, typecheck PASS.
- [x] Frozen SBF `667072` байт, SHA-256 `89d205c4ac605b73be736a284d56a4064814bfefa8b7ebb6912b95cdb1bb533f`; artifact `.qa/mainnet-test-rc/taxi_park-f68b830.so` и `/home/ivand/taxi-sbf-rc-f68b830/taxi_park.so`. Он помещается в текущие `667544` bytes без extension; recoverable buffer rent `3.389563960 SOL` плюс fees.
- [x] Финальный worker-authority fix `82c1a9b`, frozen SBF `666872` байт, SHA-256 `641ce251529ae8a2e17403966bebc3cc7df4c34350660a2ae12e08c7e2800779`; upgrade finalized `4Q5AnF…iheW93`, slot `451733270`. Exact buffer hash проверен до upgrade, buffer закрыт, authority сохранена, extension не выполнялся.
- [x] Все пять reward swaps finalized. FARE: `64n1fL…AgCTF`; stock0: `4fys77…gtjFn`; stock1–3: `7yMmNX…sUEK9`, `4PaKhu…FAs5cd`, `4UMULY…B8L6Yd`. Неисправный внешний Quantum route исключён только для smoke через `JUPITER_EXCLUDE_DEXES=Quantum`.
- [x] Invalid Claim 10 атомарно отклонён: все 10 Machine accounts и пять destination balances неизменны. Valid Claim 10 finalized `3a1Mcb…RTVCA`; balances выросли по всем пяти reward assets.
- [x] Repair 8 выполнен одной атомарной batch-транзакцией `2FbKRr…AKywm`; exact burn `72,094,562,763` raw FARE, durability всех восьми машин увеличена.
- [x] Финальная pause `3owmU7…TLDuu`; worker funding возвращён `2kKN41…D9xykJ`, worker balance `0`. Paused rescue очистил пять reward vaults и `0.007088378 SOL` FeeVault; SOL rescue `2EReEG…JPUkuy`.
- [x] Финальный recovery dry-run: mainnet genesis, Program ID/ProgramData/authority/recipient проверены; buffer closed; FeeVault recoverable SOL `0`; token vaults `0,0,0,0,0,0`; worker/backend `0`; `MAINNET_RECOVERY_DRY_RUN=PASS`. Authority balance `3.419415741 SOL`, recoverable ProgramData rent `3.392002360 SOL`; conservative total irreversible/locked cost `< 0.25 SOL` из лимита `0.5 SOL`.
- [x] После blocker протокол снова paused: signature `4oaFHZ…WUndf`; временные `0.02 SOL` worker funding возвращены на `2NUN…` за вычетом двух network fees, worker balance `0`. FeeVault reserves `0.018 SOL` сохранены и доступны для swap после upgrade либо emergency rescue.
- [x] Текущий консервативный outflow/lock `0.199323200 / 0.5 SOL`; finalized authority balance `3.456695083 SOL`, запас лимита `0.300676800 SOL`. Ни один Jupiter swap не прошёл, reward vault balances не изменились.
- [x] Ownership, transfer, reward calculation, Claim 10 с ALT и максимальный Repair 8 проверены реальными разрешёнными flows новой 16-variant версии.
- [x] Намеренно ошибочный Claim 10 атомарно отклонён: Machine PDA и token balances остались неизменными.
- [ ] Проверить frontend Garage с Phantom на mainnet-beta и отсутствие console/RPC ошибок.

### Gate 8b — новая 16-variant disposable validation

- [x] Старый disposable `3EAw…5JHMv` после строгого paused/empty audit окончательно закрыт: signature `3JFiuP…WcJNM`, slot `451748290`; возвращено `3.392002360 SOL`, fee `0.000005 SOL`. Старый Program ID навсегда tombstoned.
- [x] Канонические artwork — 16 неизменённых WebP из `original-assets/driving-scenes/`, без runtime-дороги/разметки и мигающих фар. Image manifest: `https://gateway.irys.xyz/DUxuuswdW5GvAaSejz35vmGa1G6S8xcjbb1EmqQamc5i/`; metadata manifest: `https://gateway.irys.xyz/Gj5jd6LbY1VsGcHdAtH9Bx2pBrSiADninTAAYD3pJtvd/`. Все 34 файла проверены по SHA-256 после upload.
- [x] Новый disposable Program ID `4QLtcvG2yK4g3Nui9Lu6w9ASaYsXKQ7SMxNDUFxmUXiG`, ProgramData `F3B4QLnRRBumZ27TARxSKQdZ75sb7pU3crbnU5A3LHLo`, authority `2NUN…EGVnF`. Initial deploy `a1y5uY…c8j4q`, slot `451749727`; исходный SBF `670272` bytes, SHA-256 `e7a700f450bf968c42871c5f317b2f5793e1eb8f7cb534f94f4e66c915780712`.
- [x] Initialization `2aiPiti…UsHCSD`; Core Collection `Ex1eA7BxLGFCEurXjkrEAWEgic2sMtco1rEShjeUpu6Q`; четыре metadata batches и пять reward vault завершены. Pump fee-sharing повторно подтверждён как immutable active v2, единственный shareholder `2NUN… = 10000 bps`; FARE bind `4pPtwj…xyhZS2`, start-sale `5caXzH…sbcVE`.
- [x] Выполнены 16 mint, supply `[4,4,4,4]`. DAS подтвердил `16/16` ownership и точное соответствие URI порядку `class * 4 + variant`; варианты каждого класса — `0,1,2,3`. Последний asset `9ncAkd…iqTi` переведён на worker и обратно: `48CZ2a…M9D3c`, `VWaSi6…PUAku`.
- [x] Claim ALT `3amRH79L1VYiS14twX5YhhZSzD6t6kjvkzMbCZHVgX4z`; invalid Claim 10 отклонён атомарно. Первый valid Claim 10 `5HLyvT…K536zs` увеличил FARE и stock0–2; Repair 8 `3essmf…idZks` с exact burn `6,821,023,392` raw FARE увеличил durability всех восьми машин.
- [x] Live route выявил stock-3 source-close edge (`InvalidTokenProgram 6045`). Fix commit `b3f85db` использует тот же closed-source-as-zero invariant, что и FARE; Rust `29/29`. Frozen SBF `669552` bytes, SHA-256 `a95006af7837c021e74e96f90752ea2cf10a9adb6b81220e4c1907ad8792fad3`, помещается без extension.
- [x] Disposable upgrade `bgiH9G…NhgSEW`, slot `451758405`; buffer hash проверен до upgrade, on-chain первые `669552` bytes совпали, нулевой хвост `720` bytes, buffer закрыт, authority сохранена. Повторный stock-3 swap finalized `2NYdjy…LGmGZwL`.
- [x] Второй Claim 10 `4Hpk8M…3E9jyW` увеличил все четыре stock balances, включая stock3; вместе с первым Claim подтверждены все пять reward assets. Финальная pause `456FrU…SJyYKZ`; worker balance возвращён `2Es3kZ…entYnM` и равен нулю.
- [x] Финальный recovery dry-run: mainnet genesis/Program/ProgramData/authority/recipient совпадают, buffer closed, worker/backend `0`, recoverable ProgramData `3.405860600 SOL`, FeeVault `0.035290280 SOL`, token vault raw amounts `0,272083044045,319118,73390,76387,38229`. Finalized authority balance `3.384783537 SOL`; консервативный unrecovered/locked расход не более `0.385353684 / 0.5 SOL`, даже без зачёта ALT rent и стоимости recoverable tokens.

### Gate 9 — закрытие disposable deployment

- [x] Backend/worker остановлены; pause подтверждён onchain.
- [x] Все пять ненулевых token vault выведены на `2NUN…EGVnF`; FeeVault SOL rescue `4YE1mV…TFoKL`. Повторный audit показал FeeVault, worker/backend и все шесть token vault равными нулю.
- [x] Владелец отдельно разрешил необратимый close после создания и проверки независимой резервной копии production keyset.
- [x] ProgramData закрыт на явно заданный recipient `2NUN…EGVnF`; CLI подтвердил возврат `3.405860600 SOL`. Disposable Program ID оставлен только как loader-v3 tombstone `0.000833120 SOL`.
- [x] ALT deactivated `3rmLrB…QvQLmU`, затем закрыт `4fzCFk…aJPBhh`; возвращено ещё `0.003535680 SOL` до transaction fee. Финальный deployer balance `6.829425097 SOL`.

## Текущее состояние

- Devnet E2E `Claim 10`, atomic rejection и `Repair 8 + 2` пройдены; тестовый Devnet ProgramData закрыт, rent возвращён.
- Mainnet permanent Program ID `GHGq…i3i4` на момент release freeze не опубликован.
- Оба disposable Program ID `3EAw…5JHMv` и `4QLt…mUXiG` закрыты навсегда; их ProgramData удалены, recoverable vault assets выведены, ALT второго теста закрыт.
- Никакая запись в этом документе не является разрешением на mainnet deploy или расход SOL.
- Metadata funding: `2aTrVgnedaStnRHW7dYvdTD3cFdeE6r4je4BVyXbneW6F5fvAgMVVVk2Dw5DpsPgrkRigkUa9ok9JwUQGT8jA3LC`; возврат `0.0001 SOL`: `3bEjy7SE5rk5BPNN6tYsUWkwfYkQUzCT1ZFRZKs8VA8CkAmJc6cu8eRKfNxYgT3LMNQ6rFmjYJXFfHaAxbUM93V2`.
