import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { saveItem, deleteItem, allItems, setMeta, getMeta, clearAll } from './db.js';
import { extractFields, findDuplicate } from './extract.js';
import { firebaseConfig } from './firebase-config.js';
import { compressDataUrl, bufToB64, b64ToBuf } from './img.js';

const money = (n) => 'S/ ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isValidAmount = (s) => Number.isFinite(parseFloat(s)) && parseFloat(s) > 0;
const pad = (n) => String(n).padStart(2, '0');
const MAX_EXCEL_B64 = 900_000; // límite de Firestore: 1 MiB por documento

function useObjectUrl(blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) return undefined;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="11" fill="#0b2a5b" />
      <path d="M10 36h28M14 36V22l10-8 10 8v14M20 36v-8h8v8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="37" cy="12" r="4.5" fill="#f2b705" />
    </svg>
  );
}

const STATUS_LABEL = { pending: 'En cola', processing: 'Procesando…', error: 'Error', OK: 'Reconocido', REVISAR: 'Revisar' };

function Thumb({ blob, onOpen }) {
  const url = useObjectUrl(blob);
  return url ? <img className="thumb" src={url} alt="Comprobante" onClick={() => onOpen(url)} /> : <div className="thumb empty" />;
}

function ItemRow({ item, itemNo, dup, onChange, onDelete, onOpen, onRetry }) {
  const [edit, setEdit] = useState(false);
  const photoUrl = useObjectUrl(item.image);
  const f = item.fields;
  const st = item.status === 'done' ? item.result : item.status;
  const set = (k, v) => onChange({ fields: { ...f, [k]: v } });
  const cell = (k, type = 'text', extra = {}) =>
    edit ? <input type={type} value={f[k] || ''} onChange={(e) => set(k, e.target.value)} {...extra} /> : <span>{k === 'fecha' ? fmtDate(f[k]) : k === 'egreso' ? (f[k] ? money(f[k]) : '') : f[k]}</span>;
  return (
    <tr className={`row ${st}`}>
      <td data-label="Ítem" className="itemno">{itemNo ? <b>{pad(itemNo)}</b> : <span className="muted" title="Sin ítem hasta que tenga importe válido y no sea duplicado sin autorizar">—</span>}</td>
      <td data-label="Comprobante"><Thumb blob={item.image} onOpen={onOpen} /><div className="fname">{item.name}</div></td>
      <td data-label="Fecha">{cell('fecha', 'date')}</td>
      <td data-label="N° comprobante">{!edit && photoUrl && item.fields.numero ? <button className="linklike" title="Ver la foto del comprobante" onClick={() => onOpen(photoUrl)}>{item.fields.numero}</button> : cell('numero')}</td>
      <td data-label="Beneficiario / proveedor">{cell('proveedor')}</td>
      <td data-label="Concepto">{edit ? <textarea rows={Math.max(3, (f.concepto || '').split('\n').length)} value={f.concepto || ''} onChange={(e) => set('concepto', e.target.value)} /> : <span className="concept">{f.concepto}</span>}</td>
      <td data-label="Egreso (-)" className="num">{cell('egreso', 'text', { inputMode: 'decimal' })}</td>
      <td data-label="Estado">
        <span className={`badge ${st}`}>{STATUS_LABEL[st] || st}{item.tipo ? ` · ${item.tipo}` : ''}</span>
        {item.status === 'processing' && <div className="mini"><i style={{ width: `${Math.round((item.progress || 0) * 100)}%` }} /></div>}
        {item.error && <div className="warn">{item.error}</div>}
        {item.warnings?.map((w, i) => <div className="warn" key={i}>⚠ {w}</div>)}
        {dup && (
          <div className="dup">
            ADVERTENCIA: ESTE COMPROBANTE PODRÍA ESTAR REGISTRADO ANTERIORMENTE <small>({dup})</small>
            <label><input type="checkbox" checked={!!item.dupOk} onChange={(e) => onChange({ dupOk: e.target.checked })} /> Registrar de todos modos</label>
          </div>
        )}
        {edit && item.text && <details><summary>Texto reconocido</summary><pre>{item.text}</pre></details>}
      </td>
      <td data-label="Acciones" className="actions">
        {item.status === 'error' && <button className="btn sm" onClick={onRetry}>Reintentar</button>}
        <button className="btn sm" onClick={() => setEdit(!edit)}>{edit ? 'LISTO' : 'EDITAR'}</button>
        <button className="btn sm danger" onClick={onDelete}>ELIMINAR</button>
      </td>
    </tr>
  );
}

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'No existe una cuenta con ese correo.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Inicie sesión.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/too-many-requests': 'Demasiados intentos. Espere unos minutos e inténtelo de nuevo.',
  'auth/network-request-failed': 'Sin conexión a internet.',
  'auth/operation-not-allowed': 'El inicio de sesión con correo no está activado en el proyecto.',
  'auth/unauthorized-domain': 'Este sitio no está autorizado en el proyecto de Firebase.',
};

function AuthModal({ cloud, onClose, onDone }) {
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const fail = (e) => setErr(AUTH_ERRORS[e?.code] || `No se pudo completar (${e?.code || e?.message || 'error'}).`);
  const submit = async (ev) => {
    ev.preventDefault();
    setErr(''); setInfo('');
    if (mode === 'up' && !ok) return setErr('Debe aceptar el guardado de sus datos en la nube para crear la cuenta.');
    setBusy(true);
    try {
      await (mode === 'up' ? cloud.signUp(email.trim(), pass) : cloud.signIn(email.trim(), pass));
      onDone(mode === 'up');
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const reset = async () => {
    setErr(''); setInfo('');
    if (!email.trim()) return setErr('Escriba su correo y vuelva a presionar “Olvidé mi contraseña”.');
    try { await cloud.resetPassword(email.trim()); setInfo('Le enviamos un correo para crear una contraseña nueva (revise también Spam).'); } catch (e) { fail(e); }
  };
  return (
    <div className="modal auth" onClick={onClose}>
      <form className="authbox" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="tabs">
          <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => { setMode('in'); setErr(''); }}>Iniciar sesión</button>
          <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => { setMode('up'); setErr(''); }}>Crear cuenta</button>
        </div>
        <label>Correo<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Contraseña<input type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} minLength={6} required value={pass} onChange={(e) => setPass(e.target.value)} /></label>
        {mode === 'up' && (
          <label className="consent">
            <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
            <span>Acepto que mis gastos registrados, la foto comprimida de cada comprobante y mi Excel se guarden en mi cuenta en Firebase (Google) para verlos desde cualquier dispositivo. La lectura OCR se sigue haciendo en mi dispositivo y nunca guardamos mi contraseña.</span>
          </label>
        )}
        {err && <div className="msg err">{err}</div>}
        {info && <div className="msg">{info}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Un momento…' : mode === 'up' ? 'CREAR CUENTA' : 'ENTRAR'}</button>
        {mode === 'in' && <button type="button" className="link plain" onClick={reset}>Olvidé mi contraseña</button>}
        <button type="button" className="link plain" onClick={onClose}>Seguir sin cuenta</button>
      </form>
    </div>
  );
}

export default function App() {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [excel, setExcel] = useState(null); // {name, buffer, info, updatedAt}
  const [registered, setRegistered] = useState([]); // registrados, aún no descargados en Excel
  const [history, setHistory] = useState([]);
  const [q, setQ] = useState('');
  const [hf, setHf] = useState('todos');
  const [running, setRunning] = useState(false);
  const [ocrState, setOcrState] = useState('idle');
  const [msg, setMsg] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [zoom, setZoom] = useState(false);
  const [drag, setDrag] = useState(false);
  const [user, setUser] = useState(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const historyRef = useRef(history);
  historyRef.current = history;
  const excelRef = useRef(excel);
  excelRef.current = excel;
  const cloud = useRef(null);
  const saved = useRef(new Map());
  const stop = useRef(false);

  // Restaurar trabajo pendiente tras recargar
  useEffect(() => {
    (async () => {
      try {
        const [its, ex, reg, hist] = await Promise.all([allItems(), getMeta('excel'), getMeta('registered'), getMeta('history')]);
        its.forEach((i) => saved.current.set(i.id, i));
        setItems(its.map((i) => (i.status === 'processing' ? { ...i, status: 'pending' } : i)).sort((a, b) => a.createdAt - b.createdAt));
        if (ex) setExcel(ex);
        if (reg) setRegistered(reg);
        if (hist) setHistory(hist);
      } catch (e) { console.warn('IndexedDB no disponible', e); }
      setLoaded(true);
    })();
  }, []);

  // Persistir cambios (solo elementos modificados)
  useEffect(() => {
    if (!loaded) return;
    const ids = new Set(items.map((i) => i.id));
    for (const it of items) {
      if (saved.current.get(it.id) !== it && it.status !== 'processing') { saved.current.set(it.id, it); saveItem(it).catch(() => {}); }
    }
    for (const id of [...saved.current.keys()]) if (!ids.has(id)) { saved.current.delete(id); deleteItem(id).catch(() => {}); }
  }, [items, loaded]);
  useEffect(() => { if (loaded) setMeta('registered', registered).catch(() => {}); }, [registered, loaded]);
  useEffect(() => { if (loaded) setMeta('excel', excel).catch(() => {}); }, [excel, loaded]);
  useEffect(() => { if (loaded) setMeta('history', history).catch(() => {}); }, [history, loaded]);

  // Precarga del motor OCR en segundo plano (queda en caché para uso sin conexión)
  useEffect(() => {
    if (!loaded) return undefined;
    const t = setTimeout(async () => {
      setOcrState('loading');
      try { const { getWorker } = await import('./ocr.js'); await getWorker(); setOcrState('ready'); } catch { setOcrState('error'); }
    }, 800);
    return () => clearTimeout(t);
  }, [loaded]);

  // ---------- Cuentas / nube ----------
  useEffect(() => {
    if (!loaded || !firebaseConfig) return undefined;
    let unsub;
    (async () => {
      try {
        const c = await import('./cloud.js');
        c.initCloud();
        cloud.current = c;
        setCloudReady(true);
        unsub = c.onUser((u) => setUser(u ? { uid: u.uid, email: u.email } : null));
      } catch (e) { console.warn('Nube no disponible', e); }
    })();
    return () => unsub && unsub();
  }, [loaded]);

  const wipeLocal = useCallback(async () => {
    await clearAll();
    saved.current.clear();
    setItems([]); setRegistered([]); setExcel(null); setHistory([]);
  }, []);

  useEffect(() => {
    if (!cloudReady || !user) return undefined;
    const c = cloud.current;
    let u1, u2, dead = false;
    (async () => {
      const owner = await getMeta('owner');
      if (owner && owner !== user.uid) await wipeLocal(); // datos locales de otra persona: no se mezclan
      else if (owner !== user.uid && historyRef.current.length) {
        // trabajo hecho sin cuenta: se sube a la cuenta que inicia sesión
        for (const e of historyRef.current) c.saveGasto(user.uid, e).catch(() => {});
        setMsg({ t: 'ok', s: `Se guardaron en su cuenta ${historyRef.current.length} gasto(s) que había registrado en este dispositivo.` });
      }
      if (dead) return;
      await setMeta('owner', user.uid);
      u1 = c.subscribeGastos(user.uid, (list) => {
        list.sort((a, b) => (b.registeredAt || 0) - (a.registeredAt || 0));
        setHistory(list);
        setRegistered(list.filter((e) => !e.exported).sort((a, b) => a.registeredAt - b.registeredAt));
      }, (e) => setMsg({ t: 'err', s: 'No se pudo leer su cuenta: ' + (e?.code || e?.message) }));
      u2 = c.subscribeExcel(user.uid, async (d) => {
        const cur = excelRef.current;
        if (!d) { if (cur) pushExcel(cur); return; }
        if (cur && (cur.updatedAt || 0) >= d.updatedAt) return;
        try {
          const { readExcel } = await import('./excel.js');
          const buffer = b64ToBuf(d.data);
          setExcel({ name: d.name, buffer, info: await readExcel(buffer.slice(0)), updatedAt: d.updatedAt });
        } catch (e) { console.warn('Excel de la nube ilegible', e); }
      }, () => {});
    })();
    return () => { dead = true; u1 && u1(); u2 && u2(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudReady, user?.uid]);

  const pushExcel = (x) => {
    if (!user || !cloud.current) return;
    const data = bufToB64(x.buffer);
    if (data.length > MAX_EXCEL_B64) return setMsg({ t: 'warn', s: 'Su Excel es demasiado grande para guardarse en la nube (máx. ~650 KB); quedará solo en este dispositivo.' });
    cloud.current.saveExcel(user.uid, { name: x.name, data, updatedAt: x.updatedAt || Date.now() }).catch(() => {});
  };
  const cloudSave = (entries) => user && cloud.current && entries.forEach((e) => cloud.current.saveGasto(user.uid, e).catch((er) => setMsg({ t: 'err', s: 'No se pudo guardar en la nube: ' + (er?.code || er?.message) })));

  const logout = async () => {
    if (!window.confirm('Se cerrará la sesión y se quitarán de este dispositivo los datos locales (siguen guardados en su cuenta). ¿Continuar?')) return;
    await cloud.current.signOut();
    await wipeLocal();
    setUser(null);
    setMsg({ t: 'ok', s: 'Sesión cerrada. Este dispositivo quedó limpio.' });
  };

  const patch = useCallback((id, p) => setItems((arr) => arr.map((i) => (i.id === id ? { ...i, ...p } : i))), []);

  const addFiles = (files) => {
    const ok = [...files].filter((f) => /^image\//.test(f.type) || f.type === 'application/pdf' || /\.(pdf|jpe?g|png|webp|heic|bmp)$/i.test(f.name));
    if (!ok.length) return setMsg({ t: 'warn', s: 'Seleccione imágenes (JPG, PNG…) o archivos PDF.' });
    const now = Date.now();
    setItems((arr) => [...arr, ...ok.map((file, n) => ({ id: uid(), name: file.name, createdAt: now + n, status: 'pending', file, image: null, fields: { fecha: '', numero: '', proveedor: '', concepto: '', egreso: '' }, warnings: [] }))]);
    setMsg({ t: 'ok', s: `${ok.length} archivo(s) agregado(s). Presione PROCESAR COMPROBANTES.` });
  };

  const processAll = async () => {
    if (running) return;
    setRunning(true);
    stop.current = false;
    const { recognizeFile } = await import('./ocr.js');
    setOcrState('loading');
    for (;;) {
      const next = itemsRef.current.find((i) => i.status === 'pending' && i.file);
      if (!next || stop.current) break;
      patch(next.id, { status: 'processing', progress: 0, error: null });
      try {
        const r = await recognizeFile(next.file, (p) => patch(next.id, { progress: p }));
        setOcrState('ready');
        const x = extractFields(r.text, r.confidence);
        if (x.status === 'ERROR') { patch(next.id, { status: 'error', error: 'No se detectó texto. Pruebe con una foto más nítida y con buena luz.', image: r.image }); continue; }
        patch(next.id, { status: 'done', result: x.status, fields: x.fields, tipo: x.tipo, warnings: x.warnings, conf: r.confidence, method: r.method, text: r.text, image: r.image, file: null, progress: 1 });
      } catch (e) {
        console.error(e);
        patch(next.id, { status: 'error', error: 'No se pudo leer este archivo: ' + (e?.message || e) });
      }
    }
    setRunning(false);
  };

  const orphan = items.filter((i) => i.status === 'pending' && !i.file);
  const retry = (it) => (it.file ? patch(it.id, { status: 'pending', error: null }) : setMsg({ t: 'warn', s: `Para reintentar "${it.name}", elimínelo y vuelva a subirlo.` }));

  // Duplicados: contra el Excel importado, el historial y otros de la lista
  const dups = useMemo(() => {
    const out = {};
    const base = [...(excel?.info?.records || []), ...history.map((r) => ({ ...r, origen: `historial (registrado el ${new Date(r.registeredAt).toLocaleDateString('es-PE')})` }))];
    const seen = [];
    for (const it of items) {
      if (it.status !== 'done') continue;
      const d = findDuplicate(it.fields, [...base, ...seen]);
      if (d) out[it.id] = d;
      seen.push({ ...it.fields, origen: `otro comprobante de la lista (${it.name})` });
    }
    return out;
  }, [items, excel, history]);

  // ---------- Numeración de ítems ----------
  // Cada comprobante listo recibe el siguiente ítem libre (continuando el Excel y lo ya registrado).
  const baseItem = excel?.info?.nextItem ?? 1;
  const eligible = (i) => i.status === 'done' && isValidAmount(i.fields.egreso) && (!dups[i.id] || i.dupOk);
  const itemNo = useMemo(() => {
    const m = {};
    let n = baseItem + registered.length;
    for (const i of items) if (eligible(i)) m[i.id] = n++;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, dups, baseItem, registered.length]);
  const pendNo = useMemo(() => {
    const m = {};
    [...registered].sort((a, b) => a.registeredAt - b.registeredAt).forEach((r, k) => { m[r.hid] = baseItem + k; });
    return m;
  }, [registered, baseItem]);
  const histNo = (e) => (e.exported ? e.item : pendNo[e.hid]);

  const done = items.filter((i) => i.status === 'done');
  const stats = {
    total: items.length,
    procesados: done.length,
    pendientes: items.filter((i) => i.status === 'pending' || i.status === 'processing').length,
    errores: items.filter((i) => i.status === 'error').length,
    detectado: done.reduce((s, i) => s + (parseFloat(i.fields.egreso) || 0), 0),
  };
  const acumulado = (excel?.info?.total || 0) + registered.reduce((s, r) => s + (parseFloat(r.egreso) || 0), 0);
  const progressPct = stats.total ? Math.round(((stats.procesados + stats.errores) / stats.total) * 100) : 0;

  const confirm_ = async () => {
    const ready = items.filter(eligible);
    const skippedDup = done.filter((i) => dups[i.id] && !i.dupOk).length;
    const skippedAmt = done.filter((i) => !isValidAmount(i.fields.egreso)).length;
    if (!ready.length) return setMsg({ t: 'warn', s: `No hay comprobantes listos para registrar (${skippedDup} duplicado(s) sin autorizar, ${skippedAmt} sin importe válido).` });
    const total = ready.reduce((s, i) => s + parseFloat(i.fields.egreso), 0);
    const incomplete = ready.filter((i) => !i.fields.fecha || !i.fields.numero || !i.fields.proveedor).length;
    const q_ = `¿Registrar ${ready.length} gasto(s) por ${money(total)}?` + (incomplete ? `\n${incomplete} tiene(n) campos vacíos.` : '') + (skippedDup + skippedAmt ? `\nSe omitirán ${skippedDup} duplicado(s) y ${skippedAmt} sin importe.` : '');
    if (!window.confirm(q_)) return;
    const now = Date.now();
    const recs = [];
    for (const [k, i] of ready.entries()) {
      let img = '';
      try { img = i.image ? await compressDataUrl(i.image) : ''; } catch { /* sin foto */ }
      recs.push({ hid: uid(), ...i.fields, egreso: parseFloat(i.fields.egreso).toFixed(2), tipo: i.tipo || '', archivo: i.name, img, registeredAt: now + k, exported: false });
    }
    setRegistered((r) => [...r, ...recs]);
    setHistory((h) => [...recs.slice().reverse(), ...h]);
    cloudSave(recs);
    const ids = new Set(ready.map((i) => i.id));
    setItems((arr) => arr.filter((i) => !ids.has(i.id)));
    setMsg({ t: 'ok', s: `${ready.length} gasto(s) registrado(s) con su foto e ítem ${pad(baseItem + registered.length)}–${pad(baseItem + registered.length + ready.length - 1)}. Descargue el Excel actualizado cuando termine.` });
  };

  const importExcel = async (file) => {
    if (!file) return;
    try {
      const { readExcel } = await import('./excel.js');
      const buffer = await file.arrayBuffer();
      const info = await readExcel(buffer.slice(0));
      const x = { name: file.name, buffer, info, updatedAt: Date.now() };
      setExcel(x);
      pushExcel(x);
      setMsg({ t: 'ok', s: `Excel importado: ${info.count} registro(s) previos, total ${money(info.total)}. Próximo ítem: ${pad(info.nextItem)}.` });
    } catch (e) { setMsg({ t: 'err', s: e.message || 'No se pudo leer el Excel.' }); }
  };

  const download = async () => {
    try {
      const { appendRecords, readExcel } = await import('./excel.js');
      const ordered = [...registered].sort((a, b) => a.registeredAt - b.registeredAt);
      const { buffer } = await appendRecords(excel ? excel.buffer.slice(0) : null, ordered);
      const name = excel ? excel.name.replace(/(_actualizado)?\.xlsx?$/i, '') + '_actualizado.xlsx' : 'GASTOS_OBRA_SECHURA.xlsx';
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      const info = await readExcel(buffer.slice(0));
      const x = { name, buffer, info, updatedAt: Date.now() };
      setExcel(x);
      pushExcel(x);
      const mark = new Map(ordered.map((r, k) => [r.hid, baseItem + k]));
      const now = Date.now();
      const updated = history.filter((e) => mark.has(e.hid)).map((e) => ({ ...e, exported: true, exportedAt: now, file: name, item: mark.get(e.hid) }));
      setHistory((h) => h.map((e) => updated.find((u) => u.hid === e.hid) || e));
      cloudSave(updated);
      setRegistered([]);
      setMsg({ t: 'ok', s: `Descargado: ${name} (${info.count} registros). Este archivo es ahora la base de trabajo.` });
    } catch (e) { setMsg({ t: 'err', s: e.message || 'No se pudo generar el Excel.' }); }
  };

  const removeEntry = (e) => {
    if (!window.confirm('¿Quitar este gasto del historial? (No modifica un Excel ya descargado.)')) return;
    setHistory((h) => h.filter((x) => x.hid !== e.hid));
    setRegistered((a) => a.filter((r) => r.hid !== e.hid));
    if (user && cloud.current) cloud.current.deleteGasto(user.uid, e.hid).catch(() => {});
  };

  const wipe = async () => {
    if (user) {
      if (!window.confirm('Se borrarán los comprobantes pendientes de revisar en este dispositivo. Su historial y Excel guardados en la cuenta no se tocan. ¿Continuar?')) return;
      setItems([]);
      return setMsg({ t: 'ok', s: 'Se limpiaron los comprobantes pendientes.' });
    }
    if (!window.confirm('Se borrarán fotos, registros, historial y el Excel cargado de este navegador. ¿Continuar?')) return;
    await clearAll();
    saved.current.clear();
    setItems([]); setRegistered([]); setExcel(null); setHistory([]);
    setMsg({ t: 'ok', s: 'Se eliminó todo el trabajo guardado en este dispositivo.' });
  };

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return history.filter((e) => (hf === 'todos' || (hf === 'pendiente' ? !e.exported : e.exported)) && (!k || [e.numero, e.proveedor, e.concepto, e.fecha, fmtDate(e.fecha), e.egreso, e.item, e.archivo].join(' ').toLowerCase().includes(k)));
  }, [history, q, hf]);
  const shownTotal = shown.reduce((s, e) => s + (parseFloat(e.egreso) || 0), 0);
  const dayKey = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const dayLabel = (ms) => { const s = new Date(ms).toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const dayStats = useMemo(() => {
    const m = {};
    for (const e of shown) { const k = dayKey(e.registeredAt); (m[k] ||= { n: 0, total: 0 }); m[k].n++; m[k].total += parseFloat(e.egreso) || 0; }
    return m;
  }, [shown]);
  const fmtStamp = (ms) => new Date(ms).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  const csv = () => {
    const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' | ') + '"';
    const rows = [['Ítem', 'Registrado', 'Fecha', 'N° comprobante', 'Beneficiario/Proveedor', 'Concepto', 'Egreso (S/)', 'Estado']].concat(shown.map((e) => [histNo(e) ? pad(histNo(e)) : '', fmtStamp(e.registeredAt), fmtDate(e.fecha), e.numero, e.proveedor, e.concepto, e.egreso, e.exported ? 'En Excel descargado' : 'Pendiente de descargar']));
    const blob = new Blob([String.fromCharCode(0xfeff) + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'historial_gastos_obra_sechura.csv'; document.body.appendChild(a); a.click(); a.remove();
  };

  const open = (u) => { setViewer(u); setZoom(false); };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); };
  const pickRef = { one: useRef(), many: useRef(), pdf: useRef(), xls: useRef() };
  const pick = (ref, files) => { if (files?.length) addFiles(files); if (ref.current) ref.current.value = ''; };

  return (
    <div className="app">
      <header className="top">
        <Logo />
        <div className="title">
          <h1>CONTROL DE GASTOS – OBRA SECHURA</h1>
          <p>Fotografíe comprobantes, revise los datos y descargue su Excel actualizado.</p>
        </div>
        <div className="hdr-right">
          <span className={`chip ${ocrState}`} title="El OCR se ejecuta en este dispositivo">
            {{ idle: 'OCR en espera', loading: 'Preparando OCR…', ready: 'OCR listo · sin conexión', error: 'OCR no disponible (¿primera carga sin internet?)' }[ocrState]}
          </span>
          {firebaseConfig && cloudReady && (user
            ? <span className="acct"><span className="chip ready" title={user.email}>☁ {user.email}</span><button className="btn sm" onClick={logout}>Cerrar sesión</button></span>
            : <button className="btn sm primary" onClick={() => setAuthOpen(true)}>INICIAR SESIÓN / CREAR CUENTA</button>)}
        </div>
      </header>

      <main>
        {msg && <div className={`msg ${msg.t}`} role="status" onClick={() => setMsg(null)}>{msg.s}</div>}
        {firebaseConfig && cloudReady && !user && (
          <div className="msg warn plain">Está trabajando <b>sin cuenta</b>: sus gastos solo quedan en este dispositivo. <button className="link plain" onClick={() => setAuthOpen(true)}>Inicie sesión</button> para guardarlos en la nube, con la foto de cada comprobante, y verlos desde cualquier equipo.</div>
        )}

        <section className="card">
          <div className={`drop ${drag ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
            <p className="big">Arrastre aquí fotos o PDF de facturas, boletas, recibos y vouchers</p>
            <div className="btns">
              <button className="btn primary" onClick={() => pickRef.one.current.click()}>SUBIR COMPROBANTES</button>
              <button className="btn" onClick={() => pickRef.many.current.click()}>SUBIR VARIOS ARCHIVOS</button>
              <button className="btn" onClick={() => pickRef.pdf.current.click()}>CARGAR PDF</button>
            </div>
            <input ref={pickRef.one} hidden type="file" accept="image/*" onChange={(e) => pick(pickRef.one, e.target.files)} />
            <input ref={pickRef.many} hidden type="file" multiple accept="image/*,application/pdf" onChange={(e) => pick(pickRef.many, e.target.files)} />
            <input ref={pickRef.pdf} hidden type="file" accept="application/pdf" multiple onChange={(e) => pick(pickRef.pdf, e.target.files)} />
          </div>
          <div className="btns center">
            <button className="btn accent big" disabled={running || !items.some((i) => i.status === 'pending' && i.file)} onClick={processAll}>
              {running ? 'PROCESANDO…' : 'PROCESAR COMPROBANTES'}
            </button>
            {running && <button className="btn" onClick={() => { stop.current = true; }}>Detener</button>}
          </div>
          {(running || stats.total > 0) && (
            <div className="progress" aria-label="Progreso"><i style={{ width: `${progressPct}%` }} /><span>{progressPct}%</span></div>
          )}
          {orphan.length > 0 && !running && <div className="msg warn">{orphan.length} archivo(s) quedaron en cola antes de recargar la página y deben subirse de nuevo. <button className="btn sm" onClick={() => setItems((a) => a.filter((i) => !(i.status === 'pending' && !i.file)))}>Quitar de la lista</button></div>}
        </section>

        <section className="stats">
          <div><b>{stats.total}</b><span>Documentos</span></div>
          <div><b>{stats.procesados}</b><span>Procesados</span></div>
          <div><b>{stats.pendientes}</b><span>Pendientes</span></div>
          <div className={stats.errores ? 'bad' : ''}><b>{stats.errores}</b><span>Con errores</span></div>
          <div className="wide"><b>{money(stats.detectado)}</b><span>Egresos detectados (por registrar)</span></div>
          <div className="wide dark"><b>{money(acumulado)}</b><span>Total acumulado (Excel + registrados)</span></div>
        </section>

        {items.length > 0 && (
          <section className="card">
            <div className="sec-head">
              <h2>Revisión de comprobantes</h2>
              <button className="btn primary" disabled={!done.length} onClick={confirm_}>CONFIRMAR Y REGISTRAR GASTOS</button>
            </div>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Ítem</th><th>Comprobante</th><th>Fecha</th><th>N° comprobante</th><th>Beneficiario / proveedor</th><th>Concepto</th><th>Egreso (-)</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {items.map((it) => (
                    <ItemRow key={it.id} item={it} itemNo={itemNo[it.id]} dup={dups[it.id]} onChange={(p) => patch(it.id, p)} onDelete={() => setItems((a) => a.filter((x) => x.id !== it.id))} onOpen={open} onRetry={() => retry(it)} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">Cada comprobante recibe su número de ítem (el mismo que llevará en el Excel) y su foto se guarda con él al registrar. El OCR puede equivocarse: compruebe cada dato con la foto. Nada se registra hasta que usted confirme.</p>
          </section>
        )}

        <section className="card">
          <div className="sec-head"><h2>Excel de control</h2></div>
          <p className="hint">{excel ? <>Base: <b>{excel.name}</b> · {excel.info.count} registros · total {money(excel.info.total)} · próximo ítem {pad(excel.info.nextItem)}</> : 'Sin Excel importado: se generará uno nuevo con la estructura “GASTOS REALIZADOS EN OBRA SECHURA”.'}</p>
          <div className="btns">
            <button className="btn" onClick={() => pickRef.xls.current.click()}>IMPORTAR EXCEL</button>
            <input ref={pickRef.xls} hidden type="file" accept=".xlsx" onChange={(e) => { importExcel(e.target.files[0]); e.target.value = ''; }} />
            <button className="btn primary" disabled={!registered.length && !excel} onClick={download}>DESCARGAR EXCEL ACTUALIZADO</button>
          </div>
          {registered.length > 0 && (
            <>
              <h3>Gastos registrados pendientes de descargar ({registered.length})</h3>
              <div className="tablewrap">
                <table className="small">
                  <thead><tr><th>Ítem</th><th>Fecha</th><th>N°</th><th>Beneficiario</th><th>Concepto</th><th>Egreso (-)</th><th></th></tr></thead>
                  <tbody>
                    {[...registered].sort((a, b) => a.registeredAt - b.registeredAt).map((r) => (
                      <tr key={r.hid}><td data-label="Ítem"><b>{pad(pendNo[r.hid])}</b></td><td data-label="Fecha">{fmtDate(r.fecha)}</td><td data-label="N°">{r.numero}</td><td data-label="Beneficiario">{r.proveedor}</td><td data-label="Concepto"><span className="concept">{r.concepto}</span></td><td data-label="Egreso" className="num">{money(r.egreso)}</td>
                        <td><button className="btn sm danger" onClick={() => removeEntry(r)}>Quitar</button></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="card" id="historial">
          <div className="sec-head">
            <h2>Historial de gastos registrados ({history.length})</h2>
            <span className={user ? 'chip ready' : 'chip loading'}>{user ? '☁ Cuenta: ' + user.email : 'Sin cuenta: solo este dispositivo'}</span>
            <button className="btn" disabled={!shown.length} onClick={csv}>DESCARGAR HISTORIAL (CSV)</button>
          </div>
          {history.length === 0 ? (
            <p className="hint">Aún no hay gastos registrados. Aquí aparecerá cada gasto que confirme, con su ítem, su foto y la fecha y hora de registro.</p>
          ) : (
            <>
              <div className="filters">
                <input type="search" placeholder="Buscar por ítem, proveedor, N°, concepto, fecha…" value={q} onChange={(e) => setQ(e.target.value)} />
                <select value={hf} onChange={(e) => setHf(e.target.value)}>
                  <option value="todos">Todos</option>
                  <option value="pendiente">Pendientes de descargar</option>
                  <option value="excel">Ya en el Excel descargado</option>
                </select>
              </div>
              <div className="tablewrap">
                <table className="small">
                  <thead><tr><th>Ítem</th><th>Foto</th><th>Registrado</th><th>Fecha</th><th>N°</th><th>Beneficiario</th><th>Concepto</th><th>Egreso (-)</th><th>Estado</th><th></th></tr></thead>
                  <tbody>
                    {shown.map((e, idx) => (
                      <Fragment key={e.hid}>
                      {(idx === 0 || dayKey(shown[idx - 1].registeredAt) !== dayKey(e.registeredAt)) && (
                        <tr className="dayrow"><td colSpan={10}><b>{dayLabel(e.registeredAt)}</b> <span className="muted">· {dayStats[dayKey(e.registeredAt)].n} gasto(s) · {money(dayStats[dayKey(e.registeredAt)].total)}</span></td></tr>
                        )}
                      <tr>
                        <td data-label="Ítem" className="itemno"><b>{histNo(e) ? pad(histNo(e)) : '—'}</b></td>
                        <td data-label="Foto">{e.img ? <img className="thumb" src={e.img} alt={`Comprobante ítem ${histNo(e) ? pad(histNo(e)) : ''}`} onClick={() => open(e.img)} /> : <span className="muted">sin foto</span>}</td>
                        <td data-label="Registrado">{fmtStamp(e.registeredAt)}</td>
                        <td data-label="Fecha">{fmtDate(e.fecha)}</td>
                        <td data-label="N°">{e.img ? <button className="linklike" title="Ver la foto del comprobante" onClick={() => open(e.img)}>{e.numero || 'Ver foto'}</button> : e.numero}</td>
                        <td data-label="Beneficiario">{e.proveedor}</td>
                        <td data-label="Concepto"><span className="concept">{e.concepto}</span></td>
                        <td data-label="Egreso" className="num">{money(e.egreso)}</td>
                        <td data-label="Estado"><span className={`badge ${e.exported ? 'OK' : 'REVISAR'}`}>{e.exported ? 'En Excel' : 'Pendiente de descargar'}</span></td>
                        <td><button className="btn sm danger" onClick={() => removeEntry(e)}>Quitar</button></td>
                      </tr>
                    </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint"><b>{shown.length}</b> gasto(s) · total {money(shownTotal)}. {user ? 'Guardado en su cuenta, con la foto de cada comprobante.' : 'Guardado solo en este dispositivo (inicie sesión para guardarlo en la nube).'}</p>
            </>
          )}
        </section>

        <footer>
          <p>🔒 La lectura de comprobantes (OCR) se hace en su dispositivo. {user ? 'Con su sesión iniciada, los gastos registrados, la foto comprimida de cada comprobante y su Excel se guardan en su cuenta; nadie más los ve.' : 'Sin cuenta, las fotos y el Excel no salen de este navegador.'}</p>
          <button className="link" onClick={wipe}>{user ? 'Limpiar comprobantes pendientes de este dispositivo' : 'Borrar todo el trabajo guardado en este dispositivo'}</button>
        </footer>
      </main>

      {authOpen && <AuthModal cloud={cloud.current} onClose={() => setAuthOpen(false)} onDone={(created) => { setAuthOpen(false); setMsg({ t: 'ok', s: created ? 'Cuenta creada. Su trabajo ahora se guarda en la nube.' : 'Sesión iniciada. Se cargó su historial.' }); }} />}

      {viewer && (
        <div className="modal" onClick={() => setViewer(null)}>
          <button className="btn close" onClick={() => setViewer(null)}>Cerrar ✕</button>
          <div className="imgbox" onClick={(e) => e.stopPropagation()}>
            <img src={viewer} alt="Comprobante ampliado" className={zoom ? 'zoom' : ''} onClick={() => setZoom(!zoom)} />
          </div>
          <p className="hint light">Toque la imagen para acercar / alejar</p>
        </div>
      )}
    </div>
  );
}

