'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const text = require('../lambda/lib/text');
const net = require('../lambda/lib/network');
const speech = require('../lambda/lib/speech');
const wl = require('../lambda/lib/wienerlinien');
const { lineSynonyms } = require('../tools/build-data');

test('Abkürzungen und Sprechnamen', () => {
  assert.equal(text.expandAbbreviations('Bhf. Meidling'), 'Bahnhof Meidling');
  assert.equal(text.expandAbbreviations('Wolfgang-Mühlwanger-Str.'), 'Wolfgang-Mühlwanger-Straße');
  assert.equal(text.expandAbbreviations('Schemmerlstraße, Hasenleiteng.'), 'Schemmerlstraße, Hasenleitengasse');
  assert.equal(text.expandAbbreviations('Unter St. Veit'), 'Unter Sankt Veit');
  assert.equal(text.speakable('Oper, Karlsplatz U'), 'Oper Karlsplatz');
  assert.equal(text.speakable('Quartier Belvedere S'), 'Quartier Belvedere');
  assert.equal(text.normalize('Aßmayergasse'), 'assmayergasse');
});

test('Zahlen als Wörter', () => {
  assert.equal(text.numberToWords(62), 'zweiundsechzig');
  assert.equal(text.numberToWords(21), 'einundzwanzig');
  assert.equal(text.numberToWords(13), 'dreizehn');
  assert.equal(text.numberToOrdinalNoun(1), 'einser');
  assert.equal(text.numberToOrdinalNoun(62), 'zweiundsechziger');
});

test('Synonyme für Linien', () => {
  assert.ok(lineSynonyms('62', 'ptTram').synonyms.includes('zweiundsechziger'));
  assert.ok(lineSynonyms('U6', 'ptMetro').synonyms.includes('u sechs'));
  assert.ok(lineSynonyms('59A', 'ptBusCity').synonyms.includes('neunundfünfzig a'));
  assert.equal(lineSynonyms('LB', 'ptTramWLB').value, 'badner bahn');
});

test('Haltestellensuche', () => {
  assert.deepEqual(net.findStations('bahnhof meidling'), ['Bhf. Meidling']);
  assert.deepEqual(net.findStations('Aßmayergasse'), ['Aßmayergasse']);
  assert.deepEqual(net.findStations('karlsplatz oper'), ['Oper, Karlsplatz']);
  assert.deepEqual(net.findStations('asmayergasse'), ['Aßmayergasse']); // Tippfehler
  assert.ok(net.findStations('meidling').length > 1);
  assert.deepEqual(net.findStations('gibtsnichtstrasse'), []);
});

test('Hauptlinien an der Aßmayergasse (ohne Depotfahrten)', () => {
  const main = net.linesAtStation('Aßmayergasse', { mainOnly: true }).map((id) => net.getLine(id).name);
  assert.ok(main.includes('62'));
  assert.ok(main.includes('59A'));
  assert.ok(main.includes('LB'));
  assert.ok(!main.includes('1'));
  assert.ok(!main.includes('6'));
  assert.ok(!main.includes('18'));
});

test('Artikel und Namen von Linien', () => {
  const id = (name) => net.lineIdsForText(name)[0];
  assert.equal(net.lineWithArticle(id('62')), 'die 62');
  assert.equal(net.lineWithArticle(id('59A'), 'acc'), 'den 59A');
  assert.equal(net.lineWithArticle(id('U6'), 'dat'), 'der U6');
  assert.equal(net.lineWithArticle(id('LB')), 'die Badner Bahn');
  assert.equal(net.lineWithArticle(id('D')), 'die Linie D');
  assert.equal(net.destinationSpoken('Josefsplatz'), 'Josefsplatz in Baden');
});

test('Minuten-Text', () => {
  assert.equal(speech.minutesText([3, 11, 19, 30]), 'in 3, 11 und 19 Minuten');
  assert.equal(speech.minutesText([1]), 'in 1 Minute');
  assert.equal(speech.minutesText([0]), 'jetzt');
  assert.equal(speech.minutesText([0, 5]), 'jetzt, dann in 5 Minuten');
  assert.equal(speech.minutesText([0, 5, 9]), 'jetzt, dann in 5 und 9 Minuten');
});

test('Auswahl der Echtzeit-Einträge nach Linie und Richtung', () => {
  const entries = [
    { rbl: 1748, lineId: 162, towards: 'Oper', richtungsId: 2, countdowns: [4, 13], realtime: 2 },
    { rbl: 1718, lineId: 162, towards: 'Lainz', richtungsId: 1, countdowns: [1, 9], realtime: 2 },
    { rbl: 1748, lineId: 399, towards: 'Wien Oper', richtungsId: 1, countdowns: [2, 12], realtime: 2 },
    { rbl: 1748, lineId: 399, towards: 'Wien Oper', richtungsId: 2, countdowns: [4, 19], realtime: 0 },
  ];
  assert.deepEqual(wl.countdownsFor(entries, { lineId: 162, dir: 2, rbls: [1718, 1748] }), [4, 13]);
  assert.deepEqual(wl.countdownsFor(entries, { lineId: 162, dir: 1, rbls: [1718, 1748] }), [1, 9]);
  assert.deepEqual(wl.countdownsFor(entries, { lineId: 162, dir: null, rbls: [1718, 1748] }), [1, 4, 9, 13]);
  assert.deepEqual(wl.countdownsFor(entries, { lineId: 399, dir: 2, rbls: [1748] }), [2, 12]);
  // Richtung ohne Daten -> leer (nicht die Gegenrichtung ansagen)
  assert.deepEqual(wl.countdownsFor(entries.slice(1, 2), { lineId: 162, dir: 2, rbls: [1718, 1748] }), []);
});

test('Monitor-Antwort parsen', async () => {
  const fake = async (url) => {
    assert.match(url, /rbl=1748&rbl=1693/);
    return {
      data: {
        monitors: [{
          locationStop: { properties: { attributes: { rbl: 1748 } } },
          lines: [{
            name: '62', towards: 'Oper, Karlsplatz U', richtungsId: '2', lineId: 162,
            departures: { departure: [{ departureTime: { countdown: 3, timeReal: 'x' } }, { departureTime: { countdown: 11 } }] },
          }],
        }],
      },
      message: { messageCode: 1 },
    };
  };
  const entries = await wl.fetchMonitor([1748, 1693, 1748], fake);
  assert.deepEqual(entries, [{ rbl: 1748, lineId: 162, name: '62', towards: 'Oper, Karlsplatz U', richtungsId: 2, countdowns: [3, 11], realtime: 1 }]);
  assert.deepEqual(await wl.fetchMonitor([], fake), []);
  await assert.rejects(wl.fetchMonitor([1], async () => ({ message: { messageCode: 311 } })));
});

test('Interaction Model ist gültig aufgebaut', () => {
  const model = require('../skill-package/interactionModels/custom/de-DE.json').interactionModel;
  const lm = model.languageModel;
  assert.equal(lm.invocationName, 'wiener abfahrten');
  const types = new Map(lm.types.map((t) => [t.name, t]));
  assert.ok(types.get('STOP_NAME').values.length > 1000);
  assert.ok(types.get('LINE_NAME').values.length > 100);
  const allValues = new Set();
  for (const t of lm.types) {
    for (const v of t.values) {
      for (const s of [v.name.value, ...(v.name.synonyms || [])]) {
        assert.match(s, /^[\p{L}\p{N} ]+$/u, `ungültiger Slot-Wert "${s}"`);
        const key = `${t.name}:${s}`;
        assert.ok(!allValues.has(key), `doppelter Slot-Wert ${key}`);
        allValues.add(key);
      }
    }
  }
  for (const intent of lm.intents) {
    const slotNames = new Set((intent.slots || []).map((s) => s.name));
    for (const sample of intent.samples) {
      assert.doesNotMatch(sample, /\d/, `Ziffern in "${sample}"`);
      assert.doesNotMatch(sample, /[^\p{L} {}]/u, `Sonderzeichen in "${sample}"`);
      for (const [, slot] of sample.matchAll(/\{(\w+)\}/g)) assert.ok(slotNames.has(slot), `${intent.name}: Slot ${slot} fehlt`);
    }
  }
  const samples = lm.intents.flatMap((i) => i.samples.map((s) => [s, i.name]));
  const seen = new Map();
  for (const [s, name] of samples) {
    assert.ok(!seen.has(s), `"${s}" in ${name} und ${seen.get(s)}`);
    seen.set(s, name);
  }
});
