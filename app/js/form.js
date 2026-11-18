/* Checklist-driven form: fact fields, record items, summary comments.
   No scoring - every item is simply recorded as OK / Partly / Issue / N/A. */
window.FRForm = (function () {
  "use strict";

  var rep = null, root = null, onChange = null;

  function render(report, mount, opts) {
    rep = report;
    root = mount;
    onChange = (opts && opts.onChange) || function () {};
    root.innerHTML = FRRules.visibleSections().map(renderSection).join("");
    bind();
    refreshProgress();
    FRRules.itemIds().forEach(hydrateItemPhotos);
    hydrateShotFields();
  }

  /* A section with neither a field nor an item is not shown at all: the
     default template ships without checklist items, and empty headings in
     the middle of a visit are just noise. */
  function renderSection(sec) {
    if (sec.empty) return "";
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

  function chipHtml(key, value, label, arr, custom) {
    var on = arr.indexOf(value) !== -1;
    return '<button class="chip' + (custom ? " chip-cust" : "") + '" type="button" data-chip="' +
      FRUtil.esc(value) + '" data-chip-field="' + key + '" aria-pressed="' + (on ? "true" : "false") + '">' +
      FRUtil.esc(label) + '</button>';
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
      var opts = f.options || [];
      var known = {};
      opts.forEach(function (o) { known[String(o[0])] = 1; });
      var chips = opts.map(function (o) { return chipHtml(f.k, o[0], o[1], arr); }).join("");
      /* values typed during this visit that are not in the template list */
      arr.filter(function (v) { return !known[String(v)]; }).forEach(function (v) {
        chips += chipHtml(f.k, v, v, arr, true);
      });
      var add = f.allowCustom
        ? '<button class="chip chip-add" type="button" data-chip-new="' + f.k + '">+ Other</button>'
        : "";
      var entry = f.allowCustom
        ? '<div class="chip-entry" data-chip-entry="' + f.k + '" hidden>' +
            '<input class="input" type="text" data-chip-text="' + f.k +
              '" placeholder="Type it, then press Add" autocomplete="off" enterkeyhint="done">' +
            '<button class="btn" type="button" data-chip-save="' + f.k + '">Add</button>' +
          '</div>'
        : "";
      return '<div class="field" data-chips="' + f.k + '">' + fieldLabel(f) +
        '<div class="chips">' + chips + add + '</div>' + entry + '</div>';
    }

    /* A photo slot that is not tied to a checklist item: business cards. */
    if (f.type === "photos") {
      return '<div class="field" data-shot-field="' + f.k + '">' + fieldLabel(f) +
        (f.hint ? '<p class="field-hint">' + FRUtil.esc(f.hint) + '</p>' : "") +
        '<div class="shot-strip" data-shot-strip="' + f.k + '"></div>' +
        '<button class="btn" type="button" data-add-shot="' + f.k + '">+ Add photo</button>' +
        '</div>';
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
    root.addEventListener("keydown", onKeyDown);
  }

  /* Enter inside the "type your own" box commits it, as on a desktop form. */
  function onKeyDown(e) {
    if (e.key !== "Enter") return;
    var t = e.target;
    if (!t.dataset || !t.dataset.chipText) return;
    e.preventDefault();
    addCustomChip(t.dataset.chipText);
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

    if (t.dataset.chipNew) {
      var box = root.querySelector('[data-chip-entry="' + t.dataset.chipNew + '"]');
      if (box) {
        box.hidden = !box.hidden;
        if (!box.hidden) {
          var inp = box.querySelector("input");
          if (inp) { inp.value = ""; inp.focus(); }
        }
      }
      return;
    }

    if (t.dataset.chipSave) {
      addCustomChip(t.dataset.chipSave);
      return;
    }

    if (t.dataset.toggleDetail) {
      var d = root.querySelector('[data-detail="' + t.dataset.toggleDetail + '"]');
      if (d) d.hidden = !d.hidden;
      return;
    }

    if (t.dataset.addPhoto) {
      pickPhotos({ itemId: t.dataset.addPhoto, kind: "certificate" });
      return;
    }

    if (t.dataset.addShot) {
      pickPhotos({ key: t.dataset.addShot });
      return;
    }

    if (t.dataset.delShot) {
      removeShot(t.dataset.delShot, t.dataset.delShotFrom);
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

  /* Photos land in the report, then the id is linked to whichever slot asked
     for them: a checklist item or a plain photo field such as the card. */
  function pickPhotos(opts) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = function () {
      if (!input.files || !input.files.length) return;
      addPhotoFiles(input.files, opts);
    };
    input.click();
  }

  /* The step after the file picker: also the entry point automated tests and
     the "share to" path use, since a real file dialog cannot be scripted. */
  function addPhotoFiles(files, opts) {
    opts = opts || {};
    var key = opts.key;
    var f = key ? fieldDef(key) : null;
    if (!files || !files.length) return Promise.resolve([]);
    FRUtil.toast("Compressing " + files.length + " photo(s)...");
    return FRPhotos.addFiles(rep, files, {
      itemId: opts.itemId || null,
      kind: opts.kind || (f && f.photoKind) || "other"
    }).then(function (added) {
      if (f && added.length) {
        var arr = shotFieldIds(f).slice();
        added.forEach(function (p) { if (arr.indexOf(p.id) === -1) arr.push(p.id); });
        FRModel.setPath(rep, f.store + "." + f.k, arr);
        hydrateShotField(key, f);
      }
      if (opts.itemId) {
        var d = root.querySelector('[data-detail="' + opts.itemId + '"]');
        if (d) d.hidden = false;
        hydrateItemPhotos(opts.itemId);
      }
      refreshProgress();
      onChange();
      FRUtil.toast("Photo added");
      return added;
    }).catch(function (err) {
      FRUtil.toast(err.message || "Photo failed", true);
      return [];
    });
  }

  /* A "photos" field is an array of photo ids on the report - used for the
     contact's business card, so it prints in the profile and not only in the
     appendix. */
  function shotFieldIds(f) {
    var v = FRModel.getPath(rep, f.store + "." + f.k);
    return Array.isArray(v) ? v : [];
  }

  function hydrateShotFields() {
    FRRules.sections().forEach(function (sec) {
      (sec.fields || []).concat(sec.tailFields || []).forEach(function (f) {
        if (f.type === "photos") hydrateShotField(f.k, f);
      });
    });
  }

  function hydrateShotField(key, f) {
    var holder = root && root.querySelector('[data-shot-strip="' + key + '"]');
    if (!holder || !f) return;
    var ids = shotFieldIds(f);
    if (!ids.length) {
      holder.innerHTML = '<span class="shot-empty">No photo yet</span>';
      return;
    }
    holder.innerHTML = ids.map(function (id) {
      return '<span class="shot-wrap"><img class="shot-thumb" data-shot-img="' + id + '" alt="">' +
        '<button class="shot-del" type="button" data-del-shot="' + id +
          '" data-del-shot-from="' + key + '" aria-label="Remove photo">&#215;</button></span>';
    }).join("");
    ids.forEach(function (id) {
      FRPhotos.thumbUrl(id).then(function (url) {
        var img = holder.querySelector('[data-shot-img="' + id + '"]');
        if (img && url) img.src = url;
      });
    });
  }

  function removeShot(photoId, key) {
    var f = fieldDef(key);
    if (!f) return;
    var ids = shotFieldIds(f).filter(function (id) { return id !== photoId; });
    FRModel.setPath(rep, f.store + "." + f.k, ids);
    FRPhotos.remove(rep, photoId).then(function () {
      hydrateShotField(key, f);
      refreshProgress();
      onChange();
    });
  }

  /* "Main products" is a template list, but factories make things nobody put
     on it. Anything typed here is stored on the visit only, so the template
     of the next visit stays clean. */
  function addCustomChip(key) {
    var f = fieldDef(key);
    if (!f) return;
    var box = root.querySelector('[data-chip-entry="' + key + '"]');
    var input = box && box.querySelector("input");
    var text = String((input && input.value) || "").trim().replace(/\s+/g, " ");
    if (!text) { if (input) input.focus(); return; }

    /* an option with the same wording wins, so no twins are created */
    var hit = (f.options || []).filter(function (o) {
      return String(o[1]).toLowerCase() === text.toLowerCase();
    })[0];
    var value = hit ? hit[0] : text;

    var arr = FRModel.getPath(rep, f.store + "." + f.k);
    if (!Array.isArray(arr)) arr = [];
    if (arr.indexOf(value) === -1) arr.push(value);
    FRModel.setPath(rep, f.store + "." + f.k, arr);

    var wrap = root.querySelector('[data-chips="' + key + '"]');
    if (wrap) {
      var tmp = document.createElement("div");
      tmp.innerHTML = renderField(f);
      if (tmp.firstElementChild) wrap.replaceWith(tmp.firstElementChild);
    }
    refreshProgress();
    onChange();
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

  /* Completion, not a score: how many items carry a record. With an empty
     checklist the bar says so instead of pretending there is nothing to do. */
  function refreshProgress() {
    var total = FRModel.totalItems();
    var done = FRModel.recordedCount(rep);
    var none = total === 0;

    var val = document.getElementById("progVal");
    var meta = document.getElementById("progMeta");
    var tier = document.getElementById("progTier");
    var cov = document.getElementById("progCov");
    if (val) val.textContent = none ? "0" : String(done);
    if (tier) tier.textContent = none ? "items in the checklist" : "of " + total + " recorded";
    if (meta) {
      meta.textContent = none ? "Add them in Settings"
        : (done === total ? "All items recorded" : (total - done) + " left");
    }
    if (cov) cov.style.width = (none ? 0 : Math.round(done / total * 100)) + "%";

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

  return {
    render: render,
    refreshProgress: refreshProgress,
    hydrateItemPhotos: hydrateItemPhotos,
    addPhotoFiles: addPhotoFiles
  };
})();
