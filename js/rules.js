/* Checklist + template store.
   rules.json holds the factory defaults. Everything a user may need to change
   for another kind of factory is editable here and kept in IndexedDB:
     - "checklist": { sectionId: [item, ...] }      items, order, wording
     - "template" : { states, photoKinds, sections, fields, options }
   Nothing here scores anything - items are records. */
window.FRRules = (function () {
  "use strict";

  var R = null;               // rules.json as loaded
  var sections = [];          // merged view: titles, field labels, options, items
  var savedItems = null;      // checklist override
  var savedTpl = null;        // template override (resolved shape)
  var tpl = null;             // defaults merged with the override
  var itemsById = {};
  var fieldsByKey = {};

  function load(force) {
    return fetch("rules.json" + (force ? "?v=" + Date.now() : ""), { cache: force ? "no-store" : "default" })
      .then(function (res) {
        if (!res.ok) throw new Error("rules.json " + res.status);
        return res.json();
      })
      .then(function (json) {
        R = json;
        return Promise.all([FRDB.kvGet("checklist", null), FRDB.kvGet("template", null)]);
      })
      .then(function (res) {
        savedItems = res[0] && typeof res[0] === "object" ? res[0] : null;
        savedTpl = res[1] && typeof res[1] === "object" ? res[1] : null;
        rebuild();
        return R;
      });
  }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  /* ------------------------------------------------------------ defaults */
  function defaultTemplate() {
    var out = { states: [], photoKinds: [], sections: [], fields: [], options: {} };
    (R && R.states || []).forEach(function (s) { out.states.push({ key: s.key, label: s.label }); });
    out.photoKinds = clone((R && R.photoKinds) || []);
    ((R && R.sections) || []).forEach(function (sec) {
      out.sections.push({ id: sec.id, title: sec.title });
      (sec.fields || []).concat(sec.tailFields || []).forEach(function (f) {
        out.fields.push({ k: f.k, label: f.label, placeholder: f.placeholder || "" });
        if (f.options && f.options.length) out.options[f.k] = clone(f.options);
      });
    });
    return out;
  }

  /* Accept anything stored by an older version without losing the defaults. */
  function mergeTemplate(base, saved) {
    if (!saved || typeof saved !== "object") return base;

    if (Array.isArray(saved.states)) {
      saved.states.forEach(function (s) {
        if (!s || !s.key) return;
        var hit = base.states.filter(function (x) { return x.key === s.key; })[0];
        if (hit && typeof s.label === "string" && s.label.trim()) hit.label = s.label.trim();
      });
    }

    if (Array.isArray(saved.photoKinds) && saved.photoKinds.length) {
      var kinds = saved.photoKinds.filter(function (k) {
        return Array.isArray(k) && k[0] && k[1];
      });
      if (kinds.length) base.photoKinds = clone(kinds);
    }

    if (Array.isArray(saved.sections)) {
      saved.sections.forEach(function (s) {
        var hit = s && s.id ? base.sections.filter(function (x) { return x.id === s.id; })[0] : null;
        if (hit && typeof s.title === "string" && s.title.trim()) hit.title = s.title.trim();
      });
    }

    if (Array.isArray(saved.fields)) {
      saved.fields.forEach(function (f) {
        var hit = f && f.k ? base.fields.filter(function (x) { return x.k === f.k; })[0] : null;
        if (!hit) return;
        if (typeof f.label === "string" && f.label.trim()) hit.label = f.label.trim();
        if (typeof f.placeholder === "string") hit.placeholder = f.placeholder;
      });
    }

    if (saved.options && typeof saved.options === "object") {
      Object.keys(saved.options).forEach(function (k) {
        if (!base.options[k]) return;
        var arr = (saved.options[k] || []).filter(function (o) {
          return Array.isArray(o) && o[0] && o[1];
        });
        base.options[k] = clone(arr);
      });
    }

    return base;
  }

  function rebuild() {
    tpl = mergeTemplate(defaultTemplate(), savedTpl);

    var titles = {}, meta = {};
    tpl.sections.forEach(function (s) { titles[s.id] = s.title; });
    tpl.fields.forEach(function (f) { meta[f.k] = f; });

    itemsById = {};
    fieldsByKey = {};

    sections = ((R && R.sections) || []).map(function (sec) {
      var items = savedItems && Array.isArray(savedItems[sec.id])
        ? clone(savedItems[sec.id]) : clone(sec.items || []);

      function field(f) {
        var m = meta[f.k] || {};
        var out = Object.assign({}, f, {
          label: m.label || f.label,
          placeholder: m.placeholder != null ? m.placeholder : (f.placeholder || "")
        });
        if (f.options && f.options.length) {
          out.options = tpl.options[f.k] ? clone(tpl.options[f.k]) : clone(f.options);
        }
        out.section = sec.id;
        fieldsByKey[f.k] = out;
        return out;
      }

      var out = Object.assign({}, sec, {
        title: titles[sec.id] || sec.title,
        fields: (sec.fields || []).map(field),
        tailFields: (sec.tailFields || []).map(field),
        items: items
      });
      return out;
    });

    /* Section numbers are derived, and only sections that carry something
       count: an empty section is hidden in the form and in the PDF, so it
       must not leave a gap in the numbering. Item numbers derive from the
       position in the list, never from stored data. */
    var shown = 0;
    sections.forEach(function (sec) {
      var hasFields = (sec.fields || []).length + (sec.tailFields || []).length > 0;
      sec.empty = !(hasFields || (sec.items || []).length > 0);
      if (sec.empty) { sec.no = ""; return; }
      shown += 1;
      sec.no = String(shown);
      (sec.items || []).forEach(function (it, i) {
        it.no = sec.no + "." + (i + 1);
        it.section = sec.id;
        it.sectionTitle = sec.title;
        itemsById[it.id] = it;
      });
    });
  }

  /* ---------------------------------------------------------------- read */
  function data() { return R; }
  function version() { return R && R.version; }
  function sectionsView() { return sections; }

  /* Sections that actually carry a field or an item - the form and the PDF
     skip the rest, so an untouched default template prints nothing. */
  function visibleSections() {
    return sections.filter(function (s) { return !s.empty; });
  }
  function states() { return tpl ? tpl.states : []; }
  function photoKinds() { return tpl ? tpl.photoKinds : []; }

  function section(sectionId) {
    return sections.filter(function (s) { return s.id === sectionId; })[0] || null;
  }

  function sectionItems(sectionId) {
    var sec = section(sectionId);
    return sec ? sec.items : [];
  }

  function item(id) { return itemsById[id] || null; }
  function field(key) { return fieldsByKey[key] || null; }

  function fields() {
    var out = [];
    sections.forEach(function (sec) {
      (sec.fields || []).concat(sec.tailFields || []).forEach(function (f) {
        out.push(Object.assign({}, f, { sectionTitle: sec.title, sectionNo: sec.no }));
      });
    });
    return out;
  }

  function itemIds() {
    var out = [];
    sections.forEach(function (sec) {
      (sec.items || []).forEach(function (it) { out.push(it.id); });
    });
    return out;
  }

  function editableSections() {
    return sections.filter(function (s) { return (s.items || []).length || s.kind !== "fields"; });
  }

  /* ------------------------------------------------------------- items */
  function snapshot() {
    var out = {};
    sections.forEach(function (sec) {
      if (!(sec.items || []).length && sec.kind === "fields") return;
      out[sec.id] = clone(sec.items || []);
    });
    return out;
  }

  function persist(next) {
    savedItems = next;
    return FRDB.kvSet("checklist", next).then(function () {
      rebuild();
      return sections;
    });
  }

  function newItemId() { return "it-" + FRUtil.uid(6); }

  function addItem(sectionId, label) {
    var next = snapshot();
    if (!next[sectionId]) next[sectionId] = clone(sectionItems(sectionId));
    next[sectionId].push({ id: newItemId(), label: label || "New item", hint: "", evidence: "" });
    return persist(next);
  }

  function updateItem(sectionId, itemId, patch) {
    var next = snapshot();
    var list = next[sectionId] || clone(sectionItems(sectionId));
    next[sectionId] = list.map(function (it) {
      return it.id === itemId ? Object.assign({}, it, patch) : it;
    });
    return persist(next);
  }

  function removeItem(sectionId, itemId) {
    var next = snapshot();
    var list = next[sectionId] || clone(sectionItems(sectionId));
    next[sectionId] = list.filter(function (it) { return it.id !== itemId; });
    return persist(next);
  }

  function moveItem(sectionId, itemId, delta) {
    var next = snapshot();
    var list = (next[sectionId] || clone(sectionItems(sectionId))).slice();
    var from = -1, i;
    for (i = 0; i < list.length; i++) if (list[i].id === itemId) from = i;
    var to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return Promise.resolve(sections);
    var moved = list.splice(from, 1)[0];
    list.splice(to, 0, moved);
    next[sectionId] = list;
    return persist(next);
  }

  function saveAll(map) {
    var next = {};
    Object.keys(map || {}).forEach(function (sid) {
      next[sid] = (map[sid] || []).map(function (it, i) {
        return {
          id: it.id || "it-" + FRUtil.uid(6) + i,
          label: String(it.label || "").trim() || "Item " + (i + 1),
          hint: String(it.hint || ""),
          evidence: String(it.evidence || "")
        };
      });
    });
    return persist(next);
  }

  function resetDefaults() {
    savedItems = null;
    return FRDB.kvSet("checklist", null).then(function () {
      rebuild();
      return sections;
    });
  }

  function customized() { return !!savedItems; }

  /* ---------------------------------------------------------- template */
  function template() { return clone(tpl); }

  function persistTpl(next) {
    savedTpl = next;
    return FRDB.kvSet("template", next).then(function () {
      rebuild();
      return sections;
    });
  }

  /* Every edit works on the resolved template, so the stored override is
     always complete and readable by a later version. */
  function editTemplate(fn) {
    var next = clone(tpl);
    fn(next);
    return persistTpl(next);
  }

  function optionValue(list, label) {
    var base = FRUtil.slugify(label, 20).replace(/-/g, "_");
    if (!base || base === "factory") base = "opt";
    var used = {}, v = base, n = 2;
    (list || []).forEach(function (o) { used[o[0]] = 1; });
    while (used[v]) { v = base + "_" + n; n++; }
    return v;
  }

  function ensureField(t, key) {
    if (!t.options[key]) t.options[key] = [];
    return t.options[key];
  }

  function addOption(key, label) {
    var text = String(label || "").trim() || "New option";
    return editTemplate(function (t) {
      var list = ensureField(t, key);
      list.push([optionValue(list, text), text]);
    });
  }

  function setOptionLabel(key, index, label) {
    var text = String(label || "").trim();
    if (!text) return Promise.resolve(sections);
    return editTemplate(function (t) {
      var list = ensureField(t, key);
      if (list[index]) list[index][1] = text;
    });
  }

  function removeOption(key, index) {
    return editTemplate(function (t) {
      var list = ensureField(t, key);
      if (index >= 0 && index < list.length) list.splice(index, 1);
    });
  }

  function moveOption(key, index, delta) {
    return editTemplate(function (t) {
      var list = ensureField(t, key);
      var to = index + delta;
      if (index < 0 || to < 0 || to >= list.length) return;
      var moved = list.splice(index, 1)[0];
      list.splice(to, 0, moved);
    });
  }

  function setFieldLabel(key, label) {
    var text = String(label || "").trim();
    if (!text) return Promise.resolve(sections);
    return editTemplate(function (t) {
      t.fields.forEach(function (f) { if (f.k === key) f.label = text; });
    });
  }

  function setSectionTitle(id, title) {
    var text = String(title || "").trim();
    if (!text) return Promise.resolve(sections);
    return editTemplate(function (t) {
      t.sections.forEach(function (s) { if (s.id === id) s.title = text; });
    });
  }

  function setStateLabel(key, label) {
    var text = String(label || "").trim();
    if (!text) return Promise.resolve(sections);
    return editTemplate(function (t) {
      t.states.forEach(function (s) { if (s.key === key) s.label = text; });
    });
  }

  function addKind(label) {
    var text = String(label || "").trim() || "New category";
    return editTemplate(function (t) {
      t.photoKinds.push([optionValue(t.photoKinds, text), text]);
    });
  }

  function setKindLabel(index, label) {
    var text = String(label || "").trim();
    if (!text) return Promise.resolve(sections);
    return editTemplate(function (t) {
      if (t.photoKinds[index]) t.photoKinds[index][1] = text;
    });
  }

  function removeKind(index) {
    return editTemplate(function (t) {
      if (index >= 0 && index < t.photoKinds.length) t.photoKinds.splice(index, 1);
    });
  }

  function moveKind(index, delta) {
    return editTemplate(function (t) {
      var to = index + delta;
      if (index < 0 || to < 0 || to >= t.photoKinds.length) return;
      var moved = t.photoKinds.splice(index, 1)[0];
      t.photoKinds.splice(to, 0, moved);
    });
  }

  function kindLabel(value) {
    var hit = photoKinds().filter(function (k) { return String(k[0]) === String(value); })[0];
    return hit ? hit[1] : String(value || "Other").replace(/_/g, " ");
  }

  function resetTemplate() {
    savedTpl = null;
    return FRDB.kvSet("template", null).then(function () {
      rebuild();
      return sections;
    });
  }

  function customizedTemplate() { return !!savedTpl; }

  return {
    load: load,
    data: data,
    version: version,
    sections: sectionsView,
    visibleSections: visibleSections,
    section: section,
    states: states,
    photoKinds: photoKinds,
    kindLabel: kindLabel,
    sectionItems: sectionItems,
    item: item,
    field: field,
    fields: fields,
    itemIds: itemIds,
    editableSections: editableSections,
    addItem: addItem,
    updateItem: updateItem,
    removeItem: removeItem,
    moveItem: moveItem,
    saveAll: saveAll,
    resetDefaults: resetDefaults,
    snapshot: snapshot,
    customized: customized,
    /* template */
    template: template,
    addOption: addOption,
    setOptionLabel: setOptionLabel,
    removeOption: removeOption,
    moveOption: moveOption,
    setFieldLabel: setFieldLabel,
    setSectionTitle: setSectionTitle,
    setStateLabel: setStateLabel,
    addKind: addKind,
    setKindLabel: setKindLabel,
    removeKind: removeKind,
    moveKind: moveKind,
    resetTemplate: resetTemplate,
    customizedTemplate: customizedTemplate
  };
})();
