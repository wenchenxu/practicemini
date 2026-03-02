// pages/branch-select/index.js
import { BRANCH_OPTIONS_BY_CITY } from '../../utils/config';

Page({
  data: {
    cityCode: '',
    cityName: '',
    branches: []
  },

  onLoad(options) {
    const cityCode = options.cityCode || '';
    const cityName = decodeURIComponent(options.city || '');
    // 获取该城市对应的分公司列表
    const branches = BRANCH_OPTIONS_BY_CITY[cityCode] || [];

    this.setData({ cityCode, cityName, branches });
    // 设置页面顶部标题
    wx.setNavigationBarTitle({ title: `${cityName} - 选择分公司` });
  },

  // 点击分公司后，带着城市和分公司信息进入控制台(index)
  onSelectBranch(e) {
    const branchCode = e.currentTarget.dataset.code;
    const branchName = e.currentTarget.dataset.name;
    const { cityCode, cityName } = this.data;

    wx.navigateTo({
      url: `/pages/city/index?cityCode=${cityCode}&city=${encodeURIComponent(cityName)}&branchCode=${branchCode}&branchName=${encodeURIComponent(branchName)}`
    });
  }
});