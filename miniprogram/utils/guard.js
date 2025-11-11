// utils/guard.js
function ensureAccess() {
    const app = getApp();
    if (!app.globalData.allowed) {
      wx.reLaunch({ url: '/pages/no-access/no-access' });
      return false;
    }
    return true;
  }
  
  function ensureAdmin() {
    const app = getApp();
    if (!app.globalData.allowed || app.globalData.role !== 'admin') {
      wx.showToast({ title: '仅管理员可访问', icon: 'none' });
      wx.reLaunch({ url: '/pages/no-access/no-access' });
      return false;
    }
    return true;
  }
  
  module.exports = { ensureAccess, ensureAdmin };
  