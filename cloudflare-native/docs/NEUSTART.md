# FireTime Pro frisch auf Cloudflare starten

Für Michael: keine Übernahme der bisherigen Testzugänge, Teststunden oder Testdateien. Bestehendes Testsystem bis zur erfolgreichen Prüfung unverändert lassen. Der neue Erstzugang soll `firetime.pro@gmail.com` sein. Das FireTime-Passwort wird erst im neuen System vom Nutzer selbst vergeben.

## Einmalige Einrichtung

1. Eine **neue** Cloudflare-Worker-App mit Static Assets, eine **neue leere D1-Datenbank** und einen privaten R2-Bucket anlegen. Der fertige Worker liegt als `FireTime_Cloudflare_Worker.js`, die Oberfläche als `public/` im Paket. Ein Pages-Upload nur der Oberfläche reicht nicht. Alternativ aus dem GitHub-Quellcode in `cloudflare-native` bauen und mit Wrangler veröffentlichen. Vor dem Deploy die neue D1-ID, Bucket- und Worker-Namen in einer eigenen Konfiguration einsetzen.
2. Worker-Bindings setzen: D1 `DB`, R2 `FILES`, statische Dateien `ASSETS`. Kompatibilitätsflag `nodejs_compat` verwenden. Den Worker vor den Assets ausführen lassen; andernfalls funktionieren `/api` und `/first-start` nicht.
3. **Secrets direkt in Cloudflare** eintragen, nicht in GitHub oder Chat: `FT_PEPPER` (neuer zufälliger dauerhafter Passwortschlüssel, mindestens 32 Zeichen) und `FIRST_START_KEY` (anderer zufälliger Einrichtungsschlüssel, mindestens 32 Zeichen). `FT_PEPPER` privat sichern und später nicht ändern: bestehende Passwort-Hashes hängen davon ab.
4. Für ausschließlich diese neue Instanz setzen: `MIGRATION_MODE=production`, `WRITE_ENABLED=true`, `CUTOVER_CONFIRMED=true`, `FIRST_START_ENABLED=true`. `PUBLIC_ORIGINS` auf die tatsächlich verwendeten App-Adressen begrenzen. `FT_PUBLIC_GITHUB_URL` auf die neue App-Adresse setzen, damit Links und Erinnerungen dorthin zeigen. E-Mail, Push, Kalender und Automatik zunächst `false` lassen.
5. Die neue Worker-Adresse mit `/first-start` öffnen. Einrichtungsschlüssel, Systemadmin-E-Mail und ein neues FireTime-Passwort (mindestens 14 Zeichen, zweimal) eingeben. Erst nach Schlüssel- und Eingabeprüfung wird das D1-Schema automatisch angelegt. Es entstehen nur ein Systemadmin, BSB3100, die Modulfreigaben und das Firmenprofil; keine Testmitarbeiter und keine Beispieldienste.
6. Die Einrichtung sperrt sich bei vorhandenen Daten selbst. Danach zusätzlich `FIRST_START_ENABLED=false` setzen und `FIRST_START_KEY` entfernen. Über „Zur Anmeldung“ anmelden. Als Systemadmin BSB3100 öffnen. Firmenadmin und Mitarbeiter im System anlegen; Monats-Soll, Lohn und belegte Urlaubssalden bewusst eingeben. Für BSB3100 gilt bei den vorgesehenen Mitarbeitern 25 Stunden Monatssoll; dies wird nicht pauschal jedem beliebigen neuen Mitarbeiter aufgedrängt.

Die Ersteinrichtung verweigert bestehende Datensätze, Dateien, Eigenschaften, Import-/Zustellbestände und fremde Datenbanktabellen. Zwei gleichzeitige Erststarts dürfen nur einen Systemadmin erzeugen. Bei einer verwaisten, teilweise fehlgeschlagenen Initialisierung keine Daten löschen: zuerst den Zustand prüfen.

## Anschließend die echten Dienste verbinden

- **E-Mail:** Resend-Schlüssel und verifizierten Absender konfigurieren, danach `MAIL_ENABLED=true`. Ohne E-Mail-Anbindung sind Einladungen und Passwort-Reset per E-Mail nicht verfügbar. Keine unbestätigte Gmail-Absenderadresse bei einem Fremdanbieter verwenden.
- **Push:** VAPID-Schlüsselpaar konfigurieren; anschließend Geräte in der neuen App neu anmelden und Push freigeben. Neue Adresse bedeutet neue PWA-/Push-Berechtigungen.
- **Kalender:** Google-Servicekonto anbinden. Hauptkalender sowie persönliche Mitarbeiterkalender mit Schreibrecht für das Servicekonto freigeben, IDs im Firmenprofil bzw. Mitarbeiterdatensatz eintragen und die Kalenderfunktion aktivieren. Echte Zustellung mit einem vorgesehenen Testtermin kontrollieren.
- **Automatik:** Erst nach Prüfung der Zustellwege `AUTOMATION_ENABLED=true` und Cron alle fünf Minuten aktivieren. Dann greifen Erinnerungen, Zustellung und zeitgesteuerte Abläufe.

## Vor Weitergabe an Mitarbeiter prüfen

Neuer Systemadmin-Login, neue Mitarbeiteraktivierung, ein echter Zeiteintrag, korrekte Pause, BSB3100-Sollstunden, Urlaub, PDF, Bereitschaftsbestätigung, Haupt-/Mitarbeiterkalender und Aufgabenfrist. Erst danach den bisherigen FireTime-Link auf diese Instanz umstellen. Ein kurzer lokaler Test ersetzt diese Online-Abnahme nicht.
