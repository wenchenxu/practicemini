const db = wx.cloud.database();
const _ = db.command;
const COL = db.collection('contracts');
const PAGE_SIZE = 20;

Page({
    data: { 
      city: '', 
      list: [], 
      loading: false, 
      hasMore: true, 
      lastCreatedAt: null, //上一页最后一条的创建时间
      lastId: '',          //同时带上 _id 作为并列条件的次级游标
      filter: 'all',   // all | waiting | signed | void | history
    },

  onLoad(query) {
    const cityCode = decodeURIComponent(query.cityCode || '');
    const city = decodeURIComponent(query.city || '');
    this.setData({ cityCode, city });
    wx.setNavigationBarTitle({ title: `${city} - 合同历史` });
    this.refresh();
  },

  async refresh() {
    this.setData({ list: [], hasMore: true, lastId: '', lastCreatedAt: null });
    await this.fetch();
  },

  async fetch() {
    if (!this.data.hasMore || this.data.loading) return;
    this.setData({ loading: true });
  
    try {
      const whereBase = { cityCode: this.data.cityCode, deleted: _.neq(true) };
  
      // 根据过滤增加条件
      // 后端存的字段，稍后把 status 字段名替成现在库里的
      const filter = this.data.filter;
      if (filter === 'waiting') {
        whereBase['fdd.status'] = 'waiting_sign';
      } else if (filter === 'signed') {
        whereBase['fdd.status'] = 'signed';
      } else if (filter === 'void') {
        whereBase['fdd.status'] = 'void';
      } else if (filter === 'history') {
        // 历史你原来就有的，可以是已签+已作废+已归档
        // 这里先写成 signed
        whereBase['fdd.status'] = _.in(['signed', 'void', 'archived']);
      }
      // all 就不加额外条件

      let condition = COL.where(whereBase);
  
      // 分页游标（createdAt < lastCreatedAt，或时间相同则 _id < lastId）
      if (this.data.lastCreatedAt) {
        condition = COL.where(
          _.and([
            whereBase,
            _.or([
              { createdAt: _.lt(this.data.lastCreatedAt) },
              _.and([
                { createdAt: this.data.lastCreatedAt },
                { _id: _.lt(this.data.lastId) }
              ])
            ])
          ])
        );
      }
  
      const res = await condition
        .orderBy('createdAt', 'desc')
        .orderBy('_id', 'desc')
        .limit(PAGE_SIZE)
        .get();
  
      const page = res.data.map(d => ({
        ...d,
        _createTime: this.formatTime(d.createdAt),
        _fddStatusText: this.mapFddStatus(d?.fdd?.status)
      }));
  
      const newList = this.data.list.concat(page);
  
      // 记录新的游标
      const tail = res.data[res.data.length - 1];
      this.setData({
        list: newList,
        hasMore: res.data.length === PAGE_SIZE,
        lastCreatedAt: tail ? tail.createdAt : this.data.lastCreatedAt,
        lastId: tail ? tail._id : this.data.lastId
      });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  mapFddStatus(s) {
    if (!s) return '未生成电子签';
    if (s === 'file_ready') return '文件已生成';
    if (s === 'waiting_sign') return '待签署';
    if (s === 'signed') return '已签';
    if (s === 'void') return '已作废';
    return s;
  },

  loadMore() { this.fetch(); },

  viewOne(e) {
    const id = e.currentTarget.dataset.id;
    const { city } = this.data;
    wx.navigateTo({ url: `/pages/contract-new/index?city=${encodeURIComponent(city)}&mode=view&id=${id}` });
  },

  editOne(e) {
    const id = e.currentTarget.dataset.id;
    const { cityCode, city } = this.data;
    wx.navigateTo({ 
        url: 
        `/pages/contract-new/index` +
        `?id=${id}` +
        `&mode=edit` +
        `&cityCode=${encodeURIComponent(cityCode)}` +
        `&city=${encodeURIComponent(city)}`
    });
  },

  async delOne(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return wx.showToast({ title: '缺少ID', icon: 'none' });
  
    const { confirm } = await wx.showModal({
      title: '删除确认',
      content: '确定删除该合同吗？',
      confirmText: '删除'
    });
    if (!confirm) return;
  
    try {
        wx.showLoading({ title: '删除中', mask: true });
        const res = await wx.cloud.callFunction({
          name: 'contractOps',
          data: { action: 'delete', id }   // ← 改成 delete
        });
        wx.hideLoading();
    
        const r = res?.result || {};
        if (r.ok && (r.deleted === 1 || r.updated === 1)) {
          wx.showToast({ title: '已删除' });
          await this.refresh(); // 或本地 splice
        } else {
          wx.showToast({ title: r.error || '删除失败', icon: 'none' });
        }
    } catch (err) {
        wx.hideLoading();
        console.error(err);
        wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },
  
  formatTime(serverDate) {
    if (!serverDate) return '';
    try {
      const ts = serverDate instanceof Date ? serverDate : new Date(serverDate);
      const pad = n => String(n).padStart(2, '0');
      return `${ts.getFullYear()}-${pad(ts.getMonth()+1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}`;
    } catch { return ''; }
  },

  // 点击文件名打开文件
  async openDocFromRow(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find(x => x._id === id);
    const fileID = item?.file?.pdfFileID || item?.file?.docxFileID;
  
    if (!fileID) {
      wx.showToast({ title: '暂无文档', icon: 'none' });
      return;
    }
  
    try {
      wx.showLoading({ title: '打开中', mask: true });
      const dres = await wx.cloud.downloadFile({ fileID });
      const isPdf = /\.pdf(\?|$)/i.test(fileID) || (item?.file?.pdfFileID === fileID);
      await wx.openDocument({ filePath: dres.tempFilePath, fileType: isPdf ? 'pdf' : 'docx'  });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '打开失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onShow() {
    // 从别的页（比如编辑/新建）返回时，强制刷新
    this.refresh();
  },

  //下拉刷新
  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  //触底加载
  onReachBottom() {
    this.loadMore();
  },

  // ✅ 新增：点击“空白区域/整行”进详情
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    const { city, cityCode } = this.data;
    wx.navigateTo({
      url:
        `/pages/contract-new/index` +
        `?id=${id}` +
        `&mode=view` +          // 你现在已有的查看模式
        `&cityCode=${encodeURIComponent(cityCode)}` +
        `&city=${encodeURIComponent(city)}`
    });
  },

  // ✅ 每个城市加一个“调试/开发”
  goDebug() {
    const { cityCode, city } = this.data;
    wx.navigateTo({
      url: `/pages/fadada-test/index?cityCode=${encodeURIComponent(cityCode)}&city=${encodeURIComponent(city)}`
    });
  }
});
