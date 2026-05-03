// ─────────────────────────────────────────────
// ZONE ROUTING — Multi-Sheet Traffic Splitting
//
// Each zone targets its own Google Apps Script (and therefore its own Sheet).
// The zone is selected via the ?zone= URL parameter. Once chosen, it is
// persisted in sessionStorage so navigation (tabs, submit, queue) never
// loses the zone.
//
// Landing page: no ?zone= param → index.html shows zone-selection cards.
// ─────────────────────────────────────────────

const ZONE_CONFIG = {
    "south-south": {
        label: "South-South",
        emoji: "🌊",
        color: "#0077b6",
        gradient: "linear-gradient(135deg,#0077b6,#023e8a)",
        scriptUrl: "https://script.google.com/macros/s/AKfycbwj61HfJ37mdh8_GY6dm4H7IVaGAh6WtRH4ir9XJV8sdf46f1Xe8OnLdQ1AuogbQCo3Aw/exec",
        // Only these states will appear in the State dropdown for this zone
        states: ["Akwa Ibom", "Cross River", "Delta", "Edo"]
    },
    "south-west": {
        label: "South-West",
        emoji: "🌅",
        color: "#7b2d8b",
        gradient: "linear-gradient(135deg,#7b2d8b,#4a0072)",
        scriptUrl: "https://script.google.com/macros/s/AKfycbzgKfM6_Cqnei11tznrpYdIstVBk6tT__mKhQbpKRixuSGV2Yy4M9_oP-dvdV14NyyVTQ/exec",
        states: ["Ogun", "Ondo", "Oyo"]
    },
    "south-east": {
        label: "South-East",
        emoji: "🌄",
        color: "#2d6a4f",
        gradient: "linear-gradient(135deg,#2d6a4f,#1b4332)",
        scriptUrl: "https://script.google.com/macros/s/AKfycbyT_a_B0aJPil60sl60u7cmTCpb8vrcmp8diHYRmL_STjsZkMu-t49o7hIRAlQ5AToT/exec",
        states: ["Abia", "Enugu"]
    },
    "north-central": {
        label: "North-Central",
        emoji: "🏔️",
        color: "#c77800",
        gradient: "linear-gradient(135deg,#c77800,#7c4f00)",
        scriptUrl: "https://script.google.com/macros/s/AKfycby3UIbMOznzQB6G1XAPpipmdYKA9Tc_DDDZTYyoX4_y734HuB5GwdJZaBbgzHeG6uRvgA/exec",
        states: ["Benue", "Nasarawa"]
    },
    "north-west": {
        label: "North-West",
        emoji: "🏜️",
        color: "#b5361d",
        gradient: "linear-gradient(135deg,#b5361d,#6d1e0e)",
        scriptUrl: "https://script.google.com/macros/s/AKfycbw12YIJPLst2mG7nerPmKU7q2z1HKchDu78M2N3sc6TlLLc-tMu7PfDps9ifJ41w92mkw/exec",
        states: ["Kaduna", "Kano", "Katsina"]
    }
};

// ─────────────────────────────────────────────
// Zone Resolution
// Priority: ?zone= URL param → sessionStorage → null (show landing)
// ─────────────────────────────────────────────

let _fallbackZoneKey = null;

(function resolveZone() {
    const urlZone = new URLSearchParams(window.location.search).get('zone');

    if (urlZone && ZONE_CONFIG[urlZone]) {
        // Valid zone in URL — persist it and use it
        try { sessionStorage.setItem('activeZone', urlZone); } catch (e) { _fallbackZoneKey = urlZone; }
    } else {
        // No ?zone= in the URL means the user navigated to the bare page
        try { sessionStorage.removeItem('activeZone'); } catch (e) { _fallbackZoneKey = null; }
    }
})();

function getActiveZoneKey() {
    try {
        return sessionStorage.getItem('activeZone') || _fallbackZoneKey;
    } catch (e) {
        return _fallbackZoneKey;
    }
}

function getActiveZone() {
    const key = getActiveZoneKey();
    return key ? ZONE_CONFIG[key] : null;
}

// ─────────────────────────────────────────────
// Exported globals — used by the rest of the app
// These will be `null` on the landing page (no zone chosen yet).
// ─────────────────────────────────────────────
const _zone = getActiveZone();
const SCRIPT_URL = _zone ? _zone.scriptUrl : null;

// Global Period Configuration — shared across all zones
const GLOBAL_PERIOD = {
    id: "2026-05-01_2026-05-21",
    name: "1st May to 21st May - 2026"
};

// Backward-compatibility: ensure old code expecting zone.activePeriod doesn't crash
Object.values(ZONE_CONFIG).forEach(z => {
    z.activePeriod = GLOBAL_PERIOD;
});

const ACTIVE_PERIOD = _zone ? {
    id: GLOBAL_PERIOD.id,
    name: GLOBAL_PERIOD.name,
    description: "Payment Cycle — " + _zone.label
} : { id: "none", name: "—", description: "—" };

/**
 * Build a URL that preserves the current zone parameter.
 * Use this for any <a href> or window.location changes inside the app.
 * @param {string} page - e.g. "queue.html" or "index.html"
 * @returns {string}
 */
function zoneUrl(page) {
    const key = getActiveZoneKey();
    return key ? `${page}?zone=${encodeURIComponent(key)}` : page;
}
/**
 * State code abbreviations for Certificate ID formatting.
 * Certificate ID format: SC/PT/7-digit-code
 * SC = State Code, PT = Physical Training (constant).
 */
const STATE_CODES = {
    "Abia": "AB",
    "Akwa Ibom": "AK",
    "Benue": "BE",
    "Cross River": "CR",
    "Delta": "DE",
    "Edo": "ED",
    "Enugu": "EN",
    "Kaduna": "KD",
    "Kano": "KN",
    "Katsina": "KT",
    "Nasarawa": "NS",
    "Ogun": "OG",
    "Ondo": "ON",
    "Oyo": "OY"
};

/**
 * Refreshment options per State.
 * Structure: { "State": { biscuit: [...], drink: [...] } }
 * Water is the same for all states so it's handled separately in HTML.
 * Add more states here as needed.
 */
const REFRESHMENTS = {
    "Oyo": {
        biscuit: [
            "Yale Digestive Gold (2*100g)",
            "Sesamix Biscuit (2*100g)",
            "Nasco Biscuit (100g)",
            "Fab Biscuit (100g)",
            "Mcvites Digestive 78g",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Maltina",
            "Not Provided",
            "Unticked (left blank)"
        ]
    },
    "Ondo": {
        biscuit: [
            "Rich tea (82g)",
            "Sesamix Biscuit (2*100g)",
            "Nasco Biscuit (100g)",
            "Fab Biscuit (100g)",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Maltina",
            "Not Provided",
            "Unticked (left blank)"
        ]
    },
    "Ogun": {
        biscuit: [
            "Yale Digestive Gold(2 * 100g)",
            "Sesamix Biscuit(2 * 100g)",
            "Nasco Biscuit(100g)",
            "Fab Biscuit(100g)",
            "McVites Hobonbs 78g",
            "McVites Digestive78g",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Maltina",
            "Not Provided",
            "Unticked (left blank)"
        ]
    },
    "Akwa Ibom": {
        biscuit: [
            "Munchkin Biscuit (120g)",
            "Yale Rich Short Bread Biscuit (105g)",
            "Yale Digestive Biscuit (2*80g)",
            "Beloxxi De Flora",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Maltina",
            "Beta Maltina",
            "Hi Malt",
            "Not Provided",
            "Unticked (left blank)"
        ]
    },
    "Enugu": {
        biscuit: [
            "Bees Crunchy Milk and Honey (2*70g)",
            "Supreme Digestive Biscuit (2*100g)",
            "Yale Digestive Gold (2*100g)",
            "Pure Bliss Cookies Milk (54g X 2)",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Maltina",
            "Grand Malt",
            "Hi Malt",
            "Beta Malt",
            "Dubic Malt",
            "Not Provided",
            "Unticked (left blank)"
        ]
    },
    "Edo": {
        biscuit: [
            "Biscuit (McVitie's Digestives 50g)",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Maltina",
            "Hi Malt",
            "Not Provided",
            "Unticked (left blank)"
        ]
    },
    "Benue": {
        biscuit: [
            "Yale Digestive Plus (65g)",
            "Yale Choco (65g)",
            "Yale Super Crunchy (65g)",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Beta Malt",
            "Grand Malt",
            "Hi Malt",
            "Not Provided",
            "Unticked (left blank)"
        ]
    },
    "Kaduna": {
        biscuit: [
            "Nasco Shortcake Biscuit (120g*36)",
            "Mc Vittes Hobb Nobbs or Digestive (90g)",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Maltina",
            "Not Provided",
            "Unticked (left blank)"
        ]
    },
    "Kano": {
        biscuit: [
            "Digestive/Hobnobs (78g*24/90g*12)",
            "Rich Tea (200g)",
            "Nasco Shortcake Biscuit (120g*36)",
            "McVittes Digestive (90g)",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Maltina",
            "Not Provided",
            "Unticked (left blank)"
        ]
    },
    "Katsina": {
        biscuit: [
            "Nasco Shortcake Biscuit 120g*36",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Maltina",
            "Not Provided",
            "Unticked (left blank)"
        ]
    }
};