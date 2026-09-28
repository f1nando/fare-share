import { useState } from 'react';

export const FARE_FAQ_ITEMS = [
  {
    question: 'HOW DO IT EARN FROM MY CARS?',
    answer: 'Send ready cars on shift. Each completed shift pays park revenue in cash and your selected stock token.',
  },
  {
    question: 'WHAT ARE THE FEES?',
    answer: 'Fees cover fleet operations and servicing. Every charge is shown before you confirm an action.',
  },
  {
    question: 'CAN I SELL MY CARS?',
    answer: 'Yes. Eligible cars can be listed on the marketplace or transferred from your garage.',
  },
  {
    question: 'IS THIS A REAL PRODUCT?',
    answer: 'Yes. Fare Share combines collectible taxi ownership with transparent fleet revenue tracking.',
  },
  {
    question: 'WHERE CAN I READ THE FULL DOCS',
    answer: 'Open the Docs from the navigation for mechanics, fees, treasury rules, and contract details.',
  },
];

function FaqChevron() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="44" height="44" rx="22" fill="black" />
      <path d="M14 19L22 27L30 19" stroke="white" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function FareFaq({ id = 'faq', titleId = 'fare-faq-title', titleClassName, titleTag: TitleTag = 'h2', answerIdPrefix = 'fare-faq-answer' }) {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <section className="fare-faq" id={id} aria-labelledby={titleId}>
      <div className="container">
        <TitleTag className={titleClassName} id={titleId}>FAQ</TitleTag>
        <div className="fare-faq-list">
          {FARE_FAQ_ITEMS.map((item, index) => {
            const isOpen = openIndex === index;
            const answerId = `${answerIdPrefix}-${index}`;

            return <article className={`fare-faq-entry${isOpen ? ' is-open' : ''}`} key={item.question}>
              <button
                className="fare-faq-item"
                type="button"
                aria-expanded={isOpen}
                aria-controls={answerId}
                onClick={() => setOpenIndex(isOpen ? null : index)}
              >
                <span>{item.question}</span>
                <FaqChevron />
              </button>
              <div className="fare-faq-answer" id={answerId} aria-hidden={!isOpen}>
                <div><p>{item.answer}</p></div>
              </div>
            </article>;
          })}
        </div>
      </div>
    </section>
  );
}
