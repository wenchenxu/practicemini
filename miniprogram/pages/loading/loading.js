const app = getApp();

Page({
  onLoad() {
    if (app.globalData.initialized) {
      this.handleAccess();
      return;
    }

    app.$whenReady(() => {
      this.handleAccess();
    });
  },

  handleAccess() {
    if (app.globalData.allowed) {
      wx.reLaunch({ url: '/pages/index/index' });
    } else {
      wx.reLaunch({ url: '/pages/no-access/no-access' });
    }
  }
});
