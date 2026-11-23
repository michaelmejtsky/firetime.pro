# Private Google-Drive-Dateiablage

Der neue FireTime-Start nutzt `FILE_STORAGE=drive`. D1 enthält weiterhin die strukturierten Mitarbeiter-, Stunden-, Aufgaben- und Urlaubsdaten. Drive speichert die privaten Dateien. R2 wird bei dieser Konfiguration nicht angelegt oder benötigt. Das bestehende Apps-Script-Backend wird dafür nicht aufgerufen.

## Google einmalig einrichten

1. Im Google-Konto `firetime.pro@gmail.com` in der Google Cloud Console ein separates Projekt für FireTime Pro auswählen oder erstellen. Die **Google Drive API** aktivieren.
2. Unter **Google Auth Platform** die App einrichten. Nur den Scope `https://www.googleapis.com/auth/drive.file` verwenden. FireTime braucht keinen Zugriff auf den gesamten bestehenden Drive-Bestand. Bei einem Gmail-Konto ist die Zielgruppe extern; für einen ersten Test das vorgesehene Konto als Testnutzer eintragen.
3. Unter **Clients** einen OAuth-Client vom Typ **Web application** erstellen. Als autorisierte Weiterleitungsadresse exakt die neue FireTime-Adresse mit `/drive-callback` eintragen. Die vollständige Adresse zeigt FireTime dem angemeldeten Systemadmin im Bereich „Dateiablage · Google Drive“ an. Keine Anmeldecodes oder temporären URLs aus der Browserleiste eintragen.
4. Die Client-ID im neuen Cloudflare-Worker als `GOOGLE_DRIVE_CLIENT_ID` hinterlegen, das Client-Secret als **Secret** `GOOGLE_DRIVE_CLIENT_SECRET`. Secrets nicht in Chat, GitHub oder Screenshots veröffentlichen. `GOOGLE_DRIVE_ACCOUNT=firetime.pro@gmail.com` ist in der frischen Konfiguration bereits gesetzt.
5. Als Systemadmin in FireTime „Google Drive verbinden“ wählen und die Freigabe selbst im vorgesehenen Google-Konto bestätigen. FireTime prüft die Konto-E-Mail und erstellt anschließend den privaten Ordner **FireTime Pro – Private Dateien**. Keinen bestehenden Ordner öffentlich freigeben und kein Servicekonto in einen persönlichen My-Drive-Ordner einladen.
6. „Verbindung prüfen“ wählen und dann einen vorgesehenen Testanhang sowie einen Monats-PDF speichern und wieder öffnen.

Für dauerhaften Betrieb die Google-App nicht dauerhaft im Veröffentlichungsstatus **Testing** belassen: dabei laufen Refresh-Tokens für diesen Scope grundsätzlich nach sieben Tagen ab. Die Veröffentlichung bzw. eine von Google verlangte App-Prüfung muss im Google-Projekt abgeschlossen werden. `drive.file` ist ein nicht sensibler Scope; Google legt die tatsächlichen Anforderungen fest. Es gibt keine zugesicherte externe Freigabezeit.

## Was die Anwendung absichert

- Nur aktive Systemadmins mit gültiger Sitzung können die Verbindung beginnen. Die Rückmeldung ist an einen einmaligen, zehn Minuten gültigen Zustand, die Sitzung und die genaue Callback-Adresse gebunden. Widerrufene Sitzungen werden abgewiesen.
- Die Google-E-Mail muss zum vorgesehenen Konto passen. Eine vorhandene Dateiablage wird nicht still auf ein anderes Konto oder einen anderen OAuth-Client umgestellt.
- Dauerhafte Google-Tokens liegen AES-GCM-verschlüsselt in D1. Der Schlüssel wird aus dem langfristig unveränderten `FT_PEPPER` abgeleitet und an die OAuth-Client-ID gebunden. Client-Secret, Refresh-Token und Access-Token werden nicht an den Browser zurückgegeben.
- Jeder native Datei-Identifier erhält eine reservierte Google-Datei-ID. Wiederholungen verwenden dieselbe ID; eine `409`-Antwort wird gegen Größe, Ordner und Prüfsummen geprüft. Eine Datei-ID kann nicht mit anderen Bytes überschrieben werden.
- Die Dateien erhalten keine öffentlichen Freigaben. FireTime prüft Benutzer-/Firmengrenzen, bevor ein privater Bericht oder Aufgabenanhang aus Drive geladen wird. Bereits gespeicherte Dateiprüfsummen werden beim Abruf kontrolliert.
- Bei einem verworfenen Datenbankvorgang wird ein ungebundener Upload in den Drive-Papierkorb verschoben. Ist eine Datenbankantwort verloren gegangen, wird zuerst geprüft, ob die Datei bereits erfolgreich verbucht ist. Verbuchte Dateien werden dabei nicht entfernt. Bei einem unklaren Providerfehler können private, nicht referenzierte Dateien oder Reservierungen bestehen bleiben; sie sind kein bestätigter Geschäftsdatensatz.
- Erststart, Passwortanmeldung und normale Zeitbuchung brauchen keine Drive-Verbindung. Ohne erteilte Freigabe funktionieren Upload und Dateidownload noch nicht. Hintergrund-PDFs werden getrennt von Stempeluhr und Erinnerungen verbucht, damit ein Drive-Ausfall deren Änderungen nicht zurückrollt. Optionale Logos verhindern bei einem Drive-Fehler keine Stundenbuchung oder Anmeldung.
- Drive-Speicher und API-Kontingente gelten weiterhin. Die Dateien nutzen den verfügbaren Speicher des verbundenen Google-Kontos.

## Betrieb

`FT_PEPPER`, OAuth-Client-ID und Client-Secret dauerhaft sicher aufbewahren. Eine Erneuerung des Google-Zugriffs im selben Konto und OAuth-Client erhält den vorhandenen FireTime-Ordner. Ein Wechsel auf einen anderen Google-Client oder ein anderes Konto erfordert einen kontrollierten Dateiumzug und wird vom normalen Verbindungsdialog gesperrt.

Die lokal geprüften Drive-Tests simulieren Google-Antworten; sie ersetzen keinen echten Upload-/Downloadtest mit der vorgesehenen Google-Freigabe. Die bestehende R2-Staging-Konfiguration bleibt für frühere Migrationstests erhalten. Neue Cloudflare-Deployments verwenden ausdrücklich `wrangler.fresh.jsonc`.

Offizielle Grundlagen:
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.google.com/workspace/guides/create-credentials
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2
