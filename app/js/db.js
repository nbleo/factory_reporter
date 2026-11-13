/* IndexedDB layer: reports, photos, settings.
   Photos keep their Blob here; report JSON only keeps metadata. */
window.FRDB = (function () {
  "use strict";

  var NAME = "factory-reporter";
  var VER = 1;
  var db = null;
  var opening = null;

  function open() {
    if (db) return Promise.resolve(db);
    if (opening) return opening;
    opening = new Promise(function (resolve, reject) {
      var r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = function () {
        var d = r.result;                     // r.result, not r.target.result
        if (!d.objectStoreNames.contains("reports")) {
          var s = d.createObjectStore("reports", { keyPath: "id" });
          s.createIndex("updatedAt", "updatedAt");
          s.createIndex("visitDate", "profile.visitDate");
          s.createIndex("status", "status");
        }
        if (!d.objectStoreNames.contains("photos")) {
          var p = d.createObjectStore("photos", { keyPath: "id" });
          p.createIndex("reportId", "reportId");
          p.createIndex("itemId", "itemId");
        }
        if (!d.objectStoreNames.contains("settings")) {
          d.createObjectStore("settings", { keyPath: "key" });
        }
      };
      r.onsuccess = function () { db = r.result; resolve(db); };
      r.onerror = function () { reject(r.error || new Error("IndexedDB open failed")); };
      r.onblocked = function () { reject(new Error("IndexedDB blocked by another tab")); };
    });
    return opening;
  }

  function store(name, mode) {
    return open().then(function (d) { return d.transaction(name, mode).objectStore(name); });
  }

  function wrap(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function put(name, val) {
    return store(name, "readwrite").then(function (s) { return wrap(s.put(val)); });
  }

  function get(name, key) {
    return store(name, "readonly").then(function (s) { return wrap(s.get(key)); });
  }

  function all(name) {
    return store(name, "readonly").then(function (s) { return wrap(s.getAll()); });
  }

  function del(name, key) {
    return store(name, "readwrite").then(function (s) { return wrap(s.delete(key)); });
  }

  function clear(name) {
    return store(name, "readwrite").then(function (s) { return wrap(s.clear()); });
  }

  function byIndex(name, index, val) {
    return store(name, "readonly").then(function (s) {
      return wrap(s.index(index).getAll(val));
    });
  }

  function kvGet(key, fallback) {
    return get("settings", key).then(function (row) {
      return row && "value" in row ? row.value : fallback;
    });
  }

  function kvSet(key, value) {
    return put("settings", { key: key, value: value });
  }

  function photoBlobs(reportId) {
    return byIndex("photos", "reportId", reportId);
  }

  function deleteReport(reportId) {
    return photoBlobs(reportId).then(function (rows) {
      return Promise.all(rows.map(function (r) { return del("photos", r.id); }));
    });
  }

  function usage() {
    return Promise.all([all("reports"), all("photos")]).then(function (res) {
      var reports = res[0], photos = res[1];
      var bytes = 0;
      photos.forEach(function (p) { bytes += (p.size || 0) + (p.thumbSize || 0); });
      return { reports: reports.length, photos: photos.length, bytes: bytes };
    });
  }

  function exportJSON() {
    return Promise.all([all("reports"), all("settings")]).then(function (res) {
      return { schema: 1, exportedAt: FRUtil.now(), reports: res[0], settings: res[1] };
    });
  }

  return {
    open: open, put: put, get: get, all: all, del: del, clear: clear,
    byIndex: byIndex, kvGet: kvGet, kvSet: kvSet,
    photoBlobs: photoBlobs, deleteReport: deleteReport, usage: usage, exportJSON: exportJSON
  };
})();
