# Backend Taxi Park

Backend не является источником истины для денег и начислений. Финансовое состояние находится в Solana PDA; MongoDB хранит только стажёрские кампании, журнал выданных ваучеров, rate limit и служебные настройки.

## Локальный запуск

1. Скопировать `.env.example` в `.env`.
2. Указать `MONGODB_URI`, 64-байтовый `BACKEND_SIGNER_SECRET_KEY` и случайный `TRAINEE_WORD_PEPPER`.
3. Убедиться, что публичный ключ backend signer совпадает с `Configuration.backend_signer` в Solana.
4. Запустить `npm run dev:server`.

Проверка доступности: `GET /api/health`.

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
node --import tsx --test tests/backend-voucher.test.ts
```

Worker для `collect_fees`, Jupiter swaps и продвижения reward queues будет запускаться отдельным процессом. Он не должен делить HTTP endpoint с admin-командами; admin-инструкции остаются только в ручной CLI на сервере.
