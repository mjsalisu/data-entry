const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzLUgMI6kHI_I0nODYqC0CCEoFzEEP_OSLldpHYNt4YMbZZbSvXsnU4njs7L7L28qKV/exec";

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
    "Nassarawa": "NA",
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
            "McVites Hobonbs 78g",
            "McVites Digestive78g",
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