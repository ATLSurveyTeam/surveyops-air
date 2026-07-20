import * as XLSX from 'xlsx';

const REQUIRED_SHEETS = ['Departures', 'Commercial', 'Arrivals'];
const METRIC_NAMES = new Set([
  'Remaining',
  'Target Original',
  'Target Modified',
  'Completed Targets',
  'Over Quota'
]);

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function readSheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`The workbook is missing the required “${sheetName}” worksheet.`);
  }

  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: true
  });
}

function buildReferenceMaps(existingDepCom = [], existingArrivals = []) {
  const airports = new Map();
  const airlines = new Map();

  for (const row of [...existingDepCom, ...existingArrivals]) {
    const code = normalizeText(row.code).toUpperCase();
    if (code && !airports.has(code)) {
      airports.set(code, {
        city: row.city || code,
        airport: row.airport || code,
        traffic: row.traffic || ''
      });
    }

    const airline = normalizeText(row.airline).toUpperCase();
    if (airline && !airlines.has(airline)) {
      airlines.set(airline, row.airlineName || airline);
    }
  }

  return { airports, airlines };
}

function parseMetricBlocks(rows) {
  const headers = rows[2] || [];
  const contexts = headers
    .slice(3)
    .map(value => normalizeText(value))
    .filter(Boolean);

  if (!contexts.length) {
    throw new Error('No airline or arrival-window headings were found in row 3.');
  }

  const blocks = new Map();
  let currentCode = '';

  for (let rowIndex = 3; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const rowCode = normalizeText(row[0]).toUpperCase();
    const metric = normalizeText(row[1]);
    const traffic = normalizeText(row[2]);

    if (/^[A-Z0-9]{3}$/.test(rowCode)) {
      currentCode = rowCode;
    } else if (rowCode) {
      currentCode = '';
    }

    if (!currentCode || !METRIC_NAMES.has(metric)) {
      continue;
    }

    const code = currentCode;

    if (!blocks.has(code)) {
      blocks.set(code, {
        code,
        traffic,
        metrics: {}
      });
    }

    const block = blocks.get(code);
    if (traffic) block.traffic = traffic;
    block.metrics[metric] = contexts.map((context, index) => ({
      context,
      value: numberValue(row[index + 3])
    }));
  }

  return { contexts, blocks };
}

function metricFor(block, metricName, context) {
  const values = block.metrics[metricName] || [];
  return values.find(item => item.context === context)?.value || 0;
}

function isValidOpportunity(block, context) {
  return [
    'Remaining',
    'Target Original',
    'Target Modified',
    'Completed Targets',
    'Over Quota'
  ].some(metric => metricFor(block, metric, context) > 0);
}

function airportDetails(referenceMaps, code, workbookTraffic) {
  const known = referenceMaps.airports.get(code) || {};
  const traffic = workbookTraffic || known.traffic || 'Domestic';
  const city = known.city || code;
  const airport = known.airport || code;

  return {
    city,
    airport,
    traffic,
    search: `${code} ${city} ${airport} ${traffic}`.toLowerCase()
  };
}

function parseAirlineSheet(rows, type, referenceMaps) {
  const { contexts, blocks } = parseMetricBlocks(rows);
  const results = [];

  for (const block of blocks.values()) {
    for (const airline of contexts) {
      if (!isValidOpportunity(block, airline)) continue;

      const details = airportDetails(referenceMaps, block.code, block.traffic);
      results.push({
        id: `${airline}|${block.code}`,
        airline,
        airlineName: referenceMaps.airlines.get(airline) || airline,
        code: block.code,
        ...details,
        [`${type}Remaining`]: metricFor(block, 'Remaining', airline),
        [`${type}TargetOriginal`]: metricFor(block, 'Target Original', airline),
        [`${type}TargetModified`]: metricFor(block, 'Target Modified', airline),
        [`${type}CompletedTargets`]: metricFor(block, 'Completed Targets', airline),
        [`${type}AboveGoal`]: metricFor(block, 'Over Quota', airline)
      });
    }
  }

  return results;
}

function mergeDepartureCommercial(departures, commercial) {
  const merged = new Map();

  for (const row of departures) {
    merged.set(row.id, {
      ...row,
      commercialRemaining: 0,
      commercialTargetOriginal: 0,
      commercialTargetModified: 0,
      commercialCompletedTargets: 0,
      commercialAboveGoal: 0
    });
  }

  for (const row of commercial) {
    const current = merged.get(row.id);
    if (current) {
      current.commercialRemaining = row.commercialRemaining || 0;
      current.commercialTargetOriginal = row.commercialTargetOriginal || 0;
      current.commercialTargetModified = row.commercialTargetModified || 0;
      current.commercialCompletedTargets = row.commercialCompletedTargets || 0;
      current.commercialAboveGoal = row.commercialAboveGoal || 0;
    } else {
      merged.set(row.id, {
        ...row,
        departureRemaining: 0,
        departureTargetOriginal: 0,
        departureTargetModified: 0,
        departureCompletedTargets: 0,
        departureAboveGoal: 0
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) =>
    a.airlineName.localeCompare(b.airlineName) ||
    (a.city || a.code).localeCompare(b.city || b.code)
  );
}

function parseArrivals(rows, referenceMaps) {
  const { contexts: windows, blocks } = parseMetricBlocks(rows);
  const results = [];

  for (const block of blocks.values()) {
    for (const window of windows) {
      if (!isValidOpportunity(block, window)) continue;

      const details = airportDetails(referenceMaps, block.code, block.traffic);
      results.push({
        id: `${window}|${block.code}`,
        window,
        code: block.code,
        ...details,
        arrivalRemaining: metricFor(block, 'Remaining', window),
        arrivalTargetOriginal: metricFor(block, 'Target Original', window),
        arrivalTargetModified: metricFor(block, 'Target Modified', window),
        arrivalCompletedTargets: metricFor(block, 'Completed Targets', window),
        arrivalAboveGoal: metricFor(block, 'Over Quota', window),
        search: `${details.search} ${window}`.toLowerCase()
      });
    }
  }

  return results.sort((a, b) =>
    a.window.localeCompare(b.window) ||
    (a.city || a.code).localeCompare(b.city || b.code)
  );
}

function countSummary(depCom, arrivals) {
  const departures = depCom.filter(row =>
    (row.departureRemaining || 0) > 0 || (row.departureAboveGoal || 0) > 0
  );
  const commercial = depCom.filter(row =>
    (row.commercialRemaining || 0) > 0 || (row.commercialAboveGoal || 0) > 0
  );

  return {
    departureOpportunities: depCom.filter(row =>
      row.departureRemaining !== undefined &&
      ((row.departureRemaining || 0) > 0 || (row.departureAboveGoal || 0) >= 0)
    ).length,
    commercialOpportunities: depCom.filter(row =>
      row.commercialRemaining !== undefined &&
      ((row.commercialRemaining || 0) > 0 || (row.commercialAboveGoal || 0) >= 0)
    ).length,
    arrivalOpportunities: arrivals.length,
    departureRequired: depCom.filter(row => (row.departureRemaining || 0) > 0).length,
    commercialRequired: depCom.filter(row => (row.commercialRemaining || 0) > 0).length,
    arrivalRequired: arrivals.filter(row => (row.arrivalRemaining || 0) > 0).length,
    departureRemainingTotal: depCom.reduce((sum, row) => sum + (row.departureRemaining || 0), 0),
    commercialRemainingTotal: depCom.reduce((sum, row) => sum + (row.commercialRemaining || 0), 0),
    arrivalRemainingTotal: arrivals.reduce((sum, row) => sum + (row.arrivalRemaining || 0), 0),
    departureTargetOriginalTotal: depCom.reduce((sum, row) => sum + (row.departureTargetOriginal || 0), 0),
    commercialTargetOriginalTotal: depCom.reduce((sum, row) => sum + (row.commercialTargetOriginal || 0), 0),
    arrivalTargetOriginalTotal: arrivals.reduce((sum, row) => sum + (row.arrivalTargetOriginal || 0), 0),
    departureTargetModifiedTotal: depCom.reduce((sum, row) => sum + (row.departureTargetModified || 0), 0),
    commercialTargetModifiedTotal: depCom.reduce((sum, row) => sum + (row.commercialTargetModified || 0), 0),
    arrivalTargetModifiedTotal: arrivals.reduce((sum, row) => sum + (row.arrivalTargetModified || 0), 0),
    departureCompletedTargetsTotal: depCom.reduce((sum, row) => sum + (row.departureCompletedTargets || 0), 0),
    commercialCompletedTargetsTotal: depCom.reduce((sum, row) => sum + (row.commercialCompletedTargets || 0), 0),
    arrivalCompletedTargetsTotal: arrivals.reduce((sum, row) => sum + (row.arrivalCompletedTargets || 0), 0),
    departureAboveGoalTotal: departures.reduce((sum, row) => sum + (row.departureAboveGoal || 0), 0),
    commercialAboveGoalTotal: commercial.reduce((sum, row) => sum + (row.commercialAboveGoal || 0), 0),
    arrivalAboveGoalTotal: arrivals.reduce((sum, row) => sum + (row.arrivalAboveGoal || 0), 0)
  };
}

export async function reviewWorkbook(file, existingDepCom = [], existingArrivals = []) {
  if (!file) throw new Error('Select an Excel workbook first.');

  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['xlsx', 'xls'].includes(extension)) {
    throw new Error('Select an .xlsx or .xls workbook.');
  }

  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });

  for (const sheetName of REQUIRED_SHEETS) {
    if (!workbook.SheetNames.includes(sheetName)) {
      throw new Error(`The workbook is missing the required “${sheetName}” worksheet.`);
    }
  }

  const references = buildReferenceMaps(existingDepCom, existingArrivals);
  const departures = parseAirlineSheet(
    readSheetRows(workbook, 'Departures'),
    'departure',
    references
  );
  const commercial = parseAirlineSheet(
    readSheetRows(workbook, 'Commercial'),
    'commercial',
    references
  );
  const depCom = mergeDepartureCommercial(departures, commercial);
  const arrivals = parseArrivals(
    readSheetRows(workbook, 'Arrivals'),
    references
  );

  return {
    fileName: file.name,
    depCom,
    arrivals,
    summary: countSummary(depCom, arrivals)
  };
}
