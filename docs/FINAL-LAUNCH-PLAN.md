# Fare Share — финальный план подготовки к запуску

Снимок состояния: **30 сентября 2026**. Базовый commit плана: `ef60923`.

Этот документ — единый checklist следующего production-релиза. Технические детали
остаются в `DEPLOY.md`, `docs/APP-READINESS-CHECKLIST.md` и
`docs/SCENARIO-TESTS.md`; расхождения перед release freeze должны быть устранены в
пользу фактически проверенного release candidate.

## Правила выполнения

- Сначала последовательно закрываем решения и локальную реализацию по каждому
  разделу. До окончания этого прохода ничего не публикуем.
- Затем фиксируем один release SHA и выполняем общий rehearsal и production run
  строго по порядку из этого документа.
- Создание keypair, загрузка metadata, расходы SOL, mainnet-транзакции, push и
  deployment выполняются только после отдельного прямого разрешения владельца.
- `--final` запрещён. Upgrade authority не отзывается. Authority, fee payer и
  recovery recipient всегда задаются явно.
- Любое несовпадение сети, Program ID, ProgramData, authority, recipient,
  balances, metadata или release SHA останавливает запуск.
- Финальный production Program ID, Collection и `$FARE` не могут использовать
  текущие test-only адреса.

## Обозначения

- ✅ реализовано и подтверждено на актуальном коде;
- 🟡 реализовано частично или требует повторного smoke на release candidate;
- ⬜ ещё не подготовлено;
- 🛑 обязательный production gate;
- 🔐 требуется отдельное разрешение или secret/asset от владельца.

## Сводка gates

| ID | Блок | Статус | Результат, необходимый для закрытия |
|---|---|---:|---|
| L-01 | Worker/Jupiter reserve routes | 🟡 🛑 | Focused tests и актуальный disposable mainnet swap smoke для `$FARE` и 4 xStocks |
| L-02 | Disposable mainnet rehearsal | ⬜ 🛑 🔐 | Полный сценарий на временных Program/Collection/token/DB без использования production supply |
| L-03 | Production metadata | ⬜ 🛑 🔐 | Публичные проверенные URL collection, 16 машин и trainee |
| L-04 | Production keyset и recovery | ⬜ 🛑 🔐 | Новый keyset, offline backup authority и успешный recovery dry-run |
| L-05 | Production `$FARE` | ⬜ 🛑 🔐 | Pump configuration, liquidity и pricing routes подтверждены |
| L-06 | Production configuration | 🟡 🛑 | Все значения зафиксированы в manifest и проходят preflight |
| L-07 | Final SBF | ⬜ 🛑 | Frozen `.so`, SHA-256, размер и совпадающий новый Program ID |
| L-08 | Production backend | 🟡 🛑 🔐 | MongoDB/backup/secrets/worker/monitoring/security готовы |
| L-09 | Release verification | ⬜ 🛑 | Все focused и combined gates привязаны к одному release SHA |
| L-10 | Production launch | ⬜ 🛑 🔐 | Разрешённый deploy, initialize, smoke и только затем `start_sale` |
| L-11 | Legal, UX и marketplace | ⬜ 🛑 | Legal copy, desktop/mobile, Phantom и Magic Eden проверены |

## Принятые решения

| ID | Решение | Статус и обязательные меры |
|---|---|---|
| D-01 | Production admin wallet также используется как worker payer/signer | Владелец явно принял повышенный риск 30 сентября 2026. Upgrade authority остаётся отдельной и offline. Admin/worker secret хранится только в secret storage; сервер имеет минимальный доступ, SOL balance ограничен, low-balance и admin-operation alerts обязательны. |
| D-02 | Rent временных Jupiter ATA возвращается admin/worker payer | Закрывается только canonical пустой ATA, созданный для подтверждённого route. Возврат идёт исходному payer после swap; закрытие чужого или непустого аккаунта запрещено. |
| D-03 | Worker управляется из admin runtime-настройками и ручными actions | MongoDB хранит ON/OFF, частоту и minimum SOL threshold. Отдельные admin-кнопки запускают creator-fee claim+deposit, contract split, swaps, reward calculation и полный цикл; MongoDB lock запрещает параллельные запуски. |
| D-04 | Первый production-запуск worker начинается в состоянии OFF | После deploy оператор вручную запускает полный цикл, сверяет creator fees, reserves, покупки и rewards, и только после успешной проверки включает automation в admin. |
| D-05 | Paid mint — случайная машина из точного тиража 1222 по единой цене $25 | Классы: `833 / 278 / 83 / 28`; веса наград `1 / 3 / 10 / 30`. Четыре варианта внутри каждого класса распределяются максимально поровну, лишние варианты выбираются случайно. Весь порядок заранее перемешивается и фиксируется 96-bit Merkle root. Следующая машина показывается до wallet confirmation; владелец принимает риск конкуренции за заранее видимую редкую позицию. |
| D-06 | Финальная репетиция проводится в отдельном disposable mainnet-контуре | Используются только временные Program ID, Collection, совместимый test token и отдельный MongoDB namespace. Production Program, Collection, token supply и database не затрагиваются. Любые key generation, расходы SOL и mainnet-транзакции всё равно требуют отдельного прямого разрешения владельца. |
| D-07 | Бюджет disposable mainnet rehearsal разделён на невозвратные расходы и recoverable rent | Суммарные невозвратные комиссии, slippage и прочие потери ограничены `0.5 SOL`. Recoverable ProgramData/account rent разрешён в фактически необходимом объёме только после точного расчёта Program ID/ProgramData/authority/recipient/expected return. Rent не считается расходом в лимите `0.5 SOL`, но обязан быть возвращён проверенному recipient по recovery-процедуре; любое ожидаемое превышение невозвратного лимита блокирует rehearsal. |
| D-08 | Recoverable rent disposable rehearsal возвращается funding wallet | Recipient — тот же disposable admin/worker wallet, который финансирует rehearsal. Его адрес указывается явно во всех recovery-командах и сверяется с manifest, fee payer и балансами; default signer запрещён. |
| D-09 | Для disposable rehearsal создаётся новый отдельный keyset | Владелец разрешил при подготовке rehearsal локально создать отдельные keypair для Program ID, upgrade authority, Collection, admin/worker и backend signer. Они не используются в production и не попадают в Git, логи или чат. Основная копия хранится вне репозитория; резервная копия дополнительно сохраняется в отдельной папке на Desktop. Формат защиты Desktop backup утверждается отдельно до генерации. |
| D-10 | Desktop backup disposable keyset хранится в обычном ZIP без шифрования | Архив содержит только временные rehearsal-ключи, получает однозначное имя и не попадает в Git, логи или чат. Для production keyset такой способ запрещён. После recovery и возврата rent архив сохраняется или удаляется только по отдельному решению владельца. |
| D-11 | Основной `$FARE` для disposable rehearsal — существующий test-only mainnet token | Используется `4fg5Nh2wjVddSfDPW1AATQ9Tvmdc1Np1pBQQGL4Mpump`, если повторный preflight подтверждает Pump configuration, Token Program, decimals, liquidity и безопасные Jupiter routes. Этот CA запрещён для production manifest. При несовпадении ожидаемых свойств rehearsal останавливается; замена или создание нового token требует отдельного решения. |
| D-12 | Второй CA для проверки runtime replacement создаётся как новый disposable Pump.fun token | Token создаётся самостоятельно в mainnet специально для rehearsal, не используется в production и получает явную маркировку test/rehearsal. Его создание, комиссии, первоначальная покупка и slippage входят в общий лимит невозвратных расходов `0.5 SOL`; превышение лимита блокирует операцию. Точные name, ticker и artwork утверждаются до необратимой транзакции. |
| D-13 | Disposable replacement token называется `Fare Share Rehearsal`, ticker `FARETEST` | Name и ticker используются только для временного mainnet rehearsal token. Metadata и интерфейсы обязаны явно показывать test/rehearsal назначение; token запрещено выдавать за production `$FARE`. |
| D-14 | Artwork `FARETEST` выполняется без усложнений | Отдельное простое чёрно-жёлтое изображение содержит крупный текст `FARETEST` и заметную подпись `REHEARSAL`, без production-логотипа и дополнительных вариантов. Оно используется только для disposable token metadata. |

## L-01. Worker/Jupiter reserve routes

Исторический disposable mainnet-контур уже подтверждал реальные reward swaps, в
том числе worker signer, атомарное funding WSOL и intermediate ATA. Это не считается
финальным доказательством для текущего кода: после последних изменений нужен новый
focused review и повторный smoke на release candidate.

- [ ] Сверить текущую реализацию с подтверждёнными fix-forward commits и удалить
      устаревшие противоречия в документации.
- [ ] Подтвердить, что Jupiter CPI сохраняет signer worker как payer/taker и не
      допускает посторонних signer.
- [ ] Подтвердить атомарную связь reserve funding → Ed25519 plan → swap без
      `sync_native`/lamport checkpoint mismatch.
- [ ] Разрешать только canonical idempotent ATA setup для route accounts.
- [ ] Пустые temporary ATA закрывать retryable-операцией; согласно D-02 rent
      возвращать admin/worker payer без потери reward reserves.
- [ ] Проверить Token и Token-2022 output routes, закрытый WSOL source и stale route.
- [ ] Проверить fallback/quarantine неработающего DEX без списания reserve.
- [ ] Focused checks: Rust swap tests, Jupiter tests, worker tests, server typecheck,
      worker transaction wire-size.
- [ ] Disposable smoke: `$FARE` и каждый из четырёх xStocks; при отсутствии
      безопасного route соответствующий reserve обязан остаться неизменным.
- [ ] После smoke worker остаётся остановленным до production launch и получает
      только отдельно согласованный минимальный SOL balance.

**Gate L-01 PASS:** зафиксированы signatures либо доказанный safe no-route result
для всех пяти направлений; reserve accounting, reward vault delta и rent refund
сверены до/после.

## L-02. Disposable mainnet rehearsal

Нужен отдельный временный контур, потому что `start_sale`, paid mint counters и
Collection contents нельзя очистить до состояния будущего production launch.

### Изолированные ресурсы

- [ ] Новый disposable Program ID и отдельная upgrade authority.
- [ ] Новая disposable Core Collection.
- [ ] Совместимый test Pump.fun token с проверяемой liquidity.
- [ ] Отдельный MongoDB database/namespace без production данных.
- [ ] Случайный disposable `DEPLOYMENT_ID_HEX`.
- [ ] Отдельный release manifest с сетью, адресами, signer и ожидаемыми расходами.

### Сценарии

- [ ] Единая цена `2500` cents → signed `$FARE` quote; assignment index/class/variant и proof связаны с текущей позицией.
- [ ] Paid mint переводит 100% текущего `$FARE` в canonical team ATA.
- [ ] CA меняется после `start_sale`; Configuration, `/api/token`, admin, Trade,
      public overview и новые quotes переключаются на новый CA.
- [ ] Quote со старым CA после замены отклоняется.
- [ ] Paid Core NFT создаётся и успешно передаётся другому wallet.
- [ ] Trainee создаётся в той же Collection и его transfer отклоняется permanent
      freeze delegate.
- [ ] Claim paid и trainee активов проходит с правильными временными границами.
- [ ] Garage, DAS и MongoDB indexer согласованы по owner, Collection и metadata.
- [ ] Quote отклоняется при stale market data, отсутствии liquidity, чрезмерном
      price impact и price divergence.
- [ ] Пройдены worker-сценарии L-01.

### Завершение rehearsal

- [ ] Сохранить signatures, account snapshots и результат каждого сценария.
- [ ] Остановить backend/worker и поставить disposable protocol на pause.
- [ ] Выполнить recovery **dry-run** из `DEPLOY.md` с точными authority/recipient.
- [ ] Закрытие disposable ProgramData и возврат rent — отдельное необратимое
      действие, не входящее автоматически в rehearsal.

**Gate L-02 PASS:** все сценарии подтверждены на одном disposable build, а его
Program ID, Collection, token и database явно исключены из production manifest.

## L-03. Production metadata

Владелец предоставляет оригинальные production assets; приблизительные замены
запрещены.

- [ ] `collection.json` и collection image.
- [ ] 16 уникальных JSON и 16 изображений платных машин в порядке
      `Economy 1–4`, `Comfort 1–4`, `Business 1–4`, `Legend 1–4`.
- [ ] Отдельные `trainee.json` и trainee artwork.
- [ ] Все URL постоянные HTTPS/Irys, публично доступны и возвращают верный MIME.
- [ ] Нет test/devnet wording, локальных путей или изменяемых gateway URL.
- [ ] Названия, description, attributes и изображения вручную сверены.
- [ ] Trainee attributes содержат `Type: Trainee` и `Transferable: No`.
- [ ] Metadata отображаются через DAS и минимум один поддерживаемый wallet.
- [ ] Exact URI записаны в release manifest; после freeze content не меняется.

**Gate L-03 PASS:** metadata verifier и ручная визуальная проверка проходят для
Collection и всех 17 типов assets.

## L-04. Production keyset и сохранность rent

- [ ] Новый production Program ID keypair.
- [ ] Новый collection signer.
- [ ] Новый admin keypair, который по решению D-01 также используется worker.
- [ ] Новый backend Ed25519 signer.
- [x] Отдельный worker keypair не создаётся: worker использует production admin
      keypair согласно D-01.
- [ ] Случайный production `DEPLOYMENT_ID_HEX`.
- [ ] Upgrade authority сохранена минимум в двух проверенных offline backup.
- [ ] Явно записаны public addresses authority, deploy fee payer и recovery
      recipient; secret bytes в manifest, Git и чат не попадают.
- [ ] Подготовлен постоянный recoverable buffer и оценён peak SOL deploy cost.
- [ ] Выполнен mainnet recovery dry-run по `DEPLOY.md` для точного нового Program ID.
- [ ] Проверено понимание: ProgramData rent recoverable, Program tombstone нет;
      закрытый Program ID повторно использовать нельзя.

**Gate L-04 PASS:** backup восстановлен тестовым чтением public key, dry-run
совпадает по Program/ProgramData/authority/recipient/expected return.

## L-05. Production `$FARE`

- [ ] Создан финальный Pump.fun token только после согласования имени, ticker,
      artwork, creator и расходов.
- [ ] Creator/fee-sharing configuration неизменяемо направляет 100% на точный
      согласованный `2NUN…` recipient.
- [ ] Token Program, decimals и extensions совместимы с программой.
- [ ] Подтверждена реальная `$FARE → USDC` liquidity.
- [ ] Подтверждён fallback `$FARE → SOL → USD`.
- [ ] Price impact позволяет купить каждый класс по его USD target в пределах
      configured safety limits.
- [ ] После bind одинаковый CA виден в Configuration PDA, `/api/token`, admin,
      Trade, public overview, quote payload, team ATA и worker.
- [ ] Runtime CA replacement остаётся доступен; старые balances и obligations
      отдельно учитываются и не считаются автоматически конвертированными.

**Gate L-05 PASS:** live quote matrix всех четырёх классов и оба pricing route
проверены без выполнения paid mint на production Collection.

## L-06. Production configuration manifest

До сборки final SBF зафиксировать:

- [ ] Program ID и cluster genesis hash.
- [ ] Team wallet.
- [ ] Четыре официальных xStocks mint в правильном порядке.
- [ ] Разрешённый Jupiter Program ID.
- [ ] Collection name/URI и 16 machine metadata URI.
- [ ] Trainee metadata URI.
- [ ] Единая paid mint price `2500` cents ($25).
- [ ] Backend signer public key и общий admin/worker public key с минимальным
      рабочим SOL budget.
- [ ] MongoDB database name, RPC/DAS endpoints и allowed origin.
- [ ] Quote TTL, market max age, price impact/divergence, slippage и minimum swap.
- [ ] Caps `[833, 278, 83, 28]`, total `1222`, weights `[1, 3, 10, 30]`, assignment root и trainee semantics.

Metadata URI и USD targets после `start_sale` блокируются. `$FARE` CA остаётся
runtime-replaceable согласно принятому решению.

**Gate L-06 PASS:** manifest заполнен без placeholder и проходит
`npm run protocol:preflight` без production errors.

## L-07. Final SBF и release freeze

- [ ] Обновить новый Program ID в `declare_id!`, `Anchor.toml`, server env и Vite env.
- [ ] Запустить Rust unit tests и production `cargo build-sbf`.
- [ ] Проверить отсутствие test/dev handlers и test-only addresses.
- [ ] Зафиксировать SHA-256 и размер `.so`.
- [ ] Зафиксировать Git release SHA и clean working tree.
- [ ] После freeze не пересобирать `.so` и не менять release SHA; любое изменение
      создаёт новый candidate и повторяет затронутые gates.

**Gate L-07 PASS:** frozen `.so`, hash, размер, Program ID и source commit внесены
в release manifest.

## L-08. Production backend

- [ ] Production MongoDB создана; индексы, включая `fleet_trainees`, проверены.
- [ ] Backup создан, restore реально проверен на отдельном database name.
- [ ] Helius key ротирован и ограничен; Jupiter/RPC/DAS credentials сохранены в
      secret storage, а не в Git/frontend.
- [ ] Worker запускается под supervisor, не допускающим параллельные циклы.
- [ ] Есть heartbeat/alerts для worker, quote failures, RPC/DAS/Jupiter errors,
      reserve backlog и low worker SOL.
- [ ] Edge/origin rate limits, HTTPS, secure cookies и allowed origin проверены.
- [ ] Логи не содержат secrets, signed payload с приватными данными или API keys.
- [ ] Backend и frontend могут быть откатаны/fix-forward без смены frozen program.

**Gate L-08 PASS:** production-like backend smoke и backup/restore evidence
приложены к manifest; worker остаётся выключен до шага запуска.

## L-09. Проверка release candidate

- [ ] Rust tests.
- [ ] Focused backend/client tests для mint quote, admin bind, worker/Jupiter,
      trainee, public data и protocol client.
- [ ] Server typecheck и frontend production build.
- [ ] Final SBF build/hash verification.
- [ ] Metadata verification.
- [ ] Production preflight.
- [ ] ProgramData/authority audit и recovery dry-run.
- [ ] Wire-size: paid mint, trainee activation, claim и каждый worker route class.
- [ ] Один combined browser smoke без production write operations.
- [ ] Release manifest содержит task commits, exact release SHA и результаты gates.

**Gate L-09 PASS:** проверки относятся к одному неизменному release SHA и frozen
SBF hash; рабочее дерево чистое.

## L-10. Финальный production run

Этот раздел выполняется только после прямой команды на deployment.

1. [ ] Показать release freeze: SHA, SBF hash, Program ID, включённые изменения и
       ожидаемые SOL расходы.
2. [ ] Повторно проверить clean tree, cluster genesis, authority, payer, recipient
       и balances.
3. [ ] Deploy программы **без `--final`**.
4. [ ] Проверить executable Program, ProgramData и upgrade authority.
5. [ ] Выполнить initialize с production manifest.
6. [ ] Создать production Core Collection и проверить immutable metadata/update
       delegate configuration.
7. [ ] Записать 16 paid и trainee metadata URI.
8. [ ] Привязать текущий `$FARE` CA.
9. [ ] Проверить prices, team wallet, Collection, caps, weights, vault ATA и pause.
10. [ ] Выполнить read-only и безопасный pre-sale smoke.
11. [ ] Запустить профинансированный worker в контролируемом режиме и проверить
        один цикл без нарушения reserve invariants.
12. [ ] Только после PASS всех предыдущих шагов отдельно выполнить `start_sale`.
13. [ ] Выполнить минимальный production paid mint/trainee/Garage/Claim/DAS/MongoDB
        smoke в заранее согласованном объёме.
14. [ ] Проверить team payment, vault balances, counters, Collection owner/freeze,
        worker heartbeat и public API.
15. [ ] Сохранить production signatures и снять launch freeze только после PASS.

При любой ошибке после deploy, но до `start_sale`, sale не открывается. После
`start_sale` применяется fix-forward или pause; destructive reset не используется.

## L-11. Legal, UX и marketplace

- [ ] Terms, Privacy и Disclaimer прошли юридическую проверку.
- [ ] Stock/xStocks wording не обещает ownership реальных акций или гарантированный
      доход, если это юридически неверно.
- [ ] Удалены или исправлены все обещания гарантированной доходности.
- [ ] Desktop/mobile smoke основных страниц и English-only runtime content.
- [ ] Phantom connect/sign/reject/warning flow проверен.
- [ ] Magic Eden Creator Hub настроен и публичная ссылка указывает на точную новую
      production Collection; prototype checkout не выдаётся за рабочий market.

**Gate L-11 PASS:** owner принимает финальные тексты и UX, marketplace показывает
только production Collection.

## Порядок совместной работы

### Проход A — закрытие решений без deployment

Идём по порядку `L-01 → L-11`. Для каждого блока фиксируем:

1. что уже доказано и может быть переиспользовано;
2. какое решение или asset требуется от владельца;
3. минимальную реализацию;
4. focused check;
5. commit и обновлённый статус в этом документе.

Независимые внешние материалы (metadata, legal, credentials, key custody) можно
готовить параллельно, но они не дают разрешения на внешнее действие.

### Проход B — общий rehearsal

После локальной готовности выполняется один disposable rehearsal `L-02`, который
одновременно подтверждает L-01, metadata pipeline, runtime CA replacement,
backend/indexer и пользовательские NFT-сценарии.

### Проход C — единый production release

После PASS `L-01…L-09` и `L-11` создаётся frozen release candidate. Затем по
отдельному разрешению выполняется только упорядоченный run `L-10`. Новые изменения
после freeze относятся к новому candidate.

## Следующий пункт

Начать с **L-01**: сравнить текущий worker/Jupiter код с уже подтверждённой mainnet
историей, закрыть расхождения focused-тестами и подготовить точный disposable smoke
script. Никаких mainnet-транзакций на этом шаге не выполнять.
