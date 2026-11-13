/**
 * Tiến độ thi công chi nhánh — máy chủ dữ liệu chung bằng Google Sheet + Apps Script.
 *
 * CÀI ĐẶT (làm 1 lần):
 *  1. Tạo 1 Google Sheet mới → Tiện ích mở rộng (Extensions) → Apps Script → xoá code mẫu, dán toàn bộ file này → Lưu.
 *  2. (Tuỳ chọn, để tự đồng bộ task) Cài đặt dự án (biểu tượng bánh răng) → Thuộc tính tập lệnh → thêm:
 *       HSK_TOKEN    = token wshr (phần sau chữ "Bearer ", token app="wshr", sub khác 0)
 *       HSK_API_BASE = https://wshr.hasaki.vn/api/hr/projects/task-input   (mặc định, không cần thêm)
 *  3. Triển khai (Deploy) → Tùy chọn triển khai mới → Loại: Ứng dụng web
 *       Thực thi với tư cách: Tôi (Me) · Người có quyền truy cập: Bất kỳ ai (Anyone) → Triển khai → cấp quyền.
 *  4. Copy "URL ứng dụng web" (…/exec) → dán vào file config.js trên GitHub (hoặc ô "Kết nối Google Sheet" trong tab Cấu hình).
 *  5. (Tuỳ chọn) Chạy hàm caiDatTuDongDongBo một lần để máy chủ tự đồng bộ task mỗi 30 phút.
 *
 * Khi sửa code này: Triển khai → Quản lý triển khai → chỉnh sửa (bút chì) → Phiên bản: Mới → Triển khai (URL giữ nguyên).
 *
 * Dữ liệu nằm ở sheet "data" (JSON, KHÔNG sửa tay). Sheet "TongHop" và "NhatKy" chỉ để xem/xuất, được ghi lại sau mỗi lần lưu.
 */

const DATA_SHEET = 'data';
const CHUNK = 45000; // giới hạn 1 ô Google Sheet là 50.000 ký tự

// ---------------- HTTP ----------------
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'state';
  if (action === 'rev') return json_({ rev: getRev_() });
  if (action === 'ping') return json_({ ok: true, rev: getRev_(), sync: !!prop_('HSK_TOKEN') });
  const data = load_();
  return json_({ rev: data.rev, data: data, sync: !!prop_('HSK_TOKEN') });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json_({ error: 'Dữ liệu gửi lên không phải JSON' }); }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ error: 'Máy chủ đang bận, thử lại sau ít giây' });
  try {
    if (body.action === 'ops') {
      const data = load_();
      (body.ops || []).forEach(function (op) { applyOp_(data, op); });
      save_(data);
      return json_({ rev: data.rev, data: data });
    }
    if (body.action === 'sync') {
      const data = load_();
      const summary = syncData_(data, body.storeIds || [], body.by || '');
      save_(data);
      return json_({ rev: data.rev, data: data, summary: summary });
    }
    if (body.action === 'test') {
      const id = String(body.taskId || '');
      if (!/^\d{3,12}$/.test(id)) return json_({ error: 'task_id không hợp lệ' });
      const r = fetchTask_(id);
      return json_({ status: r.status, json: r.json, text: r.json ? '' : String(r.text || '').slice(0, 2000) });
    }
    return json_({ error: 'action không hợp lệ' });
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function getRev_() { return Number(prop_('REV')) || 0; }

// ---------------- lưu trữ: mỗi bản ghi 1 dòng (key | json), chia nhỏ nếu dài ----------------
function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(DATA_SHEET);
  if (!sh) { sh = ss.insertSheet(DATA_SHEET); sh.getRange(1, 1, 1, 2).setValues([['key', 'json']]); sh.setFrozenRows(1); }
  return sh;
}

function load_() {
  const sh = sheet_();
  const n = sh.getLastRow();
  const data = { rev: getRev_(), config: null, stores: {}, logs: [], lastSync: null };
  if (n < 2) return data;
  const rows = sh.getRange(2, 1, n - 1, 2).getValues();
  const parts = {};
  rows.forEach(function (r) {
    const key = String(r[0] || ''); if (!key) return;
    const m = /^(.*)#(\d+)$/.exec(key);
    const base = m ? m[1] : key, idx = m ? Number(m[2]) : 0;
    (parts[base] = parts[base] || [])[idx] = String(r[1] || '');
  });
  Object.keys(parts).forEach(function (key) {
    let v; try { v = JSON.parse(parts[key].join('')); } catch (e) { return; }
    if (key === 'config') data.config = v;
    else if (key === 'lastSync') data.lastSync = v;
    else if (key.indexOf('store:') === 0) data.stores[key.slice(6)] = v;
    else if (key.indexOf('log:') === 0) data.logs.push(v);
  });
  data.logs.sort(function (a, b) { return String(a.ts || a.date).localeCompare(String(b.ts || b.date)); });
  return data;
}

function save_(data) {
  data.rev = getRev_() + 1;
  const rows = [];
  const put = function (key, obj) {
    const s = JSON.stringify(obj);
    if (s.length <= CHUNK) { rows.push([key, s]); return; }
    for (let i = 0, k = 0; i < s.length; i += CHUNK, k++) rows.push([key + '#' + k, s.slice(i, i + CHUNK)]);
  };
  if (data.config) put('config', data.config);
  if (data.lastSync) put('lastSync', data.lastSync);
  Object.keys(data.stores).forEach(function (id) { put('store:' + id, data.stores[id]); });
  data.logs.forEach(function (l) { put('log:' + l.id, l); });
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
  PropertiesService.getScriptProperties().setProperty('REV', String(data.rev));
  writeReadable_(data);
}

// Sheet dễ đọc cho quản lý xem / lọc / xuất Excel (ghi lại toàn bộ sau mỗi lần lưu).
function writeReadable_(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const head = ['Mã', 'Chi nhánh', 'Loại hình', 'PIC tổng', 'Nhận nhà', 'Bắt đầu thi công', 'Khai trương', 'Hiện trạng / vướng mắc', 'Cập nhật lúc', 'Cập nhật bởi'];
    const rows = Object.keys(data.stores).map(function (id) {
      const s = data.stores[id];
      return [s.code || '', s.name || '', s.type || '', s.pic || '', s.handover || '', s.buildStart || '', s.openDate || '', s.note || '', s.updatedAt || '', s.updatedBy || ''];
    }).sort(function (a, b) { return String(a[6] || '9999').localeCompare(String(b[6] || '9999')); });
    let sh = ss.getSheetByName('TongHop') || ss.insertSheet('TongHop');
    sh.clearContents(); sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); sh.setFrozenRows(1);
    if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
    const names = {}; Object.keys(data.stores).forEach(function (id) { names[id] = data.stores[id].name || id; });
    const lh = ['Ngày', 'Chi nhánh', 'Hạng mục', 'Nội dung', 'Link', 'Người ghi', 'Lúc'];
    const lr = data.logs.slice().reverse().map(function (l) { return [l.date || '', names[l.storeId] || l.storeId, l.cat || '', l.text || '', l.link || '', l.by || '', l.ts || '']; });
    let lg = ss.getSheetByName('NhatKy') || ss.insertSheet('NhatKy');
    lg.clearContents(); lg.getRange(1, 1, 1, lh.length).setValues([lh]).setFontWeight('bold'); lg.setFrozenRows(1);
    if (lr.length) lg.getRange(2, 1, lr.length, lh.length).setValues(lr);
  } catch (e) { /* sheet xem nhanh lỗi thì bỏ qua, dữ liệu chính vẫn an toàn */ }
}

// ---------------- áp thay đổi (giống hệt phía trang web) ----------------
function clone_(o) { return JSON.parse(JSON.stringify(o)); }
function merge_(a, b) {
  for (const k in b) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) a[k] = merge_(a[k] && typeof a[k] === 'object' ? a[k] : {}, b[k]);
    else a[k] = b[k];
  }
  return a;
}
function applyOp_(d, op) {
  switch (op.t) {
    case 'patch': if (d.stores[op.id]) merge_(d.stores[op.id], clone_(op.patch)); break;
    case 'create': d.stores[op.store.id] = clone_(op.store); break;
    case 'del': delete d.stores[op.id]; d.logs = d.logs.filter(function (l) { return l.storeId !== op.id; }); break;
    case 'log': if (!d.logs.some(function (l) { return l.id === op.log.id; })) d.logs.push(clone_(op.log)); break;
    case 'dellog': d.logs = d.logs.filter(function (l) { return l.id !== op.id; }); break;
    case 'config': d.config = clone_(op.config); break;
    case 'sync': for (const id in op.patches) if (d.stores[id]) merge_(d.stores[id], clone_(op.patches[id])); d.lastSync = clone_(op.lastSync); break;
    case 'replace': {
      const n = op.data || {};
      d.config = n.config && n.config.workflows ? n.config : d.config;
      d.stores = Array.isArray(n.stores) ? n.stores.reduce(function (m, x) { m[x.id] = x; return m; }, {}) : (n.stores || {});
      d.logs = Array.isArray(n.logs) ? n.logs : [];
      d.lastSync = n.lastSync || null;
      break;
    }
  }
  return d;
}

// ---------------- đồng bộ task từ API wshr (chạy trên máy chủ Google → không bị CORS) ----------------
function fetchTask_(id) {
  const token = prop_('HSK_TOKEN').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Chưa cài HSK_TOKEN trong Thuộc tính tập lệnh của Apps Script');
  const base = (prop_('HSK_API_BASE') || 'https://wshr.hasaki.vn/api/hr/projects/task-input').replace(/\/+$/, '');
  const res = UrlFetchApp.fetch(base + '/' + encodeURIComponent(id), {
    method: 'get', muteHttpExceptions: true, followRedirects: true,
    headers: { Accept: 'application/json', 'X-Locale': 'vi', 'Accept-Language': 'vi', Authorization: 'Bearer ' + token, Origin: 'https://work.hasaki.vn', Referer: 'https://work.hasaki.vn/' }
  });
  const text = res.getContentText();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.getResponseCode(), json: json, text: text };
}

function loadTask_(id) {
  const r = fetchTask_(id);
  if (r.status === 401 || r.status === 403) throw new Error('Token không hợp lệ hoặc hết hạn (HTTP ' + r.status + ')');
  if (r.status !== 200 || !r.json) return { ok: false, error: 'HTTP ' + r.status };
  let a = analyzeTask(r.json);
  if (a.ok && !a.steps.length && a.parentId) {
    const r2 = fetchTask_(String(a.parentId));
    if (r2.status === 200 && r2.json) { const a2 = analyzeTask(r2.json); if (a2.ok) a = a2; }
  }
  return a;
}

function ict_(d) { return Utilities.formatDate(d || new Date(), 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ss"); }
function taskIdOf_(link) { const m = /task_id=(\d+)/.exec(link || ''); return m ? m[1] : ''; }

function syncData_(data, storeIds, by) {
  const cfg = data.config;
  if (!cfg || !cfg.workflows) throw new Error('Chưa có cấu hình workflow trên Sheet — mở trang web và bấm Lưu cấu hình một lần');
  const want = {}; storeIds.forEach(function (id) { want[id] = true; });
  const pairs = [];
  Object.keys(data.stores).forEach(function (sid) {
    const st = data.stores[sid];
    if ((storeIds.length && !want[sid]) || st.hold) return;
    cfg.workflows.forEach(function (w) {
      const e = (st.wf || {})[w.id] || {};
      if (e.status === 'Không áp dụng') return;
      const tid = taskIdOf_(e.link); if (tid) pairs.push({ sid: sid, w: w, tid: tid, e: e });
    });
  });
  const stamp = ict_(), T = stamp.slice(0, 10);
  const sum = { tasks: pairs.length, ok: 0, failed: 0, changed: 0, unmatched: 0, errors: [] };
  if (!pairs.length) return sum;
  const got = {};
  pairs.forEach(function (p) {
    if (got[p.tid]) return;
    try { got[p.tid] = loadTask_(p.tid); }
    catch (e) { if (/Token|HSK_TOKEN/.test(String(e.message))) throw e; got[p.tid] = { ok: false, error: String(e.message || e) }; }
  });
  const patches = {};
  pairs.forEach(function (p) {
    const a = got[p.tid];
    if (!a || !a.ok) { sum.failed++; if (sum.errors.length < 5) sum.errors.push('task ' + p.tid + ': ' + (a ? a.error : 'không có dữ liệu')); return; }
    sum.ok++;
    const r = wfFromTask(p.w, a);
    const wp = { status: r.status, taskPct: r.taskPct, taskStep: r.taskStep || '', taskDone: r.taskDone, taskOpen: r.taskOpen, taskTotal: r.taskTotal, taskSteps: r.taskSteps, syncedAt: stamp, updated: T };
    if (r.step) wp.step = r.step; else if (r.taskOpen) sum.unmatched++;
    if (r.deadline) wp.deadline = r.deadline;
    if (r.taskPic) wp.pic = r.taskPic;
    if (wp.status !== p.e.status || (wp.step && wp.step !== p.e.step) || r.taskPct !== Number(p.e.taskPct) || (wp.deadline && wp.deadline !== p.e.deadline)) sum.changed++;
    (patches[p.sid] = patches[p.sid] || { wf: {}, wfSyncedAt: stamp }).wf[p.w.id] = wp;
  });
  applyOp_(data, { t: 'sync', patches: patches, lastSync: { at: stamp, by: by || 'máy chủ', summary: sum } });
  return sum;
}

// Chạy hàm này 1 lần (nút Chạy ▶ trong Apps Script) để tự đồng bộ mỗi 30 phút.
function caiDatTuDongDongBo() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tuDongDongBo') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tuDongDongBo').timeBased().everyMinutes(30).create();
}
function tuDongDongBo() {
  if (!prop_('HSK_TOKEN')) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return;
  try { const data = load_(); syncData_(data, [], 'tự động (máy chủ)'); save_(data); }
  finally { lock.releaseLock(); }
}

// ---------------- phân tích task (dùng chung với trang web — không sửa riêng một bên) ----------------
function stepCode(n){const m=/^B\.?\s*(\d+(?:\.\d+)*)/.exec(n||"");return m?"B"+m[1]:"";}
const T_STATUS={0:"Chưa xử lý",1:"Đang xử lý",2:"Hoàn thành",4:"Đã huỷ",5:"Xong, chờ ký",6:"Chờ bên ngoài"};
const T_DONE=new Set([2,5]),T_OPEN=new Set([0,1,6]);
const SENTINEL="2028-01-01";
const isMachineStep=x=>/^điều hướng/i.test(String(x.name||"").trim());
function realDate(v){const d=String(v||"").slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)&&d<SENTINEL?d:"";}
function staffOf(x){const a=x&&x.assign_to_user;const u=Array.isArray(a)?a[0]:a;return u&&(u.staff_name||u.name)||"";}
function analyzeTask(json){
  const d=json&&json.data!==undefined?json.data:json;
  if(!d||typeof d!=="object") return {ok:false,error:"response không có data"};
  const all=Array.isArray(d.subtasks)?d.subtasks:[];
  const steps=all.filter(x=>x&&!isMachineStep(x)).map(x=>({id:x.id,n:String(x.name||"").trim(),st:Number(x.status),de:realDate(x.date_end),fa:String(x.finished_at||"").slice(0,16),pic:staffOf(x)})).sort((a,b)=>a.id-b.id);
  return {ok:true,id:d.id,name:d.name||"",parentId:Number(d.parent_id)||0,wfId:d.workflow_id||null,steps,
    done:steps.filter(x=>T_DONE.has(x.st)),open:steps.filter(x=>T_OPEN.has(x.st)),cancelled:steps.filter(x=>x.st===4)};
}
// Tính kết quả cho 1 WF từ các bước trên hệ thống task.
// % = mức % (danh mục bước) của bước đang mở xa nhất; không bước nào đang mở mà có bước xong = 100%.
// Bước không có trong danh mục -> % = số bước xong / số bước đã phát sinh (bỏ bước huỷ).
function wfFromTask(wf,a){
  const pctOf=x=>{const m=matchStepStrict(wf,x.n);return m?{m,p:Number(m.p)||0}:null;};
  const counted=a.done.length+a.open.length;
  const ratio=counted?Math.round(a.done.length/counted*100):0;
  const r={taskTotal:counted,taskDone:a.done.length,taskOpen:a.open.length,taskSteps:a.steps.slice(-30)};
  if(a.open.length){
    const om=a.open.map(x=>({x,k:pctOf(x)}));
    const best=om.filter(o=>o.k).sort((u,v)=>v.k.p-u.k.p||v.x.id-u.x.id)[0];
    const doneMax=Math.max(0,...a.done.map(x=>{const k=pctOf(x);return k?k.p:0;}));
    const cur=best?best.x:a.open[a.open.length-1];
    r.status=a.open.every(x=>x.st===6)?"Đang thực hiện":"Đang thực hiện";
    r.step=best?best.k.m.n:"";
    r.taskStep=a.open.map(x=>x.n).join(" · ");
    r.taskPct=best?Math.max(best.k.p,doneMax):ratio;
    if(r.taskPct>=100) r.taskPct=99;
    r.deadline=cur.de||"";
    r.taskPic=cur.pic||"";
  }else if(a.done.length){
    const last=a.done[a.done.length-1],k=pctOf(last);
    r.status="Hoàn thành";r.step=k?k.m.n:"";r.taskStep=last.n;r.taskPct=100;r.deadline="";r.taskPic="";
  }else if(a.cancelled.length){
    r.status="Tạm dừng / vướng";r.step="";r.taskStep="Các bước đã bị huỷ";r.taskPct=0;r.taskPic="";
  }else{
    r.status="Đang thực hiện";r.step="";r.taskStep="Chưa phát sinh bước nào";r.taskPct=0;r.taskPic="";
  }
  return r;
}
// Khớp tên bước từ hệ thống với danh mục: trùng tên, hoặc cùng mã Bx và trùng phần đầu nội dung.
// Không khớp chỉ theo mã (tránh lấy nhầm % của bước khác cùng mã).
function matchStepStrict(wf,name){
  if(!name) return null; const n=normS(name);
  const ex=wf.steps.find(x=>normS(x.n)===n); if(ex) return ex;
  const code=stepCode(name), body=n.replace(/^b\.?\s*[\d.]+\.?\s*(\(\*\))?\.?\s*/,"").replace(/\s*\(\*\)\s*$/,"");
  if(!code||!body) return null;
  return wf.steps.find(x=>{if(stepCode(x.n)!==code)return false;const xb=normS(x.n).replace(/^b\.?\s*[\d.]+\.?\s*(\(\*\))?\.?\s*/,"").replace(/\s*\(\*\)\s*$/,"");return xb===body||xb.startsWith(body.slice(0,15))||body.startsWith(xb.slice(0,15));})||null;
}
const normS=x=>String(x||"").toLowerCase().normalize("NFC").replace(/\s+/g," ").trim();