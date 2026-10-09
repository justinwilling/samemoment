# SameMoment — Supabase

React/Vite mit Supabase Auth, Postgres/PostGIS und Supabase Storage. Cloudflare ist nicht erforderlich.

## Lokal starten

1. `npm install`
2. `.env.example` nach `.env` kopieren und Projekt-URL sowie öffentlichen Publishable-Key eintragen. Im vorhandenen Projekt ist dies bereits erfolgt.
3. `schema.sql` im Supabase SQL Editor ausführen. Das Schema ist für das Projekt `hdgecmruggnmfozjezqh` vorbereitet. Für ein anderes Projekt auch die öffentliche Bild-URL in `publish_moment` anpassen.
4. Authentication → URL Configuration: Website-URL als Site URL, außerdem `http://localhost:5173` und die öffentliche Website-URL als erlaubte Redirect URLs eintragen.
5. `npm run dev`, anschließend die angezeigte lokale Adresse öffnen.
6. `npm run build` erzeugt `dist/` für einen statischen Webhost. Auth, Datenbank und Bildspeicherung laufen bei Supabase; das Frontend benötigt weiterhin Webhosting.

## Datenfluss und Zugriffsregeln

- E-Mail-Anmeldung über Supabase Magic Link.
- EXIF wird lokal ausgelesen; das Bild wird auf maximal 2000 px und WebP komprimiert. Das Original wird nicht hochgeladen.
- Optimierte Bilder landen im öffentlichen Bucket `samemoment-photos`, maximal 5 MB pro Datei und MIME-Typ `image/webp`.
- Upload ist nur nach Anmeldung in den eigenen Nutzerordner möglich. Überschreiben ist nicht freigegeben.
- `publish_moment` prüft Identität, Eigentum an der vorhandenen Datei, Titel, Koordinaten und Zeitpunkt. Die Bild-URL wird serverseitig erzeugt. Direkte Tabellen-Schreibzugriffe sind gesperrt.
- Galerie und Suche rufen `search_moments_day` auf, mit räumlichem PostGIS-Index und 60 Ergebnissen pro Seite. Interne Eigentümer- und Storage-Felder werden nicht ausgegeben.
- Bei bestätigtem Datenbankfehler versucht der Client, die unveröffentlichte Datei zu entfernen. Bei unklarem Netzwerkstatus bleibt sie erhalten, damit ein eventuell gespeichertes Foto nicht beschädigt wird. Veröffentlichte Bilddateien sind vor der Upload-Bereinigung geschützt.
- Bilder, bestätigter Aufnahmeort und Aufnahmezeit sind öffentlich. Der Upload-Dialog weist vor Veröffentlichung darauf hin.

## Tests

`npm test` prüft den aktuellen Supabase-Uploadablauf inklusive Zugriff, Validierung, Fehlern und Bereinigung sowie die ältere Worker-Implementierung. `npm run build` prüft den Frontend-Build.

Die Dateien unter `worker/` bleiben als alte Implementierung erhalten und werden nicht von der Website verwendet. Es sind weder eine Worker-URL noch ein Service-Role-Key im Frontend erforderlich.

## Grenzen

Supabase Storage prüft Dateigröße und MIME-Typ; vollständige serverseitige Bilddekodierung ist nicht implementiert. Für einen offenen öffentlichen Betrieb fehlen unter anderem Moderation, Upload-Quoten und die Nutzerfunktion zum Löschen veröffentlichter Fotos. Unklare Netzwerkabbrüche können unveröffentlichte Dateien hinterlassen. Kamera-Zeitangaben ohne Zeitzone werden als lokale Browserzeit interpretiert; HEIC-Unterstützung ist browserabhängig. Magic Links benötigen passende Redirect URLs und eine funktionierende E-Mail-Zustellung.

## Tagessuche

Die Suche zeigt immer einen vollständigen Kalendertag, standardmäßig heute, in der lokalen Browser-Zeitzone. Die Datenbank verwendet inklusive Tagesbeginn und exklusiven Beginn des Folgetags; Sommer-/Winterzeitwechsel werden berücksichtigt. Die Migration für bestehende Projekte steht in `migrations/002_day_search.sql`. Manuell gesetzte Aufnahmetage werden intern mit 12 Uhr lokaler Zeit gespeichert; vorhandene EXIF-Zeitstempel bleiben erhalten. Die Oberfläche zeigt nur den Tag.

## Ortssuche

Städte, Orte und Adressen werden nach Absenden der Suche über Photon (OpenStreetMap-Daten) aufgelöst. Die Auswahl verschiebt die Karte und setzt den Mittelpunkt des bestehenden Radiusfilters. Suchtexte werden an den Geocoding-Anbieter übertragen. Ergebnisse werden für die Sitzung zwischengespeichert. `VITE_GEOCODER_URL` kann auf einen anderen Photon-Endpunkt zeigen. Der öffentliche Photon-Demoserver ist für moderate Nutzung vorgesehen und bietet keine Verfügbarkeitsgarantie; für größere Nutzung einen eigenen oder gehosteten Dienst verwenden: https://github.com/komoot/photon#demo-server .

## Upload-Formate und Profile

Der Upload akzeptiert JPG/JPEG/JFIF, PNG, WebP, GIF, BMP, AVIF, HEIC/HEIF und TIFF. Die Datei bleibt bis zur Verarbeitung auf dem Gerät, wird in ein optimiertes WebP umgewandelt und auf maximal 2.000 Pixel an der langen Seite sowie etwa 1,5 MB begrenzt. HEIC/HEIF und TIFF werden mit nachgeladenen Browser-Decodern verarbeitet. Der Upload-Dialog akzeptiert zusätzlich eine Ortsuche; der Treffer setzt den Kartenpunkt.

Nach Magic-Link-Anmeldung kann ein Nutzer einen eindeutigen Username und Anzeigenamen speichern. Die Profilsektion zeigt die eigenen Momente als Galerie und alle eigenen Aufnahmeorte auf einer Leaflet-Karte. Die Profiltabelle und RLS-Regeln stehen im unteren Abschnitt von `schema.sql`.
