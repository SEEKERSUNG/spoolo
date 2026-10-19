/* SPOOLO · 影集存储：IndexedDB（不可用时退回内存）
 * - 列表只返回元数据 + 缩略图，原图在开灯箱时按 id 按需读取
 * - 写失败的照片先留在内存里并继续参与列表；读失败时用上次成功的快照兜底
 * - 这样 IndexedDB 出问题时不会把已经存下来的影集“切没”
 */
(function (global) {
  'use strict';

  var DB = 'spoolo', VER = 1, STORE = 'frames';
  var dbp = null, memory = [], cache = [];
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

  /* 列表数据：去掉原图 Blob，只留缩略图与元数据 */
  function meta(row) {
    var out = {};
    for (var k in row) if (k !== 'blob') out[k] = row[k];
    return out;
  }

  /* 逐条游标读取：列表不再一次把每张原图都读进来 */
  function readAll() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var rows = [];
        var t = db.transaction(STORE, 'readonly');
        var req = t.objectStore(STORE).openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (!cur) {
            rows.sort(function (a, b) { return b.ts - a.ts; });
            resolve(rows);
            return;
          }
          rows.push(meta(cur.value || {}));
          cur.continue();
        };
        req.onerror = function () { reject(req.error); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  /* 库内行 + 内存中尚未落盘的行：按 id 去重（内存优先），按时间倒序 */
  function mergeRows(dbRows) {
    var map = Object.create(null), out = [], id;
    dbRows.forEach(function (r) { if (r && r.id != null) map[r.id] = r; });
    memory.forEach(function (r) { if (r && r.id != null) map[r.id] = r; });
    for (id in map) out.push(map[id]);
    out.sort(function (a, b) { return b.ts - a.ts; });
    return out.map(meta);
  }

  var Store = {
    /* 最近一次 add 是否真的写进了 IndexedDB；false 表示只在本次会话的内存里 */
    lastAddPersisted: null,

    add: function (frame) {
      if (memOnly) {
        memory.unshift(frame);
        Store.lastAddPersisted = false;
        return Promise.resolve(frame.id);
      }
      return tx('readwrite', function (os) { os.put(frame); })
        .then(function () {
          Store.lastAddPersisted = true;
          /* 把新行同步进兜底快照，避免“刚写成功又立刻读失败”时短暂看不见它 */
          var m = meta(frame), hit = false;
          for (var i = 0; i < cache.length; i++) {
            if (cache[i].id === m.id) { cache[i] = m; hit = true; break; }
          }
          if (!hit) cache.push(m);
          return frame.id;
        })
        .catch(function () {
          /* 写失败也先放进内存，本次会话仍能看能开；读路径继续读库 */
          memory.unshift(frame);
          Store.lastAddPersisted = false;
          return frame.id;
        });
    },

    all: function () {
      if (memOnly) return Promise.resolve(mergeRows([]));
      return readAll().then(function (rows) {
        cache = rows;
        return mergeRows(rows);
      }).catch(function () {
        /* 读失败时用上次成功的快照兜底，不把库里的照片切没 */
        return mergeRows(cache);
      });
    },

    get: function (id) {
      for (var i = 0; i < memory.length; i++) {
        if (memory[i].id === id) return Promise.resolve(memory[i]);
      }
      if (memOnly) return Promise.resolve(null);
      return tx('readonly', function (os) { return os.get(id); })
        .catch(function () { return null; });
    },

    /* 只更新已有记录（用于旧缩略图重建）；不改 lastAddPersisted。
       先读再写：如果照片在重建期间被删掉，不能把它写回来。 */
    update: function (row) {
      var replaced = false;
      memory = memory.map(function (f) {
        if (f.id === row.id) { replaced = true; return row; }
        return f;
      });
      if (memOnly) return Promise.resolve(replaced);
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var found = false;
          var t = db.transaction(STORE, 'readwrite');
          var os = t.objectStore(STORE);
          var req = os.get(row.id);
          req.onsuccess = function () {
            if (req.result) { found = true; os.put(row); }
          };
          t.oncomplete = function () { resolve(found); };
          t.onerror = function () { reject(t.error); };
          t.onabort = function () { reject(t.error); };
        });
      }).then(function (found) {
        if (found) {
          var m = meta(row), hit = false;
          for (var i = 0; i < cache.length; i++) {
            if (cache[i].id === m.id) { cache[i] = m; hit = true; break; }
          }
          if (!hit) cache.push(m);
        }
        return found || replaced;
      }).catch(function () { return replaced; });
    },

    remove: function (id) {
      var inMemory = false;
      memory = memory.filter(function (f) {
        if (f.id === id) { inMemory = true; return false; }
        return true;
      });
      if (memOnly) return Promise.resolve();
      return tx('readwrite', function (os) { os.delete(id); })
        .then(function () {
          cache = cache.filter(function (r) { return r.id !== id; });
        })
        .catch(function (err) {
          /* 内存行删除可以容忍库不可用；库里的行删不掉要如实报错 */
          if (inMemory) {
            cache = cache.filter(function (r) { return r.id !== id; });
            return;
          }
          throw err;
        });
    }
  };

  global.SPOOLO = global.SPOOLO || {};
  global.SPOOLO.Store = Store;
})(window);
