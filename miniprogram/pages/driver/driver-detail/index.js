// pages/driver-detail/index.js

const db = wx.cloud.database();
const COL_DRIVERS   = db.collection('drivers');
const COL_CONTRACTS = db.collection('contracts');
const COL_VEHICLES  = db.collection('vehicles');

// 司机证件照 key → 展示名
const DRIVER_DOC_LABELS = {
  idCardFront: '身份证 人像面',
  idCardBack: '身份证 国徽面',
  licenseFront: '驾驶证 正页',
  licenseBack: '驾驶证 副页'
};
const DRIVER_DOC_KEYS = Object.keys(DRIVER_DOC_LABELS);

Page({
  data: {
    clientId: '',
    nameFromQuery: '',
    loading: false,

    driver: null,
    latestContract: null,
    currentVehicle: null,

    driverDocImages: [] // [{key, label, fileID, url}]
  },

  onLoad(options) {
    const clientId = decodeURIComponent(options.clientId || '');
    const name     = decodeURIComponent(options.name || '');

    if (!clientId) {
      wx.showToast({ title: '缺少身份证号', icon: 'none' });
      return;
    }

    this.setData({ clientId, nameFromQuery: name });
    this.loadAll();
  },

  async loadAll() {
    const { clientId } = this.data;
    this.setData({ loading: true });

    try {
      // 1）司机档案
      const drvRes = await COL_DRIVERS.where({ clientId }).limit(1).get();
      const driver = drvRes.data && drvRes.data[0] ? drvRes.data[0] : null;

      // 2）最近一份合同：按 createdAt 倒序取 1 条
      const cRes = await COL_CONTRACTS
        .where({ 'fields.clientId': clientId })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      let latestContract = cRes.data && cRes.data[0] ? cRes.data[0] : null;

      if (latestContract && latestContract.createdAt) {
        // createdAt 是 Date 对象
        const d = latestContract.createdAt;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        latestContract.createdAtFmt = `${y}-${m}-${day}`;
      }

      // 3）当前车辆：按 currentDriverId === clientId 查询 1 条
      const vRes = await COL_VEHICLES
        .where({ currentDriverId: clientId })
        .limit(1)
        .get();
      const currentVehicle = vRes.data && vRes.data[0] ? vRes.data[0] : null;

      this.setData({
        driver,
        latestContract,
        currentVehicle
      });

      // [司机证件照模块 - 暂时下线 2026-10-23] 恢复时取消下行注释
      // this.loadDriverDocs(driver);
    } catch (e) {
      console.error('[driver-detail] loadAll error', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // ===== 司机证件照查看（最新版，来自 driver.documents）=====
  async loadDriverDocs(driver) {
    try {
      const docs = (driver && driver.documents) || {};
      const list = [];
      for (const k of DRIVER_DOC_KEYS) {
        if (docs[k] && docs[k].fileID) {
          list.push({ key: k, label: DRIVER_DOC_LABELS[k], fileID: docs[k].fileID, url: '' });
        }
      }
      this.setData({ driverDocImages: list });

      if (list.length === 0) return;

      const t = await wx.cloud.getTempFileURL({ fileList: list.map(x => x.fileID) });
      const urlMap = {};
      (t.fileList || []).forEach(f => {
        if (f.fileID && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL;
      });
      this.setData({
        driverDocImages: list.map(x => ({ ...x, url: urlMap[x.fileID] || '' }))
      });
    } catch (e) {
      console.error('[driver-detail] loadDriverDocs error', e);
    }
  },

  // 点击证件缩略图 → 全屏预览
  onPreviewDriverDocImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const img = this.data.driverDocImages[idx];
    if (!img) return;
    if (!img.url) {
      return wx.showToast({ title: '图片链接获取中，请稍候再试', icon: 'none' });
    }
    const urls = this.data.driverDocImages.filter(x => x.url).map(x => x.url);
    wx.previewImage({ current: img.url, urls });
  }
});
