/* Checklist-driven form: fact fields, record items, summary comments.
   No scoring - every item is simply recorded as OK / Partly / Issue / N/A. */
window.FRForm = (function () {
  "use strict";

  var rep = null, root = null, onChange = null;

  function render(report, mount, opts) {
    rep = report;
    root = mount;
    onChange = (opts && opts.onChange) || function () {};
    root.innerHTML = FRRules.sections().map(renderSection).join("");
    bind();
    refreshProgress();
    FRRules.itemIds().forEach(hydrateItemPhotos);
  }

  function renderSection(sec) {
    var body = "";
    body += (sec.fields || []).map(renderField).join("");
    body += (sec.items || []).map(renderItem).join("");
    body += (sec.tailFields || []).map(renderField).join("");
    var sec_ = sec.items && sec.items.length
      ? '<span class="sec-prog" data-prog="' + sec.id + '"></span>' : "";
    return '<section class="sec" data-sec="' + sec.id + '">' +
      '<div class="sec-head">' +
        '<span class="sec-no">' + FRUtil.esc(sec.no) + '</span>' +
        '<span class="sec-title">' + FRUtil.esc(sec.title) + '</span>' +
        sec_ +
      '</div>' +
      '<div class="sec-body">' + body + '</div>' +
    '</section>';
  }

  function fieldLabel(f) {
    return '<span>' + FRUtil.esc(f.label) + (f.required ? '<b class="req">*</b>' : '') + '</span>';
  }

  function renderField(f) {
    var v = FRModel.getPath(rep, f.store + "." + f.k);
    var val = v == null ? "" : v;
    var ph = f.placeholder ? ' placeholder="' + FRUtil.esc(f.placeholder) + '"' : "";
    var req = f.required ? " required" : "";
    var common = 'class="input" data-field="' + f.k + '"' + ph + req;

    if (f.type === "select") {
      var opts = '<option value="">-</option>' + (f.options || []).map(function (o) {
        return '<option value="' + FRUtil.esc(o[0]) + '"' + (String(val) === String(o[0]) ? " selected" : "") + '>' +
          FRUtil.esc(o[1]) + '</option>';
      }).join("");
      return '<label class="field">' + fieldLabel(f) +
        '<select ' + common + '>' + opts + '</select></label>';
    }

    if (f.type === "chips") {
      var arr = Array.isArray(val) ? val : [];
      var chips = (f.options || []).map(function (o) {
        var on = arr.indexOf(o[0]) !== -1;
        return '<button class="chip" type="button" data-chip="' + FRUtil.esc(o[0]) + '" data-chip-field="' + f.k +
          '" aria-pressed="' + (on ? "true" : "false") + '">' + FRUtil.esc(o[1]) + '</button>';
      }).join("");
      return '<div class="field" data-chips="' + f.k + '">' + fieldLabel(f) +
        '<div class="chips">' + chips + '</div></div>';
    }

    if (f.type === "money") {
      var cur = FRModel.getPath(rep, f.store + ".annualOutputCurrency") || "EUR";
      var curOpts = (f.currencies || ["EUR"]).map(function (c) {
        return '<option value="' + c + '"' + (cur === c ? " selected" : "") + '>' + c + '</option>';
      }).join("");
      return '<div class="field">' + fieldLabel(f) +
        '<div style="display:flex;gap:8px">' +
          '<input class="input" type="number" min="0" step="any" inputmode="decimal" data-field="' + f.k +
            '" value="' + FRUtil.esc(val) + '"' + ph + '>' +
          '<select class="input compact" style="width:96px" data-currency="1">' + curOpts + '</select>' +
        '</div></div>';
    }

    if (f.type === "textarea") {
      return '<label class="field">' + fieldLabel(f) +
        '<textarea class="input" data-field="' + f.k + '"' + ph +
        (f.rows ? ' rows="' + f.rows + '"' : '') + '>' + FRUtil.esc(val) + '</textarea></label>';
    }

    var type = f.type === "number" ? "number" : (f.type || "text");
    var mode = f.type === "number" ? ' inputmode="decimal"' : (f.type === "tel" ? ' inputmode="tel"' : "");
    return '<label class="field">' + fieldLabel(f) +
      '<input ' + common + ' type="' + type + '"' + mode +
      ' value="' + FRUtil.esc(val) + '"></label>';
  }

  function renderItem(it) {
    var a = rep.answers[it.id] || { state: "", note: "", photoIds: [] };
    var states = FRRules.states();
    var chips = states.map(function (s) {
      return '<button class="state-chip" type="button" data-state="' + s.key + '" data-check-state="' + it.id +
        '" aria-pressed="' + (a.state === s.key ? "true" : "false") + '">' + FRUtil.esc(s.label) + '</button>';
    }).join("");

    var hasDetail = (a.note && a.note.length) || (a.photoIds && a.photoIds.length);

    return '<div class="check" data-check="' + it.id + '">' +
      '<div class="check-head"><span class="check-no">' + FRUtil.esc(it.no) + '</span>' +
        '<span class="check-label">' + FRUtil.esc(it.label) + '</span></div>' +
      (it.hint ? '<div class="check-hint">' + FRUtil.esc(it.hint) + '</div>' : "") +
      '<div class="state-chips">' + chips + '</div>' +
      '<div class="check-foot">' +
        '<button class="link-btn" type="button" data-toggle-detail="' + it.id + '">' +
          (hasDetail ? "Note and evidence" : "Add note / photo") + '</button>' +
        (it.evidence ? '<span class="evidence-note">' + FRUtil.esc(it.evidence) + '</span>' : "") +
      '</div>' +
      '<div class="check-detail" data-detail="' + it.id + '"' + (hasDetail ? "" : " hidden") + '>' +
        '<textarea class="input" data-note="' + it.id + '" placeholder="What you saw: report number, date, measurement (English goes into the PDF)">' +
          FRUtil.esc(a.note || "") + '</textarea>' +
        '<div class="evidence" data-evidence="' + it.id + '"></div>' +
        '<button class="link-btn" type="button" data-add-photo="' + it.id + '">+ Photo for this item</button>' +
      '</div>' +
    '</div>';
  }

  function bind() {
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChangeEvent);
    root.addEventListener("click", onClick);
  }

  function fieldDef(k) {
    var out = null;
    FRRules.sections().forEach(function (s) {
      (s.fields || []).concat(s.tailFields || []).forEach(function (f) { if (f.k === k) out = f; });
    });
    return out;
  }

  function onInput(e) {
    var t = e.target;
    if (t.dataset && t.dataset.note) {
      var a = FRModel.answer(rep, t.dataset.note);
      a.note = t.value;
      onChange();
      return;
    }
    if (!t.dataset || !t.dataset.field) return;
    var f = fieldDef(t.dataset.field);
    if (!f) return;
    var v;
    if (f.type === "number" || f.type === "money") v = FRUtil.num(t.value);
    else v = t.value;
    FRModel.setPath(rep, f.store + "." + f.k, v);
    onChange();
  }

  function onChangeEvent(e) {
    var t = e.target;
    if (t.dataset && t.dataset.currency) {
      FRModel.setPath(rep, "profile.annualOutputCurrency", t.value);
      onChange();
      return;
    }
    if (t.dataset && t.dataset.field) {
      var f = fieldDef(t.dataset.field);
      if (!f) return;
      var v = f.type === "number" || f.type === "money" ? FRUtil.num(t.value) : t.value;
      FRModel.setPath(rep, f.store + "." + f.k, v);
      onChange();
    }
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t) return;

    if (t.dataset.state) {
      setState(t.dataset.checkState, t.dataset.state);
      return;
    }

    if (t.dataset.chip) {
      var k = t.dataset.chipField, f = fieldDef(k);
      if (!f) return;
      var arr = FRModel.getPath(rep, f.store + "." + k);
      if (!Array.isArray(arr)) arr = [];
      var i = arr.indexOf(t.dataset.chip);
      if (i === -1) arr.push(t.dataset.chip); else arr.splice(i, 1);
      FRModel.setPath(rep, f.store + "." + k, arr);
      t.setAttribute("aria-pressed", i === -1 ? "true" : "false");
      onChange();
      return;
    }

    if (t.dataset.toggleDetail) {
      var d = root.querySelector('[data-detail="' + t.dataset.toggleDetail + '"]');
      if (d) d.hidden = !d.hidden;
      return;
    }

    if (t.dataset.addPhoto) {
      pickPhotos(t.dataset.addPhoto);
      return;
    }

    if (t.dataset.delPhoto) {
      var pid = t.dataset.delPhoto;
      var cid = t.dataset.delPhotoFrom;
      FRPhotos.remove(rep, pid).then(function () {
        var holder = root.querySelector('[data-evidence="' + cid + '"]');
        if (holder) holder.innerHTML = "";
        hydrateItemPhotos(cid);
        onChange();
      });
      return;
    }
  }

  function setState(itemId, state) {
    var a = FRModel.answer(rep, itemId);
    a.state = a.state === state ? "" : state;
    var node = root.querySelector('[data-check="' + itemId + '"]');
    if (node) {
      var wrap = document.createElement("div");
      wrap.innerHTML = renderItem(FRRules.item(itemId));
      if (wrap.firstElementChild) node.replaceWith(wrap.firstElementChild);
    }
    hydrateItemPhotos(itemId);
    refreshProgress();
    onChange();
  }

  function pickPhotos(itemId) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = function () {
      if (!input.files || !input.files.length) return;
      FRUtil.toast("Compressing " + input.files.length + " photo(s)...");
      FRPhotos.addFiles(rep, input.files, { itemId: itemId, kind: "certificate" }).then(function () {
        var d = root.querySelector('[data-detail="' + itemId + '"]');
        if (d) d.hidden = false;
        hydrateItemPhotos(itemId);
        refreshProgress();
        onChange();
        FRUtil.toast("Photo added");
      }).catch(function (err) { FRUtil.toast(err.message || "Photo failed", true); });
    };
    input.click();
  }

  function hydrateItemPhotos(itemId) {
    var holder = root && root.querySelector('[data-evidence="' + itemId + '"]');
    if (!holder) return;
    var a = rep.answers[itemId] || { photoIds: [] };
    var ids = a.photoIds || [];
    holder.innerHTML = ids.map(function (id) {
      return '<span class="ev-wrap"><img class="evidence-thumb" data-thumb="' + id + '" alt="">' +
        '<button class="ev-del" type="button" data-del-photo="' + id + '" data-del-photo-from="' + itemId + '" aria-label="Remove">&#215;</button></span>';
    }).join("");
    ids.forEach(function (id) {
      FRPhotos.thumbUrl(id).then(function (url) {
        var img = holder.querySelector('[data-thumb="' + id + '"]');
        if (img && url) img.src = url;
      });
    });
  }

  /* Completion, not a score: how many items carry a record. */
  function refreshProgress() {
    var total = FRModel.totalItems();
    var done = FRModel.recordedCount(rep);

    var val = document.getElementById("progVal");
    var meta = document.getElementById("progMeta");
    var tier = document.getElementById("progTier");
    var cov = document.getElementById("progCov");
    if (val) val.textContent = String(done);
    if (tier) tier.textContent = "of " + total + " recorded";
    if (meta) meta.textContent = done === total && total ? "All items recorded" : (total - done) + " left";
    if (cov) cov.style.width = (total ? Math.round(done / total * 100) : 0) + "%";

    FRRules.sections().forEach(function (sec) {
      var el = root && root.querySelector('[data-prog="' + sec.id + '"]');
      if (!el) return;
      var items = sec.items || [];
      var n = items.filter(function (it) {
        var a = rep.answers[it.id];
        return a && a.state;
      }).length;
      el.textContent = n + "/" + items.length;
    });
  }

  return { render: render, refreshProgress: refreshProgress, hydrateItemPhotos: hydrateItemPhotos };
})();
