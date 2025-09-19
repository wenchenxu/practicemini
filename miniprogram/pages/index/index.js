// index.js
const { CITIES } = require('../../utils/constants.js');

Page({
    data: { cities: CITIES },
    goCity(e) {
      const city = e.currentTarget.dataset.city;
      wx.navigateTo({ url: `/pages/city/index?city=${encodeURIComponent(city)}` });
    }
})