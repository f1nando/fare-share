# Развёртывание Taxi Park

Публикация не выполняется автоматически. Все команды ниже запускает оператор вручную после заполнения production-значений и успешного `npm run protocol:preflight`.

Постоянный публичный Program ID подготовлен: `9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv`. Его keypair, а также отдельные admin/backend/worker keypair хранятся локально вне репозитория и не передаются через Git или чат.

Подготовленные публичные адреса:

- admin/deployer: `2uGKLnabWRSpDJaQSBy2fcbYzd8p8BYVzXNMgqzNNtAr`;
- backend signer: `5PbbDrUdCBfGtVXMKJLqnTieFBKLC5CbHxeaasNGjMZK`;
- worker: `5p7KyaZjr4ET5RcFN4U8zcG7JjFhgqAEzMT3BzUJ2vW3`;
- `FeeVault` и pump.fun creator PDA: `Buzxr6WtSxBmi7kZawxZ6KEjZ1465AhvYg6ZKPm4HR65`.

Для первой mainnet-публикации admin/deployer должен иметь примерно `8 SOL`: release-профиль `opt-level = "s"` уменьшает SBF примерно до 709 KB без нового stack warning в коде Taxi Park. При deploy одновременно финансируются временный upload buffer и upgradeable ProgramData. Неиспользованный rent временного buffer возвращается после успешного deploy; точная стоимость повторно проверяется непосредственно перед транзакцией.

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
4. Заполнить `$FARE` mint, четыре неизменяемых xStocks mint, devnet/test metadata URI, цены и остальные значения `.env`.
5. Выполнить `npm run protocol:preflight`.
6. Опубликовать программу в devnet с подготовленным program keypair и временной upgrade authority, затем выполнить `npm run protocol:initialize`.
7. Запустить backend и worker, после чего проверить сценарии F0/F0a из `docs/SCENARIO-TESTS.md`: сбор до graduation, PumpSwap WSOL после graduation, swaps, расчёт, claim, ремонт и стажёра.

Пример формы команды публикации; реальные пути и signer задаёт оператор:

```sh
solana program deploy -u devnet \
  --program-id <PROGRAM_KEYPAIR_PATH> \
  --upgrade-authority <UPGRADE_AUTHORITY_KEYPAIR_PATH> \
  <TAXI_PARK_SO_PATH>
```

## 3. Mainnet

1. Подготовить окончательные четыре изображения/metadata JSON и загрузить их в Arweave через Irys.
2. Повторно проверить официальные xStocks mint и выполнить `npm run protocol:check-xstocks`.
3. Зафиксировать точные mint-цены в lamports по согласованным долларовым ориентирам.
4. Заполнить production RPC/DAS, MongoDB, домены, API key и три разных server keypair.
5. Выполнить `npm run protocol:addresses`, создать основной `$FARE` с полученным `pumpCreator` и записать mint в `.env`.
6. Выполнить `npm run protocol:preflight` и только затем опубликовать тот же проверенный SBF в mainnet-beta, сначала сохранив upgrade authority.
7. Выполнить `protocol:initialize`.
8. Проверить vault, collection, все mint и реальные минимальные денежные сценарии. Только после этого вручную вызвать `start-sale`.

## 4. Сделать программу неизменяемой

После окончания проверочного периода и внешнего аудита:

```sh
solana program set-upgrade-authority \
  -u mainnet-beta \
  --upgrade-authority <CURRENT_UPGRADE_AUTHORITY_KEYPAIR_PATH> \
  --final \
  <TAXI_PROGRAM_ID>
```

`--final` необратим: после него исправить код этого deployment нельзя. Сначала команда `solana program show -u mainnet-beta <TAXI_PROGRAM_ID>` должна подтвердить ожидаемую программу и текущую upgrade authority. Изменяемыми останутся только предусмотренные on-chain операции admin: pause, Rescue, team account, backend signer, Jupiter Program ID и двухэтапная передача admin. `$FARE` и xStocks mint не заменяются.

## 5. Что не входит в автоматический deploy

- создание или финансирование production-кошельков;
- создание pump.fun токена и оплата его запуска;
- загрузка файлов в Arweave/Irys;
- юридическое одобрение xStocks-предупреждения;
- внешний аудит контракта;
- публикация frontend/backend и изменение DNS.

Эти действия требуют отдельных явных решений и доступа оператора.
