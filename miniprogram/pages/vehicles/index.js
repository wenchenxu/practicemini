const { ensureAdmin } = require('../../utils/guard');
const app = getApp();
const db = wx.cloud.database();

Page({
  data: {
    // 筛选状态
    cityCode: 'guangzhou', // 默认城市，你可以改为从全局取
    cityOptions: [
      { text: '广州', value: 'guangzhou' },
      { text: '佛山', value: 'foshan' },
      { text: '惠州', value: 'huizhou' },
      { text: '嘉兴', value: 'jiaxing' },
      { text: '绍兴', value: 'shaoxing' },
      { text: '南通', value: 'nantong' },
      { text: '常州', value: 'changzhou' },
      { text: '苏州', value: 'suzhou' },
    ],
    timeRange: 'month',
    rangeOptions: [
      { text: '今日数据', value: 'today' },
      { text: '本周数据', value: 'week' },
      { text: '本月数据', value: 'month' },
    ],

    // 核心数据 (与云函数返回结构对应)
    stats: {
      total: 0,
      rented: 0,
      available: 0,
      maintenance: 0,
      utilization: 0, // 前端计算
      utilizationRate: 0 // 用于 circle 组件的 value (0-100)
    },

    // 流水数据
    flow: {
      rentOut: [],
      return: [],
      maintenanceIn: [],
      maintenanceOut: []
    },

    // 预警数据
    expiring: [],

    // 详情弹窗控制
    showDetail: false,
    detailTitle: '',
    detailList: [], // 当前弹窗要展示的列表

    loading: false
  },

  onLoad(options) {
    // 1. 设置默认城市 (如果有全局配置)
    const initCity = options.cityCode || 'guangzhou';
    this.setData({
      cityCode: initCity
    }, () => {
      // 2. 这里的顺序很重要：先 setData 城市，再获取数据和开启监听
      this.fetchData();
      this.setupWatcher();
    });
  },

  onUnload() {
    // 页面卸载时关闭监听，防止内存泄漏
    if (this.watcher) {
      this.watcher.close();
    }
  },

  onPullDownRefresh() {
    this.fetchData().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  // --- 核心：建立数据库监听 ---
  setupWatcher() {
    const that = this;
    // 监听 vehicles 集合，只要有任何增删改，就触发刷新
    this.watcher = db.collection('vehicles')
      .where({
        cityCode: this.data.cityCode // 只监听当前城市，节省资源
      })
      .watch({
        onChange: function (snapshot) {
          // 只有当不是第一次初始化时才刷新 (snapshot.type === 'init' 是第一次)
          // 但为了保险，我们可以直接无脑刷新，或者判断 snapshot.docChanges
          console.log('[Dashboard] 数据库变动，触发实时刷新...');
          that.fetchData();
        },
        onError: function (err) {
          console.error('监听失败', err);
        }
      });
  },

  // --- 获取聚合数据 ---
  async fetchData() {
    if (this.data.loading) return;
    this.setData({ loading: true });

    try {
      const { cityCode, timeRange } = this.data;

      const res = await wx.cloud.callFunction({
        name: 'vehicleOps',
        data: {
          action: 'getDashboardStats',
          payload: {
            cityCode,
            timeRange // 'today' | 'week' | 'month'
          }
        }
      });

      const result = res.result;
      if (!result.ok) throw new Error(result.error);

      const { snapshot, flow, expiring } = result;

      // 前端计算出租率
      let rate = 0;
      if (snapshot.total > 0) {
        rate = (snapshot.rented / snapshot.total) * 100;
      }

      this.setData({
        stats: {
          ...snapshot,
          utilization: rate.toFixed(1), // 显示文本 "85.5"
          utilizationRate: rate         // 进度条数值 85.5
        },
        flow: flow,
        expiring: expiring,
        loading: false
      });

    } catch (err) {
      console.error(err);
      wx.showToast({ title: '数据加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // --- 交互事件 ---

  onCityChange(e) {
    this.setData({ cityCode: e.detail }, () => {
      // 城市变了，需要重启监听器 (监听新城市)
      if (this.watcher) this.watcher.close();
      this.setupWatcher();
      this.fetchData();
    });
  },

  onRangeChange(e) {
    this.setData({ timeRange: e.detail }, () => {
      this.fetchData();
    });
  },

  // 点击查看流水详情
  onViewDetail(e) {
    const type = e.currentTarget.dataset.type;
    const titleMap = {
      'rentOut': '新租出车辆',
      'return': '退租入库车辆',
      'maintenanceIn': '新增维修车辆',
      'expiring': '即将到期预警'
    };

    let list = [];
    if (type === 'expiring') {
      list = this.data.expiring;
    } else {
      list = this.data.flow[type] || [];
    }

    if (list.length === 0) {
      wx.showToast({ title: '暂无记录', icon: 'none' });
      return;
    }

    this.setData({
      showDetail: true,
      detailTitle: titleMap[type] || '详情列表',
      detailList: list
    });
  },

  onCloseDetail() {
    this.setData({ showDetail: false });
  }
});

