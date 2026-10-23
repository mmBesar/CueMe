/* Tiny i18n: English + Arabic. UI text only; scripts keep their own direction. */
(function (root) {
  'use strict';
  var T = {
    en: {
      display: 'Display', remote: 'Remote',
      display_hint: 'Show the script here. Works on its own too: tap the screen for controls',
      remote_hint: 'Control a CueMe display',
      connect: 'Connect', host: 'Address (e.g. 192.168.1.20:7878)', pin: 'PIN',
      nearby: 'Nearby CueMe', none_found: 'Nothing found - type the address',
      connecting: 'Connecting...', connected: 'Connected', offline: 'Offline - retrying',
      bad_pin: 'Wrong PIN', back: 'Back', this_device: 'This device',
      displays: 'displays', remotes: 'remotes', no_display: 'No display connected',
      play: 'Play', pause: 'Pause', top: 'Top', prev: 'Previous heading', next: 'Next heading',
      jog: 'Jog (release to stop)', scrub: 'Position', left: 'left',
      controls: 'Controls', script: 'Script', link: 'Connect',
      font_size: 'Text size', speed: 'Speed', width: 'Text width', dim: 'Dim', focus_pos: 'Cue line position',
      flip_x: 'Mirror (flip X)', flip_y: 'Flip Y', bold: 'Bold', focus: 'Focus band',
      text_color: 'Text color', bg_color: 'Background', countdown: 'Countdown (s)',
      auto_fullscreen: 'Fullscreen on play', fullscreen: 'Fullscreen',
      edit: 'Edit', preview: 'Preview', home: 'Main menu', session: 'Session', shared_session: 'Shared (everyone)', own_session: 'Private (this device only)', session_hint: 'Shared: all devices use one script. Private: this device gets its own; other devices join it from the list or by QR.', sessions_here: 'Sessions on this server', no_pin: '(no PIN)', fs_soft: 'Clean screen on. Press F11 once in this browser for real fullscreen.', send: 'Send to display', clear: 'Clear', confirm_clear: 'Clear the whole script?', save: 'Save', file_name: 'File name',
      library: 'Library', load: 'Load', del: 'Delete', empty_lib: 'No scripts yet',
      confirm_del: 'Delete this file?', saved: 'Saved', hide: 'Hide',
      scan_other: 'Open this address on another device', menu: 'Menu', cancel: 'Cancel',
      empty_script: 'No script yet. Tap the screen for controls, or open the menu to write or load one.',
      theme: 'Theme (Catppuccin)', theme_script: 'Use theme colours for the script',
      hide_controls: 'Hide controls', show_controls: 'Show controls', controls_hidden: 'Controls hidden. Tap the small dot to bring them back',
      sent: 'Sent', no_answer: 'The device did not answer. Check the connection and try again', save_fail: 'Not saved: the device did not confirm',
      font: 'Script font', keys_title: 'Keyboard', quit_no: 'Close this tab or window to quit',
      menu_add: 'Add to app menu', menu_remove: 'Remove from app menu', menu_added: 'Added to your app menu', menu_removed: 'Removed from your app menu', menu_fail: 'Could not change the app menu',
      k_play: 'Play / pause', k_scroll: 'Scroll while held', k_speed: 'Slower / faster', k_size: 'Text size', k_width: 'Text width',
      k_heading: 'Previous / next heading', k_nth: 'Jump to heading number', k_top: 'Top', k_end: 'Bottom', k_restart: 'Stop and go to the top',
      k_full: 'Fullscreen (from the remote: fullscreen the display)', k_esc: 'Close menu, then leave fullscreen', k_bar: 'Show / hide the control bar',
      k_menu: 'Menu', k_outline: 'Outline', k_edit: 'Edit script', k_flags: 'Mirror X, flip Y, bold, focus band', k_quit: 'Quit the app', k_help: 'This list',
      k_touch: 'Touch: drag the text to scroll, flick to glide, tap to show the control bar. Mouse: wheel or drag.',
      outline: 'Outline', outline_empty: 'No headings in this script. Start a line with # to make a heading.',
      fs_tap: 'Tap the display once, then try again', scan: 'Scan QR', scan_hint: 'Point the camera at the QR code on the display',
      scan_bad: 'That is not a CueMe code', scan_fail: 'Camera not available', saved_in: 'Scripts are saved in:',
      lang: 'العربية', keys: 'Keys: Space play/pause, Up/Down scroll, Left/Right speed, Alt+Up/Down size, [ ] width, Alt+F fullscreen, Alt+E edit, M menu'
    },
    ar: {
      display: 'عرض', remote: 'تحكم',
      display_hint: 'اعرض النص هنا. يعمل بمفرده أيضًا: المس الشاشة لإظهار التحكم',
      remote_hint: 'تحكّم في شاشة CueMe أخرى',
      connect: 'اتصال', host: 'العنوان (مثال 192.168.1.20:7878)', pin: 'الرمز',
      nearby: 'أجهزة CueMe القريبة', none_found: 'لا شيء - اكتب العنوان',
      connecting: 'جارٍ الاتصال...', connected: 'متصل', offline: 'غير متصل - إعادة المحاولة',
      bad_pin: 'الرمز غير صحيح', back: 'رجوع', this_device: 'هذا الجهاز',
      displays: 'شاشات', remotes: 'أجهزة تحكم', no_display: 'لا توجد شاشة متصلة',
      play: 'تشغيل', pause: 'إيقاف', top: 'البداية', prev: 'العنوان السابق', next: 'العنوان التالي',
      jog: 'تحريك (اتركه ليتوقف)', scrub: 'الموضع', left: 'متبقٍ',
      controls: 'الإعدادات', script: 'النص', link: 'الاتصال',
      font_size: 'حجم الخط', speed: 'السرعة', width: 'عرض النص', dim: 'التعتيم', focus_pos: 'موضع خط التركيز',
      flip_x: 'مرآة (قلب أفقي)', flip_y: 'قلب رأسي', bold: 'خط عريض', focus: 'نطاق التركيز',
      text_color: 'لون النص', bg_color: 'الخلفية', countdown: 'العد التنازلي (ث)',
      auto_fullscreen: 'ملء الشاشة عند التشغيل', fullscreen: 'ملء الشاشة',
      edit: 'تحرير', preview: 'معاينة', home: 'القائمة الرئيسية', session: 'الجلسة', shared_session: 'مشتركة (الجميع)', own_session: 'خاصة (هذا الجهاز فقط)', session_hint: 'المشتركة: كل الأجهزة تستخدم نصًا واحدًا. الخاصة: لهذا الجهاز جلسته، وتنضم إليها الأجهزة الأخرى من القائمة أو بالرمز.', sessions_here: 'الجلسات على هذا الخادم', no_pin: '(بدون رمز)', fs_soft: 'الشاشة النظيفة تعمل. اضغط F11 مرة واحدة في هذا المتصفح لملء الشاشة فعليًا.', send: 'إرسال إلى الشاشة', clear: 'مسح', confirm_clear: 'مسح السكربت بالكامل؟', save: 'حفظ', file_name: 'اسم الملف',
      library: 'المكتبة', load: 'فتح', del: 'حذف', empty_lib: 'لا توجد نصوص بعد',
      confirm_del: 'حذف هذا الملف؟', saved: 'تم الحفظ', hide: 'إخفاء',
      scan_other: 'افتح هذا العنوان على جهاز آخر', menu: 'القائمة', cancel: 'إلغاء',
      empty_script: 'لا يوجد نص بعد. المس الشاشة لإظهار التحكم، أو افتح القائمة لكتابة نص أو تحميله.',
      theme: 'السمة (Catppuccin)', theme_script: 'استخدم ألوان السمة للنص',
      hide_controls: 'إخفاء الأزرار', show_controls: 'إظهار الأزرار', controls_hidden: 'تم إخفاء الأزرار. المس النقطة الصغيرة لإعادتها',
      sent: 'تم الإرسال', no_answer: 'الجهاز لم يردّ. تحقق من الاتصال وأعد المحاولة', save_fail: 'لم يُحفظ: لم يؤكد الجهاز',
      font: 'خط النص', keys_title: 'لوحة المفاتيح', quit_no: 'أغلق التبويب أو النافذة للخروج',
      menu_add: 'إضافة إلى قائمة التطبيقات', menu_remove: 'إزالة من قائمة التطبيقات', menu_added: 'تمت الإضافة إلى قائمة التطبيقات', menu_removed: 'تمت الإزالة من قائمة التطبيقات', menu_fail: 'تعذّر تعديل قائمة التطبيقات',
      k_play: 'تشغيل / إيقاف', k_scroll: 'تمرير أثناء الضغط', k_speed: 'أبطأ / أسرع', k_size: 'حجم النص', k_width: 'عرض النص',
      k_heading: 'العنوان السابق / التالي', k_nth: 'الانتقال إلى العنوان رقم', k_top: 'البداية', k_end: 'النهاية', k_restart: 'إيقاف والعودة للبداية',
      k_full: 'ملء الشاشة (من جهاز التحكم: ملء شاشة العرض)', k_esc: 'إغلاق القائمة ثم الخروج من ملء الشاشة', k_bar: 'إظهار / إخفاء شريط التحكم',
      k_menu: 'القائمة', k_outline: 'الفهرس', k_edit: 'تحرير النص', k_flags: 'عكس أفقي، قلب رأسي، عريض، شريط التركيز', k_quit: 'إغلاق التطبيق', k_help: 'هذه القائمة',
      k_touch: 'اللمس: اسحب النص للتمرير، اقذفه للانزلاق، المس لإظهار شريط التحكم. الفأرة: العجلة أو السحب.',
      outline: 'الفهرس', outline_empty: 'لا توجد عناوين في هذا النص. ابدأ السطر بعلامة # لإنشاء عنوان.',
      fs_tap: 'المس شاشة العرض مرة ثم أعد المحاولة', scan: 'مسح رمز QR', scan_hint: 'وجّه الكاميرا إلى رمز QR على شاشة العرض',
      scan_bad: 'هذا ليس رمز CueMe', scan_fail: 'الكاميرا غير متاحة', saved_in: 'تُحفظ النصوص في:',
      lang: 'English', keys: 'اختصارات: مسافة تشغيل/إيقاف، أعلى/أسفل تمرير، يمين/يسار سرعة، Alt+أعلى/أسفل الحجم، [ ] العرض، Alt+F ملء الشاشة، Alt+E تحرير، M القائمة'
    }
  };
  var lang = 'en';
  try {
    var saved = localStorage.getItem('cueme_lang');
    if (saved === 'ar' || saved === 'en') lang = saved;
    else if (/^ar/i.test(navigator.language || '')) lang = 'ar';
  } catch (e) {}
  var api = {
    t: function (k) { return (T[lang] && T[lang][k]) || T.en[k] || k; },
    lang: function () { return lang; },
    toggle: function () {
      lang = lang === 'ar' ? 'en' : 'ar';
      try { localStorage.setItem('cueme_lang', lang); } catch (e) {}
      return lang;
    },
    dict: T
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CueI18n = api;
})(typeof window !== 'undefined' ? window : this);
