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
| D-08 | Recoverable rent disposable rehearsal возвращается funding wallet | Recipient — `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF`. Его адрес указывается явно во всех recovery-командах и сверяется с manifest, fee payer и балансами; default signer запрещён. |
| D-09 | Для disposable rehearsal создаются только технически обязательные новые keypair | Локально создаются новый Program ID keypair и Collection asset signer, поскольку это отдельные новые адреса. Wallet `2NUN…EGVnF` выполняет payer/authority/backend/admin/worker/team/creator роли. Новые disposable keypair не попадают в Git, логи или чат; основная копия хранится вне репозитория, резервная — в отдельной папке на Desktop. |
| D-10 | Desktop backup disposable keyset хранится в обычном ZIP без шифрования | Архив содержит только временные rehearsal-ключи, получает однозначное имя и не попадает в Git, логи или чат. Для production keyset такой способ запрещён. После recovery и возврата rent архив сохраняется или удаляется только по отдельному решению владельца. |
| D-11 | Основной `$FARE` для disposable rehearsal — существующий test-only mainnet token | Используется `4fg5Nh2wjVddSfDPW1AATQ9Tvmdc1Np1pBQQGL4Mpump`, если повторный preflight подтверждает Pump configuration, Token Program, decimals, liquidity и безопасные Jupiter routes. Этот CA запрещён для production manifest. При несовпадении ожидаемых свойств rehearsal останавливается; замена или создание нового token требует отдельного решения. |
| D-12 | Второй CA для проверки runtime replacement создаётся как новый disposable Pump.fun token | Token создаётся самостоятельно в mainnet специально для rehearsal, не используется в production и получает явную маркировку test/rehearsal. Его создание, комиссии, первоначальная покупка и slippage входят в общий лимит невозвратных расходов `0.5 SOL`; превышение лимита блокирует операцию. Точные name, ticker и artwork утверждаются до необратимой транзакции. |
| D-13 | Disposable replacement token называется `Fare Share Rehearsal`, ticker `FARETEST` | Name и ticker используются только для временного mainnet rehearsal token. Metadata и интерфейсы обязаны явно показывать test/rehearsal назначение; token запрещено выдавать за production `$FARE`. |
| D-14 | Artwork `FARETEST` выполняется без усложнений | Отдельное простое чёрно-жёлтое изображение содержит крупный текст `FARETEST` и заметную подпись `REHEARSAL`, без production-логотипа и дополнительных вариантов. Оно используется только для disposable token metadata. |
| D-15 | Разрешена публичная загрузка disposable `FARETEST` artwork и metadata | При подготовке rehearsal разрешено загрузить только утверждённые временные artwork/metadata в постоянное публичное хранилище, необходимое для создания Pump.fun token. Разрешение не распространяется на production Collection, 16 машин, trainee или production `$FARE` assets. URI фиксируется в rehearsal manifest до token transaction. |
| D-16 | Первоначальная покупка disposable `FARETEST` ограничена `0.25 SOL` | Покупка выполняется при создании token только после предварительной оценки transaction fee, Pump fees и ожидаемого slippage. Она не отменяет общий лимит невозвратных потерь `0.5 SOL`; если совокупная оценка может его превысить, token transaction блокируется. Полученные tokens используются только в rehearsal-сценариях и учитываются в финальном balance snapshot. |
| D-17 | Rehearsal использует существующий MongoDB cluster с отдельной database | Database name: `fare_share_disposable_rehearsal`. Все backend, worker, indexer и cleanup операции обязаны явно использовать этот name; production database и её collections не очищаются, не импортируются и не изменяются. Перед запуском сохраняется target URI без secret и выполняется проверка database name. |
| D-18 | Rehearsal backend/frontend временно заменяет старую test-only копию на существующем сервере | Перед заменой сохраняются текущий deploy artifact и server configuration для контролируемого rollback. Новый контур использует disposable Program/Collection/token, database `fare_share_disposable_rehearsal` и worker OFF. Это не разрешение немедленно выполнять deployment; запуск происходит только после freeze rehearsal manifest и отдельной команды владельца. |
| D-19 | Rehearsal-сайт доступен публично без пароля | Страница может открываться любым посетителем на существующем публичном сервере. Disposable Program/Collection/token должны быть явно отделены от production. Разрешение на публичный просмотр не означает автоматическое разрешение любому wallet выполнять paid mainnet-действия; transaction access утверждается отдельно. |
| D-20 | Все публичные пользовательские действия rehearsal доступны любому wallet | Wallet allowlist не используется: любой посетитель может выполнять paid mint, trainee activation, Trade, transfer, repair и claim в disposable mainnet-контуре. Admin routes, worker controls, secrets и authority operations остаются защищёнными существующей admin-auth и не становятся публичными. Чужие wallet оплачивают собственные транзакции; project-funded automation всё равно ограничена budget и worker initially OFF. |
| D-21 | Отдельная rehearsal-warning плашка на публичном сайте не добавляется | Владелец подтвердил, что запуск не анонсирован и активной аудитории на сайте нет. Это решение не снимает обязательное разделение disposable и production адресов в manifest и конфигурации; никакие rehearsal identifiers не переносятся в production. |
| D-22 | После успешного ручного цикла disposable-контур остаётся полностью включённым | Сразу после deployment worker всё равно стартует OFF и выполняется один обязательный ручной полный цикл с проверкой balances, routes, reserves и rewards. При успехе включаются sale, все публичные пользовательские действия и worker automation. После формального завершения rehearsal автоматический pause/rollback не выполняется: контур продолжает работать до отдельного решения о shutdown/recovery. Ранее утверждённые spending и recovery gates сохраняются и требуют отдельного согласования при конфликте с непрерывной работой. |
| D-23 | Общий лимит невозвратных расходов `0.5 SOL` сохраняется после включения automation | Учитываются project-funded transaction fees, Pump fees, фактический slippage и прочие невозвратные потери disposable-контура. При достижении заранее рассчитанного безопасного порога до `0.5 SOL` worker автоматически переводится в OFF и новые project-funded автоматические действия прекращаются. Публичный сайт и транзакции, оплачиваемые пользователями, остаются доступны. |
| D-24 | Recoverable rent остаётся заблокированным до отдельной команды shutdown/recovery | Пока disposable Program работает, ProgramData не закрывается. Команда завершить rehearsal сама по себе не разрешает close. Остановка сервисов, pause, проверка нулевых vault balances, необратимое закрытие ProgramData и возврат rent на `2NUN…EGVnF` выполняются только после нового прямого указания владельца. `--final` и отзыв upgrade authority по-прежнему запрещены. |
| D-25 | Коллекция использует 17 NFT artwork/metadata типов | Это 16 paid вариантов (`4 класса × 4 модели`) и один отдельный Trainee — Dacia Logan. Collection artwork/metadata существует дополнительно и не считается восемнадцатым taxi NFT типом. Paid supply остаётся 1222, а Trainee supply — unlimited по правилу `owner + campaign_id`. |
| D-26 | Разрешена публичная загрузка disposable NFT assets и metadata | При подготовке rehearsal разрешено загрузить отдельное Collection image/JSON, текущие 16 paid machine images/JSON и Dacia Logan Trainee image/JSON в постоянное публичное хранилище. Все metadata явно относятся к disposable rehearsal и не утверждают production artwork или production URI. Итоговые 18 image URI и 18 JSON (Collection + 17 NFT типов) фиксируются в rehearsal manifest до initialize. |
| D-27 | Disposable Collection называется `Fare Share Taxi Rehearsal`, symbol `TAXITEST` | Name и symbol используются в Collection и всех 17 rehearsal NFT metadata. Они запрещены для production Collection и должны сопровождаться test/rehearsal description без обещания фиксированной доходности. |
| D-28 | Artwork disposable Collection — существующий `public/brand/fare-driver.png` | Отдельное изображение Collection для rehearsal не создаётся. Перед upload файл проверяется визуально и по MIME; его постоянный URI фиксируется в rehearsal manifest и используется только в metadata `Fare Share Taxi Rehearsal`. |
| D-29 | Trainee NFT называется `TAXI Trainee — Dacia Logan` | Trainee metadata содержит `Type: Trainee`, `Model: Dacia Logan`, `Weight: 1`, `Transferable: No` и `Repairable: No`. Один metadata type используется для unlimited campaign assets; уникальность on-chain остаётся `owner + campaign_id`. |
| D-30 | Wallet `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF` выполняет все совместимые rehearsal-роли | Он является deploy fee payer, upgrade authority, protocol admin, worker payer/signer, backend signer, team wallet, Pump creator/fee recipient и recovery recipient. Владелец явно принял риск размещения этого authority secret на rehearsal server и увеличенный blast radius. Новый Program ID keypair и Collection asset signer всё равно существуют отдельно по требованиям Solana/Core, но их payer и authority — `2NUN…EGVnF`. |
| D-31 | Локальный keypair `2NUN…EGVnF` найден и проверен | Внешний к репозиторию Desktop-файл содержит base58-encoded 64-byte keypair; локальная derivation без вывода secret подтвердила точный public key `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF`. Файл не копируется в Git, manifest, логи или чат. |
| D-32 | Публичный disposable rehearsal размещается на основном домене `https://ownataxi.com/` | Отдельный subdomain не используется. Текущая старая test-only копия предварительно архивируется для rollback, после чего frontend/backend заменяются rehearsal release. Само решение домена не является командой начать deployment. |
| D-33 | Rehearsal повторно использует существующие server credentials внешних сервисов | Используются уже настроенные MongoDB cluster credentials, Solana RPC/DAS, Helius и Jupiter API credentials. Secrets читаются только из server secret/env storage и не переносятся в Git, manifest или чат. MongoDB изолируется database name `fare_share_disposable_rehearsal`; отсутствие или несоответствие любого credential блокирует запуск соответствующего сервиса. |
| D-34 | Rehearsal повторно использует существующую admin-auth конфигурацию | Сохраняются текущие admin username, password hash и session secret из server secret/env storage. Новые credentials входа не создаются; admin routes и worker controls остаются недоступны без действующей сессии. Значения secrets не выводятся в manifest, Git или чат. |

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
