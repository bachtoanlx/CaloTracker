// --- 1. CẤU HÌNH FIREBASE ---
// Vào console.firebase.google.com -> Tạo project -> Project Settings -> General -> Web (</>)
const firebaseConfig = {
  apiKey: "AIzaSyDBXaQR4XVGZRrHOoc70to_W2qC4ZaPCqw",
  authDomain: "kcaltracker-ai.firebaseapp.com",
  projectId: "kcaltracker-ai",
  storageBucket: "kcaltracker-ai.firebasestorage.app",
  messagingSenderId: "723091636126",
  appId: "1:723091636126:web:9a26e314ecff1577a9a08f"
};
// Khởi tạo Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// --- 3. BIẾN TOÀN CỤC ---
let userId = null; // Sẽ được gán khi đăng nhập thành công

let currentUser = {
    weight: 60, height: 165, age: 25, gender: 'male', activity: 1.2, tdee: 2000, waist: 75
};
let todayLog = [];
let todayActivityLog = [];
let weightChartInstance = null; // Biến lưu instance biểu đồ để update
let isRegisterMode = false; // Trạng thái đang ở màn hình Đăng ký hay Đăng nhập
let isSubmitting = false; // Cờ chống spam click

// --- 4. KHỞI TẠO ---
document.addEventListener('DOMContentLoaded', async () => {
    setupFoodSuggestions();
    // Lắng nghe trạng thái đăng nhập
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // Đã đăng nhập
            userId = user.uid;
            document.getElementById('auth-view').classList.add('hidden');
            document.getElementById('app-view').classList.remove('hidden');
            document.getElementById('app-view').style.display = 'flex'; // Khôi phục flex layout
            
            showNotification(`Xin chào, ${user.email}`);
            
            // Tải dữ liệu
            await loadSettings(); // Chờ tải cấu hình mới nhất từ Server
            await Promise.all([loadTodayLog(), loadTodayActivityLog()]);
            updateUI();
        } else {
            // Chưa đăng nhập
            userId = null;
            document.getElementById('auth-view').classList.remove('hidden');
            document.getElementById('app-view').classList.add('hidden');
            document.getElementById('app-view').style.display = 'none';
        }
    });
});

// --- HÀM TIỆN ÍCH: CHỐNG XSS ---
function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- HÀM TIỆN ÍCH: LẤY NGÀY GIỜ ĐỊA PHƯƠNG (Fix lỗi mất dữ liệu sáng sớm) ---
function getLocalDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- 4.1 AUTH LOGIC ---
function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('btn-auth-action');
    const switchText = document.getElementById('auth-switch-text');
    const errorMsg = document.getElementById('auth-error');

    errorMsg.style.display = 'none';

    if (isRegisterMode) {
        title.innerText = "Đăng ký tài khoản mới";
        btn.innerText = "Đăng ký";
        btn.onclick = handleRegister;
        switchText.innerText = "Đã có tài khoản?";
    } else {
        title.innerText = "Đăng nhập";
        btn.innerText = "Đăng nhập";
        btn.onclick = handleLogin;
        switchText.innerText = "Chưa có tài khoản?";
    }
}

async function handleLogin() {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-password').value;
    const errorMsg = document.getElementById('auth-error');

    try {
        await auth.signInWithEmailAndPassword(email, pass);
        // onAuthStateChanged sẽ tự xử lý chuyển trang
    } catch (error) {
        console.error(error);
        errorMsg.innerText = "Lỗi: " + error.message;
        errorMsg.style.display = 'block';
    }
}

async function handleRegister() {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-password').value;
    const errorMsg = document.getElementById('auth-error');

    try {
        await auth.createUserWithEmailAndPassword(email, pass);
        // onAuthStateChanged sẽ tự xử lý chuyển trang
    } catch (error) {
        console.error(error);
        errorMsg.innerText = "Lỗi: " + error.message;
        errorMsg.style.display = 'block';
    }
}

function handleLogout() {
    auth.signOut();
    showNotification("Đã đăng xuất", "warning");
}

// --- 5. CHỨC NĂNG ĐIỀU HƯỚNG ---
function switchTab(tabId) {
    // Ẩn tất cả tab
    document.querySelectorAll('section').forEach(s => s.classList.remove('active-tab'));
    // Hiện tab được chọn
    document.getElementById(tabId).classList.add('active-tab');
    
    // Đổi màu nút menu
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');

    if(tabId === 'tab-history') loadHistory();
    if(tabId === 'tab-charts') loadCharts();
}

// --- 6. CÀI ĐẶT & TÍNH TDEE ---
async function saveSettings() {
    currentUser.weight = parseFloat(document.getElementById('set-weight').value) || 60;
    currentUser.height = parseFloat(document.getElementById('set-height').value) || 165;
    currentUser.waist = parseFloat(document.getElementById('set-waist').value) || 75;
    currentUser.age = parseFloat(document.getElementById('set-age').value) || 25;
    currentUser.gender = document.getElementById('set-gender').value;
    currentUser.activity = parseFloat(document.getElementById('set-activity').value);

    // Công thức Mifflin-St Jeor tính BMR
    let bmr = (10 * currentUser.weight) + (6.25 * currentUser.height) - (5 * currentUser.age);
    bmr += (currentUser.gender === 'male') ? 5 : -161;
    
    // Tính TDEE (Total Daily Energy Expenditure)
    currentUser.tdee = Math.round(bmr * currentUser.activity);
    
    localStorage.setItem('user_settings', JSON.stringify(currentUser));

    // --- LƯU LỊCH SỬ CƠ THỂ VÀO FIREBASE ---
    // Dùng ID là ngày hiện tại để mỗi ngày chỉ lưu 1 bản ghi (ghi đè nếu cập nhật nhiều lần trong ngày)
    const dateInput = document.getElementById('set-date').value;
    const logDate = dateInput ? dateInput : getLocalDateString();
    const docId = `${userId}_${logDate}`;
    
    await db.collection('body_logs').doc(docId).set({
        userId: userId,
        date: logDate,
        weight: currentUser.weight,
        waist: currentUser.waist,
        timestamp: new Date()
    }).catch(e => console.error("Lỗi lưu body log:", e));

    // --- MỚI: LƯU PROFILE NGƯỜI DÙNG ĐỂ ĐỒNG BỘ ---
    await db.collection('users').doc(userId).set(currentUser).catch(e => console.error("Lỗi lưu profile:", e));

    alert(`Đã lưu! Nhu cầu calo hàng ngày của bạn là: ${currentUser.tdee} kcal`);
    updateUI();
}

async function loadSettings() {
    // Ưu tiên lấy từ Firestore nếu có, nếu không lấy localStorage (để migrate dữ liệu cũ nếu cần)
    // Ở đây ta làm đơn giản: Lấy từ localStorage trước, nhưng thực tế nên lưu settings lên Firestore user profile
    
    // 1. Lấy từ LocalStorage (Hiển thị ngay lập tức để app nhanh)
    const saved = localStorage.getItem('user_settings');
    if (saved) {
        currentUser = JSON.parse(saved);
        updateSettingsForm();
    }

    // 2. Lấy dữ liệu MỚI NHẤT từ Firebase (Ghi đè dữ liệu cũ)
    if (userId) {
        try {
            // Cách 1: Lấy từ User Profile (nếu đã lưu cấu hình đầy đủ)
            const userDoc = await db.collection('users').doc(userId).get();
            
            if (userDoc.exists) {
                const data = userDoc.data();
                currentUser = { ...currentUser, ...data };
                localStorage.setItem('user_settings', JSON.stringify(currentUser));
                updateSettingsForm();
            } else {
                // Cách 2: Nếu chưa có Profile, lấy Weight/Waist từ lịch sử body_logs MỚI NHẤT
                const latestLog = await db.collection('body_logs')
                    .where('userId', '==', userId)
                    .orderBy('date', 'desc')
                    .limit(1)
                    .get();
                
                if (!latestLog.empty) {
                    const logData = latestLog.docs[0].data();
                    currentUser.weight = logData.weight;
                    if (logData.waist) currentUser.waist = logData.waist;
                    
                    // Tính lại TDEE vì cân nặng thay đổi
                    let bmr = (10 * currentUser.weight) + (6.25 * currentUser.height) - (5 * currentUser.age);
                    bmr += (currentUser.gender === 'male') ? 5 : -161;
                    currentUser.tdee = Math.round(bmr * currentUser.activity);

                    localStorage.setItem('user_settings', JSON.stringify(currentUser));
                    updateSettingsForm();
                }
            }
        } catch (e) {
            console.error("Lỗi đồng bộ settings:", e);
        }
    }

    // Mặc định chọn ngày hôm nay
    const dateInput = document.getElementById('set-date');
    if(dateInput) dateInput.value = getLocalDateString();
}

function updateSettingsForm() {
    document.getElementById('set-weight').value = currentUser.weight;
    document.getElementById('set-height').value = currentUser.height;
    document.getElementById('set-waist').value = currentUser.waist || 75;
    document.getElementById('set-age').value = currentUser.age;
    document.getElementById('set-gender').value = currentUser.gender;
    document.getElementById('set-activity').value = currentUser.activity;
}

// --- 7. TÌM KIẾM & THÊM THỨC ĂN ---
function setupFoodSuggestions() {
    const input = document.getElementById('food-name');
    const box = document.getElementById('food-suggestions');
    
    // Hàm debounce để tránh gọi API quá nhiều khi gõ
    const debounce = (func, delay) => {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => func.apply(this, args), delay);
        };
    };

    input.addEventListener('input', debounce(async (e) => {
        const val = e.target.value.toLowerCase().trim();
        if (val.length < 2) { // Chỉ tìm khi gõ trên 2 ký tự
            box.classList.add('hidden');
            return;
        }

        try {
            // Tìm kiếm prefix (bắt đầu bằng...) trong Firestore
            const snapshot = await db.collection('foods')
                .orderBy('name')
                .startAt(val)
                .endAt(val + '\uf8ff')
                .limit(5)
                .get();

            box.innerHTML = '';
            if (snapshot.empty) {
                box.classList.add('hidden');
                return;
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                const li = document.createElement('li');
                li.innerText = data.name;
                li.onclick = () => {
                    input.value = data.name;
                    box.classList.add('hidden');
                    searchFood(); // Tự động chọn và kích hoạt tìm kiếm
                };
                box.appendChild(li);
            });
            box.classList.remove('hidden');
        } catch (err) {
            console.error("Lỗi gợi ý món ăn:", err);
        }
    }, 300));

    // Ẩn gợi ý khi click ra ngoài
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !box.contains(e.target)) {
            box.classList.add('hidden');
        }
    });
}

async function searchFood() {
    const query = document.getElementById('food-name').value.toLowerCase().trim();
    if (!query) return;

    // Reset thông báo ước tính mỗi lần tìm mới
    document.getElementById('auto-estimate-msg').classList.add('hidden');

    // Tìm trong Firebase 'foods' collection
    // Lưu ý: Cần tạo index hoặc dùng query đơn giản
    const foodsRef = db.collection('foods');
    
    try {
        const snapshot = await foodsRef.where('name', '==', query).get();
        
        document.getElementById('food-result').classList.remove('hidden');
        document.getElementById('res-name').innerText = query;

        const msgElement = document.getElementById('auto-estimate-msg');

        if (!snapshot.empty) {
            // Đã có trong DB
            const foodData = snapshot.docs[0].data();
            document.getElementById('res-kcal-unit').value = foodData.kcalPer100g;

            // Hiển thị thông báo "Đã chuẩn hóa" (Màu xanh)
            msgElement.innerHTML = '<i class="fas fa-users"></i> Dữ liệu cộng đồng. <span style="font-weight:normal; color:#777;">(Bạn có thể sửa lại)</span>';
            msgElement.style.color = '#4CAF50';
            msgElement.classList.remove('hidden');
        } else {
            // Chưa có trong DB -> Dùng thuật toán từ khóa để ước tính
            const estimatedKcal = estimateCaloriesByKeywords(query);
            document.getElementById('res-kcal-unit').value = estimatedKcal;
            
            // Hiển thị dòng thông báo "Ước tính tự động" (Màu cam)
            msgElement.innerHTML = '<i class="fas fa-magic"></i> Ước tính tự động';
            msgElement.style.color = '#f57c00';
            msgElement.classList.remove('hidden');
        }
    } catch (error) {
        console.error("Lỗi tìm kiếm:", error);
        showNotification("Lỗi kết nối database", "warning");
    }
}

// Hàm ước tính Calo dựa trên từ khóa (Heuristic)
function estimateCaloriesByKeywords(name) {
    const n = name.toLowerCase();
    
    // Nhóm nhiều dầu mỡ
    if (n.includes('chiên') || n.includes('rán') || n.includes('quay') || n.includes('mỡ')) return 300;
    if (n.includes('xào')) return 220;
    if (n.includes('sốt') || n.includes('kho') || n.includes('rim')) return 180;
    
    // Nhóm tinh bột
    if (n.includes('cơm') || n.includes('xôi') || n.includes('bánh mì')) return 200;
    if (n.includes('bún') || n.includes('phở') || n.includes('mì')) return 150;
    
    // Nhóm thanh đạm
    if (n.includes('luộc') || n.includes('hấp') || n.includes('canh')) return 60;
    if (n.includes('salad') || n.includes('nộm') || n.includes('rau')) return 40;
    
    // Mặc định trung bình nếu không rõ
    return 150; 
}

async function addFoodToLog() {
    if (isSubmitting) return; // Chống spam click

    const name = document.getElementById('res-name').innerText;
    const kcalUnit = parseFloat(document.getElementById('res-kcal-unit').value);
    const weight = parseFloat(document.getElementById('res-weight').value);

    if (!name || isNaN(kcalUnit) || isNaN(weight)) {
        showNotification("Vui lòng nhập đủ thông tin", "warning");
        return;
    }

    isSubmitting = true; // Bắt đầu xử lý

    const totalKcal = Math.round((kcalUnit * weight) / 100);
    const newItem = {
        name: name,
        kcalUnit: kcalUnit,
        weight: weight,
        totalKcal: totalKcal,
        timestamp: new Date()
    };

    // 1. Lưu vào mảng local để hiển thị ngay
    todayLog.push(newItem);
    
    // 2. SỬA LẠI: Chỉ tạo (create) món ăn mới, không ghi đè (update) để bảo vệ dữ liệu chung
    const foodRef = db.collection('foods').doc(name);
    let foodPromise = Promise.resolve(); // Tạo một promise rỗng

    try {
        const foodDoc = await foodRef.get();
        if (!foodDoc.exists) {
            // Chỉ ghi khi món ăn chưa tồn tại, tương thích với security rule "allow create"
            foodPromise = foodRef.set({
                name: name,
                kcalPer100g: kcalUnit
            });
        }
    } catch (e) { console.error("Lỗi kiểm tra food:", e); }

    // 3. Lưu log vào DB 'logs'
    const todayStr = getLocalDateString();
    const logPromise = db.collection('logs').add({
        userId: userId,
        date: todayStr,
        ...newItem
    });

    await Promise.all([foodPromise, logPromise]);

    // Reset UI
    document.getElementById('food-name').value = '';
    document.getElementById('food-result').classList.add('hidden');
    document.getElementById('auto-estimate-msg').classList.add('hidden'); // Ẩn thông báo nếu có
    updateUI();
    isSubmitting = false; // Hoàn tất, cho phép click lại
}

// Hàm lấy hệ số Kcal/phút dựa trên từ khóa (để gợi ý)
function getKcalPerMinute(name) {
    const n = name.toLowerCase();
    let kpm = 5; // Kcal per minute mặc định (trung bình)

    // Nhóm vận động nặng (High intensity)
    if (n.includes('chạy') || n.includes('bơi') || n.includes('bóng đá') || n.includes('hiit') || n.includes('nhảy dây')) {
        kpm = 10;
    }
    // Nhóm vận động vừa (Moderate)
    else if (n.includes('gym') || n.includes('tạ') || n.includes('đạp xe') || n.includes('cầu lông')) {
        kpm = 7;
    }
    // Nhóm nhẹ (Low intensity)
    else if (n.includes('đi bộ') || n.includes('yoga') || n.includes('giãn cơ')) {
        kpm = 3.5;
    }
    return kpm;
}

// Tự động điền Kcal/30p khi nhập tên hoạt động
function suggestActivityRate() {
    const name = document.getElementById('activity-name').value;
    const kpm = getKcalPerMinute(name);
    // Quy đổi ra Kcal/30 phút để người dùng dễ hình dung
    document.getElementById('activity-rate').value = Math.round(kpm * 30);
    previewActivityKcal();
}

// --- 7.6 PREVIEW CALO VẬN ĐỘNG ---
function previewActivityKcal() {
    const duration = parseFloat(document.getElementById('activity-duration').value);
    const rate30 = parseFloat(document.getElementById('activity-rate').value); // Lấy từ ô nhập
    const msg = document.getElementById('activity-est-msg');
    
    if (!isNaN(duration) && duration > 0 && !isNaN(rate30)) {
        // Công thức: (Kcal_per_30 / 30) * duration
        const burned = Math.round((rate30 / 30) * duration);
        document.getElementById('preview-burned').innerText = burned;
        msg.classList.remove('hidden');
    } else {
        msg.classList.add('hidden');
    }
}

// --- 7.5 THÊM VẬN ĐỘNG ---
async function addActivityToLog() {
    const name = document.getElementById('activity-name').value.trim();
    const duration = parseFloat(document.getElementById('activity-duration').value);
    const rate30 = parseFloat(document.getElementById('activity-rate').value);

    if (!name || isNaN(duration) || duration <= 0 || isNaN(rate30)) {
        showNotification("Vui lòng nhập đủ thông tin", "warning");
        return;
    }

    if (isSubmitting) return; // Chống spam click

    isSubmitting = true; // Bắt đầu xử lý

    // Tính toán dựa trên con số người dùng đã chốt (rate30)
    const burnedKcal = Math.round((rate30 / 30) * duration);
    // Đã hiển thị ở preview, không cần alert nữa

    const newItem = {
        name: name,
        duration: duration,
        burnedKcal: burnedKcal,
        timestamp: new Date()
    };

    // 1. Thêm vào mảng local
    todayActivityLog.push(newItem);

    // 2. Lưu vào Firebase collection 'activity_logs'
    const todayStr = getLocalDateString();
    await db.collection('activity_logs').add({
        userId: userId,
        date: todayStr,
        ...newItem
    }).catch(e => console.error("Lỗi lưu activity log:", e));

    // 3. Reset và cập nhật UI
    document.getElementById('activity-name').value = '';
    document.getElementById('activity-duration').value = '';
    document.getElementById('activity-rate').value = '';
    document.getElementById('activity-est-msg').classList.add('hidden'); // Ẩn thông báo sau khi thêm
    updateUI();
    isSubmitting = false; // Hoàn tất, cho phép click lại
}

// --- 8. CẬP NHẬT GIAO DIỆN ---
function updateUI() {
    let totalConsumed = 0;
    let totalBurned = 0;
    let combinedItems = [];

    // 1. Tổng hợp dữ liệu Ăn uống
    todayLog.forEach(item => {
        totalConsumed += item.totalKcal;
        combinedItems.push({ ...item, type: 'food' });
    });

    // 2. Tổng hợp dữ liệu Vận động
    todayActivityLog.forEach(item => {
        totalBurned += item.burnedKcal;
        combinedItems.push({ ...item, type: 'activity' });
    });

    // 3. Render danh sách tổng hợp "Hôm nay thế nào?"
    const list = document.getElementById('today-list');
    list.innerHTML = '';
    
    // Sắp xếp theo thời gian (Cũ -> Mới)
    combinedItems.sort((a, b) => {
        const tA = a.timestamp.seconds ? a.timestamp.seconds * 1000 : new Date(a.timestamp).getTime();
        const tB = b.timestamp.seconds ? b.timestamp.seconds * 1000 : new Date(b.timestamp).getTime();
        return tA - tB;
    });

    combinedItems.forEach(item => {
        let timeStr = '';
        if (item.timestamp) {
            const d = item.timestamp.seconds ? new Date(item.timestamp.seconds * 1000) : new Date(item.timestamp);
            timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        }
        const safeName = escapeHtml(item.name);
        const li = document.createElement('li');
        li.style.cursor = 'pointer'; // Thêm con trỏ tay để biết click được
        
        if (item.type === 'food') {
            li.innerHTML = `
                <span><small style="color:#999; margin-right:4px">${timeStr}</small> ${safeName} <small>(${item.weight}g)</small></span>
                <b style="color:var(--primary-dark)">+${item.totalKcal} kcal</b>
            `;
        } else {
            li.innerHTML = `
                <span><small style="color:#999; margin-right:4px">${timeStr}</small> ${safeName} <small>(${item.duration}p)</small></span>
                <b style="color: #e53935;">-${item.burnedKcal} kcal</b>
            `;
        }
        
        // Thêm sự kiện click để mở modal sửa
        // Lưu ý: item.id phải được lấy từ lúc load dữ liệu (xem phần sửa đổi loadTodayLog bên dưới)
        li.onclick = () => openEditModal(item.id, item.type);
        
        list.appendChild(li);
    });

    // Tính toán lại lượng calo còn lại
    const remaining = currentUser.tdee - totalConsumed + totalBurned;
    
    document.getElementById('target-kcal').innerText = currentUser.tdee + " kcal";
    document.getElementById('consumed-kcal').innerText = totalConsumed;
    document.getElementById('burned-kcal').innerText = totalBurned; // Hiển thị calo đã đốt
    document.getElementById('remaining-kcal').innerText = remaining;

    // --- TÍNH TOÁN CHỈ SỐ SỨC KHỎE (BMI, BMR, WHtR) ---
    // 1. BMI = Cân nặng (kg) / (Chiều cao (m))^2
    const heightM = currentUser.height / 100;
    const bmi = (currentUser.weight / (heightM * heightM)).toFixed(1);
    // 2. BMR (Tính lại để hiển thị)
    let bmr = (10 * currentUser.weight) + (6.25 * currentUser.height) - (5 * currentUser.age);
    bmr += (currentUser.gender === 'male') ? 5 : -161;
    // 3. WHtR = Vòng eo (cm) / Chiều cao (cm)
    const whtr = ((currentUser.waist || 75) / currentUser.height).toFixed(2);

    document.getElementById('disp-bmi').innerText = bmi;
    document.getElementById('disp-bmr').innerText = Math.round(bmr);
    document.getElementById('disp-whtr').innerText = whtr;
    
    // Đổi màu vòng tròn cảnh báo
    const circle = document.querySelector('.circle-progress');
    const netConsumed = totalConsumed - totalBurned;
    if (netConsumed > currentUser.tdee) {
        circle.style.borderTopColor = '#e53935'; // Màu đỏ
        document.getElementById('remaining-kcal').innerText = "Vượt " + Math.abs(remaining);
    } else {
        circle.style.borderTopColor = '#4CAF50'; // Màu xanh
    }
}

// --- 8.1 LOGIC CHỈNH SỬA & XÓA (MỚI) ---
function openEditModal(id, type) {
    const modal = document.getElementById('edit-modal');
    const nameEl = document.getElementById('edit-item-name');
    const qtyEl = document.getElementById('edit-quantity');
    const labelEl = document.getElementById('edit-label');
    
    // Tìm item trong mảng local
    let item;
    if (type === 'food') {
        item = todayLog.find(i => i.id === id);
        labelEl.innerText = "Khối lượng (g):";
        qtyEl.value = item.weight;
    } else {
        item = todayActivityLog.find(i => i.id === id);
        labelEl.innerText = "Thời gian (phút):";
        qtyEl.value = item.duration;
    }

    if (!item) return; // Không tìm thấy

    nameEl.innerText = item.name;
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-type').value = type;
    
    modal.classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
}

async function saveEditItem() {
    const id = document.getElementById('edit-id').value;
    const type = document.getElementById('edit-type').value;
    const newQty = parseFloat(document.getElementById('edit-quantity').value);

    if (isNaN(newQty) || newQty <= 0) {
        showNotification("Số lượng không hợp lệ", "warning");
        return;
    }

    closeEditModal();
    showNotification("Đang cập nhật...", "warning");

    if (type === 'food') {
        const item = todayLog.find(i => i.id === id);
        // Tính lại calo: (Kcal cũ / Weight cũ) * Weight mới
        // Hoặc chính xác hơn: (kcalUnit * newWeight) / 100
        const newTotal = Math.round((item.kcalUnit * newQty) / 100);
        
        await db.collection('logs').doc(id).update({
            weight: newQty,
            totalKcal: newTotal
        });
        await loadTodayLog(); // Tải lại để cập nhật UI
    } else {
        const item = todayActivityLog.find(i => i.id === id);
        // Tính lại calo đốt: (Burned cũ / Duration cũ) * Duration mới
        const ratePerMin = item.burnedKcal / item.duration;
        const newBurned = Math.round(ratePerMin * newQty);

        await db.collection('activity_logs').doc(id).update({
            duration: newQty,
            burnedKcal: newBurned
        });
        await loadTodayActivityLog();
    }
    updateUI();
    showNotification("Đã cập nhật thành công!");
}

let deleteTimer = null; // Biến đếm giờ cho nút xóa

async function deleteItem() {
    // Thay thế confirm() bằng logic bấm 2 lần để xóa
    const btn = event.target; // Lấy nút đang được bấm
    
    if (btn.innerText !== "Xác nhận xóa?") {
        // Lần bấm 1: Đổi text nút để hỏi lại
        const originalText = btn.innerText;
        btn.innerText = "Xác nhận xóa?";
        btn.style.background = "#b71c1c"; // Đổi màu đỏ đậm hơn
        
        // Nếu không bấm tiếp trong 3s thì reset lại
        deleteTimer = setTimeout(() => {
            btn.innerText = originalText;
            btn.style.background = "#e53935";
        }, 3000);
        return; // Dừng lại, chờ bấm lần 2
    }
    
    // Lần bấm 2: Thực hiện xóa thật
    if (deleteTimer) clearTimeout(deleteTimer);
    
    const id = document.getElementById('edit-id').value;
    const type = document.getElementById('edit-type').value;
    const collection = (type === 'food') ? 'logs' : 'activity_logs';

    closeEditModal();
    
    try {
        await db.collection(collection).doc(id).delete();
        
        // Xóa khỏi mảng local để UI cập nhật nhanh
        if (type === 'food') {
            todayLog = todayLog.filter(i => i.id !== id);
        } else {
            todayActivityLog = todayActivityLog.filter(i => i.id !== id);
        }
        updateUI();
        showNotification("Đã xóa mục đã chọn");
    } catch (e) {
        console.error(e);
        showNotification("Lỗi khi xóa: " + e.message, "warning");
    }
}

// --- 8.2 MODAL HƯỚNG DẪN ---
function openGuideModal() {
    document.getElementById('guide-modal').classList.remove('hidden');
}

function closeGuideModal() {
    document.getElementById('guide-modal').classList.add('hidden');
}

// --- 9. TẢI DỮ LIỆU TỪ FIREBASE ---
async function loadTodayLog() {
    try {
        const todayStr = getLocalDateString();
        // Query logs của user trong ngày hôm nay
        const snapshot = await db.collection('logs')
            .where('userId', '==', userId)
            .where('date', '==', todayStr)
            .get();
        
        todayLog = [];
        snapshot.forEach(doc => {
            // QUAN TRỌNG: Lưu thêm ID để sửa/xóa
            todayLog.push({ id: doc.id, ...doc.data() });
        });
        updateUI();
    } catch (error) {
        console.error("Lỗi tải nhật ký ăn uống:", error);
    }
}

async function loadTodayActivityLog() {
    try {
        const todayStr = getLocalDateString();
        const snapshot = await db.collection('activity_logs')
            .where('userId', '==', userId)
            .where('date', '==', todayStr)
            .get();
        
        todayActivityLog = [];
        snapshot.forEach(doc => {
            todayActivityLog.push({ id: doc.id, ...doc.data() });
        });
        // updateUI() sẽ được gọi sau khi hàm này và loadTodayLog() hoàn tất
    } catch (error) {
        console.error("Lỗi tải nhật ký vận động:", error);
    }
}

async function loadHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = '<li style="justify-content:center; color:#666;">Đang tải dữ liệu...</li>';
    
    try {
        // 1. Lấy dữ liệu Ăn uống (Logs)
        const logsPromise = db.collection('logs')
            .where('userId', '==', userId)
            .orderBy('timestamp', 'desc')
            .limit(30)
            .get();

        // 2. Lấy dữ liệu Vận động (Activity Logs)
        const activityPromise = db.collection('activity_logs')
            .where('userId', '==', userId)
            .orderBy('timestamp', 'desc')
            .limit(30)
            .get();

        const [logsSnapshot, activitySnapshot] = await Promise.all([logsPromise, activityPromise]);

        // 3. Gộp dữ liệu
        let items = [];
        logsSnapshot.forEach(doc => items.push({ type: 'food', ...doc.data() }));
        activitySnapshot.forEach(doc => items.push({ type: 'activity', ...doc.data() }));

        // 4. Sắp xếp theo thời gian giảm dần
        items.sort((a, b) => {
            const tA = a.timestamp.seconds ? a.timestamp.seconds : new Date(a.timestamp).getTime() / 1000;
            const tB = b.timestamp.seconds ? b.timestamp.seconds : new Date(b.timestamp).getTime() / 1000;
            return tB - tA;
        });

        list.innerHTML = '';
        if (items.length === 0) {
            list.innerHTML = '<li style="justify-content:center">Chưa có lịch sử.</li>';
            return;
        }

        // 5. Hiển thị và Nhóm theo ngày
        let currentDateStr = '';
        items.forEach(item => {
            const dateObj = item.timestamp.seconds ? new Date(item.timestamp.seconds * 1000) : new Date(item.timestamp);
            const dateStr = dateObj.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
            const timeStr = dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

            if (dateStr !== currentDateStr) {
                currentDateStr = dateStr;
                const dateLi = document.createElement('li');
                dateLi.style.cssText = 'background:#f0f2f5; font-weight:bold; color:#555; justify-content:center; font-size:13px;';
                dateLi.innerText = dateStr;
                list.appendChild(dateLi);
            }

            const safeName = escapeHtml(item.name);
            const li = document.createElement('li');
            if (item.type === 'food') {
                li.innerHTML = `<span><small style="color:#999; margin-right:5px">${timeStr}</small> ${safeName} <small>(${item.weight}g)</small></span><b style="color:var(--primary-dark)">+${item.totalKcal}</b>`;
            } else {
                li.innerHTML = `<span><small style="color:#999; margin-right:5px">${timeStr}</small> ${safeName} <small>(${item.duration}p)</small></span><b style="color:#e53935">-${item.burnedKcal}</b>`;
            }
            list.appendChild(li);
        });
    } catch (e) {
        console.error("Lỗi tải lịch sử:", e);
        list.innerHTML = `<li style="color:red; text-align:center; flex-direction:column;">Lỗi tải dữ liệu.<small>${e.message}</small></li>`;
        if (e.message.includes("index")) {
            showNotification("Cần tạo Index trên Firebase", "warning");
        }
    }
}

// --- 11. BIỂU ĐỒ THEO DÕI ---
async function loadCharts() {
    try {
        // Lấy dữ liệu body_logs của user
        // Sửa đổi: Lấy 30 bản ghi MỚI NHẤT (desc) thay vì cũ nhất
        const snapshot = await db.collection('body_logs')
            .where('userId', '==', userId)
            .orderBy('date', 'desc') 
            .limit(30) // Lấy 30 ngày gần nhất
            .get();

        const labels = [];
        const dataWeight = [];
        const dataWaist = [];
        
        // Đảo ngược lại danh sách (từ Cũ -> Mới) để vẽ biểu đồ theo dòng thời gian
        const docs = snapshot.docs.reverse();

        docs.forEach(doc => {
            const d = doc.data();
            // Format ngày ngắn gọn (vd: 20/10)
            const dateParts = d.date.split('-');
            labels.push(`${dateParts[2]}/${dateParts[1]}`);
            dataWeight.push(d.weight);
            dataWaist.push(d.waist || null); // Lấy thêm vòng eo
        });

        renderChart(labels, dataWeight, dataWaist);

    } catch (error) {
        console.error("Lỗi tải biểu đồ:", error);
        if (error.message.includes("index")) {
            showNotification("Cần tạo Index cho biểu đồ", "warning");
        }
    }
}

function renderChart(labels, dataWeight, dataWaist) {
    const ctx = document.getElementById('weightChart').getContext('2d');

    // Hủy biểu đồ cũ nếu tồn tại để tránh lỗi hiển thị chồng chéo
    if (weightChartInstance) {
        weightChartInstance.destroy();
    }

    weightChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Cân nặng (kg)',
                data: dataWeight,
                borderColor: '#4CAF50',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                borderWidth: 2,
                tension: 0.3, // Làm mềm đường cong
                fill: true,
                yAxisID: 'y'
            },
            {
                label: 'Vòng eo (cm)',
                data: dataWaist,
                borderColor: '#FF9800', // Màu cam
                backgroundColor: 'rgba(255, 152, 0, 0.1)',
                borderWidth: 2,
                borderDash: [5, 5], // Nét đứt để phân biệt
                tension: 0.3,
                fill: false,
                yAxisID: 'y1'
            }]
        },
        options: {
            responsive: true,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: true, text: 'Cân nặng (kg)' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false }, // Ẩn lưới ngang của trục phải cho đỡ rối
                    title: { display: true, text: 'Vòng eo (cm)' }
                }
            }
        }
    });
}

// --- 10. HÀM HIỂN THỊ THÔNG BÁO (TOAST) ---
function showNotification(message, type = 'success') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Chọn icon dựa trên loại thông báo
    let icon = type === 'warning' ? '<i class="fas fa-exclamation-triangle" style="color:#FF9800"></i>' : '<i class="fas fa-check-circle" style="color:#4CAF50"></i>';
    
    toast.innerHTML = `${icon} <div>${message}</div>`;
    container.appendChild(toast);

    // Tự động xóa khỏi DOM sau 5s (khớp với animation CSS)
    setTimeout(() => { toast.remove(); }, 5000);
}
