#!/usr/bin/env node
'use strict';

// Baut aus den offenen Stammdaten der Wiener Linien:
//   1. lambda/data/network.json  – welche Linie an welcher Haltestelle in
//      welche Richtung fährt, inkl. RBL-Nummern (Steig-IDs)
//   2. die Slot-Typen STOP_NAME und LINE_NAME im Interaction Model,
//      damit Alexa alle Haltestellen- und Liniennamen versteht.
//
// Aufruf (nach jedem Fahrplanwechsel sinnvoll):
//   node tools/build-data.js
//
// Datenquelle: Wiener Linien – data.gv.at, CC BY 4.0

const fs = require('fs');
const path = require('path');
const { expandAbbreviations, speakable, slotSafe, numberToWords, numberToOrdinalNoun } = require('../lambda/lib/text');

const BASE = 'https://www.wienerlinien.at/ogd_realtime/doku/ogd/';
const ROOT = path.join(__dirname, '..');
const NETWORK_FILE = path.join(ROOT, 'lambda', 'data', 'network.json');
const MODEL_FILE = path.join(ROOT, 'skill-package', 'interactionModels', 'custom', 'de-DE.json');
const MAIN_ROUTE_SHARE = 0.3;

async function fetchCsv(name) {
  const res = await fetch(`${BASE}wienerlinien-ogd-${name}.csv`);
  if (!res.ok) throw new Error(`${name}.csv -> HTTP ${res.status}`);
  const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split(';').map((h) => h.trim());
  return lines.map((line) => {
    const cols = line.split(';');
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] ?? '').trim(); });
    return row;
  });
}

function buildNetwork({ haltestellen, haltepunkte, linien, fahrwege }) {
  const stationNameByDiva = new Map(haltestellen.map((s) => [s.DIVA, s.PlatformText]));
  const townByName = new Map(haltestellen.filter((s) => s.Municipality && s.Municipality !== 'Wien')
    .map((s) => [s.PlatformText, s.Municipality]));
  const stationByRbl = new Map();
  for (const p of haltepunkte) {
    const name = stationNameByDiva.get(p.DIVA);
    if (name && p.StopID) stationByRbl.set(p.StopID, name);
  }

  const lines = {};
  for (const l of linien) {
    if (l.Realtime !== '1') continue; // ohne Echtzeit liefert der Monitor nichts
    lines[l.LineID] = { name: l.LineText, type: l.MeansOfTransport, sort: Number(l.SortingHelp) || 9999 };
  }

  // Fahrwege: (Linie, Pattern) -> geordnete Haltepunkte
  const patterns = new Map();
  for (const f of fahrwege) {
    if (!lines[f.LineID]) continue;
    const key = `${f.LineID}|${f.PatternID}`;
    if (!patterns.has(key)) patterns.set(key, { line: f.LineID, dir: Number(f.Direction), stops: [] });
    patterns.get(key).stops.push({ seq: Number(f.StopSeqCount), rbl: f.StopID });
  }

  // (Station, Linie, Richtung) -> RBLs, Anzahl Fahrwege, mögliche Endstationen
  const routes = new Map();
  const maxPatterns = new Map(); // (Linie, Richtung) -> meistbediente Station
  for (const p of patterns.values()) {
    p.stops.sort((a, b) => a.seq - b.seq);
    const terminal = stationByRbl.get(p.stops[p.stops.length - 1].rbl);
    if (!terminal) continue;
    const seen = new Set();
    for (const stop of p.stops.slice(0, -1)) {
      const station = stationByRbl.get(stop.rbl);
      if (!station || station === terminal) continue;
      const key = `${station}|${p.line}|${p.dir}`;
      if (!routes.has(key)) {
        routes.set(key, { station, line: p.line, dir: p.dir, rbls: new Set(), patterns: 0, terminals: new Map() });
      }
      const r = routes.get(key);
      r.rbls.add(Number(stop.rbl));
      if (seen.has(station)) continue;
      seen.add(station);
      r.patterns += 1;
      const lineDir = `${p.line}|${p.dir}`;
      maxPatterns.set(lineDir, Math.max(maxPatterns.get(lineDir) || 0, r.patterns));
      const t = r.terminals.get(terminal) || { count: 0, length: 0 };
      t.count += 1;
      t.length = Math.max(t.length, p.stops.length);
      r.terminals.set(terminal, t);
    }
  }

  const stations = {};
  for (const r of routes.values()) {
    // Endstation = die, zu der die meisten Fahrten dieser Richtung fahren
    const [to] = [...r.terminals.entries()]
      .sort((a, b) => b[1].count - a[1].count || b[1].length - a[1].length)[0];
    // Haltestellen, die nur von wenigen Fahrwegen der Linie bedient werden,
    // sind meist Depot- oder Umleitungsfahrten. Die bleiben auswählbar,
    // werden beim Aufzählen aber nicht genannt.
    const main = r.patterns >= MAIN_ROUTE_SHARE * maxPatterns.get(`${r.line}|${r.dir}`);
    if (!stations[r.station]) stations[r.station] = { routes: [] };
    const route = { line: Number(r.line), dir: r.dir, to, rbls: [...r.rbls].sort((a, b) => a - b) };
    if (main) route.main = true;
    stations[r.station].routes.push(route);
  }
  for (const s of Object.values(stations)) {
    s.routes.sort((a, b) => lines[a.line].sort - lines[b.line].sort || a.dir - b.dir);
  }

  const sortedStations = {};
  for (const name of Object.keys(stations).sort((a, b) => a.localeCompare(b, 'de'))) {
    sortedStations[name] = stations[name];
  }
  // Orte außerhalb Wiens, damit "Richtung Josefsplatz" zu "Josefsplatz in Baden" wird
  const towns = {};
  for (const s of Object.values(stations)) {
    for (const r of s.routes) if (townByName.has(r.to)) towns[r.to] = townByName.get(r.to);
  }

  const usedLines = new Set(Object.values(stations).flatMap((s) => s.routes.map((r) => String(r.line))));
  const sortedLines = {};
  for (const id of Object.keys(lines).filter((id) => usedLines.has(id)).sort((a, b) => lines[a].sort - lines[b].sort)) {
    sortedLines[id] = lines[id];
  }

  return {
    generated: new Date().toISOString().slice(0, 10),
    source: 'Wiener Linien – data.gv.at, CC BY 4.0',
    lines: sortedLines,
    stations: sortedStations,
    towns,
  };
}

function stationSlotValues(network) {
  const used = new Set();
  const values = [];
  const take = (s) => {
    if (!s || used.has(s)) return null;
    used.add(s);
    return s;
  };
  for (const name of Object.keys(network.stations)) {
    const expanded = expandAbbreviations(name);
    const main = take(slotSafe(expanded));
    if (!main) continue;
    const variants = [slotSafe(speakable(name))];
    const parts = expanded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) variants.push(slotSafe(`${parts[1]} ${parts[0]}`));
    const synonyms = variants.map(take).filter(Boolean);
    values.push({ id: name, name: synonyms.length ? { value: main, synonyms } : { value: main } });
  }
  return values;
}

const TYPE_VALUES = [
  { id: 'TYPE:ptMetro', value: 'u bahn', synonyms: ['ubahn', 'u bahnen', 'metro'] },
  { id: 'TYPE:ptTram', value: 'straßenbahn', synonyms: ['strassenbahn', 'bim', 'tram', 'straßenbahnen'] },
  { id: 'TYPE:ptBusCity', value: 'bus', synonyms: ['autobus', 'busse', 'stadtbus'] },
  { id: 'TYPE:ptBusNight', value: 'nachtbus', synonyms: ['nightline', 'nachtbusse'] },
  { id: 'TYPE:ptTrainS', value: 's bahn', synonyms: ['schnellbahn', 'sbahn', 'zug', 'regionalzug'] },
];

function lineSynonyms(text, type) {
  if (type === 'ptTramWLB') {
    return { value: 'badner bahn', synonyms: ['badnerbahn', 'lokalbahn', 'wiener lokalbahn', 'wlb', 'lb'] };
  }
  const m = /^([A-Z]*)(\d+)([A-Z]*)$/.exec(text);
  const lower = text.toLowerCase();
  if (!m) {
    // Buchstaben-Linien wie D oder O
    return { value: lower, synonyms: [`linie ${lower}`, `${lower} wagen`, `${lower}wagen`] };
  }
  const [, prefix, digits, suffix] = m;
  const n = Number(digits);
  const p = prefix.toLowerCase();
  const s = suffix.toLowerCase();
  const word = numberToWords(n);
  const noun = numberToOrdinalNoun(n);
  const join = (...xs) => xs.filter(Boolean).join(' ');
  const syn = [
    join(p, digits, s),
    join(p, word, s),
    `linie ${join(p, digits, s)}`,
    `linie ${join(p, word, s)}`,
  ];
  if (!p) syn.push(join(noun, s));
  if (p === 'u') syn.push(`u bahn ${word}`, `u bahn linie ${word}`);
  if (p === 'n') syn.push(`nachtbus ${join(p, word, s)}`);
  if (type === 'ptBusCity' || type === 'ptBusNight') syn.push(`bus ${join(p, word, s)}`);
  return { value: lower, synonyms: syn.map(slotSafe) };
}

function lineSlotValues(network) {
  const used = new Set();
  const values = [];
  const take = (s) => {
    if (!s || used.has(s)) return null;
    used.add(s);
    return s;
  };
  const byText = new Map();
  for (const l of Object.values(network.lines)) {
    if (!byText.has(l.name)) byText.set(l.name, l.type);
  }
  for (const [text, type] of byText) {
    const { value, synonyms } = lineSynonyms(text, type);
    const main = take(slotSafe(value));
    if (!main) continue;
    values.push({ id: `LINE:${text}`, name: { value: main, synonyms: synonyms.map(take).filter(Boolean) } });
  }
  for (const t of TYPE_VALUES) {
    const main = take(t.value);
    if (!main) continue;
    values.push({ id: t.id, name: { value: main, synonyms: t.synonyms.map(take).filter(Boolean) } });
  }
  return values;
}

async function main() {
  console.log('Lade Stammdaten der Wiener Linien …');
  const [haltestellen, haltepunkte, linien, fahrwege] = await Promise.all([
    fetchCsv('haltestellen'),
    fetchCsv('haltepunkte'),
    fetchCsv('linien'),
    fetchCsv('fahrwegverlaeufe'),
  ]);

  const network = buildNetwork({ haltestellen, haltepunkte, linien, fahrwege });
  fs.writeFileSync(NETWORK_FILE, JSON.stringify(network));
  const stationCount = Object.keys(network.stations).length;
  const lineCount = Object.keys(network.lines).length;
  console.log(`network.json: ${stationCount} Haltestellen, ${lineCount} Linien`);

  const model = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
  model.interactionModel.languageModel.types = [
    { name: 'STOP_NAME', values: stationSlotValues(network) },
    { name: 'LINE_NAME', values: lineSlotValues(network) },
  ];
  fs.writeFileSync(MODEL_FILE, JSON.stringify(model, null, 2) + '\n');
  console.log('Interaction Model: Slot-Typen STOP_NAME und LINE_NAME aktualisiert');
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { buildNetwork, stationSlotValues, lineSlotValues, lineSynonyms };
