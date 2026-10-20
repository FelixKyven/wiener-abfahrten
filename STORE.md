# Veröffentlichung im Alexa Skill Store – Checkliste

Kosten: keine. Die Prüfung durch Amazon („Certification") dauert meist ein paar Tage.

## Vorher erledigen

- [x] **E-Mail-Adresse** in `docs/datenschutz.md` eingetragen
- [ ] Repository auf GitHub veröffentlichen
- [ ] **GitHub Pages** einschalten: Repository → Settings → Pages → Source „Deploy from a branch" → Branch `main`, Ordner `/docs`
- [ ] Prüfen, dass diese Seiten erreichbar sind:
  - https://felixkyven.github.io/wiener-abfahrten/datenschutz
  - https://felixkyven.github.io/wiener-abfahrten/nutzungsbedingungen
- [ ] Skill installiert und auf dem eigenen Echo getestet (siehe README)

## In der Developer Console

Alle Texte, Icons und Links stehen bereits in `skill-package/skill.json` und werden beim Import übernommen. Kontrollieren unter **Distribution**:

| Feld | Inhalt |
|---|---|
| Public Name | Wiener Abfahrten |
| One Sentence Description | steht in `skill.json` (`summary`) |
| Detailed Description | steht in `skill.json` (`description`) |
| Example Phrases | „Alexa, öffne Wiener Abfahrten" · „Alexa, frag Wiener Abfahrten wann kommt die Straßenbahn" · „Alexa, sag Wiener Abfahrten Linie hinzufügen" |
| Icons | `skill-package/assets/images/` (108×108 und 512×512) |
| Category | Public Transportation |
| Privacy Policy URL | https://felixkyven.github.io/wiener-abfahrten/datenschutz |
| Terms of Use URL | https://felixkyven.github.io/wiener-abfahrten/nutzungsbedingungen |

**Privacy & Compliance:**
- Does this skill allow users to make purchases? → **No**
- Does this skill collect users' personal information? → **No** (nur pseudonyme User-ID und gespeicherte Haltestellen)
- Is this skill directed to children under 13? → **No**
- Does this skill contain advertising? → **No**
- Export compliance → **Ja, ankreuzen**
- Testing Instructions → stehen in `skill.json`

**Availability:** Public, Länder: Österreich und Deutschland.

## Einreichen

1. Tab **Certification** → **Validation** ausführen und alle Fehler beheben
2. **Functional test** ausführen
3. **Submission** → „Certify and publish now"

## Häufige Ablehnungsgründe – schon berücksichtigt

- ✅ Keine Markennamen im Skill-Namen oder Icon („Wiener Linien" ist geschützt)
- ✅ Hinweis „kein offizielles Angebot" und Datenquelle in der Beschreibung
- ✅ Beispielsätze passen exakt zu Sample Utterances
- ✅ Hilfe-Intent erklärt alle Funktionen
- ✅ Stop/Abbrechen beendet sofort
- ✅ Skill funktioniert auch ohne Live-Daten (sagt verständlich Bescheid)
- ✅ Aufrufname aus zwei Wörtern, ohne „Alexa"/„Skill"
