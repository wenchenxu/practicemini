const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;
const WL = db.collection('whitelist');
const VEH = db.collection('vehicles');

const ALLOWED = ['renting', 'available', 'repair'];
const CITY = 'guangzhou';

async function isAdmin(openid) {
  const me = await WL.where({ openid }).limit(1).get();
  return me.data.length && me.data[0].role === 'admin';
}

async function getStats() {
  const total = (await VEH.where({ cityCode: CITY }).count()).total;
  const rented = (await VEH.where({ cityCode: CITY, status: 'renting' }).count()).total;
  const percent = total ? Math.round((rented / total) * 100) : 0;
  return { ok: true, total, rented, percent };
}

async function listAll() {
  const pageSize = 100;
  let skip = 0;
  let all = [];
  while (true) {
    const res = await VEH.where({ cityCode: CITY })
      .orderBy('createdAt', 'desc')
      .skip(skip).limit(pageSize).get();
    all = all.concat(res.data || []);
    if (!res.data || res.data.length < pageSize) break;
    skip += pageSize;
  }
  return { ok: true, data: all };
}

async function updateStatus({ id, status }) {
  if (!id || !ALLOWED.includes(status)) return { ok: false, msg: 'bad-params' };
  const ret = await VEH.doc(id).update({ data: { status } });
  return { ok: true, updated: ret.stats.updated };
}

async function createVehicle({ vin, plate, status }) {
  if (!vin || !plate) return { ok: false, msg: 'vin/plate required' };
  const st = ALLOWED.includes((status || '').toLowerCase()) ? status.toLowerCase() : 'available';
  const exists = await VEH.where({ vin, cityCode: CITY }).limit(1).get();
  if (exists.data.length) {
    return { ok: false, msg: 'exists' };
  }
  const ret = await VEH.add({ data: {
    vin, plate, status: st,
    cityCode: CITY,
    createdAt: db.serverDate(),
  }});
  return { ok: true, id: ret._id };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { action, data = {} } = event || {};
  const admin = await isAdmin(OPENID);

  if (['updateStatus', 'create'].includes(action) && !admin) {
    return { ok: false, msg: 'no-permission' };
  }

  switch (action) {
    case 'getStats': return await getStats();
    case 'list': return await listAll();
    case 'updateStatus': return await updateStatus(data);
    case 'create': return await createVehicle(data);
    default: return { ok: false, msg: 'unknown-action' };
  }
};

