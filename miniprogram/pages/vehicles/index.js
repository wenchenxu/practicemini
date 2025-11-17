const { ensureAdmin } = require('../../utils/guard');

Page({
  data: {
    percent: 0,
    rented: 0,
    total: 0
  },

  onShow() {
    if (!ensureAdmin()) return;
    this.refresh();
  },

  async refresh() {
    await this.loadStats();
  },

  async loadStats() {
    wx.showNavigationBarLoading();
    try {
      const { result } = await wx.cloud.callFunction({ name: 'vehicles', data: { action: 'getStats' } });
      if (result && result.ok) {
        this.setData({ rented: result.rented, total: result.total, percent: result.percent });
        this.drawRing(result.percent);
      }
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  goGuangzhou() {
    wx.navigateTo({ url: '/pages/vehicles/guangzhou/guangzhou' });
  },

  drawRing(percent) {
    const size = 240; // px
    const center = size / 2;
    const radius = center - 10;
    const start = -Math.PI / 2;
    const end = start + (Math.PI * 2 * (percent / 100));

    const ctx = wx.createCanvasContext('ring', this);
    ctx.clearRect(0, 0, size, size);

    ctx.setLineWidth(16);
    ctx.setStrokeStyle('#eee');
    ctx.setLineCap('round');
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setStrokeStyle('#07c160');
    ctx.beginPath();
    ctx.arc(center, center, radius, start, end);
    ctx.stroke();

    ctx.draw();
  }
});

