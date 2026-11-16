// Almacenamiento local (IndexedDB). Todo queda en el navegador de cada persona.
import { openDB } from 'idb';

let dbp;
const db = () =>
  (dbp ||= openDB('obra-sechura', 1, {
    upgrade(d) {
      d.createObjectStore('items', { keyPath: 'id' });
      d.createObjectStore('meta');
    },
  }));

export const saveItem = async (item) => (await db()).put('items', item);
export const deleteItem = async (id) => (await db()).delete('items', id);
export const allItems = async () => (await db()).getAll('items');
export const setMeta = async (k, v) => (await db()).put('meta', v, k);
export const getMeta = async (k) => (await db()).get('meta', k);
export const clearAll = async () => {
  const d = await db();
  await d.clear('items');
  await d.clear('meta');
};
