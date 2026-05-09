const db = wx.cloud.database();
const _ = db.command;
const COL = db.collection('contracts');
const PAGE_SIZE = 20;
const { ensureAccess } = require('../../../utils/guard');

const SIGN_TASK_STATUS_TEXT = {
  task_created: '任务创建中',
  finish_creation: '已创建',
  fill_progress: '填写进行中',
  fill_completed: '填写已完成',
  sign_progress: '签署进行中',
  sign_completed: '签署已完成',
  task_finished: '任务已结束',
  task_terminated: '任务异常停止',
  expired: '已逾期',
  abolishing: '作废中',
  revoked: '已作废'
};

Page({
  data: {
    city: '',
    list: [],
    rawList: [],
    loading: false,
    hasMore: true,
    lastCreatedAt: null, //上一页最后一条的创建时间
    lastId: '',          //同时带上 _id 作为并列条件的次级游标
    filter: 'active',
    runningId: '',
    refreshingId: '',
    searchKeyword: '',
    selectedMonth: '', // 格式 'YYYY-MM'
    // 为了调试
    lastEsignUrl: ''
  },

  _searchTimer: null, // 防抖定时器

  onLoad(query) {
    const app = getApp();
    const init = () => {
      if (!ensureAccess()) return;
      const cityCode = decodeURIComponent(query.cityCode || '');
      const city = decodeURIComponent(query.city || '');
      const branchCode = query.branchCode || '';
      const branchName = decodeURIComponent(query.branchName || '');
      this.setData({ cityCode, city, branchCode, branchName });
      const displayTitle = branchName ? branchName : city;
      wx.setNavigationBarTitle({ title: `${displayTitle} - 合同历史` });
      this.refresh();
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

  async refresh() {
    this.setData({ list: [], rawList: [], hasMore: true, lastId: '', lastCreatedAt: null });
    await this.fetch();
    // 如果逻辑在 JS 计算，判断签约状态
    /* 
    const data = await this.fetch();
    if (Array.isArray(data)) {
        const list = data.map(item => {
          const esign = item.esign || {};
          let statusText = '未生成电子签';
          if (esign.lastActorUrl) {
            statusText = '成功获取签约链接';
          } else if (esign.signTaskId) {
            statusText = '获取签约链接失败';
          }
          return { ...item, _fddStatusText: statusText };
        });
        this.setData({ list });
      } */
  },

  // 新增：搜索输入（防抖）
  onSearchInput(e) {
    const val = e.detail.value;
    this.setData({ searchKeyword: val });

    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.refresh();
    }, 500); // 500ms 防抖
  },

  onSearchClear() {
    this.setData({ searchKeyword: '' });
    this.refresh();
  },

  // 新增：日期选择
  onDateChange(e) {
    this.setData({ selectedMonth: e.detail.value }); // YYYY-MM
    this.refresh();
  },

  onClearDate() {
    this.setData({ selectedMonth: '' });
    this.refresh();
  },

  async fetch() {
    if (!this.data.hasMore || this.data.loading) return;
    this.setData({ loading: true });

    try {
      const { cityCode, branchCode, searchKeyword, selectedMonth, lastCreatedAt, lastId } = this.data;

      // 1. 基础条件：城市 + 未删除
      let whereBase = { cityCode: cityCode, deleted: _.neq(true) };
      if (branchCode) {
        whereBase.branchCode = branchCode;
      }
      // 2. 搜索条件 (模糊查询)
      if (searchKeyword && searchKeyword.trim()) {
        const key = searchKeyword.trim();
        const reg = db.RegExp({ regexp: key, options: 'i' });
        // 在基础条件上叠加 OR 查询
        whereBase = _.and([
          whereBase,
          _.or([
            { 'fields.clientName': reg },  // 搜姓名
            { 'fields.carPlate': reg },    // 搜车牌
            { 'fields.clientPhone': reg }, // 搜电话
            { 'fields.contractSerialNumberFormatted': reg } // 搜合同号
          ])
        ]);
      }

      // 3. 日期筛选条件 (按月)
      if (selectedMonth) {
        // selectedMonth 格式 "2025-10"
        // iOS 不支持 "2025-10-01 00:00:00"，需转换为 "2025/10/01 00:00:00"
        const startStr = `${selectedMonth}-01 00:00:00`.replace(/-/g, '/');
        const start = new Date(startStr);

        const y = start.getFullYear();
        const m = start.getMonth() + 1; // 0-11 -> 1-12

        // 下个月 1号
        const nextMonth = m === 12 ? 1 : m + 1;
        const nextYear = m === 12 ? y + 1 : y;

        // 结束时间同理，用斜杠拼接
        const endStr = `${nextYear}/${String(nextMonth).padStart(2, '0')}/01 00:00:00`;
        const end = new Date(endStr);

        whereBase = _.and([
          whereBase,
          {
            createdAt: _.gte(start).and(_.lt(end))
          }
        ]);
      }

      // 4. 构建带分页的查询
      let condition = COL.where(whereBase);

      // 分页游标（createdAt < lastCreatedAt，或时间相同则 _id < lastId）
      if (lastCreatedAt) {
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

      const page = res.data.map(d =>
        this.decorateContractItem({
          ...d,
          _createTime: this.formatTime(d.createdAt)
        })
      );

      const rawList = this.data.rawList.concat(page);
      const newList = this.applyFilter(rawList); // 应用客户端的状态Tab过滤

      // 记录新的游标
      const tail = res.data[res.data.length - 1];
      this.setData({
        list: newList,
        rawList,
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

  loadMore() { this.fetch(); },

  // 顶部筛选（现在先做前端过滤，真正的筛选你以后可以做到数据库里）
  onFilterTap(e) {
    const filter = e.currentTarget.dataset.filter;
    const rawList = this.data.rawList || [];
    this.setData({
      filter,
      list: this.applyFilter(rawList, filter)
    });
    // 如果当前列表为空且还有更多，尝试自动加载下一页
    if (this.data.list.length === 0 && this.data.hasMore) {
      this.loadMore();
    }
  },

  async onGetDownloadUrlFromRow(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find(x => x._id === id);
    if (!item) return wx.showToast({ title: '未找到合同', icon: 'none' });

    const signTaskId = item?.esign?.signTaskId;
    if (!signTaskId) {
      return wx.showToast({ title: '请先发起并创建签署任务', icon: 'none' });
    }

    try {
      wx.showLoading({ title: '获取下载链接...', mask: true });

      const docFileId = item?.esign?.docFileId || item?.esign?.fileId;
      const downloadItems = docFileId ? [{ docId: docFileId }] : undefined;

      // 你可以传 customName（自定义下载文件名，不含扩展名时平台会按规则补）
      const { result } = await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'getOwnerDownloadUrl',
          payload: {
            signTaskId,
            downloadItems,
            // 可选：如果要强制指定别的主体，就传对象
            // ownerId: { idType: 'corp', openId: 'xxxxxx' },
            customName: `${item.fields?.clientName || '合同'}-${Date.now()}`,
          }
        }
      });

      const url =
        result?.data?.downloadUrl ||
        result?.data?.data?.downloadUrl ||
        result?.data?.ownerDownloadUrl;

      if (!url) {
        return wx.showModal({
          title: '获取失败',
          content: JSON.stringify(result),
          showCancel: false
        });
      }

      await wx.setClipboardData({ data: url });
      wx.hideLoading();
      // 弹窗提示，不带取消
      wx.showModal({
        title: '签署完毕！',
        content: '合同下载链接已复制。有效期 1 小时，请尽快下载保存。',
        confirmText: '知道了',
        showCancel: false
      });
      // 复制到剪贴板（旧可用方法）
      /*
      wx.setClipboardData({
        data: url,
        success() {
          wx.showToast({ title: '下载链接已复制', icon: 'success' });
        }
      });
      */
    } catch (err) {
      console.error(err);
      wx.showToast({ title: err.message || '异常', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onRefreshSignTaskStatus(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find(x => x._id === id);
    const signTaskId = e.currentTarget.dataset.signTaskId || item?.esign?.signTaskId;

    if (!item) {
      return wx.showModal({ title: '提示', content: '未找到合同', showCancel: false });
    }

    if (!signTaskId) {
      return wx.showModal({ title: '提示', content: '暂无签署任务。请发起签署', showCancel: false });
    }

    if (this.isSignTaskFinished(item?.esign?.signTaskStatus)) {
      return wx.showModal({ title: '提示', content: '该合同已完成签署', showCancel: false });
    }

    try {
      this.setData({ refreshingId: id });
      wx.showLoading({ title: '刷新中...', mask: true });

      const { result } = await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'getSignTaskDetail',
          payload: { signTaskId }
        }
      });

      const signTaskDetail = result?.data || result || {};
      const signTaskStatus =
        signTaskDetail?.raw?.data?.signTaskStatus;

      if (!signTaskStatus) {
        console.warn('[getSignTaskDetail] unexpected response', signTaskDetail);
        throw new Error('未返回签署状态');
      }

      await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'saveContractEsign',
          payload: { contractId: id, signTaskStatus }
        }
      });

      const mappedRawList = this.data.rawList.map(it =>
        it._id === id
          ? this.decorateContractItem({
            ...it,
            esign: { ...(it.esign || {}), signTaskStatus }
          })
          : it
      );

      this.setData({
        rawList: mappedRawList,
        list: this.applyFilter(mappedRawList)
      });
      // 成功弹窗
      wx.showModal({
        title: '状态已刷新',
        content: `当前状态：${this.mapSignTaskStatus(signTaskStatus)}`,
        showCancel: false
      });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: err.message || '刷新失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ refreshingId: '' });
    }
  },

  // prod 单线程稳定版：智能复用 signTaskId (无调试日志)
  async onSignFromRowV1(e) {
    const { item } = e.currentTarget.dataset;
    if (!item) return;

    // 0. 如果已经签署完成，直接拦截
    const esignData = item.esign || {};
    if (this.isSignTaskFinished && this.isSignTaskFinished(esignData.signTaskStatus)) {
      return wx.showToast({ title: '该合同签署已完成', icon: 'none' });
    }

    // 1. 准备变量
    const rawName = item.fields?.clientName || '';
    const rawPhone = item.fields?.clientPhone || '';
    const signerName = rawName.replace(/[\r\n]/g, '').trim();
    const signerPhone = rawPhone.replace(/[\r\n]/g, '').trim();

    if (!signerPhone) return wx.showToast({ title: '缺少客户手机号', icon: 'none' });
    if (!signerName) return wx.showToast({ title: '缺少客户姓名', icon: 'none' });

    const actorId = signerPhone;
    const clientUserId = `driver:${signerPhone}`;
    const updatesToDb = {};
    const contractId = item._id;

    wx.showLoading({ title: '处理中...', mask: true });

    try {
      const fileData = item.file || {};

      // ▼▼▼▼▼ 核心逻辑：复用 signTaskId ▼▼▼▼▼
      let signTaskId = esignData.signTaskId;

      if (signTaskId) {
        // 【情况 A】已有任务：直接跳过创建，复用 ID
        console.log('复用已有签署任务:', signTaskId);
      } else {
        // 【情况 B】新任务：上传附件 -> 上传合同 -> 创建任务
        wx.showLoading({ title: '准备文件...', mask: true });

        // --- B1. 处理附件 ---
        const attachKeys = Object.keys(fileData).filter(k => k.startsWith('attach') && k.endsWith('FileId'));
        const fddAttachs = [];

        for (const key of attachKeys) {
          const match = key.match(/attach(\d+)FileId/);
          const indexStr = match ? match[1] : '0';

          const wxFileId = fileData[key];
          // 提取真实文件名
          let realFileName = `attach${indexStr}.docx`;
          if (wxFileId && typeof wxFileId === 'string') {
            const parts = wxFileId.split('/');
            if (parts.length > 0) realFileName = parts[parts.length - 1];
          }

          const currentAttachId = `attach${indexStr}`;
          const currentAttachName = realFileName;
          const attachName = currentAttachName; // 兼容旧变量名

          let fddFileId = esignData[key];

          if (!fddFileId) {
            const tempRes = await wx.cloud.getTempFileURL({ fileList: [wxFileId] });
            const tempUrl = tempRes.fileList[0].tempFileURL;

            // 上传
            const upRes = await wx.cloud.callFunction({
              name: 'api-fadada',
              data: {
                action: 'uploadFileByUrl',
                payload: { url: tempUrl, fileName: currentAttachName, fileType: 'attach' }
              }
            });
            const fddFileUrl = upRes.result?.data?.result?.data?.fddFileUrl || upRes.result?.data?.result?.fddFileUrl;
            if (!fddFileUrl) throw new Error(`附件 ${currentAttachName} 上传失败`);

            // 转换 ID
            const cvRes = await wx.cloud.callFunction({
              name: 'api-fadada',
              data: {
                action: 'convertFddUrlToFileId',
                payload: { fddFileUrl, fileType: 'doc', fileName: currentAttachName }
              }
            });
            fddFileId = cvRes.result?.data?.result?.data?.fileIdList?.[0]?.fileId || cvRes.result?.data?.fileIdList?.[0]?.fileId;
            if (!fddFileId) throw new Error(`附件 ${currentAttachName} ID转换失败`);

            updatesToDb[`esign.${key}`] = fddFileId;
          }

          fddAttachs.push({
            attachId: currentAttachId,
            attachName: currentAttachName,
            attachFileId: fddFileId
          });
        }

        // --- B2. 处理主合同 ---
        let docFileId = esignData.docFileId || esignData.fileId;
        if (!docFileId) {
          const mainWxFileId = fileData.pdfFileID || fileData.docxFileID || item.fileID;
          if (!mainWxFileId) throw new Error('未找到主合同文件');

          const tempRes = await wx.cloud.getTempFileURL({ fileList: [mainWxFileId] });
          const tempUrl = tempRes.fileList[0].tempFileURL;

          const safeName = signerName || `contract_${item._id.slice(-4)}`;
          const fileName = `${safeName}.pdf`;

          const upRes = await wx.cloud.callFunction({
            name: 'api-fadada',
            data: {
              action: 'uploadFileByUrl',
              payload: { url: tempUrl, fileName, fileType: 'doc' }
            }
          });
          const fddUrl = upRes.result?.data?.result?.data?.fddFileUrl || upRes.result?.data?.result?.fddFileUrl;

          const cvRes = await wx.cloud.callFunction({
            name: 'api-fadada',
            data: {
              action: 'convertFddUrlToFileId',
              payload: { fddFileUrl: fddUrl, fileType: 'doc', fileName }
            }
          });
          docFileId = cvRes.result?.data?.result?.data?.fileIdList?.[0]?.fileId || cvRes.result?.data?.fileIdList?.[0]?.fileId;

          updatesToDb['esign.docFileId'] = docFileId;
        }

        // --- B3. 创建任务 ---
        wx.showLoading({ title: '创建签署任务...', mask: true });

        const taskPayload = {
          docFileId: docFileId,
          subject: `${signerName}-租车合同`,
          signerName: signerName,
          signerId: actorId,
          signerPhone: signerPhone,
          cityCode: item.cityCode,
          branchCode: item.branchCode, // 苏州增加亿睿峰盖章
          attachs: fddAttachs
        };

        const taskRes = await wx.cloud.callFunction({
          name: 'api-fadada',
          data: { action: 'createSignTaskV51', payload: taskPayload }
        });

        const taskData = taskRes.result;
        if (!taskData?.success && !taskData?.ok) throw new Error(taskData?.msg || '创建任务失败');

        signTaskId = taskData.data?.signTaskId || taskData.signTaskId || taskData.data?.data?.signTaskId;
        if (!signTaskId) throw new Error('未返回 signTaskId');

        updatesToDb['esign.signTaskId'] = signTaskId;
        updatesToDb['esign.signTaskStatus'] = 'sent';
      }

      // -----------------------------------------------------------
      // 2. 获取签署链接 (公共步骤)
      // -----------------------------------------------------------
      wx.showLoading({ title: '获取链接...', mask: true });

      const actorRes = await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'getActorUrl',
          payload: { signTaskId, actorId, clientUserId }
        }
      });
      const actorData = actorRes.result;
      const actorUrl = actorData?.data?.actorSignTaskEmbedUrl || actorData?.actorSignTaskEmbedUrl || actorData?.data?.data?.actorSignTaskEmbedUrl;

      if (!actorUrl) throw new Error('未返回签署链接');

      updatesToDb['esign.lastActorUrl'] = actorUrl;

      // 3. 最终保存
      if (Object.keys(updatesToDb).length > 0) {
        await wx.cloud.callFunction({
          name: 'api-fadada',
          data: {
            action: 'saveContractEsign',
            payload: { contractId, ...updatesToDb }
          }
        });
      }

      wx.hideLoading();

      // 4. 复制链接
      wx.setClipboardData({
        data: actorUrl,
        success: () => {
          wx.showModal({
            title: '准备就绪',
            content: '签署链接已刷新并复制。请司机使用此链接签署。',
            showCancel: false,
            confirmText: '好的',
            success: () => this.onPullDownRefresh()
          });
        }
      });

    } catch (err) {
      console.error('[Sign Error]', err);
      wx.hideLoading();
      wx.showModal({ title: '操作失败', content: err.message, showCancel: false });
    }
  },

  async onSignFromRowUpdated(e) {
    const { item } = e.currentTarget.dataset;
    if (!item) return;

    // 0. 如果已经签署完成，直接拦截
    const esignData = item.esign || {};
    if (this.isSignTaskFinished && this.isSignTaskFinished(esignData.signTaskStatus)) {
      return wx.showToast({ title: '该合同签署已完成', icon: 'none' });
    }

    // 1. 准备变量
    const rawName = item.fields?.clientName || '';
    const rawPhone = item.fields?.clientPhone || '';
    const signerName = rawName.replace(/[\r\n]/g, '').trim();
    const signerPhone = rawPhone.replace(/[\r\n]/g, '').trim();

    if (!signerPhone) return wx.showToast({ title: '缺少客户手机号', icon: 'none' });
    if (!signerName) return wx.showToast({ title: '缺少客户姓名', icon: 'none' });

    wx.showLoading({ title: '发起签署中...', mask: true });

    try {
      const fileData = item.file || {};
      const mainWxFileId = fileData.pdfFileID || fileData.docxFileID || item.fileID;

      const { result } = await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'orchestrateSignTask',
          payload: {
            contractId: item._id,
            fileData,
            esignData,
            mainWxFileId,
            signerName,
            signerPhone,
            cityCode: item.cityCode,
            branchCode: item.branchCode
          }
        }
      });

      if (!result || !result.success) {
        throw new Error(result?.error || result?.msg || '签署接口返回异常');
      }

      const actorUrl = result.data?.actorUrl;
      if (!actorUrl) throw new Error('未返回签署链接');

      wx.hideLoading();

      // 4. 复制链接
      wx.setClipboardData({
        data: actorUrl,
        success: () => {
          wx.showModal({
            title: '准备就绪',
            content: '签署链接已刷新并复制。请司机使用此链接签署。',
            showCancel: false,
            confirmText: '好的',
            success: () => this.onPullDownRefresh()
          });
        }
      });

    } catch (err) {
      console.error('[Sign Error]', err);
      wx.hideLoading();
      wx.showModal({ title: '操作失败', content: err.message, showCancel: false });
    }
  },

  viewOne(e) {
    const id = e.currentTarget.dataset.id;
    const { city } = this.data;
    this._needsRefresh = true;
    wx.navigateTo({ url: `/pages/contract/contract-new/index?city=${encodeURIComponent(city)}&mode=view&id=${id}` });
  },

  editOne(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find(x => x._id === id);
    const { cityCode, city } = this.data;
    this._needsRefresh = true;
    if (item && item.isOffline) {
      wx.navigateTo({
        url:
          `/pages/contract/contract-new-offline/index` +
          `?id=${id}` +
          `&mode=edit` +
          `&cityCode=${encodeURIComponent(cityCode)}` +
          `&city=${encodeURIComponent(city)}`
      });
      return;
    }

    wx.navigateTo({
      url:
        `/pages/contract/contract-new/index` +
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

  mapSignTaskStatus(status) {
    if (!status) return '未发起签署';
    return SIGN_TASK_STATUS_TEXT[status] || status;
  },

  isSignTaskFinished(status) {
    return status === 'task_finished';
  },

  decorateContractItem(item) {
    const signTaskStatus = item?.esign?.signTaskStatus;

    // 计算时效期
    const start = item.fields?.contractValidPeriodStart || '未指定';
    const end = item.fields?.contractValidPeriodEnd || '未指定';
    const validityPeriod = `${start} 至 ${end}`;

    // 合同状态：优先使用持久化的 contractStatus，否则动态计算（兼容旧数据）
    let statusLabel = '生效中';
    let statusClass = 'active';

    const persisted = item.contractStatus;
    if (persisted === 'terminated') {
      statusLabel = '退租';
      statusClass = 'terminated';
    } else if (persisted === 'expired') {
      statusLabel = '已到期';
      statusClass = 'expired';
    } else if (!persisted || persisted === 'active') {
      // 无持久化状态或明确 active —— 用日期动态判断（兼容旧合同）
      if (end !== '未指定') {
        try {
          const expireTimeMs = new Date(`${end}T06:00:00+08:00`).getTime();
          if (Date.now() >= expireTimeMs) {
            statusLabel = '已到期';
            statusClass = 'expired';
          }
        } catch (e) { }
      }
    }

    return {
      ...item,
      _signStatusText: this.mapSignTaskStatus(signTaskStatus),
      _signFinished: this.isSignTaskFinished(signTaskStatus),
      _validityPeriod: validityPeriod,
      _statusLabel: statusLabel,
      _statusClass: statusClass
    };
  },

  applyFilter(list, filter = this.data.filter) {
    if (filter === 'active') {
      return list.filter(item => item._statusClass === 'active');
    }
    if (filter === 'expired') {
      return list.filter(item => item._statusClass === 'terminated' || item._statusClass === 'expired');
    }
    if (filter === 'waiting') {
      return list.filter(item => {
        const status = item?.esign?.signTaskStatus;
        return (
          !status ||
          ['fill_progress', 'fill_completed', 'sign_progress', 'sign_completed'].includes(status)
        );
      });
    }
    if (filter === 'signed') {
      return list.filter(item => this.isSignTaskFinished(item?.esign?.signTaskStatus));
    }
    return list;
  },

  formatTime(serverDate) {
    if (!serverDate) return '';
    try {
      const ts = serverDate instanceof Date ? serverDate : new Date(serverDate);
      const pad = n => String(n).padStart(2, '0');
      return `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}`;
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
      await wx.openDocument({ filePath: dres.tempFilePath, fileType: isPdf ? 'pdf' : 'docx' });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '打开失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onShow() {
    // 只有从别的页面返回时才刷新（保留搜索/筛选状态）
    if (this._needsRefresh) {
      this._needsRefresh = false;
      this.refresh();
    }
  },

  //下拉刷新
  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  //触底加载
  onReachBottom() {
    this.loadMore();
  },

  onDriverDetail(e) {
    const clientId = e.currentTarget.dataset.clientId;
    const name = e.currentTarget.dataset.name || '';

    if (!clientId) {
      return wx.showToast({ title: '缺少身份证号', icon: 'none' });
    }

    wx.navigateTo({
      url: `/pages/driver/driver-detail/index?clientId=${encodeURIComponent(clientId)}&name=${encodeURIComponent(name)}`
    });
  },

  onOpenDriverCenter(e) {
    const idCard = e.currentTarget.dataset.clientId;
    if (!idCard) {
      wx.showToast({ title: '缺少司机身份证', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/driver/driver-center/index?identNo=${encodeURIComponent(idCard)}`
    });
  },

  // 新增：跳转到详情页
  toDetail(e) {
    // console.log('点击详情，Event:', e);
    const id = e.currentTarget.dataset.id;
    if (!id) { return; }
    this._needsRefresh = true;
    wx.navigateTo({
      url: `/pages/contract/contract-detail/index?id=${id}`
    });
  }
});
