# Чеклист посадки на финальный токен

Дата проверки: `TBD`

Проверяющий: `TBD`

Финальный CA: `TBD`

Тикер: `TBD`

Creator/claim wallet: `F3jKZokibZiN5SJM5JM4T3a99HVb4zueDTGPR5hbn8tR`

## 1. Зафиксировать исходное состояние

- [ ] Текущий CA записан: `TBD`
- [ ] Protocol state записан: `paused / live`
- [ ] SOL на `F3jK…n8tR`: `TBD`
- [ ] Токенов в старом protocol FARE vault: `TBD`
- [ ] Токенов старого CA в личном кошельке: `TBD`
- [ ] Main FARE obligations: `TBD`
- [ ] Trainee FARE obligations: `TBD`
- [ ] Protocol SOL: `TBD`
- [ ] Stock vault balances сохранены отдельно.
- [ ] Количество машин и trainee записано.

## 2. Проверить финальный токен

- [ ] В `/rehearsal/admin/` введён финальный CA.
- [ ] Нажата кнопка **Verify replacement**.
- [ ] Name, ticker, image и metadata правильные.
- [ ] Creator — `F3jK…n8tR` или canonical immutable sharing config с долей `F3jK…n8tR = 100%`.
- [ ] Mayhem выключен.
- [ ] Cashback выключен.
- [ ] Holder Rewards выключены.
- [ ] Custom editable creator fee выключена.
- [ ] Quote mint — SOL.
- [ ] Токен ещё не graduated.

Результат Verify: `PASS / FAIL`

## 3. Проверить отклонение неправильного CA

Использовать хотя бы один невалидный адрес: несуществующий CA, обычный SPL-токен или Pump-токен с другим creator.

- [ ] Verify вернул понятную ошибку.
- [ ] Protocol state не изменился.
- [ ] Текущий CA не изменился.
- [ ] Токены и SOL не перемещались.

Результат: `PASS / FAIL`

## 4. Проверить замену с пустым старым pool

- [ ] Старый protocol FARE vault равен нулю.
- [ ] Нажата кнопка **Cash out and replace CA**.
- [ ] Выполнен pause.
- [ ] Выполнен reset.
- [ ] Выполнен unpause.
- [ ] Продажа токенов не выполнялась.
- [ ] Новый reward pool равен нулю.
- [ ] Новый CA активен.
- [ ] Protocol снова `live`.

Pause signature: `TBD`

Reset signature: `TBD`

Unpause signature: `TBD`

Результат: `PASS / FAIL`

## 5. Проверить cash-out непустого pool

Выполнять только с небольшой тестовой суммой.

- [ ] В старый protocol reward pool внесена небольшая сумма.
- [ ] Отдельно записан баланс старого токена в личном кошельке.
- [ ] Выполнена замена CA.
- [ ] Продан ровно баланс protocol vault.
- [ ] Личные токены кошелька не продавались.
- [ ] Полученный WSOL развёрнут в native SOL на `F3jK…n8tR`.
- [ ] Старый protocol vault пуст.
- [ ] Новый protocol vault пуст.

Продано raw: `TBD`

Получено SOL: `TBD`

Sell signature: `TBD`

Результат: `PASS / FAIL`

## 6. Проверить очистку тестовых FARE-обязательств

- [ ] До замены создана небольшая machine FARE claimable.
- [ ] До замены создана небольшая trainee FARE obligation.
- [ ] После замены machine FARE claimable равна нулю.
- [ ] После замены trainee FARE obligation равна нулю.
- [ ] Main FARE obligations равны нулю.
- [ ] FARE `next_pool` и `series_remaining` равны нулю.
- [ ] Stock claimable не изменилась.

Результат: `PASS / FAIL`

## 7. Проверить сохранность остальных данных

Сравнить значения до и после замены.

- [ ] NFT-машины и их владельцы не изменились.
- [ ] Collection address не изменился.
- [ ] Количество minted машин не изменилось.
- [ ] Stock vault balances не изменились.
- [ ] Stock obligations не изменились.
- [ ] Protocol SOL не изменился.
- [ ] Team wallet не изменился.
- [ ] Личные токены кошелька не изменились, кроме явно разрешённых операций.

Результат: `PASS / FAIL`

## 8. Проверить API и интерфейс

- [ ] `/api/token` показывает новый CA и ticker.
- [ ] `/api/public/overview` показывает новый CA и `paused: false`.
- [ ] Админка показывает новый токен.
- [ ] Trade использует новый токен.
- [ ] Новый mint quote подписан с новым CA.
- [ ] Старый заранее созданный mint quote отклоняется.
- [ ] После обновления страницы старый CA не возвращается.

Результат: `PASS / FAIL`

## 9. Проверить перезапуск backend

- [ ] Backend перезапущен после успешной замены.
- [ ] `/api/token` всё ещё показывает новый CA.
- [ ] Public overview всё ещё показывает новый CA.
- [ ] Protocol остаётся `live`.
- [ ] Ручная настройка `FARE_MINT` в server env не потребовалась.

Результат: `PASS / FAIL`

## 10. Проверить повтор операции

- [ ] Повторно отправлен тот же CA.
- [ ] Повторная продажа не произошла.
- [ ] Повторный reset не изменил балансы.
- [ ] Результат вернулся как unchanged/resumed.
- [ ] Параллельный второй запуск блокируется.

Результат: `PASS / FAIL`

## 11. Проверить creator fee claim

Проводить после нескольких небольших сделок новым токеном.

- [ ] Creator fees появились.
- [ ] Claim выполнен через админку.
- [ ] SOL поступил на `F3jK…n8tR`.
- [ ] Другой кошелёк не может забрать creator fees.
- [ ] Повторный claim не списывает одну сумму дважды.

Claim signature: `TBD`

Получено SOL: `TBD`

Результат: `PASS / FAIL`

## 12. Проверить reward pool и worker

- [x] Новый reward pool пополнен небольшой суммой тестового `TAXI`.
- [x] Выполнен один ручной reward cycle.
- [x] Начисления созданы только в новом токене.
- [x] Выполнен один небольшой claim.
- [x] Баланс vault уменьшился на сумму claim.
- [x] Worker во время смены CA был выключен.
- [x] Ручной PASS получен; постоянный worker оставлен выключенным до release-решения.

Reward deposit signature: `4CF2ktaeeqy1TzVxy8ME7FfmEbBXrGwo6DrcLibvhUhR73NUNNy3AeBRcK5R7DvFY2aCkuQYEePKBXirha4t6A3t`

FARE swap signature: `4hXP8CrcGRLkJiSRF2skKMQHzMVLsu3RHy1CN4ouTbVgpE7971f8rfWkDNSSa6Z4Wcci3mbN9ZLVHtSDafGmZxhM`

Reward calculation signatures: `ftxfmFb24NeBxNvC7Bj9hHAQd8DHLsG5fVxpbou6atENhvdXiXBG5M3mhPsvWkAJnUM2UsPG84ybRzxsdu9LBfL`, `5KHQN86KQG7GhKy58bNpygBwnUGPCQftCDk1rEHkAqd78nRF2cw6ULM4ERU84XURMKnxvA7pQEoYsjzCeGuPtkq3`

Reward claim signature: `5V4Z5gn14MKZNDdECvzt95vremNzzJcJuZCMmshQd7s28kG5ifjZFVt4JPTRfXVuaPJfaxMKC5cKSMaxRqk4PBvP`

Получено: `31,791.080200 TAXI`. После claim machine claimable равен нулю.
Оставшиеся `3,532.342244 TAXI` корректно находятся в trainee `nextPool`, где нет
активного trainee; ещё `0.000001 TAXI` является bounded main-pool rounding residual.

Результат: `PASS`

## Итоговый release gate

- [ ] Новый CA совпадает on-chain, в API, админке, Trade и mint quote.
- [ ] Protocol находится в состоянии `live`.
- [ ] Reward pool и FARE obligations имеют ожидаемые значения.
- [ ] Creator fees принадлежат `F3jK…n8tR`.
- [ ] Stock vaults, NFT, Collection и protocol SOL сохранены.
- [ ] Backend restart не возвращает старый CA.
- [ ] Worker проверен вручную перед постоянным включением.
- [ ] Все обязательные signatures и балансы записаны.

## Test token evidence — 2026-10-03

Этот токен создан только для финальных integration tests и не считается финальным
production `$FARE`, пока владелец отдельно не утвердит его как финальный CA.

- Name/ticker: `taxi / TAXI`.
- CA: `C4TZajXpTPg7MP7VWuPXjSTDzyPvPgHVJjxC9dBZNKrj`.
- Launcher: `9iTVkbvMTaGpYmgx86rWpPm3t5HVresSCwmoLxTgrbD7`.
- Metadata: `https://gateway.irys.xyz/BfTT5AC1bua9dQcjVckXph9nC5sWi8pDV4Ld5j2gq65z`.
- Create: `5oPEXZkGi5pHKzu9f2CiGijrvgEdT4H3keiHqAMubgmaUwvPgqu1cp3ffkVi1NBA7CA4uJbv8LzC1931dWUxLvh2`.
- Immutable fee sharing: `5XPjdQvRtSYdMNhzdR6w2UC4H9TW9vtXNAGyJ3sBufjFYwQ36paJkzm9njwzeQSKESSf99rQT2VBzA7feVJGa29`.
- Tiny buy: `5rSHks9QonPHwXq36QbzLGT5iJRR27Aak4FRdqLgSJpkE9jNrAPdoptYuYETp8b5vAZfEZxikV9nsC5HrHGS5T6h`.
- Full sell: `2YQuB7W1yQzWgRSY7yLC4GFabmdm1zvrriTp8mgjLHHWXSqgDSE3uXsvbgvUfQjhHYLswwmHKQKUt312AZdRfa9V`.
- Creator-fee distribution: `42yL3SU9fB99VenUHi7J657JryqJH6yG6PabVr7KsULAZfpoBmv4bdVBEM34ASTfoD4Z6Q5otwmXQV91H4FUTdMv`.
- Fee recipient: immutable `10000 bps` to `F3jKZokibZiN5SJM5JM4T3a99HVb4zueDTGPR5hbn8tR`.
- PASS: SOL quote, ungraduated, Mayhem off, cashback off, holder rewards off,
  creator fee `0 bps` and not editable.
- Launcher token balance and SOL balance after cleanup: `0`.
- Net project-wallet spend from metadata through cleanup: `0.012486002 SOL`.
- Protocol bind: `275PTTdWFTPLJ2fNseDNqre51GG9GioCiKsBzLqqYoFsXqUiK8ZyJxvgxqaTNRHic91YJ1TAPBDXuVffHjdiFYDm`.
- Idempotent repeat bind: `SyLYkUzKeiFm4UhSWzfSvGdxRiVnFFufKpyJ1v7E9QuTJwziwTbp1g7aErSDHXBKsYoyaPXJ9z7fejo4uJVQXL7`.
- Runtime token config: `configured=true`, ticker `TAXI`; backend health/token smoke PASS.
- Mainnet recovery audit after binding: PASS; all six protocol token vaults are zero.
- Test liquidity buy (`0.22 SOL`): `3JgQXgqsDmsC7vinqD7iBTnxdEkRf1bNXVzo5BBEuJJ6FovtXqk3PMRxTZ4bxCkkgJaW18w4ntBpLew1EWi4Z2Uu`.
- Sale start: `4oM53eps2xXivy4yDRyxpxdDuubk8quZvdJGx7KDtFPRqqmtmM6gzdeMQXxpabzKQyM7pGghxvFmiz38465VZL2X`.
- Test unpause: `mMewmKtJEmjsLr28TMuNd3xpuXqAooSQGGtCzG2zBX5nmocaperyKVoKQZYM47cvj994TuU4Ns34MK4wKMCjC6Q`.
- Paid mint (`$25`, assignment `0`, Comfort/Toyota Prius): `REV4vebghECi4qtujKaisyWMuhR3RUJjLgkj67oaGrd29vKLwJHrCzUoQqJhSFSdAwW1U3ehAxcGEEiNaFBE1Hz`.
- Minted asset: `EMaK2hrp7QxrpgMmQ5fHbtVWTubSHgwho9Hmv8kbZ4iU`; machine PDA:
  `6EJd9S3WVhp1x8yTcqUwmDeQdh9N7HRXmzHv6ETy6CEU`.
- Post-smoke pause: `2Nj6PgqcLmjHrcyTA97ouBCpwbjz2WmRuwZuHhK6rE8eBH7mhYeo4ryUuaHnfomFijQqQJtNojsa7iuwQN9RHNrs`.
- Full TAXI unwind: `3uGALA6WkA3M49GxUZVMb537F2qa4p4dBF1PUFqqExWsHtR4dFfqtfTRkhawk7igFJej8XN2jyVnACiYZZ9werNu`.
- Post-smoke creator-fee distribution: `omG2ep6vRbyArXrKZwSQC81B6hH21sTQFy1nf62oEbAHfvZ9msrRLrPDZmSooqoKc7qVb1PGeKmLLayF9mDUcWS`.
- Smoke found and fixed the server-only assignment-manifest traversal permission:
  `/etc/ownataxi/private` is now `750 root:ownataxi`; the manifest remains `640`.
- Final state: protocol paused, sale started, minted supply `[0,1,0,0]`, all protocol
  token vaults and obligations zero, outstanding claim count zero, backend and worker stopped.
- End-to-end net project-wallet spend since the test token launch: `0.060987558 SOL`.

Финальный результат: `PASS / FAIL`

Комментарий:

```text

```

## Запрещённые проверки

Не выполнять ради тестирования смены CA:

- `--final`;
- отзыв upgrade authority;
- закрытие ProgramData;
- закрытие основного Program ID;
- перемещение stock vaults;
- вывод protocol SOL;
- тестирование необратимых операций на финальном токене без отдельного разрешения.
