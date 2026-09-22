const usdPerSol = Number(process.argv[2]);
const cents = (process.env.MINT_PRICE_USD_CENTS || '1,3,10,30')
  .split(',')
  .map(value => Number(value.trim()));

if (!Number.isFinite(usdPerSol) || usdPerSol <= 0) {
  throw new Error('Usage: npm run protocol:quote-mint-prices -- <current USD price of 1 SOL>');
}
if (cents.length !== 4 || cents.some(value => !Number.isInteger(value) || value <= 0)) {
  throw new Error('MINT_PRICE_USD_CENTS must contain four positive integer cent values');
}

const lamports = cents.map(value => Math.max(1, Math.round((value / 100 / usdPerSol) * 1_000_000_000)));

console.log(`Input SOL price: $${usdPerSol}`);
console.log(`USD targets: ${cents.map(value => `$${(value / 100).toFixed(2)}`).join(', ')}`);
console.log(`MINT_PRICES_LAMPORTS=${lamports.join(',')}`);
console.log('Review and approve these values before writing them to the deployment environment.');
