/* Report model: defaults, ids, derived status. Records only - no scoring. */
window.FRModel = (function () {
  "use strict";

  var APP_VERSION = "2.2.1";
  var SCHEMA = 2;

  function makeId(visitDate, factoryName) {
    var day = FRUtil.dateKey(visitDate);
    return day + "-" + FRUtil.slugify(factoryName || "draft", 24) + "-" + FRUtil.uid(4);
  }

  function emptyReport() {
    var now = FRUtil.now();
    var visit = FRUtil.today();
    return {
      schema: SCHEMA,
      id: makeId(visit, "draft"),
      idLocked: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      appVersion: APP_VERSION,
      deviceId: "",
      meta: { author: "" },
      profile: {
        factoryName: "", cityProvince: "", visitDate: visit, contactName: "",
        contactRole: "", phone: "", email: "", businessCardIds: [],
        mainProducts: [], mainMarkets: [], mainCustomers: "",
        annualOutputValue: null, annualOutputCurrency: "EUR",
        photoIds: []
      },
      facts: {
        employees: null, qcStaff: null, factoryAreaSqm: null, workshopAreaSqm: null,
        buildingsOwned: "", assemblyLines: null,
        monthlyCapacity: null, inHouseProcesses: []
      },
      answers: {},
      commercial: { moq: "", leadTimeDays: null, nextSteps: "" },
      conclusion: { comments: "", signature: { name: "", date: "" } },
      photos: [],
      coverPhotoId: "",
      pushedAt: null,
      remoteRev: null
    };
  }

  var STATE_MAP = { pass: "ok", fail: "issue", partial: "partial", na: "na" };

  function normalizeAnswer(a) {
    var out = { state: "", note: "", photoIds: [] };
    if (!a || typeof a !== "object") return out;
    out.state = STATE_MAP[a.state] || a.state || "";
    out.note = a.note == null ? "" : String(a.note);
    out.photoIds = Array.isArray(a.photoIds) ? a.photoIds : [];
    return out;
  }

  /* Normalise an object read back from IndexedDB or the private repo. */
  function normalize(r) {
    var base = emptyReport();
    if (!r || typeof r !== "object") return base;
    var out = Object.assign({}, base, r);
    ["profile", "facts", "meta", "commercial", "conclusion"].forEach(function (k) {
      out[k] = Object.assign({}, base[k], r[k] || {});
    });
    out.conclusion.signature = Object.assign({}, base.conclusion.signature,
      (r.conclusion && r.conclusion.signature) || {});
    out.conclusion.comments = String((r.conclusion && r.conclusion.comments) || "");

    /* v2.2.1: export markets are recorded once, in the factory profile. */
    delete out.commercial.exportMarkets;

    out.answers = {};
    Object.keys(r.answers || {}).forEach(function (id) {
      out.answers[id] = normalizeAnswer(r.answers[id]);
    });

    /* v1 stored two strings; keep the author name when it is there. */
    out.meta = { author: String(r.meta && (r.meta.author || r.meta.inspector) || "") };

    out.photos = Array.isArray(r.photos) ? r.photos : [];
    out.coverPhotoId = typeof r.coverPhotoId === "string" ? r.coverPhotoId : "";
    if (!out.id) out.id = makeId(out.profile.visitDate, out.profile.factoryName);
    if (!out.appVersion) out.appVersion = APP_VERSION;
    return out;
  }

  /* The id is derived from the factory name once, then frozen. */
  function ensureId(report) {
    if (report.idLocked) return report;
    var name = String(report.profile.factoryName || "").trim();
    if (!name) return report;
    if (report.id && report.id.indexOf("-draft-") === -1) {
      report.idLocked = true;
      return report;
    }
    report.id = makeId(report.profile.visitDate, name);
    report.idLocked = true;
    return report;
  }

  function requiredMissing(report) {
    var sections = FRRules.sections();
    var missing = [];
    sections.forEach(function (sec) {
      (sec.fields || []).concat(sec.tailFields || []).forEach(function (f) {
        if (!f.required) return;
        var v = getPath(report, f.store + "." + f.k);
        if (v == null || v === "" || (Array.isArray(v) && !v.length)) missing.push(f.k);
      });
    });
    return missing;
  }

  function recordedCount(report) {
    var n = 0;
    FRRules.itemIds().forEach(function (id) {
      var a = report.answers && report.answers[id];
      if (a && a.state) n++;
    });
    return n;
  }

  function totalItems() { return FRRules.itemIds().length; }

  function statusOf(report) {
    var total = totalItems();
    if (requiredMissing(report).length) return "draft";
    /* no checklist items in the template: the fields are the whole record */
    if (!total) return "complete";
    return recordedCount(report) === total ? "complete" : "draft";
  }

  function getPath(obj, path) {
    var parts = String(path).split("."), cur = obj, i;
    for (i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function setPath(obj, path, value) {
    var parts = String(path).split("."), cur = obj, i;
    for (i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function answer(report, itemId) {
    if (!report.answers[itemId]) report.answers[itemId] = { state: "", note: "", photoIds: [] };
    var a = report.answers[itemId];
    if (!Array.isArray(a.photoIds)) a.photoIds = [];
    if (typeof a.note !== "string") a.note = a.note == null ? "" : String(a.note);
    return a;
  }

  /* The photo that identifies the visit on the home screen: the chosen cover,
     else the first factory photo, else the first photo that is not a
     business card (a card is evidence, not a picture of the plant). */
  function coverId(report) {
    var list = (report && report.photos) || [];
    var has = function (id) {
      return !!list.filter(function (p) { return p.id === id; })[0];
    };
    if (report && report.coverPhotoId && has(report.coverPhotoId)) return report.coverPhotoId;
    var factory = list.filter(function (p) { return p.kind === "factory"; })[0];
    if (factory) return factory.id;
    var shot = list.filter(function (p) { return p.kind !== "business_card"; })[0];
    return shot ? shot.id : "";
  }

  function displayName(report) {
    var n = String(report.profile.factoryName || "").trim();
    return n || "Untitled visit";
  }

  function titleSlug(s, max) {
    return FRUtil.slugify(s, max).split("-").map(function (w) {
      return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join("-");
  }

  function pdfName(report) {
    var d = FRUtil.dateKey(report.profile.visitDate);
    return "FactoryVisit_" + titleSlug(displayName(report), 40) + "_" + d + ".pdf";
  }

  return {
    APP_VERSION: APP_VERSION,
    SCHEMA: SCHEMA,
    emptyReport: emptyReport, normalize: normalize, ensureId: ensureId,
    requiredMissing: requiredMissing, statusOf: statusOf,
    recordedCount: recordedCount, totalItems: totalItems,
    getPath: getPath, setPath: setPath,
    answer: answer, displayName: displayName, pdfName: pdfName, makeId: makeId,
    coverId: coverId
  };
})();
