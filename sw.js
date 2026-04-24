/**
 * sw.js — Service Worker for Offline Caching (PWA)
 *
 * Caches the app shell (HTML, JS, CSS) so the app loads instantly
 * even without internet. Uses cache-first for static assets and
 * network-first for the dynamic fields API.
 *
 * Update flow:
 *  1. When a new sw.js is deployed (CACHE_VERSION changes), the browser
 *     detects it and installs the new SW in the background.
 *  2. The new SW does NOT auto-activate — it waits for the page to
 *     send a SKIP_WAITING message.
 *  3. The page auto-applies the update after a brief reassuring banner.
 *     IndexedDB data (saved entries) is NEVER affected by SW updates.
 *  4. Once SKIP_WAITING is received, the new SW activates, purges old cache,
 *     and the page reloads with fresh files.
 */

const CACHE_VERSION = 'dataentry-v1.9.0.5';
const APP_SHELL = [
    './',
    './index.html',
    './queue.html',
    './app.js',
    './db.js',
    './uploader.js',
    './queue.js',
    './camera.js',
    './config.js',
    './datepicker.js',
    './style.css',
    './queue.css',
    './dist/css/bootstrap.min.css',
    './dist/js/bootstrap.bundle.min.js',
    './dist/js/idb.umd.js'
];

// External CDN — cache on first use
const CDN_URLS = [
];

/**
 * Install: Pre-cache the app shell.
 * Does NOT call skipWaiting() — waits for the page to request it
 * after confirming all pending uploads are done.
 */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => {
            console.log('[SW] Pre-caching app shell');
            return cache.addAll(APP_SHELL);
        })
    );
    // Do NOT skipWaiting here — the page controls when to activate
});

/**
 * Listen for SKIP_WAITING message from the page.
 * This is sent after the page confirms no pending uploads remain.
 */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('[SW] Received SKIP_WAITING — activating new version');
        self.skipWaiting();
    }
});

/**
 * Activate: Clean up old cache versions.
 */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_VERSION)
                    .map((key) => {
                        console.log('[SW] Removing old cache:', key);
                        return caches.delete(key);
                    })
            );
        })
    );
    // Take control of all open tabs immediately
    self.clients.claim();
});

/**
 * Fetch: Cache-first for app shell, network-first for API calls.
 */
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests (POST submissions go straight to network)
    if (event.request.method !== 'GET') return;

    // API calls (Google Apps Script) — network-first with cache fallback
    if (url.href.includes('script.google.com') || url.href.includes('script.googleusercontent.com')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Cache a copy of the API response
                    const clone = response.clone();
                    caches.open(CACHE_VERSION).then((cache) => {
                        cache.put(event.request, clone);
                    });
                    return response;
                })
                .catch(() => {
                    // Offline — serve from cache (ignoring query strings if needed)
                    return caches.match(event.request, { ignoreSearch: true });
                })
        );
        return;
    }

    // CDN resources — cache on first use
    if (CDN_URLS.some(cdn => url.href.startsWith(cdn))) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return fetch(event.request).then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_VERSION).then((cache) => {
                        cache.put(event.request, clone);
                    });
                    return response;
                });
            })
        );
        return;
    }

    // App shell files — cache-first
    event.respondWith(
        caches.match(event.request).then((cached) => {
            return cached || fetch(event.request).then((response) => {
                // Cache new resources dynamically
                const clone = response.clone();
                caches.open(CACHE_VERSION).then((cache) => {
                    cache.put(event.request, clone);
                });
                return response;
            });
        })
    );
});
