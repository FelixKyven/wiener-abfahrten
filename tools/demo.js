#!/usr/bin/env node
'use strict';

// Spielt ein Gespräch mit dem Skill durch – mit echten Live-Daten der
// Wiener Linien, aber ohne Echo und ohne Amazon-Account.
//
// Aufruf:
//   node tools/demo.js "<Haltestelle>" "<Linie>" ["<Richtung>"]
// Beispiel:
//   node tools/demo.js "Aßmayergasse" "62" "Oper"

const { conversation } = require('../test/helpers');
const wl = require('../lambda/lib/wienerlinien');

async function main() {
  const [stop = 'Karlsplatz', line = 'U1', direction] = process.argv.slice(2);
  const c = conversation({ fetchMonitor: wl.fetchMonitor });
  const say = (who, text) => console.log(`${who.padEnd(6)} ${text}`);

  say('Du:', 'Alexa, öffne Wiener Abfahrten');
  let r = await c.launch();
  say('Alexa:', r.text);

  for (const answer of [stop, line, direction]) {
    if (!r.elicit) break;
    const value = answer || '1';
    say('Du:', value);
    r = await c.answer(value);
    say('Alexa:', r.text);
  }
  if (c.session.state === 'ASK_MORE') {
    say('Du:', 'Nein');
    r = await c.intent('AMAZON.NoIntent');
    say('Alexa:', r.text);
  }

  say('Du:', `Alexa, frag Wiener Abfahrten, wann kommt die ${line}`);
  r = await c.intent('DepartureIntent', { line });
  say('Alexa:', r.text);
}

main().catch((e) => { console.error(e); process.exit(1); });
