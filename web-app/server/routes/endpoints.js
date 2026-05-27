const express = require('express');
const db = require('../lib/db');

const router = express.Router();

function paginate(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ─── ENDPOINT: ARTICULOS ───────────────────────────────────────────────
// Tables: F_ART, F_EAN, F_SEC, F_FAM, F_ALM, F_STO, F_TAR, F_LTA, F_UME

router.get('/articulos', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const search = req.query.search || '';

    let where = '';
    const params = [];
    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      where = `WHERE a.codart ILIKE $1 OR a.desart ILIKE $2`;
    }

    const countRes = await db.query(
      `SELECT COUNT(*) FROM "F_ART" a ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataParams = [...params, limit, offset];
    const result = await db.query(`
      SELECT
        a.codart, a.desart, a.pcoart, a.phaart, a.tivart, a.stoart,
        a.famart, a.eanart, a.umeart, a.falart, a.refart,
        f.codfam, f.desfam, f.secfam,
        s.codsec, s.dessec,
        u.codume, u.desume
      FROM "F_ART" a
      LEFT JOIN "F_FAM" f ON a.famart = f.codfam
      LEFT JOIN "F_SEC" s ON f.secfam = s.codsec
      LEFT JOIN "F_UME" u ON a.umeart = u.codume
      ${where}
      ORDER BY a.codart
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
        f.codfam, f.desfam, f.secfam,
        s.codsec, s.dessec,
        u.codume, u.desume
      FROM "F_ART" a
      LEFT JOIN "F_FAM" f ON a.famart = f.codfam
      LEFT JOIN "F_SEC" s ON f.secfam = s.codsec
      LEFT JOIN "F_UME" u ON a.umeart = u.codume
      WHERE a.codart = $1
    `, [codart]);

    if (artRes.rows.length === 0) {
      return res.status(404).json({ error: 'Articulo not found' });
    }

    const art = artRes.rows[0];

    const [eanRes, stoRes, ltaRes] = await Promise.all([
      db.query('SELECT * FROM "F_EAN" WHERE artean = $1', [codart]),
      db.query(`
        SELECT st.*, al.nomalm
        FROM "F_STO" st
        LEFT JOIN "F_ALM" al ON st.almsto = al.codalm
        WHERE st.artsto = $1
      `, [codart]),
      db.query(`
        SELECT lt.*, t.destar
        FROM "F_LTA" lt
        LEFT JOIN "F_TAR" t ON lt.tarlta = t.codtar
        WHERE lt.artlta = $1
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
// Tables: F_PRO, F_CLI, F_AGE, F_FPA

router.get('/catalogos/proveedores', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const search = req.query.search || '';

    let where = '';
    const params = [];
    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      where = `WHERE p.nofpro ILIKE $1 OR p.nocpro ILIKE $2`;
    }

    const countRes = await db.query(`SELECT COUNT(*) FROM "F_PRO" p ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT p.codpro, p.nifpro, p.nofpro, p.nocpro, p.dompro, p.pobpro,
        p.cpopro, p.propro, p.telpro, p.emapro, p.fpapro,
        fp.desfpa AS forma_pago
      FROM "F_PRO" p
      LEFT JOIN "F_FPA" fp ON p.fpapro = fp.codfpa
      ${where}
      ORDER BY p.codpro
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
      where = `WHERE c.nofcli ILIKE $1 OR c.noccli ILIKE $2`;
    }

    const countRes = await db.query(`SELECT COUNT(*) FROM "F_CLI" c ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT c.codcli, c.nifcli, c.nofcli, c.noccli, c.domcli, c.pobcli,
        c.cpocli, c.procli, c.telcli, c.emacli, c.agecli, c.fpacli, c.tarcli,
        ag.nomage AS agente_nombre,
        fp.desfpa AS forma_pago
      FROM "F_CLI" c
      LEFT JOIN "F_AGE" ag ON c.agecli = ag.codage
      LEFT JOIN "F_FPA" fp ON c.fpacli = fp.codfpa
      ${where}
      ORDER BY c.codcli
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
      SELECT codage, nomage, nocage, domage, emaage, comage, zonage, temage
      FROM "F_AGE" ORDER BY codage
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
      SELECT codfpa, desfpa, venfpa, tipfpa, efefpa
      FROM "F_FPA" ORDER BY codfpa
    `);
    res.json({ data: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('Formas de pago error:', err.message);
    res.status(500).json({ error: 'Failed to fetch formas de pago', message: err.message });
  }
});

// ─── ENDPOINT: TRASPASOS ───────────────────────────────────────────────
// Tables: F_TRA, F_LTR

router.get('/traspasos', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);

    const countRes = await db.query('SELECT COUNT(*) FROM "F_TRA"');
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT t.doctra, t.fectra, t.aortra, t.adetra, t.comtra,
        ao.nomalm AS almacen_origen,
        ad.nomalm AS almacen_destino,
        (SELECT COUNT(*) FROM "F_LTR" WHERE docltr = t.doctra) AS num_lineas
      FROM "F_TRA" t
      LEFT JOIN "F_ALM" ao ON t.aortra = ao.codalm
      LEFT JOIN "F_ALM" ad ON t.adetra = ad.codalm
      ORDER BY t.doctra DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({ data: result.rows, total, page, limit });
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
        ao.nomalm AS almacen_origen,
        ad.nomalm AS almacen_destino
      FROM "F_TRA" t
      LEFT JOIN "F_ALM" ao ON t.aortra = ao.codalm
      LEFT JOIN "F_ALM" ad ON t.adetra = ad.codalm
      WHERE t.doctra = $1
    `, [doctra]);

    if (traRes.rows.length === 0) {
      return res.status(404).json({ error: 'Traspaso not found' });
    }

    const lineas = await db.query(`
      SELECT l.*, a.desart
      FROM "F_LTR" l
      LEFT JOIN "F_ART" a ON l.artltr = a.codart
      WHERE l.docltr = $1
      ORDER BY l.linltr
    `, [doctra]);

    res.json({ traspaso: traRes.rows[0], lineas: lineas.rows });
  } catch (err) {
    console.error('Traspaso detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch traspaso', message: err.message });
  }
});

// ─── ENDPOINT: FACTURAS_PROVEEDOR ──────────────────────────────────────
// Tables: F_FRE, F_LFR, F_LPF

router.get('/facturas-proveedor', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);

    const countRes = await db.query('SELECT COUNT(*) FROM "F_FRE"');
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT fr.tipfre, fr.codfre, fr.facfre, fr.fecfre, fr.profre,
        fr.estfre, fr.totfre, fr.fopfre, fr.almfre,
        p.nofpro AS proveedor_nombre,
        fp.desfpa AS forma_pago,
        (SELECT COUNT(*) FROM "F_LFR" WHERE tiplfr = fr.tipfre AND codlfr = fr.codfre) AS num_lineas
      FROM "F_FRE" fr
      LEFT JOIN "F_PRO" p ON fr.profre = p.codpro
      LEFT JOIN "F_FPA" fp ON fr.fopfre = fp.codfpa
      ORDER BY fr.fecfre DESC, fr.codfre DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({ data: result.rows, total, page, limit });
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
        p.nofpro AS proveedor_nombre, p.nifpro,
        fp.desfpa AS forma_pago,
        al.nomalm AS almacen_nombre
      FROM "F_FRE" fr
      LEFT JOIN "F_PRO" p ON fr.profre = p.codpro
      LEFT JOIN "F_FPA" fp ON fr.fopfre = fp.codfpa
      LEFT JOIN "F_ALM" al ON fr.almfre = al.codalm
      WHERE fr.tipfre = $1 AND fr.codfre = $2
    `, [tipo, parseInt(codigo)]);

    if (freRes.rows.length === 0) {
      return res.status(404).json({ error: 'Factura proveedor not found' });
    }

    const [lineas, pagos] = await Promise.all([
      db.query(`
        SELECT l.*, a.desart
        FROM "F_LFR" l
        LEFT JOIN "F_ART" a ON l.artlfr = a.codart
        WHERE l.tiplfr = $1 AND l.codlfr = $2
        ORDER BY l.poslfr
      `, [tipo, parseInt(codigo)]),
      db.query(`
        SELECT * FROM "F_LPF"
        WHERE tfrlpf = $1 AND cfrlpf = $2
        ORDER BY linlpf
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
// Tables: F_ALB, F_LAL, F_LAC

router.get('/remisiones', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);

    const countRes = await db.query('SELECT COUNT(*) FROM "F_ALB"');
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT ab.tipalb, ab.codalb, ab.refalb, ab.fecalb, ab.clialb,
        ab.estalb, ab.totalb, ab.fopalb, ab.almalb, ab.agealb, ab.cnoalb,
        c.nofcli AS cliente_nombre,
        ag.nomage AS agente_nombre,
        fp.desfpa AS forma_pago,
        (SELECT COUNT(*) FROM "F_LAL" WHERE tiplal = ab.tipalb AND codlal = ab.codalb) AS num_lineas
      FROM "F_ALB" ab
      LEFT JOIN "F_CLI" c ON ab.clialb = c.codcli
      LEFT JOIN "F_AGE" ag ON ab.agealb = ag.codage
      LEFT JOIN "F_FPA" fp ON ab.fopalb = fp.codfpa
      ORDER BY ab.fecalb DESC, ab.codalb DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({ data: result.rows, total, page, limit });
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
        c.nofcli AS cliente_nombre, c.nifcli,
        ag.nomage AS agente_nombre,
        fp.desfpa AS forma_pago,
        al.nomalm AS almacen_nombre
      FROM "F_ALB" ab
      LEFT JOIN "F_CLI" c ON ab.clialb = c.codcli
      LEFT JOIN "F_AGE" ag ON ab.agealb = ag.codage
      LEFT JOIN "F_FPA" fp ON ab.fopalb = fp.codfpa
      LEFT JOIN "F_ALM" al ON ab.almalb = al.codalm
      WHERE ab.tipalb = $1 AND ab.codalb = $2
    `, [tipo, parseInt(codigo)]);

    if (albRes.rows.length === 0) {
      return res.status(404).json({ error: 'Remision not found' });
    }

    const [lineas, cobros] = await Promise.all([
      db.query(`
        SELECT l.*, a.desart
        FROM "F_LAL" l
        LEFT JOIN "F_ART" a ON l.artlal = a.codart
        WHERE l.tiplal = $1 AND l.codlal = $2
        ORDER BY l.poslal
      `, [tipo, parseInt(codigo)]),
      db.query(`
        SELECT * FROM "F_LAC"
        WHERE tfalac = $1 AND callac = $2
        ORDER BY linlac
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
// Tables: F_ALM, F_STO, F_PRO, F_CIN

router.get('/existencias', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const almacen = req.query.almacen || '';
    const search = req.query.search || '';

    let where = 'WHERE 1=1';
    const params = [];
    let pi = 1;

    if (almacen) {
      where += ` AND st.almsto = $${pi++}`;
      params.push(almacen);
    }
    if (search) {
      where += ` AND (st.artsto ILIKE $${pi} OR a.desart ILIKE $${pi})`;
      params.push(`%${search}%`);
      pi++;
    }

    const countRes = await db.query(`
      SELECT COUNT(*)
      FROM "F_STO" st
      LEFT JOIN "F_ART" a ON st.artsto = a.codart
      ${where}
    `, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT st.artsto, st.almsto, st.actsto, st.dissto, st.minsto, st.maxsto,
        a.desart, a.pcoart, a.phaart,
        al.nomalm AS almacen_nombre,
        p.nofpro AS proveedor_nombre
      FROM "F_STO" st
      LEFT JOIN "F_ART" a ON st.artsto = a.codart
      LEFT JOIN "F_ALM" al ON st.almsto = al.codalm
      LEFT JOIN "F_PRO" p ON a.phaart = p.codpro
      ${where}
      ORDER BY st.artsto, st.almsto
      LIMIT $${pi++} OFFSET $${pi}
    `, [...params, limit, offset]);

    res.json({ data: result.rows, total, page, limit });
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
        a.desart, a.pcoart, a.phaart, a.famart,
        al.nomalm AS almacen_nombre,
        p.nofpro AS proveedor_nombre
      FROM "F_STO" st
      LEFT JOIN "F_ART" a ON st.artsto = a.codart
      LEFT JOIN "F_ALM" al ON st.almsto = al.codalm
      LEFT JOIN "F_PRO" p ON a.phaart = p.codpro
      WHERE st.artsto = $1 AND st.almsto = $2
    `, [artsto, almsto]);

    if (stoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Stock record not found' });
    }

    const cinRes = await db.query(`
      SELECT * FROM "F_CIN"
      WHERE artcin = $1 AND almcin = $2
      ORDER BY feccin DESC
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
// Tables: F_ENT, F_LEN

router.get('/entradas-proveedor', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);

    const countRes = await db.query('SELECT COUNT(*) FROM "F_ENT"');
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT e.tipent, e.codent, e.refent, e.fecent, e.proent,
        e.estent, e.totent, e.fopent, e.alment,
        p.nofpro AS proveedor_nombre,
        fp.desfpa AS forma_pago,
        (SELECT COUNT(*) FROM "F_LEN" WHERE tiplen = e.tipent AND codlen = e.codent) AS num_lineas
      FROM "F_ENT" e
      LEFT JOIN "F_PRO" p ON e.proent = p.codpro
      LEFT JOIN "F_FPA" fp ON e.fopent = fp.codfpa
      ORDER BY e.fecent DESC, e.codent DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({ data: result.rows, total, page, limit });
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
        p.nofpro AS proveedor_nombre, p.nifpro,
        fp.desfpa AS forma_pago,
        al.nomalm AS almacen_nombre
      FROM "F_ENT" e
      LEFT JOIN "F_PRO" p ON e.proent = p.codpro
      LEFT JOIN "F_FPA" fp ON e.fopent = fp.codfpa
      LEFT JOIN "F_ALM" al ON e.alment = al.codalm
      WHERE e.tipent = $1 AND e.codent = $2
    `, [tipo, parseInt(codigo)]);

    if (entRes.rows.length === 0) {
      return res.status(404).json({ error: 'Entrada proveedor not found' });
    }

    const lineas = await db.query(`
      SELECT l.*, a.desart
      FROM "F_LEN" l
      LEFT JOIN "F_ART" a ON l.artlen = a.codart
      WHERE l.tiplen = $1 AND l.codlen = $2
      ORDER BY l.poslen
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
// Tables: F_FAC, F_LFA, F_LCO

router.get('/facturas-clientes', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);

    const countRes = await db.query('SELECT COUNT(*) FROM "F_FAC"');
    const total = parseInt(countRes.rows[0].count);

    const result = await db.query(`
      SELECT fc.tipfac, fc.codfac, fc.reffac, fc.fecfac, fc.clifac,
        fc.estfac, fc.totfac, fc.fopfac, fc.almfac, fc.agefac, fc.cnofac,
        c.nofcli AS cliente_nombre,
        ag.nomage AS agente_nombre,
        fp.desfpa AS forma_pago,
        (SELECT COUNT(*) FROM "F_LFA" WHERE tiplfa = fc.tipfac AND codlfa = fc.codfac) AS num_lineas
      FROM "F_FAC" fc
      LEFT JOIN "F_CLI" c ON fc.clifac = c.codcli
      LEFT JOIN "F_AGE" ag ON fc.agefac = ag.codage
      LEFT JOIN "F_FPA" fp ON fc.fopfac = fp.codfpa
      ORDER BY fc.fecfac DESC, fc.codfac DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({ data: result.rows, total, page, limit });
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
        c.nofcli AS cliente_nombre, c.nifcli,
        ag.nomage AS agente_nombre,
        fp.desfpa AS forma_pago,
        al.nomalm AS almacen_nombre
      FROM "F_FAC" fc
      LEFT JOIN "F_CLI" c ON fc.clifac = c.codcli
      LEFT JOIN "F_AGE" ag ON fc.agefac = ag.codage
      LEFT JOIN "F_FPA" fp ON fc.fopfac = fp.codfpa
      LEFT JOIN "F_ALM" al ON fc.almfac = al.codalm
      WHERE fc.tipfac = $1 AND fc.codfac = $2
    `, [tipo, parseInt(codigo)]);

    if (facRes.rows.length === 0) {
      return res.status(404).json({ error: 'Factura cliente not found' });
    }

    const [lineas, cobros] = await Promise.all([
      db.query(`
        SELECT l.*, a.desart
        FROM "F_LFA" l
        LEFT JOIN "F_ART" a ON l.artlfa = a.codart
        WHERE l.tiplfa = $1 AND l.codlfa = $2
        ORDER BY l.poslfa
      `, [tipo, parseInt(codigo)]),
      db.query(`
        SELECT * FROM "F_LCO"
        WHERE tfalco = $1 AND cfalco = $2
        ORDER BY linlco
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
