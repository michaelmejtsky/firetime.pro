# Abnahme – Cloudflare-Migrationskandidat

Stand 22.11.2026. Keine Produktivfreigabe, kein Echtkundendatenimport.

## Bereits lokal nachgewiesen

| Prüfung | Ergebnis | Aussagegrenze |
|---|---|---|
| 130 bestehende Regressionstests | Bestanden | Bisheriger Quellstand, keine Google-Live-Ausführung |
| 38 native Tests mit SQLite und D1-kompatiblem Adapter | Bestanden | Synthetische Daten, keine echte Mandantendatenbank |
| workerd mit tatsächlichen lokalen D1/R2-Bindings | Bestanden | Login, Session, Shell, Zeitbuchung, PDF-Upload/Download, Health |
| Wrangler deploy --dry-run | Bestanden | Worker lässt sich paketieren; keine Veröffentlichung |
| Passwortvergleich, Unicode einschließlich Umlaut/Emoji | Identisch zum bisherigen Algorithmus | Alter produktiver FT_PEPPER muss sicher übernommen werden |
| Gleichzeitige Versionsstände | Veralteter Mehrtabellen-Schreibzugriff vollständig zurückgerollt | Lasttest mit realer Benutzerzahl steht aus |
| Wiederholte Anfragekennung | Eine Zeitbuchung und ein Audit-Eintrag | Bei einem absichtlich neuen Klick entsteht eine neue Anfragekennung |
| Genehmigter Urlaub: Stornowunsch / Freigabe | Gutschrift bis Stornofreigabe erhalten; Tage einmalig retour | Reale Salden noch nicht verglichen |
| Freigegebener Monats-Snapshot | Unverändert zurückgegeben; neue Zeitbuchung abgewiesen | Reale Monatsbestände noch nicht verglichen |
| BSB3100 24h Bereitschaft + 2h Objekt + 2h Einsatz | 22h Bereitschaft, 4h Arbeit, 25h Soll | Beispielmonat, weitere Altfallkonstellationen abnehmen |
| Sommer-/Winterzeit | 23h/25h Dienst, lokale 08:00 korrekt, doppelte/fehlende Ortszeit geprüft | Realen Schichtbestand über Monatsgrenzen zusätzlich kontrollieren |
| Private Aufgabenanhänge | Byteidentisch an Teilnehmer; Firmenadmin ohne Gesprächsteilnahme abgewiesen | Mobilanzeige großer echter PDFs steht aus |
| Export → SQL → Datensatzvergleich | Verlustfrei, Zeichen/JSON bleiben erhalten | Keine echten Exporte vorhanden |
| Unbekanntes Schema / fehlende Datei / falscher Snapshot-Hash | Importprüfung bricht ab | Fehlende historische Dateien müssen vor Umschaltung geklärt werden |
| E-Mail-Outbox | Erst QUEUED, nach Providerannahme SENT; Fehler führen zu Retry | Resend im Test simuliert, kein echter Versand |
| 19-Uhr-Autostopp und Hintergrund-PDF | Bestanden | Tatsächliche Pause erhalten; Monats-PDF-Job endet READY |
| Aufgabenabläufe und Mehrfachzuordnung | Aufgabenfilter, unabhängige Mitarbeiterzustände, Rückgabe und erneute Durchführung geprüft | Alt-Nachrichten bleiben gespeichert, im neuen Workflow unsichtbar |
| Automatische Pause | >6h, tatsächliche Bestätigung, vorhandene Pausen zählen, Abweichungsprüfung ohne erfundenen Abzug | Reale Mitarbeiterfälle zusätzlich abnehmen |
| Jahres-/Urlaubskonto und Abgabematrix | Firmengrenzen, Mitarbeiterrechte, Jahreswechsel, freiwillige Stundenbasis geprüft | Keine reale Saldenprüfung |
| Haupt-/Mitarbeiterkalender | 30 Dienste in beiden Kalendern vorgemerkt, keine zusätzliche Einladung; Aufgabenfrist, Änderung, Abschluss, Wiederöffnung und Zielwechsel geprüft | REST-Antworten simuliert; reale Rechte und Zustellung offen |
| Oberfläche und Vektor-PDF | Desktop mit synthetischen Admin-/Mitarbeiterdaten; lange Beschreibungen und getrennte PDF-Seiten visuell geprüft | Kein schreibender Browser-Ende-zu-Ende-Test; iPhone-Abnahme offen |
| Zugangssperre / CORS / Schreibschutz | Unberechtigte Aufrufe und Schreibzugriffe abgewiesen | Produktionskonfiguration separat prüfen |

Der Original-/Portierungsvergleich verwendet denselben Exportbestand und die gleiche Zeitzonenabbildung. Er prüft Unterschiede durch den Umbau. Er ist kein unabhängiger Nachweis der gesetzlichen Lohnberechnung und keine Bestätigung eines möglicherweise abweichenden Apps-Script-Deployments.

## Vor einem echten Wechsel noch durchzuführen

- [ ] Vollständigen aktuellen Export aller 37 bekannten Tabellen und referenzierten Dateien prüfen; unbekannte Tabellen vor Import beurteilen.
- [ ] Passwortanmeldung mit dem alten FT_PEPPER an Testkopie durchführen; Mitarbeiter, Firmenadmin und Systemadmin testen.
- [ ] Reale genehmigte Monate, Anfangssalden, laufende Monate und Urlaubstage exakt vergleichen, einschließlich Mitarbeiterwechsel und vergangener Zeitumstellung.
- [ ] Monatsfreigabe/Rückgabe, manuelle Zeitkorrektur, Überlappungen und tatsächliche Pausen prüfen.
- [ ] Bereitschaftsvorschlag, Zuordnung, Veröffentlichung, geteilte Dienste, Übergabe, Bestätigung und Entfernung mit einer Datenkopie durchspielen.
- [ ] Verfügbarkeit, Arbeitsdienstplan, Krankheit, flexible Urlaubstage, Jahresgutschrift und Firmenmodule anhand der tatsächlich verwendeten Konfiguration testen.
- [ ] Aufgaben einschließlich Foto- und 10-MB-PDF-Anhängen auf iPhone und Desktop testen.
- [ ] Monats- und Sammelberichte, mehrseitige serverseitige Abwesenheits-PDFs und historische Dateiarchive öffnen und optisch prüfen.
- [ ] Reale Push-, E-Mail- und optionale Kalenderzustellung an klar festgelegte Testempfänger prüfen. Rückmeldungen und Fehlerwarteschlange kontrollieren.
- [ ] Hauptkalender-ID und persönliche Mitarbeiter-IDs eintragen. Zielkalender für das Servicekonto freigeben. Bereitschaft anlegen/ändern/entfernen, geteilten Dienst/Übergabe und Aufgabenfrist ändern/abschließen/wiederöffnen; echten Kalenderbestand und Fehlerwarteschlange prüfen.
- [ ] Native Automatik für 19 Uhr, 24h-vor-Dienst, 4h-nach-Dienst und Monatsabschluss mit kontrollierter Testzeit prüfen, bevor die alte Automatik deaktiviert wird.
- [ ] Antwortzeiten und Fehlerquote bei gleichzeitig aktiven Benutzern mit realistischen Datenmengen vergleichen; keine zugesicherte Ladezeit allein aus lokalen Tests ableiten.
- [ ] Aktuelle Datenbank-/Dateisicherung außerhalb des Arbeitsverzeichnisses und geplantes Umschaltfenster festhalten.
- [ ] Nach echten neuen Cloudflare-Buchungen ist ein Zurückwechseln ohne Datenabgleich ausdrücklich ausgeschlossen.
