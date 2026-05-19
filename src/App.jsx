import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, doc, addDoc, 
  onSnapshot, query, deleteDoc, updateDoc, getDoc, setDoc 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously 
} from 'firebase/auth';
import { 
  Search, Plus, Edit2, Trash2, Share2, ChevronLeft, Users, Download, Upload,
  Send, AlertTriangle, HelpCircle, Info, Lightbulb, Clock, CheckCircle2, Save, X, Lock, User, LogOut
} from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyBGJo-AKtx-9muWH3E6YbQmHb1CZZQzZKI",
  authDomain: "e-learning-platform-c5143.firebaseapp.com",
  projectId: "e-learning-platform-c5143",
  storageBucket: "e-learning-platform-c5143.firebasestorage.app",
  messagingSenderId: "31455467182",
  appId: "1:31455467182:web:2793a3df96adf3ce4bff3f",
  measurementId: "G-JT4YPH55TK"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'pharmacy-lesson-v1-1-2';

// 角色對照表
const ROLE_MAP = {
  '0': '管理',
  '1': '藥師',
  '2': '書記',
  '3': '藥庫'
};

// 預設的三位核心管理人員靜態清單 (本地最高優先順序判定)
const DEFAULT_ADMINS = {
  "Y06100": { name: "陳麗珺", role: "0", password: "1" },
  "Y01422": { name: "廖瑋儀", role: "0", password: "123" },
  "Y01458": { name: "林秀芳", role: "0", password: "123" }
};

// --- API Helper for Gemini ---
const apiKey = "AIzaSyBGJo-AKtx-9muWH3E6YbQmHb1CZZQzZKI";
const callGemini = async (prompt) => {
  const systemPrompt = `你是一個專業的醫療安全教育專家。請根據提供內容擴充為結構化教案。
請務必以 JSON 格式回傳：
{
  "title": "標題",
  "subtitle": "副標題（極短）",
  "caseDescription": "詳細敘述（分段，嚴禁提及移植病人，除非內容明確相關）",
  "dangerAnalysis": ["風險1", "風險2"],
  "safetyTip": "一句話提醒（6字內）",
  "quiz": {
    "question": "提問內容",
    "options": ["選項1", "選項2", "選項3", "選項4"],
    "correctIndices": [0] 
  }
}
注意：此教案與移植病人無關。安全提醒要極短精煉。`;

  let retries = 0;
  while (retries < 5) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const data = await response.json();
      return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text);
    } catch (err) {
      retries++;
      await new Promise(r => setTimeout(r, Math.pow(2, retries) * 1000));
    }
  }
  throw new Error("AI 生成失敗");
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(null); 
  const [userRole, setUserRole] = useState(null); 
  const [view, setView] = useState('login'); // login, list, editor, viewer, staff
  const [lessons, setLessons] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [responses, setResponses] = useState([]);
  const [currentLesson, setCurrentLesson] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);

  // 人員管理臨時輸入與編輯狀態
  const [newStaffId, setNewStaffId] = useState('');
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('1'); 
  const [newStaffPass, setNewStaffPass] = useState('');
  const [editingId, setEditingId] = useState(null); 
  const [editFields, setEditFields] = useState({ name: '', role: '', password: '' });

  // 完整恢復：教案編輯 Form State 與 素材輸入狀態
  const [formData, setFormData] = useState({
    title: '', subtitle: '', caseDescription: '', dangerAnalysis: [], safetyTip: '',
    quiz: { question: '', options: [], correctIndices: [] }
  });
  const [rawInput, setRawInput] = useState({ content: '', qa: '', review: '' });
  const [editMode, setEditMode] = useState('raw'); // raw (輸入素材) 或 refined (修正 AI)

  // Firebase Auth Setup 匿名驗證
  useEffect(() => {
    const initAuth = async () => {
      try { await signInAnonymously(auth); } catch (e) { console.warn("Auth init warning:", e.message); }
    };
    initAuth();
  }, []);

  // 監聽教案資料
  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'lessons'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLessons(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error("Firestore Lessons Error:", err));
    return () => unsubscribe();
  }, [auth.currentUser]);

  // 監聽人員管理資料
  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'staffs'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      // 🌟 請確保這裡是用 doc.id 作為該筆資料的 id
      setStaffList(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error("Firestore Staffs Error:", err));
    return () => unsubscribe();
  }, [auth.currentUser]);

  // 監聽藥師作答回覆資料
  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'responses'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setResponses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error("Firestore Responses Error:", err));
    return () => unsubscribe();
  }, [auth.currentUser]);

  // 處理分享外部作答連結
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const lid = urlParams.get('lessonId');
    if (lid && lessons.length > 0) {
      const target = lessons.find(l => l.id === lid);
      if (target) { 
        setCurrentLesson(target); 
        setView('viewer'); 
      }
    }
  }, [lessons]);

  // 自動化格式員編輸入
  const handleIdFormat = (val) => {
    let v = val.toUpperCase();
    if (v.length > 0 && !v.startsWith('Y')) {
      v = 'Y' + v.replace(/[^0-9]/g, '');
    }
    return v.slice(0, 6);
  };

  // 1. 靜態優先、本地立即判定登入邏輯
  const handleLogin = async (id, pass) => {
    const upperId = id.toUpperCase();
    if (!/^Y\d{5}$/.test(upperId)) {
      alert("員編格式錯誤：請輸入 Y + 5位數字");
      return;
    }
    if (!pass) {
      alert("請輸入密碼");
      return;
    }

    if (DEFAULT_ADMINS[upperId]) {
      const adminStaticInfo = DEFAULT_ADMINS[upperId];
      if (String(adminStaticInfo.password) === String(pass)) {
        setCurrentUser(upperId);
        setUserRole(adminStaticInfo.role);
        setView('list');
        
        try {
          const staffDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'staffs', upperId);
          getDoc(staffDocRef).then((snap) => {
            if (!snap.exists()) {
              setDoc(staffDocRef, {
                name: adminStaticInfo.name,
                role: adminStaticInfo.role,
                password: adminStaticInfo.password,
                createdAt: new Date().toISOString()
              });
            }
          });
        } catch (e) { console.log("Background check skipped."); }
        return; 
      } else {
        alert("密碼輸入錯誤！請輸入核心管理員的正確密碼。");
        return;
      }
    }

    setLoading(true);
    try {
      const staffDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'staffs', upperId);
      const staffSnapshot = await getDoc(staffDocRef);

      if (!staffSnapshot.exists()) {
        alert("登入失敗：您不在系統的人員授權清單中，請聯絡管理藥師。");
        return;
      }

      const staffData = staffSnapshot.data();
      const role = String(staffData.role || '1');

      if (role !== '0' && role !== '2') {
        alert(`登入拒絕：您的角色為「${ROLE_MAP[role] || '藥師'}」，本後台僅限【管理】與【書記】角色進入。`);
        return;
      }
      
      if (!staffData.password) {
        await updateDoc(staffDocRef, { password: pass, updatedAt: new Date().toISOString() });
        alert(`🎉 首次登入成功！已為您自動記憶綁定此登入密碼。`);
        setCurrentUser(upperId);
        setUserRole(role);
        setView('list');
      } else if (String(staffData.password) === String(pass)) {
        setCurrentUser(upperId);
        setUserRole(role);
        setView('list');
      } else {
        alert("密碼輸入錯誤！請輸入該員編綁定的正確密碼。");
      }
    } catch (err) {
      console.error(err);
      alert("資料庫連線失敗，請檢查網路狀態。");
    } finally {
      setLoading(false);
    }
  };

  // 手動單筆新增人員
  const handleAddStaff = async () => {
    const upperId = newStaffId.toUpperCase();
    if (!/^Y\d{5}$/.test(upperId)) { alert("員編格式錯誤！請輸入 Y 加上 5 位數字"); return; }
    if (!newStaffName) { alert("請輸入姓名！"); return; }
    
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'staffs', upperId), {
        name: newStaffName,
        role: newStaffRole,
        password: newStaffPass,
        createdAt: new Date().toISOString()
      });
      setNewStaffId('');
      setNewStaffName('');
      setNewStaffPass('');
      setNewStaffRole('1');
    } catch (e) { alert("新增同仁項目失敗"); }
  };

// 替換原本的 CSV 檔案批量導入解析功能
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target.result;
      const lines = text.split('\n');
      let importCount = 0;

      // 建立現有人員員編的 Set，方便 0 秒比對
      const existingIds = new Set(staffList.map(s => s.id));

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const columns = line.split(',');
        if (columns.length < 2) continue;

        let empId = columns[0].trim().toUpperCase();
        let empName = columns[1] ? columns[1].trim() : '';
        let empRole = columns[2] ? columns[2].trim() : '1'; 
        let empPass = ''; 

        if (/^Y\d{5}$/.test(empId) && empName) {
          // 🔥 核心修正：如果現有清單已包含此員編，則直接排除，不進行寫入
          if (existingIds.has(empId)) {
            continue; 
          }

          const staffDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'staffs', empId);
          await setDoc(staffDocRef, {
            name: empName,
            role: empRole,
            password: empPass,
            createdAt: new Date().toISOString()
          });
          importCount++;
        }
      }
      alert(`🎉 成功新增 ${importCount} 位新同仁！`);
    };
    reader.readAsText(file);
  };

  // 啟用行內編輯
  const startEditStaff = (staff) => {
    setEditingId(staff.id);
    setEditFields({
      name: staff.name,
      role: String(staff.role),
      password: staff.password || ''
    });
  };

  // 儲存行內編輯結果
  const saveEditStaff = async (id) => {
    if (!editFields.name) { alert("姓名不可留空！"); return; }
    try {
      const staffDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'staffs', id);
      await updateDoc(staffDocRef, {
        name: editFields.name,
        role: editFields.role,
        password: editFields.password,
        updatedAt: new Date().toISOString()
      });
      setEditingId(null);
    } catch (e) { alert("更新同仁資料失敗"); }
  };

  // 下載所有教案清單總表
  const downloadAllLessonsExcel = () => {
    let csvContent = "\uFEFF教案編號,教案名稱,警示副標題,建立時間,最後修改人\n";
    lessons.forEach((l, idx) => {
      const caseNum = `CASE #${idx + 1}`;
      const title = l.title.replace(/"/g, '""');
      const subtitle = l.subtitle.replace(/"/g, '""');
      csvContent += `"${caseNum}","${title}","${subtitle}","${l.createdAt || ''}","${l.lastEditor || ''}"\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `藥局教案系統_總教案清單_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 下載單一教案的所有藥師回覆數據
  const downloadLessonResponsesExcel = (lessonId, lessonTitle) => {
    const currentResponses = responses.filter(r => r.lessonId === lessonId);
    let csvContent = "\uFEFF作答時間,藥師員編,藥師姓名,角色,作答選擇,是否完全正確,多選精準正確率\n";
    
    currentResponses.forEach(r => {
      const staffInfo = staffList.find(s => s.id === r.employeeId) || DEFAULT_ADMINS[r.employeeId];
      const staffName = staffInfo ? staffInfo.name : "未知同仁";
      const staffRoleStr = staffInfo ? ROLE_MAP[String(staffInfo.role)] : "藥師";
      const choices = r.selectedIndices.map(i => i + 1).join(';');
      const isCorrectStr = r.isCorrect ? "完全正確" : "未全對";
      const score = r.accuracyRate !== undefined ? `${r.accuracyRate}%` : (r.isCorrect ? "100%" : "0%");
      csvContent += `"${r.timestamp || ''}","${r.employeeId}","${staffName}","${staffRoleStr}","選項(${choices})","${isCorrectStr}","${score}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `教案回覆分析_${lessonTitle.slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 完整恢復：最初的 AI 專家統整教案素材呼叫功能
  const handleAISuggest = async () => {
    if (!rawInput.content) {
      alert("請輸入教案素材內容！");
      return;
    }
    setLoading(true);
    try {
      const result = await callGemini(`內容：${rawInput.content}\nQA構思：${rawInput.qa}\n科內檢討：${rawInput.review}`);
      setFormData(result);
      setEditMode('refined');
    } catch (err) { 
      alert("AI 整合架構失敗，請稍微刪減字數後再重試一次"); 
    } finally { 
      setLoading(false); 
    }
  };

  const handleFinalSave = async () => {
    setLoading(true);
    try {
      const data = { ...formData, updatedAt: new Date().toISOString(), lastEditor: currentUser };
      if (currentLesson?.id) {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'lessons', currentLesson.id), data);
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'lessons'), { ...data, createdAt: new Date().toISOString() });
      }
      setView('list');
      resetForm();
    } catch (err) { alert("教案儲存雲端失敗"); }
    finally { setLoading(false); }
  };

  const resetForm = () => {
    setRawInput({ content: '', qa: '', review: '' });
    setFormData({ title: '', subtitle: '', caseDescription: '', dangerAnalysis: [], safetyTip: '', quiz: { question: '', options: [], correctIndices: [] } });
    setEditMode('raw');
    setCurrentLesson(null);
  };

  const handleShare = (id) => {
    const url = `${window.location.origin}${window.location.pathname}?lessonId=${id}`;
    const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
    setCopyFeedback(true); setTimeout(() => setCopyFeedback(false), 2000);
  };

  if (view === 'login') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-md space-y-10">
          <div className="text-center">
            <div className="bg-red-500/10 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-red-500/10">
              <Info className="text-red-500" size={40} />
            </div>
            <h1 className="text-3xl font-black text-slate-100 tracking-tight">藥局教案管理系統</h1>
            <p className="text-slate-500 mt-2 font-medium">V1.3.4 • AI 智慧教案平台</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-[40px] shadow-3xl space-y-6">
            <LoginForm onLogin={handleLogin} formatId={handleIdFormat} loginLoading={loading} />
          </div>
        </div>
      </div>
    );
  }

  if (view === 'viewer' && currentLesson) {
    return <LessonViewer lesson={currentLesson} staffList={staffList} defaultAdmins={DEFAULT_ADMINS} responses={responses} formatId={handleIdFormat} currentUser={currentUser} onBack={() => { if(currentUser) { setView('list'); } else { alert("作答已完整提交！"); } }} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans pb-20">
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="bg-red-500/20 p-2.5 rounded-2xl text-red-500 shadow-inner"><Info size={22} /></div>
            <div>
              <h2 className="text-xl font-black text-slate-100 tracking-tight">藥局教案系統</h2>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest leading-none mt-1">
                {ROLE_MAP[userRole] || 'ADMIN'} ACCESS • {currentUser}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {view === 'list' && (
              <>
                <button onClick={() => setView('staff')} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 rounded-2xl font-bold text-sm flex items-center gap-2 transition-all">
                  <Users size={18} /> 同仁名單管理
                </button>
                <button onClick={downloadAllLessonsExcel} className="bg-emerald-800/80 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-2xl font-bold text-sm flex items-center gap-2 transition-all">
                  <Download size={18} /> 下載教案總表
                </button>
                <button onClick={() => setView('editor')} className="bg-red-600 hover:bg-red-500 text-white px-5 py-2.5 rounded-2xl font-bold text-sm flex items-center gap-2 transition-all shadow-xl shadow-red-900/30">
                  <Plus size={18} /> 新增個案
                </button>
              </>
            )}
            {view !== 'list' && (
              <button onClick={() => { setView('list'); resetForm(); }} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-5 py-2.5 rounded-2xl font-bold text-sm flex items-center gap-2 transition-all">
                <ChevronLeft size={18} /> 返回主畫面
              </button>
            )}
            <button onClick={() => { setView('login'); setCurrentUser(null); setUserRole(null); }} className="p-2.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"><LogOut size={20} /></button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {view === 'staff' && (
          <div className="bg-slate-900 border border-slate-800 rounded-[40px] p-8 space-y-8 shadow-2xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
              <div className="flex items-center gap-3 text-red-500">
                <Users size={24} />
                <h3 className="text-2xl font-black text-slate-100">同仁名單管理</h3>
              </div>
              
              <label className="bg-emerald-700 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 cursor-pointer transition-all self-start md:self-auto shadow-lg">
                <Upload size={16} /> 批次導入 CSV 檔案
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
            
            {/* 手動新增人員 */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-slate-950 p-6 rounded-3xl border border-slate-800 items-center">
              <input type="text" placeholder="員編 (如 Y12345)" value={newStaffId} onChange={(e)=>setNewStaffId(handleIdFormat(e.target.value))} className="bg-slate-900 p-3.5 rounded-xl border border-slate-800 text-slate-100 font-bold tracking-widest text-sm" />
              <input type="text" placeholder="姓名" value={newStaffName} onChange={(e)=>setNewStaffName(e.target.value)} className="bg-slate-900 p-3.5 rounded-xl border border-slate-800 text-slate-100 font-bold text-sm" />
              <select value={newStaffRole} onChange={(e)=>setNewStaffRole(e.target.value)} className="bg-slate-900 p-3.5 rounded-xl border border-slate-800 text-slate-100 font-bold text-sm outline-none">
                <option value="0">0: 管理</option>
                <option value="1">1: 藥師</option>
                <option value="2">2: 書記</option>
                <option value="3">3: 藥庫</option>
              </select>
              
              <input 
                type="text" 
                placeholder="密碼 (選填)" 
                value={newStaffPass} 
                onChange={(e)=>setNewStaffPass(e.target.value)} 
                className="w-full bg-slate-900 p-3.5 rounded-xl border border-slate-800 text-slate-100 font-bold text-sm" 
              />

              <button onClick={handleAddStaff} className="bg-red-600 hover:bg-red-500 text-white font-black py-3.5 rounded-xl flex items-center justify-center gap-2 text-sm transition-all"><Plus size={16}/>新增人員</button>
            </div>

            {/* 同仁名單表格 */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-xs font-black text-slate-500 uppercase tracking-widest">
                    <th className="py-4 px-4">員編</th>
                    <th className="py-4 px-4">姓名</th>
                    <th className="py-4 px-4">角色</th>
                    <th className="py-4 px-4">密碼內容 (明文)</th>
                    <th className="py-4 px-4 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 text-sm">
                  {staffList.map(s => {
                    const isEditing = editingId === s.id;
                    return (
                      <tr key={s.id} className="hover:bg-slate-850/50 transition-colors">
                        <td className="py-4 px-4 font-mono font-bold text-slate-200 tracking-wider">{s.id}</td>
                        <td className="py-4 px-4 font-bold">
                          {isEditing ? (
                            <input type="text" value={editFields.name} onChange={(e)=>setEditFields({...editFields, name: e.target.value})} className="bg-slate-950 border border-slate-700 px-3 py-1.5 rounded text-slate-100 font-bold w-32" />
                          ) : (
                            <span className="text-slate-300">{s.name}</span>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          {isEditing ? (
                            <select value={editFields.role} onChange={(e)=>setEditFields({...editFields, role: e.target.value})} className="bg-slate-950 border border-slate-700 px-2 py-1.5 rounded text-slate-100 font-bold outline-none">
                              <option value="0">0: 管理</option>
                              <option value="1">1: 藥師</option>
                              <option value="2">2: 書記</option>
                              <option value="3">3: 藥庫</option>
                            </select>
                          ) : (
                            <span className={`text-xs font-black px-3 py-1 rounded-full ${
                              String(s.role) === '0' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 
                              String(s.role) === '2' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 
                              String(s.role) === '3' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 
                              'bg-slate-800 text-slate-300'
                            }`}>
                              {ROLE_MAP[String(s.role)] || '藥師'}
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-slate-200 font-mono">
                          {isEditing ? (
                            <input 
                              type="text" 
                              value={editFields.password} 
                              onChange={(e)=>setEditFields({...editFields, password: e.target.value})} 
                              className="bg-slate-950 border border-slate-700 px-3 py-1.5 rounded text-slate-100 w-36 font-mono text-sm" 
                              placeholder="未設定密碼" 
                            />
                          ) : (
                            <span>
                              {s.password || <span className="text-amber-500/60 text-xs italic">首次登入自動記憶</span>}
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-center">
                          {isEditing ? (
                            <div className="flex justify-center gap-2">
                              <button onClick={()=>saveEditStaff(s.id)} className="text-emerald-400 hover:bg-emerald-500/10 p-2 rounded-lg"><Save size={16}/></button>
                              <button onClick={()=>setEditingId(null)} className="text-slate-400 hover:bg-slate-800 p-2 rounded-lg"><X size={16}/></button>
                            </div>
                          ) : (
                            <div className="flex justify-center gap-1">
                              <button onClick={()=>startEditStaff(s)} className="text-slate-400 hover:text-blue-400 p-2 rounded-lg"><Edit2 size={16}/></button>
                              <button 
                                onClick={async () => {
                                  if (confirm(`確定要完全刪除 ${s.name} (${s.id}) 的所有權限與資料嗎？`)) {
                                    try {
                                      // 🌟 精準路徑：artifacts -> appId -> public -> data -> staffs -> 員工員編(s.id)
                                      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'staffs', s.id));
                                      alert("刪除成功！");
                                    } catch (error) {
                                      console.error("刪除失敗原因:", error);
                                      alert(`刪除失敗，請檢查權限或網路：${error.message}`);
                                    }
                                  }
                                }} 
                                className="text-slate-500 hover:text-red-400 p-2 rounded-lg" 
                                title="註銷人員"
                              >
                                <Trash2 size={16}/>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* 2. 在 </table> 標籤的緊接著下方，貼上這段人數統計看板程式碼： */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-6 mt-4 border-t border-slate-800 text-center">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850">
                <div className="text-xs text-slate-500 font-bold">管理人員 (0)</div>
                <div className="text-xl font-black text-red-400 mt-1">
                  {staffList.filter(s => String(s.role) === '0').length} 人
                </div>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850">
                <div className="text-xs text-slate-500 font-bold">臨床藥師 (1)</div>
                <div className="text-xl font-black text-emerald-400 mt-1">
                  {staffList.filter(s => String(s.role) === '1').length} 人
                </div>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850">
                <div className="text-xs text-slate-500 font-bold">行政書記 (2)</div>
                <div className="text-xl font-black text-blue-400 mt-1">
                  {staffList.filter(s => String(s.role) === '2').length} 人
                </div>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850">
                <div className="text-xs text-slate-500 font-bold">藥庫同仁 (3)</div>
                <div className="text-xl font-black text-amber-400 mt-1">
                  {staffList.filter(s => String(s.role) === '3').length} 人
                </div>
              </div>
              <div className="bg-red-500/5 p-4 rounded-2xl border border-red-500/10 col-span-2 md:col-span-1">
                <div className="text-xs text-red-400 font-black tracking-wider">全科員工總數</div>
                <div className="text-2xl font-black text-slate-100 mt-1">
                  {staffList.length} 人
                </div>
              </div>
            </div>
            </div>
          </div>
        )}

        {view === 'list' && (
          <div className="space-y-10">
            <div className="relative group">
              <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-red-500 transition-colors" size={22} />
              <input 
                type="text" placeholder="搜尋教案 CASE 編號、標題或關鍵字..." 
                className="w-full pl-16 pr-8 py-5 bg-slate-900 border border-slate-800 rounded-[32px] text-slate-100 placeholder:text-slate-600 focus:ring-4 focus:ring-red-500/10 focus:border-red-500/50 outline-none transition-all shadow-2xl"
                value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {lessons.filter(l => {
                const q = searchQuery.toLowerCase();
                const caseNum = `case#${lessons.indexOf(l) + 1}`;
                return l.title.toLowerCase().includes(q) || l.subtitle.toLowerCase().includes(q) || caseNum.includes(q);
              }).map((lesson, idx) => {
                const currentResCount = responses.filter(r => r.lessonId === lesson.id).length;
                return (
                  <div key={lesson.id} className="bg-slate-900 border border-slate-800 rounded-[40px] p-7 hover:border-slate-700 transition-all group relative overflow-hidden flex flex-col shadow-lg">
                    <div className="flex justify-between items-start mb-5">
                      <span className="text-[11px] font-black bg-slate-800 text-slate-400 px-4 py-1.5 rounded-full uppercase tracking-widest">CASE #{idx + 1}</span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={()=>handleShare(lesson.id)} className="p-2 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg" title="複製此教案連結分發給同仁作答"><Share2 size={16} /></button>
                        <button onClick={()=>downloadLessonResponsesExcel(lesson.id, lesson.title)} className="p-2 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg" title="匯出同仁填寫回覆 Excel (CSV)"><Download size={16} /></button>
                        <button onClick={()=>{ setCurrentLesson(lesson); setFormData(lesson); setEditMode('refined'); setView('editor'); }} className="p-2 text-slate-500 hover:text-green-400 hover:bg-green-500/10 rounded-lg"><Edit2 size={16} /></button>
                        <button onClick={async ()=>{ if(confirm("確認要完全刪除此教案嗎？")) await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'staffs', s.id)); }} className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg"><Trash2 size={16} /></button>
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-100 mb-2 leading-snug grow">{lesson.title}</h3>
                    <p className="text-slate-500 text-xs mb-4 line-clamp-2 font-medium">{lesson.subtitle}</p>
                    <div className="text-xs text-slate-400 mb-6 font-bold bg-slate-950/50 p-3 rounded-xl border border-slate-850">同仁累計提交數：{currentResCount} 份</div>
                    <button onClick={()=>{setCurrentLesson(lesson); setView('viewer');}} className="w-full bg-slate-800 hover:bg-slate-700 text-slate-100 py-3.5 rounded-2xl font-bold text-sm transition-all shadow-md">預覽追蹤與畫面</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 🌟 完整恢復最初 教案系統.txt 的教案 AI 智慧編輯整合功能頁面 */}
        {view === 'editor' && (
          <div className="bg-slate-900 border border-slate-800 rounded-[50px] shadow-3xl p-10 md:p-14">
            {editMode === 'raw' ? (
              <div className="space-y-10">
                <div className="flex items-center gap-4 text-red-500"><div className="p-3 bg-red-500/10 rounded-2xl"><Plus size={24} /></div><h2 className="text-3xl font-black tracking-tight text-slate-100">輸入新教案素材</h2></div>
                <div className="space-y-8">
                  <div className="space-y-3">
                    <label className="text-sm font-black text-slate-400 uppercase tracking-widest ml-1">教案主要核心事件經過描述</label>
                    <textarea placeholder="請詳細敘述事件經過、發現時間點與環境背景..." className="w-full p-6 bg-slate-950 border border-slate-800 rounded-[32px] text-slate-100 min-h-[180px] outline-none focus:border-red-500/50 transition-all" value={rawInput.content} onChange={(e)=>setRawInput({...rawInput, content: e.target.value})} />
                  </div>
                  <div className="space-y-3">
                    <label className="text-sm font-black text-slate-400 uppercase tracking-widest ml-1">QA 同仁核心考核點</label>
                    <textarea placeholder="希望考考同仁針對此事件的哪些關鍵處理步驟或辨識方向..." className="w-full p-6 bg-slate-950 border border-slate-800 rounded-[32px] text-slate-100 min-h-[100px] outline-none" value={rawInput.qa} onChange={(e)=>setRawInput({...rawInput, qa: e.target.value})} />
                  </div>
                  <div className="space-y-3">
                    <label className="text-sm font-black text-slate-400 uppercase tracking-widest ml-1">科內檢討與流程改善方案</label>
                    <textarea placeholder="未來防範再發生之流程優化具體建議..." className="w-full p-6 bg-slate-950 border border-slate-800 rounded-[32px] text-slate-100 min-h-[100px] outline-none" value={rawInput.review} onChange={(e)=>setRawInput({...rawInput, review: e.target.value})} />
                  </div>
                </div>
                <button onClick={handleAISuggest} disabled={loading || !rawInput.content} className="w-full py-6 bg-red-600 text-white rounded-[32px] font-black text-xl hover:bg-red-500 disabled:bg-slate-800 transition-all shadow-xl">
                  {loading ? "AI 專家正在精細統整教案中..." : "生成結構化美編教案"}
                </button>
              </div>
            ) : (
              <div className="space-y-10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-green-500"><div className="p-3 bg-green-500/10 rounded-2xl"><Edit2 size={24} /></div><h2 className="text-3xl font-black tracking-tight text-slate-100">修正與確認 AI 所產內容</h2></div>
                  <button onClick={()=>setEditMode('raw')} className="text-xs text-slate-500 hover:text-red-500 underline uppercase font-black transition-colors">重新調整素材</button>
                </div>
                <div className="grid grid-cols-1 gap-8">
                  <div>
                    <label className="text-xs font-black text-slate-500 ml-2">教案主標題</label>
                    <input type="text" value={formData.title} onChange={(e)=>setFormData({...formData, title: e.target.value})} className="w-full p-5 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 font-bold" />
                  </div>
                  <div>
                    <label className="text-xs font-black text-slate-500 ml-2">警示副標題</label>
                    <input type="text" value={formData.subtitle} onChange={(e)=>setFormData({...formData, subtitle: e.target.value})} className="w-full p-5 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100" />
                  </div>
                  <div>
                    <label className="text-xs font-black text-slate-500 ml-2">案例詳細經過敘述</label>
                    <textarea value={formData.caseDescription} onChange={(e)=>setFormData({...formData, caseDescription: e.target.value})} className="w-full p-5 bg-slate-950 border border-slate-800 rounded-2xl text-slate-300 min-h-[150px]" />
                  </div>
                  
                  <div className="bg-slate-950 p-8 rounded-[40px] border border-slate-800 space-y-3">
                    <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest">潛在風險因子原因分析</h4>
                    {formData.dangerAnalysis.map((risk, i) => (
                      <div key={i} className="flex gap-3">
                        <input type="text" value={risk} onChange={(e)=>{
                          let r = [...formData.dangerAnalysis]; r[i] = e.target.value; setFormData({...formData, dangerAnalysis: r});
                        }} className="flex-1 bg-slate-900 border border-slate-800 p-4 rounded-xl text-sm" />
                        <button onClick={()=>{
                          let r = formData.dangerAnalysis.filter((_, idx)=>idx!==i); setFormData({...formData, dangerAnalysis: r});
                        }} className="text-slate-600 hover:text-red-400 p-2"><X size={18} /></button>
                      </div>
                    ))}
                    <button onClick={()=>setFormData({...formData, dangerAnalysis: [...formData.dangerAnalysis, "新增風險因子分析內容..."]})} className="text-xs text-slate-500 hover:text-blue-400 font-bold">+ 新增分析項目</button>
                  </div>

                  <div className="bg-red-500/5 p-8 rounded-[40px] border border-red-500/20 space-y-2">
                    <label className="text-xs font-black text-red-500 uppercase tracking-widest ml-3">3秒安全提醒 (精簡短語)</label>
                    <input type="text" value={formData.safetyTip} onChange={(e)=>setFormData({...formData, safetyTip: e.target.value})} className="w-full bg-transparent p-2 text-2xl font-black text-red-500 italic outline-none tracking-tight" />
                  </div>

                  <div className="p-8 bg-slate-950 rounded-[40px] border border-slate-800 space-y-6">
                    <h4 className="font-black text-slate-100 text-lg">多選 QA 題目與核心答案配置</h4>
                    <input type="text" value={formData.quiz.question} onChange={(e)=>setFormData({...formData, quiz: {...formData.quiz, question: e.target.value}})} className="w-full bg-slate-900 p-4 rounded-2xl border border-slate-800 font-bold" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {formData.quiz.options.map((opt, i)=>(
                        <div key={i} className={`flex gap-4 items-center p-4 rounded-2xl border ${formData.quiz.correctIndices.includes(i) ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-900 border-slate-800'}`}>
                          <input type="checkbox" className="w-6 h-6 accent-green-500" checked={formData.quiz.correctIndices.includes(i)} onChange={(e)=>{
                            let n = [...formData.quiz.correctIndices]; if(e.target.checked) n.push(i); else n = n.filter(x => x !== i);
                            setFormData({...formData, quiz: {...formData.quiz, correctIndices: n}});
                          }} />
                          <input type="text" value={opt} onChange={(e)=>{
                            let o = [...formData.quiz.options]; o[i] = e.target.value; setFormData({...formData, quiz: {...formData.quiz, options: o}});
                          }} className="flex-1 bg-transparent p-1 text-sm font-medium" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <button onClick={handleFinalSave} disabled={loading} className="w-full py-6 bg-green-600 hover:bg-green-500 text-white rounded-[32px] font-black text-xl shadow-2xl">正式發佈教案並儲存至 Firebase</button>
              </div>
            )}
          </div>
        )}
      </main>

      {copyFeedback && <div className="fixed bottom-12 left-1/2 -translate-x-1/2 bg-white text-slate-900 px-10 py-5 rounded-full shadow-2xl z-50 flex items-center gap-4 font-black"><CheckCircle2 size={24} className="text-green-600" /> 教案連結已複製</div>}
    </div>
  );
}

// 找到 LoginForm 元件，將內部替換為此段
function LoginForm({ onLogin, formatId, loginLoading }) {
  const [id, setId] = useState('');
  const [pass, setPass] = useState('');

  // 處理按下 Enter 鍵的觸發邏輯
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // 防止網頁重新整理
      onLogin(id, pass);
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-red-500/10 p-4 rounded-2xl border border-red-500/20 text-center text-sm font-bold text-red-400">
        🔒 核心管理者授權驗證中心 (本地+雲端雙軌判定)
      </div>
      <div className="space-y-4">
        <div className="relative">
          <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
          <input 
            type="text" 
            placeholder="管理/書記員編 (如 Y06100)" 
            className="w-full pl-11 pr-5 py-4 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 font-bold tracking-widest uppercase outline-none focus:border-red-500/50" 
            value={id} 
            onChange={(e)=>setId(formatId(e.target.value))} 
            onKeyDown={handleKeyDown} // 綁定 Enter 鍵監聽
          />
        </div>
        
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
          <input 
            type="text" 
            placeholder="輸入登入密碼 (初次登入自動記憶)" 
            className="w-full pl-11 pr-5 py-4 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 font-bold tracking-widest outline-none focus:border-red-500/50" 
            value={pass} 
            onChange={(e)=>setPass(e.target.value)} 
            onKeyDown={handleKeyDown} // 綁定 Enter 鍵監聽
          />
        </div>
      </div>
      <button 
        type="button"
        onClick={()=>onLogin(id, pass)} 
        disabled={loginLoading} 
        className="w-full bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-black text-lg transition-all"
      >
        {loginLoading ? "安全驗證中..." : "確認登入後台"}
      </button>
    </div>
  );
}

// 學習預覽與同仁作答元件
function LessonViewer({ lesson, staffList, defaultAdmins, responses, formatId, currentUser, onBack }) {
  const [targetId, setTargetId] = useState(currentUser || '');
  const [selectedIndices, setSelectedIndices] = useState([]);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const upperId = targetId.toUpperCase();
    if (!/^Y\d{5}$/.test(upperId)) {
      alert("❌ 員編格式填寫錯誤：請輸入大寫 Y 加上 5 位數同仁編號！");
      return;
    }

    const targetStaff = staffList.find(s => s.id === upperId) || defaultAdmins[upperId];
    if (!targetStaff) {
      alert("⚠️ 員編核對錯誤：此員編目前不在人員清單中，無法送出解答！請聯絡管理藥師協助加入名單。");
      return;
    }

    if (String(targetStaff.role) !== '1') {
      alert(`身分提示：您的角色為【${ROLE_MAP[String(targetStaff.role)]}】，依規定本系統【僅限藥師角色】需要完成教案作答與數據收集。`);
      return;
    }

    if (selectedIndices.length === 0) {
      alert("請選擇至少一個合適的選項答案進行分析！");
      return;
    }
    
    setLoading(true);
    try {
      const correctSet = new Set(lesson.quiz.correctIndices);
      const selectedSet = new Set(selectedIndices);
      
      let matchCount = 0;
      lesson.quiz.options.forEach((_, i) => {
        if (correctSet.has(i) === selectedSet.has(i)) {
          matchCount++;
        }
      });
      const accuracyRate = Math.round((matchCount / lesson.quiz.options.length) * 100);
      const isCorrect = lesson.quiz.correctIndices.sort().join(',') === [...selectedIndices].sort().join(',');
      
      await addDoc(collection(getFirestore(), 'artifacts', appId, 'public', 'data', 'responses'), {
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        employeeId: upperId, 
        selectedIndices,
        isCorrect,
        accuracyRate,
        timestamp: new Date().toISOString()
      });
      setIsSubmitted(true);
    } catch (err) {
      alert("連線不穩定，作答儲存失敗");
    } finally {
      setLoading(false);
    }
  };

  const completedIds = responses.filter(r => r.lessonId === lesson.id).map(r => r.employeeId);
  const incompletePharmacists = staffList.filter(s => String(s.role) === '1' && !completedIds.includes(s.id));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300">
      <div className="bg-[#9A0D0D] text-white p-12 rounded-b-[60px] shadow-3xl">
        <div className="max-w-2xl mx-auto">
          <span className="text-[11px] font-black tracking-[0.4em] bg-white/10 px-5 py-2 rounded-full">調劑與臨床安全個案分析</span>
          <h1 className="text-3xl font-black mt-4">{lesson.title}</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12 space-y-16">
        {currentUser && (
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-[32px] space-y-4">
            <h3 className="text-sm font-black text-red-400 flex items-center gap-2"><Users size={16}/> 尚未完成此教案之藥師名單 ({incompletePharmacists.length} 人)</h3>
            {incompletePharmacists.length === 0 ? (
              <p className="text-emerald-400 text-xs font-bold">🎉 全體臨床藥師同仁皆已完成作答！</p>
            ) : (
              <div className="flex flex-wrap gap-2 pt-2">
                {incompletePharmacists.map(s => (
                  <span key={s.id} className="bg-slate-950 text-slate-400 text-xs px-3 py-1.5 rounded-xl border border-amber-500/20 font-bold text-amber-400">
                    {s.name} ({s.id})
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <section className="bg-slate-900 border border-slate-800 rounded-[40px] p-8 space-y-6">
          <h3 className="text-red-500 font-bold text-lg leading-tight">「{lesson.subtitle}」</h3>
          <div className="text-slate-200 text-lg leading-relaxed whitespace-pre-wrap">{lesson.caseDescription}</div>
        </section>

        <section className="space-y-6">
          <h4 className="font-bold text-slate-100 text-lg">💡 {lesson.quiz.question}</h4>
          <div className="space-y-3">
            {lesson.quiz.options.map((opt, idx) => {
              const isSelected = selectedIndices.includes(idx);
              return (
                <button key={idx} disabled={isSubmitted} onClick={() => {
                  let n = [...selectedIndices]; if(n.includes(idx)) n = n.filter(x => x !== idx); else n.push(idx); setSelectedIndices(n);
                }} className={`w-full text-left p-6 rounded-3xl border-2 transition-all flex justify-between items-center ${isSelected ? 'border-blue-600 bg-blue-600/5 text-blue-400' : 'border-slate-900 bg-slate-900/40'}`}>
                  <span className="font-bold">{opt}</span>
                </button>
              );
            })}
          </div>

          {!isSubmitted ? (
            <div className="pt-6 space-y-4">
              {!currentUser && (
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400">請輸入您的醫院身分員編 (英文字母 Y 將會自動轉為大寫核對)</label>
                  <input type="text" placeholder="請填寫例如 Y12345" value={targetId} onChange={(e)=>setTargetId(formatId(e.target.value))} className="w-full p-4 bg-slate-900 border border-slate-800 rounded-2xl text-slate-100 font-bold text-center tracking-widest uppercase" />
                </div>
              )}
              <button onClick={handleSubmit} disabled={loading} className="w-full bg-slate-100 text-slate-950 py-5 rounded-3xl font-black text-xl">
                {loading ? "進度資格安全核對中..." : "送出並解鎖風險案例剖析"}
              </button>
            </div>
          ) : (
            <div className="space-y-8 animate-in fade-in">
              <div className="bg-slate-900 border border-slate-800 p-8 rounded-[40px] space-y-4">
                <h3 className="text-emerald-400 font-bold text-xl">🎯 本案核心風險防範分析</h3>
                <div className="space-y-2">
                  {lesson.dangerAnalysis.map((item, i) => (
                    <p key={i} className="text-slate-300 text-md font-medium">• {item}</p>
                  ))}
                </div>
              </div>
              <div className="bg-blue-700 text-white p-8 rounded-[32px] text-center text-2xl font-black">「{lesson.safetyTip}」</div>
              <button onClick={onBack} className="w-full py-4 text-slate-500 font-bold underline">返回清單</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
