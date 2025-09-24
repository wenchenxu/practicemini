// cloudfunctions/healthCheck/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  console.log('[healthCheck] start', Date.now());
  const addRes = await db.collection('contracts_test').add({ data: { ping: true, ts: new Date() } });
  console.log('[healthCheck] db.add ok', addRes._id);
  const buf = Buffer.from('hello ' + Date.now());
  const up = await cloud.uploadFile({ cloudPath: `contracts/TEST/ping_${Date.now()}.txt`, fileContent: buf });
  console.log('[healthCheck] upload ok', up.fileID);
  return { ok: true, testDocId: addRes._id, fileID: up.fileID };
};
