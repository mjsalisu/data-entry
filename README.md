# Jobberman BCWS Data Entry Portal

**Offline-first Progressive Web App** for collecting participant data during Jobberman Building Careers for Workplace Success (BCWS) training sessions across Nigeria.

Designed for 200+ simultaneous field users on Android/iOS with unreliable internet.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [File Structure](#file-structure)
- [Setup & Deployment](#setup--deployment)
- [Google Apps Script Setup](#google-apps-script-setup)
- [How It Works](#how-it-works)
- [Deploying Updates](#deploying-updates)
- [Concurrency & Safety](#concurrency--safety)
- [Troubleshooting](#troubleshooting)
- [Important Notes](#important-notes)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                   User's Phone                   │
│                                                   │
│   index.html ←→ app.js        queue.html ←→ queue.js │
│       │              │              │              │
│       └──── db.js (IndexedDB) ─────┘              │
│              │                                     │
│         uploader.js                                │
│       (background sync)                            │
│              │                                     │
│         sw.js (Service Worker cache)               │
└──────────────┬─────────────────────────────────────┘
               │ POST (upload) / GET (verify, dynamic fields)
               ▼
┌─────────────────────────────────────────────────┐
│           Google Apps Script (code.gs)            │
│                                                   │
│   doPost() → LockService → appendRow → Sheet     │
│   doGet()  → verify UUID / getDynamicFields      │
│              │                                     │
│   Google Drive (Participant_Snapshots folder)     │
└─────────────────────────────────────────────────┘
```

### Flow

1. **User fills form** on `index.html` → saves to **IndexedDB** (works offline)
2. **User taps Upload Queue** (bottom tab) → `queue.html` shows all saved entries
3. **Upload All** → `uploader.js` sends entries one-by-one to Google Apps Script
4. **Server** writes to Google Sheet + uploads images to Google Drive
5. **Verify** (optional) → checks each UUID against the Sheet

---

## File Structure

| File | Purpose |
|---|---|
| `index.html` | Main data entry form (55+ fields, multi-step) |
| `queue.html` | Upload queue management page |
| `app.js` | Form logic, validation, draft saving, certificate ID generation |
| `queue.js` | Queue page: list rendering, stats, verify, detail panel |
| `db.js` | IndexedDB wrapper (save/read/update/delete submissions) |
| `uploader.js` | Background upload engine with retry, backoff, circuit breaker |
| `camera.js` | Native camera capture + image processing |
| `config.js` | **SCRIPT_URL** + state codes + refreshment options |
| `datepicker.js` | Custom date picker component |
| `style.css` | Shared styles (form page + bottom tab bar) |
| `queue.css` | Queue page dark theme styles |
| `sw.js` | Service Worker: offline caching + update flow |
| `manifest.json` | PWA manifest (installable on home screen) |
| `code.gs` | Google Apps Script backend (**deploy separately**) |
| `dist/` | Bootstrap CSS/JS (bundled locally for offline use) |

---

## Setup & Deployment

### Prerequisites

- A web server (Apache/XAMPP, Nginx, or any static hosting)
- A Google account with access to Google Sheets and Google Drive
- Google Apps Script project linked to the target spreadsheet

### 1. Deploy the Frontend

Copy all files to your web server's public directory:

```
/your-server/DataEntry/
├── index.html
├── queue.html
├── app.js, db.js, uploader.js, queue.js, camera.js, config.js, datepicker.js
├── style.css, queue.css
├── sw.js, manifest.json
└── dist/
    ├── css/bootstrap.min.css
    └── js/bootstrap.bundle.min.js
```

> **HTTPS is required** for Service Workers and camera access. Use HTTPS in production.

### 2. Deploy Google Apps Script

See [Google Apps Script Setup](#google-apps-script-setup) below.

### 3. Update `config.js`

Set the `SCRIPT_URL` to your deployed Apps Script web app URL:

```javascript
const SCRIPT_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
```

---

## Google Apps Script Setup

### Sheet Requirements

The target Google Sheet must have:

| Sheet Name | Purpose |
|---|---|
| `BCWS_Data` | Main data sheet — receives all form submissions |
| `DynamicFields` | Lookup sheet for state → inputtedBy → institution cascading dropdowns |
| `Errors` | Auto-created — logs any server-side errors |

### BCWS_Data Column Layout (A–BC)

| Column | Field |
|---|---|
| A | Timestamp |
| B | Participant Consent |
| C | Certificate ID |
| D | Post-Test Score |
| E | Inputted by |
| F | Jobberman SST Certificate? |
| G–N | Learner's Biodata (Name, Email, Phone, Type, Alt Phone, Address, Gender, DOB) |
| O–V | Education & Employment (Qualification, Level, Status, Occupation, Industry, Role, Skills, Income) |
| W–AB | Demographics (State, Training Details, Settlement, IDP, Disability, Disability Type) |
| AC–AH | Business & Tech (Existing Biz, Nature, Training, Tech Access, Internet, Language) |
| AI–AO | Training & Job Search (Prev Training, Reason, Confidence, Duration, Challenge, Outcome, CV) |
| AP–AW | Feedback (Hall Rating, Facilities, Biscuit, Drink, Water, Satisfaction, Enhanced, Facilitator) |
| AX–BA | Snapshots (PreTest URL, PreTest Path, PostTest URL, PostTest Path) |
| BB | Duplicate Flag |
| **BC** | **Submission UUID** ← Required for offline-first tracking |

> **⚠️ IMPORTANT**: Column BC must have a "UUID" header. This column is used for duplicate detection and verification.

### DynamicFields Sheet Layout

| Column A | Column B | Column C |
|---|---|---|
| State Name | Inputted By Name | Institution Name |

### Deploying code.gs

1. Open your Google Sheet → **Extensions** → **Apps Script**
2. Replace the code editor content with the contents of `code.gs`
3. Click **Deploy** → **New deployment**
4. Select type: **Web app**
5. Settings:
   - **Execute as**: Me
   - **Who has access**: Anyone
6. Click **Deploy** → copy the web app URL
7. Paste the URL into `config.js` as `SCRIPT_URL`

### Redeploying After Changes

When you update `code.gs`:

1. Open Apps Script editor
2. Click **Deploy** → **Manage deployments**
3. Click the pencil icon (edit) on your active deployment
4. Change **Version** to **New version**
5. Click **Deploy**

> **⚠️ CRITICAL**: You must create a **New version** for changes to take effect. Editing the code without redeploying does nothing.

---

## How It Works

### Offline-First Save

1. User fills the form and taps **Save Entry**
2. Form data + camera snapshots are saved to **IndexedDB** as Blobs
3. Each entry gets a unique **UUID** (used for duplicate detection)
4. Entry status: `pending` → ready for upload
5. User can continue entering more records without internet

### Upload Process

1. User opens **Upload Queue** (bottom tab bar)
2. Taps **Upload All**
3. `uploader.js` processes entries one at a time:
   - Random initial delay (0–10s jitter) to stagger 200 users
   - For each entry: convert Blobs → base64, POST to Apps Script
   - On success: mark as `confirmed`
   - On failure: auto-retry with exponential backoff (5s → 10s → 20s)
   - Random 2–5s delay between entries
4. Circuit breaker: after 5 consecutive failures → 60–90s cooldown → resumes

### Verification (Optional)

The **🔍 Verify Uploads** button checks each uploaded entry's UUID against the Google Sheet:
- Calls `GET ?action=verify&uuid=xxx` for each entry
- Shows ✅ Found / ❌ Not Found per entry
- Entries not found may need re-uploading (reset status to pending and re-upload)

### Draft Saving

Form progress is auto-saved to `localStorage` every few seconds. If the user leaves and returns, the form restores their last state.

---

## Deploying Updates

### Step-by-Step

1. Make your code changes (HTML, JS, CSS)
2. **Bump `CACHE_VERSION`** in `sw.js`:
   ```javascript
   // Change this version string (e.g., v1.5 → v1.6)
   const CACHE_VERSION = 'dataentry-v1.6';
   ```
3. Upload files to your web server
4. Users will automatically receive the update:

### Update Flow (Automatic)

```
New sw.js deployed
    ↓
Browser detects new version (checks every 30 min + on page load)
    ↓
Has pending uploads in IndexedDB?
    ├─ NO  → Auto-applies update, page reloads with fresh files ✅
    └─ YES → Shows blue banner: "App update available!
              Upload your X pending entries first."
              ├─ Checks every 3 seconds → auto-updates when pending = 0
              └─ "Update Now" button → confirms, then reloads
```

> **IndexedDB data is NEVER deleted** by updates. Only the cache (HTML/JS/CSS) is refreshed.

### If Users Are Stuck on Old Version

1. Ask them to refresh the page (pull-down refresh on mobile)
2. If still stuck: **Chrome** → Settings → Site Settings → Clear data for the site
3. Nuclear option: Uninstall the PWA and reinstall

---

## Concurrency & Safety

Designed for **200+ simultaneous users** uploading at the same time.

### Server-Side Protection (code.gs)

| Layer | Mechanism |
|---|---|
| **Row Locking** | `LockService.getScriptLock()` — only one `appendRow` executes at a time. Each request waits up to 30s for the lock. |
| **Duplicate Detection** | Before writing, checks if the UUID already exists in column BC. If found, returns success without re-writing. |
| **Atomic Flush** | `SpreadsheetApp.flush()` forces the write to commit before releasing the lock. |
| **Error Logging** | Failed writes are logged to an `Errors` sheet with timestamp, error message, and payload. |

### Client-Side Protection (uploader.js)

| Layer | Mechanism |
|---|---|
| **Initial Jitter** | Random 0–10s delay before starting uploads — prevents 200 devices from POSTing at t=0 |
| **Inter-Upload Delay** | Random 2–5s gap between each upload |
| **Retry with Backoff** | Each POST retries up to 3 times with exponential backoff (2s → 4s → 8s + jitter) |
| **Smart Waiting** | Failed entries show "Server busy — retrying in Xs..." with live countdown instead of immediate failure |
| **Circuit Breaker** | After 5 consecutive failures → 60–90s cooldown with countdown → resumes automatically |
| **Sequential Processing** | One upload at a time — never parallel POSTs |

### Data Safety

| Feature | How |
|---|---|
| **Persistent Storage** | `navigator.storage.persist()` — prevents browser from auto-evicting IndexedDB |
| **Leave Warning** | `beforeunload` event warns users if they try to close the tab with pending entries |
| **UUID Tracking** | Every submission has a unique UUID for server-side duplicate detection |

---

## Troubleshooting

### "Upload sent but not yet verified"
This status is from an older version. After updating, uploads are marked as `confirmed` immediately on successful POST. Run **🔍 Verify Uploads** to check against the sheet.

### Data going to wrong Google Sheet
1. Check `config.js` → `SCRIPT_URL` points to the correct deployment
2. **Clear the service worker cache** — the old `config.js` may be cached:
   - Bump `CACHE_VERSION` in `sw.js` and redeploy
   - Or: Chrome DevTools → Application → Service Workers → Unregister
3. Ensure you redeployed the Apps Script as a **New version**

### Service Worker serving stale files
1. Bump `CACHE_VERSION` in `sw.js` (mandatory for any code change)
2. Hard-refresh: `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows)
3. Chrome DevTools → Application → Cache Storage → Delete all

### Verify returns "Not Found" for entries that were uploaded
- The sheet must have data in **column BC** (UUID column, index 54 zero-based)
- Check the sheet to confirm the UUID column header exists
- The entry may have been uploaded to a different sheet (wrong `SCRIPT_URL` — see above)

### Camera not working
- HTTPS is required for `getUserMedia` (camera access)
- Mobile browsers need the page to be served over HTTPS
- `localhost` works for testing

### Users can't install the PWA
- Requires HTTPS
- The `manifest.json` must be accessible
- Check Chrome DevTools → Application → Manifest for errors

---

## Important Notes

### For Administrators

- **Never change column order** in the BCWS_Data sheet once data entry has started. The `appendRow` in `code.gs` writes columns by position, not by name.
- **Column BC (UUID)** must exist with a header. Add "UUID" as the header in column BC if missing.
- **DynamicFields sheet** must exist with the structure: State | Inputted By | Institution. This feeds the cascading dropdowns on the form.
- **Google Drive folder** `Participant_Snapshots` is auto-created. Images are organized as: `Participant_Snapshots/{Month}_{Year}/{State}/{Name}_{Label}_{Timestamp}.jpg`

### For Users / Field Agents

- **Do not use Incognito/Private mode** — IndexedDB data is deleted when the window closes
- **Do not clear browser data** while you have pending uploads — this erases your saved entries
- **Install the app** on your home screen for the best experience (browser → "Add to Home Screen")
- You can fill forms **without internet** — entries are stored locally until you upload
- The **Upload Queue** tab shows all your saved entries with their status

### For Developers

- All frontend code is **vanilla JavaScript** — no frameworks, no build step
- Bootstrap is bundled locally in `dist/` for offline use
- The `BroadcastChannel` API is used for cross-page communication (form ↔ queue)
- IndexedDB stores images as **Blobs** (not base64) to save ~33% storage
- `code.gs` is NOT deployed with the frontend — it lives in the Google Apps Script editor attached to the Google Sheet
- When making changes: **always bump `CACHE_VERSION` in `sw.js`** or users won't see updates

---

## Version History

| Version | Date | Changes |
|---|---|---|
| v1.0 | Initial | Basic form with direct POST submission |
| v1.5 | Apr 2026 | Offline-first rewrite: IndexedDB, bulk upload, PWA, queue page, bottom tab bar, verify button, LockService, UUID duplicate detection, exponential backoff, circuit breaker, update-aware service worker |
