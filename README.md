# CONTROL DE GASTOS – OBRA SECHURA

Aplicación web independiente (React + Vite). **Sin servidor, sin claves API, sin Claude.** Todo corre en el navegador de cada persona:

- OCR: Tesseract.js (español + inglés), motor e idiomas incluidos en `public/ocr/` (no se descargan de ningún CDN).
- Excel: ExcelJS (importa y exporta `.xlsx`).
- PDF: pdf.js (usa el texto del PDF; si es escaneado, lo pasa por OCR).
- Datos: IndexedDB del navegador. Cada persona/dispositivo tiene su propio espacio; nada se comparte.
- PWA: se instala en el celular y funciona sin conexión después de la primera carga.

## Probar en su computadora

Requiere Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # pruebas de extracción y Excel
npm run test:ocr   # OCR real sobre imágenes de ejemplo (tests/fixtures)
npm run build      # genera la carpeta dist/ lista para publicar
```

## Publicar y obtener el enlace

### Opción A — GitHub Pages (gratis, recomendada)
1. Cree una cuenta en github.com y un repositorio nuevo (público), p. ej. `gastos-sechura`.
2. Suba todo el contenido de esta carpeta (excepto `node_modules` y `dist`, ya excluidos en `.gitignore`).
   Desde la carpeta: `git init`, `git add .`, `git commit -m "app"`, `git branch -M main`, `git remote add origin <URL del repo>`, `git push -u origin main`.
3. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. El workflow `.github/workflows/deploy.yml` compila y publica solo. En 1–2 minutos el enlace será
   `https://SU-USUARIO.github.io/gastos-sechura/` (aparece en la pestaña **Actions** y en Settings → Pages).

### Opción B — Cloudflare Pages (gratis)
1. Suba el repositorio a GitHub como arriba.
2. En dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build command: `npm run build` · Output directory: `dist`. El enlace será `https://NOMBRE.pages.dev`.
   (También puede arrastrar la carpeta `dist/` a “Direct Upload” sin usar Git.)

### Opción C — Vercel (gratis)
Importe el repositorio en vercel.com → framework **Vite** (build `npm run build`, salida `dist`). Enlace `https://NOMBRE.vercel.app`.

> Con cualquiera de las tres, la app queda en internet sin depender de su computadora ni de Claude.

## Compartir
Envíe el enlace por WhatsApp o correo. Cada persona:
1. Abre el enlace (en iPhone: Safari → Compartir → *Agregar a pantalla de inicio*; en Android/Chrome: menú → *Instalar aplicación*).
2. Importa **su** Excel (o deja que se cree uno nuevo), sube fotos, revisa, confirma y descarga.

Los datos de cada persona viven solo en su navegador; no se mezclan ni se ven entre usuarios.

## Actualizar la aplicación
Edite el código, haga `git commit` y `git push` a `main`: GitHub vuelve a publicar solo. Para que los celulares ya instalados tomen la versión nueva, cambie `VERSION` en `public/sw.js` (p. ej. `'v2'`); al abrir la app con internet se actualiza.

## Costos y límites
- **Por comprobante: S/ 0.** No hay APIs ni créditos; el OCR usa el procesador del dispositivo.
- **Alojamiento:** GitHub Pages, Cloudflare Pages y Vercel tienen planes gratuitos con límites (GitHub Pages: repos públicos en el plan gratuito, ~1 GB de sitio y ~100 GB/mes de transferencia; Cloudflare/Vercel: límites de ancho de banda y compilaciones). Las condiciones pueden cambiar: no se garantiza que sea gratis para siempre. Si cambian, se puede mover la carpeta `dist/` a otro hosting estático sin tocar el código.
- **Dominio propio** (opcional) sí tiene costo anual.
- La primera carga descarga ~10 MB (motor e idiomas OCR); luego queda en caché del navegador.

## Limitaciones honestas
- El OCR **no es infalible**, sobre todo con fotos borrosas, arrugadas, con poca luz o letra muy pequeña. La app marca “Revisar”, avisa cuando hay varios importes posibles y no inventa datos faltantes: revise siempre contra la foto ampliada.
- Un PDF = un comprobante (se leen hasta 3 páginas).
- Si su Excel tiene imágenes, gráficos o macros, ExcelJS puede no conservarlos (texto, formatos, bordes, colores, anchos y fórmulas simples sí se conservan). Pruebe primero con una copia.
- Si el Excel tiene una fila TOTAL/SALDO debajo de los datos, los nuevos registros se insertan encima y se extienden las sumas simples (`SUM(G5:G40)`).
- Las fotos se guardan en el navegador solo mientras están pendientes de revisión; al confirmar se borran. Borrar los datos del navegador o usar modo privado elimina el trabajo pendiente: descargue el Excel con frecuencia.
- iPhone/Safari puede borrar datos de sitios que no se usan por varias semanas.

## Cuentas y guardado en la nube (Firebase)

- Proyecto Firebase: `gastos-sechura` (plan gratuito Spark). La configuración pública está en `src/firebase-config.js` (no son secretos).
- **Authentication:** correo y contraseña. Dominios autorizados: `localhost`, `jeffersonkid.github.io` (agregue su dominio si publica en otro sitio: Authentication → Configuración → Dominios autorizados).
- **Firestore** (modo producción) con estas reglas: cada persona solo accede a `users/{su uid}/...`

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

- Qué se guarda en la cuenta (solo con sesión iniciada y aceptación al crear la cuenta): cada gasto registrado (fecha, N°, beneficiario, concepto, egreso, ítem), **la foto comprimida del comprobante** (JPEG ~1200 px, dentro del mismo documento) y el Excel base (si pesa menos de ~650 KB). Los comprobantes que aún no se confirman quedan solo en el dispositivo.
- Sin sesión, todo sigue funcionando en modo local como antes.
- Al cerrar sesión se limpian los datos locales del dispositivo (siguen en la cuenta).
- Cuota gratuita de Firestore (1 GiB, 50 mil lecturas y 20 mil escrituras por día): alcanza para miles de comprobantes; puede cambiar. Firebase Storage ya no es gratuito sin tarjeta, por eso las fotos van comprimidas en Firestore.
- Para cambiar de proyecto Firebase: pegue su propia configuración en `src/firebase-config.js`.

## Ítems
Cada comprobante listo recibe su número de ítem al cargarlo (continúa el último ítem del Excel y de lo ya registrado). Es el mismo que se escribe en el Excel y queda guardado junto a su foto en el historial.
