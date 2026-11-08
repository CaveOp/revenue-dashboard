/**
 * Cave Springs — GA4 bookings (Google Apps Script, attached to the dashboard sheet)
 *
 * Set up once: in the dashboard sheet, Extensions → Apps Script. Add it as its OWN file
 * (Files → + → Script, name it "GA4 bookings"); do not paste over Code.gs, which holds the import tools.
 * Add the "Google Analytics Data API" service (Services → +), then run refreshGa4.
 * Every name in this file starts with GA4 or ga4 so it can't clash with the import tools.
 *
 * What it does:
 *   - READS booking (purchase) data from GA4. It never changes anything in GA4.
 *   - WRITES only to one tab: GA4_AUTO (same columns as GA4_TXN_CLEAN, which it does not touch).
 *     Each run rebuilds that tab with every booking from GA4_FIRST_DAY to today.
 *   - Each booking gets the date GA4 recorded it and the billing cycle (15th–14th) that date falls in.
 *   - Same fields as the "Ads keywords" exploration: Res#, date, session source / medium and campaign,
 *     first user source / medium and campaign, purchase revenue, Google Ads keyword and search text.
 *
 * Run it daily with a trigger (Triggers → + → refreshGa4, time-driven, day timer).
 * If GA4 returns an error, nothing is written and the tab keeps what it had.
 */

var GA4_PROPERTY_ID = '376866382';          // numbers only, from GA4 → Admin → Property details
var GA4_TAB             = 'GA4_AUTO';
var GA4_FIRST_DAY       = '2026-05-15';
var GA4_CYCLE_DAY       = 15;
var GA4_HEADER = ['TransactionId', 'Date', 'Cycle', 'CycleStart', 'SourceMedium', 'Campaign', 'FirstUserSourceMedium',
              'FirstUserCampaign', 'Revenue', 'ImportedOn', 'Keyword', 'SearchQuery'];
var GA4_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function refreshGa4() {
  if (!/^\d+$/.test(GA4_PROPERTY_ID)) throw new Error('Fill in GA4_PROPERTY_ID at the top of the script (numbers only).');
  var tz = Session.getScriptTimeZone();
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  // Three smaller reports joined by Res#, the same way the two exploration downloads are joined.
  var byId = {}, order = [];
  var take = function (id) {
    if (!/^\d+$/.test(id)) return null;                    // "(not set)" and blanks are skipped, as on import
    id = String(parseInt(id, 10));
    if (!byId[id]) { byId[id] = { id: id, date: '', sm: '', campaign: '', fusm: '', fcamp: '', revenue: '', keyword: '', query: '' }; order.push(id); }
    return byId[id];
  };
  var first = function (rec, field, v) { if (!rec[field] && v && v !== '(not set)') rec[field] = v; };

  ga4Report(['transactionId', 'date', 'sessionSourceMedium', 'sessionCampaignName'], ['purchaseRevenue']).forEach(function (r) {
    var rec = take(r.d[0]); if (!rec) return;
    if (!rec.date || r.d[1] < rec.date) rec.date = r.d[1];                  // earliest day GA4 recorded it
    first(rec, 'sm', r.d[2]); first(rec, 'campaign', r.d[3]);
    rec.revenue = Math.round(((Number(rec.revenue) || 0) + Number(r.m[0] || 0)) * 100) / 100;
  });
  ga4Report(['transactionId', 'firstUserSourceMedium', 'firstUserCampaignName'], ['purchaseRevenue']).forEach(function (r) {
    var rec = take(r.d[0]); if (!rec) return;
    first(rec, 'fusm', r.d[1]); first(rec, 'fcamp', r.d[2]);
  });
  ga4Report(['transactionId', 'sessionGoogleAdsKeyword', 'sessionGoogleAdsQuery'], ['purchaseRevenue']).forEach(function (r) {
    var rec = take(r.d[0]); if (!rec) return;
    first(rec, 'keyword', r.d[1]); first(rec, 'query', r.d[2]);
  });

  var rows = [GA4_HEADER];
  order.forEach(function (id) {
    var x = byId[id]; if (!x.date) return;
    var iso = x.date.slice(0, 4) + '-' + x.date.slice(4, 6) + '-' + x.date.slice(6, 8);   // GA4 gives 20260516
    var c = ga4CycleOf(iso);
    rows.push([x.id, iso, c.label, c.start, x.sm, x.campaign, x.fusm, x.fcamp, x.revenue, stamp, x.keyword, x.query]);
  });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(GA4_TAB) || ss.insertSheet(GA4_TAB);
  sh.clear();
  var range = sh.getRange(1, 1, rows.length, GA4_HEADER.length);
  range.setNumberFormat('@');          // keep Res#, dates and amounts exactly as written
  range.setValues(rows);
  Logger.log('Wrote ' + (rows.length - 1) + ' bookings to ' + GA4_TAB + '.');
}

// One GA4 report from GA4_FIRST_DAY to today, every page of it. Returns [{d:[dimension values], m:[metric values]}].
function ga4Report(dims, mets) {
  var out = [], offset = 0, total = null;
  do {
    var res = AnalyticsData.Properties.runReport({
      dateRanges: [{ startDate: GA4_FIRST_DAY, endDate: 'today' }],
      dimensions: dims.map(function (n) { return { name: n }; }),
      metrics: mets.map(function (n) { return { name: n }; }),
      limit: 10000, offset: offset
    }, 'properties/' + GA4_PROPERTY_ID);
    total = res.rowCount || 0;
    (res.rows || []).forEach(function (row) {
      out.push({ d: row.dimensionValues.map(function (v) { return v.value; }), m: (row.metricValues || []).map(function (v) { return v.value; }) });
    });
    offset += 10000;
  } while (offset < total);
  return out;
}

// Billing cycle for a yyyy-MM-dd date: the 15th of its month (or the month before) through the 14th.
function ga4CycleOf(iso) {
  var p = iso.split('-'), y = Number(p[0]), m = Number(p[1]) - 1, d = Number(p[2]);
  if (d < GA4_CYCLE_DAY) { m--; if (m < 0) { m = 11; y--; } }
  var start = new Date(y, m, GA4_CYCLE_DAY), last = new Date(y, m + 1, GA4_CYCLE_DAY - 1);
  var two = function (n) { return ('0' + n).slice(-2); };
  return {
    start: start.getFullYear() + '-' + two(start.getMonth() + 1) + '-' + two(start.getDate()),
    label: GA4_MON[m] + ' ' + GA4_CYCLE_DAY + ' – ' + GA4_MON[last.getMonth()] + ' ' + last.getDate() + ', ' + last.getFullYear()
  };
}
