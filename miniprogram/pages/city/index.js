// pages/city/index.js
const { ensureAccess } = require('../../utils/guard');
import { BRANCH_OPTIONS_BY_CITY } from '../../utils/config';

Page({
    onLoad(q) {
        const app = getApp();
        const init = () => {
          if (!ensureAccess()) return;
          const cityCode = decodeURIComponent(q.cityCode || '');
          const city = decodeURIComponent(q.city || '');
          
          // 新增：接收分公司参数
          const branchCode = q.branchCode || '';
          const branchName = decodeURIComponent(q.branchName || '');

          this.setData({ cityCode, city, branchCode, branchName });
          
          // 修改标题逻辑：如果有分公司，就显示分公司名；没有分公司，就显示城市名
          const displayTitle = branchName ? branchName : city;
          wx.setNavigationBarTitle({ title: `${displayTitle} - 门店` });
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
        const { cityCode, city, branchCode, branchName } = this.data;
        let url = `/pages/contract-new/index?cityCode=${encodeURIComponent(cityCode)}&city=${encodeURIComponent(city)}&mode=create`;
        if (branchCode) url += `&branchCode=${branchCode}&branchName=${encodeURIComponent(branchName)}`;
        
        wx.navigateTo({ url });
    },
    goList() {
        const { cityCode, city, branchCode, branchName } = this.data;
        let url = `/pages/contract-list/index?cityCode=${encodeURIComponent(cityCode)}&city=${encodeURIComponent(city)}`;
        if (branchCode) url += `&branchCode=${branchCode}&branchName=${encodeURIComponent(branchName)}`;
        
        wx.navigateTo({ url });
    },

    onGoDriverCenter() {
        const { cityCode, city, branchCode, branchName } = this.data;
        if (!cityCode) {
          return wx.showToast({ title: '缺少城市信息', icon: 'none' });
        }
        let url = `/pages/driver-center/index?cityCode=${encodeURIComponent(cityCode)}&cityName=${encodeURIComponent(city)}`;
        if (branchCode) url += `&branchCode=${branchCode}&branchName=${encodeURIComponent(branchName)}`;

        wx.navigateTo({ url });
    },

    toVehicleCenter() {
        const { cityCode, city, branchCode, branchName } = this.data;
        let url = `/pages/vehicle-center/index?cityCode=${cityCode}&city=${city}`;
        if (branchCode) url += `&branchCode=${branchCode}&branchName=${encodeURIComponent(branchName)}`;
        
        wx.navigateTo({ url });
    }
  });
  