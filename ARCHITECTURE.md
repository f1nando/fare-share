# Архитектура Taxi на Solana

## Статус

Проект проектируется для Solana. Старые решения для Robinhood Chain/EVM не применяются. Экономика, прочность машин и lazy accounting сохранены; несовместимые инфраструктурные решения повторно открыты в `docs/TECHNICAL-QUESTIONS.md`.

## Минимальный стек

- On-chain: Rust + Anchor, Solana programs и PDA accounts.
- Fungible assets: SPL Token или Token-2022; точный формат `$FARE` пока открыт.
- NFT: Solana NFT asset; предварительный кандидат — Metaplex Core.
- Frontend: React + Vite + TypeScript, `@solana/kit`, React bindings и Wallet Standard.
- Backend/indexer: Node.js + TypeScript + MongoDB.
- Локальные проверки: Rust unit tests, Anchor tests, LiteSVM или `solana-test-validator`.
- Окружения: local validator → devnet → mainnet-beta только по отдельному разрешению.

## On-chain состояние

- Configuration PDA: admin, pending admin, backend signer, pause state, `protocolTime`, разрешённые внешние program IDs и mint pubkeys.
- Main pool PDA и SPL vaults: текущая серия, следующий пул, reserved/claimable totals, доход на единицу веса и остатки округления по mint.
- Machine PDA на каждый NFT asset: вес, версия, `activeUntil`, checkpoints, `fareBase` и `claimable` по поддерживаемым mint.
- Event queue PDA: min-heap событий `MINT`, `REPAIR`, `EXPIRE`, упорядоченных по `timestamp + eventNumber`.
- Trainee pool и minute-bucket PDA: отдельные от основного парка пулы, очередь, доход на вес и записи `wallet + campaignId`.
- Program-controlled SPL token accounts: `$FARE`, stock reserves и рассчитанные активы до пользовательского `claim`.

## Публичные инструкции

- `collect_fees`: получает доступные комиссии и выполняет базовый split; точный источник 4% и граница stock swaps пока открыты.
- `calculate_rewards(group, accounts...)`: permissionless продвигает выбранную очередь bounded batch и обновляет глобальный доход на единицу веса.
- `claim(asset)`: текущий owner получает рассчитанный доход одной NFT.
- `repair(asset)`: текущий owner сжигает рассчитанную сумму `$FARE` и восстанавливает 5 дней прочности.
- `activate_trainee(voucher)`: проверяет ed25519-ваучер backend и создаёт временную стажёрскую запись.
- `claim_trainee(campaign_id)`: выплачивает одну стажёрскую машину.
- Административные инструкции: `pause`, `unpause`, двухшаговая смена admin, замена явно разрешённых зависимостей и согласованный rescue.

## Неизменные экономические правила

- 4% от покупки и 4% от продажи `$FARE`; точная Solana-реализация открыта.
- Split комиссий: 45% основной парк, 5% стажёры, 20% burn `$FARE`, 20% stock-корзина, 10% команда.
- Парк распределяет только фактически накопленный пул, без фиксированного APY.
- Максимальная прочность обычной машины — 5 дней; `claim` её не меняет.
- Полный ремонт стоит 25% рассчитанного `$FARE`-дохода машины после прошлого mint/ремонта и уменьшается пропорционально фактически потерянной прочности.
- Распределение использует общий доход на единицу веса и не перебирает 9500 NFT.
- Все суммы fungible tokens учитываются в raw units конкретного mint.

## Главные открытые зависимости

В первую очередь нужно решить SOL-1—SOL-11 в `docs/TECHNICAL-QUESTIONS.md`: механизм торговой комиссии, провайдера и mint токенизированных акций, corporate actions, swap venue, NFT-стандарт, embedded wallet/fee sponsorship, формат `$FARE`, batch limit, атомарность fee processing, transfer NFT во время pause и оплату создания Solana accounts.

## Технические основания

- [Solana Core Concepts](https://solana.com/docs/core) — programs, accounts, PDA, CPI и transaction limits.
- [Token-2022 Transfer Fees](https://solana.com/docs/tokens/extensions/transfer-fees) — стандартная комиссия применяется к каждому transfer, поэтому не является прямой заменой Uniswap hook.
- [Token-2022 Scaled UI Amount](https://solana.com/docs/tokens/extensions/scaled-ui-amount) — raw amount не меняется, multiplier влияет только на отображение.
- [Solana frontend client](https://solana.com/docs/frontend/client) — актуальный стек `@solana/kit` и React.
- [Anchor](https://www.anchor-lang.com/docs) — framework для Solana programs на Rust.
- [Metaplex Core Asset](https://developers.metaplex.com/core/what-is-an-asset) — предварительный NFT-кандидат с одним asset account.
- [xStocks](https://xstocks.com/products) — предварительный кандидат токенизированных акций на Solana; конкретные продукты, mint-адреса, ликвидность и региональные ограничения ещё нужно подтвердить.
