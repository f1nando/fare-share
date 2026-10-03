const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

export function formatCompactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (number === 0) return '0';

  const sign = number < 0 ? '−' : '';
  const absolute = Math.abs(number);
  if (absolute >= 1_000) return `${sign}${formatInteger(Math.trunc(absolute))}`;
  if (absolute >= 1) return `${sign}${formatTruncated(absolute, 1)}`;

  const leadingZeros = Math.max(0, Math.ceil(-Math.log10(absolute)) - 1);
  const factor = 10 ** (leadingZeros + 3);
  const significant = String(Math.trunc(absolute * factor + Number.EPSILON)).padStart(3, '0').slice(0, 3);
  const trimmedSignificant = significant.replace(/0+$/, '') || '0';
  if (leadingZeros >= 4) return `${sign}0,0${toSubscript(leadingZeros - 1)}${trimmedSignificant}`;
  return `${sign}0,${'0'.repeat(leadingZeros)}${trimmedSignificant}`;
}

function formatInteger(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0, useGrouping: true }).format(value);
}

function formatTruncated(value, decimalPlaces) {
  const factor = 10 ** decimalPlaces;
  const truncated = Math.trunc(value * factor + Number.EPSILON) / factor;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: decimalPlaces, useGrouping: true }).format(truncated);
}

function toSubscript(value) {
  return String(value).replace(/\d/g, digit => SUBSCRIPT_DIGITS[Number(digit)]);
}
