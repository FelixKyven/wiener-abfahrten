'use strict';

// Zugriff auf das Liniennetz (lambda/data/network.json, erzeugt von
// tools/build-data.js): Haltestellen und Linien finden, Namen für die
// Sprachausgabe aufbereiten.

const network = require('../data/network.json');
const { normalize, speakable, expandAbbreviations } = require('./text');

const BUS_TYPES = new Set(['ptBusCity', 'ptBusNight', 'ptRufBus']);

const TYPE_LABELS = {
  ptMetro: { name: 'U-Bahn', masculine: false },
  ptTram: { name: 'Straßenbahn', masculine: false },
  ptTramWLB: { name: 'Badner Bahn', masculine: false },
  ptBusCity: { name: 'Bus', masculine: true },
  ptBusNight: { name: 'Nachtbus', masculine: true },
  ptRufBus: { name: 'Rufbus', masculine: true },
  ptTrainS: { name: 'S-Bahn', masculine: false },
};

// ---------- Linien ----------

const lineIdsByText = new Map();
for (const [id, line] of Object.entries(network.lines)) {
  const key = normalize(line.name).replace(/ /g, '');
  if (!lineIdsByText.has(key)) lineIdsByText.set(key, []);
  lineIdsByText.get(key).push(Number(id));
}

function getLine(lineId) {
  const line = network.lines[String(lineId)];
  return line ? { id: Number(lineId), ...line } : null;
}

function lineIdsForText(text) {
  return lineIdsByText.get(normalize(text).replace(/ /g, '')) || [];
}

// Wie die Linie gesprochen wird, ohne Artikel: "62", "U6", "Linie D", "Badner Bahn"
function lineSpoken(lineId) {
  const line = getLine(lineId);
  if (!line) return 'unbekannte Linie';
  if (line.type === 'ptTramWLB') return 'Badner Bahn';
  if (/^[A-Z]+$/.test(line.name)) return `Linie ${line.name}`;
  return line.name;
}

function isMasculine(lineId) {
  const line = getLine(lineId);
  return Boolean(line && BUS_TYPES.has(line.type));
}

const ARTICLES = {
  nom: ['die', 'der'],
  acc: ['die', 'den'],
  dat: ['der', 'dem'],
};

// "die 62", "den 59A", "der U6" …
function lineWithArticle(lineId, grammaticalCase = 'nom') {
  const [fem, masc] = ARTICLES[grammaticalCase];
  return `${isMasculine(lineId) ? masc : fem} ${lineSpoken(lineId)}`;
}

function pronoun(lineId, grammaticalCase = 'acc') {
  if (grammaticalCase === 'nom') return isMasculine(lineId) ? 'er' : 'sie';
  return isMasculine(lineId) ? 'ihn' : 'sie';
}

function typeLabel(type) {
  return TYPE_LABELS[type] || { name: 'Linie', masculine: false };
}

function typeWithArticle(type, grammaticalCase = 'nom') {
  const label = typeLabel(type);
  const [fem, masc] = ARTICLES[grammaticalCase];
  return `${label.masculine ? masc : fem} ${label.name}`;
}

// Gehört eine Linie zu einem Typ? Die Badner Bahn zählt auch als Straßenbahn,
// Nachtbusse auch als Bus.
function lineMatchesType(lineId, type) {
  const line = getLine(lineId);
  if (!line) return false;
  if (line.type === type) return true;
  if (type === 'ptTram' && line.type === 'ptTramWLB') return true;
  if (type === 'ptBusCity' && BUS_TYPES.has(line.type)) return true;
  return false;
}

// ---------- Haltestellen ----------

function stationKeys(name) {
  const expanded = expandAbbreviations(name);
  const keys = new Set([normalize(name), normalize(speakable(name))]);
  const parts = expanded.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) keys.add(normalize(`${parts[1]} ${parts[0]}`));
  return [...keys];
}

const stationIndex = Object.keys(network.stations).map((name) => {
  const keys = stationKeys(name);
  return { name, keys, tokens: new Set(keys.join(' ').split(' ')) };
});

function getStation(name) {
  const station = network.stations[name];
  return station ? { name, routes: station.routes } : null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

function exactStations(query) {
  const q = normalize(query);
  if (!q) return [];
  return stationIndex.filter((s) => s.keys.includes(q)).map((s) => s.name);
}

// Sucht Haltestellen zu einem gesprochenen Namen. Liefert die besten Treffer,
// sortiert nach Qualität. Exakte Treffer gewinnen immer.
function findStations(query, limit = 5) {
  const q = normalize(query);
  if (!q) return [];
  const exact = exactStations(query);
  if (exact.length) return exact;

  const qTokens = q.split(' ');
  const scored = [];
  for (const s of stationIndex) {
    // alle gesagten Wörter kommen im Namen vor ("meidling" -> "Bhf. Meidling")
    const allTokens = qTokens.every((t) => [...s.tokens].some((st) => st === t || (t.length >= 4 && st.startsWith(t))));
    if (allTokens) {
      scored.push({ name: s.name, score: 2 - s.tokens.size / 100 });
      continue;
    }
    // Tippfehler / Aussprache: ähnlicher Gesamtname
    let best = 0;
    for (const key of s.keys) {
      const sim = 1 - levenshtein(q, key) / Math.max(q.length, key.length);
      if (sim > best) best = sim;
    }
    if (best >= 0.8) scored.push({ name: s.name, score: best });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.name);
}

function stationSpoken(name) {
  return speakable(name);
}

// Ziel einer Fahrt; Orte außerhalb Wiens mit Ortsname ("Josefsplatz in Baden")
function destinationSpoken(name) {
  const town = network.towns && network.towns[name];
  const spoken = speakable(name);
  if (!town) return spoken;
  const short = town.replace(/ bei Wien$/, '');
  return normalize(spoken).includes(normalize(short)) ? spoken : `${spoken} in ${short}`;
}

// Linien, die an einer Haltestelle fahren (eindeutig, in Netz-Reihenfolge)
function linesAtStation(name, { mainOnly = false } = {}) {
  const station = getStation(name);
  if (!station) return [];
  const ids = [];
  for (const r of station.routes) {
    if (mainOnly && !r.main) continue;
    if (!ids.includes(r.line)) ids.push(r.line);
  }
  return ids;
}

function routesFor(stationName, lineId) {
  const station = getStation(stationName);
  if (!station) return [];
  return station.routes.filter((r) => r.line === Number(lineId));
}

function allRbls(stationName) {
  const station = getStation(stationName);
  if (!station) return [];
  return [...new Set(station.routes.flatMap((r) => r.rbls))];
}

module.exports = {
  network,
  getLine,
  lineIdsForText,
  lineSpoken,
  lineWithArticle,
  pronoun,
  isMasculine,
  typeLabel,
  typeWithArticle,
  lineMatchesType,
  getStation,
  exactStations,
  findStations,
  stationSpoken,
  destinationSpoken,
  linesAtStation,
  routesFor,
  allRbls,
  levenshtein,
};
