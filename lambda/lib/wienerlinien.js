'use strict';

// Echtzeit-Monitor der Wiener Linien
// Doku: https://www.wienerlinien.at/ogd_realtime/doku/ogd/wienerlinien-ogd-dokumentation.pdf

const https = require('https');
const { normalize } = require('./text');

const MONITOR_URL = 'https://www.wienerlinien.at/ogd_realtime/monitor';
const TIMEOUT_MS = 4000; // Alexa wartet max. 8 Sekunden auf den Skill

class WienerLinienError extends Error {}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new WienerLinienError(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new WienerLinienError('Antwort nicht lesbar')); }
      });
    });
    req.on('error', (e) => reject(new WienerLinienError(e.message)));
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new WienerLinienError('Zeitüberschreitung')));
  });
}

// Holt die Abfahrten für alle RBLs in einer Anfrage und liefert sie flach:
// [{ rbl, lineId, name, towards, richtungsId, countdowns, realtime }]
async function fetchMonitor(rbls, getJson = httpGetJson) {
  const unique = [...new Set(rbls.map(Number))].filter(Boolean);
  if (!unique.length) return [];
  const params = new URLSearchParams();
  unique.forEach((r) => params.append('rbl', String(r)));
  const data = await getJson(`${MONITOR_URL}?${params}`);
  const monitors = data && data.data && data.data.monitors;
  if (!Array.isArray(monitors)) {
    const code = data && data.message && data.message.messageCode;
    // 312/322 = RBL unbekannt bzw. keine Daten: das ist kein Fehler, nur leer
    if (code === 312 || code === 322) return [];
    throw new WienerLinienError(`Monitor-Antwort ohne Daten (Code ${code})`);
  }
  const entries = [];
  for (const m of monitors) {
    const rbl = Number(m.locationStop && m.locationStop.properties && m.locationStop.properties.attributes
      && m.locationStop.properties.attributes.rbl);
    for (const l of m.lines || []) {
      const deps = (l.departures && l.departures.departure) || [];
      const countdowns = [];
      let realtime = 0;
      for (const d of deps) {
        const t = d.departureTime || {};
        if (typeof t.countdown === 'number') countdowns.push(t.countdown);
        if (t.timeReal) realtime += 1;
      }
      entries.push({
        rbl,
        lineId: Number(l.lineId),
        name: l.name,
        towards: (l.towards || '').trim(),
        richtungsId: Number(l.richtungsId),
        countdowns,
        realtime,
      });
    }
  }
  return entries;
}

// Wählt aus den Monitor-Einträgen die zur gespeicherten Linie/Richtung.
//
// Fallstricke in den Echtzeitdaten:
//  - An manchen Steigen meldet die API dieselbe Linie zweimal mit gleichem
//    Ziel, aber unterschiedlicher richtungsId (z.B. Badner Bahn an der
//    Aßmayergasse, einmal mit Echtzeit, einmal nur Fahrplan). Wir nehmen
//    pro Steig und Ziel den Eintrag mit den meisten Echtzeitdaten.
//  - Ein Steig kann laut Fahrplan beide Richtungen bedienen (Depotfahrten),
//    deshalb wird immer zusätzlich nach richtungsId gefiltert.
//  - Ist dir null, wird nicht nach Richtung gefiltert.
function selectEntries(entries, { lineId, dir, rbls, lineName }) {
  const rblSet = new Set((rbls || []).map(Number));
  const candidates = entries.filter((e) => (!rblSet.size || rblSet.has(e.rbl))
    && (e.lineId === Number(lineId) || (!e.lineId && lineName && e.name === lineName)));
  let selected = candidates;
  if (dir && candidates.some((e) => e.richtungsId)) {
    const towardsForDir = new Set(candidates.filter((e) => e.richtungsId === dir).map((e) => normalize(e.towards)));
    selected = candidates.filter((e) => e.richtungsId === dir || towardsForDir.has(normalize(e.towards)));
  }
  const best = new Map();
  for (const e of selected) {
    const key = `${e.rbl}|${normalize(e.towards)}`;
    const current = best.get(key);
    if (!current || e.realtime > current.realtime) best.set(key, e);
  }
  return [...best.values()];
}

function countdownsFor(entries, favorite) {
  const chosen = selectEntries(entries, favorite);
  const all = chosen.flatMap((e) => e.countdowns);
  return [...new Set(all)].sort((a, b) => a - b);
}

module.exports = { fetchMonitor, selectEntries, countdownsFor, httpGetJson, WienerLinienError, MONITOR_URL };
