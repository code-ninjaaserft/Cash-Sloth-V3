# Bestellungen, Tischservice und Küchenstatus

Cash Sloth V3 · Faultir Softworks · OP Faultir Chrysos

## Bedienung

Im Menü **Bestellungen** öffnet das Personal drei getrennte Fenster: **Selbstbedienungsfenster öffnen**, **Kunden-Infobildschirm öffnen** und **Küche / Bar öffnen**. Die Fenster können auf weitere Monitore desselben Geräts verschoben werden.

Die Selbstbedienung verwendet ausschliesslich den sichtbaren Katalog des aktuell geladenen Events, einschliesslich Kategorien, Varianten, Preisen, Titel und Logo. Sie aktualisiert ihn automatisch. Bei einem Event- oder Angebotswechsel wird eine noch nicht abgesendete Auswahl geleert; eine bereits bestätigte Bestellnummer bleibt sichtbar. Beim Aufgeben wird das Angebot erneut geprüft. Das Kiosk-Fenster verändert den Kassen-Warenkorb nicht und nimmt keine Zahlung entgegen.

Neben **Rabatt / Rabattgutschein** befindet sich auf dem Hauptbildschirm **Bestellungen bezahlen**. Die Auswahl lädt eine offene Bestellung direkt in den Zahlungsablauf. Ein vorhandener Kassen-Warenkorb wird nicht überschrieben. Übernommene Bestellpositionen können für die Zahlung rabattiert werden; Änderungen an Artikeln oder Mengen erfordern zunächst das Zurückstellen der Bestellung.

**Auf Tisch / Name buchen** speichert den Warenkorb ohne Zahlung unter einer frei gewählten Bezeichnung, beispielsweise „Tisch 7“ oder „Anna“. Weitere Buchungen mit derselben Bezeichnung bilden jeweils eine eigene unnummerierte Bestellung für die Küche. **Tischrechnung bezahlen** übernimmt alle noch wartenden Buchungen dieser Bezeichnung im aktiven Event in eine gemeinsame Rechnung. Andere Tische bleiben getrennt. Eine bereits laufende Tischzahlung nimmt keine nachträglich aufgegebenen Buchungen auf; diese bleiben für die nächste Rechnung offen. Rabatte werden beim Bezahlen angewendet. Abholen bzw. Servieren ist bereits vor dem Bezahlen möglich.

## Nummern und Status

Selbstbedienung und aktivierte Kassen-Bestellungen teilen sich je Event dieselbe Nummernvergabe von **1 bis 99**. Tischservice erhält keine Bestellnummer und verbraucht keinen Zählerstand. Nach 99 beginnt die Suche wieder bei 1; bereits offene Nummern werden übersprungen. Erst bezahlte und abgeholte oder stornierte Bestellungen geben eine Nummer frei. Sind alle Nummern belegt, wird eine weitere Bestellung bzw. neue Zahlungsaufnahme abgewiesen, bevor Geld bestätigt wird. Der Zähler und die Zuordnungen bleiben beim Neustart erhalten.

Auch gewöhnliche Kassenverkäufe erhalten beim Beginn der Zahlung eine Bestellung und Nummer. Ein noch nicht bezahlter abgebrochener Checkout bleibt fortsetzbar. Das ausdrückliche Leeren eines gewöhnlichen Kassen-Warenkorbs storniert seine unbezahlte Bestellung. Übernommene Kiosk- und Tischbestellungen werden dagegen unter **Unbezahlte Bestellung zurückstellen** freigegeben. Dabei müssen laufende Zahlungen zunächst ohne Geldbewegung abgebrochen bzw. vollständig geklärt werden.

Zahlung und Zubereitung sind unabhängig. Das Küchen-/Bar-Fenster zeigt Kiosk-, Kassen- und Tischservicebestellungen mit Artikelmengen, Herkunft und gegebenenfalls Tisch/Name. **Bestellung annehmen** setzt **In Bearbeitung**, **Abholbereit melden** setzt **Abholbereit**, **Als abgeholt markieren** entfernt sie aus der aktiven Küche und Kundenanzeige. Konkurrierende Änderungen werden mit einer Revisionsprüfung abgewiesen. Ein wiederholter Vorgang mit derselben Referenz ändert den Status nur einmal.

Tischservice erscheint ausschliesslich in der privaten Bestellübersicht und in Küche/Bar. Der öffentliche Infobildschirm zeigt die Spalten **Erhalten**, **In Bearbeitung**, **Abholbereit** mit Nummern. Er erhält keine Namen, Tischbezeichnungen, Warenkörbe oder Zahlungsdetails. Bei Verbindungsfehlern blendet er alte Nummern aus und zeigt einen Hinweis. Die private Bestellübersicht zeigt unbezahlte, bereits servierte Tischrechnungen weiterhin an. Abgeschlossene Bestellungen sind in der Archivansicht verfügbar. Stornierte Bestellungen werden automatisch gelöscht.

## Quittung und Speicherung

Neue Verkäufe speichern ihre Bestellnummer(n), Tisch-/Namensbezeichnung und ursprüngliche Herkunft (**Selbstbedienung**, **Kasse**, **Tischservice**) unveränderlich als Teil des Verkaufssnapshots. Quittungsvorschau, Verkaufsdetails und Verlauf zeigen diese Angaben. Tischbuchungen zeigen ihre Tisch-/Namensbezeichnung ohne Bestellnummer. Bereits gespeicherte ältere Verkaufssnapshots bleiben unverändert; historische Tisch-Nummern werden in der Oberfläche nicht mehr als Bestellnummer dargestellt. Spätere Status-, Event- oder Katalogänderungen verändern die Quittung nicht. Ältere Verkäufe ohne solche Angaben werden nicht nachträglich um erfundene Zuordnungen ergänzt.

Bestellungen erzeugen vor dem Bezahlen keinen Umsatz und keine Tickets. Der Verkaufsabschluss aktualisiert die Zahlung aller zugehörigen Bestellungen atomar mit dem Verkauf. Ein Helfer-/Team-Abschluss gilt als erledigte Abrechnung ohne Umsatz. Erstattungen behalten den ursprünglichen Kontext; die ausdrücklich gewünschte Löschung eines Verkaufs entfernt seine zugehörigen Bestellungen vollständig, auch aus dem Bestellarchiv und den Küchen-/Kundenanzeigen.

Migration 0020 entfernt Nummern aus laufenden Tischbuchungen und ergänzt Einstellungen sowie getrennte Quittungscodes. Migration 0019 erweitert die vorhandenen Bestellungen ohne Änderung früherer Migrationen. Vorhandene Nummern werden auf den Bereich 1–99 abgebildet. Legacy-Barverkäufe erhalten einen separaten unveränderlichen Kontext; aktuelle Zahlungen speichern ihn im bestehenden unveränderlichen JSON-Snapshot. Nummernvergabe, Buchung und Warenkorbübergabe sind transaktional und mit genauen Vorgangsreferenzen wiederholbar. Bei ungewissen Ergebnissen wird derselbe Vorgang geprüft statt erneut gebucht.

Demo-Modus verwendet eine getrennte Datenkopie und getrennte Wiederherstellungsverweise. Alle beteiligten Fenster kennzeichnen ihn; bei einem Moduswechsel werden Kiosk, Küche und Infobildschirm geschlossen. Das Küchenfenster darf nur seine Bestellungen lesen und Zubereitungsstatus ändern, der Kunden-Infobildschirm nur seine öffentliche Übersicht lesen. Zahlungen und Verwaltung bleiben der Kasse vorbehalten. Die Fenster laufen lokal auf demselben Gerät; eine Vernetzung verschiedener Geräte und der tatsächliche Bondruck sind noch nicht angeschlossen.

## Schalter und Zähler

Unter **Einstellungen → Bestellfunktionen** lassen sich Selbstbedienung, Tischservice, Kunden-Infobildschirm, Küche/Bar und automatische Kassen-Bestellnummern einzeln speichern. Die Einstellungen gelten für dieses Gerät; die Demo-Kopie ist davon getrennt. Ausschalten schliesst bereits geöffnete betroffene Fenster und verhindert neue Kiosk- bzw. Tischbuchungen auch an der Schnittstelle. Bestehende offene Rechnungen bleiben in Bestellungen bezahlbar. Bereits zugeordnete Kassen-Nummern bleiben beim Bezahlen erhalten; ausgeschaltete automatische Kassen-Nummern verhindern neue automatische Bestellungen.

**Bestellnummernzähler zurücksetzen** beginnt für das aktive Event wieder bei 1. Es werden keine Bestellungen, Status oder historischen Quittungen verändert. Belegte Nummern werden weiterhin übersprungen. Derselbe gespeicherte Reset-Vorgang wird nach ungewisser Bestätigung nicht noch einmal ausgeführt.

## Quittung und Suche

Auf der Quittung steht die Bestellnummer für Selbstbedienung und Kasse gross und fett in einem eingerahmten Abschnitt. Tischservice zeigt an derselben Quittung ausschliesslich Tisch/Name und Herkunft.

Jeder neue Verkauf erhält einen eindeutigen lokalen Code-39-Quittungscode. Normale Quittungscodes beginnen mit CC, Demo-Codes mit DC; sie sind von Ticket- und Gutscheincodes getrennt. Der Code bleibt nach Neustart und erneutem Öffnen gleich. Ältere Quittungen erhalten beim ersten Öffnen einen dauerhaften Code als separate Metadaten, ohne die finanziellen Snapshots umzuschreiben. Beim ausdrücklich gewünschten Entfernen eines Verkaufs werden auch dessen Quittungscode, zugehörige Bestellungen und gespeicherte Bestellvorgänge entfernt. Minimale gelöschte Vorgangskennungen verhindern eine unbeabsichtigte Neuerstellung durch Wiederholen alter Anfragen; Artikel, Namen und Warenkörbe werden darin nicht gespeichert.

Im Verlauf gibt es zusätzlich **Bestellnummer**, **Tisch / Name** und **Quittungsbarcode**. Tisch-/Namenssuche findet auch Teilnamen ohne Gross-/Kleinschreibung und Akzente. Bestellnummern werden genau verglichen. Quittungscodes können eingegeben oder mit einem Scanner als Tastatureingabe in das Feld gescannt und mit Enter gesucht werden. Die Suche respektiert weiterhin Event-/Gerätebereich und alle anderen gesetzten Filter; Filter lassen sich für eine neue Suche leeren. Gefilterter Export verwendet dieselbe Auswahl. Der tatsächliche Quittungsdruck bleibt bis zur Hardwareanbindung ein Platzhalter.

## Abgelehnte Bestellnummern

Wird eine unbezahlte Bestellung im Zustand **Erhalten** abgelehnt, erhält die nächste nummerierte Bestellung desselben Events bevorzugt diese Nummer. Danach geht es am unveränderten normalen Zähler weiter: auf 1, 2, 3, Ablehnung von 2 folgen 2 und anschliessend 4. Mehrere Ablehnungen werden in der Reihenfolge der Stornierungen wiedervergeben. Tischservice hat keine Nummer und ist hiervon ausgenommen.

Ablehnung und Freigabe sowie Wiedervergabe und neue Bestellung sind jeweils eine gemeinsame Transaktion. Neustarts und wiederholte Vorgangsbestätigungen erzeugen keine doppelte Freigabe. Laufende Nummern werden weiterhin übersprungen. Ein ausdrücklicher Zähler-Reset entfernt für das aktive Event auch vorgemerkte Rückgaben und beginnt die Suche wieder bei 1. Die stornierte Bestellung wird vollständig aus den Bestellansichten entfernt; die freigegebene Nummer bleibt für die nächste Vergabe vorgemerkt.

## Bereinigung gelöschter Verkaufsbestellungen

Migration 0022 ersetzt die bisherigen Stornierungs-Trigger durch das vollständige Entfernen der mit dem gelöschten Verkauf verbundenen Bestellungen. Dies geschieht in derselben Transaktion für einzelne Verkäufe, Event-Verläufe und den Geräteverlauf. Eine gemeinsam bezahlte Tischrechnung entfernt alle dazugehörigen Buchungen. Noch offene Buchungen und Verkäufe anderer Events werden nicht über eine Tischbezeichnung oder Nummer mitgelöscht.

Beim Upgrade werden bereits durch ältere Verlaufslöschungen übrig gebliebene Bestellungen bereinigt, sofern sie storniert sind, ihr zugeordneter Kassen-Warenkorb nicht mehr existiert und weder Verkauf noch Helfer-/Team-Bezug dazu vorhanden ist. Ungebundene unbezahlte Bestellungen bleiben erhalten; reguläre Stornierungen werden zusätzlich durch Migration 0023 entfernt. Die Quittung verwendet Arial mit normaler, innen leerer Null; auch der lesbare Quittungscode übernimmt diese Schrift. Die Barcode-Balken bleiben unverändert.

## Automatisches Löschen von Stornierungen

Migration 0023 entfernt sämtliche bereits gespeicherten stornierten Bestellungen und löscht künftige Stornierungen sofort. Neue Stornierungen geben eine vorhandene Bestellnummer in derselben Transaktion für die nächste Vergabe zurück; der normale Zähler bleibt unverändert. Tischbuchungen haben keine Nummer. Auch das Leeren eines abgebrochenen gewöhnlichen Kassen-Warenkorbs sowie das Zurückstellen einer gewöhnlichen Kassen-Bestellung entfernen deren Stornierung und geben ihre Nummer frei. Das Zurückstellen einer Kiosk- oder Tischbestellung lässt diese weiterhin wartend bestehen.

Die Stornierungsantwort enthält nur eine minimale Löschbestätigung mit Kennung, keine Artikel oder Namen. Sie lässt sich nach ungewissem Ergebnis mit derselben Vorgangsreferenz sicher erneut abrufen. Frühere Erstellungsanfragen können die gelöschte Bestellung nicht wiederherstellen. Bezahlte Verkäufe werden durch die normale Stornierung weiterhin nicht verändert.
