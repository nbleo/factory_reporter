/* Photo capture: resize, thumbnail, hash, store. */
window.FRPhotos = (function () {
  "use strict";

  var urlCache = {};

  function loadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" })
        .catch(function () { return createImageBitmap(file); })
        .catch(function () { return loadViaImg(file); });
    }
    return loadViaImg(file);
  }

  function loadViaImg(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Cannot read image")); };
      img.src = url;
    });
  }

  function drawToBlob(src, sw, sh, maxSide, quality) {
    var scale = Math.min(1, maxSide / Math.max(sw, sh));
    var w = Math.max(1, Math.round(sw * scale));
    var h = Math.max(1, Math.round(sh * scale));
    var canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) return resolve({ blob: blob, w: w, h: h });
        canvas.toBlob(function (b2) {
          if (b2) resolve({ blob: b2, w: w, h: h });
          else reject(new Error("Image encoding failed"));
        }, "image/jpeg", 0.8);
      }, "image/jpeg", quality);
    });
  }

  /* Longest side 1600 px, JPEG q0.78 - enough for a printed A4 appendix. */
  function compress(file, maxSide, quality) {
    return loadImage(file).then(function (src) {
      var w = src.width || src.naturalWidth;
      var h = src.height || src.naturalHeight;
      return drawToBlob(src, w, h, maxSide || 1600, quality || 0.78).then(function (out) {
        out.blob = out.blob.type === "image/jpeg" ? out.blob : out.blob;
        return out;
      });
    });
  }

  function thumb(blob) {
    return loadImage(blob).then(function (src) {
      var w = src.width || src.naturalWidth;
      var h = src.height || src.naturalHeight;
      return drawToBlob(src, w, h, 320, 0.7);
    });
  }

  function sha256(blob) {
    if (!window.crypto || !window.crypto.subtle || !blob.arrayBuffer) return Promise.resolve("");
    return blob.arrayBuffer().then(function (buf) {
      return window.crypto.subtle.digest("SHA-256", buf);
    }).then(function (hash) {
      var bytes = new Uint8Array(hash), out = "", i;
      for (i = 0; i < bytes.length; i++) out += ("0" + bytes[i].toString(16)).slice(-2);
      return out;
    }).catch(function () { return ""; });
  }

  function addFiles(report, files, opts) {
    opts = opts || {};
    var list = Array.prototype.slice.call(files || []);
    var added = [];
    var chain = Promise.resolve();

    list.forEach(function (file) {
      chain = chain.then(function () {
        return compress(file).then(function (c) {
          return thumb(c.blob).then(function (t) {
            return sha256(c.blob).then(function (hash) {
              var meta = {
                id: "p-" + FRUtil.uid(8),
                reportId: report.id,
                itemId: opts.itemId || null,
                kind: opts.kind || "other",
                caption: "",
                w: c.w, h: c.h, size: c.blob.size,
                thumbSize: t.blob.size,
                sha256: hash,
                createdAt: FRUtil.now()
              };
              return FRDB.put("photos", {
                id: meta.id, reportId: report.id, itemId: meta.itemId, kind: meta.kind,
                caption: "", w: meta.w, h: meta.h, size: meta.size, thumbSize: meta.thumbSize,
                sha256: hash, createdAt: meta.createdAt,
                blob: c.blob, thumbBlob: t.blob
              }).then(function () {
                report.photos.push(meta);
                if (opts.itemId) {
                  var a = FRModel.answer(report, opts.itemId);
                  if (a.photoIds.indexOf(meta.id) === -1) a.photoIds.push(meta.id);
                }
                added.push(meta);
              });
            });
          });
        });
      });
    });

    return chain.then(function () { return added; });
  }

  function blobOf(photoId) {
    return FRDB.get("photos", photoId);
  }

  function thumbUrl(photoId) {
    if (urlCache[photoId]) return Promise.resolve(urlCache[photoId]);
    return blobOf(photoId).then(function (row) {
      var blob = row && (row.thumbBlob || row.blob);
      if (!blob) return "";
      var url = URL.createObjectURL(blob);
      urlCache[photoId] = url;
      return url;
    });
  }

  function fullUrl(photoId) {
    return blobOf(photoId).then(function (row) {
      if (!row || !row.blob) return "";
      return URL.createObjectURL(row.blob);
    });
  }

  function remove(report, photoId) {
    report.photos = report.photos.filter(function (p) { return p.id !== photoId; });
    Object.keys(report.answers || {}).forEach(function (cid) {
      var a = report.answers[cid];
      if (a && Array.isArray(a.photoIds)) {
        a.photoIds = a.photoIds.filter(function (id) { return id !== photoId; });
      }
    });
    if (urlCache[photoId]) { URL.revokeObjectURL(urlCache[photoId]); delete urlCache[photoId]; }
    return FRDB.del("photos", photoId);
  }

  function saveToGallery(blob, name) {
    try {
      if (navigator.canShare) {
        var file = new File([blob], name || "photo.jpg", { type: "image/jpeg" });
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file] }).catch(function () {});
        }
      }
    } catch (e) { /* fall through */ }
    FRUtil.download(blob, name || "photo.jpg");
    return Promise.resolve();
  }

  return {
    compress: compress, thumb: thumb, sha256: sha256,
    addFiles: addFiles, blobOf: blobOf, thumbUrl: thumbUrl, fullUrl: fullUrl,
    remove: remove, saveToGallery: saveToGallery
  };
})();
