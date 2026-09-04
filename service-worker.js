"use strict";

const CACHE_NAME = "takemehome-shell-v12";
const scopeUrl = (path = "") => new URL(path, self.registration.scope).href;
const APP_SHELL = [
  "",
  "assets/styles.css",
  "assets/app.js",
  "locations.json",
  "manifest.webmanifest",
  "assets/favicon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
].map(scopeUrl);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match(scopeUrl());
        return Response.error();
      }),
  );
});
