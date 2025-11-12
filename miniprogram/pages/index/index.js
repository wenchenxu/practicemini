import { CITY_CODE_MAP } from '../../utils/cities';
const { ensureAccess } = require('../../utils/guard');

Page({
  data: {isAdmin: false},

  onShow() {
    const app = getApp();
    const apply = () => {
        if (!ensureAccess()) return;
        this.setData({ isAdmin: app.globalData.role === 'admin' });
      };

    if (app.globalData.initialized) {
      apply();
    } else {
      // 等 app.js 完成初始化后再设一次
      app.$whenReady(apply);
    }
  },

  goCity(e) {
    const code = e.currentTarget.dataset.code; // 如 "guangzhou"
    const name = CITY_CODE_MAP[code];
    wx.navigateTo({
      url: `/pages/city/index?cityCode=${encodeURIComponent(code)}&city=${encodeURIComponent(name)}`
    });
  },

  // 新增：跳转到法大大测试页
  goFadadaTest() {
    wx.navigateTo({
      url: '/pages/fadada-test/index'
    });
  },

  goWhitelist() {
      wx.navigateTo({
          url: '/pages/admin/whitelist/whitelist'
      });
  }
});
