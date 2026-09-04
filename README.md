# TakeMeHome

Eine installierbare statische Progressive Web App für Busverbindungen vom aktuellen Standort zu drei festen Zielen in Tübingen.

Die Anwendung besteht ausschließlich aus HTML, CSS und browsernativem JavaScript. Sie benötigt weder Node.js noch ein Frontend-Framework oder einen Paketmanager.

Das Web-App-Manifest, die App-Icons und ein kleiner Service Worker ermöglichen die Installation auf dem Startbildschirm sowie den Offline-Start der App-Hülle. Für aktuelle Verbindungen bleibt eine Internetverbindung erforderlich.

## Struktur

```text
index.htm   Einstiegspunkt der Anwendung im Webroot
assets/     Styles, Browserlogik und Icons
*.json      Ziele und PWA-Manifest im Webroot
tests/      Statischer Smoke-Test
```

Der Verzeichnisinhalt kann ohne Buildschritt direkt in ein Webroot kopiert werden. Der Webserver muss `index.htm` als Indexdatei ausliefern und für die Standortfreigabe HTTPS verwenden.

## Lokal starten

```bash
make serve
```

Danach ist die App unter `http://localhost:3000` erreichbar. `make test` prüft die direkt auslieferbaren Dateien.

Die Routen stammen von Transitous/OpenStreetMap. Die erste Busabfahrt wird über den öffentlichen Echtzeit-Stream von TüBus abgeglichen.

## Ziele konfigurieren

Die angezeigten Ziele stehen in `locations.json` im Projektroot. Ein Ziel besteht aus einer eindeutigen `id`, `name`, `address`, `shortLabel`, `latitude` und `longitude`. Weitere Ziele können als zusätzliche Objekte in `locations` ergänzt werden. `arrivalRadiusMeters` legt fest, ab welcher Entfernung TakeMeHome statt einer Busverbindung „Du bist schon da“ anzeigt.
