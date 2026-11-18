/* Zero-dependency PDF writer and report layout.
   A4, Helvetica (WinAnsi), vector text, JPEG photos via /DCTDecode. */
window.FRPDF = (function () {
  "use strict";

  var PW = 595.276, PH = 841.89;
  var M = { l: 48, r: 48, t: 64, b: 56 };
  var CONTENT_W = PW - M.l - M.r;

  var ACCENT = [0.1216, 0.1216, 0.6863];
  var ACCENT_D = [0.0902, 0.0902, 0.5490];
  var TEXT = [0.1020, 0.1137, 0.1686];
  var MUTED = [0.3608, 0.3882, 0.5098];
  var LINE = [0.8353, 0.8549, 0.9255];
  var OK = [0.1176, 0.4824, 0.2706], OK_BG = [0.8941, 0.9529, 0.9176];
  var WARN = [0.5412, 0.3529, 0.0], WARN_BG = [0.9843, 0.9412, 0.8392];
  var BAD = [0.6510, 0.1059, 0.1059], BAD_BG = [0.9843, 0.9020, 0.9020];
  var NA = [0.3608, 0.3882, 0.5098], NA_BG = [0.9255, 0.9333, 0.9608];

  /* ---------------------------------------------------------------- widths */
  var W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722,
    667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333,
    500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

  var W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
    722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722,
    667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
    556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389,
    556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

  var BASE = { 0xE4: 97, 0xE5: 97, 0xE6: 97, 0xE7: 99, 0xE8: 101, 0xE9: 101, 0xEA: 101, 0xEB: 101,
    0xEC: 105, 0xED: 105, 0xEE: 105, 0xEF: 105, 0xF1: 110, 0xF2: 111, 0xF3: 111, 0xF4: 111,
    0xF5: 111, 0xF6: 111, 0xF8: 111, 0xF9: 117, 0xFA: 117, 0xFB: 117, 0xFC: 117, 0xFD: 121,
    0xFF: 121, 0xDF: 115, 0xC4: 65, 0xC5: 65, 0xC6: 65, 0xC7: 67, 0xC8: 69, 0xC9: 69, 0xCA: 69,
    0xCB: 69, 0xCC: 73, 0xCD: 73, 0xCE: 73, 0xCF: 73, 0xD1: 78, 0xD2: 79, 0xD3: 79, 0xD4: 79,
    0xD5: 79, 0xD6: 79, 0xD8: 79, 0xD9: 85, 0xDA: 85, 0xDB: 85, 0xDC: 85, 0xDD: 89, 0x178: 89 };

  var SPECIAL = { "\u20ac": 0x80, "\u201a": 0x82, "\u0192": 0x83, "\u201e": 0x84, "\u2026": 0x85,
    "\u2020": 0x86, "\u2021": 0x87, "\u02c6": 0x88, "\u2030": 0x89, "\u0160": 0x8A, "\u2039": 0x8B,
    "\u0152": 0x8C, "\u017d": 0x8E, "\u2018": 0x91, "\u2019": 0x92, "\u201c": 0x93, "\u201d": 0x94,
    "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97, "\u02dc": 0x98, "\u2122": 0x99, "\u0161": 0x9A,
    "\u203a": 0x9B, "\u0153": 0x9C, "\u017e": 0x9E, "\u0178": 0x9F };

  /* Encode to WinAnsi (single byte). Characters outside the set become '?'. */
  function toWinAnsi(s) {
    var out = "", i, ch, code;
    s = String(s == null ? "" : s);
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      code = s.charCodeAt(i);
      if (code < 256) out += ch;
      else if (SPECIAL[ch] != null) out += String.fromCharCode(SPECIAL[ch]);
      else out += "?";
    }
    return out;
  }

  function widthOf(code, bold) {
    var table = bold ? W_BOLD : W_REG;
    if (code >= 32 && code <= 126) return table[code - 32];
    if (BASE[code]) return table[BASE[code] - 32];
    if (code === 0x80) return 556;
    return 556;
  }

  function widthPt(s, size, bold) {
    var t = toWinAnsi(s), w = 0, i;
    for (i = 0; i < t.length; i++) w += widthOf(t.charCodeAt(i), bold);
    return w * size / 1000;
  }

  function n(v) {
    var s = (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
    return s === "" || s === "-0" ? "0" : s;
  }

  function rgb(c) { return n(c[0]) + " " + n(c[1]) + " " + n(c[2]); }

  function pdfStr(s) {
    var t = toWinAnsi(s);
    var out = "", i, c, ch;
    for (i = 0; i < t.length; i++) {
      c = t.charCodeAt(i);
      ch = t.charAt(i);
      if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
      else if (c < 32 || c > 126) out += "\\" + ("00" + c.toString(8)).slice(-3);
      else out += ch;
    }
    return "(" + out + ")";
  }

  function latin1(s) {
    var out = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
    return out;
  }

  function jpegInfo(b) {
    var i = 2, m, len, h, w, comp;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      m = b[i + 1];
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        h = (b[i + 5] << 8) | b[i + 6];
        w = (b[i + 7] << 8) | b[i + 8];
        comp = b[i + 9];
        return { w: w, h: h, comp: comp };
      }
      i += 2 + len;
    }
    return { w: 0, h: 0, comp: 3 };
  }

  /* ---------------------------------------------------------------- writer */
  function Writer() { this.objs = []; }

  Writer.prototype.alloc = function () { this.objs.push({ body: "" }); return this.objs.length; };
  Writer.prototype.set = function (num, body) { this.objs[num - 1] = { body: body }; };
  Writer.prototype.stream = function (num, dict, bytes) { this.objs[num - 1] = { dict: dict, bytes: bytes }; };

  Writer.prototype.build = function () {
    var chunks = [], len = 0, self = this;
    function push(b) { chunks.push(b); len += b.length; }

    push(latin1("%PDF-1.4\n"));
    push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    var offsets = [], i, o, body;
    for (i = 0; i < self.objs.length; i++) {
      offsets[i] = len;
      o = self.objs[i];
      push(latin1((i + 1) + " 0 obj\n"));
      if (o.bytes) {
        body = o.dict.replace("{{LEN}}", String(o.bytes.length));
        push(latin1(body + "\nstream\n"));
        push(o.bytes);
        push(latin1("\nendstream\nendobj\n"));
      } else {
        push(latin1((o.body || "") + "\nendobj\n"));
      }
    }

    var xref = len;
    push(latin1("xref\n0 " + (self.objs.length + 1) + "\n0000000000 65535 f \n"));
    for (i = 0; i < offsets.length; i++) {
      push(latin1(("0000000000" + offsets[i]).slice(-10) + " 00000 n \n"));
    }
    push(latin1("trailer\n<< /Size " + (self.objs.length + 1) + " /Root 1 0 R /Info 5 0 R >>\nstartxref\n" + xref + "\n%%EOF\n"));

    var total = 0;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
    return new Blob([out], { type: "application/pdf" });
  };

  /* ---------------------------------------------------------------- layout */
  function Layout(opts) {
    this.pages = [];
    this.page = null;
    this.images = [];
    this.currentSection = "";
    this.reportId = (opts && opts.reportId) || "";
    this.rulesVersion = (opts && opts.rulesVersion) || "";
    this.factoryLine = (opts && opts.factoryLine) || "";
    this.newPage("");
  }

  Layout.prototype.newPage = function (section) {
    if (this.page) this.pages.push(this.page);
    if (section !== undefined) this.currentSection = section;
    this.page = { ops: [], section: this.currentSection };
    this.y = PH - M.t;
  };

  Layout.prototype.need = function (h) {
    if (this.y - h < M.b) this.newPage(this.currentSection);
  };

  Layout.prototype.op = function (s) { this.page.ops.push(s); };

  Layout.prototype.text = function (t, x, y, o) {
    o = o || {};
    if (t == null || t === "") return;
    var size = o.size || 9.5;
    var bold = !!o.bold;
    var color = o.color || TEXT;
    this.op("BT /" + (bold ? "F2" : "F1") + " " + n(size) + " Tf " + rgb(color) +
      " rg 1 0 0 1 " + n(x) + " " + n(y) + " Tm " + pdfStr(t) + " Tj ET\n");
  };

  Layout.prototype.textRight = function (t, xRight, y, o) {
    o = o || {};
    var w = widthPt(t, o.size || 9.5, !!o.bold);
    this.text(t, xRight - w, y, o);
  };

  Layout.prototype.textCenter = function (t, xLeft, w, y, o) {
    o = o || {};
    var tw = widthPt(t, o.size || 9.5, !!o.bold);
    this.text(t, xLeft + (w - tw) / 2, y, o);
  };

  Layout.prototype.rect = function (x, y, w, h, color) {
    this.op(rgb(color) + " rg " + n(x) + " " + n(y) + " " + n(w) + " " + n(h) + " re f\n");
  };

  Layout.prototype.line = function (x1, y1, x2, y2, width, color) {
    this.op(n(width || 0.5) + " w " + rgb(color || LINE) + " RG " +
      n(x1) + " " + n(y1) + " m " + n(x2) + " " + n(y2) + " l S\n");
  };

  Layout.prototype.wrap = function (t, maxW, size, bold) {
    var words = String(t == null ? "" : t).split(/\s+/).filter(function (w) { return w.length; });
    var lines = [], cur = "", i, w, test, cut;
    if (!words.length) return [""];
    for (i = 0; i < words.length; i++) {
      w = words[i];
      test = cur ? cur + " " + w : w;
      if (widthPt(test, size, bold) <= maxW) { cur = test; continue; }
      if (cur) { lines.push(cur); cur = ""; }
      while (widthPt(w, size, bold) > maxW && w.length > 1) {
        cut = w.length;
        while (cut > 1 && widthPt(w.slice(0, cut), size, bold) > maxW) cut--;
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      cur = w;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };

  Layout.prototype.para = function (t, o) {
    o = o || {};
    var size = o.size || 9.5;
    var lh = o.leading || size * 1.4;
    var maxW = o.maxW || CONTENT_W;
    var x = o.x == null ? M.l : o.x;
    var lines = this.wrap(t, maxW, size, !!o.bold);
    for (var i = 0; i < lines.length; i++) {
      this.need(lh);
      this.text(lines[i], x, this.y, o);
      this.y -= lh;
    }
  };

  Layout.prototype.h2 = function (no, title) {
    this.currentSection = (no ? no + "  " : "") + title;
    this.y -= 22;
    this.need(112);
    this.rect(M.l, this.y - 2, 3, 16, ACCENT);
    this.text((no ? no + "  " : "") + title, M.l + 10, this.y + 1, { size: 14, bold: true, color: ACCENT_D });
    this.y -= 14;
    this.line(M.l, this.y, PW - M.r, this.y, 0.6, LINE);
    this.y -= 12;
  };

  Layout.prototype.kv = function (label, value, o) {
    o = o || {};
    var lw = o.labelW || 132;
    var size = o.size || 9.5;
    var lines = this.wrap(value == null || value === "" ? "-" : value, CONTENT_W - lw - 12, size, false);
    var h = Math.max(1, lines.length) * 13 + 4;
    this.need(h);
    this.text(label, M.l, this.y - 9, { size: 8.5, color: MUTED });
    for (var i = 0; i < lines.length; i++) {
      this.text(lines[i], M.l + lw, this.y - 9 - i * 13, { size: size, color: TEXT });
    }
    this.y -= h;
  };

  Layout.prototype.badge = function (state, x, y, maxW) {
    var colors = {
      ok: [OK, OK_BG], partial: [WARN, WARN_BG],
      issue: [BAD, BAD_BG], na: [NA, NA_BG],
      pass: [OK, OK_BG], fail: [BAD, BAD_BG]
    };
    var key = colors[state] ? state : "";
    var c = colors[key] || [NA, NA_BG];
    var label = "-";
    var st = FRRules.states().filter(function (x) {
      return key && (x.key === key || (key === "pass" && x.key === "ok") || (key === "fail" && x.key === "issue"));
    })[0];
    if (st) label = st.label;
    var m = [label, c[0], c[1]];
    var tw = widthPt(m[0], 7.5, true) + 12;
    var bw = Math.min(maxW || 52, tw);
    this.rect(x, y, bw, 13, m[2]);
    this.textCenter(m[0], x, bw, y + 4, { size: 7.5, bold: true, color: m[1] });
  };

  Layout.prototype.checkTable = function (items) {
    var self = this;
    var cols = [24, 243, 64, 168];
    var x0 = M.l, lh = 11.5, pad = 6;

    function header() {
      self.need(24);
      var y = self.y - 10;
      self.text("#", x0 + 2, y, { size: 7.5, bold: true, color: MUTED });
      self.text("Item", x0 + cols[0] + 2, y, { size: 7.5, bold: true, color: MUTED });
      self.text("Finding", x0 + cols[0] + cols[1] + 2, y, { size: 7.5, bold: true, color: MUTED });
      self.text("Notes and evidence", x0 + cols[0] + cols[1] + cols[2] + 2, y, { size: 7.5, bold: true, color: MUTED });
      self.y -= 16;
      self.line(x0, self.y, PW - M.r, self.y, 0.5, LINE);
    }

    header();
    items.forEach(function (it) {
      var labelLines = self.wrap(it.label, cols[1] - 10, 9, false);
      var noteLines = it.note ? self.wrap(it.note, cols[3] - 10, 8, false) : [];
      var h = Math.max(labelLines.length * lh, noteLines.length * 10.5, lh) + pad * 2;
      if (self.y - h < M.b) { self.newPage(self.currentSection); header(); }
      var top = self.y;
      self.text(it.no, x0 + 2, top - pad - 7.5, { size: 8, bold: true, color: ACCENT });
      labelLines.forEach(function (ln, i) {
        self.text(ln, x0 + cols[0] + 2, top - pad - 7.5 - i * lh, { size: 9, color: TEXT });
      });
      self.badge(it.state, x0 + cols[0] + cols[1] + 2, top - pad - 12, 56);
      noteLines.forEach(function (ln, i) {
        self.text(ln, x0 + cols[0] + cols[1] + cols[2] + 2, top - pad - 7.5 - i * 10.5, { size: 8, color: MUTED });
      });
      self.line(x0, top - h, PW - M.r, top - h, 0.4, LINE);
      self.y = top - h;
    });
  };

  Layout.prototype.addImage = function (bytes, w, h) {
    var info = jpegInfo(bytes);
    var im = {
      name: "Im" + this.images.length,
      bytes: bytes,
      w: info.w || w || 1,
      h: info.h || h || 1,
      comp: info.comp || 3
    };
    this.images.push(im);
    return im;
  };

  Layout.prototype.drawImage = function (im, x, y, w, h) {
    this.op("q " + n(w) + " 0 0 " + n(h) + " " + n(x) + " " + n(y) + " cm /" + im.name + " Do Q\n");
  };

  /* --------------------------------------------------------------- finish */
  function headerOps(page, layout) {
    if (!page.section) return "";
    var y = PH - 38;
    var s = "";
    s += "BT /F1 8 Tf " + rgb(MUTED) + " rg 1 0 0 1 " + n(M.l) + " " + n(y) + " Tm " +
      pdfStr(layout.factoryLine.slice(0, 42)) + " Tj ET\n";
    var sec = String(page.section).replace(/^\d+\s+/, "").slice(0, 34);
    var sw = widthPt(sec, 8, false);
    s += "BT /F1 8 Tf " + rgb(MUTED) + " rg 1 0 0 1 " + n(PW - M.r - sw) + " " + n(y) + " Tm " +
      pdfStr(sec) + " Tj ET\n";
    s += n(0.6) + " w " + rgb(ACCENT) + " RG " + n(M.l) + " " + n(PH - 44) + " m " +
      n(PW - M.r) + " " + n(PH - 44) + " l S\n";
    return s;
  }

  function footerOps(page, index, total, layout) {
    var s = "";
    var y = 34;
    s += n(0.5) + " w " + rgb(LINE) + " RG " + n(M.l) + " 46 m " + n(PW - M.r) + " 46 l S\n";
    s += "BT /F1 7.5 Tf " + rgb(MUTED) + " rg 1 0 0 1 " + n(M.l) + " " + n(y) + " Tm " +
      pdfStr("Factory Visit Report - " + layout.reportId) + " Tj ET\n";
    var mid = "rules v" + layout.rulesVersion;
    var mw = widthPt(mid, 7.5, false);
    s += "BT /F1 7.5 Tf " + rgb(MUTED) + " rg 1 0 0 1 " + n((PW - mw) / 2) + " " + n(y) + " Tm " +
      pdfStr(mid) + " Tj ET\n";
    var p = "Page " + index + " of " + total;
    var pw = widthPt(p, 7.5, false);
    s += "BT /F1 7.5 Tf " + rgb(MUTED) + " rg 1 0 0 1 " + n(PW - M.r - pw) + " " + n(y) + " Tm " +
      pdfStr(p) + " Tj ET\n";
    return s;
  }

  Layout.prototype.buildPDF = function (info) {
    if (this.page) { this.pages.push(this.page); this.page = null; }
    var total = this.pages.length;
    var i;
    for (i = 0; i < this.pages.length; i++) {
      if (i === 0) continue;
      var head = headerOps(this.pages[i], this);
      var foot = footerOps(this.pages[i], i, total - 1, this);
      this.pages[i].ops = [head].concat(this.pages[i].ops, [foot]);
    }

    var w = new Writer();
    w.alloc();                      // 1 catalog
    w.alloc();                      // 2 pages
    w.alloc();                      // 3 F1
    w.alloc();                      // 4 F2
    w.alloc();                      // 5 info

    var imgNums = this.images.map(function () { return w.alloc(); });

    var pageRefs = [];
    this.pages.forEach(function (p) {
      var content = p.ops.join("");
      var cNum = w.alloc();
      w.stream(cNum, "<< /Length {{LEN}} >>", latin1(content));
      var pNum = w.alloc();
      pageRefs.push(pNum);
      w.set(pNum,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + n(PW) + " " + n(PH) + "]" +
        " /Resources << /Font << /F1 3 0 R /F2 4 0 R >>" + xobjDict(imgNums) + " >>" +
        " /Contents " + cNum + " 0 R >>");
    });

    w.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
    w.set(2, "<< /Type /Pages /Kids [" + pageRefs.map(function (x) { return x + " 0 R"; }).join(" ") +
      "] /Count " + pageRefs.length + " >>");
    w.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    w.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    w.set(5, "<< /Title " + pdfStr(info.title || "Factory Visit Report") +
      " /Author " + pdfStr(info.author || "") +
      " /Subject " + pdfStr(info.subject || "") +
      " /Producer " + pdfStr("FactoryReporter " + (info.appVersion || "1.0.0")) +
      " /CreationDate " + pdfStr(pdfDate(new Date())) + " >>");

    this.images.forEach(function (im, idx) {
      w.stream(imgNums[idx],
        "<< /Type /XObject /Subtype /Image /Width " + im.w + " /Height " + im.h +
        " /ColorSpace " + (im.comp === 1 ? "/DeviceGray" : "/DeviceRGB") +
        " /BitsPerComponent 8 /Filter /DCTDecode /Length {{LEN}} >>",
        im.bytes);
    });

    return { blob: w.build(), pages: pageRefs.length };
  };

  function xobjDict(nums) {
    if (!nums.length) return "";
    return " /XObject << " + nums.map(function (num, i) { return "/Im" + i + " " + num + " 0 R"; }).join(" ") + " >>";
  }

  function pdfDate(d) {
    function p(x) { return x < 10 ? "0" + x : "" + x; }
    var off = -d.getTimezoneOffset(), sign = off >= 0 ? "+" : "-";
    off = Math.abs(off);
    return "D:" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) +
      sign + p(Math.floor(off / 60)) + "'" + p(off % 60) + "'";
  }

  /* -------------------------------------------------------------- report */
  function optionLabel(field, value) {
    if (value == null || value === "") return "";
    var hit = (field.options || []).filter(function (o) { return String(o[0]) === String(value); })[0];
    return hit ? hit[1] : String(value).replace(/_/g, " ");
  }

  function chipLabels(field, arr) {
    if (!Array.isArray(arr) || !arr.length) return "";
    return arr.map(function (v) { return optionLabel(field, v); }).join(", ");
  }

  function fmtNumber(v) {
    if (v == null || v === "") return "";
    var n = Number(v);
    if (!isFinite(n)) return String(v);
    return n.toLocaleString("en-US");
  }

  function fieldValue(field, report) {
    var v = FRModel.getPath(report, field.store + "." + field.k);
    if (field.type === "select") return optionLabel(field, v);
    if (field.type === "chips") return chipLabels(field, v);
    if (field.type === "money") {
      if (v == null || v === "") return "";
      var cur = report.profile.annualOutputCurrency || "EUR";
      return cur + " " + fmtNumber(v);
    }
    if (field.type === "date") return FRUtil.fmtDate(v);
    if (field.type === "number") return fmtNumber(v);
    return v == null ? "" : String(v);
  }

  var SOFT_BG = [0.9529, 0.9569, 0.9843];

  function buildCover(L, report, opts, cover) {
    L.rect(0, PH - 8, PW, 8, ACCENT);

    L.text("FACTORY VISIT REPORT", M.l, PH - 92, { size: 10, bold: true, color: ACCENT });
    var name = report.profile.factoryName || "Untitled visit";
    var lines = L.wrap(name, CONTENT_W, 26, true);
    var y = PH - 124;
    lines.slice(0, 3).forEach(function (ln) {
      L.text(ln, M.l, y, { size: 26, bold: true, color: TEXT });
      y -= 32;
    });

    L.line(M.l, y - 2, PW - M.r, y - 2, 1, ACCENT);
    y -= 22;

    var visit = FRUtil.fmtDate(report.profile.visitDate);
    L.text(visit + "   |   " + (report.profile.cityProvince || ""), M.l, y, { size: 10, color: MUTED });
    y -= 26;

    L.text("Report ID  " + report.id, M.l, y, { size: 8, color: MUTED });
    y -= 34;

    /* key facts, two columns */
    var colW = (CONTENT_W - 24) / 2;
    var facts = [
      ["Location", report.profile.cityProvince],
      ["Contact", [report.profile.contactName, optionLabel({ options: roleOptions() }, report.profile.contactRole)].filter(Boolean).join(", ")],
      ["Employees", fmtNumber(report.facts.employees)],
      ["QC staff", fmtNumber(report.facts.qcStaff)],
      ["Factory area", report.facts.factoryAreaSqm ? fmtNumber(report.facts.factoryAreaSqm) + " m2" : ""],
      ["Monthly capacity", fmtNumber(report.facts.monthlyCapacity)],
      ["Main products", chipLabels(productField(), report.profile.mainProducts)],
      ["In-house processes", chipLabels(fieldByKey("inHouseProcesses") || { options: [] }, report.facts.inHouseProcesses)]
    ];
    var startY = y;
    facts.forEach(function (f, i) {
      var col = i % 2, row = Math.floor(i / 2);
      var x = M.l + col * (colW + 24);
      var yy = startY - row * 36;
      L.text(String(f[0]).toUpperCase(), x, yy, { size: 7, bold: true, color: MUTED });
      var vlines = L.wrap(f[1] || "-", colW, 9, false);
      L.text(vlines[0] || "-", x, yy - 13, { size: 9, color: TEXT });
    });
    y = startY - 4 * 36;

    /* summary, so HQ reads the conclusion on page one */
    var summary = String(report.conclusion && report.conclusion.comments || "").trim();
    var boxW = CONTENT_W;
    var floor = cover ? 300 : 120;
    var allLines = summary ? L.wrap(summary, boxW - 32, 9, false) : [];
    var maxLines = cover ? 6 : 9;
    var sLines = allLines.slice(0, maxLines);
    if (allLines.length > maxLines && sLines.length) {
      sLines[sLines.length - 1] = sLines[sLines.length - 1].replace(/[\s,;.]+$/, "") + " ...";
    }
    var boxH = 30 + Math.max(1, sLines.length) * 12.5 + 10;
    if (y - boxH < floor) boxH = Math.max(58, y - floor);
    var boxY = y - boxH;
    L.rect(M.l, boxY, boxW, boxH, SOFT_BG);
    L.rect(M.l, boxY, 3, boxH, ACCENT);
    L.text("SUMMARY", M.l + 16, boxY + boxH - 16, { size: 7.5, bold: true, color: ACCENT });
    if (sLines.length) {
      sLines.forEach(function (ln, i) {
        L.text(ln, M.l + 16, boxY + boxH - 32 - i * 12.5, { size: 9, color: TEXT });
      });
    } else {
      L.text("No summary written for this visit.", M.l + 16, boxY + boxH - 34, { size: 9, color: MUTED });
    }

    /* contents - fills the cover and helps HQ navigate */
    var cy = boxY - 34;
    var secs = FRRules.visibleSections();
    var contentsDrawn = false;
    if (cy - secs.length * 15 > (cover ? 268 : 118)) {
      contentsDrawn = true;
      L.text("CONTENTS", M.l, cy, { size: 7.5, bold: true, color: MUTED });
      cy -= 17;
      secs.forEach(function (sec) {
        L.text(sec.no, M.l, cy, { size: 8.5, bold: true, color: ACCENT });
        L.text(sec.title, M.l + 20, cy, { size: 9, color: TEXT });
        var n = (sec.items || []).length;
        L.textRight(n ? n + " items" : "details", PW - M.r, cy, { size: 8, color: MUTED });
        cy -= 15;
      });
    }

    /* the gate / main-building shot that identifies the factory */
    if (cover) {
      var im = L.addImage(cover.bytes, cover.w, cover.h);
      var sc = Math.min(250 / im.w, 132 / im.h);
      var dw = im.w * sc, dh = im.h * sc;
      var px = PW - M.r - dw;
      /* without a contents list the photo moves up under the summary */
      var py = contentsDrawn ? 116 : Math.max(116, boxY - 30 - dh);
      L.text("Cover photo - " + photoKindLabel(cover.kind), px, py + dh + 9, { size: 7, color: MUTED });
      L.op(n(0.5) + " w " + rgb(LINE) + " RG " + n(px) + " " + n(py) + " " + n(dw) + " " + n(dh) + " re S\n");
      L.drawImage(im, px, py, dw, dh);
    }

    /* bottom line */
    var author = (opts && opts.author) || report.meta.author || "";
    L.line(M.l, 96, PW - M.r, 96, 0.6, LINE);
    L.text("Prepared by " + (author || "-"), M.l, 78, { size: 9, bold: true, color: TEXT });
    L.text("Confidential - internal use", M.l, 63, { size: 8, color: MUTED });
    var pc = (report.photos || []).length;
    var right = visit + (pc ? "   |   " + pc + (pc === 1 ? " photo" : " photos") : "");
    L.textRight(right, PW - M.r, 78, { size: 8, color: MUTED });
  }

  var _rules = null;

  function roleOptions() {
    var f = fieldByKey("contactRole");
    return f ? f.options : [];
  }
  function productField() {
    return fieldByKey("mainProducts") || { options: [] };
  }
  /* Merged field definition: user-edited label, placeholder and options. */
  function fieldByKey(k) {
    return FRRules.field(k);
  }

  /* Returns how many fields actually carried something, so an all-empty
     section can say so instead of printing a bare heading. */
  function buildSectionFields(L, secId) {
    var sec = FRRules.section(secId);
    if (!sec) return 0;
    var all = (sec.fields || []).concat(sec.tailFields || []);
    /* a lone free-text field is labelled by the section heading itself */
    var many = all.length > 1;
    var drawn = 0;

    all.forEach(function (f) {
      if (f.type === "photos") {
        if (drawPhotosField(L, f)) drawn += 1;
        return;
      }
      var v = fieldValue(f, L._report);
      if (v === "" && !f.required) return;
      drawn += 1;
      if (f.type === "textarea") {
        var lines = L.wrap(String(v), CONTENT_W, 9.5, false);
        L.need((many ? 15 : 0) + 9 + lines.length * 13 + 4);
        if (many) {
          L.text(f.label, M.l, L.y - 9, { size: 8.5, color: MUTED });
          L.y -= 15;
        }
        L.y -= 9;                       /* kv rows sit on a y - 9 baseline */
        L.para(String(v), { size: 9.5, color: TEXT, leading: 13 });
        L.y -= 4;
      } else {
        L.kv(f.label, v);
      }
    });
    return drawn;
  }

  /* Photo slots on the report itself (the contact's business card). The
     images are pre-loaded before layout so this stays synchronous. */
  function drawPhotosField(L, f) {
    var ids = FRModel.getPath(L._report, f.store + "." + f.k);
    if (!Array.isArray(ids) || !ids.length) return false;
    var imgs = ids.map(function (id) { return (L._images || {})[id]; }).filter(Boolean);
    if (!imgs.length) return false;

    L.need(34);
    L.text(f.label, M.l, L.y - 9, { size: 8.5, color: MUTED });
    L.y -= 17;

    var gap = 10, cols = 2, cellW = (CONTENT_W - gap) / cols, maxH = 150;
    var i, k;
    for (i = 0; i < imgs.length; i += cols) {
      var row = imgs.slice(i, i + cols);
      var dims = [], h = 0;
      for (k = 0; k < row.length; k++) {
        var sc = Math.min(cellW / row[k].w, maxH / row[k].h);
        var d = { im: row[k], w: row[k].w * sc, h: row[k].h * sc };
        h = Math.max(h, d.h);
        dims.push(d);
      }
      L.need(h + 12);
      for (k = 0; k < dims.length; k++) {
        var x = M.l + k * (cellW + gap);
        var y = L.y - h;
        L.op(n(0.5) + " w " + rgb(LINE) + " RG " + n(x) + " " + n(y) + " " +
          n(cellW) + " " + n(h) + " re S\n");
        L.drawImage(L.addImage(dims[k].im.bytes, dims[k].im.w, dims[k].im.h),
          x + (cellW - dims[k].w) / 2, y + (h - dims[k].h) / 2, dims[k].w, dims[k].h);
      }
      L.y -= h + 10;
    }
    return true;
  }

  async function loadFieldPhotos(L, report) {
    L._images = {};
    var wanted = [];
    FRRules.sections().forEach(function (sec) {
      (sec.fields || []).concat(sec.tailFields || []).forEach(function (f) {
        if (f.type !== "photos") return;
        var ids = FRModel.getPath(report, f.store + "." + f.k);
        if (Array.isArray(ids)) ids.forEach(function (id) { wanted.push(id); });
      });
    });
    for (var i = 0; i < wanted.length; i++) {
      var ph = await FRDB.get("photos", wanted[i]);
      if (!ph || !ph.blob) continue;
      var buf = await ph.blob.arrayBuffer();
      L._images[wanted[i]] = { bytes: new Uint8Array(buf), w: ph.w, h: ph.h };
    }
  }

  function answerOf(report, itemId) {
    var a = (report.answers || {})[itemId] || {};
    return { state: a.state || "", note: a.note || "" };
  }

  function sectionItems(report, secId) {
    return FRRules.sectionItems(secId).map(function (it) {
      var a = answerOf(report, it.id);
      return { no: it.no, label: it.label, state: a.state, note: a.note };
    });
  }

  function photoKindLabel(kind) {
    return FRRules.kindLabel(kind);
  }

  function itemLabelOf(itemId) {
    var it = FRRules.item(itemId);
    return it ? it.no + " " + it.label : "";
  }

  function authorName(report, opts) {
    return (opts && opts.author) || report.meta.author || "";
  }

  async function build(report, opts) {
    opts = opts || {};
    _rules = FRRules.data();
    if (!_rules) throw new Error("Checklist not loaded");

    var L = new Layout({
      reportId: report.id,
      rulesVersion: _rules.version,
      factoryLine: report.profile.factoryName || ""
    });
    L._report = report;

    /* ---- cover, with the gate photo when the visit has one */
    var cover = null;
    var coverId = FRModel.coverId(report);
    if (coverId) {
      var ph = await FRDB.get("photos", coverId);
      if (ph && ph.blob) {
        var buf = await ph.blob.arrayBuffer();
        cover = { bytes: new Uint8Array(buf), w: ph.w, h: ph.h, kind: ph.kind };
      }
    }
    buildCover(L, report, opts, cover);

    /* images referenced by fields (business cards) before anything is laid out */
    await loadFieldPhotos(L, report);

    /* ---- 1..7, data driven so an edited checklist flows straight through.
       Sections with no field and no item are skipped, exactly as in the form. */
    var first = true;
    FRRules.visibleSections().forEach(function (sec) {
      if (first) { L.newPage(sec.no + "  " + sec.title); first = false; }
      L.h2(sec.no, sec.title);
      var drawn = buildSectionFields(L, sec.id);
      var items = sectionItems(report, sec.id);
      if (items.length) {
        L.y -= 4;
        L.checkTable(items);
      }
      if (sec.id === "comments") {
        if (!String(report.conclusion.comments || "").trim()) {
          L.para("No summary written for this visit.", { size: 9, color: MUTED });
        }
      } else if (!drawn && !items.length) {
        /* the heading is worth keeping - HQ can see the section was visited
           and left blank, rather than wondering whether it exists */
        L.para("Nothing recorded in this section.", { size: 9, color: MUTED });
      }
    });

    buildSignature(L, report, opts);

    /* ---- appendix A photos */
    await buildPhotos(L, report);

    var result = L.buildPDF({
      title: "Factory Visit Report - " + (report.profile.factoryName || report.id),
      author: authorName(report, opts),
      subject: (report.profile.cityProvince || "") + " - " + (report.profile.visitDate || ""),
      appVersion: FRModel.APP_VERSION
    });
    return {
      blob: result.blob,
      pages: result.pages,
      fileName: FRModel.pdfName(report)
    };
  }

  function buildSignature(L, report, opts) {
    L.need(96);
    L.y -= 34;
    L.line(M.l, L.y, M.l + 180, L.y, 0.6, LINE);
    L.line(PW - M.r - 150, L.y, PW - M.r, L.y, 0.6, LINE);
    L.text("Prepared by", M.l, L.y - 12, { size: 8, color: MUTED });
    L.text("Date", PW - M.r - 150, L.y - 12, { size: 8, color: MUTED });
    L.y -= 26;
    L.text(authorName(report, opts) || "-", M.l, L.y, { size: 9, color: TEXT });
    L.text(FRUtil.fmtDate(report.profile.visitDate), PW - M.r - 150, L.y, { size: 9, color: TEXT });
  }

  async function buildPhotos(L, report) {
    /* business cards are printed in the factory profile, not a second time here */
    var metas = (report.photos || []).filter(function (p) {
      return p && p.id && p.kind !== "business_card";
    });
    if (!metas.length) return;

    L.newPage("Appendix A  Photo record");
    L.h2("A", "Photo record");

    var single = metas.length === 1;
    var cols = single ? 1 : 2, gap = 10;
    var cellW = single ? CONTENT_W : (CONTENT_W - gap) / cols;
    var imgH = single ? 320 : 128, capH = 24, cellH = imgH + capH + 12;
    var x0 = M.l;
    var i = 0;

    for (i = 0; i < metas.length; i++) {
      var meta = metas[i];
      var col = i % cols;
      if (col === 0 && L.y - cellH < M.b) {
        L.newPage("Appendix A  Photo record");
        L.h2("A", "Photo record");
      }

      var rowTop = L.y;
      var x = x0 + col * (cellW + gap);

      var ph = await FRDB.get("photos", meta.id);
      if (ph && ph.blob) {
        var buf = await ph.blob.arrayBuffer();
        var bytes = new Uint8Array(buf);
        var im = L.addImage(bytes, meta.w, meta.h);
        var scale = Math.min(cellW / im.w, imgH / im.h);
        var dw = im.w * scale, dh = im.h * scale;
        L.drawImage(im, x + (cellW - dw) / 2, rowTop - dh, dw, dh);
        L.op(n(0.5) + " w " + rgb(LINE) + " RG " + n(x) + " " + n(rowTop - imgH) + " " +
          n(cellW) + " " + n(imgH) + " re S\n");
      } else {
        L.rect(x, rowTop - imgH, cellW, imgH, NA_BG);
        L.text("photo unavailable", x + 8, rowTop - imgH / 2, { size: 8, color: MUTED });
      }

      var cap = photoKindLabel(meta.kind) + (meta.itemId ? " - " + itemLabelOf(meta.itemId) : "");
      var capLines = L.wrap(cap, cellW, 7.5, false);
      L.text(capLines[0] || "", x, rowTop - imgH - 11, { size: 7.5, bold: true, color: TEXT });
      if (capLines[1]) L.text(capLines[1], x, rowTop - imgH - 20, { size: 7.5, color: MUTED });

      if (col === cols - 1 || i === metas.length - 1) {
        L.y = rowTop - cellH;
      }
    }
  }

  function fileName(report) { return FRModel.pdfName(report); }

  return { build: build, fileName: fileName, _width: widthPt, _encode: toWinAnsi };
})();
