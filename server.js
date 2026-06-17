const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3457;

// Multer for file uploads (in-memory)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DATA_FILE = path.join(__dirname, 'data', 'data.json');

function read() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch { return null; }
}
function write(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf-8'); }

// Serve static H5 files
const H5 = path.join(__dirname, 'public');
app.use(express.static(H5, { maxAge: '1h' }));

// ========== API ==========
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

app.get('/api/data', (_, res) => {
  const d = read();
  if (!d) return res.status(500).json({ error: 'data lost' });
  // 按部件汇总统计
  const raisedByPart = {};
  const donorsByPart = {};
  for (const r of (d.records || [])) {
    for (const p of (d.parts || [])) {
      const name = p.nameZh || p.nameTh || p.nameEn;
      if (name === r.partName) {
        raisedByPart[p.id] = (raisedByPart[p.id] || 0) + (r.amount || 0);
        donorsByPart[p.id] = (donorsByPart[p.id] || 0) + 1;
      }
    }
  }
  d.parts = d.parts.map((p) => ({
    ...p,
    raised: raisedByPart[p.id] || 0,
    donors: donorsByPart[p.id] || 0,
  }));
  d.generatedAt = new Date().toISOString();
  res.json(d);
});

// Admin: add record
app.post('/api/admin/add-record', (req, res) => {
  const { password, displayName, title, partName, quantity, amount, donatedAt } = req.body;
  const d = read();
  if (!d) return res.status(500).json({ error: 'data lost' });
  if (password !== d.settings.adminPassword) return res.status(403).json({ error: 'wrong password' });
  if (!displayName || !amount) return res.status(400).json({ error: 'missing fields' });

  const id = `DH-${Date.now().toString(36).toUpperCase()}`;
  d.records.unshift({
    id,
    displayName,
    title: title || '',
    partName: partName || '',
    quantity: Number(quantity) || 0,
    amount: Number(amount),
    donatedAt: donatedAt || new Date().toISOString().slice(0, 10)
  });
  write(d);
  res.json({ success: true, id });
});

// Admin: delete record
app.post('/api/admin/delete-record', (req, res) => {
  const { password, id } = req.body;
  const d = read();
  if (!d) return res.status(500).json({ error: 'data lost' });
  if (password !== d.settings.adminPassword) return res.status(403).json({ error: 'wrong password' });
  d.records = d.records.filter((r) => r.id !== id);
  write(d);
  res.json({ success: true });
});

// Admin: update record
app.post('/api/admin/update-record', (req, res) => {
  const { password, id, displayName, title, partName, quantity, amount, donatedAt } = req.body;
  const d = read();
  if (!d) return res.status(500).json({ error: 'data lost' });
  if (password !== d.settings.adminPassword) return res.status(403).json({ error: 'wrong password' });
  d.records = d.records.map((r) => r.id === id ? {
    ...r,
    displayName: displayName || r.displayName,
    title: title !== undefined ? title : r.title,
    partName: partName !== undefined ? partName : r.partName,
    quantity: quantity !== undefined ? Number(quantity) : r.quantity,
    amount: amount !== undefined ? Number(amount) : r.amount,
    donatedAt: donatedAt || r.donatedAt,
  } : r);
  write(d);
  res.json({ success: true });
});

// Admin: update part (full)
app.post('/api/admin/update-part', (req, res) => {
  const { password, partId, nameZh, nameTh, nameEn, unitPrice, target, sort, enabled } = req.body;
  const d = read();
  if (!d) return res.status(500).json({ error: 'data lost' });
  if (password !== d.settings.adminPassword) return res.status(403).json({ error: 'wrong password' });
  d.parts = d.parts.map((p) => p.id === partId ? {
    ...p,
    nameZh: nameZh !== undefined ? nameZh : p.nameZh,
    nameTh: nameTh !== undefined ? nameTh : p.nameTh,
    nameEn: nameEn !== undefined ? nameEn : p.nameEn,
    unitPrice: unitPrice !== undefined ? Number(unitPrice) : p.unitPrice,
    target: target !== undefined ? Number(target) : p.target,
    sort: sort !== undefined ? Number(sort) : p.sort,
    enabled: enabled !== undefined ? enabled : p.enabled,
  } : p);
  write(d);
  res.json({ success: true });
});

// Admin: add part
app.post('/api/admin/add-part', (req, res) => {
  const { password, nameZh, nameTh, nameEn, unitPrice, target, sort, enabled } = req.body;
  const d = read();
  if (!d) return res.status(500).json({ error: 'data lost' });
  if (password !== d.settings.adminPassword) return res.status(403).json({ error: 'wrong password' });
  if (!nameZh) return res.status(400).json({ error: 'nameZh required' });
  const id = `p-${Date.now().toString(36)}`;
  const maxSort = d.parts.reduce((m, p) => Math.max(m, p.sort), 0);
  d.parts.push({
    id,
    nameZh,
    nameTh: nameTh || nameZh,
    nameEn: nameEn || nameZh,
    unitPrice: Number(unitPrice) || 0,
    target: Number(target) || 0,
    raised: 0,
    donors: 0,
    sort: sort !== undefined ? Number(sort) : maxSort + 1,
    enabled: enabled !== undefined ? enabled : true,
  });
  write(d);
  res.json({ success: true, id });
});

// Admin: delete part
app.post('/api/admin/delete-part', (req, res) => {
  const { password, partId } = req.body;
  const d = read();
  if (!d) return res.status(500).json({ error: 'data lost' });
  if (password !== d.settings.adminPassword) return res.status(403).json({ error: 'wrong password' });
  d.parts = d.parts.filter((p) => p.id !== partId);
  write(d);
  res.json({ success: true });
});

// Excel 导入功德芳名录
app.post('/api/admin/import-records', upload.single('file'), (req, res) => {
  const { password, mode } = req.body;
  const d = read();
  if (!d) return res.status(500).json({ error: 'data lost' });
  if (password !== d.settings.adminPassword) return res.status(403).json({ error: 'wrong password' });
  if (!req.file) return res.status(400).json({ error: 'no file' });

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    if (wb.SheetNames.length === 0) return res.status(400).json({ error: 'empty sheet' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    if (rows.length === 0) return res.status(400).json({ error: 'Excel 无数据' });

    const imported = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const displayName = String(row['芳名'] || row['displayName'] || row['姓名'] || '').trim();
      const title = String(row['称谓'] || row['title'] || '善信').trim();
      const partName = String(row['认捐部件'] || row['partName'] || row['部件'] || '').trim();
      const quantity = parseInt(row['数量'] || row['quantity'] || 1, 10) || 1;
      const rawAmt = row['金额'] || row['amount'] || '';
      const amount = typeof rawAmt === 'number' ? rawAmt
        : Number(String(rawAmt).replace(/[฿,，\s]/g, '')) || 0;
      const donatedAt = String(row['日期'] || row['donatedAt'] || row['认捐日期'] || new Date().toISOString().slice(0, 10)).trim().slice(0, 10);

      if (!displayName || amount === 0) {
        errors.push({ row: i + 2, 芳名: displayName, message: '缺少芳名或金额' });
        continue;
      }
      const finalTitle = ['男士', '女士', '善信'].includes(title) ? title : '善信';

      imported.push({
        id: `DH-${Date.now().toString(36).toUpperCase()}-${i}`,
        displayName,
        title: finalTitle,
        partName,
        quantity,
        amount,
        donatedAt,
      });
    }

    if (imported.length === 0) {
      return res.status(400).json({ error: '没有可导入的有效数据', errors });
    }

    if (mode === 'overwrite') {
      d.records = imported;
    } else {
      d.records = [...imported, ...(d.records || [])];
    }

    write(d);
    res.json({
      success: true,
      mode: mode || 'append',
      imported: imported.length,
      totalRecords: d.records.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (e) {
    res.status(400).json({ error: 'Excel 解析失败: ' + e.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  const idx = path.join(H5, 'index.html');
  if (fs.existsSync(idx)) res.sendFile(idx);
  else res.status(404).send('Not found');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ THCF Server running on port ${PORT}`);
});
