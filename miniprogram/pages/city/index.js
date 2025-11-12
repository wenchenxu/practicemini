const { ensureAccess } = require('../../utils/guard');

Page({
    onLoad(q) {
        const app = getApp();
        const init = () => {
          if (!ensureAccess()) return;
          const cityCode = decodeURIComponent(q.cityCode || '');
          const city = decodeURIComponent(q.city || '');
          this.setData({ cityCode, city });
          wx.setNavigationBarTitle({ title: `${city} - 门店` });
        };
        if (app.globalData.initialized) init();
        else app.$whenReady(init);
    },

    onShow() {
        const app = getApp();
        const check = () => { ensureAccess(); };
        if (app.globalData.initialized) check();
        else app.$whenReady(check);
    },

    goNew() {
      const { cityCode, city } = this.data;
      wx.navigateTo({
        url: `/pages/contract-new/index?cityCode=${encodeURIComponent(cityCode)}&city=${encodeURIComponent(city)}&mode=create`
      });
    },
    goList() {
      const { cityCode, city } = this.data;
      wx.navigateTo({
        url: `/pages/contract-list/index?cityCode=${encodeURIComponent(cityCode)}&city=${encodeURIComponent(city)}`
      });
    }
  });
  