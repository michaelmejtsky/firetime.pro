# Umschaltung und Rückkehrplan

Diese Anleitung ist vorbereitet; keiner dieser Produktionsschritte wurde ausgeführt.

## Vor dem Umschaltfenster

1. Vollständige Staging-Abnahme aus `ABNAHME.md` durchführen. Bestehendes Apps-Script-Deployment und alte GitHub-`config.js` sichern. Cloudflare-Produktivressourcen getrennt von Staging planen.
2. `npm run build` erzeugt `dist/Code_Freeze_Vorbereitung.gs`. Das ist der vollständige bisherige Backendcode mit vier zusätzlichen, zunächst inaktiven Sperrprüfungen: `doPost`, `ft_tick`, `ft_timerTick_`, `ft_pdfWorker_`.
3. Bei der späteren Umschaltung diese vollständige Code.gs im bestehenden Projekt verwenden und dieselbe WebApp-Bereitstellung auf eine neue Version aktualisieren. DB-ID, Pepper, Root-ID und Gateway-Schlüssel unverändert lassen. Niemals `ft_setup`, `ft_install` oder einen Datenbank-Neuaufbau starten.
4. Keine weiteren Code-Dateien mit doppelt definierten FireTime-Funktionen hinzufügen. Das Exportscript enthält nur eindeutig benannte Zusatzfunktionen.
5. Erst prüfen, dass der alte Betrieb mit der inaktiven Sperre weiterhin funktioniert. Die Vorbereitung allein ändert keine Buchung.

## Im vereinbarten Umschaltfenster

1. Benutzer über die kurze Wartungsunterbrechung informieren. Die Automatik im neuen System bleibt deaktiviert.
2. Im alten Apps Script `ft_cloudflareFreezeOn` ausführen. Alte API-Anfragen melden Wartung; die drei bisherigen Zeit-/Erinnerungs-/PDF-Einstiege schreiben währenddessen nicht. Bereits vorher laufende Ausführungen abwarten und im Ausführungsprotokoll kontrollieren. Alle sonstigen externen Schreibzugriffe müssen ebenfalls ruhen.
3. Einen **frischen finalen Export** erstellen, Dateien vollständig exportieren und den Export prüfen. Nicht die Tage zuvor veränderte Testkopie übernehmen.
4. Finale Kopie in eine neue leere Cloudflare-Zieldatenbank und einen privaten Zielbucket importieren; Feld-/Dateivergleich und reale Monats-/Urlaubskontrollen erneut durchführen. Skripte sind auf Staging-Bucketnamen beschränkt, um versehentliche Produktivimporte zu vermeiden. Den geprüften Import für das finale Ziel ausdrücklich anpassen und kontrolliert durchführen.
5. Neue Produktionskonfiguration erstellen: Ziel-DB/Bucket, identischer Pepper, korrekte erlaubte Oberfläche(n), neue oder bisherige öffentliche App-Adresse. `MIGRATION_MODE=production`, zunächst `WRITE_ENABLED=false`, `CUTOVER_CONFIRMED=false`, alle Automatik-/Versandflags zunächst aus.
6. Erst nach bestandenem Datenvergleich `CUTOVER_CONFIRMED=true` setzen. Die tatsächliche produktive Oberfläche/API umstellen. Bei Beibehaltung von GitHub Pages ausschließlich dessen `window.FT_API_URL` auf die neue native `/api`-Adresse setzen und die neue API mit genau dieser Origin erlauben. Das alte API-Gateway wird für die neue Oberfläche nicht mehr gebraucht.
7. `WRITE_ENABLED=true` freigeben. Anmeldung, Rechte, eine kontrollierte Buchung, Monatsbericht und privates Dokument prüfen. Diese neue Buchung macht den einfachen Rückweg zur alten Datenbank unzulässig: ab dann müssen alle neuen Änderungen erhalten und gegebenenfalls rückübertragen werden.
8. Danach ausschließlich die neue Automatik freigeben: `AUTOMATION_ENABLED=true` und die einzeln geprüften `MAIL_ENABLED`-/`PUSH_ENABLED`-/`CALENDAR_ENABLED`-Flags. Die alte Sperre bleibt aktiv, um doppelte Erinnerungen, automatische Jahresgutschriften oder PDF-Jobs zu verhindern.
9. Bei neuer App-Adresse auf den Geräten Anmeldung/Push neu prüfen. Auf bestehenden iPhone-PWAs kontrollieren, welche Adresse sie tatsächlich verwenden.
10. Outbox-Fehler, Loginfehler, Zeitbuchungen und Monatswerte während der ersten Tage beobachten. Staging-Daten und produktive Daten dürfen nie gemischt werden.

## Einfacher Rückweg vor neuen Cloudflare-Buchungen

Neue Schreibzugriffe und Automatik sperren. Alte Oberfläche/API-Konfiguration zurücksetzen. Sicherstellen, dass noch keine neuen Buchungen ausschließlich in D1 entstanden sind. Im alten Apps Script `ft_cloudflareFreezeOff` ausführen und Anmeldung sowie Automatik prüfen. Die Cloudflare-Test-/Zieldatenbank bleibt als Diagnosekopie erhalten.

## Störung nach neuen Cloudflare-Buchungen

Nicht einfach auf die alten Sheets zurückschalten. Neue Schreibzugriffe und beide Automatiken stoppen; D1 und R2 vollständig sichern. Alle nach dem finalen Export entstandenen Änderungen inklusive Urlaub, Salden, Monatsfreigaben, Anhängen und Audit erfassen. Erst nach fachlich geprüftem Rückabgleich darf die alte Datenbank wieder schreiben. Eine automatische produktive Rückübertragung nach Sheets ist in diesem Paket absichtlich nicht enthalten; sie muss anhand des tatsächlichen Änderungsbestands erstellt und geprüft werden.

Ein Linkwechsel allein ist nach dem ersten neuen D1-Schreibzugriff kein sicherer Rollback.
