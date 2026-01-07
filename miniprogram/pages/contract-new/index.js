import { BRANCH_OPTIONS_BY_CITY, TYPE_OPTIONS_BY_CITY } from '../../utils/config';
const { ensureAccess } = require('../../utils/guard');
const db = wx.cloud.database();
const COL = db.collection('contracts');
const app = getApp();
const IS_PROD = app.globalData.isProd;

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
  { name:'carModel', label:'车型', type:'string', disabled: true, requiredWhen:'never', maxLength:50, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'carColor', label:'车身颜色', type:'string', disabled: true, requiredWhen:'never', maxLength:20, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'carPlate', label:'车牌号', type:'string', disabled: true, requiredWhen:'never', minLength: 8, maxLength:8, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'carVin', label:'车架号', type:'string', disabled: true, requiredWhen:'never', hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'carRentalCity', label:'租赁城市', type:'string', disabled: true, requiredWhen:'never', maxLength:20, hideOnCreate: true, hideOnEdit:true, hideOnView:true },

  // ---- Contract / Rent ----
  { name:'rentDurationMonth', label:'租期（个月）', type:'number', requiredWhen:'always', min:1, max:60 },
  { name:'contractValidPeriodStart', label:'合同生效日期', type:'date', requiredWhen:'prod' },
  { name:'contractValidPeriodEnd', label:'合同结束日期', type:'date', requiredWhen:'prod' },
  
  // 修改：普通租金相关字段（注意：如果选了以租代购，这些可能不需要填，所以 requiredWhen 改为动态判断或者在 validate 里手动校验，这里暂时保持 always/prod，但在 validate 里做逻辑分支）
  { name:'rentMonthly', label:'月租金', type:'number', requiredWhen:'never', min:0 }, // 改为 never，手动校验
  { name:'rentMonthlyFormal', label:'月租（大写）', type:'string', requiredWhen:'never', disabled:true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'rentToday', label:'首日支付金', type:'number', requiredWhen:'never', min:0 }, // 改为 never，手动校验
  { name:'rentTodayFormal', label:'首日支付（大写）', type:'string', requiredWhen:'never', disabled:true, hideOnCreate: true, hideOnEdit:true, hideOnView:true  },
  { name:'rentPaybyDayInMonth', label:'每月支付日', type:'number', requiredWhen:'always', help: '1-31号', min:1, max:31 },
  { name:'rentCustomized', label:'自定义租金周期和金额', type:'string', requiredWhen: 'never',hideOnCreate: true, hideOnEdit: true, hideOnView: true},

  // 新增：以租代购 (RTO) 专属字段
  // 注意：hideOnCreate 设为 true 是为了不让通用循环渲染它们，我们要手动用 wx:if 渲染
  { name:'rentMonthlyFirstYear', label:'1—12期每期租金', type:'number', requiredWhen:'never', min:0, hideOnCreate: true },
  { name:'rentMonthlyFirstYearFormal', label:'1—12期每期租金（大写）', type:'string', requiredWhen:'never', disabled:true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'rentMonthlySecondYear', label:'13—24期每期租金', type:'number', requiredWhen:'never', min:0, hideOnCreate: true },
  { name:'rentMonthlySecondYearFormal', label:'13—24期每期租金（大写）', type:'string', requiredWhen:'never', disabled:true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'daysTillPayment', label:'自然日内支付首期（天）', type:'number', requiredWhen:'never', min:0, hideOnCreate: true },
  { name:'sellPrice', label:'合同完结后车辆购买售价', type:'number', requiredWhen:'never', min:0, hideOnCreate: true },

  // ---- Deposit ----
  { name:'deposit', label:'押金总额', type:'number', requiredWhen:'prod', min:0 },
  { name:'depositToday', label:'押金首付', type:'number', requiredWhen:'prod', min:0 },
  { name:'depositFormal', label:'押金总额（大写）', type:'string', requiredWhen:'never', disabled:true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'depositTodayFormal', label:'押金首付（大写）', type:'string', requiredWhen:'never', disabled:true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
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
    let s = (Math.round(Number(n) * 100)).toString(); 
    if (!/^\d+$/.test(s)) return '';
    if (s === '0') return '零元整';
    units.slice(-s.length);
    let u = units.slice(units.length - s.length);
    let str = '';
    for (let i = 0; i < s.length; i++) {
      const num = Number(s[i]);
      str += chars[num] + u[i];
    }
    str = str.replace(/零角零分$/, '整').replace(/零分$/, '整').replace(/零角/g, '零').replace(/零仟|零佰|零拾/g, '零').replace(/零{2,}/g, '零').replace(/零亿/g, '亿').replace(/零万/g, '万').replace(/零元/g, '元').replace(/亿万/g, '亿').replace(/零整$/, '整');
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
    mode: 'create', 
    id: '',
    // 用于“重新生成合同”按钮的 loading
    regenLoading: false,

    showBranchPicker: false,
    branchOptions: [],
    branchIndex: -1,         
    selectedBranchCode: '',   

    selectedBranchName: '',

    showTypePicker: false,
    typeOptions: [],
    typeIndex: -1,
    selectedTypeCode: '',
    selectedTypeName: '',
    
    vehicleOptions: [],       
    vehiclePickerRange: [],   
    vehiclePickerIndex: -1,   
    
    fields: FIELDS,
    form: {
      rentToday: 120,
      rentTodayFormal: numberToCN(120),
      daysTillPayment: 7,
    },
    visibleFields: [],
    saving: false,
  },

  onLoad(options) {
    const run = () => {
        if (!ensureAccess()) return;
      const id = options.id || '';
      const mode = options.mode || 'create'; 
      const cityCode = decodeURIComponent(options.cityCode || '');
      const city = decodeURIComponent(options.city || '');

      this.setData({ id, mode, cityCode, city, visibleFields: this.data.visibleFields || [] });
      this.loadAvailableVehicles(cityCode);
      wx.setNavigationBarTitle({
        title: `${city} - ${mode === 'create' ? '新增' : (mode === 'view' ? '查看' : '编辑')}`
      });
      this.initVisibleFields(mode);

      const branchOptions = BRANCH_OPTIONS_BY_CITY[cityCode] || [];
      const showBranchPicker = branchOptions.length > 0;
      const typeOptions = TYPE_OPTIONS_BY_CITY[cityCode] || TYPE_OPTIONS_BY_CITY.default;
      const showTypePicker = typeOptions.length > 1;

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
        this.loadDoc(id).then(() => {
        // 回填后再算一次可见字段（有些显隐依赖分公司/类型）
          this.initVisibleFields(this.data.mode);
        });
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

  async loadDoc(id) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('contracts').doc(id).get();
      const doc = res.data;
      
      this.setData({
        form: doc.fields || {},
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
      wx.showLoading({ title: '生成中，约15秒，请稍候…', mask: true });
      try {
        const upRes = await wx.cloud.callFunction({
          name: 'contractOps',
          data: { action: 'update', id, fields: payload }
        });
        const upOk = upRes?.result?.ok && upRes.result.updated === 1;
        if (!upOk) {
          wx.showToast({ title: upRes?.result?.error || '保存失败', icon: 'none' });
          return;
        }
        wx.showLoading({ title: '生成中，约15秒，请稍候…', mask: true });
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
    if (this.data.mode !== 'create') return; 
    const idx = Number(e.detail.value);
    const opt = this.data.typeOptions[idx];
    this.setData({
        typeIndex: idx,
        selectedTypeCode: opt.code,
        selectedTypeName: opt.name,
    });
  },

  onInput(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value;
    this.setData({ [`form.${name}`]: value });
  },

  onInputNumber(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value;
    const patch = { [`form.${name}`]: value };

    const map = {
        rentMonthly: 'rentMonthlyFormal',
        rentToday: 'rentTodayFormal',
        deposit: 'depositFormal',
        depositToday: 'depositTodayFormal',
        depositServiceFee: 'depositServiceFeeFormal',
        rentMonthlyFirstYear: 'rentMonthlyFirstYearFormal',
        rentMonthlySecondYear: 'rentMonthlySecondYearFormal',
    };
    if (map[name]) {
        patch[`form.${map[name]}`] = numberToCN(value);
    }
    this.setData(patch);
  },

  onDateChange(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value; // yyyy-mm-dd
    this.setData({ [`form.${name}`]: value });
  },

  // 校验逻辑升级
  validate() {
    const { form, selectedTypeCode } = this.data;
    
    // 1. 基础校验 (遍历 FIELDS)
    for (const f of FIELDS) {
      const v = form[f.name];

      // 特殊：rentMonthly 和 rentToday 在 'rent_rto' 模式下可能不填
      // 如果是 rto 模式，跳过 rentMonthly 基础校验，改为后面手动校验
      if (selectedTypeCode === 'rent_rto' && (f.name === 'rentMonthly' || f.name === 'rentToday')) {
         continue; 
      }
      // 如果是普通模式，跳过 rto 字段的基础校验 (它们本身是 requiredWhen:'never' 所以默认就跳过了)

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
        if (f.strLenMin && str.length < f.strLenMin) return `${f.label}长度需≥${f.strLenMin}`;
        if (f.strLenMax && str.length > f.strLenMax) return `${f.label}长度需≤${f.strLenMax}`;
        const num = Number(v);
        if (!isFinite(num)) return `${f.label}必须为数字`;
        if (f.min !== undefined && num < f.min) return `${f.label}需≥${f.min}`;
        if (f.max !== undefined && num > f.max) return `${f.label}需≤${f.max}`;
      }
      if (f.type === 'date' && v) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${f.label}格式不正确`;
      }
    }
    const payDay = Number(form.rentPaybyDayInMonth);
    if (!(payDay >= 1 && payDay <= 31)) return '每月支付日需在 1 到 31 之间';

    if (this.data.showBranchPicker && !this.data.selectedBranchCode) {
        return '请选择分公司';
    }
    if (!this.data.selectedTypeCode) {
        return '请选择合同类型';
    }

    // 新增：针对合同类型的特定校验
    if (selectedTypeCode === 'rent_rto') {
        // 以租代购必填项
        if (!form.rentMonthlyFirstYear) return '请输入1—12期租金';
        if (!form.rentMonthlySecondYear) return '请输入13—24期租金';
        if (!form.daysTillPayment) return '请输入签订后支付天数';
        if (!form.sellPrice) return '请输入购买车辆金额';
    } else {
        // 普通租赁必填项 (补充之前跳过的)
        if (!form.rentMonthly) return '请输入月租金';
        if (!form.rentToday) return '请输入首日支付金';
    }

    return '';
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

    // 1) 防抖
    const now = Date.now();
    if (now - (this.lastSubmitTime || 0) < 2000) {
        return; 
    }
    this.lastSubmitTime = now;
  
    if (this.data.saving) return;

    // 必须在 validate() 和 toPersistObject() 之前执行
    // 这里的原理是：修改 form 对象的属性，因为它是引用类型，
    // 所以后续的 validate/toPersistObject 读取 this.data.form 时都能读到清洗后的值。
    const { form } = this.data; 
    if (form) {
      let changed = false;
      if (typeof form.clientName === 'string') {
        const clean = form.clientName.replace(/[\r\n]/g, '').trim();
        if (form.clientName !== clean) { form.clientName = clean; changed = true; }
      }
      if (typeof form.clientPhone === 'string') {
        const clean = form.clientPhone.replace(/[\r\n]/g, '').trim();
        if (form.clientPhone !== clean) { form.clientPhone = clean; changed = true; }
      }
      if (typeof form.carPlate === 'string') {
        const clean = form.carPlate.replace(/[\r\n]/g, '').trim().toUpperCase();
        if (form.carPlate !== clean) { form.carPlate = clean; changed = true; }
      }
      
      // (可选) 用户看到输入框里的回车立刻消失
      if (changed) { this.setData({ form }); }
    }

    const err = this.validate && this.validate();
    if (err) { wx.showToast({ title: err, icon: 'none', duration: 3000 }); return; }
  
    const payload = this.toPersistObject();

    // 兜底逻辑：仅针对普通租赁填充默认值
    if (mode === 'create' && selectedTypeCode !== 'rent_rto') {
        if (payload.rentToday === undefined || payload.rentToday === null || payload.rentToday === 0) {
            if (this.data.form && this.data.form.rentToday === 120) {
                console.warn('Fixed missing default rentToday: 120');
                payload.rentToday = 120;
                if (!payload.rentTodayFormal || payload.rentTodayFormal === '零元整') {
                    payload.rentTodayFormal = numberToCN(120);
                }
            }
        }
    }

    // 2. 新增：以租代购 daysTillPayment 兜底逻辑
    // 防止用户没碰输入框导致提交了 0 或 null
    if (mode === 'create' && selectedTypeCode === 'rent_rto') {
        if (!payload.daysTillPayment) {
            if (this.data.form && this.data.form.daysTillPayment === 7) {
                console.warn('Fixed missing default daysTillPayment: 7');
                payload.daysTillPayment = 7;
            }
        }
    }

    if (this.submitting) return;
    this.submitting = true;
  
    try {
      if (mode === 'edit' && id) {
        // —— 合并流程：更新 → 渲染 → 打开 —— //
        await this.onSaveAndRender();
        return; 
      }
  
      if (mode === 'create') {
        this.setData({ saving: true });
        wx.showLoading({ title: '生成中，约15秒，请稍候…', mask: true });
        const res = await wx.cloud.callFunction({
          name: 'contractV2',
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
        const contractId = result.id || result._id || '';
        wx.showToast({ title: '合同已生成', icon: 'success', duration: 2000 });
  
        if (fileID) {
          const dres = await wx.cloud.downloadFile({ fileID });
          await wx.openDocument({ filePath: dres.tempFilePath, fileType: 'pdf' });
        } else {
          wx.showModal({
            title: '提示',
            content: '合同已保存，但文档未生成，可稍后重试',
            showCancel: false,
            confirmText: '知道了',
            duration: 1000
          });
        }
  
        // 修改合同后返回上一页
        setTimeout(() => {
            const { cityCode, city } = this.data;
            wx.reLaunch({
              url: `/pages/contract-list/index?cityCode=${encodeURIComponent(cityCode || '')}&city=${encodeURIComponent(city || '')}`
            });
          }, 1500);
      }
  
    } catch (e) {
      console.error(e);
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none', duration: 3000 });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
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
    if (!id) { wx.showToast({ title:'缺少合同ID', icon:'none' }); return; }

    try {
      this.setData({ regenLoading: true });
      const res = await wx.cloud.callFunction({
        name: 'contractOps',
        data: { action: 'render', id }
      });
      const rr = res && res.result ? res.result : {};
      if (rr.ok) {
        wx.showToast({ title: '已重新生成', icon:'success' });
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

  // 创建合同时，载入可租赁的车辆
  async loadAvailableVehicles(cityCode) {
    if (!cityCode) return;
    const db = wx.cloud.database();
    const _  = db.command;
    const where = {
        cityCode,
        rentStatus: 'available',
        maintenanceStatus: _.or([
            _.eq('none'), _.eq(''), _.eq(null), _.exists(false)
        ])
    };
    try {
        const { data } = await db.collection('vehicles')
        .where(where).orderBy('plate', 'asc').limit(20).get();
        this.setData({
        vehiclePickerOptions: data,
        // picker 显示用字符串
        vehiclePickerRange: data.map(v =>
            `${v.plate || ''} ${v.model || ''}`.trim()
        ),
        vehiclePickerIndex: -1
        });
    } catch (e) {
        console.error('[contract-new] loadAvailableVehicles error', e);
        wx.showToast({ title: '加载车辆失败', icon: 'none' });
    }
  },

  // 选中车辆时自动回填车字段
  onVehiclePickChange(e) {
    const idx = Number(e.detail.value);
    const list = this.data.vehiclePickerOptions || [];
    if (!list.length) return wx.showToast({ title: '暂无车辆', icon: 'none' });
    const vehicle = list[idx];
    if (!vehicle) return;
    this.setData({
      vehiclePickerIndex: idx,
      'form.carPlate': vehicle.plate || '',
      'form.carModel': vehicle.model || '',
      'form.carColor': vehicle.color || '',
      'form.carVin':   vehicle.vin   || '',
    });
  }
});