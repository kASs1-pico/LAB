/* Local gallery. Project records and version 1 checkpoints keep their original schema. */
(function (global) {
  'use strict';

  const databaseName = 'drawing-lab-projects';
  const objectStoreName = 'projects';
  let connection;

  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore(objectStoreName, {keyPath: 'id'});
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Хранилище занято другой вкладкой.'));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    }).catch(error => { connection = null; throw error; });
    return connection;
  }

  async function transact(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(objectStoreName, mode);
      let result;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || new Error('Изменение галереи отменено.'));
      const fail = error => {
        reject(error);
        transaction.abort();
      };
      try {
        work(transaction.objectStore(objectStoreName), value => { result = value; }, fail);
      } catch (error) { fail(error); }
    });
  }

  function get(id) {
    return transact('readonly', (store, finish) => {
      const request = store.get(id);
      request.onsuccess = () => finish(request.result);
    });
  }

  function cards(makeThumbnail) {
    // A cursor releases full projects one at a time. The UI retains only compact previews
    // and checkpoint labels, and fetches the chosen document when the user opens it.
    return transact('readonly', (store, finish, fail) => {
      const result = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { finish(result); return; }
        try {
          const {id, name, updated, project, checkpoints} = cursor.value;
          result.push({id, name, updated, thumbnail: makeThumbnail(project),
            checkpoints: checkpoints.map(({name, created}) => ({name, created}))});
          cursor.continue();
        } catch (error) { fail(error); }
      };
    });
  }

  function all() {
    return transact('readonly', (store, finish) => {
      const request = store.getAll();
      request.onsuccess = () => finish(request.result);
    });
  }

  function insert(records) {
    return transact('readwrite', store => { for (const record of records) store.add(record); });
  }

  function remove(id) {
    return transact('readwrite', store => store.delete(id));
  }

  function update(id, change) {
    return transact('readwrite', (store, finish, fail) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const record = request.result;
          if (!record) throw new Error('Проект удалён в другой вкладке.');
          change(record);
          store.put(record);
        } catch (error) { fail(error); }
      };
    });
  }

  global.LabGalleryStore = Object.freeze({open, get, cards, all, insert, update, remove});
})(window);
