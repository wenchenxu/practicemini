const db = wx.cloud.database();
const COL = db.collection('contracts');
import { BRANCH_OPTIONS_BY_CITY, TYPE_OPTIONS_BY_CITY } from '../../utils/config';
const { ensureAccess } = require('../../utils/guard');
const app = getApp();
const IS_PROD = app.globalData.isProd;   // 拿到环境开关

const BASE_FIELDS = [
  // ---- Branch ----
  { name:'branchName', label:'门店名称', type:'string', requiredWhen:'never',  maxLength:50, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true},
  { name:'branchAddress', label:'门店地址', type:'string', requiredWhen:'never', maxLength:200, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'branchManagerName', label:'门店负责人姓名', type:'string', requiredWhen:'never', maxLength:50, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'branchLicense', label:'门店营业执照号', type:'string', requiredWhen:'never', maxLength:100, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'branchPhone', label:'门店电话', type:'string', requiredWhen:'never', minLength: 11, maxLength:11, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'branchBankAccount', label:'门店银行账号', type:'number', requiredWhen:'never', disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true},
  { name:'branchBankName', label:'开户行名称', type:'string', requiredWhen:'never', maxLength:100, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'branchCityCode', label:'城市编码', type:'string', requiredWhen:'never', maxLength:10, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },

  // ---- Client ----
  { name:'clientName', label:'乙方客户姓名', type:'string', requiredWhen:'always', maxLength:12 },
  { name:'clientId', label:'身份证号码', type:'string', requiredWhen:'always', minLength: 18, maxLength:18},
  { name:'clientPhone', label:'电话', type:'string', requiredWhen:'always', min:0, minLength: 11, maxLength:11},
  { name:'clientAddress', label:'身份证地址', type:'string', requiredWhen:'prod', maxLength:60 },
  { name:'clientAddressCurrent', label:'现居住地址', type:'string', requiredWhen:'never', maxLength:60 },
  { name:'clientEmergencyContact', label:'紧急联系人姓名', type:'string', requiredWhen:'prod', maxLength:12 },
  { name:'clientEmergencyPhone', label:'紧急联系人电话', type:'string', requiredWhen:'prod', min:0, minLength: 11, maxLength: 11},

  // ---- Car ----
  { name:'carModel', label:'车型', type:'string', requiredWhen:'prod', maxLength:50 },
  { name:'carColor', label:'车身颜色', type:'string', requiredWhen:'prod', maxLength:20 },
  { name:'carPlate', label:'车牌号', type:'string', requiredWhen:'prod', minLength: 8, maxLength:8 },
  { name:'carVin', label:'车架号', type:'string', requiredWhen:'always', minLength:14, maxLength:14, help:'必须14位' },
  { name:'carRentalCity', label:'租赁城市', type:'string', requiredWhen:'never', maxLength:20 },

  // ---- Contract / Rent ----
  { name:'rentDurationMonth', label:'租期（月）', type:'number', requiredWhen:'always', min:1, max:60 },
  { name:'contractValidPeriodStart', label:'合同生效日期', type:'date', requiredWhen:'prod' },
  { name:'contractValidPeriodEnd', label:'合同结束日期', type:'date', requiredWhen:'prod' },
  { name:'rentMonthly', label:'月租金', type:'number', requiredWhen:'always', min:0 },
  { name:'rentMonthlyFormal', label:'月租（大写）', type:'string', requiredWhen:'never', disabled:true},
  { name:'rentToday', label:'首日支付金', type:'number', requiredWhen:'prod', min:0 },
  { name:'rentTodayFormal', label:'首日支付（大写）', type:'string', requiredWhen:'never', disabled:true },
  { name:'rentPaybyDayInMonth', label:'每月支付日', type:'number', requiredWhen:'always', help: '1-31号', min:1, max:31 },
  { name:'rentCustomized', label:'自定义租金周期和金额', type:'string', requiredWhen: 'never'},

  // ---- Deposit ----
  { name:'deposit', label:'押金总额', type:'number', requiredWhen:'prod', min:0 },
  { name:'depositToday', label:'押金首付', type:'number', requiredWhen:'prod', min:0 },
  { name:'depositFormal', label:'押金总额（大写）', type:'string', requiredWhen:'never', disabled:true },
  { name:'depositTodayFormal', label:'押金首付（大写）', type:'string', requiredWhen:'never', disabled:true },
  { name:'depositUnpaidMonthly', label:'剩余押金月付金额', type:'number', requiredWhen:'prod', min:0 },
  { name:'depositServiceFee', label:'服务费 (默认为0）', type:'number', requiredWhen:'never', min:0, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'depositServiceFeeFormal', label:'服务费（大写）', type:'string', requiredWhen:'never', disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },

  // ---- Dates / Serial ----
  { name:'contractDate', label:'签约日期', type:'date', requiredWhen:'always' },
  { name:'contractSerialNumber', label:'合同流水号', type:'number', requiredWhen:'never', disabled:true, hideOnCreate: true },
];

// 将数字自动换成中文大写
function numberToCN(n) {
    if (n === null || n === undefined || n === '') return '';
    const units = '仟佰拾亿仟佰拾万仟佰拾元角分';
    const chars = '零壹贰叁肆伍陆柒捌玖';
    let s = (Math.round(Number(n) * 100)).toString(); // 分为单位
    if (!/^\d+$/.test(s)) return '';
    if (s === '0') return '零元整';
    units.slice(-s.length); // 只是为了 linter
    let u = units.slice(units.length - s.length);
    let str = '';
    for (let i = 0; i < s.length; i++) {
      const num = Number(s[i]);
      str += chars[num] + u[i];
    }
    // 处理零与单位
    str = str
      .replace(/零角零分$/, '整')
      .replace(/零分$/, '整')
      .replace(/零角/g, '零')
      .replace(/零仟|零佰|零拾/g, '零')
      .replace(/零{2,}/g, '零')
      .replace(/零亿/g, '亿')
      .replace(/零万/g, '万')
      .replace(/零元/g, '元')
      .replace(/亿万/g, '亿')
      .replace(/零整$/, '整');
    return str;
  };

async function openDocByFileID(fileID) {
    const dres = await wx.cloud.downloadFile({ fileID });
    await wx.openDocument({ filePath: dres.tempFilePath, fileType: 'pdf' });
}

function resolveRequired(field, isProd) {
    switch (field.requiredWhen) {
      case 'always': return true;
      case 'never': return false;
      case 'prod':
      default: return !!isProd;
    }
}
  
const FIELDS = BASE_FIELDS.map(f => ({
    ...f,
    required: resolveRequired(f, IS_PROD)
  }));

Page({
  data: {
    cityCode: '',
    city: '',
    mode: 'create', // create | view | edit
    id: '',
    // 用于“重新生成合同”按钮的 loading
    regenLoading: false,

    // 新增：分公司/类型选择状态
    showBranchPicker: false,
    branchOptions: [],
    branchIndex: -1,          // 选中下标
    selectedBranchCode: '',   // 选中的 code

    selectedBranchName: '',

    showTypePicker: false,
    typeOptions: [],
    typeIndex: -1,
    selectedTypeCode: '',
    selectedTypeName: '',
    
    fields: FIELDS,
    form: {},
    visibleFields: [],
    saving: false,
  },

  onLoad(options) {
    const run = () => {
        if (!ensureAccess()) return;
        // console.log('[contract-new onLoad] options=', options);

      // 1) 解析参数
      const id = options.id || '';
      const mode = options.mode || 'create'; // create | edit | view
      const cityCode = decodeURIComponent(options.cityCode || '');
      const city = decodeURIComponent(options.city || '');

      // 2) 基础状态
      this.setData({ id, mode, cityCode, city, visibleFields: this.data.visibleFields || [] });

      // 3) 顶部标题
      wx.setNavigationBarTitle({
        title: `${city} - ${mode === 'create' ? '新增' : (mode === 'view' ? '查看' : '编辑')}`
      });

      // 4) 计算可见字段（先按当前 mode 初始化一遍）
      this.initVisibleFields(mode);

      // 5) 分公司与合同类型选项（来源保持你现有常量）
      const branchOptions = BRANCH_OPTIONS_BY_CITY[cityCode] || [];
      const showBranchPicker = branchOptions.length > 0;

      const typeOptions = TYPE_OPTIONS_BY_CITY[cityCode] || TYPE_OPTIONS_BY_CITY.default;
      const showTypePicker = typeOptions.length > 1;

      // 若只有一个类型/分公司，默认选中它
      const typeIndex = typeOptions.length === 1 ? 0 : -1;
      const selectedTypeCode = typeIndex >= 0 ? typeOptions[typeIndex].code : '';
      const selectedTypeName = typeIndex >= 0 ? typeOptions[typeIndex].name : '';

      const branchIndex = branchOptions.length === 1 ? 0 : -1;
      const selectedBranchCode = branchIndex >= 0 ? branchOptions[branchIndex].code : '';
      const selectedBranchName = branchIndex >= 0 ? branchOptions[branchIndex].name : '';

      this.setData({
        branchOptions, showBranchPicker, branchIndex, selectedBranchCode, selectedBranchName,
        typeOptions, showTypePicker, typeIndex, selectedTypeCode, selectedTypeName,
      });

      // 6) 根据模式处理
      if ((mode === 'edit' || mode === 'view') && id) {
        // 统一使用 loadDoc(id) 回填（如果你有 fetchDetail 且它做了更多事，也可以继续用它——二选一别都用）
        this.loadDoc(id).then(() => {
        // 回填后再算一次可见字段（有些显隐依赖分公司/类型）
        this.initVisibleFields(this.data.mode);
        });
      } else if (mode === 'create') {
        // 需要的话，做自动门店数据回填
        // this.autofillBranch && this.autofillBranch();
      }
    };

    if (app.globalData.initialized) run();
    else app.$whenReady(run);
  },

  onShow() {
    const check = () => { ensureAccess(); };
    if (app.globalData.initialized) check();
    else app.$whenReady(check);

  },

  // might be obsolete
  async fetchDetail(id) {
    try {
      const { data } = await COL.doc(id).get();
      // 兼容老数据结构
      const form = data.fields || {};
      this.setData({ form });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none', duration: 5000 });
    }
  },

  async loadDoc(id) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('contracts').doc(id).get();
      const doc = res.data;
      // console.log('[loadDoc]', doc);

      // 回填到表单
      this.setData({
        form: doc.fields || {},
        // 若你把这几个存在了顶层，顺便回填，供编辑时传回
        selectedBranchCode: doc.branchCode || '',
        selectedBranchName: doc.branchName || '',
        selectedTypeCode: doc.contractType || '',
        selectedTypeName: doc.contractTypeName || ''
      });
    } catch (e) {
      console.error('[loadDoc error]', e);
      wx.showToast({ title: '加载合同失败', icon: 'none' });
    }
  },

  async onSaveAndRender() {
    const { id, mode } = this.data;
    if (mode !== 'edit' || !id) {
      wx.showToast({ title: '仅编辑状态可用', icon: 'none' });
      return;
    }

    const err = this.validate && this.validate();
    if (err) { wx.showToast({ title: err, icon: 'none' }); return; }

    const payload = this.toPersistObject();

    if (this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中…', mask: true });

    try {
      // 1) 保存更新
      const upRes = await wx.cloud.callFunction({
        name: 'contractOps',
        data: { action: 'update', id, fields: payload }
      });
      const upOk = upRes?.result?.ok && upRes.result.updated === 1;
      if (!upOk) {
        wx.showToast({ title: upRes?.result?.error || '保存失败', icon: 'none' });
        return;
      }

      // 2) 渲染并覆盖
      wx.showLoading({ title: '生成文档…', mask: true });
      const rnRes = await wx.cloud.callFunction({
        name: 'contractOps',
        data: { action: 'render', id }
      });
      const rnOk = rnRes?.result?.ok;
      const fileID = rnRes?.result?.fileID || '';

      wx.hideLoading();
      if (rnOk) {
        wx.showToast({ title: '已生成', icon: 'success' });

        try {
            if (fileID) {
              const dres = await wx.cloud.downloadFile({ fileID });
              await wx.openDocument({ filePath: dres.tempFilePath, fileType: 'pdf' });
            }
          } catch (e) {
            // 打不开也不影响返回
            console.warn('openDocument failed', e);
          }
        
        setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
      } else {
            wx.showToast({ title: rnRes?.result?.error || '已保存，但文档未生成', icon: 'none' });
            return;
      }
    } catch (e) {
      console.error(e);
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  initVisibleFields(mode) {
    const all = this.data.fields || [];
    const visible = all.filter(f => {
      if (mode === 'create') return !f.hideOnCreate;
      if (mode === 'edit')   return !f.hideOnEdit;
      if (mode === 'view')   return !f.hideOnView;
      return true;
    });
    this.setData({ visibleFields: visible });
    // console.log('[initVisibleFields]', this.data.mode, 'count=', visible.length);
  },

  // 分公司选择
  onPickBranch(e) {
    if (this.data.mode !== 'create') return;
    const idx = Number(e.detail.value);
    const opt = this.data.branchOptions[idx];
    this.setData({
        branchIndex: idx,
        selectedBranchCode: opt.code,
        selectedBranchName: opt.name,
    });
  },
    
  // 合同类型选择
  onPickType(e) {
    if (this.data.mode !== 'create') return; // 编辑/查看时禁选
    const idx = Number(e.detail.value);
    const opt = this.data.typeOptions[idx];
    this.setData({
        typeIndex: idx,
        selectedTypeCode: opt.code,
        selectedTypeName: opt.name,
    });
  },

  // 文本输入
  onInput(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value;
    this.setData({ [`form.${name}`]: value });
  },

  // 数字输入（保留字符串以便长度校验，再在保存时转为 Number）
  onInputNumber(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value; // 先保留字符串
    const patch = { [`form.${name}`]: value };

    const map = {
        rentMonthly: 'rentMonthlyFormal',
        rentToday: 'rentTodayFormal',
        deposit: 'depositFormal',
        depositToday: 'depositToday',
        depositServiceFee: 'depositServiceFeeFormal'
    };
    if (map[name]) {
        patch[`form.${map[name]}`] = numberToCN(value);
    }
    this.setData(patch);
  },

  // 日期
  onDateChange(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value; // yyyy-mm-dd
    this.setData({ [`form.${name}`]: value });
  },

  // 校验函数
  validate() {
    const { form } = this.data;
    for (const f of FIELDS) {
      const v = form[f.name];

      // 必填
      if (f.required) {
        if (f.type === 'string' && (!v || !String(v).trim())) {
          return `${f.label}为必填`;
        }
        if ((f.type === 'number' || f.type === 'date') && (v === undefined || v === null || v === '')) {
          return `${f.label}为必填`;
        }
      }

      // 类型与长度/范围
      if (f.type === 'string' && v) {
        const len = String(v).length;
        if (f.minLength && len < f.minLength) return `${f.label}长度需≥${f.minLength}`;
        if (f.maxLength && len > f.maxLength) return `${f.label}长度需≤${f.maxLength}`;
      }

      if (f.type === 'number' && (v !== '' && v !== undefined)) {
        const str = String(v);
        // 数字的“长度”要求（如账号/电话），先以字符串长度校验
        if (f.strLenMin && str.length < f.strLenMin) return `${f.label}长度需≥${f.strLenMin}`;
        if (f.strLenMax && str.length > f.strLenMax) return `${f.label}长度需≤${f.strLenMax}`;
        // 再转为数值检查范围
        const num = Number(v);
        if (!isFinite(num)) return `${f.label}必须为数字`;
        if (f.min !== undefined && num < f.min) return `${f.label}需≥${f.min}`;
        if (f.max !== undefined && num > f.max) return `${f.label}需≤${f.max}`;
      }

      if (f.type === 'date' && v) {
        // 简单校验格式 yyyy-mm-dd
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${f.label}格式不正确`;
      }
    }
    // 额外强约束：VIN 14位
    if ((form.carVin || '').length !== 14) return '车架号必须为 14 位';
    // 每月支付日 1-31（上面已校验 min/max，这里冗余保护）
    const payDay = Number(form.rentPaybyDayInMonth);
    if (!(payDay >= 1 && payDay <= 31)) return '每月支付日需在 1 到 31 之间';

    if (this.data.showBranchPicker && !this.data.selectedBranchCode) {
        return '请选择分公司';
    }
    if (!this.data.selectedTypeCode) {
        return '请选择合同类型';
    }
    return ''; // 通过
  },

  // 保存前转换数字
  toPersistObject() {
    const obj = {};
    for (const f of FIELDS) {
      const v = this.data.form[f.name];
      if (f.type === 'number') {
        obj[f.name] = (v === '' || v === undefined || v === null) ? null : Number(v);
      } else {
        obj[f.name] = v !== undefined ? v : null;
      }
    }
    return obj;
  },

  async onSubmit() {
    const {
      cityCode, city, mode, id,
      selectedBranchCode, selectedBranchName,
      selectedTypeCode, selectedTypeName
    } = this.data;
  
    const err = this.validate && this.validate();
    if (err) { wx.showToast({ title: err, icon: 'none', duration: 3000 }); return; }
  
    const payload = this.toPersistObject();
    if (this.submitting) return;
    this.submitting = true;
  
    try {
      if (mode === 'edit' && id) {
        // —— 合并流程：更新 → 渲染 → 打开 —— //
        await this.onSaveAndRender();
        return; // ← 记得 return，避免落到后面的 navigateBack
      }
  
      // —— 新建：沿用你原有流程 —— //
      if (mode === 'create') {
        const res = await wx.cloud.callFunction({
          name: 'createContract',
          data: {
            cityCode,
            cityName: city,
            branchCode: selectedBranchCode || null,
            branchName: selectedBranchName || null,
            contractType: selectedTypeCode,
            contractTypeName: selectedTypeName,
            payload
          }
        });
  
        const result = res?.result || {};
        const fileID = result.fileID || '';
  
        wx.showToast({ title: '合同已生成', icon: 'success', duration: 2000 });
  
        if (fileID) {
          const dres = await wx.cloud.downloadFile({ fileID });
          await wx.openDocument({ filePath: dres.tempFilePath, fileType: 'pdf' });
        } else {
          // 这里用 showModal，而不是 showToast 的 content/confirmText
          wx.showModal({
            title: '提示',
            content: '合同已保存，但文档未生成，可稍后重试',
            showCancel: false,
            confirmText: '知道了'
          });
        }
  
        // 修改合同后返回上一页
        setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
      }
  
    } catch (e) {
      console.error(e);
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none', duration: 3000 });
    } finally {
      this.submitting = false;
    }
  },

  async autofillBranch(){
    const db = wx.cloud.database();
    const res = await db.collection('branches').where({ city: this.data.city }).limit(1).get();
    if (res.data.length) {
      const b = res.data[0];
      this.setData({
        form: {
          ...this.data.form,
          branchName: b.branchName,
          branchAddress: b.branchAddress,
          branchManagerName: b.branchManagerName,
          branchPhone: String(b.branchPhone || ''),
          branchBankAccount: String(b.branchBankAccount || ''),
          branchBankName: b.branchBankName,
          branchCityCode: b.branchCityCode
        }
      });
    } else {
      wx.showToast({ title: '未找到门店资料', icon: 'none', duration: 5000 });
    }
  },

  toEdit() {
    const { city, id } = this.data;
    wx.navigateTo({
      url: `/pages/contract-new/index?city=${encodeURIComponent(city)}&mode=edit&id=${id}`
    });
  },

  async onRegenDoc() {
    const id = this.data.id;
    // console.log('[onRegenDoc] id=', id);
    if (!id) { wx.showToast({ title:'缺少合同ID', icon:'none' }); return; }

    try {
      this.setData({ regenLoading: true });
      const res = await wx.cloud.callFunction({
        name: 'contractOps',
        data: { action: 'render', id }
      });
      // console.log('[render result]', res);
      const rr = res && res.result ? res.result : {};
      if (rr.ok) {
        wx.showToast({ title: '已重新生成', icon:'success' });
        // 可选：立即预览
        if (rr.fileID) await openDocByFileID(rr.fileID);
      } else {
        wx.showToast({ title: rr.error || '生成失败', icon:'none' });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title:'生成失败', icon:'none' });
    } finally {
      this.setData({ regenLoading: false });
    }
  },
});
