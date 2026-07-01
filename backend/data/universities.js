 /**
 * US University Database for SheerID Verification
 * Based on SheerID-Verification-Tool analysis
 */

const UNIVERSITIES = [
    // Top US Universities (High success rate)
    { id: 2621, name: "Harvard University", domain: "harvard.edu", weight: 50 },
    { id: 2805, name: "Stanford University", domain: "stanford.edu", weight: 48 },
    { id: 2903, name: "Massachusetts Institute of Technology", domain: "mit.edu", weight: 47 },
    { id: 3018, name: "Yale University", domain: "yale.edu", weight: 45 },
    { id: 2672, name: "Princeton University", domain: "princeton.edu", weight: 44 },
    { id: 2803, name: "Columbia University", domain: "columbia.edu", weight: 43 },
    { id: 2711, name: "University of Chicago", domain: "uchicago.edu", weight: 42 },
    { id: 2920, name: "Duke University", domain: "duke.edu", weight: 41 },
    { id: 2927, name: "Northwestern University", domain: "northwestern.edu", weight: 40 },

    // Large State Universities
    { id: 1445, name: "University of California, Los Angeles", domain: "ucla.edu", weight: 38 },
    { id: 1312, name: "University of California, ", domain: "berkeley.edu", weight: 37 },
    { id: 1446, name: "University of Michigan", domain: "umich.edu", weight: 36 },
    { id: 1447, name: "University of Texas at Austin", domain: "utexas.edu", weight: 35 },
    { id: 1448, name: "University of Florida", domain: "ufl.edu", weight: 34 },
    { id: 1449, name: "Pennsylvania State University", domain: "psu.edu", weight: 33 },
    { id: 1450, name: "Ohio State University", domain: "osu.edu", weight: 32 },
    { id: 1451, name: "University of Washington", domain: "uw.edu", weight: 31 },
    { id: 1452, name: "University of Wisconsin-Madison", domain: "wisc.edu", weight: 30 },
    { id: 1453, name: "University of Illinois at Urbana-Champaign", domain: "illinois.edu", weight: 29 },

    // Private Universities  
    { id: 2930, name: "Carnegie Mellon University", domain: "cmu.edu", weight: 35 },
    { id: 2931, name: "Georgia Institute of Technology", domain: "gatech.edu", weight: 34 },
    { id: 2932, name: "University of Southern California", domain: "usc.edu", weight: 33 },
    { id: 2933, name: "New York University", domain: "nyu.edu", weight: 32 },
    { id: 2934, name: "Boston University", domain: "bu.edu", weight: 31 },
    { id: 2935, name: "University of Notre Dame", domain: "nd.edu", weight: 30 },
    { id: 2936, name: "Vanderbilt University", domain: "vanderbilt.edu", weight: 29 },
    { id: 2937, name: "Rice University", domain: "rice.edu", weight: 28 },
    { id: 2938, name: "Washington University in St. Louis", domain: "wustl.edu", weight: 27 },
    { id: 2939, name: "Emory University", domain: "emory.edu", weight: 26 },

    // More State Universities
    { id: 1460, name: "University of Virginia", domain: "virginia.edu", weight: 28 },
    { id: 1461, name: "University of North Carolina at Chapel Hill", domain: "unc.edu", weight: 27 },
    { id: 1462, name: "University of Maryland", domain: "umd.edu", weight: 26 },
    { id: 1463, name: "Purdue University", domain: "purdue.edu", weight: 25 },
    { id: 1464, name: "University of Minnesota", domain: "umn.edu", weight: 24 },
    { id: 1465, name: "Indiana University", domain: "indiana.edu", weight: 23 },
    { id: 1466, name: "University of Arizona", domain: "arizona.edu", weight: 22 },
    { id: 1467, name: "Arizona State University", domain: "asu.edu", weight: 21 },
    { id: 1468, name: "University of Colorado Boulder", domain: "colorado.edu", weight: 20 },
    { id: 1469, name: "University of Iowa", domain: "uiowa.edu", weight: 19 },

    // Tech-focused Universities
    { id: 2950, name: "California Institute of Technology", domain: "caltech.edu", weight: 35 },
    { id: 2951, name: "Rensselaer Polytechnic Institute", domain: "rpi.edu", weight: 25 },
    { id: 2952, name: "Virginia Tech", domain: "vt.edu", weight: 24 },
    { id: 2953, name: "University of California, San Diego", domain: "ucsd.edu", weight: 32 },
    { id: 2954, name: "University of California, Davis", domain: "ucdavis.edu", weight: 28 },
    { id: 2955, name: "University of California, Irvine", domain: "uci.edu", weight: 27 },
];

// Success rate tracking (in-memory, resets on restart)
const successStats = {};

/**
 * Record verification result for a university
 */
function recordResult(universityName, success) {
    if (!successStats[universityName]) {
        successStats[universityName] = { success: 0, total: 0 };
    }
    successStats[universityName].total++;
    if (success) {
        successStats[universityName].success++;
    }
}

/**
 * Get success rate for a university (0-100)
 */
function getSuccessRate(universityName) {
    const stats = successStats[universityName];
    if (!stats || stats.total === 0) return 50; // Default 50%
    return Math.round((stats.success / stats.total) * 100);
}

/**
 * Select university using weighted random selection
 * Higher weight = more likely to be selected
 * Success rate also influences selection
 */
function selectUniversity() {
    const weights = UNIVERSITIES.map(uni => {
        const successRate = getSuccessRate(uni.name);
        // Adjust weight based on success rate (50% is neutral)
        const adjustedWeight = uni.weight * (successRate / 50);
        return Math.max(1, adjustedWeight);
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < UNIVERSITIES.length; i++) {
        random -= weights[i];
        if (random <= 0) {
            const uni = UNIVERSITIES[i];
            return {
                id: uni.id,
                idExtended: String(uni.id),
                name: uni.name,
                domain: uni.domain
            };
        }
    }

    // Fallback to first university
    const first = UNIVERSITIES[0];
    return {
        id: first.id,
        idExtended: String(first.id),
        name: first.name,
        domain: first.domain
    };
}

module.exports = {
    UNIVERSITIES,
    selectUniversity,
    recordResult,
    getSuccessRate
};
