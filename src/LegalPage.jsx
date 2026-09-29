import { displayTicker, useTokenConfig } from './tokenConfig.jsx';

const legalPages = {
  terms: {
    eyebrow: 'TERMS',
    title: <>TERMS OF<br />USE</>,
    intro: 'Simple rules for using Fare Share, its website and its onchain features.',
    callout: 'If tokenized stocks are restricted or not permitted in your country, do not use Fare Share’s stock-related features.',
    sections: [
      ['USING FARE SHARE', 'By accessing Fare Share or connecting a wallet, you agree to use the product lawfully and at your own risk. You are responsible for your wallet, transactions, taxes and compliance with the rules that apply where you live.'],
      ['REGIONAL ELIGIBILITY', 'Tokenized stocks and related services are not available in every country. If you are in a restricted or unsupported jurisdiction, we do not recommend trading them and ask that you do not use Fare Share’s stock-related features. Fare Share does not determine your location or legal eligibility for you.'],
      ['NO GUARANTEED RETURN', 'Fare Share provides access to NFTs, $FARE and variable protocol rewards. Nothing on the website is financial, investment, legal or tax advice. Rewards are not guaranteed, asset values can fall, and you may lose some or all of the value you use.'],
      ['WALLETS & TRANSACTIONS', 'You keep control of your wallet and private keys. Blockchain transactions are public and usually irreversible. Always verify the network, asset, amount and destination before signing. Never share your seed phrase or private key.'],
      ['AVAILABILITY & CHANGES', 'The website, third-party integrations and onchain features may be changed, paused or unavailable. These terms may be updated when the product changes. Continued use after an update means you accept the revised terms.'],
    ],
  },
  privacy: {
    eyebrow: 'PRIVACY',
    title: <>PRIVACY<br />NOTICE</>,
    intro: 'What information Fare Share uses and what stays public on the blockchain.',
    callout: 'Fare Share will never ask for your seed phrase or private key.',
    sections: [
      ['WHAT WE USE', 'Fare Share may process your public wallet address, public blockchain activity and basic technical data needed to operate, secure and improve the website. We do not need your name to let you connect a wallet.'],
      ['PUBLIC BLOCKCHAIN DATA', 'Wallet addresses and transactions on Solana are public. Blockchain records are outside Fare Share’s control and cannot be changed or deleted by us. Avoid linking a wallet to information you want to keep private.'],
      ['HOW DATA IS USED', 'Information is used to provide product features, show your taxis and rewards, prevent abuse, diagnose errors and maintain service security. We do not sell personal information.'],
      ['SERVICE PROVIDERS', 'Wallet software, RPC providers, analytics, hosting and trading integrations may process data under their own privacy terms. Review those terms before using a third-party service.'],
      ['RETENTION & CHANGES', 'Operational data is kept only as long as reasonably needed for the service, security or legal obligations. This notice may be updated as Fare Share changes.'],
    ],
  },
  disclaimer: {
    eyebrow: 'DISCLAIMER',
    title: <>RISK<br />DISCLAIMER</>,
    intro: 'Important risks to understand before using Fare Share.',
    callout: 'Only use assets you can afford to lose. No return, price or market access is guaranteed.',
    sections: [
      ['NOT FINANCIAL ADVICE', 'Fare Share is a software product, not a broker, bank or financial adviser. Information on this website is general product information and is not investment, legal or tax advice.'],
      ['MARKET RISK', '$FARE, SOL, NFTs and tokenized stocks can be volatile, illiquid or lose all value. Past activity does not predict future rewards. Protocol rewards depend on actual fees, available liquidity and successful third-party integrations.'],
      ['TECHNOLOGY RISK', 'Smart contracts, wallets, networks, websites and third-party services can fail, be attacked or become unavailable. Transactions may be delayed, rejected or irreversible.'],
      ['TOKENIZED STOCKS', 'Tokenized stocks are subject to issuer terms, market availability and regional restrictions. If these products are restricted or not permitted in your country, we do not recommend trading them and ask that you do not use Fare Share’s stock-related features.'],
      ['YOUR RESPONSIBILITY', 'Do your own research, verify official addresses and understand every transaction before signing. You are responsible for deciding whether Fare Share is appropriate and lawful for you.'],
    ],
  },
};

function SectionTitle({ number, children }) {
  return <div className="fare-docs-section-title"><span>{number}</span><h2>{children}</h2></div>;
}

export function LegalPage({ type }) {
  const page = legalPages[type];
  const ticker = displayTicker(useTokenConfig());

  return (
    <main className="fare-docs-main fare-legal-main" id="top">
      <div className="container">
        <header className="fare-docs-page-heading fare-page-heading">
          <h1 className={`fare-page-title ${page.eyebrow.length > 7 ? 'is-long' : 'is-short'}`}>{page.eyebrow}</h1>
          <p>{page.intro}</p>
        </header>

        <div className="fare-docs-layout fare-legal-layout">
          <article className="fare-docs-article">
            <header className="fare-docs-article-header">
              <h2>{page.title}</h2>
              <div>
                <p>{page.intro}</p>
                <p className="fare-legal-meta">Last updated: September 28, 2026</p>
              </div>
            </header>

            <div className="fare-docs-callout fare-legal-callout">{page.callout}</div>

            {page.sections.map(([title, text], index) => (
              <section className="fare-docs-copy-section" key={title}>
                <SectionTitle number={String(index + 1).padStart(2, '0')}>{title}</SectionTitle>
                <p>{text.replaceAll('$FARE', `$${ticker}`)}</p>
              </section>
            ))}
          </article>
        </div>
      </div>
    </main>
  );
}

export function TermsPage() {
  return <LegalPage type="terms" />;
}

export function PrivacyPage() {
  return <LegalPage type="privacy" />;
}

export function DisclaimerPage() {
  return <LegalPage type="disclaimer" />;
}
