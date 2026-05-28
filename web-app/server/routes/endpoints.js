const express = require('express');
const db = require('../lib/db');

const router = express.Router();

function paginate(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ─── DIAGNOSTIC: Show actual columns for key tables ───────────────────
router.get('/diagnostics/columns', async (req, res) => {
  try {
    const tables = ['F_ART', 'F_CLI', 'F_PRO', 'F_FAM', 'F_SEC', 'F_UME', 'F_AGE', 'F_FPA',
      'F_ALM', 'F_STO', 'F_TRA', 'F_LTR', 'F_FRE', 'F_LFR', 'F_LPF', 'F_ALB', 'F_LAL',
      'F_LAC', 'F_ENT', 'F_LEN', 'F_FAC', 'F_LFA', 'F_LCO', 'F_EAN', 'F_LTA', 'F_TAR', 'F_CIN'];
    const result = {};
    for (const t of tables) {
      try {
        const cols = await db.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [t]
        );
        if (cols.rows.length > 0) {
          result[t] = cols.rows.map(r => r.column_name);
        }
      } catch (_) { /* table may not exist */ }
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/diagnostics/columns/:table', async (req, res) => {
  try {
    const table = req.params.table.toUpperCase();
    const cols = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [table]
    );
    res.json({ table, columns: cols.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ENDPOINT: ARTICULOS ───────────────────────────────────────────────

router.get('/articulos', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const search = req.query.search || '';

    let where = '';
    const params = [];
    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      where = `WHERE a."CODART" ILIKE $1 OR a."DESART" ILIKE $2`;
    }

    const countRes = await db.query(
      `SELECT COUNT(*) FROM "F_ART" a ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataParams = [...params, limit, offset];
    const result = await db.query(`
      SELECT
        a."CODART", a."DESART", a."PCOART", a."PHAART", a."TIVART", a."STOART",
        a."FAMART", a."EANART", a."UMEART", a."FALART", a."REFART",
        f."CODFAM", f."DESFAM", f."SECFAM",
        s."CODSEC", s."DESSEC",
        u."CODUME", u."DESUME"
      FROM "F_ART" a
      LEFT JOIN "F_FAM" f ON a."FAMART" = f."CODFAM"
      LEFT JOIN "F_SEC" s ON f."SECFAM" = s."CODSEC"
      LEFT JOIN "F_UME" u ON a."UMEART" = u."CODUME"
      ${where}
      ORDER BY a."CODART"
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, dataParams);

    res.json({ data: result.rows, total, page, limit });
  } catch (err) {
    console.error('Articulos list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch articulos', message: err.message });
  }
});

router.get('/articulos/:codart', async (req, res) => {
  try {
    const { codart } = req.params;

    const artRes = await db.query(`
      SELECT a.*,
        f."CODFAM", f."DESFAM", f."SECFAM",
        s."CODSEC", s."DESSEC",
        u."CODUME", u."DESUME"
      FROM "F_ART" a
      LEFT JOIN "F_FAM" f ON a."FAMART" = f."CODFAM"
      LEFT JOIN "F_SEC" s ON f."SECFAM" = s."CODSEC"
      LEFT JOIN "F_UME" u ON a."UMEART" = u."CODUME"
      WHERE a."CODART" = $1
    `, [codart]);

    if (artRes.rows.length === 0) {
      return res.status(404).json({ error: 'Articulo not found' });
    }

    const art = artRes.rows[0];

    const [eanRes, stoRes, ltaRes] = await Promise.all([
      db.query('SELECT * FROM "F_EAN" WHERE "ARTEAN" = $1', [codart]),
      db.query(`
        SELECT st.*, al."NOMALM"
        FROM "F_STO" st
        LEFT JOIN "F_ALM" al ON st."ALMSTO" = al."CODALM"
        WHERE st."ARTSTO" = $1
      `, [codart]),
      db.query(`
        SELECT lt.*, t."DESTAR"
        FROM "F_LTA" lt
        LEFT JOIN "F_TAR" t ON lt."TARLTA" = t."CODTAR"
        WHERE lt."ARTLTA" = $1
      `, [codart]),
    ]);

    res.json({
      articulo: art,
      ean: eanRes.rows,
      stock: stoRes.rows,
      tarifas: ltaRes.rows,
    });
  } catch (err) {
    console.error('Articulo detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch articulo', message: err.message });
  }
});

// ─── ENDPOINT: CATALOGOS ───────────────────────────────────────────────

router.get('/catalogos/proveedores', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const search = req.query.search || '';

    let where = '';
    const params = [];
    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      where = `WHERE p."NOFPRO" ILIKE $1 OR p."NOCPRO" ILIKE $2`;
    }

    const countRes = await db.query(`SELECT COUNT(*) FROM "F_PRO" p ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT p."CODPRO", p."NIFPRO", p."NOFPRO", p."NOCPRO", p."DOMPRO", p."POBPRO",
        p."CPOPRO", p."PROPRO", p."TELPRO", p."EMAPRO", p."FPAPRO",
        fp."DESFPA" AS forma_pago
      FROM "F_PRO" p
      LEFT JOIN "F_FPA" fp ON p."FPAPRO" = fp."CODFPA"
      ${where}
      ORDER BY p."CODPRO"
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    res.json({ data: result.rows, total, page, limit });
  } catch (err) {
    console.error('Proveedores error:', err.message);
    res.status(500).json({ error: 'Failed to fetch proveedores', message: err.message });
  }
});

router.get('/catalogos/clientes', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const search = req.query.search || '';

    let where = '';
    const params = [];
    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      where = `WHERE c."NOFCLI" ILIKE $1 OR c."NOCCLI" ILIKE $2`;
    }

    const countRes = await db.query(`SELECT COUNT(*) FROM "F_CLI" c ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT c."CODCLI", c."NIFCLI", c."NOFCLI", c."NOCCLI", c."DOMCLI", c."POBCLI",
        c."CPOCLI", c."PROCLI", c."TELCLI", c."EMACLI", c."AGECLI", c."FPACLI", c."TARCLI",
        ag."NOMAGE" AS agente_nombre,
        fp."DESFPA" AS forma_pago
      FROM "F_CLI" c
      LEFT JOIN "F_AGE" ag ON c."AGECLI" = ag."CODAGE"
      LEFT JOIN "F_FPA" fp ON c."FPACLI" = fp."CODFPA"
      ${where}
      ORDER BY c."CODCLI"
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    res.json({ data: result.rows, total, page, limit });
  } catch (err) {
    console.error('Clientes error:', err.message);
    res.status(500).json({ error: 'Failed to fetch clientes', message: err.message });
  }
});

router.get('/catalogos/agentes', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT "CODAGE", "NOMAGE", "NOCAGE", "DOMAGE", "EMAAGE", "COMAGE", "ZONAGE", "TEMAGE"
      FROM "F_AGE" ORDER BY "CODAGE"
    `);
    res.json({ data: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('Agentes error:', err.message);
    res.status(500).json({ error: 'Failed to fetch agentes', message: err.message });
  }
});

router.get('/catalogos/formas-pago', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT "CODFPA", "DESFPA", "VENFPA", "TIPFPA", "EFEFPA"
      FROM "F_FPA" ORDER BY "CODFPA"
    `);
    res.json({ data: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('Formas de pago error:', err.message);
    res.status(500).json({ error: 'Failed to fetch formas de pago', message: err.message });
  }
});

// ─── ENDPOINT: TRASPASOS ───────────────────────────────────────────────

router.get('/traspasos', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);

    const countRes = await db.query('SELECT COUNT(*) FROM "F_TRA"');
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT t."DOCTRA", t."FECTRA", t."AORTRA", t."ADETRA", t."COMTRA",
        ao."NOMALM" AS almacen_origen,
        ad."NOMALM" AS almacen_destino
      FROM "F_TRA" t
      LEFT JOIN "F_ALM" ao ON t."AORTRA" = ao."CODALM"
      LEFT JOIN "F_ALM" ad ON t."ADETRA" = ad."CODALM"
      ORDER BY t."DOCTRA" DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const data = [];
    for (const row of result.rows) {
      const lineas = await db.query(`
        SELECT l.*, a."DESART"
        FROM "F_LTR" l
        LEFT JOIN "F_ART" a ON l."ARTLTR" = a."CODART"
        WHERE l."DOCLTR" = $1
        ORDER BY l."LINLTR"
      `, [row.DOCTRA]);
      data.push({ ...row, lineas: lineas.rows });
    }

    res.json({ data, total, page, limit });
  } catch (err) {
    console.error('Traspasos error:', err.message);
    res.status(500).json({ error: 'Failed to fetch traspasos', message: err.message });
  }
});

router.get('/traspasos/:doctra', async (req, res) => {
  try {
    const doctra = parseInt(req.params.doctra);

    const traRes = await db.query(`
      SELECT t.*,
        ao."NOMALM" AS almacen_origen,
        ad."NOMALM" AS almacen_destino
      FROM "F_TRA" t
      LEFT JOIN "F_ALM" ao ON t."AORTRA" = ao."CODALM"
      LEFT JOIN "F_ALM" ad ON t."ADETRA" = ad."CODALM"
      WHERE t."DOCTRA" = $1
    `, [doctra]);

    if (traRes.rows.length === 0) {
      return res.status(404).json({ error: 'Traspaso not found' });
    }

    const lineas = await db.query(`
      SELECT l.*, a."DESART"
      FROM "F_LTR" l
      LEFT JOIN "F_ART" a ON l."ARTLTR" = a."CODART"
      WHERE l."DOCLTR" = $1
      ORDER BY l."LINLTR"
    `, [doctra]);

    res.json({ traspaso: traRes.rows[0], lineas: lineas.rows });
  } catch (err) {
    console.error('Traspaso detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch traspaso', message: err.message });
  }
});

// ─── ENDPOINT: FACTURAS_PROVEEDOR ──────────────────────────────────────

router.get('/facturas-proveedor', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);

    const countRes = await db.query('SELECT COUNT(*) FROM "F_FRE"');
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT fr."TIPFRE", fr."CODFRE", fr."FACFRE", fr."FECFRE", fr."PROFRE",
        fr."ESTFRE", fr."TOTFRE", fr."FOPFRE", fr."ALMFRE",
        p."NOFPRO" AS proveedor_nombre,
        fp."DESFPA" AS forma_pago
      FROM "F_FRE" fr
      LEFT JOIN "F_PRO" p ON fr."PROFRE" = p."CODPRO"
      LEFT JOIN "F_FPA" fp ON fr."FOPFRE" = fp."CODFPA"
      ORDER BY fr."FECFRE" DESC, fr."CODFRE" DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const data = [];
    for (const row of result.rows) {
      const lineas = await db.query(`
        SELECT l.*, a."DESART"
        FROM "F_LFR" l
        LEFT JOIN "F_ART" a ON l."ARTLFR" = a."CODART"
        WHERE l."TIPLFR" = $1 AND l."CODLFR" = $2
        ORDER BY l."POSLFR"
      `, [row.TIPFRE, row.CODFRE]);
      data.push({ ...row, lineas: lineas.rows });
    }

    res.json({ data, total, page, limit });
  } catch (err) {
    console.error('Facturas proveedor error:', err.message);
    res.status(500).json({ error: 'Failed to fetch facturas proveedor', message: err.message });
  }
});

router.get('/facturas-proveedor/:tipo/:codigo', async (req, res) => {
  try {
    const { tipo, codigo } = req.params;

    const freRes = await db.query(`
      SELECT fr.*,
        p."NOFPRO" AS proveedor_nombre, p."NIFPRO",
        fp."DESFPA" AS forma_pago,
        al."NOMALM" AS almacen_nombre
      FROM "F_FRE" fr
      LEFT JOIN "F_PRO" p ON fr."PROFRE" = p."CODPRO"
      LEFT JOIN "F_FPA" fp ON fr."FOPFRE" = fp."CODFPA"
      LEFT JOIN "F_ALM" al ON fr."ALMFRE" = al."CODALM"
      WHERE fr."TIPFRE" = $1 AND fr."CODFRE" = $2
    `, [tipo, parseInt(codigo)]);

    if (freRes.rows.length === 0) {
      return res.status(404).json({ error: 'Factura proveedor not found' });
    }

    const [lineas, pagos] = await Promise.all([
      db.query(`
        SELECT l.*, a."DESART"
        FROM "F_LFR" l
        LEFT JOIN "F_ART" a ON l."ARTLFR" = a."CODART"
        WHERE l."TIPLFR" = $1 AND l."CODLFR" = $2
        ORDER BY l."POSLFR"
      `, [tipo, parseInt(codigo)]),
      db.query(`
        SELECT * FROM "F_LPF"
        WHERE "TFRLPF" = $1 AND "CFRLPF" = $2
        ORDER BY "LINLPF"
      `, [tipo, parseInt(codigo)]),
    ]);

    res.json({
      factura: freRes.rows[0],
      lineas: lineas.rows,
      pagos: pagos.rows,
    });
  } catch (err) {
    console.error('Factura proveedor detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch factura proveedor', message: err.message });
  }
});

// ─── ENDPOINT: REMISIONES (Albaranes) ──────────────────────────────────

router.get('/remisiones', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);

    const countRes = await db.query('SELECT COUNT(*) FROM "F_ALB"');
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT ab."TIPALB", ab."CODALB", ab."REFALB", ab."FECALB", ab."CLIALB",
        ab."ESTALB", ab."TOTALB", ab."FOPALB", ab."ALMALB", ab."AGEALB", ab."CNOALB",
        c."NOFCLI" AS cliente_nombre,
        ag."NOMAGE" AS agente_nombre,
        fp."DESFPA" AS forma_pago
      FROM "F_ALB" ab
      LEFT JOIN "F_CLI" c ON ab."CLIALB" = c."CODCLI"
      LEFT JOIN "F_AGE" ag ON ab."AGEALB" = ag."CODAGE"
      LEFT JOIN "F_FPA" fp ON ab."FOPALB" = fp."CODFPA"
      ORDER BY ab."FECALB" DESC, ab."CODALB" DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const data = [];
    for (const row of result.rows) {
      const lineas = await db.query(`
        SELECT l.*, a."DESART"
        FROM "F_LAL" l
        LEFT JOIN "F_ART" a ON l."ARTLAL" = a."CODART"
        WHERE l."TIPLAL" = $1 AND l."CODLAL" = $2
        ORDER BY l."POSLAL"
      `, [row.TIPALB, row.CODALB]);
      data.push({ ...row, lineas: lineas.rows });
    }

    res.json({ data, total, page, limit });
  } catch (err) {
    console.error('Remisiones error:', err.message);
    res.status(500).json({ error: 'Failed to fetch remisiones', message: err.message });
  }
});

router.get('/remisiones/:tipo/:codigo', async (req, res) => {
  try {
    const { tipo, codigo } = req.params;

    const albRes = await db.query(`
      SELECT ab.*,
        c."NOFCLI" AS cliente_nombre, c."NIFCLI",
        ag."NOMAGE" AS agente_nombre,
        fp."DESFPA" AS forma_pago,
        al."NOMALM" AS almacen_nombre
      FROM "F_ALB" ab
      LEFT JOIN "F_CLI" c ON ab."CLIALB" = c."CODCLI"
      LEFT JOIN "F_AGE" ag ON ab."AGEALB" = ag."CODAGE"
      LEFT JOIN "F_FPA" fp ON ab."FOPALB" = fp."CODFPA"
      LEFT JOIN "F_ALM" al ON ab."ALMALB" = al."CODALM"
      WHERE ab."TIPALB" = $1 AND ab."CODALB" = $2
    `, [tipo, parseInt(codigo)]);

    if (albRes.rows.length === 0) {
      return res.status(404).json({ error: 'Remision not found' });
    }

    const [lineas, cobros] = await Promise.all([
      db.query(`
        SELECT l.*, a."DESART"
        FROM "F_LAL" l
        LEFT JOIN "F_ART" a ON l."ARTLAL" = a."CODART"
        WHERE l."TIPLAL" = $1 AND l."CODLAL" = $2
        ORDER BY l."POSLAL"
      `, [tipo, parseInt(codigo)]),
      db.query(`
        SELECT * FROM "F_LAC"
        WHERE "TFALAC" = $1 AND "CALLAC" = $2
        ORDER BY "LINLAC"
      `, [tipo, parseInt(codigo)]),
    ]);

    res.json({
      remision: albRes.rows[0],
      lineas: lineas.rows,
      cobros: cobros.rows,
    });
  } catch (err) {
    console.error('Remision detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch remision', message: err.message });
  }
});

// ─── ENDPOINT: EXISTENCIAS ─────────────────────────────────────────────

router.get('/existencias', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const almacen = req.query.almacen || '';
    const search = req.query.search || '';

    let where = 'WHERE 1=1';
    const params = [];
    let pi = 1;

    if (almacen) {
      where += ` AND st."ALMSTO" = $${pi++}`;
      params.push(almacen);
    }
    if (search) {
      where += ` AND (st."ARTSTO" ILIKE $${pi} OR a."DESART" ILIKE $${pi})`;
      params.push(`%${search}%`);
      pi++;
    }

    const countRes = await db.query(`
      SELECT COUNT(*)
      FROM "F_STO" st
      LEFT JOIN "F_ART" a ON st."ARTSTO" = a."CODART"
      ${where}
    `, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT st."ARTSTO", st."ALMSTO", st."ACTSTO", st."DISSTO", st."MINSTO", st."MAXSTO",
        a."DESART", a."PCOART", a."PHAART",
        al."NOMALM" AS almacen_nombre,
        p."NOFPRO" AS proveedor_nombre
      FROM "F_STO" st
      LEFT JOIN "F_ART" a ON st."ARTSTO" = a."CODART"
      LEFT JOIN "F_ALM" al ON st."ALMSTO" = al."CODALM"
      LEFT JOIN "F_PRO" p ON a."PHAART" = p."CODPRO"
      ${where}
      ORDER BY st."ARTSTO", st."ALMSTO"
      LIMIT $${pi++} OFFSET $${pi}
    `, [...params, limit, offset]);

    const data = [];
    for (const row of result.rows) {
      const cinRes = await db.query(`
        SELECT cin.*, al."NOMALM" AS almacen_nombre
        FROM "F_CIN" cin
        LEFT JOIN "F_ALM" al ON cin."ALMCIN" = al."CODALM"
        WHERE cin."ARTCIN" = $1 AND cin."ALMCIN" = $2
        ORDER BY cin."FECCIN" DESC
      `, [row.ARTSTO, row.ALMSTO]);
      data.push({ ...row, inventario: cinRes.rows });
    }

    res.json({ data, total, page, limit });
  } catch (err) {
    console.error('Existencias error:', err.message);
    res.status(500).json({ error: 'Failed to fetch existencias', message: err.message });
  }
});

router.get('/existencias/:artsto/:almsto', async (req, res) => {
  try {
    const { artsto, almsto } = req.params;

    const stoRes = await db.query(`
      SELECT st.*,
        a."DESART", a."PCOART", a."PHAART", a."FAMART",
        al."NOMALM" AS almacen_nombre,
        p."NOFPRO" AS proveedor_nombre
      FROM "F_STO" st
      LEFT JOIN "F_ART" a ON st."ARTSTO" = a."CODART"
      LEFT JOIN "F_ALM" al ON st."ALMSTO" = al."CODALM"
      LEFT JOIN "F_PRO" p ON a."PHAART" = p."CODPRO"
      WHERE st."ARTSTO" = $1 AND st."ALMSTO" = $2
    `, [artsto, almsto]);

    if (stoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Stock record not found' });
    }

    const cinRes = await db.query(`
      SELECT * FROM "F_CIN"
      WHERE "ARTCIN" = $1 AND "ALMCIN" = $2
      ORDER BY "FECCIN" DESC
    `, [artsto, almsto]);

    res.json({
      stock: stoRes.rows[0],
      inventario: cinRes.rows,
    });
  } catch (err) {
    console.error('Existencia detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch existencia', message: err.message });
  }
});

// ─── ENDPOINT: ENTRADAS_PROVEEDOR ──────────────────────────────────────

router.get('/entradas-proveedor', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);

    const countRes = await db.query('SELECT COUNT(*) FROM "F_ENT"');
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT e."TIPENT", e."CODENT", e."REFENT", e."FECENT", e."PROENT",
        e."ESTENT", e."TOTENT", e."FOPENT", e."ALMENT",
        p."NOFPRO" AS proveedor_nombre,
        fp."DESFPA" AS forma_pago
      FROM "F_ENT" e
      LEFT JOIN "F_PRO" p ON e."PROENT" = p."CODPRO"
      LEFT JOIN "F_FPA" fp ON e."FOPENT" = fp."CODFPA"
      ORDER BY e."FECENT" DESC, e."CODENT" DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const data = [];
    for (const row of result.rows) {
      const lineas = await db.query(`
        SELECT l.*, a."DESART"
        FROM "F_LEN" l
        LEFT JOIN "F_ART" a ON l."ARTLEN" = a."CODART"
        WHERE l."TIPLEN" = $1 AND l."CODLEN" = $2
        ORDER BY l."POSLEN"
      `, [row.TIPENT, row.CODENT]);
      data.push({ ...row, lineas: lineas.rows });
    }

    res.json({ data, total, page, limit });
  } catch (err) {
    console.error('Entradas proveedor error:', err.message);
    res.status(500).json({ error: 'Failed to fetch entradas proveedor', message: err.message });
  }
});

router.get('/entradas-proveedor/:tipo/:codigo', async (req, res) => {
  try {
    const { tipo, codigo } = req.params;

    const entRes = await db.query(`
      SELECT e.*,
        p."NOFPRO" AS proveedor_nombre, p."NIFPRO",
        fp."DESFPA" AS forma_pago,
        al."NOMALM" AS almacen_nombre
      FROM "F_ENT" e
      LEFT JOIN "F_PRO" p ON e."PROENT" = p."CODPRO"
      LEFT JOIN "F_FPA" fp ON e."FOPENT" = fp."CODFPA"
      LEFT JOIN "F_ALM" al ON e."ALMENT" = al."CODALM"
      WHERE e."TIPENT" = $1 AND e."CODENT" = $2
    `, [tipo, parseInt(codigo)]);

    if (entRes.rows.length === 0) {
      return res.status(404).json({ error: 'Entrada proveedor not found' });
    }

    const lineas = await db.query(`
      SELECT l.*, a."DESART"
      FROM "F_LEN" l
      LEFT JOIN "F_ART" a ON l."ARTLEN" = a."CODART"
      WHERE l."TIPLEN" = $1 AND l."CODLEN" = $2
      ORDER BY l."POSLEN"
    `, [tipo, parseInt(codigo)]);

    res.json({
      entrada: entRes.rows[0],
      lineas: lineas.rows,
    });
  } catch (err) {
    console.error('Entrada proveedor detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch entrada proveedor', message: err.message });
  }
});

// ─── ENDPOINT: FACTURAS_CLIENTES ───────────────────────────────────────

router.get('/facturas-clientes', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);

    const countRes = await db.query('SELECT COUNT(*) FROM "F_FAC"');
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT fc."TIPFAC", fc."CODFAC", fc."REFFAC", fc."FECFAC", fc."CLIFAC",
        fc."ESTFAC", fc."TOTFAC", fc."FOPFAC", fc."ALMFAC", fc."AGEFAC", fc."CNOFAC",
        c."NOFCLI" AS cliente_nombre,
        ag."NOMAGE" AS agente_nombre,
        fp."DESFPA" AS forma_pago
      FROM "F_FAC" fc
      LEFT JOIN "F_CLI" c ON fc."CLIFAC" = c."CODCLI"
      LEFT JOIN "F_AGE" ag ON fc."AGEFAC" = ag."CODAGE"
      LEFT JOIN "F_FPA" fp ON fc."FOPFAC" = fp."CODFPA"
      ORDER BY fc."FECFAC" DESC, fc."CODFAC" DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const data = [];
    for (const row of result.rows) {
      const lineas = await db.query(`
        SELECT l.*, a."DESART"
        FROM "F_LFA" l
        LEFT JOIN "F_ART" a ON l."ARTLFA" = a."CODART"
        WHERE l."TIPLFA" = $1 AND l."CODLFA" = $2
        ORDER BY l."POSLFA"
      `, [row.TIPFAC, row.CODFAC]);
      data.push({ ...row, lineas: lineas.rows });
    }

    res.json({ data, total, page, limit });
  } catch (err) {
    console.error('Facturas clientes error:', err.message);
    res.status(500).json({ error: 'Failed to fetch facturas clientes', message: err.message });
  }
});

router.get('/facturas-clientes/:tipo/:codigo', async (req, res) => {
  try {
    const { tipo, codigo } = req.params;

    const facRes = await db.query(`
      SELECT fc.*,
        c."NOFCLI" AS cliente_nombre, c."NIFCLI",
        ag."NOMAGE" AS agente_nombre,
        fp."DESFPA" AS forma_pago,
        al."NOMALM" AS almacen_nombre
      FROM "F_FAC" fc
      LEFT JOIN "F_CLI" c ON fc."CLIFAC" = c."CODCLI"
      LEFT JOIN "F_AGE" ag ON fc."AGEFAC" = ag."CODAGE"
      LEFT JOIN "F_FPA" fp ON fc."FOPFAC" = fp."CODFPA"
      LEFT JOIN "F_ALM" al ON fc."ALMFAC" = al."CODALM"
      WHERE fc."TIPFAC" = $1 AND fc."CODFAC" = $2
    `, [tipo, parseInt(codigo)]);

    if (facRes.rows.length === 0) {
      return res.status(404).json({ error: 'Factura cliente not found' });
    }

    const [lineas, cobros] = await Promise.all([
      db.query(`
        SELECT l.*, a."DESART"
        FROM "F_LFA" l
        LEFT JOIN "F_ART" a ON l."ARTLFA" = a."CODART"
        WHERE l."TIPLFA" = $1 AND l."CODLFA" = $2
        ORDER BY l."POSLFA"
      `, [tipo, parseInt(codigo)]),
      db.query(`
        SELECT * FROM "F_LCO"
        WHERE "TFALCO" = $1 AND "CFALCO" = $2
        ORDER BY "LINLCO"
      `, [tipo, parseInt(codigo)]),
    ]);

    res.json({
      factura: facRes.rows[0],
      lineas: lineas.rows,
      cobros: cobros.rows,
    });
  } catch (err) {
    console.error('Factura cliente detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch factura cliente', message: err.message });
  }
});

module.exports = router;
