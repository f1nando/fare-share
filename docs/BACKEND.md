# Backend Taxi Park

Backend не является источником истины для денег и начислений. Финансовое состояние находится в Solana PDA; MongoDB хранит только стажёрские кампании, журнал выданных ваучеров, rate limit и служебные настройки.

## Локальный запуск

1. Скопировать `.env.example` в `.env`.
2. Указать `MONGODB_URI`, 64-байтовый `BACKEND_SIGNER_SECRET_KEY` и случайный `TRAINEE_WORD_PEPPER`.
3. Убедиться, что публичный ключ backend signer совпадает с `Configuration.backend_signer` в Solana.
4. Запустить `npm run dev:server`.

Проверка доступности: `GET /api/health`.

## Первичная инициализация протокола

После публикации программы заполнить admin/setup-поля в `.env` и один раз выполнить:

```sh
npm run protocol:initialize
```

Команда атомарно создаёт основные PDA и официальную Metaplex Core Collection с `ImmutableMetadata`, затем идемпотентно создаёт шесть token accounts конфигурации: WSOL, `$FARE` и четыре xStocks. Для каждого mint автоматически используется его фактическая Token Program. Если первая транзакция уже прошла, а создание token accounts прервалось, повторный запуск безопасно завершает только отсутствующий этап.

До выполнения нужны реальные `FARE_MINT`, четыре `STOCK_MINTS`, постоянные `COLLECTION_URI`/`MACHINE_METADATA_URIS`, точные `MINT_PRICES_LAMPORTS` и случайный 32-байтовый `DEPLOYMENT_ID_HEX`. Заглушки из `.env.example` использовать нельзя.

## Кампания стажёра

```sh
npm run campaign:create -- 1 360 кодовое-слово "Первая кампания"
```

Продолжительность указывается в минутах от 60 до 10080 (7 дней). Слово сохраняется только в виде HMAC-SHA256 с серверным pepper. Оно не попадает в Solana, frontend bundle или ответ API.

Frontend отправляет `wallet`, `campaignId`, найденное слово и свободную страницу очереди в `POST /api/trainee/voucher`. Backend читает finalized Configuration PDA, рассчитывает ближайшую полную минуту protocol time и подписывает каноническое сообщение `TAXI_TRAINEE_V1`. Пользователь сам отправляет Ed25519 verify + `activate_trainee` одной Solana-транзакцией и оплачивает network fee/rent.

Повторно запросить ваучер разрешено: предыдущая транзакция могла истечь или не попасть в сеть. Ограничение «один кошелёк — одна активация каждой кампании» обеспечивает уникальный Trainee PDA в программе. API дополнительно ограничен десятью попытками за десять минут на пару IP+wallet.

## Проверки

```sh
npm run server:typecheck
node --import tsx --test tests/backend-voucher.test.ts tests/backend-worker.test.ts tests/backend-setup.test.ts
```

## Permissionless worker

```sh
npm run worker
npm run worker -- --once
```

Раз в `WORKER_INTERVAL_MS` worker проверяет finalized on-chain состояние. Он вызывает `collect_fees` только при наличии нового свободного SOL и последовательно догоняет основную и стажёрскую очереди. Для каждой транзакции он читает heap-страницы, выбирает события строго по `timestamp + eventNumber`, добавляет только нужные writable Machine/Bucket PDA и не превышает лимит 20 событий. При большом числе разных аккаунтов batch автоматически уменьшается, чтобы не собирать заведомо слишком крупную транзакцию.

Jupiter swaps будут подключены отдельным адаптером: актуальный Swap API v1 требует API key, quote и `swap-instructions`, а наш контракт дополнительно подписывает и проверяет exact input, `minOut`, deadline, nonce и hash всех route accounts. До добавления ключа worker безопасно накапливает SOL в отдельных резервах и не создаёт фиктивные токеновые начисления.

Worker не делит HTTP endpoint с admin-командами; admin-инструкции остаются только в ручной CLI на сервере.
