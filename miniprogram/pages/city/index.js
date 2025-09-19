// pages/city/index.js
Page({
    data: { city: '' },
    onLoad(query) {
      const city = decodeURIComponent(query.city || '');
      this.setData({ city });
      wx.setNavigationBarTitle({ title: city || '城市' });
    },
    goNew() {
      wx.navigateTo({
        url: `/pages/contract-new/index?city=${encodeURIComponent(this.data.city)}&mode=create`
      });
    },
    goList() {
      wx.navigateTo({
        url: `/pages/contract-list/index?city=${encodeURIComponent(this.data.city)}`
      });
    }
  });
  