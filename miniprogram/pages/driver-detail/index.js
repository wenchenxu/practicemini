// pages/driver-detail/index.js

const db = wx.cloud.database();
const COL_DRIVERS   = db.collection('drivers');
const COL_CONTRACTS = db.collection('contracts');
const COL_VEHICLES  = db.collection('vehicles');

Page({
  data: {
    clientId: '',
    nameFromQuery: '',
    loading: false,

    driver: null,
    latestContract: null,
    currentVehicle: null
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

      // 3）当前车辆：按 currentDriverClientId === clientId 查询 1 条
      const vRes = await COL_VEHICLES
        .where({ currentDriverClientId: clientId })
        .limit(1)
        .get();
      const currentVehicle = vRes.data && vRes.data[0] ? vRes.data[0] : null;

      this.setData({
        driver,
        latestContract,
        currentVehicle
      });
    } catch (e) {
      console.error('[driver-detail] loadAll error', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
