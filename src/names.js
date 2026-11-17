/**
 * Normalizacja nazw znaków i marek do porównań: wielkie litery, bez znaków diakrytycznych,
 * bez interpunkcji. Oryginalna pisownia zostaje w bazie osobno — to tylko klucz wyszukiwania.
 */

// Litery, których NFKD nie rozkłada na literę bazową + znak diakrytyczny.
const SPECIAL = {
  Ł: 'L', ł: 'L', Ø: 'O', ø: 'O', Đ: 'D', đ: 'D', Ħ: 'H', ħ: 'H',
  ß: 'SS', Æ: 'AE', æ: 'AE', Œ: 'OE', œ: 'OE', Þ: 'TH', þ: 'TH', ı: 'I',
};

export function normalizeName(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[ŁłØøĐđĦħßÆæŒœÞþı]/g, (ch) => SPECIAL[ch])
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
