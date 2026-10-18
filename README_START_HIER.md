# FireTime Pro – EIN Code für GitHub

**Developed by Michael Mejtsky**

## Ergebnis des automatischen GitHub-Neuaufbaus

Nach dem Commit von `.github/workflows/START.yml` erstellt der Workflow automatisch
alle Dateien in diesem Repository:

- `index.html`, `config.js`, `manifest.webmanifest`, `sw.js`, `assets/firetime.svg` – eigenständige responsive Website/PWA.
- `apps-script/Code.gs` – **VOLLSTÄNDIGER Apps-Script-Backendcode IN EINER DATEI** (Arbeitszeiten, Bereitschaft, Reports, Urlaub, Verwaltung, Module, Anmeldung, API).
- `apps-script/appsscript.json` – Apps-Script-Projekteinstellungen.
- `cloudflare/worker.js` – sichere Verbindung: HMAC-signierte Backend-Aufrufe.
- `.github/workflows/pages.yml` – GitHub Pages für spätere Änderungen.

**Keine Supabase-Dateien und kein iframe.** Der GitHub-Generator führt keine Aktionen in deinen Google- oder Cloudflare-Konten aus.

## Nach dem grünen GitHub-Neuaufbau – nur einmalig einrichten

**A – Google Apps Script:**

1. Das ALTE BSB3100-Google-Sheet und alte Apps-Script-Projekt **nicht löschen oder überschreiben**. Vor Änderungen Sicherungskopie anlegen.
2. Neues eigenständiges Google Apps Script-Projekt anlegen. Den **gesamten Inhalt** von `apps-script/Code.gs` als einzige Skriptdatei `Code.gs` einfügen. Unter **Projekteinstellungen** den Inhalt von `apps-script/appsscript.json` als Manifest übernehmen. Nicht parallel andere FireTime-Codedateien doppelt einfügen.
3. In **Projekteinstellungen → Skripteigenschaften** definieren:
   - `FT_DB_ID`: ID der vorhandenen **FireTime-Pro-Google-Sheets-Datenbank** (nur nach Sicherung; zuerst mit Testkopie starten). **Nicht** eine andere normale Google-Tabelle.
   - `FT_ROOT_ID`: ID des passenden FireTime-Pro-Systemordners in Google Drive.
   - `FT_PEPPER`: alter FireTime-Pro-Pepper aus dem alten Apps Script, **nur falls dessen bestehende Benutzer-Hashes weiterverwendet werden**. Ohne den alten Pepper sind alte Passwörter nicht nutzbar. Nie öffentlich veröffentlichen!
   - `FT_PUBLIC_GITHUB_URL`: `https://michaelmejtsky.github.io/firetime.pro/`
   - `FT_GATEWAY_KEY`: neu erzeugter langer Zufallsschlüssel mit mindestens 48 Zeichen. Nicht auf GitHub eintragen!
4. Neue Apps-Script-WebApp bereitstellen: **Ausführen als Ich**, Zugriff **Jeder**. Das `doGet` ist absichtlich nur noch ein Hinweis; **alle `doPost`-API-Aufrufe müssen gültig signiert sein**. Diese Sicherheitskonfiguration vor echtem Kundeneinsatz überprüfen. WebApp-URL `/exec` notieren.
5. **Weder `ft_setup()` noch `ft_install()` auf der vorhandenen Datenbank starten.** Keine automatische Datenmigration. Für den ersten Test die Datenbank kopieren, statt direkt produktive BSB3100-Daten zu verändern.

**B – Cloudflare Worker:**

1. Unter Cloudflare → Workers & Pages → Worker erstellen (z. B. `firetime-pro-api`). Vollständigen Inhalt von `cloudflare/worker.js` verwenden.
2. In den **Worker-Secrets/Variablen** hinterlegen:
   - `PUBLIC_ORIGIN` (Text): `https://michaelmejtsky.github.io`
   - `GAS_WEBAPP_URL` (Secret): Google-WebApp-`/exec`-Adresse
   - `GAS_SHARED_KEY` (Secret): exakt derselbe Schlüssel wie `FT_GATEWAY_KEY`
3. Worker aktivieren. Die öffentliche Worker-URL notieren.

**C – GitHub:**

1. Unter **Settings → Pages → Build and deployment → Source**: **GitHub Actions** auswählen (falls noch nicht aktiviert).
2. In `config.js` die **öffentliche** Adresse `https://<dein-worker>.workers.dev/api` bei `window.FT_API_URL` eintragen. **Kein Secret.**
3. GitHub Pages prüfen: `https://michaelmejtsky.github.io/firetime.pro/`.

## Funktionstests, bevor du Kunden oder echte Lohndaten einsetzt

- Systemadmin öffnet die **Systemzentrale**; nicht automatisch BSB3100.
- BSB3100 ist erster Kunde, aber es werden keine alten Daten automatisch migriert.
- Kunden-/Modulrechte sind auch bei direkten API-Aufrufen getrennt.
- Nur SYSADMIN darf gebuchte Module freischalten.
- Unabhängiger Arbeitsdienstplan; 24-Stunden-Bereitschaft und tatsächliche Einsätze separat.
- BSB3100: Eine Störung pausiert die Bereitschaft; freiwillige Objektkontrolle nicht.
- Nacht-/Sonntag-/Feiertagsstunden, Urlaubsansprüche, Monatsberichte und Zeitumstellungen (Europa/Wien).
- Mail-Einladungen gehen auf die GitHub-URL.
- Rate Limits, Passwort-Hashing, Sicherungen, Datenschutz/AV-Verträge, österreichische arbeits- und kollektivvertragliche Regeln fachlich prüfen.

## Wichtige Grenze

Das GitHub-Repo wird **vollständig erzeugt**, aber Google- und Cloudflare-Konten
sind ohne ausdrückliche Verbindung und gesicherte Zugangsdaten nicht automatisch
deploybar. **Dieser Code-Stand ist ein Test-/Pilotstand und noch nicht als
verkaufsfertiges SaaS abgenommen.** Für den Verkauf sind Live-End-to-End-,
Sicherheits-, Datenschutz- und Lohnberechnungstests nötig.
