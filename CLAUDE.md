# Greenhouse finder

## Folder ownership — do not cross
- agents/ and .kiro/ → Person A (host) only
- data/, calculator.js, app.html → Person B only
- Ask before editing a file outside your assigned folder.

## Hard rules
- The model never writes a number. Use {placeholders}; code fills them.
- Fuel model is calibrated to 11929/24000 gal per sqft per winter.
  Never replace it with a textbook heat-loss formula.
- Never invent a programme name, deadline, cost-share %, or fuel price.
- Data is pasted inline into app.html, never fetched at runtime.

## Commit every 15 minutes.