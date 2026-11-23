# FireTime Pro frisch auf Cloudflare starten

Stand 23.11.2026. Keine Übernahme der bisherigen Testzugänge, Teststunden oder Testdateien. Der neue Erstzugang soll `firetime.pro@gmail.com` sein. Das FireTime-Passwort legt der Nutzer selbst im neuen System fest. Die private Dateiablage verwendet Google Drive; **R2 ist für diesen Neustart nicht erforderlich**.

## Bereits festgelegt

- Neuer Worker: `firetime-pro-neu`
- D1: `firetime-pro-db`, ID `36e16881-02fb-4c25-90a0-b6c326caa846`
- Cloudflare-Konto: `6f5bdd91743514e54696c78b05fba911`
- Konfiguration: `wrangler.fresh.jsonc`
- Drive-Konto: `firetime.pro@gmail.com`

## Neue App aus GitHub bereitstellen

Im Cloudflare-Dashboard unter Workers & Pages eine **neue** Anwendung mit dem Repository `michaelmejtsky/firetime.pro` verbinden. Diese Einstellungen verwenden:

| Feld | Wert |
|---|---|
| Worker-Name | `firetime-pro-neu` |
| Branch | `codex/cloudflare-migration` |
| Root directory | `cloudflare-native` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy --config wrangler.fresh.jsonc` |

Die vorhandene Hauptbranch und das bisherige Apps-Script-Testsystem werden nicht umgeschaltet. Die neue Konfiguration enthält D1, Static Assets und `nodejs_compat`, aber keine R2-Bindung. Die erste Veröffentlichung kann bereits ohne Google-Verbindung erfolgen.

## Eigenen Erstzugang anlegen

1. Direkt bei dem **neuen** Worker unter Settings zwei verschiedene zufällige **Secrets** hinterlegen: `FT_PEPPER` und `FIRST_START_KEY`, jeweils mindestens 32 Zeichen. Nicht in GitHub oder Chat eintragen. `FT_PEPPER` privat sichern und später nicht wechseln: Passwort-Hashes und verschlüsselte Google-Tokens hängen davon ab.
2. Die frische Konfiguration setzt `MIGRATION_MODE=production`, `WRITE_ENABLED=true`, `CUTOVER_CONFIRMED=true`, `FIRST_START_ENABLED=true`, `FILE_STORAGE=drive`. Das gilt ausschließlich für diese neue Instanz. Versand, Kalender und Automatik bleiben vorerst aus.
3. Neue Worker-Adresse mit `/first-start` öffnen. Einrichtungsschlüssel, Systemadmin-E-Mail und neues FireTime-Passwort (mindestens 14 Zeichen, zweimal) selbst eingeben. Nach Prüfung werden Schema, Systemadmin, BSB3100, Firmenprofil und Module angelegt. Es entstehen keine Testmitarbeiter oder Beispieldienste. Die App-Adresse für spätere Links wird von der tatsächlichen Erststart-Adresse übernommen.
4. Danach `FIRST_START_ENABLED=false` setzen und das Secret `FIRST_START_KEY` entfernen. Wichtig: Bei GitHub-Deployments die Flag ebenfalls in `wrangler.fresh.jsonc` auf `false` ändern, damit spätere Deploys sie nicht wieder aktivieren. Vorhandene Daten sperren die Einrichtung zusätzlich dauerhaft.
5. Anmelden und BSB3100 öffnen. Firmenadmin und Mitarbeiter anlegen; Monatssoll, Lohn und belegte Urlaubssalden bewusst eingeben. Bei den vorgesehenen BSB3100-Mitarbeitern gilt 25 Stunden Monatssoll. Dies wird nicht pauschal jedem beliebigen Mitarbeiter aufgedrängt.
6. Die Drive-Anbindung nach **GOOGLE_DRIVE.md** einrichten. Die Verbindung wird dem Systemadmin direkt in der Kundenverwaltung sowie im Firmenprofil angezeigt. Ein Upload kann erst nach erteilter Google-Freigabe funktionieren.

Die Ersteinrichtung verweigert vorhandene Datensätze, Dateien, Integrationsbestände und fremde Datenbanktabellen. Zwei parallele Erststarts dürfen nur einen Systemadmin erzeugen. Bei einer unklaren Teilinitialisierung den Zustand prüfen, keine bestehenden Datensätze löschen.

## Anschließend echte Dienste verbinden

- **Drive:** separater Google-OAuth-Web-Client mit Drive API und `drive.file`; private Dateiablage im vorgesehenen Konto. Ausführliche Schritte in GOOGLE_DRIVE.md. Der Google-Veröffentlichungsstatus Testing genügt nicht für dauerhafte Refresh-Tokens.
- **E-Mail:** Resend-Schlüssel und verifizierten Absender konfigurieren, dann `MAIL_ENABLED=true`. Ohne E-Mail-Anbindung sind Einladungen und Passwort-Reset per E-Mail nicht verfügbar. Keine unbestätigte Gmail-Adresse als Absender beim Fremdanbieter verwenden.
- **Push:** VAPID-Schlüsselpaar konfigurieren. Geräte auf der neuen Adresse neu anmelden und Push freigeben.
- **Kalender:** Kalender-Servicekonto anbinden, Haupt- und Mitarbeiterkalender mit Schreibrecht freigeben und IDs eintragen. Die Drive-Freigabe allein erteilt keine Kalenderrechte.
- **Automatik:** Erst nach Prüfung der Zustellwege `AUTOMATION_ENABLED=true` setzen; der Cron ist alle fünf Minuten vorkonfiguriert. Produktive Versand-/Automatikflags ebenfalls im Quellcode dauerhaft nachziehen.

Vor Weitergabe an Mitarbeiter Login, Aktivierung, Zeiteintrag, Pause, Sollstunden, Urlaub, PDF, Foto, Bereitschaftsbestätigung und echte Kalenderübertragung prüfen. Erst dann den bisherigen FireTime-Link umstellen. Lastzeiten und iPhone/PWA brauchen eine eigene Online-Abnahme.
