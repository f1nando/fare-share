# Развёртывание Taxi Park

> **Текущий статус:** по решению владельца deployment `GHGq…i3i4` и Collection
> `5DwD…5nroP` являются mainnet-тестом, а не production-релизом. Sale была открыта
> только для smoke и после тестов снова поставлена на pause. Для настоящего запуска
> потребуется новый Program ID, новая Collection и отдельный release freeze.

Публикация не выполняется автоматически. Все команды ниже запускает оператор вручную после заполнения production-значений и успешного `npm run protocol:preflight`.

Постоянный публичный Program ID подготовлен: `GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4`. Его keypair, а также отдельные admin/backend/worker keypair хранятся локально вне репозитория и не передаются через Git или чат.

Подготовленные публичные адреса:

- admin/deployer: `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF`;
- backend signer: `DixHreV9jd2wdnA1FJYcrN5kdfuv5TbYGk7XEd2pxG6w`;
- worker: `4KxGWNpEiyZTNhcRtJGMYERniHDH6rSb1Mwk8pFxa6Cq`;
- `FeeVault` и pump.fun creator PDA: `Hi8JVmmHZmyDnQg8JH3i4jVPcN8GNfGC4KsoQWMvNLT6`.

Ранее зарезервированные пустые адреса `9ZLA…6eVv`, `2uGK…tAr`, `5Pbb…gMZK` и
`5p7K…2vW3` выведены из использования из-за отсутствия keypair. На них не было
deploy или SOL; они не являются частью release и не должны пополняться.

Для первой mainnet-публикации admin/deployer должен иметь минимум `6.82 SOL`. Frozen production SBF занимает `669552` байт. При deploy одновременно финансируются известный upload buffer (`3.402162360 SOL`), upgradeable ProgramData (`3.402203000 SOL`) и Program tombstone (`0.000833120 SOL`); точный peak до transaction fees — `6.805198480 SOL`. Buffer возвращается после успешного deploy, а ProgramData rent остаётся recoverable, пока сохранена upgrade authority.

## 1. Сначала зафиксировать Program ID

До создания `$FARE` нужен отдельный Solana program keypair, хранящийся вне репозитория и project workspace. Его публичный адрес должен совпадать одновременно в:

- `programs/taxi_park/src/lib.rs` — `declare_id!`;
- `Anchor.toml` — `programs.*.taxi_park`;
- `.env` — `TAXI_PROGRAM_ID`;
- `.env` — `VITE_TAXI_PROGRAM_ID`.

После изменения адреса заново собрать SBF. `npm run protocol:preflight` отклонит рассинхронизацию этих четырёх значений.

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
8. Текущий `$FARE` задаётся и в любой момент заменяется через `/admin/` или `npm run protocol:admin -- set-fare-mint <CA>`. После замены проверить одинаковый CA в Configuration PDA, `/api/token`, Trade, mint quote и public overview. Старые quotes должны отклоняться. Остаток старого vault не переносится автоматически и проверяется отдельно. Проверить mint: подписаны owner/asset/class/CA/raw amount/USD cents/expiry, 100% текущего `$FARE` поступает в canonical team ATA, а burn/reward-pool mint payment не меняет.
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
   `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF`; локальный keypair проверен,
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

Запрещено закрывать программу ради rollback, при работающих сервисах, при ненулевых
vault, при несовпадении хотя бы одного адреса или без доступной резервной копии
authority keypair. После close тот же Program ID использовать повторно нельзя.

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
