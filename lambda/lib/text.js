'use strict';

// Text-Helfer, die sowohl der Skill als auch tools/build-data.js nutzen:
// Abkürzungen der Wiener-Linien-Stammdaten ausschreiben, Namen für den
// Vergleich normalisieren und Zahlen in deutsche Wörter umwandeln.

const ABBREVIATIONS = [
  [/\bBhf\./g, 'Bahnhof'],
  [/\bHbf\./g, 'Hauptbahnhof'],
  [/\bDr\.-?/g, 'Doktor '],
  [/\bSt\.-?\s?/g, 'Sankt '],
  [/([a-zäöüß])str\./g, '$1straße'],
  [/\bStr\./g, 'Straße'],
  [/([a-zäöüß])pl\./g, '$1platz'],
  [/\bPl\./g, 'Platz'],
  [/([a-zäöüß])g\./g, '$1gasse'],
];

function expandAbbreviations(name) {
  let out = String(name || '');
  for (const [pattern, replacement] of ABBREVIATIONS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, ' ').trim();
}

// Name so, wie Alexa ihn vorlesen soll: Abkürzungen aus, Satzzeichen weg,
// U-/S-Bahn-Kürzel ("Karlsplatz U", "Quartier Belvedere S") entfernen.
function speakable(name) {
  return expandAbbreviations(name)
    .replace(/[,/()]/g, ' ')
    .replace(/(^|\s)(S\+U|U\+S|U|S)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Für Vergleiche: klein, ohne Umlaute/ß, ohne Satzzeichen.
function normalize(text) {
  return expandAbbreviations(text)
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Slot-Werte im Interaction Model: nur Buchstaben, Ziffern, Leerzeichen.
function slotSafe(text) {
  return String(text || '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
  'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

function numberToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    if (!ones) return TENS[tens];
    return (ones === 1 ? 'ein' : ONES[ones]) + 'und' + TENS[tens];
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    return (hundreds === 1 ? 'ein' : ONES[hundreds]) + 'hundert' + (rest ? numberToWords(rest) : '');
  }
  return String(n);
}

// "Der Zweiundsechziger", "der Einser" — so sagt man in Wien zu Linien.
function numberToOrdinalNoun(n) {
  return n === 1 ? 'einser' : numberToWords(n) + 'er';
}

module.exports = {
  expandAbbreviations,
  speakable,
  normalize,
  slotSafe,
  numberToWords,
  numberToOrdinalNoun,
};
