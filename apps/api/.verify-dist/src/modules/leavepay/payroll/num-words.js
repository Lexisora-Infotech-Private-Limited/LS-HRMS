"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get numberToWordsIndian () {
        return numberToWordsIndian;
    },
    get rupeesInWords () {
        return rupeesInWords;
    }
});
/** Indian-system amount in words: 78420 → "Seventy-eight thousand four hundred and twenty rupees only". */ const ONES = [
    '',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen'
];
const TENS = [
    '',
    '',
    'twenty',
    'thirty',
    'forty',
    'fifty',
    'sixty',
    'seventy',
    'eighty',
    'ninety'
];
function twoDigits(n) {
    if (n < 20) return ONES[n];
    const t = TENS[Math.floor(n / 10)];
    return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}
function threeDigits(n, withAnd) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const parts = [];
    if (h) parts.push(`${ONES[h]} hundred`);
    if (rest) parts.push((h || withAnd ? 'and ' : '') + twoDigits(rest));
    return parts.join(' ');
}
function numberToWordsIndian(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'zero';
    const crore = Math.floor(n / 1_00_00_000);
    const lakh = Math.floor(n % 1_00_00_000 / 1_00_000);
    const thousand = Math.floor(n % 1_00_000 / 1000);
    const rest = n % 1000;
    const parts = [];
    if (crore) parts.push(`${numberToWordsIndian(crore)} crore`);
    if (lakh) parts.push(`${twoDigits(lakh)} lakh`);
    if (thousand) parts.push(`${twoDigits(thousand)} thousand`);
    if (rest) parts.push(threeDigits(rest, parts.length > 0 && rest < 100));
    return parts.join(' ');
}
function rupeesInWords(paise) {
    const rupees = Math.floor(Math.abs(paise) / 100);
    const p = Math.abs(paise) % 100;
    let s = numberToWordsIndian(rupees) + ' rupees';
    if (p) s += ` and ${twoDigits(p)} paise`;
    s += ' only';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

//# sourceMappingURL=num-words.js.map