/* Small helpers. No dependencies, no build step. */
window.FRUtil = (function () {
  "use strict";

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function uid(n) {
    var out = "", chars = "abcdefghijklmnopqrstuvwxyz0123456789", i;
    var buf = new Uint8Array(n || 8);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (i = 0; i < buf.length; i++) out += chars[buf[i] % chars.length];
    return out;
  }

  function now() { return new Date().toISOString(); }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function dateKey(iso) {
    if (!iso) return today().replace(/-/g, "");
    return String(iso).slice(0, 10).replace(/-/g, "");
  }

  function slugify(s, max) {
    var out = String(s || "")
      .normalize ? String(s || "").normalize("NFKD") : String(s || "");
    out = out.replace(/[\u0300-\u036f]/g, "")   // strip accents
      .replace(/[\u00e4\u00c4]/g, "a")
      .replace(/[\u00f6\u00d6]/g, "o")
      .replace(/[\u00fc\u00dc]/g, "u")
      .replace(/\u00df/g, "ss")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!out) out = "factory";
    return out.slice(0, max || 24).replace(/-+$/, "");
  }

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function fmtDate(iso) {
    if (!iso) return "-";
    var s = String(iso).slice(0, 10), p = s.split("-");
    if (p.length !== 3) return s;
    return parseInt(p[2], 10) + " " + (MONTHS[parseInt(p[1], 10) - 1] || "") + " " + p[0];
  }

  function fmtDateTime(iso) {
    if (!iso) return "never";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return fmtDate(iso) + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function fmtSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  function num(v) {
    if (v === "" || v == null) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function toast(msg, bad) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast" + (bad ? " bad" : "");
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, bad ? 4200 : 2400);
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function bytesToB64(bytes) {
    var bin = "", chunk = 0x8000, i;
    for (i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function isOnline() { return navigator.onLine !== false; }

  return {
    $: $, $$: $$, esc: esc, uid: uid, now: now, today: today, dateKey: dateKey,
    slugify: slugify, fmtDate: fmtDate, fmtDateTime: fmtDateTime, fmtSize: fmtSize,
    num: num, debounce: debounce, toast: toast, download: download,
    bytesToB64: bytesToB64, b64ToBytes: b64ToBytes, isOnline: isOnline, pad: pad
  };
})();
