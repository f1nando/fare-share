# Развёртывание Taxi Park

Публикация не выполняется автоматически. Все команды ниже запускает оператор вручную после заполнения production-значений и успешного `npm run protocol:preflight`.

Постоянный публичный Program ID подготовлен: `9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv`. Его keypair, а также отдельные admin/backend/worker keypair хранятся локально вне репозитория и не передаются через Git или чат.

Подготовленные публичные адреса:

- admin/deployer: `2uGKLnabWRSpDJaQSBy2fcbYzd8p8BYVzXNMgqzNNtAr`;
- backend signer: `5PbbDrUdCBfGtVXMKJLqnTieFBKLC5CbHxeaasNGjMZK`;
- worker: `5p7KyaZjr4ET5RcFN4U8zcG7JjFhgqAEzMT3BzUJ2vW3`;
- `FeeVault` и pump.fun creator PDA: `Buzxr6WtSxBmi7kZawxZ6KEjZ1465AhvYg6ZKPm4HR65`.

Для первой mainnet-публикации admin/deployer должен иметь примерно `6 SOL`: release-профиль `opt-level = "z"`, ограниченная heap-очередь и минимальные проверенные CPI к Metaplex/SPL уменьшают SBF до 558 456 байт без stack warning в коде Taxi Park. При deploy одновременно финансируются известный нам upload buffer и upgradeable ProgramData. Пиковая потребность — примерно `5,677 SOL`; rent временного buffer возвращается после успешного deploy, а в ProgramData остаётся примерно `2,838 SOL`. Пока upgrade authority сохранён, депозит ProgramData можно вернуть, навсегда закрыв программу; небольшой исполняемый Program account остаётся невозвратным loader-v3 tombstone.

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
7. Создать protocol Address Lookup Table, добавить адреса из `npm run protocol:claim-lookup-addresses` и записать её адрес в `VITE_TAXI_LOOKUP_TABLE`. Без ALT атомарный Claim ограничен четырьмя машинами, с ALT — десятью.
8. Запустить backend и worker, после чего проверить сценарии F0/F0a из `docs/SCENARIO-TESTS.md`: сбор до graduation, PumpSwap WSOL после graduation, swaps, расчёт, claim, ремонт и стажёра.

ALT создаётся и наполняется тем же явно указанным authority/payer и в той же сети, что и программа:

```sh
solana address-lookup-table create -u devnet --authority <AUTHORITY_PUBKEY> --payer <PAYER_KEYPAIR>
solana address-lookup-table extend -u devnet <LOOKUP_TABLE_ADDRESS> \
  --authority <AUTHORITY_KEYPAIR> --payer <PAYER_KEYPAIR> \
  --addresses "$(npm run --silent protocol:claim-lookup-addresses)"
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

1. Подготовить окончательные четыре изображения/metadata JSON и загрузить их в Arweave через Irys.
2. Повторно проверить официальные xStocks mint и выполнить `npm run protocol:check-xstocks`.
3. Зафиксировать точные mint-цены в lamports по согласованным долларовым ориентирам.
4. Заполнить production RPC/DAS, MongoDB, домены, API key и три разных server keypair.
5. Выполнить `npm run protocol:addresses`, создать основной `$FARE` с полученным `pumpCreator` и записать mint в `.env`.
6. Выполнить `npm run protocol:preflight` и только затем опубликовать тот же проверенный SBF в mainnet-beta, сначала сохранив upgrade authority.
7. Выполнить `protocol:initialize`.
8. Создать и проверить отдельную mainnet ALT по процедуре Devnet, затем записать её адрес в production `VITE_TAXI_LOOKUP_TABLE`.
9. Проверить vault, collection, все mint и реальные минимальные денежные сценарии, включая Claim десяти машин. Только после этого вручную вызвать `start-sale`.

## 4. Сохранить upgrade authority и возможность вернуть rent

Upgrade authority после smoke-тестов **не отзывается**. Это позволяет оперативно
исправить инцидент и, если проект когда-либо окончательно закрывается, закрыть
программу штатной командой Solana и вернуть rent ProgramData получателю.

`solana program set-upgrade-authority --final` запрещено выполнять без нового
явного решения владельца: операция необратима и уничтожает возможность вернуть
депозит программы. Само закрытие программы также необратимо и не является частью
обычного deploy или обновления.

### Обязательная гарантия сохранности mainnet rent

Это блокирующее требование релиза, а не рекомендация. Боевой deployment обязан
повторять уже проверенный mainnet lifecycle: `deploy → проверка → работа → pause →
освобождение vault → close → возврат ProgramData rent`.

**Mainnet deploy запрещён**, пока одновременно не выполнены все условия:

1. Upgrade authority остаётся у зафиксированного admin/deployer
   `2uGKLnabWRSpDJaQSBy2fcbYzd8p8BYVzXNMgqzNNtAr`; локальный keypair проверен,
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

Для текущего SBF ожидается, что rent upload buffer `2,83779468 SOL` возвращается
после deploy, а `2,83783532 SOL` ProgramData возвращается только при окончательном
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

## 5. Что не входит в автоматический deploy

- создание или финансирование production-кошельков;
- создание pump.fun токена и оплата его запуска;
- загрузка файлов в Arweave/Irys;
- юридическое одобрение xStocks-предупреждения;
- внешний аудит контракта;
- публикация frontend/backend и изменение DNS.

Эти действия требуют отдельных явных решений и доступа оператора.

# Публикация программы в mainnet

Актуальный SBF-файл собран вне диска C по пути
`D:\codex-taxi-sbf\deploy\taxi_park.so`; его размер — 558 456 байт, SHA-256 —
`fd50b5de5cdd703dc961fd43d422b9eba418df8387debc9b25b9206a2deb4d47`.
При текущей ставке аренды временный buffer (`2,83779468 SOL`), ProgramData
(`2,83783532 SOL`) и аккаунт программы (`0,00083312 SOL`) одновременно требуют
примерно `5,67646312 SOL`. На deploy следует положить 6 SOL, чтобы остался запас
на комиссии и повторные транзакции.

Deploy сохраняет upgrade authority постоянно, чтобы обновление или окончательное
закрытие программы с возвратом rent оставались возможны.

Запуск из WSL:

```sh
bash scripts/deploy-program-mainnet.sh
```

Скрипт откажется выполнять deploy, если ключ программы или плательщика не
совпадает с зафиксированным адресом, размер или хеш бинарника изменился,
программа уже существует либо на кошельке меньше 6 SOL. Для upload используется
постоянный локальный buffer keypair вне репозитория. Поэтому даже при обрыве
deploy временный депозит не становится бесхозным: повторный запуск продолжит
работу с тем же buffer, а скрипт напечатает точную команду его закрытия и возврата
SOL. После подтверждённого deploy оставшийся buffer закрывается автоматически.
Скрипт отдельно проверяет, что upgrade authority остался у зафиксированного
admin, и никогда не передаёт `--final`.

Чтобы использовать приватный server-side Helius endpoint, задайте
`SOLANA_RPC_URL`; иначе используется публичный mainnet endpoint.

## Проверка возврата rent

Перед mainnet тот же SBF был проверен на локальном validator с feature set,
скопированным из mainnet. Тест отдельно создал и закрыл upload buffer, затем
развернул программу, проверил точный размер `558 456` байт, upgrade authority и
побайтовое совпадение выгруженного ELF, после чего закрыл программу.

Локальный genesis использовал более высокую ставку rent: buffer удержал
`3,88800216 SOL`, ProgramData вместе с program account — `3,88805784 SOL`.
Rent buffer и ProgramData возвращается плательщику, но rent исполняемого Program
account штатная loader-v3 команда оставляет в необратимом tombstone. Mainnet-команда
`solana rent` для актуального размера по-прежнему показывает соответственно
`2,83779468 SOL` и `2,83783532 SOL`.
