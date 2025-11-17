const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;
const WL = db.collection('whitelist');
const VEH = db.collection('vehicles');

const ALLOWED = ['renting', 'available', 'repair'];
const DEFAULT_CITY = 'guangzhou';
const CITY_CODES = ['guangzhou', 'foshan', 'huizhou', 'jiaxing', 'shaoxing', 'nantong', 'changzhou', 'suzhou'];
const CITY_NAME_TO_CODE = {
  '广州': 'guangzhou',
  '佛山': 'foshan',
  '惠州': 'huizhou',
  '嘉兴': 'jiaxing',
  '绍兴': 'shaoxing',
  '南通': 'nantong',
  '常州': 'changzhou',
  '苏州': 'suzhou'
};

function normalizeCityCode(value) {
  if (!value) return '';
  const str = String(value).trim();
  const lower = str.toLowerCase();
  if (CITY_CODES.includes(lower)) return lower;
  if (CITY_NAME_TO_CODE[str]) return CITY_NAME_TO_CODE[str];
  return '';
}

function resolveCityCode(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeCityCode(candidate);
    if (normalized) return normalized;
  }
  return DEFAULT_CITY;
}

function normalizeStatus(s) {
  const t = String(s || '').toLowerCase();
  if (t === 'maintenance' || t === 'repairing') return 'repair';
  if (t === 'rented') return 'renting';
  if (ALLOWED.includes(t)) return t;
  return 'available';
}

async function getScope(cityCode) {
  // Prefer scoped query. If legacy data does not contain city codes, fall back to whole collection.
  const scoped = (await VEH.where({ cityCode }).count()).total;
  if (scoped > 0) return { cityCode };
  const legacy = (await VEH.where(_.or([{ cityCode: _.exists(false) }, { cityCode: _.eq('') }])).count()).total;
  return legacy > 0 ? {} : { cityCode };
}

async function isAdmin(openid) {
  const me = await WL.where({ openid }).limit(1).get();
  return me.data.length && me.data[0].role === 'admin';
}

async function getStats(cityCode) {
  const scope = await getScope(cityCode);
  const total = (await VEH.where(scope).count()).total;
  const rented = (await VEH.where({ ...scope, status: _.in(['renting', 'rented']) }).count()).total;
  const percent = total ? Math.round((rented / total) * 100) : 0;
  return { ok: true, total, rented, percent };
}

async function listAll(cityCode) {
  const pageSize = 100;
  let skip = 0;
  let all = [];
  const scope = await getScope(cityCode);
  while (true) {
    const res = await VEH.where(scope)
      .skip(skip).limit(pageSize).get();
    all = all.concat(res.data || []);
    if (!res.data || res.data.length < pageSize) break;
    skip += pageSize;
  }
  // Normalize statuses for UI
  const data = all.map(d => ({ ...d, status: normalizeStatus(d.status) }));
  return { ok: true, data };
}

async function updateStatus({ id, status }) {
  if (!id || !ALLOWED.includes(status)) return { ok: false, msg: 'bad-params' };
  const ret = await VEH.doc(id).update({ data: { status } });
  return { ok: true, updated: ret.stats.updated };
}

async function createVehicle({ vin, plate, status }, cityCode) {
  if (!vin || !plate) return { ok: false, msg: 'vin/plate required' };
  const st = ALLOWED.includes((status || '').toLowerCase()) ? status.toLowerCase() : 'available';
  const exists = await VEH.where({ vin, cityCode }).limit(1).get();
  if (exists.data.length) {
    return { ok: false, msg: 'exists' };
  }
  const ret = await VEH.add({ data: {
    vin, plate, status: st,
    cityCode,
    createdAt: db.serverDate(),
  }});
  return { ok: true, id: ret._id };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { action, data = {} } = event || {};
  const cityCode = resolveCityCode(event && event.cityCode, event && event.city, data.cityCode, data.city);
  const admin = await isAdmin(OPENID);

  if (['updateStatus', 'create'].includes(action) && !admin) {
    return { ok: false, msg: 'no-permission' };
  }

  switch (action) {
    case 'getStats': return await getStats(cityCode);
    case 'list': return await listAll(cityCode);
    case 'updateStatus': return await updateStatus(data);
    case 'create': return await createVehicle(data, cityCode);
    default: return { ok: false, msg: 'unknown-action' };
  }
};
