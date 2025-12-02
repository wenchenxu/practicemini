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
    },

    onGoDriverCenter() {
        const { cityCode, city } = this.data;
        if (!cityCode) {
          return wx.showToast({ title: '缺少城市信息', icon: 'none' });
        }
        wx.navigateTo({
          url: `/pages/driver-center/index?cityCode=${encodeURIComponent(cityCode)}&cityName=${encodeURIComponent(city)}`
        });
    },

    toVehicleCenter() {
        const { cityCode, city } = this.data;
        wx.navigateTo({
          url: `/pages/vehicle-center/index?cityCode=${cityCode}&city=${city}`,
        });
    }
  });
  