// 直传到 ECS：请先把 ECS 域名加入“小程序管理后台 -> 开发设置 -> uploadFile 合法域名”
const ECS_UPLOAD_URL = 'https://tusifu.cn/api/esign/uploadFile';
const INTERNAL_TOKEN = 'qwertyuiopoiuytrewqwerty';

Page({
    data: {
      token: '',
      fileUrl: '',
      fddFileUrl: '',
      directFddFileUrl: '',
      lastResponse: '',
      lastPdfUrl: '',
      clientCorpId: ''
    },

    onInputClientCorpId(e){ this.setData({ clientCorpId: e.detail.value }); },
  
    // 小工具
    appendLog(obj) {
        const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
        this.setData({ log: `${this.data.log}\n${s}`.trim(), lastResponse: s });
    },
  
    copyLastUrl() {
        if (!this.data.lastPdfUrl) {
            wx.showToast({ title: '暂无URL', icon: 'none' });
            return;
          }
          wx.setClipboardData({
            data: this.data.lastPdfUrl,
            success: () => wx.showToast({ title: '已复制', icon: 'success' })
          });
    },

    onCopyLast() {
        const s = this.data.lastResponse || '';
        if (!s) {
          wx.showToast({ title: '暂无可复制内容', icon: 'none' });
          return;
        }
        wx.setClipboardData({ data: s });
    },

    onInputClientUserId(e) { this.setData({ clientUserId: e.detail.value }); },
    onInputRedirectUrl(e) { this.setData({ redirectUrl: e.detail.value }); },
    onInputSubject(e) { this.setData({ subject: e.detail.value }); },
    onInputFileId(e) { this.setData({ fileId: e.detail.value }); },
    onInputSignTaskId(e) { this.setData({ signTaskId: e.detail.value }); },
    onInputUrl(e) {
        this.setData({ fileUrl: e.detail.value })
      },
  
    call(action, payload) {
      return wx.cloud.callFunction({
        name: 'api-fadada',
        data: { action, payload }
      });
    },
  
    async onPing() {
      try {
        const { result } = await this.call('ping');
        this.appendLog(result);
      } catch (e) {
        this.appendLog(`Ping Error: ${e.message || e}`);
      }
    },
  
    async onGetToken() {
        try {
          const { result } = await this.call('getToken');
          this.appendLog(result);
          const ok = result?.success && result?.data?.accessToken;
          if (ok) {
            wx.showToast({ title: 'Token OK', icon: 'success' });
          } else {
            wx.showToast({ title: 'Token 获取失败', icon: 'none' });
          }
        } catch (e) {
          this.appendLog(`Token Error: ${e.message || e}`);
          wx.showToast({ title: 'Token 异常', icon: 'none' });
        }
    },
  
    async onGetCorpAuthUrl() {
        try {
          const { clientCorpId } = this.data;
          if (!clientCorpId) return wx.showToast({ title: '请填 clientCorpId', icon: 'none' });
      
          const cf = await wx.cloud.callFunction({
            name: 'api-fadada',
            data: { action: 'getCorpAuthUrl', payload: { clientCorpId } }
          });
      
          // 把完整返回打印到界面日志，便于核对结构
          this.appendLog(cf);
      
          // 稳妥取值（逐层兜底）
          const url =
            cf?.result?.data?.authUrl ||
            cf?.result?.data?.raw?.authUrl ||
            cf?.result?.data?.data?.authUrl ||
            cf?.result?.authUrl ||
            cf?.result?.data?.url ||
            cf?.result?.data?.raw?.url;
      
          if (!url) {
            const code = cf?.result?.data?.raw?.code || cf?.result?.data?.code;
            const msg  = cf?.result?.data?.raw?.msg  || cf?.result?.data?.msg;
            wx.showModal({
              title: '没拿到授权URL',
              content: code || msg ? `code=${code||''}; msg=${msg||''}` : '请看日志面板的完整返回',
              showCancel: false
            });
            return;
          }
      
          // 测试期：复制到剪贴板给法人打开（最省事）
          wx.setClipboardData({ data: url });
          wx.showModal({
            title: '企业授权URL已复制',
            content: '请在浏览器打开进行企业认证与授权（7天有效）',
            showCancel: false
          });
      
          // 若要内嵌：请把  *.uat-e.fadada.com  对应具体域名（如 80003764.uat-e.fadada.com）
          // 加入【业务域名】，然后用 <web-view src="{{authUrl}}"> 打开
        } catch (e) {
          this.appendLog(e);
          wx.showToast({ title: '获取失败', icon: 'none' });
        }
    },

    async onCheckCorpAuthStatus() {
        try {
          const { clientCorpId } = this.data;
          const { result } = await wx.cloud.callFunction({
            name: 'api-fadada',
            data: { action: 'getCorpAuthStatus', payload: { clientCorpId } }
          });
          this.appendLog(result);
          if (result?.data?.found) {
            wx.showToast({ title: '已记录回调', icon: 'success' });
          } else {
            wx.showToast({ title: '未找到回调记录', icon: 'none' });
          }
        } catch (e) {
          this.appendLog(e);
          wx.showToast({ title: '查询异常', icon: 'none' });
        }
    },

    async onGetAuthUrl() {
      try {
        const { clientUserId, redirectUrl } = this.data;
        const { result } = await this.call('getAuthUrl', { clientUserId, redirectUrl });
        this.appendLog(result);
        const url = result?.url || result?.data?.url;
        if (url) {
          wx.setClipboardData({ data: url });
          wx.showModal({
            title: '授权URL已复制',
            content: '已复制到剪贴板。测试环境验证码：111111（建议先用外部浏览器打开完成授权）',
            showCancel: false
          });
        }
      } catch (e) {
        this.appendLog(`GetAuthUrl Error: ${e.message || e}`);
      }
    },
  
    async onUploadPdf() {
        try {
          const choose = await wx.chooseMessageFile({ count: 1, type: 'file', extension: ['pdf'] });
          const file = choose?.tempFiles?.[0];
          if (!file) return;
      
          wx.showLoading({ title: '上传中...' });
      
          // 1) 先上传到云存储
          const cloudPath = `fdd/${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
          const up = await wx.cloud.uploadFile({ cloudPath, filePath: file.path });
      
          // 2) 取临时 URL
          const temp = await wx.cloud.getTempFileURL({ fileList: [up.fileID] });
          const fileObj = temp?.fileList?.[0] || {};
          const url = fileObj.tempFileURL;
          console.log('[TempFileURL object]', fileObj);
          console.log('[PDF direct URL]', url);
          // this.appendLog({ tempFileURL: url, meta: fileObj });
          // this.setData({ lastPdfUrl: url }); 

          if (!url) throw new Error('getTempFileURL 失败');
          // （可选）顺手复制到剪贴板
          if (url) {
            wx.setClipboardData({ data: url });
            wx.showToast({ title: 'URL已复制', icon: 'success' });
          }

          // 3) 调云函数，让云函数转发到 ECS 的 /uploadFileByUrl
          const { result } = await wx.cloud.callFunction({
            name: 'api-fadada',
            data: { action: 'uploadFileByUrl', 
                payload: { 
                    url, 
                    fileName: 'upload.pdf',
                    fileType: 'doc',
                 } 
            }
          });
      
          wx.hideLoading();
          this.appendLog(result);
          
          // 1) 先从返回里拿 fddFileUrl
          const body = result;
          const fddFileUrl = 
            body?.data?.result?.data?.fddFileUrl ||
            body?.data?.data?.fddFileUrl ||
            body?.result?.data?.fddFileUrl ||
            body?.result?.fddFileUrl;

          if (!fddFileUrl) {
            wx.showToast({ title: '未拿到 fddFileUrl', icon: 'none' });
            return;
          }

          // 给后端极短准备时间，允许法大大完成落盘，避免立刻请求拿不到 fileId
          await new Promise(r => setTimeout(r, 500));

          // 2) 立刻调用“文件处理”把 fddFileUrl 换成 fileId
          const r2 = await wx.cloud.callFunction({
            name: 'api-fadada',
            data: {
                action: 'convertFddUrlToFileId',
                payload: {
                    fddFileUrl,
                    fileType: 'doc',
                    fileName: '网约车租赁合同.pdf'
                }
            }
          });
          this.appendLog(r2);

          const body2 = r2.result;
          const fileId = 
            body2?.data?.result?.data?.fieldList?.fileId ||
            body2?.data?.result?.data?.fileIdList?.[0]?.fileId ||
            body2?.data?.data?.fileIdList?.[0]?.fileId ||
            body2?.result?.data?.fileIdList?.[0]?.fileId ||
            body2?.result?.fileIdList?.[0]?.fileId ||
            body2?.fileId;

          if (fileId) {
            this.setData({ fileId });
            wx.showToast({ title: '已拿到fileId', icon: 'success' });
          } else {
            wx.showToast({ title: '上传返回未包含 fileId', icon: 'none' });
          }
        } catch (e) {
          wx.hideLoading();
          this.appendLog(`Upload Error: ${e.message || e}`);
          wx.showToast({ title: '上传异常', icon: 'none' });
        }
    },

    async onGetUploadUrl() {
        try {
          // 1) 先向平台申请直传 URL（fileType 必填）
          const { result: r1 } = await wx.cloud.callFunction({
            name: 'api-fadada',
            data: { action: 'getUploadUrl', payload: { fileType: 'pdf' } }
          });
          this.appendLog(r1);
          const uploadUrl =
            r1?.data?.result?.data?.uploadUrl ||
            r1?.data?.uploadUrl ||
            r1?.result?.uploadUrl ||
            r1?.result?.data?.uploadUrl;
          const fileId =
            r1?.data?.result?.data?.fileId ||
            r1?.data?.fileId ||
            r1?.result?.fileId ||
            r1?.result?.data?.fileId;
      
          if (!uploadUrl || !fileId) {
            wx.showToast({ title: '未拿到 uploadUrl/fileId', icon: 'none' });
            return;
          }
      
          // 2) 选择本地 PDF
          const choose = await wx.chooseMessageFile({ count: 1, type: 'file', extension: ['pdf'] });
          const file = choose?.tempFiles?.[0];
          if (!file) return;
      
          // 3) 读取为 ArrayBuffer
          const fs = wx.getFileSystemManager();
          const arrayBuffer = fs.readFileSync(file.path);
      
          wx.showLoading({ title: '直传中...' });
      
          // 4) 直传：多数平台的直传URL要求 PUT 原始字节（非 multipart）
          const putRes = await new Promise((resolve, reject) => {
            wx.request({
              url: uploadUrl,
              method: 'PUT',
              header: { 'Content-Type': 'application/pdf' },
              data: arrayBuffer,
              responseType: 'text',
              success: resolve,
              fail: reject
            });
          });
      
          wx.hideLoading();
          this.appendLog(putRes);
      
          // 5) 直传成功后，一般不返回 JSON；以“拿到的 fileId”作为后续创建签署任务的文件ID
          this.setData({ fileId });
          wx.showToast({ title: '直传完成，已拿到fileId', icon: 'success' });
        } catch (e) {
          wx.hideLoading();
          this.appendLog(`GetUploadUrl Error: ${e.message || e}`);
          wx.showToast({ title: '直传异常', icon: 'none' });
        }
    },      

    async onCreateSignTask() {
      try {
        const { subject, fileId, clientUserId } = this.data;
        if (!fileId) {
          wx.showToast({ title: '请先填 fileId', icon: 'none' });
          return;
        }
        const { result } = await wx.cloud.callFunction({
            name: 'api-fadada',
            data: { action: 'createSignTask', payload: { subject, fileId, signerClientUserId: clientUserId } }
        });
        this.appendLog(result);

        const taskId = 
            result?.signTaskId || 
            result?.data?.signTaskId || 
            result?.data?.data?.signTaskId;

        if (taskId) {
          this.setData({ signTaskId: taskId });
          wx.showToast({ title: '任务已创建', icon: 'success' });
          return;
        }

        // 平台业务错误（400 时）
        const errCode = result?.data?.code || result?.code;
        const errMsg  = result?.data?.msg  || result?.msg || '创建失败';
        wx.showModal({ title: `创建失败 ${errCode||''}`, content: errMsg, showCancel: false });
      } catch (e) {
        this.appendLog(`CreateSignTask Error: ${e.message || e}`);
        wx.showToast({ title: '签署任务异常', icon: 'none' });
      }
    },
  
    async onCreateSignTaskV51() {
        try {
          const { subject, fileId } = this.data;
          if (!fileId) return wx.showToast({ title: '缺少 fileId', icon: 'none' });
      
          // signerName 可先用“张三”；如果你有 signerOpenId，也一起传
          const { result } = await wx.cloud.callFunction({
            name: 'api-fadada',
            data: {
              action: 'createSignTaskV51',
              payload: {
                subject: subject || '劳动合同签署',
                docFileId: fileId,
                signerName: '张三'
                // signerOpenId: '可选：用户openId'
              }
            }
          });
      
          this.appendLog(result);
      
          const signTaskId =
            result?.data?.signTaskId ||
            result?.signTaskId ||
            result?.data?.data?.signTaskId;
      
          if (signTaskId) {
            this.setData({ signTaskId });
            wx.showToast({ title: '任务已创建', icon: 'success' });
          } else {
            const errCode = result?.data?.code || result?.code || result?.data?.data?.code;
            const errMsg  = result?.data?.msg  || result?.msg  || result?.data?.data?.msg || '创建失败';
            wx.showModal({ title: `创建失败 ${errCode||''}`, content: errMsg, showCancel: false });
          }
        } catch (e) {
          this.appendLog(`CreateSignTaskV51 Error: ${e.message || e}`);
          wx.showToast({ title: '异常', icon: 'none' });
        }
    },

    async onGetSignUrl() {
      try {
        const { signTaskId } = this.data;
        if (!signTaskId) {
          wx.showToast({ title: '请先填 signTaskId', icon: 'none' });
          return;
        }
        const { result } = await this.call('getSignUrl', { signTaskId });
        this.appendLog(result);
        const url = result?.url || result?.data?.url;
        if (url) {
          wx.setClipboardData({ data: url });
          wx.showModal({
            title: '签署URL已复制',
            content: '已复制到剪贴板。可以在外部浏览器打开签署（测试验证码：111111）',
            showCancel: false
          });
        }
      } catch (e) {
        this.appendLog(`GetSignUrl Error: ${e.message || e}`);
      }
    }
  });
  