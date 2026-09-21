# Архитектура Taxi на Solana

## Статус

Проект проектируется для Solana. Старые решения для Robinhood Chain/EVM не применяются. Экономика, прочность машин и lazy accounting сохранены; несовместимые инфраструктурные решения повторно открыты в `docs/TECHNICAL-QUESTIONS.md`.

Точный снимок прежнего EVM-варианта сохранён в `docs/evm-robinhood-chain/` как независимая основа для возможного будущего запуска. Текущая разработка продолжается только по Solana-документам.

## Минимальный стек

- On-chain: Rust + Anchor, Solana programs и PDA accounts.
- `$FARE`: стандартный SPL-совместимый mint, создаваемый pump.fun, без собственных Token-2022 extensions и административных mint/freeze-возможностей проекта.
- Stock assets: только официальные xStocks mint на Solana; смешивание нескольких эмитентов не используется.
- NFT supply: максимум 1425 Metaplex Core Assets — 1000 «Эконом» с весом 1, 300 «Комфорт» с весом 3, 100 «Бизнес» с весом 10 и 25 «Легенда» с весом 30. Максимальный совокупный вес — 3650.
- NFT mint prices: долларовые ориентиры `$49 / $129 / $399 / $1099` один раз переводятся в точные lamports SOL перед стартом. После открытия продажи цены неизменяемы; on-chain oracle не используется.
- Региональные ограничения xStocks показываются как явный запрет в frontend и условиях использования. Технические геоблокировки, KYC и on-chain denylist не используются; достаточность подхода требует юридической проверки до запуска.
- NFT: Metaplex Core Assets в официальной коллекции проекта. Phantom и основные Solana NFT-интерфейсы показывают их как обычные коллекционные NFT.
- Frontend: React + Vite + TypeScript, `@solana/kit`, React bindings и Wallet Standard. В первой версии подключаем Phantom; собственный embedded/passkey wallet и хранение пользовательских ключей отсутствуют.
- Network fees: пользователь самостоятельно платит SOL за mint, `claim`, ремонт и активацию/claim стажёра. Backend платит только за служебные транзакции, которые отправляет сам; fee sponsorship и компенсации отсутствуют.
- Account creation: команда финансирует первоначальные configuration/pool/vault/collection accounts. После запуска fee payer каждой транзакции оплачивает rent-exempt deposit всех новых accounts, которые создаёт эта транзакция: пользовательские Core Asset, Machine/Trainee PDA, event-queue pages и недостающие token accounts либо служебные accounts backend.
- Backend/indexer: Node.js + TypeScript + MongoDB.
- Stock swaps: Jupiter. Backend получает котировку и собирает короткоживущий маршрут; программа разрешает вызов только настроенного Jupiter program ID и проверяет входной SOL, выходной xStocks mint, `minOut`, deadline и nonce.
- Локальные проверки: Rust unit tests, Anchor tests, LiteSVM или `solana-test-validator`.
- Окружения: local validator → devnet → mainnet-beta только по отдельному разрешению.

## On-chain состояние

- Configuration PDA: admin, pending admin, backend signer, pause state, `protocolTime`, разрешённые внешние program IDs и mint pubkeys.
- Main pool PDA и SPL vaults: текущая серия, следующий пул, фиксированные raw-обязательства уже рассчитанных выплат, доход на единицу веса и остатки округления по mint.
- Machine PDA на каждый Metaplex Core Asset: вес, версия, `activeUntil`, checkpoints, `fareBase` и `claimable` по поддерживаемым mint. Core Asset хранит владение и публичные NFT-метаданные; изменяемое состояние машины хранится только в Machine PDA.
- Event queue PDA: min-heap событий `MINT`, `REPAIR`, `EXPIRE`, упорядоченных по `timestamp + eventNumber`.
- Trainee pool и minute-bucket PDA: отдельные от основного парка пулы, очередь, доход на вес и записи `wallet + campaignId`.
- Program-controlled SPL token accounts: `$FARE`, stock reserves и рассчитанные активы до пользовательского `claim`.

## Публичные инструкции

- `collect_fees`: permissionless фиксирует новый pump.fun Creator Fee, поступивший напрямую на program-controlled PDA, увеличивает SOL-резервы направлений и переводит 10% команде. Swap внутри этой инструкции не выполняются.
- `process_fare_swap(plan, route_accounts...)`: permissionless по короткоживущему подписанному плану меняет накопленные 70% SOL на `$FARE`; фактический результат делится в пропорции 45/70 в основной пул, 5/70 в стажёрский пул и 20/70 немедленно сжигается.
- `process_stock_swap(mint, plan, route_accounts...)`: permissionless отдельно покупает одну разрешённую xStocks-позицию через Jupiter из её собственного SOL-резерва.
- `calculate_rewards(group, limit, accounts...)`: permissionless продвигает выбранную очередь максимум на 20 событий и обновляет глобальный доход на единицу веса. Caller может указать меньший `limit`; больше compile-time предела программа отклоняет.
- `claim(asset)`: текущий owner получает рассчитанный доход одной NFT.
- `repair(asset)`: текущий owner сжигает рассчитанную сумму `$FARE` и восстанавливает 5 дней прочности.
- `activate_trainee(voucher)`: проверяет ed25519-ваучер backend и создаёт временную стажёрскую запись.
- `claim_trainee(campaign_id)`: выплачивает одну стажёрскую машину.
- Административные инструкции: `pause`, `unpause`, двухшаговая смена admin, замена явно разрешённых зависимостей и согласованный rescue.
- Global pause замораживает `protocolTime` и блокирует инструкции Taxi, но не блокирует стандартный transfer Metaplex Core Asset. Collection Freeze Plugin не используется.

## Неизменные экономические правила

- `$FARE` запускается через pump.fun в canonical паре `FARE/SOL`. Собственных 4% временно нет; используется фактический переменный Creator Fee платформы, поступающий в SOL, без обещания постоянного процента.
- Параметры `$FARE` принимает стандартный запуск pump.fun; до основного запуска обязательны тестовый mint и проверка прямого получения Creator Fees на PDA.
- Split Creator Fee: 45% SOL покупают `$FARE` для основного парка, 5% — `$FARE` для стажёров, 20% — `$FARE` для burn, 20% напрямую покупают stock-токены, 10% переводятся команде в SOL.
- Stock-корзина состоит из `UBERx`, `TSLAx`, `GOOGLx` (Alphabet/Waymo) и `AMZNx` (Amazon/Zoox). Каждая позиция получает собственные 5% Creator Fee. Если xStock нельзя купить, SOL остаётся в отдельном резерве этой позиции и не перераспределяется.
- Рассчитанное stock-начисление NFT фиксируется в raw units. Пока пользователь не сделал `claim`, тот же raw amount уже участвует в изменениях xStocks multiplier; после `claim` он продолжает участвовать в них в пользовательском кошельке. Новый пул образуют только новые raw-токены, фактически полученные новой покупкой, а не изменение multiplier.
- Специальной паузы вокруг активации xStocks multiplier нет: raw-операции продолжаются, а небольшое возможное расхождение Jupiter quote принимается ради простоты и непрерывной работы.
- Парк распределяет только фактически накопленный пул, без фиксированного APY.
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
