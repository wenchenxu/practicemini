// pages/driver-center/index.js

const db = wx.cloud.database();
const COL_DRIVERS = db.collection('drivers');

Page({
  data: {
    cityCode: '',
    cityName: '',
    loading: false,
    error: '',
    drivers: []
  },

  onLoad(options) {
    const cityCode = decodeURIComponent(options.cityCode || '');
    const cityName = decodeURIComponent(options.cityName || '');
    this.setData({ cityCode, cityName });

    if (!cityCode) {
      this.setData({ error: '缺少城市参数 cityCode' });
      return;
    }

    this.fetchDrivers();
  },

  async fetchDrivers() {
    const { cityCode } = this.data;
    this.setData({ loading: true, error: '', drivers: [] });

    try {
      // 最简单版：一次性拉一页所有司机（数量不大问题不大）
      const res = await COL_DRIVERS
        .where({ cityCode })  // 如果你 drivers 没存 cityCode，可以先只查询全部，再自己过滤
        .orderBy('name', 'asc')  // 没有 name 字段的话可改成 createdAt
        .get();

      this.setData({
        drivers: res.data || [],
        loading: false
      });
    } catch (e) {
      console.error('[driver-center] fetchDrivers error', e);
      this.setData({
        error: '加载司机列表失败',
        loading: false
      });
    }
  },

  // 点击某个司机 → 跳到 driver-detail
  onTapDriver(e) {
    const clientId = e.currentTarget.dataset.clientId;
    const name = e.currentTarget.dataset.name || '';

    if (!clientId) {
      return wx.showToast({ title: '缺少身份证号', icon: 'none' });
    }

    wx.navigateTo({
      url: `/pages/driver-detail/index?clientId=${encodeURIComponent(clientId)}&name=${encodeURIComponent(name)}`
    });
  },

  onPullDownRefresh() {
    this.fetchDrivers()
      .catch(err => {
        console.error(err);
        wx.showToast({ title: '刷新失败', icon: 'none' });
      })
      .finally(() => {
        wx.stopPullDownRefresh();
      });
  },
});
