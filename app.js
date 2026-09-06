/* Parish Health Explorer
 *
 * Static, single-fetch app: data/parishes.json holds all 209 parishes plus the
 * archdiocese-wide medians and the planning-area rollups, so every view works
 * off one array in memory with no further requests.
 *
 * Data is built by ../../Substack Articles/detroit-parish-health/build_webtool_data.py
 */

(function () {
  "use strict";

  var DATA = null;      // {meta, parishes}
  var BY_NAME = {};     // "PA6|Divine Child Parish" -> parish

  // ---------------------------------------------------------------- analytics

  // Anonymous, cookieless counts. No-ops when GoatCounter is absent (ad
  // blockers, localhost, offline) and never throws into the app.
  function trackEvent(path, title) {
    try {
      if (window.goatcounter && typeof window.goatcounter.count === "function") {
        window.goatcounter.count({ path: path, title: title || path, event: true });
      }
    } catch (err) { /* analytics must never break the page */ }
  }

  // ---------------------------------------------------------------- formatting

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  function money(v) {
    if (!isNum(v)) return "—";
    var abs = Math.abs(v);
    var s = "$" + Math.round(abs).toLocaleString("en-US");
    return v < 0 ? "−" + s : s;
  }

  function moneyShort(v) {
    if (!isNum(v)) return "—";
    var abs = Math.abs(v), s;
    if (abs >= 1e6) s = "$" + (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + "M";
    else if (abs >= 1e3) s = "$" + Math.round(abs / 1e3) + "K";
    else s = "$" + Math.round(abs);
    return v < 0 ? "−" + s : s;
  }

  function count(v) { return isNum(v) ? Math.round(v).toLocaleString("en-US") : "—"; }

  function pct(v, digits) {
    return isNum(v) ? v.toFixed(digits === undefined ? 1 : digits) + "%" : "—";
  }

  function share(v) { return isNum(v) ? (v * 100).toFixed(1) + "%" : "—"; }

  function ratio(v) { return isNum(v) ? v.toFixed(2) : "—"; }

  function months(v) {
    if (!isNum(v)) return "—";
    if (v >= 120) return "10+ years";
    if (v >= 24) return (v / 12).toFixed(1) + " years";
    return v.toFixed(1) + " months";
  }

  function signedPct(v) {
    if (!isNum(v)) return "—";
    return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%";
  }

  function text(v) { return v === null || v === undefined || v === "" ? "—" : String(v); }

  // ------------------------------------------------------------------ helpers

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined && txt !== null) n.textContent = txt;
    return n;
  }

  function keyOf(p) { return p.planning_area + "|" + p.parish_name; }

  function normalize(s) {
    return (s || "").toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\bst\b|\bste\b/g, "saint")
      .replace(/\bss\b/g, "saints")
      .replace(/\s+/g, " ").trim();
  }

  // ---------------------------------------------------------------------- tabs

  var TABS = ["lookup", "rankings", "areas", "about"];

  function selectTab(name, focusIt) {
    TABS.forEach(function (t) {
      var tab = document.getElementById("tab-" + t);
      var panel = document.getElementById("panel-" + t);
      var on = t === name;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    });
    if (focusIt) document.getElementById("tab-" + name).focus();
    trackEvent("view-" + name, "View: " + name);
  }

  function initTabs() {
    TABS.forEach(function (t, i) {
      var tab = document.getElementById("tab-" + t);
      tab.addEventListener("click", function () { selectTab(t, false); });
      tab.addEventListener("keydown", function (e) {
        var delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (delta) {
          e.preventDefault();
          selectTab(TABS[(i + delta + TABS.length) % TABS.length], true);
        } else if (e.key === "Home") {
          e.preventDefault(); selectTab(TABS[0], true);
        } else if (e.key === "End") {
          e.preventDefault(); selectTab(TABS[TABS.length - 1], true);
        }
      });
    });
  }

  // -------------------------------------------------------------------- theme

  function initTheme() {
    var btn = document.getElementById("themeToggle");
    var stored = null;
    try { stored = localStorage.getItem("phe-theme"); } catch (e) { /* private mode */ }
    var prefersDark = window.matchMedia
      && window.matchMedia("(prefers-color-scheme: dark)").matches;
    apply(stored || (prefersDark ? "dark" : "light"));

    function apply(mode) {
      document.documentElement.setAttribute("data-theme", mode);
      var dark = mode === "dark";
      btn.setAttribute("aria-pressed", dark ? "true" : "false");
      btn.textContent = dark ? "☀️ Light" : "🌙 Dark";
    }
    btn.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "dark"
        ? "light" : "dark";
      apply(next);
      try { localStorage.setItem("phe-theme", next); } catch (e) { /* ignore */ }
    });
  }

  // ------------------------------------------------------------------- search

  var searchState = { matches: [], active: -1, open: false };

  function searchMatches(query) {
    var q = normalize(query);
    if (!q) return [];
    var terms = q.split(" ");
    return DATA.parishes.filter(function (p) {
      var hay = normalize(p.parish_name + " " + (p.city || "") + " " + p.planning_area);
      return terms.every(function (t) { return hay.indexOf(t) !== -1; });
    }).slice(0, 40);
  }

  function closeListbox() {
    var box = document.getElementById("parishListbox");
    box.hidden = true;
    box.innerHTML = "";
    searchState.open = false;
    searchState.active = -1;
    var input = document.getElementById("parishSearch");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function renderListbox(matches) {
    var box = document.getElementById("parishListbox");
    var input = document.getElementById("parishSearch");
    box.innerHTML = "";
    if (!matches.length) {
      closeListbox();
      document.getElementById("searchStatus").textContent = "No matching parishes.";
      return;
    }
    matches.forEach(function (p, i) {
      var li = el("li", "search__option");
      li.id = "parish-opt-" + i;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      li.appendChild(el("span", null, p.parish_name));
      li.appendChild(document.createTextNode(" "));
      li.appendChild(el("span", "muted",
        (p.city ? p.city + " · " : "") + p.planning_area));
      li.addEventListener("mousedown", function (e) {
        e.preventDefault();   // keep focus in the input
        choose(p);
      });
      box.appendChild(li);
    });
    box.hidden = false;
    searchState.open = true;
    input.setAttribute("aria-expanded", "true");
    document.getElementById("searchStatus").textContent =
      matches.length + " matching parish" + (matches.length === 1 ? "" : "es") + ".";
  }

  function setActive(i) {
    var box = document.getElementById("parishListbox");
    var opts = box.querySelectorAll(".search__option");
    if (!opts.length) return;
    if (searchState.active >= 0 && opts[searchState.active]) {
      opts[searchState.active].setAttribute("aria-selected", "false");
    }
    searchState.active = (i + opts.length) % opts.length;
    var opt = opts[searchState.active];
    opt.setAttribute("aria-selected", "true");
    document.getElementById("parishSearch")
      .setAttribute("aria-activedescendant", opt.id);
    if (opt.scrollIntoView) opt.scrollIntoView({ block: "nearest" });
  }

  function choose(p) {
    document.getElementById("parishSearch").value = p.parish_name;
    document.getElementById("searchClear").hidden = false;
    closeListbox();
    renderScorecard(p);
    trackEvent("view-parish", "Parish scorecard viewed");
  }

  function initSearch() {
    var input = document.getElementById("parishSearch");
    var clear = document.getElementById("searchClear");

    input.addEventListener("input", function () {
      clear.hidden = !input.value;
      searchState.matches = searchMatches(input.value);
      renderListbox(searchState.matches);
      if (input.value.length === 3) trackEvent("search-parish", "Parish search");
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!searchState.open) {
          searchState.matches = searchMatches(input.value);
          renderListbox(searchState.matches);
        }
        setActive(searchState.active + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(searchState.active - 1);
      } else if (e.key === "Enter") {
        if (searchState.open) {
          e.preventDefault();
          var i = searchState.active >= 0 ? searchState.active : 0;
          if (searchState.matches[i]) choose(searchState.matches[i]);
        }
      } else if (e.key === "Escape") {
        closeListbox();
      }
    });

    input.addEventListener("blur", function () {
      window.setTimeout(closeListbox, 120);
    });

    clear.addEventListener("click", function () {
      input.value = "";
      clear.hidden = true;
      closeListbox();
      document.getElementById("scorecard").hidden = true;
      document.getElementById("lookupEmpty").hidden = false;
      input.focus();
    });
  }

  // ---------------------------------------------------------------- scorecard

  function metric(label, value, note) {
    var d = el("div", "metric");
    d.appendChild(el("span", "metric__label", label));
    d.appendChild(el("span", "metric__value", value));
    if (note) d.appendChild(el("span", "metric__note", note));
    return d;
  }

  // "median $412K across the archdiocese" — the comparison that makes a bare
  // number legible without drawing a chart.
  function vsMedian(field, fmt) {
    var m = DATA.meta.medians[field];
    return isNum(m) ? "archdiocese median " + fmt(m) : null;
  }

  function card(title, rows) {
    var c = el("section", "card");
    c.appendChild(el("h3", null, title));
    rows.forEach(function (r) { if (r) c.appendChild(r); });
    return c;
  }

  function renderScorecard(p) {
    var box = document.getElementById("scorecard");
    document.getElementById("lookupEmpty").hidden = true;
    box.hidden = false;
    box.innerHTML = "";

    var head = el("div", "scorecard__header");
    var h = el("h2", null, p.parish_name);
    head.appendChild(h);
    var where = el("p", "scorecard__where",
      (p.city ? p.city + " · " : "") + "Planning area " +
      p.planning_area.replace("PA", ""));
    head.appendChild(where);
    box.appendChild(head);

    var grid = el("div", "card-grid");

    // --- money
    var net = p.net_fy2425;
    var netBadge = el("div", "metric");
    netBadge.appendChild(el("span", "metric__label", "FY24/25 net"));
    var badgeWrap = el("span", "metric__value");
    var b = el("span", "badge " + (isNum(net) ? (net < 0 ? "badge--bad" : "badge--good") : ""),
      (isNum(net) ? (net < 0 ? "▼ deficit " : "▲ surplus ") : "") + money(net));
    badgeWrap.appendChild(b);
    netBadge.appendChild(badgeWrap);
    var noteEl = el("span", "metric__note", vsMedian("net_fy2425", money) || "");
    netBadge.appendChild(noteEl);

    grid.appendChild(card("Money", [
      metric("Total revenue", money(p.total_revenue),
        vsMedian("total_revenue", moneyShort)),
      metric("Total expenses", money(p.total_expenses), null),
      netBadge,
      metric("Operating margin", share(p.operating_margin), null),
      metric("Three-year net trend", isNum(p.net_trend_slope)
        ? (p.net_trend_slope < 0 ? "worsening " : "improving ")
          + money(Math.abs(p.net_trend_slope)) + " a year"
        : "—", null),
      metric("Collections as a share of revenue", share(p.collections_share), null),
      metric("Salary and benefits as a share of costs", share(p.salary_share), null),
    ]));

    // --- balance sheet
    grid.appendChild(card("What it owns and owes", [
      metric("Unrestricted cash and savings", money(p.unrestricted_cash_savings),
        "what the parish can actually spend"),
      metric("Restricted savings and endowments", money(p.restricted_savings),
        "cannot be freely spent"),
      metric("Debt (bills due plus loans)", money(p.net_debt), null),
      metric("Months of runway", months(p.months_of_runway),
        vsMedian("months_of_runway", months)),
      metric("Deferred maintenance", money(p.deferred_maintenance),
        isNum(p.deferred_maintenance)
          ? (p.evaluation_report_date
            ? "property evaluation " + p.evaluation_report_date : null)
          : "no property evaluation on file"),
      p.school_subsidy_fy2425
        ? metric("Subsidy to its Catholic school", money(p.school_subsidy_fy2425), null)
        : null,
    ]));

    // --- people
    grid.appendChild(card("People", [
      metric("Mass attendance", count(p.mass_count),
        vsMedian("mass_count", count)),
      metric("Seating capacity", count(p.seating_capacity), null),
      metric("Seats filled", pct(p.utilization_pct),
        vsMedian("utilization_pct", pct)),
      metric("Weekend Masses", count(p.weekend_masses), null),
      metric("Funerals / baptisms (2024)",
        count(p.funerals) + " / " + count(p.baptisms),
        isNum(p.funeral_baptism_ratio)
          ? ratio(p.funeral_baptism_ratio) + " funerals per baptism"
          : null),
      metric("Marriages", count(p.marriages), null),
      metric("Confirmations / first communions",
        count(p.confirmations) + " / " + count(p.first_communions), null),
      metric("Adults received (OCIA)", count(p.ocia), null),
    ]));

    // --- where parishioners live
    grid.appendChild(card("Where its parishioners live", isNum(p.within_parish_pct)
      ? [
        metric("Within the parish's own territory",
          pct(p.within_parish_pct) + " (" + count(p.within_parish_count) + ")",
          vsMedian("within_parish_pct", pct)),
        metric("Within the wider planning-area region",
          pct(p.within_region_pct) + " (" + count(p.within_region_count) + ")", null),
        metric("Outside the region",
          pct(p.outside_region_pct) + " (" + count(p.outside_region_count) + ")", null),
        el("p", "metric__note",
          "Share of this parish's own registered households living inside its "
          + "territorial boundary versus farther out."),
      ]
      : [
        el("p", "metric__note",
          "No territorial boundary — this is a national or personal parish, "
          + "shrine, or mission, so registrants aren't tied to a home territory."),
      ]));

    // --- decade change
    grid.appendChild(card("Change over the decade (2015–2024)", [
      metric("Funerals", signedPct(p.funerals_pct_change), null),
      metric("Infant and minor baptisms", signedPct(p.baptisms_pct_change), null),
      metric("Marriages", signedPct(p.marriages_pct_change), null),
      metric("Confirmations", signedPct(p.confirmations_pct_change), null),
      metric("First communions", signedPct(p.first_communions_pct_change), null),
      metric("Religious education enrollment",
        signedPct(p.religious_ed_pct_change), null),
      metric("Adult sacraments", signedPct(p.adult_sacraments_pct_change), null),
    ]));

    // --- at-risk flags, as an explicit checklist rather than a grade
    var runwayKnown = p.low_runway_flag !== null && p.low_runway_flag !== undefined;
    var runwayPositiveNet = !runwayKnown && isNum(p.avg_net_3yr) && p.avg_net_3yr >= 0;
    var flags = [
      ["Ran a deficit in FY24/25", p.deficit_flag],
      ["Three-year net trend is worsening", p.net_worsening_flag],
      ["More funerals than baptisms",
        isNum(p.funerals) && isNum(p.baptisms) ? p.funerals > p.baptisms : null],
      ["Fills fewer than 30% of its seats", p.low_utilization_flag],
      ["Under five years of cash", runwayPositiveNet ? false : p.low_runway_flag,
        runwayPositiveNet
          ? "no — its 3-year average net is positive, so there's no cash burn to measure a runway against"
          : null],
    ];
    var list = el("ul", "flag-list");
    flags.forEach(function (f) {
      var yes = f[1] === true;
      var known = f[1] !== null && f[1] !== undefined;
      var li = el("li", "flag " + (yes ? "flag--yes" : known ? "flag--no" : ""));
      li.appendChild(el("span", "flag__mark", known ? (yes ? "✗" : "✓") : "?"));
      li.appendChild(el("span", null,
        f[0] + " — " + (f[2] || (known ? (yes ? "yes" : "no") : "not known"))));
      list.appendChild(li);
    });
    var risk = el("section", "card");
    risk.appendChild(el("h3", null, "Distress signals"));
    risk.appendChild(list);
    risk.appendChild(metric("Flags raised", p.at_risk_flags + " of 5", null));
    risk.appendChild(el("p", "metric__note",
      "A count of published warning signs, not a prediction about this parish's future. "
      + "See “About the numbers”."));
    grid.appendChild(risk);

    // --- planning-area context
    grid.appendChild(card("Its planning area (" + p.planning_area + ")", [
      metric("Catholic households", pct(p.pct_households_catholic), null),
      metric("Median household income", money(p.median_household_income), null),
      metric("Median age", isNum(p.median_age) ? p.median_age.toFixed(1) : "—", null),
      metric("Population change since 2010",
        signedPct(p.pop_change_pct_since_2010), null),
      metric("Catholic households since 2010",
        signedPct(p.catholic_hh_change_pct_since_2010), null),
      el("p", "metric__note",
        "Demographics describe the whole planning area, not this parish alone."),
    ]));

    box.appendChild(grid);
    h.setAttribute("tabindex", "-1");
    h.focus();
  }

  // ---------------------------------------------------------------- rankings

  var COLUMNS = [
    { key: "parish_name", label: "Parish", fmt: text, type: "text" },
    { key: "planning_area", label: "Area", fmt: text, type: "text" },
    { key: "mass_count", label: "At Mass", fmt: count },
    { key: "utilization_pct", label: "Seats filled", fmt: pct },
    { key: "total_revenue", label: "Revenue", fmt: moneyShort },
    { key: "net_fy2425", label: "Net", fmt: moneyShort },
    { key: "operating_margin", label: "Margin", fmt: share },
    { key: "months_of_runway", label: "Runway", fmt: months },
    { key: "net_debt", label: "Debt", fmt: moneyShort },
    { key: "deferred_maintenance", label: "Deferred maint.", fmt: moneyShort },
    { key: "funerals", label: "Funerals", fmt: count },
    { key: "baptisms", label: "Baptisms", fmt: count },
    { key: "funeral_baptism_ratio", label: "Fun./bapt.", fmt: ratio },
    { key: "at_risk_flags", label: "Flags", fmt: count },
    { key: "at_risk_score", label: "Score", fmt: function (v) {
      return isNum(v) ? v.toFixed(2) : "—"; } },
  ];

  var sortState = { key: "at_risk_score", dir: -1 };

  function filtered() {
    var area = document.getElementById("filterArea").value;
    var fin = document.getElementById("filterFinance").value;
    var att = document.getElementById("filterAttendance").value;
    var flags = document.getElementById("filterFlags").value;
    return DATA.parishes.filter(function (p) {
      if (area && p.planning_area !== area) return false;
      if (fin === "deficit" && p.deficit_flag !== true) return false;
      if (fin === "surplus" && p.deficit_flag !== false) return false;
      if (fin === "lowrunway" && p.low_runway_flag !== true) return false;
      if (fin === "nocushion" &&
          !(p.deficit_flag === true && p.low_runway_flag === true)) return false;
      if (att && p.attendance_bucket !== att) return false;
      if (flags && p.at_risk_flags < parseInt(flags, 10)) return false;
      return true;
    });
  }

  function sorted(rows) {
    var col = COLUMNS.filter(function (c) { return c.key === sortState.key; })[0];
    var isText = col && col.type === "text";
    return rows.slice().sort(function (a, b) {
      var x = a[sortState.key], y = b[sortState.key];
      if (isText) return String(x).localeCompare(String(y)) * sortState.dir;
      // blanks always sort last, whichever direction the column is sorted
      var xn = isNum(x), yn = isNum(y);
      if (!xn && !yn) return 0;
      if (!xn) return 1;
      if (!yn) return -1;
      return (x - y) * sortState.dir;
    });
  }

  function renderRankings() {
    var rows = sorted(filtered());
    var head = document.getElementById("rankHead");
    head.innerHTML = "";
    COLUMNS.forEach(function (c) {
      var th = el("th");
      th.scope = "col";
      var active = sortState.key === c.key;
      th.setAttribute("aria-sort", active
        ? (sortState.dir === 1 ? "ascending" : "descending") : "none");
      var btn = el("button", "sort-button");
      btn.type = "button";
      btn.appendChild(document.createTextNode(c.label + " "));
      var arrow = el("span", "arrow", active ? (sortState.dir === 1 ? "▲" : "▼") : "");
      btn.appendChild(arrow);
      btn.appendChild(el("span", "visually-hidden",
        active
          ? ", sorted " + (sortState.dir === 1 ? "ascending" : "descending")
          : ", activate to sort"));
      btn.addEventListener("click", function () {
        if (sortState.key === c.key) sortState.dir = -sortState.dir;
        else { sortState.key = c.key; sortState.dir = c.type === "text" ? 1 : -1; }
        renderRankings();
        trackEvent("sort-" + c.key, "Sort by " + c.label);
      });
      th.appendChild(btn);
      head.appendChild(th);
    });

    var body = document.getElementById("rankBody");
    body.innerHTML = "";
    rows.forEach(function (p) {
      var tr = el("tr");
      COLUMNS.forEach(function (c, i) {
        var cell = el(i === 0 ? "th" : "td", c.type === "text" ? null : "num",
          c.fmt(p[c.key]));
        if (i === 0) cell.scope = "row";
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });

    document.getElementById("rankCount").textContent =
      rows.length + " of " + DATA.parishes.length + " parishes shown";
    return rows;
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function downloadCsv() {
    var rows = sorted(filtered());
    var keys = COLUMNS.map(function (c) { return c.key; });
    var lines = [keys.join(",")];
    rows.forEach(function (p) {
      lines.push(keys.map(function (k) { return csvCell(p[k]); }).join(","));
    });
    var blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "aod-parishes.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    trackEvent("download-csv", "Download CSV");
  }

  function initRankings() {
    var area = document.getElementById("filterArea");
    DATA.meta.planning_areas.forEach(function (a) {
      var o = el("option", null, a.planning_area + " (" + a.parishes + " parishes)");
      o.value = a.planning_area;
      area.appendChild(o);
    });
    ["filterArea", "filterFinance", "filterAttendance", "filterFlags"]
      .forEach(function (id) {
        document.getElementById(id).addEventListener("change", function () {
          renderRankings();
          trackEvent("filter-" + id.replace("filter", "").toLowerCase(), "Filter");
        });
      });
    document.getElementById("downloadCsv").addEventListener("click", downloadCsv);
    renderRankings();
  }

  // ----------------------------------------------------------- planning areas

  var AREA_COLUMNS = [
    { key: "planning_area", label: "Area", fmt: text },
    { key: "parishes", label: "Parishes", fmt: count },
    { key: "deficit", label: "In deficit", fmt: count },
    { key: "deficit_rate", label: "Deficit rate", fmt: share },
    { key: "net", label: "Combined net", fmt: moneyShort },
    { key: "cash", label: "Cash", fmt: moneyShort },
    { key: "debt", label: "Debt", fmt: moneyShort },
    { key: "deferred_maintenance", label: "Deferred maint.", fmt: moneyShort },
    { key: "low_runway", label: "Under 5 yrs cash", fmt: count },
    { key: "funeral_baptism_ratio", label: "Fun./bapt.", fmt: ratio },
    { key: "median_utilization_pct", label: "Median seats filled", fmt: pct },
    { key: "median_household_income", label: "Median income", fmt: moneyShort },
  ];

  var AREA_CHARTS = [
    { key: "deficit_rate", title: "Share of parishes running a deficit",
      note: "FY24/25", fmt: share },
    { key: "funeral_baptism_ratio", title: "Funerals per baptism",
      note: "2024; above 1.0 means more funerals than baptisms", fmt: ratio },
    { key: "median_utilization_pct", title: "Median share of seats filled",
      note: "Mass attendance against seating capacity", fmt: pct },
    { key: "deferred_maintenance", title: "Deferred maintenance",
      note: "total identified repair cost", fmt: moneyShort },
  ];

  function renderAreas() {
    var areas = DATA.meta.planning_areas;

    var charts = document.getElementById("areaCharts");
    charts.innerHTML = "";
    AREA_CHARTS.forEach(function (spec) {
      var box = el("div", "area-chart");
      box.appendChild(el("h3", null, spec.title));
      box.appendChild(el("p", null, spec.note));
      var max = Math.max.apply(null, areas.map(function (a) {
        return isNum(a[spec.key]) ? a[spec.key] : 0;
      })) || 1;
      areas.forEach(function (a) {
        var row = el("div", "bar-row");
        row.appendChild(el("span", "bar-row__label", a.planning_area));
        var track = el("span", "bar-row__track");
        var fill = el("span", "bar-row__fill");
        var v = isNum(a[spec.key]) ? a[spec.key] : 0;
        fill.style.width = Math.max(1, (v / max) * 100).toFixed(1) + "%";
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("span", "bar-row__value", spec.fmt(a[spec.key])));
        box.appendChild(row);
      });
      charts.appendChild(box);
    });

    var head = document.getElementById("areaHead");
    head.innerHTML = "";
    AREA_COLUMNS.forEach(function (c) {
      var th = el("th", null, c.label);
      th.scope = "col";
      head.appendChild(th);
    });
    var body = document.getElementById("areaBody");
    body.innerHTML = "";
    areas.forEach(function (a) {
      var tr = el("tr");
      AREA_COLUMNS.forEach(function (c, i) {
        var cell = el(i === 0 ? "th" : "td", i === 0 ? null : "num", c.fmt(a[c.key]));
        if (i === 0) cell.scope = "row";
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
  }

  // --------------------------------------------------------------------- boot

  function boot(data) {
    DATA = data;
    DATA.parishes.forEach(function (p) { BY_NAME[keyOf(p)] = p; });

    document.getElementById("loading").hidden = true;
    document.getElementById("generated").textContent =
      "Data extracted from the workbooks on " + DATA.meta.generated + "; "
      + DATA.meta.parish_count + " parishes.";
    document.getElementById("sourceLink").href = DATA.meta.source_url;

    initTabs();
    initSearch();
    initRankings();
    renderAreas();
    selectTab("lookup", false);
  }

  function fail(msg) {
    var n = document.getElementById("loading");
    n.textContent = msg;
    n.hidden = false;
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    fetch("data/parishes.json")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(boot)
      .catch(function (err) {
        fail("Could not load the parish data (" + err.message
          + "). If you opened this file directly, serve the folder over HTTP instead.");
      });
  });
}());
