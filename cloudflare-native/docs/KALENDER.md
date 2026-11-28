# Google Kalender direkt in FireTime verbinden

Die neue Instanz verwendet `CALENDAR_AUTH=oauth` und `CALENDAR_ENABLED=true`. Die Drive-Verbindung des Systemadministrators bleibt eigenständig; Kalenderverbindungen gelten je Firma bzw. je Mitarbeiter. Dienstkonto-Schlüssel und manuelle Freigaben an Dienstkonten sind für diesen Ablauf nicht erforderlich. Die alte optionale Servicekonto-Anbindung bleibt nur für andere Konfigurationen erhalten.

## Einmalige zentrale Einrichtung

1. Google Calendar API im zentralen Projekt aktivieren.
2. Beim vorhandenen OAuth-Webclient diese zusätzliche autorisierte Weiterleitungsadresse exakt ergänzen:
   `https://firetime-pro-neu.firetime-pro.workers.dev/calendar-callback`
   Die vorhandene `/drive-callback`-Adresse beibehalten.
3. Vorhandene Secrets `GOOGLE_DRIVE_CLIENT_ID` und `GOOGLE_DRIVE_CLIENT_SECRET` werden auch für Kalender verwendet. Optional können ein separater Kalender-Webclient und die Secrets `GOOGLE_CALENDAR_CLIENT_ID` und `GOOGLE_CALENDAR_CLIENT_SECRET` eingesetzt werden. Bestehende Verbindungen sind an ihren Client gebunden; nach Clientwechsel neu verbinden.
4. Google Auth Platform → Datenzugriff: `openid`, `email`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly` und `https://www.googleapis.com/auth/calendar.events`. Zugriff umfasst Kalenderliste und Termine, keine Kalenderfreigaben/ACL-Verwaltung und keine Drive-Daten.
5. Während der Erprobung verbindende Google-Konten als Testnutzer ergänzen. Für Kundenbetrieb App veröffentlichen und Googles erforderliche Überprüfung abschließen. Im Testmodus können die Refresh-Tokens nach sieben Tagen ablaufen. Eine öffentliche Kundenfreigabe ist erst nach diesen zentralen Google-Schritten bestätigt.

## Firmenadmin

Firmenprofil → Google Kalender · Firma → Google Kalender verbinden → Google-Konto wählen → Kalenderzugriff bestätigen. Danach vorhandenen Kalender aus der Liste wählen oder dessen ID eingeben und „Kalender prüfen und speichern“ klicken. Die Auswahl „Hauptkalender der Firma“ legt den zentralen Firmenkalender fest; das aktiviert den Kalender für die Firma. Für die Kalenderfunktion muss das CALENDAR-Modul freigeschaltet sein.

Im selben Bereich können vorhandene Kalender Mitarbeitern zugeordnet werden, soweit das verbundene Firmenkonto Schreibrechte dafür hat. FireTime überprüft die Google-Zugriffsrolle owner/writer vor dem Speichern. Eine ID allein erteilt keine Rechte. Nicht abonnierte Kalender müssen zunächst im verbundenen Google-Konto vorhanden sein, damit die ID geprüft werden kann.

## Mitarbeiter

Mein Konto → Mein Google-Kalender → Google Kalender verbinden → Google-Konto wählen und bestätigen → eigenen bestehenden Kalender auswählen/ID eingeben → prüfen und speichern. Der Firmenadmin braucht keinen Zugriff auf dieses Google-Konto. Er kann darüber keine Kalenderliste auslesen. Nur der Mitarbeiter kann seinen persönlichen OAuth-Zugang verwenden. Firmenadmin und Systemadmin verwalten ihre Firmenverbindung; zentrale Drive-Einstellungen bleiben SYSADMIN-exklusiv.

## Übertragung

Veröffentlichte Bereitschaften werden über den vorhandenen Kalenderabgleich in den Hauptkalender und die zugeordneten persönlichen Kalender übertragen. Aufgabenfristen werden in persönliche Kalender gespiegelt. Das Verbinden allein veröffentlicht keine Dienstpläne. Neue/aktualisierte Aufgaben und Kalenderzuordnungen erzeugen den Abgleich. Bei Änderung oder Entfernung persönlicher Kalenderzuordnungen werden alte persönliche FireTime-Spiegeltermine zur Löschung vorgemerkt. Bereits veröffentlichte Hauptkalender mit Terminen dürfen vorerst nicht ohne separaten Bereinigungsablauf auf einen anderen Kalender umgestellt werden.

Kalenderzustellung funktioniert bei der neuen Konfiguration auch solange die übrigen Automationen noch deaktiviert sind. Die Warteschlange sendet dann ausschließlich Kalenderaufträge, keine E-Mails oder Push-Nachrichten. Versand wird erst nach Google-Bestätigung als SENT markiert; fehlgeschlagene Aufträge bleiben sichtbar in der Outbox und werden erneut versucht. Cron versucht offene Kalenderaufträge alle fünf Minuten. Hauptkalenderjobs speichern Firmenverbindung; persönliche Jobs speichern die konkrete bei der Zuordnung geprüfte Verbindung.

## Sicherheit und Prüfstand

Refresh-Tokens werden mit FT_PEPPER und AES-GCM verschlüsselt, an Verbindung und OAuth-Client gebunden und nie an die Oberfläche ausgegeben. OAuth-Status ist einmalig, zehn Minuten gültig und an eine aktive FireTime-Sitzung, Benutzerrolle, Firma und Weiterleitungsadresse gebunden. Ein Reconnect muss dasselbe Google-Konto verwenden. Firmenzugehörigkeit und persönliche Besitzrechte werden vor dem Google-Zugriff geprüft. Anbieter- und Verbindungswechsel können keine fremden Firmenjobs übernehmen.

Automatisierte Tests simulieren Google-Antworten: Firmen-/Mitarbeiterverbindung, Rollen, Firmenisolation, verschlüsselte Tokens, abgelaufene Sitzungen, einmaliger Callback, unvollständige Freigabe, schreibgeschützte Kalender, Auswahl bestehender Kalender, Haupt-/Personalkalenderzustellung und Kalenderbetrieb ohne andere Automationen. Die echte Google-Freigabe und ein sichtbarer Testtermin im Zielkalender müssen nach der zentralen Einrichtung noch durchgeführt werden.
