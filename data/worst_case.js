// Dev-only worst-case fixture for app.html (?data=worst / one / empty on localhost).
// Real records from profiles.json; only name and town are altered, numbers are untouched.
// Rows: largest (unnamed), smallest (unnamed), long name, long hyphenated name,
// very short name, the one real named record, missing town.
window.PROFILES_WORST = [
 {
  "id": "way/1544590099",
  "name": null,
  "lat": 42.427939,
  "lon": -72.58781,
  "sqft": 211852,
  "covering": "double_poly (assumed)",
  "gal_winter": 105299,
  "usd_winter": 385396,
  "ring": [
   [
    -72.589228,
    42.428639
   ],
   [
    -72.589209,
    42.427829
   ],
   [
    -72.588115,
    42.427823
   ],
   [
    -72.588104,
    42.427659
   ],
   [
    -72.587166,
    42.427654
   ],
   [
    -72.587155,
    42.427549
   ],
   [
    -72.586987,
    42.42756
   ],
   [
    -72.586975,
    42.427662
   ],
   [
    -72.586861,
    42.427665
   ],
   [
    -72.586883,
    42.428653
   ],
   [
    -72.589228,
    42.428639
   ]
  ],
  "town": "Whately",
  "utility": null,
  "hdd": 6000,
  "price_per_gal": 3.66,
  "estimate": {
   "low": {
    "gal": 58667,
    "usd": 214720
   },
   "high": {
    "gal": 198564,
    "usd": 726745
   },
   "point": {
    "gal": 105299,
    "usd": 385395,
    "method": "Building size × UW-Madison calibrated rate, scaled for double_poly covering, at EIA Massachusetts fuel price. Assumes a heated season comparable to the source case, mid-February to end of May."
   },
   "confidence": "wide",
   "method": "From building size only. No site data yet."
  },
  "fixes": [
   {
    "name": "Thermal curtain",
    "saves_usd": 96349,
    "cost_usd": null,
    "payback_years": null,
    "method": "25% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Night setback 5°F",
    "saves_usd": 46248,
    "cost_usd": null,
    "payback_years": null,
    "method": "12% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Seal gaps and end walls",
    "saves_usd": 38540,
    "cost_usd": null,
    "payback_years": null,
    "method": "10% of winter fuel cost, applied on its own (not combined with other fixes)."
   }
  ],
  "evidence": {
   "bill_uploaded": false,
   "quote_uploaded": false,
   "answers": {}
  }
 },
 {
  "id": "way/890539604",
  "name": null,
  "lat": 42.187595,
  "lon": -72.748955,
  "sqft": 512,
  "covering": "double_poly (assumed)",
  "gal_winter": 254,
  "usd_winter": 931,
  "ring": [
   [
    -72.748902,
    42.187615
   ],
   [
    -72.748939,
    42.187641
   ],
   [
    -72.749034,
    42.187565
   ],
   [
    -72.748997,
    42.18754
   ],
   [
    -72.748902,
    42.187615
   ]
  ],
  "town": "Westfield",
  "utility": null,
  "hdd": 6000,
  "price_per_gal": 3.66,
  "estimate": {
   "low": {
    "gal": 142,
    "usd": 519
   },
   "high": {
    "gal": 480,
    "usd": 1756
   },
   "point": {
    "gal": 254,
    "usd": 931,
    "method": "Building size × UW-Madison calibrated rate, scaled for double_poly covering, at EIA Massachusetts fuel price. Assumes a heated season comparable to the source case, mid-February to end of May."
   },
   "confidence": "wide",
   "method": "From building size only. No site data yet."
  },
  "fixes": [
   {
    "name": "Thermal curtain",
    "saves_usd": 233,
    "cost_usd": null,
    "payback_years": null,
    "method": "25% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Night setback 5°F",
    "saves_usd": 112,
    "cost_usd": null,
    "payback_years": null,
    "method": "12% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Seal gaps and end walls",
    "saves_usd": 93,
    "cost_usd": null,
    "payback_years": null,
    "method": "10% of winter fuel cost, applied on its own (not combined with other fixes)."
   }
  ],
  "evidence": {
   "bill_uploaded": false,
   "quote_uploaded": false,
   "answers": {}
  }
 },
 {
  "id": "way/890539605#worst0",
  "name": "Hampshire County Cooperative Extension Teaching Greenhouse and Propagation House",
  "lat": 42.187605,
  "lon": -72.748757,
  "sqft": 2317,
  "covering": "double_poly (assumed)",
  "gal_winter": 1151,
  "usd_winter": 4214,
  "ring": [
   [
    -72.748649,
    42.187637
   ],
   [
    -72.748733,
    42.187698
   ],
   [
    -72.74892,
    42.187556
   ],
   [
    -72.748835,
    42.187495
   ],
   [
    -72.748649,
    42.187637
   ]
  ],
  "town": "Westfield",
  "utility": null,
  "hdd": 6000,
  "price_per_gal": 3.66,
  "estimate": {
   "low": {
    "gal": 642,
    "usd": 2348
   },
   "high": {
    "gal": 2172,
    "usd": 7948
   },
   "point": {
    "gal": 1152,
    "usd": 4215,
    "method": "Building size × UW-Madison calibrated rate, scaled for double_poly covering, at EIA Massachusetts fuel price. Assumes a heated season comparable to the source case, mid-February to end of May."
   },
   "confidence": "wide",
   "method": "From building size only. No site data yet."
  },
  "fixes": [
   {
    "name": "Thermal curtain",
    "saves_usd": 1054,
    "cost_usd": null,
    "payback_years": null,
    "method": "25% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Night setback 5°F",
    "saves_usd": 506,
    "cost_usd": null,
    "payback_years": null,
    "method": "12% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Seal gaps and end walls",
    "saves_usd": 421,
    "cost_usd": null,
    "payback_years": null,
    "method": "10% of winter fuel cost, applied on its own (not combined with other fixes)."
   }
  ],
  "evidence": {
   "bill_uploaded": false,
   "quote_uploaded": false,
   "answers": {}
  }
 },
 {
  "id": "way/214086491#worst1",
  "name": "Smith-Montgomery-Wiśniewska Family Farm Greenhouses",
  "lat": 42.459811,
  "lon": -72.609665,
  "sqft": 1629,
  "covering": "double_poly (assumed)",
  "gal_winter": 810,
  "usd_winter": 2964,
  "ring": [
   [
    -72.609809,
    42.459815
   ],
   [
    -72.6098,
    42.459768
   ],
   [
    -72.609449,
    42.459805
   ],
   [
    -72.609458,
    42.459851
   ],
   [
    -72.609809,
    42.459815
   ]
  ],
  "town": "Whately",
  "utility": null,
  "hdd": 6000,
  "price_per_gal": 3.66,
  "estimate": {
   "low": {
    "gal": 451,
    "usd": 1651
   },
   "high": {
    "gal": 1527,
    "usd": 5588
   },
   "point": {
    "gal": 810,
    "usd": 2963,
    "method": "Building size × UW-Madison calibrated rate, scaled for double_poly covering, at EIA Massachusetts fuel price. Assumes a heated season comparable to the source case, mid-February to end of May."
   },
   "confidence": "wide",
   "method": "From building size only. No site data yet."
  },
  "fixes": [
   {
    "name": "Thermal curtain",
    "saves_usd": 741,
    "cost_usd": null,
    "payback_years": null,
    "method": "25% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Night setback 5°F",
    "saves_usd": 356,
    "cost_usd": null,
    "payback_years": null,
    "method": "12% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Seal gaps and end walls",
    "saves_usd": 296,
    "cost_usd": null,
    "payback_years": null,
    "method": "10% of winter fuel cost, applied on its own (not combined with other fixes)."
   }
  ],
  "evidence": {
   "bill_uploaded": false,
   "quote_uploaded": false,
   "answers": {}
  }
 },
 {
  "id": "way/214086595#worst2",
  "name": "Jo’s",
  "lat": 42.459603,
  "lon": -72.610971,
  "sqft": 1549,
  "covering": "double_poly (assumed)",
  "gal_winter": 770,
  "usd_winter": 2818,
  "ring": [
   [
    -72.61111,
    42.459607
   ],
   [
    -72.611101,
    42.459562
   ],
   [
    -72.610762,
    42.459598
   ],
   [
    -72.610771,
    42.459643
   ],
   [
    -72.61111,
    42.459607
   ]
  ],
  "town": "Whately",
  "utility": null,
  "hdd": 6000,
  "price_per_gal": 3.66,
  "estimate": {
   "low": {
    "gal": 429,
    "usd": 1570
   },
   "high": {
    "gal": 1452,
    "usd": 5314
   },
   "point": {
    "gal": 770,
    "usd": 2818,
    "method": "Building size × UW-Madison calibrated rate, scaled for double_poly covering, at EIA Massachusetts fuel price. Assumes a heated season comparable to the source case, mid-February to end of May."
   },
   "confidence": "wide",
   "method": "From building size only. No site data yet."
  },
  "fixes": [
   {
    "name": "Thermal curtain",
    "saves_usd": 705,
    "cost_usd": null,
    "payback_years": null,
    "method": "25% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Night setback 5°F",
    "saves_usd": 338,
    "cost_usd": null,
    "payback_years": null,
    "method": "12% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Seal gaps and end walls",
    "saves_usd": 282,
    "cost_usd": null,
    "payback_years": null,
    "method": "10% of winter fuel cost, applied on its own (not combined with other fixes)."
   }
  ],
  "evidence": {
   "bill_uploaded": false,
   "quote_uploaded": false,
   "answers": {}
  }
 },
 {
  "id": "way/118883914",
  "name": "Vervane Greenhouse",
  "lat": 42.328418,
  "lon": -72.532322,
  "sqft": 2906,
  "covering": "double_poly (assumed)",
  "gal_winter": 1444,
  "usd_winter": 5287,
  "ring": [
   [
    -72.532458,
    42.328375
   ],
   [
    -72.532102,
    42.328402
   ],
   [
    -72.532119,
    42.328485
   ],
   [
    -72.532475,
    42.328454
   ],
   [
    -72.532458,
    42.328375
   ]
  ],
  "town": "Amherst",
  "utility": null,
  "hdd": 6000,
  "price_per_gal": 3.66,
  "estimate": {
   "low": {
    "gal": 805,
    "usd": 2945
   },
   "high": {
    "gal": 2724,
    "usd": 9969
   },
   "point": {
    "gal": 1444,
    "usd": 5287,
    "method": "Building size × UW-Madison calibrated rate, scaled for double_poly covering, at EIA Massachusetts fuel price. Assumes a heated season comparable to the source case, mid-February to end of May."
   },
   "confidence": "wide",
   "method": "From building size only. No site data yet."
  },
  "fixes": [
   {
    "name": "Thermal curtain",
    "saves_usd": 1322,
    "cost_usd": null,
    "payback_years": null,
    "method": "25% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Night setback 5°F",
    "saves_usd": 634,
    "cost_usd": null,
    "payback_years": null,
    "method": "12% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Seal gaps and end walls",
    "saves_usd": 529,
    "cost_usd": null,
    "payback_years": null,
    "method": "10% of winter fuel cost, applied on its own (not combined with other fixes)."
   }
  ],
  "evidence": {
   "bill_uploaded": false,
   "quote_uploaded": false,
   "answers": {}
  }
 },
 {
  "id": "way/891414016#worst3",
  "name": null,
  "lat": 42.535191,
  "lon": -72.524565,
  "sqft": 2773,
  "covering": "double_poly (assumed)",
  "gal_winter": 1378,
  "usd_winter": 5045,
  "ring": [
   [
    -72.524695,
    42.535243
   ],
   [
    -72.524717,
    42.535165
   ],
   [
    -72.52437,
    42.535112
   ],
   [
    -72.524348,
    42.53519
   ],
   [
    -72.524695,
    42.535243
   ]
  ],
  "town": null,
  "utility": null,
  "hdd": 6000,
  "price_per_gal": 3.66,
  "estimate": {
   "low": {
    "gal": 768,
    "usd": 2811
   },
   "high": {
    "gal": 2599,
    "usd": 9513
   },
   "point": {
    "gal": 1378,
    "usd": 5045,
    "method": "Building size × UW-Madison calibrated rate, scaled for double_poly covering, at EIA Massachusetts fuel price. Assumes a heated season comparable to the source case, mid-February to end of May."
   },
   "confidence": "wide",
   "method": "From building size only. No site data yet."
  },
  "fixes": [
   {
    "name": "Thermal curtain",
    "saves_usd": 1261,
    "cost_usd": null,
    "payback_years": null,
    "method": "25% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Night setback 5°F",
    "saves_usd": 605,
    "cost_usd": null,
    "payback_years": null,
    "method": "12% of winter fuel cost, applied on its own (not combined with other fixes)."
   },
   {
    "name": "Seal gaps and end walls",
    "saves_usd": 505,
    "cost_usd": null,
    "payback_years": null,
    "method": "10% of winter fuel cost, applied on its own (not combined with other fixes)."
   }
  ],
  "evidence": {
   "bill_uploaded": false,
   "quote_uploaded": false,
   "answers": {}
  }
 }
];
