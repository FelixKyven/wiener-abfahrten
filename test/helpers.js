'use strict';

// Baut Alexa-Requests nach und führt Gespräche mit dem Skill – ohne Echo.

const { createSkill } = require('../lambda/index');
const { MemoryAdapter } = require('../lambda/lib/persistence');

function envelope(request, { sessionAttributes = {}, userId = 'amzn1.ask.account.TEST', isNew = false } = {}) {
  const application = { applicationId: 'amzn1.ask.skill.test' };
  return {
    version: '1.0',
    session: { new: isNew, sessionId: 'amzn1.echo-api.session.test', application, user: { userId }, attributes: sessionAttributes },
    context: {
      System: {
        application,
        user: { userId },
        device: { deviceId: 'test-device', supportedInterfaces: {} },
        apiEndpoint: 'https://api.eu.amazonalexa.com',
      },
    },
    request: { requestId: `req-${Math.random()}`, timestamp: new Date().toISOString(), locale: 'de-DE', ...request },
  };
}

function intentRequest(name, slots = {}) {
  const slotObjects = {};
  for (const [key, value] of Object.entries(slots)) {
    slotObjects[key] = { name: key, confirmationStatus: 'NONE' };
    if (value !== undefined) slotObjects[key].value = value;
  }
  return { type: 'IntentRequest', dialogState: 'IN_PROGRESS', intent: { name, confirmationStatus: 'NONE', slots: slotObjects } };
}

function plain(ssml) {
  return String(ssml || '').replace(/<\/?speak>/g, '').replace(/&amp;/g, '&');
}

// Ein Gesprächspartner: merkt sich Session-Attribute und den letzten
// ElicitSlot-Dialog, so wie Alexa es tun würde.
function conversation({ fetchMonitor, userId } = {}) {
  const adapter = new MemoryAdapter();
  const skill = createSkill({ persistenceAdapter: adapter, fetchMonitor });
  let sessionAttributes = {};
  let pendingIntent = null;

  async function send(request) {
    const res = await skill.invoke(envelope(request, { sessionAttributes, userId }));
    const response = res.response || {};
    sessionAttributes = res.sessionAttributes || {};
    const directive = (response.directives || []).find((d) => d.type === 'Dialog.ElicitSlot');
    pendingIntent = directive ? { ...directive.updatedIntent, slotToElicit: directive.slotToElicit } : null;
    return {
      text: plain(response.outputSpeech && response.outputSpeech.ssml),
      reprompt: plain(response.reprompt && response.reprompt.outputSpeech && response.reprompt.outputSpeech.ssml),
      elicit: directive ? directive.slotToElicit : null,
      intent: directive ? directive.updatedIntent : null,
      ended: response.shouldEndSession === true,
      card: response.card,
      raw: res,
    };
  }

  return {
    adapter,
    launch: () => send({ type: 'LaunchRequest' }),
    intent: (name, slots) => send(intentRequest(name, slots)),
    // Antwort auf eine Rückfrage: Alexa füllt den angefragten Slot im
    // laufenden Intent und schickt die anderen Slots unverändert mit.
    answer: (value) => {
      if (!pendingIntent) throw new Error('Keine offene Rückfrage');
      const slots = {};
      for (const [name, slot] of Object.entries(pendingIntent.slots)) slots[name] = slot.value;
      slots[pendingIntent.slotToElicit] = value;
      return send(intentRequest(pendingIntent.name, slots));
    },
    get session() { return sessionAttributes; },
  };
}

// Echtzeitdaten wie von der API, für die Haltestelle Aßmayergasse
function fakeMonitor(overrides = {}) {
  const data = {
    1748: [
      { lineId: 162, name: '62', towards: 'Oper, Karlsplatz U', richtungsId: 2, countdowns: [4, 13, 24, 34], realtime: 4 },
      { lineId: 399, name: 'WLB', towards: 'Wien Oper', richtungsId: 1, countdowns: [2, 4, 12, 19], realtime: 4 },
      { lineId: 399, name: 'WLB', towards: 'Wien Oper', richtungsId: 2, countdowns: [4, 19, 34, 49], realtime: 0 },
    ],
    1718: [
      { lineId: 162, name: '62', towards: 'Lainz, Wolkersbergenstraße', richtungsId: 1, countdowns: [1, 9], realtime: 2 },
      { lineId: 399, name: 'WLB', towards: 'Baden Josefsplatz', richtungsId: 1, countdowns: [5], realtime: 1 },
    ],
    1693: [{ lineId: 459, name: '59A', towards: 'Oper, Karlsplatz U', richtungsId: 2, countdowns: [1, 12, 23], realtime: 3 }],
    1692: [{ lineId: 459, name: '59A', towards: 'Bhf. Meidling', richtungsId: 1, countdowns: [3], realtime: 1 }],
    ...overrides,
  };
  const calls = [];
  const fn = async (rbls) => {
    calls.push(rbls);
    return rbls.flatMap((rbl) => (data[rbl] || []).map((e) => ({ rbl: Number(rbl), ...e })));
  };
  fn.calls = calls;
  return fn;
}

module.exports = { envelope, intentRequest, conversation, fakeMonitor };
