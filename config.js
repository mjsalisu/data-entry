const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw6S3Jx2ltR8anf9RGRSZ5E4Kqs7_r1Juto4_2k7HiEDAS4N_aWo0Gtg5mAKPZ_0cfa9g/exec";

/**
 * Refreshment options per State.
 * Structure: { "State": { biscuit: [...], drink: [...] } }
 * Water is the same for all states so it's handled separately in HTML.
 * Add more states here as needed.
 */
const REFRESHMENTS = {
    "Benue": {
        biscuit: [
            "Yale Digestive Plus (2 * 65g)",
            "Yale Digestive ohhh super pack (100g)",
            "Yale Digestive Choco biscuit (100g)",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Grand Malt",
            "Beta Malt",
            "Hi Malt",
            "Dubic Malt",
            "Not Provided",
            "Unticked (left blank)"
        ]
    },
    "Oyo": {
        biscuit: [
            "Rich tea(82g)",
            "Fab biscuit (100g)",
            "Mcvities (2*100g)",
            "Sesamix Biscuit (100g)",
            "Not Provided",
            "Unticked (left blank)"
        ],
        drink: [
            "Malt 33CL",
            "Amstel Pet Bottles",
            "Dubic Malt",
            "Grand Malt"
        ]
    },
    "Kaduna": {
        biscuit: [
            "Nasco Shortcake Biscuit (120g*36)",
        ],
        drink: [
            "Maltina",
        ]
    }
};
