import { CITY_CODE_MAP } from '../../utils/cities';
const { ensureAdmin } = require('../../utils/guard');

const DEFAULT_CITY_CODE = 'guangzhou';
const CITY_NAME_TO_CODE = {};
Object.entries(CITY_CODE_MAP).forEach(([code, label]) => {
  CITY_NAME_TO_CODE[label] = code;
});

function normalizeCityCode(val) {
  if (!val) return '';
  const str = String(val).trim();
  const lower = str.toLowerCase();
  if (CITY_CODE_MAP[lower]) return lower;
  if (CITY_NAME_TO_CODE[str]) return CITY_NAME_TO_CODE[str];
  return '';
}

function resolveCityName(code, fallbackName = '') {
  return CITY_CODE_MAP[code] || fallbackName || CITY_CODE_MAP[DEFAULT_CITY_CODE];
}

Page({
  data: {
    percent: 0,
    rented: 0,
    total: 0,
    city: CITY_CODE_MAP[DEFAULT_CITY_CODE],
    cityCode: DEFAULT_CITY_CODE
  },

  onLoad(options = {}) {
    const { cityCode, city } = options;
    const decodedCode = decodeURIComponent(cityCode || '');
    const decodedCity = decodeURIComponent(city || '');
    const normalizedCode = normalizeCityCode(decodedCode || decodedCity) || DEFAULT_CITY_CODE;
    const name = decodedCity || resolveCityName(normalizedCode, decodedCity);
    this.setData({ cityCode: normalizedCode, city: name });
    wx.setNavigationBarTitle({ title: `${name} · 车辆管理` });
  },

  onShow() {
    if (!ensureAdmin()) return;
    this.refresh();
  },

  async refresh() {
    await this.loadStats();
  },

  async loadStats() {
    const cityCode = this.data.cityCode || DEFAULT_CITY_CODE;
    wx.showNavigationBarLoading();
    try {
      const { result } = await wx.cloud.callFunction({ name: 'vehicles', data: { action: 'getStats', cityCode } });
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

