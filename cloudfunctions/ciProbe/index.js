const cloud = require('wx-server-sdk');
const fetch = require('node-fetch');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { docxFileID } = event || {};
  if (!docxFileID) return { ok:false, error:'missing docxFileID' };

  // 取临时 URL
  const tmp = await cloud.getTempFileURL({ fileList:[docxFileID] });
  const docxUrl = tmp?.fileList?.[0]?.tempFileURL;
  if (!docxUrl) return { ok:false, error:'tempFileURL failed' };

  const ciUrl = docxUrl + (docxUrl.includes('?') ? '&' : '?') + 'ci-process=doc-preview&dstType=pdf';
  const resp = await fetch(ciUrl);
  const buf = await resp.buffer();
  const head = buf.slice(0,5).toString(); // 应该是 "%PDF-"
  const type = resp.headers.get('content-type');

  return {
    ok: resp.ok,
    status: resp.status,
    contentType: type,
    size: buf.length,
    head5: head,          // 期待 "%PDF-"
    sampleUrl: ciUrl      // 方便排查
  };
};
