const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw6S3Jx2ltR8anf9RGRSZ5E4Kqs7_r1Juto4_2k7HiEDAS4N_aWo0Gtg5mAKPZ_0cfa9g/exec";

/**
 * Refreshment options per State.
 * Structure: { "State": { biscuit: [...], drink: [...] } }
 * Water is the same for all states so it's handled separately in HTML.
 * Add more states here as needed.
 */
const REFRESHMENTS = {
    "Adamawa": {
        biscuit: [
            "McVities Hobnobs 2*78g",
            "McVities Digestive 76g"
        ],
        drink: [
            "Maltina"
        ]
    },
    "Akwa Ibom": {
        biscuit: [
            "Munchkin Biscuits (120g)",
            "Fab Biscuit (120g)",
            "Yale Rich Shortbread (105g)"
        ],
        drink: [
            "Champ Malt",
            "Beta Malt",
            "Hi Malt"
        ]
    },
    "Bauchi": {
        biscuit: [
            "Nasco Shortcake Biscuit 120g*36",
            "Mc Vittes Hobb Nobbs OR Mc Vittes Digestive (90g)"
        ],
        drink: [
            "Maltina"
        ]
    },
    "Benue": {
        biscuit: [
            "Bees Crunchy Milk and Honey (2*70g)",
            "Supreme Digestive Biscuit (2*100g)",
            "Yale Digestive Gold (2*100g)",
            "Pure Bliss Cookies Milk (54g x 2)"
        ],
        drink: [
            "Maltina",
            "Grand Malt",
            "Hi Malt",
            "Beta Malt"
        ]
    },
    "Delta": {
        biscuit: [
            "Munchkin Biscuits (120g)",
            "Fab Biscuit (120g)",
            "Yale Rich Shortbread (105g)"
        ],
        drink: [
            "Champ Malt",
            "Beta Malt",
            "Hi Malt"
        ]
    },
    "Edo": {
        biscuit: [
            "McVities Hobnob (78g)",
            "McVites Digestive (78g)",
            "McVites Hobnobs (180g)"
        ],
        drink: [
            "Maltina"
        ]
    },
    "Enugu": {
        biscuit: [
            "Bees Crunchy Milk and Honey (2*100g)",
            "Supreme Digestive Biscuit (2*100g)",
            "Yale Digestive Gold (2*100g)",
            "Pure Bliss Cookies Milk (54g*2)"
        ],
        drink: [
            "Maltina",
            "Grand Malt",
            "Hi Malt",
            "Beta Malt"
        ]
    },
    "Kaduna": {
        biscuit: [
            "Nasco Shortcake Biscuit (120g*36)"
        ],
        drink: [
            "Maltina"
        ]
    },
    "Kano": {
        biscuit: [
            "Nasco Shortcake Biscuit (120g*36)",
            "Rich Tea (200g)",
            "Mc Vittes Digestive (78g)",
            "Mc Vittes Hobnobs (90g)"
        ],
        drink: [
            "Maltina 33CL"
        ]
    },
    "Katsina": {
        biscuit: [
            "Nasco Shortcake Biscuit 120g*36"
        ],
        drink: [
            "Maltina"
        ]
    },
    "Lagos": {
        biscuit: [
            "Fab Biscuits 100g",
            "Shortbread 90g",
            "Rich Tea Biscuit 200g",
            "NASCO Shortcake 90g"
        ],
        drink: [
            "Malt 33CL",
            "Amstel Pet Bottles",
            "Dubic Malt",
            "Grand Malt"
        ]
    },
    "Ogun": {
        biscuit: [
            "McVities Hobnob (78g)",
            "McVites Digestive (78g)",
            "McVites Hobnobs (180g)"
        ],
        drink: [
            "Maltina"
        ]
    },
    "Ondo": {
        biscuit: [
            "Rich tea (82g)",
            "Fab Biscuit (100g)",
            "McVitie's Ginger",
            "Yale Digestive Gold (2*100g)",
            "Sesamix"
        ],
        drink: [
            "Maltina",
            "Beta Maltina",
            "Height Malt"
        ]
    },
    "Oyo": {
        biscuit: [
            "Rich tea(82g)",
            "Fab biscuit (100g)",
            "Mcvities (2*100g)",
            "Sesamix Biscuit (100g)"
        ],
        drink: [
            "Maltina Pet Bottle"
        ]
    }
};