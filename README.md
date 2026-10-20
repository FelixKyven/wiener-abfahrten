# Wiener Abfahrten – Alexa Skill

**„Alexa, frag Wiener Abfahrten, wann kommt die 62?"**
→ *„Die 62 fährt in 4, 13 und 24 Minuten."*

Ein Alexa Skill, der die nächsten Abfahrten der Wiener Öffis in Echtzeit ansagt. Jede Nutzerin und jeder Nutzer richtet die eigenen Linien **per Sprache** ein – ohne App, ohne Konto, ohne Konfigurationsdatei.

```
Du:     Alexa, öffne Wiener Abfahrten
Alexa:  Willkommen! … An welcher Haltestelle steigst du ein?
Du:     Aßmayergasse
Alexa:  An der Haltestelle Aßmayergasse fahren 62, die Badner Bahn, 59A und N8.
        Welche Linie möchtest du speichern?
Du:     62
Alexa:  In welche Richtung nimmst du die 62? Richtung Lainz oder Richtung Oper Karlsplatz?
Du:     Oper
Alexa:  Gespeichert! … Möchtest du noch eine Linie hinzufügen?
```

## Funktionen

- **Alle Wiener-Linien-Haltestellen** (rund 1.700) und **Linien** (U-Bahn, Straßenbahn, Bus, Nachtbus, Badner Bahn)
- **Einrichtung per Sprache**: Haltestelle → Linie → Richtung, mit Rückfragen bei mehrdeutigen Namen („Meidling" → „Meinst du Bahnhof Meidling, Meidling Hauptstraße …?")
- **Bis zu 10 Linien** pro Nutzer, auch an verschiedenen Haltestellen
- Fragen nach Linie („wann kommt die U6"), Verkehrsmittel („wann kommt der Bus") oder allem („alle Abfahrten", oder einfach den Skill öffnen)
- Versteht Wiener Sprechweisen wie „der Zweiundsechziger", „der 62er", „die Bim"
- **Kostenlos zu betreiben**: Alexa-hosted, Wiener-Linien-API ohne Schlüssel

| Sprachbefehl | Was passiert |
|---|---|
| „Alexa, öffne Wiener Abfahrten" | beim ersten Mal: Einrichtung, danach: alle Abfahrten |
| „…, wann kommt die 62?" | Abfahrten einer Linie |
| „…, wann kommt der Bus?" | alle gespeicherten Linien dieses Typs |
| „…, Linie hinzufügen" | neue Linie einrichten |
| „…, was habe ich gespeichert?" | Liste vorlesen |
| „…, lösche die 62" | Linie entfernen |
| „…, alles löschen" | alle Daten löschen (mit Rückfrage) |

## Projektaufbau

```
wiener-abfahrten/
├── lambda/                     # Code, der bei Amazon läuft
│   ├── index.js                # Alexa-Handler, Dialog-Logik
│   ├── lib/
│   │   ├── network.js          # Haltestellen/Linien finden, Namen fürs Vorlesen
│   │   ├── wienerlinien.js     # Echtzeit-API der Wiener Linien
│   │   ├── speech.js           # Sätze bauen
│   │   ├── persistence.js      # Favoriten pro Nutzer (DynamoDB)
│   │   └── text.js             # Abkürzungen, Zahlwörter, Normalisierung
│   └── data/network.json       # generiert: Liniennetz mit Steig-Nummern (RBL)
├── skill-package/              # Skill-Definition für Amazon
│   ├── skill.json              # Store-Texte, Icons, Datenschutz-Links
│   ├── interactionModels/custom/de-DE.json
│   └── assets/images/          # Icons 108×108 und 512×512
├── tools/
│   ├── build-data.js           # Netzdaten + Slot-Typen neu erzeugen
│   └── demo.js                 # Gespräch mit Live-Daten im Terminal
├── test/                       # Tests (node --test)
└── docs/                       # GitHub Pages: Datenschutz, Nutzungsbedingungen
```

## Lokal ausprobieren

Voraussetzung: Node.js 18 oder neuer.

```bash
npm install
```

```bash
npm test
```

```bash
node tools/demo.js "Aßmayergasse" "62" "Oper"
```

Das Demo-Skript spielt ein komplettes Gespräch mit **echten Live-Daten** durch – ohne Echo und ohne Amazon-Account.

## Installation als eigener Skill (kostenlos, Alexa-hosted)

Du brauchst nur einen kostenlosen [Amazon-Developer-Account](https://developer.amazon.com) mit demselben Amazon-Konto wie dein Echo. Einen AWS-Account brauchst du nicht.

### Variante A: aus GitHub importieren (am einfachsten)

1. [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask) → **Create Skill**
2. Name: `Wiener Abfahrten`, Primary locale: **German (DE)**
3. Experience: **Other** → Model: **Custom** → Hosting: **Alexa-hosted (Node.js)**, Region: **EU (Ireland)**
4. Template: **Import skill** → URL dieses Repositorys eintragen: `https://github.com/FelixKyven/wiener-abfahrten.git`
5. Warten, bis der Build fertig ist (ein paar Minuten).
6. Tab **Test** → oben „Skill testing is enabled in" auf **Development** stellen.
7. Fertig – auf jedem Echo mit deinem Konto: „Alexa, öffne Wiener Abfahrten".

### Variante B: Code und Modell manuell hochladen

1. Skill wie oben anlegen, aber Template **Start from Scratch**.
2. **Build** → **Interaction Model** → **JSON Editor** → Inhalt von `skill-package/interactionModels/custom/de-DE.json` einfügen → **Save** → **Build Skill**.
3. Lokal `npm run package` ausführen → erzeugt `dist/lambda.zip`.
4. Tab **Code** → **Import Code** → `dist/lambda.zip` wählen → alle Dateien übernehmen → **Deploy**.
5. Weiter wie oben ab Schritt 6.

### Variante C: eigene AWS Lambda + ASK CLI

Für alle, die selbst hosten wollen: DynamoDB-Tabelle mit Partition Key `id` (String) anlegen und in der Lambda die Umgebungsvariablen `DYNAMODB_PERSISTENCE_TABLE_NAME`, `DYNAMODB_PERSISTENCE_REGION` und optional `SKILL_ID` setzen. Runtime Node.js 18 oder neuer, Handler `index.handler`. Mit der [ASK CLI](https://developer.amazon.com/de-DE/docs/alexa/smapi/quick-start-alexa-skills-kit-command-line-interface.html) in `ask-resources.json` einen `skillInfrastructure`-Eintrag (`@ask-cli/lambda-deployer`) ergänzen und `ask deploy` ausführen.

## Daten aktualisieren

Die Wiener Linien ändern ihre Stammdaten gelegentlich, vor allem zum Fahrplanwechsel. Neu erzeugen mit:

```bash
npm run build-data
```

Das lädt die aktuellen CSV-Dateien, schreibt `lambda/data/network.json` neu und aktualisiert die Haltestellen- und Liniennamen im Interaction Model. Danach Modell neu bauen und Code neu deployen.

Gespeicherte Favoriten bleiben dabei gültig: Der Skill merkt sich Haltestelle, Linie und Richtung und sucht die passenden Steige (RBL-Nummern) jedes Mal neu heraus.

## Wie es funktioniert

- **Stammdaten** (`haltestellen.csv`, `haltepunkte.csv`, `linien.csv`, `fahrwegverlaeufe.csv`) ergeben, welche Linie an welcher Haltestelle in welche Richtung fährt und welche Steig-Nummern (RBL) dazugehören.
- **Depotfahrten** (z. B. die Linien 1, 6 und 18 an der Aßmayergasse) werden herausgefiltert: Angeboten werden nur Linien, die laut Fahrplan regulär oder laut Echtzeitdaten gerade dort fahren.
- **Echtzeit**: Pro Anfrage ein einziger Aufruf von `ogd_realtime/monitor` mit allen benötigten RBL-Nummern. Gefiltert wird nach Linien-ID und Richtung (`richtungsId`).
- **Richtungen** werden mit dem Ziel benannt, das gerade auf der Anzeige an der Haltestelle steht; ohne Live-Daten mit der Endstation laut Fahrplan.

## Datenquelle & Lizenz

- Code: [MIT-Lizenz](LICENSE)
- Daten: Wiener Linien – [data.wien.gv.at](https://www.data.gv.at/katalog/dataset/wiener-linien-echtzeitdaten-via-datendrehscheibe-wien), Lizenz [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de)

Dies ist ein privates Projekt und **kein offizielles Angebot der Wiener Linien**. S-Bahn und ÖBB-Züge sind nicht enthalten, weil es dafür keine offene Echtzeit-Schnittstelle gibt.
