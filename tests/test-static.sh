#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

test -f "$project_dir/index.htm"
test ! -e "$project_dir/index.html"
test -f "$project_dir/assets/styles.css"
test -f "$project_dir/assets/app.js"
test -f "$project_dir/locations.json"
test -f "$project_dir/assets/favicon.svg"
test -f "$project_dir/assets/icon-192.png"
test -f "$project_dir/assets/icon-512.png"
test -f "$project_dir/assets/apple-touch-icon.png"
test -f "$project_dir/manifest.webmanifest"
test -f "$project_dir/service-worker.js"
test ! -e "$project_dir/_headers"
test ! -e "$project_dir/package.json"
for retired_dir in .openai app db dist drizzle examples platform public scripts site src worker; do
  test ! -e "$project_dir/$retired_dir"
done

grep -q '<title>TakeMeHome' "$project_dir/index.htm"
grep -q 'content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"' "$project_dir/index.htm"
python3 -m json.tool "$project_dir/locations.json" >/dev/null
grep -q 'Mensa Wilhelmstraße' "$project_dir/locations.json"
grep -q 'Aixer Straße 27' "$project_dir/locations.json"
grep -q 'Sand 14' "$project_dir/locations.json"
grep -q 'id="permission-panel" aria-live="polite"' "$project_dir/index.htm"
grep -q 'Standort verwenden' "$project_dir/index.htm"
grep -q 'rel="manifest" href="./manifest.webmanifest"' "$project_dir/index.htm"
grep -q 'rel="stylesheet" href="./assets/styles.css"' "$project_dir/index.htm"
grep -q 'script src="./assets/app.js"' "$project_dir/index.htm"
grep -q 'class="header-actions"' "$project_dir/index.htm"
grep -q 'id="refresh-button" type="button" aria-label="Verbindungen aktualisieren"' "$project_dir/index.htm"
if grep -q 'install-button\|App installieren\|destination-summary\|hero-aside' "$project_dir/index.htm"; then
  printf '%s\n' "Entfernter Hero-Inhalt oder Installationsbutton gefunden" >&2
  exit 1
fi
if grep -q 'Gut zu wissen\|how-it-works\|notes-grid' "$project_dir/index.htm" "$project_dir/assets/styles.css"; then
  printf '%s\n' "Entfernter Hinweisabschnitt gefunden" >&2
  exit 1
fi
if grep -q 'Wenigste Gehzeit\|Optimiert nach kürzester Gehzeit\|wird nicht gespeichert\|routes-title\|routes-subtitle' "$project_dir/index.htm" "$project_dir/assets/app.js"; then
  printf '%s\n' "Entfernter Oberflächentext gefunden" >&2
  exit 1
fi
routes_line=$(grep -n 'id="routes-section"' "$project_dir/index.htm" | cut -d: -f1)
preference_line=$(grep -n 'class="preference-panel"' "$project_dir/index.htm" | cut -d: -f1)
test "$routes_line" -lt "$preference_line"
grep -q '<geolocation id="geolocation-control" autolocate accuracymode="precise">' "$project_dir/index.htm"
if grep -q 'Demo ab Hauptbahnhof\|data-manual-start' "$project_dir/index.htm"; then
  printf '%s\n' "Manuelle Startpunktauswahl gefunden" >&2
  exit 1
fi
grep -q 'preference: "least-walking"' "$project_dir/assets/app.js"
grep -q 'navigator.geolocation' "$project_dir/assets/app.js"
grep -q 'api.transitous.org/api/v6/plan' "$project_dir/assets/app.js"
grep -q 'dfi.swtue.de/departure_board' "$project_dir/assets/app.js"
grep -q 'fetch("./locations.json"' "$project_dir/assets/app.js"
grep -q 'arrivalRadiusMeters' "$project_dir/assets/app.js"
if grep -q 'Mensa Wilhelmstraße\|Aixer Straße 27\|Sand 14' "$project_dir/assets/app.js"; then
  printf '%s\n' "Fest codiertes Ziel in Browserlogik gefunden" >&2
  exit 1
fi
grep -q 'distanceBetweenMeters' "$project_dir/assets/app.js"
grep -q 'Du bist schon da' "$project_dir/assets/app.js"
grep -q 'function hauptbahnhofTrack' "$project_dir/assets/app.js"
grep -q 'stop.track || stop.scheduledTrack' "$project_dir/assets/app.js"
grep -q 'idParts.indexOf("11000")' "$project_dir/assets/app.js"
grep -q 'Steig ${track}' "$project_dir/assets/app.js"
grep -q 'stopLabel(leg.from)' "$project_dir/assets/app.js"
grep -q 'stopLabel(leg.to)' "$project_dir/assets/app.js"
grep -q 'leg.intermediateStops' "$project_dir/assets/app.js"
grep -q 'intermediateHauptbahnhofTracks' "$project_dir/assets/app.js"
grep -q 'Hauptbahnhof · Steig' "$project_dir/assets/app.js"
if grep -q 'hbf-platforms' "$project_dir/assets/app.js" "$project_dir/assets/styles.css"; then
  printf '%s\n' "Hervorgehobenen Hauptbahnhof-Block gefunden" >&2
  exit 1
fi
grep -q 'navigator.permissions' "$project_dir/assets/app.js"
grep -q 'initializeLocationPermission' "$project_dir/assets/app.js"
grep -q 'takemehome:location-access-enabled' "$project_dir/assets/app.js"
grep -q 'rememberLocationAccess' "$project_dir/assets/app.js"
grep -q 'forgetLocationAccess' "$project_dir/assets/app.js"
grep -q 'localStorage.setItem(LOCATION_ACCESS_KEY, "true")' "$project_dir/assets/app.js"
if grep -q 'localStorage.setItem.*latitude\|localStorage.setItem.*longitude\|localStorage.setItem.*position' "$project_dir/assets/app.js"; then
  printf '%s\n' "Standortkoordinaten werden dauerhaft gespeichert" >&2
  exit 1
fi
grep -q 'HTMLGeolocationElement' "$project_dir/assets/app.js"
grep -q 'addEventListener("location", handleDeclarativeLocation)' "$project_dir/assets/app.js"
if grep -q 'beforeinstallprompt\|installPromptReady\|installButton' "$project_dir/assets/app.js"; then
  printf '%s\n' "Entfernte Installationslogik gefunden" >&2
  exit 1
fi
grep -q 'refreshLabel' "$project_dir/assets/app.js"
grep -q 'serviceWorker.register("./service-worker.js")' "$project_dir/assets/app.js"
if grep -q 'DEMO_LOCATION\|demoButton\|manualStartButtons' "$project_dir/assets/app.js"; then
  printf '%s\n' "Manueller Startpunkt in Browserlogik gefunden" >&2
  exit 1
fi
if grep -q 'setTimeout(requestLocation' "$project_dir/assets/app.js"; then
  printf '%s\n' "Automatische Standortabfrage ohne Nutzeraktion gefunden" >&2
  exit 1
fi
grep -q '"display": "standalone"' "$project_dir/manifest.webmanifest"
grep -q '"sizes": "192x192"' "$project_dir/manifest.webmanifest"
grep -q '"sizes": "512x512"' "$project_dir/manifest.webmanifest"
grep -q 'takemehome-shell-v12' "$project_dir/service-worker.js"
grep -q 'self.registration.scope' "$project_dir/service-worker.js"
grep -q '"start_url": "./"' "$project_dir/manifest.webmanifest"
grep -q '"scope": "./"' "$project_dir/manifest.webmanifest"
printf '%s\n' "Statische App: Tests erfolgreich"
