# Venezuela Reporta — Scraper de desaparecidos

Recopila información de [venezuelareporta.org](https://venezuelareporta.org) y la
guarda como **JSON seccionado** en un **Bucket de Railway** (S3-compatible).
Corre como **cron job cada 30 minutos**. Tres secciones:

- **`desaparecidos/`** — reportes de personas (Se busca / Encontrado / A salvo),
  con detección de entradas nuevas y cambios de estado.
- **`noticias/`** — lista de noticias (título, fuente, fecha, URL) de las
  pestañas news / social / videos.
- **`mapa/`** — puntos de interés con coordenadas (`lat`, `lng`, `title`,
  `kind`: edificio / acopio / emergencia, `fuente`).

Cada sección guarda en el bucket: `<seccion>/items.json` (dataset completo
keyado por id) + `<seccion>/state.json` (resumen última corrida) +
`<seccion>/changes/<runId>.json` (diff de cada corrida).

> El almacenamiento es intercambiable: si están las variables `BUCKET_*` usa el
> Railway Bucket (S3); si no, escribe en filesystem (`DATA_DIR`, p. ej. un Volume
> o `./data` en local). Mismo código en ambos casos.

> Los datos son enviados por la comunidad y el sitio los marca como **no verificados**.
> Este proyecto solo respalda/agrega información ya pública con fines humanitarios,
> con peticiones espaciadas y un User-Agent identificable.

## Qué guarda

En `DATA_DIR` (el mount del Volume):

- `reports.json` — diccionario `{ uuid: Reporte }` con TODO el dataset (la fuente de verdad).
- `changes/<runId>.json` — diff de cada corrida: nuevos reportes + cambios de estado.
- `state.json` — metadatos de la última corrida (total, nuevos, duración…).

Cada reporte incluye: `nombre`, `edad`, `ubicacion`, `estado`, `fotoUrl`,
`genero`, `ultimaVezVisto`, `publicadoRelativo`, `verificacion`, `detalles`
(todos los campos del detalle), más metadatos propios: `firstSeenAt`,
`lastSeenAt`, `enrichedAt` y `statusHistory`.

## Cómo funciona

El listado está ordenado de más nuevo a más viejo, así que en cada corrida
incremental el scraper recorre desde la página 1 de cada estado y se detiene
cuando encuentra `STOP_AFTER_KNOWN_PAGES` páginas seguidas sin nada nuevo.
La primera corrida (store vacío) o `FULL_SCAN=1` recorren TODO.

## Uso local

```bash
npm install
npm run build
npm run selftest        # valida el parser contra HTML real (test/fixtures)

# Backfill inicial (recorre TODO; rápido si no enriquece):
DATA_DIR=./data FULL_SCAN=1 ENRICH_NEW=0 npm start

# Corrida incremental normal:
DATA_DIR=./data npm start
```

En Windows PowerShell, las variables se pasan distinto:

```powershell
$env:FULL_SCAN="1"; $env:ENRICH_NEW="0"; npm start
```

## Variables de entorno

| Variable                 | Default | Para qué |
|--------------------------|---------|----------|
| `DATA_DIR`               | `/data` en Railway, `./data` local | Dónde se guardan los JSON |
| `REQUEST_DELAY_MS`       | `600`   | Espera entre peticiones |
| `STOP_AFTER_KNOWN_PAGES` | `2`     | Páginas conocidas seguidas antes de parar |
| `MAX_PAGES`              | `2000`  | Tope de seguridad por estado |
| `FULL_SCAN`              | `0`     | `1` = recorrer todas las páginas |
| `ENRICH_NEW`             | `1`     | `0` = no traer la página de detalle de los nuevos |
| `ENRICH_BATCH`           | `0`     | Enriquecer N reportes viejos por corrida (backfill gradual) |
| `USER_AGENT`             | identificable | User-Agent de las peticiones |

## Despliegue en Railway

1. **Sube el repo** a Railway (conecta el repo de GitHub o `railway up`).
2. **Crea un Bucket**: en el proyecto → **+ New → Bucket**, elige región
   (la región es permanente).
3. **Conéctalo al servicio**: en el servicio → **Variables** usa la opción de
   auto-inyectar las credenciales del bucket (`BUCKET_NAME`, `BUCKET_ENDPOINT`,
   `BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY`, `BUCKET_REGION`).
4. **Cron**: `railway.json` trae `cronSchedule: "*/30 * * * *"` (cada 30 min) y
   `restartPolicyType: NEVER`. Nota: el cron de `railway.json` no siempre activa
   el scheduler; si `nextCronRunAt` queda vacío, fíjalo en *Settings → Cron* o vía
   la API (`serviceInstanceUpdate`).
5. **Backfill inicial**: antes de dejar el cron, corre una vez con
   `FULL_SCAN=1` y `ENRICH_NEW=0` para llenar el dataset rápido
   (son ~1000+ páginas). Luego quita esas variables y deja el cron horario.
   Para rellenar el detalle de los viejos sin grandes corridas, pon
   `ENRICH_BATCH=500` un tiempo.

> Railway ejecuta el contenedor en cada disparo del cron; el proceso hace una
> corrida y termina. El Bucket conserva los JSON entre corridas.
>
> Alternativa sin bucket: crea un **Volume** montado en `/data` y define
> `DATA_DIR=/data` (no pongas las variables `BUCKET_*`).

## Estructura

```
src/
  index.ts     # entrada: una corrida y sale
  scraper.ts   # lógica de paginación, detección de nuevos y cambios
  parse.ts     # parseo HTML (cheerio) de listado y detalle
  store.ts     # lectura/escritura de los JSON en el Volume
  http.ts      # fetch con reintentos y User-Agent
  types.ts     # tipos
scripts/selftest.mjs   # valida el parser contra HTML real
test/fixtures/         # HTML real de muestra
```
