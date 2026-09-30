# Архитектура Taxi на Solana

## Статус

Проект проектируется для Solana. Старые решения для Robinhood Chain/EVM не применяются. Экономика, прочность машин и lazy accounting сохранены; несовместимые инфраструктурные решения повторно открыты в `docs/TECHNICAL-QUESTIONS.md`.

Точный снимок прежнего EVM-варианта сохранён в `docs/evm-robinhood-chain/` как независимая основа для возможного будущего запуска. Текущая разработка продолжается только по Solana-документам.

## Минимальный стек

- On-chain: Rust + Anchor, Solana programs и PDA accounts.
- `$FARE`: стандартный SPL-совместимый mint, создаваемый pump.fun, без собственных Token-2022 extensions и административных mint/freeze-возможностей проекта.
- Stock assets: только официальные xStocks mint на Solana; смешивание нескольких эмитентов не используется.
- NFT supply: максимум 1425 Metaplex Core Assets — 1000 «Эконом» с весом 1, 300 «Комфорт» с весом 3, 100 «Бизнес» с весом 10 и 25 «Легенда» с весом 30. Максимальный совокупный вес — 3650.
- Лимиты NFT считаются по количеству когда-либо выпущенных машин. Burn уменьшает обращающийся supply, но не счётчик minted и не открывает место для нового выпуска.
- NFT mint prices хранятся в `Configuration.mint_prices` как raw units привязанного `$FARE`. CA и четыре цены задаются до `start_sale`; после открытия продажи они неизменяемы.
- NFT mint не имеет лимита на один кошелёк: один адрес может последовательно выпустить любое количество машин, пока не исчерпан тираж выбранного класса. Каждая транзакция выпускает одну машину.
- NFT sale сразу публичная: после `start_sale` минт доступен любому кошельку. Allowlist, presale и персональные разрешения отсутствуют.
- NFT sale открывается вручную административной инструкцией `start_sale` после проверки точных цен, метаданных и frontend. Автоматического on-chain расписания нет.
- После `start_sale` отдельной функции закрытия или повторного открытия продажи нет. Mint завершается исчерпанием class caps; при инциденте его временно блокирует общая глобальная пауза.
- Полная цена каждого NFT mint атомарно переводится через `transfer_checked` из token account пользователя в canonical `$FARE` ATA текущего team account. Mint-платёж не сжигается и не смешивается с Creator Fees, vault, резервами или reward pools. Пользователь отдельно оплачивает SOL network fee, rent NFT/Machine PDA и создание team ATA, если его ещё нет.
- Региональные ограничения xStocks показываются как явный запрет в frontend и условиях использования. Технические геоблокировки, KYC и on-chain denylist не используются; достаточность подхода требует юридической проверки до запуска.
- NFT: Metaplex Core Assets в официальной коллекции проекта. Phantom и основные Solana NFT-интерфейсы показывают их как обычные коллекционные NFT.
- Taxi-программа формирует минимальные CPI-инструкции Metaplex Core и SPL Token напрямую; официальные библиотеки используются в тестах для побайтового сравнения формата. Это сохраняет атомарный on-chain mint и поддержку Token-2022 xStocks без тяжёлой production-обвязки SDK.
- Внешний Metaplex Core Candy Machine проверен отдельной сборкой: он уменьшил SBF только с 623 176 до 610 128 байт и rent ProgramData примерно на `0,066 SOL`. В основной вариант он не принят, потому что небольшая экономия не оправдывает четыре дополнительных Candy Machine и разделение единого атомарного mint-сценария.
- NFT metadata готовятся до продажи и показываются сразу: reveal отсутствует. Изображения и JSON загружаются в Arweave через Irys. После проверки всех постоянных URI `ImmutableMetadata` на Core Collection навсегда блокирует изменение имени и URI всех машин.
- Update authority новой Core Collection — admin-кошелёк, чтобы он мог подтвердить и управлять страницей коллекции в marketplace Creator Hub. Config PDA записывается в collection-level `UpdateDelegate`: Metaplex Core признаёт его делегатом, но Taxi-программа использует эти полномочия только внутри `mint_machine`. Старые Devnet-коллекции с Config PDA как update authority остаются совместимыми.
- Встроенная страница `/market/` остаётся только явно помеченным UI-прототипом без листингов, checkout и marketplace-коллекции в MongoDB. Собственный marketplace не реализуется: после создания и подтверждения production Collection навигация должна вести на точную официальную страницу коллекции в Magic Eden. До этого generic/test-ссылка не считается production marketplace URL.
- Configuration хранит 16 URI в фиксированном порядке `class * 4 + variant`. Variant назначается как `(serial - 1) mod 4`: распределение внутри класса строго циклическое и не зависит от клиентского Asset keypair, но предсказуемо и не является криптографической случайностью. Увеличенный layout Configuration несовместим со старым account; эта версия предназначена для новой initialization и не должна upgrade-деплоиться поверх существующей конфигурации без отдельной migration/realloc процедуры.
- Обложка коллекции хранится как `original-assets/nft/collection.png`. Канонические NFT artwork — 16 неизменённых WebP из `original-assets/driving-scenes/`; runtime-слои дороги/разметки и мигающих фар в NFT не добавляются. Имена и файлы фиксирует `original-assets/driving-scenes/manifest.json`.
- Индивидуальное имя Core Asset формируется контрактом на английском с номером внутри класса: `FARE Economy #0001`, `FARE Comfort #0001`, `FARE Business #0001` или `FARE Legend #0001`.
- Metaplex Core Royalties plugin не устанавливается: проект не получает комиссию со вторичной продажи или передачи NFT-машин.
- Владелец может напрямую сжечь Core Asset. Backend после finalized burn вызывает permissionless `cleanup_burned_machine`, но это может сделать любой: программа проверяет сожжённый Asset, ставит `BURN`-событие на текущий `protocolTime`, прекращает будущий вес машины и возвращает её незабранные активы в следующие reward pools. Момент внешнего burn задним числом не восстанавливается.
- Frontend: React + Vite + TypeScript, `@solana/kit`, React bindings и Wallet Standard. Весь новый продуктовый frontend, включая новые страницы, секции и пользовательские сценарии Fare Share, разрабатывается только как React-компоненты; отдельная статическая реализация на чистом HTML/JS не поддерживается. Публичный интерфейс на английском. В первой версии подключаем Phantom; собственный embedded/passkey wallet и хранение пользовательских ключей отсутствуют.
- Публичная Fare Share страница использует зафиксированный локальный снимок 16 настроенных автомобильных сцен из `src/drivingScenes.json` и изображения из `public/fare-share/fleet/`; при просмотре она не обращается к backend-библиотеке конфигуратора. Оригинальный экспорт хранится в `original-assets/driving-scenes/`. Сам конфигуратор остаётся локальным dev-инструментом и не входит в production-сборку.
- Network fees: пользователь самостоятельно платит SOL network fee и account rent за mint, `claim`, ремонт и активацию/claim стажёра; цена NFT при этом оплачивается в `$FARE`. Backend платит только за служебные транзакции, которые отправляет сам; fee sponsorship и компенсации отсутствуют.
- Account creation: команда финансирует первоначальные configuration/pool/vault/collection accounts. После запуска fee payer каждой транзакции оплачивает rent-exempt deposit всех новых accounts, которые создаёт эта транзакция: пользовательские Core Asset, Machine/Trainee PDA, event-queue pages, отсутствующий canonical team `$FARE` ATA и другие недостающие token accounts либо служебные accounts backend.
- Backend/indexer: Node.js + TypeScript + MongoDB. On-chain события принимаются в работу только после commitment `finalized`; `confirmed` используется лишь как возможный промежуточный статус во frontend.
- Публичная read-модель хранится в MongoDB: `fleet_machines` содержит проверенные Machine PDA вместе с текущим DAS-owner, `public_snapshots` — finalized snapshot protocol/vault, а `fleet_earning_snapshots` — пятиминутные снимки суммарных claimable rewards каждого владельца. Backend периодически пересобирает эти коллекции из Solana; после mint клиент передаёт signature и Asset, backend самостоятельно проверяет finalized-транзакцию, signer, Program ID и on-chain Machine перед записью. Главная, garage и leaderboard читают эту read-модель; при отсутствии достоверного источника интерфейс показывает пустое состояние, а не демонстрационные числа. График Garage показывает историю claimable balance с момента запуска индексатора, а не дорисованную ретроспективную прибыль.
- После перезапуска backend читает актуальные configuration, pool, reserve и queue PDA и продолжает работу с их текущего состояния; полная история пропущенных транзакций не воспроизводится. On-chain состояние является источником истины, MongoDB — off-chain хранилищем и восстанавливаемым кэшем.
- Повторные backend jobs безопасны за счёт on-chain состояния: swap-планы имеют одноразовые nonce, сбор учитывает только ещё не обработанные средства, а расчёт начинает с актуального курсора. MongoDB-lock не является защитой от двойной денежной операции.
- Production MongoDB размещается в управляемом сервисе с автоматической ежедневной резервной копией. Копия нужна для campaign/backend данных и кэша; денежное состояние восстанавливается только из Solana.
- Emergency rescue позволяет единственному admin вывести из program-controlled vault любые активы, включая SOL резервов, `$FARE` и xStocks, но только после включения глобальной паузы. Это даёт оперативное реагирование на инциденты, но означает явное доверие admin-ключу: технической гарантии невозможности вывода пользовательских резервов нет.
- Четыре xStocks mint неизменяемы после initialization. `$FARE` CA можно задать или заменить через admin только до `start_sale`; после старта он заморожен вместе с mint-ценами. Программа не содержит legacy vault и не пытается переносить raw-балансы или обязательства между разными токенами.
- Если `$FARE` либо один из xStocks mint становится непригодным, текущий deployment ставится на паузу и команда отдельно решает судьбу накопленных обязательств. Продолжение с другим mint требует новой версии программы и отдельного deployment, а не скрытой замены актива внутри работающего протокола.
- Swaps: Jupiter Swap API V2 `/build`. Backend получает готовую Metis swap-инструкцию для `WSOL → FARE/xStock`, требует маршрут без дополнительных setup/cleanup-инструкций, подписывает его и помещает внутрь Taxi CPI. Программа разрешает только настроенный Jupiter program ID и проверяет exact input, фактический выход, `minOut`, deadline, nonce и hash всех route accounts.
- Разрешён ровно один Jupiter Program ID. Admin может заменить его только во время глобальной паузы; после замены старый ID больше не принимается.
- Admin может без глобальной паузы заменить team account, получающий будущие 10% SOL из `collect_fees`. Замена не перемещает ранее отправленные средства и не затрагивает пользовательские пулы.
- Admin может без глобальной паузы заменить backend signer. Новый ключ немедленно становится единственным допустимым для новых swap-планов и стажёрских ваучеров; ранее подписанные, но не использованные сообщения старого ключа перестают приниматься.
- На старте единственный admin-ключ хранится на backend-сервере для оперативных действий. Это временная доверенная модель: компрометация сервера даёт полный admin/Rescue-доступ. Позднее ключ можно перенести на отдельный кошелёк через двухэтапную передачу admin.
- Для MVP admin keypair и отдельный backend signer keypair хранятся двумя разными значениями в обычном server-side `.env`. Файл исключён из Git, не попадает в Docker image/логи и доступен только OS-пользователю приложения; managed secret storage пока не используется.
- Admin HTTP API и web-панель защищены server-side session, CSRF, origin check и rate limit. Admin и fee-recipient keypair доступны только backend-процессу через закрытый environment-файл и не передаются frontend.
- Permissionless worker отправляет служебные транзакции отдельным fee-payer keypair с небольшим запасом SOL. Этот ключ не совпадает с backend signer или admin и не имеет специальных on-chain прав; при его компрометации под угрозой только находящийся на нём SOL.
- При production-настройке одна резервная копия admin keypair сохраняется на личном компьютере оператора вне репозитория и project workspace. Потерянный backend signer не требует backup: создаётся новый ключ и записывается admin-инструкцией.
- Локальные проверки: Rust unit tests, Anchor tests, LiteSVM или `solana-test-validator`.
- Окружения: local validator → devnet → mainnet-beta только по отдельному разрешению.

## On-chain состояние

- Configuration PDA: admin, pending admin, backend signer, pause state, `protocolTime`, разрешённые внешние program IDs и mint pubkeys.
- Main pool PDA и SPL vaults: текущая серия, следующий пул, фиксированные raw-обязательства уже рассчитанных выплат, доход на единицу веса и остатки округления по mint.
- Machine PDA на каждый Metaplex Core Asset: вес, версия, `activeUntil`, checkpoints, `fareBase` и `claimable` по поддерживаемым mint. Core Asset хранит владение и публичные NFT-метаданные; изменяемое состояние машины хранится только в Machine PDA.
- Event queue PDA: min-heap событий `MINT`, `REPAIR`, `EXPIRE`, упорядоченных по `timestamp + eventNumber`.
- Trainee pool и minute-bucket PDA: отдельные от основного парка пулы, очередь, доход на вес и записи `wallet + campaignId`.
- Program-controlled SPL token accounts: один reward account конфигурации для `$FARE`, по одному для каждого stock mint и отдельный WSOL account. Один и тот же token account принимает результат Jupiter swap и хранит рассчитанные активы до пользовательского `claim`; логические main/trainee/stock-пулы разделяются бухгалтерскими счётчиками программы, а не лишними token accounts.
- Прямой перевод `$FARE` или xStocks в reward account не меняет бухгалтерские пулы: sync-инструкций нет. Такой физический избыток доступен только административному `rescue_token` во время глобальной паузы.

## Публичные инструкции

- `collect_fees`: permissionless фиксирует новый pump.fun Creator Fee, поступивший напрямую на program-controlled PDA, увеличивает SOL-резервы направлений и переводит 10% команде. Swap внутри этой инструкции не выполняются.
- `process_fare_swap(plan, route_accounts...)`: permissionless по короткоживущему подписанному плану меняет накопленные 70% SOL на `$FARE`; фактический результат делится в пропорции 45/70 в основной пул, 5/70 в стажёрский пул и 20/70 немедленно сжигается.
- `process_stock_swap(mint, plan, route_accounts...)`: permissionless отдельно покупает одну разрешённую xStocks-позицию через Jupiter из её собственного SOL-резерва.
- `calculate_rewards(group, limit, accounts...)`: permissionless продвигает выбранную очередь максимум на 20 событий и обновляет глобальный доход на единицу веса. Caller может указать меньший `limit`; больше compile-time предела программа отклоняет.
- `claim(asset)`: текущий owner получает рассчитанный доход одной NFT.
- `cleanup_burned_machine(asset)`: permissionless проверяет, что Core Asset сожжён, и ставит событие удаления машины из расчёта на текущее `protocolTime`.
- `repair(asset)`: текущий owner сжигает рассчитанную сумму `$FARE` и восстанавливает 5 дней прочности.
- `activate_trainee(voucher)`: проверяет ed25519-ваучер backend и создаёт временную стажёрскую запись.
- `claim_trainee(campaign_id)`: выплачивает одну стажёрскую машину.
- Административные инструкции: `pause`, `unpause`, двухшаговая смена admin, замена явно разрешённых зависимостей и согласованный rescue.
- Global pause замораживает `protocolTime` и блокирует инструкции Taxi, но не блокирует стандартный transfer Metaplex Core Asset. Collection Freeze Plugin не используется.
- Одноразовый setup создаёт основные PDA и неизменяемую Metaplex Core Collection одной транзакцией, после чего идемпотентно создаёт WSOL/FARE/xStocks token accounts конфигурации. Частично завершённый setup можно безопасно повторить.

## Неизменные экономические правила

- `$FARE` запускается через pump.fun в canonical паре `FARE/SOL`. Собственных 4% временно нет; используется фактический переменный Creator Fee платформы, поступающий в SOL, без обещания постоянного процента.
- Параметры `$FARE` принимает стандартный запуск pump.fun; до основного запуска обязательны тестовый mint и проверка прямого получения Creator Fees на PDA.
- Split Creator Fee: 45% SOL покупают `$FARE` для основного парка, 5% — `$FARE` для стажёров, 20% — `$FARE` для burn, 20% напрямую покупают stock-токены, 10% переводятся команде в SOL.
- Stock-корзина состоит из `UBERx`, `TSLAx`, `GOOGLx` (Alphabet/Waymo) и `AMZNx` (Amazon/Zoox). Каждая позиция получает собственные 5% Creator Fee. Если xStock нельзя купить, SOL остаётся в отдельном резерве этой позиции и не перераспределяется.
- Рассчитанное stock-начисление NFT фиксируется в raw units. Пока пользователь не сделал `claim`, тот же raw amount уже участвует в изменениях xStocks multiplier; после `claim` он продолжает участвовать в них в пользовательском кошельке. Новый пул образуют только новые raw-токены, фактически полученные новой покупкой, а не изменение multiplier.
- Специальной паузы вокруг активации xStocks multiplier нет: raw-операции продолжаются, а небольшое возможное расхождение Jupiter quote принимается ради простоты и непрерывной работы.
- Парк распределяет только фактически накопленный пул, без фиксированного APY.
- Пользовательская выплата не подгоняется под фиксированное соотношение по стоимости: `claim` переводит фактически начисленные `$FARE`, UBERx, TSLAx, GOOGLx и AMZNx. Каждый актив рассчитывается независимо; отсутствие покупки одной позиции не создаёт долг и не блокирует остальные.
- Максимальная прочность обычной машины — 5 дней; `claim` её не меняет.
- Полный ремонт стоит 25% рассчитанного `$FARE`-дохода машины после прошлого mint/ремонта и уменьшается пропорционально фактически потерянной прочности.
- Распределение использует общий доход на единицу веса и не перебирает 1425 NFT.
- Все суммы fungible tokens учитываются в raw units конкретного mint.

## Главные открытые зависимости

Базовые вопросы SOL-1—SOL-11 решены. Оставшиеся продуктовые параметры, адреса интеграций и обязательные проверки перед mainnet перечислены в `docs/TECHNICAL-QUESTIONS.md`.

## Технические основания

- [Solana Core Concepts](https://solana.com/docs/core) — programs, accounts, PDA, CPI и transaction limits.
- [Token-2022 Transfer Fees](https://solana.com/docs/tokens/extensions/transfer-fees) — стандартная комиссия применяется к каждому transfer, поэтому не является прямой заменой Uniswap hook.
- [Token-2022 Scaled UI Amount](https://solana.com/docs/tokens/extensions/scaled-ui-amount) — raw amount не меняется, multiplier влияет только на отображение.
- [Solana frontend client](https://solana.com/docs/frontend/client) — актуальный стек `@solana/kit` и React.
- [Anchor](https://www.anchor-lang.com/docs) — framework для Solana programs на Rust.
- [Metaplex Core Asset](https://developers.metaplex.com/core/what-is-an-asset) — выбранный NFT-стандарт с одним asset account и системой plugins.
- [xStocks](https://xstocks.com/products) — выбранный провайдер токенизированных акций; используются только четыре зафиксированных официальных Solana mint.
- [xStocks Assets API](https://docs.xstocks.fi/apis/openapi/assets) — официальный источник deployments, mint-адресов, supply и multiplier для выбранных xStocks.
- [pump.fun Fees](https://pump.fun/docs/fees) — Creator Fee и общая торговая комиссия зависят от стадии запуска, paired asset и диапазона market cap и могут изменяться площадкой.
- [pump.fun Supported Pair Assets](https://pump.fun/docs/custom-pairs) — Creator Fees выплачиваются в paired asset, а не в `$FARE` автоматически.
