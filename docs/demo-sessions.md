# Demo-Sitzungen

Cash Sloth V3 · Faultir Softworks · OP Faultir Chrysos

Unter **Einstellungen → Demo-Modus** beginnt eine getrennte, vorübergehende Sitzung. Produkte, Kategorien, Presets und Einstellungen werden aus der aktuellen Kasse übernommen. Der Verkaufsverlauf beginnt leer: Bereits vorhandene Verkäufe werden ausschliesslich aus der temporären Datenkopie über die bestehende transaktionale Verlaufslöschung entfernt. Die echte Datenbank bleibt unverändert.

**Verkaufsverlauf** zeigt im Demo-Modus den **Demo-Verkaufsverlauf** mit den Verkäufen dieser Sitzung. Suche, Event-/Geräteansicht, Verkaufsdetails und Quittungsvorschau verwenden dieselbe Demo-Datenbank. Demo-Quittungscodes beginnen mit DC. Auch die bisherigen Listen der letzten Verkäufe verwenden den jeweils aktiven Betrieb.

Beim Beenden wird die Demo-Datenbank geschlossen und verworfen. Damit sind alle darin ausgestellten Tickets sowie Produkt-, Rabatt- und Wertgutscheine nicht mehr einlösbar. Eine spätere Demo beginnt mit neuer Sitzungskennung und leerem Verlauf; frühere Demo-Codes sind dort nicht vorhanden. Im normalen Betrieb werden Demo-Codes weiterhin wegen des abweichenden Betriebsmodus abgewiesen. Normale Tickets, Gutscheine, Guthaben und Verkäufe bleiben erhalten.

Ein Neustart kehrt zum normalen Betrieb zurück und lädt eine frühere Demo nicht erneut. Ein Moduswechsel erfordert weiterhin einen leeren Warenkorb und abgeschlossene Zahlungen/Erstattungen. Ticketdesk, Kiosk, Küche und Kunden-Infobildschirm werden beim Wechsel geschlossen, damit sie ausdrücklich im neuen Betrieb geöffnet werden. Der Kundenmonitor und die Kasse kennzeichnen den Demo-Modus mit einem Informationsbalken.

Die Electron-Prüfungen verwenden getrennte Testdaten und prüfen leeren Start, Demo-Verkäufe samt Quittung, unveränderten Echtverlauf, Codes beider Gutscheinarten und Tickets nach Sitzungsende, erneute Demo und Neustart.
