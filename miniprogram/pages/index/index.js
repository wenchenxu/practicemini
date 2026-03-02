// pages/index/index.js
import { CITY_CODE_MAP } from '../../utils/cities';
import { BRANCH_OPTIONS_BY_CITY } from '../../utils/config';
const { ensureAccess } = require('../../utils/guard');

Page({
  data: {
    isAdmin: false,
    branchCode: '',
    branchName: ''
  },

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

    // 新增：检查该城市是否有分公司配置
    const branches = BRANCH_OPTIONS_BY_CITY[code];
    if (branches && branches.length > 0) {
      // 有分公司-> 跳转到分公司选择页
      wx.navigateTo({
        url: `/pages/branch-select/index?cityCode=${encodeURIComponent(code)}&city=${encodeURIComponent(name)}`
      });
    } else {
      // 无分公司-> 直接进入原本的城市门店页
      wx.navigateTo({
        url: `/pages/city/index?cityCode=${encodeURIComponent(code)}&city=${encodeURIComponent(name)}`
      });
    }
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
  },

  goVehicles() {
    wx.navigateTo({ url: '/pages/vehicle-kanban/index' });
  },

  goDevTools() {
    wx.navigateTo({
      url: '/pages/dev-tools/index'
    });
  }
});
