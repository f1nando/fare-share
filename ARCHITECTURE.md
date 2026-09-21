# Архитектура Taxi на Solana

## Статус

Проект проектируется для Solana. Старые решения для Robinhood Chain/EVM не применяются. Экономика, прочность машин и lazy accounting сохранены; несовместимые инфраструктурные решения повторно открыты в `docs/TECHNICAL-QUESTIONS.md`.

Точный снимок прежнего EVM-варианта сохранён в `docs/evm-robinhood-chain/` как независимая основа для возможного будущего запуска. Текущая разработка продолжается только по Solana-документам.

## Минимальный стек

- On-chain: Rust + Anchor, Solana programs и PDA accounts.
- `$FARE`: стандартный SPL-совместимый mint, создаваемый pump.fun, без собственных Token-2022 extensions и административных mint/freeze-возможностей проекта.
- Stock assets: только официальные xStocks mint на Solana; смешивание нескольких эмитентов не используется.
- Региональные ограничения xStocks показываются как явный запрет в frontend и условиях использования. Технические геоблокировки, KYC и on-chain denylist не используются; достаточность подхода требует юридической проверки до запуска.
- NFT: Metaplex Core Assets в официальной коллекции проекта. Phantom и основные Solana NFT-интерфейсы показывают их как обычные коллекционные NFT.
- Frontend: React + Vite + TypeScript, `@solana/kit`, React bindings и Wallet Standard.
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

- `collect_fees`: permissionless обрабатывает pump.fun Creator Fee, поступивший напрямую на program-controlled PDA, делит SOL по направлениям и запускает необходимые покупки `$FARE` и stock-токенов.
- `calculate_rewards(group, accounts...)`: permissionless продвигает выбранную очередь bounded batch и обновляет глобальный доход на единицу веса.
- `claim(asset)`: текущий owner получает рассчитанный доход одной NFT.
- `repair(asset)`: текущий owner сжигает рассчитанную сумму `$FARE` и восстанавливает 5 дней прочности.
- `activate_trainee(voucher)`: проверяет ed25519-ваучер backend и создаёт временную стажёрскую запись.
- `claim_trainee(campaign_id)`: выплачивает одну стажёрскую машину.
- Административные инструкции: `pause`, `unpause`, двухшаговая смена admin, замена явно разрешённых зависимостей и согласованный rescue.

## Неизменные экономические правила

- `$FARE` запускается через pump.fun в canonical паре `FARE/SOL`. Собственных 4% временно нет; используется фактический переменный Creator Fee платформы, поступающий в SOL, без обещания постоянного процента.
- Параметры `$FARE` принимает стандартный запуск pump.fun; до основного запуска обязательны тестовый mint и проверка прямого получения Creator Fees на PDA.
- Split Creator Fee: 45% SOL покупают `$FARE` для основного парка, 5% — `$FARE` для стажёров, 20% — `$FARE` для burn, 20% напрямую покупают stock-токены, 10% переводятся команде в SOL.
- Каждая из четырёх stock-позиций получает собственные 5% Creator Fee. Если xStock нельзя купить, SOL остаётся в отдельном резерве этой позиции и не перераспределяется.
- Рассчитанное stock-начисление NFT фиксируется в raw units и не растёт до `claim`. Любой новый прирост stock-баланса program vault, включая rebasing/corporate action, сверх уже зарезервированных обязательств относится к новому пулу будущей выплаты. После `claim` токены находятся у пользователя, и последующие корпоративные события получает уже его кошелёк.
- Парк распределяет только фактически накопленный пул, без фиксированного APY.
- Максимальная прочность обычной машины — 5 дней; `claim` её не меняет.
- Полный ремонт стоит 25% рассчитанного `$FARE`-дохода машины после прошлого mint/ремонта и уменьшается пропорционально фактически потерянной прочности.
- Распределение использует общий доход на единицу веса и не перебирает 9500 NFT.
- Все суммы fungible tokens учитываются в raw units конкретного mint.

## Главные открытые зависимости

В первую очередь нужно решить оставшиеся пункты SOL-6—SOL-11 в `docs/TECHNICAL-QUESTIONS.md`: embedded wallet/fee sponsorship, batch limit, атомарность fee processing, transfer NFT во время pause и оплату создания Solana accounts.

## Технические основания

- [Solana Core Concepts](https://solana.com/docs/core) — programs, accounts, PDA, CPI и transaction limits.
- [Token-2022 Transfer Fees](https://solana.com/docs/tokens/extensions/transfer-fees) — стандартная комиссия применяется к каждому transfer, поэтому не является прямой заменой Uniswap hook.
- [Token-2022 Scaled UI Amount](https://solana.com/docs/tokens/extensions/scaled-ui-amount) — raw amount не меняется, multiplier влияет только на отображение.
- [Solana frontend client](https://solana.com/docs/frontend/client) — актуальный стек `@solana/kit` и React.
- [Anchor](https://www.anchor-lang.com/docs) — framework для Solana programs на Rust.
- [Metaplex Core Asset](https://developers.metaplex.com/core/what-is-an-asset) — выбранный NFT-стандарт с одним asset account и системой plugins.
- [xStocks](https://xstocks.com/products) — предварительный кандидат токенизированных акций на Solana; конкретные продукты, mint-адреса, ликвидность и региональные ограничения ещё нужно подтвердить.
- [pump.fun Fees](https://pump.fun/docs/fees) — Creator Fee и общая торговая комиссия зависят от стадии запуска, paired asset и диапазона market cap и могут изменяться площадкой.
- [pump.fun Supported Pair Assets](https://pump.fun/docs/custom-pairs) — Creator Fees выплачиваются в paired asset, а не в `$FARE` автоматически.
