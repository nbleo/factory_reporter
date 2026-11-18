/* App shell: routing, list, editor wiring, export, settings, backup UI. */
window.FRApp = (function () {
  "use strict";

  var U = FRUtil;
  var settings = { author: "Leo" };
  var deviceId = "";
  var current = null;
  var currentScreen = "home";
  var saveTimer = null;
  var pdf = { blob: null, name: "", url: "" };
  var searchTerm = "";
  var commentId = null;          // visit shown in the home comments card
  var commentTimer = null;

  /* ------------------------------------------------------------------ boot */
  function init() {
    return FRRules.load()
      .then(function () { return FRDB.open(); })
      .then(function () { return FRSync.load(); })
      .then(function () { return FRDB.kvGet("author", ""); })
      .then(function (v) { settings.author = v || "Leo"; return FRDB.kvGet("deviceId", ""); })
      .then(function (v) {
        deviceId = v || "";
        if (!deviceId) {
          deviceId = U.uid(8);
          return FRDB.kvSet("deviceId", deviceId);
        }
        return null;
      })
      .then(function () {
        bind();
        fillSettings();
        fillAbout();
        return renderHome();
      })
      .then(function () {
        show("home");
        updateSyncState();
        registerSW();
        window.FR.ready = true;
      })
      .catch(function (e) {
        U.toast("Startup failed: " + e.message, true);
        if (window.console) console.error(e);
      });
  }

  function registerSW() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  /* ------------------------------------------------------------------ router */
  function show(name) {
    if (name === "edit" && !current) { U.toast("Open or create a visit first"); name = "home"; }
    if (name === "photos" && !current) { U.toast("Open or create a visit first"); name = "home"; }

    U.$$(".screen").forEach(function (s) { s.hidden = s.dataset.screen !== name; });
    U.$$(".tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.go === name);
    });
    currentScreen = name;
    U.$("#btnBack").hidden = name === "home";
    U.$("#progressBar").hidden = name !== "edit";
    window.scrollTo(0, 0);

    if (name === "home") renderHome();
    if (name === "photos") renderPhotos();
    if (name === "sync") renderSync();
    if (name === "settings") fillSettings();
  }

  function bind() {
    U.$("#btnNew").addEventListener("click", newReport);
    U.$("#btnBack").addEventListener("click", function () { flushSave().then(function () { show("home"); }); });
    U.$("#btnSettings").addEventListener("click", function () { show("settings"); });
    U.$("#btnSyncState").addEventListener("click", function () { show("sync"); });
    U.$("#tabbar").addEventListener("click", function (e) {
      var b = e.target.closest("[data-go]");
      if (b) show(b.dataset.go);
    });

    U.$("#editFactory").addEventListener("input", function () {
      if (!current) return;
      current.profile.factoryName = this.value;
      updateEditSub();
      scheduleSave();
    });
    U.$("#editFactory").addEventListener("blur", function () { lockId(); });

    U.$("#btnOpenPhotos").addEventListener("click", function () { flushSave().then(function () { show("photos"); }); });
    U.$("#btnExport").addEventListener("click", exportPDF);
    U.$("#btnAddPhoto").addEventListener("click", function () { U.$("#fileInput").click(); });
    U.$("#fileInput").addEventListener("change", onFilesChosen);
    U.$("#btnCoverPick").addEventListener("click", function () { U.$("#coverInput").click(); });
    U.$("#coverInput").addEventListener("change", onCoverChosen);
    U.$("#btnCoverClear").addEventListener("click", function () { setCover(""); });
    U.$("#btnDownload").addEventListener("click", downloadPDF);
    U.$("#btnShare").addEventListener("click", sharePDF);

    U.$("#btnSaveSettings").addEventListener("click", saveSettings);
    U.$("#btnTestConn").addEventListener("click", testConnection);
    U.$("#btnDiagnose").addEventListener("click", runDiagnose);
    U.$("#btnBackupNow").addEventListener("click", backupAll);
    U.$("#btnPull").addEventListener("click", pullAll);

    U.$("#btnResetChecklist").addEventListener("click", resetChecklist);
    U.$("#btnResetTemplate").addEventListener("click", resetTemplate);
    U.$("#checklistEditor").addEventListener("click", onChecklistClick);
    U.$("#checklistEditor").addEventListener("change", onChecklistChange);
    U.$("#templateEditor").addEventListener("click", onTemplateClick);
    U.$("#templateEditor").addEventListener("change", onTemplateChange);

    U.$("#commentText").addEventListener("input", onCommentInput);
    U.$("#btnOpenComment").addEventListener("click", function () {
      if (commentId) openReport(commentId);
    });

    U.$("#searchBox").addEventListener("input", function () {
      searchTerm = this.value.trim().toLowerCase();
      renderHome();
    });

    U.$("#reportList").addEventListener("click", function (e) {
      var item = e.target.closest("[data-id]");
      if (item) openReport(item.dataset.id);
    });

    /* long press / right click to delete */
    var pressTimer = null;
    var list = U.$("#reportList");
    list.addEventListener("pointerdown", function (e) {
      var item = e.target.closest("[data-id]");
      if (!item) return;
      pressTimer = setTimeout(function () { askDelete(item.dataset.id); }, 650);
    });
    ["pointerup", "pointercancel", "pointerleave", "pointermove"].forEach(function (ev) {
      list.addEventListener(ev, function () { clearTimeout(pressTimer); });
    });
    list.addEventListener("contextmenu", function (e) {
      var item = e.target.closest("[data-id]");
      if (!item) return;
      e.preventDefault();
      askDelete(item.dataset.id);
    });

    U.$("#modalCancel").addEventListener("click", function () { closeModal(false); });
    U.$("#modalOk").addEventListener("click", function () { closeModal(true); });
  }

  /* -------------------------------------------------------------------- home */
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    var a = parts[0].charAt(0);
    var b = parts.length > 1 ? parts[1].charAt(0) : (parts[0].charAt(1) || "");
    return (a + b).toUpperCase();
  }

  function renderHome() {
    return FRDB.all("reports").then(function (rows) {
      var list = rows.filter(function (r) { return !r.deletedAt; });
      list.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });

      if (searchTerm) {
        list = list.filter(function (r) {
          var hay = (r.profile.factoryName + " " + r.profile.cityProvince + " " + r.profile.contactName).toLowerCase();
          return hay.indexOf(searchTerm) !== -1;
        });
      }

      var mount = U.$("#reportList");
      var empty = U.$("#emptyState");

      if (!list.length) {
        mount.innerHTML = "";
        empty.hidden = false;
        renderComments(rows);
        updateSyncState(rows);
        return;
      }
      empty.hidden = true;

      var total = FRModel.totalItems();
      mount.innerHTML = list.map(function (r) {
        var rec = FRModel.recordedCount(r);
        var cls = FRModel.statusOf(r);
        /* an empty checklist has nothing to count, so the badge says where
           the visit stands instead of showing 0 / 0 */
        var badge = total ? rec + "/" + total : (cls === "complete" ? "done" : "draft");
        var cover = FRModel.coverId(r);
        var sub = [
          U.fmtDate(r.profile.visitDate),
          (r.profile.cityProvince || ""),
          (r.photos || []).length + " photo" + ((r.photos || []).length === 1 ? "" : "s"),
          r.pushedAt ? "backed up" : "not backed up"
        ].filter(Boolean).join(" | ");
        return '<div class="list-item" data-id="' + U.esc(r.id) + '">' +
          '<div class="li-thumb">' +
            '<img data-cover-img="' + U.esc(r.id) + '" alt=""' + (cover ? "" : " hidden") + '>' +
            '<span class="li-thumb-fb">' + U.esc(initials(FRModel.displayName(r))) + '</span>' +
          '</div>' +
          '<div class="li-main">' +
            '<div class="li-title">' + U.esc(FRModel.displayName(r)) + '</div>' +
            '<div class="li-sub"><span>' + U.esc(sub) + '</span></div>' +
          '</div>' +
          '<div class="li-badge b-' + U.esc(cls) + '">' + U.esc(badge) + '</div>' +
        '</div>';
      }).join("");

      /* the gate / main-building shot that identifies each visit */
      list.forEach(function (r) {
        var id = FRModel.coverId(r);
        if (!id) return;
        FRPhotos.thumbUrl(id).then(function (url) {
          var img = mount.querySelector('[data-cover-img="' + r.id + '"]');
          if (img && url) { img.src = url; img.hidden = false; }
        });
      });

      renderComments(rows);
      updateSyncState(rows);
    });
  }

  /* Bottom of the home screen: the summary of the most recent visit,
     editable in place - it is the paragraph HQ reads first. */
  function renderComments(rows) {
    var box = U.$("#commentText");
    var head = U.$("#commentHead");
    var btn = U.$("#btnOpenComment");
    if (!box || !head) return;

    var live = (rows || []).filter(function (r) { return !r.deletedAt; });
    live.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    var latest = live[0] || null;

    if (!latest) {
      commentId = null;
      head.textContent = "No visit yet";
      box.value = "";
      box.disabled = true;
      if (btn) btn.disabled = true;
      return;
    }

    commentId = latest.id;
    head.textContent = FRModel.displayName(latest) + "  -  " + U.fmtDate(latest.profile.visitDate);
    box.disabled = false;
    box.value = (latest.conclusion && latest.conclusion.comments) || "";
    if (btn) btn.disabled = false;
  }

  function onCommentInput() {
    var box = U.$("#commentText");
    if (!box || !commentId) return;
    var id = commentId;
    var text = box.value;
    clearTimeout(commentTimer);
    commentTimer = setTimeout(function () {
      FRDB.get("reports", id).then(function (row) {
        if (!row) return null;
        var rep = FRModel.normalize(row);
        rep.conclusion.comments = text;
        rep.updatedAt = U.now();
        if (current && current.id === id) current.conclusion.comments = text;
        return FRDB.put("reports", rep);
      }).then(function () {
        var hint = U.$("#commentHint");
        if (hint) hint.textContent = "Saved.";
        return updateSyncState();
      }).catch(function (e) {
        U.toast("Could not save comment: " + e.message, true);
      });
    }, 700);
  }

  function newReport() {
    var rep = FRModel.emptyReport();
    rep.deviceId = deviceId;
    rep.meta.author = settings.author;
    return FRDB.put("reports", rep).then(function () {
      return openReport(rep.id);
    }).then(function () {
      setTimeout(function () {
        var f = U.$("#editFactory");
        /* never steal the caret from a field the user already tapped */
        if (f && document.activeElement === document.body) f.focus();
      }, 120);
    });
  }

  function openReport(id) {
    return FRDB.get("reports", id).then(function (r) {
      if (!r) { U.toast("Report not found", true); return; }
      current = FRModel.normalize(r);
      current.deviceId = current.deviceId || deviceId;
      U.$("#editFactory").value = current.profile.factoryName || "";
      renderEdit();
      show("edit");
    });
  }

  function renderEdit() {
    updateEditSub();
    U.$("#photoCount").textContent = String((current.photos || []).length);
    FRForm.render(current, U.$("#formMount"), { onChange: onFormChange });
  }

  function updateEditSub() {
    if (!current) return;
    var st = FRModel.statusOf(current);
    var sub = [
      U.fmtDate(current.profile.visitDate),
      current.id,
      (current.photos || []).length + " photos",
      st
    ].join("  |  ");
    U.$("#editSub").textContent = sub;
    U.$("#photoCount").textContent = String((current.photos || []).length);
  }

  function onFormChange() {
    updateEditSub();
    scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveNow(); }, 600);
  }

  function saveNow() {
    if (!current) return Promise.resolve();
    current.updatedAt = U.now();
    current.meta.author = settings.author;
    current.status = FRModel.statusOf(current);
    return FRDB.put("reports", current).then(function () {
      return updateSyncState();
    }).catch(function (e) {
      U.toast("Could not save: " + e.message, true);
    });
  }

  function flushSave() {
    clearTimeout(saveTimer);
    return saveNow();
  }

  /* Freeze the id once, migrating any photos taken under the draft id. */
  function lockId() {
    if (!current || current.idLocked) return Promise.resolve();
    var oldId = current.id;
    FRModel.ensureId(current);
    if (current.id === oldId) {
      current.idLocked = true;
      return FRDB.put("reports", current);
    }
    return FRDB.photoBlobs(oldId).then(function (rows) {
      return Promise.all(rows.map(function (r) {
        r.reportId = current.id;
        return FRDB.put("photos", r);
      }));
    }).then(function () {
      return FRDB.del("reports", oldId);
    }).then(function () {
      return FRDB.put("reports", current);
    }).then(function () {
      updateEditSub();
    });
  }

  /* ------------------------------------------------------------------ photos */
  function onFilesChosen() {
    var input = U.$("#fileInput");
    if (!current) return;
    if (!input.files || !input.files.length) return;
    var kind = U.$("#photoKind").value;
    U.toast("Compressing " + input.files.length + " photo(s)...");
    FRPhotos.addFiles(current, input.files, { kind: kind }).then(function () {
      input.value = "";
      return saveNow();
    }).then(function () {
      renderPhotos();
      updateEditSub();
      FRForm.refreshProgress();
      U.toast("Photos added");
    }).catch(function (e) {
      input.value = "";
      U.toast(e.message || "Photo failed", true);
    });
  }

  var coverUrl = "";

  function renderPhotos() {
    if (!current) return;
    fillKindOptions();
    renderCover();

    var grid = U.$("#photoGrid");
    var photos = current.photos || [];
    U.$("#photoSummary").textContent = photos.length + " photo" + (photos.length === 1 ? "" : "s");

    if (!photos.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' +
        '<p>No photos yet.</p><p class="muted">Start with the factory gate or main building - it becomes the cover photo and the picture on the home screen.</p></div>';
      return;
    }

    var coverId = FRModel.coverId(current);
    grid.innerHTML = photos.map(function (p) {
      var it = p.itemId ? FRRules.item(p.itemId) : null;
      var itemLabel = it ? it.no : "";
      var on = p.id === coverId;
      return '<div class="photo-cell' + (on ? " is-cover" : "") + '" data-photo="' + U.esc(p.id) + '">' +
        '<img data-thumb="' + U.esc(p.id) + '" alt="">' +
        (itemLabel ? '<span class="ph-item">' + U.esc(itemLabel) + '</span>' : "") +
        '<span class="ph-kind">' + U.esc(FRRules.kindLabel(p.kind)) + '</span>' +
        '<button class="ph-cover' + (on ? " on" : "") + '" type="button" data-set-cover="' + U.esc(p.id) +
          '" aria-label="Use as cover photo" aria-pressed="' + (on ? "true" : "false") + '">' +
          (on ? "&#9733;" : "&#9734;") + '</button>' +
        '<button class="ph-del" type="button" data-del-photo="' + U.esc(p.id) + '" aria-label="Delete photo">&#215;</button>' +
      '</div>';
    }).join("");

    photos.forEach(function (p) {
      FRPhotos.thumbUrl(p.id).then(function (url) {
        var img = grid.querySelector('[data-thumb="' + p.id + '"]');
        if (img && url) img.src = url;
      });
    });

    grid.onclick = function (e) {
      var star = e.target.closest("[data-set-cover]");
      if (star) {
        e.stopPropagation();
        /* compare with the pinned id, not with the automatic fallback */
        var pinned = current.coverPhotoId === star.dataset.setCover;
        setCover(pinned ? "" : star.dataset.setCover);
        return;
      }
      var del = e.target.closest("[data-del-photo]");
      if (del) {
        e.stopPropagation();
        var pid = del.dataset.delPhoto;
        FRPhotos.remove(current, pid).then(function () {
          if (current.coverPhotoId === pid) current.coverPhotoId = "";
          return saveNow();
        }).then(function () {
          renderPhotos();
          updateEditSub();
          FRForm.refreshProgress();
        });
        return;
      }
      var cell = e.target.closest("[data-photo]");
      if (cell) {
        FRPhotos.fullUrl(cell.dataset.photo).then(function (url) {
          if (url) window.open(url, "_blank");
        });
      }
    };
  }

  function fillKindOptions(keep) {
    var sel = U.$("#photoKind");
    if (!sel) return;
    var prev = keep || sel.value;
    var kinds = FRRules.photoKinds();
    sel.innerHTML = (kinds.length ? kinds : [["other", "Other"]]).map(function (k) {
      return '<option value="' + U.esc(k[0]) + '">' + U.esc(k[1]) + '</option>';
    }).join("");
    var has = kinds.some(function (k) { return String(k[0]) === String(prev); });
    sel.value = has ? prev : (kinds[0] ? kinds[0][0] : "other");
  }

  /* Cover photo: the gate / main building shot that identifies the visit. */
  function renderCover() {
    var img = U.$("#coverImg");
    var empty = U.$("#coverEmpty");
    var kind = U.$("#coverKind");
    var btn = U.$("#btnCoverClear");
    if (!img || !current) return;

    var id = FRModel.coverId(current);
    var meta = (current.photos || []).filter(function (p) { return p.id === id; })[0];

    if (coverUrl) { URL.revokeObjectURL(coverUrl); coverUrl = ""; }
    img.removeAttribute("src");
    img.hidden = true;

    if (!id || !meta) {
      if (empty) empty.hidden = false;
      if (kind) kind.textContent = "";
      if (btn) btn.disabled = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (kind) kind.textContent = FRRules.kindLabel(meta.kind);
    if (btn) btn.disabled = !current.coverPhotoId;
    FRPhotos.fullUrl(id).then(function (url) {
      if (!url) return;
      coverUrl = url;
      img.src = url;
      img.hidden = false;
    });
  }

  function setCover(photoId) {
    if (!current) return Promise.resolve();
    current.coverPhotoId = photoId || "";
    current.updatedAt = U.now();
    return FRDB.put("reports", current).then(function () {
      renderCover();
      if (currentScreen === "photos") renderPhotos();
      return updateSyncState();
    });
  }

  function onCoverChosen() {
    var input = U.$("#coverInput");
    if (!current || !input.files || !input.files.length) return Promise.resolve();
    U.toast("Compressing cover photo...");
    return lockId().then(function () {
      return FRPhotos.addFiles(current, input.files, { kind: "factory" });
    }).then(function (added) {
      if (added && added.length) current.coverPhotoId = added[0].id;
      current.updatedAt = U.now();
      return FRDB.put("reports", current);
    }).then(function () {
      input.value = "";
      renderPhotos();
      updateEditSub();
      FRForm.refreshProgress();
      U.toast("Cover photo saved");
    }).catch(function (e) {
      input.value = "";
      U.toast(e.message || "Photo failed", true);
    });
  }

  /* ------------------------------------------------------------------ export */
  function exportPDF() {
    if (!current) return;
    var btn = U.$("#btnExport");
    btn.disabled = true;
    U.toast("Building PDF...");
    return lockId()
      .then(function () { return flushSave(); })
      .then(function () {
        return FRPDF.build(current, { author: settings.author });
      })
      .then(function (res) {
        if (pdf.url) URL.revokeObjectURL(pdf.url);
        pdf.blob = res.blob;
        pdf.name = res.fileName;
        pdf.url = URL.createObjectURL(res.blob);
        U.$("#pdfFrame").src = pdf.url;
        U.$("#pdfMeta").textContent = res.pages + " pages - " + U.fmtSize(res.blob.size);
        show("preview");
        U.toast("PDF ready");
      })
      .catch(function (e) {
        U.toast("PDF failed: " + e.message, true);
        if (window.console) console.error(e);
      })
      .then(function () { btn.disabled = false; });
  }

  function downloadPDF() {
    if (!pdf.blob) { U.toast("Build the PDF first", true); return; }
    U.download(pdf.blob, pdf.name || "FactoryVisit.pdf");
  }

  function sharePDF() {
    if (!pdf.blob) { U.toast("Build the PDF first", true); return; }
    var file = new File([pdf.blob], pdf.name || "FactoryVisit.pdf", { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      var timer = setTimeout(function () {
        U.download(pdf.blob, pdf.name || "FactoryVisit.pdf");
      }, 45000);
      navigator.share({ files: [file], title: "Factory visit report" })
        .catch(function () {})
        .then(function () { clearTimeout(timer); });
    } else {
      U.download(pdf.blob, pdf.name || "FactoryVisit.pdf");
    }
  }

  /* ---------------------------------------------------------------- settings */
  function fillSettings() {
    var c = FRSync.conf();
    U.$("#setAuthor").value = settings.author || "";
    U.$("#setOwner").value = c.owner || "";
    U.$("#setRepo").value = c.repo || "";
    U.$("#setBranch").value = c.branch || "main";
    var tk = U.$("#setToken");
    tk.value = "";
    tk.placeholder = c.token ? "Saved - leave blank to keep" : "github_pat_...";
    U.$("#settingsStatus").textContent = c.token
      ? "Token saved on this device (" + c.token.length + " characters)."
      : "No token saved yet.";
    U.$("#settingsStatus").className = "status-line";
    renderChecklistEditor();
    renderTemplateEditor();
  }

  /* ------------------------------------------------------- checklist editor */
  function renderChecklistEditor() {
    var mount = U.$("#checklistEditor");
    if (!mount) return;

    mount.innerHTML = FRRules.editableSections().map(function (sec) {
      var items = sec.items || [];
      var rows = items.map(function (it, i) {
        return '<div class="cl-item" data-cl-item="' + U.esc(it.id) + '">' +
          '<div class="cl-item-top">' +
            '<span class="cl-no">' + U.esc(it.no) + '</span>' +
            '<span class="cl-grip"></span>' +
            '<button class="cl-btn" type="button" data-cl-up="' + U.esc(it.id) + '" aria-label="Move up"' +
              (i === 0 ? " disabled" : "") + '>&#8593;</button>' +
            '<button class="cl-btn" type="button" data-cl-down="' + U.esc(it.id) + '" aria-label="Move down"' +
              (i === items.length - 1 ? " disabled" : "") + '>&#8595;</button>' +
            '<button class="cl-btn del" type="button" data-cl-del="' + U.esc(it.id) + '" aria-label="Delete">&#215;</button>' +
          '</div>' +
          '<textarea class="input cl-label" rows="2" data-cl-label="' + U.esc(it.id) +
            '" aria-label="Item text">' + U.esc(it.label) + '</textarea>' +
          '<textarea class="input cl-hint" rows="2" data-cl-hint="' + U.esc(it.id) +
            '" placeholder="What to look for (optional)">' + U.esc(it.hint || "") + '</textarea>' +
        '</div>';
      }).join("");

      return '<div class="cl-sec" data-cl-sec="' + U.esc(sec.id) + '">' +
        '<div class="cl-sec-head"><span>' + (sec.no ? U.esc(sec.no) + '  ' : '') + U.esc(sec.title) + '</span>' +
          '<span class="muted small">' + items.length + '</span></div>' +
        (rows || '<p class="muted small">No items yet - this section stays hidden in the form until you add one.</p>') +
        '<button class="link-btn" type="button" data-cl-add="' + U.esc(sec.id) + '">+ Add item</button>' +
      '</div>';
    }).join("");
  }

  function checklistSaved(msg) {
    var s = U.$("#checklistStatus");
    if (s) {
      s.textContent = msg || "Saved. Reopen a visit to see the new wording.";
      s.className = "status-line ok";
    }
    updateSyncState();
  }

  function onChecklistClick(e) {
    var b = e.target.closest("button");
    if (!b) return;

    if (b.dataset.clAdd) {
      FRRules.addItem(b.dataset.clAdd, "New item").then(function () {
        renderChecklistEditor();
        var sec = FRRules.section(b.dataset.clAdd);
        var last = sec && sec.items[sec.items.length - 1];
        if (last) {
          var input = U.$('#checklistEditor [data-cl-label="' + last.id + '"]');
          if (input) { input.focus(); input.select(); }
        }
        checklistSaved("Item added.");
      });
      return;
    }

    var itemId = b.dataset.clUp || b.dataset.clDown || b.dataset.clDel;
    var it = itemId ? FRRules.item(itemId) : null;
    if (!it) return;

    if (b.dataset.clDel) {
      ask("Delete this item?",
        "\"" + it.label + "\" is removed from the checklist. Notes already recorded on existing visits are kept.",
        "Delete").then(function (ok) {
        if (!ok) return null;
        return FRRules.removeItem(it.section, itemId).then(function () {
          renderChecklistEditor();
          checklistSaved("Item deleted.");
        });
      });
      return;
    }

    var delta = b.dataset.clUp ? -1 : 1;
    FRRules.moveItem(it.section, itemId, delta).then(function () {
      renderChecklistEditor();
      checklistSaved("Order updated.");
    });
  }

  function onChecklistChange(e) {
    var t = e.target;
    var id = t.dataset && (t.dataset.clLabel || t.dataset.clHint);
    if (!id) return;
    var it = FRRules.item(id);
    if (!it) return;
    var patch = t.dataset.clLabel
      ? { label: t.value.trim() || "Untitled item" }
      : { hint: t.value };
    FRRules.updateItem(it.section, id, patch).then(function () {
      var s = U.$("#checklistStatus");
      if (s) {
        s.textContent = "Saved. Reopen a visit to see the new wording.";
        s.className = "status-line ok";
      }
    });
  }

  function resetChecklist() {
    return ask("Clear the checklist?",
      "Every item, name and hint is removed and the checklist goes back to empty. Notes already recorded on visits are kept.",
      "Clear").then(function (ok) {
      if (!ok) return null;
      return FRRules.resetDefaults().then(function () {
        renderChecklistEditor();
        checklistSaved("Checklist cleared.");
      });
    });
  }

  /* ------------------------------------------------------- template editor */
  var tplOpen = {};

  function snapshotOpen() {
    U.$$("#templateEditor details").forEach(function (d) {
      if (d.dataset.dtl) tplOpen[d.dataset.dtl] = d.open;
    });
  }

  function renderTemplateEditor() {
    var mount = U.$("#templateEditor");
    if (!mount) return;
    var t = FRRules.template();
    var fields = FRRules.fields();
    var withOptions = fields.filter(function (f) { return (f.options || []).length; });
    var plain = fields.filter(function (f) { return !(f.options || []).length; });

    var html = "";

    html += '<div class="tpl-block">' +
      '<div class="tpl-block-head">Record states<span class="muted small">green / amber / red / grey</span></div>' +
      '<div class="tpl-states">' +
      t.states.map(function (s) {
        return '<input class="input" type="text" data-tpl-state="' + U.esc(s.key) + '" value="' +
          U.esc(s.label) + '" aria-label="' + U.esc(s.key) + '">';
      }).join("") +
      '</div></div>';

    html += '<div class="tpl-block">' +
      '<div class="tpl-block-head">Photo categories<span class="muted small">' + t.photoKinds.length + '</span></div>' +
      t.photoKinds.map(function (k, i) {
        return '<div class="tpl-row">' +
          '<input class="input" type="text" data-tpl-kind="' + i + '" value="' + U.esc(k[1]) + '" aria-label="Photo category">' +
          '<button class="cl-btn" type="button" data-tpl-kind-up="' + i + '" aria-label="Move up"' +
            (i === 0 ? " disabled" : "") + '>&#8593;</button>' +
          '<button class="cl-btn" type="button" data-tpl-kind-down="' + i + '" aria-label="Move down"' +
            (i === t.photoKinds.length - 1 ? " disabled" : "") + '>&#8595;</button>' +
          '<button class="cl-btn del" type="button" data-tpl-kind-del="' + i + '" aria-label="Delete">&#215;</button>' +
        '</div>';
      }).join("") +
      '<button class="link-btn" type="button" data-tpl-kind-add="1">+ Add category</button>' +
      '</div>';

    html += '<details class="tpl-details" data-dtl="labels"' + (tplOpen.labels ? " open" : "") + '>' +
      '<summary>Section titles and field labels<span class="muted small">' + plain.length + '</span></summary>' +
      '<div class="tpl-body">' +
      '<p class="muted small">Fields that carry an option list are renamed inside Option lists below.</p>';
    FRRules.sections().forEach(function (sec) {
      var list = (sec.fields || []).concat(sec.tailFields || []).filter(function (f) {
        return !(f.options || []).length;
      });
      html += '<div class="tpl-sec">' +
        '<div class="tpl-sub tpl-sub-tight">' +
          (sec.no ? "Section " + U.esc(sec.no) : "Not shown - no items yet") + '</div>' +
        '<input class="input tpl-sec-input" type="text" data-tpl-section="' + U.esc(sec.id) + '" value="' +
          U.esc(sec.title) + '" aria-label="Section ' + U.esc(sec.no) + ' title">' +
        list.map(function (f) {
          return '<div class="tpl-field"><input class="input" type="text" data-tpl-field="' + U.esc(f.k) +
            '" value="' + U.esc(f.label) + '" aria-label="' + U.esc(f.k) + ' label"></div>';
        }).join("") +
      '</div>';
    });
    html += '</div></details>';

    html += '<details class="tpl-details" data-dtl="options"' + (tplOpen.options ? " open" : "") + '>' +
      '<summary>Option lists<span class="muted small">' + withOptions.length + '</span></summary>' +
      '<div class="tpl-body">';
    withOptions.forEach(function (f) {
      var key = 'opt-' + f.k;
      html += '<details class="tpl-group" data-dtl="' + U.esc(key) + '"' + (tplOpen[key] ? " open" : "") + '>' +
        '<summary>' + U.esc(f.label) + '<span class="muted small">' + f.options.length + '</span></summary>' +
        '<div class="tpl-group-body">' +
        '<div class="tpl-sub tpl-sub-tight">Field name</div>' +
        '<input class="input tpl-field-input" type="text" data-tpl-field="' + U.esc(f.k) +
          '" value="' + U.esc(f.label) + '" aria-label="Field label">' +
        '<div class="tpl-sub tpl-sub-tight">Options</div>' +
        f.options.map(function (o, i) {
          return '<div class="tpl-row">' +
            '<input class="input" type="text" data-tpl-opt="' + U.esc(f.k) + '" data-tpl-index="' + i +
              '" value="' + U.esc(o[1]) + '" aria-label="Option">' +
            '<button class="cl-btn" type="button" data-tpl-opt-up="' + U.esc(f.k) + '" data-tpl-index="' + i +
              '" aria-label="Move up"' + (i === 0 ? " disabled" : "") + '>&#8593;</button>' +
            '<button class="cl-btn" type="button" data-tpl-opt-down="' + U.esc(f.k) + '" data-tpl-index="' + i +
              '" aria-label="Move down"' + (i === f.options.length - 1 ? " disabled" : "") + '>&#8595;</button>' +
            '<button class="cl-btn del" type="button" data-tpl-opt-del="' + U.esc(f.k) + '" data-tpl-index="' + i +
              '" aria-label="Delete">&#215;</button>' +
          '</div>';
        }).join("") +
        '<button class="link-btn" type="button" data-tpl-opt-add="' + U.esc(f.k) + '">+ Add option</button>' +
        '</div></details>';
    });
    html += '</div></details>';

    mount.innerHTML = html;
  }

  function tplSaved(msg) {
    var s = U.$("#templateStatus");
    if (s) {
      s.textContent = msg || "Saved. Open a visit to see the new wording.";
      s.className = "status-line ok";
    }
  }

  function afterTplEdit(msg) {
    snapshotOpen();
    renderTemplateEditor();
    tplSaved(msg);
    updateSyncState();
  }

  function onTemplateClick(e) {
    var b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    var d = b.dataset;
    var idx = d.tplIndex != null ? Number(d.tplIndex) : -1;

    if (d.tplKindAdd) {
      return FRRules.addKind("New category").then(function () { afterTplEdit("Category added."); });
    }
    if (d.tplKindUp) return FRRules.moveKind(Number(d.tplKindUp), -1).then(function () { afterTplEdit("Order updated."); });
    if (d.tplKindDown) return FRRules.moveKind(Number(d.tplKindDown), 1).then(function () { afterTplEdit("Order updated."); });
    if (d.tplKindDel) return FRRules.removeKind(Number(d.tplKindDel)).then(function () { afterTplEdit("Category removed."); });

    if (d.tplOptAdd) {
      var key = d.tplOptAdd;
      return FRRules.addOption(key, "New option").then(function () {
        snapshotOpen();
        tplOpen["opt-" + key] = true;
        renderTemplateEditor();
        tplSaved("Option added.");
        var rows = U.$$('#templateEditor [data-tpl-opt="' + key + '"]');
        var last = rows[rows.length - 1];
        if (last) { last.focus(); last.select(); }
      });
    }
    if (d.tplOptUp) return FRRules.moveOption(d.tplOptUp, idx, -1).then(function () {
      tplOpen["opt-" + d.tplOptUp] = true; afterTplEdit("Order updated.");
    });
    if (d.tplOptDown) return FRRules.moveOption(d.tplOptDown, idx, 1).then(function () {
      tplOpen["opt-" + d.tplOptDown] = true; afterTplEdit("Order updated.");
    });
    if (d.tplOptDel) return FRRules.removeOption(d.tplOptDel, idx).then(function () {
      tplOpen["opt-" + d.tplOptDel] = true; afterTplEdit("Option removed.");
    });
  }

  function onTemplateChange(e) {
    var t = e.target;
    var d = t.dataset || {};
    if (d.tplState) return FRRules.setStateLabel(d.tplState, t.value).then(function () { tplSaved(); });
    if (d.tplKind != null && d.tplKind !== "") {
      return FRRules.setKindLabel(Number(d.tplKind), t.value).then(function () { tplSaved(); });
    }
    if (d.tplOpt) return FRRules.setOptionLabel(d.tplOpt, Number(d.tplIndex), t.value).then(function () { tplSaved(); });
    if (d.tplSection) {
      return FRRules.setSectionTitle(d.tplSection, t.value).then(function () {
        renderChecklistEditor();
        tplSaved();
      });
    }
    if (d.tplField) return FRRules.setFieldLabel(d.tplField, t.value).then(function () { tplSaved(); });
  }

  function resetTemplate() {
    return ask("Reset the form template?",
      "Field labels, option lists, record states and photo categories return to the factory defaults. Recorded visits keep their data.",
      "Reset").then(function (ok) {
      if (!ok) return null;
      return FRRules.resetTemplate().then(function () {
        tplOpen = {};
        renderTemplateEditor();
        tplSaved("Template reset to defaults.");
      });
    });
  }

  function readSettingsInputs() {
    return {
      author: U.$("#setAuthor").value.trim(),
      owner: U.$("#setOwner").value.trim(),
      repo: U.$("#setRepo").value.trim(),
      branch: U.$("#setBranch").value.trim() || "main",
      token: FRSync.cleanToken(U.$("#setToken").value)
    };
  }

  function applySettingsInputs() {
    var v = readSettingsInputs();
    settings.author = v.author || "Leo";
    var partial = { owner: v.owner, repo: v.repo, branch: v.branch };
    if (v.token) partial.token = v.token;
    return Promise.all([
      FRDB.kvSet("author", settings.author)
    ]).then(function () {
      return FRSync.set(partial);
    }).then(function () {
      if (current) {
        current.meta.author = settings.author;
        return FRDB.put("reports", current);
      }
      return null;
    });
  }

  function saveSettings() {
    return applySettingsInputs().then(function () {
      fillSettings();
      updateSyncState();
      var s = U.$("#settingsStatus");
      s.textContent = "Saved.";
      s.className = "status-line ok";
      U.toast("Settings saved");
    });
  }

  function testConnection() {
    var s = U.$("#settingsStatus");
    s.textContent = "Testing...";
    s.className = "status-line";
    return applySettingsInputs()
      .then(function () { return FRSync.test(); })
      .then(function (r) {
        s.textContent = "Connected as " + r.login + " - " + r.repo + " (private).";
        s.className = "status-line ok";
        fillSettings();
        updateSyncState();
      })
      .catch(function (e) {
        s.textContent = e.message;
        s.className = "status-line bad";
      });
  }

  function runDiagnose() {
    var out = U.$("#diagLog");
    out.textContent = "";
    FRSync.setLogger(function (line) {
      out.textContent += line + "\n";
      out.scrollTop = out.scrollHeight;
    });
    return applySettingsInputs().then(function () {
      return FRSync.diagnose();
    }).then(function () {
      FRSync.setLogger(onSyncLog);
    }).catch(function () {
      FRSync.setLogger(onSyncLog);
    });
  }

  function fillAbout() {
    U.$("#aboutApp").textContent = FRModel.APP_VERSION;
    U.$("#aboutDevice").textContent = deviceId || "-";
    var rules = FRRules.data();
    U.$("#aboutRules").textContent = rules ? rules.version : "-";
    fetch("sw.js").then(function (r) { return r.text(); }).then(function (txt) {
      var m = txt.match(/factory-reporter-v[\w.]+/);
      U.$("#aboutCache").textContent = m ? m[0] : "-";
    }).catch(function () { U.$("#aboutCache").textContent = "-"; });
  }

  /* -------------------------------------------------------------------- sync */
  function onSyncLog(line) {
    var el = U.$("#syncLog");
    if (!el) return;
    el.textContent += line + "\n";
    el.scrollTop = el.scrollHeight;
  }
  FRSync.setLogger(onSyncLog);

  function renderSync() {
    var c = FRSync.conf();
    U.$("#syncTarget").textContent = c.owner && c.repo
      ? c.owner + "/" + c.repo + " (" + (c.branch || "main") + ")"
      : "not configured";
    return FRDB.all("reports").then(function (rows) {
      var live = rows.filter(function (r) { return !r.deletedAt; });
      var pending = live.filter(function (r) { return !r.pushedAt || r.pushedAt < r.updatedAt; });
      var last = live.map(function (r) { return r.pushedAt || ""; }).sort().pop();
      U.$("#syncLast").textContent = last ? U.fmtDateTime(last) : "never";
      U.$("#syncPending").textContent = pending.length + " of " + live.length + " report(s) changed";
      updateSyncState(rows);
    });
  }

  function updateSyncState(rows) {
    var p = rows ? Promise.resolve(rows) : FRDB.all("reports");
    return p.then(function (list) {
      var live = (list || []).filter(function (r) { return !r.deletedAt; });
      var pending = live.filter(function (r) { return !r.pushedAt || r.pushedAt < r.updatedAt; });
      var dot = U.$("#syncDot");
      if (!dot) return;
      dot.className = "dot" + (pending.length ? " warn" : (FRSync.isConfigured() && live.length ? " ok" : ""));
      var el = U.$("#syncPending");
      if (el) el.textContent = pending.length + " of " + live.length + " report(s) changed";
    }).catch(function () {});
  }

  function backupAll() {
    var btn = U.$("#btnBackupNow");
    btn.disabled = true;
    U.$("#syncLog").textContent = "";
    return FRDB.all("reports").then(function (rows) {
      var live = rows.filter(function (r) { return !r.deletedAt; });
      var todo = live.filter(function (r) { return !r.pushedAt || r.pushedAt < r.updatedAt; });
      if (!todo.length) {
        U.toast("Everything is already backed up");
        return null;
      }
      onSyncLog("Reports to back up: " + todo.length);
      var chain = Promise.resolve();
      var done = 0;
      todo.forEach(function (row) {
        chain = chain.then(function () {
          var rep = FRModel.normalize(row);
          onSyncLog("--- " + FRModel.displayName(rep) + " (" + (++done) + "/" + todo.length + ")");
          return FRSync.pushReport(rep).then(function () {
            if (current && current.id === rep.id) {
              return FRDB.get("reports", rep.id).then(function (fresh) {
                if (fresh) current = FRModel.normalize(fresh);
              });
            }
            return null;
          });
        });
      });
      return chain;
    }).then(function () {
      return renderSync();
    }).then(function () {
      U.toast("Backup finished");
      return renderHome();
    }).catch(function (e) {
      U.toast("Backup failed: " + e.message, true);
    }).then(function () {
      btn.disabled = false;
    });
  }

  function pullAll() {
    var btn = U.$("#btnPull");
    btn.disabled = true;
    U.$("#syncLog").textContent = "";
    onSyncLog("Pulling from " + FRSync.conf().owner + "/" + FRSync.conf().repo);
    return FRSync.pullAll(function (done, total, name) {
      onSyncLog("(" + (done + 1) + "/" + total + ") " + name);
    }).then(function (r) {
      U.toast("Pulled " + r.pulled + " report(s)");
      if (current) return openReport(current.id).catch(function () {});
      return null;
    }).then(function () {
      return renderSync();
    }).then(function () {
      return renderHome();
    }).catch(function (e) {
      U.toast("Pull failed: " + e.message, true);
    }).then(function () {
      btn.disabled = false;
    });
  }

  /* ------------------------------------------------------------------- modal */
  var modalResolve = null;

  function ask(title, text, okLabel) {
    U.$("#modalTitle").textContent = title;
    U.$("#modalText").textContent = text;
    U.$("#modalOk").textContent = okLabel || "Delete";
    U.$("#modal").hidden = false;
    return new Promise(function (res) { modalResolve = res; });
  }

  function closeModal(value) {
    U.$("#modal").hidden = true;
    if (modalResolve) { modalResolve(value); modalResolve = null; }
  }

  function askDelete(id) {
    return FRDB.get("reports", id).then(function (r) {
      if (!r) return null;
      var name = FRModel.displayName(r);
      return ask("Delete this visit?",
        name + " and its photos will be removed from this device. A copy already backed up stays in the repository.",
        "Delete").then(function (ok) {
        if (!ok) return null;
        return deleteReport(r);
      });
    });
  }

  function deleteReport(r) {
    var rep = FRModel.normalize(r);
    var cleanup = Promise.resolve();
    if (rep.pushedAt) {
      rep.deletedAt = U.now();
      cleanup = FRSync.pushReport(rep).catch(function () { return null; });
    }
    return cleanup.then(function () {
      return FRDB.deleteReport(rep.id);
    }).then(function () {
      return FRDB.del("reports", rep.id);
    }).then(function () {
      if (current && current.id === rep.id) current = null;
      U.toast("Deleted");
      show("home");
    });
  }

  /* Test bridge - used by tests/*.js, harmless in production. */
  window.FR = {
    ready: false,
    state: function () {
      return { current: current, screen: currentScreen, deviceId: deviceId, settings: settings };
    },
    show: show,
    openReport: openReport,
    newReport: newReport,
    saveNow: flushSave,
    setAll: function (state) {
      var rep = current;
      if (!rep) return null;
      FRRules.itemIds().forEach(function (id) {
        var prev = rep.answers[id] || {};
        rep.answers[id] = { state: state, note: prev.note || "", photoIds: prev.photoIds || [] };
      });
      FRForm.refreshProgress();
      renderEdit();
      return flushSave();
    },
    addPhoto: function (file, kind) {
      return FRPhotos.addFiles(current, [file], { kind: kind || "factory" }).then(function () {
        return flushSave();
      });
    },
    buildPDF: function () {
      return lockId().then(function () {
        return flushSave();
      }).then(function () {
        return FRPDF.build(current, { author: settings.author });
      }).then(function (res) {
        return res.blob.arrayBuffer().then(function (buf) {
          var bytes = new Uint8Array(buf), bin = "", i;
          for (i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          }
          return { size: bytes.length, pages: res.pages, name: res.fileName, base64: btoa(bin) };
        });
      });
    },
    sync: function () { return FRSync; }
  };

  return { init: init, show: show, state: function () { return { current: current, screen: currentScreen }; } };
})();

document.addEventListener("DOMContentLoaded", function () {
  FRApp.init();
});
