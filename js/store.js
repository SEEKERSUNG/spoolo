/* SPOOLO · 影集存储：IndexedDB（不可用时退回内存） */
(function (global) {
  'use strict';

  var DB = 'spoolo', VER = 1, STORE = 'frames';
  var dbp = null, memory = [], useMemory = false;
  var memOnly = typeof indexedDB === 'undefined';

  function openDB() {
    if (memOnly) return Promise.reject(new Error('no-idb'));
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('ts', 'ts');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var os = t.objectStore(STORE);
        var out = fn(os);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  var Store = {
    available: function () { return !useMemory; },

    add: function (frame) {
      if (useMemory) {
        memory.unshift(frame);
        return Promise.resolve(frame.id);
      }
      return tx('readwrite', function (os) { os.put(frame); })
        .then(function () { return frame.id; })
        .catch(function () { useMemory = true; memory.unshift(frame); return frame.id; });
    },

    all: function () {
      if (useMemory) return Promise.resolve(memory.slice());
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var os = db.transaction(STORE, 'readonly').objectStore(STORE);
          var req = os.getAll();
          req.onsuccess = function () {
            var rows = req.result || [];
            rows.sort(function (a, b) { return b.ts - a.ts; });
            resolve(rows);
          };
          req.onerror = function () { reject(req.error); };
        });
      }).catch(function () { useMemory = true; return memory.slice(); });
    },

    get: function (id) {
      if (useMemory) {
        for (var i = 0; i < memory.length; i++) if (memory[i].id === id) return Promise.resolve(memory[i]);
        return Promise.resolve(null);
      }
      return tx('readonly', function (os) { return os.get(id); });
    },

    remove: function (id) {
      if (useMemory) {
        memory = memory.filter(function (f) { return f.id !== id; });
        return Promise.resolve();
      }
      return tx('readwrite', function (os) { os.delete(id); });
    },

    clear: function () {
      if (useMemory) { memory = []; return Promise.resolve(); }
      return tx('readwrite', function (os) { os.clear(); });
    },

    /* 估算已占用空间（字节） */
    estimate: function () {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then(function (e) {
          return { usage: e.usage || 0, quota: e.quota || 0 };
        }).catch(function () { return null; });
      }
      return Promise.resolve(null);
    }
  };

  global.SPOOLO = global.SPOOLO || {};
  global.SPOOLO.Store = Store;
})(window);
