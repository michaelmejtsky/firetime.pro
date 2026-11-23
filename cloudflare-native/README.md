# FireTime Pro – Cloudflare-Umbau

**Stand: 23.11.2026 · Migrationskandidat, noch keine Produktivfreigabe.**

Der neue Worker führt die vorhandene Fachlogik auf Cloudflare aus. D1 ersetzt Sheets. Der neue Neustart verwendet private Dateien in Google Drive über die direkte Drive-API; die bisher vorbereitete R2-Staging-Variante bleibt optional. Normale Anmeldung, Stundenberechnung, Zeiterfassung, Urlaub, Planung, Aufgaben und PDFs benötigen kein Apps Script. Die bisherige Oberfläche bleibt im Bestand; die getrennte Cloudflare-Oberfläche erhält die vereinfachte Bedienung. Google Calendar bleibt eine optionale externe Integration über die offizielle REST-API. E-Mails benötigen einen verifizierten Absender bei Resend. Push wird direkt vom Worker zugestellt.

Die bisherige produktive `config.js`, `index.html`, `cloudflare/worker.js` und `apps-script/Code.gs` werden von diesem Umbau **nicht geändert**. Keine Kundendaten, Passwörter, Exporte oder Cloudflare-Zugangsdaten gehören ins Repository.

## Frischer Neustart ohne Alt-Testdaten

Für die neue Einrichtung ohne Datenübernahme gilt **`docs/NEUSTART.md`**. Ein geschützter `/first-start`-Dialog legt das Schema, einen neuen Systemadmin und BSB3100 an. Schlüssel und Passwort werden direkt vor Ort eingegeben. Bestehende Daten werden nicht überschrieben. Der alte FT_PEPPER ist nur bei einer Übernahme alter Passwörter erforderlich; für den Neustart wird ein neuer dauerhafter Schlüssel verwendet.

## Neue Dateiablage ohne R2

Die konkrete neue Instanz verwendet `wrangler.fresh.jsonc`, die bereits angelegte D1-Datenbank und `FILE_STORAGE=drive`. Es ist kein R2-Abo und keine R2-Bindung dafür erforderlich. Die private Google-Verbindung wird nur vom Systemadmin eingerichtet. Einzelheiten und nötige Google-Einstellungen: **`docs/GOOGLE_DRIVE.md`**. Solange Google noch nicht verbunden ist, funktionieren Erststart, Anmeldung und normale Zeitbuchung; Datei-Uploads/-Abrufe benötigen die Freigabe. Die folgenden R2-Migrationsbefehle betreffen nur den alten optionalen Importpfad.

## Was hier vorbereitet ist

- Vollständiges API-kompatibles Backend aus dem aktuellen, unveränderten Fachkern; 37 übernommene Tabellen plus 3 native Ergänzungen, 94 API-Aktionen.
- Worker-eigene Oberfläche/PWA mit `/api` auf derselben Adresse; die GitHub-Oberfläche kann später ebenfalls auf die neue API zeigen.
- D1-Indizes für Firma, Benutzer, E-Mail und Monat; Anmeldungen laden nur den betreffenden Benutzer und notwendige Authentifizierungsdaten.
- Atomare Mehrtabellen-Buchungen mit Versionsprüfung. Gleichzeitige Änderungen werden erneut auf einer frischen Datenbasis berechnet. Anfragekennungen verhindern doppelte Zeitbuchungen bei wiederholten identischen Requests.
- Bestehende Passwort-Hashes und 30-Tage-Sitzungen können übernommen werden. Der alte `FT_PEPPER` ist zwingend als Secret erforderlich. Keine neue Passwortvergabe notwendig.
- Mandanten- und Rollenprüfungen aus dem bisherigen System, private Aufgabenzugriffe einschließlich PDF-Anhängen.
- Prüfsummen und geschützte Downloads für private Dateien; Drive-Uploads mit reservierten IDs und verschlüsselter OAuth-Verbindung. R2 bleibt für alte Migrationstests verfügbar.
- Dauerhafte Zustellwarteschlange für E-Mail, Push und optionalen Kalender. `QUEUED` bedeutet vorgemerkt; `SENT` erst nach Bestätigung des Empfängerservers.
- Geprüfte Datenübernahme mit Zellvergleich, Datei-Prüfsummen und Abrechnungsvergleich; optionaler vollständiger Apps-Script-Code mit zunächst inaktiver Umschaltsperre.
- Getrennter, zugangsgeschützter R2-Testbetrieb mit deaktivierten Schreib-/Zustellflags. Die ausdrücklich separate frische Drive-Konfiguration erlaubt den privaten Erststart und neue Buchungen; Zustellung und Automatik bleiben bis zur Abnahme aus.

## Neue Bedienung und Kalender

Die Oberfläche enthält Aufgabenreiter mit Statusfarben und aufklappbaren Details, Mehrfachzuordnung an Mitarbeiter, getrennte Monats-/Jahreskonten, Urlaubsübersichten, farbige Abgabematrizen und vereinfachte Stammdaten. Details und selten benötigte Angaben sind eingeklappt. Alte Nachrichten bleiben im Importbestand erhalten, sind in den Aufgabenansichten und Aufgaben-APIs ausgeblendet.

- **Firmenprofil → Hauptkalender-ID:** gemeinsamer Google-Kalender für Bereitschaften.
- **Mitarbeiter → Bearbeiten → Persönliche Kalender-ID:** Kalender der jeweiligen Person, optional. Die Google-Kalender-ID verwenden, keinen Freigabelink.
- **Haupt- und Mitarbeiterkalender aktivieren:** setzt das Firmenmodul voraus. Zusätzlich müssen Worker-Flag, Google-Servicekonto und Schreibrechte eingerichtet sein. Jeder Zielkalender muss für das Servicekonto mit Schreibrecht freigegeben werden. Kalender-IDs allein erteilen keinen Zugriff.
- Der festgelegte und veröffentlichte Bereitschaftsplan wird über den bisherigen Schritt „Kalender teilen“ in den Hauptkalender und die eingetragenen persönlichen Kalender übertragen. Ohne persönliche ID bleibt der bisherige Einladungsweg bestehen; bei direkter Spiegelung wird keine zusätzliche Einladung an dieselbe Person erzeugt.
- Aufgabenfristen erscheinen ganztägig im persönlichen Kalender. Änderungen aktualisieren den bestehenden Termin; nach endgültiger Kontrolle/Abschluss wird er entfernt. Zurückgesendete Aufgaben bleiben sichtbar; erneut geöffnete abgeschlossene Aufgaben erhalten einen neuen Termin. Ein Kalenderwechsel entfernt den bisherigen Spiegel.
- Änderungen werden zunächst dauerhaft vorgemerkt, anschließend über die Zustellwarteschlange abgearbeitet. Wiederholungen einer laufenden Übertragung erzeugen keine neuen Termine. Echte Google-Zustellung wurde lokal simuliert; eine Freigabe erfordert einen Test mit dem vorgesehenen Servicekonto.
- Die neue Pausen-Checkbox bestätigt eine tatsächlich genommene Pause. Bei mehr als sechs Stunden werden mindestens 30 Minuten berücksichtigt; vorhandene manuelle Pausen zählen mit. Ohne Pause bleiben die tatsächlichen Stunden erhalten, eine Abweichung kann vom Admin dokumentiert geprüft werden. Ein automatischer Hintergrund-Stopp erfindet keine Pause.
- Urlaub in Stunden wird nur mit hinterlegter Tagesstundenbasis oder passendem Büroprofil angezeigt. Bei flexiblen Modellen wird keine pauschale 8-Stunden-Annahme verwendet. Fehlt bei einem flexiblen Urlaub über Monats-/Jahresgrenzen die konkrete Tageszuordnung, zeigt die Teilperiodenübersicht „Zuordnung offen“ statt erfundener anteiliger Urlaubstage.

Die synthetische Oberflächenprüfung lässt sich nach dem Build mit `node tools/ui-preview.mjs` erstellen. Sie enthält ausschließlich Beispieldaten und deaktivierte Schreibzugriffe. Sie ist keine angebundene Staging-Instanz.

## Lokal prüfen

Node.js ab 22.13 installieren, dann im Ordner `cloudflare-native`:

```bash
npm ci
npm run build
npm test
npm run test:runtime
npm run bundle
```

`test:runtime` prüft den gebündelten Worker tatsächlich in workerd mit lokalen D1-/R2-Bindings. Es erfolgt keine Veröffentlichung. `dist/release` enthält den eigenständigen Worker, die Oberfläche, D1-Schema, vollständige optionale Freeze-Code.gs und Anleitungen. Die bestehenden 130 Regressionstests lassen sich zusätzlich aus dem Repository-Hauptordner mit `node --test tests/*.test.cjs` starten.

## Getrennte Cloudflare-Testumgebung einrichten

Einmalig über Wrangler im eigenen Cloudflare-Konto anmelden:

```bash
npx wrangler login
npx wrangler d1 create firetime-native-staging
npx wrangler r2 bucket create firetime-native-staging-files
```

Die zurückgegebene neue D1-ID in `wrangler.jsonc` statt `REPLACE_WITH_NEW_STAGING_D1_ID` eintragen. Ausschließlich eine neue, leere Datenbank verwenden; der alte API-Worker wird nicht überschrieben.

```bash
npx wrangler d1 migrations apply firetime-native-staging --remote
npx wrangler secret put STAGING_ACCESS_KEY
npx wrangler secret put FT_PEPPER
```

Als Testzugang mindestens 32 zufällige Zeichen setzen. `FT_PEPPER` exakt aus den bisherigen Apps-Script-Skripteigenschaften übernehmen, ausschließlich in die Secret-Eingabe. Nicht in eine Textdatei oder GitHub kopieren. Vorerst bleiben alle Flags auf `false`.

## Datenkopie exportieren und prüfen

1. `tools/FireTime_Cloudflare_Export.gs` als **zusätzliche** Datei im bestehenden Apps-Script-Projekt einfügen. Noch keine WebApp-Neubereitstellung notwendig; die Funktionen werden manuell im Editor ausgeführt.
2. `ft_cloudflareExportManifest` ausführen. Das liest die Datenbank und erstellt einen neuen privaten Exportordner. Es werden keine Stunden, Mitarbeiter, Kontostände oder Setup-Funktionen verändert. Nur Exportdateien und Export-Fortschrittseigenschaften werden neu angelegt.
3. `ft_cloudflareExportFilesNext` so oft ausführen, bis `remaining=0` und `missing=0`. Bei `missing>0` anhalten und die fehlenden Dateien klären.
4. Den vollständigen Exportordner herunterladen und lokal unter `cloudflare-native/private/export` entpacken. Erwartet: `private/export/data.json` und `private/export/files/<Datei-ID>`. Manche Drive-ZIP-Downloads fügen einen zusätzlichen äußeren Ordner ein; Pfad dann entsprechend anpassen.

```bash
node tools/migrate.mjs check private/export/data.json
node tools/reconcile.mjs private/export/data.json
node tools/migrate.mjs sql private/export/data.json private/import.sql
node tools/upload-files.mjs private/export/data.json firetime-native-staging-files --staging-only
npx wrangler d1 execute firetime-native-staging --remote --file private/import.sql
npx wrangler d1 export firetime-native-staging --remote --output private/staging-after-import.sql
node tools/migrate.mjs verify private/export/data.json private/staging-after-import.sql
```

Import nur in eine leere neue DB. Ein fehlgeschlagener umfangreicher CLI-Import kann teilweise geschrieben haben: in diesem Fall die neue Testdatenbank neu anlegen und erneut importieren, niemals mit vorhandenen Produktivdaten vermischen. Der Importer erzeugt keine Löschbefehle und überschreibt keine vorhandenen Datensätze.

Der Abrechnungsvergleich führt den originalen und den portierten Fachkern unabhängig auf derselben Exportkopie aus. Das bestätigt die Portierung, aber weder den Stand des tatsächlich bereitgestellten Apps Scripts noch die Richtigkeit der Quelldaten. Deshalb zusätzlich einige reale, freigegebene Monatsberichte mit den bisherigen Live-Anzeigen/PDFs vergleichen.

Nach erfolgreichem Import und Vergleich `WRITE_ENABLED` in der **Staging-Konfiguration** auf `true` setzen. `MIGRATION_MODE` bleibt `staging`, alle Zustell-/Automatikflags bleiben `false`.

```bash
npm run deploy:staging
```

Die von Cloudflare zurückgegebene Testadresse öffnen, den separaten Testzugang eingeben und mit einem bestehenden FireTime-Konto anmelden. Testdatenänderungen bleiben in dieser Datenkopie. Die Vorschau hat einen sichtbaren Testhinweis. Niemals jetzt die produktive GitHub-`config.js` ändern.

## E-Mail, Push und Kalender vorbereiten

| Dienst | Einstellungen/Secrets | Verhalten ohne Einrichtung |
|---|---|---|
| E-Mail | `MAIL_API_KEY`, verifizierter `MAIL_FROM`, `MAIL_ENABLED=true` | Kein Versand; Passwort-Reset kann nicht zugesagt werden |
| Push | bestehende `VAPID_PRIVATE_JWK`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `PUSH_ENABLED=true` | Keine echten Push-Nachrichten |
| Google Calendar | Neue Instanz: OAuth-Verbindung direkt in FireTime, siehe `docs/KALENDER.md`. Zentralen Webclient samt `/calendar-callback` konfigurieren. | Kunden verbinden ihr Google-Konto und wählen bestehende Kalender; keine Dienstkonten-Freigaben nötig |
| Automatik | `AUTOMATION_ENABLED=true`, `MIGRATION_MODE=production`, `CUTOVER_CONFIRMED=true`, `WRITE_ENABLED=true` | Keine Erinnerungen, keine automatische 19-Uhr-Schließung, keine Hintergrund-PDFs |

Im Staging werden selbst bei gesetzten Versand-Secrets keine Hintergrundzustellungen ausgeführt. Vor Produktion sind reale Zustelltests an ausdrücklich gewählten Testempfängern und Kalenderprüfung notwendig; lokale Tests ersetzen das nicht. Bereits installierte PWAs müssen für Push auf der neuen Adresse neu angemeldet werden. Bleibt die GitHub-Adresse bestehen und bleiben die VAPID-Schlüssel gleich, ist eine Übernahme der vorhandenen Geräte grundsätzlich möglich; auf echten iPhones prüfen.

## Grenzen und ausstehende Abnahme

- Kein Zugriff auf das produktive Cloudflare-Konto, den aktuellen Live-Sheet-Export oder dessen private Dateien war für diese Vorbereitung vorhanden. Es wurde nichts remote angelegt, importiert oder umgeschaltet.
- Nicht jede der 94 Aktionen wurde einzeln Ende-zu-Ende getestet. Die gleiche vorhandene Fachlogik wird wiederverwendet; die geprüften kritischen Abläufe sind in `docs/ABNAHME.md` festgehalten.
- Die Darstellung serverseitig erzeugter PDFs ist ein neuer, einfacherer Renderer. Enthaltene Zahlen/Texte bleiben aus dem Fachkern. Firmenlogos werden in diesem serverseitigen Renderer noch nicht eingebettet; die neue Cloudflare-Oberfläche nutzt den Vektor-Renderer für Monats- und Sammelberichte. Importierte PDFs bleiben erhalten. Vor Freigabe Sichtprüfung der mehrseitigen Berichte durchführen.
- Bestehende Daten werden verlustfrei als Datensätze mit indizierten JSON-Feldern in D1 gespeichert. Außer beim schlanken Login lädt ein Firmenaufruf zunächst den Firmenbestand; eine spätere fachweise SQL-Normalisierung ist möglich. Bei großen Datenmengen müssen reale Ladezeiten/CPU und Speicherverbrauch gemessen werden.
- Globale Versionsprüfung ist bewusst konservativ: viele gleichzeitig schreibende Firmen können Konflikte erzeugen. Unter Last vor einer Freigabe prüfen.
- Externe Zustellung ist mindestens einmal mit Wiederholungen; insbesondere Push kann nach einem Verbindungsabbruch doppelt eintreffen. E-Mails verwenden einen Idempotenzschlüssel, neue Kalendertermine stabile IDs. Provider-Zustellung ist keine Lesebestätigung.
- Das schlichte Health-Endpoint bestätigt Bindings/Flags, keine erfolgreiche Datenmigration.

**Produktivumschaltung erst nach `docs/ABNAHME.md` und `docs/UMSCHALTUNG.md`.**
