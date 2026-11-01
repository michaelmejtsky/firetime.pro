# Aufgaben und Arbeitszeitübersicht – Version 1.8.26

Aufgaben laufen durch vier getrennte Status: Neu (`OPEN`), Angenommen
(`ACCEPTED`), Erledigt – zur Kontrolle (`DONE`), Abgeschlossen (`CLOSED`).
Nur die zugewiesene Person nimmt Aufgaben an und meldet sie mit einem echten
JPEG- oder PNG-Foto als erledigt. Nur der administrative Auftraggeber darf eine
erledigte Aufgabe nach Kontrolle abschließen. Eine Rückgabe zur Nachbearbeitung
benötigt eine Begründung; anschließend muss die Aufgabe erneut angenommen werden.
Fotos und Rückmeldungen bleiben in der Unterhaltung erhalten. Bestehende
`DONE`-Aufgaben bleiben erledigt zur Kontrolle und werden nicht automatisch
abgeschlossen. Es werden keine Datensätze oder Tabellenspalten migriert.

Die Übersicht bietet Mitarbeitern und Administration vier Statusfilter sowie
hervorgehobene Fristen. Normale private Nachrichten sind weiter verfügbar;
Mitarbeiter können keine Aufgaben erstellen. Die bisherigen Firmen- und
Teilnehmergrenzen bleiben bestehen.

Die eigene Mitarbeiter-Zeitübersicht zeigt das Datum pro Eintrag einmal,
Von-bis-Uhrzeit, Nettozeit und Pause. Bei mehrtägigen Einträgen erscheint auch
das Enddatum. Die administrative Gesamtübersicht behält die Mitarbeiternamen.

## Aktivierung

1. Den vollständigen Inhalt von `apps-script/Code.gs` im bestehenden
   Apps-Script-Projekt ersetzen und speichern.
2. Unter **Bereitstellen → Bereitstellungen verwalten → Bearbeiten** eine
   **neue Version** der bestehenden Web-App bereitstellen. Die bestehende
   Bereitstellung und ihre URL weiterverwenden.
3. FireTime Pro neu öffnen bzw. aktualisieren. Die Oberfläche zeigt V1.8.26.

Kein `ft_setup()` oder `ft_install()` ausführen. Bestehende Skripteigenschaften,
Datenbank, Drive-Dateien und Trigger weiterverwenden. Für den Worker ist keine
Änderung nötig. Der Repository-Commit allein veröffentlicht das Apps Script nicht.

## Prüfung

`node --test tests/*.test.cjs`

Isolierte Tests prüfen die Statusübergänge, Rollen- und Firmengrenzen,
Fotopflicht, Rückgabe mit Verlauf, Benachrichtigungsempfänger, Statusfilter,
Namensanzeige sowie Datums-/Uhrzeitdarstellung mit Europe/Vienna.
