"use strict";

const LOCATION_ACCESS_KEY = "takemehome:location-access-enabled";
let destinations = [];
let arrivalRadiusMeters = 250;
let configurationReady;
const state = {
  phase: "idle",
  position: null,
  results: [],
  liveDepartures: new Map(),
  expanded: null,
  error: "",
  updatedAt: null,
  preference: "least-walking",
  includeScooters: false,
  routeRequestId: 0,
  streams: [],
  permissionState: "prompt",
};

const elements = {
  connectionStatus: document.querySelector("#connection-status"),
  refreshButton: document.querySelector("#refresh-button"),
  locationTitle: document.querySelector("#location-title"),
  locationCopy: document.querySelector("#location-copy"),
  updatedAt: document.querySelector("#updated-at"),
  permissionPanel: document.querySelector("#permission-panel"),
  permissionError: document.querySelector("#permission-error"),
  geolocationControl: document.querySelector("#geolocation-control"),
  locationButton: document.querySelector("#location-button"),
  routesSection: document.querySelector("#routes-section"),
  routeGrid: document.querySelector("#route-grid"),
  preferenceButtons: [...document.querySelectorAll("[data-preference]")],
  scooterToggle: document.querySelector("#scooter-toggle"),
};

function remembersLocationAccess() {
  try {
    return window.localStorage.getItem(LOCATION_ACCESS_KEY) === "true";
  } catch {
    return false;
  }
}

function rememberLocationAccess() {
  try {
    window.localStorage.setItem(LOCATION_ACCESS_KEY, "true");
  } catch {
    // Die Browserberechtigung funktioniert auch ohne verfügbaren lokalen Speicher.
  }
}

function forgetLocationAccess() {
  try {
    window.localStorage.removeItem(LOCATION_ACCESS_KEY);
  } catch {
    // Der Browser bleibt die maßgebliche Stelle für die Berechtigung.
  }
}

async function loadLocationConfiguration() {
  const response = await fetch("./locations.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Konfiguration: ${response.status}`);
  const configuration = await response.json();
  if (!Array.isArray(configuration.locations) || configuration.locations.length === 0) {
    throw new Error("Keine Ziele konfiguriert");
  }

  const tones = ["blue", "red", "cream"];
  destinations = configuration.locations.map((location, index) => {
    const id = String(location.id || "").trim();
    const name = String(location.name || "").trim();
    const address = String(location.address || "").trim();
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (!id || !name || !address || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error(`Ungültiges Ziel an Position ${index + 1}`);
    }
    const fallbackLabel = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
    return {
      id,
      name,
      address,
      short: String(location.shortLabel || fallbackLabel).slice(0, 4),
      point: { lat: latitude, lon: longitude },
      tone: tones[index % tones.length],
    };
  });

  if (new Set(destinations.map((destination) => destination.id)).size !== destinations.length) {
    throw new Error("Ziel-IDs müssen eindeutig sein");
  }

  const configuredRadius = Number(configuration.arrivalRadiusMeters);
  if (Number.isFinite(configuredRadius) && configuredRadius >= 0 && configuredRadius <= 5000) {
    arrivalRadiusMeters = configuredRadius;
  }

}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatClock(value) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(date);
}

function minuteLabel(seconds) {
  return `${Math.max(1, Math.round(Number(seconds || 0) / 60))} Min.`;
}

function cleanStopName(name) {
  return String(name || "")
    .replace(/^Tübingen\s+/i, "")
    .replace(/^START$/, "Dein Standort")
    .replace(/^END$/, "Ziel");
}

function hauptbahnhofTrack(stop) {
  if (!stop) return "";
  const stopId = String(stop.stopId || "");
  const isHauptbahnhof = /Hauptbahnhof/i.test(String(stop.name || "")) || stopId.split(":").includes("11000");
  if (!isHauptbahnhof) return "";

  const suppliedTrack = String(stop.track || stop.scheduledTrack || "").trim();
  if (suppliedTrack) return suppliedTrack;

  const idParts = stopId.split(":");
  const stopIndex = idParts.indexOf("11000");
  return stopIndex >= 0 && idParts.length > stopIndex + 2
    ? idParts[stopIndex + 2].replace(/_.*/, "").trim()
    : "";
}

function stopLabel(stop) {
  const name = cleanStopName(stop?.name);
  const track = hauptbahnhofTrack(stop);
  return track ? `${name} · Steig ${track}` : name;
}

function tuebusStopId(stopId) {
  const match = String(stopId || "").match(/(de:\d{5}:[^\s]+)/);
  return match?.[1] ?? null;
}

function rentalProviderName(leg) {
  const name = String(leg?.rental?.systemName || leg?.rental?.providerGroupId || "Mietroller");
  return name
    .replace(/\s+t[uü]bingen$/i, "")
    .replace(/\s+Technology OÜ$/i, "")
    .trim() || "Mietroller";
}

function routeSummary(legs) {
  return legs
    .filter((leg) => leg.mode === "BUS" || leg.mode === "RENTAL")
    .map((leg) => leg.mode === "RENTAL" ? `${rentalProviderName(leg)} E-Roller` : leg.routeShortName || leg.displayName || "Bus")
    .join(" → ");
}

function walkingSeconds(itinerary) {
  return itinerary.legs
    .filter((leg) => leg.mode === "WALK")
    .reduce((total, leg) => total + Number(leg.duration || 0), 0);
}

function distanceBetweenMeters(from, to) {
  const earthRadiusMeters = 6371000;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(to.lat - from.lat);
  const longitudeDelta = toRadians(to.lon - from.lon);
  const fromLatitude = toRadians(from.lat);
  const toLatitude = toRadians(to.lat);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function selectItinerary(itineraries, preference) {
  return [...itineraries].sort((a, b) => {
    if (preference === "least-walking") {
      const walkingDifference = walkingSeconds(a) - walkingSeconds(b);
      if (walkingDifference !== 0) return walkingDifference;
    }
    return new Date(a.endTime).getTime() - new Date(b.endTime).getTime();
  })[0] ?? null;
}

function selectedResults() {
  return state.results
    .map((result) => ({ ...result, itinerary: selectItinerary(result.alternatives, state.preference) }))
    .sort((a, b) => {
      if (!a.itinerary) return 1;
      if (!b.itinerary) return -1;
      return new Date(a.itinerary.endTime).getTime() - new Date(b.itinerary.endTime).getTime();
    });
}

function closeStreams() {
  state.streams.forEach((stream) => stream.close());
  state.streams = [];
}

function statusMarkup(live, cancelled) {
  if (cancelled) return '<span class="status-pill cancelled">Fällt aus</span>';
  return `<span class="status-pill ${live ? "live" : "plan"}"><span class="pulse-dot" aria-hidden="true"></span>${live ? "TüBus live" : "Fahrplan"}</span>`;
}

function rentalStatusMarkup(leg) {
  return `<span class="status-pill rental"><span class="pulse-dot" aria-hidden="true"></span>${escapeHtml(rentalProviderName(leg))} Mietroller</span>`;
}

function safeRentalUri(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:", "bolt:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function rentalAppUri(leg) {
  const rental = leg?.rental || {};
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent)) {
    return safeRentalUri(rental.rentalUriIOS || rental.rentalUriWeb);
  }
  if (/Android/i.test(navigator.userAgent)) {
    return safeRentalUri(rental.rentalUriAndroid || rental.rentalUriWeb);
  }
  return safeRentalUri(rental.rentalUriWeb);
}

function rentalMapMarkup(leg) {
  const latitude = Number(leg?.from?.lat);
  const longitude = Number(leg?.from?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";

  const latitudePadding = 0.0022;
  const longitudePadding = 0.0033;
  const bbox = [
    longitude - longitudePadding,
    latitude - latitudePadding,
    longitude + longitudePadding,
    latitude + latitudePadding,
  ].join(",");
  const mapParameters = new URLSearchParams({ bbox, layer: "mapnik", marker: `${latitude},${longitude}` });
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?${mapParameters}`;
  const fullMapUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(latitude)}&mlon=${encodeURIComponent(longitude)}#map=18/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}`;
  const appUri = rentalAppUri(leg);
  const provider = rentalProviderName(leg);

  return `
    <section class="rental-map" aria-label="Standort des Miet-E-Rollers">
      <div class="rental-map-heading">
        <div><strong>${escapeHtml(provider)}-Roller finden</strong><span>Marker zeigt den aktuellen Fahrzeugstandort</span></div>
        <div class="rental-map-links">
          ${appUri ? `<a href="${escapeHtml(appUri)}">Anbieter-App</a>` : ""}
          <a href="${escapeHtml(fullMapUrl)}" target="_blank" rel="noreferrer">Große Karte</a>
        </div>
      </div>
      <iframe src="${escapeHtml(mapUrl)}" title="Karte zum ${escapeHtml(provider)}-Roller" loading="lazy" referrerpolicy="no-referrer"></iframe>
    </section>`;
}

function detailMarkup(leg, index) {
  const isWalk = leg.mode === "WALK";
  const isRental = leg.mode === "RENTAL";
  const symbol = isWalk ? "↗" : isRental ? "R" : leg.routeShortName || "B";
  const heading = isWalk
    ? `${minuteLabel(leg.duration)} zu Fuß`
    : isRental
      ? `${minuteLabel(leg.duration)} mit E-Roller`
      : `Bus ${leg.routeShortName || leg.displayName || ""}`;
  const direction = !isWalk && leg.headsign ? ` · Richtung ${cleanStopName(leg.headsign)}` : "";
  const intermediateHauptbahnhofTracks = isWalk
    ? []
    : [...new Set((leg.intermediateStops || []).map(hauptbahnhofTrack).filter(Boolean))];
  const platformNote = intermediateHauptbahnhofTracks.length
    ? `<p>Hauptbahnhof · Steig ${escapeHtml(intermediateHauptbahnhofTracks.join(" → "))}</p>`
    : "";
  const legDescription = isRental
    ? `${rentalProviderName(leg)} · bis zum Abstellpunkt`
    : `${stopLabel(leg.from)} → ${stopLabel(leg.to)}${direction}`;
  return `
    <div class="detail-row" data-leg="${index}">
      <div class="detail-symbol ${isWalk ? "walk" : isRental ? "rental" : "bus"}" aria-hidden="true">${escapeHtml(symbol)}</div>
      <div class="detail-copy">
        <div class="detail-heading"><strong>${escapeHtml(heading)}</strong><span>${escapeHtml(formatClock(leg.startTime))}–${escapeHtml(formatClock(leg.endTime))}</span></div>
        <p>${escapeHtml(legDescription)}</p>${platformNote}
      </div>
    </div>`;
}

function transferLabel(legs) {
  const busCount = legs.filter((leg) => leg.mode === "BUS").length;
  return busCount <= 1 ? "Direkt" : `${busCount - 1}× umsteigen`;
}

function routeCardMarkup(result) {
  const { destination, itinerary } = result;
  if (result.nearby) {
    const roundedDistance = Math.max(0, Math.round(result.distanceMeters / 10) * 10);
    return `
      <article class="route-card is-nearby tone-${escapeHtml(destination.tone)}">
        <div class="card-topline">
          <div class="destination-mark" aria-hidden="true">${escapeHtml(destination.short)}</div>
          <div class="destination-copy"><p class="eyebrow">Nach</p><h2>${escapeHtml(destination.name)}</h2><p>${escapeHtml(destination.address)}</p></div>
        </div>
        <div class="already-there"><span aria-hidden="true">✓</span><div><strong>Du bist schon da</strong><p>Das Ziel ist nur etwa ${escapeHtml(roundedDistance)} Meter entfernt. Dafür brauchst du keine Fahrt.</p></div></div>
      </article>`;
  }
  if (!itinerary) {
    return `
      <article class="route-card tone-${escapeHtml(destination.tone)}">
        <div class="card-topline">
          <div class="destination-mark" aria-hidden="true">${escapeHtml(destination.short)}</div>
          <div class="destination-copy"><p class="eyebrow">Nach</p><h2>${escapeHtml(destination.name)}</h2><p>${escapeHtml(destination.address)}</p></div>
        </div>
        <div class="route-empty"><span aria-hidden="true">!</span><div><strong>Gerade keine Verbindung gefunden</strong><p>${escapeHtml(result.error || "Bitte aktualisiere die Suche in einem Moment noch einmal.")}</p></div></div>
      </article>`;
  }

  const busLegs = itinerary.legs.filter((leg) => leg.mode === "BUS");
  const firstBus = busLegs[0];
  const firstRental = itinerary.legs.find((leg) => leg.mode === "RENTAL");
  const firstRideIndex = itinerary.legs.findIndex((leg) => leg.mode === "BUS" || leg.mode === "RENTAL");
  const firstRide = itinerary.legs[firstRideIndex];
  const firstWalk = itinerary.legs.slice(0, firstRideIndex).find((leg) => leg.mode === "WALK");
  if (!firstRide) return "";
  const live = state.liveDepartures.get(destination.id);
  const liveMinutes = Number(live?.countdown_minutes);
  const startsWithRental = firstRide.mode === "RENTAL";
  const departLabel = startsWithRental
    ? "Jetzt"
    : Number.isFinite(liveMinutes)
      ? (liveMinutes === 0 ? "Jetzt" : `${liveMinutes} Min.`)
      : formatClock(firstBus.startTime || itinerary.startTime);
  const isExpanded = state.expanded === destination.id;
  const quickTarget = startsWithRental
    ? `zum ${rentalProviderName(firstRide)}-E-Roller`
    : `bis ${stopLabel(firstBus.from)}`;
  const detailsNote = firstBus
    ? "Ankunft nach aktuellem Fahrplan; die Abfahrt des ersten Busses wird direkt mit TüBus abgeglichen."
    : "Die Rollerverfügbarkeit stammt aus den aktuellen Sharing-Daten und kann sich kurzfristig ändern.";
  const detailsButtonLabel = isExpanded
    ? "Details schließen"
    : firstRental
      ? "Route & Karte ansehen"
      : "Route ansehen";

  return `
    <article class="route-card tone-${escapeHtml(destination.tone)}">
      <div class="card-topline">
        <div class="destination-mark" aria-hidden="true">${escapeHtml(destination.short)}</div>
        <div class="destination-copy"><p class="eyebrow">Nach</p><h2>${escapeHtml(destination.name)}</h2><p>${escapeHtml(destination.address)}</p></div>
        ${firstBus ? statusMarkup(Boolean(live?.is_realtime), Boolean(live?.cancelled || firstBus.cancelled)) : rentalStatusMarkup(firstRental)}
      </div>
      <div class="journey-hero">
        <div><span class="time-label">Los in</span><strong class="depart-time">${escapeHtml(departLabel)}</strong></div>
        <div class="journey-line" aria-hidden="true"><span></span><i>→</i><span></span></div>
        <div class="arrival-block"><span class="time-label">Ankunft</span><strong>${escapeHtml(formatClock(itinerary.endTime))}</strong></div>
      </div>
      <div class="route-facts"><span class="bus-number">${escapeHtml(routeSummary(itinerary.legs))}</span><span>${escapeHtml(minuteLabel(itinerary.duration))}</span><span>${escapeHtml(minuteLabel(walkingSeconds(itinerary)))} Fußweg</span><span>${escapeHtml(transferLabel(itinerary.legs))}</span></div>
      <div class="quick-instruction">
        <span class="walk-icon" aria-hidden="true">↗</span>
        <p><strong>${firstWalk ? escapeHtml(minuteLabel(firstWalk.duration)) : "Kurz"} zu Fuß</strong><span>${escapeHtml(quickTarget)}</span></p>
      </div>
      <button class="details-button" type="button" data-route-details="${escapeHtml(destination.id)}" aria-expanded="${isExpanded}">${escapeHtml(detailsButtonLabel)}<span aria-hidden="true">${isExpanded ? "−" : "+"}</span></button>
      ${isExpanded ? `<div class="route-details">${itinerary.legs.map(detailMarkup).join("")}${firstRental ? rentalMapMarkup(firstRental) : ""}<p class="details-note">${escapeHtml(detailsNote)}</p></div>` : ""}
    </article>`;
}

function loadingMarkup() {
  const card = '<article class="route-card loading-card"><div class="loading-line short"></div><div class="loading-line title"></div><div class="loading-time"></div><div class="loading-line"></div><div class="loading-line half"></div></article>';
  return `${card}${card}${card}<span class="sr-only">Verbindungen werden geladen</span>`;
}

function render() {
  const busy = state.phase === "locating" || state.phase === "loading";
  document.documentElement.dataset.phase = state.phase;
  elements.connectionStatus.textContent = state.phase === "ready" ? "Live verbunden" : busy ? "Wird geladen" : state.phase === "error" ? "Standort fehlt" : "Standort wählen";
  elements.refreshButton.disabled = busy;
  elements.refreshButton.querySelector("span").classList.toggle("spin", busy);
  const refreshLabel = busy ? "Verbindungen werden aktualisiert" : "Verbindungen aktualisieren";
  elements.refreshButton.setAttribute("aria-label", refreshLabel);
  elements.refreshButton.title = refreshLabel;

  elements.preferenceButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.preference === state.preference)));
  elements.scooterToggle.checked = state.includeScooters;

  elements.locationTitle.textContent = state.phase === "locating" ? "Standort wird bestimmt …" : state.position ? "Aktueller Standort" : "Standortfreigabe benötigt";
  elements.locationCopy.textContent = state.position ? `${state.position.lat.toFixed(4)}, ${state.position.lon.toFixed(4)}` : "Nur für die aktuelle Routenabfrage";
  if (state.updatedAt) {
    elements.updatedAt.hidden = false;
    elements.updatedAt.textContent = `Stand ${state.updatedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
  } else {
    elements.updatedAt.hidden = true;
  }

  elements.permissionPanel.hidden = state.phase !== "idle" && state.phase !== "error";
  elements.permissionError.textContent = state.error || "Tippe auf „Standort verwenden“. Erst dann fragt Chrome nach deiner Berechtigung.";
  elements.locationButton.textContent = state.phase === "error" ? "Erneut versuchen" : "Standort verwenden";
  elements.routesSection.setAttribute("aria-busy", String(busy));

  if (busy) {
    elements.routeGrid.className = "route-grid loading-grid";
    elements.routeGrid.setAttribute("role", "status");
    elements.routeGrid.innerHTML = loadingMarkup();
  } else if (state.phase === "ready") {
    elements.routeGrid.className = "route-grid";
    elements.routeGrid.removeAttribute("role");
    elements.routeGrid.innerHTML = selectedResults().map(routeCardMarkup).join("");
    elements.routeGrid.querySelectorAll("[data-route-details]").forEach((button) => {
      button.addEventListener("click", () => {
        state.expanded = state.expanded === button.dataset.routeDetails ? null : button.dataset.routeDetails;
        render();
      });
    });
  } else {
    elements.routeGrid.className = "waiting-card";
    elements.routeGrid.removeAttribute("role");
    elements.routeGrid.innerHTML = "<p>Nach deiner Standortfreigabe erscheinen hier automatisch die passenden Verbindungen.</p>";
  }
}

function connectLiveStreams() {
  closeStreams();
  selectedResults().forEach(({ destination, itinerary }) => {
    const busLeg = itinerary?.legs.find((leg) => leg.mode === "BUS");
    const stopId = tuebusStopId(busLeg?.from?.stopId);
    const line = busLeg?.routeShortName || busLeg?.displayName;
    if (!stopId || !line) return;

    const url = new URL("https://dfi.swtue.de/departure_board");
    url.searchParams.set("max_departures", "12");
    url.searchParams.set("timespan_minutes", "120");
    url.searchParams.set("stop_id", stopId);
    const stream = new EventSource(url);
    stream.addEventListener("departures", (event) => {
      try {
        const departures = JSON.parse(event.data);
        const planned = formatClock(busLeg.startTime);
        const matches = departures.filter((departure) => departure.line === line);
        const match = matches.find((departure) => departure.departure_time === planned) || matches[0];
        if (match) {
          state.liveDepartures.set(destination.id, match);
          render();
        }
      } catch {
        // Der Fahrplan bleibt nutzbar, wenn eine Echtzeitmeldung fehlerhaft ist.
      }
    });
    state.streams.push(stream);
  });
}

async function loadRoutes(point) {
  const requestId = ++state.routeRequestId;
  const includeScooters = state.includeScooters;
  state.phase = "loading";
  state.error = "";
  state.liveDepartures.clear();
  closeStreams();
  render();

  try {
    const results = await Promise.all(destinations.map(async (destination) => {
      const distanceMeters = distanceBetweenMeters(point, destination.point);
      if (distanceMeters <= arrivalRadiusMeters) {
        return { destination, alternatives: [], nearby: true, distanceMeters };
      }
      const params = new URLSearchParams({
        fromPlace: `${point.lat},${point.lon}`,
        toPlace: `${destination.point.lat},${destination.point.lon}`,
        transitModes: "BUS",
        directModes: includeScooters ? "RENTAL" : "",
        preTransitModes: includeScooters ? "WALK,RENTAL" : "WALK",
        postTransitModes: includeScooters ? "WALK,RENTAL" : "WALK",
        detailedLegs: "false",
        maxTransfers: "2",
      });
      if (includeScooters) {
        params.set("directRentalFormFactors", "SCOOTER_STANDING");
        params.set("preTransitRentalFormFactors", "SCOOTER_STANDING");
        params.set("postTransitRentalFormFactors", "SCOOTER_STANDING");
        params.set("directRentalPropulsionTypes", "ELECTRIC");
        params.set("preTransitRentalPropulsionTypes", "ELECTRIC");
        params.set("postTransitRentalPropulsionTypes", "ELECTRIC");
      }
      try {
        const response = await fetch(`https://api.transitous.org/api/v6/plan?${params}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Routenserver: ${response.status}`);
        const data = await response.json();
        const alternatives = [...(data.itineraries || []), ...(data.direct || [])]
          .filter((item) => item.legs.some((leg) => leg.mode === "BUS" || (includeScooters && leg.mode === "RENTAL")));
        return { destination, alternatives };
      } catch {
        return { destination, alternatives: [], error: "Die Live-Auskunft ist vorübergehend nicht erreichbar." };
      }
    }));
    if (requestId !== state.routeRequestId) return;
    state.results = results;
    state.updatedAt = new Date();
    state.phase = "ready";
    render();
    connectLiveStreams();
  } catch {
    if (requestId !== state.routeRequestId) return;
    state.error = "Die Verbindungen konnten gerade nicht geladen werden.";
    state.phase = "error";
    render();
  }
}

function requestLocation() {
  if (!window.isSecureContext) {
    state.error = "Standortzugriff ist nur über eine sichere HTTPS-Verbindung möglich.";
    state.phase = "error";
    render();
    return;
  }
  if (!navigator.geolocation) {
    state.error = "Dieser Browser unterstützt keine Standortfreigabe.";
    state.phase = "error";
    render();
    return;
  }

  state.phase = "locating";
  state.error = "";
  render();
  navigator.geolocation.getCurrentPosition(
    usePosition,
    (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        state.permissionState = "denied";
        forgetLocationAccess();
        state.error = "Der Standortzugriff ist in Chrome blockiert. Öffne die Website-Informationen links in der Adresszeile, stelle „Standort“ auf „Zulassen“ und versuche es danach erneut.";
      } else if (error.code === error.TIMEOUT) {
        state.error = "Die Standortbestimmung hat zu lange gedauert. Prüfe, ob die Ortungsdienste des Telefons eingeschaltet sind, und versuche es erneut.";
      } else {
        state.error = "Dein Standort konnte nicht bestimmt werden. Prüfe die Ortungsdienste und versuche es erneut.";
      }
      state.phase = "error";
      render();
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 120000 },
  );
}

async function usePosition(position) {
  try {
    await configurationReady;
  } catch {
    return;
  }
  state.permissionState = "granted";
  rememberLocationAccess();
  state.position = { lat: position.coords.latitude, lon: position.coords.longitude };
  loadRoutes(state.position);
}

function handleDeclarativeLocation(event) {
  const control = event.currentTarget;
  if (control.position) {
    state.permissionState = "granted";
    usePosition(control.position);
    return;
  }
  if (control.error) {
    if (control.error.code === control.error.PERMISSION_DENIED) forgetLocationAccess();
    state.error = control.error.code === control.error.PERMISSION_DENIED
      ? "Chrome konnte den Standort nicht freigeben. Tippe erneut auf das Standort-Steuerelement, um die Freigabe wiederherzustellen."
      : "Dein Standort konnte nicht bestimmt werden. Prüfe, ob die Ortungsdienste des Telefons eingeschaltet sind, und versuche es erneut.";
    state.phase = "error";
    render();
  }
}

async function initializeLocationPermission() {
  if (!navigator.geolocation) {
    state.error = "Dieser Browser unterstützt keine Standortfreigabe.";
    state.phase = "error";
    render();
    return;
  }
  const rememberedAccess = remembersLocationAccess();
  if (!navigator.permissions?.query) {
    if (rememberedAccess) requestLocation();
    return;
  }

  try {
    const permission = await navigator.permissions.query({ name: "geolocation" });
    state.permissionState = permission.state;
    if (permission.state === "granted") {
      if (!("HTMLGeolocationElement" in window)) requestLocation();
    } else if (permission.state === "prompt" && rememberedAccess) {
      requestLocation();
    } else if (permission.state === "denied") {
      forgetLocationAccess();
      state.error = "Tippe auf das Standort-Steuerelement. Chrome öffnet direkt den passenden Dialog zur erneuten Freigabe.";
      state.phase = "error";
      render();
    }

    permission.addEventListener?.("change", () => {
      state.permissionState = permission.state;
      if (permission.state === "granted" && !state.position) {
        if (!("HTMLGeolocationElement" in window)) requestLocation();
      } else if (permission.state === "denied") {
        forgetLocationAccess();
        state.error = "Tippe auf das Standort-Steuerelement. Chrome öffnet direkt den passenden Dialog zur erneuten Freigabe.";
        state.phase = "error";
        render();
      }
    });
  } catch {
    // Nicht alle mobilen Browser unterstützen die Permissions API vollständig.
    if (rememberedAccess) requestLocation();
  }
}

elements.preferenceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.preference = button.dataset.preference;
    state.liveDepartures.clear();
    state.expanded = null;
    render();
    if (state.phase === "ready") connectLiveStreams();
  });
});

elements.scooterToggle.addEventListener("change", () => {
  state.includeScooters = elements.scooterToggle.checked;
  state.liveDepartures.clear();
  state.expanded = null;
  if (state.position) loadRoutes(state.position);
  else render();
});

elements.refreshButton.addEventListener("click", () => state.position ? loadRoutes(state.position) : requestLocation());
elements.locationButton.addEventListener("click", requestLocation);
elements.geolocationControl.addEventListener("location", handleDeclarativeLocation);
window.addEventListener("beforeunload", closeStreams);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

render();
configurationReady = loadLocationConfiguration();
configurationReady
  .then(() => {
    render();
    return initializeLocationPermission();
  })
  .catch(() => {
    state.error = "Die Ziele in locations.json konnten nicht geladen werden. Bitte prüfe die Konfigurationsdatei.";
    state.phase = "error";
    render();
  });
window.setInterval(() => {
  if (state.phase === "ready" && state.position) loadRoutes(state.position);
}, 5 * 60 * 1000);
