# Gutscheine und Rabatte

Cash Sloth V3 · Faultir Softworks · OP Faultir Chrysos

## Bedienung

**Gutscheine & Rabatte** im Menü verwaltet Rabattvorlagen und Gutscheine. Ein Rabatt kann prozentual, als fester CHF-Abzug oder als ein Gratisprodukt definiert werden. Der Geltungsbereich ist der aktuelle Warenkorb oder ein bestimmtes Produkt (dessen Varianten eingeschlossen sind). Vorlagen wie „Mitarbeiter-Rabatt“ lassen sich benennen, speichern, bearbeiten und löschen; sie gelten geräteweit und werden im Demo-Modus nur in dessen Arbeitskopie geändert.

Im Warenkorb öffnet **Rabatt / Rabattgutschein** die Auswahl für eine Vorlage, einen individuellen Rabatt oder einen Gutscheincode. Mehrere Rabatte und Gutscheine lassen sich kombinieren. Jede weitere Anwendung reduziert den bereits rabattierten verbleibenden Preis; kostenlose Stücke werden dabei übersprungen. Ein Code kann pro Warenkorb nur einmal reserviert werden. **Alle Rabatte entfernen** entfernt sämtliche Rabatte und Reservierungen. Nach der Anwendung sind Produkt- und Mengenänderungen gesperrt, bis alle Rabatte entfernt oder der Warenkorb geleert wird. Damit kann eine nachträgliche Mengenänderung keinen festen CHF-Gutschein vervielfachen. Nach dem Entfernen werden die gespeicherten Originalpreise wiederhergestellt. Die Katalogpreise bleiben unverändert.

Rabatte sind in den Verkaufspreisen berücksichtigt und mit Bezeichnung und Originalpreis in den historischen Positionen gespeichert. Prozentwerte werden pro Stück auf Rappen gerundet. Ein fester CHF-Abzug wird exakt über die berechtigten Stücke verteilt; falls nötig erscheinen separate Positionen mit um einen Rappen abweichenden Stückpreisen. Ein Gratisprodukt-Gutschein macht genau ein berechtigtes Stück kostenlos. Auch ein vollständig rabattierter Verkauf kann ohne Geldeingang abgeschlossen werden. Helfer-/Team-Bezüge bleiben davon getrennt; dafür müssen Rabatte zuvor entfernt werden.

## Gutscheinarten und Gültigkeit

- **Wertgutschein (CHF-Guthaben):** eigenständiges Guthaben, das bei Zahlungen eingesetzt wird. Teilbeträge und Restguthaben bleiben erhalten.
- **Prozentrabatt / fester CHF-Abzug / Gratisprodukt:** Preisvorteil, der vor dem Bezahlen auf den Warenkorb angewendet wird.

Bei der Ausstellung werden Name, Wert bzw. Vorteil, Geltungsbereich, optionale Frist und maximale oder unbegrenzte Einlösungen eingestellt. Bei Wertgutscheinen wird unbegrenzte Einlösung vorausgewählt, damit Restguthaben in mehreren Einkäufen genutzt werden kann. Datum und erlaubte Einlösungen können später mit **Gültigkeit bearbeiten** geändert werden. **Gutschein wertlos machen** sperrt dauerhaft; ein höheres Limit oder neues Ablaufdatum hebt eine Sperre nicht auf.

Ausstellung allein erfasst keinen Geldeingang und ist kein Gutscheinverkauf. Wenn für die Ausgabe Geld entgegengenommen wird, ist dies ein gesonderter Vorgang; die aktuelle Ausstellungsmaske behauptet keine Zahlung. Der ursprüngliche Guthabenwert und der aktuelle Saldo werden getrennt gespeichert.

Die Gutscheinvorschau enthält Name, ursprünglichen Wert/Vorteil, Ausstellungszeit und Barcode/Textcode. Veränderliches Restguthaben und Status stehen nur auf dem Bildschirm. **Gutschein drucken** ist bis zur Hardwareanbindung deaktiviert. Die Codes funktionieren lokal auf diesem Gerät. Normale Codes beginnen mit AC, Demo-Codes mit AD; Gutscheine des jeweils anderen Modus werden abgewiesen. Das Ticketdesk hat keinen Zugriff auf die Gutscheinverwaltung oder Guthabenbuchungen.

Ein Rabattgutschein wird bei der Anwendung für den Warenkorb reserviert und erst beim erfolgreichen Verkaufsabschluss gezählt. Entfernen oder Leeren ohne Verkauf verbraucht keine Einlösung. Eine zum Anwendungszeitpunkt gültige Reservierung bleibt für diesen Checkout gültig, auch wenn während der Zahlung die Frist verstreicht. Während einer Reservierung können die Gutscheinregeln nicht verändert werden.

## Zahlung mit Guthaben

Im Zahlungsfenster **Wertgutschein / Guthaben** öffnen, Code und CHF-Betrag eingeben und **Guthaben einsetzen** wählen. Der Betrag wird als eigenes Zahlungsmittel bestätigt; der restliche Betrag kann mit Karte/TWINT oder bar bezahlt werden. Nur der verbleibende Bargeldanteil wird auf fünf Rappen gerundet. Mehrere Wertgutscheincodes können gemeinsam einen Verkauf bezahlen. Vor Abschluss und vor bestätigtem Bargeld kann eine Gutscheinzahlung mit **Gutscheinzahlung zurücknehmen** zurückgebucht werden.

Wertgutscheine reduzieren nicht den Warenpreis. Der Verlauf und die Quittung unterscheiden Gutscheinanteil und tatsächlich übergebene Bargeld-/Kartenzahlung. Bei Verkäufen mit Gutscheinanteil erfolgen Erstattungen als Guthaben auf die ursprünglichen Wertgutscheine. Die Rückzahlung füllt deren verwendete Anteile in Reihenfolge auf; ein darüber hinausgehender Anteil aus anderen Zahlungsarten wird auf den letzten verwendeten Gutschein gutgeschrieben. Es gibt keine automatische Auszahlung des Gutscheinwerts in bar. Bereits verbrauchte Einlösungsanzahlen bleiben nach einer Erstattung erhalten; das gutgeschriebene Guthaben bleibt gespeichert. Bei einer begrenzten Einlösungszahl kann die Verwaltung das Limit erhöhen.

Die ausdrücklich gewünschte Löschung eines Verkaufs setzt dessen Gutscheinverbrauch/Guthabenbuchungen zurück, als hätte dieser Verkauf nicht stattgefunden. Eine gewöhnliche Erstattung bleibt dagegen ein eigenständiger historischer Vorgang.

## Umsetzung und Prüfungen

Migration 0017 erhält vorhandene Reservierungen und Einlösungen und erweitert diese auf mehrere Vorteilsgutscheine je Warenkorb bzw. Verkauf. Migration 0016 erweitert die zulässigen bestätigten Zahlungsarten um voucher, kopiert vorhandene Zahlungsdaten unverändert und stellt bestehende Prüf-, Sperr- und Löschtrigger wieder her. Frühere Migrationen bleiben unverändert. Separate Tabellen speichern Rabattmetadaten, Vorlagen, Gutscheine, Reservierungen, Einlösungen, Guthabenbuchungen und idempotente Vorgangsreferenzen.

Rabattberechnungen erfolgen im Domain-Modul ausschliesslich mit integer Rappen und BigInt-Verteilung. Die Application koordiniert Warenkorbsperren und Berechtigungen; SQLite speichert die Daten innerhalb der bestehenden synchronen Transaktionen. Guthabenabzug und bestätigte Zahlungszuordnung sind atomar. Direkte, frei erfundene voucher-Zahlungen über die gewöhnliche Zahlungsvorbereitung werden abgewiesen. Kontostandgrenzen, Betriebsmodus, Gültigkeit, Anzahl und aktive Reservierungen werden serverseitig geprüft.

Vor schreibenden UI-Aufrufen wird eine genaue Vorgangsreferenz gespeichert. Nach ungewisser Bestätigung wird derselbe Vorgang wiederholt, statt einen weiteren Gutschein auszustellen oder Guthaben erneut abzuziehen. Der Demo-Modus verwendet seine eigenen Daten und Wiederherstellungsverweise.

Integrationstests prüfen exakte CHF-Verteilung, Produktumfang, Originalpreis-Snapshots, Erstattungen, Gratisstücke, Reservierung/Verbrauch, Entfernen vor Verkauf, Frist/Sperre, Teilzahlungen, Restguthaben, Guthabenrückbuchung, direkte Aufrufabwehr, Neustart und Modustrennung. Weitere Prüfungen simulieren Rollback beim Schreiben und verlorene Commit-Bestätigungen. Der Oberflächentest durchläuft Vorlage, Rabatt anwenden/entfernen, Wertgutschein mit Bargeldrest und einen Gratisprodukt-Gutschein.
