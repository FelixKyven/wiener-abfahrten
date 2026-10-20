'use strict';

// Sätze für die Sprachausgabe.

const net = require('./network');

function escapeSsml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function listJoin(items, conjunction = 'und') {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

// [3, 11, 19] -> "in 3, 11 und 19 Minuten"; [0, 5] -> "jetzt, dann in 5 Minuten"
function minutesText(countdowns) {
  const top = countdowns.slice(0, 3);
  if (!top.length) return '';
  const unit = (list) => (list.length === 1 && list[0] === 1 ? 'Minute' : 'Minuten');
  if (top[0] === 0) {
    const rest = top.slice(1);
    return rest.length ? `jetzt, dann in ${listJoin(rest.map(String))} ${unit(rest)}` : 'jetzt';
  }
  return `in ${listJoin(top.map(String))} ${unit(top)}`;
}

// Welche Zusatzinfos braucht ein Favorit, damit er eindeutig ist?
// Richtung nur, wenn dieselbe Linie mehrfach gespeichert ist;
// Haltestelle nur, wenn Favoriten an verschiedenen Haltestellen liegen.
function labelOptions(favorite, allFavorites) {
  const sameLine = allFavorites.filter((f) => f.lineId === favorite.lineId);
  const stations = new Set(allFavorites.map((f) => f.station));
  const sameLineStations = new Set(sameLine.map((f) => f.station));
  return {
    withDirection: sameLine.length > 1 && sameLineStations.size < sameLine.length,
    withStation: stations.size > 1,
  };
}

function favoriteLabel(favorite, { withDirection = false, withStation = false, grammaticalCase = 'nom' } = {}) {
  let label = net.lineWithArticle(favorite.lineId, grammaticalCase);
  if (withStation) label += ` ab ${net.stationSpoken(favorite.station)}`;
  if (withDirection && favorite.to) label += ` Richtung ${net.destinationSpoken(favorite.to)}`;
  return label;
}

function departureSentence(favorite, countdowns, allFavorites) {
  const label = favoriteLabel(favorite, labelOptions(favorite, allFavorites));
  if (!countdowns.length) {
    const dat = favoriteLabel(favorite, { ...labelOptions(favorite, allFavorites), grammaticalCase: 'dat' });
    return `Von ${dat} finde ich gerade keine Abfahrten.`;
  }
  return `${capitalize(label)} fährt ${minutesText(countdowns)}.`;
}

function describeFavorite(favorite) {
  return `${net.lineWithArticle(favorite.lineId)} an der Haltestelle ${net.stationSpoken(favorite.station)}`
    + (favorite.to ? ` Richtung ${net.destinationSpoken(favorite.to)}` : '');
}

// "62, 59A und die Badner Bahn" – für Aufzählungen an einer Haltestelle
function linesList(lineIds, max = 8) {
  const names = lineIds.slice(0, max).map((id) => {
    const line = net.getLine(id);
    return line && line.type === 'ptTramWLB' ? 'die Badner Bahn' : net.lineSpoken(id);
  });
  if (lineIds.length > max) return `${names.join(', ')} und ${lineIds.length - max} weitere`;
  return listJoin(names);
}

module.exports = {
  escapeSsml,
  capitalize,
  listJoin,
  minutesText,
  favoriteLabel,
  labelOptions,
  departureSentence,
  describeFavorite,
  linesList,
};
