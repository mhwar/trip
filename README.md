# 🇰🇷 Korea Trip Planner (كوريا)

خطاط رحلة كوريا الجنوبية التفاعلي - **14-24 مايو 2026**

## ✨ الميزات
- 📅 جدول يومي تفاعلي (11 يوم)
- 📍 مكتبة مواقع (~100 موقع)
- 📋 مهام التجهيز (40+ مهمة)
- 🗺️ خريطة تفاعلية
- 💰 تتبع الميزانية
- 🏨 دليل الفنادق Grand Tier
- ℹ️ معلومات السفر والعبارات الكورية

## 🚀 التشغيل
1. ارفع `korea-trip.html` على [Netlify Drop](https://app.netlify.com/drop)
2. أو افتح من خادم محلي: `python3 -m http.server`
3. ⚠️ لا تفتح مباشرة بـ `file://` (Safari يمنع بعض الميزات)

## 📁 هيكل الملفات
```
korea-trip.html     ← الملف الرئيسي (كل شيء بداخله)
src/
  p1.html           ← HTML base
  p2.html           ← CSS
  p3.html           ← HTML body
  p4.html           ← Data (TYPES, LIB, TASKS)
  p5.html           ← Core JS
  p6.html           ← Modals & Picker
  p7.html           ← Sections (Library, Map, Budget, Info)
```

## 🛠️ التطوير
عدّل الـsrc files ثم ادمجها:
```bash
cat src/p*.html > korea-trip.html
```

## 📋 تذكرة السفر
- رقم المرجع: **9T7ZEZ** (Etihad)
- EY822: أبوظبي 21:10 → سيول ICN 10:50 (14 مايو)
- EY823: سيول ICN 17:50 → أبوظبي 22:35 (24 مايو)
