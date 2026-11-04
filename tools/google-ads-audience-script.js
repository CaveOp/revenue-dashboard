/**
 * Cave Springs — Ad Audience (Google Ads script)
 *
 * Paste this into Google Ads: Tools → Bulk actions → Scripts → + (new script).
 *
 * What it does:
 *   - READS reports from Google Ads. It never changes campaigns, budgets, bids, ads or tracking.
 *   - WRITES only to one tab of the dashboard sheet: AD_AUDIENCE_CLEAN.
 *     Each run rebuilds that tab from scratch, for every billing cycle from FIRST_CYCLE to today.
 *   - Billing cycles run from the 15th through the 14th of the next month, the same as the dashboard.
 *     The cycle still running is filled through today.
 *
 * Location (city and state) is where the people who saw the ads were.
 * Run it any time with the Run button; schedule it daily to keep the dashboard fresh.
 * If any report fails, nothing is written and the tab keeps what it had.
 */

var SHEET_ID    = '18Jn8voijFQHCLfZn6xwrkqjvDhTO2E3A5tVshtGRRyc';
var TAB         = 'AD_AUDIENCE_CLEAN';
var CYCLE_DAY   = 15;
var FIRST_CYCLE = '2026-05-15';
var HEADER = ['Cycle', 'CycleStart', 'Report', 'Group', 'Item', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'ImportedOn', 'DataThrough'];

var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Google's codes → the names the dashboard shows
var AGE = { AGE_RANGE_18_24: '18-24', AGE_RANGE_25_34: '25-34', AGE_RANGE_35_44: '35-44', AGE_RANGE_45_54: '45-54',
            AGE_RANGE_55_64: '55-64', AGE_RANGE_65_UP: '65+', AGE_RANGE_UNDETERMINED: 'Unknown' };
var GENDER = { FEMALE: 'Female', MALE: 'Male', UNDETERMINED: 'Unknown' };
var DEVICE = { MOBILE: 'Mobile phones', DESKTOP: 'Computers', TABLET: 'Tablets', CONNECTED_TV: 'TV screens', OTHER: 'Other' };
var NETWORK = { SEARCH: 'Google search', SEARCH_PARTNERS: 'Search partners', CONTENT: 'Display network', YOUTUBE: 'YouTube',
                YOUTUBE_SEARCH: 'YouTube', YOUTUBE_WATCH: 'YouTube', GOOGLE_TV: 'Google TV', MIXED: 'Cross-network' };
var DAY = { MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday', FRIDAY: 'Friday',
            SATURDAY: 'Saturday', SUNDAY: 'Sunday' };

function main() {
  var tz = AdsApp.currentAccount().getTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  // Build every row first; write only if all reports came back.
  var rows = [HEADER];
  var geoProblem = '';
  cycles(today).forEach(function (c) {
    var add = function (report, group, item, m) {
      rows.push([c.label, c.start, report, group || '', item, m.impressions, m.clicks, m.cost, m.conversions, stamp, c.through]);
    };
    var range = " WHERE segments.date BETWEEN '" + c.start + "' AND '" + c.through + "'";

    collect('SELECT ad_group_criterion.age_range.type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM age_range_view' + range,
      function (r) { return ['', name(AGE, r.adGroupCriterion.ageRange.type)]; }).forEach(function (x) { add('age', x.group, x.item, x.m); });

    collect('SELECT ad_group_criterion.gender.type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM gender_view' + range,
      function (r) { return ['', name(GENDER, r.adGroupCriterion.gender.type)]; }).forEach(function (x) { add('gender', x.group, x.item, x.m); });

    collect('SELECT segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign' + range,
      function (r) { return ['', name(DEVICE, r.segments.device)]; }).forEach(function (x) { add('device', x.group, x.item, x.m); });

    collect('SELECT segments.day_of_week, metrics.impressions FROM campaign' + range,
      function (r) { return ['', name(DAY, r.segments.dayOfWeek)]; }).forEach(function (x) { add('day', x.group, x.item, x.m); });

    collect('SELECT segments.hour, metrics.impressions FROM campaign' + range,
      function (r) { return ['', hourName(r.segments.hour)]; }).forEach(function (x) { add('hour', x.group, x.item, x.m); });

    collect('SELECT segments.day_of_week, segments.hour, metrics.impressions FROM campaign' + range,
      function (r) { return [name(DAY, r.segments.dayOfWeek), hourName(r.segments.hour)]; }).forEach(function (x) { add('day_hour', x.group, x.item, x.m); });

    collect('SELECT segments.ad_network_type, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign' + range,
      function (r) { return ['', name(NETWORK, r.segments.adNetworkType)]; }).forEach(function (x) { add('network', x.group, x.item, x.m); });

    collect('SELECT search_term_view.search_term, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view' + range,
      function (r) { return ['', String(r.searchTermView.searchTerm || '').toLowerCase()]; }).forEach(function (x) { add('search', x.group, x.item, x.m); });

    // Where people were (their physical location). Kept separate: if Google refuses these
    // reports, the log says so and every other report above is still written.
    try {
      var cities = geo('city', range), states = geo('state', range);   // both first, so a cycle never gets only half
      cities.forEach(function (x) { add('city', '', x.item, x.m); });
      states.forEach(function (x) { add('state', '', x.item, x.m); });
    } catch (e) {
      geoProblem = String(e && e.message || e);
    }
  });
  if (geoProblem) Logger.log('Location reports skipped: ' + geoProblem);

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
  sh.clear();
  var range = sh.getRange(1, 1, rows.length, HEADER.length);
  range.setNumberFormat('@');          // keep dates and numbers exactly as written (no auto-formatting)
  range.setValues(rows);
  Logger.log('Wrote ' + (rows.length - 1) + ' rows to ' + TAB + ' for ' + cycles(today).length + ' cycles.');
}

// Every cycle from FIRST_CYCLE through the one running today. Dates as yyyy-MM-dd text.
function cycles(today) {
  var out = [];
  var p = FIRST_CYCLE.split('-');
  var y = Number(p[0]), m = Number(p[1]) - 1;
  while (true) {
    var start = iso(y, m, CYCLE_DAY);
    if (start > today) break;
    var lastD = new Date(y, m + 1, CYCLE_DAY - 1);
    var last = iso(lastD.getFullYear(), lastD.getMonth(), lastD.getDate());
    out.push({
      start: start,
      through: last < today ? last : today,
      label: MON[m] + ' ' + CYCLE_DAY + ' – ' + MON[lastD.getMonth()] + ' ' + lastD.getDate() + ', ' + lastD.getFullYear()
    });
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

// Runs one report and adds up the rows that share the same name (e.g. all campaigns' Mobile phones).
function collect(query, keyOf) {
  var by = {}, order = [];
  var it = AdsApp.search(query);
  while (it.hasNext()) {
    var r = it.next();
    var k = keyOf(r);
    if (!k[1]) continue;
    var id = k[0] + '\u0001' + k[1];
    if (!by[id]) { by[id] = { group: k[0], item: k[1], m: { impressions: '', clicks: '', cost: '', conversions: '' } }; order.push(id); }
    var m = by[id].m, x = r.metrics || {};
    if (x.impressions != null) m.impressions = (Number(m.impressions) || 0) + Number(x.impressions);
    if (x.clicks != null) m.clicks = (Number(m.clicks) || 0) + Number(x.clicks);
    if (x.costMicros != null) m.cost = Math.round(((Number(m.cost) || 0) + Number(x.costMicros) / 1e6) * 100) / 100;
    if (x.conversions != null) m.conversions = Math.round(((Number(m.conversions) || 0) + Number(x.conversions)) * 100) / 100;
  }
  return order.map(function (id) { return by[id]; });
}

// Location report for one cycle: 'city' or 'state'. Google returns location codes; their names are looked up after.
var STATE_FIELD = null;   // 'geo_target_state', or 'geo_target_region' if this account's API version has no state field
function geo(level, range) {
  var fields = level === 'city' ? ['geo_target_city'] : (STATE_FIELD ? [STATE_FIELD] : ['geo_target_state', 'geo_target_region']);
  var last;
  for (var i = 0; i < fields.length; i++) {
    var fld = fields[i], key = fld.replace(/_([a-z])/g, function (a, c) { return c.toUpperCase(); });
    try {
      var rows = collect('SELECT segments.' + fld + ', metrics.impressions, metrics.clicks, metrics.cost_micros FROM user_location_view' + range,
        function (r) { return ['', r.segments && r.segments[key] || '']; });
      if (level === 'state') STATE_FIELD = fld;
      var names = geoNames(rows.map(function (x) { return x.item; }), level);
      return rows.map(function (x) { return { item: names[x.item] || 'Unknown', m: x.m }; });
    } catch (e) { last = e; }
  }
  throw last;
}
// geoTargetConstants/1014221 → 'Redding, California' (city) or 'California' (state). Remembered between cycles.
var GEO_NAMES = {};
function geoNames(ids, level) {
  var need = ids.filter(function (id) { return id && !(id in GEO_NAMES); });
  for (var i = 0; i < need.length; i += 200) {
    var list = need.slice(i, i + 200).map(function (id) { return "'" + id + "'"; }).join(',');
    var it = AdsApp.search('SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.canonical_name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (' + list + ')');
    while (it.hasNext()) {
      var g = it.next().geoTargetConstant;
      var parts = String(g.canonicalName || g.name || '').split(',');
      if (parts.length > 1) parts.pop();               // drop the country
      GEO_NAMES[g.resourceName] = { city: parts.join(', '), state: g.name };
    }
  }
  var out = {};
  ids.forEach(function (id) { var n = GEO_NAMES[id]; if (n) out[id] = level === 'city' ? n.city : n.state; });
  return out;
}

function name(map, code) { return map[code] || (code ? String(code).charAt(0) + String(code).slice(1).toLowerCase().replace(/_/g, ' ') : ''); }
function hourName(h) { h = Number(h); return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' AM' : ' PM'); }
function iso(y, m, d) { var t = new Date(y, m, d); return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }
