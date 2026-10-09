# Развёртывание Taxi Park

## Доставка application release

### Single-signer paid mint (локальное изменение, ещё не опубликовано)

Новый paid mint использует NFT PDA с seeds `paid-asset`, 32 байта owner,
assignment index в формате `u16 little-endian`. Backend вычисляет PDA при запросе
quote только с owner, frontend независимо проверяет адрес, программа подписывает
Core Create CPI через `invoke_signed`. Оплата и выпуск остаются атомарными.
Legacy quotes с asset signer поддерживаются для совместимости; существующие NFT
и machine PDA не меняются.

Перед публикацией обязательны целевой devnet/local-validator CPI smoke с настоящим
Metaplex Core, проверка mint/transfer/list/cancel для PDA NFT и recovery gates ниже.
Local-validator CPI/lifecycle smoke выполнен: PASS; детали и devnet recovery —
[`docs/PDA-MINT-VALIDATION.md`](docs/PDA-MINT-VALIDATION.md).
Порядок доставки: upgrade программы → backend → frontend. Новый frontend нельзя
публиковать до upgrade: прежняя программа требует внешний asset signer.
Снятие предупреждения Lighthouse подтверждается отдельно в Phantom; один signer
сам по себе не гарантирует отсутствие предупреждения.

Mainnet PDA-mint upgrade использует `scripts/upgrade-pda-mint-mainnet.sh`,
по умолчанию только read-only preflight. Frozen binary, source SHA, keypair paths,
RPC file, evidence directory и backup verification marker передаются явно.
Wrapper сохраняет предыдущий ELF, запрещает auto-extend, оставляет authority у
`F3jK…n8tR`, проверяет hash нового ELF, неизменный ProgramData rent и возврат buffer.
Он никогда не закрывает mainnet Program/ProgramData. При сбое upload проверяется
известный buffer `9FxH…ffeVY`; повторный upload или закрытие только этого buffer
выполняются после отдельной проверки. Backend/frontend не переключаются, пока
on-chain hash и authority не подтверждены.

Если массовая CLI-загрузка упирается в retries, использовать
`scripts/upload-pda-buffer-mainnet.mjs`: сначала read-only preflight, затем
`--execute UPLOAD-<buffer>-<ELF SHA-256>` с теми же явными env paths.
Скрипт только загружает известный buffer (не делает upgrade), отправляет по одной
записи, ждёт confirmation, сохраняет signatures вне Git и сверяет весь ELF на
`finalized`. При сбое не повторяет неопределённую транзакцию автоматически;
resume пропускает уже совпадающие finalized bytes. После загрузки upgrade из
готового buffer выполняется отдельно, только после проверки hash/authority/rent.

Исходный код доставляется на сервер только через GitHub: локальный `main`
проверяется, фиксируется точным commit SHA и после отдельного разрешения
отправляется в `origin/main`. На сервере выполняются `git fetch` и detached
checkout этого SHA в новый release-каталог. Полная передача проекта или
`node_modules` через SCP/SSH запрещена.

`npm ci` выполняется только при изменении `package-lock.json`; при неизменном
lockfile переиспользуется соответствующий server-side dependency set. Первый
Git-based release может один раз создать проверенный cache через `npm ci`, если
готового cache ещё нет. Следующие release с тем же нормализованным lockfile
получают локальный hardlink clone cache; общий symlink на весь `node_modules` не
используется из-за некорректного TypeScript `NodeNext` realpath resolution. `.env`,
keypair и другие secrets находятся вне Git и release-каталогов и никогда не
перезаписываются deployment-процессом. `current` переключается атомарно только
после focused-проверок нового release; при ошибке предыдущий release остаётся
активным. Полный rehearsal запускается один раз для замороженного release
candidate, а не после каждой небольшой правки.

Frontend имеет два независимых канала. Обычный домен обслуживается symlink
`/var/www/ownataxi/production-current`, а полный тестовый интерфейс под
`/rehearsal/` — symlink `/var/www/ownataxi/rehearsal-current`. Без отдельной
команды владельца все новые frontend-релизы переключают только rehearsal-канал.
Production обновляется отдельно или атомарно продвигается с проверенного release
через `deploy/switch-ownataxi-frontend.sh`. Holding-сборка показывает только
главную страницу и `COMING SOON` вместо CA.

> **Текущий статус:** новый production Program `8Z9M…YwxD` и Collection
> `Ebcw…RXpm` опубликованы в mainnet. Upgrade authority, protocol admin, backend
> signer, team/mint recipient и recovery owner — `F3jK…n8tR`. С 2026-10-09 привязан
> `CoRKACYXk1NfvRnjaB4DbA4NyubPhWmFiB6oCRAApump` (`TOASTER`, metadata name `Toast`).
> Fee sharing V2 active, immutable, 100% на `F3jK…n8tR`. Старый test CA
> `C4TZ…NKrj` выведен из использования: vault продан в SOL, старые TAXI-награды
> сброшены; NFT и xStocks сохранены. Reset signature:
> `2CwTicHdna1iq9RnJEnYd5nH8c4kPu9UNkUMhSFUoz9hmx7CAzd186jzujj6fgSgWKFRnwEDFoH8WxADa3f1x6gg`.
> Protocol `live`, supply `[2,1,0,0]`, application release `e4c26a7`, worker OFF.
> Проверены finalized migration, API/browser token, $25 mint quote, buy/sell quotes,
> buy transaction simulation и fee-sharing claim simulation. Реальные paid mint,
> торговый round-trip и полный цикл creator fees → rewards с новым CA ещё не выполнены.

Публикация не выполняется автоматически. Все команды ниже запускает оператор вручную после заполнения production-значений и успешного `npm run protocol:preflight`.

Постоянный публичный Program ID: `8Z9Mru23DFLJGFsDH7tPAfD289JSC4SABt81rqhrYwxD`.
ProgramData: `8JHtNnvcKH435F55hD5gv3ZUCBfuzBSoAf4k1NLJLkCY`. Keypair и резервные
копии хранятся вне репозитория и не передаются через Git или чат.

Подготовленные публичные адреса:

- deployer, upgrade authority, admin, backend signer, team и recovery owner:
  `F3jKZokibZiN5SJM5JM4T3a99HVb4zueDTGPR5hbn8tR`;
- Collection: `Ebcwoz2G7qb3o2ZP4HsCcHysQ2EQ4q6MDJdnA5mTRXpm`;
- initialize/claim ALT: `DyChCqg6MV2QmP2YGX19Ai9nEGriydCVFeiLigDLGRQn`.

Ранее зарезервированные пустые адреса `9ZLA…6eVv`, `2uGK…tAr`, `5Pbb…gMZK` и
`5p7K…2vW3` выведены из использования из-за отсутствия keypair. На них не было
deploy или SOL; они не являются частью release и не должны пополняться.

Frozen production SBF после PDA-mint upgrade 2026-10-07 занимает `881680` байт, SHA-256
`124147cf9ba9683aad0943c8806e4eae976b6a2b98c4963b4c8803e33ab5f21e`.
ProgramData capacity `882048` байт содержит `4.481682680 SOL` recoverable rent;
upload buffer закрыт после
deploy, а Program tombstone составляет `0.000833120 SOL`.

Текущий PDA-mint release: `e4c26a7`. Backend:
`/srv/ownataxi/releases/20261007T-pda-mint-e4c26a7`; frontend:
`/var/www/ownataxi/releases/20261007T-pda-mint-e4c26a7/full`.
Upgrade и проверки rent/authority/buffer/ELF завершены на finalized;
worker остаётся выключен. Доказательства и ограничения smoke:
`docs/PDA-MINT-VALIDATION.md`. Исторический `deploy-program-mainnet.sh` закреплён
за исходным ELF и не предназначен для повторного deploy актуального release.

Mainnet deployment выполнен 2026-10-03: initial deploy
`4L7RWMMzhLpBqrApYwX1pDLnmrusSpwuRogs2YFLTkT6qdm4Mr2TM8rGhqUiBoS798KqUqcc8qRoBiiaR6GRKrdH`,
финальный upgrade `5eK2mgqMvFjh9tQEmAz9DfBGv9U2CbTRv4SjeDxxZjCBkFe5U2kXsuXFxixbKNN2dxkfs2MmgQCM46itVbC2gmnc`.
Collection переключена до старта sale и до первого mint на `Ebcw…RXpm` транзакцией
`4oDz4H…7nPSZ`; DAS подтверждает authority `F3jK…n8tR`. Ошибочно созданная до
переноса authority Collection сожжена и оставила только Core tombstone `0.000655320 SOL`.
2026-10-03 test CA `C4TZ…NKrj` был привязан к протоколу. Paid-mint smoke выпустил
Comfort asset `EMaK…Z4iU` транзакцией `REV4ve…E1Hz`. Production protocol сейчас
`live`, saleStarted `true`, supply `[0,1,0,0]`. Production worker smoke подтвердил
creator-fee claim/deposit, FARE/xStock swaps и reward calculation. Автоматический
retry после временных RPC-ошибок также завершён успешно. Активной машине доступны
`348.516417 TAXI`, `0.00017406 UBERx`, `0.00003261 TSLAx`, `0.00003549 GOOGLx`
и `0.00004800 AMZNx`; все reward `nextPool` и `seriesRemaining` пусты. Protocol
vault содержит `15,151` lamport, необработанные creator fees отсутствуют.
Trade index version `6` исключает rent создания/закрытия token accounts из
исторических цены и объёма; после rebuild показатель 24H составляет около `-4.47%`.
Постоянный worker остаётся выключенным.
Recovery manifest SHA-256:
`f69756b7498ecf6df74cd5954d4cb1cb352fd0f17f7620ee1b704af80b503153`;
fail-closed close dry-run — PASS, но close не выполнялся.

## 1. Сначала зафиксировать Program ID

До создания `$FARE` нужен отдельный Solana program keypair, хранящийся вне репозитория и project workspace. Его публичный адрес должен совпадать одновременно в:

- `programs/taxi_park/src/lib.rs` — `declare_id!`;
- `Anchor.toml` — `programs.*.taxi_park`;
- `.env` — `TAXI_PROGRAM_ID`;
- `.env` — `VITE_TAXI_PROGRAM_ID`.

После изменения адреса заново собрать SBF. `npm run protocol:preflight` отклонит рассинхронизацию этих четырёх значений.

### Disposable rehearsal keyset preparation

До финальной команды script работает только как dry-run и ничего не создаёт.
После `начинай репетицию` одноразовый keyset создаётся вне repository, сразу
архивируется в указанный Desktop ZIP и проверяется повторным derivation из архива:

```powershell
powershell -File scripts/prepare-disposable-keyset.ps1 `
  -OutputDirectory C:\Users\ivand\Desktop\FareShare-Rehearsal-Keyset `
  -BackupZip C:\Users\ivand\Desktop\FareShare-Rehearsal-Keyset.zip `
  -UpgradeAuthorityAddress 2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF
```

Execute требует дополнительно `-Execute` и точную строку из dry-run. Script никогда
не выводит secret bytes и не использует созданные keys для транзакций. Полученный
`backup-marker.json` обязателен для disposable deploy preflight.

## 2. Devnet

1. Собрать актуальный `taxi_park.so` через `cargo build-sbf`.
2. Выполнить `npm run protocol:addresses` и сохранить выведенный `pumpCreator`; для вычисления PDA опубликованная программа ещё не нужна.
3. Создать обычный тестовый SOL-paired `$FARE` через официальный pump.fun, указав этот `pumpCreator` как creator.
4. Заполнить `$FARE` mint, четыре неизменяемых xStocks mint, devnet/test metadata URI, `MINT_PRICES_USD_CENTS` и параметры безопасности mint quote.
5. Выполнить `npm run protocol:preflight`.
6. Опубликовать программу в devnet с подготовленным program keypair и временной upgrade authority, затем выполнить `npm run protocol:initialize`.
7. Создать protocol Address Lookup Table, добавить адреса из `npm run protocol:claim-lookup-addresses` и записать её адрес в `VITE_TAXI_LOOKUP_TABLE`. Без ALT атомарный Claim ограничен четырьмя машинами, с ALT — десятью.
8. Запустить backend и worker, после чего проверить сценарии F0/F0a из `docs/SCENARIO-TESTS.md`: сбор до graduation, PumpSwap WSOL после graduation, swaps, расчёт, claim, ремонт и стажёра.

ALT создаётся и наполняется тем же явно указанным authority/payer и в той же сети, что и программа. Скрипт печатает адрес и обе finalized-подписи; полученный адрес записывается в `VITE_TAXI_LOOKUP_TABLE`:

```sh
node --env-file=.env.devnet --import tsx scripts/create-claim-lookup-table.ts
solana address-lookup-table get -u devnet <LOOKUP_TABLE_ADDRESS>
```

После `extend` нужно дождаться следующего slot до browser smoke. ALT не замораживается заранее: это сохраняет возможность обратно совместимо добавить новый постоянный адрес при upgrade программы.

### Возврат Devnet SOL

Devnet upgrade authority не отзывается. Поэтому rent ProgramData можно вернуть
deployer, если тестовое развёртывание окончательно закрывается. Небольшой rent
исполняемого Program account остаётся в необратимом loader-v3 tombstone и не
возвращается штатной командой Solana. Для текущего
Devnet доступны read-only аудит и защищённый recovery:

```sh
npm run protocol:audit-devnet-recovery
bash scripts/recover-devnet-sol.sh
```

Вторая команда по умолчанию выполняет только dry-run. Режим `--execute` требует
точную строку подтверждения, проверяет genesis Devnet, Program ID, ProgramData,
upgrade authority и локальные keypair. Скрипт запрещает необратимое закрытие, пока
в SOL- или token-vault остаются средства: сначала нужно поставить протокол на паузу
и вывести их командами `rescue-sol` / `rescue-token`. После проверки он возвращает
баланс worker и закрывает ProgramData в пользу deployer. Rent обычных PDA, коллекции,
mint и token account (сейчас около `0.0443 SOL`) текущая версия контракта не закрывает.

Команду с `--execute` нельзя запускать для обычного rollback: закрытие программы
необратимо и допустимо только после отдельного явного решения владельца.

Пример формы команды публикации; реальные пути и signer задаёт оператор:

```sh
solana program deploy -u devnet \
  --program-id <PROGRAM_KEYPAIR_PATH> \
  --upgrade-authority <UPGRADE_AUTHORITY_KEYPAIR_PATH> \
  <TAXI_PARK_SO_PATH>
```

## 3. Mainnet

Перед любым тестовым mainnet-развёртыванием пройти отдельный пошаговый checklist: [`docs/MAINNET-TEST-CHECKLIST.md`](docs/MAINNET-TEST-CHECKLIST.md). Тест микроцен выполняется только на disposable Program ID и отдельной Collection.

1. Проверить окончательные collection cover, 16 изображений и 17 metadata JSON в production Irys manifest `9evKWgrS3Jp6cGdDD3oBMRCoy7SYJ7gb6jBupX7ZMsaE`.
2. Повторно проверить официальные xStocks mint и выполнить `npm run protocol:check-xstocks`.
3. Сгенерировать один неизменяемый shuffled assignment manifest на 1222 paid NFT, сохранить его backup, записать совпадающий `MINT_ASSIGNMENT_ROOT_HEX`, установить `MINT_PRICES_USD_CENTS=2500,2500,2500,2500` и проверить live `$FARE → USDC` route, price impact, TTL и signer.
4. Заполнить production RPC/DAS, MongoDB, домены, API key и три разных server keypair.
5. Выполнить `npm run protocol:addresses` и подготовить параметры будущего `$FARE` с полученным `pumpCreator`, не создавая токен заранее.
6. Выполнить `npm run protocol:preflight` и только затем опубликовать тот же проверенный SBF в mainnet-beta, сначала сохранив upgrade authority.
7. Выполнить `protocol:initialize`; на этом этапе `$FARE` ещё может не существовать, а `fare_mint` в Configuration PDA останется пустым.
8. Первый `$FARE` задаётся через `/admin/` или `npm run protocol:admin -- set-fare-mint <CA>`. Для замены существующего CA администратор вставляет новый CA в `/admin/`, проверяет автоматически прочитанный ticker и подтверждает одну операцию `Cash out and replace CA`. Backend проверяет совместимость, ликвидность и отсутствие активной reward-series, ставит протокол на pause, выводит только старый protocol FARE в fixed wallet `2NUN…EGVnF`, продаёт точную выведенную сумму в WSOL, разворачивает WSOL в native SOL на тот же кошелёк и выполняет cash-out reset. Reset требует пустые старый и новый protocol vault; одной транзакцией очищает FARE-обязательства и checkpoints всех machine/trainee, не меняет stock rewards, переключает CA, инвалидирует старый swap nonce и оставляет новый `next_pool` нулевым. После проверки backend возвращает протокол в исходное paused/live состояние. Этапы сохраняются в MongoDB и повтор того же CA продолжает незавершённую операцию; ошибка оставляет протокол на pause и средства в последнем подтверждённом old-token/WSOL/SOL состоянии. Максимальный slippage автоматической конвертации ограничен 1000 bps. Wallet FARE, stock vault и protocol SOL не продаются. Прямой `set-fare-mint` больше не заменяет существующий CA. После завершения проверить нулевые старые обязательства и `next_pool`, пустой новый vault, SOL delta recipient, одинаковый CA в Configuration PDA, `/api/token`, Trade, mint quote и public overview; старые quotes должны отклоняться. Проверить mint: подписаны owner/asset/class/CA/raw amount/USD cents/expiry, 100% текущего `$FARE` поступает в canonical team ATA, а burn/reward-pool mint payment не меняет.
   Перед upgrade сравнить размер frozen `.so` с capacity ProgramData (`space - 45`). Текущий cash-out reset build имеет `827880` байт при mainnet capacity `803744`, поэтому перед его публикацией требуется отдельный `solana program extend 3i1YDj1ZKCypwoYqP21CzGatdPMzuRPUGrsjSxGBEp1Z 24136 --url mainnet-beta --keypair <явный fee-payer>`. Сначала проверить сеть, Program ID, ProgramData, upgrade authority и баланс fee payer; затем подтвердить новый ProgramData account space `827925`, capacity `827880` и recoverable rent `4.206509240 SOL`. Extension добавляет `0.122610880 SOL` recoverable rent и не отзывает upgrade authority. Размер и точную дельту пересчитать заново, если frozen artifact изменился; никогда не использовать default signer или `--final`.
9. До `start-sale` загрузить отдельную trainee metadata и записать `TRAINEE_METADATA_URI`. Smoke activation должна создать asset в основной Collection с `PermanentFreezeDelegate.frozen = true` и immutable `PluginAuthority::None`; transfer trainee обязан завершаться ошибкой, transfer платной машины — проходить.
9. Создать и проверить отдельную mainnet ALT по процедуре Devnet, затем записать её адрес в production `VITE_TAXI_LOOKUP_TABLE`.
   Если initialize с полными metadata превышает лимит транзакции, сначала выполнить
   `npm run protocol:create-initialize-lookup`, сохранить выведенный адрес в
   `VITE_TAXI_LOOKUP_TABLE`, и только затем запускать `protocol:initialize`.
10. Проверить, что `/api/token`, hero и `/trade/` показывают тот же CA и введённый в админке тикер; затем проверить vault, collection, все mint и реальные минимальные денежные сценарии, включая Claim десяти машин. Только после этого вручную вызвать `start-sale`; без привязанного CA контракт отклонит запуск продажи.

## 4. Сохранить upgrade authority и возможность вернуть rent

Upgrade authority после smoke-тестов **не отзывается**. Это позволяет оперативно
исправить инцидент и, если проект когда-либо окончательно закрывается, закрыть
программу штатной командой Solana и вернуть rent ProgramData получателю.

`solana program set-upgrade-authority --final` запрещено выполнять без нового
явного решения владельца: операция необратима и уничтожает возможность вернуть
депозит программы. Само закрытие программы также необратимо и не является частью
обычного deploy или обновления.

### Обязательная гарантия сохранности mainnet rent

Перед любым release отдельно проверить поддержку Pump creator fees: direct
creator `2NUN…` и immutable active version-2 sharing config с единственной долей
`2NUN… = 100%`. Поддержка безопасного sharing-варианта обязательна; произвольные,
редактируемые или разделённые configs должны отклоняться on-chain и backend.

Это блокирующее требование релиза, а не рекомендация. Боевой deployment обязан
повторять уже проверенный mainnet lifecycle: `deploy → проверка → работа → pause →
освобождение vault → close → возврат ProgramData rent`.

**Mainnet deploy запрещён**, пока одновременно не выполнены все условия:

1. Upgrade authority остаётся у зафиксированного admin/deployer
   `F3jKZokibZiN5SJM5JM4T3a99HVb4zueDTGPR5hbn8tR`; локальный keypair проверен,
   имеет защищённую резервную копию и не зависит от единственного сервера.
2. В deploy-команде явно указан этот upgrade authority и отсутствует `--final`.
3. Upload buffer создаётся постоянным известным keypair вне репозитория. При любом
   обрыве известна точная команда его закрытия и возврата rent тому же deployer.
4. После deploy проверены Program ID, ProgramData address, upgrade authority,
   размер и SHA-256 выгруженного ELF. Оставшийся buffer закрыт, его баланс возвращён.
5. До перевода основной суммы подготовлен mainnet recovery dry-run, который жёстко
   проверяет mainnet genesis, Program ID, ProgramData, authority, recipient и все
   локальные signer. Подстановка адресов или сети через небезопасные defaults запрещена.
6. Recovery-аудит отдельно показывает: возвращаемый ProgramData rent, невозвратный
   Program tombstone, balances всех SOL/token vault и ожидаемый итоговый баланс.

Для target-specific read-only проверки используется:

```sh
npm run protocol:audit-mainnet-recovery
npm run protocol:audit-mainnet-recovery -- --require-paused --require-empty-vaults
```

Команда намеренно не имеет адресных или signer defaults. В отдельном некоммитимом
`.env.mainnet-recovery` нужно явно задать `SOLANA_RPC_URL`,
`RECOVERY_PROGRAM_ID`, `RECOVERY_PROGRAMDATA_ADDRESS`,
`RECOVERY_AUTHORITY_ADDRESS`, `RECOVERY_FEE_PAYER_ADDRESS`,
`RECOVERY_RECIPIENT_ADDRESS`, `RECOVERY_BUFFER_ADDRESS`,
`RECOVERY_WORKER_ADDRESS`, `RECOVERY_BACKEND_ADDRESS` и пути к keypair для
authority, fee payer, buffer, worker и backend. Скрипт не отправляет транзакции.

Для текущего SBF ожидается, что rent upload buffer `3.402162360 SOL` возвращается
после deploy, а `3.402203000 SOL` ProgramData возвращается только при окончательном
закрытии. `0,00083312 SOL` исполняемого Program account останется в loader-v3
tombstone и считается заранее известной невозвратной стоимостью. Комиссии также
невозвратны. Эти суммы перед реальным deploy обязательно пересчитываются по точному
размеру финального бинарника и текущей mainnet rent rate.

### Строгий порядок окончательного закрытия mainnet

Закрытие допустимо только по отдельной явной команде владельца и выполняется строго
в таком порядке:

1. Остановить backend/worker и любые процессы, способные отправлять транзакции.
2. Поставить протокол на паузу и подтвердить on-chain pause.
3. Зафиксировать balances, обязательства и список всех SOL/token vault.
   До rescue обязательно выполнить `npm run protocol:audit-shutdown-claims -- --require-zero`.
   Скрипт связывает каждую ненулевую Machine reward с текущим DAS owner. Если owner
   недоступен, paused-программа позволяет admin вызвать `shutdown_claim_for_owner`
   или `shutdown_claim_trainee_for_owner`: подпись owner не нужна, но выплата может
   уйти только в canonical ATA фактического NFT owner. После owner-bound settlement
   аудит повторяется с `--require-zero`. Отдельная shutdown-инструкция может очистить
   только rounding dust не более `16 raw` на один asset; более крупная obligation
   всегда блокирует rescue и close.
4. Выполнить разрешённые `rescue-sol` / `rescue-token` на заранее проверенные
   адреса получателей.
5. Повторный аудит обязан подтвердить нулевой доступный SOL в fee vault и нулевые
   raw amounts во всех token vault. Любое ненулевое значение блокирует close.
6. Повторно проверить mainnet genesis, точный Program ID, ProgramData, authority,
   deployer keypair и recipient. Authority, fee payer и recipient передаются в CLI
   явно; reliance на default signer запрещён.
7. Записать баланс deployer до операции, закрыть программу, дождаться `finalized`,
   затем подтвердить отсутствие ProgramData и статус `Program ... has been closed`.
8. Сверить изменение баланса с ожидаемым ProgramData rent за вычетом комиссий и
   сохранить signature закрытия в release notes.

Исполняемый fail-closed wrapper (по умолчанию только dry-run):

```sh
npm run protocol:close-mainnet-programdata -- \
  --manifest /absolute/frozen-rehearsal-manifest.json \
  --manifest-sha256 <FROZEN_FILE_SHA256> \
  --rpc-url <EXPLICIT_MAINNET_RPC> \
  --program-id <PROGRAM_ID> --programdata <PROGRAMDATA> \
  --authority <AUTHORITY> --fee-payer <FEE_PAYER> --buffer <BUFFER> \
  --recipient <RECOVERY_RECIPIENT> --worker <WORKER> --backend <BACKEND> \
  --authority-keypair <PATH> --fee-payer-keypair <PATH> --buffer-keypair <PATH> \
  --worker-keypair <PATH> --backend-keypair <PATH> \
  --services-stopped "I CONFIRM ALL TRANSACTION-SENDING SERVICES ARE STOPPED" \
  --protocol-paused "I CONFIRM THE PROTOCOL IS PAUSED ON CHAIN" \
  --max-fee-lamports <BOUND>
```

Manifest обязан быть frozen в режиме `complete`, содержать постоянный upload
buffer и точный `recoverableRentLamports`; SHA-256 файла также передаётся явно.
Все адреса и существующие keypair paths обязательны и сверяются без default signer.
Dry-run выполняет усиленный аудит с `--require-paused --require-empty-vaults`, но
никогда не вызывает close. Для необратимого запуска после отдельного разрешения
добавляются `--execute` и точная строка `--confirm`, напечатанная успешным dry-run.
Wrapper повторяет аудит непосредственно перед close, запрещает `--final`, ждёт
`finalized` и проверяет исчезновение ProgramData, сохранение Program tombstone и
дельту recipient в пределах `recoverable rent - bounded fees`.
Пользовательский fee bound дополнительно ограничен жёстким максимумом `0.001 SOL`.

Запрещено закрывать программу ради rollback, при работающих сервисах, при ненулевых
vault, при несовпадении хотя бы одного адреса или без доступной резервной копии
authority keypair. После close тот же Program ID использовать повторно нельзя.

Текущая rehearsal-программа `3i1Y…Ep1Z` окончательно закрыта на mainnet-beta
2026-10-03. Close signature: `5p1cJoeCC2NwVGUZRYCrHFBnCV9PnkYZWyiHWdQHKW9VTBCCpxWepL8mkT2p44BRUQcDSQSja8RbRTTTPz2c6zPr`.
ProgramData `5dRM…DSiuW` отсутствует, recipient `2NUN…EGVnF` получил
`4.442094320 SOL` после комиссии `0.000005000 SOL`, а Program ID остался loader-v3
tombstone с `0.000833120 SOL`.

### Подтверждение на настоящем mainnet

Минимальная программа прошла полный цикл на mainnet-beta 2026-09-28:

- payer/authority/recipient: `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF`;
- Program ID: `56acKgFW1Tn9vzcsBysWiYNjQYBzTySdLfZzUk1NCctp`;
- deploy: `LQdRRs59P5FsUMk48vfLfHWbfrcfs71zJLqxZNZzo1iBoSiun7UWECpE2uNXsmGTDnaucNk6o39SyYxyc5oej26`;
- успешный вызов: `57BdjJuNgo1PwEBzfHUTFygF2uqvgiiYRSjmwtQhR59GWGhbF2RvTj5CH24gL4u6vLFK1iR5ur45GQbvjtn9m9am`;
- close: `4e1EiSGvaghfasDpoKPPABJG5BQ8hWK8bKyj9FfDMu8m7HhukM8den2gACXdpxQvQdRazcA4Jy2HkGCWUG8d7drC`;
- возвращено из ProgramData: `0,11410188 SOL`;
- полный невозвратный расход: `0,00097812 SOL`, из них `0,00083312 SOL` —
  loader-v3 tombstone, остальное — комиссии.

Тест доказывает сам механизм Solana, но не заменяет перечисленные выше проверки
точных production-адресов и balances перед закрытием боевой программы.

### Одноразовый rehearsal deploy

Одноразовая rehearsal-программа использует отдельный скрипт и только полностью
проверенный manifest (`validationMode: "complete"`). Безопасный режим по умолчанию
задаётся явно и не отправляет транзакции:

```sh
npm run rehearsal:deploy -- preflight \
  --manifest /secure/rehearsal-manifest.json \
  --program-so /secure/taxi_park.so \
  --program-keypair /secure/program.json \
  --upgrade-authority-keypair /secure/authority.json \
  --fee-payer-keypair /secure/fee-payer.json \
  --recipient-keypair /secure/recipient.json \
  --buffer-keypair /secure/persistent-buffer.json \
  --buffer-address <EXPECTED_BUFFER_ADDRESS> \
  --backup-marker /secure/rehearsal-key-backup.json \
  --rpc-url <EXPLICIT_MAINNET_RPC_URL>
```

Backup marker — JSON вне репозитория с точными `programId`, `upgradeAuthority`,
`buffer`, значением `backupVerified: true` и непустым `verifiedAt`. Скрипт никогда
не генерирует ключи. Preflight проверяет mainnet genesis, все keypair/address,
ProgramData PDA, SBF hash/size и текущий rent buffer/ProgramData. ProgramData rent
обязан точно совпасть с `limits.recoverableRentLamports` manifest.

Режим `execute` принимает те же аргументы плюс `--confirm` со строкой, напечатанной
успешным preflight. Любое другое подтверждение блокирует deploy. `--final` запрещён;
fee payer, authority, recipient и постоянный buffer всегда передаются явно.

## 5. Что не входит в автоматический deploy

- создание или финансирование production-кошельков;
- создание pump.fun токена и оплата его запуска;
- загрузка файлов в Arweave/Irys;
- юридическое одобрение xStocks-предупреждения;
- внешний аудит контракта;
- публикация frontend/backend и изменение DNS.

Эти действия требуют отдельных явных решений и доступа оператора.

# Публикация программы в mainnet

Актуальный deployed SBF-файл собран в WSL по пути
`/home/ivand/taxi-sbf-rounding-17031ed/artifact/taxi_park.so`; его размер — `678968`
байт, SHA-256 — `1eae14a88f7b10b1a32c29a995d17d915ec4886994e09fa120d2582aec509339`.
ProgramData имеет capacity `679792` байт и recoverable rent `3.454222200 SOL`.
Повторный upgrade бинарником не больше этой capacity требует временный buffer
`3.449995640 SOL` плюс transaction fees; buffer закрывается после проверки и rent
возвращается authority. Program account `0.000833120 SOL` остаётся loader-v3
tombstone только после окончательного close.

Deploy сохраняет upgrade authority постоянно, чтобы обновление или окончательное
закрытие программы с возвратом rent оставались возможны.

Запуск из WSL:

```sh
bash scripts/deploy-program-mainnet.sh
```

Безопасная проверка всех release gates без отправки deploy-транзакции:

```sh
DEPLOY_PREFLIGHT_ONLY=1 bash scripts/deploy-program-mainnet.sh
```

Скрипт откажется выполнять deploy, если ключ программы или плательщика не
совпадает с зафиксированным адресом, размер или хеш бинарника изменился,
программа уже существует либо на кошельке меньше `6.82 SOL`. Для upload используется
постоянный локальный buffer keypair вне репозитория. Поэтому даже при обрыве
deploy временный депозит не становится бесхозным: повторный запуск продолжит
работу с тем же buffer, а скрипт напечатает точную команду его закрытия и возврата
SOL. После подтверждённого deploy оставшийся buffer закрывается автоматически.
Скрипт отдельно проверяет, что upgrade authority остался у зафиксированного
admin, и никогда не передаёт `--final`.

Перед release freeze проверено: production keyset имеет независимую резервную
копию, disposable ProgramData и ALT закрыты, recoverable SOL возвращены на
`2NUN…EGVnF`, итоговый finalized balance — `6.829425097 SOL`. Permanent Program ID
`GHGq…i3i4` onchain отсутствует; это ожидаемое состояние до отдельного разрешения
на deploy.

Permanent mainnet deploy выполнен после отдельного разрешения владельца: release
SHA `d900a2f9d1baf2384c13d26533978fd91af4c690`, signature
`5XcXqasMLq6SMG599p8Qu1yqhrv2LVJ7Has27pJLXQJMcwZVRPEeGz4hEptbvJzDmifySSAkADnep7SvheB2sxDz`,
slot `451769173`. Onchain ELF имеет точный frozen SHA-256
`61abf9dad7389db5f28c6b149d4a20cd9cf5a30a6f5e84c650e329e7251ab2f1`;
ProgramData `3mUa…eazU`, authority `2NUN…EGVnF`. Upload buffer закрыт, post-deploy
balance — `3.423058977 SOL`. `--final` не использовался.

Production initialization выполнена отдельным разрешённым этапом. Initialize ALT
`95zxT5xTRhrzPRwqBYgRCHudshVeeHNZkK67HjfnAMsQ`: create `4tMkSd…KdsQD`, extend
`23v4r8…Kyq7gT`. Initialize `3qVfNq…jdXPst`, четыре metadata batches
`5rRUv3…WmC87P`, `Q9AZrx…HW3Ut`, `2NVuAJ…anMfQc`, `icCfNQ…ieacht`, reward vaults
`4DeFei…C4kuPu`. Core Collection: `5DwDHVk2ciBi4J9rLAxEpoqea26WJpwd9Xbu31N5nroP`.
Onchain проверены admin/backend/team, четыре xStocks mint, все 16 URI, цены
`1000000 / 3000000 / 10000000 / 30000000`, нулевой supply и `saleStarted=false`.
`fareMint` остаётся пустым до создания финального `$FARE`; после его привязки эта
же ALT расширяется claim-адресами. Post-initialize balance — `3.370009257 SOL`.

Для безопасной pre-sale проверки временно привязан ранее проверенный test mint
`4fg5Nh2wjVddSfDPW1AATQ9Tvmdc1Np1pBQQGL4Mpump` (`TAXI EMPIRE`, symbol `TAXI`):
finalized bind `9AHbm4…opAv7W`. Повторная проверка подтвердила активную SOL bonding
curve, Token-2022 и canonical immutable fee-sharing v2 `100% → 2NUN…EGVnF` без
Mayhem/Cashback/Holder Rewards/custom fee. FARE vault `6abo81…TcrvRV` создан,
ALT `95zx…AMsQ` расширена до 21 claim-адреса (`4w87QZ…L4nWMR`). Sale не запущена,
supply `[0,0,0,0]`; поэтому CA можно заменить финальным `$FARE`. Запускать
`start-sale` с этим тестовым CA запрещено без отдельного решения владельца.
Pre-sale mint simulation против permanent program ожидаемо вернула Anchor
`SaleNotStarted` (`6041`) до отправки транзакции; NFT не создавался и SOL не
списывались.

После решения считать deployment тестовым цены до старта sale уменьшены до
`1 / 3 / 10 / 30` lamports (`3UKNWG…Wr3QZ7E`), sale открыта
`2EmVS6…UKjcvB`. Отдельный buyer `7BJt…Sruxi` получил ограниченные `0.2 SOL`.
Успешно выполнены 16 mint: supply `[4,4,4,4]`, варианты каждого класса `0–3`;
DAS подтвердил ownership, Collection и все 16 URI. Core transfer последней машины
к worker и обратно: `2yvwEz…xMHWc`, `iZXXNX…GqJtFb`.

Reward smoke использовал суммарно `0.1 SOL` test deposit. Успешно куплены и
распределены `$TAXI`, TSLAx и GOOGLx; UBERx/AMZNx оставлены нулевыми, потому что
текущие Jupiter routes требовали бы существенно больший test amount. Claim 10
`2YmKnZ…8Wmi1y` увеличил три доступных reward balance; invalid Claim 10 был
атомарно отклонён без изменений. Repair 8 `4WZgsK…RkjpS5` сжёг точно
`11,594,516,239` raw `$TAXI`. Остатки свободного SOL buyer/worker возвращены на
admin, оба баланса равны нулю. Финальная pause: `4Z2mUq…5R1ft2m`.

После smoke admin имеет `3.129511961 SOL`; ProgramData rent `3.402203000 SOL`
не затронут и остаётся recoverable. В FeeVault остаётся `0.088932152 SOL`, а также
reward tokens и обязательства тестовым NFT; их нельзя считать потерянными, но
выводить следует только при отдельном закрытии теста после paused/empty audit.

30 сентября 2026 обнаружено расхождение rounding dust: accumulator сохранял
дробный остаток, но тот же raw remainder повторно возвращался в `next_pool`.
Из-за этого claim двух активных машин превышал backing на `6 raw TSLAx` и
`2 raw GOOGLx`. Protocol поставлен на pause (`624smE…WeUUb`), ProgramData
расширен на минимальные `10240` байт (`3Ap6mi…JYzY`), затем SBF из commit
`17031ed` опубликован signature `2a8vJh…hWLotu`, slot `451816905`.
On-chain ELF проверен по SHA-256, authority `2NUN…EGVnF` сохранена, постоянный
buffer `5uK9…TuoQ` закрыт и его rent возвращён. Vault точно пополнен на
`6 raw TSLAx + 2 raw GOOGLx` transaction `4DHPgU…Jjg55`; после unpause
`ctEVpD…XZZkB` fresh Claim simulation завершилась с `err: null` и `152981 CU`.
Новая логика резервирует весь accumulator budget один раз, а legacy claim после
фактического token transfer безопасно выравнивает заниженное поле obligations.

Чтобы использовать приватный server-side Helius endpoint, задайте
`SOLANA_RPC_URL`; иначе используется публичный mainnet endpoint.

## Проверка возврата rent

Актуальная 16-variant логика прошла полный disposable mainnet lifecycle, включая
deploy/upgrade, побайтовую проверку ELF, закрытие buffer и подтверждение возврата
ProgramData rent старого disposable deployment. Frozen production SBF отличается
Program ID и поэтому имеет отдельный SHA-256, который жёстко проверяет deploy script.
Rent buffer и ProgramData возвращается плательщику, но rent исполняемого Program
account loader-v3 оставляет в необратимом tombstone.
