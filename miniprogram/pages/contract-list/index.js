const db = wx.cloud.database();
const _ = db.command;
const COL = db.collection('contracts');
const PAGE_SIZE = 20;
const { ensureAccess } = require('../../utils/guard');

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
    filter: 'all',
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
      this.setData({ cityCode, city });
      wx.setNavigationBarTitle({ title: `${city} - 合同历史` });
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
      const { cityCode, searchKeyword, selectedMonth, lastCreatedAt, lastId } = this.data;

      // 1. 基础条件：城市 + 未删除
      let whereBase = { cityCode: cityCode, deleted: _.neq(true) };
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

      // 你可以传 customName（自定义下载文件名，不含扩展名时平台会按规则补）
      const { result } = await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'getOwnerDownloadUrl',
          payload: {
            signTaskId,
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
      return wx.showToast({ title: '未找到合同', icon: 'none' });
    }

    if (!signTaskId) {
      return wx.showToast({ title: '暂无签署任务。请发起签署', icon: 'none' });
    }

    if (this.isSignTaskFinished(item?.esign?.signTaskStatus)) {
      return wx.showToast({ title: '该合同已完成签署', icon: 'none' });
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
      wx.showToast({ title: `状态：${this.mapSignTaskStatus(signTaskStatus)}`, icon: 'none' });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: err.message || '刷新失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ refreshingId: '' });
    }
  },

  // 旧版本。发起签署：一口气做完  upload -> process -> create task -> actor url -> 复制
  async onSignFromRow(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find(x => x._id === id);
    if (!item) return wx.showToast({ title: '未找到合同', icon: 'none' });

    if (this.isSignTaskFinished(item?.esign?.signTaskStatus)) {
      return wx.showToast({ title: '该合同签署已完成', icon: 'none' });
    }

    // 1) 拿到小程序存储的 PDF fileID
    const fileID = item?.file?.pdfFileID || item?.file?.docxFileID;
    if (!fileID) return wx.showToast({ title: '此合同暂无文件', icon: 'none' });

    // 2) 组几个签署要用的字段
    const rawName = item.fields?.clientName || '';
    const rawPhone = item.fields?.clientPhone || '';
    // 强力净化：去掉所有 回车(\r)、换行(\n) 和 首尾空格
    const signerName = rawName.replace(/[\r\n]/g, '').trim();
    const signerPhone = rawPhone.replace(/[\r\n]/g, '').trim();
    // 兜底保护：如果名字被洗空了，给个默认值防止文件名为空
    const safeFileName = signerName ? `${signerName}.pdf` : `contract_${id.slice(-4)}.pdf`;

    // 这个是你 ECS /sign-task/create 里要的 actorId，可以用手机号
    const actorId = signerPhone;
    // 这个是你刚才特别强调“不要为空”的 clientUserId
    const clientUserId = signerPhone
      ? `driver:${signerPhone}`
      : `contract:${item._id}`;
    // 合同标题，用你原来那一套
    const subject =
      item.fields?.contractSerialNumberFormatted ||
      `${this.data.city || ''}-${signerName}合同`;

    try {
      this.setData({ runningId: id });
      wx.showLoading({ title: '签署生成中...', mask: true });

      // A. 取临时URL
      const tmp = await wx.cloud.getTempFileURL({ fileList: [fileID] });
      const tempUrl = tmp?.fileList?.[0]?.tempFileURL;
      if (!tempUrl) throw new Error('getTempFileURL 失败');

      // B. 上传到法大大（URL方式）
      const up = await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'uploadFileByUrl',
          payload: {
            url: tempUrl,
            fileName: safeFileName,
            fileType: 'doc' //这是正确的 fileType
          }
        }
      });

      console.log('[Debug] uploadFileByUrl raw result:', up); // 加上这行日志方便调试

      const rawData = up?.result?.data || {}; // 取出云函数返回的 data 部分

      const fddFileUrl =
        rawData?.fddFileUrl ||                        // 结构1: 直接在 data 里
        rawData?.data?.fddFileUrl ||                  // 结构2: data.data.fddFileUrl (常见)
        rawData?.result?.data?.fddFileUrl ||          // 结构3: data.result.data.fddFileUrl
        rawData?.result?.fddFileUrl ||                // 结构4: data.result.fddFileUrl
        up?.result?.data?.data?.fddFileUrl;           // 兜底: 旧写法

      if (!fddFileUrl) {
        // 如果还是拿不到，打印出完整结构以便排查
        console.error('[Fatal] fddFileUrl 解析失败。完整返回:', JSON.stringify(up));
        throw new Error('未拿到 fddFileUrl');
      }

      console.log('=== 准备调用 convertFddUrlToFileId ===');
      console.log('fddFileUrl:', fddFileUrl);
      console.log('fileName:', `${signerName}.pdf`);
      console.log('fileType:', 'doc');
      if (!fddFileUrl) throw new Error('未拿到 fddFileUrl');
      await new Promise(r => setTimeout(r, 1000));

      // C. 文件处理 → 拿到 fileId
      const conv = await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'convertFddUrlToFileId',
          payload: {
            // 这里 ECS 那条路由是按官方写的 fileType=doc 来处理的
            fddFileUrl,
            fileType: 'doc',
            fileName: safeFileName
          }
        }
      });

      const fileId =
        conv?.result?.data?.data?.fileIdList?.[0]?.fileId ||
        conv?.result?.data?.result?.data?.fileIdList?.[0]?.fileId;
      if (!fileId) throw new Error('文件处理未返回 fileId');

      await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'saveContractEsign',
          payload: {
            contractId: item._id,
            fileId
          }
        }
      });

      // D. 创建签署任务（这里名字和字段都要对上 ECS）
      const { cityCode, city } = this.data;

      const create = await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'createSignTaskV51',     // 名字对上云函数
          payload: {
            subject,
            docFileId: fileId,             // 名字对上 ECS
            signerName,                    // ECS 要的
            signerId: actorId,
            signerPhone,
            cityCode,
            cityName: city,
            businessId: this.data.selectedBusinessId
          }
        }
      });
      // 前端直接看到报错
      // console.log('createSignTaskV51 result =', create);

      const signTaskId =
        create?.result?.data?.signTaskId ||
        create?.result?.signTaskId ||
        create?.result?.data?.data?.signTaskId;
      if (!signTaskId) {
        const msg =
          create?.result?.data?.msg ||
          create?.result?.msg ||
          '创建签署任务失败';
        throw new Error(msg);
      }

      // E. 获取参与方签署链接（名字也要对上）
      const actor = await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'getActorUrl',
          payload: {
            signTaskId,
            actorId,
            clientUserId,
            // clientPhone: signerPhone,
            redirectMiniAppUrl: '/pages/contract-list/index'
          }
        }
      });

      const embedUrl =
        actor?.result?.data?.actorSignTaskEmbedUrl ||
        actor?.result?.data?.data?.actorSignTaskEmbedUrl ||
        actor?.result?.actorSignTaskEmbedUrl;

      if (!embedUrl) {
        throw new Error('未拿到签署URL');
      }

      await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'saveContractEsign',
          payload: {
            contractId: item._id,
            signTaskId,
            actorUrl: embedUrl
          }
        }
      });

      // F. 复制
      wx.setClipboardData({
        data: embedUrl,
        success: () => {
          this.setData({ lastEsignUrl: embedUrl });
          wx.showToast({ title: '签署链接已复制', icon: 'success' });
        }
      });

    } catch (err) {
      console.error(err);
      wx.showToast({ title: err.message || '签署失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ runningId: '' });
    }
  },

  // 增加附件，单线程稳定版：上传附件 -> 上传主合同 -> 创建任务 -> 获取链接 -> 复制
  async onSignFromRowV1(e) {
    console.log('按钮被点击了，dataset:', e.currentTarget.dataset);
    // 1. 获取并校验 item
    const { item } = e.currentTarget.dataset;
    if (!item) {
      console.error('错误：没有拿到 item 数据');
      return;
    }

    // 2. 准备关键变量 (从旧版逻辑移植回来)
    // -----------------------------------------------------
    const rawName = item.fields?.clientName || '';
    const rawPhone = item.fields?.clientPhone || '';

    // 强力清洗：去掉回车、换行、首尾空格
    const signerName = rawName.replace(/[\r\n]/g, '').trim();
    const signerPhone = rawPhone.replace(/[\r\n]/g, '').trim();

    // 校验必要信息
    if (!signerPhone) return wx.showToast({ title: '缺少客户手机号', icon: 'none' });
    if (!signerName) return wx.showToast({ title: '缺少客户姓名', icon: 'none' });

    // 构造 ID
    const actorId = signerPhone;
    const clientUserId = `driver:${signerPhone}`;
    // -----------------------------------------------------

    wx.showLoading({ title: '准备附件...', mask: true });
    console.log('[Sign] Start processing:', item.contractSerialNumberFormatted);

    try {
      const contractId = item._id;
      const fileData = item.file || {};
      const esignData = item.esign || {};

      // 3. 识别有哪些附件需要处理
      const attachKeys = Object.keys(fileData).filter(k => k.startsWith('attach') && k.endsWith('FileId'));
      console.log('[Sign] Found attachments in DB:', attachKeys);

      const fddAttachs = [];
      const updatesToDb = {};

      // 4. 循环处理每个附件 (单线程串行)
      for (const key of attachKeys) {
        const match = key.match(/attach(\d+)FileId/);
        const indexStr = match ? match[1] : '0';

        const wxFileId = fileData[key]; // 例如 cloud://.../TSFZX-GZ-001-责任书.docx

        // 使用正则提取最后一个斜杠后的内容
        let realFileName = `attach${indexStr}.docx`; // 兜底默认值
        if (wxFileId && typeof wxFileId === 'string') {
          const parts = wxFileId.split('/');
          if (parts.length > 0) {
            realFileName = parts[parts.length - 1]; // 拿到 "TSFZX-GZ-001-责任书.docx"
          }
        }

        // 你的附件 ID (attachId) 依然可以用 attach1, attach2 这种简单的内部代号
        // 但展示给用户的名字 (attachName) 用真实文件名
        const currentAttachId = `attach${indexStr}`;
        const currentAttachName = realFileName;

        // const attachName = `attach${indexStr}.docx`; 

        let fddFileId = esignData[key];

        if (fddFileId) {
          console.log(`[Sign] ${attachName} already uploaded:`, fddFileId);
        } else {
          const wxFileId = fileData[key];
          console.log(`[Sign] Uploading ${attachName}...`);

          // A. 获取临时链接
          const tempRes = await wx.cloud.getTempFileURL({ fileList: [wxFileId] });
          const tempUrl = tempRes.fileList[0].tempFileURL;

          // B. 上传到法大大
          const upRes = await wx.cloud.callFunction({
            name: 'api-fadada',
            data: {
              action: 'uploadFileByUrl',
              payload: {
                url: tempUrl,
                fileName: currentAttachName,
                fileType: 'attach'
              }
            }
          });

          const remoteData = upRes.result;
          const fddFileUrl = remoteData?.data?.result?.data?.fddFileUrl || remoteData?.data?.result?.fddFileUrl;

          if (!fddFileUrl) {
            throw new Error(`上传附件 ${currentAttachName} 失败`);
          }

          // C. 转换 ID
          const cvRes = await wx.cloud.callFunction({
            name: 'api-fadada',
            data: {
              action: 'convertFddUrlToFileId',
              payload: {
                fddFileUrl,
                fileType: 'doc',
                fileName: currentAttachName
              }
            }
          });

          const cvRemoteResult = cvRes.result;
          fddFileId = cvRemoteResult?.data?.result?.data?.fileIdList?.[0]?.fileId ||
            cvRemoteResult?.data?.fileIdList?.[0]?.fileId;

          if (!fddFileId) {
            console.error(`[Fatal] ${currentAttachName} ID转换失败返回:`, cvRemoteResult);
            throw new Error(`附件 ${currentAttachName} ID转换失败`);
          }

          updatesToDb[`esign.${key}`] = fddFileId;
        }

        fddAttachs.push({
          attachId: currentAttachId, // 内部ID: attach1
          attachName: currentAttachName, // 显示名: TSFZX-...-责任书.docx
          attachFileId: fddFileId
        });
      }

      // 5. 中途存档
      if (Object.keys(updatesToDb).length > 0) {
        console.log('[Sign] Checkpoint: Saving attachments to DB...');
        await wx.cloud.callFunction({
          name: 'api-fadada',
          data: {
            action: 'saveContractEsign',
            payload: { contractId, ...updatesToDb }
          }
        });
      }

      // 6. 处理主合同
      let docFileId = esignData.docFileId || esignData.fileId;

      if (!docFileId) {
        console.log('[Sign] 主合同未上传，开始补传...');
        const mainWxFileId = fileData.pdfFileID || fileData.docxFileID || item.fileID;
        if (!mainWxFileId) throw new Error('未找到主合同文件');

        const tempRes = await wx.cloud.getTempFileURL({ fileList: [mainWxFileId] });
        const tempUrl = tempRes.fileList[0].tempFileURL;

        // 这里使用了刚才提取并清洗过的 signerName
        const safeName = signerName || `contract_${item._id.slice(-4)}`;
        const fileName = `${safeName}.pdf`;

        const upRes = await wx.cloud.callFunction({
          name: 'api-fadada',
          data: {
            action: 'uploadFileByUrl',
            payload: { url: tempUrl, fileName, fileType: 'doc' }
          }
        });

        const remoteData = upRes.result;
        const fddFileUrl = remoteData?.data?.result?.data?.fddFileUrl || remoteData?.data?.result?.fddFileUrl;
        if (!fddFileUrl) throw new Error('主合同上传失败');

        const cvRes = await wx.cloud.callFunction({
          name: 'api-fadada',
          data: {
            action: 'convertFddUrlToFileId',
            payload: { fddFileUrl, fileType: 'doc', fileName }
          }
        });
        const cvRemote = cvRes.result;
        docFileId = cvRemote?.data?.result?.data?.fileIdList?.[0]?.fileId || cvRemote?.data?.fileIdList?.[0]?.fileId;

        if (!docFileId) throw new Error('主合同ID转换失败');

        console.log(`[Sign] 主合同补传成功 -> ${docFileId}`);
        updatesToDb['esign.docFileId'] = docFileId;
      }

      // 7. 发起签署
      wx.showLoading({ title: '创建签署任务...', mask: true });

      const taskPayload = {
        docFileId: docFileId,
        subject: `${signerName}-租车合同`, // 清洗过的变量
        signerName: signerName,
        signerId: actorId,
        signerPhone: signerPhone,
        cityCode: item.cityCode,
        attachs: fddAttachs // 这里面现在包含了真实的文件名
      };

      console.log('[Sign] Calling createSignTaskV51 with:', taskPayload);
      const taskRes = await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'createSignTaskV51',
          payload: taskPayload
        }
      });

      const taskData = taskRes.result;
      if (!taskData?.success && !taskData?.ok) {
        throw new Error(taskData?.msg || '创建任务失败');
      }

      const signTaskId = taskData.data?.signTaskId || taskData.signTaskId || taskData.data?.data?.signTaskId;
      if (!signTaskId) throw new Error('未返回 signTaskId');

      updatesToDb['esign.signTaskId'] = signTaskId;
      updatesToDb['esign.signTaskStatus'] = 'sent';

      // 8. 获取签署链接
      wx.showLoading({ title: '获取签署链接...', mask: true });

      const actorRes = await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'getActorUrl',
          payload: {
            signTaskId,
            actorId: actorId,
            clientUserId: clientUserId,
          }
        }
      });

      const actorData = actorRes.result;
      const actorUrl = actorData?.data?.actorSignTaskEmbedUrl ||
        actorData?.actorSignTaskEmbedUrl ||
        actorData?.data?.data?.actorSignTaskEmbedUrl;

      if (!actorUrl) throw new Error('未返回签署链接');

      updatesToDb['esign.lastActorUrl'] = actorUrl;

      // 9. 最终保存
      console.log('[Sign] Saving final updates to DB:', updatesToDb);
      await wx.cloud.callFunction({
        name: 'api-fadada',
        data: {
          action: 'saveContractEsign',
          payload: {
            contractId,
            ...updatesToDb
          }
        }
      });

      // 10. 成功与复制
      wx.hideLoading();
      wx.setClipboardData({
        data: actorUrl,
        success: () => {
          wx.showModal({
            title: '发起成功',
            content: '签署链接已复制。',
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

  mapSignTaskStatus(status) {
    if (!status) return '未发起签署';
    return SIGN_TASK_STATUS_TEXT[status] || status;
  },

  isSignTaskFinished(status) {
    return status === 'task_finished';
  },

  decorateContractItem(item) {
    const signTaskStatus = item?.esign?.signTaskStatus;
    return {
      ...item,
      _signStatusText: this.mapSignTaskStatus(signTaskStatus),
      _signFinished: this.isSignTaskFinished(signTaskStatus)
    };
  },

  applyFilter(list, filter = this.data.filter) {
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

  onDriverDetail(e) {
    const clientId = e.currentTarget.dataset.clientId;
    const name = e.currentTarget.dataset.name || '';

    if (!clientId) {
      return wx.showToast({ title: '缺少身份证号', icon: 'none' });
    }

    wx.navigateTo({
      url: `/pages/driver-detail/index?clientId=${encodeURIComponent(clientId)}&name=${encodeURIComponent(name)}`
    });
  },

  onOpenDriverCenter(e) {
    const idCard = e.currentTarget.dataset.clientId;
    if (!idCard) {
      wx.showToast({ title: '缺少司机身份证', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/driver-center/index?identNo=${encodeURIComponent(idCard)}`
    });
  }
});
