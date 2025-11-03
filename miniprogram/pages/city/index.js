Page({
    onLoad(q) {
      const cityCode = decodeURIComponent(q.cityCode || '');
      const city = decodeURIComponent(q.city || '');
      this.setData({ cityCode, city });
      wx.setNavigationBarTitle({ title: `${city} - 门店` });
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
    // 调试/开发
    goDebug() {
        const { cityCode, city } = this.data;
        wx.navigateTo({
          url: `/pages/fadada-test/index?cityCode=${encodeURIComponent(cityCode)}&city=${encodeURIComponent(city)}`
        });
    }
  });
  