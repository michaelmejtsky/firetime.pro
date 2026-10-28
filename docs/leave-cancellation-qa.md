# Urlaubsstornierung: Validierung vor Merge und Deployment

## Automatisierte Prüfung (28.10.2026)

Basis: main fb67d69222115d90f0b4a7d14ffb14974086cdd7.
Die bereits in main vorhandenen UI- und Backend-Aktionen ersetzen den alten UI-only-Stand von PR 8.

Korrektur: Die Berichtsberechnung berücksichtigt APPROVED und CANCEL_PENDING als weiterhin genehmigten Urlaub. Erst eine bestätigte Stornierung entfernt die Zeitgutschrift.

`node --test tests/*.test.cjs`: 117 Tests erfolgreich.
Die neuen Tests verwenden pro Test eine frische In-Memory-Datenbank und führen den tatsächlichen Backend-Code in einer Node-VM aus. Google-Dienste und Tabellenzugriffe sind ersetzt. Das ist kein Apps-Script-/Google-Sheets-Integrationstest.

Nachweis der Regression: Mit dem ursprünglichen APPROVED-only-Filter scheitern zwei neue Tests (laufende Salden sowie monatsübergreifende Zeitgutschrift). Mit der Korrektur bestehen alle Tests.

Abgedeckt: Bearbeiten und Zurückziehen offener Anträge, Stornierungsantrag und Ablehnung ohne Saldenänderung, bestätigte Stornierung mit einmaliger Rückbuchung, feste und flexible Modelle, Monatsgrenzen, Eigentümer-/Mandanten-/Rollenschutz, ungültige Übergänge, Datumsvalidierung, Überschneidungen, Bestandsanträge und unveränderte APPROVED-/FINAL-Monatssnapshots.

## Noch offen: isolierte Google-Sheets-QA und Deployment-Nachweis

Diese Schritte wurden hier nicht ausgeführt. Vor dem Merge ist die ursprüngliche QA-Bedingung des PR weiterhin zu erfüllen:

1. Ein separates Apps-Script-QA-Projekt und eine Kopie der Datenbank verwenden. FT_DB_ID darf ausschließlich auf die Kopie zeigen. Mail, Push, Kalender und Trigger in QA deaktivieren bzw. auf separate QA-Ressourcen richten. Nicht ft_setup() gegen die bestehende Datenbank ausführen.
2. Vorher-Export sichern: Leaves (IDs, Status, Tage, creditHours), Users (leaveBalance, openingHours), LeaveLedger und freigegebene Months (snapshot, snapshotHash). Zusätzlich Berichte und laufende Salden für betroffene Monate erfassen.
3. Aktuelle Code.gs dieses PR im QA-Projekt bereitstellen. Über den echten API-Einstieg einen offenen Antrag bearbeiten und zurückziehen. Urlaubssaldo darf sich nicht ändern.
4. Genehmigten Urlaub zur Stornierung anmelden: Status CANCEL_PENDING; Urlaubssaldo, Zeitgutschrift und neu berechnete laufende Salden müssen unverändert bleiben. Ablehnen: APPROVED, ebenfalls unverändert.
5. Erneut Stornierung anmelden und bestätigen: CANCELLED, Tage genau einmal zurückgebucht, Zeitgutschrift entfernt. Wiederholung muss abgewiesen werden und darf keine weitere Buchung erzeugen.
6. Fremde Benutzer/Firmen, Mitarbeiter-Review, ungültige Übergänge und Überschneidungen über die API prüfen. Bestehende unbeteiligte Urlaube und Salden sowie genehmigte/finale Monatssnapshots mit dem Vorher-Export vergleichen; nur die ausdrücklich bearbeiteten Datensätze dürfen sich ändern.
7. QA-Ergebnis, getesteten Commit und Apps-Script-Deployment-Version dokumentieren. Erst nach erfolgreichem QA-Lauf und gesichertem Backend-Rollout den Merge freigeben.
