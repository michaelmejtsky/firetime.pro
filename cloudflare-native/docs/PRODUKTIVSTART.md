# FireTime Pro 2.1.0 – BSB3100 Produktivpilot

Die neue Worker-Instanz ist eine eigenständige Produktivinstanz. Daten des Piloten sind echte Firmenbuchungen und bleiben erhalten. Start der regulären Verwendung ist für Jänner 2027 vorgesehen; Mitarbeiter und Umfang legt der Firmenadmin fest. Es werden keine Beispielmitarbeiter oder Teststunden erzeugt. Die alte App und die Hauptbranch werden nicht umgeschaltet oder gelöscht.

## Aktivierter Betrieb

`wrangler.fresh.jsonc`: MIGRATION_MODE=production, WRITE_ENABLED=true, CUTOVER_CONFIRMED=true, FIRST_START_ENABLED=false, AUTOMATION_ENABLED=true, CALENDAR_ENABLED=true mit OAuth, MAIL_ENABLED=true mit Gmail, PUSH_ENABLED=true. Cron läuft alle fünf Minuten. Native Frontend-Kennzeichnung und Manifest verwenden Version 2.1.0 ohne Testbanner. PWA-Start und Push-Ziele verwenden den neuen Worker-Rootpfad.

Die Flags allein bestätigen keine externe Zustellung. In der Systemadmin-Kundenverwaltung zeigt „Systembetrieb“ den Verbindungsstand und die Outbox-Statuszahlen. Gmail-Freigabe, tatsächlicher Versand an den Firmenadmin, Kalenderfreigabe und Push-Empfang am Handy müssen online bestätigt werden.

## Zentrale Gmail-Freigabe

1. Gmail API im Google-Cloud-Projekt FireTime Pro aktivieren.
2. Beim bestehenden Webclient zusätzlich die autorisierte Weiterleitungsadresse `https://firetime-pro-neu.firetime-pro.workers.dev/gmail-callback` ergänzen; Drive-/Kalender-Callbacks beibehalten.
3. Google Auth Platform → Datenzugriff: `https://www.googleapis.com/auth/gmail.send` sowie openid/email zulassen. Es wird nur Sendeberechtigung verlangt; das Postfach wird nicht gelesen.
4. In FireTime als Systemadmin Kundenverwaltung → Systembetrieb → Gmail-Versand verbinden. Das vorgesehene Konto firetime.pro@gmail.com wählen und Sendefreigabe bestätigen. Andere Konten werden abgewehrt.
5. Die bestehende Drive-Verbindung bleibt getrennt. Gmail-Tokens werden AES-GCM-verschlüsselt in D1 gespeichert und an den zentralen Client gebunden.

Gmail-Zustellaufträge werden erst nach einer Google-Message-ID als SENT markiert. Bei unklarer Netzwerkantwort wird nicht blind erneut gesendet: Der Auftrag erhält ERROR und der Gesendet-Ordner muss vor erneutem Versand geprüft werden. Bekannte temporäre Ablehnungen werden mit Rückstellung erneut versucht. Googles Versand- und Kontolimits gelten. Solange der zentrale Google-Webclient im Testmodus steht, sind dessen Nutzer-/Tokenbeschränkungen relevant; vor Kundenfreigabe den Google-Veröffentlichungsstatus und erforderliche Prüfung erledigen.

## BSB3100 Firmenadmin

Nach erfolgreicher Gmail-Freigabe wird genau ein Firmenadmin für office@bsb3100.at mit Namen „BSB3100 Büro“ angelegt, sofern die Adresse noch nicht anders zugeordnet ist. Der Autorisierungsvorgang stößt dies unmittelbar an, der Cron dient als Wiederholung bei technischen Unterbrechungen. Ein bestehender Zugang wird nicht überschrieben. Die Einladung wird einmalig vorgemerkt und über Gmail versendet. Der Empfänger legt sein Passwort selbst fest. Bei vorhandenem unaktiviertem Konto wird nur dann eine erste Einladung erzeugt, wenn noch kein Einladungsdatensatz existiert.

Die eigentliche App-Logik erzeugt keine weiteren Mitarbeiter. Der Firmenadmin legt seine ausgewählten Mitarbeiter an und lädt sie ein. Für den administrativen Zugang werden keine Sollstunden, Verdienste oder Urlaubsansprüche erfunden (0; keine Mitarbeiterabrechnung). Für echte Mitarbeiter sind Monatsstunden, Beschäftigungsbeginn, Abrechnungsbeginn (bei Start Jänner 2027: 2027-01), Stunden-Startsaldo und tatsächlicher Urlaub nach den jeweiligen Unterlagen einzutragen. Eine konfigurierte Pilot-Adresse wird nicht für globale Zugriffe privilegiert; der Zugang ist ADMIN nur innerhalb BSB3100.

## Push und Automationen

Push-Schlüssel entstehen einmalig im Backend, bleiben über Updates stabil und liegen verschlüsselt in D1. Eine vorhandene explizite VAPID-Konfiguration wird beibehalten. Mehrere gleichzeitige Initialisierungen verwenden nach dem atomaren Insert denselben gespeicherten Schlüssel. Private Schlüssel werden nicht an die App ausgegeben.

Automationen: Stempeluhr-Autostopp, bestehende Erinnerungen und PDF-Hintergrundverarbeitung. Drive-/PDF-Fehler können bereits erfolgte Zeitabschlüsse nicht zurückrollen. Push braucht je Gerät eine ausdrückliche Browserfreigabe. Auf iPhone/iPad muss die PWA korrekt installiert sein; Empfang wird auf den tatsächlichen Geräten geprüft.

## Prüfstand

Automatisierte Tests umfassen Gmail-SYSADMIN-/Kontoprüfung, einmalige OAuth-Rückmeldung, verschlüsselte Tokens, MIME/Empfängerprüfung, tatsächliche API-Bestätigung vor SENT, Abwehr von Doppelversand bei unklarem Ergebnis, parallele stabile Push-Initialisierung sowie einmalige Firmenadmin-Anlage und Einladung nach Gmail-Verbindung. Google-Antworten sind simuliert. Der echte Firmenadmin-Empfang, Kalender und Geräte-Push bleiben Live-Prüfungen.
