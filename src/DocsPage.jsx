import { useEffect, useState } from 'react';
import { displayTicker, useTokenConfig } from './tokenConfig.jsx';

const steps = [
  ['01', 'MINT A TAXI', 'Mint the next taxi from the precommitted shuffled collection.'],
  ['02', 'EARN BY WEIGHT', 'An active taxi shares actual protocol rewards.'],
  ['03', 'REPAIR WITH FARE', 'Restore five days of durability when needed.'],
  ['04', 'CLAIM ASSETS', 'Collect FARE and available xStocks to your wallet.'],
];

const tabs = [
  { id: 'overview', label: 'OVERVIEW', href: '#overview', sections: ['overview', 'one-minute', 'public-data'] },
  { id: 'taxis', label: 'TAXIS', href: '#cars', sections: ['cars', 'mint', 'garage'] },
  { id: 'rewards', label: 'REWARDS', href: '#revenue', sections: ['revenue', 'rewards', 'leaderboard'] },
  { id: 'trading', label: 'TRADING', href: '#trade', sections: ['trade', 'market'] },
  { id: 'repairs', label: 'REPAIRS', href: '#durability', sections: ['durability', 'ownership'] },
  { id: 'risks', label: 'RISKS', href: '#trainee', sections: ['trainee', 'risks'] },
];

function SectionTitle({ number, children }) {
  return <div className="fare-docs-section-title"><span>{number}</span><h2>{children}</h2></div>;
}

export function DocsPage() {
  const tokenConfig = useTokenConfig();
  const ticker = displayTicker(tokenConfig);
  const [activeTab, setActiveTab] = useState('overview');
  const [isMobileHeader, setIsMobileHeader] = useState(false);

  useEffect(() => {
    const breakpoint = window.matchMedia('(max-width: 600px)');
    const updateHeaderOffset = () => setIsMobileHeader(breakpoint.matches);

    updateHeaderOffset();
    breakpoint.addEventListener('change', updateHeaderOffset);
    return () => breakpoint.removeEventListener('change', updateHeaderOffset);
  }, []);

  useEffect(() => {
    const updateActiveTab = () => {
      const marker = 190;
      let current = 'overview';

      tabs.forEach((tab) => {
        tab.sections.forEach((sectionId) => {
          const section = document.getElementById(sectionId);
          if (section && section.getBoundingClientRect().top <= marker) current = tab.id;
        });
      });

      setActiveTab(current);
    };

    updateActiveTab();
    window.addEventListener('scroll', updateActiveTab, { passive: true });
    window.addEventListener('resize', updateActiveTab);
    return () => {
      window.removeEventListener('scroll', updateActiveTab);
      window.removeEventListener('resize', updateActiveTab);
    };
  }, []);

  return (
    <>
      <main className="fare-docs-main" id="top">
        <div className="container">
          <header className="fare-docs-page-heading fare-page-heading">
            <h1 className="fare-page-title is-short">DOCS</h1>
            <p>How the onchain taxi park works.</p>
          </header>
          <nav
            className="fare-docs-tabs"
            aria-label="Documentation sections"
            style={{ position: 'sticky', top: isMobileHeader ? '88px' : '118px', zIndex: 2 }}
          >
            {tabs.map((tab) => (
              <a
                className={activeTab === tab.id ? 'is-active' : undefined}
                href={tab.href}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </a>
            ))}
          </nav>

          <div className="fare-docs-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <article className="fare-docs-article" id="overview">
              <header className="fare-docs-article-header">
                <h2>THE ONCHAIN<br />TAXI PARK</h2>
                <p>Fare Share is a Solana taxi park made of ownable NFT cars. Active cars share rewards created from actual protocol fees. Returns are variable, no fixed APY is promised, and every owner keeps control of their NFT and claimed assets.</p>
              </header>

              <div className="fare-docs-steps" aria-label="How Fare Share works">
                {steps.map(([number, title, text]) => <div key={number}><strong>{number} · {tokenText(title, ticker)}</strong><span>{tokenText(text, ticker)}</span></div>)}
              </div>

              <section className="fare-docs-copy-section" id="one-minute">
                <SectionTitle number="01">FARE SHARE IN ONE MINUTE</SectionTitle>
                <p>Connect a supported Solana wallet and mint a taxi from the official Fare Share collection. Each taxi is a Metaplex Core NFT with its own onchain operating account. The NFT stays in your wallet; Fare Share never takes custody of your wallet or private keys.</p>
                <p>A newly minted taxi enters the park with five days of durability and starts participating automatically. There are no routes, drivers or shifts to configure. Its share depends on the class weight and the exact time for which it remains active.</p>
                <p>{tokenText('Protocol fees are converted into $FARE and four supported xStocks. Rewards are calculated onchain in batches and become claimable by the current NFT owner. Repairing restores durability; claiming does not.', ticker)}</p>
                <div className="fare-docs-callout">Mint → stay active → rewards are calculated → claim to your wallet → repair and repeat.</div>
              </section>

              <section className="fare-docs-copy-section" id="public-data">
                <SectionTitle number="02">PUBLIC SITE & LIVE DATA</SectionTitle>
                <p>The public dashboard is a finalized read model of Solana state. Minted Cars is the number of paid taxis already created; Active Cars counts taxis currently earning; Unique Owners counts distinct current owner wallets; and Active Weight is the sum of the class weights of active taxis.</p>
                <p>Treasury SOL is unprocessed SOL held in the protocol fee vault, not every SOL balance controlled by the project. Funded Reward Assets shows how many of the five reward vaults currently have a non-zero balance. A funded vault does not mean every taxi already has a claimable amount.</p>
                <p>Wallet addresses, NFTs, balances and transactions are public on Solana. The site uses MongoDB only for rebuildable indexes, charts and public read models; onchain accounts remain authoritative for ownership, reserves and actions.</p>
                <p>FAQ provides short answers, while Terms, Privacy and Disclaimer contain the legal and risk information that applies to the website. Test and internal utility routes are not product features and are not part of these user instructions.</p>
                <div className="fare-docs-callout">Current configured token: ${ticker}<br />Mint: <span className="break">{tokenConfig.mint || 'Loading current configuration…'}</span></div>
              </section>

              <section className="fare-docs-copy-section" id="cars">
                <SectionTitle number="03">TAXIS, CLASSES & SUPPLY</SectionTitle>
                <p>The paid collection has exactly 1,222 taxis: 833 Economy cars with weight 1, 278 Comfort cars with weight 3, 83 Business cars with weight 10, and 28 Legend cars with weight 30. Class and model follow a precommitted shuffled order. Weight affects a taxi’s share of a reward period; it is not a guaranteed return.</p>
                <p>{tokenText('Every taxi mint costs $25. The class and one of its four models come from a precommitted shuffled supply of 1,222 cars. Immediately before minting, a short-lived signed quote converts $25 into $FARE using live market liquidity. The full token payment goes directly to the team wallet.', ticker)}</p>
                <p>The team receives tokens rather than guaranteed dollars. The minted Metaplex Core Asset remains transferable and can be listed for SOL through Fare Share Market.</p>
                <p>Names, artwork and permanent traits are stored through immutable Arweave metadata. Live information—durability, checkpoints and unclaimed rewards—is read from the taxi’s Solana account instead of being written into static NFT metadata.</p>
                <p>Burning a taxi permanently removes the NFT and does not reopen its place in the collection. After the burn is finalized and cleaned up onchain, its future weight is removed and any unclaimed assets return to the relevant reward pools.</p>
              </section>

              <section className="fare-docs-copy-section" id="mint">
                <SectionTitle number="04">MINT PAGE</SectionTitle>
                <p>The Mint page shows the finalized number minted in each class, the remaining collection supply and live odds based on the still-unminted assignments. One random taxi is minted per transaction and its class and model are revealed only after the transaction.</p>
                <p>{tokenText('A short-lived quote converts the current on-chain USD mint price into the current $FARE amount. If the connected wallet does not have enough $FARE, the page can prepare a separate Jupiter purchase for the missing amount. The refreshed mint quote must still be valid when the NFT transaction is signed.', ticker)}</p>
                <p>The mint transaction atomically transfers payment, creates the Metaplex Core NFT and initializes its onchain taxi account. A successful taxi starts with five days of durability. If public indexing is delayed after finalization, the NFT still exists onchain and the site retries synchronization.</p>
                <p>The same page accepts active trainee campaign keywords. Trainee activation is a separate transaction, costs no taxi purchase price, and still requires SOL for network fees and account rent.</p>
              </section>

              <section className="fare-docs-copy-section" id="garage">
                <SectionTitle number="05">GARAGE</SectionTitle>
                <p>Garage loads the connected wallet’s finalized paid taxis and trainee NFTs. Each paid taxi card shows its class, weight, durability, calculated ${ticker} and calculated UBERx, TSLAx, GOOGLx and AMZNx balances.</p>
                <p>The fleet summary shows claimable cars, total owned fleet weight and how many cars are still working. Its 24-hour, 7-day and 30-day chart records the wallet’s finalized claimable ${ticker} history; it is not a price or profit chart.</p>
                <p>Claim and Repair can be signed for one taxi or in batches. The current client supports up to ten claims when the protocol lookup table is configured, otherwise four, and up to eight repairs per transaction. Larger fleets are processed by repeating the action. Each transaction is atomic and never partially claims or repairs its selected batch.</p>
                <p>Trainee rewards are shown and claimed separately. During a protocol pause, Garage remains readable but claim and repair transactions are disabled.</p>
              </section>

              <section className="fare-docs-copy-section" id="revenue">
                <SectionTitle number="06">WHERE REWARDS COME FROM</SectionTitle>
                <p>{tokenText('$FARE launches through pump.fun in the FARE/SOL pair. Fare Share receives the platform’s actual variable Creator Fee in SOL. The fee rate is controlled by the platform and can change; Fare Share does not add or promise a permanent 4% trading tax.', ticker)}</p>
                <p>{tokenText('Collected SOL is separated by the protocol: 45% buys $FARE for the main taxi park, 5% buys $FARE for trainee campaigns, 20% buys and burns $FARE, 20% buys xStocks in four equal 5% allocations, and 10% goes to the project team.', ticker)}</p>
                <p>The stock basket contains UBERx, TSLAx, GOOGLx and AMZNx. Each asset is bought independently through Jupiter. If one route is unavailable or fails its safety checks, that asset’s SOL remains reserved for a later attempt; successful purchases and other rewards are not cancelled.</p>
                <div className="fare-docs-callout">The park distributes only assets it actually receives. It does not create a fixed yield or debt for a missing asset.</div>
              </section>

              <section className="fare-docs-copy-section" id="rewards">
                <SectionTitle number="07">HOW REWARDS ARE CALCULATED</SectionTitle>
                <p>Rewards are split by active time and class weight. The protocol divides a calculation period at every mint, repair and expiry event. Within each time segment, an active taxi receives its class weight divided by the total active weight, multiplied by that segment’s share of the available pool.</p>
                <p>A taxi never earns for time before it was minted or while it is broken. Funds may already be in a pool before a taxi joins, but the new taxi can share only the time segments after its exact mint or repair time. If no taxis are active, the pool waits instead of being lost.</p>
                <p>Calculation and claim are separate. Permissionless calculation transactions advance the event queue in bounded batches and lock each taxi’s share. A claim simply transfers the amount already calculated for one taxi; claim order cannot increase or reduce anyone else’s allocation.</p>
                <p>{tokenText('A payout can contain $FARE, UBERx, TSLAx, GOOGLx and AMZNx. Each asset is accounted for independently in its native raw units. Small rounding remainders stay in the matching pool for a future calculation.', ticker)}</p>
              </section>

              <section className="fare-docs-copy-section" id="leaderboard">
                <SectionTitle number="08">LEADERBOARD</SectionTitle>
                <p>The Leaderboard ranks verified current owners by active fleet weight, then by car count. Weight is displayed together with the number of paid taxis owned by that wallet. Inactive taxis remain in the car count but do not contribute active weight.</p>
                <p>Received, USD is the lifetime value of confirmed onchain reward claims indexed for that owner and valued with the current indexed USD prices. It excludes rewards that are merely claimable and can change when asset prices change. Wallet links open the corresponding public Solscan account.</p>
              </section>

              <section className="fare-docs-copy-section" id="trade">
                <SectionTitle number="09">TRADE TOKEN</SectionTitle>
                <p>{tokenText('Trade buys or sells the currently configured $FARE token against SOL through a validated Jupiter route. The form shows the expected output, route, price impact and token market stage before the wallet is asked to sign.', ticker)}</p>
                <p>HALF and MAX use the connected wallet’s available balance. For SOL purchases, MAX keeps an estimated reserve for priority fees and possible token-account creation; the wallet shows the final network fee. Quotes can expire or change before signing, and the transaction may fail if liquidity or safety limits change.</p>
                <p>The page also displays indexed candlesticks and volume, recent finalized trades, and the largest token holders. These views are informational and may lag the chain while indexing catches up.</p>
              </section>

              <section className="fare-docs-copy-section" id="market">
                <SectionTitle number="10">TAXI MARKET</SectionTitle>
                <p>Market is Fare Share’s onchain SOL marketplace. Buy a Taxi shows active fixed-price listings. A purchase transfers the exact listed SOL price to the seller and the selected NFT to the buyer atomically.</p>
                <p>A seller can list a transferable paid taxi, cancel the listing or accept a matching buy request. The listed NFT stays in the seller’s wallet; its onchain transfer delegate can move it only through the authorized sale. Trainee NFTs cannot be listed because they are permanently non-transferable.</p>
                <p>Buy requests can target one exact NFT, one vehicle model or one class. Their SOL is held in an onchain escrow until a matching owner accepts or the buyer cancels. Acceptance exchanges the selected NFT and escrowed SOL atomically. Cancelling returns the escrowed SOL and recoverable account rent.</p>
                <p>My Activity shows the connected wallet’s listings and escrowed requests. Buying a listing does not automatically cancel a separate exact-NFT request made by the same buyer; it must be cancelled from My Activity to recover its escrow. Fare Share charges no NFT creator royalty, although Solana network and account-rent costs may apply.</p>
              </section>

              <section className="fare-docs-copy-section" id="durability">
                <SectionTitle number="11">DURABILITY & REPAIRS</SectionTitle>
                <p>Every normal taxi has five days of maximum durability. At the exact expiry time it leaves the active weight and stops earning until repaired. Claiming rewards does not refill or extend durability.</p>
                <p>{tokenText('A repair burns $FARE from the current owner and restores a full five days from the repair time. The cost is 25% of the taxi’s calculated $FARE earnings since its previous mint or repair. Only already calculated earnings are used; pending calculations are never estimated.', ticker)}</p>
                <p>{tokenText('Repairing early does not reduce the total percentage paid: each repair uses only the new calculated $FARE earned since the preceding mint or repair. A taxi at full durability cannot be repaired merely to extend its expiry time.', ticker)}</p>
                <p>{tokenText('If the calculated repair base is zero, the repair can be free. Otherwise the wallet must hold enough $FARE and confirm the burn transaction. Repair all handles up to eight worn taxis in one atomic transaction. If more need repair, Garage shows how many remain for the next transaction; no batch is partially executed. Network and account-creation fees are paid separately in SOL.', ticker)}</p>
              </section>

              <section className="fare-docs-copy-section" id="ownership">
                <SectionTitle number="12">OWNERSHIP, CLAIMS & TRANSFERS</SectionTitle>
                <p>The wallet that currently owns the official NFT controls its taxi. A similar-looking NFT outside the verified Fare Share collection is not accepted by the protocol. Marketplace delegates cannot claim or repair unless they are also the current owner.</p>
                <p>Unclaimed rewards, durability and operating history belong to the taxi’s onchain account and move with the NFT. If a transfer completes before claim, the new owner can claim the full remaining balance. Assets already claimed to the previous owner’s wallet do not follow the taxi.</p>
                <p>A single-car claim transfers all supported assets calculated for that taxi at that moment. Claim all aggregates five reward assets and handles up to four taxis in one atomic transaction, or up to ten when the protocol lookup table is configured. If more taxis have rewards, Garage shows how many remain for the next transaction; no batch is partially executed. New rewards calculated later can be claimed in another transaction. The owner pays the Solana network fee and any rent needed to create missing token accounts.</p>
                <p>Fare Share does not charge NFT royalties on ordinary secondary transfers or marketplace sales. Direct wallet transfers and Fare Share Market activity remain onchain and require normal Solana fees. Always verify the official collection and transaction details before signing.</p>
              </section>

              <section className="fare-docs-copy-section" id="trainee">
                <SectionTitle number="13">TRAINEE CAMPAIGNS</SectionTitle>
                <p>A trainee campaign mints an eligible wallet a temporary Metaplex Core NFT through a backend-signed voucher. The NFT appears in the wallet and Garage, but it is permanently non-transferable and cannot be repaired. The voucher defines a campaign, an activation window and a duration between one hour and seven days.</p>
                <p>{tokenText('Trainees share a separate 5% $FARE pool. Participation starts at the next full minute, ends automatically, and does not affect the main NFT park. Each campaign can be activated once per wallet and claimed separately.', ticker)}</p>
                <p>The backend checks campaign rules and signs the voucher, while the Solana program verifies that signature and prevents reuse. A voucher never gives the backend access to the user’s wallet.</p>
              </section>

              <section className="fare-docs-copy-section" id="risks">
                <SectionTitle number="14">FEES, RISKS & TRUST</SectionTitle>
                <p>{tokenText('Rewards depend on real trading activity, swap execution, token liquidity, active park weight and asset prices. $FARE, SOL, NFTs and tokenized stocks can lose value. Historical rewards are not a forecast, and owning a taxi does not guarantee profit or principal protection.', ticker)}</p>
                <p>{tokenText('Owners pay $FARE for the NFT mint price and SOL for network fees and account rent. Claim, repair and trainee transactions also require SOL network fees. Swaps depend on Jupiter routes; xStocks also depend on their issuer, supported jurisdictions and market availability. Users must confirm they are legally permitted to use the product and tokenized stocks in their country.', ticker)}</p>
                <p>The Solana program is the source of truth for reserves, reward checkpoints and ownership rules. MongoDB stores recoverable backend data and cache only. Most maintenance calls are permissionless, but fresh swap plans require the backend signer.</p>
                <p>The deployment has an upgrade authority and a trusted admin. During a global pause, the admin can use emergency rescue functions, including moving assets from protocol-controlled vaults. This is an explicit trust assumption, not a trustless guarantee. Verify the official domain, collection and token addresses before signing.</p>
                <div className="fare-docs-callout">Never share a seed phrase or private key. Fare Share support will never ask for either.</div>
              </section>
            </article>
          </div>
        </div>
      </main>
    </>
  );
}

function tokenText(value, ticker) {
  return value.replaceAll('$FARE', `$${ticker}`).replaceAll('FARE/SOL', `${ticker}/SOL`).replace(/\bFARE\b/g, ticker);
}
