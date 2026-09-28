# Checklist тестового Mainnet-развёртывания

Цель — проверить production-бинарник в `mainnet-beta` с микроценами NFT, не загрязняя состояние постоянной программы и не рискуя её тиражом.

## Зафиксированная стратегия

- [x] Использовать отдельный disposable Program ID и отдельную Core Collection.
- [x] Не использовать постоянный Program ID `9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv` для тестовой продажи.
- [x] Не вызывать `start-sale` постоянной программы с микроценами: старт продажи и счётчики выпущенных NFT необратимы.
- [x] Сохранить upgrade authority; никогда не передавать `--final`.
- [x] После теста выполнить `pause → empty vaults → recovery audit → close`, понимая, что disposable Program ID станет непригоден навсегда.

## Gates — решаем строго по порядку

### Gate 1 — production-only контракт

- [x] Удалить on-chain `credit_devnet_rewards` и соответствующий backend/admin tooling из production-кода.
- [x] Собрать baseline SBF после удаления: `641720` байт, SHA-256 `35b3a37dfbb2b130cd88440bad105b3cb88d536732bd12a9c02d55761cdd635c`.
- [x] Проверить бинарник: имя и discriminator `credit_devnet_rewards` отсутствуют; других test/devnet handlers в исходниках нет.
- [ ] После назначения disposable Program ID заново собрать и зафиксировать финальные размер/SHA-256: baseline не является release artifact.

### Gate 2 — изолированная идентичность теста

- [x] Создать disposable mainnet program keypair вне репозитория: `3EAw6VA99tH6y5nEYuGNDWpBVkXXtKnSxpBtmk95JHMv`.
- [x] Создать постоянный recoverable upload-buffer keypair вне репозитория: `7ZZcZWkq2JRJPvYYPUBkyGQoQ6oTNw284Byuew29MCKE`.
- [x] Создать отдельные test-mainnet backend `GkAaxN3mF6ko5qUPfBgstujzmE9kFCYAThDfkGkP74Lz` и worker `9GHXjBfG6qwV7Bwm53EBXh2Z19g6L2wUG6zVTY7hvAtA`.
- [x] Выбрать authority/payer теста: ранее проверенный recovery-циклом `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF`; production authority `2uGK…` тестом не используется.
- [ ] Подтвердить независимую резервную копию keypair authority и четырёх новых test-mainnet keypair.
- [ ] Синхронизировать disposable Program ID в `declare_id!`, `Anchor.toml`, `TAXI_PROGRAM_ID` и `VITE_TAXI_PROGRAM_ID` только в изолированной test-mainnet конфигурации.
- [x] Подтвердить, что постоянный `9ZLA…6eVv` не существует onchain и его keypair не используется тестом.
- [ ] Пополнить authority перед deploy: текущий mainnet-баланс `0.33957387 SOL`, что заведомо меньше необходимого пикового rent.

### Gate 3 — конфигурация и preflight

- [ ] Исправить текущие ошибки `protocol:preflight`: семь rate-limit значений, официальный порядок `STOCK_MINTS` и рассинхронизацию Program ID.
- [ ] Подтвердить mainnet genesis отдельно для server RPC, browser RPC и DAS.
- [ ] Использовать отдельные test-mainnet MongoDB/database name, backend URL и allowed origin.
- [ ] Проверить official xStocks mint и их Token/Token-2022 owners через `protocol:check-xstocks`.
- [ ] Выбрать отдельный тестовый `$FARE` mint и документировать, какие реальные swap-сценарии он позволяет проверить.

### Gate 4 — assets и микроцены

- [ ] Использовать отдельные тестовые metadata URI и изображения; не смешивать их с будущей production Collection.
- [ ] Зафиксировать точные микроцены в lamports для четырёх классов.
- [ ] Подтвердить ожидаемый максимальный расход на mint, rent и комиссии.
- [ ] До `start-sale` проверить collection, team recipient, mint prices и все caps непосредственно из Configuration PDA.

### Gate 5 — regression и release artifact

- [ ] Исправить общий `npm test`, который сейчас подхватывает lifecycle script и TypeScript-тесты без `tsx`.
- [ ] Разобрать пять воспроизводимых city-тестов; либо исправить, либо отдельно зафиксировать обоснованный baseline до release freeze.
- [ ] Получить зелёные Rust, backend, protocol-client, typecheck, frontend build и browser smoke.
- [ ] Собрать один финальный SBF после freeze; больше его не пересобирать перед deploy.
- [ ] Сохранить SHA-256, размер, git commit и список включённых задач в release manifest.

### Gate 6 — rent и recovery до deploy

- [ ] Пересчитать rent для точного финального SBF.
- [ ] Проверить mainnet admin/deployer `2uGKLnabWRSpDJaQSBy2fcbYzd8p8BYVzXNMgqzNNtAr`, его keypair и резервную копию.
- [ ] Подготовить target-specific recovery audit без default signer и небезопасных адресных defaults.
- [ ] Dry-run обязан проверить mainnet genesis, Program ID, ProgramData, authority, recipient, buffer и все SOL/token vault.
- [ ] Подтвердить достаточный баланс для пикового deploy и отдельно известный невозвратный tombstone/fees.

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
