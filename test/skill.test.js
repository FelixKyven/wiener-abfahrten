'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { conversation, fakeMonitor } = require('./helpers');

async function setup62(c) {
  await c.launch();
  await c.answer('aßmayergasse');
  await c.answer('62');
  return c.answer('oper');
}

test('Erster Start: Skill fragt direkt nach der Haltestelle', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  const r = await c.launch();
  assert.match(r.text, /Willkommen bei Wiener Abfahrten/);
  assert.equal(r.elicit, 'stop');
  assert.equal(r.intent.name, 'AddFavoriteIntent');
});

test('Einrichtung: Haltestelle -> Linie -> Richtung -> gespeichert', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  await c.launch();

  let r = await c.answer('aßmayergasse');
  assert.equal(r.elicit, 'line');
  assert.match(r.text, /62, die Badner Bahn, 59A und N8/);
  // Depotfahrten der Linien 1, 6 und 18 werden nicht aufgezählt
  assert.doesNotMatch(r.text, /\b(1|6|18),/);

  r = await c.answer('62');
  assert.equal(r.elicit, 'direction');
  assert.match(r.text, /Richtung Lainz Wolkersbergenstraße oder Richtung Oper Karlsplatz/);

  r = await c.answer('oper');
  assert.match(r.text, /Gespeichert: die 62 an der Haltestelle Aßmayergasse Richtung Oper Karlsplatz/);
  assert.match(r.text, /frag Wiener Abfahrten, wann kommt die 62/);
  assert.equal(c.session.state, 'ASK_MORE');

  r = await c.intent('AMAZON.NoIntent');
  assert.equal(r.ended, true);
});

test('Abfahrten einer gespeicherten Linie', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  await setup62(c);
  const r = await c.intent('DepartureIntent', { line: '62' });
  assert.equal(r.text, 'Die 62 fährt in 4, 13 und 24 Minuten.');
  assert.equal(r.ended, true);
});

test('Linie, Haltestelle und Richtung in einem Satz', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  const r = await c.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: '59a', direction: 'oper' });
  assert.match(r.text, /Gespeichert: der 59A an der Haltestelle Aßmayergasse Richtung Oper Karlsplatz/);
});

test('Richtung per Ordnungszahl ("die zweite")', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  let r = await c.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: '59a' });
  assert.equal(r.elicit, 'direction');
  r = await c.answer('die zweite');
  assert.match(r.text, /Gespeichert: der 59A/);
});

test('Badner Bahn: doppelte Einträge der API werden zusammengeführt', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  await c.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: 'badner bahn', direction: 'oper' });
  const r = await c.intent('DepartureIntent', { line: 'badner bahn' });
  // Der Eintrag mit Echtzeitdaten gewinnt
  assert.equal(r.text, 'Die Badner Bahn fährt in 2, 4 und 12 Minuten.');
});

test('Alle Abfahrten beim Öffnen, wenn schon Linien gespeichert sind', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  await setup62(c);
  await c.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: '59a', direction: 'oper' });
  const r = await c.launch();
  assert.equal(r.text, 'Die 62 fährt in 4, 13 und 24 Minuten. Der 59A fährt in 1, 12 und 23 Minuten.');
  assert.equal(r.ended, true);
});

test('Verkehrsmittel statt Linie ("wann kommt der bus")', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  await setup62(c);
  await c.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: '59a', direction: 'oper' });
  const r = await c.intent('DepartureIntent', { line: 'bus' });
  assert.equal(r.text, 'Der 59A fährt in 1, 12 und 23 Minuten.');
});

test('Nicht gespeicherte Linie: Skill bietet an, sie hinzuzufügen', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  await setup62(c);
  let r = await c.intent('DepartureIntent', { line: '13a' });
  assert.equal(r.text, 'Den 13A hast du noch nicht gespeichert. Soll ich ihn hinzufügen?');
  r = await c.intent('AMAZON.YesIntent');
  assert.equal(r.elicit, 'stop');
  assert.equal(r.intent.slots.line.value, '13A');
});

test('Mehrdeutige und unbekannte Haltestellen', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  await c.launch();
  let r = await c.answer('meidling');
  assert.match(r.text, /^Meinst du Bahnhof Meidling, .+ oder .+\?$/);
  r = await c.answer('xyzqwert');
  assert.match(r.text, /habe ich nicht gefunden/);
  r = await c.answer('bahnhof meidling');
  assert.equal(r.elicit, 'line');
});

test('Linie hält nicht an der Haltestelle', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  const r = await c.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: 'u6' });
  assert.equal(r.elicit, 'line');
  assert.match(r.text, /^Die U6 hält nicht an dieser Haltestelle/);
});

test('"62er" wird als Linie 62 erkannt', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  const r = await c.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: '62er' });
  assert.equal(r.elicit, 'direction');
});

test('Liste, Löschen und Zurücksetzen', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  await setup62(c);
  await c.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: '59a', direction: 'oper' });

  let r = await c.intent('ListFavoritesIntent');
  assert.match(r.text, /^Du hast 2 Linien gespeichert: die 62 .+ und der 59A .+\.$/);

  r = await c.intent('RemoveFavoriteIntent', { line: '62' });
  assert.equal(r.text, 'Erledigt, die 62 habe ich gelöscht.');

  r = await c.intent('ResetIntent');
  assert.equal(r.text, 'Soll ich wirklich deine gespeicherte Linie löschen?');
  r = await c.intent('AMAZON.YesIntent');
  assert.match(r.text, /alles gelöscht/);

  r = await c.intent('ListFavoritesIntent');
  assert.match(r.text, /noch keine Linien gespeichert/);
});

test('Doppelt speichern wird erkannt', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  await setup62(c);
  const r = await c.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: '62', direction: 'oper' });
  assert.match(r.text, /hast du schon gespeichert/);
});

test('Gleiche Linie an zwei Haltestellen: Haltestelle wird mitgesagt', async () => {
  const monitor = fakeMonitor({
    4615: [{ lineId: 306, name: 'U6', towards: 'Floridsdorf', richtungsId: 1, countdowns: [2, 6], realtime: 2 }],
    470: [{ lineId: 162, name: '62', towards: 'Oper, Karlsplatz U', richtungsId: 2, countdowns: [7], realtime: 1 }],
    477: [],
  });
  const c = conversation({ fetchMonitor: monitor });
  await setup62(c);
  await c.intent('AddFavoriteIntent', { stop: 'bahnhof meidling', line: '62', direction: 'oper' });
  const r = await c.intent('DepartureIntent', { line: '62' });
  assert.equal(r.text, 'Die 62 ab Aßmayergasse fährt in 4, 13 und 24 Minuten. Die 62 ab Bahnhof Meidling fährt in 7 Minuten.');
});

test('Keine Abfahrten und API-Ausfall', async () => {
  const empty = async () => [];
  const c = conversation({ fetchMonitor: empty });
  await c.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: '62', direction: 'oper' });
  let r = await c.intent('DepartureIntent', { line: '62' });
  assert.equal(r.text, 'Von der 62 finde ich gerade keine Abfahrten.');

  const failing = async () => { throw new Error('boom'); };
  const c2 = conversation({ fetchMonitor: failing });
  // Einrichten klappt auch ohne Live-Daten (Fahrplan als Fallback)
  r = await c2.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: '62', direction: 'oper' });
  assert.match(r.text, /Gespeichert/);
  r = await c2.intent('DepartureIntent', { line: '62' });
  assert.match(r.text, /Wiener Linien antworten gerade nicht/);
});

test('S-Bahn wird freundlich abgelehnt', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  await setup62(c);
  const r = await c.intent('DepartureIntent', { line: 's bahn' });
  assert.match(r.text, /S-Bahn-Zeiten bekomme ich von den Wiener Linien leider nicht/);
});

test('Hilfe, Abbrechen, Nicht verstanden', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  let r = await c.intent('AMAZON.HelpIntent');
  assert.match(r.text, /Linie hinzufügen/);
  assert.equal(r.ended, false);
  r = await c.intent('AMAZON.FallbackIntent');
  assert.match(r.text, /nicht verstanden/);
  r = await c.intent('AMAZON.StopIntent');
  assert.equal(r.text, 'Bis bald!');
});

test('Favoriten sind pro Nutzer getrennt', async () => {
  const monitor = fakeMonitor();
  const a = conversation({ fetchMonitor: monitor, userId: 'user-a' });
  await setup62(a);
  const r = await a.intent('ListFavoritesIntent');
  assert.match(r.text, /eine Linie gespeichert/);
  // neuer Gesprächspartner = eigener Speicher, eigener Nutzer
  const b = conversation({ fetchMonitor: monitor, userId: 'user-b' });
  const rb = await b.intent('ListFavoritesIntent');
  assert.match(rb.text, /noch keine Linien/);
});

test('Reine Depotfahrten werden nicht als Linie angenommen', async () => {
  const c = conversation({ fetchMonitor: fakeMonitor() });
  const r = await c.intent('AddFavoriteIntent', { stop: 'aßmayergasse', line: '6' });
  assert.equal(r.elicit, 'line');
  assert.match(r.text, /^Die 6 hält nicht an dieser Haltestelle/);
});

test('Namensauflösung von Alexa (Slot-IDs) wird verstanden', async () => {
  const { createSkill } = require('../lambda/index');
  const { MemoryAdapter } = require('../lambda/lib/persistence');
  const { envelope } = require('./helpers');
  const skill = createSkill({ persistenceAdapter: new MemoryAdapter(), fetchMonitor: fakeMonitor() });
  const resolved = (heard, id) => ({
    value: heard,
    resolutions: { resolutionsPerAuthority: [{ status: { code: 'ER_SUCCESS_MATCH' }, values: [{ value: { name: heard, id } }] }] },
  });
  const res = await skill.invoke(envelope({
    type: 'IntentRequest',
    dialogState: 'STARTED',
    intent: {
      name: 'AddFavoriteIntent',
      confirmationStatus: 'NONE',
      slots: {
        // so wie Alexa es schicken könnte: gehört, aber per ID aufgelöst
        stop: { name: 'stop', confirmationStatus: 'NONE', ...resolved('asmayer gasse', 'S60200103') },
        line: { name: 'line', confirmationStatus: 'NONE', ...resolved('zweiundsechziger', 'LINE_62') },
        direction: { name: 'direction', confirmationStatus: 'NONE', value: 'oper' },
      },
    },
  }));
  assert.match(res.response.outputSpeech.ssml, /Gespeichert: die 62 an der Haltestelle Aßmayergasse/);
});
