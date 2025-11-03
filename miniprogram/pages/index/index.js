import { CITY_CODE_MAP } from '../../utils/cities';

Page({
  data: {},
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
  }
});
