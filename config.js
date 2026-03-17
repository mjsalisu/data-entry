const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzRAmCZB7mbeV6bJ9nuw1CBFCvKiL9aipoHiEWqYkpExQfZLdUTuPuRtjeemhq1BVVz/exec";

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
            "Not Provided",
            "Unticked (left blank)"
        ]
    }
};