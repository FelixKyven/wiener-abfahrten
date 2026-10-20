'use strict';

// Wiener Abfahrten – Alexa Skill für Echtzeit-Abfahrten der Wiener Linien.
//
// Jeder Nutzer speichert per Sprache seine Linien ("Favoriten"):
//   Haltestelle -> Linie -> Richtung
// Danach reicht: "Alexa, frag Wiener Abfahrten, wann kommt die 62?"

const Alexa = require('ask-sdk-core');
const net = require('./lib/network');
const speech = require('./lib/speech');
const { normalize, speakable } = require('./lib/text');
const wl = require('./lib/wienerlinien');
const { createDefaultAdapter } = require('./lib/persistence');

const SKILL_NAME = 'Wiener Abfahrten';
const MAX_FAVORITES = 10;
const MAX_LIVE_RBLS = 20;

const INTENT_SLOTS = {
  AddFavoriteIntent: ['stop', 'line', 'direction'],
  RemoveFavoriteIntent: ['line'],
};

const TYPE_WORDS = {
  strassenbahn: 'ptTram', bim: 'ptTram', tram: 'ptTram',
  bus: 'ptBusCity', autobus: 'ptBusCity',
  'u bahn': 'ptMetro', ubahn: 'ptMetro',
  nachtbus: 'ptBusNight',
  's bahn': 'ptTrainS', sbahn: 'ptTrainS', schnellbahn: 'ptTrainS', zug: 'ptTrainS',
};
const WLB_WORDS = new Set(['badner bahn', 'badnerbahn', 'wlb', 'lokalbahn', 'wiener lokalbahn']);
const ORDINALS = { 1: ['1', 'eins', 'erste', 'ersten', 'erstere'], 2: ['2', 'zwei', 'zweite', 'zweiten', 'letztere', 'andere'] };

// ---------- Hilfsfunktionen ----------

function say(text) {
  return speech.escapeSsml(text);
}

function intentName(handlerInput) {
  return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
    ? Alexa.getIntentName(handlerInput.requestEnvelope)
    : null;
}

function isIntent(...names) {
  return (handlerInput) => names.includes(intentName(handlerInput));
}

function session(handlerInput) {
  return handlerInput.attributesManager.getSessionAttributes();
}

function setState(handlerInput, state) {
  handlerInput.attributesManager.setSessionAttributes(state ? { ...state } : {});
}

async function loadFavorites(handlerInput) {
  const attrs = await handlerInput.attributesManager.getPersistentAttributes();
  return Array.isArray(attrs.favorites) ? attrs.favorites : [];
}

async function storeFavorites(handlerInput, favorites) {
  const attrs = await handlerInput.attributesManager.getPersistentAttributes();
  attrs.favorites = favorites;
  attrs.version = 1;
  handlerInput.attributesManager.setPersistentAttributes(attrs);
  await handlerInput.attributesManager.savePersistentAttributes();
}

function buildIntent(name, values = {}) {
  const slots = {};
  for (const slot of INTENT_SLOTS[name] || []) {
    slots[slot] = { name: slot, confirmationStatus: 'NONE' };
    if (values[slot]) slots[slot].value = values[slot];
  }
  return { name, confirmationStatus: 'NONE', slots };
}

function elicit(handlerInput, intent, slotName, text, reprompt) {
  return handlerInput.responseBuilder
    .speak(say(text))
    .reprompt(say(reprompt || text))
    .addElicitSlotDirective(slotName, intent)
    .getResponse();
}

function resolutionIds(slot) {
  const authorities = (slot && slot.resolutions && slot.resolutions.resolutionsPerAuthority) || [];
  for (const a of authorities) {
    if (a.status && a.status.code === 'ER_SUCCESS_MATCH') return a.values.map((v) => v.value.id);
  }
  return [];
}

function resolveStation(slot) {
  const heard = slot && slot.value;
  if (!heard) return { status: 'empty' };
  const pick = (names) => {
    const unique = [...new Set(names)].filter((n) => net.getStation(n));
    if (unique.length === 1) return { status: 'found', station: unique[0], heard };
    if (unique.length > 1) return { status: 'ambiguous', options: unique.slice(0, 3), heard };
    return null;
  };
  return pick(net.exactStations(heard))
    || pick(resolutionIds(slot))
    || pick(net.findStations(heard))
    || { status: 'unknown', heard };
}

function resolveLine(slot) {
  const heard = slot && slot.value;
  if (!heard) return { status: 'empty' };
  for (const id of resolutionIds(slot)) {
    if (id.startsWith('TYPE:')) return { status: 'type', type: id.slice(5), heard };
    if (id.startsWith('LINE:')) {
      const lineIds = net.lineIdsForText(id.slice(5));
      if (lineIds.length) return { status: 'line', lineIds, heard };
    }
  }
  const cleaned = normalize(heard)
    .replace(/^(die |der |den |linie )+/, '')
    .replace(/^(\d+)er( |$)/, '$1$2'); // "62er" -> "62", "13er a" -> "13 a"
  if (WLB_WORDS.has(cleaned)) return { status: 'line', lineIds: net.lineIdsForText('LB'), heard };
  if (TYPE_WORDS[cleaned]) return { status: 'type', type: TYPE_WORDS[cleaned], heard };
  const lineIds = net.lineIdsForText(cleaned);
  if (lineIds.length) return { status: 'line', lineIds, heard };
  return { status: 'unknown', heard };
}

// Linie als Slot-Wert, der beim nächsten Turn wieder eindeutig aufgelöst wird
function lineSlotValue(lineId) {
  const line = net.getLine(lineId);
  return line ? line.name : undefined;
}

function currentRbls(favorite) {
  const routes = net.routesFor(favorite.station, favorite.lineId)
    .filter((r) => !favorite.dir || r.dir === favorite.dir);
  const rbls = [...new Set(routes.flatMap((r) => r.rbls))];
  return rbls.length ? rbls : (favorite.rbls || []);
}

function sameFavorite(a, b) {
  return a.station === b.station && a.lineId === b.lineId && (a.dir || null) === (b.dir || null);
}

// ---------- Abfahrten ansagen ----------

async function departuresResponse(handlerInput, favorites, fetchMonitor) {
  const rbls = [...new Set(favorites.flatMap(currentRbls))];
  let entries;
  try {
    entries = await fetchMonitor(rbls);
  } catch (e) {
    console.error('Wiener Linien Monitor fehlgeschlagen:', e.message);
    return handlerInput.responseBuilder
      .speak(say('Die Wiener Linien antworten gerade nicht. Probier es bitte gleich nochmal.'))
      .withShouldEndSession(true)
      .getResponse();
  }
  const text = favorites.map((f) => {
    const countdowns = wl.countdownsFor(entries, { lineId: f.lineId, dir: f.dir, rbls: currentRbls(f) });
    return speech.departureSentence(f, countdowns, favorites);
  }).join(' ');
  return handlerInput.responseBuilder
    .speak(say(text))
    .withSimpleCard(SKILL_NAME, text)
    .withShouldEndSession(true)
    .getResponse();
}

// ---------- Einrichtung (AddFavoriteIntent) ----------

async function offeredLines(stationName, fetchMonitor) {
  const all = net.linesAtStation(stationName);
  const main = new Set(net.linesAtStation(stationName, { mainOnly: true }));
  let live = new Set();
  try {
    const entries = await fetchMonitor(net.allRbls(stationName).slice(0, MAX_LIVE_RBLS));
    live = new Set(entries.filter((e) => e.countdowns.length).map((e) => e.lineId));
  } catch (e) {
    console.warn('Live-Abfrage beim Einrichten fehlgeschlagen:', e.message);
  }
  const offered = all.filter((id) => main.has(id) || live.has(id));
  return offered.length ? offered : all;
}

// Ziel je Richtung: bevorzugt das, was gerade auf der Anzeige an der
// Haltestelle steht (Echtzeit "towards"), sonst die Endstation laut Fahrplan.
// Liefern beide Richtungen live dasselbe Ziel, nehmen wir den Fahrplan.
async function withDestinations(routes, lineId, fetchMonitor) {
  let live = [];
  if (routes.length > 1) {
    try {
      live = await fetchMonitor([...new Set(routes.flatMap((r) => r.rbls))]);
    } catch (e) {
      console.warn('Live-Ziele nicht verfügbar:', e.message);
    }
  }
  const withLive = routes.map((r) => {
    const entry = live.find((e) => e.lineId === lineId && e.richtungsId === r.dir && r.rbls.includes(e.rbl) && e.towards);
    return entry
      ? { ...r, destination: entry.towards, spoken: speakable(entry.towards) }
      : { ...r, destination: r.to, spoken: net.destinationSpoken(r.to) };
  });
  if (new Set(withLive.map((r) => normalize(r.spoken))).size === withLive.length) return withLive;
  return routes.map((r) => ({ ...r, destination: r.to, spoken: net.destinationSpoken(r.to) }));
}

function matchDirection(heard, routes) {
  if (!heard) return null;
  const q = normalize(heard).replace(/^(richtung|nach|zur|zum|in richtung) /, '');
  for (const [index, words] of Object.entries(ORDINALS)) {
    if (words.includes(q) || words.some((w) => q === `die ${w}` || q === `richtung ${w}`)) return routes[Number(index) - 1] || null;
  }
  const words = q.split(' ').filter((w) => w.length > 2);
  const scored = routes.map((r) => {
    let score = 0;
    for (const name of [r.spoken, net.destinationSpoken(r.to)]) {
      const target = normalize(name).split(' ');
      const hits = words.filter((w) => target.some((t) => t === w || t.startsWith(w))).length;
      score = Math.max(score, words.length ? hits / words.length : 0);
    }
    return { route: r, score };
  }).sort((a, b) => b.score - a.score);
  if (scored[0] && scored[0].score >= 0.5 && (!scored[1] || scored[1].score < scored[0].score)) return scored[0].route;
  return null;
}

async function continueSetup(handlerInput, fetchMonitor) {
  const intent = handlerInput.requestEnvelope.request.intent;
  const slots = intent.slots || {};
  const favorites = await loadFavorites(handlerInput);
  setState(handlerInput, null);

  if (favorites.length >= MAX_FAVORITES) {
    return handlerInput.responseBuilder
      .speak(say(`Du hast schon ${MAX_FAVORITES} Linien gespeichert, mehr gehen nicht. Lösche zuerst eine, zum Beispiel mit: lösche die 62.`))
      .withShouldEndSession(true)
      .getResponse();
  }

  // 1. Haltestelle
  const stop = resolveStation(slots.stop);
  const lineHeard = slots.line && slots.line.value;
  if (stop.status === 'empty') {
    return elicit(handlerInput, buildIntent('AddFavoriteIntent', { line: lineHeard }), 'stop',
      'An welcher Haltestelle steigst du ein?',
      'Sag mir den Namen der Haltestelle, zum Beispiel: Karlsplatz.');
  }
  if (stop.status === 'unknown') {
    return elicit(handlerInput, buildIntent('AddFavoriteIntent', { line: lineHeard }), 'stop',
      `Die Haltestelle ${stop.heard} habe ich nicht gefunden. Sag den Namen bitte nochmal, so wie er auf dem Haltestellenschild steht.`,
      'Wie heißt die Haltestelle?');
  }
  if (stop.status === 'ambiguous') {
    const names = stop.options.map(net.stationSpoken);
    return elicit(handlerInput, buildIntent('AddFavoriteIntent', { line: lineHeard }), 'stop',
      `Meinst du ${speech.listJoin(names, 'oder')}?`,
      `Welche Haltestelle meinst du: ${speech.listJoin(names, 'oder')}?`);
  }
  const station = stop.station;
  const stationSpoken = net.stationSpoken(station);

  // 2. Linie – angeboten (und angenommen) werden Linien, die hier regulär
  // oder gerade live fahren; reine Depotfahrten nicht.
  const line = resolveLine(slots.line);
  let lineId = null;
  let offeredCache = null;
  const getOffered = async () => {
    if (!offeredCache) offeredCache = await offeredLines(station, fetchMonitor);
    return offeredCache;
  };
  const askLine = async (prefix) => {
    const offered = await getOffered();
    return elicit(handlerInput, buildIntent('AddFavoriteIntent', { stop: station }), 'line',
      `${prefix}An der Haltestelle ${stationSpoken} fahren ${speech.linesList(offered)}. Welche Linie möchtest du speichern?`,
      `Welche Linie an der Haltestelle ${stationSpoken} möchtest du speichern?`);
  };
  if (line.status === 'line') {
    const offered = await getOffered();
    lineId = line.lineIds.find((id) => offered.includes(id)) || null;
    if (!lineId) {
      return askLine(`${speech.capitalize(net.lineWithArticle(line.lineIds[0]))} hält nicht an dieser Haltestelle. `);
    }
  } else if (line.status === 'type') {
    const label = net.typeLabel(line.type);
    if (line.type === 'ptTrainS') {
      return askLine('S-Bahn-Zeiten bekomme ich von den Wiener Linien leider nicht. ');
    }
    const offered = await getOffered();
    const ofType = offered.filter((id) => net.lineMatchesType(id, line.type));
    if (ofType.length === 1) {
      lineId = ofType[0];
    } else if (ofType.length > 1) {
      return elicit(handlerInput, buildIntent('AddFavoriteIntent', { stop: station }), 'line',
        `An der Haltestelle ${stationSpoken} fahren mehrere Linien: ${speech.linesList(ofType)}. Welche meinst du?`,
        `Welche Linie meinst du: ${speech.linesList(ofType)}?`);
    } else {
      return askLine(`${label.masculine ? 'Ein' : 'Eine'} ${label.name} finde ich dort nicht. `);
    }
  } else if (line.status === 'unknown') {
    return askLine(`Die Linie ${line.heard} kenne ich nicht. `);
  } else {
    const offered = await getOffered();
    if (offered.length === 1) {
      lineId = offered[0];
    } else {
      return askLine('');
    }
  }

  // 3. Richtung
  const allRoutes = net.routesFor(station, lineId);
  const mainRoutes = allRoutes.filter((r) => r.main);
  const routes = await withDestinations(mainRoutes.length ? mainRoutes : allRoutes, lineId, fetchMonitor);
  let route = null;
  let dir = null;
  if (routes.length === 1) {
    route = routes[0];
    dir = route.dir;
  } else if (routes.length > 1 && new Set(routes.map((r) => r.spoken)).size === 1) {
    route = routes[0]; // beide Richtungen mit gleichem Ziel (Ringlinie): nicht filtern
  } else {
    route = matchDirection(slots.direction && slots.direction.value, routes);
    if (!route) {
      const options = routes.map((r) => `Richtung ${r.spoken}`);
      const lineLabel = net.lineWithArticle(lineId, 'acc');
      return elicit(handlerInput, buildIntent('AddFavoriteIntent', { stop: station, line: lineSlotValue(lineId) }), 'direction',
        `In welche Richtung nimmst du ${lineLabel}? ${speech.listJoin(options, 'oder')}?`,
        `${speech.listJoin(options, 'oder')}?`);
    }
    dir = route.dir;
  }

  // 4. Speichern
  const favorite = {
    station,
    lineId,
    dir,
    to: dir ? route.destination : null,
    rbls: [...new Set(routes.filter((r) => !dir || r.dir === dir).flatMap((r) => r.rbls))],
  };
  const described = speech.describeFavorite(favorite);
  setState(handlerInput, { state: 'ASK_MORE' });
  if (favorites.some((f) => sameFavorite(f, favorite))) {
    return handlerInput.responseBuilder
      .speak(say(`${speech.capitalize(described)} hast du schon gespeichert. Möchtest du noch eine Linie hinzufügen?`))
      .reprompt(say('Möchtest du noch eine Linie hinzufügen? Sag ja oder nein.'))
      .getResponse();
  }
  favorites.push(favorite);
  await storeFavorites(handlerInput, favorites);
  const tip = favorites.length === 1
    ? ` Ab jetzt sagst du einfach: Alexa, frag ${SKILL_NAME}, wann kommt ${net.lineWithArticle(lineId)}?`
    : '';
  return handlerInput.responseBuilder
    .speak(say(`Gespeichert: ${described}.${tip} Möchtest du noch eine Linie hinzufügen?`))
    .reprompt(say('Möchtest du noch eine Linie hinzufügen? Sag ja oder nein.'))
    .withSimpleCard(SKILL_NAME, `Gespeichert: ${described}`)
    .getResponse();
}

function startSetup(handlerInput, text, values = {}) {
  return elicit(handlerInput, buildIntent('AddFavoriteIntent', values), 'stop', text,
    'Sag mir den Namen der Haltestelle, zum Beispiel: Karlsplatz.');
}

// ---------- Handler ----------

function createHandlers({ fetchMonitor }) {
  const LaunchRequestHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest',
    async handle(h) {
      const favorites = await loadFavorites(h);
      if (favorites.length) return departuresResponse(h, favorites, fetchMonitor);
      return startSetup(h, `Willkommen bei ${SKILL_NAME}! Ich sage dir die nächsten Abfahrten deiner Öffis in Echtzeit. `
        + 'Richten wir zuerst deine Linie ein. An welcher Haltestelle steigst du ein?');
    },
  };

  const DepartureIntentHandler = {
    canHandle: isIntent('DepartureIntent'),
    async handle(h) {
      setState(h, null);
      const favorites = await loadFavorites(h);
      const slot = h.requestEnvelope.request.intent.slots && h.requestEnvelope.request.intent.slots.line;
      const line = resolveLine(slot);
      if (!favorites.length) {
        const values = line.status === 'line' ? { line: lineSlotValue(line.lineIds[0]) } : {};
        return startSetup(h, 'Du hast noch keine Linien gespeichert. Richten wir eine ein. An welcher Haltestelle steigst du ein?', values);
      }
      let subset = favorites;
      if (line.status === 'line') {
        subset = favorites.filter((f) => line.lineIds.includes(f.lineId));
        if (!subset.length) {
          const lineId = line.lineIds[0];
          setState(h, { state: 'OFFER_ADD', line: lineSlotValue(lineId) });
          return h.responseBuilder
            .speak(say(`${speech.capitalize(net.lineWithArticle(lineId, 'acc'))} hast du noch nicht gespeichert. Soll ich ${net.pronoun(lineId)} hinzufügen?`))
            .reprompt(say(`Soll ich ${net.lineWithArticle(lineId, 'acc')} hinzufügen?`))
            .getResponse();
        }
      } else if (line.status === 'type') {
        if (line.type === 'ptTrainS') {
          return h.responseBuilder
            .speak(say('S-Bahn-Zeiten bekomme ich von den Wiener Linien leider nicht. Ich kann dir U-Bahn, Straßenbahn, Bus und Badner Bahn ansagen.'))
            .withShouldEndSession(true)
            .getResponse();
        }
        subset = favorites.filter((f) => net.lineMatchesType(f.lineId, line.type));
        if (!subset.length) {
          const label = net.typeLabel(line.type);
          setState(h, { state: 'OFFER_ADD', line: label.name });
          return h.responseBuilder
            .speak(say(`Du hast noch ${label.masculine ? 'keinen' : 'keine'} ${label.name} gespeichert. Soll ich ${label.masculine ? 'einen' : 'eine'} hinzufügen?`))
            .reprompt(say(`Soll ich ${label.masculine ? 'einen' : 'eine'} ${label.name} hinzufügen?`))
            .getResponse();
        }
      }
      return departuresResponse(h, subset, fetchMonitor);
    },
  };

  const AllDeparturesIntentHandler = {
    canHandle: isIntent('AllDeparturesIntent'),
    async handle(h) {
      setState(h, null);
      const favorites = await loadFavorites(h);
      if (!favorites.length) {
        return startSetup(h, 'Du hast noch keine Linien gespeichert. Richten wir eine ein. An welcher Haltestelle steigst du ein?');
      }
      return departuresResponse(h, favorites, fetchMonitor);
    },
  };

  const AddFavoriteIntentHandler = {
    canHandle: isIntent('AddFavoriteIntent'),
    handle: (h) => continueSetup(h, fetchMonitor),
  };

  const RemoveFavoriteIntentHandler = {
    canHandle: isIntent('RemoveFavoriteIntent'),
    async handle(h) {
      setState(h, null);
      const favorites = await loadFavorites(h);
      if (!favorites.length) {
        return h.responseBuilder.speak(say('Du hast noch keine Linien gespeichert.')).withShouldEndSession(true).getResponse();
      }
      const saved = speech.linesList([...new Set(favorites.map((f) => f.lineId))], MAX_FAVORITES);
      const askWhich = (prefix = '') => elicit(h, buildIntent('RemoveFavoriteIntent'), 'line',
        `${prefix}Welche Linie soll ich löschen? Gespeichert sind: ${saved}.`,
        'Welche Linie soll ich löschen?');
      const slot = h.requestEnvelope.request.intent.slots && h.requestEnvelope.request.intent.slots.line;
      const line = resolveLine(slot);
      let matches = [];
      if (line.status === 'line') matches = favorites.filter((f) => line.lineIds.includes(f.lineId));
      else if (line.status === 'type') matches = favorites.filter((f) => net.lineMatchesType(f.lineId, line.type));
      else return askWhich(line.status === 'unknown' ? `Die Linie ${line.heard} kenne ich nicht. ` : '');

      if (!matches.length) {
        return askWhich(line.status === 'line'
          ? `${speech.capitalize(net.lineWithArticle(line.lineIds[0], 'acc'))} hast du nicht gespeichert. `
          : 'Davon hast du nichts gespeichert. ');
      }
      const lineIds = [...new Set(matches.map((f) => f.lineId))];
      if (lineIds.length > 1) {
        return askWhich(`Du hast mehrere davon gespeichert: ${speech.linesList(lineIds)}. `);
      }
      await storeFavorites(h, favorites.filter((f) => !matches.includes(f)));
      return h.responseBuilder
        .speak(say(`Erledigt, ${net.lineWithArticle(lineIds[0], 'acc')} habe ich gelöscht.`))
        .withShouldEndSession(true)
        .getResponse();
    },
  };

  const ListFavoritesIntentHandler = {
    canHandle: isIntent('ListFavoritesIntent'),
    async handle(h) {
      setState(h, null);
      const favorites = await loadFavorites(h);
      if (!favorites.length) {
        setState(h, { state: 'OFFER_ADD' });
        return h.responseBuilder
          .speak(say('Du hast noch keine Linien gespeichert. Möchtest du eine hinzufügen?'))
          .reprompt(say('Möchtest du eine Linie hinzufügen?'))
          .getResponse();
      }
      const items = favorites.map(speech.describeFavorite);
      const intro = favorites.length === 1 ? 'Du hast eine Linie gespeichert' : `Du hast ${favorites.length} Linien gespeichert`;
      const text = `${intro}: ${speech.listJoin(items)}.`;
      return h.responseBuilder
        .speak(say(text))
        .withSimpleCard(SKILL_NAME, items.map((i) => `• ${speech.capitalize(i)}`).join('\n'))
        .withShouldEndSession(true)
        .getResponse();
    },
  };

  const ResetIntentHandler = {
    canHandle: isIntent('ResetIntent'),
    async handle(h) {
      const favorites = await loadFavorites(h);
      if (!favorites.length) {
        setState(h, null);
        return h.responseBuilder.speak(say('Es ist nichts gespeichert.')).withShouldEndSession(true).getResponse();
      }
      setState(h, { state: 'CONFIRM_RESET' });
      const what = favorites.length === 1 ? 'deine gespeicherte Linie'
        : favorites.length === 2 ? 'beide gespeicherten Linien' : `alle ${favorites.length} gespeicherten Linien`;
      return h.responseBuilder
        .speak(say(`Soll ich wirklich ${what} löschen?`))
        .reprompt(say(`Soll ich ${what} löschen? Sag ja oder nein.`))
        .getResponse();
    },
  };

  const YesIntentHandler = {
    canHandle: isIntent('AMAZON.YesIntent'),
    async handle(h) {
      const { state, line } = session(h);
      setState(h, null);
      if (state === 'ASK_MORE') {
        return startSetup(h, 'Gut. An welcher Haltestelle?');
      }
      if (state === 'OFFER_ADD') {
        return startSetup(h, 'Okay. An welcher Haltestelle steigst du ein?', line ? { line } : {});
      }
      if (state === 'CONFIRM_RESET') {
        await storeFavorites(h, []);
        return h.responseBuilder
          .speak(say('Erledigt, alles gelöscht. Sag einfach "Linie hinzufügen", wenn du neu starten möchtest.'))
          .withShouldEndSession(true)
          .getResponse();
      }
      return HelpIntentHandler.handle(h);
    },
  };

  const NoIntentHandler = {
    canHandle: isIntent('AMAZON.NoIntent'),
    async handle(h) {
      const { state } = session(h);
      setState(h, null);
      let text = 'Okay.';
      if (state === 'ASK_MORE') {
        const favorites = await loadFavorites(h);
        const example = favorites.length ? net.lineWithArticle(favorites[favorites.length - 1].lineId) : 'die 62';
        text = `Alles klar! Frag mich einfach: wann kommt ${example}? Oder: alle Abfahrten.`;
      } else if (state === 'CONFIRM_RESET') {
        text = 'Okay, ich lasse alles, wie es ist.';
      }
      return h.responseBuilder.speak(say(text)).withShouldEndSession(true).getResponse();
    },
  };

  const HelpIntentHandler = {
    canHandle: isIntent('AMAZON.HelpIntent'),
    handle(h) {
      setState(h, null);
      const text = `Mit ${SKILL_NAME} hörst du die nächsten Abfahrten deiner Öffis in Echtzeit. `
        + 'Frag zum Beispiel: wann kommt die 62? Oder sag: alle Abfahrten. '
        + 'Neue Linien richtest du mit "Linie hinzufügen" ein. '
        + 'Mit "was habe ich gespeichert" hörst du deine Liste, und mit "lösche die 62" entfernst du eine Linie. '
        + 'Was möchtest du tun?';
      return h.responseBuilder.speak(say(text)).reprompt(say('Was möchtest du tun?')).getResponse();
    },
  };

  const FallbackIntentHandler = {
    canHandle: isIntent('AMAZON.FallbackIntent'),
    handle(h) {
      const { state } = session(h);
      if (state === 'ASK_MORE' || state === 'OFFER_ADD' || state === 'CONFIRM_RESET') {
        return h.responseBuilder
          .speak(say('Sag bitte einfach ja oder nein.'))
          .reprompt(say('Ja oder nein?'))
          .getResponse();
      }
      return h.responseBuilder
        .speak(say('Das habe ich leider nicht verstanden. Frag zum Beispiel: wann kommt die 62? Oder sag: Hilfe.'))
        .reprompt(say('Was möchtest du wissen?'))
        .getResponse();
    },
  };

  const CancelAndStopIntentHandler = {
    canHandle: isIntent('AMAZON.CancelIntent', 'AMAZON.StopIntent', 'AMAZON.NavigateHomeIntent'),
    handle(h) {
      setState(h, null);
      return h.responseBuilder.speak(say('Bis bald!')).withShouldEndSession(true).getResponse();
    },
  };

  const SessionEndedRequestHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'SessionEndedRequest',
    handle(h) {
      const { reason, error } = h.requestEnvelope.request;
      if (error) console.warn('Session beendet:', reason, error.type, error.message);
      return h.responseBuilder.getResponse();
    },
  };

  const ErrorHandler = {
    canHandle: () => true,
    handle(h, error) {
      console.error('Unbehandelter Fehler:', error && error.stack ? error.stack : error);
      return h.responseBuilder
        .speak(say('Entschuldigung, da ist etwas schiefgelaufen. Probier es bitte nochmal.'))
        .withShouldEndSession(true)
        .getResponse();
    },
  };

  return {
    requestHandlers: [
      LaunchRequestHandler,
      DepartureIntentHandler,
      AllDeparturesIntentHandler,
      AddFavoriteIntentHandler,
      RemoveFavoriteIntentHandler,
      ListFavoritesIntentHandler,
      ResetIntentHandler,
      YesIntentHandler,
      NoIntentHandler,
      HelpIntentHandler,
      FallbackIntentHandler,
      CancelAndStopIntentHandler,
      SessionEndedRequestHandler,
    ],
    errorHandlers: [ErrorHandler],
  };
}

function createSkill({
  persistenceAdapter = createDefaultAdapter(),
  fetchMonitor = wl.fetchMonitor,
  skillId = process.env.SKILL_ID,
} = {}) {
  const { requestHandlers, errorHandlers } = createHandlers({ fetchMonitor });
  const builder = Alexa.SkillBuilders.custom()
    .addRequestHandlers(...requestHandlers)
    .addErrorHandlers(...errorHandlers)
    .withPersistenceAdapter(persistenceAdapter)
    .withCustomUserAgent('wiener-abfahrten');
  // Optional: nur Anfragen dieses Skills annehmen (bei eigener Lambda sinnvoll)
  if (skillId) builder.withSkillId(skillId);
  return builder.create();
}

let defaultSkill;
exports.handler = async (event, context) => {
  if (!defaultSkill) defaultSkill = createSkill();
  return defaultSkill.invoke(event, context);
};

exports.createSkill = createSkill;
