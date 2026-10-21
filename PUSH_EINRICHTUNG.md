# FireTime Pro 1.8.8 – Echte Hintergrund-Push-Mitteilungen

## Status
Der Code enthält echte Web-Push-Funktionen. **Noch nicht produktiv aktiv**, bevor die Cloudflare-Worker-Secrets gesetzt, der neue Worker veröffentlicht und die Apps-Script-Eigenschaft gesetzt sind. Bestehende E-Mails bleiben aktiv. Für eine Push-Einrichtung ist kein Apple-Developer-Konto nötig.

Die Integration nutzt die GitHub-Pages-Web-App \`https://michaelmejtsky.github.io/firetime.pro/\`, den vorhandenen Cloudflare API Worker \`firetime-pro-api\` und das bestehende Apps Script. Es gibt keine neue kostenpflichtige Push-Plattform.

## Einmalige Einrichtung

### 1. VAPID-Schlüssel lokal erzeugen
Nur auf einem eigenen Computer mit Node.js 22 oder höher:

\`\`\`bash
node tools/generate-vapid.mjs DEINE-EMAIL@DEINE-DOMAIN.AT
\`\`\`

Der Befehl erzeugt drei Werte. **Den Wert \`VAPID_PRIVATE_JWK\` niemals in GitHub oder einen Chat posten.** Er ist der geheime Signaturschlüssel für Push. Ein neues Schlüsselpaar ersetzt nicht automatisch bereits registrierte Push-Abonnements. Schlüssel deshalb sicher aufbewahren.

### 2. Cloudflare Worker aktualisieren
Unter Cloudflare → **Workers & Pages → firetime-pro-api** den Quellcode durch die vollständige Datei \`cloudflare/worker.js\` aus \`main\` ersetzen und neu veröffentlichen. Die existierenden Secrets und Variablen **nicht löschen**.

Drei **zusätzliche** Einstellungen beim API Worker hinterlegen:

| Name | Typ | Wert |
| --- | --- | --- |
| \`VAPID_PRIVATE_JWK\` | **Secret** | Ausgabe aus Schritt 1: JSON |
| \`VAPID_PUBLIC_KEY\` | Textvariable | Ausgabe aus Schritt 1: öffentlicher Base64URL-Key |
| \`VAPID_SUBJECT\` | Textvariable | \`mailto:DEINE-EMAIL@DEINE-DOMAIN.AT\` |

Diese bestehenden Einstellungen unverändert lassen: \`GAS_WEBAPP_URL\`, \`GAS_SHARED_KEY\` und \`PUBLIC_ORIGIN=https://michaelmejtsky.github.io\`.

Die neue Worker-Route \`/internal/push\` akzeptiert ausschließlich kurzlebige, mit dem bestehenden \`GAS_SHARED_KEY\` signierte Anforderungen aus Apps Script. Der Browser erhält **nie** den privaten VAPID-Schlüssel.

### 3. Google Apps Script aktualisieren
In dem bestehenden produktiven Google Apps Script die **vollständige** \`apps-script/Code.gs\` aus \`main\` einsetzen und neue Web-App-Version veröffentlichen.

In **Projekteinstellungen → Skripteigenschaften** genau **eine neue Eigenschaft** ergänzen:

\`\`\`
FT_PUSH_WORKER_URL = https://firetime-pro-api.firetime-pro.workers.dev
\`\`\`

Die Worker-Adresse ohne \`/api\` oder \`/internal/push\` eintragen. Falls deine öffentliche API-Worker-URL anders heißt, nimm dieselbe Origin wie in \`config.js\`, jedoch ohne \`/api\`. \`FT_GATEWAY_KEY\` und alle bestehenden Einstellungen **nicht verändern**.

**Wichtig: Apps-Script-Manifest:** Weil Web Push `UrlFetchApp.fetch` verwendet, benötigt dein Apps Script den zusätzlichen OAuth-Scope `https://www.googleapis.com/auth/script.external_request`. Die vollständige korrigierte `apps-script/appsscript.json` liegt im Repository. Im Apps Script unter **Projekteinstellungen → Appsscript.json-Manifestdatei im Editor anzeigen** aktivieren, im Editor `appsscript.json` öffnen und die komplette Datei aus GitHub übernehmen. Die anderen Berechtigungen nicht löschen.

**Berechtigung einmalig bestätigen:** Nach dem Speichern im Apps Script die harmlose Funktion `ft_pushBerechtigungPruefen_EINMAL` im Funktionsmenü wählen und über **Ausführen** starten. Wenn Google eine neue Berechtigung verlangt, als Eigentümer zulassen. Diese Funktion bereitet nur eine Beispielanfrage auf und verschickt **keine** Nachricht oder Netzwerkanfrage und ändert keine Tabellen. Anschließend im Bereitstellungsmenü eine **neue Web-App-Version** veröffentlichen.

**Keine Setup-, Installations- oder Upgrade-Funktion ausführen.** Die optionale Tabelle \`PushDevices\` entsteht erst bei der ersten Geräteaktivierung.

### 4. Mitarbeiter richten Push selbst ein
1. Die App unter **https://michaelmejtsky.github.io/firetime.pro/** öffnen. Die App muss **V1.8.8** anzeigen.
2. Auf dem iPhone (iOS 16.4+) die Seite in Safari öffnen, über **Teilen → Zum Home-Bildschirm** installieren und anschließend **vom Home-Bildschirm aus** starten. Unter Android einen Browser mit Web-Push nutzen.
3. Anmelden → **Nachrichten & Aufgaben → Benachrichtigungen** → **Push aktivieren**.
4. Berechtigung erlauben und **Testbenachrichtigung senden**.
5. Der Bereich soll **Push aktiv**, **Dieses Gerät: Registriert** und **E-Mail: Weiterhin aktiv** anzeigen.

Jeder Mitarbeiter kann Push auf mehreren Geräten aktivieren (max. fünf). Mit **Auf diesem Gerät deaktivieren** werden Anmeldung und Push-Abonnement dieses Geräts entfernt, ohne die Nachrichten oder Zeitaufzeichnungen zu löschen.

## Bei welchen Ereignissen?
- Neue Direktnachricht vom Firmenadministrator oder von einem Kollegen.
- Antwort in einer Unterhaltung.
- Neue Aufgabe oder geänderter Aufgabenstatus.
- Erinnerung am Vormittag des Vortags einer noch offenen Aufgabe, sofern der bestehende \`ft_tick\`-Trigger läuft.

Die Push-Mitteilung zeigt nur einen kurzen Hinweis, **keinen vertraulichen Nachrichtentext oder Fotos**. Sie führt zum geschützten Nachrichtenbereich. E-Mail bleibt zusätzlich bestehen. Geräte ohne Push bleiben vollständig nutzbar.

## Hinweise / Diagnose
- **Nicht eingerichtet:** Eines der Cloudflare-Secrets fehlt, der Worker wurde nicht aktualisiert, oder \`FT_PUSH_WORKER_URL\` fehlt in Apps Script.
- **Nicht aktiviert:** Der Push-Dienst ist bereit, dieses Gerät hat sich aber noch nicht registriert.
- **Blockiert:** Im Gerät die Mitteilungsberechtigung für die Home-Bildschirm-App prüfen.
- **Test versendet, aber nichts am Handy:** Mitteilungseinstellungen, Fokusmodus, Service Worker und Internetverbindung prüfen. „Versendet“ bedeutet Annahme durch den Push-Dienst, nicht garantierte Sichtbarkeit.
- **Alte Cloudflare-Webseitenadresse:** Die alte UI-Adresse \`firetime-pro.firetime-pro.workers.dev\` ist unabhängig von GitHub Pages und wird durch GitHub-Merge nicht automatisch aktualisiert.
- Cloudflare Worker muss ausgehend \`https://web.push.apple.com\`, \`https://fcm.googleapis.com\` und \`https://updates.push.services.mozilla.com\` erreichen können.
- Bei Chrome/Android kann die Zustellung vom Energie-Sparmodus oder den Systemeinstellungen beeinflusst werden.

Alle Änderungen sind auf das Kommunikationsmodul begrenzt. Bestehende Personaldaten, Arbeitszeitregeln und Bereitschaftsabwicklung bleiben erhalten.
