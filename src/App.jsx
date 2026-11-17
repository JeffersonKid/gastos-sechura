import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { saveItem, deleteItem, allItems, setMeta, getMeta, clearAll } from './db.js';
import { extractFields, findDuplicate } from './extract.js';

const money = (n) => 'S/ ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isValidAmount = (s) => Number.isFinite(parseFloat(s)) && parseFloat(s) > 0;

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

function ItemRow({ item, dup, onChange, onDelete, onOpen, onRetry }) {
  const [edit, setEdit] = useState(false);
  const f = item.fields;
  const st = item.status === 'done' ? item.result : item.status;
  const set = (k, v) => onChange({ fields: { ...f, [k]: v } });
  const cell = (k, type = 'text', extra = {}) =>
    edit ? <input type={type} value={f[k] || ''} onChange={(e) => set(k, e.target.value)} {...extra} /> : <span>{k === 'fecha' ? fmtDate(f[k]) : k === 'egreso' ? (f[k] ? money(f[k]) : '') : f[k]}</span>;
  return (
    <tr className={`row ${st}`}>
      <td data-label="Comprobante"><Thumb blob={item.image} onOpen={onOpen} /><div className="fname">{item.name}</div></td>
      <td data-label="Fecha">{cell('fecha', 'date')}</td>
      <td data-label="N° comprobante">{cell('numero')}</td>
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

export default function App() {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [excel, setExcel] = useState(null); // {name, buffer, info}
  const [registered, setRegistered] = useState([]);
  const [running, setRunning] = useState(false);
  const [ocrState, setOcrState] = useState('idle');
  const [msg, setMsg] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [zoom, setZoom] = useState(false);
  const [drag, setDrag] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const saved = useRef(new Map());
  const stop = useRef(false);

  // Restaurar trabajo pendiente tras recargar
  useEffect(() => {
    (async () => {
      try {
        const [its, ex, reg] = await Promise.all([allItems(), getMeta('excel'), getMeta('registered')]);
        its.forEach((i) => saved.current.set(i.id, i));
        setItems(its.map((i) => (i.status === 'processing' ? { ...i, status: 'pending' } : i)).sort((a, b) => a.createdAt - b.createdAt));
        if (ex) setExcel(ex);
        if (reg) setRegistered(reg);
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

  // Precarga del motor OCR en segundo plano (queda en caché para uso sin conexión)
  useEffect(() => {
    if (!loaded) return undefined;
    const t = setTimeout(async () => {
      setOcrState('loading');
      try { const { getWorker } = await import('./ocr.js'); await getWorker(); setOcrState('ready'); } catch { setOcrState('error'); }
    }, 800);
    return () => clearTimeout(t);
  }, [loaded]);

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

  // Un archivo pendiente restaurado tras recarga ya no tiene `file` (no se guarda el original): se marca para resubir
  const orphan = items.filter((i) => i.status === 'pending' && !i.file);

  const retry = (it) => (it.file ? patch(it.id, { status: 'pending', error: null }) : setMsg({ t: 'warn', s: `Para reintentar "${it.name}", elimínelo y vuelva a subirlo.` }));

  // Duplicados: contra Excel importado, registrados y otros de la lista
  const dups = useMemo(() => {
    const out = {};
    const base = [...(excel?.info?.records || []), ...registered.map((r) => ({ ...r, origen: 'registrado en esta sesión' }))];
    const seen = [];
    for (const it of items) {
      if (it.status !== 'done') continue;
      const d = findDuplicate(it.fields, [...base, ...seen]);
      if (d) out[it.id] = d;
      seen.push({ ...it.fields, origen: `otro comprobante de la lista (${it.name})` });
    }
    return out;
  }, [items, excel, registered]);

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

  const confirm_ = () => {
    const ready = done.filter((i) => isValidAmount(i.fields.egreso) && (!dups[i.id] || i.dupOk));
    const skippedDup = done.filter((i) => dups[i.id] && !i.dupOk).length;
    const skippedAmt = done.filter((i) => !isValidAmount(i.fields.egreso)).length;
    if (!ready.length) return setMsg({ t: 'warn', s: `No hay comprobantes listos para registrar (${skippedDup} duplicado(s) sin autorizar, ${skippedAmt} sin importe válido).` });
    const total = ready.reduce((s, i) => s + parseFloat(i.fields.egreso), 0);
    const incomplete = ready.filter((i) => !i.fields.fecha || !i.fields.numero || !i.fields.proveedor).length;
    const q = `¿Registrar ${ready.length} gasto(s) por ${money(total)}?` + (incomplete ? `\n${incomplete} tiene(n) campos vacíos.` : '') + (skippedDup + skippedAmt ? `\nSe omitirán ${skippedDup} duplicado(s) y ${skippedAmt} sin importe.` : '');
    if (!window.confirm(q)) return;
    setRegistered((r) => [...r, ...ready.map((i) => ({ ...i.fields, egreso: parseFloat(i.fields.egreso).toFixed(2), tipo: i.tipo }))]);
    const ids = new Set(ready.map((i) => i.id));
    setItems((arr) => arr.filter((i) => !ids.has(i.id)));
    setMsg({ t: 'ok', s: `${ready.length} gasto(s) registrado(s). Descargue el Excel actualizado cuando termine.` });
  };

  const importExcel = async (file) => {
    if (!file) return;
    try {
      const { readExcel } = await import('./excel.js');
      const buffer = await file.arrayBuffer();
      const info = await readExcel(buffer.slice(0));
      setExcel({ name: file.name, buffer, info });
      setMsg({ t: 'ok', s: `Excel importado: ${info.count} registro(s) previos, total ${money(info.total)}. Próximo ítem: ${String(info.nextItem).padStart(2, '0')}.` });
    } catch (e) { setMsg({ t: 'err', s: e.message || 'No se pudo leer el Excel.' }); }
  };

  const download = async () => {
    try {
      const { appendRecords, readExcel } = await import('./excel.js');
      const { buffer } = await appendRecords(excel ? excel.buffer.slice(0) : null, registered);
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
      setExcel({ name, buffer, info });
      setRegistered([]);
      setMsg({ t: 'ok', s: `Descargado: ${name} (${info.count} registros). Este archivo es ahora la base de trabajo.` });
    } catch (e) { setMsg({ t: 'err', s: e.message || 'No se pudo generar el Excel.' }); }
  };

  const wipe = async () => {
    if (!window.confirm('Se borrarán fotos, registros pendientes y el Excel cargado de este navegador. ¿Continuar?')) return;
    await clearAll();
    saved.current.clear();
    setItems([]); setRegistered([]); setExcel(null);
    setMsg({ t: 'ok', s: 'Se eliminó todo el trabajo guardado en este dispositivo.' });
  };

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
        <span className={`chip ${ocrState}`} title="El OCR se ejecuta en este dispositivo">
          {{ idle: 'OCR en espera', loading: 'Preparando OCR…', ready: 'OCR listo · sin conexión', error: 'OCR no disponible (¿primera carga sin internet?)' }[ocrState]}
        </span>
      </header>

      <main>
        {msg && <div className={`msg ${msg.t}`} role="status" onClick={() => setMsg(null)}>{msg.s}</div>}

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
          {orphan.length > 0 && !running && <div className="msg warn">{orphan.length} archivo(s) quedaron en cola antes de recargar la página y deben subirse de nuevo (las fotos originales no se guardan hasta ser procesadas). <button className="btn sm" onClick={() => setItems((a) => a.filter((i) => !(i.status === 'pending' && !i.file)))}>Quitar de la lista</button></div>}
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
                <thead><tr><th>Comprobante</th><th>Fecha</th><th>N° comprobante</th><th>Beneficiario / proveedor</th><th>Concepto</th><th>Egreso (-)</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {items.map((it) => (
                    <ItemRow key={it.id} item={it} dup={dups[it.id]} onChange={(p) => patch(it.id, p)} onDelete={() => setItems((a) => a.filter((x) => x.id !== it.id))} onOpen={(u) => { setViewer(u); setZoom(false); }} onRetry={() => retry(it)} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">El OCR puede equivocarse: compruebe cada dato con la foto (clic en la miniatura para ampliarla). Nada se registra hasta que usted confirme.</p>
          </section>
        )}

        <section className="card">
          <div className="sec-head"><h2>Excel de control</h2></div>
          <p className="hint">{excel ? <>Base: <b>{excel.name}</b> · {excel.info.count} registros · total {money(excel.info.total)} · próximo ítem {String(excel.info.nextItem).padStart(2, '0')}</> : 'Sin Excel importado: se generará uno nuevo con la estructura “GASTOS REALIZADOS EN OBRA SECHURA”.'}</p>
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
                  <thead><tr><th>Fecha</th><th>N°</th><th>Beneficiario</th><th>Concepto</th><th>Egreso (-)</th><th></th></tr></thead>
                  <tbody>
                    {registered.map((r, i) => (
                      <tr key={i}><td data-label="Fecha">{fmtDate(r.fecha)}</td><td data-label="N°">{r.numero}</td><td data-label="Beneficiario">{r.proveedor}</td><td data-label="Concepto">{r.concepto}</td><td data-label="Egreso" className="num">{money(r.egreso)}</td>
                        <td><button className="btn sm danger" onClick={() => setRegistered((a) => a.filter((_, k) => k !== i))}>Quitar</button></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <footer>
          <p>🔒 Todo se procesa en su dispositivo. Las fotos y el Excel no se envían a ningún servidor; se guardan solo en este navegador.</p>
          <button className="link" onClick={wipe}>Borrar todo el trabajo guardado en este dispositivo</button>
        </footer>
      </main>

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

