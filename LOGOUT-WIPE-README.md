# أيقونة تسجيل الخروج في سطح المكتب (My PC)

انسخ فوق المشروع (نفس المسارات). مفيش تغيير في الـ API.

الأيقونة موجودة في: الـ Dock (جنب البوابة) • أيقونات سطح المكتب • لوحة التطبيقات (+ زرار في الفوتر) • Run (logout / تسجيل الخروج) • قايمة الـ Menu bar • موبايل (Control center).
بتظهر في الإعدادات ▸ التخصيص ▸ الأيقونات تقدر تخفيها وترجّعها.

لما تدوس عليها يظهر اختيارين:
1) خروج ومسح بياناتي من الجهاز — يخرج من الحساب ويمسح localStorage / sessionStorage / كل IndexedDB (المسودات والملفات المؤقتة) / Cache Storage / كاش الأندرويد، ويعمل reload. (اللغة بس هي اللي بتفضل.)
2) خروج فقط — زي الخروج العادي.
والإلغاء بـ Esc أو الضغط برّا.

ملفات جديدة: src/lib/wipeLocalData.js
ملفات معدّلة: context/AuthContext.jsx (logout({wipe:true})) • lib/draftStore.js • desktop/{DesktopOS,shell,macShell,MobileShell,OsIcons,prefs}.jsx/js • desktop/mac.css
